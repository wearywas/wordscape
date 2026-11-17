import http from 'node:http';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompanion } from './index.mjs';

const cleanup = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const folder = await mkdtemp(path.join(tmpdir(), 'wordscape-http-test-'));
  cleanup.push(async () => {
    if (!path.basename(folder).startsWith('wordscape-http-test-'))
      throw new Error('Unexpected test directory');
    await rm(folder, { recursive: true, force: true });
  });
  const dist = path.join(folder, 'dist');
  await mkdir(dist);
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>Wordscape</title>');
  const ai = {
    status: vi.fn(async () => ({ busy: false })),
    login: vi.fn(async () => ({ authUrl: 'https://auth.openai.com/' })),
    cancel: vi.fn(async () => ({ cancelled: true })),
    generate: vi.fn(async () => ({ proposal: {} })),
    generateWorld: vi.fn(async () => ({ proposal: { additions: [] } })),
    close: vi.fn(async () => {}),
  };
  const maps = { provider: 'test', extract: vi.fn(async () => ({ data: {} })) };
  const terrain = {
    provider: 'test-terrain',
    extract: vi.fn(async () => ({
      terrain: { heights: [10, 11, 12, 13] },
      diagnostics: { provider: 'test-terrain' },
    })),
  };
  const companion = createCompanion({ ai, maps, terrain, port: 8787, dist });
  await new Promise((resolve) => companion.server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => companion.close());
  const request = (url, { method = 'GET', body, headers = {} } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: companion.server.address().port,
          path: url,
          method,
          headers: { Host: '127.0.0.1:8787', ...headers },
        },
        (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              text: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  const status = await request('/api/status');
  const token = JSON.parse(status.text).token;
  const headers = {
    Origin: 'http://127.0.0.1:5173',
    'Content-Type': 'application/json',
    'X-Wordscape-Token': token,
  };
  return { request, ai, maps, terrain, folder, dist, headers, status, companion };
}

