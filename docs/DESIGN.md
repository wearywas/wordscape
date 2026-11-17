# Wordscape / first build

Decision date: November 15, 2026 (America/Los_Angeles). All initial creative and implementation choices delegated to Codex by the user in prompt 1.

Intent: investigate a compact, portable, language-led description of a world whose spatial arrangement is stable across visual generators. Start with a real aerial survey, not an invented fantasy scene.

Chosen approach: a renderer-independent JSON spatial document in local metres. Objects carry a descriptive name, category, footprint, height, elevation, layer, evidence and provenance. Relationships support the semantic graph. Layers permit intentional overlap. The word map and procedural Three.js scene consume the same document.

Alternatives: a text tile grid is concise but too rigid for streets and overlapping vegetation; a pure graph expresses relationships but cannot fix placement without an additional layout step. The chosen hybrid preserves explicit geometry and descriptive semantics.

First specimen: Washington Square, San Francisco. One public aerial crop, manually interpreted by Codex, with estimated dimensions and heights. No live vision service, no API keys, no paid generators. Do not claim automatic satellite reconstruction or survey precision.

Interface: a quiet cartographic workbench, spatial canvas as the primary element, object index on the left, inspector on the right. Choose Words / 3D world / Aerial / Document. Select and edit objects, add/remove objects, toggle categories, inspect sources, import/export JSON, export glTF. Local persistence and undo/redo make exploration reversible.

Design tokens: map paper #edf0e9; ink #263b36; forest #345d4e; water #89bec8; sandstone #d8b89c; white #fafbf7. Georgia for the compact wordmark and explanatory title; system sans for controls; monospace only for coordinates and JSON. Use olive/sage cartographic land and restrained architectural warm tones. The live isometric language map is the memorable element, with simple flat editor chrome.

Layout: header with project and export actions; left object index | large map canvas | right selected-object inspector; bottom compact world metrics. On narrow viewports the inspector follows the map and index collapses to a shorter panel.

Verification: meaningful tests for format roundtrip, malformed imports, geometry, references and overlap; browser smoke checks for editing/persistence, undo, mode changes, exports, import errors and responsive layout; production build and lint. Original sessions retained separately; prompt ledger and export workflow checked from the beginning.

Limits: deterministic category adapters rather than general language understanding; estimated heights; no terrain reconstruction, arbitrary automatic image ingestion, multiuser backend, paid AI or photorealism in build 1.

## Prompt 2: knowledge containers and safe exploration

Keep Washington Square as the shared baseline for the first 4–5 prompts. Extend the document to version 0.2 while preserving 0.1 import support. Each placement can own typed facts with independent evidence, references to photos/maps/history/datasets/inspiration, and child placements through parentId. Keep the serializable object array flat with absolute coordinates; container moves/rotations propagate rigidly through descendants via shared document helpers. Resizing changes only the selected footprint. Exporting a container creates a valid small world document with its descendants and required sources, omitting relationships outside the packet.

Facts use explicit unknown values instead of guessed data. They are descriptive inputs, not executable instructions; source links are opened only by the user or an authorized downstream agent. Procedural adapters consume known fact keys (levels, roof, species/form, fixture type, road direction) with bounded complexity and deterministic fallbacks. Evidence and date limitations remain visible.

View mode is the default on every load. Drag pans and clicks inspect; object movement, metadata changes and document edits require explicit Edit mode. Existing changed worlds are preserved across a specimen refresh; only the exact untouched v0.1 specimen upgrades automatically. Keep both imagery dates visible when comparing older sharper imagery with newer coarser imagery.

## Prompt 3: sourced terrain and the next observation

Three agents compared terrain, grounding, provenance and survey coverage approaches; the selected design and deferred ideas are in [PROMPT_03_BRAINSTORM.md](PROMPT_03_BRAINSTORM.md). The compact 0.3 grid retains absolute datum heights, capture date and native resolution. Object elevation remains an absolute local base unless explicitly terrain-relative. Ground anchors are shared pure functions, so the editor, container movement, renderer and export agree.

The live 3D view drapes surfaces and models level foundations, with true vertical scale and a non-mutating flat comparison. It does not infer architectural floor levels from bare-earth measurements. An interactive notebook makes elevation readable even when the plan hides slopes. Evidence counts, a focused field-review queue and descriptive spatial patterns can be exported for future agents; no numeric completeness score or automatic fantasy generator is introduced. Pristine 0.2 specimens now upgrade too; edited worlds still remain intact.
