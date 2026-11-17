import { getFact, migrateWorld, validateWorld } from './document';
import { inferSurveyBounds, isGeographicBounds, mercatorLatLng, mercatorPoint } from './aerial';
import { getObjectBaseElevation, sampleTerrain } from './terrain';
import type { GeographicBounds, WorldDocument, WorldObject, WorldSource } from './types';
import { CURRENT_WORLD_VERSION } from './types';

export type CardinalDirection = 'north' | 'east' | 'south' | 'west';
const radians = Math.PI / 180;
const round = (n: number) => Math.round(n * 1000) / 1000;
const near = (a: number, b: number, tolerance = 1e-8) => Math.abs(a - b) <= tolerance;

/** Equal projected spans with an exact shared geographic edge; no date-line wrapping. */
export function adjacentBounds(
  bounds: GeographicBounds,
  direction: CardinalDirection,
): GeographicBounds {
  if (!isGeographicBounds(bounds)) throw new Error('Invalid adjacent survey bounds.');
  const sw = mercatorPoint(bounds.west, bounds.south),
    ne = mercatorPoint(bounds.east, bounds.north);
  let next: GeographicBounds;
  switch (direction) {
    case 'east':
      next = { ...bounds, west: bounds.east, east: bounds.east + bounds.east - bounds.west };
      break;
    case 'west':
      next = { ...bounds, east: bounds.west, west: bounds.west - (bounds.east - bounds.west) };
      break;
    case 'north':
      next = { ...bounds, south: bounds.north, north: mercatorLatLng(0, ne[1] + ne[1] - sw[1])[0] };
      break;
    case 'south':
      next = {
        ...bounds,
        north: bounds.south,
        south: mercatorLatLng(0, sw[1] - (ne[1] - sw[1]))[0],
      };
      break;
    default:
      throw new Error('Choose north, east, south or west.');
  }
  if (!isGeographicBounds(next))
    throw new Error('Adjacent bounds would cross the date line or exceed ±85° latitude.');
  return next;
}

