---
name: linear-cards
description: Show, triage, or create Linear issues through Linear-shaped cards in the chat. One tool call with the person's words; the plugin reads Linear and Jev picks the view. Use for 'show NEAT-9', 'what's open', 'where do we stand', 'create an issue for', 'file this in Linear'.
---

# Linear cards

One tool call draws the card. The plugin reads and writes Linear itself through Bonsai's Linear connection, Jev picks the layout and fields at runtime, and the card renders. Speed is the point: call the tool in your first step. Do not read `linear://`, `mcp://linear`, tool schemas, memory, or the repo first. Do not research the topic. The person fixes anything on the card.

| The ask | The one call |
| --- | --- |
| "show NEAT-9", "status of NEAT-9", "open NEAT-9" | `linearcards_issue { identifier: "NEAT-9" }` |
| "comment on NEAT-9 that …" | `linearcards_issue { identifier: "NEAT-9", commentDraft: "…" }` |
| "what's open", "my issues", "in progress", "triage", "where do we stand", "how is Evals v1 going", "issues about evals", anything about several issues | `linearcards_view { task: <their words>, query?: <one topic word, only if named>, project?: <name, only if named>, assignee?: "me" only for "my issues" }` |
| "create a ticket for …", "file an issue …", "log a bug …" | `linearcards_newissue { task: <their words>, title: <≤ 80 chars>, description?: <≤ 3 short lines, only if the ask has real detail> }` |

After the call returns, reply with at most one short line, or nothing. Never restate the card's fields. Never rebuild a card as prose or a generic form.

## Messages the cards send back

Each one is exactly one tool call, then one short line (or nothing). Never call the Linear MCP yourself for these.

- A message starting `Save NEAT-10: …`, `Comment on NEAT-10:`, or `Create in NEAT: …` (sent by Save changes, Comment, and Create issue): call `linearcards_apply { message: <the whole message, verbatim> }`. The plugin parses it, writes to Linear, and redraws the card with what Linear saved. Do not rewrite or interpret the message. Bonsai may ask you to approve the write; that is expected.
- `Show NEAT-7` (a row click): `linearcards_issue { identifier: "NEAT-7" }`.
- Anything else the person asks you to change in Linear ("mark NEAT-10 done"): `linearcards_apply { changes: [{ identifier, state, priority (0-4), assignee, project, labels }] }` with only the fields that change.

## If the tool reports an error

Its text says why (for example Linear rejected the token). Say that in one line and fall back to `linear://` reads only if the person asks for the data anyway.
