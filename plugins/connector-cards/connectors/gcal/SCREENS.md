# Google Calendar: screen map

**Route:** Google Calendar API v3 over REST (`https://www.googleapis.com/calendar/v3`) with Bonsai's Google sign-in. Service `google.account`, scheme `google.oauth`, scope `calendar.events`; the plugin asks `connectServiceId: gcal` so a missing scope points the person at the right connect. Endpoints: `users/me/calendarList`, `calendars/{id}/events` (list, get, insert, patch, delete).

**Why these screens:** Google Calendar's schedule view (the agenda), the event popup, and the quick-create dialog are the three screens people use from a chat; week/month grids do not survive in a chat column. Sources: calendar.google.com, Bonsai's own `gcal://` primer, asks in session history (what's on today, prep my next meeting, schedule a call).

| Screen in Google Calendar | Composition | Fields shown | Fields that edit | A Save writes | Chat adaptation |
| --- | --- | --- | --- | --- | --- |
| Schedule (agenda) view | `agenda` | day headers with the date badge, per event: calendar colour, time range, title, optional location / guest count / Meet glyph (Jev-picked) | none inline | — | Range is Jev-picked (today, tomorrow, this week, next week, next 7/14 days, yesterday, past week); a row click opens the event card |
| Event popup | `event` | colour, title, day · time range, location, Join with Google Meet, guests with RSVP dots, notes, Going? Yes/No/Maybe, calendar name | title, date, start/end time, location, guests (click to edit) | `events.patch { summary, start, end, location, attendees }`; RSVP → patch own `responseStatus` | Guests capped at 8 rows; notes fold after 3 lines; open-in-Google-Calendar icon |
| Create event dialog | `draft` | title, date, start/end, All day, guests, Meet toggle, location, description, calendar | all | `events.insert` (+ `conferenceData` for Meet) → then the event card | The agent passes start/end/attendees it heard; Jev picks duration, Meet, all-day, calendar |

**Jev picks (view):** range, view (agenda/event), then include-past, attendees, location, description. **Jev picks (draft):** Meet, all-day, duration (when no end), calendar (when several).

**Keys:** events are named `#a1b2c3` (a hash of calendar + event id) in cards and messages; the key → id map lives in the connector's cache.

**Card messages:** `Save event #a1b2c3: title → …; start → 2026-10-24 15:00; end → …; location → …; guests → …; meet → yes` · `Create event: <title>` + properties line + optional `Notes:` block · `RSVP #a1b2c3: yes|no|maybe` · `Delete event #a1b2c3` · `Show event #a1b2c3`.

**Not built:** recurring-event editing (edits hit the single instance), free/busy finder, multi-day grid, reminders, colours per event, attachments.
