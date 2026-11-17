# Ten processed real layout examples

Round 8 adds **ten complete, valid Wordscape documents**, converted from the retained Round 7 OpenStreetMap crops. The files contain **2,432 objects and 579 building footprints** in 220–250 m windows. Each also has a smaller contiguous geometry context, containing **20–35 records**, for the model to inspect. This supplies actual footprints, orientations and route shapes alongside descriptive statistics; it is not a collection of place names or a fixed fictional template.

The cases deliberately contrast close historic fabric, harbor sheds, planned island blocks, dense small buildings, detached housing, a mountain village, mixed civic blocks and a sparse roadside village. They are purposive examples, not a representative sample. Descriptive labels/tags are authored interpretations; the polygon and route data retain OSM provenance.

## Importable examples

Each linked JSON is a complete WorldDocument that can be imported independently. The [plan contact sheet](../public/reference/layout-examples/contact-sheet.png) shows actual converted polygons; dashed red rectangles identify the contiguous prompt contexts. It is a vector-derived diagram, not imagery. Ground is flat, building heights and corridor widths may be explicit converter estimates, and absent features remain unknown.

| Processed example                                                                                    | Full objects | Buildings | Context records | Median building gap |
| ---------------------------------------------------------------------------------------------------- | -----------: | --------: | --------------: | ------------------: |
| [Monaco old town](../public/reference/layout-examples/monaco-old-town.wordscape.json)                |          362 |        45 |              33 |                 0 m |
| [San Francisco harbor edge](../public/reference/layout-examples/sf-wharf.wordscape.json)             |          214 |        26 |              33 |             1.760 m |
| [Hulhumalé planned blocks](../public/reference/layout-examples/hulhumale-grid.wordscape.json)        |          174 |        82 |              26 |                 0 m |
| [Thulusdhoo settlement](../public/reference/layout-examples/thulusdhoo-village.wordscape.json)       |          170 |       113 |              33 |             1.157 m |
| [Schaan detached housing](../public/reference/layout-examples/schaan-housing.wordscape.json)         |          282 |        54 |              32 |             5.465 m |
| [Malbun village](../public/reference/layout-examples/malbun-village.wordscape.json)                  |          290 |        61 |              29 |             6.097 m |
| [Vaduz civic center](../public/reference/layout-examples/vaduz-center.wordscape.json)                |          572 |        79 |              35 |                 0 m |
| [La Digue dispersed buildings](../public/reference/layout-examples/la-digue-coast.wordscape.json)    |           81 |        62 |              31 |             6.178 m |
| [Apia civic district](../public/reference/layout-examples/apia-center.wordscape.json)                |          265 |        38 |              34 |             2.223 m |
| [Matautu Lefaga roadside village](../public/reference/layout-examples/lefaga-village.wordscape.json) |           22 |        19 |              20 |             5.582 m |

Gaps are minimum edge-to-edge distances to another retained building in the same full window. Touching/overlapping footprints give zero. Crop edges and incomplete mapping bias these values. Buildings per hectare range from 3.04 to 23.35 in these windows, but this is **mapped density**, not a recommended target or a complete inventory.

## Actual geometry in the prompt

[`src/data/layoutExamples.json`](../src/data/layoutExamples.json) contains the compact versioned corpus. The generation integration selects two known examples; it does not send all ten complete documents. Each entry has:

- `id`, authored `name`, `context` and search `tags`.
- `source`: ODbL attribution, exact retained-source checksum, original source URL/snapshot/access date, verified geographic bounds and the static complete-world path.
- `stats`: measurements of the **full processed world**, including density, footprint areas, gaps, road proximity and route orientations. These do not describe just the smaller context rectangle.
- `cluster`: a contiguous rectangular selection clipped directly from the processed world, with coordinates in metres from that rectangle's southwest corner. Its `bounds.x/y` locate it within the full world.
- `cluster.objects`: real polygon vertices and route centerlines, source OSM IDs and original full-world object IDs. Non-route footprint vertices are **absolute cluster-local coordinates**, unlike the object-local footprint convention in a complete WorldDocument. The coordinate note is explicit.

No random object sample is used. Every intersecting footprint is retained unless clipping fails validation; a route is retained when its centerline intersects the rectangle. Consecutive segments of one mapped way are grouped only when their endpoints coincide. The grouped centerline still contains every retained segment, and `sourceObjectIds` maps each segment back to the full Wordscape. Parallel `nodeIds` preserve actual OSM node identities; null means the endpoint was clipped. Geometric crossings alone do not establish a connection.

Compact footprint vertices and centers are rounded to 0.01 m, centerlines to 0.001 m. These digits describe numerical serialization, not mapping accuracy. No vertex-count decimation or replacement of irregular footprints with stock rectangles occurs. Estimated height evidence accompanies compact buildings; estimated width evidence accompanies route corridors. Coastal water lists all coastline way IDs used by the original conversion. Its level remains a display convention, not a measured tide.

