type Point = [number, number];
type Edge = { a: number; b: number; coast: boolean };

const EPS = 1e-6;
const cross = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

function clip(a: Point, b: Point, width: number, depth: number): [Point, Point] | undefined {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let from = 0,
    to = 1;
  for (const [p, q] of [
    [-dx, a[0]],
    [dx, width - a[0]],
    [-dy, a[1]],
    [dy, depth - a[1]],
  ]) {
    if (Math.abs(p) < EPS) {
      if (q < -EPS) return;
      continue;
    }
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to) return;
  }
  const point = (t: number): Point => [
    Math.max(0, Math.min(width, a[0] + dx * t)),
    Math.max(0, Math.min(depth, a[1] + dy * t)),
  ];
  return [point(from), point(to)];
}

/** Polygonizes complete boundary-to-boundary coastlines. OSM water is on each way's right.
 * Unknown topology and enclosed islands are rejected; no guessed ocean rectangle is emitted.
 */
export function coastalWaterPolygons(
  paths: Point[][],
  width: number,
  depth: number,
): {
  polygons: Point[][];
  warnings: string[];
} {
  const fail = (detail: string) => ({
    polygons: [],
    warnings: [`Coastal water omitted: ${detail}`],
  });
  const points: Point[] = [],
    ids = new Map<string, number>(),
    edges: Edge[] = [];
  const vertex = (p: Point) => {
    const key = p.map((n) => Math.round(n / EPS)).join(',');
    let id = ids.get(key);
    if (id === undefined) {
      id = points.length;
      points.push(p);
      ids.set(key, id);
    }
    return id;
  };
  const onBoundary = ([x, y]: Point) =>
    x <= EPS || y <= EPS || width - x <= EPS || depth - y <= EPS;
  const coastKeys = new Set<string>();
  let inputSegments = 0;
  for (const path of paths)
    for (let i = 0; i + 1 < path.length; i++) {
      if (++inputSegments > 20000)
        return fail('source exceeds the bounded coastline processing limit.');
      const line = clip(path[i], path[i + 1], width, depth);
      if (!line || Math.hypot(line[0][0] - line[1][0], line[0][1] - line[1][1]) < EPS) continue;
      const a = vertex(line[0]),
        b = vertex(line[1]),
        key = [Math.min(a, b), Math.max(a, b)].join(':');
      if (coastKeys.has(key))
        return fail('duplicate or contradictory coastline segments need review.');
      coastKeys.add(key);
      edges.push({ a, b, coast: true });
      if (edges.length > 1000)
        return fail('more than 1,000 coastline segments intersect this selection.');
    }
  if (!edges.length)
    return paths.length
      ? fail('no coastline crosses this selection; land/sea coverage is unknown.')
      : { polygons: [], warnings: [] };

  // A complete clipped chain has one incoming/outgoing edge internally and ends only at the box.
  const incoming = new Map<number, number>(),
    outgoing = new Map<number, number>();
  const coastNeighbors = new Map<number, number[]>();
  for (const edge of edges) {
    incoming.set(edge.b, (incoming.get(edge.b) ?? 0) + 1);
    outgoing.set(edge.a, (outgoing.get(edge.a) ?? 0) + 1);
    for (const [a, b] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ])
      coastNeighbors.set(a, [...(coastNeighbors.get(a) ?? []), b]);
    const a = points[edge.a],
      b = points[edge.b];
    if (
      (Math.abs(a[0] - b[0]) < EPS && (a[0] < EPS || width - a[0] < EPS)) ||
      (Math.abs(a[1] - b[1]) < EPS && (a[1] < EPS || depth - a[1] < EPS))
    )
      return fail('coastline coincides with the crop boundary; the water side is ambiguous.');
  }
  for (const id of coastNeighbors.keys()) {
    const ins = incoming.get(id) ?? 0,
      outs = outgoing.get(id) ?? 0;
    if (onBoundary(points[id])) {
      if (ins + outs !== 1)
        return fail('a branching or tangential boundary junction needs review.');
    } else if (ins !== 1 || outs !== 1)
      return fail('a coastline ends or branches inside the selection.');
  }
  const seen = new Set<number>();
  const pending = [...coastNeighbors.keys()].filter((id) => onBoundary(points[id]));
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...coastNeighbors.get(id)!);
  }
  if (seen.size !== coastNeighbors.size)
    return fail('enclosed island coastlines require hole-aware water polygons.');

  // Coastlines must not cross or overlap except at their connected source endpoints.
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const e = edges[i],
        f = edges[j];
      if ([e.a, e.b].some((id) => id === f.a || id === f.b)) continue;
      const a = points[e.a],
        b = points[e.b],
        c = points[f.a],
        d = points[f.b];
      if (
        Math.max(a[0], b[0]) + EPS < Math.min(c[0], d[0]) ||
        Math.max(c[0], d[0]) + EPS < Math.min(a[0], b[0]) ||
        Math.max(a[1], b[1]) + EPS < Math.min(c[1], d[1]) ||
        Math.max(c[1], d[1]) + EPS < Math.min(a[1], b[1])
      )
        continue;
      if (cross(a, b, c) * cross(a, b, d) <= EPS && cross(c, d, a) * cross(c, d, b) <= EPS)
        return fail('intersecting coastline geometry needs repair.');
    }

  for (const p of [
    [0, 0],
    [width, 0],
    [width, depth],
    [0, depth],
  ] as Point[])
    vertex(p);
  const perimeter = ([x, y]: Point) =>
    y <= EPS
      ? x
      : width - x <= EPS
        ? width + y
        : depth - y <= EPS
          ? 2 * width + depth - x
          : 2 * (width + depth) - y;
  const boundary = points
    .map((_, id) => id)
    .filter((id) => onBoundary(points[id]))
    .sort((a, b) => perimeter(points[a]) - perimeter(points[b]));
  for (let i = 0; i < boundary.length; i++)
    edges.push({ a: boundary[i], b: boundary[(i + 1) % boundary.length], coast: false });
  const neighbors = new Map<number, number[]>(),
    coastDirection = new Map<string, boolean>();
  for (const edge of edges) {
    for (const [a, b] of [
      [edge.a, edge.b],
      [edge.b, edge.a],
    ])
      neighbors.set(a, [...(neighbors.get(a) ?? []), b]);
    if (edge.coast) {
      coastDirection.set(`${edge.a}:${edge.b}`, false);
      coastDirection.set(`${edge.b}:${edge.a}`, true);
    }
  }
  for (const [id, adjacent] of neighbors)
    adjacent.sort(
      (a, b) =>
        Math.atan2(points[a][1] - points[id][1], points[a][0] - points[id][0]) -
        Math.atan2(points[b][1] - points[id][1], points[b][0] - points[id][0]),
    );
  const visited = new Set<string>(),
    polygons: Point[][] = [];
  for (const [start, adjacent] of neighbors)
    for (const next of adjacent) {
      if (visited.has(`${start}:${next}`)) continue;
      let a = start,
        b = next;
      const polygon: Point[] = [],
        sides = new Set<boolean>();
      for (let step = 0; step <= edges.length * 2; step++) {
        const key = `${a}:${b}`;
        if (visited.has(key)) {
          if (a !== start || b !== next) return fail('coastline faces could not be closed.');
          break;
        }
        visited.add(key);
        polygon.push(points[a]);
        const side = coastDirection.get(key);
        if (side !== undefined) sides.add(side);
        const exits = neighbors.get(b)!;
        const c = exits[(exits.indexOf(a) + exits.length - 1) % exits.length];
        a = b;
        b = c;
      }
      const area =
        polygon.reduce((sum, p, i) => {
          const q = polygon[(i + 1) % polygon.length];
          return sum + p[0] * q[1] - q[0] * p[1];
        }, 0) / 2;
      if (area <= EPS) continue; // exterior face
      if (sides.size !== 1)
        return fail('coastline direction does not consistently identify land and water.');
      if (sides.has(true)) polygons.push(polygon);
    }
  return { polygons, warnings: [] };
}
