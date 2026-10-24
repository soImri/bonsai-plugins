# Google Calendar: screen map

**Route:** Google Calendar API v3 over REST (`https://www.googleapis.com/calendar/v3`) with Bonsai's Google sign-in. Service `google.account`, scheme `google.oauth`, scope `calendar.events`; the plugin asks `connectServiceId: gcal` so a missing scope points the person at the right connect. Endpoints: `users/me/calendarList`, `calendars/{id}/events` (list, get, insert, patch, delete), `freeBusy`.

**Inventory (what Bonsai's own `gcal://` covers):** list/search events by period, read/edit/delete one event, create events, `gcal://availability` (free/busy), calendars and settings. Its scheduling skill's core move is check availability → propose slots → book, which is the Find-a-time screen below. Not mirrored: calendar/settings management (rare from chat).

**Why these screens:** Google Calendar's schedule view (the agenda), the month grid, the event popup, Find a time, and the quick-create dialog. The week grid is the one Google screen left out: at chat width it degrades to the agenda, which already groups by day. Sources: calendar.google.com, Bonsai's own `gcal://` primer, asks in session history (what's on today, prep my next meeting, schedule a call).

| Screen in Google Calendar | Composition | Fields shown | Fields that edit | A Save writes | Chat adaptation |
| --- | --- | --- | --- | --- | --- |
| Schedule (agenda) view | `agenda` | day headers with the date badge, per event: calendar colour, time range, title, optional location / guest count / Meet glyph (Jev-picked) | none inline | — | Range is Jev-picked (today, tomorrow, this week, next week, next 7/14 days, yesterday, past week); a row click opens the event card |
| Month view | `month` | the month's name, a 7-column grid, each day's number (today filled), up to three event chips per day (colour dot, start time, title; all-day chips filled), "+N more" | none inline | — | A day number opens that day's agenda (`What's on my calendar on 2026-10-27?`); a chip opens the event; ‹ › move a month through the chat |
| Find a time (event editor tab) | `free` | a time grid: hours 8 AM–7 PM down the side, up to five working days across, busy blocks drawn in place with titles, free time tinted; Google-style suggested times | the proposed slot: press and drag on a day to draw it (up or down, 15-min snap), drag the block to move it (across days too), drag its bottom edge to stretch or shrink it; no duration dropdown; dashed block, turns red if it overlaps | — (Use this time opens the create dialog inline, prefilled with the slot, the title from the ask and Meet when it was a call; Save then sends `Create event: …`) | Google's freeBusy over every selected calendar; weekends and past hours skipped; pages of five days |
| Invitations | `agenda` with `invitesOnly` | the agenda filtered to events the person has not answered | RSVP on the event card | — | 'invites I haven't answered', 'anything to respond to' |
| Event popup | `event` | colour, title, day · time range, location, Join with Google Meet, guests with RSVP dots, notes, Going? Yes/No/Maybe, calendar name | title, date, start/end time, location, guests (click to edit) | `events.patch { summary, start, end, location, attendees }`; RSVP → patch own `responseStatus` | Guests capped at 8 rows; notes fold after 3 lines; open-in-Google-Calendar icon |
| Create event dialog | `draft` | title, date, start/end, All day, guests, Meet toggle, location, description, calendar | all | `events.insert` (+ `conferenceData` for Meet) → then the event card | The agent passes start/end/attendees it heard; Jev picks duration, Meet, all-day, calendar |

**Jev picks (view):** range (incl. this/next month), view (agenda/event/month/free), invites-only, then include-past, attendees, location, description. A named day (`filters.date`) bypasses the range pick. **Jev picks (draft):** Meet, all-day, duration (when no end), calendar (when several).

**Keys:** events are named `#a1b2c3` (a hash of calendar + event id) in cards and messages; the key → id map lives in the connector's cache.

**Follow-ups (additive only; every native control is always live):**

| Screen | Native controls (always) | Follow-up candidates (`when`) |
| --- | --- | --- |
| Event | click-to-edit title, time, location, guests; Join Meet; RSVP row when invited; Save | none |
| Agenda / month / find a time | navigation chips cut to the ask (asked range + neighbour; Invites · N when pending; Find a time / Month when Jev adds them; the golden set for "show my calendar"), rows expand in place, day panel, slot picking | `create`: a `+ New event` button opens the create dialog in the card (planning, blocking time, a prep block the context names) |
| Create | title, date and time, all-day, guests, Meet, location, notes, calendar | none |

**Card messages:** `Save event #a1b2c3: title → …; start → 2026-10-24 15:00; end → …; location → …; guests → …; meet → yes` · `Create event: <title>` + properties line + optional `Notes:` block · `RSVP #a1b2c3: yes|no|maybe` · `Delete event #a1b2c3` · `Show event #a1b2c3`.

**Guest edits** echo every existing guest with their current RSVP (Google's patch resets any guest sent without one) and add only the new emails.

**Not built:** week grid, recurring-event editing (edits hit the single instance), other people's availability (freeBusy only sees calendars the account can read), reminders, colours per event, attachments, calendar/settings management.
