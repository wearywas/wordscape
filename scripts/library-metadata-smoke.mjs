import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
/* global indexedDB */

// Isolated IndexedDB regression against Vite's source-module endpoint; no application UI or provider calls.
const baseUrl = process.env.WORDSCAPE_TEST_URL ?? 'http://127.0.0.1:5173';
const world = JSON.parse(await readFile('src/data/washingtonSquare.v0.1.json', 'utf8'));
world.name = 'Edited legacy library metadata fixture';
world.objects[0].x += 2;
world.objects[0].evidence = 'authored';
const browser = await chromium.launch({
  channel: process.env.WORDSCAPE_BROWSER ?? 'chrome',
  headless: true,
});
try {
  const context = await browser.newContext();
  await context.route('**/library-metadata-regression.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Isolated metadata regression</title>',
    }),
  );
  const page = await context.newPage();
  await page.goto(`${baseUrl}/library-metadata-regression.html`);
  const result = await page.evaluate(async (world) => {
    const library = await import('/src/world/surveyLibrary.ts');
    const saved = (await library.saveSurveySnapshots([world]))[0];
    const requestValue = (request) =>
      new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    const transactionDone = (transaction) =>
      new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    const db = await requestValue(indexedDB.open('wordscape-surveys-v1', 2));
    const record = await requestValue(
      db.transaction('documents').objectStore('documents').get(saved.id),
    );
    const retainedDocument = `\n${record.document}\n`;
    const originalDate = '2025-01-02T03:04:05.000Z';
    const makeLegacyMetadata = async () => {
      const tx = db.transaction(['entries', 'documents'], 'readwrite'),
        done = transactionDone(tx);
      const legacy = { ...saved, savedAt: originalDate, objectCount: 999 };
      delete legacy.bounds;
      delete legacy.isComposition;
      tx.objectStore('entries').put(legacy);
      tx.objectStore('documents').put({ id: saved.id, document: retainedDocument });
      await done;
    };
    await makeLegacyMetadata();
    const returned = await library.saveSurveySnapshots([world]);
    const explicit = await library.listSavedSurveys();
    const documentAfter = await requestValue(
      db.transaction('documents').objectStore('documents').get(saved.id),
    );
    const read = await library.readSavedSurvey(saved.id);
    await makeLegacyMetadata();
    const initialized = await library.saveSurveySnapshots([world], true);
    const afterInitialize = await library.listSavedSurveys();
    await library.removeSavedSurvey(saved.id);
    await library.saveSurveySnapshots([world], true);
    const afterDelete = await library.listSavedSurveys();
    db.close();
    return {
      saved,
      originalDate,
      returned,
      explicit,
      documentUnchanged: documentAfter.document === retainedDocument,
      readName: read.name,
      readX: read.objects[0].x,
      initialized,
      afterInitialize,
      afterDelete,
    };
  }, world);
  assert.equal(result.explicit.length, 1);
  assert.equal(result.explicit[0].id, result.saved.id);
  assert.deepEqual(
    result.explicit[0].bounds,
    result.saved.bounds,
    'Explicit resave must recover derived geographic metadata',
  );
  assert.equal(result.explicit[0].isComposition, false);
  assert.equal(result.explicit[0].objectCount, world.objects.length);
  assert.equal(result.explicit[0].savedAt, result.originalDate);
  assert.equal(result.returned[0].savedAt, result.originalDate);
  assert.equal(result.documentUnchanged, true, 'The stored document bytes must remain untouched');
  assert.equal(result.readName, world.name);
  assert.equal(result.readX, world.objects[0].x);
  assert.deepEqual(result.initialized, []);
  assert.deepEqual(result.afterInitialize[0].bounds, result.saved.bounds);
  assert.deepEqual(result.afterDelete, [], 'Initialization must not resurrect a deleted snapshot');
  await page.reload();
  const afterReload = await page.evaluate(async (world) => {
    const library = await import('/src/world/surveyLibrary.ts');
    await library.saveSurveySnapshots([world], true);
    return library.listSavedSurveys();
  }, world);
  assert.deepEqual(afterReload, []);
  console.log(
    'Library metadata regression passed: existing hash refreshed; save date, document bytes and edits retained; deleted copy stayed deleted after reload.',
  );
} finally {
  await browser.close();
}
