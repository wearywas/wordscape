import type { WorldDocument, WorldObject, WorldTerrain } from './types';
import { getFootprint } from './geometry.ts';

type Point = [number, number];
const EPSILON = 1e-8;

export interface FootprintTerrain {
  min: number | undefined;
  max: number | undefined;
  mean: number | undefined;
  sampleCount: number;
  missingCount: number;
}

function usable(terrain: WorldTerrain | undefined): terrain is WorldTerrain {
  return (
    !!terrain &&
    Number.isInteger(terrain.columns) &&
    terrain.columns >= 2 &&
    terrain.columns <= 257 &&
    Number.isInteger(terrain.rows) &&
    terrain.rows >= 2 &&
    terrain.rows <= 257 &&
    Number.isFinite(terrain.spacing) &&
    terrain.spacing > 0 &&
    terrain.heights.length === terrain.columns * terrain.rows
  );
}

/** Bilinear absolute source-datum metres. Undefined means absent/outside/no-data coverage. */
export function sampleTerrain(world: WorldDocument, x: number, y: number): number | undefined {
  const terrain = world.terrain;
  if (!usable(terrain) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  let u = (x - terrain.origin.x) / terrain.spacing;
  let v = (y - terrain.origin.y) / terrain.spacing;
  // Remove roundoff from rotated footprint vertices that mathematically lie on the grid edge.
  if (Math.abs(u - Math.round(u)) < 1e-12) u = Math.round(u);
  if (Math.abs(v - Math.round(v)) < 1e-12) v = Math.round(v);
  if (u < 0 || v < 0 || u > terrain.columns - 1 || v > terrain.rows - 1) return undefined;
  const column = Math.min(terrain.columns - 2, Math.floor(u));
  const row = Math.min(terrain.rows - 2, Math.floor(v));
  const tx = u - column,
    ty = v - row;
  const samples: [number, number][] = [
    [row * terrain.columns + column, (1 - tx) * (1 - ty)],
    [row * terrain.columns + column + 1, tx * (1 - ty)],
    [(row + 1) * terrain.columns + column, (1 - tx) * ty],
    [(row + 1) * terrain.columns + column + 1, tx * ty],
  ];
  let height = 0;
  for (const [index, weight] of samples) {
    if (weight === 0) continue;
    const sample = terrain.heights[index];
    if (sample === null || !Number.isFinite(sample)) return undefined;
    height += sample * weight;
  }
  return height;
}

function inside(point: Point, polygon: Point[]): boolean {
  let contained = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    const cross = (b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0]);
    if (
      Math.abs(cross) <= EPSILON &&
      point[0] >= Math.min(a[0], b[0]) - EPSILON &&
      point[0] <= Math.max(a[0], b[0]) + EPSILON &&
      point[1] >= Math.min(a[1], b[1]) - EPSILON &&
      point[1] <= Math.max(a[1], b[1]) + EPSILON
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      contained = !contained;
  }
  return contained;
}

