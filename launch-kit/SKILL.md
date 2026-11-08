---
name: launch-kit
description: "Build or extend a feature launch kit: one portable HTML launch page, short real-product previews, and an announcement cover. Use for 'build a launch kit for <my feature>', multi-preview feature pages, or adding a surface to an existing kit. Composes product-preview for recording. Not for a lone GIF, feature implementation, recurring release notes, or posting an announcement."
metadata:
  version: "0.1.1"
  kay-model-tier: medium
---

# Build a launch kit

Deliver one self-contained HTML page, short previews, a cover, and a README.
Work in a folder the person chooses. Keep private raw footage out of public repos.

## Hard rules

- Never narrate the UI. No tagline, helper line, caption, or label that restates the screen. Text is data, a task label, or the value lead.
- No status chrome: audience, feature flags, merge state, recording dates, or how-it-works sections. Status and provenance belong in the README.
- Use demo data only. Never redact, blur, redraw, or invent a recorded frame. Re-record a bad take.
- A finished kit never authorizes posting, external sharing, or merging. Get explicit approval for those actions.
- Put these rules in every brief for a helper that writes copy, builds a page, records, or makes a cover. Read [copy rules](references/copy.md) before writing.

## 1. Set the scope

1. Find the feature's existing kit. Ask for its folder if unknown. Read its page, media layout, and README.
2. Confirm the final build and the natural units to show: apps, surfaces, or use cases. Do not infer a roadmap from old material.
3. List the person's tasks and the real flow each preview must show. Aim for one 9–12 second clip per task. Use ordinary prompts.
4. If extending a kit, preserve its format. Hash unrelated tab source blocks, media, and the cover before editing. Compare afterward. Leave them byte-identical. Change only the requested unit and necessary navigation. Do not migrate the whole page to this template.

## 2. Compose the recorder

Search `skill://` for `product-preview` and read its installed root. If missing, install it from https://github.com/soImri/bonsai-plugins through Bonsai's marketplace workflow. Installation or source trust may need the person. Stop recording until it is available.

Follow its recording guide, cleanup, protected-file comparison, and encoding checks. Do not write a second recorder. Copy its scripts to a writable kit tools folder and run `npm ci` there. Use that same folder for this skill's scripts; no extra npm packages are needed. Copy installed supporting files with `write` and `source`, not guessed disk paths.

Record the final corrected build in a sandbox. For assistant demos, append “Just reply here, don't save anything” to every prompt. This is not a security boundary; withhold real write access. Verify demo state before a take. Reset only recording-owned demo mutations afterward. Retain failed takes separately.

This kit narrows product-preview's captions: use one task per clip. Scene captions must be short task labels, not explanations of buttons or the UI. Keep its visible speed label on compressed waits. Retake a broken frame. If the label promises a flow the clip does not show, re-record that flow; do not merely relabel.

## 3. Build the page and cover

For a new kit, copy [the page template](templates/launch-page.html) to the kit as `index.html`. Edit its `kit-data` JSON. The template has no external fonts or brand assets.

- Put the concept/value first. Write the lead about better work and the pain it removes.
- With several natural units, use a concept tab, then one tab per unit. Every populated tab has a gallery, including the concept.
- With one natural unit, use the concept lead plus one gallery without tabs. Keep the concept's `previews` empty in this case.
- Each preview has a task `label`, a GIF `src`, a verified settled static `poster`, and a static `thumbnail`. Use relative media paths. Make thumbnails from accepted posters with Sharp, at most 320px wide, without enlargement. Do not use opening/loading frames.
- Add `pending: true` only for a unit the person explicitly asks to include as coming soon. Give it `previews: []`. Show only its name and “Coming soon”; invent no capabilities.
- Keep one large active preview and labeled static thumbnails. Only the selected GIF loads or plays. Switching tabs or previews removes the old image and revokes its replay URL. Keep arrows, keyboard navigation, Replay, Pause/Play, and sideways mobile thumbnails.

