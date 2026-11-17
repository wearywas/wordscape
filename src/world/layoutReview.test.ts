import { describe, expect, it } from 'vitest';
import { describeWorldLayout } from './layoutReview';
import { makeObject } from './document';
import type { WorldDocument } from './types';
const fixture = (): WorldDocument => ({
  format: 'wordscape',
  version: '0.7',
  name: 'Authored metrics',
  description: '',
  units: 'metres',
  bounds: { width: 100, depth: 100 },
  origin: { latitude: 0, longitude: 0, note: 'Local' },
  seed: 1,
  sources: [],
  objects: [10, 25].map((x, index) => ({
    ...makeObject('building', x, 20),
    id: `b-${index}`,
    width: 10,
    depth: 10,
    rotation: 0,
  })),
  relations: [],
});
describe('descriptive layout measurements', () => {
  it('measures polygon area and edge gaps, not centre spacing or a quality score', () => {
    const measured = describeWorldLayout(fixture());
    expect(measured.summedBuildingAreaM2).toBe(200);
    expect(measured.buildingCoverageRatio).toBe(0.02);
    expect(measured.nearestBuildingGapM?.median).toBe(5);
    expect(measured.buildingOrientation.axisAlignedFraction).toBe(1);
    expect(measured.notes.join(' ')).toMatch(/not.*quality|no.*score/i);
  });
  it('reports overlaps as zero gaps and measures non-orthogonal orientation', () => {
    const world = fixture();
    world.objects[1].x = 12;
    world.objects[1].rotation = 45;
    const measured = describeWorldLayout(world);
    expect(measured.nearestBuildingGapM?.median).toBe(0);
    expect(measured.buildingOrientation.axisAlignedFraction).toBe(0.5);
  });
  it('uses recorded route centreline lengths and discloses envelope estimates', () => {
    const world = fixture();
    world.objects.push(
      {
        ...makeObject('road', 30, 20),
        width: 60,
        depth: 40,
        facts: [{ key: 'path.centerline', value: '[[0,0],[30,40],[60,40]]', evidence: 'authored' }],
      },
      { ...makeObject('pavement', 70, 70), width: 5, depth: 20 },
    );
    const measured = describeWorldLayout(world);
    expect(measured.routeCount).toBe(2);
    expect(measured.estimatedRouteLengthM).toBe(100);
    expect(measured.notes.join(' ')).toMatch(/envelope/i);
  });
  it('excludes only building outlines that the renderer hides behind their child masses', () => {
    const world = fixture();
    const parent = {
      ...makeObject('building', 20, 20),
      id: 'outline',
      width: 40,
      depth: 20,
      facts: [{ key: 'building.isOutline', value: true, evidence: 'authored' as const }],
    };
    for (const object of world.objects) object.parentId = parent.id;
    world.objects.push(parent);
    const measured = describeWorldLayout(world);
    expect(measured.buildingCount).toBe(2);
    expect(measured.summedBuildingAreaM2).toBe(200);
    expect(measured.nearestBuildingGapM?.median).toBe(5);
    expect(measured.notes.join(' ')).toMatch(/1.*outline.*excluded/);
    expect(describeWorldLayout({ ...world, objects: [parent] }).summedBuildingAreaM2).toBe(800);
    parent.geometry = {
      type: 'parts',
      version: 1,
      space: 'normalized-object',
      evidence: 'authored',
      parts: [
        {
          id: 'box',
          label: 'Visible recipe',
          primitive: 'box',
          position: [0, 0.5, 0],
          rotation: [0, 0, 0],
          dimensions: [1, 1, 1],
          color: '#888888',
          footprint: null,
        },
      ],
    };
    expect(describeWorldLayout(world).summedBuildingAreaM2).toBe(1000);
  });
  it('rejects extreme and stale recorded route centerlines while keeping finite current-placement estimates', () => {
    for (const value of ['[[0,0],[1e308,1e308]]', '[[0,0],[10,0]]']) {
      const world = fixture();
      world.objects.push({
        ...makeObject('road', 50, 50),
        width: 20,
        depth: 4,
        rotation: 90,
        facts: [{ key: 'path.centerline', value, evidence: 'authored' }],
      });
      const measured = describeWorldLayout(world);
      expect(measured.estimatedRouteLengthM).toBe(20);
      expect(measured.routeOrientation.binLengthM[0]).toBe(20);
      expect(measured.notes.join(' ')).toMatch(/1.*centerline.*rejected/);
    }
    const rotated = fixture();
    rotated.objects.push({
      ...makeObject('road', 50, 50),
      width: 20,
      depth: 4,
      rotation: 90,
      facts: [{ key: 'path.centerline', value: '[[40,50],[60,50]]', evidence: 'authored' }],
    });
    expect(describeWorldLayout(rotated).routeOrientation.binLengthM[0]).toBe(20);
  });
  it('checks whole centerline segments against concave route footprints', () => {
    const world = fixture();
    const route = {
      ...makeObject('road', 20, 20),
      width: 20,
      depth: 20,
      footprint: [
        [-10, -10],
        [10, -10],
        [10, -6],
        [-6, -6],
        [-6, 10],
        [-10, 10],
      ] as [number, number][],
      facts: [
        { key: 'path.centerline', value: '[[10,25],[25,10]]', evidence: 'authored' as const },
      ],
    };
    world.objects.push(route);
    expect(describeWorldLayout(world).estimatedRouteLengthM).toBe(20);
    route.facts[0].value = '[[10,25],[12,12],[25,10]]';
    const consistent = describeWorldLayout(world);
    expect(consistent.estimatedRouteLengthM).toBeCloseTo(26.306, 3);
    expect(consistent.notes.join(' ')).toMatch(/0 recorded centerlines were rejected/);
  });
});
