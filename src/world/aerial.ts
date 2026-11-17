import { migrateWorld, validateWorld } from './document';
import type { GeographicBounds, WorldDocument } from './types';
import specimenGeoreference from '../../public/reference/washington-square-georeference.json' with { type: 'json' };

export const USGS_OVERVIEW_URL =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer';
export const USGS_NAIP_URL =
  'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer';
export const USDA_NAIP_URL =
  'https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer';
export const USGS_ATTRIBUTION = 'USGS / USDA · The National Map';
export const USGS_CREDITS_URL =
  'https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map';
const EARTH_RADIUS = 6378137;
const toRadians = Math.PI / 180;

export function isGeographicBounds(value: unknown): value is GeographicBounds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const box = value as GeographicBounds;
  return (
    [box.west, box.south, box.east, box.north].every(Number.isFinite) &&
    box.west >= -180 &&
    box.east <= 180 &&
    box.west < box.east &&
    box.south >= -85 &&
    box.north <= 85 &&
    box.south < box.north
  );
}
export function mercatorPoint(longitude: number, latitude: number): [number, number] {
  return [
    EARTH_RADIUS * longitude * toRadians,
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (latitude * toRadians) / 2)),
  ];
}
export function mercatorLatLng(east: number, north: number): [number, number] {
  return [
    (2 * Math.atan(Math.exp(north / EARTH_RADIUS)) - Math.PI / 2) / toRadians,
    east / EARTH_RADIUS / toRadians,
  ];
}

/** Extent interpolation is linear in Web Mercator, not in latitude. Does not alter stored placements. */
export function localToLatLng(
  bounds: GeographicBounds,
  size: WorldDocument['bounds'],
  x: number,
  y: number,
): [number, number] {
  const sw = mercatorPoint(bounds.west, bounds.south),
    ne = mercatorPoint(bounds.east, bounds.north);
  return mercatorLatLng(
    sw[0] + ((ne[0] - sw[0]) * x) / size.width,
    sw[1] + ((ne[1] - sw[1]) * y) / size.depth,
  );
}

/** Recover only a recorded importer frame, matching source bbox, or the verified retained specimen frame. */
export function inferSurveyBounds(world: WorldDocument): GeographicBounds | undefined {
  if (world.imaginary) return undefined;
  if (world.aerial && isGeographicBounds(world.aerial.bounds)) return { ...world.aerial.bounds };
  const specimenBounds = specimenGeoreference.geographicBoundsEPSG4326;
  if (
    world.origin.latitude === specimenBounds.south &&
    world.origin.longitude === specimenBounds.west &&
    world.bounds.width === specimenGeoreference.worldBoundsMetres.width &&
    world.bounds.depth === specimenGeoreference.worldBoundsMetres.depth &&
    world.sources.some(
      (source) =>
        source.id === 'naip-2024' &&
        source.url === specimenGeoreference.sourceService &&
        source.notes.includes(specimenGeoreference.rasterName) &&
        source.notes.includes(specimenGeoreference.image),
    )
  )
    return { ...specimenBounds };
  const sources = world.sources.filter(
    (source) => source.id === 'osm-extract' || source.title === 'OpenStreetMap extract',
  );
  if (!sources.length) return undefined;
  const frame =
    /^Southwest local frame; x east, y north\. Web Mercator scaled by ([0-9.eE+-]+)\./.exec(
      world.origin.note,
    );
  const scale = frame ? Number(frame[1]) : undefined;
  if (scale !== undefined && Number.isFinite(scale) && scale > 0 && scale <= 1) {
    const sw = mercatorPoint(world.origin.longitude, world.origin.latitude);
    const [north, east] = mercatorLatLng(
      sw[0] + world.bounds.width / scale,
      sw[1] + world.bounds.depth / scale,
    );
    const bounds = { west: world.origin.longitude, south: world.origin.latitude, east, north };
    if (isGeographicBounds(bounds)) return bounds;
  }
  for (const source of sources) {
    let values: number[] | undefined;
    try {
      const parameter = new URL(source.url).searchParams.get('bbox');
      if (parameter) values = parameter.split(',').map(Number);
    } catch {
      continue;
    }
    if (!values || values.length !== 4) continue;
    const [west, south, east, north] = values,
      bounds = { west, south, east, north };
    if (!isGeographicBounds(bounds)) continue;
    const cosine = Math.cos(((south + north) / 2) * toRadians);
    const sw = mercatorPoint(west, south),
      ne = mercatorPoint(east, north);
    if (
      Math.abs(west - world.origin.longitude) < 1e-8 &&
      Math.abs(south - world.origin.latitude) < 1e-8 &&
      Math.abs((ne[0] - sw[0]) * cosine - world.bounds.width) < 0.02 &&
      Math.abs((ne[1] - sw[1]) * cosine - world.bounds.depth) < 0.02
    )
      return bounds;
  }
  return undefined;
}

