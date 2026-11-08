---
name: ship-app-cards
description: "Take a connected app from no App Cards to shipped, end to end: learn the card rules, agree which of the app's screens become cards, build them in the app's bundled Bonsai plugin, run up to three eval + UX-expert rounds until each card feels like the real app, record previews and add the app to the launch kit, then merge and announce. Use when someone asks to set up, add or build App Cards (chat cards that look and work like the app) for a service such as Gmail, Todoist, Notion or GitHub, or to run the whole card process for an app. Needs a top model and the yaklabs-ai/kay repo. Not for fixing one card's bug, showing an app's records with cards that already exist, the card visual rules alone, or a launch page with no new cards."
metadata:
  version: "0.1.1"
  kay-model-tier: ultra
---

# Ship App Cards

An App Card draws one screen of a connected app inside the Bonsai chat, so the person sees it and decides without switching apps: an inbox, a task list, an event, a chart. This skill takes one app from zero cards to cards that are merged, previewed and announced. It is the process Yaklabs used for Linear, Google Calendar, Slack, PostHog, Todoist and Gmail.

| Stage | You end with | Gate before the next stage |
| --- | --- | --- |
| 1. Primer | an agreed card table and a scenario list | the person says yes to the table |
| 2. Build | cards drawing in the dev app with real data | the person has seen them |
| 3. Loop | up to three eval + UX rounds | no open blocker, or the person accepts each named one |
| 4. Launch kit | a preview per card and the app's tab on the launch page | every frame passes the privacy check |
| 5. Publish | a merged PR and a team announcement | the person's go-ahead to merge and to post |

## Before you start

Check every item and tell the person what is missing before any work. Do not start on a weaker setup.

- **Model.** Run this session on Claude Opus 5.5 at the `xhigh` (extra high) thinking level, or on Claude Fable 5.1, or on a newer top model. If the session runs anything else, stop and ask the person to switch in the model picker and start again. This session is the root: it holds hours of rulings, writes every brief, and judges whether a card really feels like the app. Those are the models the shipped App Cards were built with. Helpers run lower: builder and UX reviewer at the `large` tier, eval owner at `medium` or `large`, never `small`.
- **Time and spend.** Estimate from two runs: three to five hours and roughly $100 to $200 of model spend per app. Gmail (three cards, four rounds) cost about $55 for the root, $47 for the builder, $15 for the eval owner and $1 to $6 per UX round. Todoist's root alone cost about $98.
- **Repo.** App Cards ship inside Bonsai's own repo, `yaklabs-ai/kay`, in the app's bundled plugin (`plugins/<app>/`). You need a checkout, permission to push a branch, and GitHub connected in Bonsai. This method builds cards only there; without repo access, stop and say so.
- **A machine that runs the dev app.** A Mac that can build and launch Bonsai's dev app from a worktree (the repo skill `local-dev-worktrees` owns that).
- **The app, connected, with safe data.** The app connected in Bonsai, plus a test account, workspace or demo project a card may write to. Real accounts stay read-only until the person approves a write.
- **A plugin that already signs in.** The app needs a bundled plugin that signs in and reads (`plugins/<app>/kay-plugin.json`). If it has none, building that plugin comes first as its own agreed piece of work; model it on `plugins/linear`.

Repo skills named below live in the checkout's `.agents/skills/<name>/SKILL.md`. Once the session is rooted in a worktree they usually appear under `skill://`; if not, read the file directly.

This skill follows the repo skill `plugin-card-authoring` with two deliberate changes: the UX reviewer is read-only (the builder owns all UI code), and merging happens only in stage 5, by this session, after the person's go-ahead. Helpers never merge.

## Rules for every stage

- **Never narrate the UI.** No tagline, caption, helper line, legend or status sentence that restates what the card, its icons or its buttons show. Text is data (a name, a subject, a time, a count) or a control's own label. Empty and error states say what happened in a few words plus the action. Put this rule in every brief you write: it is the most repeated correction in this project, and a brief without it gets narration back.
- **A press by the person is the only consent for a write.** No live writes (send, save, create, RSVP, react, complete) during build, review or recording unless the person approves that write. Tests use fixtures or the app's simulator.
- **The person decides merging and posting.** Never merge, mark a PR ready, or post to Slack without their go-ahead for that action.
- **Never weaken a test to reach green.** Fix the cause, or log it as a known gap with the reason.
- **Look like the app, then cut.** Copy the app's layout, words, glyphs and order. When a control does not serve the card's one decision, remove it instead of fixing it.

## 1. Primer: learn the rules and agree the cards

