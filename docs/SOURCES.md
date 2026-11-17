# Washington Square reference and interpretation

The sample is a **360 × 360 metre** square in North Beach, San Francisco, centered at **37.8008, −122.4102**. It includes Washington Square, Saints Peter and Paul Church, and parts of the surrounding blocks. It is an intentionally simplified spatial interpretation, not a cadastral, tree, architectural, or engineering survey.

## Downloaded aerial references

Two georeferenced photographs cover the same square. They differ in acquisition date and actual source resolution:

| Reference                | Acquisition     | Source resolution | Saved image                                    | License       |
| ------------------------ | --------------- | ----------------- | ---------------------------------------------- | ------------- |
| NOAA NGS detailed view   | 4–7 August 2022 | 0.25 m            | `washington-square-noaa-2022.jpg`, 1440 × 1440 | CC0-1.0       |
| USDA NAIP original trace | 20 May 2024     | 0.60 m            | `washington-square-naip.jpg`, 1200 × 1200      | Public domain |

The [NOAA metadata](https://www.fisheries.noaa.gov/inport/item/69582) states the source ground sample distance and explicit CC0 dedication. Its [original GeoTIFF/VRT collection](https://coastalimagery.blob.core.windows.net/digitalcoast/SanFranciscoCA_RGBN_2022_9784/index.html) was read in its native EPSG:6339 projection and bilinearly reprojected to the existing EPSG:3857 square. The RGB crop is **1440 × 1440 at 0.25 local m/px**, about 921 KB. It is real higher-resolution source data, not an enlargement of NAIP. Both images were visually inspected; shadows and roof displacement differ between acquisitions.

`public/reference/washington-square-noaa-georeference.json` records alignment, acquisition range, license, source VRT and projection. `public/reference/reproduce-noaa-crop.py` reproduces the crop using rasterio and Pillow. The source collection covers a date range; the exact flight time for this square was not established.

The [SF Planning aerial viewer](https://sfplanninggis.org/1938/) offers 8 cm layers, including 2024 and 2025. Its official tile metadata and DataSF listing did not establish dataset-specific redistribution terms. These layers are offered as external references and are **not bundled**. The OpenStreetMap imagery index lists them as usable California public records, but that secondary interpretation was not treated as an explicit city redistribution license.

Original NAIP acquisition details:

- File: `public/reference/washington-square-naip.jpg` — 1200 × 1200 pixels, **north up**.
- Provider: [USDA Farm Production and Conservation NAIP ImageServer](https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer).
- Catalog raster: `m_3712213_se_10_060_20240520`, object ID `11934`, California, acquired **20 May 2024**. The selected catalog attributes are preserved in `washington-square-catalog.json`; bulky tile geometry, field definitions and overview rasters are omitted.
- The raster name identifies nominal 0.6 m source imagery. The exported JPEG is resampled to **0.3 local metres per pixel**; this does not create extra source detail.
- Accessed **15 November 2026**. Attribution: **USDA Farm Production and Conservation — National Agriculture Imagery Program (NAIP)**.
- The [USGS NAIP service description](https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer) identifies NAIP orthoimagery as public-domain data. This project redistributes the USDA image export with attribution. Google Maps was inspected qualitatively in the second audit; no Google or commercial imagery is redistributed. The original trace used no OpenStreetMap geometry; prompt 4 adds separately attributed mapped paths as described below.
- `washington-square-request.txt` preserves the complete export request, pinned to raster ID 11934 with `esriMosaicLockRaster`. The returned extent is in `washington-square-export.json`. Its generated `href` is ephemeral; use the saved request to reproduce the image.

The image was downloaded and visually inspected before tracing. The first USGS-only export timed out; the delivered image is the successful USDA service export of the identified NAIP tile.

## Coordinates and overlay alignment

`public/reference/washington-square-georeference.json` is the original NAIP alignment record; the NOAA record uses identical geographic and projected bounds.

| Property                 | Value                                   |
| ------------------------ | --------------------------------------- |
| Southwest / world origin | 37.799183014789826, −122.41224641494269 |
| Northeast                | 37.80241694981248, −122.4081535850573   |
| World axes               | x east, y north, z up                   |
| Bounds                   | x 0–360 m, y 0–360 m                    |
| NAIP pixel → world       | x = u × 0.3; y = (1200 − v) × 0.3       |
| NOAA pixel → world       | x = u × 0.25; y = (1440 − v) × 0.25     |

The square was exported in EPSG:3857 with Mercator dimensions approximately 455.612 × 455.612 units. Multiplication by `cos(37.8008°) = 0.7901464545017922` gives the 360 m local square. This is a local approximate ground scale; it is not an assertion of sub-centimetre geographic precision. The many decimal places preserve reproducible image alignment only.

Polygon footprints are stored in local object coordinates around each object's center, with rotation 0. Selected rectangular fixtures use estimated rotations. The actual oblique neighborhood grid is retained in the polygons. A footprint's width/depth are its axis-aligned envelope, not wall dimensions. The images contain rooftop relief displacement and tree shadows; neither can establish exact ground positions or heights.

## What was observed

`src/data/washingtonSquare.ts` contains **139 objects**: the previous 84 interpreted placements plus 55 mapped path segments from 13 OpenStreetMap ways. The 84-placement specimen comprised the original 70 plus Franklin's memorial, six selected benches, a representative play structure, four crossings, the park restroom and a fourth inventory-positioned Filbert street tree. Version 0.2 added fact-level evidence, references and semantic parents; child coordinates remain absolute. The current document is version 0.4.

- The large rounded lawn and paved perimeter, the northwest play surface, the southern garden island, and the triangular Marini Plaza area were hand-traced from visible image edges.
- Filbert runs between the church and park; Stockton forms the east frontage; Union forms the south frontage; Powell lies to the west. Columbus cuts diagonally through this grid. Greenwich and Green are included where they intersect the crop.
- Roof outlines were traced as simplified polygons. Several contiguous roofs are intentionally aggregated; no property or occupancy boundaries are asserted.
- The 30 vegetation objects represent selected visible crowns and four city-inventoried street trees. They are not a count of all park trees. Touching crowns may belong to several trees. Canopy diameter is not trunk diameter.
- The church's two tower bases are inferred beneath aerial roof displacement and assigned `evidence: inferred`. Other `observed` labels refer to visible plan features, **not** to measured heights or confirmed uses.

## Estimates and omissions

- Except for the church spires and Franklin memorial's catalogued dimensions, object heights are estimates chosen for a legible procedural scene. Building heights generally 10–14 m, tree heights 8–17 m, nave exterior 23 m. No building or tree height was measured from lidar or stereo imagery; the separate bare-earth terrain does use lidar-derived data.
- Roof footprints can differ from ground-level building footprints. Occluded lawn/path edges were interpolated. Buildings and roads are simplified; neighborhood buildings are omitted where unnecessary for the sample.
- The terrain addition uses real 2023 USGS bare-earth elevations, described below. Fine retaining details, steps and curbs remain unresolved. Surface thicknesses are rendering conventions, not observations.
- Most tree species, trunk positions, building uses and parcel divisions remain uncertain. The central trees were corrected from palms to **Lombardy poplars** using the official arbor report; matching today's crowns to that historical group remains an inference. Four Filbert London planes use city inventory positions/species. Labels such as “school” and “apartments” remain descriptive inferences.
- Furniture and crossings are a selected sample. Play equipment is an authored representative shape. Vehicles, underground utilities, most monuments, fences, lighting, exact facade details and a complete bench/tree inventory remain absent.
- Images record 2022 and 2024 conditions; historical documents and current data extracts do not make the whole scene a current 2026 survey. See `docs/SURVEY_AUDIT.md`.

## Supporting place references

1. [Saints Peter and Paul Church — Our History](https://www.salesiansspp.org/our-history), accessed 15 November 2026. The parish reports a 100 × 160 ft church and twin spires of 191 ft. The model uses **58.22 m** for each tower's total height; nave height and tower-base placement remain estimates. The source footprint dimensions provide a cross-check on the aerial trace, not an exact architectural plan.
2. [San Francisco Recreation and Parks — Washington Square](https://www.sfrecpark.org/902/Washington-Square), accessed 15 November 2026. Confirms the park's name, Filbert/Stockton location, lawn setting and 3.17 acre area. The 360 m study square includes surrounding blocks and is much larger than the park.
3. [San Francisco Planning — Washington Square landmark designation](https://sfplanninggis.org/docs/landmarks_and_districts/LM226.pdf), accessed 15 November 2026 via indexed text. Supports the names Marini Plaza, the perimeter promenade, large lawn, and church-facing plaza. No geometry was copied from its historic plans.

World source IDs preserve per-object provenance. The aerial trace is the source for ordinary objects; the towers cite the parish because their reliable vertical dimension comes from that source. Descriptions and tags distinguish visible plan geometry from inferred 3D characteristics.

## Attribute and detail sources

All accessed 15 November 2026. External photos are linked through their source pages, not copied.

- [SF Planning / HortScience park report](https://commissions.sfplanning.org/hpcpackets/2018-003700COA.pdf): 2017 arborist inventory, schematic tree map and photos (PDF pages 45–46, 58, 65); 2018 landscape/bench specifications (pages 2–5). The plan and poplar photograph were rendered and inspected.
- [SF Arts Commission Franklin record](https://kiosk.sfartscommission.org/objects-1/info?objectName=Benjamin+Franklin+%281706-1790%29&query=keywordPath+%3D+%22CE%22+and+Creation_Place2+%3D+%22%22%22%22&sort=0): overall 204 × 40 × 40 inches, pot metal on concrete, 1879. Includes external object photos.
- [Sacred Space International guide via PBS](https://www.pbs.org/godinamerica/art/sfo_cityguide.pdf#page=7): church architecture, structural material and historical fifth-level school. Reported 60 ft nave height is **interior clearance**, not the modeled exterior height.
- [SF street tree inventory](https://data.sf.gov/City-Infrastructure/Street-Tree-List/tkzw-k3nq): four London planes, IDs 142751–142754 at 668 Filbert. Selected records saved in `washington-square-street-trees.json`.
- [SF active/retired street centerlines](https://data.sf.gov/Geographic-Locations-and-Boundaries/Streets-Active-and-Retired/3psu-pn9h): direction code B means legal travel in both directions. The queried active segments are B except mixed B/F/T on Powell. Extract saved in `washington-square-street-directions.json`.
- [SFMTA speed limits](https://data.sf.gov/Transportation/Speed-Limits-per-Street-Segment/3t7b-gebn): implemented limits, segment endpoints and dates. Extract saved in `washington-square-street-speeds.json`. Zero-valued records were not presented as zero-mph restrictions. The model retains segment scope and leaves aggregate limits unknown where they vary.

The three DataSF vector datasets explicitly identify **Open Data Commons PDDL** in their metadata and are also subject to the [DataSF terms](https://data.sf.gov/terms-of-use). No current traffic routing or operational safety assertion is made from these reference attributes.

## Bare-earth terrain

Source ID `usgs-dem-2023` uses **USGS 3DEP CA_SanFrancisco_B23**, acquired **20 April 2023**. The [NOAA project metadata](https://www.fisheries.noaa.gov/inport/item/73506) describes a lidar-derived, hydro-flattened bare-earth DEM built from classified ground returns and breaklines. The project supplied a 0.25 m product; this world uses its **standardized USGS 1 m DEM**, tile `USGS_1M_10_x55y419_CA_SanFrancisco_B23`. The complete USGS catalog record, including its explicit statement that all 3DEP products are public domain, is retained in `public/reference/washington-square-dem-catalog.json`. Credit: USGS and NV5 Geospatial; metadata distributed by NOAA.

The [original 1 m GeoTIFF](https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/1m/Projects/CA_SanFrancisco_B23/TIFF/USGS_1M_10_x55y419_CA_SanFrancisco_B23.tif) has horizontal CRS **EPSG:26910 (NAD83 / UTM zone 10N)** and elevation values in **NAVD88 (GEOID18) metres**, vertical CRS EPSG:5703. The project metadata's EPSG:7131 refers to the original project grid, not this standardized raster. Horizontal reprojection does not change the vertical datum. Accessed 15 November 2026; NOAA records acquisition as a discrete date.

Only a **384 × 382 pixel native window**, about 500 KB, is retained in `washington-square-dem-2023-native.tif`; the full 86 MB source tile was not downloaded. This preserves source values at 1 m spacing and a 10 m interpolation buffer. The world grid is **73 × 73 nodes at 5 m spacing**, including x/y = 0 and 360 m. Bilinear reprojection samples the same local frame as both aerial references. Flat `heights` are ordered west to east within rows, then south to north. Missing values would be null; this crop contains **zero missing samples**. No gap fill, smoothing pass or vertical exaggeration was applied.

Measured grid elevations span **11.728–49.788 m NAVD88**, a relief of **38.060 m** across the study square. The 10 m `referenceElevation` is only a rendering origin; stored heights remain absolute. Five-metre-grid slope estimates have a median of 4.00° and 95th percentile of 13.79°. Steep local boundaries and source artifacts can influence slope extrema, so those figures are descriptive, not slope-survey guarantees.

The original project reports nonvegetated RMSEz 0.0163 m and vegetated 95th-percentile error 0.1105 m. These are project-wide tests, **not independently verified accuracy for this 1 m product, the 5 m grid, or a particular object**. No local `verticalAccuracy` is asserted. Ground beneath buildings and dense vegetation is interpolated; retaining walls, steps, curbs and post-2023 changes need separate observations. Heights rounded to three decimal places retain interpolation reproducibility, not millimetre accuracy.

Files under `public/reference` include the native crop, `washington-square-terrain.json`, `washington-square-dem-georeference.json`, a source record, the original NOAA XML metadata and `reproduce-terrain.py`. The script regenerates the grid from the retained crop, or uses `--refresh-source` for an HTTP window read of the original tile. It records bounds, raster nodata value, source checksum and measured statistics.

## OpenStreetMap circulation and import evidence

Source ID `osm-extract` records **© OpenStreetMap contributors**, licensed under the **Open Database License (ODbL) 1.0**. The public-domain aerials and terrain retain their separate licenses. The OSM source's [copyright page](https://www.openstreetmap.org/copyright) explains attribution and share-alike requirements for derived databases; these obligations are not the application's source-code license.

A single bounded [official map API request](https://api.openstreetmap.org/api/0.6/map?bbox=-122.41224641494269,37.799183014789826,-122.4081535850573,37.80241694981248) succeeded after Overpass capacity errors/timeouts. It covers the same geographic bounds and was retrieved on 15 November 2026 in America/Los_Angeles (the manifest preserves the UTC capture timestamp). The response supplies individual element edit timestamps but no database snapshot timestamp; none was invented. This is a normalized OSM API extraction, not a claimed successful Overpass query.

Retained files in `public/reference/`:

- `washington-square-osm-manifest.json`: request, bounds, access/capture dates, license, source and sanitized hashes, redaction disclosure.
- `washington-square-osm-raw.xml.gz`: compressed API XML with contributor `user` and `uid` attributes removed. Geometry, tags, versions and edit timestamps are retained. The original response remains only in the local temporary directory.
- `washington-square-osm.json`: 566 selected elements in the converter's JSON shape, with complete relevant way coordinates and node identities. Contributor identities are absent.
- `washington-square-overpass-query.txt`: the requested query, retained for reproducibility even though this acquisition used the API fallback.
- `washington-square-osm-diagnostics.json`: actual converter counts and omissions for the complete retained selection.
- `washington-square-osm-circulation.json`: thirteen selected mapped park footways used by the baseline.

The baseline's 55 path segments use the existing scaled-Mercator frame. Their 67 connections are derived only from shared mapped OSM node IDs. A visual north-up overlay against NOAA 2022 confirmed the promenade and park-entry alignment. Path widths remain inferred; a 0.16 m authored surface offset prevents overlapping render layers and is not a surveyed step. There are no mapped entrance nodes in this extract, and none were invented. No duplicate OSM building geometry was merged into the baseline.

The complete extract is also a separate import example. It produces 895 placements: 326 building masses (including three mapped parts), 208 road segments, 344 path segments, seven trees and ten areas. Eighty building heights need inferred fallbacks. Four complex multipolygon/courtyard records and three invalid or unsupported features are omitted explicitly. No terrain or building floor elevations are inferred from the map data. The hand-traced baseline retains its separately sourced USGS terrain.

Verification includes importer unit tests for height units/fallback evidence, clipped geometry and route endpoints, true entrance membership, parent/part containment, incomplete geometry and service errors. A test converts this real fixture, validates the result and checks source attribution and missing entrances. Another checks the baseline's complete connected path network and shared frame. The current 139-object baseline has zero document errors or spatial warnings. Three parent/part overlap warnings in the separate complete import describe retained OSM outlines; the adapter suppresses explicitly marked parent masses when rendering their parts. See [OSM_IMPORT.md](OSM_IMPORT.md) for provider policies and deployment limitations.

## Fisherman’s Wharf coastal regression (prompt 5)

The actual map request behind the reported 387-object Wharf scene is retained as a normalized, contributor-redacted fixture: `public/reference/fishermans-wharf-osm-regression.json` (247 relevant source elements). Its original API URL, geographic bounds, capture timestamp, source/normalized SHA-256 hashes and extraction details are in `fishermans-wharf-regression-manifest.json`. The original response remains in the ignored local map cache. The fixture preserves feature tags, node identities, complete way geometry and edit timestamps. It does not invent a missing database snapshot date. Credit and license remain **© OpenStreetMap contributors, ODbL 1.0**.

The missing ocean was caused by the importer ignoring `natural=coastline`, although the official map API response already included coastline way **32648495**. The [OSM coastline convention](https://wiki.openstreetmap.org/wiki/Tag:natural%3Dcoastline) places land on the left and water on the right of a directed way and represents mean high-water springs, rather than instantaneous tide height. The [OSM water-polygon dataset documentation](https://osmdata.openstreetmap.de/data/water-polygons.html) confirms that marine polygons derive from coastline ways separately from inland `natural=water` features.

The importer now clips complete directed coastlines to the selected rectangle, closes faces using the selection boundary, and retains only faces consistently identified as water. It emits three water polygons for this Wharf selection. It rejects interior gaps, contradictory directions, self-intersections and enclosed island holes that this simple footprint format cannot safely represent. It never substitutes a guessed blue rectangle. Open-sea selections without intersecting coastline remain unresolved. Queries now include coastline ways and water relations; a cache query revision prevents reuse of earlier incomplete Overpass selections.

`fishermans-wharf-naip-regression.jpg` is a 900 × 900 north-up diagnostic crop from the same public-domain USDA NAIP raster 11934 used for Washington Square, acquired 20 May 2024. Its exact export request is in the manifest. Nominal source resolution is 0.60 m; exported local pixel spacing is 0.40 m and does not add source detail. The downloaded image and an overlay of imported buildings/coastal water were visually inspected. Derived water follows the harbor and open sea and excludes the pier sheds and mainland. Some piers and structures over water are not modeled by the current feature importer.

The conspicuous diagonal masses are real **Shed A** (OSM way 25372350) and **Shed B** (25372352), cut by the northern selection boundary. Their mapped heights are 9 m and 10 m. Their clipped plan areas are approximately 5,295.661 m² and 4,992.978 m²; the large axis-aligned envelopes reflect the diagonal orientation, not wall widths. The aerial agrees with their outlines. Actual Three.js meshes use flat roofs, remain within those envelopes, and retain the mapped heights. No evidence supported shrinking or deleting these buildings. `import.clipped` already identifies their selection cuts; those cuts are not asserted to be real exterior walls.

The fixed extraction contains 390 objects and has zero validation errors or spatial warnings. Real-source regressions check water coverage at harbor/open-sea points, absence of water at mainland/shed points, coastal provenance, unknown water elevation, and actual building mesh heights/envelopes. Synthetic topology tests reject unsafe water fills. Map-provider tests verify that both coastline ways and water relations are requested. Geometry is mapped evidence; water level, depth and navigability remain unknown. Flat-preview offsets/thicknesses are explicitly authored display conventions, not tidal or bathymetric measurements.

## Automatic terrain for selected areas (prompt 5)

New selections and explicit survey completion use the public [USGS 3DEP elevation ImageServer](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) within the conterminous-US coverage envelope, with the worldwide [Mapzen/Tilezen terrain archive on AWS](https://registry.opendata.aws/terrain-tiles/) as a whole-grid fallback. Neither requires an API key. These are external elevation datasets; no model synthesizes missing ground heights. The output uses the exact southwest local frame of the mapped objects, north-up row ordering, at most 65 × 65 samples, and a minimum 5 m grid interval.

USGS [getSamples](https://developers.arcgis.com/rest/services-reference/enterprise/get-samples/) returns source raster identities and resolutions. We request bilinear samples at explicit geographic positions and retain null for missing samples. The verified Wharf and Alamo Square responses both identify `CA_SanFrancisco_B23` at reported **1 m native resolution**. The [NOAA project metadata](https://www.fisheries.noaa.gov/inport/item/73506) establishes NAVD88 with GEOID18 for that dataset. Other service results carry a local-datum caveat rather than inheriting that project-specific identification; [USGS documents differing vertical datums](https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model). Retrieval dates are recorded separately from acquisition dates. The automatic service does not infer a capture date or local vertical accuracy from the response.

The global archive combines [multiple source products](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md), with variable native resolution, age, datum and occasional bathymetry. Its [Terrarium RGB format](https://github.com/tilezen/joerd/blob/master/docs/formats.md) encodes elevation in metres. Small served pixels do not imply a fine native DEM: format 0.5 therefore distinguishes optional known native `sourceResolution`, served raster `sampledResolution`, and output-grid `spacing`. The global path leaves native resolution, local datum and acquisition date unknown unless established. Its source record retains provider attribution and links to the [full credit register](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Values below zero remain negative; transparent/no-data pixels remain null.

The [live verification record](history/terrain-05-live.json) includes all four observed outcomes. The first Wharf request fell back to the global archive (4,225 samples, −10.277 to 5.866 m, unknown local datum). A later bounded verification returned complete USGS coverage (4,225 samples, **−1.070 to 6.847 m**, NAVD88/GEOID18), and the ordinary cache and real HTTP endpoint then returned that verified primary result. Alamo Square returned 676 USGS samples, 64.254–80.731 m. Paris returned 2,860 global samples, 28.464–44.390 m, at 3.143 m served pixel pitch; its native resolution and local datum remain unknown. These observations demonstrate those particular requests, not universal availability, accuracy or uptime.

Successful exact-bound requests are cached for seven days. A global fallback after a USGS failure is cached for five minutes so the primary source can recover. Retrieval is bounded by 75 seconds, at most five USGS batches or sixteen PNG tiles, fixed image dimensions and response byte limits. Cancellation reaches active requests. Partial no-data is retained, and completely absent coverage produces an error rather than a flat replacement. Cache failures do not fabricate data. Provider details, limits, attachment policies and tests are documented in [TERRAIN_IMPORT.md](TERRAIN_IMPORT.md).

Terrain is attached only after geographic alignment and document validation. Explicit completion preserves authored absolute placements; un-authored mapped objects follow the new terrain, and architectural child offsets are preserved across repeat attachments. Coastal water remains a flat authored rendering convention at datum zero with unknown measured tide level. It is never draped over bathymetry or described as measured sea level. Changing terrain datum or source can change the preview; this prototype is not an engineering elevation or flood-risk tool.
