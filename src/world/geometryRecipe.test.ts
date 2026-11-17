import published from '../../public/wordscape.schema.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import {
  GEOMETRY_RECIPE_SCHEMA,
  geometryPartBounds,
  transformGeometryPoint,
  validateGeometryRecipe,
} from './geometryRecipe';
import { createGeometryTemplate, GEOMETRY_TEMPLATE_IDS } from './geometryTemplates';
import { migrateWorld, parseWorld, serializeWorld, updateObject, validateWorld } from './document';
import type { GeometryPart, GeometryRecipe, WorldDocument } from './types';

function box(patch: Partial<GeometryPart> = {}): GeometryPart {
  return {
    id: 'block',
    label: 'Block',
    primitive: 'box',
    position: [0, 0.5, 0],
    rotation: [0, 0, 0],
    dimensions: [0.5, 1, 0.5],
    color: '#abc123',
    footprint: null,
    ...patch,
  };
}
function recipe(part = box()): GeometryRecipe {
  return {
    type: 'parts',
    version: 1,
    space: 'normalized-object',
    evidence: 'authored',
    parts: [part],
  };
}
function world(): WorldDocument {
  return {
    format: 'wordscape',
    version: '0.4',
    name: 'Recipe test',
    description: '',
    units: 'metres',
    bounds: { width: 100, depth: 100 },
    origin: { latitude: 0, longitude: 0, note: '' },
    seed: 1,
    sources: [{ id: 'survey', title: 'Survey', url: '', attribution: '', accessed: '', notes: '' }],
    relations: [],
    terrain: {
      type: 'height-grid',
      rows: 2,
      columns: 2,
      spacing: 100,
      origin: { x: 0, y: 0 },
      heights: [10, 20, 10, 20],
      referenceElevation: 10,
      verticalDatum: 'Fixture',
      sourceId: 'survey',
      sourceResolution: 100,
      interpolation: 'bilinear',
    },
    objects: [
      {
        id: 'custom',
        label: 'Custom shape',
        description: '',
        kind: 'building',
        x: 50,
        y: 50,
        width: 12,
        depth: 8,
        height: 6,
        elevation: 0,
        grounding: 'terrain',
        rotation: 0,
        layer: 1,
        evidence: 'observed',
        sourceId: 'survey',
        geometry: recipe(),
        facts: [{ key: 'building.levels', value: 2, evidence: 'sourced', sourceIds: ['survey'] }],
        references: [{ sourceId: 'survey', role: 'photo' }],
      },
    ],
  };
}

