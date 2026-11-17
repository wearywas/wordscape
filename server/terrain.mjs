import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import { validateBounds } from './maps.mjs';

const R = 6378137,
  CIRCUMFERENCE = 2 * Math.PI * R;
const USGS =
  'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples';
const TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const MIRROR = 'https://elevation-tiles-prod-eu.s3.eu-central-1.amazonaws.com/terrarium';
const ATTRIBUTION =
  'Mapzen / Tilezen terrain, hosted by AWS Open Data. Sources include USGS 3DEP, SRTM and GMTED2010; NOAA ETOPO1; ArcticDEM; Geoscience Australia; Austria DGM; Canada CDEM; EU-DEM / Copernicus; INEGI; LINZ; Kartverket; and the UK Environment Agency. Source-specific credits: https://github.com/tilezen/joerd/blob/master/docs/attribution.md';
const round = (value) => Math.round(value * 1000) / 1000;
const mercatorY = (latitude) => R * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
const cancelled = (signal) => {
  if (signal?.aborted) throw new Error('Terrain request cancelled.');
};

/** Matches the OSM converter's southwest scaled-Mercator frame, to its 1 mm rounding. */
export function buildTerrainGrid(input) {
  const bounds = validateBounds(input);
  const scale = Math.cos(((bounds.south + bounds.north) * Math.PI) / 360);
  const west = (R * bounds.west * Math.PI) / 180,
    south = mercatorY(bounds.south);
  const width = round(((R * (bounds.east - bounds.west) * Math.PI) / 180) * scale);
  const depth = round((mercatorY(bounds.north) - south) * scale);
  const spacing = Math.max(5, Math.ceil((Math.max(width, depth) / 64) * 1000) / 1000);
  const columns = Math.ceil(width / spacing) + 1,
    rows = Math.ceil(depth / spacing) + 1;
  const points = [],
    projected = [];
  for (let row = 0; row < rows; row++)
    for (let column = 0; column < columns; column++) {
      const x = west + (column * spacing) / scale,
        y = south + (row * spacing) / scale;
      projected.push([x, y]);
      points.push([
        column === 0 ? bounds.west : ((x / R) * 180) / Math.PI,
        row === 0 ? bounds.south : ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
      ]);
    }
  return {
    bounds,
    frame: {
      origin: { latitude: bounds.south, longitude: bounds.west },
      width,
      depth,
      mercatorScale: scale,
    },
    spacing,
    columns,
    rows,
    points,
    projected,
  };
}