1. Create a worktree of `yaklabs-ai/kay` and move the session into it before writing anything: `git fetch origin main`, then `wt switch --create <app>-cards --base origin/main --yes`, then `reroot` into the printed path. Read the worktree's `AGENTS.md`.
2. Read the repo's card method and rules: repo skill `plugin-card-authoring` and `packages/plugin-ui-sdk/docs/plugin-card-design.md`. They own the architecture (contracts, the `kay.app` and `kay.ui` halves, the 480px limit, create-once, one pinned account) and the pre-PR checklist; this skill does not repeat them. List the plugins that already have cards with `git grep -l '"cards"' origin/main -- 'plugins/*/kay-plugin.json'`, then pick the reference that reads data the way the app's plugin does: `plugins/gcal` for an app with its own REST backend, several accounts, a create card and a shared UI kit; `plugins/linear` or `plugins/todoist` for an app reached through an MCP server; `plugins/posthog` for an app that keeps per-sign-in state.
3. Find what people actually ask about the app: search past sessions (`sessions://`) and the team's Slack for its name. Look at the app's current web screens (web search for recent screenshots and help-center pages).
4. Draft the card table in the format `plugin-card-authoring` gives: one to five cards, one per distinct decision (Todoist shipped a single card), the app screen each copies, its write and save model, and a named V2 list of everything cut. Cut with the repo skill `dumbest-v1`'s questions: delete it, hardcode it, or leave it to the app behind "Open in <App>"?
5. Write the scenario list in the same pass. Format and required rows: [the review loop](references/review-loop.md#the-scenario-list).
6. Send the person the table and the V2 list in one short message and ask for a yes. One decision. Build nothing before it.

## 2. Build

1. Read [traps](references/traps.md) now. Most hours lost in earlier runs came from the issues listed there, starting with where the plugin runs.
2. Measure the data route: call the app's real reads once through the plugin and keep the responses as test fixtures. Response shapes are rarely what the docs say.
3. Spawn one builder at the `large` tier with [the builder brief](references/briefs.md#builder). The builder owns every code write; you do not edit product code in parallel.
4. The builder adds an "Interactive cards" section to the plugin's primer: each card's ref, when to use it, its required inputs, "use a card only when `ui_render` lists it, otherwise answer as before", and "after drawing a card, end the turn without describing it". Generated skill files come from the repo's generator, never by hand (repo skill `plugin-primer-authoring`).
5. Verify the builder's report yourself: re-run the plugin's card tests, typecheck, lint and the repo's static checks.
6. First look: launch the dev app from the worktree with the cards flag on ([traps](references/traps.md#dev-app)), open each card with real data, take screenshots, and show the person. Their feedback outranks every reviewer.

## 3. Loop: eval set + UX expert, at most three rounds

Read [the review loop](references/review-loop.md) before round 1. In short: each round a read-only UX reviewer compares every card with the real app, both in the live dev app at chat width (mouse, keyboard, hover, selection) and in fixtures at 768px and 360px in light and dark. A separate eval owner turns the scenario list into tests that only it edits. You rule each finding (fix, park for V2, or not a bug), send the fixes to the builder in one pass, and verify before the next round. Keep a per-round log.

Stop iterating at three rounds or when a round finds nothing actionable. Stopping is not acceptance: if a blocker or a failing must-fix eval is still open at the cap, do not move to stage 4. Send the person the open items and ask one question: another round, or accept them as named known gaps. The person can order more rounds, and findings they report themselves are must-fix.

## 4. Launch kit

Read [launch kit](references/launch-kit.md). Record one short preview per card from the final build, in the real dev app, on demo data. Add the app to the team's launch page (extend the existing kit, never start a competing one) and make sure the page has a cover. Every frame passes the privacy check before anything is shared. Publish the page, previews and cover, and open the page for the person.

## 5. Publish

1. One review round (repo skill `pr-review`), then a draft PR (repo skill `pr`) whose body walks the design doc's pre-PR checklist and lists the human decisions. A plugin new to the repo trips repo-wide guard tests; see [traps](references/traps.md#ci).
2. Merge only on the person's go-ahead. Marking the PR ready re-runs CI; merge after it passes.
3. Announce with the repo skill `pr-announce`, which owns the channel lookup and the draft. The team's usual post is one line with the PR link plus one preview GIF, such as "Todoist App Cards are now live! <PR link>" with the "Plan your day" clip; Yaklabs posts these in `#dynamic-ui`. Show the exact text for approval unless the person already approved it.
4. Merged is not shipped. Main reaches the internal build within hours and the public app at the next release, and while the `app-cards` flag exists only the people it targets see cards. Say which applies in the report, and in the post when "live" would overstate it.

## Done

The app's cards are merged, the launch page has the app's tab with previews and a cover, the announcement is posted or waiting on the person's approval, and the person has the PR link, the round log, the parked V2 list, and a plain list of what was not tested. A capped loop is not proof that everything works; the usual untested parts are the host's sign-in and error frames around a card, live effects in the real app, the agent choosing the right card, and screen readers.

## Maintaining this skill

Routing and outcome cases are in [evals](references/evals.md). Fold a new lesson into the step or trap it belongs to; do not append run stories.
