import { describe, expect, it } from 'vitest';
import {
  documentBytes,
  duplicateObject,
  getDescendants,
  getFact,
  getFootprint,
  makeObject,
  migrateWorld,
  parseWorld,
  removeObject,
  serializeWorld,
  updateObject,
  validateWorld,
} from './document';
import type { WorldDocument, WorldObject } from './types';
import { getObjectBaseElevation } from './terrain';

function fixture(): WorldDocument {
  return {
    format: 'wordscape',
    version: '0.1',
    name: 'A small world 🌳',
    description: 'Editable spatial text.',
    units: 'metres',
    bounds: { width: 100, depth: 100 },
    origin: { latitude: 51.5, longitude: -0.1, note: 'Southwest corner.' },
    seed: 42,
    sources: [
      {
        id: 'map',
        title: 'Map',
        url: 'https://example.com',
        attribution: 'Example',
        accessed: '2026-11-15',
        notes: '',
      },
    ],
    objects: [
      {
        id: 'house',
        label: 'House',
        kind: 'building',
        description: '',
        x: 20,
        y: 30,
        width: 10,
        depth: 6,
        height: 8,
        elevation: 0,
        rotation: 0,
        layer: 1,
        evidence: 'observed',
        sourceId: 'map',
        tags: ['home'],
      },
    ],
    relations: [],
  };
}

describe('world document boundary', () => {
  it('preserves all world data through compact and readable serialization', () => {
    const world = fixture();
    world.objects[0].footprint = [
      [-5, -3],
      [5, -3],
      [2, 3],
      [-5, 3],
    ];
    const readable = serializeWorld(world);
    expect(readable).toContain('\n');
    expect(parseWorld(readable)).toEqual(world);
    expect(parseWorld(serializeWorld(world, false))).toEqual(world);
    expect(serializeWorld(parseWorld(readable))).toBe(readable);
  });

  it('canonicalizes property ordering without changing object or relation array order', () => {
    const world = fixture();
    const reversed = Object.fromEntries(
      Object.entries(world).reverse(),
    ) as unknown as WorldDocument;
    expect(serializeWorld(reversed)).toBe(serializeWorld(world));
    world.objects.push({ ...world.objects[0], id: 'second', x: 60 });
    expect(parseWorld(serializeWorld(world)).objects.map((object) => object.id)).toEqual([
      'house',
      'second',
    ]);
  });

  it('counts compact UTF-8 bytes, including multibyte labels', () => {
    const world = fixture();
    const ascii = { ...world, name: 'A small world x' };
    expect(documentBytes(world) - documentBytes(ascii)).toBe(3);
    expect(documentBytes(world)).toBe(
      new TextEncoder().encode(serializeWorld(world, false)).byteLength,
    );
  });

  it.each(['{', 'null', '[]', '42', '{}'])(
    'rejects invalid input with a useful document error: %s',
    (input) => {
      expect(() => parseWorld(input)).toThrow(/JSON|world|format|document/i);
    },
  );

  it('identifies invalid fields instead of accepting malformed numeric values', () => {
    const world = fixture();
    world.objects[0].width = -10;
    world.objects[0].x = Infinity;
    world.origin.latitude = 91;
    const errors = validateWorld(world).errors.join('\n');
    expect(errors).toMatch(/objects\[0\]\.width/);
    expect(errors).toMatch(/objects\[0\]\.x.*finite/);
    expect(errors).toMatch(/origin\.latitude/);
    expect(() => serializeWorld(world)).toThrow(/width|finite/);
  });

  it('rejects unknown versions, kinds, fields, and executable source URLs', () => {
    const world = fixture();
    const raw = JSON.parse(JSON.stringify(world));
    raw.version = '9.0';
    raw.objects[0].kind = 'script';
    raw.objects[0].html = '<script>bad()</script>';
    raw.sources[0].url = 'javascript:alert(1)';
    expect(() => parseWorld(JSON.stringify(raw))).toThrow(/version/);
    const errors = validateWorld(raw).errors.join('\n');
    expect(errors).toMatch(/kind/);
    expect(errors).toMatch(/html/);
    expect(errors).toMatch(/url/);
  });

  it('rejects duplicate IDs and broken object or source references', () => {
    const world = fixture();
    world.objects.push({ ...world.objects[0], sourceId: 'missing' });
    world.sources.push({ ...world.sources[0] });
    world.relations.push({ from: 'house', to: 'ghost', type: 'near' });
    const errors = validateWorld(world).errors.join('\n');
    expect(errors).toMatch(/duplicate.*house/i);
    expect(errors).toMatch(/duplicate.*map/i);
    expect(errors).toMatch(/sourceId.*missing/);
    expect(errors).toMatch(/relations\[0\]\.to.*ghost/);
  });

  it('enforces document, object, vertex, and string resource limits', () => {
    expect(() => parseWorld(' '.repeat(16 * 1024 * 1024 + 1))).toThrow(/large|limit/i);
    expect(() => parseWorld(JSON.stringify(fixture()) + ' '.repeat(4 * 1024 * 1024))).toThrow(
      /4 MiB/,
    );
    const world = fixture();
    world.objects = Array.from({ length: 1001 }, (_, index) => ({
      ...world.objects[0],
      id: `o${index}`,
    }));
    expect(validateWorld(world).errors.join()).toMatch(/1000/);
    world.objects = [fixture().objects[0]];
    world.objects[0].footprint = Array.from({ length: 257 }, (_, index) => [index, 0]);
    world.objects[0].label = 'x'.repeat(10001);
    expect(validateWorld(world).errors.join()).toMatch(/256/);
    expect(validateWorld(world).errors.join()).toMatch(/label/);
  });

  it('rejects degenerate or crossing footprints before rendering them', () => {
    const world = fixture();
    world.objects[0].footprint = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    expect(validateWorld(world).errors.join()).toMatch(/footprint/);
    world.objects[0].footprint = [
      [0, 0],
      [2, 2],
      [0, 2],
      [2, 0],
    ];
    expect(validateWorld(world).errors.join()).toMatch(/footprint/);
  });
});

