import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { mkdir } from 'node:fs/promises';

// Retained examples only: this smoke never invokes a model or live map provider.
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER || 'chrome',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1536, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route('**/api/ai/**', () => {
  throw new Error('Framework example flow must not invoke a model.');
});
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('wordscape.world.v1')));
try {
  await mkdir('test-results', { recursive: true });
  await page.goto(process.env.WORDSCAPE_TEST_URL || 'http://127.0.0.1:5173', {
    waitUntil: 'networkidle',
  });
  const original = await saved();
  await expect(page.locator('.framework-note')).toContainText('portable worlds');
  await expect(page.locator('.framework-note')).toContainText(
    'Three.js is one example interpreter',
  );
  await expect(page.locator('.canvas-caption, .canvas-kicker, .intro-illustration')).toHaveCount(0);
  assert.ok(
    (await page
      .locator('.word-map')
      .evaluate((map) => parseFloat(globalThis.getComputedStyle(map).paddingTop))) < 40,
    'Words view reclaims the old heading space',
  );
  await page.screenshot({ path: 'test-results/round9-framework-words.png' });
  const navigation = page.getByRole('navigation', { name: 'World view' });
  await navigation.getByRole('button', { name: '3D world', exact: true }).click();
  await expect(page.locator('.world-scene canvas')).toBeVisible();
  await expect(page.locator('.canvas-caption, .canvas-kicker')).toHaveCount(0);
  await navigation.getByRole('button', { name: 'Aerial', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Aerial reference', exact: true })).toBeVisible();
  await expect(page.locator('.canvas-caption, .canvas-kicker')).toHaveCount(0);
  await page.getByRole('button', { name: 'About the framework', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(
    'Three.js is an example renderer, not the format itself',
  );
  await page.getByRole('button', { name: 'Explore example worlds', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Example worlds', exact: true })).toBeVisible();
  await expect(page.locator('.world-example-card')).toHaveCount(6);
  await expect(
    page.getByRole('link', { name: 'Download Lanternwater Lanes · refined JSON', exact: true }),
  ).toHaveAttribute('href', '/examples/lanternwater-lanes-refined.wordscape.json');
  await page.screenshot({ path: 'test-results/round9-examples.png' });
  await page.getByRole('button', { name: 'Open Mossbell Retreat · flat', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Mossbell Retreat', exact: true, level: 1 }),
  ).toBeVisible();
  const woodland = await saved();
  await page.getByRole('button', { name: 'Saved worlds', exact: true }).click();
  const originalCard = page
    .locator('.saved-survey')
    .filter({ has: page.getByRole('heading', { name: original.name, exact: true }) });
  await expect(originalCard).toBeVisible();
  await expect(
    page
      .locator('.saved-survey')
      .filter({ has: page.getByRole('heading', { name: 'Mossbell Retreat', exact: true }) }),
  ).toBeVisible();
  await originalCard.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: original.name, exact: true, level: 1 }),
  ).toBeVisible();
  await expect.poll(async () => (await saved()).name).toBe(original.name);
  assert.ok(
    isDeepStrictEqual(await saved(), original),
    'Opening a bundled example archives the exact prior document',
  );

  // Invalid bundled content and closing a delayed load both leave the current document intact.
  await page.route('**/examples/mossbell-retreat.wordscape.json', (route) =>
    route.fulfill({ body: '{"format":"broken"}', contentType: 'application/json' }),
  );
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByRole('button', { name: 'Open Mossbell Retreat · flat', exact: true }).click();
  await expect(page.locator('.world-examples-error')).toBeVisible();
  assert.ok(isDeepStrictEqual(await saved(), original));
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.unroute('**/examples/mossbell-retreat.wordscape.json');
  let release,
    requested = false;
  await page.route('**/examples/mossbell-retreat.wordscape.json', async (route) => {
    requested = true;
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({ json: woodland }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByRole('button', { name: 'Open Mossbell Retreat · flat', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  release();
  await page.waitForTimeout(100);
  assert.ok(isDeepStrictEqual(await saved(), original));
  await page.unroute('**/examples/mossbell-retreat.wordscape.json');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.screenshot({ path: 'test-results/round9-examples-mobile.png' });
  assert.equal(
    await page
      .getByRole('dialog')
      .evaluate((dialog) => dialog.scrollWidth > dialog.clientWidth + 1),
    false,
  );
  await page
    .getByRole('button', { name: 'Open Lanternwater Lanes · refined', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Lanternwater Lanes', exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.world-scene canvas')).toBeVisible();
  const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await page.screenshot({ path: 'test-results/round9-framework-mobile.png', fullPage: true });
  assert.equal(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1,
    ),
    false,
  );
  await page.getByRole('button', { name: 'Examples', exact: true }).click();
  await page.getByRole('button', { name: 'Open Mossbell Retreat · terrain', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Mossbell Retreat', exact: true, level: 1 }),
  ).toBeVisible();
  await expect.poll(async () => (await saved()).terrain?.evidence).toBe('authored');
  assert.equal((await saved()).terrain.heights.length, 33 * 33);
  await expect(page.getByRole('button', { name: 'Show terrain', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/round9-example-terrain-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    'Framework browser smoke passed: compact views, renderer/format explanation, offline example open, exact prior-world archive/reopen, invalid/late-response protection, Saved worlds and mobile fit. No model requests.',
  );
} finally {
  await browser.close();
}
