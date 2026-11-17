import {
  CURRENT_WORLD_VERSION,
  KIND_LABELS,
  type ObjectKind,
  type WorldDocument,
  type WorldObject,
} from './types.ts';
import { getFootprint } from './geometry.ts';
import { getObjectBaseElevation } from './terrain.ts';
import { validateGeometryRecipe } from './geometryRecipe.ts';
export { getFootprint } from './geometry.ts';

type Point = [number, number];
type RecordValue = Record<string, unknown>;
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ATLAS_BYTES = 16 * 1024 * 1024;
const EPSILON = 1e-8;
const KINDS = Object.keys(KIND_LABELS);
const encoder = new TextEncoder();
const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function getWorldLimits(world: unknown) {
  const atlas =
    isRecord(world) &&
    ['0.6', '0.7', '0.8'].includes(world.version as string) &&
    world.composition !== undefined;
  return {
    objects: atlas ? 4000 : 1000,
    sources: atlas ? 400 : 100,
    relations: atlas ? 16000 : 4000,
    bytes: atlas ? MAX_ATLAS_BYTES : MAX_BYTES,
  };
}

export function parseWorld(input: string): WorldDocument {
  if (typeof input !== 'string') throw new Error('The world document must be JSON text.');
  if (input.length > MAX_ATLAS_BYTES || encoder.encode(input).byteLength > MAX_ATLAS_BYTES) {
    throw new Error('The world document is too large. The maximum atlas input limit is 16 MiB.');
  }
  let value: WorldDocument;
  try {
    value = JSON.parse(input);
  } catch (error) {
    throw new Error(
      `Invalid JSON. ${error instanceof Error ? error.message : 'Check commas and quotation marks.'}`,
      { cause: error },
    );
  }
  if (encoder.encode(input).byteLength > getWorldLimits(value).bytes)
    throw new Error('The ordinary world input limit is 4 MiB.');
  assertValid(value);
  return value;
}

