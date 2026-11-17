# Contributing

Wordscape is an alpha framework proposal with a reference workbench. Changes should improve the portable record, its interpreters or the ability to inspect evidence. A new rendering effect does not automatically require a format field; a new structural capability may.

## Run and verify

Use Node.js 24 and the committed lockfile. In PowerShell:

```powershell
npm ci
npm run dev
```

The workbench is at `http://127.0.0.1:5173`; the local companion uses port 8787. No provider account is needed for examples, manual edits or local geometry recipes.

```powershell
npm run check
npm run format:check
```

For interface changes, run the relevant browser suite against a running server. Installed Chrome is the default browser channel; `WORDSCAPE_BROWSER` and `WORDSCAPE_TEST_URL` can override the channel and URL.

```powershell
node scripts/framework-smoke.mjs
npm run test:browser:worlds
npm run test:browser:navigation
```

Other browser suites cover the editor, creation studio, saved library and atlas composition. Their provider responses are retained fixtures or explicit mocks; do not introduce live model calls or geographic queries into routine tests. Generated screenshots and exports belong in ignored `test-results/`.

## Keep changes reviewable

- Explain the concrete problem, resulting behavior and checks performed. Include desktop/mobile screenshots when the interface changes.
- Keep core document logic independent of React and scene engines. See [interpreter guidance](docs/INTERPRETERS.md).
- For format changes, update types, schema, validation, migration behavior, meaningful round-trip tests and [FORMAT.md](docs/FORMAT.md). Reject unsupported data rather than silently dropping it. Preserve historical examples unless a migration is explicit.
- Preserve source facts and provenance. Mark authored or inferred values honestly; missing coverage is not measured zero.
- Keep provider requests bounded and cancellation-aware. Never put credentials in client code, fixtures, exported worlds or commits. API billing must remain an explicit choice.

## Data and licenses

Code and original authored documentation use the repository's [MIT license](LICENSE). Third-party data and imagery retain their own terms; consult [NOTICE.md](NOTICE.md), per-source metadata and [source documentation](docs/SOURCES.md). OSM-derived examples require OpenStreetMap attribution and ODbL compliance. Do not assume that permission to view an online image also permits copying its tiles into a portable world.

When adding a real-data example, retain its source, date, license, processing notes and known omissions. Use small reproducible fixtures and avoid personal contributor metadata that the feature does not need. A manually authored example should say so and should not invent a geographic survey provenance.

The [documentation index](docs/README.md) separates current guidance from historical build records. Keep existing history paths stable when updating public documentation.
