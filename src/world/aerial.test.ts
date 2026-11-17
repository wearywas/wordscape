import { describe, expect, it } from 'vitest';
import {
  attachAerialReference,
  canRequestNaip,
  inferSurveyBounds,
  localToLatLng,
  mercatorPoint,
  naipImageUrl,
  USDA_NAIP_URL,
} from './aerial';
import { convertOsmToWorld, geographicFrame } from '../imports/osm';
import { boundsAround } from '../imports/area';
import { migrateWorld, parseWorld, serializeWorld, validateWorld } from './document';
import { createContainerPacket } from './packet';
import type { WorldDocument } from './types';
import baselineV1 from '../data/washingtonSquare.v0.1.json';
import specimenGeoreference from '../../public/reference/washington-square-georeference.json';

const bounds = boundsAround(37.808415, -122.416635, 360);
function fixture(): WorldDocument {
  return convertOsmToWorld(
    {
      elements: [
        { type: 'node', id: 1, lat: 37.808415, lon: -122.416635, tags: { natural: 'tree' } },
      ],
    },
    {
      bounds,
      sourceUrl: `https://api.openstreetmap.org/api/0.6/map?bbox=${[bounds.west, bounds.south, bounds.east, bounds.north].join(',')}`,
      accessed: '2026-11-16',
    },
  ).world;
}
describe('portable online aerial references', () => {
  it('recovers the retained specimen frame for an edited older copy without replacing its content', () => {
    const world = structuredClone(baselineV1) as WorldDocument;
    world.name = 'My renamed and edited specimen';
    world.objects[0].x += 2;
    world.objects[0].evidence = 'authored';
    const before = JSON.stringify(world);
    expect(inferSurveyBounds(world)).toEqual(specimenGeoreference.geographicBoundsEPSG4326);
    expect(JSON.stringify(world)).toBe(before);
    world.bounds.width = 361;
    expect(inferSurveyBounds(world)).toBeUndefined();
    world.bounds.width = 360;
    world.origin.longitude += 0.000001;
    expect(inferSurveyBounds(world)).toBeUndefined();
    world.origin.longitude = specimenGeoreference.geographicBoundsEPSG4326.west;
    world.sources.find((source) => source.id === 'naip-2024')!.notes = 'Unrelated image';
    expect(inferSurveyBounds(world)).toBeUndefined();
  });
  it('recovers exact importer coordinates without mutating a legacy world or guessing generic origins', () => {
    const world = fixture(),
      before = JSON.stringify(world);
    const recovered = inferSurveyBounds(world)!;
    expect(recovered.west).toBe(bounds.west);
    expect(recovered.south).toBe(bounds.south);
    const a = mercatorPoint(recovered.east, recovered.north),
      b = mercatorPoint(bounds.east, bounds.north);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.003);
    expect(JSON.stringify(world)).toBe(before);
    world.origin.note = 'Approximate southwest origin';
    expect(inferSurveyBounds(world)).toEqual(bounds);
    world.bounds.width += 10;
    expect(inferSurveyBounds(world)).toBeUndefined();
    world.sources = [];
    expect(inferSurveyBounds(world)).toBeUndefined();
  });
  it('uses Mercator interpolation, including high latitudes and both southwest/northeast corners', () => {
    const high = boundsAround(70, 20, 1000),
      size = geographicFrame(high);
    const sw = localToLatLng(high, size, 0, 0),
      ne = localToLatLng(high, size, size.width, size.depth);
    expect(sw[0]).toBeCloseTo(high.south, 11);
    expect(sw[1]).toBeCloseTo(high.west, 11);
    expect(ne[0]).toBeCloseTo(high.north, 11);
    expect(ne[1]).toBeCloseTo(high.east, 11);
    const middle = localToLatLng(high, size, size.width / 2, size.depth / 2);
    expect(middle[0]).not.toBe((high.south + high.north) / 2);
    expect(mercatorPoint(middle[1], middle[0])[1]).toBeCloseTo(
      (mercatorPoint(high.west, high.south)[1] + mercatorPoint(high.east, high.north)[1]) / 2,
      6,
    );
  });
  it('persists only the provider reference and provenance, retaining every placement and source fact', () => {
    const original = fixture(),
      next = attachAerialReference(original, bounds, '2026-11-16');
    expect(next.version).toBe('0.8');
    expect(next.objects).toEqual(original.objects);
    expect(next.objects).not.toBe(original.objects);
    expect(original.aerial).toBeUndefined();
    expect(next.aerial).toEqual({
      type: 'online-imagery',
      provider: 'usgs-imagery',
      bounds,
      sourceId: 'usgs-online-imagery',
    });
    expect(next.sources.at(-1)?.url).toBe(USDA_NAIP_URL);
    expect(parseWorld(serializeWorld(next))).toEqual(next);
    expect(attachAerialReference(next, bounds, '2026-11-17').sources).toEqual(next.sources);
    expect(
      createContainerPacket(next, next.objects[0].id).sources.some(
        (source) => source.id === next.aerial!.sourceId,
      ),
    ).toBe(true);
  });
  it('rejects unsupported providers, imported network URLs, dangling sources, invalid extents and legacy aerial fields', () => {
    const valid = attachAerialReference(fixture(), bounds);
    for (const patch of [
      { provider: 'other' },
      { url: 'https://untrusted.example/tiles' },
      { sourceId: 'missing' },
      { bounds: { ...bounds, east: bounds.west } },
      { bounds: { ...bounds, north: 86 } },
    ]) {
      const next = structuredClone(valid);
      Object.assign(next.aerial!, patch);
      expect(validateWorld(next).errors.length).toBeGreaterThan(0);
    }
    const legacy = { ...valid, version: '0.4' as const };
    expect(validateWorld(legacy).errors.join(' ')).toMatch(/0.5/);
  });
  it('keeps requests allowlisted and bounded without claiming detail outside NAIP coverage', () => {
    const url = new URL(naipImageUrl(bounds, 1e9, NaN));
    expect(url.href.startsWith(`${USDA_NAIP_URL}/exportImage?`)).toBe(true);
    expect(url.searchParams.get('size')).toBe('1600,512');
    expect(url.searchParams.get('bboxSR')).toBe('3857');
    expect(canRequestNaip(bounds)).toBe(true);
    expect(canRequestNaip(boundsAround(51.5, -0.1, 360))).toBe(false);
    expect(() => naipImageUrl({ ...bounds, west: 180, east: -180 }, 500, 500)).toThrow();
  });
});
describe('version0.5 elevation resolution semantics', () => {
  it('permits honest unknown native resolution only in0.5 and preserves legacy known values', () => {
    const world = migrateWorld(fixture());
    world.terrain = {
      type: 'height-grid',
      columns: 2,
      rows: 2,
      spacing: 360,
      origin: { x: 0, y: 0 },
      heights: [10, 11, 12, 13],
      verticalDatum: 'Mixed sources; datum uncertain',
      referenceElevation: 10,
      sourceId: world.sources[0].id,
      sampledResolution: 4.7,
      interpolation: 'bilinear',
    };
    expect(validateWorld(world).errors).toEqual([]);
    expect(parseWorld(serializeWorld(world)).terrain?.sourceResolution).toBeUndefined();
    expect(validateWorld({ ...world, version: '0.4' }).errors.join(' ')).toMatch(
      /sourceResolution/,
    );
    world.terrain.sampledResolution = -1;
    expect(validateWorld(world).errors.join(' ')).toMatch(/sampledResolution/);
    delete world.terrain.sampledResolution;
    world.terrain.sourceResolution = 1;
    expect(validateWorld({ ...world, version: '0.4' }).errors).toEqual([]);
  });
});
