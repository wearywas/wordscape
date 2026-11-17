import { describe, expect, it } from 'vitest';
import { getFootprintTerrain, getObjectBaseElevation, sampleTerrain } from './terrain';
import type { WorldDocument, WorldObject, WorldTerrain } from './types';

const terrain: WorldTerrain = {
  type: 'height-grid',
  columns: 2,
  rows: 2,
  spacing: 10,
  origin: { x: 0, y: 0 },
  heights: [10, 20, 30, 40],
  verticalDatum: 'Test datum',
  referenceElevation: 10,
  sourceId: 'dem',
  sourceResolution: 1,
  interpolation: 'bilinear',
};
const object: WorldObject = {
  id: 'object',
  label: 'Object',
  kind: 'building',
  description: '',
  x: 5,
  y: 5,
  width: 10,
  depth: 10,
  height: 7,
  elevation: 2,
  rotation: 0,
  layer: 0,
  evidence: 'authored',
};
function world(grid: WorldTerrain = structuredClone(terrain)): WorldDocument {
  return {
    format: 'wordscape',
    version: '0.3',
    name: 'Terrain test',
    description: '',
    units: 'metres',
    bounds: { width: 10, depth: 10 },
    origin: { latitude: 0, longitude: 0, note: '' },
    seed: 1,
    sources: [{ id: 'dem', title: 'DEM', url: '', attribution: 'Test', accessed: '', notes: '' }],
    objects: [],
    relations: [],
    terrain: grid,
  };
}

describe('terrain interpolation', () => {
  it('samples row-major west/east and south/north values without subtracting the datum', () => {
    const input = world();
    expect(sampleTerrain(input, 0, 0)).toBe(10);
    expect(sampleTerrain(input, 10, 0)).toBe(20);
    expect(sampleTerrain(input, 0, 10)).toBe(30);
    expect(sampleTerrain(input, 10, 10)).toBe(40);
    expect(sampleTerrain(input, 5, 5)).toBe(25);
    expect(sampleTerrain(input, 2.5, 7.5)).toBe(27.5);
  });

  it('applies local grid origin and does not extrapolate beyond coverage', () => {
    const input = world({ ...terrain, origin: { x: 20, y: -10 } });
    expect(sampleTerrain(input, 25, -5)).toBe(25);
    expect(sampleTerrain(input, 19.99, -5)).toBeUndefined();
    expect(sampleTerrain(input, 25, 0.01)).toBeUndefined();
    expect(sampleTerrain(input, Infinity, 0)).toBeUndefined();
    expect(sampleTerrain({ ...input, terrain: undefined }, 25, -5)).toBeUndefined();
  });

  it('retains unknown cells but ignores null corners with exactly zero interpolation weight', () => {
    const input = world({ ...terrain, heights: [null, 20, 30, 40] });
    expect(sampleTerrain(input, 5, 5)).toBeUndefined();
    expect(sampleTerrain(input, 0, 0)).toBeUndefined();
    expect(sampleTerrain(input, 10, 0)).toBe(20);
    expect(sampleTerrain(input, 10, 5)).toBe(30);
    expect(sampleTerrain(input, 5, 10)).toBe(35);
  });
});

describe('footprint terrain and placement grounding', () => {
  it('finds a bilinear stationary maximum between an oblique edge midpoint and its endpoints', () => {
    const input = world({ ...terrain, spacing: 1, referenceElevation: 0, heights: [0, 0, 0, 100] });
    const placement: WorldObject = {
      ...object,
      x: 0.4,
      y: 0.4,
      width: 1,
      depth: 1,
      footprint: [
        [-0.4, -0.4],
        [0.6, -0.2],
        [-0.4, 0.6],
      ],
      grounding: 'terrain',
      terrainAnchor: 'highest-footprint',
      elevation: 0,
    };
    expect(getFootprintTerrain(input, placement).max).toBeCloseTo(31.25);
    expect(getObjectBaseElevation(input, placement)).toBeCloseTo(31.25);
  });

  it('includes an interior ridge that is absent at the footprint centre and corners', () => {
    const input = world({
      ...terrain,
      columns: 4,
      rows: 4,
      spacing: 1,
      referenceElevation: 0,
      heights: [0, 0, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    const placement = { ...object, x: 1.5, y: 1.5, width: 3, depth: 3 };
    expect(sampleTerrain(input, 1.5, 1.5)).toBe(5);
    const stats = getFootprintTerrain(input, placement);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(20);
    expect(stats.missingCount).toBe(0);
  });

  it('samples boundary grid crossings when a narrow footprint contains no grid node', () => {
    const input = world({
      ...terrain,
      columns: 3,
      rows: 3,
      spacing: 1,
      referenceElevation: 0,
      heights: [0, 0, 0, 0, 20, 0, 0, 0, 0],
    });
    const stats = getFootprintTerrain(input, { ...object, x: 1.3, y: 1, width: 0.4, depth: 2 });
    expect(stats.max).toBeCloseTo(18);
    expect(stats.min).toBe(0);
  });

  it('uses the rotated custom polygon rather than its enclosing box', () => {
    const input = world({
      ...terrain,
      columns: 3,
      rows: 3,
      spacing: 1,
      referenceElevation: 0,
      heights: [0, 0, 0, 0, 0, 0, 0, 0, 100],
    });
    const placement: WorldObject = {
      ...object,
      x: 1,
      y: 1,
      width: 2,
      depth: 2,
      footprint: [
        [-1, -1],
        [1, -1],
        [-1, 1],
      ],
    };
    expect(getFootprintTerrain(input, placement).max).toBe(0);
    expect(getFootprintTerrain(input, { ...placement, rotation: 180 }).max).toBeCloseTo(100);
  });

  it('keeps legacy elevation separate from terrain offsets and object height', () => {
    const input = world();
    expect(getObjectBaseElevation(input, object)).toBe(2);
    expect(getObjectBaseElevation(input, { ...object, grounding: 'absolute' })).toBe(2);
    expect(getObjectBaseElevation(input, { ...object, grounding: 'terrain' })).toBe(17);
    expect(
      getObjectBaseElevation(input, {
        ...object,
        grounding: 'terrain',
        terrainAnchor: 'highest-footprint',
      }),
    ).toBe(32);
    expect(getObjectBaseElevation(input, { ...object, grounding: 'terrain', height: 100 })).toBe(
      17,
    );
  });

  it('does not turn missing grounding or partial footprint coverage into a zero-height base', () => {
    const input = world({
      ...terrain,
      columns: 3,
      rows: 3,
      spacing: 1,
      heights: [null, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    const placement: WorldObject = {
      ...object,
      x: 1,
      y: 1,
      width: 2,
      depth: 2,
      grounding: 'terrain',
    };
    expect(getObjectBaseElevation(input, placement)).toBe(-8);
    expect(
      getObjectBaseElevation(input, { ...placement, terrainAnchor: 'highest-footprint' }),
    ).toBeUndefined();
    expect(getFootprintTerrain(input, placement).missingCount).toBeGreaterThan(0);
    expect(getObjectBaseElevation(input, { ...placement, x: -1 })).toBeUndefined();
  });
});
