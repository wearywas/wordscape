import { describe, expect, it } from 'vitest';
import { applyModelProposal } from './proposals';
import { makeObject } from './document';
import { createGeometryTemplate } from './geometryTemplates';
import type { WorldDocument } from './types';
import type { ModelResult } from '../services/companion';

const object = {
  ...makeObject('building', 20, 20),
  id: 'selected',
  label: 'Original',
  facts: [{ key: 'building.levels', value: 2, evidence: 'inferred' as const }],
};
const world: WorldDocument = {
  format: 'wordscape',
  version: '0.4',
  name: 'Proposal test',
  description: '',
  units: 'metres',
  bounds: { width: 100, depth: 100 },
  origin: { latitude: 0, longitude: 0, note: '' },
  seed: 1,
  sources: [],
  objects: [object, { ...makeObject('tree', 60, 60), id: 'untouched' }],
  relations: [],
};
const proposal = (): ModelResult => ({
  provider: 'codex',
  model: 'test-model',
  proposal: {
    summary: 'Authored visual interpretation.',
    changes: [
      {
        objectId: object.id,
        description: 'Proposed pavilion',
        geometry: createGeometryTemplate('pavilion').geometry,
      },
    ],
  },
});

describe('reviewed model proposals', () => {
  it('changes only selected description/geometry and adds authored generation provenance', () => {
    const before = JSON.stringify(world),
      next = applyModelProposal(world, [object], proposal());
    expect(JSON.stringify(world)).toBe(before);
    expect(next.objects[1]).toEqual(world.objects[1]);
    expect(next.objects[0].x).toBe(object.x);
    expect(next.objects[0].width).toBe(object.width);
    expect(next.objects[0].facts).toContainEqual(object.facts[0]);
    expect(next.objects[0].facts).toContainEqual(
      expect.objectContaining({ key: 'generation.model', evidence: 'authored' }),
    );
    expect(next.objects[0].geometry?.parts.length).toBeGreaterThan(1);
  });
  it('rejects stale selections and unselected changes', () => {
    expect(() =>
      applyModelProposal(
        { ...world, objects: [{ ...object, x: 21 }, world.objects[1]] },
        [object],
        proposal(),
      ),
    ).toThrow(/changed/);
    const result = proposal();
    result.proposal.changes[0].objectId = 'untouched';
    expect(() => applyModelProposal(world, [object], result)).toThrow(/selected/);
  });
  it('rejects duplicate, executable and out-of-envelope proposals', () => {
    const duplicate = proposal();
    duplicate.proposal.changes.push(duplicate.proposal.changes[0]);
    expect(() => applyModelProposal(world, [object], duplicate)).toThrow(/unique/);
    const malicious = proposal();
    Object.assign(malicious.proposal.changes[0], { sourceId: 'verified', script: 'alert(1)' });
    expect(() => applyModelProposal(world, [object], malicious)).toThrow(/fields/);
    const oversize = proposal();
    oversize.proposal.changes[0].geometry!.parts[0].dimensions = [5, 5, 5];
    expect(() => applyModelProposal(world, [object], oversize)).toThrow();
  });
  it('treats null geometry as preserve, and retains sourced facts', () => {
    const withRecipe = { ...object, geometry: createGeometryTemplate('bench').geometry };
    const result = proposal();
    result.proposal.changes[0].geometry = null;
    const next = applyModelProposal({ ...world, objects: [withRecipe] }, [withRecipe], result);
    expect(next.objects[0].geometry).toEqual(withRecipe.geometry);
  });
});
