# Wordscape format 0.8

Wordscape is UTF-8 JSON describing a small, bounded world in metres. The document is the source of truth: text edits and visual edits update the same object data. It supports declarative shape recipes, but contains no binary meshes, scripts, textures, credentials, or executable instructions. The machine-readable structural specification is [`public/wordscape.schema.json`](../public/wordscape.schema.json); TypeScript types are in [`src/world/types.ts`](../src/world/types.ts).

Version 0.2 added placement containers, typed facts with evidence, object-level reference links, and the `fixture` kind. Version 0.3 added sourced terrain and explicit grounding. Version 0.4 added bounded geometry recipes. Version 0.5 added online aerial references and separated known native DEM resolution from served raster pixel pitch. Version 0.6 added optional geographic survey compositions. Version 0.7 added an explicit imaginary-world marker. Version 0.8 adds explicit terrain evidence (`authored` or `sourced`); an absent legacy field remains unspecified, never implicitly authored. Legacy versions 0.1–0.7 remain readable and serializable with their original fields and versions unchanged. `migrateWorld(world)` explicitly returns a validated, independent 0.8 copy without inventing facts, parents, sources, terrain, grounding modes, recipes, aerial references or composition records. Container/fact fields and fixture objects require version 0.2 or later; terrain and grounding fields require 0.3 or later; recipes require 0.4 or later; aerial references and sampled terrain resolution require 0.5 or later. Unsupported future versions are rejected. Migration preserves edited placements and does not automatically attach the latest survey terrain or replace a saved world.

## Imaginary worlds and model proposals

Format 0.7 optionally records `imaginary: {brief, guideVersion}`. The brief is the submitted text (empty is allowed), and the guide version identifies the advisory layout study. Such a document uses `origin.latitude = 0` and `origin.longitude = 0` only as a numeric placeholder; it is not a location in the Gulf of Guinea. `inferSurveyBounds` returns no geographic extent, and geographic aerial references and survey compositions are prohibited. Ordinary object/byte caps still apply. Migrating an older real survey does not add the imaginary marker.

`prepareWorldGeneration(request)` validates and independently snapshots a request (abbreviated here) `{provider, model?, mode:'create'|'revise', prompt?, size?, world?}` request. Creation defaults to 360 m; 180 and 720 m are the other supported sizes. Revision requires the existing document and preserves its bounds. `reviewWorldGeneration(request,result)` validates the returned proposal again in the browser and produces review fields including `{world,warnings,addedIds,changedIds}` without changing the original. `applyWorldGeneration(currentWorld,request,result)` revalidates and rejects revision if any part of its original document changed meanwhile. The UI also invalidates creation previews when their starting world changes.

The strict model response contains a summary, name, description, additions, changes and relations. Creation needs 20–60 placements and no changes; revision permits up to 60 additions and 12 description/recipe changes, with at least one operation. All addition fields are bounded, complete and authored. Footprint envelopes must remain inside the document even after rotation. Recipes use the existing non-executable geometry contract. Unknown fact values become null/unknown; generated facts cannot invent source links or replace existing facts. Existing objects retain all fields except explicitly proposed descriptions and geometry; changed descriptions are prefixed as authored model interpretations. Existing sources, relations, aerial/composition records and plan placements remain intact. Terrain and vertical grounding also remain intact unless the explicit imaginary terrain-authoring operation below is enabled. New placements on an existing terrain follow that terrain; missing coverage rejects the addition. New water is an authored flat surface requiring shoreline/height review, not measured hydrology.

Explicit model relations are checked against actual IDs. If omitted, the helper adds a small nearest-centre `near` graph labelled as authored proximity, never as guaranteed connectivity or access. Building overlaps remain review warnings; generation is not asserted to be collision-free. Models may fail strict validation and return no preview; there is no hidden preset fallback or automatic paid-provider switch.

The complete existing document is sent only to the local companion for validation. Model context contains the name, bounds and up to 160 deterministically spread object summaries, capped at 120 KiB: descriptions are shortened, facts are limited to twelve, and footprints over sixteen vertices are explicitly marked as simplified. Model context additionally includes resolved object base heights and, when terrain exists, a coarse 9 × 9 height summary with datum/reference/provenance information. Full terrain grids, source records and linked references remain excluded; linked content is not fetched. The final prompt, including the versioned layout study, is capped at 200 KiB. Included/omitted counts are validated against the request and disclosed for review. `src/data/layoutGuide.json` distinguishes small-sample observations from authored design advice; it is neither model training nor universal planning rules. Generated worlds carry the guide attribution separately from their fictional placements.

### Reference-guided proposals (application 0.8)

