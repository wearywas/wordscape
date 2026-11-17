import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
/* global window, indexedDB */

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
const { attachTerrain } = await import('../src/imports/terrain.ts');
const { attachAerialReference } = await import('../src/world/aerial.ts');
const { adjacentBounds } = await import('../src/world/atlas.ts');
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

let original = convertOsmToWorld(fixture, {
  bounds: manifest.bounds,
  sourceUrl: manifest.sourceUrl,
  accessed: manifest.accessed,
  name: 'Wharf · real source fixture',
}).world;
original = attachAerialReference(
  attachTerrain(original, terrain, { groundObjects: true }),
  manifest.bounds,
  manifest.accessed,
);
const editedId = 'osm-way-93422616';
const authored = original.objects.find((object) => object.id === editedId);
Object.assign(authored, {
  label: 'Authored Anchorage Square',
  description: 'Regression edit: retain this placement and height through composition.',
  x: authored.x + 1.25,
  height: authored.height + 2,
  evidence: 'authored',
  grounding: 'absolute',
  elevation: 1.75,
});
delete authored.terrainAnchor;
original = JSON.parse(JSON.stringify(migrateWorld(original)));
assert.equal(original.objects.length, 390);
assert.deepEqual(validateWorld(original).errors, []);

// Only the first tile is actual geographic evidence. The neighboring response is a
// deliberately translated fixture for UI/frame testing, never a survey of that area.
const eastBounds = adjacentBounds(manifest.bounds, 'east');
const deltaLongitude = eastBounds.west - manifest.bounds.west;
function translateFixture(value) {
  if (Array.isArray(value)) return value.map(translateFixture);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      ['lon', 'minlon', 'maxlon'].includes(key) && typeof item === 'number'
        ? item + deltaLongitude
        : translateFixture(item),
    ]),
  );
}
const syntheticMap = translateFixture(fixture);
const syntheticTerrain = structuredClone(terrain);
syntheticTerrain.bounds = eastBounds;
syntheticTerrain.frame = geographicFrame(eastBounds);
syntheticTerrain.source = {
  ...syntheticTerrain.source,
  id: 'synthetic-east-terrain',
  title: 'Synthetic translated terrain — browser regression only',
  url: 'https://example.invalid/wordscape/synthetic-east-terrain',
  notes:
    'Copied retained Wharf heights into an adjacent test frame. Not real elevation evidence for the neighboring area.',
};
syntheticTerrain.terrain.sourceId = syntheticTerrain.source.id;
syntheticTerrain.terrain.notes = syntheticTerrain.source.notes;
const neighborName = 'Synthetic east tile';
const overlapName = 'Wharf · overlapping copy';
const atlasName = 'Regression atlas · one real and one synthetic tile';
const baseUrl = process.env.WORDSCAPE_TEST_URL ?? 'http://127.0.0.1:5173';
const origin = new URL(baseUrl).origin;
const counts = { maps: 0, terrain: 0, denied: 0 };
const errors = [];
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER ?? 'chrome',
  headless: true,
});
await mkdir('test-results', { recursive: true });
let page;

const active = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
const library = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('wordscape-surveys-v1');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['entries', 'documents'], 'readonly');
          const entries = transaction.objectStore('entries').getAll();
          const documents = transaction.objectStore('documents').getAll();
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
const savedRow = (name) =>
  page.locator('.saved-survey').filter({ has: page.getByRole('heading', { name, exact: true }) });
async function openLibrary() {
  await page.getByRole('button', { name: 'Saved worlds', exact: true }).click();
  await page.getByRole('dialog', { name: 'Saved worlds', exact: true }).waitFor();
}
async function openAtlas() {
  await openLibrary();
  await page.getByRole('button', { name: 'Combine surveys', exact: true }).click();
  await page.getByRole('dialog', { name: 'Combine surveys', exact: true }).waitFor();
}
async function verifyStore(count) {
  await expect.poll(async () => (await library()).entries.length).toBe(count);
  const store = await library();
  assert.deepEqual(
    store.entries.map((entry) => entry.id).sort(),
    store.documents.map((item) => item.id).sort(),
  );
  for (const entry of store.entries) {
    const document = store.documents.find((item) => item.id === entry.id).document;
    assert.equal(Buffer.byteLength(document), entry.bytes);
    assert.equal(JSON.parse(document).objects.length, entry.objectCount);
  }
  return store;
}
async function chooseView(name) {
  await page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name, exact: true })
    .click();
}

