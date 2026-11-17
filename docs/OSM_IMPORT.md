# OpenStreetMap import

`src/imports/osm.ts` is a pure converter. `convertOsmToWorld(response, options)` returns `{world, diagnostics}`; it never fetches data. `options.bounds` uses west/south/east/north degrees. An optional local `frame` preserves the existing Washington Square alignment. Default frames start at the southwest corner, x east/y north, with local ground metres derived from scaled Web Mercator. Each dimension must be 5–1000 m; date-line crossings and latitudes beyond ±85° are rejected.

The module also exports `geographicFrame`, `buildOverpassQuery`, `parseOsmLength`, and browser-only `parseOsmXml`. The XML parser rejects document types/entities and responses larger than 8 MiB. It drops contributor identities while retaining element IDs, tags, versions, edit timestamps and geometry. The network layer owns endpoint selection, cancellation, caching and request limits.

## What is recorded

- Individual closed building footprints, mapped building parts, simple single-ring relations, green-space/water areas, street and path centerline segments, tagged trees, and tagged entrances.
- Original OSM element IDs, a direct element URL, tags and supplied edit timestamps are retained as facts. A database timestamp is recorded when supplied; it is not a survey acquisition date.
- Explicit heights are converted to metres. Heights derived from levels use an inferred 3 m per level; otherwise the building mass fallback is an inferred 9 m. Missing levels remain unknown. Roof shapes, materials, lane counts, speeds and traffic direction are sourced only when usable mapped tags exist.
- An entrance is created only from an actual `entrance` node. Membership of that node in a building way supports its parent association. A symbolic entrance marker is not a measured door.
- Paths retain centerlines and shared OSM endpoint IDs. Clipped endpoints lose the corresponding node ID, so an outside source node is not falsely relocated to a crop boundary. Widths are inferred when not mapped. Restrictions and steps remain facts; connectivity does not promise access, safety or wheelchair suitability.
- Flat-preview surfaces use explicit authored offsets and 0.02 m thickness: green space/water starts at 0 m, paved areas at 0.04 m, roads at 0.06 m and paths at 0.08 m. This keeps mapped corridors visible through overlapping park polygons. `placement.surfaceOffset` and `placement.surfaceThickness` disclose the convention; they are not terrain measurements, curb heights or bridge clearance. The Washington Square baseline retains its separately authored terrain-relative surface stack.
- Parent outlines containing mapped building parts receive `building.isOutline=true`, following the [OSM Simple 3D Buildings convention](https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings). Parts remain separate; incomplete part coverage still requires review. No procedural geometry recipe is invented from missing data.

## Limits and diagnostics

The converter rejects responses with service error remarks instead of treating partial results as complete. It limits input to 20,000 elements and output to 1,000 objects. Complex multipolygons, courtyard holes, incomplete ways, invalid polygons and very large polygons are explicitly omitted; holes are never silently filled. Objects and route centerlines are clipped to the selected square. No terrain, floor elevations, bridge/tunnel heights or indoor circulation is invented. Counts describe imported records, not completeness of the real place.

## Service policies and attribution

All OSM-derived data carries **© OpenStreetMap contributors** and the **[Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/)**. Keep the attribution and license with exported data and follow the share-alike requirements for derived databases. [OSM copyright and attribution guidance](https://www.openstreetmap.org/copyright) is the primary reference. This dataset license is separate from the application's source-code license.

The [Overpass operator manual](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html) distinguishes occasional manual queries from using public servers as a general application backend. The local prototype uses explicit bounded requests, with caching and configurable providers; deployment needs a provider appropriate to expected use. The [OSM maintained instance list](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances) records Private.coffee's permission for general projects and asks large projects to contact the operator. An endpoint's current policy still governs its use. Do not evade throttling by cycling providers or retrying rapidly.

No public Nominatim search is built into this importer. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) prohibits autocomplete and generic automatically generated search services without an informed developer decision; it also specifies an application-wide maximum of one request per second, identification, caching and attribution. Coordinates or a map URL avoid an unnecessary geocoding dependency. A deployment can deliberately configure an appropriate geocoder.

