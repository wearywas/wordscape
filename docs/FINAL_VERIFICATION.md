# Final verification — Round 10

Verification is performed against the submitted application 0.9.0 / format 0.8. The final source is pinned at [`v0.9.0-challenge`](https://github.com/wearywas/wordscape/tree/v0.9.0-challenge); the completed dialogue may be added in a later documentation-only commit.

## Observed results — November 18, 2026

| Check                                               | Result                                                                                                                                                                                                         |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                                     | ESLint, **301 tests in 38 project test files**, TypeScript and production build pass.                                                                                                                          |
| `npm run format:check` and `git diff --check`       | Pass.                                                                                                                                                                                                          |
| Production browser workflows on port 4173           | **Eight suites pass:** workbench, creation studio, survey library, atlas, navigation, world generation, framework and Washington enrichment.                                                                   |
| Dev-only IndexedDB metadata regression on port 5173 | Pass.                                                                                                                                                                                                          |
| Demo recording                                      | 32.64 seconds, 1440 × 900, silent; actual terrain/flat and JSON/export video frames inspected. No page errors or external/API requests; downloaded JSON equals the open document.                              |
| Submission packet                                   | All ten prompts, two supplied-instruction records and four readable conversations retained. The checked local packet links resolve. Discord body is 1,714 characters before replacing its history placeholder. |
| Private retention                                   | Original-session hashes match the private snapshot copies. Original pre-publication Git bundle verifies.                                                                                                       |
| Publication audit                                   | Public repository accessible; four withheld account-bearing screenshot blobs absent from public ancestry. Earlier public-HEAD credential-pattern audit covered 317 blobs with no hits.                         |

The final current-tree credential-pattern scan checked 296 non-binary files, including the new history exports, with no hits. Pattern scanning supplements the specific attachment/history review; it does not prove the absence of every possible sensitive value.

The production build reports the existing initial-chunk size warning (approximately 1.24 MB minified / 289 kB gzip); it is not a build failure. Browser tests use mocks or retained provider/model responses. The atlas test's second tile is explicitly synthetic. No new model generation or paid API call was performed in Round 10, and these checks do not assert live provider uptime. Earlier successful and rejected live integrations remain in their original round records.

The final source is tagged after the published commit's [GitHub check workflow](https://github.com/wearywas/wordscape/actions/workflows/check.yml) succeeds. The post-reply history refresh is separately gated by actual session completion; it is not represented as already captured in an in-progress export.

## Final changes

This round adds submission documentation, exact combined prompt/history exports, a completion-gated export command and reproducible media capture. Test discovery now excludes ignored private checkout copies, preventing duplicated tests from inflating the reported coverage. Application behavior and source world data remain the tested Round 9 implementation.

Four new history tests verify incomplete/mismatched final-turn rejection, exact prompt/instruction retention, private-original/public-redaction separation and rejection of duplicate or malformed records. The real unfinished Round 10 export returns a nonzero status; the real Round 9 final response and completion event match and appear in the retained dialogue.

## Reproduction

Use Node.js 24, `npm ci`, `npm run check` and `npm run format:check`. Browser checks use installed Chrome against a running production preview; [CONTRIBUTING.md](../CONTRIBUTING.md) lists the commands. The dev-only IndexedDB metadata regression requires the Vite source-module endpoint.

The final test configuration explicitly discovers project tests under `src`, `server` and `scripts`. Ignored private clean-checkout archives must not be counted as additional coverage.
