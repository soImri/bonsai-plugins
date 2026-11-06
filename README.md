# imri-plugins

A Bonsai marketplace: plugins and skills by Imri Sofer.

| Item | Kind | What it is |
| --- | --- | --- |
| `product-preview` | skill | Record a short, captioned GIF of a real product flow or matched before/after comparison. Portable CDP recorder, GIF encoder, review images, optional presentation page and cover; no machine-specific paths or Kay checkout required. |
| `plugins/connector-cards` | plugin | Connector Cards: a connected app's own UI in Bonsai's chat. Linear (issue, list, board, project, create), Google Calendar (agenda, month, event, find a time, create) and Slack (channel, thread, activity, composer). One tool call per ask; the plugin reads and writes the app through Bonsai's sign-in, Jev picks the view and fields at runtime, and you navigate inside the card. |

## Add it to Bonsai

App Store → Sources → add `https://github.com/soImri/bonsai-plugins` as a marketplace and review the source. Then open App Store → Browse and press Get on the specific item you want. To use the preview workflow, choose `product-preview`; Connector Cards is a separate install.

If this source is already added, open App Store → Sources → the source → Check for updates, then find `product-preview` in Browse.

Or ask Bonsai: "add https://github.com/soImri/bonsai-plugins as a marketplace source and install only the product-preview skill".

Trusting a source makes its catalog browsable; it does not install every item. This repository also carries a plugin. Installed plugin code runs inside Bonsai with Bonsai's own authority; the preview skill itself is instructions and scripts, not a running plugin.

### Product Preview prerequisites

A sandbox/development Chromium or Electron page with CDP enabled, Node.js 22+, and npm access. The skill discovers the target's actual endpoint and asks the agent to adapt the scenario to the observed UI. It does not automate sign-in or capture native operating-system dialogs. Its optional page and cover templates need no private brand assets or licensed fonts.

## Layout

Skills sit at the root (one `SKILL.md` folder each), plugins under `plugins/` (one `kay-plugin.json` folder each). `marketplace.json` names them and assigns categories. Generate the catalog with `node tools/validate.mjs --fix`, then check it with `node tools/validate.mjs` before publishing. The catalog's versions and content digests describe the items from this source; recipients refresh the source through Bonsai to discover published changes.
