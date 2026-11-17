# Round 7: imagined worlds and iterative authoring

The user wants imaginary creation to become Wordscape's central purpose while retaining real-world mapping as a reference and learning tool. They explicitly request agent-led sampling of roughly20–100 real map slices, optional creative briefs, and a way to improve existing real or imaginary worlds. Their standing authorization delegates implementation decisions and reserves rounds9–10 for polish/delivery.

## Design decisions

- A direct whole-document rewrite would risk replacing sourced observations. A fixed template with model-written labels would give the model too little creative scope. The selected approach is a bounded scene proposal: named placements and optional procedural recipes, validated locally and previewed before application.
- New imaginary worlds use the existing local Codex/ChatGPT connection or an explicitly selected API provider. Blank briefs are supported. Sizes are180,360 or720 metres; each proposal contains20–60 authored placements, with relations and optional normalized-part geometry. This round starts on flat ground. Generated hills and broader spatial restructuring remain later refinement opportunities.
- Existing-world iteration adds up to60 authored placements and changes up to12 descriptions/appearance recipes. It preserves all original source facts, sources, placements, dimensions, terrain and imagery. It does not delete or relocate existing objects. Application is explicit, undoable, and archives both versions in the existing library. Stale proposals are rejected.
- The format0.7 imaginary marker explicitly distinguishes a fictional local frame from geographic coordinates. Imaginary worlds have no aerial reference and cannot masquerade as real mapped selections.
- A20-window purposive OSM study supplies versioned advisory observations and separately labelled authored heuristics. It is not representative, not a trained model, and not proof that missing map records mean empty land. Source crops, hashes, methods and a contact sheet remain inspectable and reproducible.
- Introduce prominent Imagine a world and Improve this world actions now. Keep the existing baseline on startup; the broader imaginary-first home screen, language and library organization can be refined during polish.

## Work and checks

1. Sampling agent: bounded source acquisition, metrics, guide, source sanitization/attribution and independent audit.
2. World-engine agent: shared strict schema, model context and validation, new endpoint using the existing busy/cancel/provider path, format migration and preservation tests.
3. Renderer agent: optional-brief studio, auth/provider selection, preview/apply/cancel, responsive browser checks.
4. Root: application integration, live subscription-backed creation and iteration, actual scene inspection/export, regression checks, documentation/history and private commit/CI.

No model code or arbitrary external asset URLs are executed. The model sees a bounded summary of existing objects, not terrain rasters, reference images or full source records. All generation remains an authored interpretation. Unsupported or malformed output is shown as an error and does not modify the open world.

Round8 remains available for creative refinement; rounds9–10 remain reserved for polish and delivery.
