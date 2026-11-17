import schema from './geometryRecipe.schema.json' with { type: 'json' };
import type { GeometryPart, WorldObject } from './types';

export const GEOMETRY_RECIPE_SCHEMA = schema;
export const MAX_GEOMETRY_PARTS = 32;
type Point = [number, number];
type Vector = [number, number, number];
type RecipeEnvelope = Pick<WorldObject, 'width' | 'depth' | 'height' | 'footprint'>;
const EPSILON = 1e-8;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Portable normalized transform: dimensions, X rotation, Y rotation, Z rotation, translation. */
export function transformGeometryPoint(point: Vector, part: GeometryPart): Vector {
  let [x, y, z] = point.map((value, index) => value * part.dimensions[index]);
  const [rx, ry, rz] = part.rotation.map((degrees) => (degrees * Math.PI) / 180);
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + part.position[0], y + part.position[1], z + part.position[2]];
}

export function geometryPartBounds(part: GeometryPart): { min: Vector; max: Vector } {
  const corners: Vector[] = [];
  for (const x of [-0.5, 0.5])
    for (const y of [-0.5, 0.5])
      for (const z of [-0.5, 0.5]) corners.push(transformGeometryPoint([x, y, z], part));
  return {
    min: [0, 1, 2].map((axis) => Math.min(...corners.map((point) => point[axis]))) as Vector,
    max: [0, 1, 2].map((axis) => Math.max(...corners.map((point) => point[axis]))) as Vector,
  };
}