function containerFixture(): WorldDocument {
  const world = fixture();
  world.version = '0.2';
  world.objects[0].facts = [
    { key: 'building.levels', value: 2, evidence: 'sourced', sourceIds: ['map'] },
    { key: 'building.material', value: null, evidence: 'unknown', note: 'Not established.' },
  ];
  world.objects[0].references = [{ sourceId: 'map', role: 'photo', view: 'north facade' }];
  world.objects.push(
    {
      ...fixture().objects[0],
      id: 'child',
      kind: 'fixture',
      parentId: 'house',
      x: 24,
      y: 30,
      width: 2,
      depth: 1,
      height: 1,
      elevation: 3,
      rotation: 20,
    },
    {
      ...fixture().objects[0],
      id: 'grandchild',
      kind: 'fixture',
      parentId: 'child',
      x: 24,
      y: 32,
      width: 1,
      depth: 1,
      height: 1,
      elevation: 4,
      rotation: 10,
    },
    { ...fixture().objects[0], id: 'unrelated', x: 70, y: 70 },
  );
  world.relations = [
    { from: 'child', to: 'house', type: 'within', note: 'Part of the placement.' },
    { from: 'house', to: 'unrelated', type: 'near' },
    { from: 'unrelated', to: 'grandchild', type: 'connects' },
  ];
  return world;
}

