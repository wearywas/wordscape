import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { getFootprint, validateWorld } from '../src/world/document';
import type { WorldDocument } from '../src/world/types';
import examples from '../src/data/layoutExamples.json';
import { convertOsmToWorld, type OverpassResponse } from '../src/imports/osm';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root));
const metadata = JSON.parse(read('public/reference/layout-examples/manifest.json').toString());
const fact = (o: WorldDocument['objects'][number], key: string) =>
  o.facts?.find((f) => f.key === key)?.value;
function edgeDistance(p: number[], a: number[], b: number[]) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inPolygon(p: number[], polygon: number[][]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (edgeDistance(p, a, b) < 0.04) return true;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

describe('processed real layout examples', () => {
  it('ships ten bounded valid worlds with actual source provenance and audited omissions', () => {
    expect(examples.examples).toHaveLength(10);
    expect(new Set(examples.examples.map((e) => e.id)).size).toBe(10);
    for (const example of examples.examples) {
      const bytes = read(`public${example.source.worldPath}`);
      const world: WorldDocument = JSON.parse(bytes.toString());
      const audit = metadata.examples.find((e: { id: string }) => e.id === example.id);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(audit.sha256);
      expect(validateWorld(world).errors).toEqual([]);
      expect(world.imaginary).toBeUndefined();
      expect(world.terrain).toBeUndefined();
      expect(world.objects.length).toBeGreaterThan(10);
      expect(world.objects.length).toBeLessThan(1000);
      expect(audit.diagnostics.counts.importedObjects).toBe(world.objects.length);
      expect(
        audit.diagnostics.omitted.some((o: { reason: string }) =>
          o.reason.includes('Object limit'),
        ),
      ).toBe(false);
      expect(world.sources[0].attribution).toContain('OpenStreetMap contributors');
      expect(world.sources[0].notes).toContain(example.source.retainedSourceSha256);
      const thumbnail = read(`public${example.source.thumbnailPath}`);
      expect(thumbnail.subarray(1, 4).toString()).toBe('PNG');
      expect([thumbnail.readUInt32BE(16), thumbnail.readUInt32BE(20)]).toEqual([320, 320]);
      const raw = read(`public/reference/layout-study/${example.id}.osm.json.gz`);
      expect(createHash('sha256').update(raw).digest('hex')).toBe(
        example.source.retainedSourceSha256,
      );
      const source = JSON.parse(gunzipSync(raw).toString());
      expect(example.source.snapshotAt).toBe(source.source.snapshotAt ?? null);
      expect(example.source.accessed).toBe(source.source.downloadedAt.slice(0, 10));
      const reconverted = convertOsmToWorld(
        {
          elements: source.elements,
          ...(source.source.snapshotAt
            ? { osm3s: { timestamp_osm_base: source.source.snapshotAt } }
            : {}),
        } as OverpassResponse,
        {
          bounds: example.source.bounds,
          name: world.name,
          sourceUrl: source.source.url,
          accessed: example.source.accessed,
        },
      );
      expect(reconverted.world.objects).toEqual(world.objects);
      expect(reconverted.world.relations).toEqual(world.relations);
      expect(reconverted.diagnostics).toEqual(audit.diagnostics);
    }
  });
  it('passes contiguous real footprints and route segments rather than disconnected invented layouts', () => {
    for (const example of examples.examples) {
      const world: WorldDocument = JSON.parse(read(`public${example.source.worldPath}`).toString());
      const byId = new Map(world.objects.map((o) => [o.id, o]));
      const cluster = example.cluster;
      expect(cluster.objects.length).toBeGreaterThanOrEqual(20);
      expect(cluster.objects.length).toBeLessThanOrEqual(45);
      const representedIds = cluster.objects.flatMap((o) => o.sourceObjectIds);
      expect(new Set(representedIds).size).toBe(cluster.objectCountBeforeRouteGrouping);
      expect(representedIds.every((id) => byId.has(id))).toBe(true);
      expect(cluster.objects.some((o) => o.kind === 'building')).toBe(true);
      expect(cluster.objects.some((o) => 'centerline' in o)).toBe(true);
      for (const object of cluster.objects) {
        if ('centerline' in object && object.centerline) {
          expect(object.nodeIds?.length).toBe(object.centerline.length);
          expect(object.sourceObjectIds.length).toBe(object.centerline.length - 1);
          object.sourceObjectIds.forEach((id, i) => {
            const original = byId.get(id)!;
            const originalLine = JSON.parse(String(fact(original, 'path.centerline')));
            if (object.nodeIds?.[i] !== null)
              expect(object.nodeIds?.[i]).toBe(fact(original, 'osm.fromNode'));
            if (object.nodeIds?.[i + 1] !== null)
              expect(object.nodeIds?.[i + 1]).toBe(fact(original, 'osm.toNode'));
            for (const p of [object.centerline![i], object.centerline![i + 1]]) {
              expect(
                edgeDistance(
                  [p[0] + cluster.bounds.x, p[1] + cluster.bounds.y],
                  originalLine[0],
                  originalLine[1],
                ),
              ).toBeLessThan(0.04);
            }
          });
        } else if ('footprint' in object && object.footprint) {
          const polygon = getFootprint(byId.get(object.sourceObjectIds[0])!);
          for (const p of object.footprint)
            expect(
              inPolygon([p[0] + cluster.bounds.x, p[1] + cluster.bounds.y], polygon),
              `${example.id}/${object.id}: clipped footprint escapes source`,
            ).toBe(true);
        }
      }
    }
  });
  it('describes observed orientation contrast without scoring naturalness or invented terrain', () => {
    const oldTown = examples.examples.find((e) => e.id === 'monaco-old-town')!;
    const planned = examples.examples.find((e) => e.id === 'hulhumale-grid')!;
    expect(oldTown.stats.roadOrientation.orthogonalAlignment).toBeLessThan(
      planned.stats.roadOrientation.orthogonalAlignment!,
    );
    for (const example of examples.examples) {
      expect(example.stats.roadOrientation.binLengthM.reduce((sum, n) => sum + n, 0)).toBeCloseTo(
        example.stats.roadLengthM,
        1,
      );
      expect(example.stats.nearestBuildingGapM.n).toBe(example.stats.buildingCount);
      expect(example.stats.summedBuildingAreaRatio).toBeGreaterThan(0);
      expect(
        example.stats.importedEstimatedHeightCount + example.stats.importedMappedHeightCount,
      ).toBe(example.stats.buildingCount);
    }
  });
});
