import { it, expect } from 'vitest';
import { restoreSavedWorld } from './savedWorld';
import { migrateWorld, serializeWorld } from './document';
import baselineV1 from '../data/washingtonSquare.v0.1.json';
import baselineV2 from '../data/washingtonSquare.v0.2.json';
import baselineV3 from '../data/washingtonSquare.v0.3.json';
import baselineV4 from '../data/washingtonSquare.v0.4.json';
import { washingtonSquare } from '../data/washingtonSquare';
import type { WorldDocument } from './types';

it('upgrades only untouched old survey data and preserves custom placements', () => {
  const original = baselineV1 as WorldDocument;
  const latest = migrateWorld(original);
  latest.objects[0].facts = [{ key: 'road.direction', value: null, evidence: 'unknown' }];
  expect(restoreSavedWorld(serializeWorld(original), latest)).toEqual(latest);
  expect(restoreSavedWorld(serializeWorld(migrateWorld(original)), latest)).toEqual(latest);
  const edited = structuredClone(original);
  edited.objects[0].x += 3;
  const restored = restoreSavedWorld(serializeWorld(edited), latest);
  expect(restored.objects[0].x).toBe(edited.objects[0].x);
  expect(restored.objects[0].facts).toBeUndefined();
  expect(restored.version).toBe('0.8');
  expect(restoreSavedWorld(null, latest)).toEqual(latest);
});

it('upgrades the pristine 0.2 specimen while preserving any metadata edits', () => {
  const original = baselineV2 as WorldDocument;
  const latest = { ...migrateWorld(original), name: 'Updated specimen' };
  expect(restoreSavedWorld(serializeWorld(original), latest)).toEqual(latest);
  const edited = structuredClone(original);
  edited.objects[0].facts!.push({
    key: 'survey.note',
    value: 'My observation',
    evidence: 'authored',
  });
  expect(restoreSavedWorld(serializeWorld(edited), latest).objects[0].facts).toEqual(
    edited.objects[0].facts,
  );
});

it('upgrades only the pristine 0.3 terrain specimen and retains edited terrain or facts', () => {
  const original = baselineV3 as WorldDocument;
  expect(original.version).toBe('0.3');
  expect(original.objects).toHaveLength(84);
  const latest = { ...migrateWorld(original), description: 'New mapped circulation' };
  expect(restoreSavedWorld(serializeWorld(original), latest)).toEqual(latest);
  expect(restoreSavedWorld(serializeWorld(migrateWorld(original)), latest)).toEqual(latest);
  const edited = structuredClone(original);
  edited.terrain!.heights[0] = edited.terrain!.heights[0]! + 0.01;
  expect(restoreSavedWorld(serializeWorld(edited), latest).terrain!.heights[0]).toBe(
    edited.terrain!.heights[0],
  );
  const noted = structuredClone(original);
  noted.objects[0].description += ' My field note.';
  expect(restoreSavedWorld(serializeWorld(noted), latest).objects[0].description).toBe(
    noted.objects[0].description,
  );
});

it('upgrades the untouched 139-object 0.4 survey to the enriched bundled specimen', () => {
  const original = baselineV4 as WorldDocument;
  const latest = migrateWorld(washingtonSquare);
  expect(original.version).toBe('0.4');
  expect(original.objects).toHaveLength(139);
  expect(latest.objects).toHaveLength(165);
  expect(restoreSavedWorld(serializeWorld(original), latest)).toEqual(latest);
  expect(restoreSavedWorld(serializeWorld(migrateWorld(original)), latest)).toEqual(latest);
});

it.each<[string, (world: WorldDocument) => void]>([
  [
    'document metadata',
    (world) => {
      world.description += ' My field notes.';
    },
  ],
  [
    'placement',
    (world) => {
      world.objects[0].x += 0.01;
    },
  ],
  [
    'object description',
    (world) => {
      world.objects[0].description += ' Revisited.';
    },
  ],
  [
    'fact',
    (world) => {
      (world.objects[0].facts ??= []).push({
        key: 'survey.note',
        value: 'Checked locally',
        evidence: 'authored',
      });
    },
  ],
  [
    'terrain sample',
    (world) => {
      world.terrain!.heights[0] = world.terrain!.heights[0]! + 0.01;
    },
  ],
  [
    'source note',
    (world) => {
      world.sources[0].notes += ' My source annotation.';
    },
  ],
  [
    'relation note',
    (world) => {
      world.relations[0].note += ' My connection annotation.';
    },
  ],
])('retains the complete 0.4 saved document after a %s edit', (_name, edit) => {
  const edited = structuredClone(baselineV4) as WorldDocument;
  edit(edited);
  const expected = migrateWorld(edited);
  const restored = restoreSavedWorld(serializeWorld(edited), washingtonSquare);
  expect(restored).toEqual(expected);
  expect(restored.objects).toHaveLength(139);
});
