# Layout study: twenty mapped windows

Round 7 measured **20 real geographic windows, 350–500 m wide**, using retained OpenStreetMap data and six small regional downloads. The retained geometry contains **1,937 building footprints, 3,587 motor-road segments and 3,646 path segments** after clipping and filtering. These are mapped features and consecutive-node segments, not a census of buildings or streets. No model was trained: the result is a compact, versioned advisory guide supplied in the world-generation prompt.

The study is deliberately small and purposive. Public-query failures and the availability of small regional extracts shaped its geography. It spans North America, Europe, Asia, Africa and Oceania, with urban blocks, villages, mapped farmland, waterfronts and sparse upland/interior windows. It is **not a representative sample of those places, continents, land uses or the world**. Context labels are authored selection intentions. Nearby Monaco and Liechtenstein cases help compare contrasting layouts, but are not seamless adjacent survey tiles.

## Files and provenance

- [`manifest.json`](../public/reference/layout-study/manifest.json) records every bounding box, local metric frame, source URL, timestamp, checksum, omission and computed distribution.
- Twenty `*.osm.json.gz` files in the same directory retain the normalized source ways needed to reproduce the measurements. They contain OSM feature/node IDs, coordinates and a small tag whitelist; no contributor usernames, user IDs, changeset IDs, names, addresses or contact tags are included.
- [`contact-sheet.png`](../public/reference/layout-study/contact-sheet.png) and the accompanying SVG show the actual retained geometry, north up. They were inspected after extraction. This is a vector inspection sheet, not aerial imagery or a claim of complete feature coverage.
- [`layoutGuide.json`](../src/data/layoutGuide.json) contains the compact sample metrics, derived observations and separately labelled authored heuristics. Each observation/heuristic references sample IDs. Generated fictional placements remain authored; they do not inherit surveyed status from this guide.

