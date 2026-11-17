import { migrateWorld, parseWorld, serializeWorld } from './document';
import { inferSurveyBounds } from './aerial';
import type { GeographicBounds, WorldDocument } from './types';

export interface SavedSurvey {
  id: string;
  name: string;
  savedAt: string;
  bytes: number;
  objectCount: number;
  width: number;
  depth: number;
  hasTerrain: boolean;
  hasAerial: boolean;
  isComposition?: boolean;
  bounds?: GeographicBounds;
}
const DATABASE = 'wordscape-surveys-v1';
const MAX_SNAPSHOTS = 100;
let connection: Promise<IDBDatabase> | undefined;

function database(): Promise<IDBDatabase> {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('entries'))
        db.createObjectStore('entries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('documents'))
        db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      resolve(db);
    };
    request.onerror = () =>
      reject(request.error ?? new Error('Survey storage could not be opened.'));
    request.onblocked = () => {
      blocked = true;
      reject(
        new Error('Another Wordscape tab is blocking survey storage. Close that tab and retry.'),
      );
    };
  }).catch((error) => {
    connection = undefined;
    throw error;
  });
  return connection;
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Survey storage request failed.'));
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Survey storage transaction was cancelled.'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Survey storage transaction failed.'));
  });
}

/** Immutable, content-addressed snapshots. Saving an unchanged world does not create duplicates. */
export async function saveSurveySnapshots(
  worlds: WorldDocument[],
  initializeOnly = false,
): Promise<SavedSurvey[]> {
  const prepared = await Promise.all(
    worlds.map(async (input) => {
      const world = migrateWorld(input),
        document = serializeWorld(world, false),
        bytes = new TextEncoder().encode(document);
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      const id = Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
      const entry: SavedSurvey = {
        id,
        name: world.name,
        savedAt: new Date().toISOString(),
        bytes: bytes.length,
        objectCount: world.objects.length,
        width: world.bounds.width,
        depth: world.bounds.depth,
        hasTerrain: !!world.terrain,
        hasAerial: !!world.aerial,
        isComposition: !!world.composition,
        bounds: inferSurveyBounds(world),
      };
      return { entry, document };
    }),
  );
  const unique = [...new Map(prepared.map((item) => [item.entry.id, item])).values()];
  const db = await database();
  const transaction = db.transaction(['entries', 'documents', 'settings'], 'readwrite');
  const done = transactionDone(transaction);
  // Attach rejection handling before awaiting individual requests; an aborted transaction can reject both.
  done.catch(() => {});
  try {
    const entries = transaction.objectStore('entries'),
      documents = transaction.objectStore('documents'),
      settings = transaction.objectStore('settings');
    const [existing, initialized] = await Promise.all([
      requestValue(entries.getAll()),
      requestValue(settings.get('initialized')),
    ]);
    const byId = new Map<string, SavedSurvey>(
      (existing as SavedSurvey[]).map((entry) => [entry.id, entry]),
    );
    const existingOnly = initializeOnly && initialized;
    // Initialization may refresh an existing index entry, but must never recreate a deleted copy.
    const candidates = existingOnly ? unique.filter((item) => byId.has(item.entry.id)) : unique;
    const newCount = candidates.filter((item) => !byId.has(item.entry.id)).length;
    if (existing.length + newCount > MAX_SNAPSHOTS) {
      transaction.abort();
      throw new Error(
        'The library has 100 saved copies. Export or remove a copy before saving more.',
      );
    }
    for (const item of candidates) {
      const previous = byId.get(item.entry.id);
      if (previous) {
        // Index fields are derived and can evolve; snapshot bytes and original save time are immutable.
        item.entry = { ...item.entry, savedAt: previous.savedAt };
        entries.put(item.entry);
        continue;
      }
      entries.put(item.entry);
      documents.put({ id: item.entry.id, document: item.document });
    }
    settings.put(true, 'initialized');
    await done;
    return existingOnly ? [] : candidates.map((item) => item.entry);
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      /* It may already be complete or aborted. */
    }
    throw error;
  }
}
export async function listSavedSurveys(): Promise<SavedSurvey[]> {
  const db = await database();
  const entries = (await requestValue(
    db.transaction('entries', 'readonly').objectStore('entries').getAll(),
  )) as SavedSurvey[];
  return entries.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || a.name.localeCompare(b.name));
}
export async function readSavedSurvey(id: string): Promise<WorldDocument> {
  const db = await database();
  const record = (await requestValue(
    db.transaction('documents', 'readonly').objectStore('documents').get(id),
  )) as { document: string } | undefined;
  if (!record) throw new Error('This saved survey is no longer in the library.');
  return migrateWorld(parseWorld(record.document));
}
export async function removeSavedSurvey(id: string): Promise<void> {
  const db = await database(),
    transaction = db.transaction(['entries', 'documents'], 'readwrite'),
    done = transactionDone(transaction);
  transaction.objectStore('entries').delete(id);
  transaction.objectStore('documents').delete(id);
  await done;
}
export function surveyStorageMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'QuotaExceededError')
    return 'Device storage is full. Export a world or remove an old saved copy to make room.';
  return error instanceof Error
    ? error.message
    : 'The survey library is unavailable. Export JSON to keep a durable copy.';
}
