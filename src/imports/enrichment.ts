import { migrateWorld, validateWorld } from '../world/document';
import type { WorldDocument, WorldObject } from '../world/types';

/** Add newly identified water only. Existing geometry, IDs, edits and source claims are retained. */
export function addMissingSurveyWater(
  world: WorldDocument,
  imported: WorldDocument,
): { world: WorldDocument; added: number } {
  const incoming = migrateWorld(imported);
  if (
    Math.abs(world.origin.latitude - incoming.origin.latitude) > 1e-7 ||
    Math.abs(world.origin.longitude - incoming.origin.longitude) > 1e-7 ||
    Math.abs(world.bounds.width - incoming.bounds.width) > 0.02 ||
    Math.abs(world.bounds.depth - incoming.bounds.depth) > 0.02
  )
    throw new Error('Water extraction does not match the current survey frame.');
  const next = migrateWorld(world),
    ids = new Set(next.objects.map((object) => object.id));
  const water = incoming.objects.filter((object) => object.kind === 'water' && !ids.has(object.id));
  if (!water.length) return { world: next, added: 0 };
  if (next.objects.length + water.length > 1000)
    throw new Error(
      'The missing water would exceed the 1,000-object limit. No existing object was removed.',
    );
  const sourceIds = new Map<string, string>();
  const needed = new Set(
    water.flatMap((object) =>
      [
        object.sourceId,
        ...(object.facts ?? []).flatMap((fact) => fact.sourceIds ?? []),
        ...(object.references ?? []).map((reference) => reference.sourceId),
      ].filter((id): id is string => !!id),
    ),
  );
  for (const source of incoming.sources.filter((source) => needed.has(source.id))) {
    const matching = next.sources.find(
      (item) =>
        item.url === source.url &&
        item.accessed === source.accessed &&
        item.notes === source.notes &&
        item.title === source.title &&
        item.attribution === source.attribution,
    );
    if (matching) {
      sourceIds.set(source.id, matching.id);
      continue;
    }
    let id = `${source.id}-water`,
      suffix = 2;
    while (next.sources.some((item) => item.id === id)) id = `${source.id}-water-${suffix++}`;
    next.sources.push({ ...source, id, title: `${source.title} · water completion` });
    sourceIds.set(source.id, id);
  }
  const remap = (id: string) => sourceIds.get(id) ?? id;
  const added: WorldObject[] = water.map((object) => ({
    ...object,
    parentId: undefined,
    sourceId: object.sourceId ? remap(object.sourceId) : undefined,
    facts: object.facts?.map((fact) => ({ ...fact, sourceIds: fact.sourceIds?.map(remap) })),
    references: object.references?.map((reference) => ({
      ...reference,
      sourceId: remap(reference.sourceId),
    })),
  }));
  next.objects.push(...added);
  const errors = validateWorld(next).errors;
  if (errors.length) throw new Error(errors[0]);
  return { world: next, added: added.length };
}
