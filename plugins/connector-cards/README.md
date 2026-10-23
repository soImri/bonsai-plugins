# Connector cards

A connected app's own UI inside Bonsai's chat, for any connector. The person asks in words; the plugin reads the app through Bonsai's sign-in, Jev picks which screen and which fields fit the ask, the card renders, and edits write back through the same sign-in. One tool call per ask, seconds end to end.

Connectors today: **Linear** (issue, list, board, project, create), **Google Calendar** (agenda, month, event, find a time, create) and **Slack** (channel, thread, activity inbox, composer). Add one with `node tools/new-connector.mjs`; the process is in `CONNECTORS.md`.

## Install

From the marketplace `https://github.com/soImri/bonsai-plugins` (App Store → Browse → Connector cards → Get), or as a local directory plugin. On install Bonsai asks for the grants the plugin needs: Jev, and the shared sign-in of each connector's service (Linear, Google, Slack). The apps themselves must be connected in Bonsai (App Store → Installed).

## Try

New chat: "what's open in Linear?", "show NEAT-9", "create a ticket for …", "what's on my calendar today?", "who am I meeting this week?", "schedule a call with Seb tomorrow at 3". Change a pill or a time on the card and press Save.
