import { describe, expect, it, vi } from 'vitest';
import {
  applyAuthoredTerrain,
  buildAuthoredTerrain,
  canAuthorTerrain,
  type AuthoredTerrainRecipe,
} from './authoredTerrain';
import { getObjectBaseElevation, sampleTerrain } from './terrain';
import { parseWorld, serializeWorld } from './document';
import type { WorldDocument, WorldObject } from './types';
import { exportWorldGlb } from './threeAdapter';

const hill = (): AuthoredTerrainRecipe => ({
  type: 'analytic-heightfield',
  version: 1,
  evidence: 'authored',
  baseElevation: 0,
  features: [{ x: 0.5, y: 0.5, radiusX: 0.4, radiusY: 0.3, height: 40, rotation: 20 }],
});
const object = (id: string, kind: WorldObject['kind'] = 'building'): WorldObject => ({
  id,
  kind,
  label: id,
  description: 'Authored scene object.',
  x: 90,
  y: 90,
  width: 10,
  depth: 10,
  height: 8,
  rotation: 0,
  elevation: 0,
  layer: 1,
  evidence: 'authored',
  facts: [{ key: 'material', value: 'stone', evidence: 'authored' }],
});
const world = (): WorldDocument => ({
  format: 'wordscape',
  version: '0.7',
  name: 'Imaginary hills',
  description: 'An authored local place.',
  units: 'metres',
  bounds: { width: 180, depth: 180 },
  origin: { latitude: 0, longitude: 0, note: 'Imaginary placeholder.' },
  seed: 0,
  imaginary: { brief: 'Hills', guideVersion: '1.0' },
  sources: [],
  objects: [],
  relations: [],
});
const metadata = { provider: 'codex', model: 'test-model' };

