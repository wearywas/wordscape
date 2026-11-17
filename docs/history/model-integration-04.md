# Automatic model integration check during prompt 4

This is application-feature verification performed by the root Codex agent inside reply 4. It is not additional human build direction. The user completed the app's official ChatGPT sign-in and acknowledged **“Signed in!”**; no credentials were supplied to the agent. That setup-only acknowledgement is retained in the main history separately from numbered project prompts.

Provider: installed official Codex app-server, using Wordscape's separate authenticated profile. The default selected model was `gpt-6.1-sol`. No OpenAI API key or separately billed API fallback was used. Authentication and generation consume the account's applicable allowance.

The user-facing model instruction entered automatically for the integration test was:

> Design an open-air reading pavilion with a low rectangular foundation, four slender columns, a simple flat overhanging roof, two separate benches and a small central book stand. Use warm timber, pale stone and a muted green roof. Use only axis-aligned boxes and upright cylinders so all parts fit safely inside the given envelope. This is a fictional design, not a claim about the real park.

The target was a new authored building named “Open-air reading pavilion”, 12 m wide × 12 m deep × 8 m high, centred in the separate Alamo Square test world. `server/ai.mjs` adds the spatial contract and selected object context, and supplies the recipe JSON Schema. No source websites, filesystem tools, external assets or browser tools were available to the model.

## Attempts retained

1. The first live attempt failed. Its error was masked by a Windows `EBUSY` failure while removing the Codex worker's temporary working directory. The underlying generation error was not recovered and is not asserted to be a geometry error. Shutdown now awaits process exit, retries transient directory locks and preserves the original failure. A regression test covers cleanup not replacing generation errors.
2. The second live attempt returned structured JSON but failed the shared geometry validator: the first three parts exceeded the normalized object envelope. No proposal was applied. The rejected raw model proposal was not retained by the service; its validation response is present in the original root tool history. The coordinate instructions were then clarified to specify array order, centres, dimensions, inequalities and a valid example, without weakening validation.

3. The third live attempt, with the same user-facing instruction and the corrected coordinate contract, passed validation. `gpt-6.1-sol` produced a ten-part pavilion: foundation, four columns, roof, two benches and the book stand/support. Preview did not change the world. Explicit application changed the test world's object count from 343 to 344, with every previous object byte-for-byte unchanged. Container JSON and GLB exports retained the authored recipe and generation provenance.

The complete successful HTTP request/response, actual server prompt and output schema are retained in [model-04-success.json](model-04-success.json). No credentials or account identifiers are included. [The standalone generated example](../../public/examples/reading-pavilion.wordscape.json) recentres the same shape in a small imaginary local frame; that recentering is an explicit packaging change, not another model generation.

Mocked browser integration tests are separate and explicitly marked in `scripts/studio-smoke.mjs`; their success is not represented as live inference. There were three live generation attempts in this automatic check, with no separately billed API request. No automatic repair loop was added: failed proposals remain unapplied and visible to the user.
