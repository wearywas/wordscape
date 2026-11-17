// Reproduce the candidate input for the conservative Washington Square edge audit.
// No network calls. Python/Shapely performs footprint intersection checks separately.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

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
  load(url, context, next) {
    if (url.endsWith('.json'))
      return {
        format: 'module',
        source: `export default ${readFileSync(new URL(url), 'utf8')}`,
        shortCircuit: true,
      };
    return next(url, context);
  },
});
const { washingtonSquare } = await import('../src/data/washingtonSquare.ts');
const { convertOsmToWorld } = await import('../src/imports/osm.ts');
const { getFootprint, serializeWorld, validateWorld } = await import('../src/world/document.ts');
const root = new URL('../', import.meta.url),
  cache = new URL('.wordscape/washington-enrichment/', root);
const sourceBytes = await readFile(new URL('public/reference/washington-square-osm.json', root));
const input = JSON.parse(sourceBytes);
const metadata = JSON.parse(
  await readFile(new URL('public/reference/washington-square-osm-manifest.json', root), 'utf8'),
);
const baseline = structuredClone(washingtonSquare);
baseline.objects = baseline.objects.filter((o) => !o.tags?.includes('osm-edge-enrichment'));
baseline.sources = baseline.sources.filter((s) => s.id !== 'osm-washington-edges');
baseline.relations = baseline.relations.filter(
  (r) => !r.note?.startsWith('Round 9 edge enrichment:'),
);
const buildingInput = {
  ...input,
  elements: input.elements.filter((e) => e.tags?.building || e.tags?.['building:part']),
};
const converted = convertOsmToWorld(buildingInput, {
  name: 'Washington Square mapped building candidates',
  bounds: metadata.bounds,
  frame: {
    origin: { latitude: baseline.origin.latitude, longitude: baseline.origin.longitude },
    width: 360,
    depth: 360,
    mercatorScale: 0.7901464545017922,
  },
  accessed: metadata.accessed,
  sourceUrl: metadata.sourceUrl,
});
const majorStreets = new Set([
  'Stockton Street',
  'Powell Street',
  'Columbus Avenue',
  'Green Street',
  'Greenwich Street',
  'Filbert Street',
  'Union Street',
]);
const minorRoutes = convertOsmToWorld(
  {
    ...input,
    elements: input.elements.filter(
      (e) => e.tags?.highway && e.tags?.name && !majorStreets.has(e.tags.name),
    ),
  },
  {
    name: 'Washington Square mapped minor route candidates',
    bounds: metadata.bounds,
    frame: {
      origin: { latitude: baseline.origin.latitude, longitude: baseline.origin.longitude },
      width: 360,
      depth: 360,
      mercatorScale: 0.7901464545017922,
    },
    accessed: metadata.accessed,
    sourceUrl: metadata.sourceUrl,
  },
);
await mkdir(cache, { recursive: true });
await writeFile(new URL('baseline-before.json', cache), serializeWorld(baseline));
await writeFile(
  new URL('candidate-input.json', cache),
  JSON.stringify(
    {
      source: {
        ...metadata,
        normalizedSha256: createHash('sha256').update(sourceBytes).digest('hex'),
      },
      baseline: {
        name: baseline.name,
        bounds: baseline.bounds,
        objectCount: baseline.objects.length,
        objects: baseline.objects.map((o) => ({ ...o, worldFootprint: getFootprint(o) })),
      },
      candidates: converted.world.objects.map((o) => ({ ...o, worldFootprint: getFootprint(o) })),
      routeCandidates: minorRoutes.world.objects.map((o) => ({
        ...o,
        worldFootprint: getFootprint(o),
      })),
      diagnostics: converted.diagnostics,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `Prepared ${converted.world.objects.length} mapped building candidates against ${baseline.objects.length} preserved baseline objects.`,
);
if (process.argv.includes('--select')) {
  const result = spawnSync(
    process.env.WORDSCAPE_AUDIT_PYTHON ?? 'python',
    ['-B', 'scripts/select-washington-edges.py'],
    { cwd: fileURLToPath(root), stdio: 'inherit' },
  );
  if (result.error || result.status !== 0)
    throw result.error ?? new Error('Edge selection failed.');
}
if (process.argv.includes('--write')) {
  const audit = JSON.parse(await readFile(new URL('selection-audit.json', cache), 'utf8'));
  if (audit.source.normalizedSha256 !== createHash('sha256').update(sourceBytes).digest('hex'))
    throw new Error('Stale selection audit: source hash differs. Run --select first.');
  const addedSourceId = 'osm-washington-edges';
  const palette = ['#d4c7af', '#d8c7b7', '#cabfae', '#d7d2c7', '#c3c7bd'];
  const roofPalette = ['#837d75', '#8c8981', '#777d79'];
  const objects = [...audit.selected, ...audit.routes].map(
    ({ worldFootprint, ...record }, index) => {
      void worldFootprint;
      const object = structuredClone(record);
      object.sourceId = addedSourceId;
      object.grounding = 'terrain';
      if (object.kind === 'building') object.terrainAnchor = 'highest-footprint';
      object.tags = [...(object.tags ?? []), 'osm-edge-enrichment'];
      object.facts = object.facts.map((f) => ({
        ...f,
        ...(f.sourceIds
          ? { sourceIds: f.sourceIds.map((id) => (id === 'osm-extract' ? addedSourceId : id)) }
          : {}),
      }));
      object.references = object.references?.map((r) => ({ ...r, sourceId: addedSourceId }));
      const tags = JSON.parse(object.facts.find((f) => f.key === 'osm.tags').value);
      if (object.kind === 'building') {
        const address = tags['addr:housenumber']?.split(';').join('/');
        object.label =
          address && tags['addr:street']
            ? `${address} ${tags['addr:street']}`
            : tags['addr:street']
              ? `${tags['addr:street']} building`
              : `Edge building ${index + 1}`;
        object.description =
          'Individual mapped OSM building footprint added at the specimen edge after comparison with retained NAIP/NOAA imagery. Existing hand-traced frontages are preserved. Mapped height tags remain source claims; missing heights and flat roof forms are explicit estimates. Facade and roof colors are authored display choices, not observed finishes.';
        object.facts.push(
          {
            key: 'building.material',
            value: null,
            evidence: 'unknown',
            note: 'No usable mapped material tag in the retained extract; facade material is not inferred from roof imagery.',
          },
          {
            key: 'building.color',
            value: palette[index % palette.length],
            evidence: 'authored',
            note: 'Subdued display palette chosen to distinguish adjacent masses; not the observed facade color.',
          },
          {
            key: 'building.roofColor',
            value: roofPalette[index % roofPalette.length],
            evidence: 'authored',
            note: 'Authored display tone; no roof-color tag is supplied by this source.',
          },
          {
            key: 'placement.foundation',
            value: 'Highest sampled terrain beneath footprint',
            evidence: 'inferred',
            sourceIds: ['usgs-dem-2023'],
            note: 'Modeled level foundation on the existing DEM; not a measured floor elevation.',
          },
        );
      } else {
        object.description =
          'Mapped Via Ferlinghetti centerline, retained as a complete bounded way after checking its inferred corridor against existing and mapped building footprints. Shared node identities preserve the recorded connection. This does not establish access, current road width or accessibility.';
      }
      return object;
    },
  );
  const relations = [];
  const paths = objects.filter((o) => o.kind === 'road' || o.kind === 'pavement');
  for (let i = 0; i < paths.length; i++)
    for (let j = i + 1; j < paths.length; j++) {
      const nodeIds = (o) =>
        o.facts.filter((f) => ['osm.fromNode', 'osm.toNode'].includes(f.key)).map((f) => f.value);
      const shared = nodeIds(paths[i]).find((id) => nodeIds(paths[j]).includes(id));
      if (shared !== undefined)
        relations.push({
          from: paths[i].id,
          to: paths[j].id,
          type: 'connects',
          note: `Round 9 edge enrichment: shared mapped OSM node ${shared}; connectivity is not an access guarantee.`,
        });
    }
  const source = {
    id: addedSourceId,
    title: 'OpenStreetMap · Washington Square peripheral buildings and alley',
    url: metadata.sourceUrl,
    attribution: `${metadata.attribution} · Open Database License (ODbL) 1.0`,
    accessed: metadata.accessed,
    notes: `Reused the retained bounded extraction captured ${metadata.capturedAtUTC}; no new acquisition. Snapshot timestamp was not supplied. Normalized source SHA-256 ${audit.source.normalizedSha256}. Added 24 non-overlapping peripheral building footprints and two Via Ferlinghetti segments, compared with retained 2022 NOAA and 2024 NAIP imagery. Existing interpreted objects remain unchanged. Source heights, inferred dimensions and authored colors have independent evidence. See docs/SURVEY_AUDIT.md and /reference/washington-square-edge-audit.json. ODbL terms: ${metadata.licenseUrl}.`,
  };
  const combined = {
    ...baseline,
    sources: [...baseline.sources, source],
    objects: [...baseline.objects, ...objects],
    relations: [...baseline.relations, ...relations],
  };
  const validation = validateWorld(combined);
  if (validation.errors.length)
    throw new Error(`Enriched baseline is invalid: ${validation.errors.join(' ')}`);
  await writeFile(
    new URL('src/data/washingtonSquareEdges.json', root),
    JSON.stringify({ source, objects, relations }, null, 2) + '\n',
  );
  const publicAudit = {
    ...audit,
    baselineCanonicalSha256: createHash('sha256')
      .update(serializeWorld(baseline, false))
      .digest('hex'),
    selected: objects
      .filter((o) => o.kind === 'building')
      .map((o) => ({
        id: o.id,
        label: o.label,
        height: o.height,
        heightEvidence:
          o.facts.find((f) => f.key === 'building.reportedHeight')?.evidence ??
          o.facts.find((f) => f.key === 'building.height')?.evidence,
        footprintVertices: o.footprint.length,
      })),
    routes: paths.map((o) => ({ id: o.id, label: o.label })),
    afterObjects: baseline.objects.length + objects.length,
    addedRelations: relations.length,
    validation,
    imageCheck: {
      images: ['washington-square-noaa-2022.jpg', 'washington-square-naip.jpg'],
      method:
        'North-up overlay visually inspected against both retained official imagery crops; roof displacement/date differences remain. Colors are authored, not sampled from the photographs.',
    },
  };
  await writeFile(
    new URL('public/reference/washington-square-edge-audit.json', root),
    JSON.stringify(publicAudit, null, 2) + '\n',
  );
  await copyFile(
    new URL('candidate-overlay.png', cache),
    new URL('public/reference/washington-square-edge-overlay.png', root),
  );
  console.log(
    `Wrote ${objects.length} additional objects and ${relations.length} source-node connection; baseline integration is a separate explicit edit.`,
  );
}
