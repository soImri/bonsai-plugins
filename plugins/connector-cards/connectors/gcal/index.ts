/**
 * The Google Calendar connector: events as Google Calendar's own UI.
 *
 *   view    words → events in a Jev-picked range, drawn as an agenda (or one event)
 *   record  #a1b2c3 or a title → one event with RSVP, guests, Meet
 *   draft   words (+ title, start, end, attendees from the agent) → Google's create dialog
 *   apply   the card's Save / Create / RSVP / Delete → written, card redrawn from Google's truth
 *
 * Reads and writes use Google Calendar v3 with Bonsai's Google sign-in (calendar scopes).
 */
import { HttpError, defineConnector, classify, ms, type Run, type CardResult } from "../../runtime.ts";
import { createEvent, deleteEvent, freeBusy, getEvent, listEvents, mergeAttendees, patchEvent, readMeta, rememberKeys, resolveKey, rsvp, type Busy, type Calendar, type Event, type EventBody } from "./api.ts";
import { RANGE_LABEL, createRubric, dayBounds, dayStart, monthGrid, rangeBounds, toGoogleTime, tzParts, viewRubric, wall, type Composition, type Picks, type Range } from "./rubrics.ts";
import { parseCardMessage, type EventChange, type EventCreate } from "./write.ts";

const KEY = /#[0-9a-f]{6}\b/i;

