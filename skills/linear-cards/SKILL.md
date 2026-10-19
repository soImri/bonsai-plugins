---
name: linear-cards
description: Show a Linear issue, or draft and create one, through Linear-shaped cards in the chat instead of prose. Use for 'show NEAT-9', 'what's the status of', 'create an issue for', 'file this in Linear'. Reads go through linear://, the create goes through the Linear MCP after the person presses Create issue on the card.
---

# Linear cards

Two tools draw Linear's own UI in the chat. You supply the fields; the card draws them.

## Show an issue

1. `read linear://issues/<identifier>` (or search first).
2. Call `linearcards_issue` with the fields you read: identifier, title, description, url, state `{name, type}`, priority (0–4), assignee, project, labels, createdAt, completedAt.
3. Pass `options` (the team's states, projects, labels, members) so the card's pills can change values. Read them once per session and reuse.
4. Reply with at most one short line (the issue link). Do not restate any field; the card is the answer.

## Change an issue from its card

The person changes pills on the card and presses Save changes. One message arrives like `Update NEAT-10: status → In Progress; labels → Decision, Design` (fields separated by `;`: status, priority, assignee, project, labels; labels is the full comma list, `none` clears). Apply all of them in one Linear MCP `update_issue` call, then confirm in one short line. Do not redraw the card.

## Several issues, or an open-ended ask

For "what's open", "my issues", "what's in progress", "triage NEAT", or anything about more than one issue:

1. `search` or `list linear://issues` with the right filters.
2. Call `linearcards_view` with `task` (the person's words), `issues` (compact fields for each: identifier, title, state, priority, assignee, project, labels, createdAt, and description only when short) and `options`.
3. Bonsai's Jev picks the view (one issue, list, or board by status) and the fields. You do not choose the layout. Reply with at most one short line.
4. A click on a row sends `Show <identifier>`; answer that with `linearcards_issue`.

## Create an issue

1. Read the team's pick lists once: states, projects, labels, members (`linear://` team or issue reads expose them; the Linear MCP `list_issue_statuses`, `list_projects`, `list_issue_labels`, `list_users` also work).
2. Call `linearcards_newissue` with your proposed title, description, state, priority, assignee, project, labels, and `options` holding those lists.
3. Stop. Do not create anything yet.
4. When a message arrives that starts with `Create Linear issue`, create exactly what it specifies through the Linear MCP (`create_issue`), then show the result with `linearcards_issue`.

## Rules

- Never rebuild a card as a list of fields in prose or in a generic form.
- Priority mapping: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
- Pass real option lists. A card with guessed options misleads the person.