This application-0.8 addition used the existing format-0.7 geometry capabilities; these remain supported in current format 0.8. Generation requests additionally accept `layout: 'contextual' | 'clustered' | 'planned' | 'open'` and optional `referenceIds`. Omit IDs for automatic deterministic brief/tag selection; use `[]` for no examples or one/two known unique IDs for manual selection. Unknown, duplicate or excessive IDs reject. The server supplies the actual selected IDs and layout in its result; the model cannot invent reference sources. The browser validates those against the request. Existing legacy results without these fields remain replayable. When replaying an earlier automatic selection after selector changes, explicitly use the result's recorded reference IDs to reproduce that context.

`src/data/layoutExamples.json` contains ten bounded geometry contexts and full-world statistics, with source crop hashes, attribution and links to complete importable Wordscapes. Two selected excerpts fit inside the existing 200 KiB aggregate prompt cap. Context polygon vertices use cluster-local coordinates; generated `footprint` vertices instead use the document's existing object-local offsets, before rotation. New model additions require `footprint: null` for the regular envelope or a simple polygon of 3–16 points within ±half width/depth. Legacy additions may omit it. Shared validation checks the polygon, transformed world bounds and geometry recipe. No format field or executable geometry was added.

Used references become separately attributed inspiration source records, with authored provenance. Revision retains existing evidence and appends these records rather than rewriting citations. Complete reference worlds, images and source URL contents are not sent to the model or fetched by it. See [reference construction and omissions](LAYOUT_EXAMPLES.md).

`describeWorldLayout` calculates summed declared polygon area (not a union or mesh silhouette), nearest polygon-edge gap distribution, and descriptive envelope/route orientation bins. Suppressed outline containers are excluded; at most 128 deterministic building anchors are sampled against all neighbors. Recorded centerlines are used only when finite, bounded and compatible with the current footprint; otherwise route length/orientation is explicitly an envelope estimate. These are not quality, completeness, connectivity or accessibility scores.

## Adjacent surveys and compositions

For authored terrain creation and revision, see the next section. Survey composition keeps its separate sourced-datum requirements.

### Authored terrain (format 0.8, application 0.9)

`terrain.evidence` is optional and may be `authored` or `sourced` in format 0.8. Earlier documents remain readable and unchanged; migration does not invent this field. The serialized terrain remains an ordinary `height-grid`, so another interpreter need not understand the author's construction recipe to render it.

The model request may enable `terrainMode:'author'`; omitted/`preserve` keeps legacy behavior. The creation UI enables authoring by default, with an explicit flat-ground option. Revision starts in preserve mode and requires an eligible imaginary world: no geographic imagery/composition, no unmarked/sourced terrain, and no terrain-dependent object in a protected hierarchy (including an authored terrain-dependent child under a non-authored parent). Absolute protected descendants are retained unchanged. Unsupported revisions reject before provider contact. Terrain-only revision may have empty addition/change/relation arrays.

The model returns `terrain: {type:'analytic-heightfield',version:1,evidence:'authored',baseElevation,features}`. At most eight elliptical hills/basins have normalized `x/y` in [0,1], normalized radii in [0.08,1.5], metre height in [−150,300] and CCW rotation in [−180,180]. Base elevation is [−100,100] m. A feature contributes `height × (1 − u² − v²)²` inside its rotated ellipse and zero outside. Combined sampled heights must stay within [−200,500] m. This is declarative data, never executed model code.

The deterministic interpreter samples square-pitch grid spacing `max(width,depth)/32`, with enough rows/columns to cover the complete bounds (33 × 33 for square worlds). Heights are rounded to millimetres for serialization; this is authoring precision, not survey accuracy. The output uses an explicitly authored local datum and reference elevation zero; the recipe and provider/model provenance remain in an appended source record. No acquisition date, DEM resolution or measured accuracy is invented.

On opted-in revision, eligible authored root objects follow the new ground while retaining their previous ground offsets. Upright buildings/landmarks use the highest-footprint anchor by default; existing explicit anchors are retained; absolute architectural children move by their parent's physical height delta. Plan positions, dimensions, facts, descriptions and shapes remain unchanged unless separately proposed by an allowed operation. Water keeps its flat physical local level rather than draping. Protected objects are not silently moved. Review reports `terrainChanged`, `regroundedIds`, and preserved grounding IDs. Apply remains explicit, stale-checked and undoable. Slopes, foundation infill, access and shorelines still require inspection; decorative mountain objects from earlier outputs are not automatically removed.

### Geographic survey composition

`adjacentBounds(bounds, 'north' | 'east' | 'south' | 'west')` returns a neighboring rectangle with the same Web Mercator spans and an exact shared geographic edge. North/south movement uses projected northing rather than adding latitude degrees. Date-line wrapping and extension beyond ±85° are rejected. A neighbor remains a separate ordinary survey; normal provider/import bounds and resource limits apply.

