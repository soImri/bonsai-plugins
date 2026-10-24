---
name: add-connector
description: The process for giving a new connected app (Slack, Gmail, Notion…) its own cards in the connector-cards plugin: inventory what Bonsai can reach, map the app's screens, scaffold the module, write the reads, rubrics, writes and compositions, build the eval set, test in fresh sessions. Use when asked to add a connector to connector cards or to make cards for an app.
---

# Add a connector to Connector cards

A connector is one folder, `connectors/<id>/`, with four files that fulfil one contract (`runtime.ts` → `Connector`), plus a screen map and an eval set. The runtime already owns the tools, the routing, the sign-in, Jev's limits and the result envelope; the UI shell already dispatches by connector. You write only what is specific to the app. Work in the plugin's checkout (`CONNECTORS.md` there is the long form of this skill).

Do the steps in order; each one's artifact feeds the next.

## 1. Inventory: what can Bonsai reach?

Decide the data route before any design. In this order, cheapest first:

- `read plugin://<the app's plugin id>` and `help <scheme>://` for the app's URI module: what Bonsai already reads and writes, and which service id and scheme id its sign-in uses (e.g. `linear.account` / `linear.mcp-oauth`, `google.account` / `google.oauth`, `slack.account` / …).
- `read mcp://<server>` when the app ships an MCP server: its tool list is the write surface, and sometimes the only surface the token accepts (Linear's token works on its MCP server only, not its GraphQL API; Google's works on the REST API).
- The app's REST/GraphQL docs for anything the above misses.

Record the route and the sign-in ids in the connector's `SCREENS.md` header. The plugin reaches the app through a shared-identity grant: add `{service, schemes, operations: ["resolve"]}` to `kay-plugin.json` → `permissions.byTarget.kay.agent.auth`, and the user grants `auth.shared-identity` for that service on the install row (`config://settings/installs`). Until every declared service is granted, the whole agent target is refused, so declare only what you ship.

## 2. Screen map: which screens, which fields

Pick the three to five screens people have muscle memory for in the app. Two sources beat online research: the app's own screens (open it in the browser pane and look) and what the person actually asks Bonsai about it (`search sessions://` for the app's name). For each screen write one table row in `SCREENS.md`: screen → the composition name → fields shown → fields that edit → what a Save writes → what changes for chat (compact, edits batch behind Save, no navigation chrome, one record per card when the ask names one).

Every card mimics the app's UI, never a form of fields. Edits batch behind Save; no write per pill click.

## 2b. Follow-ups: the screen's own controls always live; a follow-up only adds

Rule one, from Imri on 2026-10-23: every element a card renders is interactive, as it is in the app. A pill is a picker, a tab switches, a row edits, a composer sends. Never render a disabled, read-only or dimmed version of a control, and never hide one behind a disclosure.

A **follow-up** is an additive secondary action the card gains for this ask: a comment box already open, a `+ New issue` or `+ New event` button, a composer with the draft filled in. For each screen, list the few additive actions that would save the person their next message, each with `id`, a `label` in the person's terms, `when` (the situations that make it likely), an optional `unless`, and a heuristic `guess`. Many screens have none; that is fine.

In `rubrics.ts` export them as `FollowUp[]` factories. In `index.ts` call `run.followUps(purpose, state, candidates)` in a `Promise.all` beside the composition classify, wrap the classify in `remembered(run.recall, () => jev(...))`, put the ids on the payload (`composition.followUps` for views, `followUps` for records), and return `offered: fu.actions` plus `remember: comp`. In `apply`, return `used` (what the message did: `comment`, `create`, a property name). In `ui.tsx`, `const fu = useFollowUps(ids)`; add the control when `fu.picked("id")`. Nothing else in the card reads the follow-ups.

The test: three asks with different `context` lines produce the same native controls every time and differ only in what was added. Then repeat one plain ask three times: the third must come from memory (`debug.decidedBy: "memory"`, `timing.jev: "0 ms"`).

## 2b″. Writes in the background

A card shows the change first and writes second. Use `useWrite(ctx)` from the kit for every write: set the card's state to the new value, call `w.run(message, { revert })`, and show `writeNote(w)` where a status belongs (the SaveBar's note, a footer line). For a write that creates a record, pass `onDone(details)` and show the created record from the refreshed data the endpoint returns (`details.issues[0]`, `details.event`). Never render a "Saving…" state that blocks the card, and never wait for a new card. The message grammar is the same one `apply` parses, so the background route and the chat fallback are one code path on the plugin side.

