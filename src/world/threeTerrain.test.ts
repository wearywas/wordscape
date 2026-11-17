import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { WorldDocument, WorldObject } from './types';
import { createWorldGroup, disposeWorldGroup, exportWorldGlb } from './threeAdapter';
import { createTerrainContext, renderedTerrainHeight } from './threeTerrain';
import { getObjectBaseElevation } from './terrain';

const terrainWorld: WorldDocument = {
  format: 'wordscape',
  version: '0.3',
  name: 'Sloping test site',
  description: 'Planar slope',
  units: 'metres',
  bounds: { width: 40, depth: 40 },
  origin: { latitude: 0, longitude: 0, note: 'Fixture' },
  seed: 10,
  sources: [
    {
      id: 'dem',
      title: 'Test elevation field',
      url: 'https://example.com/dem',
      attribution: 'Fixture',
      accessed: '2026-11-15',
      notes: 'Synthetic test only.',
    },
  ],
  terrain: {
    type: 'height-grid',
    columns: 5,
    rows: 5,
    spacing: 10,
    origin: { x: 0, y: 0 },
    heights: Array.from(
      { length: 25 },
      (_, index) => 100 + (index % 5) * 2 + Math.floor(index / 5),
    ),
    verticalDatum: 'Test datum',
    referenceElevation: 100,
    sourceId: 'dem',
    sourceResolution: 1,
    interpolation: 'bilinear',
  },
  objects: [],
  relations: [],
};

