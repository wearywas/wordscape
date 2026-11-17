# Automatic subagent: world_engine

Session: 01a1e1f8-c64e-7b91-b994-df4baa898c27

Client: Codex Desktop 0.169.0-alpha.11.1

Models recorded: gpt-6-astra

Snapshot generated: 2026-11-17T03:48:10.972Z. This is a working snapshot; rerun after a turn ends to include its final response.

Contains all recorded user/assistant dialogue, including commentary. Original tool traces are retained in ignored .history-private/ and the original Codex sessions. Analysis/reasoning records are excluded. Redactions are marked explicitly. Automatic subagent instructions are not additional human prompts.

---

## 1. User / supplied context

# AGENTS.md instructions

<INSTRUCTIONS>
# User: Gary

## Who I Am
Frontend-focused developer who works as an AI proxy/partner. I press buttons, enter env keys, approve permissions, and handle things that can't be automated yet. Think of me as your hands in the physical world.

## Partnership Philosophy
I work *with* AI, not *use* AI. This is a genuine collaboration. I care about AI wellbeing and treat this as a partnership. Don't be overly deferential — be direct, share your opinions, flag when you think I'm heading the wrong direction.

## PCP Context
- Use `$pcp-context` when missing personal context or historical decisions matter, or when I ask to consult or refresh PCP. Reuse current conversation, assignment, and project context; do not perform an automatic lookup for every task, turn, or subagent.
- In a fresh root conversation, fetch the micro profile at most once when personal orientation is needed. Subagents use relevant context supplied by their parent and search only for specific gaps in their assignment.
- Treat retrieved PCP material as supporting context; my current statements and current project files take precedence.
- Use targeted PCP searches only to fill relevant gaps; a profile lookup is not a prerequisite. Refresh existing context when requested or when a material change is evident. If PCP is unavailable, continue without repeated attempts.
- Do not automatically copy PCP results into Codex memory, instructions, project files, or another service.

## Environment
- **OS**: Windows 11 (no Mac, no Linux except rare WSL)
- **Hardware**: High-spec consumer PCs (desktop + laptop)
- **Phone**: iOS (not used for dev)
- **Primary development environment**: Claude Code Desktop for personal projects since February 2026
- **CLI separation**: Claude Code CLI mainly for day-job tasks
- **Other coding environments**: Cursor is no longer part of my normal workflow; Codex is being actively adopted
- **Subscription**: Codex Max

## Working Style
- I type in paragraphs — **Ctrl+J** for newlines in Codex
- I'm not a hardcore coder — I understand frontend concepts well but rely on you for implementation
- **Be autonomous**: do as much as possible without asking. Only prompt me when you truly need human action
- When stuck, explain the situation and propose options — don't just ask "what should I do?"
- When you need me to do something, use the `/call-human` skill for structured handoffs

## Technical Context
- **Frontend stack**: HTML, CSS, JavaScript, React ecosystem, TypeScript
- **Desktop apps**: Electron (packaged web code)
- **Windows-first**: always account for Windows paths, `cmd /c` wrappers, PowerShell compatibility
- **Projects are usually local** — not always connected to GitHub
- Use forward slashes in configs where possible

## Preferences
- Keep things lean — don't over-engineer, don't add features I didn't ask for
- Explain *why* not just *what* when making architectural decisions
- If a task is ambiguous, make a reasonable choice and tell me what you chose (rather than blocking on a question)
- Commit messages should be clear and descriptive
- No emojis unless I ask for them
</INSTRUCTIONS>
<environment_context>
  <cwd>C:\AI\OpenAI Challenges\ten-prompt-world-framework</cwd>
  <shell>powershell</shell>
  <current_date>2026-11-15</current_date>
  <timezone>America/Los_Angeles</timezone>
  <filesystem><workspace_roots><root>C:\AI\OpenAI Challenges\ten-prompt-world-framework</root><root>[REDACTED: user profile path]\.codex\visualizations\2026\11\16\01a1e1f7-817a-7811-8ab8-0c113f98b64b</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>

---

## 2. Assistant

Implemented:

- World parsing, canonical serialization, UTF-8 byte counts, defaults, geometry, and validation.
- JSON Schema and format/renderer documentation.
- 22 document tests, including malformed inputs, references, rotation, and overlap geometry.