describe('version 0.2 placement containers', () => {
  it('roundtrips child placement, typed facts, evidence, and references without losing legacy fields', () => {
    const world = containerFixture();
    expect(parseWorld(serializeWorld(world))).toEqual(world);
    expect(getFact(world.objects[0], 'building.levels')).toBe(2);
    expect(getFact(world.objects[0], 'building.material')).toBeNull();
    expect(getFact(world.objects[0], 'absent')).toBeUndefined();
  });

  it('migrates legacy documents explicitly and leaves the original unchanged', () => {
    const old = fixture();
    expect(parseWorld(serializeWorld(old)).version).toBe('0.1');
    const migrated = migrateWorld(old);
    expect(migrated).toEqual({ ...old, version: '0.8' });
    expect(migrated.objects).not.toBe(old.objects);
    expect(old.version).toBe('0.1');
    expect(migrateWorld(migrated)).toEqual(migrated);
  });

  it('requires version 0.2 for fixture kinds and new object fields', () => {
    const world = containerFixture();
    world.version = '0.1';
    expect(validateWorld(world).errors.join()).toMatch(/0\.2/);
    const old = fixture();
    old.objects[0].kind = 'fixture';
    expect(validateWorld(old).errors.join()).toMatch(/kind/);
  });

  it('rejects missing parents, self-parenting, and longer parent cycles', () => {
    const world = containerFixture();
    world.objects[1].parentId = 'missing';
    expect(validateWorld(world).errors.join()).toMatch(/parentId.*missing/);
    world.objects[1].parentId = 'child';
    expect(validateWorld(world).errors.join()).toMatch(/parentId.*itself|self/i);
    world.objects[1].parentId = 'house';
    world.objects[0].parentId = 'grandchild';
    expect(validateWorld(world).errors.join()).toMatch(/cyc/i);
  });

  it('rejects duplicate fact keys, broken provenance, and unknown facts pretending to be values', () => {
    const world = containerFixture();
    world.objects[0].facts!.push(
      { key: 'building.levels', value: 3, evidence: 'sourced', sourceIds: ['missing'] },
      { key: 'tree.species', value: 'Oak', evidence: 'unknown' },
      { key: 'road.direction', value: null, evidence: 'observed' },
      { key: 'building.material', value: 'Brick', evidence: 'sourced' },
    );
    world.objects[0].references!.push({ sourceId: 'gone', role: 'history' });
    const errors = validateWorld(world).errors.join('\n');
    expect(errors).toMatch(/duplicate.*building.levels/);
    expect(errors).toMatch(/sourceIds.*missing/);
    expect(errors).toMatch(/unknown.*null|null.*unknown/);
    expect(errors).toMatch(/sourced.*source/);
    expect(errors).toMatch(/references.*gone/);
  });

  it('limits fact/reference payloads and rejects nonfinite numeric facts', () => {
    const world = containerFixture();
    world.objects[0].facts = [{ key: 'building.levels', value: Infinity, evidence: 'inferred' }];
    expect(validateWorld(world).errors.join()).toMatch(/facts.*finite/);
    world.objects[0].facts = Array.from({ length: 65 }, (_, i) => ({
      key: `fact.${i}`,
      value: i,
      evidence: 'authored' as const,
    }));
    world.objects[0].references = Array.from({ length: 33 }, () => ({
      sourceId: 'map',
      role: 'map' as const,
    }));
    const errors = validateWorld(world).errors.join();
    expect(errors).toMatch(/64/);
    expect(errors).toMatch(/32/);
  });

  it('finds the complete subtree without depending on object array order', () => {
    const world = containerFixture();
    [world.objects[1], world.objects[2]] = [world.objects[2], world.objects[1]];
    expect(getDescendants(world, 'house').map((object) => object.id)).toEqual([
      'grandchild',
      'child',
    ]);
    expect(getDescendants(world, 'missing')).toEqual([]);
    expect(getDescendants(world, 'child').map((object) => object.id)).toEqual(['grandchild']);
  });

  it('moves and rotates nested children once around the old root pivot, including elevation', () => {
    const world = containerFixture();
    const moved = updateObject(world, 'house', { x: 30, y: 40, rotation: 90, elevation: 5 });
    const child = moved.objects.find((object) => object.id === 'child')!;
    const grandchild = moved.objects.find((object) => object.id === 'grandchild')!;
    expect(child.x).toBeCloseTo(30);
    expect(child.y).toBeCloseTo(44);
    expect(child.elevation).toBe(8);
    expect(child.rotation).toBe(110);
    expect(grandchild.x).toBeCloseTo(28);
    expect(grandchild.y).toBeCloseTo(44);
    expect(grandchild.elevation).toBe(9);
    expect(grandchild.rotation).toBe(100);
    expect(child.width).toBe(2);
    expect(child.height).toBe(1);
    expect(moved.objects[3]).toEqual(world.objects[3]);
    expect(world.objects[0].x).toBe(20);
    expect(world.objects[1].x).toBe(24);
    expect(moved.objects[0].facts).toEqual(world.objects[0].facts);
  });

  it('resizes containers without scaling or moving child geometry', () => {
    const world = containerFixture();
    const resized = updateObject(world, 'house', { width: 30, depth: 20, height: 40 });
    expect(resized.objects[1]).toEqual(world.objects[1]);
    expect(resized.objects[2]).toEqual(world.objects[2]);
    expect(() => updateObject(world, 'house', { parentId: 'grandchild' })).toThrow(/cycl/i);
    expect(() => updateObject(world, 'house', { id: 'renamed' })).toThrow(/ID|id/);
    expect(() => updateObject(world, 'missing', { x: 2 })).toThrow(/missing/);
  });

  it('rejects an entire transform when any descendant exceeds coordinate limits', () => {
    const world = containerFixture();
    world.objects[1].x = 1000000;
    expect(() => updateObject(world, 'house', { x: 21 })).toThrow(/objects\[1\]\.x/);
    expect(world.objects[0].x).toBe(20);
    expect(world.objects[1].x).toBe(1000000);
  });

  it('removes a whole subtree and every relation touching it', () => {
    const world = containerFixture();
    const removed = removeObject(world, 'house');
    expect(removed.objects.map((object) => object.id)).toEqual(['unrelated']);
    expect(removed.relations).toEqual([]);
    expect(world.objects).toHaveLength(4);
  });

  it('duplicates nested objects with independent data, remapped parents, and preserved external links', () => {
    const world = containerFixture();
    const { world: duplicated, rootId } = duplicateObject(world, 'house');
    const copy = duplicated.objects.find((object) => object.id === rootId)!;
    const descendants = getDescendants(duplicated, rootId);
    expect(duplicated.objects).toHaveLength(7);
    expect(descendants).toHaveLength(2);
    expect(new Set(duplicated.objects.map((object) => object.id)).size).toBe(7);
    expect(copy.x).toBe(30);
    expect(copy.y).toBe(40);
    expect(copy.facts).toEqual(world.objects[0].facts);
    expect(copy.facts).not.toBe(world.objects[0].facts);
    expect(descendants[0].parentId).toBe(rootId);
    expect(descendants[1].parentId).toBe(descendants[0].id);
    expect(descendants[0].x).toBe(34);
    expect(duplicated.relations).toContainEqual({ from: rootId, to: 'unrelated', type: 'near' });
    expect(duplicated.relations).toContainEqual({
      from: 'unrelated',
      to: descendants[1].id,
      type: 'connects',
    });
    expect(duplicated.relations).toContainEqual({
      from: descendants[0].id,
      to: rootId,
      type: 'within',
      note: 'Part of the placement.',
    });
    expect(validateWorld(duplicated).errors).toEqual([]);
  });

  it('keeps the external parent when duplicating a child container', () => {
    const world = containerFixture();
    const result = duplicateObject(world, 'child');
    expect(result.world.objects.find((object) => object.id === result.rootId)?.parentId).toBe(
      'house',
    );
    expect(getDescendants(result.world, result.rootId)).toHaveLength(1);
  });

  it('creates a valid fixture placement with editable defaults', () => {
    const world = containerFixture();
    world.objects.push(makeObject('fixture', 10, 10));
    expect(validateWorld(world).errors).toEqual([]);
    expect(world.objects.at(-1)?.evidence).toBe('authored');
  });

  it('handles the maximum parent-chain depth iteratively and rejects a cycle at its end', () => {
    const world = containerFixture();
    world.relations = [];
    world.objects = Array.from({ length: 1000 }, (_, index) => ({
      ...fixture().objects[0],
      id: `node-${index}`,
      kind: 'fixture',
      ...(index ? { parentId: `node-${index - 1}` } : {}),
    }));
    expect(validateWorld(world).errors).toEqual([]);
    expect(getDescendants(world, 'node-0')).toHaveLength(999);
    expect(() => duplicateObject(world, 'node-0')).toThrow(/1000-object/);
    world.objects[0].parentId = 'node-999';
    expect(validateWorld(world).errors.join()).toMatch(/cycle/);
    expect(getDescendants(world, 'node-0')).toHaveLength(999);
  });

  it('rejects aggregate content that exceeds the import budget despite valid individual fields', () => {
    const world = containerFixture();
    world.relations = [];
    world.objects = Array.from({ length: 500 }, (_, index) => ({
      ...fixture().objects[0],
      id: `large-${index}`,
      kind: 'fixture',
      description: 'x'.repeat(10000),
    }));
    expect(validateWorld(world).errors.join()).toMatch(/document.*4 MiB/i);
    expect(() => serializeWorld(world)).toThrow(/4 MiB/);
  });

  it('falls back to compact output when indentation would make an accepted world impossible to import', () => {
    const world = containerFixture();
    world.relations = [];
    const facts = Array.from({ length: 64 }, (_, index) => ({
      key: `fact.${index}`,
      value: index,
      evidence: 'authored' as const,
    }));
    world.objects = Array.from({ length: 800 }, (_, index) => ({
      ...fixture().objects[0],
      id: `large-${index}`,
      kind: 'fixture',
      facts,
    }));
    expect(validateWorld(world).errors).toEqual([]);
    const saved = serializeWorld(world);
    expect(() => parseWorld(saved)).not.toThrow();
    expect(parseWorld(saved).objects).toHaveLength(800);
  });
});

