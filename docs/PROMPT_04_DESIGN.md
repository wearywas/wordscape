# Prompt 4: automatic places and portable geometry

The user authorized an automatic area-to-world experiment and a model-assisted interpretation workflow, preferably using ChatGPT subscription access. Work remained in the same private Wordscape project. This document records implementation decisions made inside prompt 4, not additional human instructions.

## Parallel investigation

- Survey agent: identify available vector evidence, implement a bounded OSM conversion, retain real source extracts, connect the baseline's mapped walking paths, and document omissions.
- Renderer agent: design a portable, validated geometry recipe and render it independently of stock category assets; preserve terrain and GLB metadata.
- World-engine agent: verify official subscription authentication, implement the local AI service, then review companion security and cancellation.
- Root: integrate the area picker and proposal review UI, exercise independent geographic areas, test application flows, and maintain the build record.

## Chosen implementation

1. Use mapped vectors for automatic extraction. A coordinate, map URL, or clickable map defines a square of up to 1 km. This supports broad geographic coverage wherever suitable OpenStreetMap data exists. It does not infer details from aerial pixels.
2. Preserve uncertainty. Actual map tags carry OSM source links and edit dates. Default building heights and widths are inferred. Missing entrances stay missing. Unsupported multipolygon/courtyard geometry is reported instead of silently filled. New regions do not receive invented terrain.
3. Keep the detailed baseline. Thirteen mapped park footways become 55 connected segments inside the existing Washington Square terrain survey. The larger imported example is a separate reviewable world, so the manually investigated landmark detail is not silently replaced.
4. Extend objects with declarative geometry: up to 32 bounded parts, five primitive types, normalized to the existing object envelope. Recipes are authored visual interpretations and cannot execute JavaScript, fetch assets, or rewrite source evidence.
5. Use the installed Codex app-server's official ChatGPT authentication, with a separate Wordscape profile. Subscription limits apply. An explicit OpenAI Responses API provider is available with a server-side key and separate billing; no automatic paid fallback occurs. This is a local companion integration, not a deployed web OAuth service.
6. Generate, validate, preview, then apply. Geometry proposals preserve positions, dimensions, facts and source links. A stale world or out-of-envelope recipe cannot be applied. A model cannot silently add unselected objects or claim new surveyed facts.

## Deliberate limits

The prototype caps worlds at 1,000 placements. Large or dense areas can exceed that budget, with omissions reported. Public map services have variable availability; requests are bounded, cached, and manually initiated. A production shared service would need an appropriate data/tile provider and operational setup. Terrain fetching beyond the retained Washington Square sample, automatic reference-photo retrieval, photorealistic modeling, arbitrary executable model code, and pedestrian route guidance are outside this iteration.

Live subscription inference was verified after the user's separate Wordscape sign-in: a ten-part pavilion passed on the third automatic attempt. The failures, corrected coordinate contract and successful output are retained in the integration history. Mocked integration tests are explicitly labelled and never represented as real model generations. See BUILD_NOTES for the final verification outcome.
