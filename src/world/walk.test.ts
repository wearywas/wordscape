import { describe, expect, it } from 'vitest';
import {
  createWalkContext,
  findWalkSpawn,
  moveWalker,
  WALK_EYE_HEIGHT,
  walkPositionAt,
} from './walk';
import type { WorldDocument, WorldObject } from './types';
import { washingtonSquare } from '../data/washingtonSquare';

const object = (
  id: string,
  kind: WorldObject['kind'],
  x: number,
  y: number,
  width = 4,
  depth = 4,
): WorldObject => ({
  id,
  kind,
  label: id,
  description: '',
  x,
  y,
  width,
  depth,
  height: kind === 'building' ? 6 : 0.1,
  elevation: 0,
  rotation: 0,
  layer: 0,
  evidence: 'authored',
});
const world = (objects: WorldObject[] = []): WorldDocument => ({
  format: 'wordscape',
  version: '0.5',
  name: 'Walk fixture',
  description: '',
  units: 'metres',
  bounds: { width: 40, depth: 40 },
  origin: { latitude: 0, longitude: 0, note: '' },
  seed: 1,
  sources: [],
  relations: [],
  objects,
});
const terrainWorld = (): WorldDocument => ({
  ...world(),
  terrain: {
    type: 'height-grid',
    columns: 3,
    rows: 3,
    spacing: 20,
    origin: { x: 0, y: 0 },
    heights: [100, 102, 104, 100, 102, 104, 100, 102, 104],
    referenceElevation: 100,
    sourceId: 'dem',
    verticalDatum: 'fixture',
    interpolation: 'bilinear',
  },
});

describe('human-scale walking', () => {
  it('finds usable ground in the actual Washington Square survey', () => {
    const context = createWalkContext(washingtonSquare);
    const start = findWalkSpawn(context);
    expect(start).toBeDefined();
    expect(start!.ground).toBeGreaterThan(0);
    const moved = moveWalker(context, start!, 0, 1);
    expect(Math.hypot(moved.x - start!.x, moved.y - start!.y)).toBeGreaterThan(0.5);
  });
  it('spawns on a mapped path before unrecorded open ground and stays at human eye height', () => {
    const doc = world([object('path', 'pavement', 12, 20, 3, 25)]);
    const spawn = findWalkSpawn(createWalkContext(doc))!;
    expect(spawn).toEqual({ x: 12, y: 20, ground: 0.1 });
    expect(spawn.ground + WALK_EYE_HEIGHT).toBeCloseTo(1.8);
  });
  it('uses actual terrain triangles and subtracts the datum once', () => {
    const context = createWalkContext(terrainWorld());
    const start = walkPositionAt(context, 10, 10)!;
    expect(start.ground).toBeCloseTo(1);
    expect(moveWalker(context, start, 2, 0).ground).toBeCloseTo(1.2);
  });
  it('does not stack overlapping draped surface heights', () => {
    const doc = terrainWorld();
    doc.objects = [object('road', 'road', 10, 10), object('path', 'pavement', 10, 10)].map(
      (item) => ({ ...item, grounding: 'terrain' }),
    );
    expect(walkPositionAt(createWalkContext(doc), 10, 10)?.ground).toBeCloseTo(1.1);
  });
  it('blocks water, world edges and building footprints even when hidden in the view', () => {
    const context = createWalkContext(
      world([object('water', 'water', 10, 20), object('house', 'building', 20, 20)]),
    );
    expect(walkPositionAt(context, 10, 20)).toBeUndefined();
    expect(walkPositionAt(context, 0.1, 20)).toBeUndefined();
    expect(walkPositionAt(context, 18.1, 20)).toBeUndefined();
    expect(walkPositionAt(context, 17, 20)).toBeDefined();
  });
  it('cannot tunnel through a thin rotated wall and slides along it', () => {
    const wall = object('wall', 'building', 20, 20, 0.1, 15);
    const context = createWalkContext(world([wall]));
    const start = walkPositionAt(context, 19, 19)!;
    const result = moveWalker(context, start, 3, 1);
    expect(result.x).toBeLessThan(19.73);
    expect(result.y).toBeGreaterThan(19.9);
    const rotated = createWalkContext(world([{ ...wall, rotation: 45 }]));
    expect(walkPositionAt(rotated, 20, 20)).toBeUndefined();
  });
  it('rejects missing terrain, incomplete source cells, and steep drops', () => {
    const doc = terrainWorld();
    doc.terrain!.heights.fill(null);
    expect(findWalkSpawn(createWalkContext(doc))).toBeUndefined();
    doc.terrain!.heights = [100, 100, 100, 100, null, 100, 100, 100, 100];
    expect(walkPositionAt(createWalkContext(doc), 5, 5)).toBeUndefined();
    doc.terrain!.heights = [100, 200, 300, 100, 200, 300, 100, 200, 300];
    expect(walkPositionAt(createWalkContext(doc), 5, 5)).toBeUndefined();
  });
  it('uses authored flat comparison only when explicitly requested', () => {
    const doc = terrainWorld();
    doc.terrain!.heights.fill(null);
    expect(walkPositionAt(createWalkContext(doc, false), 10, 10)?.ground).toBe(0);
  });
  it('does not treat non-rendered building containers as solid masses', () => {
    const parent = {
      ...object('outline', 'building', 20, 20, 20, 20),
      facts: [{ key: 'building.isOutline', value: true, evidence: 'inferred' as const }],
    };
    const child = { ...object('part', 'building', 25, 20), parentId: 'outline' };
    const context = createWalkContext(world([parent, child]));
    expect(walkPositionAt(context, 15, 20)).toBeDefined();
    expect(walkPositionAt(context, 25, 20)).toBeUndefined();
  });
  it('does not change serialized source placements or facts while moving', () => {
    const doc = terrainWorld();
    const before = JSON.stringify(doc);
    const context = createWalkContext(doc);
    moveWalker(context, findWalkSpawn(context)!, 1, 1);
    expect(JSON.stringify(doc)).toBe(before);
  });
});
