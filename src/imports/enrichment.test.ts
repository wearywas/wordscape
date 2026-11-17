import { describe, expect, it } from 'vitest';
import { addMissingSurveyWater } from './enrichment';
import { makeObject, validateWorld } from '../world/document';
import type { WorldDocument } from '../world/types';

const base = (): WorldDocument => ({
  format: 'wordscape',
  version: '0.5',
  name: 'Edited world',
  description: 'Keep my edits',
  units: 'metres',
  origin: { latitude: 37, longitude: -122, note: 'Original' },
  bounds: { width: 100, depth: 100 },
  seed: 1,
  sources: [
    {
      id: 'osm-extract',
      title: 'My source title',
      url: 'https://openstreetmap.org',
      attribution: 'My edited attribution',
      accessed: '2026-11-16',
      notes: 'same notes',
    },
  ],
  objects: [
    {
      ...makeObject('building', 50, 50),
      id: 'edited-building',
      label: 'Custom label',
      elevation: 17,
      evidence: 'authored',
    },
  ],
  relations: [],
});
const imported = (): WorldDocument => ({
  ...base(),
  name: 'New extract',
  sources: [{ ...base().sources[0], title: 'OSM source', attribution: 'OSM contributors' }],
  objects: [
    { ...makeObject('building', 30, 30), id: 'edited-building', label: 'Do not overwrite' },
    {
      ...makeObject('water', 20, 20),
      id: 'new-water',
      width: 10,
      depth: 10,
      sourceId: 'osm-extract',
      footprint: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
      facts: [
        { key: 'water.kind', value: 'coastal', evidence: 'sourced', sourceIds: ['osm-extract'] },
      ],
      references: [{ role: 'map', sourceId: 'osm-extract' }],
    },
  ],
});

describe('missing survey water enrichment', () => {
  it('adds only missing water and preserves all existing edited objects and document metadata', () => {
    const original = base(),
      fresh = imported(),
      before = JSON.stringify(original);
    const result = addMissingSurveyWater(original, fresh);
    expect(result.added).toBe(1);
    expect(result.world.objects[0]).toEqual(original.objects[0]);
    expect(result.world.name).toBe(original.name);
    expect(result.world.description).toBe(original.description);
    expect(result.world.sources[0]).toEqual(original.sources[0]);
    expect(JSON.stringify(original)).toBe(before);
    expect(validateWorld(result.world).errors).toEqual([]);
    expect(addMissingSurveyWater(result.world, fresh).added).toBe(0);
  });
  it('remaps every source reference instead of merging distinct attribution claims', () => {
    const result = addMissingSurveyWater(base(), imported()).world;
    const water = result.objects.find((object) => object.id === 'new-water')!;
    expect(water.sourceId).not.toBe('osm-extract');
    expect(water.facts![0].sourceIds).toEqual([water.sourceId]);
    expect(water.references![0].sourceId).toBe(water.sourceId);
    expect(result.sources.find((source) => source.id === water.sourceId)?.attribution).toBe(
      'OSM contributors',
    );
  });
  it('does not share mutable imported footprint data with the returned world', () => {
    const fresh = imported(),
      result = addMissingSurveyWater(base(), fresh).world;
    result.objects.find((object) => object.id === 'new-water')!.footprint![0][0] = -4;
    expect(fresh.objects[1].footprint![0][0]).toBe(-5);
  });
  it('rejects a different frame or malformed incoming document before adding water', () => {
    expect(() =>
      addMissingSurveyWater(base(), { ...imported(), bounds: { width: 101, depth: 100 } }),
    ).toThrow(/frame/);
    expect(() =>
      addMissingSurveyWater(base(), {
        ...imported(),
        origin: { ...imported().origin, latitude: NaN },
      }),
    ).toThrow();
  });
});