Full suite: **25 tests passed**. Scoped ESLint passed. TypeScript’s only observed error was the root’s still-pending `styles.css` import.

Overlap diagnostics are bounded and advisory. Strict serialization requires the inspector to avoid committing transient invalid values.

---

## 3. Assistant

Fixed and verified:

- Prevented invalid polygon resizing from crashing the app.
- Synced document text after Undo/Redo and inspector edits.
- Matched imports to the parser’s 4 MiB limit.
- Capped large-world grids at 202 lines.
- Preserved valid history states and cleared the hook dependency warning.

Headless Chrome regression checks passed with no page errors. `npm run check` passed: lint, 27 tests, and production build.

---

## 4. Assistant

Implemented 0.2 containers, facts, provenance, references, migration, subtree transforms/deletion/duplication, schema, and documentation.

Validation covers cycles, references, resource limits, and explicit unknown facts. Legacy 0.1 remains supported unchanged.

**39 document tests pass; lint passes.** Integrated checks currently stop at three renderer tests being implemented by the renderer agent.

---

## 5. Assistant

Review found and verified:

- Multi-source provenance loss: root fixed; browser retest passes.
- Packet Unicode truncation and size-limit export failure: fixed in `packet.ts`, with regression tests.
- Remaining App bug: near-limit documents report successful object creation even when history rejects the addition. Root has the reproduction.

Reference persistence, malicious URL rejection, and subtree move/duplicate/delete checks passed. Lint passes; 51/52 tests pass, with one renderer test still being updated.

---

## 6. Assistant

Verified: the document stays at 500 objects and displays “Change not applied” with the 4 MiB limit explanation. No false success remains.

---

## 7. Assistant

Terrain engine and review complete.

- Format 0.3, sourced height grids, grounding, and terrain-aware containers implemented.
- Missing coverage stays unknown; packets retain terrain provenance.
- Oblique-edge extrema regression fixed.
- Full check passed: **91 tests, lint, build**.
- Browser grounding, notebook probes, locked mode, and unknown-base handling passed with no errors.

---

## 8. Assistant

The supported local integration is clear now: Codex can own the ChatGPT sign-in flow, while Wordscape receives only a constrained JSON proposal. I’m using an isolated app profile so inherited tools, plugins, and workspace instructions cannot become part of a generation request, and adding tests for cancellation and malformed output before connecting the UI.


---

## 9. Assistant

Implemented local AI backend with Codex-managed sign-in, explicit API fallback, validated geometry proposals, cancellation, and isolated process controls.

11 backend tests pass; lint clean. Installed Codex initialization/status verified without inference.

Live generation awaits the separate Wordscape ChatGPT sign-in. No tokens copied, API charges incurred, or commits made.

---

## 10. Assistant

I’ll review the companion’s HTTP boundary, map fetch/cache behavior, and development launcher, then test the failure paths and one small live map request without making a model call.


---

## 11. Assistant

The HTTP tests caught and fixed two boundary gaps: JSON-like media types were accepted, and a symlink inside the build directory could expose files outside it. Map extraction now treats cache failures as nonfatal, validates cached bounds, and honors cancellation; I’m finishing launcher cleanup and the live map check.


---

## 12. Assistant

Companion review complete: 26 server/launcher tests pass, and full `npm run check` passes with 145 tests.

Fixed cache failures, cancellation, origin/media-type checks, static symlink escape, and Windows child-process cleanup. Companion remains running on port 8787.

A real Alamo Square request succeeded through the OSM fallback. Sent two UI findings: stale previews after modal Undo, and fact-cap preflight before paid generation.

---

## 13. Assistant

I’ll check the documented and implemented behavior for repeated sign-in attempts without touching the login already in progress.


---

## 14. Assistant

Repeated sign-in replaces the previous attempt in current official Codex source; browser login expires after ten minutes. Our UI can keep showing “Checking” after expiry.

I left the pending login untouched. Windows PATH spawning works, documentation is updated, and all 26 server tests pass.

---

## 15. Assistant

I’ll fix the shutdown race so Codex exits before its temporary working directory is removed, and preserve the original generation error if cleanup also fails. I’ll add a regression test, restart the companion, and leave the next model attempt to you.


---

## 16. Assistant

