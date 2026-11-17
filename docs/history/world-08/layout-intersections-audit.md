# Round 8 exact plan-polygon audit

This independent audit compares the exact transformed **declared footprint polygons**, not only their axis-aligned bounding envelopes. The [machine-readable result](layout-intersections-audit.json) records source-file SHA-256 hashes, every relevant pair, intersection area, minimum gap and the tolerances used. None of the three worlds was edited.

| Retained output | Solid–solid area overlaps | Shared boundary contacts | Conservative corridor/water warnings | Actual positive-area footprint overlaps | Envelope-only warnings |
| --- | ---: | ---: | ---: | ---: | ---: |
| First Lanternwater Lanes | 0 | 0 | 5 | 4 | 1 |
| Mossbell Retreat | 0 | 0 | 4 | 1 | 3 |
| Refined Lanternwater Lanes | 0 | 1 | 14 | 9 | 5 |

“Solids” here means building/landmark footprints, excluding any outline container that the renderer suppresses. “Actual” refers to polygon intersection; it does not assert that every intersecting part is a closed three-dimensional wall.

## Refined canal

There are **no positive-area building/building overlaps** among the 26 buildings. Keeper's House and Lantern Guild House share a 22 m boundary, with zero overlapping area.

The 14 conservative warnings contain nine real building/corridor plan overlaps:

| Building | Corridor/court | Overlap |
| --- | --- | ---: |
| Little Keyworks | Coppersmith Bend | 0.931425 m² |
| Threefold Copperworks | Pearwright Court | 27.323019 m² |
| Rainthread Weaving House | Pearwright Court | 41.598842 m² |
| Pearleaf Press | Pearwright Court | 0.001019 m² |
| Russet Pear Cottage | Pearwright Court | 0.338031 m² |
| Pipkeeper House | Pearwright Court | 8.633873 m² |
| Green Shutter Cottage | Pearwright Court | 1.905286 m² |
| Blue Compass House | Netmakers Passage | 0.477518 m² |
| Moonwake Guesthouse | Netmakers Passage | 0.477518 m² |

Five other warnings are envelope-only. No building/water polygon overlap was found. The tiny Pearleaf Press sliver is approximately 10.2 cm²; the two large workshop/court overlaps are substantial. Threefold Copperworks has a full-footprint ground-level box hall in its custom recipe, so that particular overlap is not merely an empty space inside a decorative bounding envelope. Rainthread Weaving House uses the normal building mass. **The refined result should not be described as collision-free or as having completely clear routes.**

## Woodland

None of the five huts intersects any path or water polygon. The three hut/path warnings are conservative: Fern Hut–Arrival bend has a 10.859 m polygon gap; Rowan Hut–Upper clearing walk 8.625 m; Birch Hut–Birch departure 7.846 m.

The only positive overlap is the pavilion threshold path entering the pavilion deck by 1 m across its 2.4 m width, totaling **2.4 m²**. This strip is clear of the open-sided pavilion's posts. It is consistent with an approach/deck connection, rather than a hut collision. The deck is 0.30 m high and the path 0.04 m high, so this observation is not an accessibility or step-free access claim.

## First canal

Four corridor/court footprints overlap declared building footprints: Kiln Court Stores–Uneven Kiln Court **57.093344 m²**; Copper-Domed Archive–Copper Court **2.272727 m²**; Mapbinder's Shop–Copper Court **7.992424 m²**; Pear Court Inn–Pear Court Passage **22 m²**. One additional warning is envelope-only. No building/building or building/water area overlap was found.

## Reproduction and limits

The optional development helper uses Python and **Shapely 2.1.1**, already available in the development environment. It introduces no application/runtime dependency and makes no network calls:

```powershell
python -B scripts/audit-generated-layouts.py
python -B -m unittest discover -s scripts -p test_audit_generated_layouts.py
```

The three development tests verify local rotation before translation, boundary contact versus positive area, and rotated-envelope false positives. All pass. If using another development environment, install the optional Shapely version in an isolated environment; it is unnecessary for running Wordscape.

The audit transforms each object's local footprint by its counterclockwise plan rotation and world x/y translation, matching `getFootprint`; objects without a polygon use their declared rectangle. Positive area uses a 0.000001 m² threshold to avoid floating-point slivers. Boundary-only contact is separate. The app's conservative warning condition is reproduced as more than 0.05 m overlap on each bounding-box axis.

This is a plan audit, not a mesh collision solver. It does not establish route connectivity, usable doorways, navigability, tree/fixture clearance, vertical separation or accessibility. Custom recipes and open structures can occupy less than their declared footprint. All three audited scenes are flat; no terrain surface was assumed or modified. Pairwise overlap sums are not a union of obstructed pavement areas. The recorded source hashes must match before reusing these conclusions for an edited world.