/** Explicit opt-in persistence: add a reference and its provenance, preserving every existing object. */
export function attachAerialReference(
  world: WorldDocument,
  bounds: GeographicBounds,
  accessed = new Date().toISOString().slice(0, 10),
): WorldDocument {
  if (world.imaginary)
    throw new Error('Imaginary worlds cannot receive a geographic imagery reference.');
  if (!isGeographicBounds(bounds))
    throw new Error('The aerial reference needs finite, ordered bounds within ±85° latitude.');
  const next = migrateWorld(world);
  let source = next.sources.find(
    (item) => item.url === USDA_NAIP_URL && item.title === 'USGS / USDA online imagery reference',
  );
  if (!source) {
    let id = 'usgs-online-imagery',
      suffix = 2;
    while (next.sources.some((item) => item.id === id)) id = `usgs-online-imagery-${suffix++}`;
    source = {
      id,
      title: 'USGS / USDA online imagery reference',
      url: USDA_NAIP_URL,
      attribution: USGS_ATTRIBUTION,
      accessed,
      notes: `Online reference only; image pixels are not stored in this document or GLB. USDA NAIP detail covers the conterminous United States; native resolution, capture dates and coverage vary. Overview service: ${USGS_OVERVIEW_URL} . Outside detailed coverage, imagery is coarser. Alaska overview imagery includes licensed SPOT data for viewing; do not infer redistribution rights. This is a live mosaic, not a fixed-date survey. USDA imagery terms: https://www.fpacbc.usda.gov/geospatial-services/customer-services . Overview terms and credits: ${USGS_CREDITS_URL}`,
    };
    next.sources.push(source);
  }
  next.aerial = {
    type: 'online-imagery',
    provider: 'usgs-imagery',
    bounds: { ...bounds },
    sourceId: source.id,
  };
  const errors = validateWorld(next).errors;
  if (errors.length) throw new Error(errors[0]);
  return next;
}

/** The detailed public-domain NAIP service covers CONUS; this is an extent screen, not a coverage guarantee. */
export function canRequestNaip(bounds: GeographicBounds): boolean {
  return (
    isGeographicBounds(bounds) &&
    bounds.west >= -124.84 &&
    bounds.east <= -66.85 &&
    bounds.south >= 24.49 &&
    bounds.north <= 49.58
  );
}

/** One bounded view request to a fixed service; imported documents cannot inject URLs or parameters. */
export function naipImageUrl(bounds: GeographicBounds, width: number, height: number): string {
  if (!isGeographicBounds(bounds)) throw new Error('Invalid imagery view bounds.');
  const sw = mercatorPoint(bounds.west, bounds.south),
    ne = mercatorPoint(bounds.east, bounds.north);
  const pixels = [width, height].map((value) =>
    Math.max(64, Math.min(1600, Math.round(Number.isFinite(value) ? value : 512))),
  );
  const parameters = new URLSearchParams({
    bbox: [...sw, ...ne].join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: pixels.join(','),
    format: 'jpgpng',
    f: 'image',
    returnSquarePixels: 'false',
  });
  return `${USDA_NAIP_URL}/exportImage?${parameters}`;
}
