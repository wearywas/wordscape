# Local AI companion

`createAiService()` exports `status()`, `login()`, `generate(request)`, `generateWorld(request)`, `cancel()` and `close()`. The HTTP host owns loopback binding, the allowed Host/Origin list, CSRF token and HTTP body limit. These methods do not write the world. The browser previews a proposal and revalidates it before explicit application. Further placement edits require Edit mode.

## Authentication and billing

The preferred provider is the installed official **Codex app-server**, using its managed `account/login/start` ChatGPT browser flow. Wordscape never reads, copies, returns or logs authentication tokens. Codex keeps its own authentication in the separate `%LOCALAPPDATA%/Wordscape/codex` profile on Windows. This deliberately requires a one-time Wordscape sign-in even when the Codex desktop app is already signed in. Subscription eligibility, model access and usage limits are determined by the signed-in account; a successful login alone does not verify an inference entitlement.

Current OpenAI documentation also describes a general **Sign in with ChatGPT** OAuth capability for eligible open-source and locally hosted apps. This implementation uses the documented Codex-managed flow; it does not implement that separate client-registration/token-management flow, and it does not impersonate a generic OAuth app.

The optional API provider uses only the companion's `OPENAI_API_KEY` environment variable. Its usage follows API billing; it is never selected automatically when Codex fails. `WORDSCAPE_API_MODEL` sets the API default (otherwise `gpt-6.1-sol`). `WORDSCAPE_CODEX_BIN` can point to the official executable if it is absent from PATH. Neither setting is accepted from HTTP requests.

