import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createWorldGroup, disposeWorldGroup, exportWorldGlb } from './threeAdapter';
import type { WorldDocument, WorldObject } from './types';
import { washingtonSquare } from '../data/washingtonSquare';

const document: WorldDocument = {
  format: 'wordscape',
  version: '0.1',
  name: 'Adapter fixture',
  description: 'A small world',
  units: 'metres',
  bounds: { width: 100, depth: 80 },
  origin: { latitude: 0, longitude: 0, note: 'Fixture' },
  seed: 42,
  sources: [
    {
      id: 'survey',
      title: 'Survey',
      url: 'https://example.com',
      attribution: 'Fixture',
      accessed: '2026-11-15',
      notes: 'Fixture',
    },
  ],
  relations: [],
  objects: [
    {
      id: 'parcel',
      label: 'Irregular parcel',
      description: 'L shape',
      kind: 'building',
      x: 60,
      y: 50,
      width: 12,
      depth: 12,
      height: 7,
      elevation: 2,
      rotation: 90,
      layer: 1,
      evidence: 'observed',
      sourceId: 'survey',
      facts: [
        { key: 'building.roofShape', value: 'flat', evidence: 'observed', sourceIds: ['survey'] },
      ],
      references: [{ sourceId: 'survey', role: 'photo', view: 'West frontage' }],
      footprint: [
        [-6, -6],
        [6, -6],
        [6, 0],
        [0, 0],
        [0, 6],
        [-6, 6],
      ],
    },
    {
      id: 'oak',
      label: 'Oak',
      description: 'Tree',
      kind: 'tree',
      x: 15,
      y: 25,
      width: 8,
      depth: 9,
      height: 12,
      elevation: 0,
      rotation: 0,
      layer: 2,
      evidence: 'inferred',
      parentId: 'parcel',
      facts: [{ key: 'tree.species', value: null, evidence: 'unknown', note: 'Not identified.' }],
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

function renderObject(patch: Partial<WorldObject>): THREE.Group {
  const object = {
    ...document.objects[0],
    footprint: undefined,
    x: 50,
    y: 40,
    rotation: 0,
    elevation: 0,
    layer: 0,
    ...patch,
  };
  return createWorldGroup({ ...document, objects: [object] }).children.find(
    (node) => node.userData.worldObjectId === object.id,
  ) as THREE.Group;
}

function role(group: THREE.Group, name: string): THREE.Mesh | undefined {
  return group.children.find((node) => node.userData.renderRole === name) as THREE.Mesh | undefined;
}

describe('Fact-driven geometry', () => {
  it('uses actual floor facts to change facade geometry, with a bounded detail budget', () => {
    const two = renderObject({
      facts: [{ key: 'building.levels', value: 2, evidence: 'sourced' }],
    });
    const five = renderObject({
      facts: [{ key: 'building.levels', value: 5, evidence: 'inferred' }],
    });
    const hostile = renderObject({
      facts: [{ key: 'building.levels', value: 1e9, evidence: 'authored' }],
    });
    const unknown = renderObject({
      facts: [{ key: 'building.levels', value: null, evidence: 'unknown' }],
    });
    expect(role(two, 'windows')).toBeDefined();
    const bodyBounds = new THREE.Box3().setFromObject(role(two, 'building-body')!);
    const windowBounds = new THREE.Box3().setFromObject(role(two, 'windows')!);
    expect(windowBounds.max.x).toBeGreaterThan(bodyBounds.max.x);
    expect(role(five, 'windows')!.geometry.getAttribute('position').count).toBeGreaterThan(
      role(two, 'windows')!.geometry.getAttribute('position').count,
    );
    expect(role(hostile, 'windows')!.geometry.getAttribute('position').count).toBeLessThan(10000);
    expect(role(unknown, 'windows')).toBeUndefined();
    [two, five, hostile, unknown].forEach(disposeWorldGroup);
  });

  it('changes roofs and tree forms from facts while retaining object envelopes', () => {
    const flat = renderObject({
      facts: [{ key: 'building.roofShape', value: 'flat', evidence: 'observed' }],
    });
    const gabled = renderObject({
      facts: [{ key: 'building.roofShape', value: 'gabled', evidence: 'observed' }],
    });
    expect(role(flat, 'roof')!.geometry.getAttribute('position').array).not.toEqual(
      role(gabled, 'roof')!.geometry.getAttribute('position').array,
    );
    const palm = renderObject({
      kind: 'tree',
      width: 4,
      depth: 7,
      height: 14,
      facts: [{ key: 'tree.form', value: 'palm', evidence: 'inferred' }],
    });
    const columnar = renderObject({
      kind: 'tree',
      width: 4,
      depth: 7,
      height: 14,
      facts: [{ key: 'tree.form', value: 'columnar', evidence: 'inferred' }],
    });
    expect(palm.children.length).not.toBe(columnar.children.length);
    for (const tree of [palm, columnar]) {
      const size = new THREE.Box3().setFromObject(tree).getSize(new THREE.Vector3());
      expect(size.x).toBeLessThanOrEqual(4.00001);
      expect(size.z).toBeLessThanOrEqual(7.00001);
      expect(size.y).toBeLessThanOrEqual(14.00001);
    }
    [flat, gabled, palm, columnar].forEach(disposeWorldGroup);
  });

  it('renders supported fixtures distinctly and leaves unknown road direction unmarked', () => {
    const bench = renderObject({
      kind: 'fixture',
      width: 3,
      depth: 1,
      height: 1.2,
      facts: [{ key: 'fixture.type', value: 'bench', evidence: 'observed' }],
    });
    const lamp = renderObject({
      kind: 'fixture',
      width: 1,
      depth: 1,
      height: 4,
      facts: [{ key: 'fixture.type', value: 'lamp', evidence: 'observed' }],
    });
    expect(role(bench, 'bench-seat')).toBeDefined();
    expect(role(lamp, 'lamp-post')).toBeDefined();
    const road = renderObject({
      kind: 'road',
      width: 60,
      depth: 10,
      height: 0.08,
      facts: [
        { key: 'road.direction', value: 'two-way', evidence: 'sourced' },
        { key: 'road.lanes', value: 2, evidence: 'sourced' },
      ],
    });
    const unknown = renderObject({
      kind: 'road',
      width: 60,
      depth: 10,
      height: 0.08,
      facts: [{ key: 'road.direction', value: null, evidence: 'unknown' }],
    });
    expect(role(road, 'road-markings')).toBeDefined();
    expect(role(unknown, 'road-markings')).toBeUndefined();
    [bench, lamp, road, unknown].forEach(disposeWorldGroup);
  });

  it('keeps children at absolute coordinates and retains facts and references', () => {
    const parent = { ...document.objects[0], rotation: 90, x: 55, y: 50 };
    const child: WorldObject = {
      ...document.objects[1],
      parentId: parent.id,
      facts: [{ key: 'tree.form', value: 'columnar', evidence: 'sourced', sourceIds: ['survey'] }],
      references: [{ sourceId: 'survey', role: 'photo' }],
    };
    const group = createWorldGroup({ ...document, version: '0.2', objects: [parent, child] });
    const rendered = group.children.find((node) => node.userData.worldObjectId === child.id)!;
    expect(rendered.position.toArray()).toEqual([-35, 0.036, 15]);
    expect(rendered.parent).toBe(group);
    expect(rendered.userData.worldObject.facts).toEqual(child.facts);
    expect(rendered.userData.worldObject.references).toEqual(child.references);
    disposeWorldGroup(group);
  });

  it('keeps roof vertices within a concave source footprint', () => {
    const group = renderObject({
      footprint: document.objects[0].footprint,
      facts: [{ key: 'building.roofShape', value: 'gabled', evidence: 'observed' }],
    });
    const positions = role(group, 'roof')!.geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index),
        north = -positions.getZ(index);
      expect(x).toBeGreaterThanOrEqual(-6.00001);
      expect(x).toBeLessThanOrEqual(6.00001);
      expect(north).toBeGreaterThanOrEqual(-6.00001);
      expect(north).toBeLessThanOrEqual(6.00001);
      expect(x > 0.00001 && north > 0.00001).toBe(false);
    }
    disposeWorldGroup(group);
  });

  it('uses sourced pedestal/figure dimensions and keeps every surveyed object inside its envelope', () => {
    const group = createWorldGroup(washingtonSquare, undefined, { terrainEnabled: false });
    const statue = group.children.find(
      (node) => node.userData.worldObjectId === 'franklin-statue',
    )!;
    expect(statue.userData.rendering.baseHeight).toBeCloseTo(3.5052);
    expect(statue.userData.rendering.figureHeight).toBeCloseTo(1.6764);
    for (const object of washingtonSquare.objects) {
      const rendered = group.children.find((node) => node.userData.worldObjectId === object.id)!;
      rendered.position.set(0, 0, 0);
      rendered.rotation.set(0, 0, 0);
      const size = new THREE.Box3().setFromObject(rendered).getSize(new THREE.Vector3());
      expect(size.x, `${object.id} width`).toBeLessThanOrEqual(object.width + 0.001);
      expect(size.z, `${object.id} depth`).toBeLessThanOrEqual(object.depth + 0.001);
      expect(size.y, `${object.id} height`).toBeLessThanOrEqual(object.height + 0.001);
    }
    disposeWorldGroup(group);
  });
});

describe('Three.js document adapter', () => {
  it('centres SW-origin coordinates, preserves source evidence, and applies rotation and elevation', () => {
    const group = createWorldGroup(document, ['building']);
    const parcel = group.children.find((node) => node.userData.worldObjectId === 'parcel');
    expect(parcel).toBeDefined();
    expect(parcel?.position.toArray()).toEqual([10, 2.018, -10]);
    expect(parcel?.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(parcel?.userData.worldObject.footprint).toEqual(document.objects[0].footprint);
    expect(parcel?.userData.source.id).toBe('survey');
    expect(group.children.some((node) => node.userData.worldObjectId === 'oak')).toBe(false);
    const geometry = (parcel?.children[0] as THREE.Mesh).geometry;
    // The source footprint is an L, with 108 m² area, not the 144 m² bounding rectangle.
    geometry.computeBoundingBox();
    expect(geometry.boundingBox?.getSize(new THREE.Vector3()).toArray()).toEqual([12, 6.75, 12]);
    expect(new THREE.Box3().setFromObject(parcel!).getSize(new THREE.Vector3()).y).toBeCloseTo(7);
    const positions = geometry.getAttribute('position');
    let baseArea = 0;
    for (let index = 0; index < positions.count; index += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, index);
      const b = new THREE.Vector3().fromBufferAttribute(positions, index + 1);
      const c = new THREE.Vector3().fromBufferAttribute(positions, index + 2);
      if ([a, b, c].every((point) => Math.abs(point.y) < 0.00001))
        baseArea += Math.abs(b.sub(a).cross(c.sub(a)).y) / 2;
    }
    expect(baseArea).toBeCloseTo(108);
    expect(group.userData.wordscape).toEqual(document);
    expect(group.userData.wordscape).not.toBe(document);
    disposeWorldGroup(group);
  });

  it('keeps the surveyed church towers as separate selectable objects at their reported height', () => {
    const world = createWorldGroup(washingtonSquare, ['landmark'], { terrainEnabled: false });
    expect(world.children.filter((node) => node.userData.worldObjectId)).toHaveLength(3);
    for (const id of ['church-west-tower', 'church-east-tower']) {
      const tower = world.children.find((node) => node.userData.worldObjectId === id);
      expect(tower).toBeDefined();
      const size = new THREE.Box3().setFromObject(tower!).getSize(new THREE.Vector3());
      expect(size.y).toBeCloseTo(58.22);
      expect(tower?.userData.source.id).toBe('parish');
    }
    disposeWorldGroup(world);
  });

  it('generates identical tree shapes and materials from the same seed', () => {
    const a = createWorldGroup(document, ['tree']);
    const b = createWorldGroup(document, ['tree']);
    const signature = (root: THREE.Group): unknown[] => {
      const output: unknown[] = [];
      root.traverse((node) => {
        if (node instanceof THREE.Mesh)
          output.push({
            position: node.position.toArray(),
            scale: node.scale.toArray(),
            rotation: node.rotation.toArray(),
            color: (node.material as THREE.MeshStandardMaterial).color.getHex(),
          });
      });
      return output;
    };
    expect(signature(a)).toEqual(signature(b));
    disposeWorldGroup(a);
    disposeWorldGroup(b);
  });

  it('exports valid GLB with recoverable document and per-object source metadata', async () => {
    // Node has Blob but no FileReader; this implements only the binary API used by GLTFExporter.
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
    const blob = await exportWorldGlb(document);
    const buffer = await blob.arrayBuffer();
    const header = new DataView(buffer);
    expect(blob.type).toBe('model/gltf-binary');
    expect(header.getUint32(0, true)).toBe(0x46546c67);
    expect(header.getUint32(4, true)).toBe(2);
    expect(header.getUint32(8, true)).toBe(buffer.byteLength);
    const jsonLength = header.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))) as {
      nodes: {
        name?: string;
        extras?: {
          wordscape?: WorldDocument;
          worldObject?: WorldObject;
          source?: { id: string };
        };
      }[];
    };
    expect(gltf.nodes.find((node) => node.name === document.name)?.extras?.wordscape).toEqual(
      document,
    );
    expect(
      gltf.nodes.find((node) => node.extras?.worldObject?.id === 'parcel')?.extras?.source?.id,
    ).toBe('survey');
    expect(
      gltf.nodes.find((node) => node.extras?.worldObject?.id === 'parcel')?.extras?.worldObject
        ?.references,
    ).toEqual(document.objects[0].references);
    expect(
      gltf.nodes.find((node) => node.extras?.worldObject?.id === 'oak')?.extras?.worldObject
        ?.parentId,
    ).toBe('parcel');
    expect(
      gltf.nodes.find((node) => node.extras?.worldObject?.id === 'oak')?.extras?.worldObject?.facts,
    ).toEqual(document.objects[1].facts);
  });
});
