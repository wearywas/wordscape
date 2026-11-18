# Wordscape — Ten Prompt Build submission packet

**A portable world document. Many possible interpretations.** Wordscape is an open-source alpha framework proposal for world builders, tool developers and AI agents. It records named objects, metre-based placements, dimensions, relationships, terrain and evidence in editable JSON. A surveyed place and an imaginary place use the same contract. The bundled Words map and Three.js workbench are example interpreters, not a promise of universal engine support or photorealistic reconstruction.

The [public repository](https://github.com/wearywas/wordscape) is the deliverable; no hosted service or paid account is required to try the included examples. The [short silent demonstration](media/wordscape-demo.webm) shows the actual workbench using retained examples, without a live generation request. See its [recording notes and manifest](media/README.md).

## Submitted source and quick start

Application **0.9.0**, document format **0.8**. The immutable submission tag is [`v0.9.0-challenge`](https://github.com/wearywas/wordscape/tree/v0.9.0-challenge). History exports refreshed after the final response may appear in later documentation-only commits; the tagged application remains the submitted version.

```powershell
git clone --branch v0.9.0-challenge https://github.com/wearywas/wordscape.git
cd wordscape
npm ci
npm run dev
```

Use Node.js 24 and open **http://127.0.0.1:5173**. Choose **Examples** to inspect Washington Square, Mossbell's authored terrain or another retained world. Open Words, 3D world and Document; select objects; enable Edit mode to change placements; export JSON or GLB. The [demo guide](DEMO_GUIDE.md) explains the rest. Live map services and optional model generation require their respective network/provider access; the loopback companion must not be exposed as a public service.

## How the ten were spent

[Every prompt in order, with one-line outcomes](history/prompts-all.md) · [Prompt ledger](PROMPT_LEDGER.md) · [Supporting instructions](history/supporting-instructions.md)

| Prompt | Main contribution                                                                         |
| ------ | ----------------------------------------------------------------------------------------- |
| 1      | Aerial-based Washington Square specimen, spatial document, Words/3D views and export.     |
| 2      | Containers, sourced facts and references, finer imagery and explicit Edit mode.           |
| 3      | Sourced elevation, grounding and a survey/evidence notebook.                              |
| 4      | Bounded map import, declarative geometry and an optional local model connection.          |
| 5      | Coastal water, automatic terrain/aerial references and saved surveys.                     |
| 6      | Adjacent survey composition, wheel zoom and human-scale walking.                          |
| 7      | Imagined-world creation, existing-world iteration and a twenty-window layout study.       |
| 8      | Ten concrete reference Wordscapes, layout controls and inspectable model context.         |
| 9      | Actual authored terrain, framework-first presentation, public docs and a richer baseline. |
| 10     | Final verification, recorded demonstration and this submission/history packet.            |

The original dialogue retains a setup-only **“Signed in!”** acknowledgement between prompts 4 and 5. It contains no feature direction and is disclosed as excluded setup. Automatic model calls, subagents and failed integration tests are retained, not counted as new human prompts. The separate, earlier two-prompt ghost-photography game stopped after a context-full error. No application code or design was reused. The owner considers Wordscape a fresh project based on Discord chatter; this is not an official eligibility determination. That separate project's original history is not included here.

## Build notes and disclosures

- **Client and models:** Codex Desktop on Windows, recorded runtime `0.169.0-alpha.11.1`, with `gpt-6-astra` recorded for the main build session and inherited automatic subagents. Application integration tests separately used `gpt-6.1-sol` through the official local Codex provider. Consult the generated [history manifest](history/export-manifest.json) for observed session metadata rather than inferred product labels.
- **Starting point:** empty directory on November 15, 2026; no copied starter or pre-built application features. React, TypeScript, Vite, Three.js and other standard libraries are recorded in the lockfile. Codex authored the code and configuration.
- **Instructions and skills:** user-supplied standing/project instructions are retained in the history. The all-round skill disclosure, exact implementation decisions, failed attempts and verification details are in [BUILD_NOTES.md](BUILD_NOTES.md). Skills provided workflow guidance; AI assistance was through Codex/ChatGPT only.
- **Manual work:** the owner wrote briefs, supplied screenshots, opened comparison maps, completed sign-in, restarted the computer and tested the UI. Existing tooling/authentication were setup. No manual application feature or bug-fix coding was reported. Final history export, review, sharing and Discord wording/link edits are submission work; any extra manual changes should be disclosed when posting.
- **Scope:** generated layouts can overlap routes; walking and procedural foundations are approximate. Real map coverage is incomplete and mixed-date. Facts, estimates, authored geometry and unknowns are distinguished. The framework is an alpha proposal, not an established standard or packaged SDK.
- **Size claim:** the three-object minimal example is 1,617 compact UTF-8 bytes. This excludes interpreters, dependencies and external imagery/assets. It is not a compression ratio against an equivalent finished 3D world.
- **Licensing:** code, schema and original documentation are MIT. OpenStreetMap-derived data and other source imagery/data retain separate terms and attribution. See [NOTICE.md](../NOTICE.md). No Google 3D geometry or textures were extracted.
- **Publication:** the public Git history starts with a reviewed Round 9 snapshot because four earlier Google Maps screenshots contained account UI. Original Git history, sessions and images remain private for judging; [PUBLICATION.md](PUBLICATION.md) records the snapshot relationship and redactions.

## History and verification

[Main dialogue](history/main.md) · [Survey agent](history/survey.md) · [World-engine agent](history/world_engine.md) · [Renderer agent](history/renderer.md) · [Manifest](history/export-manifest.json)

The readable exports preserve recorded public dialogue with marked redactions. They omit internal reasoning and tool traces; some automatic inter-agent message bodies in the local session format are encrypted, so the exporter marks them as unavailable rather than fabricating text. Original session files are preserved privately. These custom exports are supporting evidence, **not a claim to replace the event's full-session export/share or screenshot/recording requirement**.

The manifest reports whether it actually contains the final Round 10 assistant response and matching completed-turn event. A snapshot made during the turn is necessarily incomplete. [Final verification](FINAL_VERIFICATION.md) records the automated and browser checks. Earlier live generation results, including rejected proposals, are linked from the [ledger](PROMPT_LEDGER.md).

## Owner's final steps — after Reply 10 has finished

**What:** attach a complete, reviewed conversation artifact and post the prepared entry. **Why:** the final response does not exist in the session file until the turn ends, and only the owner should send the Discord entry. Allow approximately 5–15 minutes for export/review; a full screenshot fallback may take longer.

1. **Refresh the final readable history.** In the project directory, run `npm run history:final`. It must report that Round 10 is complete. If it reports an active/incomplete turn, wait for the assistant to stop and run the same export command again; no new AI prompt is needed. It never modifies application code or publishes private originals.
2. **Publish only the refreshed public history.** Review the marked public redactions, then run the following commands. Do not add `.history-private`, native raw exports or private Git ancestry. This documentation-only commit leaves the submission tag fixed.

   ```powershell
   git add -- docs/history docs/PROMPT_LEDGER.md
   git diff --cached --stat
   git commit -m "docs: capture completed tenth reply"
   git push origin main
   ```

3. **Save a complete original-session artifact.** Use the client's full-conversation export/share after completion, or the event's fallback of readable ordered screenshots/a recording of the full conversation. Review before publication: the original thread contains four account-bearing Round 6 screenshots that were deliberately withheld from the public repo. If sharing cannot redact those attachments, use marked-redaction screenshots/recording instead. Keep unredacted originals private. Include the automatic-agent conversation history or supporting exports and preserve its originals too.

   A documented CLI route is available to try from this project directory, without sending another build prompt:

   ```powershell
   codex resume 01a1e1f7-817a-7811-8ab8-0c113f98b64b
   ```

   Inside the resumed CLI, run `/export .history-private/wordscape-native-session.md`. The installed CLI's resume syntax was checked, and [OpenAI's export instructions](https://learn.chatgpt.com/docs/developer-commands?surface=cli#export-a-conversation-with-export) document saving the completed conversation this way. The actual completed-session export has not been performed during this active turn. Check that the output includes the last reply and represents attachments adequately; keep this raw export private until reviewed and produce a marked-redaction public copy or screenshot fallback as needed. Do not type the slash command as a new message to this build conversation.

4. **Check links as a judge.** Open the repository, submitted tag, demo, prompt list and history artifact signed out. Confirm the full history includes the last assistant response and the prompt attachments or clearly marked redactions. Add the complete artifact link/attachment to [DISCORD_ENTRY.md](DISCORD_ENTRY.md), replacing its bracketed line.
5. **Post the entry yourself** as a reply in the supplied **Ten Prompt Build: Rules & Submissions** thread before **Sunday, November 22, 2026, 11:59 PM as shown in the supplied Discord notice**. The draft is sized for one normal Discord message. Retain the submitted source, original sessions and private Git bundle until judging is complete. Retain the separate failed concept's original history as well if available for eligibility questions.

**Success:** the posted entry links an accessible repo/source version, short description/demo, all ten prompts and instructions, build disclosures, and a complete reviewed conversation artifact. No additional feature request or “done” reply is needed. Exporting/sharing alone does not spend an eleventh build prompt under the supplied rules. This repository does not automatically submit to Discord.
