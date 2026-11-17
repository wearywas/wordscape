import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  prepareWorldGeneration,
  buildWorldGenerationPrompt,
  worldGenerationSchema,
  reviewWorldGeneration,
} from '../src/world/worldGeneration.ts';
import { serializeWorld } from '../src/world/document.ts';
import { describeWorldLayout as describeLayout } from '../src/world/layoutReview.ts';

// Explicit developer integration check: selected existing ChatGPT connection only.
// Requests and responses are evidence; no token/account identity is written.
const scenario = process.argv[2] || 'canal';
const briefs = {
  canal: {
    layout: 'clustered',
    size: 180,
    prompt:
      'Create Lanternwater Lanes, a fictional storybook canal village on a flat 180 metre square. Retain the idea of a copper-domed archive, workshops, cottages, market courts, orchard planting and a canal, but make a denser settlement that feels grown over time. Use 45–60 objects, including about 24–30 varied buildings arranged into three close clusters along a gently bending market lane and a short waterfront spine. Aim for about 25–35% summed building footprint coverage, with varied narrow gaps and occasional shared walls, while keeping useful routes clear. Include two small uneven gathering courts rather than a giant central square. Orient buildings to their nearby route and cluster; avoid identical rows, equal setbacks and right-angle symmetry. Let the canal or shore have a simple bent polygon outline. Place only a few useful trees and fixtures in leftover pockets. Keep all footprints inside the scene and avoid solid overlaps. Use original bounded geometry for the copper-domed archive and one workshop, with other roofs interpreted from authored facts. Reference real layout relationships creatively; this is fiction, not a copy of a real town.',
  },
  woodland: {
    layout: 'open',
    size: 180,
    prompt:
      'Create Mossbell Retreat, an imaginary woodland clearing on a flat 180 metre square. This should feel open and rural, not urban: only five small huts, a shared pavilion, a narrow meandering footpath, a small irregular pond, and groups of trees of varied size concentrated at the edges and in a few loose groves. Use 24–32 total objects. Keep a generous irregular central clearing and three small hut groups following the path, with orientations reflecting the local bend. Avoid grids, evenly spaced trees, giant straight boulevards and urban density. Keep dry buildings and tree trunks clear of water and routes. Simple authored geometry is sufficient; a memorable little pavilion may use a few normalized parts. All geometry and claims are invented.',
  },
};
briefs['canal-refined'] = briefs.canal;
if (!briefs[scenario]) throw new Error('Use canal, canal-refined or woodland.');
const request = prepareWorldGeneration({ provider: 'codex', mode: 'create', ...briefs[scenario] });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const record = {
  scenario,
  started: new Date().toISOString(),
  request,
  modelPrompt: buildWorldGenerationPrompt(request),
  outputSchema: worldGenerationSchema(request),
};
const directory = 'docs/history/world-08';
await mkdir(directory, { recursive: true });
try {
  const status = await (await fetch('http://127.0.0.1:8787/api/status')).json();
  if (!status.ai?.codex?.authenticated)
    throw new Error('Wordscape ChatGPT connection is not authenticated.');
  const response = await fetch('http://127.0.0.1:8787/api/ai/world', {
    method: 'POST',
    headers: {
      Origin: 'http://127.0.0.1:5173',
      'Content-Type': 'application/json',
      'X-Wordscape-Token': status.token,
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(390000),
  });
  record.status = response.status;
  record.result = await response.json();
  if (!response.ok) throw new Error(record.result.error || `HTTP ${response.status}`);
  const review = reviewWorldGeneration(request, record.result);
  const serialized = serializeWorld(review.world);
  const outputName =
    scenario === 'canal-refined'
      ? 'lanternwater-lanes-refined'
      : scenario === 'canal'
        ? 'lanternwater-lanes'
        : 'mossbell-retreat';
  const file = `public/examples/${outputName}.wordscape.json`;
  await writeFile(file, serialized);
  record.output = {
    file,
    objects: review.world.objects.length,
    recipes: review.world.objects.filter((o) => o.geometry).length,
    polygonFootprints: review.world.objects.filter((o) => o.footprint).length,
    references: record.result.referenceIds,
    warnings: review.warnings,
    layout: describeLayout(review.world),
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
  if (scenario.startsWith('canal'))
    record.comparisonBaseline = describeLayout(
      JSON.parse(await readFile('public/examples/lanternwater.wordscape.json', 'utf8')),
    );
  record.success = true;
} catch (error) {
  record.success = false;
  record.error = error.message;
  process.exitCode = 1;
} finally {
  record.finished = new Date().toISOString();
  const path = `${directory}/${scenario}-${stamp}.json`;
  await writeFile(path, JSON.stringify(record, null, 2));
  console.log(
    JSON.stringify(
      { path, success: record.success, error: record.error, output: record.output },
      null,
      2,
    ),
  );
}