The crop selection targets approximately 32 records by comparing counts in candidate rectangles, then retains the whole chosen rectangle. Selection therefore is explicitly purposive. Lefaga uses its complete 250 m world because it is genuinely sparse in the retained data. The other contexts range from 70 to 130 m. The [manifest](../public/reference/layout-examples/manifest.json) records each selection, diagnostic and omission.

## Metrics and limits

`roadOrientation` uses undirected headings clockwise from north, with six 30° bins weighted by segment length. Its `orthogonalAlignment` is the magnitude of the length-weighted fourth angular moment: parallel/perpendicular directions reinforce each other. Monaco's value is 0.301 and Hulhumalé's is 0.869 in these windows. **This is not a naturalness score.** A single straight rural road can also score highly; La Digue's sparse road sample demonstrates that limitation. The geometry, gaps and context matter together.

Summed building area is not a polygon union and can include overlap. Road proximity is from the building's footprint envelope center to a mapped road centerline, not a setback or access guarantee. Terrain, pedestrian accessibility, usable entrances, fine vegetation and ground materials are not acquired by this corpus. Reuse the layout as fictional inspiration, never as surveyed evidence for generated placements.

## Independent conversion audit

All ten complete documents pass the same format/geometry validator used by the app, and none hits the 1,000-object import limit. The retained full-conversion diagnostics total:

- 9 highway areas omitted from centerline conversion.
- 2 complex multipolygon/courtyard relations omitted.
- 3 unsupported or invalid geometry/attribute cases omitted.
- 4 coastline-topology cases where water was conservatively omitted.
- 382 successful footprint-clipping events recorded by the converter.

These are converter event counts, not a census of all absent real-world features. The converter's `estimatedHeights` diagnostic increments before final geometry acceptance: it totals 571 attempted estimates, including rejected geometry. `stats.importedEstimatedHeightCount` instead counts the 568 retained building records with inferred height facts; 11 retained buildings have mapped height tags. No height tag is treated as a new field measurement.

All explicit `world.relations` arrays are empty in this corpus: the current importer adds those relations for supported building-part containment, which these retained cases lack. **Route connectivity is not lost or fabricated:** original node identities are retained in full-world facts and compact `nodeIds`. The regional source crops omit nodes and most relation geometry, so they cannot establish mapped entrances/tree coverage or full building decomposition.

The importer currently represents only selected park/garden/playground/grass and water area classes. Other mapped simple areas, including meadow, vineyard, forest, residential/commercial land use and sports grounds, are counted separately in `coverage.unrepresentedAreaClasses`. Blank ground must not be interpreted as their absence. Labels that initially implied a rendered vineyard/meadow boundary were corrected after this audit.

The compact-context audit caught a coastline identity hazard: re-running coastline conversion on a smaller rectangle can split or renumber the water faces. The final pipeline **clips the already-processed world instead**, keeping source identity and geometry consistent. Every compact footprint vertex and route segment is tested against its full-world source geometry, allowing only stated rounding tolerance. One Apia polygon becomes invalid when clipped to the smaller context and is omitted there with its exact object ID and validation reason retained in the manifest; it remains present in the valid full world. Sixteen route corridors touch context boundaries while their centerlines remain outside and are excluded by the documented centerline rule.

## Provenance and reproduction

The source is **© OpenStreetMap contributors**, under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); [OpenStreetMap copyright](https://www.openstreetmap.org/copyright) and the [Round 7 source study](LAYOUT_STUDY.md) explain attribution and acquisition. Nine cases reuse Geofabrik regional crops with actual PBF snapshot `2026-11-15T21:22:28Z`; the Wharf retains its earlier source URL/access date and unknown snapshot where no timestamp was supplied. No source date was invented, no new network request was made, and no contributor identities were added.

Reproduce from the project root:

```powershell
node scripts/build-layout-examples.mjs
npx vitest run scripts/layout-examples.test.ts
# Optional PNG diagrams: Python with Pillow; the SVG is always generated.
node scripts/build-layout-examples.mjs --preview
```

The build script uses the existing `convertOsmToWorld`, format validator and migration helper. `scripts/layout-example-places.json` records deliberate source-frame crop positions. Full-world JSON, manifest checksums and compact context are deterministic for the retained inputs and converter version. The optional Pillow renderer draws the same processed polygon geometry directly; it does not fetch or edit imagery. Its Windows font fallback is documented in the script. The full contact sheet was visually inspected after generation.

The tests verify ten valid complete documents, exact reproduction of converted objects/relations/diagnostics, retained source hashes and dates, contiguous context-to-world geometry, original route segment/node identity, and a real orientation contrast. They do not assert statistical representativeness, safe access or universal layout quality.
