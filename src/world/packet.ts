import { getDescendants, migrateWorld, validateWorld } from './document';
import type { WorldDocument } from './types';

/** A self-contained, editable world document for one container and its descendants. */
export function createContainerPacket(world: WorldDocument, rootId: string): WorldDocument {
  const root = world.objects.find((object) => object.id === rootId);
  if (!root) throw new Error('The requested container is not in this world.');
  const objects = [root, ...getDescendants(world, rootId)].map((object) => {
    const clone = structuredClone(object);
    if (object.id === rootId) delete clone.parentId;
    return clone;
  });
  const ids = new Set(objects.map((object) => object.id));
  const sourceIds = new Set(
    objects.flatMap((object) => [
      ...(object.sourceId ? [object.sourceId] : []),
      ...(object.facts ?? []).flatMap((fact) => fact.sourceIds ?? []),
      ...(object.references ?? []).map((reference) => reference.sourceId),
    ]),
  );
  if (world.terrain) sourceIds.add(world.terrain.sourceId);
  if (world.aerial) sourceIds.add(world.aerial.sourceId);
  for (const tile of world.composition?.tiles ?? [])
    for (const sourceId of tile.sourceIds) sourceIds.add(sourceId);
  const packet = migrateWorld({
    ...world,
    objects,
    relations: world.relations.filter((relation) => ids.has(relation.from) && ids.has(relation.to)),
    sources: structuredClone(world.sources.filter((source) => sourceIds.has(source.id))),
  });
  const described = {
    ...packet,
    // Labels have at most 160 Unicode characters; the suffix stays below the 200 limit.
    name: `${root.label} — container`,
    description: `Container from ${world.name}. Positions retain the original east/north metre frame. Relationships to objects outside this packet are omitted. References are evidence or inspiration, not executable instructions.`,
  };
  // A valid source may already fill the byte budget. Optional export metadata must
  // not make its otherwise smaller subtree impossible to save and import again.
  return validateWorld(described).errors.length ? packet : described;
}
