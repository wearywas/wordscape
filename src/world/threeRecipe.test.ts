import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGeometryTemplate, GEOMETRY_TEMPLATE_IDS } from './geometryTemplates';
import { createWorldGroup, disposeWorldGroup, exportWorldGlb } from './threeAdapter';
import { getObjectBaseElevation } from './terrain';
import type { GeometryPart, WorldDocument, WorldObject } from './types';

function fixture(template = createGeometryTemplate('pavilion')): WorldDocument {
  return {
    format: 'wordscape',
    version: '0.4',
    name: 'Portable recipes',
    description: '',
    units: 'metres',
    bounds: { width: 40, depth: 40 },
    origin: { latitude: 0, longitude: 0, note: '' },
    seed: 42,
    relations: [],
    sources: [
      {
        id: 'survey',
        title: 'Fixture survey',
        url: 'https://example.com',
        attribution: 'Fixture',
        accessed: '2026-11-15',
        notes: '',
      },
    ],
    terrain: {
      type: 'height-grid',
      columns: 2,
      rows: 2,
      spacing: 40,
      origin: { x: 0, y: 0 },
      heights: [100, 120, 100, 120],
      referenceElevation: 100,
      verticalDatum: 'Fixture datum',
      sourceId: 'survey',
      sourceResolution: 40,
      interpolation: 'bilinear',
    },
    objects: [
      {
        ...template,
        id: 'recipe-object',
        description: 'Authored shape at a recorded placement',
        x: 20,
        y: 20,
        elevation: 0.2,
        grounding: 'terrain',
        terrainAnchor: 'highest-footprint',
        rotation: 0,
        layer: 0,
        evidence: 'observed',
        sourceId: 'survey',
        facts: [{ key: 'building.levels', value: 2, evidence: 'sourced', sourceIds: ['survey'] }],
        references: [{ sourceId: 'survey', role: 'photo' }],
      },
    ],
  };
}
function objectGroup(root: THREE.Group, id = 'recipe-object'): THREE.Group {
  return root.children.find((node) => node.userData.worldObjectId === id) as THREE.Group;
}
function partMeshes(group: THREE.Group): THREE.Mesh[] {
  return group.children.filter((node) => node.userData.recipePartId) as THREE.Mesh[];
}
afterEach(() => vi.unstubAllGlobals());

