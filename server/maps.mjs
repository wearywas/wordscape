import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';

const LIMIT = 8 * 1024 * 1024;
const R = 6378137;
export function validateBounds(bounds) {
  if (
    !bounds ||
    typeof bounds !== 'object' ||
    Array.isArray(bounds) ||
    Object.keys(bounds).some((key) => !['west', 'south', 'east', 'north'].includes(key))
  )
    throw new Error('Provide geographic bounds.');
  const { west, south, east, north } = bounds;
  if (
    ![west, south, east, north].every(Number.isFinite) ||
    west < -180 ||
    east > 180 ||
    west >= east ||
    south < -85 ||
    north > 85 ||
    south >= north
  )
    throw new Error('Choose a valid area within 85° latitude, without crossing the date line.');
  const scale = Math.cos(((north + south) * Math.PI) / 360);
  const width = ((R * (east - west) * Math.PI) / 180) * scale;
  const depth =
    R *
    Math.log(
      Math.tan(Math.PI / 4 + (north * Math.PI) / 360) /
        Math.tan(Math.PI / 4 + (south * Math.PI) / 360),
    ) *
    scale;
  if (width < 5 || depth < 5 || width > 1000.01 || depth > 1000.01)
    throw new Error('Choose an area between 5 m and 1 km wide and deep.');
  return { west, south, east, north };
}
function query(bounds) {
  const box = [bounds.south, bounds.west, bounds.north, bounds.east].join(',');
  return `[out:json][timeout:25][maxsize:33554432];(nwr["building"](${box});way["building:part"](${box});way["highway"](${box});node["entrance"](${box});node["natural"="tree"](${box});nwr["leisure"~"^(park|garden|playground)$"](${box});way["landuse"="grass"](${box});nwr["natural"="water"](${box});way["natural"="coastline"](${box}););out body geom;`;
}
async function boundedText(response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Map provider returned ${response.status}.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Map provider returned no data.');
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > LIMIT) {
      await reader.cancel();
      throw new Error('This area contains too much map data. Choose a smaller area.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createMapService({
  env = process.env,
  fetchFn = fetch,
  cacheDir = path.resolve('.wordscape/map-cache'),
  timeoutMs = 30000,
} = {}) {
  const overpass = env.WORDSCAPE_OVERPASS_URL || 'https://overpass.private.coffee/api/interpreter';
  const api = env.WORDSCAPE_OSM_API_URL || 'https://api.openstreetmap.org/api/0.6/map';
  let busy = false;
  return {
    provider: overpass,
    async extract(input, signal) {
      const bounds = validateBounds(input);
      if (signal?.aborted) throw new Error('Map request cancelled.');
      const key = createHash('sha256')
        .update(JSON.stringify({ bounds, overpass, api, queryVersion: 2 }))
        .digest('hex');
      const file = path.join(cacheDir, `${key}.json`);
      let cached;
      try {
        if ((await stat(file)).size <= LIMIT * 2 + 16384) {
          const candidate = JSON.parse(await readFile(file, 'utf8'));
          const age = Date.now() - candidate.cachedAt;
          const sameBounds = JSON.stringify(candidate.bounds) === JSON.stringify(bounds);
          const validData =
            candidate.format === 'overpass'
              ? Array.isArray(candidate.data?.elements) && !candidate.data.remark
              : candidate.format === 'osm-xml' &&
                typeof candidate.data === 'string' &&
                /<osm(?:\s|>)/.test(candidate.data);
          if (
            Number.isFinite(age) &&
            age >= 0 &&
            age < 86400000 &&
            sameBounds &&
            validData &&
            Array.isArray(candidate.warnings) &&
            typeof candidate.sourceUrl === 'string' &&
            typeof candidate.accessed === 'string'
          )
            cached = candidate;
        }
      } catch {
        /* cache is optional */
      }
      if (signal?.aborted) throw new Error('Map request cancelled.');
      if (cached) return { ...cached, cached: true };
      if (busy) throw new Error('Another map request is running. Wait for it to finish.');
      busy = true;
      const headers = {
        'User-Agent':
          'Wordscape/0.5 (local research prototype; https://github.com/wearywas/wordscape)',
        Accept: 'application/json, application/xml, text/xml',
      };
      try {
        let result;
        const warnings = [];
        try {
          const response = await fetchFn(overpass, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ data: query(bounds) }),
            signal: AbortSignal.any([
              signal ?? new AbortController().signal,
              AbortSignal.timeout(timeoutMs),
            ]),
          });
          const data = JSON.parse(await boundedText(response));
          if (!Array.isArray(data.elements) || data.remark)
            throw new Error('Overpass returned an incomplete result.');
          result = { format: 'overpass', data, sourceUrl: overpass };
        } catch (error) {
          if (signal?.aborted) throw new Error('Map request cancelled.', { cause: error });
          if (env.WORDSCAPE_OSM_FALLBACK === 'off') throw error;
          warnings.push(
            'Overpass was unavailable. This bounded selection was retrieved through the OpenStreetMap map API.',
          );
          const url = new URL(api);
          url.searchParams.set(
            'bbox',
            [bounds.west, bounds.south, bounds.east, bounds.north].join(','),
          );
          const response = await fetchFn(url, {
            headers,
            signal: AbortSignal.any([
              signal ?? new AbortController().signal,
              AbortSignal.timeout(timeoutMs),
            ]),
          });
          const data = await boundedText(response);
          if (!/<osm(?:\s|>)/.test(data))
            throw new Error('The map provider did not return OSM data.', { cause: error });
          result = { format: 'osm-xml', data, sourceUrl: url.toString() };
        }
        const complete = {
          ...result,
          bounds,
          warnings,
          accessed: new Date().toISOString().slice(0, 10),
          cachedAt: Date.now(),
          cached: false,
        };
        if (signal?.aborted) throw new Error('Map request cancelled.');
        try {
          await mkdir(cacheDir, { recursive: true });
          await writeFile(file, JSON.stringify(complete));
        } catch {
          warnings.push(
            'The optional local map cache could not be written; the downloaded data is still available.',
          );
        }
        return complete;
      } catch (error) {
        if (signal?.aborted) throw new Error('Map request cancelled.', { cause: error });
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}