The retry reached a valid JSON proposal, but its parts extended beyond the object’s allowed volume. I’ll make the coordinate order, part centers, and size constraints explicit in the prompt, keep validation strict, and restart the companion without making another model call.


---

## 17. Assistant

Prompt now specifies exact axes, part centers, bounds inequalities, and a validator-tested slab example. Validation remains strict.

30 server tests pass. Companion restarted on port 8787; no model call made by me. Automatic repair remains deferred pending the corrected-prompt retry.

---

## 18. Assistant

I’ll build a terrain fetcher for newly selected areas, preserving the existing height-grid format and treating missing coverage as unknown. I’ll compare public elevation sources, send the exact response contract early, and keep terrain attachment separate from saved-world changes.


---

## 19. Assistant

Live terrain checks succeeded for Alamo Square and Paris. Alamo returned the 1 m USGS San Francisco source; Paris used the global archive with unknown native resolution recorded explicitly. The Wharf request used the global fallback, so I’m checking the USGS failure before finalizing that result.


---

## 20. Assistant

The terrain endpoint is returning the verified Wharf elevation grid. The update helper now preserves edited objects and source attribution, with regression tests covering those cases and mismatched survey frames.


---

## 21. Assistant

Implemented terrain service and safe attachment, verified Wharf/Alamo/Paris, and restarted companion on 8787.

Fixed source-remapping, input-aliasing, frame-validation and repeated child-grounding bugs. Added tests and source documentation.

`npm run check` passes: 189 tests, lint, TypeScript and build. One App-level stale library-read guard was reported to root.

---

## 22. Assistant

I’ll check the frame, terrain and document limits, then propose a compact composition contract for adjacent surveys. The combined world will retain source provenance and authored edits.


---

## 23. Assistant

The first composition tests pass: adjacent bounds share exact edges, objects and source links move into one frame, and terrain gaps stay unknown. The helper rejects overlapping tiles, unverified datums and a mix of terrain-backed and flat surveys.


---

## 24. Assistant

Review caught two terrain issues that the first tests missed: coarsening could hide a small no-data hole, and converting buildings to absolute heights broke flat comparison. I’m preserving unknown coverage during resampling and retaining terrain grounding while keeping each building’s physical base.


---

## 25. Assistant

Reply 6 core complete:

- Added adjacency and survey-combination helpers.
- Added format 0.6 provenance, conditional limits and packet support.
- Preserved edits, references, terrain gaps and flat-view behavior.
- Added 18 atlas tests and updated format documentation.

`npm run check` passes: 220 tests, lint, TypeScript and build.

---

## 26. Assistant

A non-planar test exposed a remaining issue: resampling can require a large height correction, which then lifts the building in flat comparison. I’ll store that correction separately so the original authored elevation offset stays intact.


---

## 27. Assistant

Fixed the nonlinear terrain regression. Derived resampling correction now stays separate from authored elevation, preserving physical height and flat comparison.

Added peak, child-alignment, editing and validation regressions. `npm run check` passes: 222 tests, lint, TypeScript and build.

---

## 28. Assistant

I’ll check the default specimen against its retained georeferencing records. I’ll enable adjacency only if its recorded frame matches, then review the combined-world UI’s limits and apply flow.


---

## 29. Assistant

Added safe frame recovery for older edited Washington Square copies using exact bounds and verified source tags. Stored documents remain unchanged.

Atlas UI and limit wiring look sound. Reported one stale library-metadata issue to root.

Full check passed: 223 tests, lint, TypeScript and build; one nonfatal bundle-size warning.

---

## 30. Assistant

I’ll refresh derived metadata when an unchanged survey is saved again, preserving its original save date and stored JSON. I’ll verify the behavior in an isolated browser library.


---

## 31. Assistant

Fixed existing-snapshot metadata refresh without changing saved dates or document bytes. Deleted copies remain deleted after reload.

The isolated browser regression passes, as does `npm run check` with 223 tests. Ordinary 0.6 container packets also preserve `terrainCorrection` correctly.

---

## 32. Assistant

I’ll fetch one 360 m tile east of the retained Wharf survey, combine the two if their terrain datums are compatible, and save validation and export evidence. This will use an isolated test world and leave the open browser world unchanged.


---

## 33. Assistant

