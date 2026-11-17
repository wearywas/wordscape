// Offline conversion of retained OSM sources into complete importable Wordscapes
// and smaller contiguous geometry examples. No network, authored source geometry or terrain.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { spawnSync } from 'node:child_process';
import {
  distribution,
  measureLayout,
  polygonGap,
  pointSegmentDistance,
} from './layout-metrics.mjs';

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
        return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { convertOsmToWorld, geographicFrame } = await import('../src/imports/osm.ts');
const { getFootprint, migrateWorld, validateWorld } = await import('../src/world/document.ts');
const root = new URL('../', import.meta.url),
  out = new URL('public/reference/layout-examples/', root);
const config = JSON.parse(
  await readFile(new URL('scripts/layout-example-places.json', root), 'utf8'),
);
const R = 6378137,
  rad = Math.PI / 180;
const round = (v, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const sha = (data) => createHash('sha256').update(data).digest('hex');
const fact = (object, key) => object.facts?.find((f) => f.key === key);
const sourceIds = (object) =>
  fact(object, 'osm.coastlineWays')
    ? JSON.parse(fact(object, 'osm.coastlineWays').value).map((id) => `way/${id}`)
    : [String(fact(object, 'osm.element')?.value ?? object.id)];
const polygonArea = (p) =>
  Math.abs(
    p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0),
  ) / 2;
const length = (points) =>
  points
    .slice(1)
    .reduce((sum, p, i) => sum + Math.hypot(p[0] - points[i][0], p[1] - points[i][1]), 0);

function subBounds(bounds, x, y, width, depth = width) {
  const scale = geographicFrame(bounds).mercatorScale;
  const west = R * bounds.west * rad,
    south = R * Math.log(Math.tan(Math.PI / 4 + (bounds.south * rad) / 2));
  const lat = (v) => (2 * Math.atan(Math.exp(v / R)) - Math.PI / 2) / rad;
  return {
    west: (west + x / scale) / R / rad,
    south: lat(south + y / scale),
    east: (west + (x + width) / scale) / R / rad,
    north: lat(south + (y + depth) / scale),
  };
}

function clipPolygon(points, width, depth) {
  let output = points;
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
        b = input[(i + 1) % input.length];
      const ai = positive ? a[axis] >= limit : a[axis] <= limit,
        bi = positive ? b[axis] >= limit : b[axis] <= limit;
      if (ai) output.push(a);
      if (ai !== bi) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        output.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
  }
  return output.filter(
    (p, i) =>
      Math.hypot(
        p[0] - output[(i + 1) % output.length][0],
        p[1] - output[(i + 1) % output.length][1],
      ) > 0.0001,
  );
}

function clipLine(a, b, width, depth) {
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
  if (hi - lo < 1e-8) return;
  return {
    points: [
      [a[0] + lo * dx, a[1] + lo * dy],
      [a[0] + hi * dx, a[1] + hi * dy],
    ],
    lo,
    hi,
  };
}

