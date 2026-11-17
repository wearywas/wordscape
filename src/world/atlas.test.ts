import { describe, expect, it } from 'vitest';
import { adjacentBounds, combineSurveyWorlds } from './atlas';
import { makeObject, parseWorld, serializeWorld, updateObject, validateWorld } from './document';
import { geographicFrame } from '../imports/osm';
import { getObjectBaseElevation, sampleTerrain } from './terrain';
import { createContainerPacket } from './packet';
import { viewObjectBase } from './threeTerrain';
import type { GeographicBounds, WorldDocument } from './types';

const west = { west: 0, south: 0, east: 0.001, north: 0.001 };
const east = { west: 0.001, south: 0, east: 0.002, north: 0.001 };
function tile(bounds: GeographicBounds, name = 'Survey'): WorldDocument {
  const frame = geographicFrame(bounds);
  return {
    format: 'wordscape',
    version: '0.5',
    name,
    description: `Authored ${name} notes`,
    units: 'metres',
    bounds: { width: frame.width, depth: frame.depth },
    origin: {
      ...frame.origin,
      note: `Southwest local frame; x east, y north. Web Mercator scaled by ${frame.mercatorScale}.`,
    },
    seed: 3,
    sources: [
      {
        id: 'map',
        title: name,
        url: 'https://openstreetmap.org',
        attribution: `Credit ${name}`,
        accessed: '2026-11-16',
        notes: '',
      },
    ],
    aerial: { type: 'online-imagery', provider: 'usgs-imagery', bounds, sourceId: 'map' },
    objects: [
      {
        ...makeObject('building', 25, 25),
        id: 'same-id',
        sourceId: 'map',
        facts: [{ key: 'note', value: name, evidence: 'sourced', sourceIds: ['map'] }],
        references: [{ sourceId: 'map', role: 'map' }],
      },
    ],
    relations: [],
  };
}
function elevated(bounds: GeographicBounds, reference = 0): WorldDocument {
  const world = tile(bounds);
  world.terrain = {
    type: 'height-grid',
    columns: 3,
    rows: 3,
    spacing: 60,
    origin: { x: 0, y: 0 },
    heights: Array(9).fill(20),
    verticalDatum: 'NAVD88',
    referenceElevation: reference,
    sourceId: 'map',
    sourceResolution: 1,
    interpolation: 'bilinear',
  };
  world.objects[0].grounding = 'terrain';
  world.objects[0].elevation = 2;
  return world;
}

