# Write an interpreter

An interpreter consumes a validated world and produces a view or another representation. It should keep the original record separate from disposable meshes and caches. The current repository exposes source modules, not a published stable SDK. The format is **0.8**; supported historical versions remain readable.

## Start with a small supported subset

The TypeScript below produces upright footprint-prism records for a flat world. Imports are relative to a module placed at the repository root. It uses existing validation, geometry and elevation helpers; `PrismRecord` is this example's output type, not a package API.

```ts
import { parseWorld, getFootprint } from './src/world/document.ts';
import { getObjectBaseElevation } from './src/world/terrain.ts';
import type { WorldDocument, WorldObject } from './src/world/types.ts';

type PrismRecord = {
  id: string;
  ring: [number, number, number][];
  height: number;
  metadata: WorldObject;
};

export function interpretFlatWorld(text: string): {
  document: WorldDocument;
  prisms: PrismRecord[];
} {
  const world = parseWorld(text); // Throws for unsupported versions or invalid data.
  if (world.terrain || world.objects.some((object) => object.geometry)) {
    throw new Error('This starter supports flat worlds without geometry recipes.');
  }
  const prisms: PrismRecord[] = world.objects.map((object) => {
    const base = getObjectBaseElevation(world, object);
    if (base === undefined) throw new Error(`Unresolved ground: ${object.id}`);
    return {
      id: object.id,
      ring: getFootprint(object).map(([east, north]): [number, number, number] => [
        east - world.bounds.width / 2,
        base,
        -(north - world.bounds.depth / 2),
      ]),
      height: object.height,
      metadata: structuredClone(object),
    };
  });
  return { document: structuredClone(world), prisms };
}
```

Pass the [minimal garden JSON](../public/examples/minimal.wordscape.json) as `text`. Extrude each ring upward by `height` in your target renderer. This starter deliberately gives trees and buildings generic footprint prisms; it does not implement material facts, road markings or the complete visual semantics. Preserve `document` for round-trip export instead of reconstructing JSON from meshes.

## Coordinates and hierarchy

- Document coordinates are metres: `x` east and `y` north from the southwest frame origin. Footprint points are local east/north offsets before object rotation.
- `getFootprint` returns transformed world east/north points. Do not apply the object's rotation or position a second time.
- The example maps east to renderer X, up to Y, and north to negative Z, centered around the world bounds. A different engine can use a different axis mapping if it is explicit and invertible.
- `parentId` is semantic. Children already have absolute world positions. Render each once; do not nest them under another placement transform.
- A layer orders overlapping surfaces; it is not a measured elevation. Any anti-z-fighting offset is an interpreter decision, not a document edit.

## Add terrain and recipes explicitly

Use `getObjectBaseElevation(world, object)` for grounding, including terrain anchors and composition corrections. `undefined` means unresolved coverage, not zero. `sampleTerrain` returns absolute datum metres; subtract `terrain.referenceElevation` exactly once when mapping the sampled ground into the local render frame. Preserve null gaps and avoid triangulating across unsupported cells.

A complete terrain interpreter must mesh the grid, subdivide/drape broad surfaces, keep buildings upright with an explicit foundation interpretation, and honor flat absolute water levels. The included [terrain adapter](../src/world/threeTerrain.ts) demonstrates these choices. Its foundations are modeled supports, not surveyed floor levels.

Geometry recipes are bounded declarative parts, not executable scripts. Support their coordinate space, rotations, primitive dimensions and footprints, or report them as unsupported. Do not silently replace an authored recipe while claiming equivalent output. The [format reference](FORMAT.md) defines the recipe contract; the [Three.js adapter](../src/world/threeAdapter.ts) is one implementation.

## Evidence, safety and compatibility

Keep object IDs, source records, fact evidence, references, terrain and composition metadata intact. Unknown facts stay unknown; defaults and decorative details are interpretations. Render text as text, never executable HTML. Do not execute descriptions, evaluate recipe strings or fetch linked source pages automatically.

Use `parseWorld` at the input boundary and `serializeWorld` for export. JSON Schema is useful for structure, but shared validation also checks geometry, source integrity, hierarchy and coverage. Ordinary documents allow up to 1,000 objects / 4 MiB; composed surveys use separate limits. Call `getWorldLimits` rather than assuming one cap. Treat validation limits as upper bounds, not a rendering budget.

Test rotated/concave footprints, explicit unknowns, missing terrain, absolute children and document round trips. Record your interpreter version and supported fact vocabulary. Cross-engine compatibility must be demonstrated by an adapter; it does not follow merely from accepting JSON. For edits, send updated object data through the document helpers rather than storing only a changed mesh transform.
