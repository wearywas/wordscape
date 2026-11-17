# Demo guide

Start the app using the [root setup instructions](../README.md). The bundled examples, document editing and 3D interpretation work without a model account. Live area imports require the local companion; model generation additionally requires an explicit provider connection.

## Inspect an existing record

1. Open **Examples**. Choose Washington Square for sourced terrain and mapped features; **Mossbell Retreat · terrain** or **Alderfold** for authored height grids; **Lanternwater Lanes · refined** or **Mossbell Retreat · flat** for retained imaginary layouts; or Reading pavilion for one procedural recipe. The current world is archived before the example opens. If storage fails, the example does not replace it.
2. Select an object in **World objects** or click its footprint in **Words**. Inspect coordinates, dimensions, evidence, facts and references. Placements are locked until **Edit mode** is enabled.
3. Switch between **Words**, **3D world** and **Document**. These are views of the same record. **Aerial** is a geographic reference and is disabled for explicitly imaginary worlds.
4. Export **World document** for portable JSON. Export **3D model** for GLB geometry from the example interpreter, with the complete world document embedded in metadata.

For a smaller format example, download [minimal.wordscape.json](../public/examples/minimal.wordscape.json) and use **Import**. It has three manually authored objects and no external data dependencies.

## Edit and navigate

In **Words**, drag empty space to pan and scroll to zoom around the pointer. In **Edit mode**, drag an object or edit its inspector fields. Focused footprints support arrow-key movement; Shift increases the step. Parent-container edits propagate to descendants. **Document** exposes JSON with an explicit **Apply document** action.

In **3D world**, drag to orbit, scroll to zoom and right-drag to pan. **Reset view** fits the current viewport. **Walk here** switches to a 1.7 m eye-height view: WASD or arrows move, dragging looks around, and Escape or **Return to orbit** exits. **Reset walk** finds suitable ground near the selection or scene center. Walking uses approximate collision; it does not establish accessible routes, doorway clearance or stair/bridge traversal.

**Terrain · true scale** and **Flat comparison** change the preview only. Exports retain recorded terrain. **Terrain & survey** opens the ground profile, evidence counts and review notes; authored ground is identified as authored, not as a measured DEM.

For a direct terrain comparison, open **Mossbell Retreat · terrain** and toggle **Flat comparison**. The revision retains the original 29 objects and their plan positions, with 28 placements regrounded on an authored 33 × 33 grid. Its retained original description still mentions flat ground; the terrain record and preview show the revision. **Alderfold** is a separate 24-object world generated with authored terrain from the start. These files demonstrate actual stored height grids, not measured landscapes or stand-in landmark cones.

Undo/redo is available in Edit mode during the current tab session. **Saved worlds** stores snapshots locally in IndexedDB; **Save current copy** preserves later edits. Export JSON for a backup that survives browser-storage loss.

## Create an imaginary world

Open **Imagine a world**. The brief is optional. Choose a size, **Layout character** and automatic, manual or no **Real-place references**. Reference cards show retained mapped examples; their 3D previews are read-only. Automatic selection is a local keyword/tag heuristic, not a quality ranking.

**Include authored terrain** is on by default. The model proposes bounded landforms that become a real height grid in the document, rather than cone-shaped landmark substitutes. It may choose flat terrain when the brief calls for it. Uncheck the option to request a flat ground plane.

Choose the ChatGPT/local Codex connection or explicitly select the separately billed API provider. There is no automatic paid fallback. Generate, then inspect the scene, reference context, plan measurements, ground-elevation range and warnings. **Open imagined world** applies the preview; cancellation or closing discards it.

## Improve a world, including its ground

**Improve this world** can propose additions and selected description/form changes. Existing plan positions, dimensions and source facts are preserved; the operation does not delete or relocate existing buildings.

Terrain revision defaults off. For an eligible imaginary world, explicitly enable **Author or replace terrain** to allow fictional ground to change. Eligibility excludes surveyed/unmarked terrain and protected terrain-dependent source placements. Eligible authored objects may move vertically to follow the new ground; the preview reports regrounded and protected placement counts. Water remains a flat plane. Inspect foundations, slopes, access and shorelines before **Apply improvements**. Terrain-only proposals are supported.

Whole-world generation sends the brief, preferences, guide and selected reference statistics/small geometry contexts to the selected provider. Revision also sends bounded existing-object summaries, resolved bases and a coarse 9 × 9 terrain summary when present. Full terrain grids, images and the world's source records remain with the local companion. The review reports included and omitted object counts; see the [companion documentation](../server/ai-README.md) for details.

## Import or extend a real place

**Create a place** selects a bounded mapped area, retrieves available mapped features and optional sourced terrain, and previews the result before opening it. The retained Washington Square import works without a new geographic request. This is vector-map conversion, not image recognition. Review omissions and inferred heights.

**Complete survey** adds supported missing source data while retaining existing objects. For individual geographic surveys, the creation studio's **North / East / South / West** controls select an adjacent area with an exact shared boundary. **Saved worlds → Combine surveys** previews a composition of compatible saved tiles. See [OSM import](OSM_IMPORT.md) and [terrain import](TERRAIN_IMPORT.md) for coverage, provider and licensing limits.

## Read the results critically

The current Washington Square specimen contains 165 placements; it is a mixed-source interpretation, not a complete present-day survey. Historical example files retain their original versions and assumptions. Layout coverage and spacing are descriptive measurements, not scores or collision guarantees. The retained canal example still has corridor overlaps; the [layout audit](history/world-08/layout-intersections-audit.md) documents them. A valid document can still need visual and spatial revision.