function object(patch: Partial<WorldObject>): WorldObject {
  return {
    id: 'surface',
    label: 'Surface',
    description: 'Test object',
    kind: 'road',
    x: 20,
    y: 20,
    width: 30,
    depth: 5,
    height: 0.08,
    elevation: 0,
    grounding: 'terrain',
    rotation: 0,
    layer: 0,
    evidence: 'authored',
    ...patch,
  };
}
function find(group: THREE.Group, id: string): THREE.Group {
  return group.children.find((node) => node.userData.worldObjectId === id) as THREE.Group;
}
function vertices(mesh: THREE.Mesh): THREE.Vector3[] {
  mesh.updateWorldMatrix(true, false);
  const positions = mesh.geometry.getAttribute('position');
  return Array.from({ length: positions.count }, (_, index) =>
    new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe('Terrain geometry and grounding', () => {
  it('renders source elevations at true scale and subtracts the datum reference exactly once', () => {
    const group = createWorldGroup(terrainWorld);
    const terrain = group.children.find((node) => node.name === 'Recorded terrain')!;
    const mesh = terrain.children.find((node) => node.name === 'terrain-surface') as THREE.Mesh;
    const points = vertices(mesh);
    expect(Math.min(...points.map((point) => point.y))).toBeCloseTo(0);
    expect(Math.max(...points.map((point) => point.y))).toBeCloseTo(12);
    expect(terrain.userData.verticalExaggeration).toBe(1);
    expect(terrain.userData.terrain).toEqual(terrainWorld.terrain);
    disposeWorldGroup(group);
  });

  it('drapes rotated roads and their markings across a slope without changing horizontal placement', () => {
    const road = object({
      rotation: 31,
      facts: [
        { key: 'road.direction', value: 'two-way', evidence: 'authored' },
        { key: 'road.lanes', value: 2, evidence: 'authored' },
      ],
    });
    const group = createWorldGroup({ ...terrainWorld, objects: [road] });
    const rendered = find(group, road.id);
    const markings = rendered.children.find(
      (node) => node.userData.renderRole === 'road-markings',
    ) as THREE.Mesh;
    expect(markings.geometry.getAttribute('position').count).toBeGreaterThan(12);
    for (const point of vertices(markings)) {
      const sourceX = point.x + 20,
        sourceY = 20 - point.z;
      expect(point.y - (sourceX * 0.2 + sourceY * 0.1)).toBeCloseTo(road.height, 4);
    }
    expect(rendered.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(31));
    disposeWorldGroup(group);
  });

  it('adds internal surface vertices at a hill that is absent from the polygon corners', () => {
    const heights = Array<number>(25).fill(100);
    heights[12] = 118;
    const lawn = object({ kind: 'grass', width: 40, depth: 40, height: 0.12, elevation: 0.08 });
    const world = {
      ...terrainWorld,
      terrain: { ...terrainWorld.terrain!, heights },
      objects: [lawn],
    };
    const group = createWorldGroup(world);
    const surface = find(group, lawn.id).children.find(
      (node) => node.userData.renderRole === 'surface',
    ) as THREE.Mesh;
    const points = vertices(surface);
    expect(
      points.some(
        (point) => Math.abs(point.x) < 0.0001 && Math.abs(point.z) < 0.0001 && point.y > 18.19,
      ),
    ).toBe(true);
    expect(surface.geometry.getAttribute('position').count).toBeGreaterThan(100);
    disposeWorldGroup(group);
  });

  it('keeps buildings upright at the shared highest anchor and fills foundations down to ground', () => {
    const building = object({
      id: 'building',
      kind: 'building',
      width: 10,
      depth: 10,
      height: 9,
      elevation: 1,
      terrainAnchor: 'highest-footprint',
    });
    const tree = object({
      id: 'tree',
      kind: 'tree',
      x: 10,
      y: 10,
      width: 4,
      depth: 4,
      height: 8,
      elevation: 2,
      parentId: building.id,
    });
    const world = { ...terrainWorld, objects: [building, tree] };
    const group = createWorldGroup(world),
      house = find(group, building.id),
      trunk = find(group, tree.id);
    expect(house.position.y).toBeCloseTo(getObjectBaseElevation(world, building)!);
    expect(house.position.y).toBeCloseTo(8.5);
    expect(trunk.position.toArray()).toEqual([-10, 5, 10]);
    expect(trunk.parent).toBe(group);
    const foundation = house.children.find(
      (node) => node.userData.renderRole === 'terrain-foundation',
    ) as THREE.Mesh;
    expect(foundation).toBeDefined();
    expect(Math.min(...vertices(foundation).map((point) => point.y))).toBeCloseTo(4.5);
    const roof = house.children.find((node) => node.userData.renderRole === 'roof') as THREE.Mesh;
    expect(new THREE.Box3().setFromObject(roof).max.y).toBeCloseTo(17.5);
    expect(house.rotation.x).toBe(0);
    expect(house.rotation.z).toBe(0);
    disposeWorldGroup(group);
  });

  it('retains absolute architectural alignment in the flat comparison without mutating the document', () => {
    const parent = object({
      id: 'church',
      kind: 'building',
      width: 10,
      depth: 10,
      height: 9,
      elevation: 1,
      terrainAnchor: 'highest-footprint',
    });
    const child = object({
      id: 'tower',
      kind: 'building',
      width: 3,
      depth: 3,
      height: 20,
      elevation: 8.5,
      grounding: 'absolute',
      parentId: parent.id,
    });
    const world = { ...terrainWorld, objects: [parent, child] };
    const before = JSON.stringify(world);
    const flat = createWorldGroup(world, undefined, { terrainEnabled: false });
    expect(find(flat, parent.id).position.y).toBeCloseTo(1);
    expect(find(flat, child.id).position.y).toBeCloseTo(1);
    expect(JSON.stringify(world)).toBe(before);
    disposeWorldGroup(flat);
  });

  it('leaves holes for missing samples and omits unresolved terrain-grounded objects', () => {
    const heights = [...terrainWorld.terrain!.heights];
    heights[12] = null;
    const world = {
      ...terrainWorld,
      terrain: { ...terrainWorld.terrain!, heights },
      objects: [object({ id: 'unresolved' })],
    };
    const group = createWorldGroup(world);
    expect(find(group, 'unresolved')).toBeUndefined();
    expect(group.userData.unresolvedPlacements).toEqual([
      expect.objectContaining({ id: 'unresolved' }),
    ]);
    const context = createTerrainContext(world)!;
    expect(renderedTerrainHeight(context, 20, 20)).toBeUndefined();
    const mesh = group.children
      .find((node) => node.name === 'Recorded terrain')!
      .children.find((node) => node.name === 'terrain-surface') as THREE.Mesh;
    expect(mesh.geometry.index!.count).toBeLessThan((context.columns - 1) * (context.rows - 1) * 6);
    disposeWorldGroup(group);
  });

  it('bounds terrain render resolution for large imported grids', () => {
    const world = {
      ...terrainWorld,
      terrain: {
        ...terrainWorld.terrain!,
        columns: 257,
        rows: 257,
        spacing: 40 / 256,
        heights: Array<number>(257 * 257).fill(100),
      },
    };
    const context = createTerrainContext(world)!;
    expect(context.columns).toBeLessThanOrEqual(161);
    expect(context.rows).toBeLessThanOrEqual(161);
    expect(context.min).toBeCloseTo(0);
    expect(context.max).toBeCloseTo(0);
  });

  it('does not fill a missing bilinear corner using only the other three triangle vertices', () => {
    const world: WorldDocument = {
      ...terrainWorld,
      bounds: { width: 1, depth: 1 },
      terrain: {
        ...terrainWorld.terrain!,
        columns: 2,
        rows: 2,
        spacing: 1,
        heights: [100, 100, null, 100],
      },
    };
    const context = createTerrainContext(world)!;
    expect(renderedTerrainHeight(context, 0.75, 0.25)).toBeUndefined();
    const group = createWorldGroup(world);
    const mesh = group.children
      .find((node) => node.name === 'Recorded terrain')!
      .children.find((node) => node.name === 'terrain-surface') as THREE.Mesh;
    expect(mesh.geometry.index!.count).toBe(0);
    disposeWorldGroup(group);
  });

  it('does not replace an entirely missing elevation field with a flat ground slab', () => {
    const world: WorldDocument = {
      ...terrainWorld,
      terrain: { ...terrainWorld.terrain!, heights: Array<null>(25).fill(null) },
      objects: [object({ id: 'unresolved' })],
    };
    const group = createWorldGroup(world);
    expect(group.children).toHaveLength(0);
    expect(group.userData.terrainStatus).toContain('no flat replacement');
    expect(group.userData.unresolvedPlacements).toHaveLength(1);
    disposeWorldGroup(group);
  });

  it('exports the full source terrain and actual terrain geometry in GLB', async () => {
    class BinaryFileReader {
      result: ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob): void {
        void blob.arrayBuffer().then((result) => {
          this.result = result;
          this.onloadend?.();
        });
      }
    }
    vi.stubGlobal('FileReader', BinaryFileReader);
    const buffer = await (await exportWorldGlb(terrainWorld)).arrayBuffer();
    const header = new DataView(buffer),
      length = header.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length))) as {
      nodes: {
        name?: string;
        mesh?: number;
        extras?: { wordscape?: WorldDocument; terrain?: unknown };
      }[];
    };
    expect(gltf.nodes.find((node) => node.extras?.wordscape)?.extras?.wordscape?.terrain).toEqual(
      terrainWorld.terrain,
    );
    expect(gltf.nodes.find((node) => node.name === 'terrain-surface')?.mesh).toBeTypeOf('number');
    expect(gltf.nodes.find((node) => node.name === 'Recorded terrain')?.extras?.terrain).toEqual(
      terrainWorld.terrain,
    );
  });
});
