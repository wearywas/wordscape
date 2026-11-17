# Round 8: concrete references and clustered generation

The user wants more varied, dense and naturally arranged imaginary worlds, with ten processed real examples supplied to generation. They also authorize reasonable related improvements. This is the last feature/refinement round before rounds 9–10 polish and delivery.

## Selected approach

Use ten complete Wordscapes converted from the real retained Round 7 extracts, plus contiguous smaller geometry contexts. Select two references locally from the brief, with optional manual selection or no examples. This satisfies the concrete-example approach without requiring a public map service to respond during every generation. The selector is a deterministic keyword/tag heuristic, not agentic geographic search; references are inspectable and downloadable.

The previous prompt's preference for unrotated objects encouraged orthogonal layouts. Replace it with route-aligned building groups, varied setbacks, small courts, purposeful open spaces and orientation changes that serve the layout. Compact urban briefs receive a denser allocation within the existing 60-object cap; rural/open briefs remain open. A layout preference helps steer this without overriding explicit instructions. Random jitter is not the objective.

Allow optional simple local polygon footprints in model proposals, using the existing document geometry contract. This permits bent routes/water and irregular buildings without introducing executable geometry or a new document version. Keep schema, boundary, self-intersection, recipe and source validation strict. Existing-world iteration still preserves original placements and evidence; it does not silently restructure a real survey.

Expose descriptive building coverage, nearest-footprint gaps and route/orientation measurements in review. These are not a naturalness or navigation score. Exclude suppressed building-outline containers and validate recorded route centerlines before using them for measurements.

## Work and verification

- Survey agent: ten reproducible full Wordscapes, real contiguous geometry contexts, thumbnails, source hashes, attribution, omissions and geometry-to-source tests.
- Engine agent: bounded automatic/manual reference context, typed preferences and footprint proposals, inspiration provenance, descriptive metrics and preservation/regression tests.
- Renderer agent: reference selection, read-only mapped 3D preview/download, results/metrics, cancellation/stale invalidation and mobile/browser checks.
- Root: independent review, live subscription-backed generation, actual scene/export inspection, comparison with the earlier example, history/docs/private commit and CI.

Live comparisons must disclose changed briefs: the original Lanternwater request explicitly limited cottages and asked for generous clearances. A denser brief is not a controlled causal test of the new reference system. Preserve attempts and outputs, including failures, without manually correcting generated data.

New imaginary terrain and wholesale rearrangement are deferred. The current request's layout quality and inspectable reference mechanism take priority; all real-world tools remain available.
