import { describe, expect, it } from 'vitest';
import {
  buildOverpassQuery,
  convertOsmToWorld,
  geographicFrame,
  parseOsmLength,
  parseOsmXml,
} from './osm';
import type { OsmElement, OverpassResponse } from './osm';
import { validateWorld } from '../world/document';
import { Box3 } from 'three';
import { createWorldGroup, disposeWorldGroup } from '../world/threeAdapter';

const bounds = { west: 0, south: 0, east: 0.001, north: 0.001 };
const ring = [
  { lon: 0.0001, lat: 0.0001 },
  { lon: 0.0003, lat: 0.0001 },
  { lon: 0.0003, lat: 0.0003 },
  { lon: 0.0001, lat: 0.0003 },
  { lon: 0.0001, lat: 0.0001 },
];
const building: OsmElement = {
  type: 'way',
  id: 10,
  nodes: [1, 2, 3, 4, 1],
  geometry: ring,
  tags: { building: 'yes', height: '30 ft', 'building:levels': '3' },
  timestamp: '2025-01-02T03:04:05Z',
};
const response = (elements: OsmElement[]): OverpassResponse => ({
  elements,
  osm3s: { timestamp_osm_base: '2026-11-16T00:00:00Z' },
});

describe('bounded OSM import', () => {
  it('renders overlapping mapped paths and streets above green space with authored offsets', () => {
    const route: OsmElement = {
      type: 'way',
      id: 94,
      nodes: [901, 902],
      geometry: [
        { lon: 0.00012, lat: 0.0002 },
        { lon: 0.00028, lat: 0.0002 },
      ],
      tags: { highway: 'footway' },
    };
    const { world } = convertOsmToWorld(
      response([
        { ...building, id: 90, tags: { leisure: 'park' } },
        { ...building, id: 91, tags: { natural: 'water' } },
        { ...building, id: 92, tags: { leisure: 'playground' } },
        { ...route, id: 93, tags: { highway: 'residential' } },
        route,
      ]),
      { bounds },
    );
    const group = createWorldGroup(world);
    group.updateMatrixWorld(true);
    try {
      const top = (id: string) =>
        new Box3().setFromObject(
          group.children.find((child) => child.userData.worldObjectId === id)!,
        ).max.y;
      expect(top('osm-way-92')).toBeGreaterThan(top('osm-way-90'));
      expect(top('osm-way-93-segment-0')).toBeGreaterThan(top('osm-way-90'));
      expect(top('osm-way-94-segment-0')).toBeGreaterThan(top('osm-way-92'));
      expect(top('osm-way-94-segment-0')).toBeGreaterThan(top('osm-way-91'));
      for (const object of world.objects) {
        expect(object.facts).toContainEqual(
          expect.objectContaining({
            key: 'placement.surfaceOffset',
            value: object.elevation,
            evidence: 'authored',
            unit: 'm',
          }),
        );
        expect(object.facts).toContainEqual(
          expect.objectContaining({
            key: 'placement.surfaceThickness',
            value: object.height,
            evidence: 'authored',
            unit: 'm',
          }),
        );
      }
      expect(world.terrain).toBeUndefined();
    } finally {
      disposeWorldGroup(group);
    }
  });
  it('converts individual mapped buildings and retains height units and provenance', () => {
    const { world, diagnostics } = convertOsmToWorld(response([building]), { bounds });
    expect(validateWorld(world).errors).toEqual([]);
    expect(world.objects).toHaveLength(1);
    expect(world.objects[0].height).toBeCloseTo(9.144);
    expect(world.objects[0].facts).toContainEqual(
      expect.objectContaining({
        key: 'building.reportedHeight',
        value: 9.144,
        evidence: 'sourced',
        unit: 'm',
        sourceIds: ['osm-extract'],
      }),
    );
    expect(world.objects[0].facts).toContainEqual(
      expect.objectContaining({ key: 'osm.editedAt', value: building.timestamp }),
    );
    expect(world.sources[0].attribution).toContain('ODbL');
    expect(diagnostics.timestamp).toBe('2026-11-16T00:00:00Z');
  });
  it('keeps heights derived from levels inferred and unspecified floors unknown', () => {
    const input = response([
      { ...building, tags: { building: 'yes', 'building:levels': '4' } },
      { ...building, id: 11, tags: { building: 'yes' } },
    ]);
    const { world, diagnostics } = convertOsmToWorld(input, { bounds });
    expect(world.objects.map((o) => o.height)).toEqual([12, 9]);
    expect(diagnostics.counts.estimatedHeights).toBe(2);
    expect(world.objects[0].facts).toContainEqual(
      expect.objectContaining({ key: 'building.height', evidence: 'inferred' }),
    );
    expect(world.objects[1].facts).toContainEqual(
      expect.objectContaining({ key: 'building.levels', value: null, evidence: 'unknown' }),
    );
  });
  it('clips geometry to the requested frame without claiming the selection edge is a wall', () => {
    const partial = { ...building, geometry: ring.map((p) => ({ ...p, lon: p.lon - 0.0002 })) };
    const { world } = convertOsmToWorld(response([partial]), { bounds });
    expect(validateWorld(world).errors).toEqual([]);
    expect(world.objects[0].facts).toContainEqual(
      expect.objectContaining({ key: 'import.clipped', value: true, evidence: 'authored' }),
    );
    expect(world.objects[0].x - world.objects[0].width / 2).toBeCloseTo(0, 2);
  });
  it('imports only mapped entrances and attaches them through shared building node IDs', () => {
    const entrance: OsmElement = {
      type: 'node',
      id: 2,
      ...ring[1],
      tags: { entrance: 'main', wheelchair: 'yes' },
    };
    const { world, diagnostics } = convertOsmToWorld(response([building, entrance]), { bounds });
    expect(diagnostics.counts.entrances).toBe(1);
    expect(world.objects.find((o) => o.id === 'osm-node-2')?.parentId).toBe('osm-way-10');
    expect(convertOsmToWorld(response([building]), { bounds }).diagnostics.counts.entrances).toBe(
      0,
    );
  });
  it('retains route topology, explicit restrictions, and inferred invalid widths', () => {
    const route: OsmElement = {
      type: 'way',
      id: 20,
      nodes: [100, 101, 102],
      geometry: [
        { lon: 0.0001, lat: 0.0005 },
        { lon: 0.0004, lat: 0.0005 },
        { lon: 0.0008, lat: 0.0007 },
      ],
      tags: { highway: 'footway', width: 'about two', access: 'private' },
    };
    const { world, diagnostics } = convertOsmToWorld(response([route]), { bounds });
    expect(diagnostics.counts.paths).toBe(2);
    expect(world.objects[0].facts).toContainEqual(
      expect.objectContaining({ key: 'path.width', evidence: 'inferred' }),
    );
    expect(world.objects[0].facts).toContainEqual(
      expect.objectContaining({ key: 'osm.toNode', value: 101 }),
    );
    expect(world.objects[1].facts).toContainEqual(
      expect.objectContaining({ key: 'osm.fromNode', value: 101 }),
    );
    expect(world.objects[0].facts).toContainEqual(
      expect.objectContaining({ key: 'path.access', value: 'private' }),
    );
  });
  it('omits incomplete ways and courtyard relations instead of inventing geometry', () => {
    const incomplete = { ...building, id: 11, geometry: [ring[0], null, ring[2], ring[0]] };
    const courtyard: OsmElement = {
      type: 'relation',
      id: 12,
      tags: { building: 'yes', type: 'multipolygon' },
      members: [
        { type: 'way', ref: 13, role: 'outer', geometry: ring },
        { type: 'way', ref: 14, role: 'inner', geometry: ring },
      ],
    };
    const { world, diagnostics } = convertOsmToWorld(response([incomplete, courtyard]), { bounds });
    expect(world.objects).toHaveLength(0);
    expect(diagnostics.omitted).toHaveLength(2);
  });
  it('clips route endpoints without falsely moving outside OSM node identities', () => {
    const way: OsmElement = {
      type: 'way',
      id: 32,
      nodes: [50, 51],
      geometry: [
        { lon: -0.0005, lat: 0.0005 },
        { lon: 0.0005, lat: 0.0005 },
      ],
      tags: { highway: 'footway' },
    };
    const { world } = convertOsmToWorld(response([way]), { bounds });
    const facts = world.objects[0].facts!;
    const line = JSON.parse(facts.find((f) => f.key === 'path.centerline')!.value as string);
    expect(line[0][0]).toBe(0);
    expect(facts.some((f) => f.key === 'osm.fromNode')).toBe(false);
    expect(facts).toContainEqual(expect.objectContaining({ key: 'osm.toNode', value: 51 }));
    expect(facts).toContainEqual(
      expect.objectContaining({
        key: 'import.centerlineClipped',
        value: true,
        evidence: 'authored',
      }),
    );
  });
  it('retains source building parts and marks their parent outline as a container', () => {
    const part: OsmElement = {
      ...building,
      id: 33,
      tags: { 'building:part': 'yes', height: '5' },
      geometry: ring.map((p) => ({
        lon: 0.0002 + (p.lon - 0.0002) * 0.5,
        lat: 0.0002 + (p.lat - 0.0002) * 0.5,
      })),
    };
    const { world } = convertOsmToWorld(response([building, part]), { bounds });
    expect(world.objects.find((o) => o.id === 'osm-way-33')?.parentId).toBe('osm-way-10');
    expect(world.objects.find((o) => o.id === 'osm-way-10')?.facts).toContainEqual(
      expect.objectContaining({ key: 'building.isOutline', value: true, evidence: 'inferred' }),
    );
  });
  it('rejects service error remarks, oversized bounds and hostile XML before parsing', () => {
    expect(() =>
      convertOsmToWorld({ ...response([]), remark: 'runtime error: timed out' }, { bounds }),
    ).toThrow('incomplete');
    expect(() => buildOverpassQuery({ ...bounds, east: 0.02 })).toThrow('1 km');
    expect(() => geographicFrame({ ...bounds, south: 86, north: 87 })).toThrow('85');
    expect(() => parseOsmXml('<!DOCTYPE osm><osm/>')).toThrow('document types');
    expect(buildOverpassQuery(bounds)).toContain('out body geom;');
    expect(buildOverpassQuery(bounds)).toContain('way["natural"="coastline"]');
    expect(buildOverpassQuery(bounds)).toContain('nwr["natural"="water"]');
  });
  it('does not suppress an outline for a partially overlapping neighboring part', () => {
    const part: OsmElement = {
      ...building,
      id: 34,
      tags: { 'building:part': 'yes' },
      geometry: ring.map((p) => ({ ...p, lon: p.lon + 0.00005 })),
    };
    const { world } = convertOsmToWorld(response([building, part]), { bounds });
    expect(world.objects.find((o) => o.id === 'osm-way-34')?.parentId).toBeUndefined();
    expect(
      world.objects
        .find((o) => o.id === 'osm-way-10')
        ?.facts?.some((f) => f.key === 'building.isOutline'),
    ).toBe(false);
  });
  it('parses unambiguous lengths and rejects ranges and descriptive values', () => {
    expect(parseOsmLength(`6' 2"`)).toBeCloseTo(1.8796);
    expect(parseOsmLength('180 cm')).toBe(1.8);
    expect(parseOsmLength('12;14')).toBeUndefined();
    expect(parseOsmLength('about 20')).toBeUndefined();
  });
});