describe('portable recipe renderer', () => {
  it('keeps explicitly mapped parent outlines as metadata without covering their parts', () => {
    const world = fixture();
    const parent = {
      ...world.objects[0],
      id: 'outline',
      geometry: undefined,
      facts: [{ key: 'building.isOutline', value: true, evidence: 'observed' as const }],
      width: 20,
      depth: 20,
    };
    world.objects[0].parentId = parent.id;
    world.objects.push(parent);
    const root = createWorldGroup(world);
    expect(objectGroup(root, 'outline').children).toHaveLength(0);
    expect(objectGroup(root, 'outline').userData.worldObject).toEqual(parent);
    expect(partMeshes(objectGroup(root))).toHaveLength(world.objects[0].geometry!.parts.length);
    disposeWorldGroup(root);
    world.objects = [parent];
    const unpartitioned = createWorldGroup(world);
    expect(objectGroup(unpartitioned, 'outline').children.length).toBeGreaterThan(0);
    disposeWorldGroup(unpartitioned);
  });

  it('renders every recipe primitive within its declared physical envelope', () => {
    for (const id of GEOMETRY_TEMPLATE_IDS) {
      const world = fixture(createGeometryTemplate(id)),
        object = world.objects[0];
      const root = createWorldGroup(world, undefined, { terrainEnabled: false });
      const group = objectGroup(root);
      const meshes = partMeshes(group);
      expect(meshes).toHaveLength(object.geometry!.parts.length);
      expect(group.userData.rendering.adapter).toBe('geometry-parts');
      for (const mesh of meshes) {
        mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox!;
        expect(bounds.min.x).toBeGreaterThanOrEqual(-object.width / 2 - 1e-5);
        expect(bounds.max.x).toBeLessThanOrEqual(object.width / 2 + 1e-5);
        expect(bounds.min.z).toBeGreaterThanOrEqual(-object.depth / 2 - 1e-5);
        expect(bounds.max.z).toBeLessThanOrEqual(object.depth / 2 + 1e-5);
        expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-5);
        expect(bounds.max.y).toBeLessThanOrEqual(object.height + 1e-5);
        expect(mesh.userData.detailEvidence).toBe('authored');
        expect(mesh.userData.worldObjectId).toBe(object.id);
        expect(mesh.geometry.getAttribute('position').count).toBeLessThan(2000);
      }
      expect(meshes.some((mesh) => mesh.userData.renderRole === 'building-body')).toBe(false);
      disposeWorldGroup(root);
    }
  });

  it('renders the polygon roof as a triangular extrusion and scales edits predictably', () => {
    const world = fixture();
    const first = createWorldGroup(world, undefined, { terrainEnabled: false });
    const roof = partMeshes(objectGroup(first)).find(
      (mesh) => mesh.userData.recipePartId === 'gable-roof',
    )!;
    const source = Array.from(roof.geometry.getAttribute('position').array);
    const yLevels = new Set(source.filter((_, index) => index % 3 === 1).map((y) => y.toFixed(5)));
    expect(yLevels.size).toBe(2);
    expect(roof.geometry.getAttribute('position').count).toBe(24);
    const resized = structuredClone(world);
    resized.objects[0].width *= 2;
    resized.objects[0].height *= 3;
    const second = createWorldGroup(resized, undefined, { terrainEnabled: false });
    const changed = partMeshes(objectGroup(second))
      .find((mesh) => mesh.userData.recipePartId === 'gable-roof')!
      .geometry.getAttribute('position');
    source.forEach((value, index) =>
      expect(changed.array[index]).toBeCloseTo(
        value * (index % 3 === 0 ? 2 : index % 3 === 1 ? 3 : 1),
        4,
      ),
    );
    [first, second].forEach(disposeWorldGroup);
  });

  it('keeps recipes rigid on terrain and never applies parent transforms twice', () => {
    const world = fixture(createGeometryTemplate('bench'));
    const object = world.objects[0];
    object.kind = 'road';
    object.parentId = 'parent';
    object.rotation = 37;
    world.objects.push({
      ...object,
      id: 'parent',
      parentId: undefined,
      geometry: undefined,
      kind: 'building',
      x: 7,
      y: 9,
      rotation: 80,
      width: 3,
      depth: 3,
      height: 2,
    });
    const root = createWorldGroup(world),
      group = objectGroup(root);
    expect(group.position.x).toBeCloseTo(0);
    expect(group.position.y).toBeCloseTo(getObjectBaseElevation(world, object)!);
    expect(group.position.z).toBeCloseTo(0);
    expect(group.rotation.y).toBeCloseTo(THREE.MathUtils.degToRad(37));
    expect(group.userData.grounding.surface).toBe('upright at shared engine base');
    const seat = partMeshes(group).find((mesh) => mesh.userData.recipePartId === 'seat')!;
    const positions = seat.geometry.getAttribute('position');
    const heights = new Set(
      Array.from({ length: positions.count }, (_, index) => positions.getY(index).toFixed(5)),
    );
    expect(heights.size).toBe(2);
    expect(group.userData.worldObject.parentId).toBe('parent');
    disposeWorldGroup(root);
  });

  it('rejects direct renderer use of invalid recipes before creating part meshes', () => {
    const world = fixture();
    world.objects[0].geometry!.parts[0].dimensions = [100000, 1, 1];
    expect(() => createWorldGroup(world)).toThrow(/Invalid geometry/);
  });

  it('exports the full recipe, each named part, terrain and independent factual evidence', async () => {
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
    const world = fixture(createGeometryTemplate('sculpture'));
    world.version = '0.5';
    world.aerial = {
      type: 'online-imagery',
      provider: 'usgs-imagery',
      bounds: { west: -122.42, south: 37.8, east: -122.4195, north: 37.8004 },
      sourceId: 'survey',
    };
    const buffer = await (await exportWorldGlb(world)).arrayBuffer();
    const view = new DataView(buffer);
    const gltf = JSON.parse(
      new TextDecoder().decode(new Uint8Array(buffer, 20, view.getUint32(12, true))),
    ) as {
      images?: unknown[];
      nodes: {
        extras?: {
          wordscape?: WorldDocument;
          worldObject?: WorldObject;
          recipePartId?: string;
          recipePart?: GeometryPart;
          detailEvidence?: string;
        };
      }[];
    };
    expect(gltf.nodes.find((node) => node.extras?.wordscape)?.extras?.wordscape).toEqual(world);
    expect(gltf.images).toBeUndefined();
    expect(
      gltf.nodes.find((node) => node.extras?.worldObject?.id === 'recipe-object')?.extras
        ?.worldObject,
    ).toEqual(world.objects[0]);
    for (const part of world.objects[0].geometry!.parts) {
      const extras = gltf.nodes.find((node) => node.extras?.recipePartId === part.id)?.extras;
      expect(extras?.recipePart).toEqual(part);
      expect(extras?.detailEvidence).toBe('authored');
    }
  });
});
