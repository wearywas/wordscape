import { getFootprint } from './geometry';
import { createTerrainContext, renderedTerrainHeight, viewObjectBase } from './threeTerrain';
import type { WorldDocument, WorldObject } from './types';

export const WALK_EYE_HEIGHT = 1.7;
export const WALK_RADIUS = 0.28;
export const WALK_SPEED = 2.2;
export interface WalkPosition {
  x: number;
  y: number;
  ground: number;
}
type Point = [number, number];
interface WalkEntry {
  object: WorldObject;
  polygon: Point[];
  role: 'solid' | 'surface' | 'water' | 'trunk';
  base: number | undefined;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export interface WalkContext {
  world: WorldDocument;
  terrainEnabled: boolean;
  groundAt: (x: number, y: number) => number | undefined;
  nearby: (x: number, y: number) => WalkEntry[];
  paths: WalkEntry[];
}

function segmentDistance(x: number, y: number, a: Point, b: Point): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function contains(x: number, y: number, polygon: Point[], padding = 0): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (segmentDistance(x, y, a, b) <= padding + 1e-8) return true;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}

/** View-only collision index: source placements and evidence are never changed. */
export function createWalkContext(world: WorldDocument, terrainEnabled = true): WalkContext {
  const terrain = createTerrainContext(world, terrainEnabled);
  const cells = new Map<string, WalkEntry[]>();
  const large: WalkEntry[] = [];
  const paths: WalkEntry[] = [];
  const cellSize = Math.max(16, Math.max(world.bounds.width, world.bounds.depth) / 40);
  const parents = new Set(world.objects.map((object) => object.parentId).filter(Boolean));
  for (const object of world.objects) {
    const fact = (key: string) => object.facts?.find((item) => item.key === key)?.value;
    if (
      !object.geometry &&
      object.kind === 'building' &&
      fact('building.isOutline') === true &&
      parents.has(object.id)
    )
      continue;
    const crosswalk = fact('fixture.type') === 'crosswalk';
    let role: WalkEntry['role'];
    if (object.kind === 'water') role = 'water';
    else if (object.kind === 'tree') role = 'trunk';
    else if (!object.geometry && (['road', 'pavement', 'grass'].includes(object.kind) || crosswalk))
      role = 'surface';
    else if (object.height > 0.25) role = 'solid';
    else continue;
    const polygon = getFootprint(object);
    const radius = Math.max(0.1, Math.min(0.6, Math.min(object.width, object.depth) * 0.06));
    const entry: WalkEntry = {
      object,
      role,
      polygon,
      base: viewObjectBase(world, object, terrainEnabled),
      minX:
        (role === 'trunk' ? object.x - radius : Math.min(...polygon.map((point) => point[0]))) -
        WALK_RADIUS,
      maxX:
        (role === 'trunk' ? object.x + radius : Math.max(...polygon.map((point) => point[0]))) +
        WALK_RADIUS,
      minY:
        (role === 'trunk' ? object.y - radius : Math.min(...polygon.map((point) => point[1]))) -
        WALK_RADIUS,
      maxY:
        (role === 'trunk' ? object.y + radius : Math.max(...polygon.map((point) => point[1]))) +
        WALK_RADIUS,
    };
    if (role === 'surface' && (object.kind === 'pavement' || crosswalk)) paths.push(entry);
    const x0 = Math.floor(entry.minX / cellSize),
      x1 = Math.floor(entry.maxX / cellSize);
    const y0 = Math.floor(entry.minY / cellSize),
      y1 = Math.floor(entry.maxY / cellSize);
    // Bound memory for exceptionally large or overlapping imported footprints.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) {
      large.push(entry);
      continue;
    }
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(entry);
        else cells.set(key, [entry]);
      }
  }
  const nearby = (x: number, y: number) =>
    [
      ...(cells.get(`${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`) ?? []),
      ...large,
    ].filter((entry) => x >= entry.minX && x <= entry.maxX && y >= entry.minY && y <= entry.maxY);
  const groundAt = (x: number, y: number): number | undefined => {
    let ground =
      terrainEnabled && world.terrain ? terrain && renderedTerrainHeight(terrain, x, y) : 0;
    if (ground === undefined) return undefined;
    const terrainGround = ground;
    for (const entry of nearby(x, y)) {
      if (entry.role !== 'surface' || entry.base === undefined || !contains(x, y, entry.polygon))
        continue;
      const object = entry.object;
      const base =
        terrainEnabled && world.terrain && object.grounding === 'terrain'
          ? terrainGround + object.elevation
          : entry.base;
      ground = Math.max(ground, base + object.height + object.layer * 0.018);
    }
    return ground;
  };
  return { world, terrainEnabled, paths, nearby, groundAt };
}

