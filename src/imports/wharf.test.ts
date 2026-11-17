import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import source from '../../public/reference/fishermans-wharf-osm-regression.json';
import manifest from '../../public/reference/fishermans-wharf-regression-manifest.json';
import { convertOsmToWorld, type OverpassResponse } from './osm';
import { getFootprint, validateWorld } from '../world/document';
import { createWorldGroup, disposeWorldGroup } from '../world/threeAdapter';

const convert = () =>
  convertOsmToWorld(source as unknown as OverpassResponse, {
    bounds: manifest.bounds,
    sourceUrl: manifest.sourceUrl,
    accessed: manifest.accessed,
  });
const inside = (p: [number, number], ring: [number, number][]) => {
  let found = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      found = !found;
  }
  return found;
};

describe('actual Fisherman’s Wharf source regression', () => {
  it('derives coastal water around the real harbor without filling the pier sheds or mainland', () => {
    const { world } = convert();
    expect(validateWorld(world)).toEqual({ errors: [], warnings: [] });
    const water = world.objects.filter((o) => o.kind === 'water');
    expect(water).toHaveLength(3);
    const covered = (point: [number, number]) =>
      water.some((object) => inside(point, getFootprint(object)));
    expect(covered([160, 200])).toBe(true); // harbor basin visible on USDA aerial
    expect(covered([320, 340])).toBe(true); // open sea northeast of the pier
    expect(covered([100, 100])).toBe(false); // mainland
    expect(covered([187.523, 314.417])).toBe(false); // Shed A
    expect(covered([89.188, 316.688])).toBe(false); // Shed B
    for (const object of water) {
      expect(object.sourceId).toBe('osm-extract');
      expect(object.facts).toContainEqual(
        expect.objectContaining({
          key: 'osm.coastlineWays',
          value: '[32648495]',
          evidence: 'sourced',
        }),
      );
      expect(object.facts).toContainEqual(
        expect.objectContaining({
          key: 'water.surfaceElevation',
          value: null,
          evidence: 'unknown',
        }),
      );
      expect(object.facts).toContainEqual(
        expect.objectContaining({
          key: 'water.renderLevel',
          value: 0,
          unit: 'm',
          evidence: 'authored',
        }),
      );
    }
  });
  it('preserves the real diagonal sheds and their mapped heights without a giant roof extrusion', () => {
    const { world } = convert();
    const group = createWorldGroup(world, ['building']);
    group.updateMatrixWorld(true);
    try {
      for (const [id, height, expectedArea] of [
        ['osm-way-25372350', 9, 5295.661],
        ['osm-way-25372352', 10, 4992.978],
      ] as const) {
        const object = world.objects.find((o) => o.id === id)!;
        const points = getFootprint(object);
        const area =
          Math.abs(
            points.reduce((sum, a, i) => {
              const b = points[(i + 1) % points.length];
              return sum + a[0] * b[1] - b[0] * a[1];
            }, 0),
          ) / 2;
        expect(area).toBeCloseTo(expectedArea, 2);
        expect(object.height).toBe(height);
        expect(object.facts).toContainEqual(
          expect.objectContaining({ key: 'import.clipped', value: true, evidence: 'authored' }),
        );
        const mesh = group.children.find((child) => child.userData.worldObjectId === id)!;
        expect(mesh.userData.rendering.roofShape).toBe('flat');
        const box = new Box3().setFromObject(mesh);
        expect(box.max.y - box.min.y).toBeCloseTo(height, 4);
        expect(box.max.x - box.min.x).toBeLessThanOrEqual(object.width + 0.001);
        expect(box.max.z - box.min.z).toBeLessThanOrEqual(object.depth + 0.001);
      }
    } finally {
      disposeWorldGroup(group);
    }
  });
});