describe('local companion HTTP boundary', () => {
  it('routes world proposals with the same CSRF boundary and a separate bounded full-document allowance', async () => {
    const { request, ai, headers } = await setup();
    const body = JSON.stringify({
      provider: 'codex',
      mode: 'revise',
      world: { text: 'x'.repeat(300 * 1024) },
    });
    expect(
      (
        await request('/api/ai/world', {
          method: 'POST',
          body,
          headers: { ...headers, 'X-Wordscape-Token': 'wrong' },
        })
      ).status,
    ).toBe(403);
    expect(ai.generateWorld).not.toHaveBeenCalled();
    expect((await request('/api/ai/world', { method: 'POST', body, headers })).status).toBe(200);
    expect(ai.generateWorld).toHaveBeenCalledTimes(1);
    expect((await request('/api/ai/generate', { method: 'POST', body, headers })).status).toBe(413);
    expect(
      (
        await request('/api/ai/world', {
          method: 'POST',
          body: 'x'.repeat(16 * 1024 * 1024 + 16385),
          headers,
        })
      ).status,
    ).toBe(413);
  });
  it('routes a bounded terrain request through the same origin and token boundary', async () => {
    const { request, terrain, headers } = await setup();
    const bounds = { west: 1, south: 2, east: 1.001, north: 2.001 };
    expect(
      (
        await request('/api/terrain/extract', {
          method: 'POST',
          body: JSON.stringify({ bounds }),
          headers: { ...headers, 'X-Wordscape-Token': 'wrong' },
        })
      ).status,
    ).toBe(403);
    expect(terrain.extract).not.toHaveBeenCalled();
    const result = await request('/api/terrain/extract', {
      method: 'POST',
      body: JSON.stringify({ bounds }),
      headers,
    });
    expect(result.status).toBe(200);
    expect(JSON.parse(result.text).diagnostics.provider).toBe('test-terrain');
    expect(terrain.extract.mock.calls[0][0]).toEqual(bounds);
    expect(terrain.extract.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });
  it('rejects untrusted origins and Host values before exposing the status token', async () => {
    const { request, status } = await setup();
    expect(status.status).toBe(200);
    expect(status.headers['cache-control']).toBe('no-store');
    expect(
      (await request('/api/status', { headers: { Origin: 'https://evil.test' } })).status,
    ).toBe(403);
    expect((await request('/api/status', { headers: { Host: 'evil.test:8787' } })).status).toBe(
      403,
    );
    expect(
      (await request('/api/status', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
    ).toBe(403);
  });
  it('requires the origin, token and exact JSON media type for mutations', async () => {
    const { request, ai, headers } = await setup();
    expect(
      (
        await request('/api/ai/login', {
          method: 'POST',
          body: '{}',
          headers: { ...headers, 'X-Wordscape-Token': 'wrong' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/ai/login', {
          method: 'POST',
          body: '{}',
          headers: { ...headers, 'Content-Type': 'application/jsonp' },
        })
      ).status,
    ).toBe(403);
    const missingOrigin = { ...headers };
    delete missingOrigin.Origin;
    expect(
      (await request('/api/ai/login', { method: 'POST', body: '{}', headers: missingOrigin }))
        .status,
    ).toBe(403);
    expect(ai.login).not.toHaveBeenCalled();
    expect((await request('/api/ai/login', { method: 'POST', body: '{}', headers })).status).toBe(
      200,
    );
    expect(ai.login).toHaveBeenCalledTimes(1);
  });
  it('returns useful errors for invalid JSON and excessive request bodies', async () => {
    const { request, ai, headers } = await setup();
    expect(
      (await request('/api/ai/login', { method: 'POST', body: 'invalid', headers })).status,
    ).toBe(400);
    expect(
      (
        await request('/api/ai/login', {
          method: 'POST',
          body: 'x'.repeat(256 * 1024 + 1),
          headers,
        })
      ).status,
    ).toBe(413);
    expect(ai.login).not.toHaveBeenCalled();
  });
  it('serves built files and rejects encoded traversal or a symlink leaving dist', async () => {
    const { request, folder, dist } = await setup();
    await writeFile(path.join(folder, 'private.txt'), 'private');
    await mkdir(path.join(folder, 'outside'));
    await writeFile(path.join(folder, 'outside', 'private.txt'), 'private');
    await symlink(path.join(folder, 'outside'), path.join(dist, 'linked'), 'junction');
    const page = await request('/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Wordscape');
    expect((await request('/', { method: 'HEAD' })).text).toBe('');
    expect((await request('/%2e%2e%2fprivate.txt')).status).toBe(403);
    expect((await request('/linked/private.txt')).status).toBe(403);
  });
  it('cancels only its active AI request when the browser disconnects', async () => {
    const { request, ai, headers, companion } = await setup();
    let started;
    let finish;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    ai.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
          started();
        }),
    );
    let cancelled;
    const cancelledPromise = new Promise((resolve) => {
      cancelled = resolve;
    });
    ai.cancel.mockImplementation(async () => {
      cancelled();
      finish({ proposal: {} });
      return { cancelled: true };
    });
    const active = http.request({
      hostname: '127.0.0.1',
      port: companion.server.address().port,
      path: '/api/ai/generate',
      method: 'POST',
      headers: { Host: '127.0.0.1:8787', ...headers },
    });
    active.on('error', () => {});
    active.end('{}');
    await ready;
    expect(
      (await request('/api/ai/generate', { method: 'POST', headers, body: '{}' })).status,
    ).toBe(409);
    expect(ai.cancel).not.toHaveBeenCalled();
    active.destroy();
    await cancelledPromise;
    expect(ai.cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['browser disconnect', 'server shutdown'])('aborts map fetches on %s', async (mode) => {
    const { maps, headers, companion } = await setup();
    let started;
    let aborted;
    const ready = new Promise((resolve) => {
      started = resolve;
    });
    const stopped = new Promise((resolve) => {
      aborted = resolve;
    });
    maps.extract.mockImplementation(
      (_bounds, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted();
              reject(new Error('Cancelled'));
            },
            { once: true },
          );
          started();
        }),
    );
    const active = http.request({
      hostname: '127.0.0.1',
      port: companion.server.address().port,
      path: '/api/maps/extract',
      method: 'POST',
      headers: { Host: '127.0.0.1:8787', ...headers },
    });
    active.on('error', () => {});
    active.end('{"bounds":{}}');
    await ready;
    if (mode === 'browser disconnect') active.destroy();
    else await companion.close();
    await stopped;
  });
});