Read product-preview's presentation guide. Copy and reuse its `templates/cover.html`; do not copy that template into this skill. Use a genuine high-resolution capture from an accepted flow. Render a larger master (3200×1800), then downsample to 1600×900 with Sharp. Verify source pixels are sufficient for its displayed size. Never upscale a screenshot or the cover. Inspect the final cover at full size. Do not use image generation for product UI.

## 4. Audit privacy before publishing anything

Copy [frame-audit.mjs](scripts/frame-audit.mjs), [ocr.swift](scripts/ocr.swift), and [audit-privacy.mjs](scripts/audit-privacy.mjs) beside the copied product-preview scripts. The first two are unchanged shared copies. Run the wrapper from that tools folder:

```sh
node audit-privacy.mjs --out <new-audit-dir> --allow-domain example.com <clip.gif> <take>/frames-raw
```

Replace the domain with the person's explicitly allowed domain. Repeat the flag for more domains. Omit it to flag every email. A matching domain does not make private data safe.

Audit every raw and encoded frame of every take, including rejected takes. Audit the genuine cover capture and final cover too, using a folder of PNGs. Keep input paths distinct. Use a fresh output directory every time. The audit decodes every frame, deduplicates identical pixel states, writes numbered contact sheets, and OCRs each state. The wrapper rejects empty coverage and a failed installed OCR engine without a successful fallback. Exit 2 also means an outside address or OCR error; resolve it before delivery. Compare `coverage.json` with the take's recorded and encoded frame counts. A script cannot detect an omitted input.

Open every contact sheet at full size. Inspect every distinct state; open individual state PNGs when text is small. Read `ocr-text.tsv`. Check outside addresses, sensitive titles, DMs, and all data outside the demo set. OCR cannot certify those. Any privacy finding means re-record, then re-audit. Do not crop away a finding to pass.

Swift OCR runs on macOS. Other systems use Tesseract when available. If neither works, the script reports OCR unavailable and still creates sheets. Complete the full visual pass and record that OCR was not run. Never call it an automated privacy pass. After recording the results, remove only audit-generated frame images with the person's retention policy; never delete source takes or unrelated files.

## 5. Package and verify

Copy [package-page.mjs](scripts/package-page.mjs), [check-page.mjs](scripts/check-page.mjs), and [kit-data.mjs](scripts/kit-data.mjs) to the tools folder. The packager inlines media without npm dependencies. The checker reuses product-preview's Playwright and Sharp. Node.js 22+ is required.

```sh
node <tools>/package-page.mjs --input <kit>/index.html --output <kit>/launch.html
node <tools>/check-page.mjs --page <kit>/launch.html --tools <tools> --out <checks-dir>
```

Use a local Chromium executable with `--browser <path>` if provided by the environment. Otherwise install Playwright's Chromium from the copied tools folder (`npx playwright install chromium`); follow its platform dependency guidance. Do not depend on a product checkout's node_modules.

The default checks run at 1440×900 and 390×844. They cover every tab, selection, direct hash, arrows, keyboard, Replay, reduced motion, static thumbnails, unloaded old clips, offline assets, overflow, and console errors. They save JSON proof and screenshots outside the skill source. Resolve every failure. For an existing format, adapt a kit-local checker to the same checks; this script intentionally validates this template's contract.

Then inspect both sizes visually. Play every clip and compare the visible task with its label. Check readability, settled thumbnails, the final build, the cover, and privacy. Automated geometry and OCR are not proof of truthful copy or legible UI. Record anything unverified.

## 6. Deliver in Bonsai

Write a README beside the kit. Include accepted takes, durations, build identity, source/media paths, cover dimensions, privacy totals (raw/encoded frames, distinct states, sheets, OCR states/errors/findings), visual-review result, checks, preservation hashes, and anything not verified.

Publish the inspected page, previews, and cover with `publish_artifact`. Open the page with `open_artifact`. Publish only after the privacy gate. Keep working scripts, raw frames, rejected takes, and audit images private.

If asked, draft announcement text for approval: value lead, page link, one preview. Never post it. Get the person's explicit go-ahead for any external share or merge.

For maintenance, use [routing and outcome cases](references/evals.md) and the [synthetic fixture generator](scripts/smoke.mjs). A synthetic template test does not verify a real recording, privacy, or delivery.
