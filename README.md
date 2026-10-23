# bonsai-plugins

Bonsai plugins by Imri Sofer. Each plugin is a folder with its own `kay-plugin.json`.

| Plugin | What it is |
| --- | --- |
| `connector-cards/` | Connector-owned UI in Bonsai's chat. Linear first: issue, list, board, project and create cards in Linear's own shape; one tool call per ask, the plugin reads and writes Linear itself, Jev picks the view and fields at runtime. |

## Install in Bonsai

Add this repository as a plugin source (App Store → Sources, or ask Bonsai to add `https://github.com/imri-star/bonsai-plugins`), approve it, then install `connector-cards`. Updates arrive with each push.
