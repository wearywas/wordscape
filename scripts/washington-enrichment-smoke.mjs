import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Isolated local browser; retained data only, without model or map acquisition calls.
const baseline = JSON.parse(await readFile('src/data/washingtonSquare.v0.4.json', 'utf8'));
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER || 'chrome',
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const acquired = [];
await page.route('**/api/{ai,maps,terrain}/**', (route) => {
  acquired.push(route.request().url());
  return route.abort();
});
const saved = () =>
  page.evaluate(() => JSON.parse(globalThis.localStorage.getItem('wordscape.world.v1')));
const show3d = async () => {
  await page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name: '3D world', exact: true })
    .click();
  await expect(page.locator('.world-scene canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  // Let the continuous WebGL loop render its settled, reset camera.
  await page.waitForTimeout(400);
};
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(process.env.WORDSCAPE_TEST_URL || 'http://127.0.0.1:5173', {
    waitUntil: 'networkidle',
  });
  await expect.poll(async () => (await saved())?.objects.length).toBe(165);
  const enriched = await saved();
  await page.getByLabel('Import world document', { exact: true }).setInputFiles({
    name: 'washington-square-before.wordscape.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(baseline)),
  });
  await expect.poll(async () => (await saved())?.objects.length).toBe(139);
  const before = await saved();
  await show3d();
  await page.screenshot({ path: 'test-results/round9-washington-before.png' });
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(async () => (await saved())?.objects.length).toBe(165);
  const after = await saved();
  assert.deepEqual(after, enriched, 'Untouched prior specimen reloads as the enriched baseline');
  assert.deepEqual(
    after.objects.slice(0, 139),
    before.objects,
    'All prior object content survives',
  );
  assert.deepEqual(after.terrain, before.terrain, 'Terrain values are unchanged');
  await show3d();
  await page.screenshot({ path: 'test-results/round9-washington-after.png' });
  await page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name: 'Aerial', exact: true })
    .click();
  await expect(page.getByRole('combobox', { name: 'Aerial reference', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/round9-washington-aerial.png' });

  const edited = structuredClone(baseline);
  edited.objects[0].description += ' Browser preservation check.';
  await page.getByLabel('Import world document', { exact: true }).setInputFiles({
    name: 'washington-square-edited.wordscape.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(edited)),
  });
  await expect.poll(async () => (await saved())?.objects.length).toBe(139);
  const editedSaved = await saved();
  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await saved(), editedSaved, 'An edited prior specimen is preserved on reload');
  assert.deepEqual(errors, []);
  assert.deepEqual(acquired, []);
  await writeFile(
    'test-results/round9-washington-browser.json',
    JSON.stringify(
      {
        beforeObjects: before.objects.length,
        afterObjects: after.objects.length,
        additions: after.objects.slice(139).map(({ id, kind, label }) => ({ id, kind, label })),
        priorObjectsPreserved: true,
        terrainPreserved: true,
        editedSavePreserved: true,
        pageErrors: errors,
        acquisitionRequests: acquired,
        screenshots: [
          'round9-washington-before.png',
          'round9-washington-after.png',
          'round9-washington-aerial.png',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'Washington enrichment browser check passed: pristine 139→165 upgrade, unchanged prior objects/terrain, edited document preserved, before/after 3D and aerial screenshots, no page errors or acquisition requests.',
  );
} finally {
  await browser.close();
}
