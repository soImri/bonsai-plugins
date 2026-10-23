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

## 3. Scaffold

`node tools/new-connector.mjs <id> "<Label>" <serviceId> <schemeId>` creates `connectors/<id>/{index.ts, api.ts, rubrics.ts, write.ts, ui.tsx, SCREENS.md, evals.json}` from the template, registers the id in `connectors/index.ts` and `connectors/ui.ts`, and adds the auth entry to the manifest. Fill in the TODOs; the template's comments say what each export is for.

## 4. Reads, rubrics, writes, compositions

- `api.ts`: the app's calls with the bearer token; normalise records to one plain shape the UI reads; cache pick lists (10 min, stale-while-revalidate). Give records a short stable key when the app's ids are long (`#a1b2c3`) so cards can name them in plain words.
- `rubrics.ts`: what Jev is asked, most important first, at most 8 questions (the hosted route refuses more). Each answer has a heuristic twin, so a dropped question degrades to the heuristic, never to a hole. Choice criteria keys are plain tokens (`p0`, `s1`), mapped back after the answer.
- `write.ts`: a card speaks a short human grammar in the chat (`Save <ref>: field → value; …`, `Create …: <title>` + a properties line); the plugin parses it, the agent passes it verbatim. Unit-check the parser with node before wiring it.
- `index.ts`: `defineConnector({ id, label, summary, aliases, auth, triggers: { keywords, refPattern, messagePattern }, examples, filters, view, record, draft, apply })`. `apply` re-reads what it touched and returns a view/record payload so the card redraws from the app's truth.
- `ui.tsx`: compositions drawn from the kit (`ui/kit.tsx`: card chrome, Picker, SaveBar, glyphs). Read the payload from `ctx.details`; send messages with `ctx.send`; open links with `ctx.openUrl`. Export `{ id, label, component, runningText }`.

## 5. Eval set

`evals.json`: ten to twenty asks with the expected routing (`connector`, `kind`), composition (`view`, `scope`/`range`, grouping), fields, and for writes the exact parsed shape. Run them with `node tools/eval.mjs <id>`: it invokes the plugin's tools through the `kay` CLI in this session (no model turn) and compares. Keep it green before you push; it is the regression gate when a rubric's wording changes.

## 6. Test like a person

A git commit in the plugin directory reloads the plugin (touching files or toggling the install does not). Subagents keep the parent's plugin generation, so test in fresh top-level sessions: `open_session` with a first message, then read its transcript for the tool call, its arguments, the result line and the timing. Check: one tool call and no reads before it; the connector routed as expected; the composition and fields Jev picked; the card's message round-trips through `cards_apply`. Then look at the cards yourself: the agent cannot see them, so never report a card as fixed from the transcript alone.

## 7. Log picks for the loop

The runtime records every pick and every correction (a property the person changed before pressing Create; a re-ask for a different view) under the plugin's data dir. Feed the recent picks for similar asks into the rubric's state so Jev sees what this person chose last time. The eval set stays the gate for rubric changes.
