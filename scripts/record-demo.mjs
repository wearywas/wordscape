import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

// Reproducible, silent recording of the unchanged public UI and retained examples.
// Uses a fresh context, blocks provider endpoints, and never signs in or generates a world.
const baseURL = process.env.WORDSCAPE_TEST_URL || 'http://127.0.0.1:4173';
await mkdir('test-results/demo-recording', { recursive: true });
await mkdir('docs/media', { recursive: true });
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER || 'chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: 'test-results/demo-recording', size: { width: 1440, height: 900 } },
  acceptDownloads: true,
});
const page = await context.newPage();
const video = page.video();
const errors = [],
  phases = [];
const started = performance.now();
page.on('pageerror', (error) => errors.push(error.message));
await context.route('**/*', async (route) => {
  const requested = new URL(route.request().url());
  if (requested.origin !== new URL(baseURL).origin || requested.pathname.startsWith('/api/')) {
    errors.push(`Unexpected provider request: ${requested.origin}${requested.pathname}`);
    await route.abort();
    return;
  }
  await route.continue();
});
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
const phase = (label) =>
  phases.push({ seconds: Number(((performance.now() - started) / 1000).toFixed(1)), label });
const pause = (milliseconds) => page.waitForTimeout(milliseconds);
const nav = page.getByRole('navigation', { name: 'World view' });
const dismissNotice = async () => {
  const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
};
let completed = false;
try {
  await page.goto(baseURL, { waitUntil: 'networkidle' });
  await expect(page.locator('.word-map')).toBeVisible();
  const baseline = await saved();
  assert.equal(baseline.version, '0.8');
  assert.equal(baseline.objects.length, 165);
  phase('Washington Square: Words view of the portable record');
  await pause(2600);
  await page.screenshot({ path: 'docs/media/framework-words.png' });

  await page.locator('.object-row').filter({ hasText: 'Saints Peter and Paul' }).first().click();
  phase('Select a named placement and inspect its data');
  await pause(2400);
  await nav.getByRole('button', { name: '3D world', exact: true }).click();
  await expect(page.locator('.world-scene canvas')).toBeVisible();
  phase('Three.js interprets the same surveyed document');
  await pause(4200);
  assert.deepEqual(await saved(), baseline, 'Changing views must preserve the document');

  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Example worlds', exact: true })).toBeVisible();
  phase('Bundled examples require no model connection');
  await pause(2200);
  await page.getByRole('button', { name: 'Open Mossbell Retreat · terrain', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Mossbell Retreat', level: 1, exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await saved()).terrain?.evidence).toBe('authored');
  await pause(900);
  await dismissNotice();
  const authored = await saved();
  phase('Mossbell: actual authored height grid at true scale');
  await page.screenshot({ path: 'docs/media/authored-terrain.png' });
  await pause(4200);

  const terrainToggle = page.getByRole('button', { name: 'Show terrain', exact: true });
  await terrainToggle.click();
  await expect(terrainToggle).toHaveAttribute('aria-pressed', 'false');
  phase('Flat comparison changes the view only');
  await pause(2800);
  assert.deepEqual(await saved(), authored);
  await terrainToggle.click();
  await expect(terrainToggle).toHaveAttribute('aria-pressed', 'true');
  phase('Recorded terrain remains in the world');
  await pause(2400);

  await nav.getByRole('button', { name: 'Document', exact: true }).click();
  const editor = page.getByRole('textbox', { name: 'World JSON document', exact: true });
  await expect(editor).toBeVisible();
  assert.deepEqual(JSON.parse(await editor.inputValue()), authored);
  phase('The editable source is ordinary portable JSON');
  await editor.click({ position: { x: 200, y: 120 } });
  await page.mouse.wheel(0, 260);
  await pause(600);
  await page.screenshot({ path: 'docs/media/portable-json.png' });
  await pause(3500);

  await page.getByRole('button', { name: 'Export world', exact: true }).click();
  phase('Export the source document or this interpreter’s GLB');
  await pause(2100);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /World document Portable JSON/ }).click();
  await (await download).saveAs('test-results/demo-recording/mossbell-export.wordscape.json');
  assert.deepEqual(
    JSON.parse(
      await readFile('test-results/demo-recording/mossbell-export.wordscape.json', 'utf8'),
    ),
    authored,
  );
  await pause(2000);
  assert.deepEqual(errors, []);
  completed = true;
} finally {
  await context.close();
  if (completed) await video.saveAs('docs/media/wordscape-demo.webm');
  await browser.close();
}
const videoBytes = await readFile('docs/media/wordscape-demo.webm');
const manifest = {
  recordedAt: new Date().toISOString(),
  applicationVersion: '0.9',
  worldFormat: '0.8',
  recording: 'wordscape-demo.webm',
  bytes: (await stat('docs/media/wordscape-demo.webm')).size,
  sha256: createHash('sha256').update(videoBytes).digest('hex'),
  viewport: { width: 1440, height: 900 },
  audio: false,
  description:
    'Unedited recording of the production workbench in an isolated browser. Retained examples only; no model or geographic provider requests. View changes preserve the document; downloaded JSON matches the open record.',
  phases,
  examples: [
    'Washington Square (165 placements)',
    'Mossbell Retreat, authored terrain revision (29 placements)',
  ],
  attribution:
    'Washington Square incorporates © OpenStreetMap contributors (ODbL) and public-domain USGS terrain. Mossbell is authored fiction with separately attributed OSM-derived layout inspiration. See ../../NOTICE.md and source records in each world.',
};
await writeFile('docs/media/demo-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  JSON.stringify({
    recording: manifest.recording,
    bytes: manifest.bytes,
    phases: phases.length,
    errors: errors.length,
  }),
);