try {
  const context = await browser.newContext({ viewport: { width: 1560, height: 1000 } });
  await context.addInitScript((world) => {
    if (!localStorage.getItem('wordscape.world.v1'))
      localStorage.setItem('wordscape.world.v1', JSON.stringify(world));
    window.__atlasUnhandled = [];
    window.addEventListener('unhandledrejection', (event) =>
      window.__atlasUnhandled.push(String(event.reason)),
    );
  }, original);
  await context.route('**/*', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.pathname === '/api/status')
      return route.fulfill({
        json: {
          token: 'atlas-test-token',
          ai: {
            codex: { available: false, authenticated: false, models: [], isolated: true },
            api: { configured: false, defaultModel: 'unused' },
            busy: false,
          },
          maps: {
            provider: 'synthetic-regression-fixture',
            tileUrl: `${origin}/test-map-tile/{z}/{x}/{y}.png`,
          },
          terrain: { available: true },
        },
      });
    if (['/api/maps/extract', '/api/terrain/extract'].includes(target.pathname)) {
      assert.equal(request.headers()['x-wordscape-token'], 'atlas-test-token');
      const requested = request.postDataJSON().bounds;
      for (const key of ['west', 'south', 'east', 'north'])
        assert.ok(Math.abs(requested[key] - eastBounds[key]) < 1e-10, `exact adjacent ${key}`);
      assert.equal(
        requested.west,
        original.aerial.bounds.east,
        'neighbor shares the exact geographic edge',
      );
      if (target.pathname === '/api/maps/extract') {
        counts.maps++;
        return route.fulfill({
          json: {
            format: 'overpass',
            data: syntheticMap,
            sourceUrl: 'https://example.invalid/wordscape/synthetic-east-map',
            bounds: eastBounds,
            accessed: manifest.accessed,
            cached: true,
            warnings: [
              'Synthetic translated fixture for browser testing; not a real survey of this neighbor.',
            ],
          },
        });
      }
      counts.terrain++;
      return route.fulfill({ json: syntheticTerrain });
    }
    if (target.pathname.startsWith('/api/')) {
      counts.denied++;
      return route.fulfill({
        status: 403,
        json: { error: 'No live provider calls in atlas regression.' },
      });
    }
    if (target.origin !== origin || target.pathname.startsWith('/test-map-tile/'))
      return route.fulfill({ contentType: 'image/png', body: pixel });
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await verifyStore(1);
  assert.deepEqual(await active(), original);

  // Create a distinct overlapping saved snapshot through the editor, then restore
  // the first immutable snapshot before extending it.
  const overlap = { ...original, name: overlapName };
  await page.getByRole('button', { name: 'Edit mode', exact: true }).click();
  await chooseView('Document');
  await page.getByRole('textbox', { name: 'World JSON document' }).fill(JSON.stringify(overlap));
  await page.getByRole('button', { name: 'Apply document', exact: true }).click();
  await expect.poll(async () => (await active()).name).toBe(overlapName);
  await openLibrary();
  await page.getByRole('button', { name: 'Save current copy', exact: true }).click();
  await verifyStore(2);
  await savedRow(original.name).getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await active()).name).toBe(original.name);

  await page.getByRole('button', { name: 'Create a place', exact: true }).click();
  const directions = page.getByRole('group', { name: 'Adjacent survey direction' });
  await directions.getByRole('button', { name: 'North', exact: true }).click();
  await expect(page.getByText('Exact north neighbor of', { exact: false })).toBeVisible();
  await directions.getByRole('button', { name: 'East', exact: true }).click();
  await expect(page.getByText('Exact east neighbor of', { exact: false })).toBeVisible();
  await page.getByRole('textbox', { name: 'World name', exact: true }).fill(neighborName);
  await page.getByRole('button', { name: 'Fetch mapped area', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open this world', exact: true })
    .waitFor({ timeout: 45000 });
  assert.deepEqual(
    await active(),
    original,
    'adjacent preview does not replace the active document',
  );
  assert.match(await page.locator('.studio-summary').innerText(), /390 mapped placements/);
  await page.getByRole('button', { name: 'Open this world', exact: true }).click();
  await expect.poll(async () => (await active()).name).toBe(neighborName);
  const neighbor = await active();
  assert.deepEqual(validateWorld(neighbor).errors, []);
  assert.deepEqual(neighbor.aerial.bounds, eastBounds);
  assert.deepEqual(neighbor.terrain.heights, syntheticTerrain.terrain.heights);
  const beforeCombination = await verifyStore(3);

  // Overlap is an explicit error, never a silently doubled scene.
  await openAtlas();
  await page.getByRole('checkbox', { name: `Include ${original.name}`, exact: true }).check();
  await page.getByRole('checkbox', { name: `Include ${overlapName}`, exact: true }).check();
  await page.getByRole('button', { name: 'Preview combined world', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(/overlap/i);
  await expect(page.getByRole('button', { name: 'Open combined world', exact: true })).toHaveCount(
    0,
  );
  assert.deepEqual(await active(), neighbor);
  assert.deepEqual((await verifyStore(3)).documents, beforeCombination.documents);

  await page.getByRole('checkbox', { name: `Include ${overlapName}`, exact: true }).uncheck();
  await page.getByRole('checkbox', { name: `Include ${neighborName}`, exact: true }).check();
  await page.getByRole('textbox', { name: 'Combined world name', exact: true }).fill(atlasName);
  await page.getByRole('button', { name: 'Preview combined world', exact: true }).click();
  await page
    .getByRole('button', { name: 'Open combined world', exact: true })
    .waitFor({ timeout: 45000 });
  assert.deepEqual(
    await active(),
    neighbor,
    'composition preview leaves the active survey untouched',
  );
  assert.deepEqual((await verifyStore(3)).documents, beforeCombination.documents);
  await page.screenshot({ path: 'test-results/atlas-preview-round6.png', fullPage: true });
  await page.getByRole('button', { name: 'Open combined world', exact: true }).click();
  await expect.poll(async () => (await active()).name).toBe(atlasName);
  const atlas = await active();
  assert.equal(atlas.version, '0.8');
  assert.equal(atlas.composition.tiles.length, 2);
  assert.equal(atlas.bounds.width, 720);
  assert.equal(atlas.bounds.depth, 360);
  assert.equal(atlas.objects.length, original.objects.length + neighbor.objects.length);
  assert.equal(new Set(atlas.objects.map((object) => object.id)).size, atlas.objects.length);
  assert.equal(atlas.aerial.bounds.west, manifest.bounds.west);
  assert.equal(atlas.aerial.bounds.east, eastBounds.east);
  assert.deepEqual(validateWorld(atlas).errors, []);
  const preserved = atlas.objects.find((object) => object.label === authored.label);
  assert.equal(preserved.height, authored.height);
  assert.ok(Math.abs(preserved.x - authored.x) < 0.001);
  assert.ok(Math.abs(preserved.y - authored.y) < 0.001);
  assert.equal(
    preserved.elevation + atlas.terrain.referenceElevation,
    authored.elevation + original.terrain.referenceElevation,
  );
  assert.deepEqual(preserved.footprint, authored.footprint);
  const saved = await verifyStore(4);
  for (const before of beforeCombination.documents)
    assert.deepEqual(
      saved.documents.find((item) => item.id === before.id),
      before,
      'source snapshot is byte-for-byte unchanged',
    );
  await page.locator('.canvas-stage.mode-3d canvas').waitFor();
  await page.screenshot({ path: 'test-results/atlas-combined-round6.png', fullPage: true });

  await page.reload({ waitUntil: 'networkidle' });
  assert.deepEqual(await active(), atlas);
  await openLibrary();
  await savedRow(original.name).getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await active()).name).toBe(original.name);
  assert.deepEqual(await active(), original);
  await openLibrary();
  await savedRow(atlasName).getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(async () => (await active()).name).toBe(atlasName);
  assert.deepEqual(await active(), atlas);
  await verifyStore(4);
  await openLibrary();
  const download = page.waitForEvent('download');
  await savedRow(atlasName)
    .getByRole('button', { name: `Export ${atlasName}`, exact: true })
    .click();
  await (await download).saveAs('test-results/atlas-round6.wordscape.json');
  assert.deepEqual(
    JSON.parse(await readFile('test-results/atlas-round6.wordscape.json', 'utf8')),
    atlas,
  );
  await page.getByRole('button', { name: 'Combine surveys', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: `Include ${atlasName}`, exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth + 1),
    'mobile atlas has no page overflow',
  );
  const box = await page
    .getByRole('dialog', { name: 'Combine surveys', exact: true })
    .boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391, 'combine controls fit mobile width');
  await page.screenshot({ path: 'test-results/atlas-mobile-round6.png', fullPage: true });
  assert.deepEqual(await page.evaluate(() => window.__atlasUnhandled), []);
  assert.deepEqual(errors, []);
  assert.deepEqual(counts, { maps: 1, terrain: 1, denied: 0 });
  console.log(
    'Atlas regression passed: exact adjacent fetch, overlap rejection, preview isolation, 780-object composition, authored preservation, immutable source snapshots, reload/reopen/export, mobile fit. Second tile is synthetic; no live provider requests.',
  );
} catch (error) {
  if (page && !page.isClosed())
    await page
      .screenshot({ path: 'test-results/atlas-failure.png', fullPage: true })
      .catch(() => {});
  // Large world comparisons should not dump megabytes of fixture data on failure.
  console.error(error.stack?.slice(0, 3500) ?? String(error));
  if (errors.length) console.error('Browser errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
}