describe('bounded declarative geometry', () => {
  it('validates independent editable examples covering every supported primitive', () => {
    const primitives = new Set();
    for (const id of GEOMETRY_TEMPLATE_IDS) {
      const template = createGeometryTemplate(id);
      expect(validateGeometryRecipe(template.geometry, template), id).toEqual([]);
      template.geometry.parts.forEach((part) => primitives.add(part.primitive));
      const original = createGeometryTemplate(id);
      template.geometry.parts[0].color = '#000000';
      expect(original.geometry.parts[0].color).not.toBe('#000000');
    }
    expect([...primitives].sort()).toEqual([
      'box',
      'cone',
      'cylinder',
      'extruded-polygon',
      'sphere',
    ]);
  });

  it('uses the documented dimension, X/Y/Z rotation and translation order', () => {
    const part = box({
      dimensions: [0.2, 0.4, 0.6],
      position: [0.1, 0.5, -0.1],
      rotation: [90, 0, 90],
    });
    const transformed = transformGeometryPoint([0.5, 0.5, 0.5], part);
    expect(transformed[0]).toBeCloseTo(0.4);
    expect(transformed[1]).toBeCloseTo(0.6);
    expect(transformed[2]).toBeCloseTo(0.1);
    expect(geometryPartBounds(part).min[1]).toBeCloseTo(0.4);
    expect(validateGeometryRecipe(recipe(part))).toEqual([]);
  });

  it('rejects transformed overflow even when the part centre is inside', () => {
    expect(
      validateGeometryRecipe(recipe(box({ dimensions: [1, 0.5, 1], rotation: [0, 45, 0] }))).join(
        ' ',
      ),
    ).toMatch(/envelope/);
    expect(validateGeometryRecipe(recipe(box({ position: [0, 0, 0] }))).join(' ')).toMatch(
      /envelope/,
    );
    expect(validateGeometryRecipe(recipe(box({ position: [0.4, 0.5, 0] }))).join(' ')).toMatch(
      /envelope/,
    );
  });

  it('respects concave traced footprints, including notches between accepted corners', () => {
    const envelope = {
      width: 10,
      height: 10,
      depth: 10,
      footprint: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [1, 5],
        [1, -1],
        [-1, -1],
        [-1, 5],
        [-5, 5],
      ] as [number, number][],
    };
    expect(
      validateGeometryRecipe(recipe(box({ dimensions: [0.8, 1, 0.8] })), envelope).join(' '),
    ).toMatch(/traced object footprint/);
    expect(
      validateGeometryRecipe(
        recipe(box({ position: [-0.3, 0.5, 0], dimensions: [0.2, 1, 0.8] })),
        envelope,
      ),
    ).toEqual([]);
    const lShape = {
      ...envelope,
      footprint: [
        [-5, -5],
        [5, -5],
        [5, 0],
        [0, 0],
        [0, 5],
        [-5, 5],
      ] as [number, number][],
    };
    expect(validateGeometryRecipe(recipe(box()), lShape).join(' ')).toMatch(
      /traced object footprint/,
    );
    expect(
      validateGeometryRecipe(
        recipe(box({ position: [-0.25, 0.5, 0.25], dimensions: [0.5, 1, 0.5] })),
        lShape,
      ),
    ).toEqual([]);
  });

  it('rejects executable extensions, source claims and resource-amplifying data', () => {
    for (const invalid of [
      { ...recipe(), script: 'fetch("https://example.com")' },
      { ...recipe(), evidence: 'sourced' },
      {
        ...recipe(),
        parts: Array.from({ length: 33 }, (_, index) => box({ id: `part-${index}` })),
      },
      { ...recipe(), parts: [box(), box()] },
      { ...recipe(), parts: [box({ color: 'url(https://example.com/texture)' })] },
      { ...recipe(), parts: [box({ dimensions: [NaN, 1, 1] })] },
      { ...recipe(), parts: [{ ...box(), subdivisions: 100000 }] },
      { ...recipe(), parts: [{ ...box(), primitive: {} }] },
    ])
      expect(validateGeometryRecipe(invalid).length).toBeGreaterThan(0);
    expect(validateGeometryRecipe(recipe(), { width: 1, depth: 1, height: 0 }).join(' ')).toMatch(
      /positive/,
    );
  });

  it('rejects missing fields and invalid extrusion polygons without silently repairing data', () => {
    const incomplete: Record<string, unknown> = { ...box() };
    delete incomplete.footprint;
    expect(validateGeometryRecipe({ ...recipe(), parts: [incomplete] }).join(' ')).toMatch(
      /footprint/,
    );
    for (const footprint of [
      null,
      [
        [0, 0],
        [0, 0],
        [0.5, 0.5],
      ],
      [
        [-0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
        [0.5, -0.5],
      ],
      Array.from({ length: 17 }, (_, i) => [Math.cos(i), Math.sin(i)]),
    ]) {
      expect(
        validateGeometryRecipe({
          ...recipe(),
          parts: [{ ...box(), primitive: 'extruded-polygon', footprint }],
        }).join(' '),
      ).toMatch(/footprint/);
    }
  });

  it('keeps the published document schema and backend recipe schema identical', () => {
    expect(published.$defs.geometryRecipe).toEqual(GEOMETRY_RECIPE_SCHEMA);
    expect(GEOMETRY_RECIPE_SCHEMA.additionalProperties).toBe(false);
  });
});

describe('recipe document integration', () => {
  it('round-trips recipes with terrain, source evidence and references intact', () => {
    const document = world();
    expect(validateWorld(document).errors).toEqual([]);
    expect(parseWorld(serializeWorld(document))).toEqual(document);
    const edited = updateObject(document, 'custom', { width: 15, height: 9 });
    expect(edited.objects[0].geometry).toEqual(document.objects[0].geometry);
    expect(edited.objects[0].evidence).toBe('authored');
    expect(edited.objects[0].facts).toEqual(document.objects[0].facts);
  });

  it('requires version0.4 for recipes while migrating older terrain without inventing geometry', () => {
    const legacy = world();
    legacy.version = '0.3';
    expect(validateWorld(legacy).errors.join(' ')).toMatch(/0.4/);
    delete legacy.objects[0].geometry;
    const migrated = migrateWorld(legacy);
    expect(migrated).toEqual({ ...legacy, version: '0.8' });
    expect(migrated.terrain).not.toBe(legacy.terrain);
    expect(migrated.objects[0].geometry).toBeUndefined();
    expect(legacy.version).toBe('0.3');
  });

  it('rejects an edit that pushes generated parts outside an unchanged traced footprint', () => {
    const document = world();
    document.objects[0].footprint = [
      [-3, -2],
      [3, -2],
      [3, 2],
      [-3, 2],
    ];
    expect(validateWorld(document).errors).toEqual([]);
    expect(() => updateObject(document, 'custom', { width: 20 })).toThrow(
      /traced object footprint/,
    );
    expect(document.objects[0].width).toBe(12);
  });
});
