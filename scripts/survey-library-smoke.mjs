import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
/* global window, indexedDB */

// Node 24 strips TS; this hook resolves the application's extensionless TS imports.
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
const { convertOsmToWorld } = await import('../src/imports/osm.ts');
const { migrateWorld, validateWorld } = await import('../src/world/document.ts');
const fixture = JSON.parse(
  await readFile('public/reference/fishermans-wharf-osm-regression.json', 'utf8'),
);
const manifest = JSON.parse(
  await readFile('public/reference/fishermans-wharf-regression-manifest.json', 'utf8'),
);
const terrain = JSON.parse(
  await readFile('public/reference/fishermans-wharf-terrain-regression.json', 'utf8'),
);
const aerial = await readFile('public/reference/fishermans-wharf-naip-regression.jpg');
const sourceWithoutCoast = {
  ...fixture,
  elements: fixture.elements.filter((element) => element.tags?.natural !== 'coastline'),
};
const oldWorld = convertOsmToWorld(sourceWithoutCoast, {
  bounds: manifest.bounds,
  sourceUrl: manifest.sourceUrl,
  accessed: manifest.accessed,
  name: 'Wharf · retained browser regression',
}).world;
oldWorld.version = '0.4'; // Simulates a saved round-4 import, before coastline/terrain/aerial completion.
const editedId = 'osm-way-93422616';
const edited = oldWorld.objects.find((object) => object.id === editedId);
Object.assign(edited, {
  label: 'Edited Anchorage Square',
  description: 'Authored edit retained through survey completion.',
  x: edited.x + 1.25,
  height: edited.height + 2,
  elevation: 1.75,
  grounding: 'absolute',
  evidence: 'authored',
});
assert.equal(oldWorld.objects.length, 387);
assert.deepEqual(validateWorld(oldWorld).errors, []);

const baseUrl = process.env.WORDSCAPE_TEST_URL ?? 'http://127.0.0.1:5173';
const origin = new URL(baseUrl).origin;
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER ?? 'chrome',
  headless: true,
});
await mkdir('test-results', { recursive: true });
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const requestCounts = { maps: 0, terrain: 0, denied: 0 };
const errors = [];
let page;