describe('adjacent survey bounds', () => {
  it('shares exact edges and preserves Mercator spans in every cardinal direction', () => {
    expect(adjacentBounds(west, 'east')).toEqual(east);
    expect(adjacentBounds(east, 'west')).toEqual(west);
    const north = adjacentBounds(west, 'north');
    expect(north.south).toBe(west.north);
    expect(north.west).toBe(west.west);
    expect(north.north).toBeCloseTo(0.002, 10);
    expect(adjacentBounds(north, 'south').south).toBeCloseTo(0, 10);
  });
  it('rejects a date-line crossing, invalid input and a polar extension', () => {
    expect(() => adjacentBounds({ ...west, west: 179.999, east: 180 }, 'east')).toThrow(
      /date|longitude|bounds/i,
    );
    expect(() => adjacentBounds({ ...west, north: NaN }, 'north')).toThrow();
    expect(() =>
      adjacentBounds({ west: 0, east: 0.001, south: 84.999, north: 85 }, 'north'),
    ).toThrow();
  });
});
describe('survey atlas composition', () => {
  it('reprojects separate surveys and preserves source claims, edits, relations and inputs', () => {
    const a = tile(west, 'West'),
      b = tile(east, 'East');
    a.objects.push({ ...makeObject('fixture', 30, 25), id: 'child', parentId: 'same-id' });
    a.relations.push({ from: 'child', to: 'same-id', type: 'within', note: 'Retain relation' });
    const before = JSON.stringify([a, b]);
    const { world, stats } = combineSurveyWorlds([a, b], { name: 'Joined' });
    expect(world.name).toBe('Joined');
    expect(world.version).toBe('0.8');
    expect(world.bounds.width).toBeCloseTo(222.639, 3);
    expect(world.objects[2].x - world.objects[0].x).toBeCloseTo(111.31949, 4);
    expect(new Set(world.objects.map((o) => o.id)).size).toBe(3);
    expect(world.objects[1].parentId).toBe(world.objects[0].id);
    expect(world.relations[0]).toEqual({
      from: world.objects[1].id,
      to: world.objects[0].id,
      type: 'within',
      note: 'Retain relation',
    });
    expect(world.sources.map((s) => s.attribution)).toContain('Credit East');
    expect(world.objects[2].facts![0].sourceIds).toEqual([world.objects[2].sourceId]);
    expect(world.objects[2].references![0].sourceId).toBe(world.objects[2].sourceId);
    expect(world.composition!.tiles.map((t) => t.description)).toEqual([
      'Authored West notes',
      'Authored East notes',
    ]);
    expect(stats.tiles).toBe(2);
    expect(validateWorld(world).errors).toEqual([]);
    expect(parseWorld(serializeWorld(world))).toEqual(world);
    expect(JSON.stringify([a, b])).toBe(before);
  });
  it('merges compatible terrain with one baseline and rebases absolute children once', () => {
    const a = elevated(west, 10),
      b = elevated(east, 0);
    a.objects.push({
      ...makeObject('fixture', 25, 25),
      id: 'child',
      parentId: 'same-id',
      elevation: 15,
      grounding: 'absolute',
    });
    const { world } = combineSurveyWorlds([a, b]);
    expect(sampleTerrain(world, 25, 25)).toBeCloseTo(20, 6);
    expect(sampleTerrain(world, 150, 25)).toBeCloseTo(20, 6);
    expect(getObjectBaseElevation(world, world.objects[0])).toBeCloseTo(
      getObjectBaseElevation(world, world.objects[2])!,
      6,
    );
    expect(
      world.objects[1].elevation - getObjectBaseElevation(world, world.objects[0])!,
    ).toBeCloseTo(3, 6);
    expect(world.terrain!.sourceResolution).toBe(1);
    expect(validateWorld(world).errors).toEqual([]);
  });
  it('rejects incompatible or unidentified terrain datums instead of silently flattening', () => {
    const a = elevated(west),
      b = elevated(east);
    b.terrain!.verticalDatum = 'EGM96';
    expect(() => combineSurveyWorlds([a, b])).toThrow(/datum/i);
    expect(() => combineSurveyWorlds([elevated(west), tile(east)])).toThrow(
      /no terrain|terrain first/i,
    );
    a.terrain!.verticalDatum = b.terrain!.verticalDatum =
      'Mixed source vertical datums; local datum not established';
    expect(() => combineSurveyWorlds([a, b])).toThrow(/datum/i);
  });
  it('recognizes only the verified SF datum aliases and keeps their original labels', () => {
    const a = elevated(west),
      b = elevated(east);
    a.terrain!.verticalDatum = 'NAVD88 (GEOID18)';
    b.terrain!.verticalDatum = 'NAVD88 (CA_SanFrancisco_B23; GEOID18)';
    const atlas = combineSurveyWorlds([a, b]).world;
    expect(atlas.terrain!.verticalDatum).toBe('NAVD88 (GEOID18)');
    expect(atlas.sources.find((s) => s.id === atlas.terrain!.sourceId)!.notes).toContain(
      'CA_SanFrancisco_B23',
    );
  });
  it('retains terrain grounding and flat comparison while preserving a sloping solid base', () => {
    const a = elevated(west, 10),
      b = elevated(east, 10);
    a.terrain!.heights = b.terrain!.heights = [20, 30, 40, 20, 30, 40, 20, 30, 40];
    const previous = getObjectBaseElevation(a, a.objects[0])!;
    const atlas = combineSurveyWorlds([a, b]).world,
      object = atlas.objects[0];
    expect(object.grounding).toBe('terrain');
    expect(getObjectBaseElevation(atlas, object)).toBeCloseTo(
      previous + 10 - atlas.terrain!.referenceElevation,
      6,
    );
    expect(viewObjectBase(atlas, object, false)).toBeCloseTo(2, 2);
  });
  it('keeps a large derived peak correction separate from authored and flat offsets', () => {
    const a = elevated(west),
      b = elevated(east);
    a.terrain!.columns = 24;
    a.terrain!.rows = 24;
    a.terrain!.spacing = 5;
    a.terrain!.heights = Array(576).fill(20);
    a.terrain!.heights[6 * 24 + 6] = 100;
    Object.assign(a.objects[0], {
      x: 30,
      y: 30,
      width: 10,
      depth: 10,
      elevation: 0,
      terrainAnchor: 'highest-footprint',
    });
    a.objects.push({
      ...makeObject('fixture', 30, 30),
      id: 'child',
      parentId: 'same-id',
      elevation: 110,
      grounding: 'absolute',
    });
    const atlas = combineSurveyWorlds([a, b]).world,
      object = atlas.objects[0],
      child = atlas.objects[1];
    expect(object.elevation).toBe(0);
    expect(object.terrainCorrection).toBeCloseTo(80, 5);
    expect(getObjectBaseElevation(atlas, object)! + atlas.terrain!.referenceElevation).toBeCloseTo(
      100,
      5,
    );
    expect(viewObjectBase(atlas, object, false)).toBe(0);
    expect(viewObjectBase(atlas, child, false)).toBeCloseTo(10, 5);
    expect(parseWorld(serializeWorld(atlas)).objects[0].terrainCorrection).toBeCloseTo(80, 5);
    const renamed = updateObject(atlas, object.id, { label: 'Retain alignment' });
    expect(renamed.objects[0].terrainCorrection).toBeCloseTo(80, 5);
    const raised = updateObject(atlas, object.id, { elevation: 1 });
    expect(
      getObjectBaseElevation(raised, raised.objects[0])! - getObjectBaseElevation(atlas, object)!,
    ).toBeCloseTo(1, 5);
    expect(viewObjectBase(raised, raised.objects[0], false)).toBe(1);
    const moved = updateObject(atlas, object.id, { x: 45 });
    expect(moved.objects[0].terrainCorrection).toBeUndefined();
    expect(getObjectBaseElevation(moved, moved.objects[0])).toBeCloseTo(0, 5);
    expect(
      moved.objects[1].elevation - getObjectBaseElevation(moved, moved.objects[0])!,
    ).toBeCloseTo(10, 5);
  });
  it('rejects corrections on older versions, absolute placements and draped surfaces', () => {
    const input = elevated(west);
    input.objects[0].terrainCorrection = 1;
    expect(validateWorld(input).errors.join()).toMatch(/terrainCorrection.*0.6/);
    input.version = '0.6';
    input.objects[0].grounding = 'absolute';
    expect(validateWorld(input).errors.join()).toMatch(/terrainCorrection.*terrain/);
    input.objects[0].grounding = 'terrain';
    input.objects[0].kind = 'road';
    expect(validateWorld(input).errors.join()).toMatch(
      /terrainCorrection.*building|terrainCorrection.*solid/,
    );
  });
  it('deduplicates a shared mapped point, retains both source links and remaps relations', () => {
    const a = tile(west, 'West'),
      b = tile(east, 'East');
    for (const [world, x] of [
      [a, 111.319],
      [b, 0],
    ] as const) {
      world.objects = [
        { ...makeObject('tree', x, 40), id: 'osm-node-42', evidence: 'observed', sourceId: 'map' },
      ];
    }
    b.objects.push({ ...makeObject('fixture', 25, 40), id: 'bench' });
    b.relations.push({ from: 'bench', to: 'osm-node-42', type: 'near' });
    const result = combineSurveyWorlds([a, b]);
    expect(result.stats.deduplicated).toBe(1);
    expect(result.world.objects).toHaveLength(2);
    expect(result.world.objects[0].references).toHaveLength(2);
    expect(result.world.relations[0].to).toBe(result.world.objects[0].id);
    a.objects[0].evidence = 'authored';
    expect(combineSurveyWorlds([a, b]).stats.deduplicated).toBe(0);
  });
  it('retains clipped route segments and synthetic coastal polygons despite shared source IDs', () => {
    const a = tile(west),
      b = tile(east);
    for (const [world, x] of [
      [a, 111.319],
      [b, 0],
    ] as const)
      world.objects = [
        {
          ...makeObject('road', x, 40),
          id: 'osm-way-42-segment-0',
          evidence: 'observed',
          sourceId: 'map',
          facts: [{ key: 'import.centerlineClipped', value: true, evidence: 'authored' }],
        },
        {
          ...makeObject('water', x, 70),
          id: 'osm-coastal-water-0',
          evidence: 'observed',
          sourceId: 'map',
          facts: [{ key: 'osm.element', value: 'way/9', evidence: 'sourced', sourceIds: ['map'] }],
        },
      ];
    const result = combineSurveyWorlds([a, b]);
    expect(result.world.objects).toHaveLength(4);
    expect(result.stats.deduplicated).toBe(0);
    expect(result.stats.seamFragments).toBe(2);
  });
  it('transforms absolute route coordinates and preserves mapped metric facts', () => {
    const a = tile(west),
      b = tile(east);
    b.objects[0].facts = [
      {
        key: 'path.centerline',
        value: '[[0,10],[10,10]]',
        evidence: 'sourced',
        sourceIds: ['map'],
      },
      { key: 'path.width', value: 3, unit: 'm', evidence: 'sourced', sourceIds: ['map'] },
    ];
    const result = combineSurveyWorlds([a, b]).world;
    const line = JSON.parse(result.objects[1].facts![0].value as string);
    expect(line).toEqual([
      [111.319, 10],
      [121.319, 10],
    ]);
    expect(result.objects[1].facts![1].value).toBe(3);
  });
  it('exports a container with all composition source references intact', () => {
    const atlas = combineSurveyWorlds([tile(west, 'West'), tile(east, 'East')]).world;
    const packet = createContainerPacket(atlas, atlas.objects[0].id);
    expect(packet.objects).toHaveLength(1);
    expect(validateWorld(packet).errors).toEqual([]);
    expect(packet.sources).toHaveLength(2);
  });
  it('allows the larger atlas budget only with valid composition metadata', () => {
    const a = tile(west),
      b = tile(east);
    for (const world of [a, b])
      world.objects = Array.from({ length: 600 }, (_, i) => ({
        ...makeObject('fixture', 25, 25),
        id: `item${i}`,
      }));
    const result = combineSurveyWorlds([a, b]).world;
    expect(result.objects).toHaveLength(1200);
    expect(validateWorld(result).errors).toEqual([]);
    const ordinary = { ...result, composition: undefined };
    expect(validateWorld(ordinary).errors.join()).toMatch(/1000/);
    const old = { ...result, version: '0.5' as const };
    expect(validateWorld(old).errors.join()).toMatch(/composition.*0.6/);
    result.composition!.tiles[0].sourceIds = ['missing'];
    expect(validateWorld(result).errors.join()).toMatch(/missing source/);
  });
  it('round-trips a combined document larger than the ordinary four-MiB budget', () => {
    const a = tile(west),
      b = tile(east);
    for (const world of [a, b])
      world.objects = Array.from({ length: 600 }, (_, i) => ({
        ...makeObject('fixture', 25, 25),
        id: `large${i}`,
        description: 'x'.repeat(4000),
      }));
    const world = combineSurveyWorlds([a, b]).world;
    const json = serializeWorld(world, false);
    expect(new TextEncoder().encode(json).byteLength).toBeGreaterThan(4 * 1024 * 1024);
    expect(parseWorld(json).objects).toHaveLength(1200);
    const ordinary = { ...world, composition: undefined };
    expect(() => parseWorld(JSON.stringify(ordinary))).toThrow(/4 MiB/);
  });
  it('keeps null terrain in an uncovered quadrant of an L-shaped atlas', () => {
    const north = { west: 0, east: 0.001, south: 0.001, north: 0.002 };
    const { world } = combineSurveyWorlds([elevated(west), elevated(east), elevated(north)]);
    expect(sampleTerrain(world, 180, 180)).toBeUndefined();
    expect(sampleTerrain(world, 25, 25)).toBeCloseTo(20, 6);
  });
  it('does not interpolate over a fine-grid no-data hole when the adjacent grid is coarser', () => {
    const a = elevated(west),
      b = elevated(east);
    a.terrain!.columns = 25;
    a.terrain!.rows = 25;
    a.terrain!.spacing = 5;
    a.terrain!.heights = Array(625).fill(20);
    a.terrain!.heights[6 * 25 + 6] = null;
    expect(sampleTerrain(a, 30, 30)).toBeUndefined();
    const atlas = combineSurveyWorlds([a, b]).world;
    expect(sampleTerrain(atlas, 30, 30)).toBeUndefined();
    expect(sampleTerrain(atlas, 200, 25)).toBeCloseTo(20, 6);
  });
  it('retains complete north-adjacent coverage despite rounded local frame dimensions', () => {
    const frame = {
      west: -122.41868162595988,
      south: 37.806798014784974,
      east: -122.41458837404012,
      north: 37.81003194980763,
    };
    const a = elevated(frame),
      b = elevated(adjacentBounds(frame, 'north'));
    for (const world of [a, b]) {
      world.terrain!.columns = 65;
      world.terrain!.rows = 65;
      world.terrain!.spacing = world.bounds.width / 64;
      world.terrain!.heights = Array(4225).fill(20);
    }
    const atlas = combineSurveyWorlds([a, b]).world;
    expect(atlas.terrain!.heights.filter((h) => h === null)).toHaveLength(0);
    expect(sampleTerrain(atlas, 30, atlas.bounds.depth - 1)).toBeCloseTo(20, 6);
    expect(sampleTerrain(atlas, atlas.bounds.width, atlas.bounds.depth)).toBeCloseTo(20, 6);
  });
  it('retains complementary clipped seam fragments and authored variants with unique IDs', () => {
    const a = tile(west),
      b = tile(east);
    for (const [world, x] of [
      [a, 105],
      [b, 5],
    ] as const) {
      world.objects[0].x = x;
      world.objects[0].evidence = 'observed';
      world.objects[0].facts = [{ key: 'import.clipped', value: true, evidence: 'authored' }];
    }
    const result = combineSurveyWorlds([a, b]);
    expect(result.world.objects).toHaveLength(2);
    expect(result.stats.seamFragments).toBe(2);
    expect(result.warnings.join(' ')).toMatch(/fragment|clip/i);
  });
  it('rejects overlapping, disconnected, nested or oversized compositions', () => {
    expect(() => combineSurveyWorlds([tile(west), tile(west)])).toThrow(/overlap/i);
    expect(() =>
      combineSurveyWorlds([tile(west), tile({ west: 0.003, east: 0.004, south: 0, north: 0.001 })]),
    ).toThrow(/connect|adjacent/i);
    const combined = combineSurveyWorlds([tile(west), tile(east)]).world;
    expect(() => combineSurveyWorlds([combined, tile(east)])).toThrow(
      /ordinary|nested|composition/i,
    );
    expect(() => combineSurveyWorlds([tile(west)])).toThrow(/2|two/i);
  });
});
