import { geographicFrame } from './osm';
import { getFact, migrateWorld, validateWorld } from '../world/document';
import { getObjectBaseElevation } from '../world/terrain';
import type {
  GeographicBounds,
  WorldDocument,
  WorldObject,
  WorldSource,
  WorldTerrain,
} from '../world/types';

export interface TerrainExtraction {
  bounds: GeographicBounds;
  frame: {
    origin: { latitude: number; longitude: number };
    width: number;
    depth: number;
    mercatorScale: number;
  };
  terrain: WorldTerrain;
  source: WorldSource;
  diagnostics: {
    provider: string;
    tiles: number;
    requests: number;
    validSamples: number;
    totalSamples: number;
    min: number;
    max: number;
    warnings: string[];
  };
  cached: boolean;
  cachedAt?: number;
}

/** A pure, reviewable attachment. No stored world is changed by this helper.
 * groundObjects explicitly rebases only un-authored OSM placements. Authored
 * absolute placements remain absolute. A water.renderLevel is an authored flat
 * datum level, not a measured tide or a request to drape water over bathymetry.
 */
export function attachTerrain(
  world: WorldDocument,
  extraction: TerrainExtraction,
  { groundObjects = false }: { groundObjects?: boolean } = {},
): WorldDocument {
  if (!extraction?.bounds || !extraction.frame?.origin || !extraction.terrain || !extraction.source)
    throw new Error('The terrain response is incomplete.');
  const frame = geographicFrame(extraction.bounds);
  const near = (a: number, b: number, tolerance: number) =>
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
  if (
    !near(frame.origin.latitude, world.origin.latitude, 1e-8) ||
    !near(frame.origin.longitude, world.origin.longitude, 1e-8) ||
    !near(frame.width, world.bounds.width, 0.002) ||
    !near(frame.depth, world.bounds.depth, 0.002) ||
    !near(frame.origin.latitude, extraction.frame.origin.latitude, 1e-8) ||
    !near(frame.origin.longitude, extraction.frame.origin.longitude, 1e-8) ||
    !near(frame.width, extraction.frame.width, 0.002) ||
    !near(frame.depth, extraction.frame.depth, 0.002) ||
    !near(frame.mercatorScale, extraction.frame.mercatorScale, 1e-10)
  )
    throw new Error(
      'Terrain frame does not match this world. Fetch elevation for its original geographic bounds.',
    );
  const terrain = structuredClone(extraction.terrain);
  if (terrain.sourceId !== extraction.source.id)
    throw new Error('Terrain source identity does not match its provenance.');
  if (
    terrain.origin.x !== 0 ||
    terrain.origin.y !== 0 ||
    (terrain.columns - 1) * terrain.spacing + 1e-8 < frame.width ||
    (terrain.rows - 1) * terrain.spacing + 1e-8 < frame.depth ||
    (terrain.columns - 1) * terrain.spacing > frame.width + terrain.spacing + 0.002 ||
    (terrain.rows - 1) * terrain.spacing > frame.depth + terrain.spacing + 0.002
  )
    throw new Error('Terrain grid does not cover the matching world frame.');
  const next = migrateWorld(world),
    source = structuredClone(extraction.source);
  const old = next.sources.find((value) => value.id === source.id);
  if (old && JSON.stringify(old) !== JSON.stringify(source)) {
    const base = source.id;
    let suffix = 2;
    while (next.sources.some((value) => value.id === `${base}-${suffix}`)) suffix++;
    source.id = `${base}-${suffix}`;
    terrain.sourceId = source.id;
  }
  if (!next.sources.some((value) => value.id === source.id)) next.sources.push(source);
  next.terrain = terrain;
  if (groundObjects) {
    const originals = new Map(world.objects.map((object) => [object.id, object]));
    const rebased = new Set<string>();
    next.objects = next.objects.map((object) => {
      const waterLevel = getFact(object, 'water.renderLevel');
      if (
        object.kind === 'water' &&
        typeof waterLevel === 'number' &&
        Number.isFinite(waterLevel)
      ) {
        const offset =
          world.terrain && object.grounding === 'absolute'
            ? object.elevation - (waterLevel - world.terrain.referenceElevation)
            : object.elevation;
        return {
          ...object,
          grounding: 'absolute',
          terrainAnchor: undefined,
          elevation: waterLevel - terrain.referenceElevation + offset,
        };
      }
      if (
        object.sourceId !== 'osm-extract' ||
        object.evidence === 'authored' ||
        object.grounding === 'terrain'
      )
        return object;
      rebased.add(object.id);
      return {
        ...object,
        grounding: 'terrain',
        terrainAnchor:
          object.kind === 'building' || object.kind === 'landmark' ? 'highest-footprint' : 'center',
      };
    });
    const byId = new Map(next.objects.map((object) => [object.id, object]));
    const pending = next.objects.filter((object) => rebased.has(object.id) && object.parentId);
    // Original documents are already acyclic. Resolve parents before children.
    for (let pass = 0; pending.length && pass <= next.objects.length; pass++)
      for (let index = pending.length - 1; index >= 0; index--) {
        const child = pending[index],
          parent = byId.get(child.parentId!);
        if (!parent || pending.some((value) => value.id === parent.id)) continue;
        const base = getObjectBaseElevation(next, parent),
          oldChild = originals.get(child.id)!,
          oldParent = originals.get(parent.id)!,
          oldBase = getObjectBaseElevation(world, oldParent);
        if (base !== undefined && oldBase !== undefined) {
          const changed: WorldObject = {
            ...child,
            grounding: 'absolute',
            terrainAnchor: undefined,
            elevation: base + oldChild.elevation - oldBase,
          };
          byId.set(child.id, changed);
          next.objects = next.objects.map((value) => (value.id === child.id ? changed : value));
        }
        pending.splice(index, 1);
      }
  }
  const errors = validateWorld(next).errors;
  if (errors.length) throw new Error(`Terrain was not attached: ${errors[0]}`);
  return next;
}
