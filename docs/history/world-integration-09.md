# Round 9 terrain integration checks

Two explicit automatic application checks used the already authenticated ChatGPT/Codex connection. Both succeeded on their first call and report `gpt-6.1-sol`. Exact requests, assembled prompts, specialized schemas, responses, hashes and timestamps are retained below. No separate API billing, extra human prompt, runtime-generated code execution or manually corrected model output was involved.

| Check | Input/output | Verified behavior |
| --- | --- | --- |
| [Terrain-only revision](world-09/revise-2026-11-17T01-57-58-389Z.json) | Original flat Mossbell → [terrain version](../../public/examples/mossbell-terrain.wordscape.json) | All 29 objects retained; 28 re-grounded; all plan positions, dimensions, facts, descriptions and recipes compared equal; flat pond retained |
| [Creation with terrain](world-09/create-2026-11-17T02-11-23-022Z.json) | New brief → [Alderfold](../../public/examples/alderfold-terrain.wordscape.json) | 24 objects and an actual authored heightfield generated together |

Each output has 1,089 samples (33 × 33). Mossbell elevations range from −3.579 to 29.981 local metres, forming a hill and pond basin. Alderfold ranges from 0 to 24.993 m. These are invented landforms, not measured terrain. Both documents use format 0.8 and retain the compact analytic recipe and provider/model provenance in a source record. The existing format's terrain mesh is used; no landmark cones substitute for the ground.

The revision preserves source descriptions by design: Mossbell's original text still mentions flat ground, while its new terrain record and labelled example card explain the revision. Earlier decorative mountain objects in a user's world likewise are not automatically deleted. The original flat Mossbell file remains unchanged and is separately available in Examples.

Isolated Chrome checks imported each actual result, rendered orbit and terrain/flat views, walked without mutating data, exported GLB with full document metadata, and verified mobile fit. GLBs are 5,673,144 bytes for Mossbell and 1,267,500 bytes for Alderfold. The height grid and explicit authored evidence survive the metadata roundtrip. Alderfold's initial walk view faces a nearby wall; backing up and turning works. Sparse geometry, foundation infill, steep slopes and shoreline fit remain interpretation limitations.

Unit coverage includes bounded recipe validation, complete rectangular grid coverage, protected sourced-ground rejection before provider contact, terrain-only revision, parent/child vertical alignment, flat water, missing context samples and the actual terrain mesh in GLB. Independent review found a mixed-evidence grounding bug: an observed object already attached to an authored grid could move during replacement. A preflight guard now rejects that unsupported combination, including protected ancestry, before inference. The regression and the full suite pass.

Screenshots: [Mossbell terrain](world-09/mossbell-terrain.png), [flat comparison](world-09/mossbell-flat.png), [Alderfold](world-09/alderfold.png). `scripts/terrain-world-live-check.mjs create|revise` reproduces an explicit allowance-consuming check; normal tests use fixtures and do not contact a model.