interface Tile {
  id: string;
  world: WorldDocument;
  bounds: GeographicBounds;
  dx: number;
  dy: number;
  scale: number;
  width: number;
  depth: number;
  objectIds: Map<string, string>;
  sourceIds: Map<string, string>;
}
export interface AtlasResult {
  world: WorldDocument;
  warnings: string[];
  stats: {
    tiles: number;
    inputObjects: number;
    objects: number;
    deduplicated: number;
    seamFragments: number;
  };
}
function uniqueId(prefix: string, original: string, used: Set<string>): string {
  let hash = 2166136261;
  for (const character of original) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  const candidate = `${prefix}:${original}`;
  const base =
    candidate.length <= 120 ? candidate : `${candidate.slice(0, 109)}-${(hash >>> 0).toString(16)}`;
  let id = base,
    suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  used.add(id);
  return id;
}
function sourceKey(source: WorldSource) {
  return JSON.stringify([
    source.title,
    source.url,
    source.attribution,
    source.accessed,
    source.notes,
  ]);
}
function point(tile: Tile, x: number, y: number): [number, number] {
  return [tile.dx + x * tile.scale, tile.dy + y * tile.scale];
}
function terrainSample(tile: Tile, x: number, y: number): number | undefined {
  const grid = tile.world.terrain!;
  const clampRoundoff = (value: number, min: number, max: number) =>
    value < min && value >= min - 0.002 ? min : value > max && value <= max + 0.002 ? max : value;
  return sampleTerrain(
    tile.world,
    clampRoundoff(
      (x - tile.dx) / tile.scale,
      grid.origin.x,
      grid.origin.x + (grid.columns - 1) * grid.spacing,
    ),
    clampRoundoff(
      (y - tile.dy) / tile.scale,
      grid.origin.y,
      grid.origin.y + (grid.rows - 1) * grid.spacing,
    ),
  );
}
function canonicalDatum(datum: string): string {
  return datum === 'NAVD88 (CA_SanFrancisco_B23; GEOID18)' ? 'NAVD88 (GEOID18)' : datum;
}
function clipped(object: WorldObject) {
  return (
    getFact(object, 'import.clipped') === true ||
    getFact(object, 'import.centerlineClipped') === true
  );
}
function duplicateKey(object: WorldObject, originalId: string): string | undefined {
  if (object.evidence === 'authored' || object.parentId || clipped(object)) return;
  // This ID is local to an extraction; its first coastline way is evidence, not polygon identity.
  if (originalId.startsWith('osm-coastal-water-')) return;
  if (
    !/^osm-(node|way|relation)-/.test(originalId) &&
    typeof getFact(object, 'osm.element') !== 'string'
  )
    return;
  return (
    originalId +
    JSON.stringify(
      {
        ...object,
        id: undefined,
        sourceId: undefined,
        facts: object.facts?.map((f) => ({ ...f, sourceIds: undefined })),
        references: object.references?.map((r) => ({ ...r, sourceId: undefined })),
      },
      (_key, value) => (typeof value === 'number' ? round(value) : value),
    )
  );
}
function mergeEvidence(target: WorldObject, incoming: WorldObject): boolean {
  const references = [...(target.references ?? []), ...(incoming.references ?? [])];
  for (const sourceId of [target.sourceId, incoming.sourceId])
    if (sourceId && !references.some((r) => r.sourceId === sourceId))
      references.push({ sourceId, role: 'map' });
  const uniqueReferences = [...new Map(references.map((r) => [JSON.stringify(r), r])).values()];
  const facts = target.facts?.map((fact, index) => {
    const ids = [
      ...new Set([...(fact.sourceIds ?? []), ...(incoming.facts?.[index].sourceIds ?? [])]),
    ];
    return ids.length ? { ...fact, sourceIds: ids } : fact;
  });
  if (uniqueReferences.length > 32 || facts?.some((f) => (f.sourceIds?.length ?? 0) > 32))
    return false;
  if (uniqueReferences.length) target.references = uniqueReferences;
  if (facts) target.facts = facts;
  return true;
}

/** A coarse grid must not bridge a source hole merely because its corners are valid. */
function maskUnknownCells(
  tiles: Tile[],
  heights: (number | null)[],
  columns: number,
  rows: number,
  spacing: number,
  width: number,
  depth: number,
): number {
  const invalid = new Set<number>();
  let unknownCells = 0;
  for (let row = 0; row < rows - 1; row++)
    for (let column = 0; column < columns - 1; column++) {
      const left = column * spacing,
        right = Math.min((column + 1) * spacing, width),
        bottom = row * spacing,
        top = Math.min((row + 1) * spacing, depth);
      if (right <= left || top <= bottom) continue;
      let covered = 0,
        unknown = false;
      for (const tile of tiles) {
        const grid = tile.world.terrain!,
          pitch = grid.spacing * tile.scale,
          gridLeft = tile.dx + grid.origin.x * tile.scale,
          gridBottom = tile.dy + grid.origin.y * tile.scale;
        const x0 = Math.max(left, tile.dx, gridLeft),
          x1 = Math.min(right, tile.dx + tile.width, gridLeft + (grid.columns - 1) * pitch),
          y0 = Math.max(bottom, tile.dy, gridBottom),
          y1 = Math.min(top, tile.dy + tile.depth, gridBottom + (grid.rows - 1) * pitch);
        if (x1 <= x0 || y1 <= y0) continue;
        covered += (x1 - x0) * (y1 - y0);
        const startX = Math.max(0, Math.floor((x0 - gridLeft) / pitch)),
          endX = Math.min(grid.columns - 2, Math.ceil((x1 - gridLeft) / pitch) - 1),
          startY = Math.max(0, Math.floor((y0 - gridBottom) / pitch)),
          endY = Math.min(grid.rows - 2, Math.ceil((y1 - gridBottom) / pitch) - 1);
        for (let y = startY; y <= endY && !unknown; y++)
          for (let x = startX; x <= endX; x++) {
            const i = y * grid.columns + x;
            if (
              [i, i + 1, i + grid.columns, i + grid.columns + 1].some(
                (index) => grid.heights[index] === null,
              )
            ) {
              unknown = true;
              break;
            }
          }
      }
      // Imported extents are rounded to millimetres; do not turn that roundoff into a false gap.
      const tolerance = 0.002 * (right - left + (top - bottom));
      if (unknown || covered < (right - left) * (top - bottom) - tolerance) {
        unknownCells++;
        for (const i of [
          row * columns + column,
          row * columns + column + 1,
          (row + 1) * columns + column,
          (row + 1) * columns + column + 1,
        ])
          invalid.add(i);
      }
    }
  for (const i of invalid) heights[i] = null;
  return unknownCells;
}

