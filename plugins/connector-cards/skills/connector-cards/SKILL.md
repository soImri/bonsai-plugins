---
name: connector-cards
description: Show, draft, or change records of a connected app (Linear issues, Google Calendar events, more to come) through cards shaped like the app's own UI. One tool call with the person's words; the plugin reads the app and Jev picks the view. Use for 'what's open', 'show NEAT-9', 'what's on today', 'schedule a call', 'create a ticket', and the Save/Create/RSVP messages cards send.
---

# Connector cards

Four tools, any connector. One call draws the card: the plugin picks the connector (from references, keywords, or Jev), reads the app through Bonsai's sign-in, Jev picks the layout and fields, and the card renders. Speed is the point: call the tool in your first step. Do not read `linear://`, `gcal://`, `mcp://`, tool schemas, memory, or a repo first. Do not research the topic. The person fixes anything on the card.

| The ask | The one call |
| --- | --- |
| About several records: "what's open", "my issues", "where do we stand", "how is Evals v1 going", "what's on today", "my week", "show me this month", "when am I free next week", "find 30 min for a call", "invites I haven't answered", "who am I meeting tomorrow" | `cards_view { task: <their words>, refs?: [ids named], query?: <topic word>, filters?: {…} }` |
| About one record: "show NEAT-9", "status of NEAT-9", "comment on NEAT-9 that …", "show my 3pm", "the call with Seb" | `cards_record { ref: "NEAT-9" \| "#a1b2c3" \| "<title>", draft?: <comment text> }` |
| Make a new one: "create a ticket for …", "file a bug …", "schedule a call with Seb tomorrow at 3", "block Friday afternoon" | `cards_draft { task: <their words>, title: <≤ 80 chars>, body?: <≤ 3 lines>, fields?: {…} }` |
| A message a card sent (see below) | `cards_apply { message: <the whole message, verbatim> }` |

Pass `connector` ("linear", "gcal") only when the ask is ambiguous. A calendar ask about one specific date goes in `filters: { date: "YYYY-MM-DD" }`. A free-time slot click sends `Draft an event on <date> at <time> for <N> minutes`: answer it with `cards_draft { task, title: "New event", fields: { start, end } }`. For a calendar draft, put what the ask states into `fields`: `start` and `end` as the person's local date-time (`2026-10-24T15:00`), `attendees` as emails, `location`, `allDay`. Leave out what the ask does not say; Jev and the card fill the rest.

After the call returns, reply with nothing. Not a summary, not what the card shows, not what to press next: the card is the whole answer and the person navigates inside it (ranges, views, rows expand in place). The only exception is an error line when the tool reports one. Never rebuild a card as prose or a generic form.

## Messages the cards send back

Each one is exactly one `cards_apply { message }` call with the message verbatim, then nothing. Never call an MCP or URI yourself for these; the plugin parses, writes, and redraws the card from the app's truth. Bonsai may ask you to approve the write; that is expected.

- Linear: `Save NEAT-10: status → In Progress; labels → A, B` (one line per issue), `Comment on NEAT-10:` + body, `Create in NEAT: <title>` + a properties line and an optional `Description:` block.
- Google Calendar: `Save event #a1b2c3: start → 2026-10-24 15:00; end → …`, `Create event: <title>` + a properties line and an optional `Notes:` block, `RSVP #a1b2c3: yes|no|maybe`, `Delete event #a1b2c3`.
- A row click: `Show NEAT-7` or `Show event #a1b2c3` → `cards_record { ref }`.

For a change the person asks you for in words ("mark NEAT-10 done", "move my 3pm to 4"), use `cards_apply { connector, payload }` with the connector's own shape: Linear `{ changes: [{ identifier, state?, priority?, assignee?, project?, labels? }], comment?, create? }`; Google Calendar `{ changes: [{ key, title?, start?, end?, location?, guests?, meet? }], create?, rsvp?: { key, response }, delete?: key }`. Show the record first when you need its key.

## If the tool reports an error

Its text says why (not connected, token rejected, nothing matched). Say that in one line. Fall back to `linear://` or `gcal://` reads only if the person asks for the data anyway.