// Crop already processed geometry. Re-running coastline topology on a second
// rectangle can renumber/split its faces, so it is deliberately not used here.
function cropWorld(world, rectangle) {
  const cropped = {
    ...structuredClone(world),
    bounds: { width: rectangle.width, depth: rectangle.depth },
    objects: [],
    relations: [],
  };
  const diagnostics = {
    method: 'Clip the complete processed Wordscape; do not reinterpret source coastlines.',
    invalidClippedObjects: [],
    routeCorridorsWithCenterlineOutside: 0,
  };
  for (const original of world.objects) {
    const originalPoints = getFootprint(original).map(([x, y]) => [
      x - rectangle.x,
      y - rectangle.y,
    ]);
    const footprint = clipPolygon(originalPoints, rectangle.width, rectangle.depth);
    if (footprint.length < 3 || polygonArea(footprint) < 0.0001) continue;
    const object = structuredClone(original),
      lineFact = fact(object, 'path.centerline');
    if (
      originalPoints.some(([x, y]) => x < 0 || y < 0 || x > rectangle.width || y > rectangle.depth)
    )
      object.facts.push({
        key: 'import.contextClipped',
        value: true,
        evidence: 'authored',
        note: 'Clipped again to the smaller contiguous prompt context rectangle.',
      });
    if (lineFact) {
      const line = JSON.parse(lineFact.value).map(([x, y]) => [x - rectangle.x, y - rectangle.y]);
      const clipped = clipLine(line[0], line[1], rectangle.width, rectangle.depth);
      if (!clipped) {
        diagnostics.routeCorridorsWithCenterlineOutside++;
        continue;
      }
      lineFact.value = JSON.stringify(clipped.points.map((p) => p.map((n) => round(n, 3))));
      if (clipped.lo > 1e-8) object.facts = object.facts.filter((f) => f.key !== 'osm.fromNode');
      if (clipped.hi < 1 - 1e-8) object.facts = object.facts.filter((f) => f.key !== 'osm.toNode');
    }
    const minX = Math.min(...footprint.map((p) => p[0])),
      maxX = Math.max(...footprint.map((p) => p[0]));
    const minY = Math.min(...footprint.map((p) => p[1])),
      maxY = Math.max(...footprint.map((p) => p[1]));
    Object.assign(object, {
      x: round((minX + maxX) / 2, 3),
      y: round((minY + maxY) / 2, 3),
      width: round(maxX - minX, 3),
      depth: round(maxY - minY, 3),
      rotation: 0,
    });
    object.footprint = footprint.map(([x, y]) => [round(x - object.x, 3), round(y - object.y, 3)]);
    delete object.parentId;
    const validation = validateWorld({ ...cropped, objects: [object] });
    if (validation.errors.length) {
      diagnostics.invalidClippedObjects.push({ id: object.id, errors: validation.errors });
      continue;
    }
    cropped.objects.push(object);
  }
  return { world: cropped, diagnostics };
}