function assertValid(world: WorldDocument): void {
  const { errors } = validateWorld(world);
  if (errors.length) {
    throw new Error(
      `Invalid world document:\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…and ${errors.length - 8} more errors.` : ''}`,
    );
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

export function serializeWorld(world: WorldDocument, pretty = true): string {
  assertValid(world);
  const value = canonical(world);
  const output = JSON.stringify(value, null, pretty ? 2 : undefined);
  // Accepted documents must remain importable even when indentation is expensive.
  const limit = getWorldLimits(world).bytes;
  return pretty && (output.length > limit || encoder.encode(output).byteLength > limit)
    ? JSON.stringify(value)
    : output;
}

export function documentBytes(world: WorldDocument): number {
  return encoder.encode(serializeWorld(world, false)).byteLength;
}

const cross = (a: Point, b: Point, c: Point): number =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function onSegment(point: Point, a: Point, b: Point): boolean {
  return (
    Math.abs(cross(a, b, point)) <= EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}
function edgesCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  return (
    ((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
    ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))
  );
}

function validPolygon(points: Point[]): boolean {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON) return false;
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        edgesCross(a, b, c, d) ||
        onSegment(a, c, d) ||
        onSegment(b, c, d) ||
        onSegment(c, a, b) ||
        onSegment(d, a, b)
      )
        return false;
    }
  }
  return Math.abs(area) > EPSILON;
}

function inside(point: Point, polygon: Point[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (onSegment(point, a, b)) return false; // Shared edges are not occupied area.
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}

function polygonsOverlap(a: Point[], b: Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (edgesCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
    }
  }
  if (a.some((point) => inside(point, b)) || b.some((point) => inside(point, a))) return true;
  for (const [polygon, other] of [
    [a, b],
    [b, a],
  ]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i],
        q = polygon[(i + 1) % polygon.length];
      if (inside([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], other)) return true;
    }
  }
  // Identical or collinearly overlapping polygons may have every vertex on an edge.
  // A simple polygon has an ear; test candidate ear centres in both interiors.
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[(i + polygon.length - 1) % polygon.length],
        q = polygon[i],
        r = polygon[(i + 1) % polygon.length];
      const point: Point = [(p[0] + q[0] + r[0]) / 3, (p[1] + q[1] + r[1]) / 3];
      if (inside(point, a) && inside(point, b)) return true;
    }
  }
  return false;
}

/** Runtime validation deliberately accepts malformed runtime values without crashing. */
export function validateWorld(world: WorldDocument): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const record = (value: unknown, path: string, keys: string[]): RecordValue | undefined => {
    if (!isRecord(value)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    for (const key of Object.keys(value))
      if (!keys.includes(key))
        errors.push(`${path}.${key} is not a supported field in this format version.`);
    return value;
  };
  const string = (value: unknown, path: string, max = 10000, min = 0): value is string => {
    if (typeof value !== 'string' || [...value].length < min || [...value].length > max) {
      errors.push(`${path} must be text with ${min}–${max} characters.`);
      return false;
    }
    return true;
  };
  const id = (value: unknown, path: string): value is string => {
    if (!string(value, path, 128, 1)) return false;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value)) {
      errors.push(`${path} must be an identifier using letters, digits, _, ., :, or -.`);
      return false;
    }
    return true;
  };
  const number = (
    value: unknown,
    path: string,
    min: number,
    max: number,
    integer = false,
    positive = false,
  ): value is number => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value)) ||
      (positive && value <= 0)
    ) {
      errors.push(
        `${path} must be a finite ${integer ? 'integer' : 'number'} ${positive ? 'greater than 0 and ' : `between ${min} and `}${max}.`,
      );
      return false;
    }
    return true;
  };
  const choice = (value: unknown, path: string, choices: readonly string[]): void => {
    if (typeof value !== 'string' || !choices.includes(value))
      errors.push(`${path} must be ${choices.join(' | ')}.`);
  };
  const array = (value: unknown, path: string, max: number, min = 0): unknown[] => {
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      errors.push(`${path} must be an array with ${min}–${max} entries.`);
      return [];
    }
    return value;
  };
  const root = record(world, 'world', [
    'format',
    'version',
    'name',
    'description',
    'units',
    'bounds',
    'origin',
    'seed',
    'sources',
    'objects',
    'relations',
    'terrain',
    'aerial',
    'composition',
    'imaginary',
  ]);
  if (!root) return { errors, warnings };
  choice(root.format, 'format', ['wordscape']);
  choice(root.version, 'version', ['0.1', '0.2', '0.3', '0.4', '0.5', '0.6', '0.7', '0.8']);
  const limits = getWorldLimits(root);
  choice(root.units, 'units', ['metres']);
  string(root.name, 'name', 200, 1);
  string(root.description, 'description');
  number(root.seed, 'seed', 0, 4294967295, true);
  const bounds = record(root.bounds, 'bounds', ['width', 'depth']);
  if (bounds)
    for (const key of ['width', 'depth'])
      number(bounds[key], `bounds.${key}`, 0, 100000, false, true);
  const origin = record(root.origin, 'origin', ['latitude', 'longitude', 'note']);
  if (origin) {
    number(origin.latitude, 'origin.latitude', -90, 90);
    number(origin.longitude, 'origin.longitude', -180, 180);
    string(origin.note, 'origin.note');
  }
  const sourceIds = new Set<string>();
  if (root.imaginary !== undefined) {
    if (!['0.7', '0.8'].includes(root.version as string))
      errors.push('imaginary requires format version 0.7 or later.');
    const imaginary = record(root.imaginary, 'imaginary', ['brief', 'guideVersion']);
    if (imaginary) {
      string(imaginary.brief, 'imaginary.brief', 4000);
      string(imaginary.guideVersion, 'imaginary.guideVersion', 100, 1);
    }
    if (root.aerial !== undefined || root.composition !== undefined)
      errors.push(
        'An imaginary world cannot have a geographic aerial reference or survey composition.',
      );
    if (origin && (origin.latitude !== 0 || origin.longitude !== 0))
      errors.push('An imaginary world uses the explicit non-geographic 0/0 origin placeholder.');
  }
  array(root.sources, 'sources', limits.sources).forEach((value, index) => {
    const path = `sources[${index}]`;
    const source = record(value, path, ['id', 'title', 'url', 'attribution', 'accessed', 'notes']);
    if (!source) return;
    if (id(source.id, `${path}.id`)) {
      if (sourceIds.has(source.id)) errors.push(`${path}.id: duplicate source ID "${source.id}".`);
      sourceIds.add(source.id);
    }
    string(source.title, `${path}.title`, 500, 1);
    if (
      string(source.url, `${path}.url`, 2048) &&
      source.url !== '' &&
      !/^https?:\/\//.test(source.url)
    )
      errors.push(`${path}.url must be an HTTP(S) URL or empty.`);
    string(source.attribution, `${path}.attribution`);
    string(source.accessed, `${path}.accessed`, 100);
    string(source.notes, `${path}.notes`);
  });
  if (root.composition !== undefined) {
    if (!['0.6', '0.7', '0.8'].includes(root.version as string))
      errors.push('composition requires format version 0.6 or later.');
    const composition = record(root.composition, 'composition', ['type', 'tiles']);
    if (composition) {
      choice(composition.type, 'composition.type', ['survey-atlas']);
      const tileIds = new Set<string>();
      array(composition.tiles, 'composition.tiles', 4, 2).forEach((value, index) => {
        const path = `composition.tiles[${index}]`;
        const tile = record(value, path, [
          'id',
          'name',
          'description',
          'seed',
          'bounds',
          'sourceIds',
        ]);
        if (!tile) return;
        if (id(tile.id, `${path}.id`)) {
          if (tileIds.has(tile.id)) errors.push(`${path}.id duplicates a tile ID.`);
          tileIds.add(tile.id);
        }
        string(tile.name, `${path}.name`, 200, 1);
        string(tile.description, `${path}.description`);
        number(tile.seed, `${path}.seed`, 0, 4294967295, true);
        const extent = record(tile.bounds, `${path}.bounds`, ['west', 'south', 'east', 'north']);
        if (extent) {
          for (const key of ['west', 'east'])
            number(extent[key], `${path}.bounds.${key}`, -180, 180);
          for (const key of ['south', 'north'])
            number(extent[key], `${path}.bounds.${key}`, -85, 85);
          if (
            !(Number(extent.west) < Number(extent.east)) ||
            !(Number(extent.south) < Number(extent.north))
          )
            errors.push(`${path}.bounds must be ordered west/east and south/north.`);
        }
        array(tile.sourceIds, `${path}.sourceIds`, 100).forEach((value, i) => {
          if (id(value, `${path}.sourceIds[${i}]`) && !sourceIds.has(value))
            errors.push(`${path}.sourceIds[${i}] refers to missing source "${value}".`);
        });
      });
    }
    if (bounds)
      for (const key of ['width', 'depth'])
        number(bounds[key], `composition bounds.${key}`, 0, 2000.01, false, true);
  }
  if (root.aerial !== undefined) {
    if (!['0.5', '0.6', '0.7', '0.8'].includes(root.version as string))
      errors.push('aerial requires format version 0.5 or later.');
    const aerial = record(root.aerial, 'aerial', ['type', 'provider', 'bounds', 'sourceId']);
    if (aerial) {
      choice(aerial.type, 'aerial.type', ['online-imagery']);
      choice(aerial.provider, 'aerial.provider', ['usgs-imagery']);
      const extent = record(aerial.bounds, 'aerial.bounds', ['west', 'south', 'east', 'north']);
      if (extent) {
        const west = number(extent.west, 'aerial.bounds.west', -180, 180);
        const east = number(extent.east, 'aerial.bounds.east', -180, 180);
        const south = number(extent.south, 'aerial.bounds.south', -85, 85);
        const north = number(extent.north, 'aerial.bounds.north', -85, 85);
        if (west && east && (extent.west as number) >= (extent.east as number))
          errors.push('aerial.bounds must run west to east without crossing the date line.');
        if (south && north && (extent.south as number) >= (extent.north as number))
          errors.push('aerial.bounds must run south to north.');
      }
      if (id(aerial.sourceId, 'aerial.sourceId') && !sourceIds.has(aerial.sourceId))
        errors.push(`aerial.sourceId refers to missing source "${aerial.sourceId}".`);
    }
  }
  if (root.terrain !== undefined) {
    if (!['0.3', '0.4', '0.5', '0.6', '0.7', '0.8'].includes(root.version as string))
      errors.push('terrain requires format version 0.3 or later.');
    const terrain = record(root.terrain, 'terrain', [
      'type',
      'evidence',
      'columns',
      'rows',
      'spacing',
      'origin',
      'heights',
      'verticalDatum',
      'referenceElevation',
      'sourceId',
      'sourceResolution',
      'sampledResolution',
      'interpolation',
      'verticalAccuracy',
      'acquired',
      'notes',
    ]);
    if (terrain) {
      choice(terrain.type, 'terrain.type', ['height-grid']);
      if (terrain.evidence !== undefined) {
        if (root.version !== '0.8') errors.push('terrain.evidence requires format version 0.8.');
        choice(terrain.evidence, 'terrain.evidence', ['authored', 'sourced']);
      }
      choice(terrain.interpolation, 'terrain.interpolation', ['bilinear']);
      const columnsValid = number(terrain.columns, 'terrain.columns', 2, 257, true);
      const rowsValid = number(terrain.rows, 'terrain.rows', 2, 257, true);
      const spacingValid = number(terrain.spacing, 'terrain.spacing', 0, 100000, false, true);
      const origin = record(terrain.origin, 'terrain.origin', ['x', 'y']);
      if (origin) {
        const xValid = number(origin.x, 'terrain.origin.x', -1000000, 1000000);
        const yValid = number(origin.y, 'terrain.origin.y', -1000000, 1000000);
        if (xValid && columnsValid && spacingValid)
          number(
            (origin.x as number) + ((terrain.columns as number) - 1) * (terrain.spacing as number),
            'terrain.extent.x',
            -1000000,
            1000000,
          );
        if (yValid && rowsValid && spacingValid)
          number(
            (origin.y as number) + ((terrain.rows as number) - 1) * (terrain.spacing as number),
            'terrain.extent.y',
            -1000000,
            1000000,
          );
      }
      const heights = array(terrain.heights, 'terrain.heights', 66049, 4);
      if (
        columnsValid &&
        rowsValid &&
        heights.length !== (terrain.columns as number) * (terrain.rows as number)
      )
        errors.push('terrain.heights must contain exactly columns × rows samples.');
      heights.forEach((height, index) => {
        if (height !== null) number(height, `terrain.heights[${index}]`, -100000, 100000);
      });
      string(terrain.verticalDatum, 'terrain.verticalDatum', 200, 1);
      number(terrain.referenceElevation, 'terrain.referenceElevation', -100000, 100000);
      if (
        !['0.5', '0.6', '0.7', '0.8'].includes(root.version as string) ||
        terrain.sourceResolution !== undefined
      )
        number(terrain.sourceResolution, 'terrain.sourceResolution', 0, 100000, false, true);
      if (terrain.sampledResolution !== undefined) {
        if (!['0.5', '0.6', '0.7', '0.8'].includes(root.version as string))
          errors.push('terrain.sampledResolution requires format version 0.5.');
        number(terrain.sampledResolution, 'terrain.sampledResolution', 0, 100000, false, true);
      }
      if (id(terrain.sourceId, 'terrain.sourceId') && !sourceIds.has(terrain.sourceId))
        errors.push(`terrain.sourceId refers to missing source "${terrain.sourceId}".`);
      if (terrain.verticalAccuracy !== undefined)
        number(terrain.verticalAccuracy, 'terrain.verticalAccuracy', 0, 100000);
      if (terrain.notes !== undefined) string(terrain.notes, 'terrain.notes');
      if (terrain.acquired !== undefined) {
        const acquired = record(terrain.acquired, 'terrain.acquired', ['start', 'end']);
        if (acquired) {
          for (const key of ['start', 'end']) {
            const value = acquired[key];
            if (!string(value, `terrain.acquired.${key}`, 10, 10)) continue;
            const date = new Date(`${value}T00:00:00.000Z`);
            if (
              !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
              !Number.isFinite(date.getTime()) ||
              date.toISOString().slice(0, 10) !== value
            )
              errors.push(
                `terrain.acquired.${key} must be a valid ISO calendar date (YYYY-MM-DD).`,
              );
          }
          if (
            typeof acquired.start === 'string' &&
            typeof acquired.end === 'string' &&
            acquired.start > acquired.end
          )
            errors.push('terrain.acquired.end must be on or after terrain.acquired.start.');
        }
      }
    }
  }
  const objectIds = new Set<string>();
  const parents = new Map<string, string>();
  const parentPaths = new Map<string, string>();
  const objects = array(root.objects, 'objects', limits.objects);
  objects.forEach((value, index) => {
    const path = `objects[${index}]`;
    const object = record(value, path, [
      'id',
      'label',
      'kind',
      'description',
      'x',
      'y',
      'width',
      'depth',
      'height',
      'elevation',
      'rotation',
      'layer',
      'evidence',
      'sourceId',
      'footprint',
      'tags',
      'parentId',
      'facts',
      'references',
      'grounding',
      'terrainAnchor',
      'terrainCorrection',
      'geometry',
    ]);
    if (!object) return;
    if (id(object.id, `${path}.id`)) {
      if (objectIds.has(object.id)) errors.push(`${path}.id: duplicate object ID "${object.id}".`);
      objectIds.add(object.id);
    }
    string(object.label, `${path}.label`, 160, 1);
    string(object.description, `${path}.description`);
    choice(
      object.kind,
      `${path}.kind`,
      root.version === '0.1' ? KINDS.filter((kind) => kind !== 'fixture') : KINDS,
    );
    choice(object.evidence, `${path}.evidence`, ['observed', 'inferred', 'authored']);
    for (const key of ['x', 'y']) number(object[key], `${path}.${key}`, -1000000, 1000000);
    for (const key of ['width', 'depth'])
      number(object[key], `${path}.${key}`, 0, 100000, false, true);
    number(object.height, `${path}.height`, 0, 100000);
    number(object.elevation, `${path}.elevation`, -100000, 100000);
    if (object.grounding !== undefined) {
      if (!['0.3', '0.4', '0.5', '0.6', '0.7', '0.8'].includes(root.version as string))
        errors.push(`${path}.grounding requires format version 0.3 or later.`);
      choice(object.grounding, `${path}.grounding`, ['absolute', 'terrain']);
      if (object.grounding === 'terrain' && root.terrain === undefined)
        errors.push(`${path}.grounding requires a terrain grid.`);
    }
    if (object.terrainAnchor !== undefined) {
      if (!['0.3', '0.4', '0.5', '0.6', '0.7', '0.8'].includes(root.version as string))
        errors.push(`${path}.terrainAnchor requires format version 0.3 or later.`);
      choice(object.terrainAnchor, `${path}.terrainAnchor`, ['center', 'highest-footprint']);
      if (object.grounding !== 'terrain')
        errors.push(`${path}.terrainAnchor requires grounding: "terrain".`);
    }
    if (object.terrainCorrection !== undefined) {
      if (!['0.6', '0.7', '0.8'].includes(root.version as string))
        errors.push(`${path}.terrainCorrection requires format version 0.6.`);
      number(object.terrainCorrection, `${path}.terrainCorrection`, -200000, 200000);
      if (object.grounding !== 'terrain')
        errors.push(`${path}.terrainCorrection requires grounding: "terrain".`);
      if (object.kind !== 'building' && object.kind !== 'landmark')
        errors.push(
          `${path}.terrainCorrection is supported only for building and landmark solids.`,
        );
    }
    number(object.rotation, `${path}.rotation`, -360000, 360000);
    number(object.layer, `${path}.layer`, -1000, 1000, true);
    if (object.geometry !== undefined) {
      if (!['0.4', '0.5', '0.6', '0.7', '0.8'].includes(root.version as string))
        errors.push(`${path}.geometry requires format version 0.4 or later.`);
      errors.push(
        ...validateGeometryRecipe(
          object.geometry,
          object as unknown as WorldObject,
          `${path}.geometry`,
        ),
      );
    }
    if (
      object.sourceId !== undefined &&
      id(object.sourceId, `${path}.sourceId`) &&
      !sourceIds.has(object.sourceId)
    )
      errors.push(`${path}.sourceId refers to missing source "${object.sourceId}".`);
    if (object.tags !== undefined)
      array(object.tags, `${path}.tags`, 32).forEach((tag, tagIndex) =>
        string(tag, `${path}.tags[${tagIndex}]`, 64),
      );
    for (const key of ['parentId', 'facts', 'references']) {
      if (root.version === '0.1' && object[key] !== undefined)
        errors.push(
          `${path}.${key} requires format version 0.2. Use migrateWorld before adding container data.`,
        );
    }
    if (
      object.parentId !== undefined &&
      id(object.parentId, `${path}.parentId`) &&
      typeof object.id === 'string'
    ) {
      parents.set(object.id, object.parentId);
      parentPaths.set(object.id, `${path}.parentId`);
    }
    if (object.facts !== undefined) {
      const factKeys = new Set<string>();
      array(object.facts, `${path}.facts`, 64).forEach((value, factIndex) => {
        const factPath = `${path}.facts[${factIndex}]`;
        const fact = record(value, factPath, [
          'key',
          'value',
          'unit',
          'evidence',
          'sourceIds',
          'note',
        ]);
        if (!fact) return;
        if (id(fact.key, `${factPath}.key`)) {
          if (factKeys.has(fact.key))
            errors.push(`${factPath}.key: duplicate fact key "${fact.key}".`);
          factKeys.add(fact.key);
        }
        if (typeof fact.value === 'number') number(fact.value, `${factPath}.value`, -1e15, 1e15);
        else if (typeof fact.value === 'string') string(fact.value, `${factPath}.value`);
        else if (fact.value !== null && typeof fact.value !== 'boolean')
          errors.push(`${factPath}.value must be text, a finite number, boolean, or null.`);
        choice(fact.evidence, `${factPath}.evidence`, [
          'observed',
          'inferred',
          'authored',
          'sourced',
          'unknown',
        ]);
        if ((fact.value === null) !== (fact.evidence === 'unknown'))
          errors.push(
            `${factPath}: unknown evidence requires a null value, and null values must use unknown evidence.`,
          );
        if (fact.unit !== undefined) string(fact.unit, `${factPath}.unit`, 64);
        if (fact.note !== undefined) string(fact.note, `${factPath}.note`);
        if (fact.sourceIds !== undefined)
          array(fact.sourceIds, `${factPath}.sourceIds`, 32).forEach((sourceId, sourceIndex) => {
            const sourcePath = `${factPath}.sourceIds[${sourceIndex}]`;
            if (id(sourceId, sourcePath) && !sourceIds.has(sourceId))
              errors.push(`${sourcePath} refers to missing source "${sourceId}".`);
          });
        if (
          fact.evidence === 'sourced' &&
          (!Array.isArray(fact.sourceIds) || fact.sourceIds.length === 0)
        )
          errors.push(`${factPath}: sourced facts require at least one sourceIds reference.`);
      });
    }
    if (object.references !== undefined)
      array(object.references, `${path}.references`, 32).forEach((value, referenceIndex) => {
        const referencePath = `${path}.references[${referenceIndex}]`;
        const reference = record(value, referencePath, ['sourceId', 'role', 'view', 'note']);
        if (!reference) return;
        if (
          id(reference.sourceId, `${referencePath}.sourceId`) &&
          !sourceIds.has(reference.sourceId)
        )
          errors.push(
            `${referencePath}.sourceId refers to missing source "${reference.sourceId}".`,
          );
        choice(reference.role, `${referencePath}.role`, [
          'photo',
          'map',
          'history',
          'dataset',
          'inspiration',
        ]);
        if (reference.view !== undefined) string(reference.view, `${referencePath}.view`, 200);
        if (reference.note !== undefined) string(reference.note, `${referencePath}.note`);
      });
    if (object.footprint !== undefined) {
      const before = errors.length;
      const points = array(object.footprint, `${path}.footprint`, 256, 3);
      points.forEach((point, pointIndex) => {
        const coords = array(point, `${path}.footprint[${pointIndex}]`, 2, 2);
        coords.forEach((coordinate, axis) =>
          number(coordinate, `${path}.footprint[${pointIndex}][${axis}]`, -1000000, 1000000),
        );
      });
      if (errors.length === before && !validPolygon(points as Point[]))
        errors.push(
          `${path}.footprint must be a simple polygon with nonzero area, no crossings, and no repeated closing vertex.`,
        );
    }
  });
  for (const [childId, parentId] of parents) {
    if (!objectIds.has(parentId))
      errors.push(`${parentPaths.get(childId)} refers to missing parent "${parentId}".`);
    if (childId === parentId) errors.push(`${parentPaths.get(childId)} cannot refer to itself.`);
  }
  // Iterative traversal supports the full 1,000-object depth without overflowing the stack.
  const checkedParents = new Set<string>();
  for (const start of parents.keys()) {
    const trail = new Set<string>();
    let cursor = start;
    while (parents.has(cursor) && !checkedParents.has(cursor)) {
      if (trail.has(cursor)) {
        errors.push(`${parentPaths.get(cursor)} creates a parent cycle involving "${cursor}".`);
        break;
      }
      trail.add(cursor);
      cursor = parents.get(cursor)!;
    }
    trail.forEach((id) => checkedParents.add(id));
  }
  array(root.relations, 'relations', limits.relations).forEach((value, index) => {
    const path = `relations[${index}]`;
    const relation = record(value, path, ['from', 'to', 'type', 'note']);
    if (!relation) return;
    for (const key of ['from', 'to'])
      if (id(relation[key], `${path}.${key}`) && !objectIds.has(relation[key] as string))
        errors.push(`${path}.${key} refers to missing object "${relation[key]}".`);
    choice(relation.type, `${path}.type`, ['near', 'within', 'connects', 'overlaps']);
    if (relation.note !== undefined) string(relation.note, `${path}.note`);
  });
  if (errors.length) return { errors, warnings };
  const compact = JSON.stringify(world);
  if (compact.length > limits.bytes || encoder.encode(compact).byteLength > limits.bytes) {
    errors.push(
      `The world document exceeds the ${limits.bytes / 1024 / 1024} MiB compact UTF-8 content limit.`,
    );
    return { errors, warnings };
  }

  const shapes = world.objects.map((object) => {
    const points = getFootprint(object);
    const xs = points.map(([x]) => x),
      ys = points.map(([, y]) => y);
    const box = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
    if (
      box.minX < -EPSILON ||
      box.minY < -EPSILON ||
      box.maxX > world.bounds.width + EPSILON ||
      box.maxY > world.bounds.depth + EPSILON
    )
      warnings.push(`Object "${object.id}" extends outside the world bounds.`);
    const base = getObjectBaseElevation(world, object);
    if (base === undefined)
      warnings.push(
        `Object "${object.id}" has incomplete terrain coverage; its grounded base is unknown.`,
      );
    return { object, points, box, base };
  });
  const solids = shapes
    .filter(
      ({ object, base }) => object.kind === 'building' && object.height > 0 && base !== undefined,
    )
    .sort((a, b) => a.box.minX - b.box.minX);
  let comparisons = 0;
  let overlaps = 0;
  outer: for (let i = 0; i < solids.length; i++) {
    const a = solids[i];
    for (let j = i + 1; j < solids.length; j++) {
      const b = solids[j];
      if (b.box.minX >= a.box.maxX - EPSILON) break;
      if (
        Math.min(a.box.maxY, b.box.maxY) <= Math.max(a.box.minY, b.box.minY) + EPSILON ||
        Math.min(a.base! + a.object.height, b.base! + b.object.height) <=
          Math.max(a.base!, b.base!) + EPSILON
      )
        continue;
      comparisons += a.points.length * b.points.length;
      if (comparisons > 200000 || overlaps >= 100) {
        warnings.push(
          'Overlap checks reached their diagnostic budget; some building pairs were not checked.',
        );
        break outer;
      }
      if (polygonsOverlap(a.points, b.points)) {
        warnings.push(`Buildings "${a.object.id}" and "${b.object.id}" physically overlap.`);
        overlaps++;
      }
    }
  }
  return { errors, warnings };
}

let fallbackId = 0;
function newObjectId(kind: ObjectKind): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${++fallbackId}`;
  return `${kind}-${suffix}`;
}

export function makeObject(kind: ObjectKind, x: number, y: number): WorldObject {
  const dimensions: Record<ObjectKind, [number, number, number, number]> = {
    grass: [20, 16, 0.04, 0],
    pavement: [14, 5, 0.08, 1],
    road: [28, 8, 0.1, 1],
    building: [14, 10, 10, 2],
    water: [18, 12, 0.05, 1],
    tree: [7, 7, 10, 3],
    landmark: [3, 3, 5, 3],
    fixture: [2, 0.7, 1, 3],
  };
  const [width, depth, height, layer] = dimensions[kind];
  return {
    id: newObjectId(kind),
    label: KIND_LABELS[kind],
    kind,
    description: '',
    x,
    y,
    width,
    depth,
    height,
    elevation: 0,
    rotation: 0,
    layer,
    evidence: 'authored',
  };
}

/** Upgrade explicitly; parsing and serialization never silently change format versions. */
export function migrateWorld(world: WorldDocument): WorldDocument {
  assertValid(world);
  return { ...structuredClone(world), version: CURRENT_WORLD_VERSION };
}

export function getFact(
  object: WorldObject,
  key: string,
): string | number | boolean | null | undefined {
  return object.facts?.find((fact) => fact.key === key)?.value;
}

/** Excludes the root and preserves document order; safe even if handed a cyclic draft. */
export function getDescendants(world: WorldDocument, id: string): WorldObject[] {
  if (!world.objects.some((object) => object.id === id)) return [];
  const children = new Map<string, string[]>();
  for (const object of world.objects) {
    if (!object.parentId) continue;
    const siblings = children.get(object.parentId) ?? [];
    siblings.push(object.id);
    children.set(object.parentId, siblings);
  }
  const visited = new Set<string>([id]);
  const queue = [id];
  for (let index = 0; index < queue.length; index++) {
    for (const childId of children.get(queue[index]) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      queue.push(childId);
    }
  }
  return world.objects.filter((object) => object.id !== id && visited.has(object.id));
}

function requireObject(world: WorldDocument, id: string): WorldObject {
  const object = world.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(`Object "${id}" was not found in this world.`);
  return object;
}

/** Apply absolute placement changes atomically, propagating rigid motion to descendants. */
export function updateObject(
  world: WorldDocument,
  id: string,
  patch: Partial<WorldObject>,
): WorldDocument {
  assertValid(world);
  const original = requireObject(world, id);
  if (patch.id !== undefined && patch.id !== id)
    throw new Error('Object IDs cannot be renamed by updateObject.');
  const updated = { ...original, ...patch, evidence: 'authored' as const };
  // A composition correction belongs to the original placement/anchor, not a new authored placement.
  if (
    !('terrainCorrection' in patch) &&
    ['x', 'y', 'width', 'depth', 'rotation', 'grounding', 'terrainAnchor', 'kind'].some(
      (key) => key in patch,
    )
  )
    delete updated.terrainCorrection;
  const descendants = new Set(getDescendants(world, id).map((object) => object.id));
  const rotationDelta = updated.rotation - original.rotation;
  const angle = (rotationDelta * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const originalBase = getObjectBaseElevation(world, original);
  const updatedBase = getObjectBaseElevation(world, updated);
  const elevationDelta =
    originalBase !== undefined && updatedBase !== undefined
      ? updatedBase - originalBase
      : undefined;
  const moved =
    updated.x !== original.x ||
    updated.y !== original.y ||
    rotationDelta !== 0 ||
    updated.elevation !== original.elevation ||
    updated.grounding !== original.grounding ||
    updated.terrainAnchor !== original.terrainAnchor ||
    (elevationDelta !== undefined && Math.abs(elevationDelta) > EPSILON);
  if (moved && descendants.size && elevationDelta === undefined)
    throw new Error(
      `Cannot move container "${id}": its terrain coverage does not resolve a physical base.`,
    );
  const next: WorldDocument = {
    ...world,
    objects: world.objects.map((object) => {
      if (object.id === id) return updated;
      if (!moved || !descendants.has(object.id)) return object;
      const x = object.x - original.x,
        y = object.y - original.y;
      let rotation = object.rotation + rotationDelta;
      if (Math.abs(rotation) > 360000) rotation %= 360;
      const transformed: WorldObject = {
        ...object,
        x: updated.x + x * cos - y * sin,
        y: updated.y + x * sin + y * cos,
        rotation,
        evidence: 'authored',
      };
      if (
        transformed.x !== object.x ||
        transformed.y !== object.y ||
        transformed.rotation !== object.rotation
      )
        delete transformed.terrainCorrection;
      const oldBase = getObjectBaseElevation(world, object);
      const newGroundBase = getObjectBaseElevation(world, { ...transformed, elevation: 0 });
      if (oldBase === undefined || newGroundBase === undefined || elevationDelta === undefined)
        throw new Error(
          `Cannot move container "${id}": child "${object.id}" has incomplete terrain coverage.`,
        );
      transformed.elevation = oldBase + elevationDelta - newGroundBase;
      return transformed;
    }),
  };
  assertValid(next);
  return next;
}

/** Delete the complete placement subtree and relations involving any deleted object. */
export function removeObject(world: WorldDocument, id: string): WorldDocument {
  assertValid(world);
  requireObject(world, id);
  const removed = new Set([id, ...getDescendants(world, id).map((object) => object.id)]);
  return {
    ...world,
    objects: world.objects.filter((object) => !removed.has(object.id)),
    relations: world.relations.filter(
      (relation) => !removed.has(relation.from) && !removed.has(relation.to),
    ),
  };
}

/** Copy a subtree 10m east/north, remapping internal references and retaining external links. */
export function duplicateObject(
  world: WorldDocument,
  id: string,
): { world: WorldDocument; rootId: string } {
  assertValid(world);
  const root = requireObject(world, id);
  const subtree = new Set([id, ...getDescendants(world, id).map((object) => object.id)]);
  const limit = getWorldLimits(world).objects;
  if (world.objects.length + subtree.size > limit)
    throw new Error(`Duplicating this container would exceed the ${limit}-object limit.`);
  const copies = structuredClone(world.objects.filter((object) => subtree.has(object.id)));
  const existing = new Set(world.objects.map((object) => object.id));
  const ids = new Map<string, string>();
  for (const object of copies) {
    let nextId = newObjectId(object.kind);
    while (existing.has(nextId)) nextId = newObjectId(object.kind);
    existing.add(nextId);
    ids.set(object.id, nextId);
  }
  const objects = copies.map((object) => ({
    ...object,
    id: ids.get(object.id)!,
    label:
      object.id === root.id ? `${[...object.label].slice(0, 155).join('')} copy` : object.label,
    ...(object.parentId ? { parentId: ids.get(object.parentId) ?? object.parentId } : {}),
    evidence: 'authored' as const,
  }));
  const relations = world.relations
    .filter((relation) => subtree.has(relation.from) || subtree.has(relation.to))
    .map((relation) => ({
      ...relation,
      from: ids.get(relation.from) ?? relation.from,
      to: ids.get(relation.to) ?? relation.to,
    }));
  const next = {
    ...world,
    objects: [...world.objects, ...objects],
    relations: [...world.relations, ...relations],
  };
  const rootId = ids.get(id)!;
  return { world: updateObject(next, rootId, { x: root.x + 10, y: root.y + 10 }), rootId };
}
