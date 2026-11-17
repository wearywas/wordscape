import type { WorldDocument, WorldObject, WorldTerrain } from './types';
import { CURRENT_WORLD_VERSION } from './types.ts';
import { getObjectBaseElevation } from './terrain.ts';

export interface AuthoredTerrainRecipe {
  type: 'analytic-heightfield';
  version: 1;
  evidence: 'authored';
  baseElevation: number;
  /** Normalized east/north positions and radii; height is metres, rotation CCW degrees. */
  features: {
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    height: number;
    rotation: number;
  }[];
}
const numeric = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const featureProperties = {
  x: numeric(0, 1),
  y: numeric(0, 1),
  radiusX: numeric(0.08, 1.5),
  radiusY: numeric(0.08, 1.5),
  height: numeric(-150, 300),
  rotation: numeric(-180, 180),
};
export const AUTHORED_TERRAIN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', const: 'analytic-heightfield' },
    version: { type: 'integer', const: 1 },
    evidence: { type: 'string', const: 'authored' },
    baseElevation: numeric(-100, 100),
    features: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: featureProperties,
        required: Object.keys(featureProperties),
      },
    },
  },
  required: ['type', 'version', 'evidence', 'baseElevation', 'features'],
};
function fields(
  value: unknown,
  keys: string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !(key in value))
  )
    throw new Error(`${path} must contain exactly ${keys.join(', ')}.`);
}
function finite(value: unknown, min: number, max: number, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error(`${path} must be finite between ${min} and ${max}.`);
}
function authoredHierarchy(object: WorldObject, byId: Map<string, WorldObject>) {
  let current: WorldObject | undefined = object,
    count = 0;
  while (current) {
    if (current.evidence !== 'authored' || count++ > byId.size) return false;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return true;
}
export function canAuthorTerrain(world: WorldDocument): boolean {
  const byId = new Map(world.objects.map((object) => [object.id, object]));
  return (
    !!world.imaginary &&
    !world.aerial &&
    !world.composition &&
    (!world.terrain || world.terrain.evidence === 'authored') &&
    !world.objects.some(
      (object) => object.grounding === 'terrain' && !authoredHierarchy(object, byId),
    )
  );
}

/** Compact smooth elliptical hills/basins, sampled into the ordinary portable terrain grid. */
export function buildAuthoredTerrain(
  bounds: WorldDocument['bounds'],
  recipe: AuthoredTerrainRecipe,
  sourceId: string,
): WorldTerrain {
  fields(recipe, ['type', 'version', 'evidence', 'baseElevation', 'features'], 'Authored terrain');
  if (
    recipe.type !== 'analytic-heightfield' ||
    recipe.version !== 1 ||
    recipe.evidence !== 'authored'
  )
    throw new Error('Terrain must be an authored analytic-heightfield version 1.');
  finite(recipe.baseElevation, -100, 100, 'Terrain base elevation');
  finite(bounds.width, 1, 2000, 'Terrain width');
  finite(bounds.depth, 1, 2000, 'Terrain depth');
  if (!Array.isArray(recipe.features) || recipe.features.length > 8)
    throw new Error('Terrain features must contain at most 8 hills or basins.');
  for (const [index, feature] of recipe.features.entries()) {
    fields(feature, Object.keys(featureProperties), `Terrain feature ${index}`);
    for (const [key, range] of Object.entries(featureProperties))
      finite(
        feature[key as keyof typeof feature],
        range.minimum,
        range.maximum,
        `Terrain feature ${index}.${key}`,
      );
  }
  const spacing = Math.max(bounds.width, bounds.depth) / 32,
    columns = Math.ceil(bounds.width / spacing) + 1,
    rows = Math.ceil(bounds.depth / spacing) + 1;
  const heights = Array.from({ length: columns * rows }, (_, index) => {
    const x = (index % columns) * spacing,
      y = Math.floor(index / columns) * spacing;
    let height = recipe.baseElevation;
    for (const feature of recipe.features) {
      const angle = (feature.rotation * Math.PI) / 180,
        dx = x - feature.x * bounds.width,
        dy = y - feature.y * bounds.depth;
      const u = (Math.cos(angle) * dx + Math.sin(angle) * dy) / (feature.radiusX * bounds.width),
        v = (-Math.sin(angle) * dx + Math.cos(angle) * dy) / (feature.radiusY * bounds.depth),
        q = u * u + v * v;
      if (q < 1) height += feature.height * (1 - q) ** 2;
    }
    finite(height, -200, 500, 'Combined authored terrain height');
    return Math.round(height * 1000) / 1000;
  });
  return {
    type: 'height-grid',
    columns,
    rows,
    spacing,
    origin: { x: 0, y: 0 },
    heights,
    evidence: 'authored',
    verticalDatum: 'Authored local metres; no geodetic datum',
    referenceElevation: 0,
    sourceId,
    interpolation: 'bilinear',
    notes:
      'Authored smooth elliptical features sampled on a bounded regular grid, then bilinearly interpolated. Grid pitch is an authoring resolution, not measurement accuracy. No geographic or surveyed elevation claim.',
  };
}

/** Only explicit imaginary authoring can replace terrain; source documents are never edited in place. */
export function applyAuthoredTerrain(
  world: WorldDocument,
  recipe: AuthoredTerrainRecipe,
  metadata: { provider: string; model: string },
): {
  world: WorldDocument;
  regroundedIds: string[];
  preservedGroundingIds: string[];
  warnings: string[];
} {
  if (!canAuthorTerrain(world))
    throw new Error(
      'Terrain authoring requires an imaginary world with absent or explicitly authored terrain. Survey/unmarked terrain and non-authored terrain-dependent placements or their descendants are protected.',
    );
  const next = structuredClone(world);
  next.version = CURRENT_WORLD_VERSION;
  let sourceId = 'authored-terrain',
    suffix = 2;
  while (next.sources.some((source) => source.id === sourceId))
    sourceId = `authored-terrain-${suffix++}`;
  next.terrain = buildAuthoredTerrain(world.bounds, recipe, sourceId);
  next.sources.push({
    id: sourceId,
    title: 'Authored imaginary terrain',
    url: '',
    attribution: `Authored interpretation via ${metadata.provider} / ${metadata.model}`,
    accessed: '',
    notes: `Not surveyed or geographic terrain. Recipe uses normalized east/north centers and radii, metre heights, CCW rotation. Each feature contributes height*(1-u²-v²)² inside its ellipse and zero outside. ${JSON.stringify(recipe)}`,
  });
  const oldById = new Map(world.objects.map((object) => [object.id, object])),
    nextById = new Map(next.objects.map((object) => [object.id, object]));
  const depth = (object: WorldObject) => {
    let current = object,
      count = 0;
    while (current.parentId && count <= world.objects.length) {
      count++;
      const parent = oldById.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return count;
  };
  const architecturalChild = (object: WorldObject) => {
    let parent = object.parentId ? oldById.get(object.parentId) : undefined,
      count = 0;
    while (parent && count++ <= world.objects.length) {
      if (['building', 'landmark'].includes(parent.kind)) return true;
      parent = parent.parentId ? oldById.get(parent.parentId) : undefined;
    }
    return false;
  };
  const regrounded = new Set<string>(),
    preservedGroundingIds: string[] = [];
  for (const original of [...world.objects].sort((a, b) => depth(a) - depth(b))) {
    if (!authoredHierarchy(original, oldById)) {
      preservedGroundingIds.push(original.id);
      continue;
    }
    const object = nextById.get(original.id)!,
      oldBase = getObjectBaseElevation(world, original);
    if (oldBase === undefined)
      throw new Error(`Cannot re-ground ${original.id}: its previous terrain base is unknown.`);
    if (object.kind === 'water') {
      object.grounding = 'absolute';
      object.elevation = oldBase;
      delete object.terrainAnchor;
      delete object.terrainCorrection;
      continue;
    }
    if (original.grounding !== 'terrain' && original.parentId && architecturalChild(original)) {
      const oldParent = oldById.get(original.parentId)!,
        newParent = nextById.get(original.parentId)!;
      const before = getObjectBaseElevation(world, oldParent),
        after = getObjectBaseElevation(next, newParent);
      if (before === undefined || after === undefined)
        throw new Error(`Cannot re-ground ${original.id}: parent base is unknown.`);
      object.elevation = original.elevation + after - before;
    } else {
      const anchor =
        original.terrainAnchor ??
        (['building', 'landmark'].includes(original.kind) ? 'highest-footprint' : 'center');
      const oldGround = world.terrain
        ? getObjectBaseElevation(world, {
            ...original,
            grounding: 'terrain',
            terrainAnchor: anchor,
            elevation: 0,
            terrainCorrection: undefined,
          })
        : 0;
      if (oldGround === undefined)
        throw new Error(`Cannot re-ground ${original.id}: previous ground coverage is unknown.`);
      object.grounding = 'terrain';
      object.terrainAnchor = anchor;
      object.elevation = oldBase - oldGround;
      delete object.terrainCorrection;
    }
    const newBase = getObjectBaseElevation(next, object);
    if (newBase === undefined) throw new Error(`Authored terrain does not cover ${object.id}.`);
    if (
      Math.abs(newBase - oldBase) > 1e-8 ||
      object.grounding !== original.grounding ||
      object.terrainAnchor !== original.terrainAnchor
    )
      regrounded.add(object.id);
  }
  return {
    world: next,
    regroundedIds: world.objects.filter((o) => regrounded.has(o.id)).map((o) => o.id),
    preservedGroundingIds,
    warnings: [
      'Terrain is an authored heightfield, not surveyed elevation. Inspect slopes, foundations and access before applying.',
      ...(world.objects.some((o) => o.kind === 'water')
        ? [
            'Existing water keeps a flat absolute local level; inspect whether the new terrain forms suitable shorelines.',
          ]
        : []),
      ...(preservedGroundingIds.length
        ? [
            `${preservedGroundingIds.length} non-authored placements or their descendants retain their previous absolute grounding; inspect their fit against the new terrain.`,
          ]
        : []),
    ],
  };
}
