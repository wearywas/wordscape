import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { buildTerrainGrid, createTerrainService, decodeTerrarium } from './terrain.mjs';

const sf = { west: -122.416, south: 37.807, east: -122.412, north: 37.81 };
const globalBounds = { west: 2.293, south: 48.857, east: 2.296, north: 48.86 };
const folders = [];
async function cache() {
  const value = await mkdtemp(path.join(tmpdir(), 'wordscape-terrain-test-'));
  folders.push(value);
  return value;
}
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (!path.basename(folder).startsWith('wordscape-terrain-test-'))
      throw new Error('Unexpected test directory');
    await rm(folder, { recursive: true, force: true });
  }
});
function tile(height = 42) {
  const png = new PNG({ width: 256, height: 256 });
  const value = height + 32768;
  for (let p = 0; p < png.data.length; p += 4) {
    png.data[p] = Math.floor(value / 256);
    png.data[p + 1] = Math.floor(value % 256);
    png.data[p + 2] = Math.round((value % 1) * 256);
    png.data[p + 3] = 255;
  }
  return PNG.sync.write(png);
}
function usgs(_url, options) {
  const parameters = new URLSearchParams(options.body);
  const points = JSON.parse(parameters.get('geometry')).points;
  return Promise.resolve(
    new Response(
      JSON.stringify({
        samples: points.map((point, index) => ({
          locationId: index,
          location: { x: point[0], y: point[1] },
          value: String(5 + index / 100),
          resolution: 1,
          attributes: { Name: 'CA_SanFrancisco_B23', Source: 'USGS' },
        })),
      }),
    ),
  );
}

describe('terrain extraction', () => {
  it('creates a bounded north-up regular grid covering the exact rounded world frame', () => {
    const grid = buildTerrainGrid(sf);
    expect(grid.columns).toBeLessThanOrEqual(65);
    expect(grid.rows).toBeLessThanOrEqual(65);
    expect(grid.frame.origin).toEqual({ latitude: sf.south, longitude: sf.west });
    expect(grid.points[0]).toEqual([sf.west, sf.south]);
    expect((grid.columns - 1) * grid.spacing).toBeGreaterThanOrEqual(grid.frame.width);
    expect((grid.rows - 1) * grid.spacing).toBeGreaterThanOrEqual(grid.frame.depth);
    expect(grid.points[grid.columns][1]).toBeGreaterThan(grid.points[0][1]);
    expect(() => buildTerrainGrid({ ...sf, east: 0 })).toThrow();
  });
  it('decodes metres and rejects malformed/oversized PNGs without inventing zero', () => {
    expect(decodeTerrarium(tile(-3.25))[0]).toBe(-3.25);
    const transparent = new PNG({ width: 256, height: 256 });
    expect(decodeTerrarium(PNG.sync.write(transparent))[0]).toBeNull();
    expect(() => decodeTerrarium(Buffer.from('invalid'))).toThrow(/PNG/);
  });
  it('uses reported USGS resolutions, maps samples by locationId and caches the result', async () => {
    const fetchFn = vi.fn(usgs);
    const service = createTerrainService({ cacheDir: await cache(), fetchFn });
    const result = await service.extract(sf);
    expect(result.diagnostics.provider).toBe('usgs-3dep');
    expect(result.terrain.sourceResolution).toBe(1);
    expect(result.terrain.verticalDatum).toContain('NAVD88');
    expect(result.terrain.acquired).toBeUndefined();
    expect(result.terrain.heights).toHaveLength(result.terrain.columns * result.terrain.rows);
    const count = fetchFn.mock.calls.length;
    expect((await service.extract(sf)).cached).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(count);
    await expect(service.extract(sf, AbortSignal.abort())).rejects.toThrow(/cancelled/);
  });
  it('retains partial no-data and never merges global bathymetry into a USGS grid', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            samples: [
              {
                locationId: 0,
                value: '10',
                resolution: 1,
                attributes: { Name: 'CA_SanFrancisco_B23' },
              },
            ],
          }),
        ),
    );
    const result = await createTerrainService({ cacheDir: await cache(), fetchFn }).extract(sf);
    expect(result.terrain.heights).toContain(null);
    expect(result.diagnostics.validSamples).toBeLessThan(result.diagnostics.totalSamples);
    expect(fetchFn.mock.calls.every(([url]) => String(url).includes('getSamples'))).toBe(true);
  });
  it('falls back globally with explicit unknown native resolution and retained negative heights', async () => {
    let usgsCalls = 0;
    const fetchFn = vi.fn(async (url, options) =>
      String(url).includes('getSamples')
        ? ++usgsCalls === 1
          ? new Response('unavailable', { status: 503 })
          : usgs(url, options)
        : new Response(tile(-5)),
    );
    const result = await createTerrainService({ cacheDir: await cache(), fetchFn }).extract(sf);
    expect(result.diagnostics.provider).toBe('mapzen-terrarium');
    expect(result.terrain.sourceResolution).toBeUndefined();
    expect(result.terrain.sampledResolution).toBeGreaterThan(0);
    expect(result.terrain.heights.every((v) => v === -5)).toBe(true);
    expect(result.diagnostics.warnings.join(' ')).toMatch(/USGS/);
    expect(usgsCalls).toBeLessThanOrEqual(2);
  });
  it('fails on complete missing coverage and limits provider response bytes', async () => {
    const noData = PNG.sync.write(new PNG({ width: 256, height: 256 }));
    await expect(
      createTerrainService({
        cacheDir: await cache(),
        fetchFn: async () => new Response(noData),
      }).extract(globalBounds),
    ).rejects.toThrow(/coverage/);
    await expect(
      createTerrainService({
        cacheDir: await cache(),
        fetchFn: async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
      }).extract(globalBounds),
    ).rejects.toThrow(/large/);
  });
  it('cancels requests without trying a fallback provider', async () => {
    let ready;
    const started = new Promise((resolve) => {
      ready = resolve;
    });
    const controller = new AbortController();
    const fetchFn = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('abort')), { once: true });
          ready();
        }),
    );
    const service = createTerrainService({ cacheDir: await cache(), fetchFn });
    const active = service.extract(sf, controller.signal);
    await started;
    controller.abort();
    await expect(active).rejects.toThrow(/cancelled/);
    expect(fetchFn.mock.calls.every(([url]) => String(url).includes('getSamples'))).toBe(true);
  });
});
