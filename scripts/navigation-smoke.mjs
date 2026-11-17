import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER ?? 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('test-results', { recursive: true });
const clickView = (name) =>
  page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name, exact: true })
    .click();
const saved = () => page.evaluate(() => localStorage.getItem('wordscape.world.v1'));
try {
  await page.goto(process.env.WORDSCAPE_TEST_URL ?? 'http://127.0.0.1:5173', {
    waitUntil: 'networkidle',
  });
  const initial = await saved();
  await clickView('Words');
  const map = page.locator('svg.word-map');
  const box = await map.boundingBox();
  // Chromium dispatches wheel coordinates at integer CSS pixels.
  const cursor = {
    x: Math.round(box.x + box.width * 0.67),
    y: Math.round(box.y + box.height * 0.43),
  };
  const atCursor = () =>
    map.evaluate((svg, point) => {
      const p = new globalThis.DOMPoint(point.x, point.y).matrixTransform(
        svg.getScreenCTM().inverse(),
      );
      return [p.x, p.y];
    }, cursor);
  const beforeAnchor = await atCursor();
  const beforeView = await map.getAttribute('viewBox');
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -380);
  await expect.poll(() => map.getAttribute('viewBox')).not.toBe(beforeView);
  const afterAnchor = await atCursor();
  assert.ok(
    Math.hypot(afterAnchor[0] - beforeAnchor[0], afterAnchor[1] - beforeAnchor[1]) < 0.01,
    'Wheel zoom must keep cursor anchored',
  );
  assert.equal(await saved(), initial, 'Map zoom must not mutate placements');
  const zoomed = await map.getAttribute('viewBox');
  await page.mouse.move(20, 20);
  await page.mouse.wheel(0, 200);
  await page.waitForTimeout(100);
  assert.equal(
    await map.getAttribute('viewBox'),
    zoomed,
    'Wheel outside map must not change map zoom',
  );
  await page.screenshot({ path: 'test-results/navigation-map-zoom.png' });

  await clickView('3D world');
  const canvas = page.locator('.world-scene canvas');
  await expect(canvas).toBeVisible();
  await page.getByRole('button', { name: 'Walk here', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'walk');
  const position = async () =>
    (await canvas.getAttribute('data-walk-position')).split(',').map(Number);
  await expect.poll(() => canvas.getAttribute('data-walk-position')).not.toBeNull();
  const start = await position();
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  await page.keyboard.up('w');
  const moved = await position();
  assert.ok(Math.hypot(moved[0] - start[0], moved[1] - start[1]) > 0.2, 'W must move the viewer');
  await page.keyboard.down('d');
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Return to orbit', exact: true }).focus();
  await page.waitForTimeout(80);
  const blurred = await position();
  await page.waitForTimeout(200);
  assert.deepEqual(await position(), blurred, 'Blur must stop held movement');
  await page.keyboard.up('d');
  const walkControls = await page.locator('.world-walk-controls').boundingBox();
  const mapControls = await page.locator('.map-controls').boundingBox();
  assert.ok(
    walkControls.y + walkControls.height < mapControls.y,
    'Walk help must not cover terrain/reset controls',
  );
  await page.screenshot({ path: 'test-results/navigation-walk.png' });
  await page.keyboard.press('Escape');
  await expect(canvas).toHaveAttribute('data-view-mode', 'orbit');
  await page.getByRole('button', { name: 'Walk here', exact: true }).click();
  await page.getByRole('button', { name: 'Terrain & survey', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const modalPosition = await position();
  await page.keyboard.press('w');
  await page.waitForTimeout(150);
  assert.deepEqual(await position(), modalPosition, 'Modal must block movement');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Return to orbit', exact: true }).click();
  assert.equal(await saved(), initial, 'Walking must not mutate the world');
  // The workbench is blocked by a modal, but its own embedded model preview must still orbit.
  await page.getByRole('button', { name: 'Create a place', exact: true }).click();
  await page.getByRole('tab', { name: 'Model builder', exact: true }).click();
  await page.getByRole('button', { name: 'pavilion', exact: true }).click();
  const previewCanvas = page.locator('.studio-scene canvas');
  await expect(previewCanvas).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Walk here', exact: true }),
  ).toHaveCount(0);
  await page.waitForTimeout(200);
  const previewBefore = await previewCanvas.screenshot();
  const previewBox = await previewCanvas.boundingBox();
  await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    previewBox.x + previewBox.width / 2 + 80,
    previewBox.y + previewBox.height / 2 + 30,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.notDeepEqual(
    await previewCanvas.screenshot(),
    previewBefore,
    'Modal model preview must remain interactive',
  );
  // Layer removal must retain Leaflet's own listener cleanup before a later fitBounds.
  await page.getByRole('tab', { name: 'A mapped area', exact: true }).click();
  await page.getByRole('button', { name: 'Street map', exact: true }).click();
  await page
    .getByRole('group', { name: 'Adjacent survey direction' })
    .getByRole('button', { name: 'North', exact: true })
    .click();
  await page.getByRole('button', { name: 'Satellite / aerial', exact: true }).click();
  await page
    .getByRole('group', { name: 'Adjacent survey direction' })
    .getByRole('button', { name: 'East', exact: true })
    .click();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  assert.equal(await saved(), initial, 'Preview orbit must not mutate the world');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Walk here', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-view-mode', 'walk');
  const overflow = await page.evaluate(
    () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1,
  );
  assert.equal(overflow, false, 'Walk help must not overflow mobile');
  await page.screenshot({ path: 'test-results/navigation-walk-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Navigation smoke passed: anchored wheel zoom, no outside-wheel interception, walking, blur/Escape/modal handling, mobile bounds, unchanged document.',
  );
} finally {
  await browser.close();
}