`combineSurveyWorlds(worlds, {name?})` returns `{world, warnings, stats}` for two to four ordinary survey snapshots. Statistics record input tiles/objects, retained objects, consolidated duplicates and clipped fragments. Inputs must have a recorded geographic frame consistent with their local dimensions, be at most 1 km each, share cardinal edges as one connected area, and have no positive-area overlap. The union must fit within 2 km on each axis. Corner-only contact, nested compositions, unknown frames, and conflicting copied extents reject before producing a proposal. The original documents are never changed. The manually traced Washington Square specimen is recognized only when its exact southwest origin and 360 m dimensions match the retained georeferencing record and its NAIP source retains the verified service, raster and image tags. Renamed or edited copies keep all content; a changed frame or unrelated source is not guessed from the world name.

The returned world is a normal flat document. A common scaled Web Mercator frame places all objects in metres from the union's southwest origin. Plan positions, extents and local footprints receive uniform horizontal scaling and translation; rotation, heights, measured metric facts and normalized recipes are retained. `path.centerline` is the importer's known coordinate-valued fact and is transformed explicitly. Raw OSM node/way/segment identities, bearings, recorded widths and vertical facts retain their original meanings. Geographic roundoff and the importer's millimetre-rounded frame edges can differ by submillimetre amounts.

Optional `composition: {type:'survey-atlas', tiles:[...]}` records two to four source tiles. Each tile has `id`, original `name`, authored `description`, `seed`, geographic `bounds`, and its remapped `sourceIds`. Object/source IDs receive stable `tile1:`, `tile2:` namespaces in supplied tile order; long IDs use a bounded deterministic suffix. Identical source records may be shared, while different URL, attribution, title, date or notes remain distinct. Every object source, fact source, reference, parent and relation endpoint is remapped. Container packets retain composition source records as well as their normal object/terrain evidence.

Only un-authored, unclipped mapped objects with matching source identity and equivalent transformed content at millimetre precision are consolidated. Containers and children are retained independently. Consolidation combines source links and never discards differing facts or authored variants. Synthetic coastal-water IDs are per-extract identities and are never deduplication keys. `import.clipped` and `import.centerlineClipped` fragments remain separate with explicit diagnostics; matching source IDs do not justify guessing a polygon union. Selection cuts are not real exterior walls, and clipped neighboring building roofs can retain steps.

All inputs must either have terrain or all be flat. Terrain grids must state the same established vertical datum; mixed, unknown or unverified datum declarations reject rather than being silently flattened or averaged. The two exact verified SF labels `NAVD88 (GEOID18)` and `NAVD88 (CA_SanFrancisco_B23; GEOID18)` are accepted aliases, with original labels retained in provenance notes. No broader NAVD88 realization equivalence is inferred. A common grid uses bilinear resampling near the coarsest transformed input spacing, fitted to an integral number of intervals on the longest side and bounded to 257 × 257 samples. Millimetre frame-rounding tolerance is applied only at source grid boundaries.

Unsurveyed areas, including an L-shaped composition's missing quadrant, and missing source samples stay null. Every output interpolation cell is checked against intersected input cells and source coverage; if any source portion is unknown, all four output vertices are null. This prevents a coarse grid's valid corners from concealing a small source hole. It can conservatively widen an unknown gap by up to two output intervals, which is disclosed in diagnostics. At an exactly shared sampled edge, the first listed tile takes priority; discrepancies above 5 cm produce a diagnostic. Resampling does not increase native detail or establish new accuracy.

The combined grid retains absolute datum heights and uses one render reference. Absolute object bases receive the difference between the original and combined references. Buildings and solid landmarks retain terrain grounding and their original authored `elevation` offset. Where both source and derived anchors resolve, separate optional `terrainCorrection` compensates for resampling so the physical base and architectural child offsets stay fixed. Missing derived coverage stays unresolved. Flat comparison excludes this derived correction and uses the original elevation offset; absolute architectural children retain their terrain-ancestor flattening behavior. Corrections above 5 cm are reported, including their maximum magnitude. A coarser grid can lose small peaks, so retaining a physical base does not restore missing terrain detail. Ground surfaces continue to drape over the derived grid. Native/sample resolution fields are carried only when all inputs establish them, using the coarsest value. Original source records and URLs remain in the document. A retained online aerial reference is expanded to the combined geographic bounds; image pixels are still external.

`terrainCorrection` is permitted in 0.6 or later, only on terrain-grounded building or landmark solids, and must be finite within ±200,000 m. Physical base is `anchor − referenceElevation + elevation + terrainCorrection`; flat base remains `elevation`. Renaming, editing facts, or raising the authored offset preserves the correction. An explicit move, rotation, footprint-envelope resize, grounding/anchor change or kind change clears it, because the old resampling alignment no longer describes the new placement. Moved descendants clear their own correction and retain rigid physical offsets. Container duplication uses the same placement rules. It is derived composition data, not an observed terrain height, an authored lift, or a correction applied to draped road/grass surfaces.

