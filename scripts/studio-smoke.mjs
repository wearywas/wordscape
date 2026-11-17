import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createGeometryTemplate } from '../src/world/geometryTemplates.ts';

// Deterministic UI integration: retained real map fixture + an explicitly mocked AI provider.
// This test performs no model inference, sign-in, or new map extraction.
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER ?? 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('test-results', { recursive: true });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
let requestCount = 0;
await page.route('**/api/status', (route) =>
  route.fulfill({
    json: {
      token: 'ui-test-token',
      ai: {
        codex: { available: true, authenticated: true, models: [], isolated: true },
        api: { configured: false, defaultModel: 'mock' },
        busy: false,
      },
      maps: { provider: 'test', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    },
  }),
);
await page.route('**/api/ai/generate', async (route) => {
  requestCount++;
  const body = route.request().postDataJSON();
  assert.equal(body.provider, 'codex');
  assert.equal(body.context.objects.length, 1);
  await route.fulfill({
    json: {
      provider: 'codex',
      model: 'mock-ui-test',
      proposal: {
        summary: 'Mocked test proposal, not a live model response.',
        changes: [
          {
            objectId: body.context.objects[0].id,
            description: 'Mocked pavilion interpretation.',
            geometry: createGeometryTemplate('pavilion').geometry,
          },
        ],
      },
    },
  });
});
try {
  await page.goto(process.env.WORDSCAPE_TEST_URL ?? 'http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Create a place' }).waitFor();
  const initial = await saved();
  await page.getByRole('button', { name: 'Create a place' }).click();
  await page.getByRole('button', { name: 'Try Washington Square example' }).click();
  await page.getByRole('button', { name: 'Open this world' }).waitFor({ timeout: 20000 });
  await page.locator('.studio-scene canvas').waitFor();
  assert.deepEqual(await saved(), initial, 'preview must not mutate the open world');
  assert.match(await page.locator('.studio-summary').innerText(), /mapped placements/);
  await page.screenshot({ path: 'test-results/studio-import-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Open this world' }).click();
  const imported = await saved();
  assert.ok(imported.objects.length > 700 && imported.objects.length <= 1000);
  assert.ok(
    imported.objects.some((object) => object.facts?.some((fact) => fact.key === 'osm.element')),
  );
  assert.deepEqual(imported.terrain, initial.terrain);
  assert.equal(
    await page.getByRole('button', { name: 'Edit mode', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  await page.getByRole('button', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await saved(), initial);
  await page.getByRole('button', { name: 'Create a place' }).click();
  await page.getByRole('tab', { name: 'Model builder' }).click();
  await page.getByRole('button', { name: 'pavilion', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to current world' }).waitFor();
  await page.getByRole('button', { name: 'pavilion', exact: true }).focus();
  await page.keyboard.press('Control+z');
  assert.deepEqual(await saved(), initial, 'modal must block behind-dialog undo');
  await page.getByRole('button', { name: 'Generate proposal' }).click();
  await page.getByRole('button', { name: 'Apply to current world' }).waitFor();
  await page.locator('.studio-scene canvas').waitFor();
  assert.equal(requestCount, 1);
  assert.deepEqual(await saved(), initial);
  await page.screenshot({ path: 'test-results/studio-model-mock-preview.png', fullPage: true });
  await page.getByRole('button', { name: 'Apply to current world' }).click();
  const modeled = await saved();
  assert.equal(modeled.objects.length, initial.objects.length + 1);
  assert.deepEqual(modeled.objects.slice(0, -1), initial.objects);
  assert.equal(modeled.objects.at(-1).geometry.evidence, 'authored');
  assert.ok(
    modeled.objects
      .at(-1)
      .facts.some((fact) => fact.key === 'generation.model' && fact.value === 'mock-ui-test'),
  );
  await page.getByRole('button', { name: 'Edit mode', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.deepEqual(await saved(), initial);
  await page.getByRole('button', { name: 'Create a place' }).click();
  await page.getByRole('tab', { name: 'Model builder' }).click();
  assert.equal(
    await page.getByRole('button', { name: 'Generate proposal' }).isDisabled(),
    false,
    'undoing a newly created selection should leave a usable new-object draft',
  );
  await page.getByRole('tab', { name: 'A mapped area' }).click();
  await page.getByRole('button', { name: 'Try Washington Square example' }).click();
  await page.getByRole('button', { name: 'Open this world' }).waitFor();
  await page.getByLabel('Survey width').selectOption('200');
  assert.equal(
    await page.getByRole('button', { name: 'Open this world' }).count(),
    0,
    'moving the area must invalidate its preview',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  );
  assert.ok(
    await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
  );
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Studio browser checks passed: real retained OSM preview/apply/undo, terrain/source retention, mocked model preview/apply/undo, modal keyboard isolation, stale area invalidation, mobile layout. No live model calls.',
  );
} finally {
  await browser.close();
}