/** Sampled footprint range, including boundary crossings and internal terrain grid nodes. */
export function getFootprintTerrain(world: WorldDocument, object: WorldObject): FootprintTerrain {
  const empty: FootprintTerrain = {
    min: undefined,
    max: undefined,
    mean: undefined,
    sampleCount: 0,
    missingCount: 0,
  };
  const terrain = world.terrain;
  if (!usable(terrain)) return empty;
  const polygon = getFootprint(object);
  if (polygon.some((point) => point.some((value) => !Number.isFinite(value)))) return empty;
  const points = new Map<string, Point>();
  const add = (x: number, y: number) =>
    points.set(`${x.toPrecision(15)},${y.toPrecision(15)}`, [x, y]);
  if (inside([object.x, object.y], polygon)) add(object.x, object.y);
  for (const [x, y] of polygon) add(x, y);
  const xs = polygon.map((point) => point[0]),
    ys = polygon.map((point) => point[1]);
  const firstColumn = Math.max(
    0,
    Math.ceil((Math.min(...xs) - terrain.origin.x) / terrain.spacing),
  );
  const lastColumn = Math.min(
    terrain.columns - 1,
    Math.floor((Math.max(...xs) - terrain.origin.x) / terrain.spacing),
  );
  const firstRow = Math.max(0, Math.ceil((Math.min(...ys) - terrain.origin.y) / terrain.spacing));
  const lastRow = Math.min(
    terrain.rows - 1,
    Math.floor((Math.max(...ys) - terrain.origin.y) / terrain.spacing),
  );
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      const point: Point = [
        terrain.origin.x + column * terrain.spacing,
        terrain.origin.y + row * terrain.spacing,
      ];
      if (inside(point, polygon)) add(...point);
    }
  }
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index],
      b = polygon[(index + 1) % polygon.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const cuts = new Set([0, 1]);
    if (Math.abs(dx) > EPSILON)
      for (let column = firstColumn; column <= lastColumn; column++) {
        const t = (terrain.origin.x + column * terrain.spacing - a[0]) / dx;
        if (t > 0 && t < 1) cuts.add(t);
      }
    if (Math.abs(dy) > EPSILON)
      for (let row = firstRow; row <= lastRow; row++) {
        const t = (terrain.origin.y + row * terrain.spacing - a[1]) / dy;
        if (t > 0 && t < 1) cuts.add(t);
      }
    const sorted = [...cuts].sort((left, right) => left - right);
    for (let cut = 0; cut < sorted.length; cut++) {
      const t = sorted[cut];
      add(a[0] + dx * t, a[1] + dy * t);
      if (cut > 0) {
        const start = sorted[cut - 1];
        const middle = (start + t) / 2;
        add(a[0] + dx * middle, a[1] + dy * middle);
        const first = sampleTerrain(world, a[0] + dx * start, a[1] + dy * start);
        const mid = sampleTerrain(world, a[0] + dx * middle, a[1] + dy * middle);
        const last = sampleTerrain(world, a[0] + dx * t, a[1] + dy * t);
        if (first !== undefined && mid !== undefined && last !== undefined) {
          // A bilinear cell restricted to a straight edge is a quadratic in u∈[0,1].
          const quadratic = 2 * (first + last - 2 * mid);
          const linear = last - first - quadratic;
          if (Math.abs(quadratic) > EPSILON) {
            const stationary = -linear / (2 * quadratic);
            if (stationary > 0 && stationary < 1) {
              const at = start + (t - start) * stationary;
              add(a[0] + dx * at, a[1] + dy * at);
            }
          }
        }
      }
    }
  }
  let min = Infinity,
    max = -Infinity,
    sum = 0,
    missingCount = 0;
  for (const [x, y] of points.values()) {
    const height = sampleTerrain(world, x, y);
    if (height === undefined) {
      missingCount++;
      continue;
    }
    min = Math.min(min, height);
    max = Math.max(max, height);
    sum += height;
  }
  const count = points.size - missingCount;
  return {
    min: count ? min : undefined,
    max: count ? max : undefined,
    mean: count ? sum / count : undefined,
    sampleCount: points.size,
    missingCount,
  };
}

/** Local render base: datum subtraction happens exactly once; height is never added here. */
export function getObjectBaseElevation(
  world: WorldDocument,
  object: WorldObject,
): number | undefined {
  if (object.grounding !== 'terrain') return object.elevation;
  if (!world.terrain) return undefined;
  let ground: number | undefined;
  if (object.terrainAnchor === 'highest-footprint') {
    const samples = getFootprintTerrain(world, object);
    ground = samples.missingCount ? undefined : samples.max;
  } else ground = sampleTerrain(world, object.x, object.y);
  return ground === undefined
    ? undefined
    : ground -
        world.terrain.referenceElevation +
        object.elevation +
        (object.terrainCorrection ?? 0);
}