Only format 0.6 or later documents with valid composition metadata gain the atlas budgets: 4,000 objects, 400 sources, 16,000 relations and 16 MiB input/compact UTF-8 content. Ordinary documents keep 1,000 objects, 100 sources, 4,000 relations and 4 MiB. `getWorldLimits(world)` exposes those limits for UI boundaries; runtime validation still checks composition fields and source integrity. Terrain, fact, footprint and per-field caps do not increase. The composition can be edited, saved, exported and rendered through the same document/scene interfaces.

## Coordinates and geometry

The world rectangle runs from `(0, 0)` at its southwest corner to `(bounds.width, bounds.depth)` at its northeast corner. `x` increases east; `y` increases north. `origin` describes the approximate geographic position of that southwest corner. It is contextual metadata; converting geodetic coordinates to this local metre plane remains an importer's responsibility.

An object's `(x, y)` is its centre. `width` and `depth` describe its local east-west and north-south dimensions before rotation. `rotation` is degrees counterclockwise, viewed from above. By default, `elevation` is the base height above the local reference plane; explicit terrain grounding makes it an offset above the ground anchor. `height` always means the object's vertical extent and is never a terrain elevation. `layer` is an integer drawing-order hint: higher layers appear above lower layers in a plan. Layers do not cancel physical intersections; overlap checks use resolved physical base heights.

`footprint`, when present, is an unclosed, simple polygon of local `[x, y]` offsets relative to the object's centre. Three to 256 vertices are allowed, in either winding order, without holes. It takes precedence over width/depth for the ground outline. Move the object by changing `x` and `y`; local vertices stay unchanged. `getFootprint(object)` returns new absolute, rotated vertices. Without a custom footprint, objects use a rectangle; tree canopies use a 16-vertex ellipse. A renderer can extrude that outline from elevation through elevation + height. SVG flips the northing axis; a Three.js adapter can map plan `(x, y)` and elevation to scene `(x, elevation, -y)`.

## Portable geometry recipes

An optional `geometry` on any object replaces its category's default 3D shape. Omit it to retain the existing fact-driven building, tree, surface, or fixture adapter. A recipe is editable document data and can be composed by a person, a template, or a language model. It cannot run code or fetch assets. This format is additive: parts may intersect, but it has no Boolean subtraction, animation, shaders, resource URLs, or external mesh references.

```json
{
  "type": "parts",
  "version": 1,
  "space": "normalized-object",
  "evidence": "authored",
  "parts": [
    {
      "id": "plinth",
      "label": "Stone plinth",
      "primitive": "cylinder",
      "position": [0, 0.1, 0],
      "rotation": [0, 0, 0],
      "dimensions": [0.7, 0.2, 0.7],
      "color": "#c6c0ae",
      "footprint": null
    },
    {
      "id": "orb",
      "label": "Copper orb",
      "primitive": "sphere",
      "position": [0, 0.5, 0],
      "rotation": [0, 0, 0],
      "dimensions": [0.6, 0.6, 0.6],
      "color": "#bd865c",
      "footprint": null
    }
  ]
}
```

The normalized object envelope uses `[east, up, north]`: horizontal coordinates span −0.5 through 0.5 and vertical coordinates span 0 through 1. Each primitive starts centred on the origin in a unit cube. Boxes fill the cube; cylinders and cones have vertical axes and radius 0.5; spheres have radius 0.5. Nonuniform dimensions produce elliptical cross sections and ellipsoids. Part dimensions must be finite fractions from 0.001 through 1. A part's transform scales the unit primitive by `dimensions`, applies coordinate rotations about X, then Y, then Z, and adds `position`. Angles are degrees from −180 through 180. The adapter then multiplies east/up/north by the object's width/height/depth, applies the object's plan rotation, and places it at its resolved base. Part rotations are performed in normalized space: resizing the object can stretch the composed shape and change apparent angles. The shared `transformGeometryPoint` defines this order for other adapters.

`extruded-polygon` uses a simple 3–16 vertex part-local `[east, north]` outline within ±0.5, extruded vertically from −0.5 to 0.5 before the part transform. There are no holes. All other primitives require `footprint: null`. Every recipe and part field shown above is required; unknown fields are rejected. IDs are unique within the recipe and contain 1–64 identifier characters. Labels are plain text of 1–120 characters. Colors are six-digit hex strings. Recipes contain 1–32 parts and adapters use fixed bounded primitive tessellation; the recipe cannot request arbitrary subdivision counts.

