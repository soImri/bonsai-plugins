---
name: product-preview
description: "Record a short, captioned GIF of a real product flow, a matched before/after comparison, or a feature walkthrough. Includes a portable Chromium/CDP recorder, GIF encoder, review images, and optional presentation-page and cover templates. Use when asked to make a product preview, demo recording, or feature GIF. Not for implementing the feature, fabricated UI animations, static mockups, or posting the result."
metadata:
  version: "0.1.0"
  kay-model-tier: medium
---

# Record a product preview

Show a real product doing the real flow in under a minute. Keep actions at real speed. Shorten only waits, with a visible speed label. Put one plain caption above each scene. Do not redraw answers, hide errors, or alter the recorded UI; a drawn pointer and click rings are the only capture overlays.

## Set up the take

1. Identify the feature, the version to show, and the states that prove the change. Plan three to six scenes with short factual captions. For before/after, record the old version before replacing it and repeat the same task, crop, timing and revealing interactions in both takes (including hover or narrow-window states when relevant).
2. Use an already-running, signed-in development or sandbox instance. Read its repository's current launch and live-verification guidance if you must start one. Discover its actual CDP endpoint and exact page URL; never assume ports, checkout paths, app names, user names or screen size. These scripts support Chromium pages, including Electron renderers with CDP enabled. They do not capture native OS dialogs. A non-CDP target needs that platform's supported recorder; do not claim this script supports it.
3. Read [the recording guide](references/recording.md). Copy this skill's `scripts/` folder to a writable working directory of the user's choice. In Bonsai, list the installed skill's scripts and use `write` with `source` to copy each one. Never edit the installed copy or assume its on-disk location. Run `npm ci` in the copied directory. Runtime dependencies are pinned in `package-lock.json`; no Kay checkout, pnpm cache, Swift, screen-capture permission or global media tools are required.
4. Adapt `scripts/scenario.example.mjs` into `scenario.mjs` using current observed selectors. The recorder requires explicit prepare/run/cleanup hooks. Prepare a dedicated demo chat or page; verify it is idle. Cleanup must stop and verify only the runs and queued work created by this take, including after failure. Never use a global stop-all or close someone else's chat.

## Protect real data

Use invented, non-sensitive demo content and sandbox destinations. Do not send, save, publish or mutate real accounts just to make a demo. For assistant demos, append “Just reply here, don't save anything” to every prompt, including helper prompts. This is not a permission boundary: use a sandbox and withhold write-capable tools where possible. Do not approve tool or sign-in prompts during recording.

Identify writable locations from the app's current instructions and configuration. Snapshot relevant files before the take and compare afterward, excluding the take's own outputs. Inspect differences before attribution: another session may be writing at the same time. Report unexpected changes; do not delete or revert unrelated work. Do not assume any particular vault or archive exists.

## Record and review

1. Set explicit `DEMO_CDP`, `DEMO_PAGE` and `DEMO_OUT` values, then run the recorder as described in the guide. It streams the page's actual frames without raising the native window. Do not resize, navigate away, change renderer code or interact with the demo page mid-take. If the chosen method needs focus or screen takeover, tell the person before starting.
2. Mark each scene boundary; wait on actual UI state, not a guess about model latency. Keep reading holds long enough to understand the result. Stop on unexpected UI, capture errors, missing answers or cleanup failures. Retake instead of explaining a broken frame.
3. Fill `scenes.json` from the recorded event names; `scripts/scenes.example.json` shows the format. Encode with `node make-preview-gif.cjs <take-dir> 800`. The encoder checks recording success, time bounds, geometry and event names. It outputs the GIF, `contact.png`, `poster.png` and `gif-proof.json`.
4. Inspect the contact sheet and poster at full size, and play the GIF. Check true captions, readable text, relevant final state, no private content, unexpected toasts or clipping, and visible labels on sped-up waits. Verify cleanup and the protected-file comparison. A visual recording proves only what it shows; verify saving or persistence separately if claimed.

## Deliver

Archive the recording frames, events, scene plan, exact scripts as run and a short README beside the final GIF in a user-chosen folder. Name the feature/version and state what was and was not verified. Keep working scripts and private raw footage out of public repositories.

In Bonsai, publish the final GIF with `publish_artifact` and open the returned URI with `open_artifact`. A presentation page or social cover is optional: read [presentation guidance](references/presentation.md) and use the bundled templates. The templates work without private brand assets or commercial fonts. Use only authorized brand assets if requested.

Posting, sharing a link or sending the result is separate. Obtain approval for the exact destination, text and attachments. Do not claim a marketplace install or recipient delivery from a repository push alone.

Done means the person can view the inspected preview, recording-owned work is stopped, side effects are checked, and reproduction files are findable. For maintenance, run the tests and cases in [the evaluation guide](references/evals.md).
