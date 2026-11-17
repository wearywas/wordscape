import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import extract from '../../public/reference/fishermans-wharf-osm-regression.json';
import manifest from '../../public/reference/fishermans-wharf-regression-manifest.json';
import { convertOsmToWorld } from '../imports/osm';
import type { OverpassResponse } from '../imports/osm';
import { createWorldGroup, disposeWorldGroup } from './threeAdapter';

type Point = [number, number];
function inPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[previous],
      b = polygon[index],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const t = Math.max(
      0,
      Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)),
    );
    if (Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) < 0.0001) return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
describe('real Fisherman’s Wharf diagonal sheds', () => {
  it('keeps their roofs and walls inside traced clipped polygons at the sourced9m/10m heights', () => {
    const { world } = convertOsmToWorld(extract as unknown as OverpassResponse, {
      bounds: manifest.bounds,
      sourceUrl: manifest.sourceUrl,
      accessed: manifest.accessed,
    });
    const group = createWorldGroup(world, ['building']);
    try {
      for (const [id, height] of [
        ['osm-way-25372350', 9],
        ['osm-way-25372352', 10],
      ] as const) {
        const object = world.objects.find((candidate) => candidate.id === id)!;
        const rendered = group.children.find(
          (candidate) => candidate.userData.worldObjectId === id,
        )!;
        expect(object.height).toBe(height);
        expect(new THREE.Box3().setFromObject(rendered).getSize(new THREE.Vector3()).y).toBeCloseTo(
          height,
          4,
        );
        const body = rendered.children.filter((child) =>
          ['roof', 'building-body'].includes(child.userData.renderRole),
        ) as THREE.Mesh[];
        expect(body).toHaveLength(2);
        for (const mesh of body) {
          const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
          const positions = geometry.getAttribute('position');
          for (let vertex = 0; vertex < positions.count; vertex++) {
            expect(
              inPolygon([positions.getX(vertex), -positions.getZ(vertex)], object.footprint!),
              `${id} vertex ${vertex}`,
            ).toBe(true);
          }
          for (let vertex = 0; vertex < positions.count; vertex += 3) {
            const x =
              (positions.getX(vertex) + positions.getX(vertex + 1) + positions.getX(vertex + 2)) /
              3;
            const y =
              -(positions.getZ(vertex) + positions.getZ(vertex + 1) + positions.getZ(vertex + 2)) /
              3;
            expect(inPolygon([x, y], object.footprint!), `${id} triangle ${vertex / 3}`).toBe(true);
          }
          if (geometry !== mesh.geometry) geometry.dispose();
        }
      }
    } finally {
      disposeWorldGroup(group);
    }
  });
});
