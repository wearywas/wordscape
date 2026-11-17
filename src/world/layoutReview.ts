import type { WorldDocument } from './types';
import { getFootprint } from './geometry.ts';
export interface LayoutDescription {
  objectCount: number;
  buildingCount: number;
  excludedOutlineBuildings: number;
  summedBuildingAreaM2: number;
  buildingCoverageRatio: number;
  nearestBuildingGapM: { min: number; median: number; max: number } | null;
  gapSampleCount: number;
  gapSampled: boolean;
  buildingOrientation: { bins: number[]; axisAlignedFraction: number | null };
  routeCount: number;
  estimatedRouteLengthM: number;
  routeOrientation: { binLengthM: number[]; axisAlignedFraction: number | null };
  notes: string[];
}
type Point = [number, number];
const round = (value: number) => Math.round(value * 1000) / 1000;
const angle = (degrees: number) => ((degrees % 180) + 180) % 180;
const aligned = (degrees: number) =>
  Math.min(angle(degrees) % 90, 90 - (angle(degrees) % 90)) <= 10;
function area(points: Point[]) {
  return (
    Math.abs(
      points.reduce((sum, a, i) => {
        const b = points[(i + 1) % points.length];
        return sum + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2
  );
}
function pointDistance(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
    );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function cross(a: Point, b: Point, c: Point) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function segmentGap(a: Point, b: Point, c: Point, d: Point) {
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}
function inside(p: Point, polygon: Point[]) {
  let contained = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      contained = !contained;
  }
  return contained;
}
function boundaryDistance(point: Point, polygon: Point[]) {
  return Math.min(
    ...polygon.map((a, i) => pointDistance(point, a, polygon[(i + 1) % polygon.length])),
  );
}
function covered(point: Point, polygon: Point[]) {
  return inside(point, polygon) || boundaryDistance(point, polygon) <= 0.002;
}
function segmentCovered(a: Point, b: Point, polygon: Point[]) {
  if (!covered(a, polygon) || !covered(b, polygon)) return false;
  const rx = b[0] - a[0],
    ry = b[1] - a[1],
    cuts = [0, 1];
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i],
      d = polygon[(i + 1) % polygon.length];
    const sx = d[0] - c[0],
      sy = d[1] - c[1],
      denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-10) continue;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++) {
    const t = (cuts[i - 1] + cuts[i]) / 2;
    if (!covered([a[0] + rx * t, a[1] + ry * t], polygon)) return false;
  }
  return true;
}
function polygonGap(a: Point[], b: Point[]) {
  if (inside(a[0], b) || inside(b[0], a)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      best = Math.min(best, segmentGap(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
      if (best < 1e-8) return 0;
    }
  return best;
}
function box(points: Point[]) {
  return {
    minX: Math.min(...points.map((p) => p[0])),
    maxX: Math.max(...points.map((p) => p[0])),
    minY: Math.min(...points.map((p) => p[1])),
    maxY: Math.max(...points.map((p) => p[1])),
  };
}
function boxGap(a: ReturnType<typeof box>, b: ReturnType<typeof box>) {
  return Math.hypot(
    Math.max(0, a.minX - b.maxX, b.minX - a.maxX),
    Math.max(0, a.minY - b.maxY, b.minY - a.maxY),
  );
}
/** Plan-view descriptors. They deliberately do not collapse different briefs into one quality score. */
export function describeWorldLayout(world: WorldDocument): LayoutDescription {
  const parentsWithChildren = new Set(
    world.objects.flatMap((object) => (object.parentId ? [object.parentId] : [])),
  );
  const suppressedOutlines = new Set(
    world.objects
      .filter(
        (object) =>
          object.kind === 'building' &&
          !object.geometry &&
          parentsWithChildren.has(object.id) &&
          object.facts?.some(
            (fact) =>
              fact.key === 'building.isOutline' &&
              fact.evidence !== 'unknown' &&
              fact.value === true,
          ),
      )
      .map((object) => object.id),
  );
  const buildings = world.objects
    .filter((o) => o.kind === 'building' && !suppressedOutlines.has(o.id))
    .map((o) => ({ object: o, points: getFootprint(o) }));
  const boxes = buildings.map(({ points }) => box(points)),
    bins = Array<number>(6).fill(0),
    gaps: number[] = [];
  let axisAligned = 0;
  for (const { object } of buildings) {
    const degrees = angle(object.rotation + (object.depth > object.width ? 90 : 0));
    bins[Math.min(5, Math.floor(degrees / 30))]++;
    if (aligned(degrees)) axisAligned++;
  }
  const stride = Math.max(1, Math.ceil(buildings.length / 128));
  for (let i = 0; i < buildings.length; i += stride) {
    let gap = Infinity;
    for (let j = 0; j < buildings.length; j++) {
      if (i === j || boxGap(boxes[i], boxes[j]) >= gap) continue;
      gap = Math.min(gap, polygonGap(buildings[i].points, buildings[j].points));
      if (gap === 0) break;
    }
    if (Number.isFinite(gap)) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const routeBins = Array<number>(6).fill(0),
    routes = world.objects.filter((o) => o.kind === 'road' || o.kind === 'pavement');
  let routeLength = 0,
    alignedLength = 0,
    envelopeRoutes = 0,
    rejectedCenterlines = 0;
  const addSegment = (a: Point, b: Point) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const degrees = angle((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI);
    routeBins[Math.min(5, Math.floor(degrees / 30))] += length;
    routeLength += length;
    if (aligned(degrees)) alignedLength += length;
  };
  for (const object of routes) {
    const fact = object.facts?.find((f) => f.key === 'path.centerline' && f.evidence !== 'unknown');
    let points: Point[] | undefined;
    if (typeof fact?.value === 'string') {
      try {
        const parsed = JSON.parse(fact.value);
        if (
          Array.isArray(parsed) &&
          parsed.length >= 2 &&
          parsed.length <= 256 &&
          parsed.every(
            (p) =>
              Array.isArray(p) &&
              p.length === 2 &&
              p.every(Number.isFinite) &&
              p[0] >= -0.002 &&
              p[1] >= -0.002 &&
              p[0] <= world.bounds.width + 0.002 &&
              p[1] <= world.bounds.depth + 0.002,
          )
        ) {
          const polygon = getFootprint(object);
          const length = parsed
            .slice(1)
            .reduce(
              (sum, point, index) =>
                sum + Math.hypot(point[0] - parsed[index][0], point[1] - parsed[index][1]),
              0,
            );
          if (
            Number.isFinite(length) &&
            length > 0 &&
            boundaryDistance(parsed[0], polygon) <= 0.05 &&
            boundaryDistance(parsed.at(-1), polygon) <= 0.05 &&
            parsed.slice(1).every((point, index) => segmentCovered(parsed[index], point, polygon))
          )
            points = parsed;
        }
      } catch {
        /* Missing or malformed source centreline falls back to a labelled estimate. */
      }
      if (!points) rejectedCenterlines++;
    }
    if (points) {
      for (let i = 1; i < points.length; i++) addSegment(points[i - 1], points[i]);
    } else {
      envelopeRoutes++;
      const length = Math.max(object.width, object.depth),
        radians = ((object.rotation + (object.depth > object.width ? 90 : 0)) * Math.PI) / 180;
      addSegment([0, 0], [length * Math.cos(radians), length * Math.sin(radians)]);
    }
  }
  const summedArea = buildings.reduce((sum, b) => sum + area(b.points), 0),
    mid = Math.floor(gaps.length / 2);
  return {
    objectCount: world.objects.length,
    buildingCount: buildings.length,
    excludedOutlineBuildings: suppressedOutlines.size,
    summedBuildingAreaM2: round(summedArea),
    buildingCoverageRatio: round(summedArea / (world.bounds.width * world.bounds.depth)),
    nearestBuildingGapM: gaps.length
      ? {
          min: round(gaps[0]),
          median: round(gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2),
          max: round(gaps[gaps.length - 1]),
        }
      : null,
    gapSampleCount: gaps.length,
    gapSampled: stride > 1,
    buildingOrientation: {
      bins,
      axisAlignedFraction: buildings.length ? round(axisAligned / buildings.length) : null,
    },
    routeCount: routes.length,
    estimatedRouteLengthM: round(routeLength),
    routeOrientation: {
      binLengthM: routeBins.map(round),
      axisAlignedFraction: routeLength ? round(alignedLength / routeLength) : null,
    },
    notes: [
      'Descriptive plan measurements, not a quality score or universal density target. Compare only in light of the brief and world area.',
      'Building area sums declared footprint polygons, not a union or recipe mesh silhouettes; overlapping footprints can count twice. Gaps are nearest polygon-edge distances, with overlaps/contact reported as zero.',
      `${suppressedOutlines.size} building outline containers are excluded because the renderer suppresses them in favor of their children; standalone outlines and custom recipes remain included.`,
      `Nearest-gap anchors ${stride > 1 ? 'are deterministically sampled (maximum 128)' : 'include all buildings'}; neighbors are searched across the whole document.`,
      'Building orientation bins use the longest object-envelope axis, counterclockwise from east in [0,30),…,[150,180), not actual facade or irregular polygon-edge orientations. Route bins use undirected bearings clockwise from north. Axis alignment means within 10° of 0/90°, not a goodness score.',
      `${rejectedCenterlines} recorded centerlines were rejected as malformed, outside the world/current footprint, or inconsistent with its endpoints. Remaining source facts are unchanged.`,
      `${envelopeRoutes} of ${routes.length} route objects use longest-envelope length estimates because recorded centerlines are unavailable or incompatible with current placement; broad plazas are not linear routes. No traversability or network connectivity is inferred.`,
    ],
  };
}