/** The agent's `fields.start` (ISO with or without an offset) → wall time "YYYY-MM-DD HH:MM" in tz. */
const wallFromInput = (input: unknown, tz: string): string | undefined => {
  if (typeof input !== "string" || !input.trim()) return undefined;
  const s = input.trim();
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(s)) return wall(s, tz);
  return s.replace("T", " ").slice(0, 16);
};
/** Pure arithmetic on a wall string, no zone involved. */
const addMinutesWall = (start: string, minutes: number): string => {
  const [d, t = "00:00"] = start.split(" ");
  const [h, m] = t.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const base = new Date(`${d}T00:00:00Z`); base.setUTCDate(base.getUTCDate() + Math.floor(total / 1440));
  return `${base.toISOString().slice(0, 10)} ${String(Math.floor((total % 1440) / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/** Working hours the free-time finder looks inside, as wall-clock hours in the calendar's zone. */
const WORKDAY = { start: 9, end: 18 };

/** Each day's busy blocks and the open slots between them, within working hours, from now on. */
function freeSlots(busy: Busy[], events: Event[], from: Date, to: Date, now: Date, tz: string, slotMin: number) {
  const days: { date: string; weekday: string; busy: { start: string; end: string; title?: string }[]; free: { start: string; end: string }[] }[] = [];
  const merged = busy.map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() })).sort((a, b) => a.s - b.s).reduce<{ s: number; e: number }[]>((acc, b) => { const last = acc[acc.length - 1]; if (last && b.s <= last.e) last.e = Math.max(last.e, b.e); else acc.push({ ...b }); return acc; }, []);
  for (let d = dayStart(from, tz); d < to; d = dayStart(d, tz, 1)) {
    const wd = tzParts(d, tz).wd;
    if (wd === 0 || wd === 6) continue;
    const dayS = Math.max(d.getTime() + WORKDAY.start * 3600e3, now.getTime());
    const dayE = d.getTime() + WORKDAY.end * 3600e3;
    if (dayE <= dayS) continue;
    const todays = merged.filter((b) => b.e > dayS && b.s < dayE);
    const free: { start: string; end: string }[] = [];
    let cursor = Math.ceil(dayS / (15 * 60e3)) * 15 * 60e3;
    for (const b of [...todays, { s: dayE, e: dayE }]) {
      if (b.s - cursor >= slotMin * 60e3) free.push({ start: wall(new Date(cursor).toISOString(), tz), end: wall(new Date(b.s).toISOString(), tz) });
      cursor = Math.max(cursor, b.e);
    }
    const titleFor = (b: { s: number; e: number }) => events.find((ev) => !ev.allDay && new Date(ev.start).getTime() < b.e && new Date(ev.end).getTime() > b.s)?.title;
    days.push({ date: wall(d.toISOString(), tz).slice(0, 10), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][wd], busy: todays.map((b) => ({ start: wall(new Date(Math.max(b.s, dayS)).toISOString(), tz), end: wall(new Date(Math.min(b.e, dayE)).toISOString(), tz), ...(titleFor(b) ? { title: titleFor(b) } : {}) })), free });
  }
  return days;
}

const calendarFor = (calendars: Calendar[], idOrName: string | undefined) => calendars.find((c) => c.id === idOrName) ?? calendars.find((c) => c.name.toLowerCase() === (idOrName ?? "").toLowerCase()) ?? calendars.find((c) => c.primary && c.writable) ?? calendars.find((c) => c.writable) ?? calendars[0];

async function eventByRef(token: string, cache: Run["cache"], calendars: Calendar[], ref: string, signal?: AbortSignal): Promise<Event | undefined> {
  const k = ref.match(KEY)?.[0]?.toLowerCase();
  if (k) { const hit = await resolveKey(cache, k); if (hit) { const cal = calendars.find((c) => c.id === hit.calendar); if (cal) return getEvent(token, cal, hit.id, signal); } }
  // A title: search the coming two weeks (and the past week), best match first.
  const now = new Date();
  const found = await listEvents(token, cache, calendars, new Date(now.getTime() - 7 * 864e5), new Date(now.getTime() + 14 * 864e5), ref, signal);
  const upcoming = found.filter((e) => new Date(e.end ?? e.start) >= now);
  return upcoming[0] ?? found[found.length - 1];
}

export const gcal = defineConnector({
  id: "gcal",
  label: "Google Calendar",
  summary: "meetings, events, invites and free time on the person's Google Calendar",
  aliases: ["calendar", "google calendar", "gcal", "cal"],
  auth: { serviceId: "google.account", schemeId: "google.oauth", requiredScopes: ["https://www.googleapis.com/auth/calendar.events"], connectServiceId: "gcal" },
  triggers: {
    keywords: ["calendar", "meeting", "meetings", "event", "events", "schedule", "invite", "invites", "invitation", "invitations", "agenda", "appointment", "call with", "tomorrow", "this week", "next week", "this month", "next month", "month", "free", "busy", "availability", "available", "find a time", "rsvp", "what's on", "whats on", "my day", "booked"],
    refPattern: KEY,
    messagePattern: /^(Save event|Create event|RSVP|Delete event)\b/,
  },
  examples: {
    view: ["what's on today", "my week", "what do I have tomorrow", "show me this month", "when am I free this week", "find 30 min for a call next week", "invites I haven't answered", "who am I meeting next week"],
    record: ["show my 3pm", "the call with Seb", "show #a1b2c3"],
    draft: ["schedule a call with Seb tomorrow at 3pm", "block Friday afternoon for focus", "set up a 30 min sync with alex@… on Monday"],
    apply: ["Save event #a1b2c3: start → 2026-10-24 15:00; end → 2026-10-24 15:30", "Create event: <title>\\n<properties line>", "RSVP #a1b2c3: yes", "Delete event #a1b2c3"],
  },
  filters: { calendar: "a calendar's name, to look at one calendar only", date: "one day, YYYY-MM-DD, when the ask names a specific date" },
  explain: (err) => (err instanceof HttpError ? (err.status === 401 ? "Google rejected Bonsai's sign-in (HTTP 401). Reconnect Google in App Store → Installed → Google Calendar → Connections." : err.status === 403 ? "Google refused (HTTP 403): the connected Google account has not granted calendar access to Bonsai. Reconnect Google Calendar in App Store → Installed." : undefined) : undefined),

  async view({ token, params, signal, startedAt, jev, cache, history }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const tz = meta.timeZone;
    const now = new Date();
    const only = params.filters?.calendar ? meta.calendars.filter((c) => c.name.toLowerCase() === String(params.filters.calendar).toLowerCase()) : meta.calendars;
    const calendars = only.length ? only : meta.calendars;
    const task: string = params.task ?? "";
    const pastWanted = /\b(yesterday|last week|past week|what did i)\b/i.test(task);
    const refs: string[] = (params.refs ?? []).filter((r: string) => KEY.test(r));
    const date: string | undefined = typeof params.filters?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.filters.date) ? params.filters.date : undefined;
    // The fetch window is decided before Jev answers: a month ask needs the month's 6-week grid, anything else ±2 weeks.
    const guessRange = viewRubric(task, [], tz, now).guess.range;
    const monthAhead = guessRange === "next_month" ? 1 : 0;
    const grid = monthGrid(now, tz, monthAhead);
    const wantsMonth = guessRange === "this_month" || guessRange === "next_month";
    let window: [Date, Date] = date ? dayBounds(date, tz) : wantsMonth ? [grid.gridStart, grid.gridEnd] : [dayStart(now, tz, pastWanted ? -7 : 0), dayStart(now, tz, 14)];
    let all: Event[];
    if (refs.length) all = (await Promise.all(refs.map((r) => eventByRef(token, cache, calendars, r, signal)))).filter(Boolean) as Event[];
    else all = await listEvents(token, cache, calendars, window[0], window[1], params.query, signal);
    const tGoogle = ms(startedAt);
    const rubric = viewRubric(task, all, tz, now);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const { value, took: tJev } = await jev({ purpose: "gcal-view" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, () => rubric.guess);
    const comp = value as Composition;
    if (date) comp.range = "day";
    // Jev chose a month the heuristic did not fetch for: fetch the grid now (rare, one more round trip).
    const isMonth = comp.range === "this_month" || comp.range === "next_month";
    const g = isMonth ? monthGrid(now, tz, comp.range === "next_month" ? 1 : 0) : grid;
    if (isMonth && !refs.length && (g.gridStart < window[0] || g.gridEnd > window[1])) { all = await listEvents(token, cache, calendars, g.gridStart, g.gridEnd, params.query, signal); window = [g.gridStart, g.gridEnd]; }
    if (isMonth && comp.view !== "free") comp.view = "month";
    const [from, to] = date ? dayBounds(date, tz) : isMonth ? [g.gridStart, g.gridEnd] : rangeBounds(comp.range, now, tz);
    let events = all;
    if (!refs.length) {
      events = all.filter((e) => { const s = new Date(e.start), en = new Date(e.end ?? e.start); return s < to && en > from && (comp.fields.past || isMonth || comp.range !== "today" || en >= now); });
      if (!events.length && comp.range === "today" && !comp.fields.past) { const todays = all.filter((e) => { const s = new Date(e.start); return s >= from && s < to; }); if (todays.length) { events = todays; comp.fields.past = true; } }
    }
    if (comp.fields.invitesOnly) events = events.filter((e) => e.myResponse === "needsAction");
    if (events.length === 1 && (comp.view === "event" || refs.length)) comp.view = "event";
    if (events.length !== 1 && comp.view === "event") comp.view = "agenda";
    const who = comp.by === "jev" ? `Jev picked, ${comp.variant} questions answered` : "default pick, Jev unavailable";
    const rangeLabel = date ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][tzParts(from, tz).wd]} ${date}` : RANGE_LABEL[comp.range];
    const cals = meta.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, primary: c.primary }));
    let extra: Record<string, unknown> = {};
    if (comp.view === "free") {
      // Availability: Google's freeBusy over the range, then the open slots between busy blocks in working hours.
      const [ff, ft] = isMonth ? [now, g.next] : [new Date(Math.max(from.getTime(), now.getTime())), to.getTime() > now.getTime() ? to : dayStart(now, tz, 7)];
      const busyMap = await freeBusy(token, calendars.map((c) => c.id), ff, ft, signal);
      const busy = Object.values(busyMap).flat();
      const slotMin = Number(task.match(/\b(\d{2,3})\s*(?:min|minutes)\b/i)?.[1] ?? (/\b(an? hour|1 ?h|60 ?min)\b/i.test(task) ? 60 : 30));
      extra = { free: { days: freeSlots(busy, all, ff, ft, now, tz, slotMin), slotMinutes: slotMin, workday: WORKDAY, from: wall(ff.toISOString(), tz), to: wall(ft.toISOString(), tz) } };
    }
    if (comp.view === "month") extra = { ...extra, month: { label: new Date(g.first.getTime() + 36e5 * 12).toLocaleDateString("en-US", { timeZone: tz, month: "long", year: "numeric" }), gridStart: wall(g.gridStart.toISOString(), tz).slice(0, 10), gridEnd: wall(g.gridEnd.toISOString(), tz).slice(0, 10), first: wall(g.first.toISOString(), tz).slice(0, 10), next: wall(g.next.toISOString(), tz).slice(0, 10) } };
    const payload = { kind: "view", task, timeZone: tz, now: wall(now.toISOString(), tz), rangeLabel, calendars: cals, events, composition: comp, ...extra, timing: { google: tGoogle, jev: tJev } };
    const picked = `${comp.view}, range ${comp.range}${comp.fields.attendees ? ", with guests" : ""}${comp.fields.location ? ", with locations" : ""}${comp.fields.invitesOnly ? ", invites only" : ""}`;
    const viewName = comp.view === "event" ? "an event card" : comp.view === "month" ? "a month grid" : comp.view === "free" ? "a find-a-time view" : "an agenda";
    if (!events.length && comp.view !== "free") return { summary: `No ${comp.fields.invitesOnly ? "unanswered invitations" : "events"} ${rangeLabel.toLowerCase()}. Say so in one line.`, payload, picked };
    return { summary: `Showing ${comp.view === "free" ? `free time (${rangeLabel})` : `${events.length} event${events.length === 1 ? "" : "s"} (${rangeLabel})`} as ${viewName} (${who}; Google ${tGoogle}, Jev ${tJev}). The card is the answer: reply with one short line or nothing. Never restate its fields.`, payload, picked };
  },

  async record({ token, params, signal, startedAt, cache }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const ev = await eventByRef(token, cache, meta.calendars, String(params.ref ?? ""), signal);
    if (!ev) throw new Error(`No event matches "${params.ref}" in the next two weeks.`);
    await rememberKeys(cache, [ev]);
    return { summary: `Showing "${ev.title}" (${wall(ev.start, meta.timeZone)}) as a Google Calendar event card (Google ${ms(startedAt)}). The card is the answer: reply with one short line or nothing.`, payload: { kind: "event", timeZone: meta.timeZone, event: ev, calendars: meta.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, primary: c.primary })), timing: { google: ms(startedAt) } } };
  },

  async draft({ token, params, signal, startedAt, jev, cache, history }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const tz = meta.timeZone;
    const tGoogle = ms(startedAt);
    const f = params.fields ?? {};
    const title = (params.title?.trim() || String(params.task ?? "").replace(/^(please\s+)?(schedule|book|set up|setup|create|add|put|block)\s+(a\s+|an\s+)?/i, "").split(/\b(on|at|for|tomorrow|next|this)\b/i)[0].trim() || "New event").slice(0, 120);
    const attendees: string[] = Array.isArray(f.attendees) ? f.attendees : typeof f.attendees === "string" ? f.attendees.split(/[,;]\s*/).filter(Boolean) : [];
    const rubric = createRubric(params.task ?? "", title, Boolean(f.end), attendees, meta.calendars);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const { value: picks, took: tJev } = await jev({ purpose: "gcal-new-event" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, rubric.guess) as { value: Picks; took: string };
    const allDay = typeof f.allDay === "boolean" ? f.allDay : picks.allDay;
    const now = new Date();
    const nextHalf = new Date(Math.ceil((now.getTime() + 5 * 60e3) / (30 * 60e3)) * 30 * 60e3);
    const start = wallFromInput(f.start, tz) ?? wall(nextHalf.toISOString(), tz);
    const endWall = wallFromInput(f.end, tz) ?? addMinutesWall(start, picks.durationMin);
    const calendar = calendarFor(meta.calendars, f.calendar ?? picks.calendar);
    const draft = { title, description: params.body?.trim() ?? "", start, end: endWall, allDay, attendees, location: f.location ?? "", meet: typeof f.meet === "boolean" ? f.meet : picks.meet, calendar: calendar?.id, calendarName: calendar?.name, timeZone: tz };
    return {
      summary: `Draft "${title}" shown as Google Calendar's create dialog: ${allDay ? start.slice(0, 10) : `${start} → ${endWall}`}${attendees.length ? `, guests ${attendees.join(", ")}` : ""}${draft.meet ? ", with Meet" : ""} (${picks.by === "jev" ? `Jev picked, ${picks.variant} questions answered` : "default pick, Jev unavailable"}; Google ${tGoogle}, Jev ${tJev}). Stop here with at most one short line. When the person presses Save, a message starting 'Create event:' arrives: call cards_apply with that whole message in \`message\`.`,
      payload: { kind: "draft", draft, calendars: meta.calendars.filter((c) => c.writable).map((c) => ({ id: c.id, name: c.name, color: c.color, primary: c.primary })), picks: { by: picks.by, confidence: picks.confidence }, timing: { google: tGoogle, jev: tJev } },
      picked: `${allDay ? "all day" : `${picks.durationMin} min`}${draft.meet ? ", Meet" : ""}, calendar ${calendar?.name ?? "primary"}`,
    };
  },

  async apply({ token, params, signal, startedAt, cache }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const tz = meta.timeZone;
    const parsed = typeof params.message === "string" ? parseCardMessage(params.message) : { changes: [] as EventChange[] };
    const p = params.payload ?? {};
    const changes: EventChange[] = [...parsed.changes, ...(p.changes ?? [])];
    const create: EventCreate | undefined = p.create ?? parsed.create;
    const rsvpReq = p.rsvp ?? parsed.rsvp;
    const del: string | undefined = p.delete ?? parsed.delete;
    if (!changes.length && !create && !rsvpReq && !del) throw new Error("Nothing to apply: the message did not parse as a calendar card command and no payload was passed.");
    const applied: string[] = [];
    const fresh: Event[] = [];
    let correction: string | undefined;
    const locate = async (key: string) => { const hit = await resolveKey(cache, key); const cal = hit && meta.calendars.find((c) => c.id === hit.calendar); if (!hit || !cal) throw new Error(`I no longer know which event ${key} is. Show it again first.`); return { cal, id: hit.id }; };
    for (const c of changes) {
      const { cal, id } = await locate(c.key);
      const current = await getEvent(token, cal, id, signal);
      const body: EventBody = {};
      if (c.title !== undefined) body.summary = c.title;
      if (c.location !== undefined) body.location = c.location ?? "";
      if (c.start !== undefined) body.start = toGoogleTime(c.start, tz, current.allDay);
      if (c.end !== undefined) body.end = toGoogleTime(c.end, tz, current.allDay);
      if (c.guests !== undefined) body.attendees = mergeAttendees(current.attendees, c.guests);
      if (c.meet === true && !current.meet) (body as any).conferenceData = { createRequest: { requestId: `cc-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
      const ev = await patchEvent(token, cal, id, body, signal);
      fresh.push(ev);
      applied.push(`${ev.title}: ${Object.keys(body).map((k) => (k === "summary" ? "title" : k)).join(", ")} saved`);
    }
    if (create) {
      const cal = calendarFor(meta.calendars.filter((c) => c.writable), create.calendar);
      if (!cal) throw new Error("No writable calendar on this Google account.");
      if (!create.start) throw new Error("The event needs a start time.");
      const allDay = Boolean(create.allDay);
      const body: EventBody = { summary: create.title, ...(create.description ? { description: create.description } : {}), ...(create.location ? { location: create.location } : {}), start: toGoogleTime(create.start, tz, allDay), end: toGoogleTime(create.end ?? create.start, tz, allDay), ...(create.guests?.length ? { attendees: create.guests.map((email) => ({ email })) } : {}) };
      if (allDay && body.end?.date === body.start?.date) { const d = new Date(`${body.start!.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); body.end = { date: d.toISOString().slice(0, 10) }; }
      const ev = await createEvent(token, cal, body, Boolean(create.meet), signal);
      fresh.push(ev);
      applied.push(`"${ev.title}" created ${allDay ? ev.start : wall(ev.start, tz)}`);
      correction = `created ${allDay ? "all day" : `${create.start} → ${create.end ?? "?"}`}${create.meet ? ", Meet" : ", no Meet"}${create.guests?.length ? `, ${create.guests.length} guests` : ""}`;
    }
    if (rsvpReq) { const { cal, id } = await locate(rsvpReq.key); const ev = await rsvp(token, cal, id, rsvpReq.response, signal); fresh.push(ev); applied.push(`${ev.title}: RSVP ${rsvpReq.response}`); }
    if (del) { const { cal, id } = await locate(del); const ev = await getEvent(token, cal, id, signal).catch(() => undefined); await deleteEvent(token, cal, id, signal); applied.push(`${ev?.title ?? del}: deleted`); }
    await rememberKeys(cache, fresh);
    const tWrite = ms(startedAt);
    const comp: Composition = { view: fresh.length === 1 ? "event" : "agenda", range: "next_14_days", fields: { attendees: true, location: true, description: fresh.length === 1, past: true, invitesOnly: false }, by: "fallback" };
    return {
      summary: `Saved to Google Calendar: ${applied.join("; ")} (Google ${tWrite}). ${fresh.length ? "The card shows the updated event; " : ""}reply with one short line or nothing.`,
      payload: fresh.length === 1 ? { kind: "event", timeZone: tz, event: fresh[0], calendars: meta.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, primary: c.primary })), applied, timing: { google: tWrite } } : { kind: "view", task: "Saved", timeZone: tz, now: wall(new Date().toISOString(), tz), calendars: meta.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, primary: c.primary })), events: fresh, composition: comp, applied, timing: { google: tWrite } },
      ...(typeof correction === "string" ? { correction } : {}),
    };
  },
});
