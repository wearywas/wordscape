import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';

// Run against an already running dev/preview server. Chrome is present on this Windows host.
const url = process.env.WORDSCAPE_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER ?? 'chrome',
  headless: true,
});
await mkdir('test-results', { recursive: true });
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
const clickView = (name) =>
  page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name, exact: true })
    .click();
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  const initial = await saved();
  const initialCount = initial.objects.length;
  assert.ok(initialCount >= 70);
  assert.equal(initial.version, '0.8');
  assert.equal(initial.terrain.heights.length, 73 * 73);
  await page.getByRole('button', { name: 'Terrain & survey', exact: true }).click();
  assert.match(await page.getByRole('dialog').innerText(), /38.1 m/);
  await page.getByRole('slider', { name: 'Probe east', exact: true }).fill('0');
  await page.getByRole('slider', { name: 'Probe north', exact: true }).fill('0');
  assert.equal(await page.locator('.probe-height').innerText(), '49.8 m');
  await page.getByRole('slider', { name: 'Probe east', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(
    await page.getByRole('slider', { name: 'Probe east', exact: true }).inputValue(),
    '1',
  );
  const notebookDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export survey notebook', exact: true }).click();
  await (await notebookDownload).saveAs('test-results/survey-notebook.json');
  const notebook = JSON.parse(await readFile('test-results/survey-notebook.json', 'utf8'));
  assert.equal(notebook.objectCount, initialCount);
  assert.equal(notebook.checks.length, initialCount);
  assert.equal(notebook.terrain.sourceId, initial.terrain.sourceId);
  assert.ok(notebook.checkedFields.missing > 0);
  assert.ok(notebook.sources.some((source) => source.id === initial.terrain.sourceId));
  await page.getByRole('button', { name: /Show all \d+ objects to review/ }).click();
  await page.locator('.survey-review-list button').filter({ hasText: 'West bell tower' }).click();
  assert.equal(
    await page
      .getByRole('complementary', { name: 'Object inspector' })
      .getByRole('textbox', { name: 'Name', exact: true })
      .inputValue(),
    'West bell tower',
  );
  assert.deepEqual(await saved(), initial);
  await page.keyboard.press('Escape');
  assert.equal(
    await page.getByRole('button', { name: 'Edit mode', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  await page.getByRole('button', { name: 'Inspect an object', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Object inspector' });
  assert.equal(
    await inspector.getByRole('textbox', { name: 'Name', exact: true }).getAttribute('readonly'),
    '',
  );
  const lockedSchool = page.getByRole('button', { name: 'Select School building', exact: true });
  const lockedBox = await lockedSchool.boundingBox();
  const oldViewBox = await page.locator('svg.word-map').getAttribute('viewBox');
  await page.mouse.move(lockedBox.x + lockedBox.width / 2, lockedBox.y + lockedBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    lockedBox.x + lockedBox.width / 2 + 45,
    lockedBox.y + lockedBox.height / 2 + 20,
    { steps: 6 },
  );
  await page.mouse.up();
  assert.deepEqual(await saved(), initial);
  assert.notEqual(await page.locator('svg.word-map').getAttribute('viewBox'), oldViewBox);
  await lockedSchool.focus();
  await page.keyboard.press('Shift+ArrowRight');
  assert.deepEqual(await saved(), initial);
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await page.getByRole('button', { name: 'Edit mode', exact: true }).click();
  await inspector.getByRole('textbox', { name: 'Name', exact: true }).fill('Test pavilion');
  await inspector.getByRole('spinbutton', { name: 'Height', exact: true }).fill('22');
  assert.ok(
    (await saved()).objects.some(
      (object) =>
        object.label === 'Test pavilion' && object.height === 22 && object.evidence === 'authored',
    ),
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(
    await page.getByRole('button', { name: 'Edit mode', exact: true }).getAttribute('aria-pressed'),
    'false',
  );
  await page.getByRole('button', { name: 'Edit mode', exact: true }).click();
  assert.ok(
    (await saved()).objects.some(
      (object) => object.label === 'Test pavilion' && object.height === 22,
    ),
  );
  await page
    .getByRole('button', { name: /Test pavilion/ })
    .first()
    .click();
  await inspector.getByRole('button', { name: 'Duplicate', exact: true }).click();
  assert.equal((await saved()).objects.length, initialCount + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal((await saved()).objects.length, initialCount);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  assert.equal((await saved()).objects.length, initialCount + 1);
  await clickView('Document');
  assert.equal(
    JSON.parse(await page.getByRole('textbox', { name: 'World JSON document' }).inputValue())
      .objects.length,
    initialCount + 1,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(
    JSON.parse(await page.getByRole('textbox', { name: 'World JSON document' }).inputValue())
      .objects.length,
    initialCount,
  );
  await page.getByRole('textbox', { name: 'World JSON document' }).fill('{ invalid');
  await page.getByRole('button', { name: 'Apply document' }).click();
  assert.match(await page.getByRole('status').first().textContent(), /Invalid JSON/);
  assert.equal((await saved()).objects.length, initialCount);
  await page.getByRole('textbox', { name: 'World JSON document' }).fill(JSON.stringify(initial));
  await page.getByRole('button', { name: 'Apply document' }).click();
  await clickView('Words');
  await page.getByRole('button', { name: 'Add object', exact: true }).click();
  await page.locator('.add-menu').getByRole('button', { name: 'Tree', exact: true }).click();
  assert.equal((await saved()).objects.length, initialCount + 1);
  await inspector.getByRole('button', { name: 'Delete selected object' }).click();
  assert.equal((await saved()).objects.length, initialCount);
  const footprint = page.getByRole('button', {
    name: 'Select Washington Square lawn',
    exact: true,
  });
  await footprint.focus();
  const lawnBefore = (await saved()).objects.find(
    (object) => object.label === 'Washington Square lawn',
  );
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(
    (await saved()).objects.find((object) => object.label === 'Washington Square lawn').x,
    lawnBefore.x + 10,
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const beforeDrag = (await saved()).objects.find((object) => object.label === 'School building');
  const school = page.getByRole('button', { name: 'Select School building', exact: true });
  const box = await school.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const afterDrag = (await saved()).objects.find((object) => object.label === 'School building');
  assert.notEqual(afterDrag.x, beforeDrag.x);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await inspector.getByRole('button', { name: 'Add fact', exact: true }).click();
  let modal = page.getByRole('dialog');
  await modal.getByRole('textbox', { name: 'Fact key', exact: true }).fill('generation.note');
  await modal
    .getByRole('textbox', { name: 'Fact value', exact: true })
    .fill('Keep the original footprint.');
  await modal.getByRole('button', { name: 'Save fact', exact: true }).click();
  assert.ok(
    (await saved()).objects
      .find((object) => object.label === 'School building')
      .facts.some((fact) => fact.key === 'generation.note' && fact.evidence === 'authored'),
  );
  await inspector.getByRole('button', { name: 'Add reference', exact: true }).click();
  modal = page.getByRole('dialog');
  await modal
    .getByRole('textbox', { name: 'Reference title', exact: true })
    .fill('Test inspiration');
  await modal
    .getByRole('textbox', { name: 'Web link', exact: true })
    .fill('https://example.com/reference');
  await modal.getByRole('button', { name: 'Save reference', exact: true }).click();
  assert.ok((await saved()).sources.some((source) => source.title === 'Test inspiration'));
  const packetDownloadPromise = page.waitForEvent('download');
  await inspector.getByRole('button', { name: 'Export container JSON', exact: true }).click();
  await (await packetDownloadPromise).saveAs('test-results/smoke-container.wordscape.json');
  const packet = JSON.parse(await readFile('test-results/smoke-container.wordscape.json', 'utf8'));
  assert.ok(packet.objects[0].facts.some((fact) => fact.key === 'generation.note'));
  assert.ok(packet.sources.some((source) => source.title === 'Test inspiration'));
  await clickView('Document');
  await page.getByRole('textbox', { name: 'World JSON document' }).fill(JSON.stringify(initial));
  await page.getByRole('button', { name: 'Apply document' }).click();
  await clickView('Words');
  const church = initial.objects.find((object) => object.id === 'church');
  const churchChildren = initial.objects.filter((object) => object.parentId === church.id);
  if (churchChildren.length) {
    await page
      .locator('.object-list')
      .getByRole('button', { name: /Saints Peter and Paul/ })
      .click();
    await inspector
      .getByRole('spinbutton', { name: 'East', exact: true })
      .fill(String(church.x + 5));
    const moved = await saved();
    for (const child of churchChildren)
      assert.equal(moved.objects.find((object) => object.id === child.id).x, child.x + 5);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Export world', exact: true }).click();
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /World document Portable JSON/ }).click();
  const jsonDownload = await jsonDownloadPromise;
  await jsonDownload.saveAs('test-results/smoke.wordscape.json');
  const exported = JSON.parse(await readFile('test-results/smoke.wordscape.json', 'utf8'));
  assert.deepEqual(exported, initial);
  await page.getByLabel('Import world document').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"wrong"}'),
  });
  assert.match(await page.locator('.toast').textContent(), /Import failed/);
  assert.equal((await saved()).objects.length, initialCount);
  await page.getByLabel('Import world document').setInputFiles('test-results/smoke.wordscape.json');
  assert.deepEqual(await saved(), initial);
  await clickView('Aerial');
  await page.locator('svg image').waitFor();
  assert.equal(
    await page.locator('svg image').getAttribute('href'),
    '/reference/washington-square-noaa-2022.jpg',
  );
  await page.getByRole('button', { name: 'Survey & sources' }).click();
  await page.getByRole('dialog').waitFor();
  assert.ok(
    await page
      .getByRole('dialog')
      .locator('.source-image')
      .evaluate((image) => image.complete && image.naturalWidth === 1440),
  );
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await clickView('3D world');
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(600);
  assert.ok(
    await page.locator('canvas').evaluate((canvas) => canvas.width > 0 && canvas.height > 0),
  );
  const terrainToggle = page.getByRole('button', { name: 'Show terrain', exact: true });
  assert.equal(await terrainToggle.getAttribute('aria-pressed'), 'true');
  await terrainToggle.click();
  assert.equal(await terrainToggle.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await saved(), initial);
  // Export while the preview is flat: the recorded terrain must still be in the GLB.
  await page.getByRole('button', { name: 'Export world', exact: true }).click();
  const glbDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /3D model glTF binary/ }).click();
  await (await glbDownloadPromise).saveAs('test-results/smoke.glb');
  const glb = await readFile('test-results/smoke.glb');
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.ok(gltf.nodes.length > initialCount);
  const terrainNode = gltf.nodes.find((node) => node.name === 'Recorded terrain');
  assert.deepEqual(terrainNode.extras.terrain, initial.terrain);
  assert.equal(terrainNode.extras.verticalExaggeration, 1);
  await terrainToggle.click();
  await page.screenshot({ path: 'test-results/wordscape-3d.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await clickView('Words');
  assert.ok(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  );
  await page.screenshot({ path: 'test-results/wordscape-mobile-words.png', fullPage: true });
  await page.getByRole('button', { name: 'Terrain & survey', exact: true }).click();
  assert.ok(
    await page
      .getByRole('dialog')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  );
  await page.getByRole('slider', { name: 'Probe north', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('slider', { name: 'Probe north', exact: true }).fill('360');
  await page.screenshot({ path: 'test-results/wordscape-mobile-terrain.png', fullPage: true });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: terrain probe/notebook/provenance export, flat-preview isolation and terrain GLB; locked viewing, editing, persistence, undo/redo, facts/references, container transforms, JSON roundtrip, aerial, 3D, mobile. No page errors.',
  );
} finally {
  await browser.close();
}
