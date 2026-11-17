import { describe, expect, it } from 'vitest';
import { washingtonSquare } from './washingtonSquare';
import baseline from './washingtonSquare.v0.4.json';
import additions from './washingtonSquareEdges.json';
import { parseWorld, serializeWorld, validateWorld } from '../world/document';
import { getObjectBaseElevation } from '../world/terrain';
import type { WorldDocument } from '../world/types';

describe('Washington Square peripheral enrichment', () => {
  it('preserves every previous object, fact, source and relation while adding only audited geometry', () => {
    const before = parseWorld(JSON.stringify(baseline));
    const after = parseWorld(serializeWorld(washingtonSquare));
    expect(before.objects).toHaveLength(139);
    expect(after.objects).toHaveLength(165);
    expect(after.objects.slice(0, before.objects.length)).toEqual(before.objects);
    expect(after.sources.slice(0, before.sources.length)).toEqual(before.sources);
    expect(after.relations.slice(0, before.relations.length)).toEqual(before.relations);
    expect(after.terrain).toEqual(before.terrain);
    expect(after.origin).toEqual(before.origin);
    expect(after.bounds).toEqual(before.bounds);
    expect(after.description).toBe(before.description);
    expect(validateWorld(washingtonSquare).errors).toEqual([]);
  });
  it('separates mapped dimensions from authored color and inferred foundations', () => {
    const added = washingtonSquare.objects.filter((o) => o.tags?.includes('osm-edge-enrichment'));
    expect(added).toHaveLength(26);
    expect(added.filter((o) => o.kind === 'building')).toHaveLength(24);
    expect(added.filter((o) => o.kind === 'road')).toHaveLength(2);
    for (const object of added) {
      expect(object.sourceId).toBe('osm-washington-edges');
      expect(getObjectBaseElevation(washingtonSquare, object)).toBeTypeOf('number');
      expect(object.facts?.find((f) => f.key === 'osm.element')?.sourceIds).toEqual([
        'osm-washington-edges',
      ]);
      if (object.kind !== 'building') continue;
      expect(object.terrainAnchor).toBe('highest-footprint');
      expect(object.facts?.find((f) => f.key === 'building.color')?.evidence).toBe('authored');
      expect(object.facts?.find((f) => f.key === 'building.roofColor')?.evidence).toBe('authored');
      expect(object.facts?.find((f) => f.key === 'building.material')?.value).toBeNull();
      expect(object.facts?.find((f) => f.key === 'placement.foundation')?.evidence).toBe(
        'inferred',
      );
    }
    expect(additions.relations).toHaveLength(1);
    expect(additions.relations[0].note).toContain('shared mapped OSM node');
    expect(
      (baseline as WorldDocument).objects.some((o) => o.tags?.includes('osm-edge-enrichment')),
    ).toBe(false);
  });
});
