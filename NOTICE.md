# Code, data and imagery notices

Original Wordscape code, schema and documentation are offered under the [MIT license](LICENSE). This permission does not relicense third-party data, imagery, dependency code or trademarks. The application is an independent experimental project; provider names do not imply endorsement.

## Real-world data

OpenStreetMap source extracts and derivative map databases, including the ten reference Wordscapes, retain **© OpenStreetMap contributors** and the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve the source records, attribution and applicable share-alike obligations when distributing those datasets. See [OSM copyright guidance](https://www.openstreetmap.org/copyright), [source documentation](docs/SOURCES.md), [import limits](docs/OSM_IMPORT.md) and the per-file manifests. They are not relicensed as MIT merely because they accompany the code.

The Washington Square specimen combines authored interpretation, official public records, US aerial/terrain references and OSM-derived additions. Its individual facts and sources distinguish those origins. Building colours newly supplied for the perimeter are explicitly authored choices, not extracted photographs or verified material observations.

Generated examples retain their actual model/provider and any map-inspiration provenance. No claim is made that an output receiving source geometry is free of the source's applicable obligations. The minimal authored example contains no geographic source data. Always inspect the source records for the file you redistribute.

## Imagery and terrain

Bundled aerials, elevation grids and reference diagrams retain the provider notices and acquisition information in [SOURCES](docs/SOURCES.md), [TERRAIN_IMPORT](docs/TERRAIN_IMPORT.md) and `public/reference/`. US government public-domain material and third-party imagery are distinguished there. An online aerial reference is a link to a service, not a redistribution license for its image pixels. Wordscape does not package or extract Google 3D geometry or textures. User-provided comparison screenshots in build history are evidence, not application assets or reusable source imagery; account-bearing screenshots are withheld from the public snapshot as explained in the publication notes.

## Dependencies

Dependencies retain their own licenses. The lockfile pins the supplied versions; `node_modules/<package>/LICENSE*` after `npm ci` contains their upstream notices. DM Sans font files retain their upstream font license. Dependencies and browser/renderer assets are excluded from the advertised world-document byte counts.

## Build history

The prompt ledger and readable conversation exports document this challenge build. Personal account UI has been withheld where stated; original sessions and attachments are retained privately for verification. This is not permission to reuse private verification material or third-party screenshots under the code license.
