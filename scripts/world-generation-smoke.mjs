import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';

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
const { createGeometryTemplate } = await import('../src/world/geometryTemplates.ts');
const { worldGenerationContext, LAYOUT_GUIDE_VERSION } =
  await import('../src/world/worldGeneration.ts');
const { selectLayoutReferences } = await import('../src/world/layoutReferences.ts');

function placement(id, kind, x, y, width, depth, height, extra = {}) {
  return {
    id,
    label: id.replaceAll('-', ' '),
    kind,
    description: 'Authored browser-test fixture, not a live model response.',
    x,
    y,
    width,
    depth,
    height,
    elevation: 0,
    rotation: 0,
    layer: 1,
    parentId: null,
    tags: ['imaginary'],
    facts: [],
    geometry: null,
    ...extra,
  };
}
function resultFor(request) {
  const context = worldGenerationContext(request);
  let additions, changes, relations;
  if (request.mode === 'create') {
    additions = [
      placement('common-green', 'grass', 90, 90, 70, 70, 0.1),
      placement('shared-square', 'pavement', 90, 90, 24, 24, 0.15, { layer: 2 }),
    ];
    for (const [id, x, y, w, d] of [
      ['south-street', 90, 18, 160, 7],
      ['north-street', 90, 162, 160, 7],
      ['west-street', 18, 90, 7, 150],
      ['east-street', 162, 90, 7, 150],
    ])
      additions.push(placement(id, 'road', x, y, w, d, 0.12));
    for (const [id, x, y, w, d] of [
      ['south-walk', 90, 50, 5, 60],
      ['north-walk', 90, 130, 5, 60],
      ['west-walk', 50, 90, 60, 5],
      ['east-walk', 130, 90, 60, 5],
    ])
      additions.push(placement(id, 'pavement', x, y, w, d, 0.15, { layer: 2 }));
    additions.push(
      placement('garden-pavilion', 'landmark', 90, 90, 14, 14, 8, {
        geometry: createGeometryTemplate('pavilion').geometry,
        layer: 3,
      }),
    );
    for (let i = 0; i < 8; i++)
      additions.push(
        placement(
          `courtyard-home-${i}`,
          'building',
          [40, 65, 115, 140][i % 4],
          i < 4 ? 40 : 140,
          17,
          20,
          10 + (i % 3) * 3,
          {
            ...(i === 0
              ? {
                  footprint: [
                    [-8.5, -10],
                    [8.5, -10],
                    [8.5, 2],
                    [0, 2],
                    [0, 10],
                    [-8.5, 10],
                  ],
                }
              : {}),
            facts: [
              { key: 'building.levels', value: 3, unit: null, note: 'Authored choice.' },
              {
                key: 'building.roofShape',
                value: i % 2 ? 'gabled' : 'flat',
                unit: null,
                note: 'Authored choice.',
              },
            ],
          },
        ),
      );
    for (const [i, [x, y]] of [
      [70, 70],
      [110, 70],
      [70, 110],
      [110, 110],
      [28, 28],
      [152, 28],
      [28, 152],
      [152, 152],
    ].entries())
      additions.push(
        placement(`garden-tree-${i}`, 'tree', x, y, 5, 5, 7, {
          facts: [{ key: 'tree.form', value: 'broadleaf', unit: null, note: 'Authored choice.' }],
        }),
      );
    const bench = createGeometryTemplate('bench');
    for (const [i, [x, y]] of [
      [80, 78],
      [100, 102],
    ].entries())
      additions.push(
        placement(`garden-bench-${i}`, 'fixture', x, y, bench.width, bench.depth, bench.height, {
          geometry: bench.geometry,
        }),
      );
    changes = [];
    relations = ['south-walk', 'north-walk', 'west-walk', 'east-walk'].map((from) => ({
      from,
      to: 'shared-square',
      type: 'connects',
      note: 'Authored pedestrian connection.',
    }));
  } else {
    const bench = createGeometryTemplate('bench');
    additions = [
      placement(
        'generation-test-bench',
        'fixture',
        request.world.bounds.width / 2,
        request.world.bounds.depth / 2,
        bench.width,
        bench.depth,
        bench.height,
        { geometry: bench.geometry },
      ),
    ];
    changes = [
      {
        objectId: request.world.objects[0].id,
        description: 'An authored descriptive refinement from the browser fixture.',
        geometry: null,
      },
    ];
    relations = [];
    if (request.terrainMode === 'author') {
      additions = [];
      changes = [];
    }
  }
  return {
    provider: request.provider,
    model: 'mock-world-model',
    guideVersion: LAYOUT_GUIDE_VERSION,
    layout: request.layout ?? 'contextual',
    referenceIds: selectLayoutReferences(request).referenceIds,
    context: { includedObjects: context.includedObjects, omittedObjects: context.omittedObjects },
    proposal: {
      summary:
        request.mode === 'create'
          ? 'A compact garden neighborhood with a shared square, connected walks and varied building forms.'
          : 'One new editable bench and one descriptive refinement. Existing measurements and placements are retained.',
      name: 'Garden Commons',
      description: 'An imaginary neighborhood, generated by a deterministic browser fixture.',
      terrain:
        request.terrainMode === 'author'
          ? {
              type: 'analytic-heightfield',
              version: 1,
              evidence: 'authored',
              baseElevation: 0,
              features: [
                {
                  x: 0.5,
                  y: 0.5,
                  radiusX: 0.4,
                  radiusY: 0.35,
                  height: request.mode === 'create' ? 12 : 24,
                  rotation: 0,
                },
              ],
            }
          : null,
      additions,
      changes,
      relations,
    },
  };
}

