# Automatic terrain for selected areas

`POST /api/terrain/extract` accepts `{bounds:{west,south,east,north}}` through the companion's existing origin/token boundary. Selections use the same 5–1,000 m limits as map extraction. The result contains `{bounds,frame,terrain,source,diagnostics,cached,cachedAt}`. `frame` matches the OSM converter's southwest origin, rounded dimensions and scaled Web Mercator coordinates. Grid nodes run west→east, then south→north. A final edge row/column can extend less than one interval beyond the rounded world bounds so interpolation covers the entire selection.

## Sources and quality

Within the conterminous-US coverage envelope, the service first requests [USGS 3DEP](https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer) elevation. The [getSamples operation](https://developers.arcgis.com/rest/services-reference/enterprise/get-samples/) accepts explicit sample positions and returns raster identity and resolution. We use bilinear interpolation, at most 900 points per batch and two simultaneous batches. Returned location IDs determine the grid position; response order is irrelevant. Missing and nonnumeric values remain null. Partial USGS coverage is retained without inserting values from another provider.

The SF checks returned `CA_SanFrancisco_B23`, also used by the retained Washington Square DEM. Its [project metadata](https://www.fisheries.noaa.gov/inport/item/73506) establishes NAVD88/GEOID18. Other results carry an explicit local-datum verification caveat: USGS explains that [vertical datums vary outside CONUS](https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model). The automatic service does not claim universal NAVD88. Access dates are retrieval dates; acquisition dates and vertical accuracy are omitted when not established.

Outside that envelope, or if the complete USGS request fails or has no coverage, the whole grid comes from the worldwide [Mapzen/Tilezen archive on AWS](https://registry.opendata.aws/terrain-tiles/). No API key is required. [Terrarium encoding](https://github.com/tilezen/joerd/blob/master/docs/formats.md) stores metres as `R*256 + G + B/256 - 32768`. PNG dimensions are checked before bounded decoding. Pixel-centred bilinear interpolation spans tile edges. Transparent/no-data pixels remain null; negative bathymetric heights remain negative.

The global archive combines [several DEM products and native resolutions](https://github.com/tilezen/joerd/blob/master/docs/data-sources.md). Format 0.5 keeps known native resolution in optional `sourceResolution`; `sampledResolution` is served raster pixel pitch, and `terrain.spacing` is the output grid interval. These are different quantities. Unknown local native resolution, datum and capture date are explicitly left unknown. Source records retain attribution and the [provider credit register](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

## Resource limits and failure behavior

The grid has at most 65×65 nodes and spacing of at least 5 m. USGS needs at most five batches. The global path requests at most sixteen 256×256 tiles with three concurrent requests. Responses are capped at 2 MiB each and the whole operation at 75 seconds. Only one extraction runs per service. Cancellation reaches active fetches and stops queued work. Completely missing coverage returns an error, never a synthetic zero-height grid.

Successful exact selections are cached for seven days. A global fallback after USGS failure is cached for five minutes so a later request can recover the primary data. Cache failures are nonfatal. Provider URLs are local environment configuration, never request parameters: `WORDSCAPE_USGS_TERRAIN_URL`, `WORDSCAPE_USGS_TERRAIN=off`, `WORDSCAPE_TERRARIUM_URL`, and `WORDSCAPE_TERRARIUM_MIRROR_URL`. The AWS replica can supply the same archive after a transport failure. No account or model endpoint is used for elevation.

## Reviewable attachment

`attachTerrain(world, extraction, {groundObjects:false})` checks exact geographic alignment, source identity and grid coverage, clones the document and validates the result. It never changes storage. Default behavior preserves placement fields. A conflicting source ID receives a fresh ID instead of overwriting prior provenance.

Explicit `groundObjects:true` rebases only un-authored `osm-extract` placements and retains their prior elevation offsets. Buildings and solid landmarks use the highest covered footprint point; other objects use their centre. Architectural children use a resolved parent base plus the prior relative offset. If the parent base is unknown, only the child's own terrain coverage can resolve it. Authored absolute placements remain unchanged. Existing terrain-grounded placements continue to follow terrain.

A numeric authored `water.renderLevel` keeps a water object flat in the grid's vertical datum, regardless of source ID. Coastal zero is a disclosed rendering convention, not a measured tide or a claim that NAVD88 equals sea level. Unknown `water.surfaceElevation` facts remain unknown. Water is not draped over bathymetry, and its existing thin render offset is preserved.

## Verification

[Live records](history/terrain-05-live.json) preserve bounds, source identity, grid settings and coverage. Alamo Square returned 676 USGS samples at reported 1 m native resolution, ranging 64.254–80.731 m. Paris returned 2,860 global samples, ranging 28.464–44.390 m, with 3.143 m served pixel pitch and unknown native resolution. The first Wharf request used the global fallback; a fresh bounded verification returned all 4,225 USGS samples, ranging −1.070–6.847 m. Both outcomes are retained. The ordinary exact-selection cache now contains the verified primary result; the real HTTP route returned it successfully.

Tests cover frame alignment, north-up ordering, PNG decoding, no-data, native versus sampled resolution, cache/fallback, bounded bytes, cancellation, queue stopping, preservation of authored placements, parent/child offsets, flat water, source identity and HTTP origin/token controls. Live checks establish only the observed responses, not worldwide completeness or provider uptime.
