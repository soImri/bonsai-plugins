---
name: linear-cards
description: Show a Linear issue, or draft and create one, through Linear-shaped cards in the chat instead of prose. Use for 'show NEAT-9', 'what's the status of', 'create an issue for', 'file this in Linear'. Reads go through linear://, the create goes through the Linear MCP after the person presses Create issue on the card.
---

# Linear cards

Two tools draw Linear's own UI in the chat. You supply the fields; the card draws them.

## Show an issue

1. `read linear://issues/<identifier>` (or search first).
2. Call `linear_issue_card` with the fields you read: identifier, title, description, url, state `{name, type}`, priority (0–4), assignee, project, labels, createdAt, completedAt.
3. Say nothing else about the issue. The card is the answer.

## Create an issue

1. Read the team's pick lists once: states, projects, labels, members (`linear://` team or issue reads expose them; the Linear MCP `list_issue_statuses`, `list_projects`, `list_issue_labels`, `list_users` also work).
2. Call `linear_new_issue_card` with your proposed title, description, state, priority, assignee, project, labels, and `options` holding those lists.
3. Stop. Do not create anything yet.
4. When a message arrives that starts with `Create Linear issue`, create exactly what it specifies through the Linear MCP (`create_issue`), then show the result with `linear_issue_card`.

## Rules

- Never rebuild a card as a list of fields in prose or in a generic form.
- Priority mapping: 0 none, 1 urgent, 2 high, 3 medium, 4 low.
- Pass real option lists. A card with guessed options misleads the person.
