import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  distribution,
  measureLayout,
  pointSegmentDistance,
  polygonGap,
} from './layout-metrics.mjs';

const square = (x, y, size = 10) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
];
const bounds = { west: 0, south: 0, east: 0.001, north: 0.001 };
const geo = ([x, y]) => ({ lon: x / 111319.49079327358, lat: y / 111319.49079327358 });
const way = (id, points, tags, nodes = points.map((_, i) => id * 100 + i)) => ({
  type: 'way',
  id,
  geometry: points.map(geo),
  tags,
  nodes,
});
describe('layout study measurements', () => {
  it('keeps the retained corpus traceable without contributor or contact metadata', () => {
    const root = new URL('../', import.meta.url);
    const manifest = JSON.parse(
      readFileSync(new URL('public/reference/layout-study/manifest.json', root), 'utf8'),
    );
    const guide = JSON.parse(readFileSync(new URL('src/data/layoutGuide.json', root), 'utf8'));
    expect(manifest.completedCount).toBe(20);
    expect(manifest.failures).toEqual([]);
    const ids = new Set(manifest.samples.map((sample) => sample.id));
    expect(ids.size).toBe(20);
    expect(guide.sampleCount).toBe(ids.size);
    for (const sample of manifest.samples) {
      const bytes = readFileSync(new URL(`public/reference/layout-study/${sample.file}`, root));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(sample.sha256);
      const data = JSON.parse(gunzipSync(bytes));
      expect(data.source.url).toMatch(/^https:\/\//);
      expect(data.source.downloadedAt).toBeTruthy();
      for (const element of data.elements) {
        for (const key of ['user', 'uid', 'changeset']) expect(element).not.toHaveProperty(key);
        expect(
          Object.keys(element.tags ?? {}).some((key) =>
            /^(name|addr:|contact:|phone|email)/.test(key),
          ),
        ).toBe(false);
      }
      const computed = measureLayout(data, sample.bounds);
      expect(computed.metrics).toEqual(sample.metrics);
      expect(computed.omissions).toEqual(sample.omissions);
    }
    for (const item of [...guide.patterns, ...guide.heuristics]) {
      expect(item.sampleIds.every((id) => ids.has(id))).toBe(true);
    }
    expect(guide.patterns.every((item) => item.evidence === 'derived')).toBe(true);
    expect(guide.heuristics.every((item) => item.evidence === 'authored')).toBe(true);
  });
  it('measures footprint boundaries rather than centroid spacing', () => {
    expect(polygonGap(square(0, 0), square(12, 0))).toBe(2);
    expect(polygonGap(square(0, 0), square(10, 0))).toBe(0);
    expect(polygonGap(square(0, 0), square(5, 5))).toBe(0);
    expect(
      polygonGap(
        [
          [0, 4],
          [20, 4],
          [20, 6],
          [0, 6],
        ],
        [
          [9, 0],
          [11, 0],
          [11, 10],
          [9, 10],
        ],
      ),
    ).toBe(0);
    expect(pointSegmentDistance([5, 5], [0, 0], [10, 0])).toBe(5);
  });
  it('keeps empty metrics unknown instead of converting missing data into zero distances', () => {
    expect(distribution([])).toEqual({ n: 0, min: null, median: null, p90: null, max: null });
    const result = measureLayout({ elements: [] }, bounds);
    expect(result.metrics.buildingCount).toBe(0);
    expect(result.metrics.nearestBuildingGapM.median).toBeNull();
    expect(result.metrics.largestNetworkFraction).toBeNull();
  });
  it('uses genuine shared nodes for connectivity and keeps mere crossings disconnected', () => {
    const a = way(
      1,
      [
        [10, 50],
        [50, 50],
      ],
      { highway: 'residential' },
      [1, 2],
    );
    const b = way(
      2,
      [
        [50, 50],
        [90, 50],
      ],
      { highway: 'footway' },
      [2, 3],
    );
    const c = way(
      3,
      [
        [30, 10],
        [30, 90],
      ],
      { highway: 'residential' },
      [4, 5],
    );
    const result = measureLayout({ elements: [a, b, c] }, bounds);
    expect(result.metrics.networkComponents).toBe(2);
    expect(result.metrics.networkNodes).toBe(5);
    expect(result.metrics.largestNetworkFraction).toBe(0.6);
    expect(result.metrics.roadSegmentCount).toBe(2);
    expect(result.metrics.pathSegmentCount).toBe(1);
  });
  it('records clipped polygons, source omissions and centerline distance independently', () => {
    const a = way(1, [...square(20, 20), [20, 20]], { building: 'yes' });
    const b = way(2, [...square(32, 20), [32, 20]], { building: 'yes' });
    const road = way(
      3,
      [
        [0, 10],
        [100, 10],
      ],
      { highway: 'residential' },
    );
    const outside = way(
      4,
      [
        [-5, 70],
        [5, 70],
        [5, 80],
        [-5, 80],
        [-5, 70],
      ],
      { building: 'yes' },
    );
    const result = measureLayout(
      { elements: [a, b, road, outside, { type: 'relation', id: 5, tags: { building: 'yes' } }] },
      bounds,
    );
    expect(result.metrics.buildingCount).toBe(3);
    expect(result.metrics.clippedBuildingCount).toBe(1);
    expect(result.metrics.nearestBuildingGapM.median).toBeCloseTo(2, 3);
    expect(result.metrics.buildingEnvelopeCenterToRoadCenterlineM.min).toBeCloseTo(15, 3);
    expect(result.omissions.relations).toBe(1);
    expect(
      result.geometry.buildings.every((b) => b.footprint.every(([x, y]) => x >= 0 && y >= 0)),
    ).toBe(true);
  });
});