describe('authored terrain heightfields', () => {
  it('creates reproducible genuine terrain heights with full coverage and honest provenance', () => {
    const input = world();
    const result = applyAuthoredTerrain(input, hill(), metadata);
    expect(input.terrain).toBeUndefined();
    expect(result.world.terrain).toMatchObject({
      columns: 33,
      rows: 33,
      evidence: 'authored',
      referenceElevation: 0,
    });
    expect(sampleTerrain(result.world, 90, 90)).toBeCloseTo(40);
    expect(sampleTerrain(result.world, 0, 0)).toBe(0);
    expect(sampleTerrain(result.world, 180, 180)).toBe(0);
    expect(sampleTerrain(result.world, 181, 180)).toBeUndefined();
    expect(result.world.terrain?.sourceResolution).toBeUndefined();
    expect(result.world.terrain?.acquired).toBeUndefined();
    expect(result.world.sources[0].notes).toContain('analytic-heightfield');
    expect(parseWorld(serializeWorld(result.world))).toEqual(result.world);
    expect(applyAuthoredTerrain(input, hill(), metadata).world).toEqual(result.world);
  });
  it('rejects unbounded recipes and protects survey or unmarked terrain', () => {
    for (const recipe of [
      { ...hill(), baseElevation: NaN },
      { ...hill(), features: Array(9).fill(hill().features[0]) },
      { ...hill(), features: [{ ...hill().features[0], radiusX: 0 }] },
      { ...hill(), features: Array(2).fill({ ...hill().features[0], height: 300 }) },
    ])
      expect(() => buildAuthoredTerrain(world().bounds, recipe, 'authored-terrain')).toThrow();
    const surveyed = world();
    delete surveyed.imaginary;
    expect(canAuthorTerrain(surveyed)).toBe(false);
    expect(() => applyAuthoredTerrain(surveyed, hill(), metadata)).toThrow(/imaginary/i);
    const protectedWorld = applyAuthoredTerrain(world(), hill(), metadata).world;
    delete protectedWorld.terrain!.evidence;
    expect(canAuthorTerrain(protectedWorld)).toBe(false);
    expect(() => applyAuthoredTerrain(protectedWorld, hill(), metadata)).toThrow(
      /authored|protected/i,
    );
    protectedWorld.terrain!.evidence = 'sourced';
    expect(canAuthorTerrain(protectedWorld)).toBe(false);
  });
  it('covers a rectangular world with square grid pitch', () => {
    const input = { ...world(), bounds: { width: 180, depth: 111 } };
    const result = applyAuthoredTerrain(input, hill(), metadata).world;
    expect(result.terrain).toMatchObject({ columns: 33, rows: 21, spacing: 5.625 });
    for (const [x, y] of [
      [0, 0],
      [180, 0],
      [0, 111],
      [180, 111],
      [90, 55.5],
    ])
      expect(sampleTerrain(result, x, y)).toBeTypeOf('number');
  });
  it('exports authored terrain geometry and its complete provenance in a portable GLB', async () => {
    class BinaryFileReader {
      result: ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        void blob.arrayBuffer().then((result) => {
          this.result = result;
          this.onloadend?.();
        });
      }
    }
    vi.stubGlobal('FileReader', BinaryFileReader);
    try {
      const authored = applyAuthoredTerrain(world(), hill(), metadata).world;
      const buffer = await (await exportWorldGlb(authored)).arrayBuffer();
      const length = new DataView(buffer).getUint32(12, true);
      const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length))) as {
        nodes: { name?: string; mesh?: number; extras?: { wordscape?: WorldDocument } }[];
      };
      expect(gltf.nodes.find((node) => node.name === 'terrain-surface')?.mesh).toBeTypeOf('number');
      const exported = gltf.nodes.find((node) => node.extras?.wordscape)?.extras?.wordscape;
      expect(exported?.terrain).toEqual(authored.terrain);
      expect(exported?.sources).toEqual(authored.sources);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('re-grounds authored roots and architectural children while keeping water flat and source placements unchanged', () => {
    const input = world();
    input.objects = [
      object('hall'),
      { ...object('tower'), parentId: 'hall', elevation: 8 },
      object('tree', 'tree'),
      { ...object('pond', 'water'), height: 0.03, elevation: -1 },
      { ...object('source'), evidence: 'observed', elevation: 2 },
    ];
    const before = structuredClone(input);
    const result = applyAuthoredTerrain(input, hill(), metadata);
    const [hall, tower, tree, pond, source] = result.world.objects;
    expect(getObjectBaseElevation(result.world, hall)).toBeCloseTo(40);
    expect(tower.elevation).toBeCloseTo(48);
    expect(tower.grounding).not.toBe('terrain');
    expect(getObjectBaseElevation(result.world, tree)).toBeCloseTo(40);
    expect(pond.elevation).toBe(-1);
    expect(pond.grounding).toBe('absolute');
    expect(source).toEqual(before.objects[4]);
    expect(result.regroundedIds).toEqual(['hall', 'tower', 'tree']);
    expect(result.preservedGroundingIds).toContain('source');
    expect(
      result.world.objects.map((o) => ({
        x: o.x,
        y: o.y,
        width: o.width,
        depth: o.depth,
        rotation: o.rotation,
        facts: o.facts,
      })),
    ).toEqual(
      before.objects.map((o) => ({
        x: o.x,
        y: o.y,
        width: o.width,
        depth: o.depth,
        rotation: o.rotation,
        facts: o.facts,
      })),
    );
    expect(input).toEqual(before);
  });
  it('preserves offsets above previous authored terrain instead of reusing absolute heights as offsets', () => {
    const input = applyAuthoredTerrain(
      world(),
      { ...hill(), baseElevation: 10, features: [] },
      metadata,
    ).world;
    input.objects = [
      {
        ...object('relative'),
        grounding: 'terrain',
        terrainAnchor: 'highest-footprint',
        elevation: 2,
      },
      { ...object('absolute'), elevation: 12 },
      { ...object('child'), parentId: 'absolute', elevation: 18 },
    ];
    const result = applyAuthoredTerrain(input, hill(), metadata);
    expect(getObjectBaseElevation(result.world, result.world.objects[0])).toBeCloseTo(42);
    expect(getObjectBaseElevation(result.world, result.world.objects[1])).toBeCloseTo(42);
    expect(result.world.objects[2].elevation).toBeCloseTo(48);
    expect(result.world.sources.slice(0, input.sources.length)).toEqual(input.sources);
  });
  it('refuses to replace a shared grid when a protected placement would silently move with it', () => {
    const input = applyAuthoredTerrain(
      world(),
      { ...hill(), baseElevation: 10, features: [] },
      metadata,
    ).world;
    input.objects = [
      { ...object('source'), evidence: 'observed', grounding: 'terrain', elevation: 2 },
    ];
    expect(getObjectBaseElevation(input, input.objects[0])).toBe(12);
    expect(canAuthorTerrain(input)).toBe(false);
    expect(() =>
      applyAuthoredTerrain(input, { ...hill(), baseElevation: 40, features: [] }, metadata),
    ).toThrow(/protected/i);
    input.objects = [
      { ...object('source'), evidence: 'observed' },
      { ...object('child'), parentId: 'source', grounding: 'terrain', elevation: 2 },
    ];
    expect(canAuthorTerrain(input)).toBe(false);
  });
});
