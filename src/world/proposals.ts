import { migrateWorld, validateWorld } from './document';
import { validateGeometryRecipe } from './geometryRecipe';
import type { WorldDocument, WorldObject } from './types';
import type { ModelResult } from '../services/companion';

/** Only description and bounded geometry may be proposed. Evidence never becomes sourced. */
export function applyModelProposal(
  world: WorldDocument,
  selected: WorldObject[],
  result: ModelResult,
): WorldDocument {
  if (
    !result ||
    !['codex', 'api'].includes(result.provider) ||
    typeof result.model !== 'string' ||
    result.model.length > 100 ||
    !result.proposal ||
    typeof result.proposal.summary !== 'string' ||
    !Array.isArray(result.proposal.changes) ||
    result.proposal.changes.length < 1 ||
    result.proposal.changes.length > 3
  )
    throw new Error('Invalid model proposal.');
  const allowed = new Map(selected.map((object) => [object.id, object]));
  const changed = new Set<string>();
  const replacements = new Map<string, WorldObject>();
  for (const change of result.proposal.changes) {
    const original = allowed.get(change.objectId),
      current = world.objects.find((object) => object.id === change.objectId);
    if (!original || !current || changed.has(change.objectId))
      throw new Error('The proposal must target unique selected objects only.');
    if (JSON.stringify(current) !== JSON.stringify(original))
      throw new Error('This object changed after generation began. Generate a fresh proposal.');
    if (
      Object.keys(change).some((key) => !['objectId', 'description', 'geometry'].includes(key)) ||
      typeof change.description !== 'string' ||
      !change.description.trim() ||
      change.description.length > 10000
    )
      throw new Error('Invalid proposed object fields.');
    if (change.geometry !== null) {
      const errors = validateGeometryRecipe(change.geometry, current);
      if (errors.length) throw new Error(errors[0]);
    }
    changed.add(change.objectId);
    replacements.set(change.objectId, {
      ...current,
      description: change.description,
      ...(change.geometry === null ? {} : { geometry: change.geometry }),
      facts: [
        ...(current.facts ?? []).filter(
          (fact) => !['generation.model', 'generation.provider'].includes(fact.key),
        ),
        {
          key: 'generation.model',
          value: result.model,
          evidence: 'authored',
          note: 'Generated visual interpretation; not a surveyed or verified real-world fact.',
        },
        { key: 'generation.provider', value: result.provider, evidence: 'authored' },
      ],
    });
  }
  const next = {
    ...migrateWorld(world),
    objects: world.objects.map((object) => replacements.get(object.id) ?? object),
  };
  const errors = validateWorld(next).errors;
  if (errors.length) throw new Error(errors[0]);
  return next;
}
