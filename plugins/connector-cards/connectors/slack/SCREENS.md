# Slack: screen map

**Route:** Slack's Web API (`https://slack.com/api`) with Bonsai's Slack sign-in, a user token (service `slack.account`, scheme `slack.oauth`; scopes include channels/groups/im/mpim history, search:read, chat:write, reactions:write, users:read). Methods: `auth.test`, `users.list`, `conversations.list`, `conversations.history`, `conversations.replies`, `search.messages`, `chat.postMessage`, `reactions.add`.

**Inventory (what Bonsai's own `slack://` covers):** list channels/DMs/people/files, read a conversation or a thread, search, post or schedule, reactions, pins, open DMs, edit/delete own messages. The hard constraint it documents: Slack allows this app **one `conversations.history` and one `conversations.replies` read per minute per workspace**; search has its own budget. The connector tracks the minute itself and falls back to `search.messages in:#channel` for a channel read when the minute is used; thread reads always spend it.

**Why these screens:** the channel view and the thread are what people look at; the inbox (Activity in Slack's own vocabulary: recent messages across conversations, mentions, DMs) is what "catch me up" needs; the composer is the one write screen. Sources: the Slack app, Bonsai's Slack skills, asks in session history ("what's new in #neat-build", "did anyone ping me").

| Screen in Slack | Composition | Fields shown | Fields that edit | A Send writes | Chat adaptation |
| --- | --- | --- | --- | --- | --- |
| Channel view | `channel` | header (#name, members, topic), day dividers, messages (avatar initials, name, time, text with bold/italic/code/quotes, files, reactions as pills, "N replies ›"), composer | the composer | `chat.postMessage` (`Post in #name:` + text) | Last 40 messages; hover shows quick reactions (✅ 👍 👀 🎉), Reply, open-in-Slack; a reaction pill click reacts (`React to #name <ts>: :emoji:`); "N replies" opens the thread card |
| Thread | `thread` | the parent and its replies, reply composer | the reply composer | `chat.postMessage` with `thread_ts` (`Reply in #name <ts>:` + text) | Reply counts hidden inside a thread |
| Activity / inbox | `inbox` | messages grouped by conversation, newest conversation first, mention badge, two most recent per conversation with "N more…" | none | — | Range and focus Jev-picked (today / 3 days / week; all / mentions / DMs); focus chips filter in the card when the loaded set allows, otherwise ask again; "Open ›" opens the channel card |
| Composer | `draft` | To (conversation picker), message box, ⌘↩ | all | `chat.postMessage` (`Post in #name:` or `Post in @person:` + text) | Jev picks the conversation from the ask against names and topics when the ask names none |

**Jev picks (view):** range, focus, show threads, show reactions. **Jev picks (draft):** the conversation (up to 8 candidates).

**Card messages:** `Post in #name:` + body · `Reply in #name <ts>:` + body · `React to #name <ts>: :emoji:` · `Show #name` · `Show thread <channelId>/<ts>`.

**Not built:** scheduling, pins, files (listed only), editing or deleting messages, opening new DMs, unread counts (Slack's API does not expose them cheaply), profile cards, threads inline inside the channel card (a thread read spends the minute; a layer-2 endpoint candidate).