function terrainFixture(): WorldDocument {
  const world = containerFixture();
  world.version = '0.3';
  world.terrain = {
    type: 'height-grid',
    columns: 2,
    rows: 2,
    spacing: 100,
    origin: { x: 0, y: 0 },
    heights: [0, 0, 0, 100],
    verticalDatum: 'Test datum',
    referenceElevation: 0,
    sourceId: 'map',
    sourceResolution: 1,
    interpolation: 'bilinear',
    acquired: { start: '2023-04-20', end: '2023-04-20' },
  };
  world.objects[0].grounding = 'terrain';
  world.objects[0].elevation = 2;
  world.objects[1].elevation = 11;
  world.objects[2].grounding = 'terrain';
  world.objects[2].elevation = 3;
  return world;
}

describe('version 0.3 terrain document integrity', () => {
  it('keeps version 0.7 readable unchanged and requires 0.8 for explicit terrain evidence', () => {
    const legacy = terrainFixture();
    legacy.version = '0.7';
    const before = structuredClone(legacy);
    expect(parseWorld(serializeWorld(legacy))).toEqual(before);
    expect(migrateWorld(legacy)).toEqual({ ...before, version: '0.8' });
    expect(legacy).toEqual(before);
    legacy.terrain!.evidence = 'authored';
    expect(validateWorld(legacy).errors.join(' ')).toMatch(/terrain.evidence.*0\.8/);
    legacy.version = '0.8';
    expect(parseWorld(serializeWorld(legacy))).toEqual(legacy);
  });
  it('roundtrips source-datum heights, capture interval and explicit grounding without normalizing samples', () => {
    const world = terrainFixture();
    expect(parseWorld(serializeWorld(world))).toEqual(world);
    expect(migrateWorld(world)).toEqual({ ...world, version: '0.8' });
    const legacy = containerFixture();
    const migrated = migrateWorld(legacy);
    expect(migrated.version).toBe('0.8');
    expect(migrated.terrain).toBeUndefined();
    expect(migrated.objects).toEqual(legacy.objects);
  });

  it('rejects terrain and grounding in older versions without silently changing their meaning', () => {
    const world = terrainFixture();
    world.version = '0.2';
    expect(validateWorld(world).errors.join()).toMatch(/terrain.*0\.3/);
    delete world.terrain;
    expect(validateWorld(world).errors.join()).toMatch(/grounding.*0\.3/);
  });

  it('validates grid dimensions, exact sample count, finite heights, origin, spacing and provenance', () => {
    const world = terrainFixture();
    world.terrain!.columns = 258;
    world.terrain!.rows = 1.5;
    world.terrain!.spacing = 0;
    world.terrain!.heights = [Infinity];
    world.terrain!.origin.x = NaN;
    world.terrain!.sourceId = 'missing-dem';
    const errors = validateWorld(world).errors.join('\n');
    expect(errors).toMatch(/terrain.columns/);
    expect(errors).toMatch(/terrain.rows/);
    expect(errors).toMatch(/terrain.spacing/);
    expect(errors).toMatch(/terrain.heights/);
    expect(errors).toMatch(/terrain.origin.x/);
    expect(errors).toMatch(/sourceId.*missing-dem/);
  });

  it('requires a real ordered capture interval and a terrain-only highest-footprint anchor', () => {
    const world = terrainFixture();
    world.terrain!.acquired = { start: '2023-02-30', end: '2023-01-01' };
    world.objects[1].terrainAnchor = 'highest-footprint';
    const errors = validateWorld(world).errors.join('\n');
    expect(errors).toMatch(/acquired/);
    expect(errors).toMatch(/terrainAnchor.*grounding/);
  });

  it('retains null height samples and warns when a placement cannot be grounded', () => {
    const world = terrainFixture();
    world.terrain!.heights[0] = null;
    expect(validateWorld(world).errors).toEqual([]);
    expect(validateWorld(world).warnings.join()).toMatch(/terrain coverage/);
    expect(parseWorld(serializeWorld(world)).terrain!.heights[0]).toBeNull();
    expect(getObjectBaseElevation(world, world.objects[0])).toBeUndefined();
  });

  it('uses resolved terrain base heights for physical overlap warnings', () => {
    const world = terrainFixture();
    world.objects = [
      world.objects[0],
      { ...world.objects[0], id: 'lower', grounding: 'absolute', elevation: 0, height: 5 },
    ];
    world.relations = [];
    expect(validateWorld(world).errors).toEqual([]);
    expect(validateWorld(world).warnings).toEqual([]);
  });

  it('preserves rigid physical child relationships across mixed grounding modes on sloped terrain', () => {
    const world = terrainFixture();
    const moved = updateObject(world, 'house', { x: 30, y: 40, rotation: 90 });
    expect(getObjectBaseElevation(moved, moved.objects[0])).toBeCloseTo(14);
    expect(getObjectBaseElevation(moved, moved.objects[1])).toBeCloseTo(17);
    expect(getObjectBaseElevation(moved, moved.objects[2])).toBeCloseTo(16.68);
    expect(moved.objects[2].elevation).toBeCloseTo(4.36);
    expect(moved.objects[2].x).toBeCloseTo(28);
    expect(moved.objects[2].y).toBeCloseTo(44);
    expect(world.objects[2].elevation).toBe(3);
  });

  it('preserves child attachment when resizing changes a highest-footprint anchor height', () => {
    const world = terrainFixture();
    world.objects[0].terrainAnchor = 'highest-footprint';
    const before = getObjectBaseElevation(world, world.objects[0])!;
    const resized = updateObject(world, 'house', { width: 20 });
    const after = getObjectBaseElevation(resized, resized.objects[0])!;
    expect(after - before).toBeCloseTo(1.65);
    expect(resized.objects[1].elevation).toBeCloseTo(12.65);
    expect(resized.objects[1].x).toBe(world.objects[1].x);
    expect(resized.objects[1].width).toBe(world.objects[1].width);
  });

  it('rejects a container move when its physical child base cannot be resolved', () => {
    const world = terrainFixture();
    world.objects[2].x = 200;
    expect(() => updateObject(world, 'house', { x: 30 })).toThrow(/terrain coverage/);
    expect(world.objects[0].x).toBe(20);
  });

  it('duplicates a grounded container using the same physical child transform as a move', () => {
    const world = terrainFixture();
    const copied = duplicateObject(world, 'house');
    const root = copied.world.objects.find((object) => object.id === copied.rootId)!;
    const children = getDescendants(copied.world, copied.rootId);
    expect(getObjectBaseElevation(copied.world, root)).toBeCloseTo(14);
    expect(getObjectBaseElevation(copied.world, children[0])).toBeCloseTo(17);
    expect(getObjectBaseElevation(copied.world, children[1])).toBeCloseTo(16.68);
    expect(children[1].elevation).toBeCloseTo(2.4);
  });
});