function cross(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(p: Point, a: Point, b: Point): boolean {
  return (
    Math.abs(cross(a, b, p)) <= EPSILON &&
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON
  );
}
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const ac = cross(a, b, c),
    ad = cross(a, b, d),
    ca = cross(c, d, a),
    cb = cross(c, d, b);
  return (
    ((ac > EPSILON && ad < -EPSILON) || (ac < -EPSILON && ad > EPSILON)) &&
    ((ca > EPSILON && cb < -EPSILON) || (ca < -EPSILON && cb > EPSILON))
  );
}
function simplePolygon(points: Point[]): boolean {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= EPSILON) return false;
    area += a[0] * b[1] - b[0] * a[1];
    for (let j = i + 2; j < points.length; j += 1) {
      if (i === 0 && j === points.length - 1) continue;
      const c = points[j],
        d = points[(j + 1) % points.length];
      if (
        segmentsCross(a, b, c, d) ||
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
    if (onSegment(point, a, b)) return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
function rectangleInside(rectangle: Point[], polygon: Point[]): boolean {
  if (!rectangle.every((point) => inside(point, polygon))) return false;
  for (let i = 0; i < rectangle.length; i += 1) {
    const a = rectangle[i],
      b = rectangle[(i + 1) % rectangle.length];
    if (!inside([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], polygon)) return false;
    for (let j = 0; j < polygon.length; j += 1)
      if (segmentsCross(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return false;
  }
  // An inward notch can touch a rectangle edge only at vertices. Its interior boundary
  // vertices still reveal that some of the rectangle lies outside the simple polygon.
  const minX = rectangle[0][0],
    minY = rectangle[0][1],
    maxX = rectangle[2][0],
    maxY = rectangle[2][1];
  return !polygon.some(
    (point) =>
      point[0] > minX + EPSILON &&
      point[0] < maxX - EPSILON &&
      point[1] > minY + EPSILON &&
      point[1] < maxY - EPSILON,
  );
}

/** Shared client/server validation. This module has no engine, DOM, network, or executable-code dependencies. */
export function validateGeometryRecipe(
  value: unknown,
  object?: RecipeEnvelope,
  path = 'geometry',
): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return [`${path} must be a geometry recipe object.`];
  const fields = ['type', 'version', 'space', 'evidence', 'parts'];
  for (const key of Object.keys(value))
    if (!fields.includes(key)) errors.push(`${path}.${key} is not supported.`);
  if (value.type !== 'parts') errors.push(`${path}.type must be "parts".`);
  if (value.version !== 1) errors.push(`${path}.version must be 1.`);
  if (value.space !== 'normalized-object')
    errors.push(`${path}.space must be "normalized-object".`);
  if (value.evidence !== 'authored')
    errors.push(`${path}.evidence must be "authored"; a generated shape is not verified evidence.`);
  if (
    !Array.isArray(value.parts) ||
    value.parts.length < 1 ||
    value.parts.length > MAX_GEOMETRY_PARTS
  )
    return [...errors, `${path}.parts must contain 1–${MAX_GEOMETRY_PARTS} parts.`];
  const validEnvelope =
    !object ||
    [object.width, object.height, object.depth].every(
      (dimension) => typeof dimension === 'number' && Number.isFinite(dimension) && dimension > 0,
    );
  if (!validEnvelope) errors.push(`${path} requires positive object width, height, and depth.`);
  const polygon = object?.footprint;
  const validFootprint =
    !polygon ||
    (Array.isArray(polygon) &&
      polygon.length >= 3 &&
      polygon.length <= 256 &&
      polygon.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every(
            (coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate),
          ),
      ) &&
      simplePolygon(polygon));
  if (!validFootprint)
    errors.push(`${path} needs a valid traced object footprint before checking containment.`);
  const ids = new Set<string>();
  value.parts.forEach((raw, index) => {
    const partPath = `${path}.parts[${index}]`;
    if (!isRecord(raw)) {
      errors.push(`${partPath} must be an object.`);
      return;
    }
    const start = errors.length;
    const keys = [
      'id',
      'label',
      'primitive',
      'position',
      'rotation',
      'dimensions',
      'color',
      'footprint',
    ];
    for (const key of Object.keys(raw))
      if (!keys.includes(key)) errors.push(`${partPath}.${key} is not supported.`);
    for (const key of keys) if (!(key in raw)) errors.push(`${partPath}.${key} is required.`);
    if (
      typeof raw.id !== 'string' ||
      raw.id.length > 64 ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(raw.id)
    )
      errors.push(`${partPath}.id must be a 1–64 character identifier.`);
    else {
      if (ids.has(raw.id)) errors.push(`${partPath}.id duplicates another part.`);
      ids.add(raw.id);
    }
    if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 120)
      errors.push(`${partPath}.label must contain 1–120 characters.`);
    if (
      typeof raw.primitive !== 'string' ||
      !['box', 'cylinder', 'cone', 'sphere', 'extruded-polygon'].includes(raw.primitive)
    )
      errors.push(`${partPath}.primitive is not supported.`);
    for (const key of ['position', 'rotation', 'dimensions'] as const) {
      const vector = raw[key];
      const range = key === 'position' ? [-0.5, 1] : key === 'rotation' ? [-180, 180] : [0.001, 1];
      if (
        !Array.isArray(vector) ||
        vector.length !== 3 ||
        !vector.every((number) => finite(number, range[0], range[1]))
      )
        errors.push(
          `${partPath}.${key} must be three finite numbers from ${range[0]} to ${range[1]}.`,
        );
    }
    if (typeof raw.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.color))
      errors.push(`${partPath}.color must be a six-digit hex color.`);
    if (raw.primitive === 'extruded-polygon') {
      if (
        !Array.isArray(raw.footprint) ||
        raw.footprint.length < 3 ||
        raw.footprint.length > 16 ||
        !raw.footprint.every(
          (point) =>
            Array.isArray(point) &&
            point.length === 2 &&
            point.every((number) => finite(number, -0.5, 0.5)),
        ) ||
        !simplePolygon(raw.footprint as Point[])
      )
        errors.push(
          `${partPath}.footprint must be a simple 3–16 vertex polygon inside the part's ±0.5 unit square.`,
        );
    } else if (raw.footprint !== null)
      errors.push(`${partPath}.footprint must be null for this primitive.`);
    if (errors.length !== start) return;
    const part = raw as unknown as GeometryPart,
      bounds = geometryPartBounds(part);
    if (
      bounds.min[0] < -0.5 - EPSILON ||
      bounds.max[0] > 0.5 + EPSILON ||
      bounds.min[1] < -EPSILON ||
      bounds.max[1] > 1 + EPSILON ||
      bounds.min[2] < -0.5 - EPSILON ||
      bounds.max[2] > 0.5 + EPSILON
    )
      errors.push(`${partPath} exceeds the normalized object envelope after rotation.`);
    if (object && validEnvelope && polygon && validFootprint) {
      const rectangle: Point[] = [
        [bounds.min[0] * object.width, bounds.min[2] * object.depth],
        [bounds.max[0] * object.width, bounds.min[2] * object.depth],
        [bounds.max[0] * object.width, bounds.max[2] * object.depth],
        [bounds.min[0] * object.width, bounds.max[2] * object.depth],
      ];
      if (!rectangleInside(rectangle, polygon))
        errors.push(`${partPath} projected bounds leave the traced object footprint.`);
    }
  });
  return errors;
}