Sources: [Codex app-server authentication and lifecycle](https://learn.chatgpt.com/docs/app-server), [ChatGPT plan usage for local apps](https://developers.openai.com/siwc/token-sharing-open-source), [API authentication](https://developers.openai.com/api/reference/overview).

An unfinished browser sign-in is not permanent: the current upstream [account processor](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/account_processor.rs) times it out after ten minutes. Starting another login replaces the previous attempt, so finish in the newest browser tab. This behavior was reviewed in official source without interrupting a pending user login; the installed CLI's exact timeout/retry behavior was not exercised live.

## Request and result

```json
{
  "provider": "codex",
  "prompt": "Propose a restrained facade interpretation.",
  "model": "optional-model-identifier",
  "context": { "worldName": "Washington Square", "objects": ["1–3 complete selected WorldObjects"] }
}
```

The prompt is limited to 4,000 characters and the full request to 160 KiB. Only a selected subset of object fields is sent to the model; the entire world, terrain grid, source URLs and references are not included. Object descriptions and facts remain untrusted context. A result has `{provider, model, proposal:{summary, changes}}`, where each change contains exactly `{objectId, description, geometry}`. IDs must be selected and unique. Geometry is either null (keep the existing recipe) or the shared, validated `GeometryRecipe`. It cannot contain executable code, external asset URLs, placement edits, fact changes or citations. Generated geometry is explicitly authored. Output is capped at 128 KiB; the API route also caps output at 12,000 tokens.

## Process boundary

### Whole-world proposals (prompts 7–8)

`POST /api/ai/world` and `createAiService().generateWorld(request)` share the existing account, provider selection, busy state, cancellation and restricted text-only subprocess. Requests are `{provider,model?,mode:'create'|'revise',prompt?,size?,world?}`. Blank briefs are allowed. Creation selects 180, 360 (default) or 720 m and asks the model for 20–60 authored objects. Revision accepts a validated existing ordinary world or atlas and permits additions plus description/geometry changes only; no existing facts, citations or plan placements are changed. Explicit opted-in imaginary terrain authoring may replace ground and re-ground eligible objects as described below. Existing descriptions changed by a proposal are explicitly marked as authored interpretations.

Only this HTTP route allows a body up to 16 MiB plus 16 KiB of envelope/brief. The contained document still obeys its 4 MiB ordinary or 16 MiB atlas limit. Other routes retain the 256 KiB HTTP boundary. Full documents never enter the model prompt: only world name/bounds, up to 160 bounded object summaries (120 KiB), and the advisory layout guide are included. Resolved object bases and a coarse 9 × 9 terrain height summary with datum/reference/provenance information are also included when available. Full terrain grids, source records, linked references and aerial pixels are excluded. Footprints are limited to sixteen context vertices and marked when simplified. The whole prompt is capped at 200 KiB. Object text and guide strings remain data, never executable instructions.

The strict schema is specialized to the requested rectangle and create/revise operation. The response is capped at 384 KiB (24,000 API output tokens) and has `{summary,name,description,additions,changes,relations,terrain}` (`terrain:null` in preserve mode; legacy recorded results may omit it). Shared browser/server helpers validate fields, references, bounds, recipes and the complete preview document. The result includes `{provider,model,guideVersion,context:{includedObjects,omittedObjects},proposal}`. All generated placements and geometry are authored. New imaginary worlds have an explicit non-geographic marker; no fake aerial reference is added. Revision preserves the whole input document except the permitted operations, and explicit application rejects stale snapshots. Invalid output produces a useful error without applying any changes. No automatic repair or retry is performed.

The companion owns a stdio subprocess, never a public app-server WebSocket endpoint. It creates a temporary empty working directory, strips inherited API keys and runtime overrides, and uses an app-owned Codex configuration. Shell, code mode, images, web search, multi-agent, MCP, plugins, hooks, skills and other extension tools are disabled, following Codex's own [temporary structured-request implementation](https://github.com/openai/codex/blob/main/codex-rs/tui/src/temporary_structured_request.rs). Each generation starts an ephemeral read-only thread with tool network access disabled and no selected environments/capabilities. A mismatching sandbox response, unexpected tool item, approval request or token-forwarding request stops generation. This is a constrained text-generation bridge, not a general agent execution endpoint.

The installed CLI's legacy read-only sandbox does not itself promise a restricted read-root list; isolation therefore also depends on suppressing tools and inherited configuration. Update and retest this integration when updating Codex. The raw protocol is never exposed to the browser. The CLI is versioned independently; incompatible protocol or account failures are reported instead of silently weakening the policy.

Only one generation runs at a time. Cancellation/timeout aborts API fetches or interrupts/stops the local Codex process; the next request can start a fresh process using the same Codex-managed sign-in. Shutdown waits for process exit before removing the temporary working directory and retries transient Windows file locks. Cleanup failures cannot replace the original generation error. Object refinement has a bounded 180-second deadline; whole-world creation and revision have a bounded 360-second deadline because they generate a larger scene proposal. An explicit service-level `timeoutMs` overrides either deadline for tests or an embedding host. Cancellation remains immediate and cannot undo quota already consumed. No prompts or raw provider errors are logged by this module; failures expose only the request phase, numeric code, recognized error category and HTTP status. Ephemeral Codex threads are requested; account/runtime logging remains governed by Codex and the provider.

### Concrete layout reference context (prompt 8)

Whole-world requests also accept `layout` (`contextual`, `clustered`, `planned`, `open`) and optional `referenceIds`. Omitted IDs select two of ten retained real-world examples using a bounded local keyword/tag heuristic; `[]` means no examples; one or two known unique IDs select them explicitly. The server returns its actual selection and the client verifies it. References are not fetched by the model. Only compact contiguous geometry contexts and full-world statistics enter the aggregate 200 KiB prompt; complete reference documents and preview images stay outside it. Source attribution and crop hashes are retained as inspiration records in the resulting world. Old automatic runs must use their recorded result IDs for exact replay after selector changes.

Generated placements can supply `footprint: null` or 3–16 simple polygon vertices in object-local metres. Vertices stay within the envelope, and the rotated footprint/envelope must fit the world. Shared validation rejects malformed geometry. This uses existing format 0.7 capabilities and preserves old omitted-footprint results. Descriptive metrics and clearance warnings are review aids; the bridge does not guarantee natural or collision-free layouts.

## Verification

### Authored terrain proposals (prompt 9)

`terrainMode:'author'` enables a bounded analytic heightfield recipe in whole-world creation or an eligible imaginary revision. The application samples it into portable format-0.8 terrain with explicit authored evidence. Revision requires opt-in, permits terrain-only results, preserves plan placements/facts, and reports vertical re-grounding before application. Surveyed or unmarked terrain and protected terrain-dependent objects reject before provider contact. `preserve` or omission retains earlier behavior. See [the exact terrain contract](../docs/FORMAT.md#authored-terrain-format-08-application-09). The UI discloses that existing-world context includes a coarse 9 × 9 terrain summary; the complete grid remains local. This is true heightfield authoring, not cone-shaped landmark substitution.

`npx vitest run server/ai.test.mjs server/ai-codex.test.mjs` covers the AI contract and process boundary. `npm run test:server` includes those plus the HTTP boundary, map caching/fallback/cancellation, static-path containment and Windows development launcher (30 tests at the final prompt-4 review). They are also included in the current `npm run check` suite (297 tests at Round 9). Provider tests use fake transports and do not spend quota. A real local initialize/account-read probe is safe without inference; a model call requires an authenticated account or configured API key and consumes the chosen provider's allowance.

The Windows installed CLI was successfully launched as `codex` through PATH with `shell:false`; an explicit `.exe` suffix was unnecessary. A missing executable was also checked: status reports Codex unavailable without crashing the companion. The live map HTTP route was verified on a small Alamo Square selection using the OSM fallback; this did not call a model.

After the user completed the official sign-in, a live `gpt-6.1-sol` request generated a valid ten-part reading pavilion. Preview, explicit application, container JSON and GLB metadata were verified. It succeeded on the third automatic integration attempt: the first exposed a cleanup race, and the second was rejected for out-of-envelope geometry. The exact passing request/response and failure notes are retained in [the integration record](../docs/history/model-integration-04.md). No live API-key inference was performed; that route was tested with a fake transport only.
