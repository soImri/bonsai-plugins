# Launch kit

The launch kit is one HTML page that shows what App Cards do for a person, with a tab per app. Each new app adds its tab, previews and labels. Recording uses the `product-preview` skill from the same marketplace (search `skill://` for `product-preview`; install it from the marketplace if it is missing). This file adds what is specific to App Cards.

## Find the kit

Ask the person where the team's App Cards launch kit lives and get the folder. Extend it: add the app's tab, or replace its "coming soon" placeholder. Leave every other tab, the cover and their media byte-for-byte unchanged, and check that afterwards. If nobody has a kit, build a one-app page with `product-preview`'s presentation template in the same structure, and hand it to whoever owns the team's kit.

## Page structure

- First tab: the concept, in benefit terms. The approved lead: "Move your work forward right in the conversation, without reading long replies or switching apps. Bonsai brings up the right screen, and you make the call."
- One tab per app. Its main element is a gallery: one large active preview and labeled thumbnails to switch. Only the selected preview plays or loads; switching tabs or previews stops the previous one. Arrows, keyboard navigation and Replay work. On mobile the thumbnails scroll sideways.
- Labels name the person's task, not the feature: "Plan your day", "Check it off", "Set a priority", "Find a time to meet". If a label promises a different flow than the clip shows, re-record; do not relabel.
- No page chrome about status: no audience, feature flag, merge state, "coming soon" notes on built apps, recording dates or how-it-works sections. Never narrate the UI on the page or in caption bars either. Status lives in the README.
- A cover for the announcement: 1600x900, from a genuine capture, downsampled from a larger master, never upscaled.

## Record the previews

- Record from the final build, after the last loop fixes, in the real dev app with the cards flag on. A take from before the fixes is not the preview.
- One clip per card, focused on its one decision, about 9 to 12 seconds.
- Ordinary prompts a person would type, each ending with "Just reply here, don't save anything." The dev app reads the person's local instructions, and a demo run once wrote a made-up note into their notes; check afterwards that no file outside the take's own output changed.
- Demo data only: a demo project, test workspace or sandbox account. Check its state through the app's API before each take. If a clip's job is a write (ticking off a task, setting a priority), make it on demo data and reset it through the API right after.
- Wait for the take to finish naturally. Never interrupt the agent mid-take, and never edit renderer code while recording.
- Match the existing clips: same width (800px in the Yaklabs kit, including the caption bar), the wait from sent prompt to first drawn card shortened to under 2 seconds with a visible speed label, real actions at real speed, a settled thumbnail per clip.
- Retake instead of explaining a broken frame. Keep failed takes, never overwrite them, and keep raw footage out of public repositories.

## Privacy check

Before any frame is published or shared, check every raw and encoded frame. Nothing may show an outside email address, a private or sensitive title (medical, personal), DM content, or tasks and projects outside the demo data.

1. Copy `scripts/frame-audit.mjs` and `scripts/ocr.swift` from this skill into the working folder where `product-preview`'s scripts ran `npm ci` (the audit uses its `sharp`). In Bonsai, use `write` with `source` to copy each installed file; never edit the installed copy.
2. Run it on each clip and its take's raw frames: `node frame-audit.mjs --out <audit-dir> --allow-domain <team domain> <clip.gif> <take>/frames-raw`. It decodes every frame, keeps one PNG per distinct pixel state, builds numbered contact sheets, OCRs every state (macOS Vision, or `tesseract` when installed), and exits with code 2 when it finds an address outside the allowed domains or an OCR error.
3. Open every `sheet-*.png` at full size and skim `ocr-text.tsv`. OCR finds addresses; only your eyes find a sensitive title or someone else's data. If the script reports OCR as unavailable, the visual pass carries the whole check: say so in the README.
4. Record the totals (frames, distinct states, sheets, OCR states, findings) in the kit's README.

Raw frames may include local paths in a dev footer; crop them out of the encoded clip. On any finding, re-record. Never redact, blur, redraw or invent a card. Delete the audit folder's frame images once the result is recorded: they contain the same data you were checking.

## Check and deliver

- Open the packaged page and check every tab and gallery selection at desktop (1440x900) and mobile (390x844): one preview plays, text is readable, each label matches its clip, all media resolves from the single packaged file, no overflow and no console errors.
- Look at the cover at full size.
- Publish the page, the app's previews and the cover with `publish_artifact`, and open the page with `open_artifact`.
- Write a README beside the kit: accepted takes, durations, privacy results, and what was not verified.
- A finished kit does not authorize posting or sharing. That is stage 5, with the person's approval.
