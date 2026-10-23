---
name: linear-cards
description: Show, triage, or create Linear issues through Linear-shaped cards in the chat. One tool call with the person's words; the plugin reads Linear and Jev picks the view. Use for 'show NEAT-9', 'what's open', 'where do we stand', 'create an issue for', 'file this in Linear'.
---

# Linear cards

One tool call draws the card. The plugin reads Linear itself through Bonsai's Linear connection, Jev picks the layout and fields at runtime, and the card renders. Speed is the point: call the tool in your first step. Do not read `linear://`, `mcp://linear`, tool schemas, memory, or the repo first. Do not research the topic. The person fixes anything on the card.

| The ask | The one call |
| --- | --- |
| "show NEAT-9", "status of NEAT-9", "open NEAT-9" | `linearcards_issue { identifier: "NEAT-9" }` |
| "comment on NEAT-9 that …" | `linearcards_issue { identifier: "NEAT-9", commentDraft: "…" }` |
| "what's open", "my issues", "in progress", "triage", "where do we stand", "how is Evals v1 going", "issues about evals", anything about several issues | `linearcards_view { task: <their words>, query?: <one topic word, only if named>, project?: <name, only if named>, assignee?: "me" only for "my issues" }` |
| "create a ticket for …", "file an issue …", "log a bug …" | `linearcards_newissue { task: <their words>, title: <≤ 80 chars>, description?: <≤ 3 short lines, only if the ask has real detail> }` |

After the call returns, reply with at most one short line, or nothing. Never restate the card's fields. Never rebuild a card as prose or a generic form.

## Messages the cards send back

Each one needs exactly one Linear MCP call, then one short confirming line. Do not redraw the card unless noted.

- `Update NEAT-10: status → In Progress; labels → Decision, Design` (one line per issue): per line, `mcp(server: "linear", tool: "save_issue", args: { id: "NEAT-10", state: "In Progress", labels: ["Decision", "Design"] })`. Field map: status → `state`, priority → `priority` (0 none, 1 urgent, 2 high, 3 medium, 4 low), assignee → `assignee` (`none` → null), project → `project` (`none` → null), labels → `labels` (full list; `none` → []).
- `Comment on NEAT-10: <text>`: `mcp(server: "linear", tool: "save_comment", args: { issueId: "NEAT-10", body: <text> })`.
- `Create Linear issue in NEAT: …` followed by a JSON block: `mcp(server: "linear", tool: "save_issue", args: { team, title, description, state, priority, assignee, project, labels })` with the JSON's values (drop empty ones), then `linearcards_issue { identifier: <the new identifier> }`.
- `Show NEAT-7`: `linearcards_issue { identifier: "NEAT-7" }`.

## If the tool reports an error

Its text says why (for example Linear rejected the token). Say that in one line and fall back to `linear://` reads only if the person asks for the data anyway.
