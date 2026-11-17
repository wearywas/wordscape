import { describe, expect, it } from 'vitest';
import { washingtonSquare } from './washingtonSquare';
import {
  washingtonSquareCirculation as routes,
  washingtonSquareCirculationRelations as relations,
} from './washingtonSquareCirculation';
import { validateWorld } from '../world/document';
import source from '../../public/reference/washington-square-osm.json';
import manifest from '../../public/reference/washington-square-osm-manifest.json';
import { convertOsmToWorld, type OverpassResponse } from '../imports/osm';

describe('retained Washington Square map evidence', () => {
  it('imports the real source with source IDs, honest gaps and no invented entrances', () => {
    const { world, diagnostics } = convertOsmToWorld(source as unknown as OverpassResponse, {
      bounds: manifest.bounds,
      accessed: manifest.accessed,
      sourceUrl: manifest.sourceUrl,
    });
    expect(validateWorld(world).errors).toEqual([]);
    expect(diagnostics.counts.buildings).toBeGreaterThan(300);
    expect(diagnostics.counts.entrances).toBe(0);
    expect(diagnostics.omitted.some((item) => item.reason.includes('courtyard'))).toBe(true);
    expect(world.objects.every((object) => object.sourceId === 'osm-extract')).toBe(true);
    expect(JSON.stringify(source)).not.toMatch(/"(?:user|uid)":/);
  });
  it('preserves one connected mapped park network in the existing aerial frame', () => {
    expect(routes).toHaveLength(55);
    expect(relations).toHaveLength(67);
    expect(validateWorld(washingtonSquare)).toEqual({ errors: [], warnings: [] });
    const endpoints = (id: string) =>
      routes
        .find((route) => route.id === id)!
        .facts!.filter((fact) => ['osm.fromNode', 'osm.toNode'].includes(fact.key))
        .map((fact) => fact.value);
    for (const relation of relations)
      expect(endpoints(relation.from).some((node) => endpoints(relation.to).includes(node))).toBe(
        true,
      );
    const seen = new Set([routes[0].id]);
    for (let i = 0; i < routes.length; i++)
      for (const relation of relations) {
        if (seen.has(relation.from)) seen.add(relation.to);
        if (seen.has(relation.to)) seen.add(relation.from);
      }
    expect(seen.size).toBe(routes.length);
    for (const route of routes) {
      expect(route.parentId).toBe('park-walk');
      expect(route.x).toBeGreaterThan(130);
      expect(route.x).toBeLessThan(265);
      expect(route.y).toBeGreaterThan(135);
      expect(route.y).toBeLessThan(240);
      expect(route.grounding).toBe('terrain');
    }
  });
});