async function prepare(context, blockedStorage = false) {
  await context.addInitScript(
    ({ world, blocked }) => {
      if (!localStorage.getItem('wordscape.world.v1'))
        localStorage.setItem('wordscape.world.v1', JSON.stringify(world));
      window.__surveyUnhandled = [];
      window.addEventListener('unhandledrejection', (event) =>
        window.__surveyUnhandled.push(String(event.reason)),
      );
      if (blocked)
        Object.defineProperty(window, 'indexedDB', {
          value: {
            open() {
              throw new DOMException(
                'Survey storage blocked for regression test.',
                'SecurityError',
              );
            },
          },
        });
    },
    { world: oldWorld, blocked: blockedStorage },
  );
  await context.route('**/*', async (route) => {
    const request = route.request(),
      target = new URL(request.url());
    if (target.pathname === '/api/status')
      return route.fulfill({
        json: {
          token: 'survey-test-token',
          ai: {
            codex: { available: false, authenticated: false, models: [], isolated: true },
            api: { configured: false, defaultModel: 'unused' },
            busy: false,
          },
          maps: {
            provider: 'retained-test-fixture',
            tileUrl: `${origin}/test-map-tile/{z}/{x}/{y}.png`,
          },
          terrain: { available: true },
        },
      });
    if (['/api/maps/extract', '/api/terrain/extract'].includes(target.pathname)) {
      assert.equal(request.headers()['x-wordscape-token'], 'survey-test-token');
      const bounds = request.postDataJSON().bounds;
      for (const key of ['west', 'south', 'east', 'north'])
        assert.ok(
          Math.abs(bounds[key] - manifest.bounds[key]) < 1e-8,
          `original ${key} frame retained`,
        );
      if (target.pathname === '/api/maps/extract') {
        requestCounts.maps++;
        return route.fulfill({
          json: {
            format: 'overpass',
            data: fixture,
            sourceUrl: manifest.sourceUrl,
            bounds: manifest.bounds,
            accessed: manifest.accessed,
            cached: true,
            warnings: [],
          },
        });
      }
      requestCounts.terrain++;
      return route.fulfill({ json: terrain });
    }
    if (target.pathname.startsWith('/api/')) {
      requestCounts.denied++;
      return route.fulfill({
        status: 403,
        json: { error: 'No live provider requests are permitted by this regression.' },
      });
    }
    if (target.pathname.startsWith('/test-map-tile/'))
      return route.fulfill({ contentType: 'image/png', body: pixel });
    if (target.origin !== origin) {
      if (target.hostname === 'apps.geo.fpac.usda.gov')
        return route.fulfill({ contentType: 'image/jpeg', body: aerial });
      return route.fulfill({ contentType: 'image/png', body: pixel });
    }
    return route.continue();
  });
  const tab = await context.newPage();
  tab.on('pageerror', (error) => errors.push(error.message));
  return tab;
}
const active = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
const library = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('wordscape-surveys-v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            transaction = db.transaction(['entries', 'documents'], 'readonly');
          const entries = transaction.objectStore('entries').getAll(),
            documents = transaction.objectStore('documents').getAll();
          transaction.oncomplete = () => {
            db.close();
            resolve({ entries: entries.result, documents: documents.result });
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
  );
const row = (count) => page.locator('.saved-survey').filter({ hasText: `${count} objects` });
async function openLibrary() {
  await page.getByRole('button', { name: 'Saved worlds', exact: true }).click();
  await page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Saved worlds', exact: true }) })
    .waitFor();
}
async function verifyStore(count) {
  await expect.poll(async () => (await library()).entries.length).toBe(count);
  const stored = await library();
  assert.deepEqual(
    stored.entries.map((entry) => entry.id).sort(),
    stored.documents.map((document) => document.id).sort(),
    'metadata and document stores remain atomic',
  );
  for (const entry of stored.entries) {
    const text = stored.documents.find((document) => document.id === entry.id).document;
    assert.equal(Buffer.byteLength(text), entry.bytes);
    assert.equal(JSON.parse(text).objects.length, entry.objectCount);
  }
  return stored;
}

try {
  const context = await browser.newContext({ viewport: { width: 1560, height: 1000 } });
  page = await prepare(context);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Complete survey', exact: true }).waitFor();
  const original = await active();
  assert.deepEqual(original, migrateWorld(oldWorld));
  await verifyStore(1);
  await page.getByRole('button', { name: 'Complete survey', exact: true }).click();
  await page.getByRole('button', { name: 'Preview survey completion', exact: true }).click();
  await page
    .getByRole('button', { name: 'Apply survey completion', exact: true })
    .waitFor({ timeout: 45000 });
  assert.match(
    await page.locator('.studio-summary').innerText(),
    /Preserves 387 existing placements and adds 3 mapped water surfaces/,
  );
  assert.deepEqual(await active(), original, 'preview leaves the stored active world unchanged');
  await page.getByRole('button', { name: 'Apply survey completion', exact: true }).click();
  await expect.poll(async () => (await active()).objects.length).toBe(390);
  const completed = await active();
  assert.deepEqual(
    completed.objects.find((object) => object.id === editedId),
    original.objects.find((object) => object.id === editedId),
    'authored placement survives completion exactly',
  );
  assert.ok(
    original.objects.every((before) => completed.objects.some((after) => after.id === before.id)),
  );
  assert.deepEqual(completed.terrain, terrain.terrain);
  assert.equal(completed.aerial.type, 'online-imagery');
  for (const key of ['west', 'south', 'east', 'north'])
    assert.ok(Math.abs(completed.aerial.bounds[key] - manifest.bounds[key]) < 1e-8);
  assert.ok(completed.sources.some((source) => source.id === completed.aerial.sourceId));
  assert.ok(completed.sources.some((source) => source.id === completed.terrain.sourceId));
  const water = completed.objects.filter((object) => object.kind === 'water');
  assert.equal(water.length, 3);
  assert.ok(
    water.every(
      (object) =>
        object.grounding === 'absolute' && object.elevation === -terrain.terrain.referenceElevation,
    ),
  );
  await verifyStore(2);
  await page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name: 'Aerial', exact: true })
    .click();
  await page.getByLabel('Georeferenced aerial imagery and recorded object footprints').waitFor();
  await page
    .locator(
      '.geo-aerial-map img.leaflet-image-layer, .geo-aerial-map img.leaflet-tile-loaded, .leaflet-image-layer',
    )
    .first()
    .waitFor({ timeout: 15000 });
  // Raster requests are mocked: this checks layout/reference attachment, not live imagery quality.
  await page.screenshot({
    path: 'test-results/survey-completed-wharf-aerial-layout.png',
    fullPage: true,
  });
  await page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name: '3D world', exact: true })
    .click();
  await page.locator('.canvas-stage.mode-3d canvas').waitFor();
  await page.screenshot({ path: 'test-results/survey-completed-wharf-3d.png', fullPage: true });

  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await active(), completed);
  await openLibrary();
  await row(387).getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await active()).objects.length).toBe(387);
  assert.deepEqual(await active(), original, 'the original saved survey reopens after reload');
  await page.reload({ waitUntil: 'networkidle' });
  await openLibrary();
  await row(390).getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await active()).objects.length).toBe(390);
  assert.deepEqual(
    await active(),
    completed,
    'completed source metadata/grid survives archive and reopening',
  );
  await openLibrary();
  const beforeSave = await verifyStore(2);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Save current copy', exact: true }).click();
    await expect(page.locator('.library-notice')).toContainText(
      'Identical copies are kept only once',
    );
  }
  assert.deepEqual(
    (await verifyStore(2)).entries,
    beforeSave.entries,
    'identical saves preserve snapshot IDs and timestamps',
  );
  const download = page.waitForEvent('download');
  await row(390)
    .getByRole('button', { name: /^Export / })
    .click();
  await (await download).saveAs('test-results/library-completed-wharf.json');
  assert.deepEqual(
    JSON.parse(await readFile('test-results/library-completed-wharf.json', 'utf8')),
    completed,
  );
  await page.screenshot({ path: 'test-results/survey-library-round5.png', fullPage: true });
  await row(390)
    .getByRole('button', { name: /^Remove / })
    .click();
  await row(390).getByRole('button', { name: 'Remove copy', exact: true }).click();
  await verifyStore(1);
  assert.deepEqual(
    await active(),
    completed,
    'removing an archived copy does not delete the active world',
  );
  await page.reload({ waitUntil: 'networkidle' });
  await verifyStore(1);
  assert.deepEqual(
    await active(),
    completed,
    'reloading does not restore a deliberately removed snapshot',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await openLibrary();
  assert.ok(
    await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth + 1),
    'mobile library has no page overflow',
  );
  const mobileDialog = await page.getByRole('dialog').boundingBox();
  assert.ok(
    mobileDialog.x >= 0 && mobileDialog.x + mobileDialog.width <= 391,
    'saved surveys fit within 390px',
  );
  await page.screenshot({ path: 'test-results/survey-library-mobile-round5.png', fullPage: true });
  assert.deepEqual(await page.evaluate(() => window.__surveyUnhandled), []);
  await context.close();

  const blocked = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await prepare(blocked, true);
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await openLibrary();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Survey storage blocked');
  await page.getByRole('button', { name: 'Save current copy', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Survey storage blocked');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit mode', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit mode', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name: 'Document', exact: true })
    .click();
  const editable = await active();
  editable.name = 'Wharf editing with unavailable library';
  await page.getByRole('textbox', { name: 'World JSON document' }).fill(JSON.stringify(editable));
  await page.getByRole('button', { name: 'Apply document', exact: true }).click();
  await expect.poll(async () => (await active()).name).toBe(editable.name);
  assert.deepEqual(await page.evaluate(() => window.__surveyUnhandled), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(requestCounts, { maps: 1, terrain: 1, denied: 0 });
  console.log(
    'Survey library regression passed: real Wharf completion, authored preservation, archive/reload/reopen, deduplication, export, safe removal, and unavailable IndexedDB. No live provider requests.',
  );
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: 'test-results/survey-library-failure.png', fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
