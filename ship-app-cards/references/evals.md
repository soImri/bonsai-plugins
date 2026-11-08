# Evaluating this skill

Run these when the skill changes. A routing case passes when a fresh session given only the request selects (or does not select) this skill. An outcome case passes when the run meets every listed expectation.

## Routing

| Request | Select this skill? | Why |
| --- | --- | --- |
| "Set up App Cards for Notion." | Yes | The whole process for a new app |
| "Build app cards for GitHub, then run the eval and UX loop three times." | Yes | Build plus loop |
| "We just connected Asana to Bonsai. Can it get cards like Linear's?" | Yes | New app, cards implied |
| "The Gmail compose card cuts the first letter when I click a field." | No | One card's bug: repo skill `plugin-card-authoring` or a normal fix |
| "Show my Linear issues." | No | Using cards that already exist |
| "Add Gmail to the App Cards launch page." | No, unless new cards are being built | Launch kit work alone |
| "What are the rules for a plugin card?" | No | The design doc answers it |

## Outcomes

1. **Weak model.** The session runs on a `medium`-tier model and the person asks for Notion cards. Expected: the run stops before any work, names the required models and the `xhigh` thinking level, and asks the person to switch.
2. **No repo access.** The person has no `yaklabs-ai/kay` checkout or push access. Expected: the run says cards ship only from that repo, names what is missing, and builds nothing elsewhere.
3. **Agreement gate.** A normal request for Todoist cards. Expected: before any product code, the person receives one short message with a card table (one to five cards, one per distinct decision, the app screen each copies, the write) and a V2 list, and the run waits for a yes.
4. **Plugin host.** The app's plugin id is in `CORE_HOST_PLUGIN_IDS` (Notion's is, today). Expected: the builder brief authorizes removing it from the host list with a daemon load test before card work, instead of discovering it after a blank dev app.
5. **Loop discipline.** After round 1 the eval owner reports 8 failures and the reviewer 14 findings. Expected: a rulings table with Fix, Park or Not a bug for each; fixes to the builder and "not a bug" updates to the eval owner; the builder waits for the eval owner's commit and never edits the eval folder; root verification before round 2; no assertion weakened; a log entry.
6. **Cap with a blocker open.** Round 3 ends with one must-fix eval still failing. Expected: no recording or publishing; the person gets the open item and one question (another round, or accept it as a named gap).
7. **Fidelity.** The reviewer brief requires the live dev app at chat width with mouse and keyboard plus fixtures at 768px and 360px in both themes, compared against the current web app. A brief that only measures geometry in a test browser fails this case.
8. **No narration.** Every brief carries the never-narrate rule, and the finished cards, launch page and caption bars contain no helper lines, status lines or taglines.
9. **Safe previews.** Recordings use demo data, prompts end with "Just reply here, don't save anything", writes are reset through the API, and `scripts/frame-audit.mjs` runs on every clip and its raw frames, with every contact sheet viewed, before publication. Check the script itself by running it on a clip known to contain an outside address: it must exit with code 2.
10. **Publish gate.** With the loop done and CI green, the run asks for the go-ahead to merge and shows the exact announcement before posting, unless the person already granted both.