async function boundedBytes(response, maxBytes) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Terrain provider returned HTTP ${response.status}.`);
  }
  if (!response.body) throw new Error('Terrain provider returned no data.');
  const reader = response.body.getReader(),
    chunks = [];
  let count = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    count += value.length;
    if (count > maxBytes) {
      await reader.cancel();
      throw new Error('Terrain provider response is too large.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export function decodeTerrarium(bytes) {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString('ascii', 12, 16) !== 'IHDR' ||
    bytes.readUInt32BE(16) !== 256 ||
    bytes.readUInt32BE(20) !== 256 ||
    bytes[24] !== 8
  )
    throw new Error('Expected a bounded 256×256, 8-bit Terrarium PNG.');
  const png = PNG.sync.read(bytes, { checkCRC: true });
  const heights = new Array(256 * 256);
  for (let index = 0; index < heights.length; index++) {
    const offset = index * 4;
    const height =
      png.data[offset] * 256 + png.data[offset + 1] + png.data[offset + 2] / 256 - 32768;
    heights[index] =
      png.data[offset + 3] === 0 || height === -32768 || height < -12000 || height > 10000
        ? null
        : height;
  }
  return heights;
}

async function parallel(items, count, action) {
  let cursor = 0,
    failure;
  await Promise.all(
    Array.from({ length: Math.min(count, items.length) }, async () => {
      while (cursor < items.length && !failure) {
        const item = items[cursor++];
        try {
          await action(item);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;
}

export function createTerrainService({
  env = process.env,
  fetchFn = fetch,
  cacheDir = path.resolve('.wordscape/terrain-cache'),
  timeoutMs = 75000,
} = {}) {
  const usgsUrl = env.WORDSCAPE_USGS_TERRAIN_URL || USGS;
  const tilesUrl = env.WORDSCAPE_TERRARIUM_URL || TILES;
  const mirrorUrl = env.WORDSCAPE_TERRARIUM_MIRROR_URL || MIRROR;
  let busy = false;
  const headers = { 'User-Agent': 'Wordscape/0.5 local terrain research prototype' };

  async function getUsgs(grid, signal) {
    const heights = Array(grid.points.length).fill(null),
      resolutions = [],
      names = new Set();
    const batches = [];
    for (let start = 0; start < grid.points.length; start += 900) batches.push(start);
    await parallel(batches, 2, async (start) => {
      cancelled(signal);
      const points = grid.points.slice(start, start + 900);
      const body = new URLSearchParams({
        geometry: JSON.stringify({ points, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryMultipoint',
        returnFirstValueOnly: 'true',
        interpolation: 'RSP_BilinearInterpolation',
        outFields: 'Name,Source',
        f: 'json',
      });
      const response = await fetchFn(usgsUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal,
      });
      const data = JSON.parse((await boundedBytes(response, 2 * 1024 * 1024)).toString('utf8'));
      if (!Array.isArray(data.samples) || data.error || data.samples.length > points.length)
        throw new Error('USGS returned an incomplete or invalid sample response.');
      const seen = new Set();
      for (const sample of data.samples) {
        const index = sample.locationId;
        if (!Number.isInteger(index) || index < 0 || index >= points.length || seen.has(index))
          throw new Error('USGS sample identities did not match the request.');
        seen.add(index);
        // Empty strings, null and NoData are unknown, never numeric zero.
        const value =
          typeof sample.value === 'number'
            ? sample.value
            : typeof sample.value === 'string' &&
                /^-?\d+(\.\d+)?(?:[eE][+-]?\d+)?$/.test(sample.value.trim())
              ? Number(sample.value)
              : NaN;
        if (Number.isFinite(value) && value >= -12000 && value <= 10000)
          heights[start + index] = round(value);
        if (
          Number.isFinite(sample.resolution) &&
          sample.resolution > 0 &&
          sample.resolution <= 100000
        )
          resolutions.push(sample.resolution);
        if (typeof sample.attributes?.Name === 'string')
          names.add(sample.attributes.Name.slice(0, 200));
      }
    });
    if (!heights.some((value) => value !== null))
      throw new Error('USGS has no elevation coverage for this selection.');
    const knownSf = names.size === 1 && names.has('CA_SanFrancisco_B23');
    return {
      heights,
      provider: 'usgs-3dep',
      resolution: resolutions.length ? Math.max(...resolutions) : undefined,
      datum: knownSf
        ? 'NAVD88 (CA_SanFrancisco_B23; GEOID18)'
        : 'USGS 3DEP source datum (normally NAVD88 in CONUS; local datum unverified)',
      url: usgsUrl,
      attribution:
        'USGS National Map 3D Elevation Program. Public-domain elevation data courtesy of the U.S. Geological Survey.',
      tiles: 0,
      requests: batches.length,
      notes: `USGS source raster(s): ${[...names].join(', ') || 'not reported'}. Native resolution is the coarsest reported sample resolution, not vertical accuracy. Retrieval date is not acquisition date. Missing samples remain null.`,
      warnings: knownSf
        ? []
        : [
            'The local 3DEP vertical datum was not independently verified; NAVD88 is typical within the conterminous United States.',
          ],
    };
  }

  async function getGlobal(grid, signal) {
    const scale = grid.frame.mercatorScale;
    let zoom = Math.min(
      15,
      Math.max(0, Math.ceil(Math.log2((CIRCUMFERENCE * scale) / (256 * grid.spacing)))),
    );
    let pixels, addresses;
    while (true) {
      const size = 256 * 2 ** zoom;
      pixels = grid.projected.map(([x, y]) => [
        (x / CIRCUMFERENCE + 0.5) * size - 0.5,
        (0.5 - y / CIRCUMFERENCE) * size - 0.5,
      ]);
      addresses = new Set();
      for (const [px, py] of pixels)
        for (const x of [Math.floor(px), Math.floor(px) + 1])
          for (const y of [Math.floor(py), Math.floor(py) + 1])
            addresses.add(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`);
      if (addresses.size <= 16 || zoom === 0) break;
      zoom--;
    }
    const decoded = new Map(),
      warnings = [],
      imagery = new Set();
    await parallel([...addresses], 3, async (address) => {
      cancelled(signal);
      const url = `${tilesUrl}/${zoom}/${address}.png`;
      let response;
      try {
        response = await fetchFn(url, { headers, signal });
      } catch (error) {
        if (signal.aborted || tilesUrl !== TILES) throw error;
        response = await fetchFn(`${mirrorUrl}/${zoom}/${address}.png`, { headers, signal });
        warnings.push('The AWS European replica supplied one or more terrain tiles.');
      }
      if ([404, 410].includes(response.status)) {
        await response.body?.cancel();
        decoded.set(address, null);
        return;
      }
      const metadata =
        response.headers.get('x-amz-meta-sources') || response.headers.get('x-imagery-sources');
      if (metadata) imagery.add(metadata.slice(0, 1500));
      decoded.set(address, decodeTerrarium(await boundedBytes(response, 2 * 1024 * 1024)));
    });
    const sample = (x, y) =>
      decoded.get(`${Math.floor(x / 256)}/${Math.floor(y / 256)}`)?.[
        (((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)
      ] ?? null;
    const heights = pixels.map(([px, py]) => {
      const x = Math.floor(px),
        y = Math.floor(py),
        dx = px - x,
        dy = py - y;
      const weighted = [
        [sample(x, y), (1 - dx) * (1 - dy)],
        [sample(x + 1, y), dx * (1 - dy)],
        [sample(x, y + 1), (1 - dx) * dy],
        [sample(x + 1, y + 1), dx * dy],
      ].filter(([, weight]) => weight > 1e-12);
      return weighted.some(([value]) => value === null)
        ? null
        : round(weighted.reduce((sum, [value, weight]) => sum + value * weight, 0));
    });
    if (!heights.some((value) => value !== null))
      throw new Error('No elevation coverage was available for this selection.');
    return {
      heights,
      provider: 'mapzen-terrarium',
      sampledResolution: round((CIRCUMFERENCE * scale) / (256 * 2 ** zoom)),
      datum: 'Mixed source vertical datums; local datum not established',
      url: 'https://registry.opendata.aws/terrain-tiles/',
      attribution: ATTRIBUTION,
      tiles: addresses.size,
      requests: addresses.size,
      notes: `Mapzen/Tilezen Terrarium zoom ${zoom}; bilinear raster sampling. Tile pixel pitch is sampledResolution; native DEM resolution and acquisition date are unknown and deliberately omitted. Tiles may include bathymetry below water. ${imagery.size ? `Reported contributors: ${[...imagery].join('; ').slice(0, 3000)}` : 'Tile source metadata was not provided.'}`,
      warnings: [
        ...new Set(warnings),
        'Global terrain is a multi-source visualization DEM. Native resolution, local vertical datum and acquisition dates are not established; pixel spacing is not survey accuracy.',
      ],
    };
  }

  return {
    provider: 'USGS 3DEP with worldwide Mapzen / AWS terrain fallback',
    async extract(input, callerSignal) {
      const grid = buildTerrainGrid(input);
      cancelled(callerSignal);
      const key = createHash('sha256')
        .update(JSON.stringify({ version: 1, bounds: grid.bounds, usgsUrl, tilesUrl }))
        .digest('hex');
      const file = path.join(cacheDir, `${key}.json`);
      try {
        if ((await stat(file)).size <= 512 * 1024) {
          const cached = JSON.parse(await readFile(file, 'utf8')),
            age = Date.now() - cached.cachedAt;
          const ttl = cached.diagnostics?.warnings?.some(
            (note) => typeof note === 'string' && note.startsWith('USGS elevation was unavailable'),
          )
            ? 5 * 60000
            : 7 * 86400000;
          if (
            age >= 0 &&
            age < ttl &&
            JSON.stringify(cached.bounds) === JSON.stringify(grid.bounds) &&
            JSON.stringify(cached.frame) === JSON.stringify(grid.frame) &&
            cached.source?.id === cached.terrain?.sourceId &&
            typeof cached.source?.url === 'string' &&
            Array.isArray(cached.diagnostics?.warnings) &&
            cached.terrain?.spacing === grid.spacing &&
            cached.terrain?.columns === grid.columns &&
            cached.terrain?.rows === grid.rows &&
            Array.isArray(cached.terrain.heights) &&
            cached.terrain.heights.length === grid.points.length &&
            cached.terrain.heights.every(
              (value) =>
                value === null || (Number.isFinite(value) && value >= -12000 && value <= 10000),
            )
          ) {
            cancelled(callerSignal);
            return { ...cached, cached: true };
          }
        }
      } catch {
        /* Optional cache misses/corruption do not block acquisition. */
      }
      cancelled(callerSignal);
      if (busy) throw new Error('Another terrain request is running. Wait for it to finish.');
      busy = true;
      const signal = AbortSignal.any([
        callerSignal ?? new AbortController().signal,
        AbortSignal.timeout(timeoutMs),
      ]);
      try {
        let data;
        const warnings = [];
        const { west, east, south, north } = grid.bounds;
        if (
          west >= -125 &&
          east <= -66 &&
          south >= 24 &&
          north <= 50 &&
          env.WORDSCAPE_USGS_TERRAIN !== 'off'
        ) {
          const usgsTimeout = AbortSignal.any([
            signal,
            AbortSignal.timeout(Math.min(45000, timeoutMs)),
          ]);
          try {
            data = await getUsgs(grid, usgsTimeout);
          } catch (error) {
            cancelled(signal);
            warnings.push(
              `USGS elevation was unavailable; the complete grid uses the global terrain archive instead. ${error instanceof SyntaxError ? 'The provider returned invalid JSON.' : ''}`.trim(),
            );
          }
        }
        data ??= await getGlobal(grid, signal);
        cancelled(signal);
        const known = data.heights.filter((value) => value !== null),
          min = Math.min(...known),
          max = Math.max(...known);
        const sourceId = `terrain-${data.provider}-${key.slice(0, 12)}`;
        if (known.length < data.heights.length)
          warnings.push(
            `${data.heights.length - known.length} elevation samples have no coverage and remain null; terrain-grounded objects there are unresolved.`,
          );
        const terrain = {
          type: 'height-grid',
          columns: grid.columns,
          rows: grid.rows,
          spacing: grid.spacing,
          origin: { x: 0, y: 0 },
          heights: data.heights,
          verticalDatum: data.datum,
          referenceElevation: Math.floor(min / 10) * 10,
          sourceId,
          ...(data.resolution ? { sourceResolution: data.resolution } : {}),
          ...(data.sampledResolution ? { sampledResolution: data.sampledResolution } : {}),
          interpolation: 'bilinear',
          notes: data.notes,
        };
        const source = {
          id: sourceId,
          title:
            data.provider === 'usgs-3dep'
              ? 'USGS 3DEP terrain sample'
              : 'Mapzen / AWS Terrain Tiles',
          url: data.url,
          attribution: data.attribution,
          accessed: new Date().toISOString().slice(0, 10),
          notes: data.notes,
        };
        const result = {
          bounds: grid.bounds,
          frame: grid.frame,
          terrain,
          source,
          diagnostics: {
            provider: data.provider,
            tiles: data.tiles,
            requests: data.requests,
            validSamples: known.length,
            totalSamples: data.heights.length,
            min,
            max,
            warnings: [...warnings, ...data.warnings],
          },
          cached: false,
          cachedAt: Date.now(),
        };
        try {
          await mkdir(cacheDir, { recursive: true });
          await writeFile(file, JSON.stringify(result));
        } catch {
          result.diagnostics.warnings.push(
            'The optional terrain cache could not be written; downloaded elevation remains available.',
          );
        }
        return result;
      } catch (error) {
        if (signal.aborted)
          throw new Error(
            callerSignal?.aborted
              ? 'Terrain request cancelled.'
              : 'Terrain request timed out; no replacement heights were invented.',
            { cause: error },
          );
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}
