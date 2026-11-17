import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  reviewWorldGeneration,
  buildWorldGenerationPrompt,
  worldGenerationSchema,
} from '../src/world/worldGeneration.ts';
import { serializeWorld } from '../src/world/document.ts';

// Explicit manual developer check: uses the selected subscription, never API fallback.
// Retains the request, response and outcome; never writes the local session token.
const mode = process.argv[2] || 'create';
if (!['create', 'revise'].includes(mode)) throw new Error('Use create or revise.');
const prompt =
  mode === 'create'
    ? 'Create Lanternwater: a fictional storybook canal village, on a flat 180 metre square. Plan a clear connected pedestrian layout first, with a market square, a narrow aquamarine canal along the eastern side, two small jetties, six to eight varied cottages and workshops, a copper-domed archive tower, an orchard and public benches. Use 26–36 named objects total, distinct ground/surface top heights so paths remain visible, sensible human scale, dry building foundations and generous walkable clearances. Give at least three important buildings original geometry recipes using a few colored primitive parts, including the archive dome. Fit all rotated footprints inside the square. No surveyed facts or real geographic location. Aim for a legible, charming miniature world rather than uniform blocks.'
    : 'Improve Lanternwater with more distinctive 3D forms: enrich the archive tower and two cottages using colored editable primitive parts, while preserving every existing placement and fact. Add two or three small lamps or flower planters at sensible public-space edges, keeping routes clear. Keep the village identity and all current geometry unless deliberately improving that object. Make only 3 appearance changes and 2–3 additions.';
const request =
  mode === 'create'
    ? { provider: 'codex', mode, size: 180, prompt }
    : {
        provider: 'codex',
        mode,
        prompt,
        world: JSON.parse(await readFile('public/examples/lanternwater.wordscape.json', 'utf8')),
      };
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const record = {
  mode,
  started: new Date().toISOString(),
  request,
  modelPrompt: buildWorldGenerationPrompt(request),
  outputSchema: worldGenerationSchema(request),
};
await mkdir('docs/history/world-07', { recursive: true });
const recordPath = `docs/history/world-07/${mode}-${stamp}.json`;
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
  const serialized = serializeWorld(review.world);
  const file = `public/examples/lanternwater${mode === 'revise' ? '-refined' : ''}.wordscape.json`;
  await mkdir('public/examples', { recursive: true });
  await writeFile(file, serialized);
  record.output = {
    file,
    objects: review.world.objects.length,
    relations: review.world.relations.length,
    recipes: review.world.objects.filter((o) => o.geometry).length,
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
  await writeFile(recordPath, JSON.stringify(record, null, 2));
  console.log(
    JSON.stringify(
      { recordPath, success: record.success, error: record.error, output: record.output },
      null,
      2,
    ),
  );
}