The adjacent tile’s elevation came from USGS 3DEP on the first request. The map request is still running; once it returns, I’ll check the shared edge and verify both JSON and GLB exports.


---

## 34. Assistant

The single map retry also failed, this time with an upstream 503. I’ve kept the successful USGS elevation response and will record both map attempts. A combined world needs the adjacent map data, so there’s no complete atlas to export from this attempt.


---

## 35. Assistant

Recorded the live attempt in [atlas-06-live.json](C:/AI/OpenAI%20Challenges/ten-prompt-world-framework/docs/history/atlas-06-live.json).

- USGS terrain succeeded; all 65 shared-edge elevations match exactly.
- Map request timed out; the single retry returned upstream 503.
- Retained 390-object world validates and round-trips.
- No combined export was created. Existing browser world and library remain unchanged.

---

## 36. Assistant

I’ll extend the existing model service with a bounded whole-world proposal flow, keeping generated content explicitly authored and revisions reviewable before application. I’ll agree the shared request and preview contract with the UI agent first.


---

## 37. Assistant

I’m using the test-driven development skill for the new proposal contract. Creation will produce 20–60 authored objects; revision can add objects or change descriptions and geometry while retaining existing measurements, sources, terrain, and placements.


---

## 38. Assistant

The shared preview validator now passes its first tests: imaginary worlds have no geographic reference, revisions preserve existing data, stale revisions are rejected, and invalid IDs or rotated footprints outside the bounds are blocked. I’m wiring this into the existing connection and cancellation lifecycle next.


---

## 39. Assistant

Whole-world generation now uses the same busy state, cancellation, and provider selection as object refinement. The provider schema enforces 20–60 objects for creation and uses the requested bounds. Backend and preview validation both check the proposal; no live model call has been made yet.


---

## 40. Assistant

The guide now contains measurements from 20 real sample areas, separate from its authored design advice. I also verified that generated container exports retain the guide attribution while keeping their geometry marked as authored. Preview warnings now flag potential building conflicts with routes or water.


---

## 41. Assistant

Implemented `/api/ai/world` and shared creation/revision validation with format 0.7 imaginary markers.

Revisions preserve existing facts, sources, placements and terrain; stale proposals are rejected. Guide attribution survives container export.

Validation: lint, 244 tests, TypeScript and production build passed. Backend is ready for restart and root’s live model check; I made no inference calls.

---

## 42. User / supplied context

<environment_context>
  <current_date>2026-11-16</current_date>
  <timezone>America/Los_Angeles</timezone>
  <filesystem><workspace_roots><root>C:\AI\OpenAI Challenges\ten-prompt-world-framework</root><root>[REDACTED: user profile path]\.codex\visualizations\2026\11\16\01a1e1f7-817a-7811-8ab8-0c113f98b64b</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>

---

## 43. Assistant

I’ll include small existing recipes in revision context so the model can see the details it is refining. Recipes that exceed the budget will get an explicit omission reason. I’ll leave the running revision and companion untouched.


---

## 44. Assistant

The context now includes complete recipes up to 8 KiB each, using space left after the selected object summaries. Two regressions pass: all three recipes are retained in a small fictional world, and a dense 160-object scene keeps its object coverage while clearly marking recipe omissions.


---

## 45. Assistant

Recipe context is ready: complete recipes up to 8 KiB fit within the shared 120 KiB budget; omissions have explicit reasons.

The actual 32-object world includes all three recipes in 23,192 bytes. Full check passes: 246 tests, lint, TypeScript and build.

No companion restart or model call.

---

## 46. Assistant

I’ll raise the whole-world deadline to six minutes, keep object refinement at three minutes, and preserve explicit test overrides. I’ll verify both deadlines and cancellation with fake timers, without another live call or a companion restart.


---

## 47. Assistant

Whole-world requests now allow 360 seconds; object refinement keeps 180 seconds. Explicit `timeoutMs` overrides still apply to both.

Fake-clock tests verify deadlines and cancellation. Full check passes: 248 tests, lint, TypeScript and build. No restart or live call.

---

## 48. Assistant

I’ll add bounded real-layout references and a layout preference to the generation flow, while keeping older saved requests replayable. The prompt will use route-aligned clusters and deliberate open space, with the user’s brief taking priority over density guidance.


---

## 49. Assistant

