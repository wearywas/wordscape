# Public snapshot and retained build history

Wordscape is published as an open-source alpha framework proposal with an example interpreter. The public repository starts from a reviewed Round 9 source snapshot. It is the same challenge project, not a restarted build or a reset prompt count.

## Why the public Git history starts here

Four user-supplied Google Maps comparison screenshots from Round 6 contain browser/Google account thumbnails and a profile badge. They had already entered older private commits, so removing only the current copies would not remove them from public history. The original repository is retained privately as `wordscape-build-history`; the reviewed public snapshot occupies `wearywas/wordscape`. No original commits, sessions or images were destroyed. The private originals remain available to the owner for judging verification.

The four screenshots are withheld in the public snapshot, with a [marked attachment notice](history/attachments/prompt-06-images-redacted.md). They were build discussion evidence, not app assets or source geometry. No Google textures/geometry were extracted into Wordscape. The rest of the readable prompt/response exports, exact user prompt files, source manifests and live application requests/results remain available, with previously marked user-path and credential redactions.

The current-tree and reachable-history audit found no committed credentials, `.env`, Codex profile, private session archive or embedded remote authentication. Git identities use the repository owner's public GitHub noreply address. Dependency licenses and source-specific dataset/imagery notices are separate from the MIT code license; see [NOTICE](../NOTICE.md).

## Publication verification

The public snapshot is commit `111005e0d21705590e1de0915851697ec8086622`, with source tree `a82b40f8f12e11fba9627c2ebcb22767dbc8e781`. It exactly matches the reviewed private Round 9 release tree; only Git ancestry differs. A verified private bundle preserves the original history, and `wordscape-build-history` remains private. The local working branch now tracks the public history; the private archive is a separate remote and must never be merged into it.

A fresh exported source checkout passed `npm ci`, all 297 tests, lint, TypeScript and the production build, then the example-opening browser workflow. An additional credential-disabled shallow clone of the actual public URL succeeded and contains none of the four withheld screenshot blobs. Anonymous GitHub API/README requests returned 200 for the public repository, while the private archive returned 404; the prior screenshot-bearing private commit was not found in the public repository. [Initial public CI](https://github.com/wearywas/wordscape/actions/runs/44011221240) passed on the exact snapshot.

## Challenge delivery status

Round 10 prepares the [final submission packet](SUBMISSION.md), recorded demonstration, verification and immutable `v0.9.0-challenge` source tag. It does not send a Discord entry. The [prompt ledger](PROMPT_LEDGER.md) discloses the unrelated abandoned project and counting convention; there is no claim of an official eligibility ruling. Automatic app integration/model tests and subagent work are retained in the build notes.

Exports made during a reply do not include that reply's final message until a later refresh. After Reply 10, `npm run history:final` verifies actual completion and refreshes the readable public exports; a later documentation-only commit can publish those exports without moving the submitted source tag. Keep original sessions until judging completes. A complete native export/shared snapshot or the event's readable ordered screenshot/recording fallback must accompany the final entry. Review and mark redactions before publication: a native share may include the original account-bearing screenshots that were withheld from Git. These readable exports are supporting evidence, not an assertion that a custom exporter replaces the required original history.
