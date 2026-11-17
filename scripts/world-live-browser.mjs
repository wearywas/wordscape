import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';

// Inspect retained real model output in an isolated browser; no inference or provider requests.
const source =
  process.argv[2] ||
  process.env.WORDSCAPE_LIVE_SOURCE ||
  'public/examples/lanternwater-refined.wordscape.json';
const output = process.argv[3] || process.env.WORDSCAPE_LIVE_OUTPUT || 'lanternwater-live';
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(output))
  throw new Error(
    'Output basename must contain only letters, digits, dots, underscores or hyphens (maximum 100 characters).',
  );
const artifact = (suffix) => `test-results/${output}${suffix}`;
const world = JSON.parse(await readFile(source, 'utf8'));
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER || 'chrome',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(process.env.WORDSCAPE_TEST_URL || 'http://127.0.0.1:4173');
  await page.getByLabel('Import world document').setInputFiles(source);
  await expect(page.getByRole('heading', { name: world.name, exact: true })).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page
    .getByRole('navigation', { name: 'World view' })
    .getByRole('button', { name: '3D world', exact: true })
    .click();
  await expect(page.locator('.world-scene canvas')).toBeVisible();
  await page.waitForTimeout(1000);
  if (await dismiss.isVisible()) await dismiss.click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: artifact('.png') });
  await expect(
    page
      .getByRole('navigation', { name: 'World view' })
      .getByRole('button', { name: 'Aerial', exact: true }),
  ).toBeDisabled();
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
  assert.deepEqual(await saved(), world);
  if (world.terrain) {
    const toggle = page.getByRole('button', { name: 'Show terrain', exact: true });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await page.waitForTimeout(250);
    await page.screenshot({ path: artifact('-flat.png') });
    assert.deepEqual(await saved(), world, 'Flat comparison must not remove the recorded terrain');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Walk here', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Return to orbit', exact: true })).toBeVisible();
  await page.keyboard.down('w');
  await page.waitForTimeout(350);
  await page.keyboard.up('w');
  await page.screenshot({ path: artifact('-walk.png') });
  if (world.terrain) {
    // A safe spawn can face a nearby wall; inspect another direction without modifying the world.
    await page.keyboard.down('s');
    await page.waitForTimeout(700);
    await page.keyboard.up('s');
    const canvas = await page.locator('.world-scene canvas').boundingBox();
    await page.mouse.move(canvas.x + canvas.width * 0.35, canvas.y + canvas.height * 0.45);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * 0.35 + 300, canvas.y + canvas.height * 0.45, {
      steps: 12,
    });
    await page.mouse.up();
    await page.screenshot({ path: artifact('-walk-look.png') });
  }
  assert.deepEqual(await saved(), world, 'Walking must not alter generated data');
  await page.getByRole('button', { name: 'Return to orbit', exact: true }).click();
  await page.getByRole('button', { name: 'Export world', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /3D model glTF binary/ }).click();
  await (await download).saveAs(artifact('.glb'));
  const glb = await readFile(artifact('.glb'));
  assert.equal(glb.toString('utf8', 0, 4), 'glTF');
  const gltf = JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
  assert.deepEqual(gltf.nodes.find((node) => node.extras?.wordscape)?.extras.wordscape, world);
  await page.setViewportSize({ width: 390, height: 844 });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({ path: artifact('-mobile.png'), fullPage: true });
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1,
    ),
    false,
  );
  // Resizing deliberately preserves the orbit's vertical span. Reset fits the narrower viewport.
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await expect(page.locator('.world-scene canvas')).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: artifact('-mobile-fitted.png'), fullPage: true });
  assert.deepEqual(await saved(), world, 'Reframing must not alter generated data');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      source,
      output,
      objects: world.objects.length,
      recipes: world.objects.filter((o) => o.geometry).length,
      terrainSamples: world.terrain?.heights.length ?? 0,
      glbBytes: glb.length,
      checks:
        'Retained live world import, render, terrain/flat comparison when present, walk, unchanged document, disabled aerial, GLB metadata roundtrip and mobile fit passed.',
    }),
  );
} finally {
  await browser.close();
}
