# Traps

Each trap cost an earlier run real time. Check the ones for your stage before you act. Card architecture traps (sign-in grant purposes, per-sign-in state, measuring real responses, portaled pickers) are owned by the repo skill `plugin-card-authoring`; they are not repeated here.

## Where the plugin runs

Cards need the daemon. Bonsai's plugin host has no card registration (`app.implementCard`) and no app sign-in (`app.auth`), so a plugin that the host runs never draws its cards: in the dev app it does not load at all, and nothing in the chat says why. Before building, search the checkout for `CORE_HOST_PLUGIN_IDS`. If the app's plugin id is in that list, the builder removes it (Google Calendar and Gmail both did) and adds a test proving the daemon loads the plugin and registers its cards and endpoints. Check again on each new base: the host may gain card support later.

## Plugin wiring

- Card refs are `<namespace>.<localId>`, and two plugins can share a namespace (Gmail and Google Calendar are both `google`). Prefix ids that could collide (`mail-compose`).
- The account may lack a scope the card needs, with no way to grant it. Gmail reading needs a restricted Google scope that the standard client does not get. Show an honest "not available for this account" state, not a Connect button that cannot help.
- Generated files (skills, catalogs) come from the repo's generators. Never hand-edit them.

## Dev app

- Dev builds never reach the feature-flag service, so turn cards on in the launch command itself: `KAY_FEATURE_FLAGS=app-cards=on`. An empty value inherited from an agent shell overrides the dev `.env` file.
- On a busy Mac the launch can be refused by the repo's load guard. Wait and retry through the supported command. Never bypass the guard.
- Never run the dev app's start command from a session that the dev app itself hosts: it restarts the instance under the conversation and the session loses its connections. Run the dev app from your normal Bonsai and drive it from there.
- A machine without the team's sign-in secrets needs the lighter app profile (`pnpm dev:up --profile app`); `local-dev-worktrees` covers it.
- A spawned helper keeps its parent's plugin version. Test plugin changes in a fresh top-level chat, not in a helper.
- UI tests need `NODE_ENV=test`; Bonsai's shell sets production, which breaks React's test utilities.

## Agent behavior

- After drawing a card, the agent tends to add a sentence describing it. Put "end the turn without describing the card" in the primer section. The host's own tool result invites a closing line, so some narration may remain; report it as a host issue, not a card bug.
- The agent picks the card from the card's manifest description and the primer. Write both as routing text: what the card is for and the inputs the agent must pass.

## CI

A plugin new to the repo, or one that gains a URI scheme or a sign-in service, trips repo-wide guard tests that list every plugin. Todoist hit all of these:

- The shared sign-in list (`SHARED_IDENTITY_AUTH_SERVICES`) must include the plugin's service.
- The transcript's tool wording must cover the plugin's URI scheme.
- The plugin's UI files may depend only on allowlisted packages.
- Tests that read CSS need the package's `test:styles` task.
- Unused-export and dependency checks (knip) must pass.

Read how the newest card plugin satisfied each guard and copy it. Do not disable a guard.

## Demo data

Demo and test writes go to a demo project or test account, and you reset them afterwards through the app's API. Todoist's previews used a "Launch demo" project and restored every task's state after each take.