All source-derived extracts and measurements carry **© OpenStreetMap contributors**, under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). See [OpenStreetMap attribution and copyright](https://www.openstreetmap.org/copyright). The small normalized extracts are included so the derived results remain inspectable and reproducible.

The two San Francisco cases reuse earlier retained extracts; their original source URLs and retrieval dates remain in this manifest. Their narrower query categories differ from the regional selections. The other 18 cases came from the public [Geofabrik download service](https://download.geofabrik.de/), which supplies ODbL regional extracts and removes contributor identity metadata from its public downloads:

| Regional extract                                                         | Windows                                                        |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| [Monaco](https://download.geofabrik.de/europe/monaco.html)               | Old town; harbor                                               |
| [Liechtenstein](https://download.geofabrik.de/europe/liechtenstein.html) | Vaduz center; Schaan housing; Ruggell farmland; Malbun village |
| [Maldives](https://download.geofabrik.de/asia/maldives.html)             | Malé center; Hulhumalé grid; Thulusdhoo village                |
| [Seychelles](https://download.geofabrik.de/africa/seychelles.html)       | Victoria center; La Digue coast; Mahé interior                 |
| [Nauru](https://download.geofabrik.de/australia-oceania/nauru.html)      | Yaren coast; Buada lagoon surroundings; Nauru interior         |
| [Samoa](https://download.geofabrik.de/australia-oceania/samoa.html)      | Apia center; Matautu Lefaga village; Upolu interior            |

The six downloaded PBFs total **14,402,374 bytes**. Their actual headers report snapshot `2026-11-15T21:22:28Z`; download dates and SHA-256 hashes are recorded separately. These are database snapshot dates, not field observation dates. Full regional PBFs and the optional Python environment stay in ignored `.wordscape/`; they are not shipped with the app. Public crops preserve complete candidate ways needed for clipping, so a way may extend beyond its measurement window.

## Acquisition limits

Three initial Overpass probes timed out: one Private.coffee POST (25 s), one overpass-api.de POST (25 s), and one GET transport check (18 s). None produced a sample. The study then switched to six sequential static regional downloads, one attempt per file, with a 2 s pause, a 45 s timeout and an 8 MiB cap per download. Cached files are reused. There were **20 completed windows and zero unavailable windows** after this fallback; sparse retained data remain sparse, not invented.

This follows the [Overpass operator's resource-sharing guidance](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) and [Private.coffee's considerate-use policy](https://overpass.private.coffee/). It avoids turning the [OSMF editing API](https://operations.osmfoundation.org/policies/api/) into a read-only batch extractor. No imagery was collected and no paid API was used. The acquisition script does not retry indefinitely or expand its geographic scope.

## What is measured

Coordinates use a local Web Mercator frame scaled by the cosine of the window's middle latitude, in metres, with x east and y north. Features are clipped to the rectangle. The precision shown in JSON is numerical output, not survey accuracy.

| Metric               | Meaning and practical limit                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Building area        | Area of each clipped simple building polygon. Building parts and relation-assembled multipolygons are omitted. Summed coverage is not a union and may include overlaps.                                                         |
| Nearest-building gap | Minimum edge-to-edge distance from each retained building to another retained building; touching/overlapping polygons yield zero. Window edges and missing neighbors bias this measurement.                                     |
| Road proximity       | Distance from a building's footprint **envelope center** to the nearest retained motor-road centerline. It is not a setback, entrance distance, walking distance or proof of access.                                            |
| Road/path length     | Sum of clipped consecutive-node segments, separated by highway classes. This is neither a count of named streets nor carriageway width.                                                                                         |
| Connectivity         | Components, junctions and largest-component node fraction using shared original OSM node IDs. A visual crossing without a shared node does not connect. Window cuts, access restrictions and grade separation are not resolved. |
| Area adjacency       | Building/area polygon pairs with edge gap ≤ **10 m**, including overlap. Ten metres is an authored analysis threshold, not a discovered universal rule.                                                                         |

Only simple closed ways become areas. Relation multipolygons/holes are not assembled; ways longer than 5,000 nodes are omitted. The regional extractor does not select relations, so its relation omission count is not a complete inventory of absent relation features. Linear natural tags such as coastline/ridge/cliff are not treated as filled areas. Polygon clipping is simplified and is unsuitable for cadastral or navigation claims. Area classes can overlap, and `leisure` polygons do not all mean vegetation.

The Mahé and Upolu interior windows retain very little qualifying geometry. That is useful evidence of the pipeline's limits, **not evidence of empty land**. The Buada water outline may be absent because relation geometry is excluded. No terrain, imagery, field-verified dimensions, street widths, traffic conditions or tree-species inventory was acquired; retained height tags do not contribute to these measurements.

## Evidence versus generation advice

Across the 16 windows with at least two retained buildings, median nearest-building gap ranges from **0 to 7.189 m**, and median clipped footprint area ranges from **72.039 to 480.068 m²**. Fifteen windows contain both road and path classes; four contain fewer than five retained buildings; fourteen contain building/area pairs within the chosen 10 m threshold. These are computed descriptions of these source windows only.

The guide's recommendations—plan routes before placing solids, vary clearances and footprint sizes, keep intended walking space unobstructed, and make water crossings deliberate—are explicitly **authored heuristics**. Their cited samples provide context; the study does not establish safety standards, universal spacing, accessibility compliance or causal design rules. The model should adapt them to the requested imaginary place rather than copy a real site or a fixed stock arrangement.

## Reproduction and verification

From the project root in PowerShell, the included normalized crops are sufficient for an offline recomputation:

```powershell
node scripts/sample-places.mjs
npx vitest run scripts/layout-metrics.test.mjs
# Optional local contact sheet; requires the existing Playwright dependency and Chrome:
node scripts/sample-places.mjs --preview
```

For a fresh acquisition, the optional [PyOsmium](https://osmcode.org/pyosmium/) helper streams regional PBF ways and their node locations:

```powershell
python -m venv .wordscape/layout-venv
.wordscape/layout-venv/Scripts/python.exe -m pip install osmium==4.3.2
node scripts/sample-places.mjs --acquire
```

`WORDSCAPE_STUDY_PYTHON` can select another Python executable with that dependency. Existing regional files are reused. The `latest.osm.pbf` endpoints are mutable; a fresh download can change the study. Use the included normalized crops and recorded checksums to reproduce this snapshot. `generatedAt` is the recomputation time; it does not replace source timestamps.

The tests cover boundary-distance calculations, missing-data nulls, true shared-node connectivity versus merely crossing lines, clipping and omission accounting, plus retained-corpus checksums, privacy fields and guide references. The twenty-window contact sheet was visually inspected to catch misplaced selections and misclassified linear natural features. Ruggell was deliberately centered on a mapped farmland polygon and Matautu Lefaga on a mapped village node after that review; these are transparent purposive selection adjustments, not random sampling.
