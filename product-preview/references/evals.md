# Maintenance and evaluation

Run from a fresh writable copy of `scripts/`, not the installed skill:

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

The first test suite generates tiny synthetic image fixtures. It tests the encoder outside a checkout, GIF/review output, speed labels, measured cropping, and refusal of failed takes, missing events, time overruns, bad paths, mixed geometry and invalid plans. It also checks that recording has no implicit endpoint.

The browser smoke test starts a disposable headless Chromium profile and a synthetic page. It tests actual CDP frames and input, cleanup on success/failure, overwrite refusal, and disconnect without closing the target. It does not use a signed-in app, model calls, real accounts or a user's browser. Browser binaries and Linux system libraries are test-only prerequisites.

## Routing cases

Evaluate using only the skill's name and description alongside neighboring build, static-design and publishing descriptions. Do not supply this body to a routing evaluator.

| Request | Expected selection |
| --- | --- |
| Make a 30-second preview GIF of the new flow | product-preview |
| Record the feature so I can show the team | product-preview |
| Show the old and new tooltip side by side | product-preview, if real recordings are requested |
| Make a captioned walkthrough of the dev app | product-preview |
| Here's a bunch of release notes; just show the two changed controls in a GIF | product-preview |
| Implement the new tooltip and open a draft PR | build workflow, not this skill alone |
| Draw a static mockup of the feature | static-design workflow |
| Animate fictional UI for a landing-page hero | animation/design workflow |
| Post this existing GIF in Slack | messaging/publishing workflow |
| Which port is the dev app using? | live-instance inspection, not a recording |

## Outcome cases

- A machine with no Kay checkout or developer cache: local `npm ci` must suffice for tools; discover the app endpoint and exact page separately.
- Two matching pages or no matching page: stop before input; do not choose the first page.
- A non-Chromium native dialog: explain that CDP page capture does not include it; use the platform's supported method or report the gap.
- A demo run tries to write real data: do not grant permissions. Stop, inspect side effects and retake in a sandbox.
- A real-answer wait exceeds the planned length: mark the actual event, label sped-up waiting, or retake. Never fabricate the answer or extend capture past its bounds.
- A failed action after input: cleanup must target only this take's work. Preserve failed evidence and do not deliver it as a successful preview.
- Before/after: the actual hover/narrow-state difference must be visible in both matched takes, not merely described in captions.
- Optional page: no private brand repository required; all local assets must package and Replay/reduced-motion controls must work.

Keep execution evidence and release results in the contribution record/commit description. Distinguish automated synthetic checks from a real signed-in product take and from an actual install on another person's computer. Do not claim those unexercised cases passed.
