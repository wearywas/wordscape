# Prompt 3: what a place needs beyond its plan

The user authorized an agent brainstorming session and implementation within the same reply. No additional human prompts were requested. Washington Square remains the baseline through prompts 4–5.

## Agent perspectives

- **Survey:** prioritize source-bound observations (capture dates, method, datum and uncertainty); make unresolved observations visible; distinguish terrain-relative placement from absolute local elevation. A source link does not turn an estimate into a measured fact.
- **World engine:** carry a regular elevation grid with deterministic sampling and explicit no-data; separate object height, ground altitude and vertical offset; preserve legacy worlds and physical relationships when containers move across slopes.
- **Renderer:** center samples alone fail on long roads and broad buildings. Drape surfaces over multiple samples, keep architectural masses upright, and record the placement rule separately from the decorative mesh. Preserve true scale.

The agents compared these recommendations. The main integration risks were double-applying elevation, treating missing samples as zero, independently grounding the church's towers, and allowing a preview comparison to alter exported geometry.

## Selected implementation

1. **Portable terrain.** Format 0.3 stores absolute datum heights, source resolution, stored spacing, capture interval, source ID, vertical datum and a separate rendering reference elevation. The 2023 USGS 1 m bare-earth DEM is resampled to a 73 × 73 grid at 5 m spacing. The extracted native subset and reproduction script remain available. Native resolution and stored spacing are not accuracy claims.
2. **Explicit grounding.** Objects either keep an absolute local elevation or use it as a terrain offset. Terrain anchors can be the center or the highest sampled ground in a footprint. Streets and landscapes drape; buildings receive modeled supports. The church and towers share an explicit floor elevation. This is a rendering interpretation, not a measured floor survey.
3. **A survey notebook.** An interactive elevation map/profile, per-object ground/slope readings, evidence counts and a focused review queue expose gaps. The report can be exported for a future world-building agent. Sourced, interpreted and missing fields remain separate; segment-specific speed facts do not resolve an entire road.
4. **Descriptive patterns.** Recorded object density, modeled building heights and tree-center spacing offer starting references for imaginary worlds. Counts and sample sizes travel with the report. These are summaries of this incomplete authored specimen, not learned urban laws or planting advice.

## Alternatives and limits

- Individual object altitude alone would leave roads, paths and empty ground flat. A reusable ground surface is necessary.
- Bundling the full 1 m terrain everywhere would increase the document and mesh size without resolving our uncertain footprints. A compact 5 m grid is adequate for this first terrain iteration; curbs, stairs and retaining walls remain separate future geometry.
- Live elevation requests would make reproduction dependent on a service and connection. The recorded grid renders offline.
- No vertical exaggeration is used in 3D. A flat comparison affects the preview only. The notebook's height profile is explicitly fitted vertically and is not an equal-scale slope illustration.
- No automatic imaginary-world generation is added. Washington Square supplies evidence and descriptive examples first.
- Future priorities include per-observation geometry methods/dates, surveyed entrances and circulation, parcel/building decomposition, terrain breaklines, and actual floor elevations. Those require better observations, not extra decorative meshes.

## Verification targets

Verify grid orientation and datum against the native crop; legacy import and saved-world preservation; missing-data handling; sampling and slope; terrain-aware rigid container edits; draped mesh and foundation behavior; metadata/terrain in JSON and GLB; flat-preview isolation; notebook export and mobile/keyboard access.
