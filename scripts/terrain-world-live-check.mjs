import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  prepareWorldGeneration,
  buildWorldGenerationPrompt,
  worldGenerationSchema,
  reviewWorldGeneration,
} from '../src/world/worldGeneration.ts';
import { serializeWorld } from '../src/world/document.ts';

// Explicit developer integration check; uses only the selected existing Codex connection.
const scenario = process.argv[2] || 'create';
if (!['create', 'revise'].includes(scenario)) throw new Error('Use create or revise.');
const original =
  scenario === 'revise'
    ? JSON.parse(await readFile('public/examples/mossbell-retreat.wordscape.json', 'utf8'))
    : undefined;
const request = prepareWorldGeneration({
  provider: 'codex',
  mode: scenario,
  terrainMode: 'author',
  layout: 'open',
  referenceIds: [],
  ...(original ? { world: original } : { size: 180 }),
  prompt: original
    ? 'Change only the actual terrain of Mossbell Retreat. Raise a smooth wooded ridge toward the northwest, about 30 metres above the clearing. Keep the central path and huts on gentle ground. Preserve the existing pond water level and make its basin below that plane. Do not add any objects, cones or rock landmarks; do not change object descriptions, recipes, facts or plan placements. This is a terrain-only improvement. Describe the actual authored landform, not a surveyed mountain.'
    : 'Create Alderfold, a small imaginary hillside retreat on a 180 metre square. Generate actual terrain: a broad smooth ridge near the north edge, about 25 metres above a gentler southern clearing. Place five small huts and one simple pavilion on the gentler part, linked by a modest path with several bends. Add loose tree groups around the edges and a few useful benches. Use 20–26 total objects, varied hut orientations, simple rectangles or low-sided polygons, and no water. Keep all objects comfortably inside the scene with clear paths. Terrain is the landform; do not add cone or pyramid landmark mountains. Simple stock forms are sufficient, with at most one small pavilion recipe.',
});
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const record = {
  started: new Date().toISOString(),
  scenario,
  request,
  modelPrompt: buildWorldGenerationPrompt(request),
  outputSchema: worldGenerationSchema(request),
};
await mkdir('docs/history/world-09', { recursive: true });
try {
  const status = await (await fetch('http://127.0.0.1:8787/api/status')).json();
  if (!status.ai?.codex?.authenticated)
    throw new Error('Existing Wordscape ChatGPT connection is not authenticated.');
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
  if (!review.terrainChanged || review.world.terrain?.evidence !== 'authored')
    throw new Error('Expected actual authored terrain.');
  if (original) {
    for (const before of original.objects) {
      const after = review.world.objects.find((o) => o.id === before.id);
      for (const key of [
        'x',
        'y',
        'width',
        'depth',
        'height',
        'rotation',
        'facts',
        'description',
        'geometry',
      ]) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after?.[key]))
          throw new Error(`Unexpected revision change: ${before.id}.${key}`);
      }
    }
  }
  const serialized = serializeWorld(review.world);
  const file = `public/examples/${scenario === 'create' ? 'alderfold-terrain' : 'mossbell-terrain'}.wordscape.json`;
  await writeFile(file, serialized);
  const heights = review.world.terrain.heights.filter((v) => v !== null);
  record.output = {
    file,
    objects: review.world.objects.length,
    terrainChanged: review.terrainChanged,
    regrounded: review.regroundedIds.length,
    terrain: {
      rows: review.world.terrain.rows,
      columns: review.world.terrain.columns,
      min: Math.min(...heights),
      max: Math.max(...heights),
    },
    warnings: review.warnings,
    sha256: createHash('sha256').update(serialized).digest('hex'),
  };
  record.success = true;
} catch (error) {
  record.success = false;
  record.error = error.message;
  process.exitCode = 1;
} finally {
  record.finished = new Date().toISOString();
  const file = `docs/history/world-09/${scenario}-${stamp}.json`;
  await writeFile(file, JSON.stringify(record, null, 2));
  console.log(
    JSON.stringify(
      { file, success: record.success, error: record.error, output: record.output },
      null,
      2,
    ),
  );
}
