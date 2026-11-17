import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiService } from './ai.mjs';
import { createMapService } from './maps.mjs';
import { createTerrainService } from './terrain.mjs';
import { MAX_WORLD_REQUEST_BYTES } from '../src/world/worldGeneration.ts';

export function createCompanion({
  ai = createAiService(),
  maps = createMapService(),
  terrain = createTerrainService(),
  port = 8787,
  dist = path.resolve('dist'),
} = {}) {
  let activeAiRequest = null;
  const mapRequests = new Set();
  let closing;
  const token = randomBytes(32).toString('hex');
  const origins = new Set(
    [5173, 4173, port].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]),
  );
  const hosts = new Set([...origins].map((origin) => new URL(origin).host));
  const json = (res, status, value) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (
        !hosts.has(req.headers.host) ||
        (req.headers.origin && !origins.has(req.headers.origin)) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        return json(res, 403, { error: 'Only this local Wordscape app can access the companion.' });
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/status')
          return json(res, 200, {
            token,
            ai: await ai.status(),
            maps: {
              provider: maps.provider,
              tileUrl:
                process.env.WORDSCAPE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            },
            terrain: { available: true },
          });
        if (req.method === 'GET' && url.pathname === '/api/ai/status')
          return json(res, 200, await ai.status());
        if (req.method !== 'POST') return json(res, 404, { error: 'Unknown endpoint.' });
        if (
          !origins.has(req.headers.origin) ||
          req.headers['x-wordscape-token'] !== token ||
          String(req.headers['content-type']).split(';')[0].trim().toLowerCase() !==
            'application/json'
        )
          return json(res, 403, { error: 'Refresh Wordscape before making this request.' });
        let size = 0;
        const bodyLimit = url.pathname === '/api/ai/world' ? MAX_WORLD_REQUEST_BYTES : 256 * 1024;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > bodyLimit) return json(res, 413, { error: 'Request too large.' });
          chunks.push(chunk);
        }
        let body;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
          return json(res, 400, { error: 'Request must be JSON.' });
        }
        if (url.pathname === '/api/ai/login') return json(res, 200, await ai.login());
        if (url.pathname === '/api/ai/cancel') return json(res, 200, await ai.cancel());
        if (url.pathname === '/api/ai/generate' || url.pathname === '/api/ai/world') {
          if (activeAiRequest)
            return json(res, 409, {
              error: 'A generation is already running. Cancel it before starting another.',
            });
          const owner = Symbol('generation');
          activeAiRequest = owner;
          res.on('close', () => {
            if (!res.writableEnded && activeAiRequest === owner) void ai.cancel();
          });
          try {
            const result = await (url.pathname === '/api/ai/world'
              ? ai.generateWorld(body)
              : ai.generate(body));
            if (!res.destroyed) json(res, 200, result);
          } finally {
            if (activeAiRequest === owner) activeAiRequest = null;
          }
          return;
        }
        if (url.pathname === '/api/maps/extract' || url.pathname === '/api/terrain/extract') {
          const controller = new AbortController();
          mapRequests.add(controller);
          res.on('close', () => {
            if (!res.writableEnded) controller.abort();
          });
          try {
            const service = url.pathname === '/api/terrain/extract' ? terrain : maps;
            const result = await service.extract(body.bounds, controller.signal);
            if (!res.destroyed) json(res, 200, result);
          } finally {
            mapRequests.delete(controller);
          }
          return;
        }
        return json(res, 404, { error: 'Unknown endpoint.' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return json(res, 405, { error: 'Method not allowed.' });
      let name = decodeURIComponent(url.pathname);
      if (name === '/') name = '/index.html';
      const file = path.resolve(dist, `.${name}`);
      if (!file.startsWith(`${path.resolve(dist)}${path.sep}`))
        return json(res, 403, { error: 'Invalid path.' });
      const [realRoot, realFile] = await Promise.all([realpath(dist), realpath(file)]);
      if (!realFile.startsWith(`${realRoot}${path.sep}`))
        return json(res, 403, { error: 'Invalid path.' });
      if (!(await stat(file)).isFile()) return json(res, 404, { error: 'Not found.' });
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.woff2': 'font/woff2',
        '.woff': 'font/woff',
      };
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch (error) {
      if (!res.headersSent && !res.destroyed)
        json(res, error?.code === 'ENOENT' ? 404 : 400, {
          error:
            error?.code === 'ENOENT'
              ? 'Build the app first with npm run build.'
              : error instanceof Error
                ? error.message
                : 'Request failed.',
        });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 100;
  return {
    server,
    close: () => {
      closing ??= (async () => {
        const stopped = new Promise((resolve) => server.close(resolve));
        for (const controller of mapRequests) controller.abort();
        try {
          await ai.close();
        } finally {
          server.closeAllConnections();
        }
        await stopped;
      })();
      return closing;
    },
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.WORDSCAPE_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid WORDSCAPE_PORT.');
  const companion = createCompanion({ port });
  companion.server.listen(port, '127.0.0.1', () =>
    process.stdout.write(`Wordscape companion: http://127.0.0.1:${port}\n`),
  );
  for (const event of ['SIGINT', 'SIGTERM'])
    process.on(event, () => void companion.close().finally(() => process.exit(0)));
}