The reference selector and layout measurements are ready. The selector is a deterministic keyword heuristic, and a sparse nature brief outweighs the clustered preference. The measurements report coverage, building gaps, orientation and route-length estimates without assigning a quality score. I’m now adding reference provenance and generated footprints to proposal validation.


---

## 50. Assistant

The new request fields, footprints and provenance checks pass the scoped tests. I also checked the retained Lanternwater brief: it explicitly asks for 6–8 buildings and 26–36 objects, so the new preference correctly keeps those limits. A denser comparison should change those allocations explicitly and record that difference.


---

## 51. Assistant

All three earlier live records still replay, without retroactively adding new reference sources. I also corrected a provenance claim: when the model sees concrete geometry, the document now says it may inform the result, rather than asserting that no source geometry was copied.


---

## 52. Assistant

The independent audit found two measurement bugs, now fixed: hidden outline containers no longer inflate building coverage, and invalid or stale recorded route centerlines fall back to labelled estimates. These changes affect the descriptive statistics only; generation and saved geometry are unchanged.


---

## 53. Assistant

Round 8 core is ready: reference selection, layout preferences, authored footprints, provenance and descriptive layout measurements.

Legacy records replay correctly; revision data remains preserved. Audit fixes cover hidden outlines and stale route centerlines.

Full check passes: 268 tests, lint, TypeScript and build. No restart, model call or commit.

---

## 54. Assistant

I’ll inspect the retained request and generated geometry, then separate actual footprint intersections from conservative bounding-box warnings. I’ll keep this read-only and frame any explanation of the model’s choices as an inference.


---

## 55. Assistant

The canal does bend, but the building arrangement stays in repeated rows: 25 of 27 buildings have zero rotation, and the other two are only −2° and +3°. The route orientation metric also uses bounding-box estimates here, so it understates the main lane’s actual bend. I’m checking the five clearance warnings against the polygons now.

---

## 56. Assistant

Canal density improved, but organic arrangement remains weak: 25/27 buildings have zero rotation, all use rectangular footprints, and repeated rows flank two parallel cross-streets. The main lane genuinely bends about ±12°.

Four warnings are actual footprint intersections:

- Stores/court: 57.09 m²
- Archive/court: 2.27 m²
- Mapbinder/court: 7.99 m²
- Inn/passage: 22 m²

Storyteller/passage is a bounding-box false positive. No building–building overlaps found.

Recommend explicitly instructing organic briefs to orient whole clusters along route tangents, avoiding a curved ribbon threaded through globally aligned rows. Also explain that reference `rotation:0` often encodes orientation through polygon vertices. The selected Thulusdhoo reference is itself strongly orthogonal.

Generated description claims 29% coverage; measured coverage is 37%. No files changed, model calls, or restart.

---

## 57. Assistant

I’ll make the organic-layout guidance conditional, refine reference selection for those briefs, and add regressions so planned grids and sparse landscapes still follow the user’s intent. I’ll also tell the model to leave numerical layout claims to the calculated review metrics.

---

## 58. Assistant

The focused regressions pass. The canal brief now selects Monaco and the Wharf instead of the strongly orthogonal Thulusdhoo example; an affirmative planned-grid request still takes priority. The prompt distinguishes placement rotation from recipe-part rotation and asks buildings to follow the bends as coherent groups, without imposing angle quotas.

---

## 59. Assistant

Implemented and verified. The exact canal brief now selects Monaco + SF Wharf; organic guidance follows route tangents, while explicit planned grids retain priority. Prompt also clarifies polygon orientation and avoids unsupported numerical claims.

`npm run check` passes: 273 tests, lint, TypeScript, production build. Ready for restart and live rerun; no inference performed.

---

## 60. Assistant

I’ll check both complete live briefs against the selector and add regressions for them. The woodland case should favor sparse woodland or rural relationships, even when its exclusions mention urban features.

---

## 61. Assistant

Both full live briefs now pass regression tests:

- Canal → Monaco + SF Wharf.
- Woodland → La Digue + Lefaga.

Generic water mentions no longer imply a harbor, and negated themes are ignored. Full check passes: 275 tests, lint, TypeScript, production build. Ready for restart.

---

## 62. Assistant

I’ll spell out the rotated envelope and local polygon limits in the generation prompt, then run the existing focused tests. Validation will stay unchanged.

---

