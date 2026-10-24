/**
 * Google Calendar rubrics: what Jev is asked (most important first, ≤ 8) and the heuristics that
 * answer when Jev is not there. Plus the date arithmetic in the calendar's own time zone.
 */
import { choiceOf, yesOf, type JevAnswers, type JevQuestion } from "../../runtime.ts";
import type { FollowUp } from "../../runtime.ts";
import type { Calendar, Event } from "./api.ts";

/* ---------- time in a zone ---------- */
export function tzParts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
  const p: Record<string, string> = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday) };
}
const offsetMs = (d: Date, tz: string) => { const p = tzParts(d, tz); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - d.getTime(); };
/** Midnight at the start of `d`'s day (+ `addDays`) in `tz`, as an instant. */
export function dayStart(d: Date, tz: string, addDays = 0): Date {
  const p = tzParts(d, tz);
  const naive = Date.UTC(p.y, p.m - 1, p.d + addDays, 0, 0, 0);
  return new Date(naive - offsetMs(new Date(naive), tz));
}
/** "2026-10-24 15:00" (wall time in tz) → the Google body's {dateTime, timeZone}; an offset/Z string passes through. */
export function toGoogleTime(s: string, tz: string, allDay: boolean): { dateTime?: string; date?: string; timeZone?: string } {
  const t = s.trim().replace(" ", "T");
  if (allDay) return { date: t.slice(0, 10) };
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(t)) return { dateTime: t };
  return { dateTime: t.length === 16 ? `${t}:00` : t, timeZone: tz };
}
/** An ISO instant → "2026-10-24 15:00" wall time in tz (what cards show and send). */
export function wall(iso: string | undefined, tz: string): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const p = tzParts(new Date(iso), tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")} ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/* ---------- ranges ---------- */
export type Range = "today" | "tomorrow" | "rest_of_week" | "next_week" | "next_7_days" | "next_14_days" | "yesterday" | "past_week" | "this_month" | "next_month" | "day";
export const RANGE_LABEL: Record<Range, string> = { today: "Today", tomorrow: "Tomorrow", rest_of_week: "This week", next_week: "Next week", next_7_days: "Next 7 days", next_14_days: "Next 14 days", yesterday: "Yesterday", past_week: "Past week", this_month: "This month", next_month: "Next month", day: "Day" };

/** Midnight at the start of the month `addMonths` from `d`'s month, in tz. */
export function monthStart(d: Date, tz: string, addMonths = 0): Date {
  const p = tzParts(d, tz);
  const naive = Date.UTC(p.y, p.m - 1 + addMonths, 1, 0, 0, 0);
  return new Date(naive - offsetMs(new Date(naive), tz));
}
/** The 6-week grid Google draws for a month: from the Sunday on or before the 1st to the Saturday on or after the last day. */
export function monthGrid(d: Date, tz: string, addMonths = 0): { first: Date; next: Date; gridStart: Date; gridEnd: Date } {
  const first = monthStart(d, tz, addMonths);
  const next = monthStart(d, tz, addMonths + 1);
  const gridStart = dayStart(first, tz, -tzParts(first, tz).wd);
  const last = dayStart(next, tz, -1);
  const gridEnd = dayStart(last, tz, 7 - tzParts(last, tz).wd);
  return { first, next, gridStart, gridEnd };
}

export function rangeBounds(r: Range, now: Date, tz: string): [Date, Date] {
  const d0 = dayStart(now, tz);
  const wd = tzParts(now, tz).wd; // 0 = Sun
  const daysToMon = ((8 - wd) % 7) || 7; // next Monday
  switch (r) {
    case "today": return [d0, dayStart(now, tz, 1)];
    case "tomorrow": return [dayStart(now, tz, 1), dayStart(now, tz, 2)];
    case "rest_of_week": return [d0, dayStart(now, tz, daysToMon)];
    case "next_week": return [dayStart(now, tz, daysToMon), dayStart(now, tz, daysToMon + 7)];
    case "next_7_days": return [d0, dayStart(now, tz, 7)];
    case "next_14_days": return [d0, dayStart(now, tz, 14)];
    case "yesterday": return [dayStart(now, tz, -1), d0];
    case "past_week": return [dayStart(now, tz, -7), d0];
    case "this_month": return [monthStart(now, tz), monthStart(now, tz, 1)];
    case "next_month": return [monthStart(now, tz, 1), monthStart(now, tz, 2)];
    case "day": return [d0, dayStart(now, tz, 1)];
  }
}
/** Bounds for one named day ("2026-10-27") in tz. */
export function dayBounds(date: string, tz: string): [Date, Date] {
  const noonUtc = new Date(`${date}T12:00:00Z`);
  const probe = new Date(noonUtc.getTime() - offsetMs(noonUtc, tz));
  return [dayStart(probe, tz), dayStart(probe, tz, 1)];
}
export function guessRange(task: string): Range {
  const t = task.toLowerCase();
  if (/\bnext month\b/.test(t)) return "next_month";
  if (/\b(this month|the month|my month|month view|monthly)\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/.test(t)) return "this_month";
  if (/\byesterday\b/.test(t)) return "yesterday";
  if (/\b(last|past) week\b/.test(t)) return "past_week";
  if (/\btomorrow\b/.test(t)) return "tomorrow";
  if (/\bnext week\b/.test(t)) return "next_week";
  if (/\b(this week|rest of (the )?week|week)\b/.test(t)) return "rest_of_week";
  if (/\b(today|tonight|this afternoon|this morning|now|next)\b/.test(t)) return "today";
  if (/\b(two weeks|14 days|fortnight)\b/.test(t)) return "next_14_days";
  return "next_7_days";
}

/* ---------- the view rubric ---------- */
export type Composition = { view: "agenda" | "event" | "month" | "free"; range: Range; fields: { attendees: boolean; location: boolean; description: boolean; past: boolean; invitesOnly: boolean }; by: "jev" | "fallback" | "memory"; confidence?: number; variant?: string; followUps?: string[];
  /** The navigation chips this card shows (range keys plus "invites", "free"): the asked range and its neighbour, peripheral info that exists, what Jev added; the full set only for a general look. */
  chips?: string[] };

export function guessView(task: string, range: Range): Composition["view"] {
  if (/\b(free|available|availability|open slot|find (a )?time|when can|fit in|book a time)\b/i.test(task)) return "free";
  if (range === "this_month" || range === "next_month" || /\bmonth\b/i.test(task)) return "month";
  return "agenda";
}

export function viewRubric(task: string, sample: Event[], tz: string, now: Date) {
  const gr = guessRange(task);
  const guess: Composition = { view: guessView(task, gr), range: gr, fields: { attendees: /\b(who|guest|attendee|with)\b/i.test(task), location: /\b(where|room|location|office)\b/i.test(task), description: /\b(about|agenda|notes|detail)\b/i.test(task), past: /\b(all|everything|whole|yesterday|past|last|month)\b/i.test(task), invitesOnly: /\b(invite|invites|invitation|invitations|rsvp|respond|haven't answered|not answered|pending)\b/i.test(task) }, by: "fallback" };
  const state = { task, now: wall(now.toISOString(), tz), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][tzParts(now, tz).wd], eventsNext14Days: sample.length, sample: sample.slice(0, 10).map((e) => ({ key: e.key, title: e.title, start: wall(e.start, tz), allDay: e.allDay, guests: e.attendees.length })) };
  const questions: Record<string, JevQuestion> = {
    range: { type: "choice", instructions: "Which stretch of time does the task ask about? Judge the words. 'what's on', 'what do I have', 'my day', 'next meeting' -> today; 'tomorrow' -> tomorrow; 'this week', 'rest of the week' -> rest_of_week; 'next week' -> next_week; 'coming up', 'upcoming', 'my calendar' with no time word -> next_7_days; 'the next two weeks' -> next_14_days; 'yesterday' -> yesterday; 'last week', 'what did I have' -> past_week; 'this month', 'my month', 'October' -> this_month; 'next month' -> next_month.",
      criteria: { today: "The rest of today (or all of today when the task says so).", tomorrow: "Tomorrow only.", rest_of_week: "From today to the end of this week.", next_week: "Next Monday to Sunday.", next_7_days: "The coming seven days.", next_14_days: "The coming two weeks.", yesterday: "Yesterday only.", past_week: "The last seven days.", this_month: "The whole current month.", next_month: "The whole next month." } },
    view: { type: "choice", instructions: "Pick the composition. One specific meeting ('my 3pm', 'the call with Seb', 'next meeting') -> event; a stretch of time -> agenda; a whole month or 'month view' -> month; free time, availability, 'when am I free', 'find a time', 'fit in a 30 min call' -> free.", criteria: { agenda: "Events listed under day headers, like Google Calendar's schedule view.", event: "One event in full: time, guests, location, notes, Meet link, RSVP.", month: "Google Calendar's month grid: seven columns, one cell per day with its events.", free: "Find a time: each day's busy blocks and the open slots between them, to pick one." } },
    invitesOnly: { type: "bool", instructions: "Show only invitations the person has not answered yet?", criteria: { true: "The task is about invites, RSVPs, things to respond to, or pending invitations.", false: "The task is about the schedule in general." } },
    past: { type: "bool", instructions: "Include events that have already ended today?", criteria: { true: "The task asks about the whole day, the past, or what happened.", false: "The task is about what is still ahead." } },
    attendees: { type: "bool", instructions: "Show the guest list on each event?", criteria: { true: "The task is about people: who, with whom, guests, attendees, RSVPs.", false: "Times and titles are enough." } },
    location: { type: "bool", instructions: "Show locations?", criteria: { true: "The task asks where, mentions rooms, offices, travel, or in-person meetings.", false: "Location does not matter." } },
    description: { type: "bool", instructions: "Show event notes/descriptions?", criteria: { true: "The task asks what a meeting is about, its agenda, or details.", false: "Notes do not matter." } },
  };
  const read = (answers: JevAnswers, variant: string): Composition | undefined => {
    if (answers.range?.type !== "choice") return undefined;
    return { view: choiceOf(answers, "view", guess.view) as Composition["view"], range: answers.range.choice as Range, fields: { attendees: yesOf(answers, "attendees", guess.fields.attendees), location: yesOf(answers, "location", guess.fields.location), description: yesOf(answers, "description", guess.fields.description), past: yesOf(answers, "past", guess.fields.past), invitesOnly: yesOf(answers, "invitesOnly", guess.fields.invitesOnly) }, by: "jev", confidence: answers.range.confidence, variant };
  };
  return { state, questions, read, guess };
}

/* ---------- the create rubric ---------- */
export type Picks = { durationMin: number; meet: boolean; allDay: boolean; calendar?: string; by: "jev" | "fallback"; confidence?: number; variant?: string };

export function createRubric(task: string, title: string, hasEnd: boolean, attendees: string[], calendars: Calendar[]) {
  const writable = calendars.filter((c) => c.writable);
  const guess = (): Picks => ({ durationMin: /\b(1 ?h|hour|60)\b/i.test(task) ? 60 : /\b(15|quick)\b/i.test(task) ? 15 : /\b45\b/.test(task) ? 45 : 30, meet: attendees.length > 0 || /\b(call|zoom|meet|video|remote)\b/i.test(task), allDay: /\b(all[- ]day|whole day|day off|holiday|ooo|out of office)\b/i.test(task), calendar: (writable.find((c) => c.primary) ?? writable[0])?.id, by: "fallback" });
  const questions: Record<string, JevQuestion> = {
    meet: { type: "bool", instructions: "Add a Google Meet link?", criteria: { true: "A call, video, remote or online meeting, or guests who are not in the same place.", false: "In person, a reminder, a block of focus time, or no guests." } },
    allDay: { type: "bool", instructions: "Is this an all-day event rather than a timed one?", criteria: { true: "A day off, holiday, out-of-office, a deadline, or 'all day'.", false: "A meeting, call, or anything with a time." } },
  };
  if (!hasEnd) questions.duration = { type: "choice", instructions: "How long should the event be when the task gives no end time?", criteria: { "15": "A quick sync or check-in.", "30": "An ordinary meeting or call; the default.", "45": "A longer discussion.", "60": "A one-hour meeting, interview, or review.", "90": "A workshop or deep session.", "120": "A half-day block." } };
  if (writable.length > 1) questions.calendar = { type: "choice", instructions: "Which calendar does this belong on, judged by the task against the calendar names?", criteria: Object.fromEntries(writable.slice(0, 8).map((c, i) => [`c${i}`, `${c.name}${c.primary ? " (primary; the default)" : ""}`])) };
  const state = { task, title, attendees: attendees.join(", ") || "none", calendars: writable.map((c) => c.name).join(", ") };
  const read = (answers: JevAnswers, variant: string): Picks | undefined => {
    if (answers.meet?.type !== "bool") return undefined;
    const g = guess();
    const cal = answers.calendar?.type === "choice" ? writable[Number(String(answers.calendar.choice).slice(1))]?.id : undefined;
    return { durationMin: answers.duration?.type === "choice" ? Number(answers.duration.choice) : g.durationMin, meet: yesOf(answers, "meet", g.meet), allDay: yesOf(answers, "allDay", g.allDay), calendar: cal ?? g.calendar, by: "jev", confidence: answers.meet.probability, variant };
  };
  return { state, questions, read, guess };
}


/* ---------- navigation: which chips a card shows. The chip row is our adaptation, not Google Calendar's own screen, so it is tailored to the ask. ---------- */
export const GOLDEN_CHIPS = ["today", "tomorrow", "rest_of_week", "next_week", "this_month", "invites", "free"];
const CHIP_ORDER = ["yesterday", "past_week", "today", "tomorrow", "rest_of_week", "next_7_days", "next_week", "next_14_days", "this_month", "next_month", "invites", "free"];
const NEIGHBOUR: Record<string, string[]> = { today: ["tomorrow"], tomorrow: ["rest_of_week"], rest_of_week: ["next_week"], next_week: ["rest_of_week"], next_7_days: ["next_14_days"], next_14_days: ["this_month"], yesterday: ["today"], past_week: ["rest_of_week"], this_month: ["next_month"], next_month: ["this_month"], day: [], invites: ["rest_of_week"] };
/** The asked range + its neighbour, "Invites · N" when invitations are pending, plus what Jev added (find / month); the golden set for a general look. */
export function chipsFor(comp: { view: string; range: string; fields: { invitesOnly?: boolean } }, picked: string[], pendingInvites: number): string[] {
  if (picked.includes("full_navigation")) return GOLDEN_CHIPS.filter((k) => k !== "invites" || pendingInvites > 0 || comp.fields.invitesOnly);
  // A find-a-time card navigates by its own day grid; a range chip beside it ("This week") is noise.
  if (comp.view === "free") return CHIP_ORDER.filter((k) => k === "free" || (k === "this_month" && picked.includes("month")));
  const active = comp.fields.invitesOnly ? "invites" : comp.range;
  const set = new Set<string>([active, ...(NEIGHBOUR[comp.range] ?? [])]);
  if (pendingInvites > 0) set.add("invites");
  if (picked.includes("find")) set.add("free");
  if (picked.includes("month")) set.add("this_month");
  return CHIP_ORDER.filter((k) => set.has(k));
}

/* ---------- follow-ups: additive secondary actions./* ---------- follow-ups: additive secondary actions. The screen's own controls (range chips, Find a time, click-to-edit, RSVP, the create dialog's fields) are always there and always live; a follow-up only adds something. ---------- */
/** An agenda or month card: a + New event button opens the create dialog inside the card. */
export function agendaFollowUps(task: string, view: string): FollowUp[] {
  const w = task.toLowerCase();
  const named = /\b(today|tomorrow|yesterday|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|invit|free|available|\d{1,2}(st|nd|rd|th)?\b|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(w);
  return [
    { id: "full_navigation", label: "move around the whole calendar (today, tomorrow, this week, next week, month, invites, find a time all offered)", when: "A general look with no range named: 'show my calendar', 'my schedule', 'what's going on', 'open my calendar'.", unless: "The ask names a day, a week, a month, invitations, or free time: then only that range and its neighbour are offered.", guess: !named },
    ...(view === "free" ? [] : [{ id: "find", label: "find a free time from here (a Find a time chip)", when: "Scheduling intent beside the look: fitting a call in, 'when can I', someone to meet, a slot to find, the context says they want to book something.", unless: "A plain look at the day or week.", guess: /\b(find|free|available|availability|book|schedule|slot|when can|fit)\w*/.test(w) } as FollowUp]),
    ...(view === "month" ? [] : [{ id: "month", label: "zoom out to the month grid (a Month chip)", when: "The ask spans more than two weeks, mentions the month, planning ahead, travel, or a date beyond next week.", unless: "The ask is about today, tomorrow or this week.", guess: /\b(month|ahead|upcoming|travel|trip|rest of)\w*/.test(w) } as FollowUp]),
    ...(view === "free" ? [] : [{ id: "create", label: "add a new event from here (a + New event button opens the create dialog in the card)", when: "Planning or blocking time: 'add', 'put', 'block', 'book', a task to fit in, a prep block before a meeting the context names.", unless: "A plain look at the day or week.", guess: /\b(add|put|block|book|new event|create|fit in|prep)\w*/.test(w) } as FollowUp]),
  ];
}