/** Conservative footprint collision, unknown-ground rejection and a modest slope limit. */
export function walkPositionAt(
  context: WalkContext,
  x: number,
  y: number,
): WalkPosition | undefined {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < WALK_RADIUS ||
    y < WALK_RADIUS ||
    x > context.world.bounds.width - WALK_RADIUS ||
    y > context.world.bounds.depth - WALK_RADIUS
  )
    return undefined;
  for (const entry of context.nearby(x, y)) {
    if (entry.role === 'surface') continue;
    if (entry.role === 'trunk') {
      const radius = Math.max(
        0.1,
        Math.min(0.6, Math.min(entry.object.width, entry.object.depth) * 0.06),
      );
      if (Math.hypot(x - entry.object.x, y - entry.object.y) <= radius + WALK_RADIUS)
        return undefined;
    } else if (contains(x, y, entry.polygon, WALK_RADIUS)) return undefined;
  }
  const ground = context.groundAt(x, y);
  if (ground === undefined) return undefined;
  for (const [dx, dy] of [
    [WALK_RADIUS, 0],
    [-WALK_RADIUS, 0],
    [0, WALK_RADIUS],
    [0, -WALK_RADIUS],
  ]) {
    const sample = context.groundAt(x + dx, y + dy);
    if (sample === undefined || Math.abs(sample - ground) > 0.35) return undefined;
  }
  return { x, y, ground };
}

/** Prefer mapped footpaths, then a bounded search of resolved open ground. */
export function findWalkSpawn(context: WalkContext, preferred?: Point): WalkPosition | undefined {
  const target: Point = preferred ?? [
    context.world.bounds.width / 2,
    context.world.bounds.depth / 2,
  ];
  const paths = [...context.paths].sort(
    (a, b) =>
      Math.hypot(a.object.x - target[0], a.object.y - target[1]) -
      Math.hypot(b.object.x - target[0], b.object.y - target[1]),
  );
  for (const path of paths) {
    const points: Point[] = [[path.object.x, path.object.y]];
    for (const point of path.polygon)
      points.push([(point[0] + path.object.x) / 2, (point[1] + path.object.y) / 2]);
    for (const point of points) {
      if (!contains(point[0], point[1], path.polygon)) continue;
      const spawn = walkPositionAt(context, point[0], point[1]);
      if (spawn) return spawn;
    }
  }
  const direct = walkPositionAt(context, ...target);
  if (direct) return direct;
  const points: Point[] = [];
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++)
      points.push([
        ((x + 0.5) * context.world.bounds.width) / 32,
        ((y + 0.5) * context.world.bounds.depth) / 32,
      ]);
  points.sort(
    (a, b) =>
      Math.hypot(a[0] - target[0], a[1] - target[1]) -
      Math.hypot(b[0] - target[0], b[1] - target[1]),
  );
  for (const point of points) {
    const spawn = walkPositionAt(context, ...point);
    if (spawn) return spawn;
  }
  return undefined;
}

/** Short substeps prevent crossing thin obstacles; sliding keeps wall contact usable. */
export function moveWalker(
  context: WalkContext,
  start: WalkPosition,
  dx: number,
  dy: number,
): WalkPosition {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return start;
  const distance = Math.hypot(dx, dy);
  const scale = distance > 4 ? 4 / distance : 1;
  const steps = Math.max(1, Math.ceil(Math.min(distance, 4) / 0.12));
  const sx = (dx * scale) / steps,
    sy = (dy * scale) / steps;
  let position = start;
  for (let i = 0; i < steps; i++) {
    for (const [mx, my] of [
      [sx, sy],
      [sx, 0],
      [0, sy],
    ]) {
      const next = walkPositionAt(context, position.x + mx, position.y + my);
      if (next && Math.abs(next.ground - position.ground) <= 0.35) {
        position = next;
        break;
      }
    }
  }
  return position;
}