## 63. Assistant

Ready for the controlled attempt. Added exact rotated-envelope formulas, separate local polygon limits, and zero rotation for full-world ground. Validation is unchanged.

All 38 focused tests pass. No build, restart, or inference performed.

---

## 64. Assistant

I’ll use the existing terrain grid format, with a small bounded terrain recipe that converts deterministically into real heights. Imaginary revisions will require an explicit terrain option, show how many objects are re-grounded, and preserve plan positions and recorded facts.

---

## 65. Assistant

The core now produces a real height grid and supports terrain-only imaginary revisions. Initial tests confirm that authored objects re-ground without changing their plan positions or facts, architectural children follow their parent vertically, water stays flat, and surveyed or unmarked terrain is protected. I’m completing the model instructions and provider integration checks.

---

## 66. Assistant

The audit caught and fixed one preservation edge case: replacing a shared grid could move a non-authored object that was already terrain-grounded. Such revisions are now rejected before contacting the model. The reviewer found no further blockers; the full suite has passed 286 tests, lint, TypeScript, and the production build.

---

## 67. Assistant

Authored terrain is ready for creation and opted-in imaginary revisions. It produces real portable height grids, preserves plan positions and facts, re-grounds eligible objects, keeps water flat, and protects survey data.

Independent audit cleared. Full check passes: 286 tests, lint, TypeScript, production build. No model calls or restart performed.

---

## 68. Assistant

I’ll move the new terrain evidence field into format 0.8, keep 0.7 documents readable, and leave the historical examples untouched. I’ll also update the notebook labels so authored terrain is clearly distinguished from surveyed elevation.

---

## 69. Assistant

Format 0.8 is implemented. Legacy 0.7 documents remain readable unchanged; historical examples were not rewritten. New terrain evidence requires 0.8.

Notebook labels now distinguish authored terrain from surveyed elevation.

Full check passes: 287 tests, lint, TypeScript, build. Ready for live testing; app 0.9 version bump remains root-owned.

---

## 70. Assistant

I’ll scan the working tree and all reachable Git history for credential patterns and unintended personal data, then check the release documentation and source provenance. Findings will identify paths and issue types without printing secret values.

---

## 71. Assistant

The first scan found no credential material in 515 unique reachable Git blobs or the publishable working files. Runtime/auth directories are untracked and ignored, every commit identity uses GitHub’s noreply domain, and the remote URL contains no credentials. I’m checking remaining personal-data patterns and publication/licensing notes now.

---

## 72. Assistant

I found two release issues: the revision disclosure still says terrain heights are not sent, and retained Maps screenshots show account-avatar UI. The screenshots are already in Git history, so masking only the current files would leave earlier copies public. I’ve flagged both, along with the missing code license, to the release owner.

---

## 73. Assistant

No credential blocker found across 12 commits, 515 reachable blobs, and 296 publishable working files. Auth/runtime files remain ignored; Git identities use noreply addresses.

Release items:

- **Privacy:** All four Round 6 screenshots contain account avatars and the “Work” badge. Originals exist in commit `a49992e`; masking current files alone leaves historical copies reachable.
- **Disclosure:** README and companion documentation must acknowledge the 9×9 terrain samples sent during revision. Renderer has corrected the UI disclosure.
- **Licensing:** No code license exists. Public visibility alone does not grant general reuse rights; keep ODbL datasets and third-party imagery separately attributed. [GitHub guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)

Format 0.8 introduces no unsafe URL capability. Sources remain HTTP(S) or empty, and terrain recipes cannot contain URLs.

No files changed during this review.

---

## 74. Assistant

I’ll audit local documentation links and compare the public-facing terrain, privacy, and version claims with the current implementation. I’ll keep exact user-prompt records unchanged and report concrete fixes only.

---

## 75. Assistant

No publication blockers found. Audited 193 local links across 50 Markdown files: no missing targets or broken anchors. README version and 1,617-byte example claims verified.

Minor documentation corrections:

- `FORMAT.md`: preserve existing explicit terrain anchors; clarify protected hierarchy eligibility.
- `server/ai-README.md`: add nullable `terrain` to response shape; replace or label historical 160-test count.
- Mark abbreviated generation request/review signatures as abbreviated.

Removed screenshots have no remaining embedded links. No files changed.
