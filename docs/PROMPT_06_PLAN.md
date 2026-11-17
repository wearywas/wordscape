# Round 6: connect places and explore them

The user requested investigation of Google's terrain/3D data, mouse-wheel zoom, efficient progress on the planned next steps, and at least one reserved round for model-generated imaginary worlds. Implementation decisions remain delegated to Codex.

## Delivered scope

- Exact cardinal neighbor selection shares a geographic edge with the open survey. Manual coordinate, size and map changes clear the adjacency choice. Network extraction remains bounded to one ordinary tile.
- Combine two to four saved ordinary surveys into one editable format 0.6 document, with a common geographic frame, source/ID remapping, original tile metadata, conservative deduplication, explicit retained seam fragments and up to 4,000 objects / 2 km span. Original saved documents remain immutable. Preview and explicit application remain separate.
- Preserve terrain gaps, accept only compatible known datums, and reject mixing flat and terrain-bearing inputs. Derived resampling correction is separate from authored elevation so both physical grounding and flat comparison retain their meanings.
- Cursor-anchored wheel zoom for Words and bundled aerial views, with existing native zoom retained for the online imagery and Three.js views.
- Human-scale walking in the full 3D workbench: perspective camera, 1.7 m eye height, WASD/arrows, drag look, Escape/return to orbit, reset, and conservative terrain/footprint collision. This is a viewing aid, not an accessibility or navigability survey. Doors, steps, bridges and interior routes are not simulated.
- Review official Google data capabilities and terms. Keep open data as the persisted recording foundation; no paid Google integration or content extraction was added.

## Remaining rounds

- **Round 7 candidate:** begin whole imaginary-segment generation through the existing ChatGPT/Codex or explicitly selected API connection. Optional user prompt, compact learned/descriptive layout context, validated world proposals and review before applying. Real-world patterns remain examples, not universal rules or inferred real facts.
- **Round 8 reserved:** imaginary-world refinement and demonstration, including generation variety, spatial logic and portability. If round 7 needs integration work, this remains a dedicated full round for the imaginary-world feature.
- **Rounds 9–10 reserved:** polish, accessibility/performance, demo and writeup, source/attribution checks, complete prompt/history packaging and final delivery decisions. No public publishing or contest submission occurs implicitly.

The walking feature landed one round early, making room for the imaginary-world work without consuming the final two rounds. Later user steering may change rounds 7–8, while preserving at least one full imaginary-world round.
