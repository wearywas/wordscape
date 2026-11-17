// Small planar measurements of mapped geometry, not a completeness/accuracy assessment.
const R = 6378137;
const rad = Math.PI / 180;
const rounded = (n) => Math.round(n * 1000) / 1000;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const closed = (points) => points.length >= 4 && distance(points[0], points.at(-1)) < 0.001;
export function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return distance(p, [a[0] + dx * t, a[1] + dy * t]);
}
function inside(p, polygon) {
  let yes = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (pointSegmentDistance(p, a, b) < 1e-8) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}
export function polygonGap(a, b) {
  if (inside(a[0], b) || inside(b[0], a)) return 0;
  let min = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const p = a[i],
        q = a[(i + 1) % a.length],
        r = b[j],
        s = b[(j + 1) % b.length];
      if (segmentsCross(p, q, r, s)) return 0;
      min = Math.min(
        min,
        pointSegmentDistance(p, r, s),
        pointSegmentDistance(q, r, s),
        pointSegmentDistance(r, p, q),
        pointSegmentDistance(s, p, q),
      );
    }
  return min;
}
const area = (p) =>
  Math.abs(
    p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0),
  ) / 2;
function clipPolygon(p, width, depth) {
  let output = p;
  for (const [axis, limit, positive] of [
    [0, 0, true],
    [0, width, false],
    [1, 0, true],
    [1, depth, false],
  ]) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i++) {
      const a = input[i],
        b = input[(i + 1) % input.length],
        ai = positive ? a[axis] >= limit : a[axis] <= limit,
        bi = positive ? b[axis] >= limit : b[axis] <= limit;
      if (ai) output.push(a);
      if (ai !== bi) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return output;
}
function clipSegment(a, b, width, depth) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  let lo = 0,
    hi = 1;
  for (const [p, q] of [
    [-dx, a[0]],
    [dx, width - a[0]],
    [-dy, a[1]],
    [dy, depth - a[1]],
  ]) {
    if (p === 0) {
      if (q < 0) return;
      continue;
    }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo > hi) return;
  }
  if (hi - lo < 1e-10) return;
  return { a: [a[0] + dx * lo, a[1] + dy * lo], b: [a[0] + dx * hi, a[1] + dy * hi], lo, hi };
}
export function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { n: 0, min: null, median: null, p90: null, max: null };
  const q = (at) => {
    const i = (sorted.length - 1) * at,
      lo = Math.floor(i);
    return rounded(sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo));
  };
  return { n: sorted.length, min: q(0), median: q(0.5), p90: q(0.9), max: q(1) };
}
export function measureLayout(data, bounds) {
  const scale = Math.cos(((bounds.south + bounds.north) / 2) * rad);
  const merc = (lon, lat) => [R * lon * rad, R * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2))];
  const sw = merc(bounds.west, bounds.south),
    ne = merc(bounds.east, bounds.north);
  const width = (ne[0] - sw[0]) * scale,
    depth = (ne[1] - sw[1]) * scale;
  const project = (p) => {
    const v = merc(p.lon, p.lat);
    return [(v[0] - sw[0]) * scale, (v[1] - sw[1]) * scale];
  };
  const buildings = [],
    areas = [],
    roads = [],
    paths = [],
    allSegments = [];
  const omissions = {
    relations: 0,
    incompleteWays: 0,
    openAreaWays: 0,
    buildingParts: 0,
    degeneratePolygons: 0,
    unsupportedHighways: 0,
  };
  for (const e of data.elements) {
    if (e.type === 'relation') {
      omissions.relations++;
      continue;
    }
    if (e.type !== 'way') continue;
    const tags = e.tags ?? {};
    if (
      !e.geometry?.length ||
      e.geometry.some((p) => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon))
    ) {
      omissions.incompleteWays++;
      continue;
    }
    const points = e.geometry.map(project);
    const pathClass = /^(footway|path|pedestrian|steps|cycleway|bridleway)$/.test(tags.highway);
    const roadClass =
      /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track)(?:_link)?$/.test(
        tags.highway,
      );
    if (tags.highway && !pathClass && !roadClass) omissions.unsupportedHighways++;
    if ((pathClass || roadClass) && tags.area !== 'yes')
      for (let i = 0; i < points.length - 1; i++) {
        const c = clipSegment(points[i], points[i + 1], width, depth);
        if (!c) continue;
        const segment = {
          osmId: `way/${e.id}`,
          highway: tags.highway,
          a: c.a,
          b: c.b,
          fromNode: c.lo < 1e-9 ? e.nodes?.[i] : null,
          toNode: c.hi > 1 - 1e-9 ? e.nodes?.[i + 1] : null,
        };
        allSegments.push(segment);
        (pathClass ? paths : roads).push(segment);
      }
    const category =
      tags.building && tags.building !== 'no'
        ? 'building'
        : tags.landuse
          ? `landuse:${tags.landuse}`
          : tags.leisure
            ? `leisure:${tags.leisure}`
            : /^(water|wood|wetland|scrub|grassland|heath|beach|sand|bare_rock|scree|shingle|fell|glacier|mud)$/.test(
                  tags.natural,
                )
              ? `natural:${tags.natural}`
              : null;
    if (!category) continue;
    if (tags['building:part']) {
      omissions.buildingParts++;
      continue;
    }
    if (!closed(points)) {
      omissions.openAreaWays++;
      continue;
    }
    const footprint = clipPolygon(points.slice(0, -1), width, depth);
    if (footprint.length < 3 || area(footprint) < 0.1) {
      omissions.degeneratePolygons++;
      continue;
    }
    const item = {
      osmId: `way/${e.id}`,
      category,
      footprint,
      areaM2: area(footprint),
      clipped: points.some(([x, y]) => x < 0 || y < 0 || x > width || y > depth),
    };
    (category === 'building' ? buildings : areas).push(item);
  }
  const gap = [];
  for (let i = 0; i < buildings.length; i++) {
    let nearest = Infinity;
    for (let j = 0; j < buildings.length; j++)
      if (i !== j)
        nearest = Math.min(nearest, polygonGap(buildings[i].footprint, buildings[j].footprint));
    if (Number.isFinite(nearest)) gap.push(nearest);
  }
  const roadDistances = [];
  for (const b of buildings) {
    const xs = b.footprint.map((p) => p[0]),
      ys = b.footprint.map((p) => p[1]);
    const center = [
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    ];
    let min = Infinity;
    for (const s of roads) min = Math.min(min, pointSegmentDistance(center, s.a, s.b));
    if (Number.isFinite(min)) roadDistances.push(min);
  }
  const adjacency = {};
  for (const a of areas) {
    let count = 0;
    for (const b of buildings) if (polygonGap(a.footprint, b.footprint) <= 10) count++;
    adjacency[a.category] = (adjacency[a.category] ?? 0) + count;
  }
  // Shared original OSM IDs establish topology. Clip endpoints remain private to their segment.
  const graph = new Map(),
    lengths = [];
  allSegments.forEach((s, i) => {
    const a = s.fromNode == null ? `cut:${i}:a` : `node:${s.fromNode}`,
      b = s.toNode == null ? `cut:${i}:b` : `node:${s.toNode}`;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      if (!graph.has(from)) graph.set(from, new Set());
      graph.get(from).add(to);
    }
    lengths.push(distance(s.a, s.b));
  });
  const seen = new Set(),
    components = [];
  for (const node of graph.keys())
    if (!seen.has(node)) {
      const queue = [node];
      seen.add(node);
      for (const n of queue)
        for (const next of graph.get(n))
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
      components.push(queue.length);
    }
  const roadLength = roads.reduce((s, e) => s + distance(e.a, e.b), 0),
    pathLength = paths.reduce((s, e) => s + distance(e.a, e.b), 0);
  return {
    frame: {
      width: rounded(width),
      depth: rounded(depth),
      units: 'metres',
      axis: 'x east, y north',
      mercatorScale: scale,
    },
    metrics: {
      buildingCount: buildings.length,
      clippedBuildingCount: buildings.filter((b) => b.clipped).length,
      buildingFootprintAreaM2: distribution(buildings.map((b) => b.areaM2)),
      nearestBuildingGapM: distribution(gap),
      buildingEnvelopeCenterToRoadCenterlineM: distribution(roadDistances),
      roadSegmentCount: roads.length,
      pathSegmentCount: paths.length,
      roadLengthM: rounded(roadLength),
      pathLengthM: rounded(pathLength),
      roadLengthPerHa: rounded(roadLength / ((width * depth) / 10000)),
      mappedFootprintAreaRatio: rounded(
        buildings.reduce((s, b) => s + b.areaM2, 0) / (width * depth),
      ),
      networkNodes: graph.size,
      networkComponents: components.length,
      largestNetworkFraction: graph.size ? rounded(Math.max(...components) / graph.size) : null,
      junctionNodes: [...graph.values()].filter((n) => n.size >= 3).length,
      landUseClasses: [...new Set(areas.map((a) => a.category))].sort(),
      buildingAreaAdjacencyPairsWithin10m: adjacency,
      areaCount: areas.length,
    },
    omissions,
    geometry: {
      buildings: buildings.map((b) => ({
        ...b,
        areaM2: rounded(b.areaM2),
        footprint: b.footprint.map((p) => p.map(rounded)),
      })),
      roads: roads.map((s) => ({ ...s, a: s.a.map(rounded), b: s.b.map(rounded) })),
      paths: paths.map((s) => ({ ...s, a: s.a.map(rounded), b: s.b.map(rounded) })),
      areas: areas.map((a) => ({
        ...a,
        areaM2: rounded(a.areaM2),
        footprint: a.footprint.map((p) => p.map(rounded)),
      })),
    },
  };
}
