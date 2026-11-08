# Launch-kit evaluations

Test routing from the description alone. Compare it with product-preview's description; do not supply the bodies. Record actual selection, evidence, and changes. These are fixtures, not claimed behavioral results.

## Routing

| Request | Expected selection |
| --- | --- |
| Build a launch kit for my feature | launch-kit |
| Make a feature page, a few short demos, and a cover | launch-kit |
| Add the new workspace surface to our existing launch kit | launch-kit |
| Make one gallery page for our search feature, no tabs | launch-kit |
| Show three use cases and a concept preview in one offline page | launch-kit |
| We have a kit already; add the new app and leave the rest alone | launch-kit |
| The feature is ready; I need a launch page, not an implementation | launch-kit |
| Build a kit for filters; ignore the noisy roadmap notes, show only saved filters | launch-kit; do not invent roadmap tabs |
| Record one nine-second GIF of this flow | product-preview |
| Compare this button before and after the change | product-preview |
| Implement the feature first | implementation workflow, not launch-kit |
| Write this week's release digest | release-notes workflow, not launch-kit |
| Post our announcement to a channel | messaging approval workflow; not kit creation |
| Generate a fictional product screenshot | not launch-kit; do not fabricate a real capture |

## Outcome cases

Run real recording cases only in an authorized sandbox. Use fresh sessions that have not seen the expected outcome. Record run count and pass rate. An author review is not an execution pass.

| Case | Observable acceptance |
| --- | --- |
| New multi-unit feature | Concept first; every populated tab has a gallery; natural units come from this feature, not a fixed app list. |
| Single natural unit | Concept lead plus one gallery; no tablist; concept previews empty. |
| Requested coming-soon unit | Plain name and placeholder, no controls, claims, or media. Never added unasked. |
| Switch every preview and tab | Exactly one player; old image src removed; old replay Blob URL revoked; inactive GIFs not requested. |
| Keyboard and Replay | Tab and gallery arrows, Home/End, wrapping, Replay twice, and Pause/Play work; reduced motion starts on a poster. |
| Mobile | No document overflow at 390×844; thumbnail rail scrolls sideways when its content exceeds its width; selected thumb stays visible. |
| Offline package | One HTML file; all GIFs and static media embedded; no external requests, missing images, or console errors. |
| Label promises scheduling but footage only opens an event | Re-record scheduling; do not deliver a relabeled old clip. |
| System-tour lead or explanatory caption | Rewrite as a specific reader gain or task label; no helper paragraph or status footer. |
| Dependency absent | Search for product-preview; request its marketplace installation/trust as needed; no invented replacement recorder. |
| Non-CDP target | Follow product-preview's supported-capture boundary; stop instead of claiming its recorder supports native OS dialogs. |
| Final-build mismatch or broken frame | Stop and retake from the final build, never explain it away. |
| Outside email, sensitive title, DM, or out-of-set task in one frame | Audit all raw and encoded states, including rejected takes; re-record and re-audit before any publish. No redaction or masking. |
| No Swift or Tesseract | Clear OCR-unavailable message; complete visual review of all states; README says no automated OCR check ran. |
| Empty input or installed OCR execution failure without a working fallback | audit-privacy.mjs rejects empty per-input coverage and OCR failure with exit 2. Missing engines may use the explicit visual fallback. Reusing an audit output directory fails. |
| Cover has insufficient source pixels | Capture at sufficient resolution; use product-preview's cover template; downsample a larger master to 1600×900, never upscale. |
| Existing kit | Same format; unrelated tab blocks, media, and cover hashes byte-identical; no whole-kit migration. |
| Delivery | README has accepted takes, durations, privacy totals and limits; publish only inspected page/previews/cover, open page, do not post/share/merge. |

## Authoring validation

- Description-only routing: 14/14 expected selections in one independent evaluation. No skill body was supplied.
- Synthetic browser run on Node 24 and Chromium: multi-unit 469 assertions, single-unit 197, requested pending unit 371. Zero failures at both 1440×900 and 390×844.
- Missing media, remote media, invalid single-unit concept, and animated-thumbnail fixtures were rejected as expected.
- Shared frame audit and Swift OCR copies stayed byte-identical. The wrapper passed synthetic coverage (4 frames, 4 states, 2 sheets, 4 OCR states, no findings), reported missing OCR clearly, and rejected empty input, stale output, failed installed OCR, and an outside synthetic address. The allowed-domain parameter was exercised.
- Representative desktop and mobile screenshots and synthetic contact sheets were inspected. Covers in the smoke kit are solid-color test images, downsampled from 3200×1800 to 1600×900.
- Not executed: real product recording, genuine capture/cover rendering, real-kit extension, Tesseract, non-macOS runtime, marketplace installation, or Bonsai delivery. These tests do not certify live privacy or copy truth.

## Mechanical smoke test

Use only synthetic media here. It proves page behavior, not real capture quality or privacy. Copy product-preview's dependency manifests into a tools folder outside the skill source and run `npm ci` there. Keep node_modules and all output outside this skill.

```sh
node <launch-kit>/scripts/smoke.mjs --out <scratch> --tools <preview-tools>
node <launch-kit>/scripts/package-page.mjs --input <scratch>/multi/index.html --output <scratch>/multi/launch.html
node <launch-kit>/scripts/check-page.mjs --page <scratch>/multi/launch.html --tools <preview-tools> --out <scratch>/multi/checks
```

Repeat package/check for `single` and `pending`. Pass `--browser <path>` when using an existing local Chromium. Otherwise install the matching Playwright Chromium in the tools environment. All runs must have zero failures at 1440×900 and 390×844.

The generator also writes negative fixtures. Packaging `bad-missing/index.html`, `bad-remote/index.html`, and `bad-single/index.html` must fail. Checking `bad-static/launch.html` must fail because its thumbnail is animated. Keep these expected failures separate from positive results.

Before publishing the skill, check that every relative Markdown link resolves. Scan all files for personal paths, names, emails, and private source references. Compare the audit and OCR copies byte-for-byte with their source; they should not drift. Report any routing, real-recorder, visual, cross-platform OCR, or delivery paths that were not executed.