const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER ?? 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1020 } });
await mkdir('test-results', { recursive: true });
const errors = [],
  requests = [];
page.on('pageerror', (error) => errors.push(error.message));
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
let replyMode = 'valid',
  release;
await page.route('**/api/status', (route) =>
  route.fulfill({
    json: {
      token: 'world-browser-test',
      ai: {
        codex: {
          available: true,
          authenticated: true,
          planType: 'test',
          models: [],
          isolated: true,
        },
        api: { configured: true, defaultModel: 'mock-api-world' },
        busy: false,
      },
      maps: { provider: 'test', tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    },
  }),
);
await page.route('**/api/ai/**', (route) => {
  throw new Error(`Unexpected model endpoint: ${route.request().url()}`);
});
await page.route('**/api/ai/world', async (route) => {
  const request = route.request().postDataJSON();
  requests.push(request);
  const result = resultFor(request);
  const mode = replyMode;
  if (mode === 'invalid') result.proposal.additions[0].x = -20;
  if (mode === 'delayed')
    await new Promise((resolve) => {
      release = resolve;
    });
  await route.fulfill({ json: result }).catch((error) => {
    if (mode !== 'delayed') throw error;
  });
});
try {
  await page.goto(process.env.WORDSCAPE_TEST_URL ?? 'http://127.0.0.1:5173', {
    waitUntil: 'networkidle',
  });
  const original = await saved();
  await page.getByRole('button', { name: 'Improve this world', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Author or replace terrain/ })).toHaveCount(0);
  await expect(page.locator('.world-studio-terrain-option')).toContainText(
    'Recorded terrain is protected',
  );
  await page.getByRole('combobox', { name: 'Real-place references' }).selectOption('none');
  await page.getByRole('button', { name: 'Generate improvements', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply improvements', exact: true })).toBeVisible();
  await expect(page.locator('.world-studio-scene canvas')).toBeVisible();
  assert.deepEqual(await saved(), original, 'Review must not change the existing document');
  assert.equal(requests.at(-1).mode, 'revise');
  assert.equal(requests.at(-1).terrainMode, 'preserve');
  assert.deepEqual(requests.at(-1).referenceIds, []);
  await expect(page.locator('.world-studio-used-references')).toContainText('No concrete examples');
  assert.deepEqual(requests.at(-1).world, original);
  await page.getByText('What the model received', { exact: true }).click();
  await expect(page.locator('.world-studio-input')).toContainText('existing objects included');
  await page.screenshot({ path: 'test-results/world-generation-revision.png' });
  await page.getByRole('button', { name: 'Apply improvements', exact: true }).click();
  await expect.poll(async () => (await saved()).objects.length).toBe(original.objects.length + 1);
  const revised = await saved();
  assert.deepEqual(revised.sources, original.sources);
  assert.deepEqual(revised.terrain, original.terrain);
  assert.deepEqual(revised.aerial, original.aerial);
  for (let i = 0; i < original.objects.length; i++)
    assert.deepEqual(
      { ...revised.objects[i], description: original.objects[i].description },
      original.objects[i],
    );
  assert.equal(revised.objects.at(-1).evidence, 'authored');
  assert.ok(revised.objects.at(-1).geometry.parts.length > 1);

  await page.getByRole('button', { name: 'Imagine a world', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: /Include authored terrain/ })).toBeChecked();
  const brief = page.getByRole('textbox', { name: /What kind of place/ });
  const referenceIds = () =>
    page
      .locator('.layout-reference-card')
      .evaluateAll((cards) => cards.map((card) => card.dataset.referenceId));
  await brief.fill('A sparse woodland clearing with dispersed homes');
  assert.deepEqual(
    await referenceIds(),
    selectLayoutReferences({ prompt: await brief.inputValue() }).referenceIds,
  );
  const woodlandIds = await referenceIds();
  await brief.fill('A compact harbor waterfront with piers');
  assert.deepEqual(
    await referenceIds(),
    selectLayoutReferences({ prompt: await brief.inputValue() }).referenceIds,
  );
  assert.notDeepEqual(
    await referenceIds(),
    woodlandIds,
    'Automatic references must follow the brief',
  );
  await page.getByRole('combobox', { name: 'Real-place references' }).selectOption('manual');
  await expect(page.locator('.layout-reference-options input:checked')).toHaveCount(2);
  await expect(page.locator('.layout-reference-options input:disabled')).toHaveCount(8);
  while (await page.locator('.layout-reference-options input:checked').count())
    await page.locator('.layout-reference-options input:checked').first().uncheck();
  await expect(page.getByRole('button', { name: 'Generate world', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: /Monaco/ }).check();
  await page.getByRole('checkbox', { name: /San Francisco/ }).check();
  await expect(page.getByRole('checkbox', { name: /Hulhumal/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Preview Monaco in 3D' }).click();
  await expect(page.locator('.layout-reference-scene canvas')).toBeVisible();
  assert.deepEqual(await saved(), revised, 'A reference preview is read-only');
  const referenceDownload = page.waitForEvent('download');
  await page
    .locator('[data-reference-id="monaco-old-town"]')
    .getByRole('link', { name: 'Download world JSON' })
    .click();
  await (await referenceDownload).saveAs('test-results/reference-browser-fixture.wordscape.json');
  const referenceWorld = JSON.parse(
    await readFile('test-results/reference-browser-fixture.wordscape.json', 'utf8'),
  );
  assert.equal(referenceWorld.objects.length, 362);
  await page.locator('.layout-references').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/world-generation-references.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.layout-reference-cards').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/world-generation-references-mobile.png' });
  assert.equal(
    await page
      .getByRole('dialog')
      .evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth + 1),
    false,
  );
  await page.setViewportSize({ width: 1500, height: 1020 });
  await page.getByRole('button', { name: 'Close reference preview' }).click();
  await page.getByRole('combobox', { name: 'Real-place references' }).selectOption('auto');
  await brief.fill('');
  await page.getByRole('combobox', { name: /World size/ }).selectOption('180');
  await page.getByRole('combobox', { name: /Model connection/ }).selectOption('api');
  replyMode = 'invalid';
  await page.getByRole('button', { name: 'Generate world', exact: true }).click();
  await expect(page.locator('.world-studio-error')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open imagined world', exact: true })).toHaveCount(
    0,
  );
  assert.deepEqual(await saved(), revised, 'Invalid proposals must preserve the current world');
  replyMode = 'delayed';
  const beforeCancel = requests.length;
  await page.getByRole('button', { name: 'Generate world', exact: true }).click();
  await expect.poll(() => requests.length).toBe(beforeCancel + 1);
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect(page.locator('.world-studio-notice')).toContainText('cancelled');
  release();
  await page.waitForTimeout(120);
  await expect(page.getByRole('button', { name: 'Open imagined world', exact: true })).toHaveCount(
    0,
  );
  assert.deepEqual(await saved(), revised);

  // Closing the studio also aborts its request and discards a late response.
  const beforeClose = requests.length;
  await page.getByRole('button', { name: 'Generate world', exact: true }).click();
  await expect.poll(() => requests.length).toBe(beforeClose + 1);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  release();
  await page.waitForTimeout(120);
  assert.deepEqual(await saved(), revised);
  await page.getByRole('button', { name: 'Imagine a world', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open imagined world', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('combobox', { name: /World size/ }).selectOption('180');
  await page.getByRole('combobox', { name: /Model connection/ }).selectOption('api');
  replyMode = 'valid';
  await page.getByRole('button', { name: 'Generate world', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open imagined world', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: /Layout character/ }).selectOption('clustered');
  await expect(page.getByRole('button', { name: 'Open imagined world', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Generate world', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open imagined world', exact: true }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Real-place references' }).selectOption('none');
  await expect(page.getByRole('button', { name: 'Open imagined world', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Generate world', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open imagined world', exact: true }),
  ).toBeVisible();
  assert.deepEqual(requests.at(-1).referenceIds, []);
  await page.getByRole('combobox', { name: 'Real-place references' }).selectOption('manual');
  await expect(page.getByRole('button', { name: 'Open imagined world', exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('checkbox', { name: /Monaco/ }).check();
  await page.getByRole('checkbox', { name: /San Francisco/ }).check();
  await page.getByRole('button', { name: 'Generate world', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Open imagined world', exact: true }),
  ).toBeVisible();
  assert.equal(requests.at(-1).layout, 'clustered');
  assert.equal(requests.at(-1).terrainMode, 'author');
  await expect(page.getByRole('region', { name: 'Terrain proposal' })).toContainText(
    'Authored terrain preview',
  );
  await expect(page.getByRole('region', { name: 'Terrain proposal' })).toContainText('relief');
  assert.deepEqual(requests.at(-1).referenceIds, ['monaco-old-town', 'sf-wharf']);
  await expect(page.locator('.world-studio-used-references')).toContainText('Monaco');
  await expect(page.getByRole('region', { name: 'Layout measurements' })).toContainText(
    'median nearest building-edge gap',
  );
  assert.equal(requests.at(-1).provider, 'api', 'API must be explicitly selected');
  assert.equal(requests.at(-1).prompt, '', 'A blank optional brief must be accepted');
  assert.equal(requests.at(-1).world, undefined, 'Create mode must not send the open document');
  assert.deepEqual(await saved(), revised, 'A complete world preview must remain unapplied');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Walk here', exact: true }),
  ).toHaveCount(0);
  await page.locator('.world-studio-scene').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/world-generation-create.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.world-studio-scene').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/world-generation-mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1,
    ),
    false,
  );
  assert.equal(
    await page
      .getByRole('dialog')
      .evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth + 1),
    false,
  );
  await page.getByRole('button', { name: 'Open imagined world', exact: true }).click();
  await expect.poll(async () => (await saved()).name).toBe('Garden Commons');
  let imaginary = await saved();
  assert.ok(imaginary.imaginary);
  assert.equal(imaginary.aerial, undefined);
  assert.equal(imaginary.terrain.evidence, 'authored');
  assert.ok(Math.max(...imaginary.terrain.heights) > 10);
  assert.ok(imaginary.objects.length >= 20 && imaginary.objects.length <= 60);
  assert.ok(imaginary.objects.every((object) => object.evidence === 'authored'));
  assert.ok(imaginary.objects.some((object) => object.geometry));
  assert.ok(imaginary.objects.some((object) => object.footprint?.length === 6));
  assert.deepEqual(
    JSON.parse(
      imaginary.objects[0].facts.find((fact) => fact.key === 'generation.referenceIds').value,
    ),
    ['monaco-old-town', 'sf-wharf'],
  );
  assert.ok(imaginary.sources.some((source) => source.title.includes('Monaco')));
  await expect(
    page
      .getByRole('navigation', { name: 'World view' })
      .getByRole('button', { name: 'Aerial', exact: true }),
  ).toBeDisabled();
  // Terrain-only iteration is explicit, remains a preview, and retains source facts and plan positions.
  const beforeTerrainRevision = imaginary;
  await page.getByRole('button', { name: 'Improve this world', exact: true }).click();
  const terrainToggle = page.getByRole('checkbox', { name: /Author or replace terrain/ });
  await expect(terrainToggle).not.toBeChecked();
  await terrainToggle.check();
  await page.getByRole('button', { name: 'Generate improvements', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply improvements', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Terrain proposal' })).toContainText(
    'existing objects regrounded vertically',
  );
  assert.deepEqual(await saved(), beforeTerrainRevision);
  await terrainToggle.uncheck();
  await expect(page.getByRole('button', { name: 'Apply improvements', exact: true })).toHaveCount(
    0,
  );
  await terrainToggle.check();
  await page.getByRole('button', { name: 'Generate improvements', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Apply improvements', exact: true })).toBeVisible();
  await page.getByRole('region', { name: 'Terrain proposal' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/world-generation-terrain-mobile.png' });
  await page.getByRole('button', { name: 'Apply improvements', exact: true }).click();
  await expect.poll(async () => Math.max(...(await saved()).terrain.heights)).toBeGreaterThan(20);
  imaginary = await saved();
  assert.equal(imaginary.objects.length, beforeTerrainRevision.objects.length);
  for (const original of beforeTerrainRevision.objects) {
    const next = imaginary.objects.find((object) => object.id === original.id);
    for (const key of ['x', 'y', 'width', 'depth', 'height', 'rotation', 'facts'])
      assert.deepEqual(next[key], original[key], `Terrain revision preserves ${key}`);
  }
  await page.getByRole('button', { name: 'Export world', exact: true }).click();
  const jsonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /World document Portable JSON/ }).click();
  await (await jsonDownload).saveAs('test-results/imaginary-browser-fixture.wordscape.json');
  assert.deepEqual(
    JSON.parse(await readFile('test-results/imaginary-browser-fixture.wordscape.json', 'utf8')),
    imaginary,
  );
  await page.getByRole('button', { name: 'Export world', exact: true }).click();
  const glbDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /3D model glTF binary/ }).click();
  await (await glbDownload).saveAs('test-results/imaginary-browser-fixture.glb');
  const glb = await readFile('test-results/imaginary-browser-fixture.glb');
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.deepEqual(gltf.nodes.find((node) => node.extras?.wordscape)?.extras.wordscape, imaginary);
  assert.deepEqual(errors, []);
  console.log(
    'World generation browser smoke passed: surveyed-terrain protection, authored ground preview, explicit terrain-only revision and regrounding, source/plan preservation, automatic/manual/none references, two-reference limit, read-only reference preview/download, input invalidation, metrics, footprint/reference/terrain export retention, cancellation, explicit provider, mobile layout. All model responses were deterministic mocks.',
  );
} finally {
  await browser.close();
}