`validateGeometryRecipe(value, object?)` enforces the data contract and transformed bounds. Each transformed part's conservative unit-cube bounds must remain inside the normalized envelope. When the object has a traced footprint, the projected bounding rectangle must also fit completely inside that local metre polygon, including its concavities. This deliberate conservative check can reject a sphere or rotated shape whose actual surface would fit. It prevents authored detail from protruding beyond the recorded footprint without expensive Boolean clipping. An object's height must be positive when it has a recipe. Changing object dimensions may invalidate containment against an unchanged traced footprint; such an edit rejects atomically rather than silently clipping or moving parts.

The standalone structural schema is [`src/world/geometryRecipe.schema.json`](../src/world/geometryRecipe.schema.json), also embedded in the document schema. The same pure validator runs in the browser and local generation service. JSON Schema checks structure; transformed bounds, simple polygons, duplicate IDs, and traced containment additionally require the validator. A structured model response does not bypass those checks.

Recipe evidence is always `authored`. It never promotes object placement, facts, or source references to verified evidence. The Three adapter preserves the complete recipe on the object's GLB metadata and adds each named part's recipe record and authored status to the corresponding mesh. A custom shape stays rigid and upright at the shared terrain anchor; category-based draping is disabled for that shape. Building foundation infill remains an explicitly inferred adapter detail. Flat comparison affects display only; GLB export retains recorded terrain. Flat object hierarchy and absolute coordinates apply unchanged.

`createGeometryTemplate('bench' | 'pavilion' | 'sculpture')` returns independent `{ label, kind, width, depth, height, geometry }` data. These examples are normal recipes, so the same editor or generator can alter their parts or replace them with a new composition. They require no model downloads and imply no claim that the example exists at a real surveyed location.

## Objects, evidence, and relationships

Kinds are `grass`, `pavement`, `road`, `building`, `water`, `tree`, `landmark`, and `fixture` (street furniture and similar details). Labels and descriptions communicate meaning, while geometry communicates placement. IDs are stable ASCII identifiers containing letters, digits, `_`, `.`, `:`, or `-`, starting with a letter or digit. Object IDs and source IDs are unique within their own namespaces.

`evidence` is `observed`, `inferred`, or `authored`. An optional `sourceId` points to a record in `sources`; sources retain a title, an optional HTTP(S) URL, attribution, access date text, and notes. An evidence label expresses the author's confidence and is not a verification claim by the renderer. A source URL is data and is never automatically fetched.

Relations connect existing object IDs using `near`, `within`, `connects`, or `overlaps`, with an optional note. They are descriptive assertions, not layout constraints: moving an object does not automatically reposition related objects. Array order is preserved. `seed` is a nonnegative 32-bit integer reserved for reproducible procedural interpretation.

## Terrain, datum, and grounding

The optional `terrain` record is a regular `height-grid`: `columns`, `rows`, uniform metre `spacing`, local southwest `origin: { x, y }`, and a flat `heights` array. Node `[column, row]` is at `(origin.x + column * spacing, origin.y + row * spacing)`; its value is `heights[row * columns + column]`. Rows run south to north and columns west to east. Values are absolute metre elevations in the stated `verticalDatum`. The grid may cover part or all of the world and may extend beyond it.

`sourceId` points to the terrain's provenance record. `sourceResolution` records a known native DEM resolution separately from the document's sampling spacing; a 1 m source sampled every 5 m remains a 5 m document grid. In version 0.5 this field may be omitted when native resolution is unknown, as with a mixed-source elevation mosaic. Optional `sampledResolution` records the ground pixel pitch of the served raster used to sample elevations. It is neither a native-resolution nor an accuracy claim. Both fields, when present, are positive metres. Older 0.3/0.4 terrain records still require `sourceResolution` and do not accept `sampledResolution`. Optional `acquired: { start, end }` records an inclusive capture interval using valid `YYYY-MM-DD` dates. `verticalAccuracy`, when present, is metre accuracy supported for this grid; omit it when unknown rather than transferring a project-wide accuracy claim to a resampled local grid. `notes` records processing and limitations, including uncertain vertical datums.

`referenceElevation` is one stable local display origin in the same vertical datum. Keep source heights unchanged: local ground height equals `source height − referenceElevation`. This datum subtraction happens once. It does not alter object height or imply a measurement of foundations.

`interpolation` is `bilinear`. `sampleTerrain(world, x, y)` returns absolute datum metres, or `undefined` outside the grid, without terrain, or when a contributing sample is `null`. Null means missing data and never becomes zero. A null corner with exactly zero interpolation weight does not invalidate a known node or edge. Sampling does not extrapolate outside coverage.

Object grounding is explicit:

