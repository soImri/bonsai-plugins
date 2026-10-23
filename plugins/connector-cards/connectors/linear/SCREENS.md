# Linear: screen map

**Route:** Linear's MCP server (`https://mcp.linear.app/mcp`, JSON-RPC over Streamable HTTP) with Bonsai's Linear sign-in. Service `linear.account`, scheme `linear.mcp-oauth`. The token is refused by `api.linear.app/graphql` (401), so reads and writes both go through MCP tools: `list_teams`, `list_issue_statuses`, `list_issue_labels`, `list_projects`, `list_users`, `list_issues`, `get_issue`, `save_issue`, `save_comment`.

**Why these screens:** the four views people live in (issue, list, board, project) plus the create dialog. Sources: Linear's own app, the session history of asks about Linear (status of X, what's open, where do we stand, create a ticket).

| Screen in Linear | Composition | Fields shown | Fields that edit | A Save writes | Chat adaptation |
| --- | --- | --- | --- | --- | --- |
| Issue view | `issue` | team › identifier, title, description, status, priority, assignee, project, labels, created/done dates, comments box | status, priority, assignee, project, labels (pills); comment | `save_issue { id, state, priority, assignee, project, labels }`; `save_comment { issueId, body }` | One issue per card; description folds after 3 lines; open-in-Linear icon; team is a label, not a link |
| Issues list | `list` | priority glyph, identifier, status glyph, title, labels count, assignee, date (fields are Jev-picked) | priority, status, labels, assignee per row | one `save_issue` per changed row, batched behind Save | Rows, no columns header; a row click opens the issue card |
| Board | `board` | grouped rows by status / project / assignee / priority (Jev-picked) | same as list | same as list | Groups stack vertically with a header and count; no horizontal columns |
| Project view | `project` | team › Project, name, summary, lead, target date, progress bar, issues grouped by status | same as list | same as list | Header + progress on top of a board |
| Create issue dialog | `draft` | team, title, description, status, priority, assignee, project, labels | all | `save_issue { team, title, description, state, priority, assignee, project, labels }` → then the new issue card | Jev prefills properties from the ask; Create issue sends `Create in <team>: …` |

**Jev picks (view):** scope (open/active/done/all), view, groupBy, sort, then description/assignee/labels/dates fields. **Jev picks (draft):** priority, project, up to five labels, state, assign-to-me.

**Follow-ups (up to three per card, picked from the ask, the context and the recipe for similar asks; a property that is not picked shows as data):**

| Screen | Primary surface | Follow-up candidates (`when`) |
| --- | --- | --- |
| Issue | identifier, title, description, properties as pills, open-in-Linear | `status` (progress, done, start) · `priority` (triage, urgency) · `comment` (respond, feedback, a question on it; always when a draft is passed) · `assignee` (who owns it, hand-off) · `labels` (categorising, bug/feature) · `project` (planning across projects) |
| List / board / project | the rows (expand in place), scope label | `edit` (inline priority/status pickers: triage, planning, review) · `scopes` (open / in progress / done / all) · `views` (list / board / project tabs) · `group` (regroup a board) · `create` (+ New issue inline) |
| Create | title, description, Jev-picked properties as pills | `priority` · `project` · `labels` · `assignee` · `state` (the picked ones become pickers) |

A bare "show NEAT-9" is the issue with its properties as plain pills; "show NEAT-9" while triaging gets the priority picker; while answering Seb gets the comment box.

**Card messages:** `Save NEAT-10: status → …; labels → …` · `Comment on NEAT-10:` + body · `Create in NEAT: <title>` + properties line + optional `Description:` block · `Show NEAT-7`.

**Not built:** sub-issues, relations, cycles, attachments, assignee pickers with avatars, inline description editing.
