# Portable recording

## Prerequisites

Node.js 22 or later and network access for `npm ci`. The target must expose Chromium's DevTools Protocol (CDP) on a loopback address. Find the address from the app's documented dev launcher; use current repository guidance, not a port copied from another take. Do not expose remote debugging publicly. Signed-in page access and the agent's integration credentials are separate.

Copy every file in `scripts/` to an empty writable folder. This includes `package.json`, `package-lock.json`, the recorder, encoder, scenario and scene examples, and smoke test. Run commands from that copied folder:

```sh
npm ci
```

This installs the local `playwright` and `sharp` packages. Recording attaches to an existing Chromium instance; it does not download or start another browser. Only the synthetic browser test needs `npx playwright install chromium` (and Linux system libraries if Playwright reports them missing).

## Adapt the scenario

Copy `scenario.example.mjs` to `scenario.mjs`. Inspect the running target with the available browser/live-verification tools first. Implement these hooks:

- `prepare(ctx)`: open a dedicated demo surface and verify that no previous run/queue is active there. Set the owned scope for cleanup before the first mutation. No scenario input has been sent yet.
- `run(ctx)`: mark events and use observed locators to perform the flow. Verify typed text before sending; wait for real state changes. Use `ctx.glide(locator)` for a visible pointer, `ctx.type(locator, text)` for verified typing, `ctx.mark(name)` for event times, and `ctx.wait(ms)` for deliberate reading holds. `ctx.expect` is Playwright's assertion API.
- `cleanup(ctx)`: stop and verify only work created by this scenario, discard its queued messages, and leave unrelated sessions alone. It is called even if prepare/run fails. Throw if cleanup cannot be verified. Use the scope established before input, never whatever chat happens to be active after navigation.

The shipped example fails closed until adapted; it never sends a canned task or presses a guessed button. All hooks get `page`; they may share scenario-local variables. Keep selectors and prompts in the scenario, not the reusable recorder.

## Run

Set the three required environment variables using your shell. These are illustrative values, not discovery defaults:

```sh
DEMO_CDP=http://127.0.0.1:<actual-cdp-port> \
DEMO_PAGE=http://localhost:<actual-page-port>/ \
DEMO_OUT=<absolute-new-take-directory> \
node record-preview.mjs ./scenario.mjs
```

On PowerShell set `$env:DEMO_CDP`, `$env:DEMO_PAGE` and `$env:DEMO_OUT`, then run the same Node command. `DEMO_OUT` must not already exist, so a retake cannot mix old/new frames. The endpoint is loopback-only and page matching is exact. If zero or several pages match, the script lists the ambiguity and stops. Never pass a production debugging endpoint.

Optional `DEMO_TIMEOUT_MS` bounds the scenario (default 180000). Hooks must use bounded waits; the deadline signals `ctx.signal`, and the built-in `ctx.wait()` is cancellation-aware. Cleanup has its own 30-second bound and fresh helpers. The first SIGINT/SIGTERM requests cancellation and cleanup; a second forces exit and requires manual cleanup. If a scenario ignores cancellation for more than two seconds, the recorder disconnects without racing it against cleanup, marks manual cleanup required, and fails the take. Check the sandbox before any delivery.

The recorder saves page frames at up to 10 fps, preserving the final frame of a burst. It takes explicit first/last snapshots so static endings remain reproducible. It adds only a pointer and click rings, removes those overlays afterward, detaches CDP and disconnects its automation client. It does not shut down the running app.

A failed take retains `events.json` with its error and cleanup outcome. Never encode/deliver it as a successful preview. The recorder does not automate sign-in, grant permissions, audit arbitrary filesystem writes, or prove backend persistence.

## Edit the scene plan

Copy `scenes.example.json` into the take as `scenes.json`. Each segment is:

```text
[mode, scene-number, from-event, from-offset-seconds, to-event, to-offset-seconds, view]
```

`real` preserves elapsed time at 10 fps. `wait` compresses waits longer than 5 seconds and displays the rounded speed factor. `view` is `window` by default. Optional `crop` is `{x,y,w,h}` in page CSS pixels; use `view: "crop"` only after measuring it from this take. The full window is letterboxed to the same output dimensions for segments that need context. Source dimensions must stay fixed for a take; make separate takes for viewport comparisons.

Use factual captions of at most 55 characters. The caption bar is outside the UI. Actions must not be mislabeled as waits. Event offsets must stay within the recorded interval; do not extend a missing answer with a held earlier frame.

```sh
node make-preview-gif.cjs <take-directory> 800
```

Review `contact.png`, `poster.png`, the looping GIF and `gif-proof.json`. The proof includes source/output dimensions, duration, frame count, actual speed factors, and cleanup status. Encoding can use substantial memory; start with a short take and 800px width. The encoder rejects plans above its bounded pixel budget instead of exhausting memory.
