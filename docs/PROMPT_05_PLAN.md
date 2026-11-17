# Round 5: complete and retain a survey

The user authorized automatic terrain, waterfront/water fixes, retained aerial references, and whichever additional ideas fit this round. Implementation decisions are delegated to Codex; no extra design-approval prompt is needed.

## This round

- Retrieve sourced terrain automatically for new bounded areas. Prefer detailed USGS elevation samples where available, with an explicitly labelled global fallback. Preserve nulls, source resolution versus served sampling, datum uncertainty, provenance, cancellation and bounded requests.
- Recover coastal water from mapped coastline topology; do not infer the ocean from empty map space. Keep water level assumptions separate from ground elevation and unknown actual tide level. Investigate the user's exact Wharf source before changing the large pier buildings.
- Add a real satellite selection layer and an online imagery descriptor that survives export/import. Retain the dated bundled Washington Square reference. Existing imported surveys can recover a reference from their explicit geographic frame without changing placements.
- Add an IndexedDB library of immutable survey snapshots. Save current and incoming worlds on explicit replacement, retain edited worlds before leaving, deduplicate identical content, and provide reopen/export/removal with visible storage errors. The existing current-document save remains independent. Saved geographic extents appear on the selector.
- Add an explicit completion workflow for the open imported survey, preserving existing objects while attaching terrain, imagery and newly mapped water. Preview before applying.

## Queued with a finite round budget

- Round 6 candidate: adjacent survey selection and a common geographic frame for combined tiles, with deduplication and seam tests.
- Round 7 candidate: first-person exploration at human scale, including ground-following and a clear escape back to orbit view.
- Round 8 candidate: remaining integration and a small imaginary-world demonstration using the recorded rules; scope depends on rounds 6–7.
- Rounds 9–10 reserved for polish, accessibility/performance, demo/writeup, complete history and contest delivery preparation. No public submission or publishing is implied by this development work.

These are planning choices within prompt 5, not additional human instructions. Later user refinements can change rounds 6–8 while preserving the final two rounds.
