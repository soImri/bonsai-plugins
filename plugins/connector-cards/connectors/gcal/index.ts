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
import { HttpError, defineConnector, classify, ms, type Run, type CardResult, remembered } from "../../runtime.ts";
import { createEvent, deleteEvent, freeBusy, getEvent, listEvents, mergeAttendees, patchEvent, readMeta, rememberKeys, resolveKey, rsvp, type Busy, type Calendar, type Event, type EventBody } from "./api.ts";
import { RANGE_LABEL, createRubric, dayBounds, dayStart, monthGrid, rangeBounds, toGoogleTime, tzParts, viewRubric, wall, type Composition, type Picks, type Range } from "./rubrics.ts";
import { agendaFollowUps, draftFollowUps, eventFollowUps } from "./rubrics.ts";
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

/** "find 45 min for a call with Seb next week" → "Call with Seb"; anything else → "New event". */
function titleFromAsk(task: string): string {
  const STOP = /^(next|this|on|tomorrow|today|at|in|for|about|and|or|the|a|an|sometime|early|late|before|after)$/i;
  const m = task.match(/\b((?:quick\s+)?(?:call|meeting|sync|chat|coffee|interview|review|catch[- ]?up|check[- ]?in|1:1|one on one|lunch|demo|walkthrough|session))\s+(?:with|w\/)\s+([A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*)?)/i);
  if (m) {
    const name = m[2].split(/\s+/).filter((w, i) => i === 0 || !STOP.test(w)).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
    return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} with ${name}`;
  }
  const n = task.match(/\b(?:for|about)\s+(?:a|an|the)?\s*([a-z][\w' -]{2,40}?)(?:\s+(?:next|this|on|tomorrow|today|at|in)\b|$)/i);
  return n ? n[1].trim().replace(/^\w/, (c) => c.toUpperCase()) : "New event";
}

/**
 * Suggested starts, like Google's "Suggested times": every :00/:30 inside a free gap that fits the
 * slot, scored to prefer mid-morning and early afternoon, a 15-minute buffer from busy blocks, and
 * sooner days; at most two per day, six in all.
 */
const minsOfWall = (w: string) => { const [h, m] = (w.split(" ")[1] ?? "0:0").split(":").map(Number); return h * 60 + m; };
function suggest(days: ReturnType<typeof freeSlots>, slotMin: number) {
  const scored: { date: string; weekday: string; start: string; end: string; score: number }[] = [];
  days.forEach((day, di) => {
    for (const gap of day.free) {
      const [gh, gm] = gap.start.split(" ")[1].split(":").map(Number); const [eh, em] = gap.end.split(" ")[1].split(":").map(Number);
      const gapStart = gh * 60 + gm, gapEnd = eh * 60 + em;
      for (let t = Math.ceil(gapStart / 30) * 30; t + slotMin <= gapEnd; t += 30) {
        const h = t / 60;
        let score = 0;
        if (h >= 10 && h < 12) score += 3; else if (h >= 14 && h < 16) score += 2; else if (h >= 9 && h < 17) score += 1;
        if (t - gapStart >= 15 && gapEnd - (t + slotMin) >= 15) score += 1; // breathing room
        if (t % 60 === 0) score += 0.5;
        score -= di * 0.4;
        const hh = (n: number) => `${day.date} ${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
        scored.push({ date: day.date, weekday: day.weekday, start: hh(t), end: hh(t + slotMin), score });
      }
    }
  });
  // Best morning and best afternoon per day, so the list reads like Google's: a few distinct options, not six at 10:00.
  const out: typeof scored = [];
  for (const s of scored.sort((a, b) => b.score - a.score)) {
    const mine = out.filter((o) => o.date === s.date);
    const afternoon = minsOfWall(s.start) >= 12 * 60;
    if (mine.length >= 2 || mine.some((o) => (minsOfWall(o.start) >= 12 * 60) === afternoon)) continue;
    out.push(s); if (out.length >= 6) break;
  }
  return out.sort((a, b) => a.start.localeCompare(b.start)).map(({ date, weekday, start, end }) => ({ date, weekday, start, end }));
}

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

  async view({ token, params, signal, startedAt, jev, cache, history, followUps, recall }: Run): Promise<CardResult> {
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
    // The card navigates inside what we fetch, so fetch a superset: two weeks back and ahead, plus this month's and next month's grids.
    const nextGrid = monthGrid(now, tz, 1);
    const superset: [Date, Date] = [new Date(Math.min(dayStart(now, tz, pastWanted ? -7 : -14).getTime(), grid.gridStart.getTime())), new Date(Math.max(dayStart(now, tz, 14).getTime(), nextGrid.gridEnd.getTime()))];
    let window: [Date, Date] = date ? dayBounds(date, tz) : superset;
    void wantsMonth;
    let all: Event[];
    if (refs.length) all = (await Promise.all(refs.map((r) => eventByRef(token, cache, calendars, r, signal)))).filter(Boolean) as Event[];
    else all = await listEvents(token, cache, calendars, window[0], window[1], params.query, signal);
    const tGoogle = ms(startedAt);
    const rubric = viewRubric(task, all, tz, now);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const g0 = rubric.guess;
    const [{ value, took: tJev }, fu] = await Promise.all([
      remembered(recall, () => jev({ purpose: "gcal-view" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, () => rubric.guess)),
      followUps("gcal-follow-ups", { task, shape: refs.length === 1 || all.length === 1 ? "event" : g0.view, eventCount: all.length }, refs.length === 1 || all.length === 1 ? eventFollowUps(task, all[0] ?? {}) : agendaFollowUps(task, g0.view, all)),
    ]);
    const comp = value as Composition;
    comp.followUps = fu.actions;
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
      const days = freeSlots(busy, all, ff, ft, now, tz, slotMin);
      extra = { free: { days, suggested: suggest(days, slotMin), slotMinutes: slotMin, workday: WORKDAY, from: wall(ff.toISOString(), tz), to: wall(ft.toISOString(), tz), seed: { title: titleFromAsk(task), meet: /\b(call|zoom|meet|video|remote|online)\b/i.test(task) }, calendars: meta.calendars.filter((c) => c.writable).map((c) => ({ id: c.id, name: c.name, color: c.color, primary: c.primary })) } };
    }
    const monthInfo = (mg: ReturnType<typeof monthGrid>) => ({ label: new Date(mg.first.getTime() + 36e5 * 12).toLocaleDateString("en-US", { timeZone: tz, month: "long", year: "numeric" }), gridStart: wall(mg.gridStart.toISOString(), tz).slice(0, 10), gridEnd: wall(mg.gridEnd.toISOString(), tz).slice(0, 10), first: wall(mg.first.toISOString(), tz).slice(0, 10), next: wall(mg.next.toISOString(), tz).slice(0, 10) });
    const months = [monthInfo(monthGrid(now, tz, 0)), monthInfo(nextGrid)];
    extra = { ...extra, month: monthInfo(g), months, window: { from: wall(window[0].toISOString(), tz), to: wall(window[1].toISOString(), tz) } };
    const payload = { kind: "view", task, timeZone: tz, now: wall(now.toISOString(), tz), rangeLabel, calendars: cals, events, allEvents: all, composition: comp, ...extra, timing: { google: tGoogle, jev: tJev } };
    const picked = `${comp.view}, range ${comp.range}${comp.fields.attendees ? ", with guests" : ""}${comp.fields.location ? ", with locations" : ""}${comp.fields.invitesOnly ? ", invites only" : ""}`;
    const viewName = comp.view === "event" ? "an event card" : comp.view === "month" ? "a month grid" : comp.view === "free" ? "a find-a-time view" : "an agenda";
    void who; void viewName;
    if (!events.length && comp.view !== "free") return { summary: `No ${comp.fields.invitesOnly ? "unanswered invitations" : "events"} ${rangeLabel.toLowerCase()}; the card says so and offers other ranges. Reply with nothing.`, payload, picked, offered: fu.actions, remember: comp };
    return { summary: `Card shown (${comp.view === "free" ? "find a time" : `${events.length} event${events.length === 1 ? "" : "s"}, ${rangeLabel}`}). Reply with nothing: the card is the whole answer, and the person navigates inside it.`, payload, picked, offered: fu.actions , remember: comp };
  },

  async record({ token, params, signal, startedAt, cache, followUps, context }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const ev = await eventByRef(token, cache, meta.calendars, String(params.ref ?? ""), signal);
    if (!ev) throw new Error(`No event matches "${params.ref}" in the next two weeks.`);
    await rememberKeys(cache, [ev]);
    const fu = await followUps("gcal-follow-ups", { task: params.ref, event: { title: ev.title, start: ev.start, myResponse: ev.myResponse ?? "own", guests: ev.attendees.length } }, eventFollowUps(`${params.ref} ${context ?? ""}`, ev));
    return { summary: `Card shown ("${ev.title}"). Reply with nothing.`, picked: `event${fu.actions.length ? `, follow-ups ${fu.actions.join(", ")}` : ""}`, offered: fu.actions, remember: { by: fu.by }, payload: { kind: "event", followUps: fu.actions, timeZone: meta.timeZone, event: ev, calendars: meta.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, primary: c.primary })), timing: { google: ms(startedAt) } } };
  },

  async draft({ token, params, signal, startedAt, jev, cache, history, followUps }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const tz = meta.timeZone;
    const tGoogle = ms(startedAt);
    const f = params.fields ?? {};
    const title = (params.title?.trim() || String(params.task ?? "").replace(/^(please\s+)?(schedule|book|set up|setup|create|add|put|block)\s+(a\s+|an\s+)?/i, "").split(/\b(on|at|for|tomorrow|next|this)\b/i)[0].trim() || "New event").slice(0, 120);
    const attendees: string[] = Array.isArray(f.attendees) ? f.attendees : typeof f.attendees === "string" ? f.attendees.split(/[,;]\s*/).filter(Boolean) : [];
    const rubric = createRubric(params.task ?? "", title, Boolean(f.end), attendees, meta.calendars);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const [{ value: picks, took: tJev }, fu] = await Promise.all([
      jev({ purpose: "gcal-new-event" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, rubric.guess) as Promise<{ value: ReturnType<typeof rubric.guess>; took: string }>,
      followUps("gcal-follow-ups", { task: params.task, title, guests: attendees.join(", ") || "none" }, draftFollowUps(params.task ?? "", { attendees, meet: Boolean(f.meet), location: f.location, description: params.body?.trim() }, meta.calendars.filter((c) => c.writable).length)),
    ]);
    const allDay = typeof f.allDay === "boolean" ? f.allDay : picks.allDay;
    const now = new Date();
    const nextHalf = new Date(Math.ceil((now.getTime() + 5 * 60e3) / (30 * 60e3)) * 30 * 60e3);
    const start = wallFromInput(f.start, tz) ?? wall(nextHalf.toISOString(), tz);
    const endWall = wallFromInput(f.end, tz) ?? addMinutesWall(start, picks.durationMin);
    const calendar = calendarFor(meta.calendars, f.calendar ?? picks.calendar);
    const draft = { title, description: params.body?.trim() ?? "", start, end: endWall, allDay, attendees, location: f.location ?? "", meet: typeof f.meet === "boolean" ? f.meet : picks.meet, calendar: calendar?.id, calendarName: calendar?.name, timeZone: tz , followUps: fu.actions };
    return {
      summary: `Create dialog shown. Reply with nothing and stop; do not describe the draft or tell the person what to press. When a message starting 'Create event:' arrives, call cards_apply with it verbatim in \`message\`.`,
      payload: { kind: "draft", draft, calendars: meta.calendars.filter((c) => c.writable).map((c) => ({ id: c.id, name: c.name, color: c.color, primary: c.primary })), picks: { by: picks.by, confidence: picks.confidence }, timing: { google: tGoogle, jev: tJev } },
      picked: `${allDay ? "all day" : `${picks.durationMin} min`}${draft.meet ? ", Meet" : ""}, calendar ${calendar?.name ?? "primary"}`, offered: fu.actions, remember: { by: fu.by },
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
    const used = [...new Set([...changes.flatMap((c) => [c.start !== undefined || c.end !== undefined ? "reschedule" : "", c.guests !== undefined ? "guests" : "", c.title !== undefined || c.location !== undefined ? "details" : "", c.meet !== undefined ? "meet" : ""].filter(Boolean)), ...(rsvpReq ? ["rsvp"] : []), ...(create ? ["create"] : []), ...(del ? ["delete"] : [])])];
    const comp: Composition = { view: fresh.length === 1 ? "event" : "agenda", range: "next_14_days", fields: { attendees: true, location: true, description: fresh.length === 1, past: true, invitesOnly: false }, by: "fallback" , followUps: used.filter((u) => u === "rsvp" || u === "reschedule" || u === "guests" || u === "details") };
    return {
      summary: `Saved to Google Calendar: ${applied.join("; ")}. The card shows the result; reply with nothing.`,
      payload: fresh.length === 1 ? { kind: "event", followUps: comp.followUps, timeZone: tz, event: fresh[0], calendars: meta.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, primary: c.primary })), applied, timing: { google: tWrite } } : { kind: "view", task: "Saved", timeZone: tz, now: wall(new Date().toISOString(), tz), calendars: meta.calendars.map((c) => ({ id: c.id, name: c.name, color: c.color, writable: c.writable, primary: c.primary })), events: fresh, composition: comp, applied, timing: { google: tWrite } },
      ...(typeof correction === "string" ? { correction } : {}), used,
    };
  },
});