## 2c. Navigation is tailored; the screen is not

A list-type card has two layers. The screen (rows, pills, composers, click-to-edit, Save) is the app's own: always complete, always live. The navigation row (range chips, scope tabs, focus filters) is our adaptation and is cut to the ask: the asked range or scope plus its neighbour, peripheral information only when it exists (a pending-invites count), plus what Jev adds for this ask. The full set, the *golden* navigation, is drawn only for a general look ("show my calendar"), via a `full_navigation` candidate in the follow-up rubric. Compute the set in `rubrics.ts` (see `chipsFor` in gcal, `scopesFor` in linear, `inboxChips` in slack), put it on the composition, and draw exactly that in `ui.tsx`. A row with one chip is not drawn. Add evals that pin the set for a named ask and the golden set for a general one.

## 3. Scaffold

`node tools/new-connector.mjs <id> "<Label>" <serviceId> <schemeId>` creates `connectors/<id>/{index.ts, api.ts, rubrics.ts, write.ts, ui.tsx, SCREENS.md, evals.json}` from the template, registers the id in `connectors/index.ts` and `connectors/ui.ts`, and adds the auth entry to the manifest. Fill in the TODOs; the template's comments say what each export is for.

## 4. Reads, rubrics, writes, compositions

- `api.ts`: the app's calls with the bearer token; normalise records to one plain shape the UI reads; cache pick lists (10 min, stale-while-revalidate). Give records a short stable key when the app's ids are long (`#a1b2c3`) so cards can name them in plain words.
- `rubrics.ts`: what Jev is asked, most important first, at most 8 questions (the hosted route refuses more). Each answer has a heuristic twin, so a dropped question degrades to the heuristic, never to a hole. Choice criteria keys are plain tokens (`p0`, `s1`), mapped back after the answer.
- `write.ts`: a card speaks a short human grammar in the chat (`Save <ref>: field → value; …`, `Create …: <title>` + a properties line); the plugin parses it, the agent passes it verbatim. Unit-check the parser with node before wiring it.
- `index.ts`: `defineConnector({ id, label, summary, aliases, auth, triggers: { keywords, refPattern, messagePattern }, examples, filters, view, record, draft, apply })`. `apply` re-reads what it touched and returns a view/record payload so the card redraws from the app's truth.
- `ui.tsx`: compositions drawn from the kit (`ui/kit.tsx`: card chrome, Picker, SaveBar, glyphs). Read the payload from `ctx.details`; send messages with `ctx.send`; open links with `ctx.openUrl`. Export `{ id, label, component, runningText }`. Then run `node tools/build-ui.mjs`: Bonsai bundles the UI entry from its text alone, so `kay-ui.tsx` is one generated file built from `ui/entry.tsx` and every connector's `ui.tsx`; commit the output, or the previous cards keep running.

## 5. Eval set

`evals.json`: ten to twenty asks with the expected routing (`connector`, `kind`), composition (`view`, `scope`/`range`, grouping), fields, and for writes the exact parsed shape. Run them with `node tools/eval.mjs <id>`: it invokes the plugin's tools through the `kay` CLI in this session (no model turn) and compares. Keep it green before you push; it is the regression gate when a rubric's wording changes.

## 6. Test like a person

Build the UI (`node tools/build-ui.mjs`), then commit: a git commit in the plugin directory reloads the plugin (touching files or toggling the install does not). Subagents keep the parent's plugin generation, so test in fresh top-level sessions: `open_session` with a first message, then read its transcript for the tool call, its arguments, the result line and the timing. Check: one tool call and no reads before it; the connector routed as expected; the composition and fields Jev picked; the card's message round-trips through `cards_apply`. Then look at the cards yourself: the agent cannot see them, so never report a card as fixed from the transcript alone.

## 5b. Follow-up evals

Add live cases with `args.context` and `includes` / `excludes` on the follow-up path: `{ "ask": "NEAT-9", "tool": "record", "args": { "ref": "NEAT-9", "context": "triaging before Friday's review" }, "includes": { "followUps": ["priority"] }, "excludes": { "followUps": ["project"] } }`. Cover: the bare ask (few or no follow-ups), one context that should add a specific control, one that should not.

## 7. Log picks for the loop

The runtime records every pick and every correction (a property the person changed before pressing Create; a re-ask for a different view) under the plugin's data dir. Feed the recent picks for similar asks into the rubric's state so Jev sees what this person chose last time. The eval set stays the gate for rubric changes.
