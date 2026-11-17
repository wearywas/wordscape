# Terrain Engine Implementation Plan

> **For agentic workers:** Implement the approved contract in the assigned world-engine subsystem. Root coordinates renderer, survey data, UI, and independent review.

**Goal:** Store sourced terrain and resolve grounded placements consistently in format 0.3 without changing legacy worlds.

**Architecture:** A bounded regular height grid retains absolute datum elevations and provenance; a pure terrain module supplies bilinear samples and common grounding math. Geometry remains renderer independent. Container edits preserve resolved physical relationships.

**Tech Stack:** TypeScript, Vitest, JSON Schema draft 2020-12; no new dependencies.

**Spec:** Root-approved prompt 3 contract, documented in `docs/FORMAT.md` with the implementation.

## Global constraints

- No commits or UI changes in this assignment; preserve 0.1/0.2 parsing and edited saved worlds.
- East/north metre coordinates; row-major samples run west→east and south→north.
- At most 257×257 grid nodes, finite bounded metre values, null for no data; unchanged 4 MiB document limit.
- Terrain and grounding fields require 0.3. Missing/absolute grounding preserves existing local elevation.
- Terrain source heights minus referenceElevation are local render heights; object height remains separate.

## Review focus

- Grid edge samples must not be poisoned by unused null corners, or extrapolated beyond coverage.
- Wide/rotated footprints must include internal ridges and boundary grid crossings.
- Unknown grounding must never silently become elevation zero.
- Container and duplicate transformations must preserve physical child offsets on slopes.
- Standalone packets must retain terrain and its source record; migration must not attach terrain to edited legacy worlds.

### Task 1: Pure terrain contract and sampling

- [x] Add `WorldTerrain`, grounding, and terrainAnchor types; write failing interpolation, null, boundary, footprint-extrema, and grounding tests.
- [x] Extract unchanged footprint geometry to `geometry.ts`, re-export from document; implement `terrain.ts` helpers.
- [x] Verify targeted terrain tests.

### Task 2: Document integrity and container operations

- [x] Write failing 0.3 validation/migration, rigid terrain movement, duplication, coverage, and packet tests.
- [x] Implement version gates, grid/date/source validation, resolved overlap checks, offset conversions, and packet source retention.
- [x] Verify all world-engine tests and preserve legacy tests.

### Task 3: Portable specification and integration

- [x] Update JSON Schema and FORMAT with exact semantics, limits, unknown coverage, and sampling policy.
- [x] Validate schema, run scoped lint and full `npm run check`, report unrelated in-progress failures by name.
- [x] Coordinate root and renderer review using the exact shared helper signatures.
