// Default is reproducible offline measurement. --acquire downloads six small regions
// sequentially (one attempt each), then runs the optional Python PBF crop helper.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { measureLayout } from './layout-metrics.mjs';

const root = new URL('../', import.meta.url);
const file = (relative) => new URL(relative, root);
const config = JSON.parse(await readFile(file('scripts/layout-study-places.json'), 'utf8'));
const cache = file('.wordscape/layout-study/');
const output = file('public/reference/layout-study/');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const license = {
  name: 'Open Database License 1.0',
  url: 'https://opendatacommons.org/licenses/odbl/1-0/',
  attribution: '© OpenStreetMap contributors',
};
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
if (process.argv.includes('--acquire')) {
  for (const [region, url] of Object.entries(config.regions)) {
    const destination = new URL(`${region}.osm.pbf`, cache);
    try {
      const existing = await stat(destination).catch(() => null);
      if (existing) {
        console.log(`${region}: cached ${existing.size} bytes`);
        continue;
      }
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Wordscape/0.7 (bounded layout study; https://github.com/wearywas/wordscape)',
        },
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024)
          throw new Error('Regional download exceeds the 8 MiB study cap.');
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      await writeFile(destination, data);
      await writeFile(
        new URL(`${region}.download.json`, cache),
        JSON.stringify(
          {
            downloadedAt: new Date().toISOString(),
            lastModified: response.headers.get('last-modified'),
            downloadBytes: bytes,
            responseSha256: sha(data),
          },
          null,
          2,
        ) + '\n',
      );
      console.log(`${region}: downloaded ${bytes} bytes`);
    } catch (error) {
      const failure = {
        url,
        status: 'failed',
        attemptedAt: new Date().toISOString(),
        error: error.message,
      };
      await writeFile(
        new URL(`${region}.failure.json`, cache),
        JSON.stringify(failure, null, 2) + '\n',
      );
      console.error(`${region}: ${error.message}; no retry`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const python = process.env.WORDSCAPE_STUDY_PYTHON ?? '.wordscape/layout-venv/Scripts/python.exe';
  const result = spawnSync(python, ['scripts/extract-layout-pbf.py'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  if (result.error || result.status !== 0)
    throw result.error ?? new Error('PBF selection helper failed.');
}
const keep = new Set([
  'building',
  'building:part',
  'highway',
  'landuse',
  'leisure',
  'natural',
  'area',
  'layer',
  'bridge',
  'tunnel',
  'height',
  'building:levels',
]);
for (const place of config.places.filter((p) => p.retained)) {
  const source = JSON.parse(await readFile(file(`public/reference/${place.retained}`), 'utf8'));
  const metadata = JSON.parse(await readFile(file(`public/reference/${place.manifest}`), 'utf8'));
  const elements = source.elements
    .filter((e) => e.type === 'way' || e.type === 'relation')
    .map((e) => ({
      type: e.type,
      id: e.id,
      ...(e.nodes ? { nodes: e.nodes } : {}),
      ...(e.geometry ? { geometry: e.geometry } : {}),
      ...(e.members
        ? {
            members: e.members.map(({ type, ref, role, geometry }) => ({
              type,
              ref,
              role,
              ...(geometry ? { geometry } : {}),
            })),
          }
        : {}),
      tags: Object.fromEntries(Object.entries(e.tags ?? {}).filter(([key]) => keep.has(key))),
    }))
    .filter((e) => Object.keys(e.tags).length);
  const record = {
    version: 1,
    sample: { ...place, bounds: metadata.bounds },
    source: {
      provider: 'Retained OpenStreetMap extraction',
      url: metadata.sourceUrl,
      downloadedAt: metadata.capturedAtUTC,
      snapshotAt: metadata.sourceSnapshotTimestamp ?? null,
      originalManifest: place.manifest,
      note: 'Existing bounded category extraction; not a new request. Kept tags match this study; feature query differs from the regional files.',
    },
    elements,
  };
  await writeFile(
    new URL(`${place.id}.osm.json.gz`, output),
    gzipSync(Buffer.from(JSON.stringify(record)), { mtime: 0 }),
  );
}
const summaries = [],
  failures = [];
const previewMaps = [];
for (const place of config.places) {
  try {
    const bytes = await readFile(new URL(`${place.id}.osm.json.gz`, output));
    const record = JSON.parse(gunzipSync(bytes));
    const measured = measureLayout(record, record.sample.bounds);
    previewMaps.push({ sample: record.sample, ...measured });
    summaries.push({
      id: place.id,
      label: place.label,
      intendedContext: place.intendedContext,
      bounds: record.sample.bounds,
      source: record.source,
      file: `${place.id}.osm.json.gz`,
      sha256: sha(bytes),
      bytes: bytes.length,
      sourceCandidateWays: record.elements.filter((e) => e.type === 'way').length,
      ...measured,
      geometry: undefined,
    });
    console.log(
      `${place.id}: ${measured.metrics.buildingCount} buildings, ${measured.metrics.roadSegmentCount} road segments, ${measured.metrics.landUseClasses.length} area classes`,
    );
  } catch (error) {
    failures.push({ id: place.id, status: 'unavailable', reason: error.message });
  }
}
const limitations = [
  'Purposive 20-window case study, selected partly by small downloadable regions after Overpass timeouts. Not random, statistically representative, or machine-learning training.',
  'OSM records mapped geometry, not complete real-world inventories. Zero means no retained feature, never proven absence. The intendedContext labels are authored sampling intentions.',
  'Only simple closed ways are measured as areas. Multipolygon relations/holes and building parts are omitted; very long ways over 5000 nodes are omitted. Retained SF query coverage differs from whole-region crops.',
  'Distances use local scaled Web Mercator metres. Nearest-building gaps are edge-to-edge within the clipped window; edge censoring and unmapped neighbors bias them. Shared walls yield zero.',
  'Road proximity is from each building footprint envelope center to a mapped motor-road centerline, not a setback, entrance distance, route length, or access guarantee.',
  'Connectivity uses shared original OSM node identities and is cut by window boundaries. It is not navigation, access, accessibility, or grade-separation validation.',
  'Land-use adjacency counts building/area pairs within an authored 10 m threshold, including overlaps. Areas may overlap; summed footprint coverage is not polygon-union coverage.',
  'No terrain, imagery, field-verified heights/widths, traffic conditions, or tree-species inventory was acquired. Retained height tags are not used in these metrics. Snapshot/edit dates are not survey acquisition dates.',
];
const manifest = {
  version: 1,
  studyId: 'wordscape-layout-study-v1',
  generatedAt: new Date().toISOString(),
  plannedCount: config.places.length,
  completedCount: summaries.length,
  sourceLicense: license,
  providerPolicy: 'https://download.geofabrik.de/',
  acquisition: {
    method:
      'Small Geofabrik region downloads + two retained extracts; offline bounding-box candidate selection',
    requests:
      'Six regional downloads, one attempt each; cached files reused. No public editing-API batch or imagery requests.',
    failedOverpassProbes: [
      {
        endpoint: 'https://overpass.private.coffee/api/interpreter',
        method: 'POST',
        timeoutSeconds: 25,
      },
      { endpoint: 'https://overpass-api.de/api/interpreter', method: 'POST', timeoutSeconds: 25 },
      { endpoint: 'https://overpass-api.de/api/interpreter', method: 'GET', timeoutSeconds: 18 },
    ],
    note: 'All three preliminary Overpass probes timed out before the download strategy was selected; they are not completed samples.',
  },
  limitations,
  samples: summaries,
  failures,
};
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
const smallSamples = summaries.map((s) => ({
  id: s.id,
  label: s.label,
  intendedContext: s.intendedContext,
  metrics: {
    buildingCount: s.metrics.buildingCount,
    roadSegmentCount: s.metrics.roadSegmentCount,
    pathSegmentCount: s.metrics.pathSegmentCount,
    medianBuildingAreaM2: s.metrics.buildingFootprintAreaM2.median,
    medianNearestBuildingGapM: s.metrics.nearestBuildingGapM.median,
    medianBuildingToRoadCenterlineM: s.metrics.buildingEnvelopeCenterToRoadCenterlineM.median,
    networkComponents: s.metrics.networkComponents,
    largestNetworkFraction: s.metrics.largestNetworkFraction,
    landUseClasses: s.metrics.landUseClasses,
  },
}));
const withBuildings = summaries.filter((s) => s.metrics.buildingCount >= 2);
const finite = (key) => withBuildings.map((s) => s.metrics[key].median).filter((n) => n !== null);
const pattern = (id, summary, samples) => ({
  id,
  summary,
  evidence: 'derived',
  sampleIds: samples.map((s) => s.id),
});
const patterns = [];
if (withBuildings.length) {
  const gaps = finite('nearestBuildingGapM'),
    areas = finite('buildingFootprintAreaM2');
  patterns.push(
    pattern(
      'spacing-varies',
      `Among ${withBuildings.length} windows with at least two mapped buildings, median edge-to-edge nearest-neighbor gaps range from ${Math.min(...gaps)} to ${Math.max(...gaps)} m; one universal spacing is not supported.`,
      withBuildings,
    ),
  );
  patterns.push(
    pattern(
      'footprint-scale-varies',
      `Median clipped building footprint area ranges from ${Math.min(...areas)} to ${Math.max(...areas)} m² across these building-containing windows.`,
      withBuildings,
    ),
  );
}
const mixed = summaries.filter(
  (s) => s.metrics.roadSegmentCount > 0 && s.metrics.pathSegmentCount > 0,
);
patterns.push(
  pattern(
    'routes-have-types',
    `${mixed.length} of ${summaries.length} measured windows contain both mapped motor-road and pedestrian/cycle/path segments; these are distinct route classes.`,
    mixed,
  ),
);
const sparse = summaries.filter((s) => s.metrics.buildingCount < 5);
patterns.push(
  pattern(
    'mapped-sparse-examples',
    `${sparse.length} measured windows have fewer than five retained building footprints. This is mapped sparsity, not proof of an empty landscape.`,
    sparse,
  ),
);
const adjacent = summaries.filter((s) =>
  Object.values(s.metrics.buildingAreaAdjacencyPairsWithin10m).some((n) => n > 0),
);
patterns.push(
  pattern(
    'buildings-and-area-context',
    `${adjacent.length} windows contain mapped buildings within 10 m of a retained land-use/natural/leisure area polygon, including overlaps.`,
    adjacent,
  ),
);
const previous = JSON.parse(await readFile(file('src/data/layoutGuide.json'), 'utf8'));
const heuristicSamples = {
  'routes-first': mixed,
  'variable-clearances': withBuildings,
  'walkable-openings': mixed,
  'water-boundaries': summaries.filter((s) => s.metrics.landUseClasses.includes('natural:water')),
};
const guide = {
  version: '1.0',
  studyId: manifest.studyId,
  studyPending: false,
  sampleCount: summaries.length,
  generatedAt: manifest.generatedAt,
  sourceLicense: license,
  samples: smallSamples,
  patterns,
  heuristics: previous.heuristics.map((h) => ({
    ...h,
    sampleIds: (heuristicSamples[h.id] ?? []).map((s) => s.id),
  })),
  limitations,
};
await writeFile(file('src/data/layoutGuide.json'), JSON.stringify(guide, null, 2) + '\n');
if (process.argv.includes('--preview')) {
  const esc = (value) =>
    String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  const maps = previewMaps
    .map(({ sample, frame, geometry, metrics }, index) => {
      const x = (index % 4) * 310 + 15,
        y = Math.floor(index / 4) * 340 + 92;
      const scale = 280 / Math.max(frame.width, frame.depth);
      const px = (value) => Math.round(value * 100) / 100;
      const polygon = (p, color, opacity = 1) =>
        `<polygon points="${p.map(([x, y]) => `${px(x * scale)},${px(280 - y * scale)}`).join(' ')}" fill="${color}" fill-opacity="${opacity}"/>`;
      const line = (s, color, width) =>
        `<line x1="${px(s.a[0] * scale)}" y1="${px(280 - s.a[1] * scale)}" x2="${px(s.b[0] * scale)}" y2="${px(280 - s.b[1] * scale)}" stroke="${color}" stroke-width="${width}"/>`;
      return `<g transform="translate(${x},${y})"><text y="0" font-size="14" font-weight="bold">${esc(sample.label)}</text><text y="18" font-size="11">${Math.round(frame.width)} m square · ${metrics.buildingCount} mapped buildings</text><g transform="translate(0,28)"><rect width="280" height="280" fill="#f4f3ed"/>${geometry.areas.map((a) => polygon(a.footprint, a.category === 'natural:water' ? '#96bdcd' : '#bfcea9', 0.7)).join('')}${geometry.roads.map((s) => line(s, '#64737a', 1.5)).join('')}${geometry.paths.map((s) => line(s, '#b79567', 0.7)).join('')}${geometry.buildings.map((b) => polygon(b.footprint, '#735f4d')).join('')}<rect width="280" height="280" fill="none" stroke="#ccd1c8"/></g></g>`;
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1250" height="1810" font-family="Arial,sans-serif" fill="#263f35"><rect width="100%" height="100%" fill="#fff"/><text x="15" y="28" font-size="23" font-weight="bold">Twenty mapped windows · north up</text><text x="15" y="49" font-size="13">OSM-derived geometry: brown buildings · gray roads · tan paths · green mapped areas · blue inland water</text><text x="15" y="68" font-size="12">Different window sizes; no imagery. Missing features and omitted multipolygons are unknown. © OpenStreetMap contributors · ODbL 1.0</text>${maps}</svg>`;
  await writeFile(new URL('contact-sheet.svg', output), svg);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1250, height: 1810 },
      deviceScaleFactor: 1,
    });
    await page.goto(new URL('contact-sheet.svg', output).href);
    await page.screenshot({
      path: fileURLToPath(new URL('contact-sheet.png', output)),
    });
  } finally {
    await browser.close();
  }
}
console.log(
  `Layout study: ${summaries.length}/${config.places.length} windows measured; ${failures.length} unavailable. No synthetic source geometry.`,
);
