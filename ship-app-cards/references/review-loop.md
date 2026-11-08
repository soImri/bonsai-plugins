# The eval + UX review loop

Run it after the cards build and the person has had a first look. At most three rounds unless the person sets another cap.

## Who writes what

| Role | Tier | Writes | Never touches |
| --- | --- | --- | --- |
| Root (you) | the session's model | the scenario list, rulings, the round log, the dev app | product code |
| Builder | `large` | product code in `plugins/<app>/`, its own non-eval tests, and the host-placement change when [traps](traps.md#where-the-plugin-runs) applies | `plugins/<app>/test/evals/` |
| UX reviewer, new each round | `large` | a report and screenshots outside the repo; scratch only in a gitignored folder it deletes | tracked files |
| Eval owner, same agent every round | `medium` or `large` | only `plugins/<app>/test/evals/`, its own suite, maintained across rounds and committed each round | product code, tests outside the eval folder |

Only the eval owner edits the eval folder. When a ruling changes the expected behavior ("not a bug"), tell the eval owner to update that test. Writes stay single-threaded: the builder starts fixing only after the eval owner has committed. Keep the same eval owner across rounds (continue it by message) so it knows its suite. Spawn a fresh UX reviewer each round for fresh eyes, and give it the previous report and your rulings. Briefs: [briefs](briefs.md).

Keep the reports and the log in one review folder outside the repo, such as `~/app-cards-reviews/<app>-<date>/round-<n>/`, and the scenario list in Whiteboard or that folder. Name the folder in every brief.

## The scenario list

Write it before round 1, beside the card table. One line per scenario: id, start state → action → expected result. Fixtures and the simulator only.

```md
## Compose
- C1 One account, new email → fill To/Subject/Body, Send → "Sending… Undo" for 5s → exactly one send → sent state with a link to the message.
- C2 Undo inside 5s → editable again, same text, nothing sent; Send again → one send.
- C3 Double-press Send → one send.
```

Cover, for every card:

- The happy path and each write, with its undo or failure.
- Combinations of actions: reply then archive, archive then reply, open a row then go back, two fast actions then undo the first.
- Create-once: the host's `submission` states `checking`, `none`, `unknown`, `submitted`, and a reopened chat.
- Account pinning: two accounts and none named is refused; the write uses the read's account.
- Size: the largest realistic data (50 rows, a 3,000-word body, 40 recipients) stays inside the 480px limit with actions reachable.
- Every state: loading, empty, failed, needs sign-in, saving, saved, could not confirm.
- Cross-cutting: no narration (visible text is data or control labels only); every record links to the app as the pinned account; a slow older read never overwrites a newer one; long names, right-to-left text and emoji; dark-mode contrast of at least 4.5:1; keyboard reach and focus after every action; the agent uses a card only when `ui_render` lists it.

Mark a scenario `todo` with its reason when no fixture can express it (agent routing needs a model harness).

## One round

1. Start both helpers in parallel, pinned to the same commit: the UX reviewer ([brief](briefs.md#ux-reviewer)) and the eval owner ([brief](briefs.md#eval-owner)).
2. Read both reports. Rule every finding in a table:
   - **Fix**: the smallest change that makes it behave like the app.
   - **Park**: a named V2 item, recorded as a known gap.
   - **Not a bug**: say why, and have the eval match the app's real behavior. Example: two quick archives in Gmail leave one Undo toast for the latest action, so a test expecting two toasts was wrong.
   Do not change an agreed product decision to make an eval pass, and do not let a reviewer reopen settled decisions.
3. Send every Fix to the builder in one message, ranked, naming the evals that must pass. Send every "not a bug" ruling to the eval owner in the same step.
4. Verify yourself: re-run the evals and card suites, typecheck, lint and static checks; look at the new screenshots; check the live dev app when the change is visible there. Check the eval folder's diff since the last round: an assertion may only get stronger or follow a ruling.
5. Write the round into the log.

## How the reviewer must look

The real app is the reference: its current web version, with links and how certain each reference is. Measured geometry is not fidelity: Gmail's cards passed three rounds of 360px checks in a test browser while every focused text field drew a frame that cut off the first letter, which the person saw in seconds in the real app.

So every round:

- Drive the live dev app at real chat width (about 768px): click, type, hover, select text, Tab through. Never press a real write in the live app.
- Render fixtures for states the live account cannot reach, at 768px and 360px, light and dark.
- Zoom crops to 2x for edges. Measure alignment with computed styles: label, chips, subject and body share one left edge where the app does.
- Focus, selection and caret look like the app's own. Do not add frames, outlines or rings the app does not draw; a fix for one control's focus must not restyle every control (in Gmail, text fields show only the caret and keyboard rings sit outside buttons).
- Report controls that do not serve the card's one decision as cuts, not as fixes.

## Findings that typechecks miss

Pre-check these on every app; each one shipped into an earlier build and was caught by a round:

- A stale response overwriting a newer one; a late background write (mark as read) undoing the person's later action.
- A double press creating or sending twice.
- Silent truncation, or totals computed from the truncated rows.
- Undo toasts and error notices shown on the wrong record; scope them to their record.
- Focus dropped to the page body after an action; it should land on the next row, the Undo, or the field.
- Unsent text lost when the person navigates back inside the card; keep it per record until they discard it.
- HTML-only content showing raw CSS; remote content loading.
- Opening a long thread or list at the oldest item instead of the latest.
- A long invalid token collapsing a narrow layout; alerts that clip instead of wrapping.
- Save, Send or Create shown before anything changed. Team convention for App Cards: the action appears only after a change, bottom right, unless the app itself saves on pick.
- Success text that contains the word "error" read as a failure; parse how the reply starts, not what it mentions.
- A dead-end Connect button when the account cannot get the access at all; show what is unavailable instead.

## Stopping

Stop iterating at the cap or when a round finds nothing actionable. Stopping is not acceptance. If a blocker or a failing must-fix eval is open at the cap, do not record or publish: give the person the open items and ask whether to run another round or accept them as named known gaps. Report what remains plainly: failing evals, parked items, and what no round could test. Issues the person reports after the cap are must-fix, and they may order more rounds.

## Round log

```md
# <App> App Cards: review log (max 3 rounds)

Cards: <refs>. Worktree <path>, branch <branch>, base <sha>. Scenario list: <link>.

## Round <n> (HEAD <sha>)

Inputs: round-<n>/ux.md (<k> findings, <k> screenshots); round-<n>/evals.md (<pass>/<fail>/<todo>, commit <sha>).

| Finding | Class | Ruling |
| --- | --- | --- |
| UX3 Send stays enabled on `unknown` | Blocker | Fix: disabled, with a link to Sent |
| UX10 Bcc-only send | Polish | Park: V2, shared validation change |

Fixes: commit <sha>; <pass>/<fail>/<todo> across <k> files; static checks <k>/<k>. Root re-run: <totals>.
Live dev app: <what you checked and saw>.
Remaining holes: <untested parts and why>.
```