function compact(world) {
  const objects = [],
    groups = new Map();
  for (const object of world.objects) {
    const line = fact(object, 'path.centerline');
    if (line) {
      const key = `${fact(object, 'osm.element')?.value}:${object.kind}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(object);
      continue;
    }
    objects.push({
      id: object.id,
      kind: object.kind,
      x: round(object.x),
      y: round(object.y),
      width: round(object.width),
      depth: round(object.depth),
      rotation: object.rotation,
      footprint: getFootprint(object).map(([x, y]) => [round(x), round(y)]),
      ...(object.kind === 'building'
        ? {
            height: object.height,
            heightEvidence:
              fact(object, 'building.reportedHeight')?.evidence ??
              fact(object, 'building.height')?.evidence ??
              'inferred',
          }
        : {}),
      sourceIds: sourceIds(object),
      sourceObjectIds: [object.id],
      clipped:
        fact(object, 'import.clipped')?.value === true ||
        fact(object, 'import.contextClipped')?.value === true,
    });
  }
  for (const group of groups.values()) {
    group.sort(
      (a, b) =>
        Number(fact(a, 'osm.segmentIndex')?.value) - Number(fact(b, 'osm.segmentIndex')?.value),
    );
    let chain;
    for (const object of group) {
      const points = JSON.parse(fact(object, 'path.centerline').value);
      const contiguous =
        chain &&
        Math.hypot(
          chain.centerline.at(-1)[0] - points[0][0],
          chain.centerline.at(-1)[1] - points[0][1],
        ) < 0.003;
      if (!contiguous) {
        const widthFact = fact(object, object.kind === 'road' ? 'road.width' : 'path.width');
        chain = {
          id: `${object.id}-chain`,
          kind: object.kind,
          centerline: points.map((p) => p.map((n) => round(n, 3))),
          nodeIds: [
            fact(object, 'osm.fromNode')?.value ?? null,
            fact(object, 'osm.toNode')?.value ?? null,
          ],
          width: widthFact?.value ?? null,
          widthEvidence: widthFact?.evidence ?? 'unknown',
          sourceIds: [String(fact(object, 'osm.element').value)],
          sourceObjectIds: [object.id],
        };
        objects.push(chain);
      } else {
        chain.centerline.push(points[1].map((n) => round(n, 3)));
        chain.nodeIds.push(fact(object, 'osm.toNode')?.value ?? null);
        chain.sourceObjectIds.push(object.id);
      }
    }
  }
  return objects;
}

function stats(world) {
  const buildings = world.objects.filter(
    (o) => o.kind === 'building' && fact(o, 'building.isOutline')?.value !== true,
  );
  const polygons = buildings.map(getFootprint);
  const routes = world.objects
    .filter((o) => fact(o, 'path.centerline'))
    .map((o) => ({ kind: o.kind, line: JSON.parse(fact(o, 'path.centerline').value) }));
  const roads = routes.filter((r) => r.kind === 'road');
  const orientationBins = Array(6).fill(0);
  let weight = 0,
    cx = 0,
    cy = 0;
  for (const {
    line: [a, b],
  } of roads) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      d = Math.hypot(dx, dy);
    const angle = (((Math.atan2(dx, dy) / rad) % 180) + 180) % 180;
    orientationBins[Math.min(5, Math.floor(angle / 30))] += d;
    weight += d;
    cx += d * Math.cos(4 * angle * rad);
    cy += d * Math.sin(4 * angle * rad);
  }
  const areaM2 = world.bounds.width * world.bounds.depth;
  return {
    scope: 'complete converted world',
    objectCount: world.objects.length,
    buildingCount: buildings.length,
    importedEstimatedHeightCount: buildings.filter(
      (o) => fact(o, 'building.height')?.evidence === 'inferred',
    ).length,
    importedMappedHeightCount: buildings.filter(
      (o) => fact(o, 'building.reportedHeight')?.evidence === 'sourced',
    ).length,
    buildingCountPerHa: round((buildings.length / areaM2) * 10000),
    summedBuildingAreaRatio: round(
      polygons.reduce((sum, p) => sum + polygonArea(p), 0) / areaM2,
      3,
    ),
    footprintAreaM2: distribution(polygons.map(polygonArea)),
    nearestBuildingGapM: distribution(
      polygons.length > 1
        ? polygons.map((p, i) =>
            Math.min(...polygons.filter((_, j) => i !== j).map((q) => polygonGap(p, q))),
          )
        : [],
    ),
    buildingEnvelopeCenterToRoadCenterlineM: distribution(
      roads.length
        ? buildings.map((b) =>
            Math.min(
              ...roads.map(({ line }) => pointSegmentDistance([b.x, b.y], line[0], line[1])),
            ),
          )
        : [],
    ),
    roadLengthM: round(roads.reduce((sum, r) => sum + length(r.line), 0)),
    pathLengthM: round(
      routes.filter((r) => r.kind === 'pavement').reduce((sum, r) => sum + length(r.line), 0),
    ),
    roadOrientation: {
      convention:
        'Undirected degrees clockwise from north; bins [0,30), [30,60), … [150,180). Length weighted.',
      binLengthM: orientationBins.map((v) => round(v)),
      orthogonalAlignment: weight ? round(Math.hypot(cx, cy) / weight, 3) : null,
    },
    relationCount: world.relations.length,
  };
}

const limitations = [
  'Ten purposively selected examples from retained OSM extracts, not a representative sample or model training. Context labels and tags are authored descriptions.',
  'The complete Wordscapes preserve converter omissions and estimated heights/widths. Source footprint geometry does not establish height, roof form, entrances, terrain, access or mapping completeness.',
  'Compact context clips the processed Wordscape to a contiguous rectangle, never a disconnected random sample. Intersecting footprints and centerline-intersecting routes are retained unless clipping is invalid, with omissions counted in the manifest. Consecutive segments of the same mapped way are grouped only when endpoints meet; this does not invent new connections.',
  'Compact footprints use absolute cluster-local x/y metres and are rounded to 0.01 m; centerlines to 0.001 m. Full Wordscapes retain their original object-local footprint convention. No outline is replaced with a stock rectangle.',
  'Building gaps and density are censored by crop boundaries and missing mapping. Orientation alignment describes mapped road segments: a single straight road can score highly; it is not a universal grid or naturalness score.',
  'Regional retained sources omit relation multipolygon assembly, nodes, names, contributor identities and most tags. No new network acquisition or terrain inference occurs in this conversion.',
];
await mkdir(out, { recursive: true });
const examples = [],
  manifest = {
    version: config.version,
    sourceStudy: 'wordscape-layout-study-v1',
    method: 'Offline retained-source conversion with convertOsmToWorld',
    limitations,
    examples: [],
  };
const previews = [];
for (const place of config.examples) {
  const sourceBytes = await readFile(
    new URL(`public/reference/layout-study/${place.id}.osm.json.gz`, root),
  );
  const source = JSON.parse(gunzipSync(sourceBytes));
  const originalFrame = geographicFrame(source.sample.bounds);
  const x = Math.max(
    0,
    Math.min(originalFrame.width - place.size, place.center[0] - place.size / 2),
  );
  const y = Math.max(
    0,
    Math.min(originalFrame.depth - place.size, place.center[1] - place.size / 2),
  );
  const bounds = subBounds(source.sample.bounds, x, y, place.size);
  const input = {
    elements: source.elements,
    ...(source.source.snapshotAt
      ? { osm3s: { timestamp_osm_base: source.source.snapshotAt } }
      : {}),
  };
  const options = {
    bounds,
    name: place.name,
    sourceUrl: source.source.url,
    accessed: source.source.downloadedAt?.slice(0, 10) ?? 'Unknown',
  };
  const converted = convertOsmToWorld(input, options),
    world = migrateWorld(converted.world);
  world.description = `${place.context} A real mapped layout example, processed from retained OSM data. Flat ground and explicit inferred building heights/corridor widths; this is not a complete survey.`;
  world.sources[0].title = `${source.source.provider} · ${source.sample.label}`;
  world.sources[0].notes += ` Retained source crop: layout-study/${place.id}.osm.json.gz; SHA-256 ${sha(sourceBytes)}. Regional extract snapshot ${source.source.snapshotAt ?? 'not supplied'}; original retrieval ${source.source.downloadedAt ?? 'unknown'}. This smaller window was converted offline; no new source acquisition. The retained source tag/category filtering and omitted relation geometry are documented in docs/LAYOUT_STUDY.md.`;
  const validation = validateWorld(world);
  if (validation.errors.length) throw new Error(`${place.id}: ${validation.errors.join(' ')}`);
  if (converted.diagnostics.omitted.some((o) => o.reason.includes('Object limit')))
    throw new Error(`${place.id}: object limit reached; reduce the explicit window.`);
  if (!world.objects.some((o) => o.kind === 'building'))
    throw new Error(`${place.id}: selected case has no converted building.`);
  // Choose a connected spatial window by its geometry count; retain all categories within it.
  // This is purposive crop selection, not a claim that the topology is a single component.
  const candidates = [];
  for (const size of [70, 90, 110, 130, 150, 170, 190, 210, 230, 250].filter(
    (s) => s <= place.size,
  )) {
    for (const fx of [0.35, 0.5, 0.65])
      for (const fy of [0.35, 0.5, 0.65]) {
        const cx = Math.max(0, Math.min(place.size - size, place.size * fx - size / 2));
        const cy = Math.max(0, Math.min(place.size - size, place.size * fy - size / 2));
        const rectangle = subBounds(bounds, cx, cy, size);
        const measured = measureLayout(input, rectangle);
        const routeWays = new Set(
          [...measured.geometry.roads, ...measured.geometry.paths].map(
            (r) => `${r.osmId}:${r.highway}`,
          ),
        );
        const n =
          measured.geometry.buildings.length + measured.geometry.areas.length + routeWays.size;
        const score =
          Math.abs(n - 32) +
          (measured.geometry.buildings.length < 4 ? 50 : 0) +
          (!routeWays.size ? 50 : 0) +
          Math.abs(fx - 0.5) +
          Math.abs(fy - 0.5);
        candidates.push({ x: cx, y: cy, width: size, depth: size, bounds: rectangle, score });
      }
  }
  candidates.sort((a, b) => a.score - b.score);
  let selected;
  for (const candidate of candidates.slice(0, 16)) {
    const clusterConverted = cropWorld(world, candidate);
    const objects = compact(clusterConverted.world);
    if (!selected || Math.abs(objects.length - 32) < Math.abs(selected.objects.length - 32))
      selected = {
        ...candidate,
        objects,
        diagnostics: clusterConverted.diagnostics,
        converted: clusterConverted.world,
      };
    if (objects.length >= 20 && objects.length <= 45) break;
  }
  const cluster = {
    bounds: {
      x: round(selected.x),
      y: round(selected.y),
      width: round(selected.converted.bounds.width, 3),
      depth: round(selected.converted.bounds.depth, 3),
    },
    units: 'metres',
    coordinateNote:
      'x east/y north from this contiguous crop’s southwest corner. Footprint points and route centerlines are ABSOLUTE CLUSTER-LOCAL metres, not offsets from object centers. Full Wordscape positions use its own southwest origin.',
    objectCountBeforeRouteGrouping: selected.converted.objects.length,
    selection:
      'Purposive rectangular subwindow targeting roughly 20–45 geometry records, clipped from the complete processed Wordscape. All valid intersecting footprints and centerline-intersecting routes are retained; clipping omissions are counted in the manifest. Original route nodes/geometry are not randomly sampled.',
    objects: selected.objects,
  };
  const worldPath = `/reference/layout-examples/${place.id}.wordscape.json`;
  const worldText = JSON.stringify(world) + '\n';
  await writeFile(new URL(`${place.id}.wordscape.json`, out), worldText);
  const entry = {
    id: place.id,
    name: place.name,
    context: place.context,
    tags: place.tags,
    source: {
      attribution: '© OpenStreetMap contributors',
      license: 'ODbL 1.0',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      url: source.source.url,
      worldPath,
      thumbnailPath: `/reference/layout-examples/${place.id}.plan.png`,
      bounds,
      snapshotAt: source.source.snapshotAt ?? null,
      accessed: options.accessed,
      studySampleId: place.id,
      retainedSourceSha256: sha(sourceBytes),
    },
    stats: stats(world),
    cluster,
    limitations: [...converted.diagnostics.warnings],
  };
  const measuredAreas = measureLayout(input, bounds).geometry.areas;
  const unrepresentedAreaClasses = {};
  for (const area of measuredAreas) {
    if (
      [
        'landuse:grass',
        'leisure:park',
        'leisure:garden',
        'leisure:playground',
        'natural:water',
      ].includes(area.category)
    )
      continue;
    unrepresentedAreaClasses[area.category] = (unrepresentedAreaClasses[area.category] ?? 0) + 1;
  }
  if (Object.keys(unrepresentedAreaClasses).length)
    entry.limitations.push(
      `Mapped simple area classes not rendered by the existing importer: ${Object.keys(unrepresentedAreaClasses).join(', ')}. Blank ground does not imply absent land use.`,
    );
  examples.push(entry);
  manifest.examples.push({
    id: place.id,
    source: entry.source,
    sha256: sha(worldText),
    bytes: Buffer.byteLength(worldText),
    stats: entry.stats,
    diagnostics: converted.diagnostics,
    validationWarnings: validation.warnings,
    cluster: {
      bounds: cluster.bounds,
      geometryRecords: cluster.objects.length,
      diagnostics: selected.diagnostics,
    },
    retainedSourceRelations: input.elements.filter((e) => e.type === 'relation').length,
    coverage: {
      unrepresentedAreaClasses,
      retainedNodes: input.elements.filter((e) => e.type === 'node').length,
      note: 'Source crops intentionally omit nodes and most relation geometry. Missing mapped trees, entrances and land-use surfaces must not be interpreted as real-world absence.',
    },
  });
  previews.push({ place, world, cluster });
  console.log(
    `${place.id}: ${world.objects.length} objects, ${entry.stats.buildingCount} buildings, ${world.relations.length} relations; contiguous cluster ${cluster.objects.length} records (${cluster.objectCountBeforeRouteGrouping} source objects)`,
  );
}
await writeFile(new URL('manifest.json', out), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(
  new URL('src/data/layoutExamples.json', root),
  JSON.stringify(
    { version: config.version, sourceStudy: manifest.sourceStudy, examples, limitations },
    null,
    2,
  ) + '\n',
);

const escape = (v) =>
  String(v).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const panels = previews
  .map(({ place, world, cluster }, index) => {
    const scale = 305 / Math.max(world.bounds.width, world.bounds.depth),
      x = (index % 5) * 330 + 15,
      y = Math.floor(index / 5) * 390 + 100;
    const colors = {
      grass: '#c4d2b5',
      water: '#95c7d8',
      road: '#9da9ad',
      pavement: '#d8cba6',
      building: '#775d4b',
      tree: '#64835b',
      fixture: '#545e5a',
      landmark: '#775d4b',
    };
    const polygons = [...world.objects]
      .sort((a, b) => a.layer - b.layer)
      .map(
        (o) =>
          `<polygon points="${getFootprint(o)
            .map(([x, y]) => `${round(x * scale)},${round(305 - y * scale)}`)
            .join(' ')}" fill="${colors[o.kind]}"/>`,
      )
      .join('');
    const b = cluster.bounds;
    return `<g transform="translate(${x},${y})"><text font-size="13" font-weight="bold">${escape(place.name)}</text><text y="20" font-size="11">${round(world.bounds.width)} m · ${world.objects.length} objects · ${cluster.objects.length} context records</text><g transform="translate(0,34)"><rect width="305" height="305" fill="#f5f3ee"/>${polygons}<rect x="${round(b.x * scale)}" y="${round(305 - (b.y + b.depth) * scale)}" width="${round(b.width * scale)}" height="${round(b.depth * scale)}" fill="none" stroke="#ce4e56" stroke-width="2" stroke-dasharray="5 3"/><rect width="305" height="305" fill="none" stroke="#b7beb5"/></g></g>`;
  })
  .join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1665" height="880" font-family="Arial,sans-serif" fill="#283c32"><rect width="100%" height="100%" fill="white"/><text x="15" y="28" font-size="23" font-weight="bold">Ten real layouts processed into Wordscapes</text><text x="15" y="50" font-size="13">North up · actual converted polygons and route corridors · dashed red = contiguous prompt context window</text><text x="15" y="70" font-size="12">Mapped geometry is incomplete; heights/route widths may be inferred. © OpenStreetMap contributors · ODbL 1.0. No terrain or imagery.</text>${panels}</svg>`;
await writeFile(new URL('contact-sheet.svg', out), svg);
if (process.argv.includes('--preview')) {
  const preview = spawnSync(
    process.env.WORDSCAPE_PREVIEW_PYTHON ?? 'python',
    ['scripts/render-layout-examples.py'],
    { cwd: root, stdio: 'inherit' },
  );
  if (preview.error || preview.status !== 0)
    throw (
      preview.error ??
      new Error('Optional PNG renderer requires Python with Pillow; the SVG is already available.')
    );
}
console.log(
  `Processed ${examples.length} complete real Wordscapes and contiguous geometry contexts. No network requests.`,
);