- Absent or `grounding: "absolute"`: `elevation` remains its legacy local base height, even when terrain is present.
- `grounding: "terrain"`: `elevation` is a metre offset above the selected terrain anchor. Resolved local base is `anchor height − referenceElevation + elevation`, plus a 0.6 solid's optional derived `terrainCorrection`.
- `terrainAnchor: "center"` (default): use the centre sample.
- `terrainAnchor: "highest-footprint"`: use the highest sampled height beneath the rotated footprint. This policy is available only with terrain grounding.

`getFootprintTerrain` evaluates footprint vertices, its centre when inside the polygon, internal grid nodes, edge/grid-line crossings, and intervening edge midpoints. Within each grid cell, a bilinear surface along an oblique footprint edge is quadratic; the helper also evaluates any interior stationary point so an edge ridge is not missed between samples. It reports absolute-datum min/max and an unweighted mean of evaluated known points. `sampleCount` includes every evaluated position; `missingCount` counts the unknown subset. These are extrema of the interpolated grid, not a measured foundation survey or a guarantee about unsampled real terrain. The geometry helper respects concave footprints and rotations instead of sampling an enclosing rectangle.

`getObjectBaseElevation` returns the resolved local base. A highest-footprint anchor requires complete sampled coverage; a missing centre or incomplete highest-anchor coverage returns `undefined`. Validation warns, and renderers must visibly identify or omit unresolved grounded placements instead of placing them at an invented zero. Architectural children may explicitly use absolute local bases matched to a parent's resolved base; hierarchy itself never implies additional inherited transforms.

## Online aerial references

Version 0.5 may retain a geographic reference without embedding imagery pixels:

```json
{
  "type": "online-imagery",
  "provider": "usgs-imagery",
  "bounds": { "west": -122.41868, "south": 37.8068, "east": -122.41459, "north": 37.81003 },
  "sourceId": "usgs-online-imagery"
}
```

This optional `world.aerial` describes the complete local world rectangle. Its southwest corner corresponds to `(0, 0)` and its northeast corner to `(bounds.width, bounds.depth)`. Interpolation is linear in EPSG:3857 Web Mercator coordinates, followed by inverse projection to geographic latitude/longitude. It is not linear in latitude. Longitudes are between −180 and 180 and latitudes between −85 and 85; bounds must be ordered without crossing the date line. The source ID must resolve. This explicit mapping does not replace the contextual `world.origin` or move any object.

