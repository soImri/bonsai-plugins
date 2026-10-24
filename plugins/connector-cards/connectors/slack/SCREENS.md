# Slack: screen map

**Route:** Slack's Web API (`https://slack.com/api`) with Bonsai's Slack sign-in, a user token (service `slack.account`, scheme `slack.oauth`; scopes include channels/groups/im/mpim history, search:read, chat:write, reactions:write, users:read). Methods: `auth.test`, `users.list`, `conversations.list`, `conversations.history`, `conversations.replies`, `search.messages`, `chat.postMessage`, `reactions.add`.

**Inventory (what Bonsai's own `slack://` covers):** list channels/DMs/people/files, read a conversation or a thread, search, post or schedule, reactions, pins, open DMs, edit/delete own messages. The hard constraint it documents: Slack allows this app **one `conversations.history` and one `conversations.replies` read per minute per workspace**; search has its own budget. The connector tracks the minute itself and falls back to `search.messages in:#channel` for a channel read when the minute is used; thread reads always spend it.

**Why these screens:** the channel view and the thread are what people look at; the inbox (Activity in Slack's own vocabulary: recent messages across conversations, mentions, DMs) is what "catch me up" needs; the composer is the one write screen. Sources: the Slack app, Bonsai's Slack skills, asks in session history ("what's new in #neat-build", "did anyone ping me").

| Screen in Slack | Composition | Fields shown | Fields that edit | A Send writes | Chat adaptation |
| --- | --- | --- | --- | --- | --- |
| Channel view | `channel` | header (#name, members, topic), day dividers, messages (avatar initials, name, APP badge, time, text with bold/italic/code/quotes, app attachments as Slack unfurls, files, reactions as pills, "N replies ›"), composer | the composer, a reply box per thread | `chat.postMessage` (`Post in #name:` + text; `Reply in #name <ts>:` + text) | Two weeks loaded up front (search `in:#name`, replies included, merged with one history read when Slack's minute allows); threads open in place from the loaded replies; hover shows quick reactions (✅ 👍 👀 🎉), Reply, open-in-Slack |
| Thread | `thread` (standalone, when the ask names a thread) | the parent and its replies, reply composer | the reply composer | `chat.postMessage` with `thread_ts` | Inside a channel or inbox card, threads open in place instead |
| Activity | `activity` | Slack's Activity: Mentions (by others, outside threads you are in), Threads (you started, replied in, or were mentioned in: parent + replies open in place), Direct messages (per person, last three, with a composer); each with profile pictures; newest first; no time filters, two weeks loaded | reply boxes per thread, DM composers, quick reactions, open-in-Slack; `New message` (conversation picker + box) when Jev picks the `post` follow-up | `chat.postMessage` (post / reply), `reactions.add` | Jev picks the focus: needs_me (default: all three sections, empty ones hidden), mentions, threads, dms, all (recent per channel; also for a topic search) |
| Composer | `draft` | To (conversation picker), message box, ⌘↩ | all | `chat.postMessage` (`Post in #name:` or `Post in @person:` + text) | Jev picks the conversation from the ask against names and topics when the ask names none |

**Jev picks (view):** range, focus, show threads, show reactions. **Jev picks (draft):** the conversation (up to 8 candidates).

**Follow-ups (additive only; every native control is always live):**

| Screen | Native controls (always) | Follow-up candidates |
| --- | --- | --- |
| Channel / thread | composer, threads open in place with reply box, reactions and quick reactions, open-in-Slack | none yet |
| Activity | sections (Mentions / Threads / DMs) with reply boxes, DM composers, reactions, threads open in place; no chips | `post`: a New message button opens the composer with a conversation picker (when the ask or context is about telling, pinging, announcing) |

**Profile pictures:** `users.list` `profile.image_72` on every person (and `bot_profile.icons` on apps), carried on messages and DM conversations; the card draws coloured initials until the image loads or if it cannot.

**Card messages (writes only):** `Post in #name:` + body · `Reply in #name <ts>:` + body · `React to #name <ts>: :emoji:`.

**Not built:** scheduling, pins, files (listed only), editing or deleting messages, opening new DMs, unread counts (Slack's API does not expose them cheaply), profile cards, paging past 100 messages or two weeks (a layer-2 endpoint candidate).
