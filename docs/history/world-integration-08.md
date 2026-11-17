# Round 8 live reference-guided generation

Five explicit developer integration calls used Wordscape's already authenticated ChatGPT/Codex profile. Three returned valid worlds; two were rejected. All successful results report `gpt-6.1-sol`. No API-key provider, model-driven geographic fetch, human application-code edit or manual output repair was used. These are automatic checks within reply 8, not new human prompts.

Each JSON record below preserves the exact application request, assembled model prompt, specialized output schema, HTTP result, timestamps, warnings and (for successes) serialized-world SHA-256. The companion validates before returning a proposal, so the two failure records contain the returned error, not the rejected raw model output. No credentials or account identity are recorded. Existing user worlds/library were not replaced by these checks.

| Check | Duration | Result |
| --- | ---: | --- |
| [Canal initial](world-08/canal-2026-11-16T17-23-28-363Z.json) | 158.203 s | 46 objects / 27 buildings, two recipes; Monaco + Thulusdhoo references |
| [Woodland](world-08/woodland-2026-11-16T17-38-42-921Z.json) | 125.133 s | 29 objects / six buildings, one pavilion recipe; SF Wharf + La Digue references |
| [Canal organic guidance attempt 1](world-08/canal-refined-2026-11-16T18-13-13-392Z.json) | 254.782 s | Rejected: local footprint north exceeded its −12…12 m envelope |
| [Canal organic guidance attempt 2](world-08/canal-refined-2026-11-16T18-30-30-887Z.json) | 181.264 s | Rejected: addition `a1` exceeded world bounds after rotation |
| [Canal final](world-08/canal-refined-2026-11-16T18-49-50-357Z.json) | 234.569 s | 46 objects / 26 buildings, two recipes, three polygon surfaces; Monaco + SF Wharf references |

The canal calls use the same user-level test brief. After inspecting the first result, general organic-layout guidance was strengthened to turn whole clusters along route tangents, avoid repeated full-width cross-streets, and explain orientation already encoded in reference polygons. After the two validation failures, exact rotated-envelope formulas and separate local-footprint limits were added. Validation was not relaxed and rejected geometry was not clamped or silently repaired. This application has no automatic model retry loop; the calls above were individually initiated by Codex during development.

## Reference matching changes

The ten full examples were converted from retained, attributed Round 7 map extracts; no new map service call was necessary. The selector sends two compact contiguous geometry contexts and full-world statistics, not all ten complete worlds. It is a deterministic brief/tag heuristic, not LLM geographic search. Manual selection and no-reference generation are available.

The first woodland run exposed a weak match: generic water mentions and negated urban language influenced the selector. Matching now honors local negations and favors dispersed examples for the exact woodland brief (La Digue + Lefaga); the full live briefs are regression fixtures. **The retained woodland was not regenerated after this fix** and its original SF Wharf + La Digue attribution remains intact. Current automatic matching is not retroactively claimed for historical runs. Replaying an old automatic result after selection changes requires its recorded result reference IDs as explicit request IDs.

## Measured outcome and limits

| Actual world | Buildings | Summed footprint coverage | Median nearest building-edge gap |
| --- | ---: | ---: | ---: |
| Round 7 original Lanternwater | 8 | 8.8% | 12.0 m |
| Round 8 initial Lanternwater Lanes | 27 | 37.0% | 3.0 m |
| Round 8 final Lanternwater Lanes | 26 | 36.5% | 2.681 m |
| Mossbell Retreat | 6 | 1.5% | See retained layout measurements |

This is **not a controlled causal benchmark**: the Round 7 brief explicitly requested only six to eight cottages/workshops and generous clearances, whereas Round 8 requests a denser settlement. Summed coverage is declared footprint area, not a union or rendered mesh silhouette. The initial result's generated prose claimed about 29% coverage, despite measured 37%; subsequent guidance leaves measurements to the review calculator.

The final town has 13 unrotated buildings, nine at +10° and four at −15°. It has three coherent orientation groups and varied building dimensions, but remains stylized and partly row-like. Its route orientation measurements use envelope estimates because these authored routes have no recorded centerlines; they do not prove route connectivity or traversability. The woodland has a bent footpath, differently oriented hut groups, open clearing and varied edge groves. Its sparse vegetation is constrained by the test brief's 24–32 object budget.

An independent [exact polygon audit](world-08/layout-intersections-audit.md) with a reproducible optional Python/Shapely script records actual plan intersections. The final town has no positive-area building/building overlap and one shared wall, but **nine building/corridor overlaps**, including two significant court encroachments; five other envelope warnings are conservative. The initial town has four such overlaps. Woodland huts clear paths and water; its only positive-area building/path contact is the open pavilion deck/approach connection (2.4 m²). Elevation, roof overhangs and accessibility are outside this plan audit. The town is not collision-free; no generated world was manually changed to hide this limitation.

## Retained examples and browser checks

- [First canal world](../../public/examples/lanternwater-lanes.wordscape.json)
- [Final canal world](../../public/examples/lanternwater-lanes-refined.wordscape.json)
- [Woodland world](../../public/examples/mossbell-retreat.wordscape.json)

`scripts/world-live-browser.mjs <source> <artifact-basename>` imports each actual output in an isolated Chrome context, renders 3D, walks without changing the document, checks disabled geographic aerial, exports GLB with exact complete-world metadata, and checks mobile page fit. Reset view fits the scene after resizing; orbit scale otherwise stays preserved. All three pass. GLB sizes: initial canal 944,264 bytes, woodland 1,215,572 bytes, final canal 1,110,080 bytes. Final canal compact JSON is 73,067 bytes; this excludes the viewer and procedural interpreter. Screenshots are retained with this record.

The production browser world-studio suite separately tests automatic/manual/no references, the two-reference limit, real read-only reference preview/download, changed-input invalidation, custom footprints/reference JSON and GLB retention, cancellation, explicit provider selection, apply/undo and mobile fit. Its model responses are deterministic mocks, distinct from the live outputs above.