describe('plan geometry', () => {
  it('rotates rectangle footprints counterclockwise around their centre', () => {
    const object = { ...fixture().objects[0], x: 10, y: 20, width: 4, depth: 2, rotation: 90 };
    const footprint = getFootprint(object);
    const expected = [
      [11, 18],
      [11, 22],
      [9, 22],
      [9, 18],
    ];
    footprint.forEach(([x, y], index) => {
      expect(x).toBeCloseTo(expected[index][0]);
      expect(y).toBeCloseTo(expected[index][1]);
    });
  });

  it('uses local custom footprints and translates them through x/y alone', () => {
    const object = {
      ...fixture().objects[0],
      x: 10,
      y: 20,
      footprint: [
        [0, 0],
        [4, 0],
        [0, 2],
      ] as [number, number][],
    };
    expect(getFootprint(object)).toEqual([
      [10, 20],
      [14, 20],
      [10, 22],
    ]);
    expect(getFootprint({ ...object, x: 11, y: 18 })).toEqual([
      [11, 18],
      [15, 18],
      [11, 20],
    ]);
    expect(object.footprint).toEqual([
      [0, 0],
      [4, 0],
      [0, 2],
    ]);
  });

  it('represents tree canopies as an ellipse within the declared width and depth', () => {
    const object: WorldObject = {
      ...fixture().objects[0],
      kind: 'tree',
      x: 0,
      y: 0,
      width: 8,
      depth: 4,
    };
    const points = getFootprint(object);
    expect(points.length).toBeGreaterThanOrEqual(8);
    expect(Math.max(...points.map(([x]) => x))).toBeCloseTo(4);
    expect(Math.max(...points.map(([, y]) => y))).toBeCloseTo(2);
    expect(points.every(([x, y]) => (x * x) / 16 + (y * y) / 4 <= 1.000001)).toBe(true);
  });

  it('warns on intersecting building volumes but accepts overlapping vegetation', () => {
    const world = fixture();
    world.objects.push({ ...world.objects[0], id: 'second', x: 22 });
    expect(validateWorld(world).errors).toEqual([]);
    expect(validateWorld(world).warnings.join()).toMatch(
      /overlap.*house.*second|house.*second.*overlap/i,
    );
    world.objects[1].kind = 'grass';
    expect(validateWorld(world).warnings).toEqual([]);
  });

  it('does not report touching or vertically separated buildings as collisions', () => {
    const world = fixture();
    world.objects.push({ ...world.objects[0], id: 'second', x: 30 });
    expect(validateWorld(world).warnings).toEqual([]);
    world.objects[1].x = 20;
    world.objects[1].elevation = 8;
    world.objects[1].layer = 2;
    expect(validateWorld(world).warnings).toEqual([]);
  });

  it('detects narrow overlaps with collinear edges even when drawing layers differ', () => {
    const world = fixture();
    world.objects.push({ ...world.objects[0], id: 'second', x: 29.9, layer: 9 });
    expect(validateWorld(world).warnings.join()).toMatch(/overlap/);
  });

  it('uses actual polygon boundaries instead of only bounding rectangles', () => {
    const world = fixture();
    world.objects[0].footprint = [
      [-4, -4],
      [4, -4],
      [-4, 4],
    ];
    world.objects.push({
      ...world.objects[0],
      id: 'second',
      footprint: [
        [4, 4],
        [4, -3],
        [-3, 4],
      ],
    });
    expect(validateWorld(world).warnings).toEqual([]);
  });

  it('warns when geometry extends beyond the declared world without discarding it', () => {
    const world = fixture();
    world.objects[0].x = 0;
    expect(validateWorld(world).warnings.join()).toMatch(/bounds|outside/i);
    expect(parseWorld(serializeWorld(world))).toEqual(world);
  });

  it('creates distinct editable IDs and valid defaults for every supported kind', () => {
    const world = fixture();
    world.objects = (
      ['grass', 'pavement', 'road', 'building', 'water', 'tree', 'landmark'] as const
    ).map((kind) => makeObject(kind, 50, 50));
    expect(new Set(world.objects.map(({ id }) => id)).size).toBe(7);
    expect(validateWorld(world).errors).toEqual([]);
    expect(
      world.objects.every(({ evidence, x, y }) => evidence === 'authored' && x === 50 && y === 50),
    ).toBe(true);
  });
});
