import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMapService, validateBounds } from './maps.mjs';

const bounds = { west: -122.41, south: 37.8, east: -122.409, north: 37.801 };
const folders = [];
async function cache() {
  const folder = await mkdtemp(path.join(tmpdir(), 'wordscape-map-test-'));
  folders.push(folder);
  return folder;
}
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (!path.basename(folder).startsWith('wordscape-map-test-'))
      throw new Error('Unexpected test directory');
    await rm(folder, { recursive: true, force: true });
  }
});
const response = () =>
  new Response(JSON.stringify({ elements: [{ type: 'node', id: 1, lat: 37.8, lon: -122.41 }] }));

describe('bounded map provider and cache', () => {
  it('rejects invalid or excessive areas before any network request', () => {
    expect(() => validateBounds({ ...bounds, east: Infinity })).toThrow(/valid area/);
    expect(() => validateBounds({ ...bounds, east: -120 })).toThrow(/1 km/);
    expect(() => validateBounds({ ...bounds, west: 179, east: -179 })).toThrow(/date line/);
  });
  it('caches a valid result, ignores a corrupt cache, and never serves an aborted request', async () => {
    const cacheDir = await cache();
    const fetchFn = vi.fn().mockImplementation(async () => response());
    const service = createMapService({ cacheDir, fetchFn });
    expect((await service.extract(bounds)).cached).toBe(false);
    expect((await service.extract(bounds)).cached).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const query = fetchFn.mock.calls[0][1].body.get('data');
    expect(query).toContain('way["natural"="coastline"]');
    expect(query).toContain('nwr["natural"="water"]');
    const [filename] = await readdir(cacheDir);
    const saved = JSON.parse(await readFile(path.join(cacheDir, filename), 'utf8'));
    await writeFile(
      path.join(cacheDir, filename),
      JSON.stringify({ ...saved, bounds: { ...bounds, west: 0 } }),
    );
    expect((await service.extract(bounds)).cached).toBe(false);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await expect(service.extract(bounds, AbortSignal.abort())).rejects.toThrow(/cancelled/);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
  it('returns successful data when the optional cache cannot be written', async () => {
    const directory = await cache();
    const cacheDir = path.join(directory, 'not-a-directory');
    await writeFile(cacheDir, 'file');
    const service = createMapService({ cacheDir, fetchFn: async () => response() });
    const result = await service.extract(bounds);
    expect(result.format).toBe('overpass');
    expect(result.warnings.join(' ')).toMatch(/cache/i);
  });
  it('falls back once to the bounded OSM map endpoint and preserves provenance', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream unavailable'))
      .mockResolvedValueOnce(new Response('<osm version="0.6"></osm>'));
    const service = createMapService({ cacheDir: await cache(), fetchFn });
    const result = await service.extract(bounds);
    expect(result.format).toBe('osm-xml');
    expect(result.warnings).toHaveLength(1);
    expect(new URL(fetchFn.mock.calls[1][0]).searchParams.get('bbox')).toBe(
      '-122.41,37.8,-122.409,37.801',
    );
    expect(result.sourceUrl).toContain('bbox=');
  });
  it('cancels an active request without invoking fallback and releases the busy lock', async () => {
    let started;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            started();
          }),
      )
      .mockImplementation(async () => response());
    const service = createMapService({ cacheDir: await cache(), fetchFn });
    const controller = new AbortController();
    const active = service.extract(bounds, controller.signal);
    await ready;
    await expect(service.extract({ ...bounds, west: bounds.west - 0.0001 })).rejects.toThrow(
      /running/,
    );
    controller.abort();
    await expect(active).rejects.toThrow(/cancelled/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await service.extract(bounds)).format).toBe('overpass');
  });
  it('honors fallback-off and limits response bytes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('x'.repeat(8 * 1024 * 1024 + 1)));
    const service = createMapService({
      cacheDir: await cache(),
      fetchFn,
      env: { WORDSCAPE_OSM_FALLBACK: 'off' },
    });
    await expect(service.extract(bounds)).rejects.toThrow(/too much map data/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