The provider is an allowlisted identifier, not a user-supplied tile URL. The adapter displays [USGS Imagery Only](https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer) overview tiles and requests bounded [USDA NAIP](https://apps.geo.fpac.usda.gov/geo-imagery/rest/services/naip/conus_naip/ImageServer) detail for settled views in the conterminous United States. Native resolution, coverage, and capture dates vary; the service's current display is not a guaranteed dated snapshot. Elsewhere the overview is coarse. Zooming beyond source detail does not add spatial information. Detail requests time out after 15 seconds and retain an available overview rather than loading indefinitely. Missing imagery is reported, and a separate OpenStreetMap street layer is available; street cartography is not presented as an aerial photograph.

The application shows USGS/USDA attribution and links to [USGS terms and credits](https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map). [USDA identifies its aerial imagery as public domain](https://www.fpacbc.usda.gov/geospatial-services/customer-services). The overview service describes licensed SPOT imagery in Alaska for online viewing, so the reference does not grant blanket redistribution rights. Esri World Imagery is not used merely because its endpoint is public: its subscription/license terms differ. No imagery is harvested, stitched into an offline collection, placed in JSON, or baked into GLB by this adapter. A saved document retains only the provider, georeference, and source metadata and needs a network connection to view these pixels again. The existing bundled Washington Square reference images remain separate fixed local resources.

`inferSurveyBounds(world)` is a pure compatibility helper. It returns an existing aerial extent or reconstructs a prior OSM import's explicitly recorded Mercator frame. Its fallback accepts a source `bbox` only when the southwest origin and local dimensions match. It does not infer coordinates from an arbitrary approximate origin or replace a saved document. `attachAerialReference(world, bounds, accessed?)` explicitly adds the reference and a reusable source record to a validated independent 0.5 copy. Existing objects, facts, recipes, terrain, and relationships remain intact. Container exports retain the complete geographic frame and aerial source even when no contained placement cites it directly.

## Placement containers

Any placement may contain other placements: a child's optional `parentId` names its parent object. The document keeps a flat `objects` array, and every object's x/y position and rotation remain absolute world values. The grounding policy resolves elevation into a local world base. This avoids parent-relative transforms and lets renderers inspect independent placements. Parent links must resolve, cannot refer to the object itself, and cannot form cycles. A parent implies ownership, not a requirement that child geometry fit inside the parent's footprint.

Use `updateObject` for edits. Translation, counterclockwise rotation about the old parent's centre, and resolved base changes propagate rigidly to all descendants exactly once. For simultaneous rotation and translation, a child is rotated around the original root and then placed relative to the new root. Terrain-grounded child offsets are recalculated to preserve physical parent/child height relationships on a new slope; absolute child bases move by the same vertical delta. Missing coverage needed for this conversion rejects the entire container move. Descendant widths, depths, heights, and local footprints stay unchanged. Resizing a container never scales or moves children's x/y positions; if a highest-footprint resize changes the parent's base, children receive that vertical shift. Reparenting keeps placement unchanged. Changed placements become `authored`; fact evidence and source records remain intact. Invalid results reject atomically without changing the input document.

`removeObject` deletes the complete subtree and any relation touching a removed ID. `duplicateObject` creates an independent copy of the whole subtree, moves it ten metres east and north, marks copied placements authored, and returns its new root ID. Internal parent and relation endpoints are remapped; the root keeps its external parent, and relations to external objects keep their external endpoint. Facts and reference data are copied independently; source records remain shared by ID. Copies obey object and relation limits. Out-of-bounds positions remain warnings, as elsewhere in the format.

Duplication uses the same resolved physical transform as a move, so absolute architectural children remain attached when their grounded parent is copied uphill. Container packets retain the full terrain grid, datum, original coordinate frame, and the terrain source record even when no contained object directly cites that source.

## Facts and reference evidence

`facts` is a list of up to 64 named values per placement. Keys are unique within the placement and use the same 1–128 character syntax as IDs. Dotted names make their meaning clearer. Values are strings, finite numbers, booleans, or `null`, with an optional unit, note, and up to 32 source IDs.

```json
{
  "key": "building.levels",
  "value": 3,
  "evidence": "sourced",
  "sourceIds": ["city-record"],
  "note": "Above-ground levels described in the cited record."
}
```

Fact evidence is `observed`, `inferred`, `authored`, `sourced`, or `unknown`. A sourced fact requires at least one existing source ID. An authored fact may omit sources. An explicitly unknown fact has `value: null` and `evidence: "unknown"`; neither a guess nor the string `"unknown"` stands in for this state. Missing facts are unspecified, while null facts record a known gap. Placement evidence and fact evidence are separate: moving a building changes placement evidence without invalidating an independently sourced construction date.

Useful names include `building.levels`, `building.roofShape`, `building.material`, `tree.species`, `tree.form`, `road.direction`, `road.speedLimit`, and `fixture.type`. Keys remain open for other domains. Values and units must be interpreted according to an adapter's documented vocabulary. The core stores them losslessly and does not claim to verify their truth or generate arbitrary geometry from free text. `getFact(object, key)` returns the primitive value, null for an explicit unknown, or undefined for an absent key. Consumers needing confidence or attribution should inspect the matching fact record.

`references` provides up to 32 reusable links per placement. Each entry points to an existing source ID and specifies a role: `photo`, `map`, `history`, `dataset`, or `inspiration`. Optional `view` text identifies a viewpoint or subject, such as `north facade`, while `note` records how the source should be used. Reference links provide context for later generators; they do not automatically establish every visible detail as a sourced fact. URLs live in the central source record and are never fetched or executed by the document engine.

## Document API

```ts
parseWorld(input: string): WorldDocument
serializeWorld(world: WorldDocument, pretty = true): string
documentBytes(world: WorldDocument): number
validateWorld(world: WorldDocument): { errors: string[]; warnings: string[] }
getFootprint(object: WorldObject): [number, number][]
makeObject(kind: ObjectKind, x: number, y: number): WorldObject
migrateWorld(world: WorldDocument): WorldDocument
getFact(object: WorldObject, key: string): string | number | boolean | null | undefined
getDescendants(world: WorldDocument, id: string): WorldObject[]
updateObject(world: WorldDocument, id: string, patch: Partial<WorldObject>): WorldDocument
removeObject(world: WorldDocument, id: string): WorldDocument
duplicateObject(world: WorldDocument, id: string): { world: WorldDocument; rootId: string }
sampleTerrain(world: WorldDocument, x: number, y: number): number | undefined
getObjectBaseElevation(world: WorldDocument, object: WorldObject): number | undefined
getFootprintTerrain(world: WorldDocument, object: WorldObject): {
  min: number | undefined; max: number | undefined; mean: number | undefined;
  sampleCount: number; missingCount: number;
}
```

`parseWorld` validates before returning and throws an actionable error containing field paths for invalid data. `serializeWorld` validates, sorts JSON object keys recursively, preserves array order and every accepted value, and defaults to two-space indentation. Compact output uses `pretty = false`; if indentation alone would exceed the applicable 4 MiB ordinary / 16 MiB composition import limit, the serializer falls back to compact output so the saved document remains importable. Canonicalization preserves document meaning, not original whitespace, key order, or numeric spelling. No accepted fields are silently removed. Unknown fields and versions are rejected so imports cannot quietly lose data. `documentBytes` measures compact UTF-8 output, including multibyte text. `makeObject` returns a new authored object with a unique ID and editable defaults.

The mutation helpers return new documents and preserve the original. They throw for missing object IDs or invalid results; `updateObject` does not rename IDs. `getDescendants` excludes the named root, preserves document array order, and returns an empty array for an absent root. Parent traversal is iterative and supports the applicable object limit without recursive stack growth.

Errors block import and serialization: invalid fields, nonfinite or excessive numbers, duplicate IDs or fact keys, dangling references, parent cycles, inconsistent unknown facts, malformed footprints, or resource limits. Warnings retain the document: geometry outside bounds and overlapping building volumes. Ground cover, tree canopies, paths, and water can overlap intentionally. Buildings sharing an edge or whose vertical ranges do not intersect are not collisions. Collision checks use actual polygon outlines, not just bounding boxes. To keep large documents responsive, overlap diagnostics have a comparison budget and warn when that budget is exhausted; warnings are advisory, not a complete structural survey.

Ordinary limits: 4 MiB of input JSON and compact UTF-8 document content; 1,000 objects; 100 sources; 4,000 relations. The composition budgets above apply only with valid 0.6-or-later composition metadata. Both use 256 vertices per footprint and 32 tags of up to 64 characters. The aggregate byte limit also applies to edited documents, even when every individual field is valid. Text fields have per-field limits documented in the schema, with long descriptions capped at 10,000 characters. Dimensions must be positive and at most 100,000 metres; positions and local offsets lie within ±1,000,000 metres. Height is 0–100,000 metres, elevation ±100,000 metres, rotation ±360,000 degrees, layer an integer between −1,000 and 1,000, latitude ±90 and longitude ±180. Bounds overflow is a warning, allowing an object to straddle a site boundary.

Version 0.2 additionally allows 64 facts and 32 references per placement, and 32 source IDs per fact. Fact strings and notes are limited to 10,000 characters, units to 64, reference views to 200, and numeric facts to ±1,000,000,000,000,000. The JSON Schema checks structural rules; duplicate keys, graph integrity, and geometric warnings require `validateWorld`.

Version 0.3 permits 2–257 rows and columns, exactly `rows × columns` heights, and at most 66,049 samples. Height and reference elevations are bounded to ±100,000 m; spacing and source resolution must be positive and no more than 100,000 m. Grid origin and extent remain within ±1,000,000 m. Datum names have 1–200 characters. Terrain obeys the applicable aggregate document byte limit. Exact array dimensions, ordered acquisition dates, source integrity, and grounding coverage are checked by `validateWorld` in addition to the JSON Schema.

## Renderer adapter contract

The core module does not import React, SVG, WebGL, or a scene engine. A minimal adapter accepts the validated document and returns or updates its renderer's representation:

```ts
interface WorldRenderer<Scene> {
  render(document: Readonly<WorldDocument>): Scene;
}
```

Adapters resolve geometry with `getFootprint`, interpret kind and labels, and respect layer, elevation, and height. They retain object IDs for selection and edit callbacks. A move callback communicates `{ id, x, y }` to the editor, which creates an updated document; it does not mutate engine geometry as the persistent state. Render plain labels as text, never as HTML, and never execute descriptions or source strings. Engine-specific meshes and caches are disposable derived state. Both an SVG plan and a 3D scene can therefore open the same saved document without a format conversion.

Render children once at their stored absolute positions and use the shared `getObjectBaseElevation` policy. Do not reapply parent transforms or independently raise building bases in a scene graph: the document helper already propagated them. Terrain mesh and draped surfaces use `sampleTerrain` with the same reference elevation. No-data cells remain gaps. Read recognized fact keys to choose deterministic interpretations, retain evidence/reference/terrain records in exported metadata, and leave explicitly unknown details neutral. Repeatable generation requires a documented interpreter and version as well as the document and seed; free-form facts alone do not guarantee identical output from unrelated generators.

For imported building decompositions, an explicit non-unknown `building.isOutline: true` fact plus at least one child tells the Three adapter to retain the parent outline as metadata while rendering the mapped parts. It omits the parent's default mass and foundation, preventing them from covering those parts. A parent without children still receives normal default geometry; an explicit custom recipe also renders normally. The parent remains available in the map and hierarchy.

Version 0.5 intentionally does not describe full interior models, dynamic simulation, automatic geospatial surveying, hole polygons, embedded texture assets, or executable procedures. Terrain, descriptive material facts, bounded authored shape compositions, and online reference metadata are supported; default decorative geometry and foundation infill remain adapter interpretations. New structural capabilities should use an explicit format version and migration rather than silently changing existing values.