## Washington Square reference

Two main Overpass requests returned capacity errors, and Private.coffee requests timed out. One bounded request to the official OSM map API succeeded. `public/reference/washington-square-osm.json` is a normalized subset of that real response, not a claimed Overpass response. The source URL, capture time, hashes and redaction are recorded in `washington-square-osm-manifest.json`. Public compressed XML has contributor `user` and `uid` attributes removed; geometric data, tags, versions and edit timestamps remain intact. The unmodified response exists only in the local temporary directory.

The baseline adds thirteen mapped park footways as 55 short segments, connected by 67 relations based solely on shared OSM nodes. All form one connected mapped network. A north-up overlay was visually checked against the NOAA 2022 image; paths follow the visible promenade and entry walks. The 2026 OSM extract and 2022 aerial have different dates. No tagged entrances were found, and no surrounding OSM buildings are merged into the hand-traced baseline. Existing buildings therefore retain their original IDs and interpretation.

## Local gateway and verification

`npm run dev` starts the UI and loopback companion; `npm run build` followed by `npm start` runs the built app with the same companion. `npm run preview` is a static preview only. The map gateway allows one active extraction, validates 5–1000 m bounds, caps responses at 8 MiB, and caches successful exact selections for 24 hours. A failed Overpass request can make one bounded request to the configured OSM map API; `WORDSCAPE_OSM_FALLBACK=off` disables this. There is no unbounded retry/provider rotation. Endpoint settings live in the companion environment, not request-controlled URLs.

The map selector uses ordinary interactive raster tiles and browser caching. The [OSMF tile policy](https://operations.osmfoundation.org/policies/tiles/) requires visible attribution, a valid browser Referer and caching; it prohibits bulk download and offline tile archives. Only normal visible-map requests are intended. The downloadable world is vector-derived data, not a tile archive. `WORDSCAPE_TILE_URL` allows a suitable alternate provider; update attribution and obey that provider's terms if it changes. Public service availability is not guaranteed.

Verification commands:

```powershell
npx vitest run src/imports/osm.test.ts src/data/washingtonSquareCirculation.test.ts src/world/savedWorld.test.ts
npm run test:server
```

The source tests cover measurement units versus inferred fallbacks, clipping and endpoint identity, mapped entrance association, conservative parent/part containment, omission diagnostics and safe XML rejection. The retained real extract is validated, and the baseline's 55 path segments are checked as one network through 67 genuine shared-node connections. Its image alignment was visually checked separately. XML parsing is browser-only; the parent browser workflow checks the official API fallback. Network tests use controlled transports; they do not establish public provider uptime or map completeness.
A Three.js regression also checks that actual imported path/road meshes rise above overlapping grass, water and paved-area meshes. This caught and fixed the initial flat-preview bug where taller park slabs hid the paths; source coordinates and mapped topology were unchanged.

## Coastal water

Marine water is derived separately from `natural=coastline` ways, with water on the right of their directed edges. The query now includes these ways and `natural=water` relations. Complete clipped coastlines and the selection edge form bounded faces; only consistently water-facing polygons are retained. Broken/contradictory topology, intersecting coastlines and enclosed island holes are diagnosed and omitted. Entirely offshore selections without an intersecting coast are not guessed from location alone.

`water.kind=coastal` and `osm.coastlineWays` identify the source interpretation. `water.surfaceElevation=null` records the missing level measurement. The mean high-water boundary is not an instantaneous sea surface or depth survey. Any flat water rendering level must remain an explicit authored convention, particularly when terrain or bathymetry is later attached. The Wharf fixture and aerial/mesh verification are documented in [SOURCES.md](SOURCES.md).

For terrain integration, coastal water additionally records `water.renderLevel=0 m` with **authored** evidence: a flat visualization convention in whichever terrain datum is attached. It does not claim zero tide height or datum equivalence. The unknown `water.surfaceElevation` is retained. Terrain attachment converts this display level using the recorded reference elevation once and does not drape the ocean over bathymetry.