/** Flatten 2–4 adjacent immutable snapshots into a regular renderer-independent document. */
export function combineSurveyWorlds(
  worlds: WorldDocument[],
  options: { name?: string } = {},
): AtlasResult {
  if (!Array.isArray(worlds) || worlds.length < 2 || worlds.length > 4)
    throw new Error('Choose 2–4 ordinary saved surveys to combine.');
  const inputs = worlds.map((world) => {
    if (world.composition)
      throw new Error('Choose ordinary surveys; nested compositions are not supported.');
    const copy = migrateWorld(world),
      bounds = inferSurveyBounds(copy);
    if (!bounds)
      throw new Error(
        `“${world.name}” has no verified geographic survey frame. Use a mapped survey tile.`,
      );
    const sw = mercatorPoint(bounds.west, bounds.south),
      ne = mercatorPoint(bounds.east, bounds.north);
    const scale = Math.cos(((bounds.south + bounds.north) / 2) * radians);
    const width = (ne[0] - sw[0]) * scale,
      depth = (ne[1] - sw[1]) * scale;
    if (
      !near(world.origin.longitude, bounds.west) ||
      !near(world.origin.latitude, bounds.south) ||
      !near(width, world.bounds.width, 0.025) ||
      !near(depth, world.bounds.depth, 0.025)
    )
      throw new Error(
        `“${world.name}” has inconsistent geographic bounds and local placement dimensions.`,
      );
    if (width > 1000.01 || depth > 1000.01)
      throw new Error('Each source survey must be at most 1 km in either direction.');
    return { world: copy, bounds, sw, scale };
  });
  const links = inputs.map(() => new Set<number>());
  for (let i = 0; i < inputs.length; i++)
    for (let j = i + 1; j < inputs.length; j++) {
      const a = inputs[i].bounds,
        b = inputs[j].bounds;
      const x = Math.min(a.east, b.east) - Math.max(a.west, b.west),
        y = Math.min(a.north, b.north) - Math.max(a.south, b.south);
      if (x > 1e-8 && y > 1e-8)
        throw new Error('Selected surveys overlap. Choose adjacent, non-overlapping copies.');
      if (
        ((near(a.east, b.west) || near(b.east, a.west)) && y > 1e-8) ||
        ((near(a.north, b.south) || near(b.north, a.south)) && x > 1e-8)
      ) {
        links[i].add(j);
        links[j].add(i);
      }
    }
  const connected = new Set([0]),
    queue = [0];
  for (const i of queue)
    for (const j of links[i])
      if (!connected.has(j)) {
        connected.add(j);
        queue.push(j);
      }
  if (connected.size !== inputs.length)
    throw new Error('Surveys must form one connected area sharing cardinal edges.');
  const bounds = {
    west: Math.min(...inputs.map((t) => t.bounds.west)),
    south: Math.min(...inputs.map((t) => t.bounds.south)),
    east: Math.max(...inputs.map((t) => t.bounds.east)),
    north: Math.max(...inputs.map((t) => t.bounds.north)),
  };
  const sw = mercatorPoint(bounds.west, bounds.south),
    ne = mercatorPoint(bounds.east, bounds.north);
  const scale = Math.cos(((bounds.south + bounds.north) / 2) * radians),
    width = round((ne[0] - sw[0]) * scale),
    depth = round((ne[1] - sw[1]) * scale);
  if (width > 2000.01 || depth > 2000.01)
    throw new Error('The combined area must fit within 2 km in each direction.');
  const warnings: string[] = [],
    sourceIds = new Set<string>(),
    objectIds = new Set<string>(),
    sources: WorldSource[] = [];
  const sourceLookup = new Map<string, string>();
  const tiles: Tile[] = inputs.map((input, index) => {
    const tile: Tile = {
      ...input,
      id: `tile${index + 1}`,
      dx: (input.sw[0] - sw[0]) * scale,
      dy: (input.sw[1] - sw[1]) * scale,
      scale: scale / input.scale,
      width: (input.world.bounds.width * scale) / input.scale,
      depth: (input.world.bounds.depth * scale) / input.scale,
      objectIds: new Map(),
      sourceIds: new Map(),
    };
    for (const source of tile.world.sources) {
      const key = sourceKey(source),
        existing = sourceLookup.get(key);
      if (existing) tile.sourceIds.set(source.id, existing);
      else {
        const id = uniqueId(tile.id, source.id, sourceIds);
        tile.sourceIds.set(source.id, id);
        sources.push({ ...source, id });
        sourceLookup.set(key, id);
      }
    }
    for (const object of tile.world.objects)
      tile.objectIds.set(object.id, uniqueId(tile.id, object.id, objectIds));
    return tile;
  });
  const world: WorldDocument = {
    format: 'wordscape',
    version: CURRENT_WORLD_VERSION,
    name: (options.name ?? `${worlds[0].name} · combined surveys`).slice(0, 200),
    description:
      'Combined geographic surveys. Source snapshots remain unchanged. Shared-boundary clipped fragments are retained; no missing geometry is invented.',
    units: 'metres',
    bounds: { width, depth },
    origin: {
      latitude: bounds.south,
      longitude: bounds.west,
      note: `Southwest local frame; x east, y north. Web Mercator scaled by ${scale}. Composed from recorded survey frames.`,
    },
    seed: worlds[0].seed,
    sources,
    objects: [],
    relations: [],
    composition: {
      type: 'survey-atlas',
      tiles: tiles.map((t) => ({
        id: t.id,
        name: t.world.name,
        description: t.world.description,
        seed: t.world.seed,
        bounds: { ...t.bounds },
        sourceIds: [...t.sourceIds.values()],
      })),
    },
  };
  const terrainTiles = tiles.filter((t) => t.world.terrain);
  if (terrainTiles.length && terrainTiles.length !== tiles.length)
    throw new Error(
      'Some selected surveys have no terrain. Complete their terrain first, or combine surveys that are all flat.',
    );
  if (terrainTiles.length) {
    const datum = canonicalDatum(terrainTiles[0].world.terrain!.verticalDatum);
    if (
      terrainTiles.some((t) => canonicalDatum(t.world.terrain!.verticalDatum) !== datum) ||
      /unknown|mixed|unverified|not established|source datum/i.test(datum)
    )
      throw new Error(
        'Terrain datums are incompatible or not established. Combine surveys with the same verified vertical datum.',
      );
    const desiredSpacing = Math.max(...terrainTiles.map((t) => t.world.terrain!.spacing * t.scale));
    const longest = Math.max(width, depth),
      intervals = Math.min(256, Math.max(1, Math.ceil(longest / desiredSpacing)));
    const spacing = longest / intervals;
    const columns = Math.ceil(width / spacing - 1e-10) + 1,
      rows = Math.ceil(depth / spacing - 1e-10) + 1;
    const heights: (number | null)[] = [];
    let seamDifference = 0;
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = column * spacing,
          y = row * spacing;
        const insideAtlas = x <= width + 0.002 && y <= depth + 0.002;
        const eligible = terrainTiles.filter(
          (t) =>
            !insideAtlas ||
            (x >= t.dx - 0.002 &&
              x <= t.dx + t.width + 0.002 &&
              y >= t.dy - 0.002 &&
              y <= t.dy + t.depth + 0.002),
        );
        const values = eligible
          .map((t) => terrainSample(t, x, y))
          .filter((n): n is number => n !== undefined);
        if (values.length > 1)
          seamDifference = Math.max(seamDifference, Math.max(...values) - Math.min(...values));
        heights.push(values.length ? round(values[0]) : null);
      }
    const masked = maskUnknownCells(terrainTiles, heights, columns, rows, spacing, width, depth);
    if (masked)
      warnings.push(
        `${masked} output terrain cells intersect missing source coverage. Their vertices remain null; conservative masking can widen a gap by up to two grid intervals.`,
      );
    const finite = heights.filter((n): n is number => n !== null);
    if (!finite.length)
      throw new Error('The selected terrain grids have no sample coverage in the combined frame.');
    const id = uniqueId('atlas', 'terrain', sourceIds),
      grids = terrainTiles.map((t) => t.world.terrain!);
    sources.push({
      id,
      title: 'Combined survey elevation grids',
      url: '',
      attribution: 'Derived from the retained elevation sources listed in the composition tiles.',
      accessed: '',
      notes: `Bilinear resampling in a common local frame; original absolute heights and datum retained. Input source IDs and datum labels: ${terrainTiles.map((t) => `${t.sourceIds.get(t.world.terrain!.sourceId)} [${t.world.terrain!.verticalDatum}]`).join(', ')}. Shared-edge priority follows the listed tile order; missing coverage remains null.`,
    });
    world.terrain = {
      type: 'height-grid',
      columns,
      rows,
      spacing,
      origin: { x: 0, y: 0 },
      heights,
      verticalDatum: datum,
      referenceElevation: Math.floor(Math.min(...finite) / 10) * 10,
      sourceId: id,
      interpolation: 'bilinear',
      ...(grids.every((g) => g.sourceResolution !== undefined)
        ? { sourceResolution: Math.max(...grids.map((g) => g.sourceResolution!)) }
        : {}),
      ...(grids.every((g) => g.sampledResolution !== undefined)
        ? { sampledResolution: Math.max(...grids.map((g) => g.sampledResolution!)) }
        : {}),
      notes:
        'Derived combined grid; no increase in native source detail. Unsurveyed areas and source gaps remain null.',
    };
    if (seamDifference > 0.05)
      warnings.push(
        `Shared-edge elevation samples differ by up to ${seamDifference.toFixed(2)} m; the first listed tile takes precedence.`,
      );
  }
  const aerial = tiles.find((t) => t.world.aerial);
  if (aerial)
    world.aerial = {
      ...aerial.world.aerial!,
      bounds,
      sourceId: aerial.sourceIds.get(aerial.world.aerial!.sourceId)!,
    };
  let deduplicated = 0,
    seamFragments = 0;
  const duplicates = new Map<string, WorldObject>();
  for (const tile of tiles) {
    const parents = new Set(tile.world.objects.map((o) => o.parentId).filter(Boolean));
    for (const original of tile.world.objects) {
      const object = structuredClone(original),
        [x, y] = point(tile, object.x, object.y);
      object.id = tile.objectIds.get(original.id)!;
      object.x = x;
      object.y = y;
      object.width *= tile.scale;
      object.depth *= tile.scale;
      if (object.footprint)
        object.footprint = object.footprint.map(([x, y]) => [x * tile.scale, y * tile.scale]);
      if (tile.world.terrain && world.terrain) {
        const delta = tile.world.terrain.referenceElevation - world.terrain.referenceElevation;
        if (object.grounding !== 'terrain') object.elevation += delta;
        else if (object.kind === 'building' || object.kind === 'landmark') {
          const base = getObjectBaseElevation(tile.world, original),
            anchor = getObjectBaseElevation(world, {
              ...object,
              elevation: 0,
              terrainCorrection: 0,
            });
          if (base !== undefined && anchor !== undefined)
            object.terrainCorrection = base + delta - anchor - object.elevation;
        }
      }
      if (object.sourceId) object.sourceId = tile.sourceIds.get(object.sourceId)!;
      object.facts = object.facts?.map((fact) => {
        const next = {
          ...fact,
          ...(fact.sourceIds
            ? { sourceIds: fact.sourceIds.map((id) => tile.sourceIds.get(id)!) }
            : {}),
        };
        if (fact.key === 'path.centerline' && typeof fact.value === 'string') {
          let points: unknown;
          try {
            points = JSON.parse(fact.value);
          } catch {
            throw new Error(`Object “${original.id}” has invalid path.centerline coordinates.`);
          }
          if (
            !Array.isArray(points) ||
            points.length !== 2 ||
            points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
          )
            throw new Error(`Object “${original.id}” has invalid path.centerline coordinates.`);
          next.value = JSON.stringify(
            (points as [number, number][]).map(([x, y]) => point(tile, x, y).map(round)),
          );
        }
        return next;
      });
      if (object.references)
        object.references = object.references.map((r) => ({
          ...r,
          sourceId: tile.sourceIds.get(r.sourceId)!,
        }));
      const key = parents.has(original.id) ? undefined : duplicateKey(object, original.id);
      const duplicate = key ? duplicates.get(key) : undefined;
      if (duplicate && mergeEvidence(duplicate, object)) {
        tile.objectIds.set(original.id, duplicate.id);
        deduplicated++;
        continue;
      }
      if (key) duplicates.set(key, object);
      if (clipped(object)) seamFragments++;
      world.objects.push(object);
    }
  }
  // Resolve IDs after deduplication; parents remain metadata, never hidden transforms.
  const relationKeys = new Set<string>();
  for (const tile of tiles) {
    for (const original of tile.world.objects)
      if (original.parentId) {
        const object = world.objects.find((o) => o.id === tile.objectIds.get(original.id));
        if (object) object.parentId = tile.objectIds.get(original.parentId)!;
      }
    for (const relation of tile.world.relations) {
      const mapped = {
        ...relation,
        from: tile.objectIds.get(relation.from)!,
        to: tile.objectIds.get(relation.to)!,
      };
      const key = JSON.stringify(mapped);
      if (!relationKeys.has(key)) {
        world.relations.push(mapped);
        relationKeys.add(key);
      }
    }
  }
  if (seamFragments)
    warnings.push(
      `${seamFragments} clipped fragments are retained separately with their original physical bases. Their cuts are not asserted to be real exterior walls; roof steps may remain and no polygon union was guessed.`,
    );
  if (deduplicated)
    warnings.push(
      `${deduplicated} identical un-authored mapped objects were consolidated, retaining their source links.`,
    );
  const corrected = world.objects.filter(
    (object) => Math.abs(object.terrainCorrection ?? 0) > 0.05,
  );
  if (corrected.length)
    warnings.push(
      `${corrected.length} solid bases retain derived resampling corrections up to ${Math.max(...corrected.map((object) => Math.abs(object.terrainCorrection!))).toFixed(2)} m. Original elevation offsets and flat comparison remain unchanged.`,
    );
  const errors = validateWorld(world).errors;
  if (errors.length) throw new Error(`The combined survey is not valid: ${errors[0]}`);
  return {
    world,
    warnings,
    stats: {
      tiles: tiles.length,
      inputObjects: worlds.reduce((sum, w) => sum + w.objects.length, 0),
      objects: world.objects.length,
      deduplicated,
      seamFragments,
    },
  };
}
