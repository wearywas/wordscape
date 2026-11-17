import { describe, expect, it } from 'vitest';
import { attachTerrain } from './terrain';
import { geographicFrame } from './osm';
import { makeObject, validateWorld } from '../world/document';
import { getObjectBaseElevation } from '../world/terrain';
import type { TerrainExtraction } from './terrain';
import type { WorldDocument } from '../world/types';

const bounds = { west: -122.41, south: 37.8, east: -122.409, north: 37.801 };
const frame = geographicFrame(bounds);
const world = (): WorldDocument => ({
  format: 'wordscape',
  version: '0.5',
  name: 'Imported',
  description: '',
  units: 'metres',
  bounds: { width: frame.width, depth: frame.depth },
  origin: { ...frame.origin, note: '' },
  seed: 1,
  sources: [
    {
      id: 'osm-extract',
      title: 'Map',
      url: 'https://openstreetmap.org',
      attribution: 'OSM',
      accessed: '2026-11-16',
      notes: '',
    },
  ],
  objects: [
    {
      ...makeObject('building', 40, 40),
      id: 'parent',
      evidence: 'observed',
      sourceId: 'osm-extract',
      elevation: 2,
    },
    {
      ...makeObject('landmark', 40, 40),
      id: 'child',
      evidence: 'observed',
      sourceId: 'osm-extract',
      parentId: 'parent',
      elevation: 12,
    },
    { ...makeObject('fixture', 70, 70), id: 'authored', sourceId: 'osm-extract', elevation: 20 },
  ],
  relations: [],
});
const extraction = (): TerrainExtraction => ({
  bounds,
  frame,
  terrain: {
    type: 'height-grid',
    columns: 3,
    rows: 3,
    spacing: 60,
    origin: { x: 0, y: 0 },
    heights: Array(9).fill(35),
    verticalDatum: 'NAVD88',
    referenceElevation: 30,
    sourceId: 'terrain-test',
    sourceResolution: 1,
    interpolation: 'bilinear',
  },
  source: {
    id: 'terrain-test',
    title: 'Terrain',
    url: 'https://usgs.gov',
    attribution: 'USGS',
    accessed: '2026-11-16',
    notes: '',
  },
  diagnostics: {
    provider: 'usgs-3dep',
    tiles: 0,
    requests: 1,
    validSamples: 9,
    totalSamples: 9,
    min: 35,
    max: 35,
    warnings: [],
  },
  cached: false,
});
describe('reviewable terrain attachment', () => {
  it('preserves authored placements by default and never mutates either input', () => {
    const original = world(),
      data = extraction(),
      before = JSON.stringify(original),
      beforeData = JSON.stringify(data);
    const next = attachTerrain(original, data);
    expect(next.objects).toEqual(original.objects);
    expect(next.terrain).toEqual(data.terrain);
    expect(JSON.stringify(original)).toBe(before);
    expect(JSON.stringify(data)).toBe(beforeData);
    expect(validateWorld(next).errors).toEqual([]);
  });
  it('explicitly grounds only un-authored OSM objects and keeps architectural child offsets', () => {
    const next = attachTerrain(world(), extraction(), { groundObjects: true });
    expect(next.objects[0].grounding).toBe('terrain');
    expect(getObjectBaseElevation(next, next.objects[0])).toBe(7);
    expect(next.objects[1].grounding).toBe('absolute');
    expect(next.objects[1].elevation).toBe(17);
    expect(next.objects[2].grounding).toBeUndefined();
    expect(next.objects[2].elevation).toBe(20);
  });
  it('keeps child offsets stable on repeated attachment and follows a refreshed parent base once', () => {
    const first = attachTerrain(world(), extraction(), { groundObjects: true });
    const repeated = attachTerrain(first, extraction(), { groundObjects: true });
    expect(repeated.objects).toEqual(first.objects);
    const refreshed = extraction();
    refreshed.terrain.heights = Array(9).fill(39);
    const next = attachTerrain(repeated, refreshed, { groundObjects: true });
    expect(getObjectBaseElevation(next, next.objects[0])).toBe(11);
    expect(next.objects[1].elevation).toBe(21);
    expect(next.objects[1].elevation - getObjectBaseElevation(next, next.objects[0])!).toBe(10);
    expect(next.objects[2]).toEqual(first.objects[2]);
  });
  it('rejects mismatched geographic frames and terrain/source identities', () => {
    expect(() =>
      attachTerrain({ ...world(), origin: { ...world().origin, longitude: 1 } }, extraction()),
    ).toThrow(/frame/i);
    const wrong = extraction();
    wrong.source.id = 'wrong';
    expect(() => attachTerrain(world(), wrong)).toThrow(/source/i);
  });
  it('keeps authored water render levels flat in the supplied datum and preserves unknown measured levels', () => {
    const original = world();
    original.objects = [
      {
        ...makeObject('water', 40, 40),
        id: 'water',
        elevation: -0.1,
        sourceId: 'osm-extract',
        facts: [
          { key: 'water.renderLevel', value: 0, unit: 'm', evidence: 'authored' },
          { key: 'water.surfaceElevation', value: null, evidence: 'unknown' },
        ],
      },
    ];
    const next = attachTerrain(original, extraction(), { groundObjects: true });
    expect(next.objects[0].grounding).toBe('absolute');
    expect(next.objects[0].elevation).toBe(-30.1);
    expect(next.objects[0].facts).toContainEqual({
      key: 'water.surfaceElevation',
      value: null,
      evidence: 'unknown',
    });
  });
});
