# Workbench media

[`wordscape-demo.webm`](wordscape-demo.webm) is a short silent recording of application 0.9 using format 0.8. It shows the actual workbench, without composited UI or generated screenshots:

1. Washington Square in Words and 3D, with a selected object’s data.
2. Opening the retained Mossbell terrain example.
3. True-scale terrain and a view-only flat comparison.
4. The JSON document and its local export.

The recording uses an isolated browser and makes no model or geographic provider requests. It does not show a live generation request. Source dates and source-versus-authored evidence remain in the example files. [The manifest](demo-manifest.json) records scene timings and the video hash.

The retained clip is **32.64 seconds**, 1440 × 900 pixels, with no audio (5,783,458 bytes). Its SHA-256 is `9fec58c26d3878250d0d33c0a4e10b1b35aa9e2acabf727e73ecfc6155b65b52`. Video decoding and sampled frames were checked after recording; there were no page errors or provider requests.

| Time    | Actual workflow                                    |
| ------- | -------------------------------------------------- |
| 0–7 s   | Washington Square Words view and object inspection |
| 7–11 s  | Three.js interpretation of the same document       |
| 11–15 s | Open a retained example                            |
| 15–22 s | Authored terrain followed by flat comparison       |
| 22–25 s | Restore recorded terrain                           |
| 25–33 s | Inspect JSON and export the unchanged document     |

Mossbell's terrain revision deliberately retains its earlier world description and original brief, which describe flat ground. The explicit authored height grid records the subsequent terrain change; the recording does not rewrite that historical model output.

Production browser verification on 2026-11-18 passed all eight workflow suites: main workbench, creation studio, saved-world library, connected surveys, navigation, world generation review, framework/examples and Washington Square migration. A ninth, development-only library metadata regression also passed. The generation responses and acquisition responses in these tests are mocks or retained fixtures, not live service availability checks.

Reproduce it against an already running production preview:

```powershell
npm run build
npm run preview -- --port 4173
# In another terminal:
node scripts/record-demo.mjs
```

`WORDSCAPE_TEST_URL` and `WORDSCAPE_BROWSER` can override the server URL and installed browser channel. The script validates unchanged document state and the exported JSON. Recorded video is saved when the isolated browser context closes.

The screenshots and video depict an original application. Washington Square includes **© OpenStreetMap contributors**, ODbL-derived mapped features and public-domain USGS terrain. Mossbell is authored fiction whose layout inspiration retains separate attribution. These media do not relicense third-party source data: see [NOTICE.md](../../NOTICE.md), [sources](../SOURCES.md) and each example's source records.
