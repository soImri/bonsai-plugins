/**
 * Google Calendar v3 over REST with Bonsai's Google sign-in, normalised to the card's event shape.
 *
 * Events get a short stable key (#a1b2c3, a hash of calendar + event id) so cards can name them in
 * plain words; the key → id map lives in the connector's cache so a later message can resolve it.
 */
import { HttpError, type DiskCache } from "../../runtime.ts";

const BASE = "https://www.googleapis.com/calendar/v3";
const META_TTL_MS = 10 * 60 * 1000;

export type Calendar = { id: string; name: string; primary: boolean; color?: string; timeZone?: string; writable: boolean };
export type Attendee = { email: string; name?: string; response: "accepted" | "declined" | "tentative" | "needsAction"; self?: boolean; organizer?: boolean; optional?: boolean };
export type Event = {
  key: string; id: string; calendar: string; calendarName: string; title: string;
  start: string; end: string; allDay: boolean; timeZone?: string;
  location?: string; description?: string; attendees: Attendee[]; organizer?: string; meet?: string; link?: string;
  status?: string; myResponse?: Attendee["response"]; color?: string; recurring?: boolean;
};

export async function gapi<T = any>(token: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  const txt = await res.text();
  if (!res.ok) throw new HttpError(res.status, `Google Calendar answered ${res.status}: ${txt.slice(0, 200)}`);
  return (txt ? JSON.parse(txt) : undefined) as T;
}

/* ---------- calendars (cached) ---------- */
type Meta = { at: number; calendars: Calendar[]; timeZone: string };
let metaMem: Meta | undefined;

export async function readMeta(token: string, cache: DiskCache, signal?: AbortSignal): Promise<Meta> {
  if (metaMem && Date.now() - metaMem.at < META_TTL_MS) return metaMem;
  const disk = metaMem ?? (await cache.read<Meta>("calendars"));
  if (disk) { metaMem = disk; if (Date.now() - disk.at >= META_TTL_MS) void fetchMeta(token, cache).catch(() => undefined); return disk; }
  return fetchMeta(token, cache, signal);
}
async function fetchMeta(token: string, cache: DiskCache, signal?: AbortSignal): Promise<Meta> {
  const r = await gapi(token, "GET", "/users/me/calendarList?minAccessRole=reader&maxResults=50", undefined, signal);
  const calendars: Calendar[] = (r.items ?? []).filter((c: any) => !c.hidden && c.selected !== false).map((c: any) => ({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: Boolean(c.primary), ...(c.backgroundColor ? { color: c.backgroundColor } : {}), ...(c.timeZone ? { timeZone: c.timeZone } : {}), writable: c.accessRole === "owner" || c.accessRole === "writer" }));
  const primary = calendars.find((c) => c.primary);
  const meta: Meta = { at: Date.now(), calendars, timeZone: primary?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC" };
  metaMem = meta;
  void cache.write("calendars", meta);
  return meta;
}

/* ---------- events ---------- */
export function keyOf(calendarId: string, eventId: string): string {
  let h = 2166136261;
  for (const ch of `${calendarId}|${eventId}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return `#${h.toString(16).padStart(8, "0").slice(0, 6)}`;
}

export function normalizeEvent(e: any, cal: Calendar): Event {
  const allDay = Boolean(e.start?.date);
  const attendees: Attendee[] = (e.attendees ?? []).map((a: any) => ({ email: a.email, ...(a.displayName ? { name: a.displayName } : {}), response: a.responseStatus ?? "needsAction", ...(a.self ? { self: true } : {}), ...(a.organizer ? { organizer: true } : {}), ...(a.optional ? { optional: true } : {}) }));
  const meet = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri;
  const me = attendees.find((a) => a.self);
  return {
    key: keyOf(cal.id, e.id), id: e.id, calendar: cal.id, calendarName: cal.name, title: e.summary ?? "(No title)",
    start: allDay ? e.start.date : e.start?.dateTime, end: allDay ? e.end?.date : e.end?.dateTime, allDay, ...(e.start?.timeZone ? { timeZone: e.start.timeZone } : {}),
    ...(e.location ? { location: e.location } : {}), ...(e.description ? { description: String(e.description).replace(/<[^>]+>/g, "").slice(0, 700) } : {}),
    attendees, ...(e.organizer?.displayName || e.organizer?.email ? { organizer: e.organizer.displayName ?? e.organizer.email } : {}), ...(meet ? { meet } : {}), ...(e.htmlLink ? { link: e.htmlLink } : {}),
    ...(e.status ? { status: e.status } : {}), ...(me ? { myResponse: me.response } : {}), ...(cal.color ? { color: cal.color } : {}), ...(e.recurringEventId ? { recurring: true } : {}),
  };
}

/** Events across the selected calendars in [from, to), sorted by start; remembers keys for later. */
export async function listEvents(token: string, cache: DiskCache, calendars: Calendar[], from: Date, to: Date, query: string | undefined, signal?: AbortSignal): Promise<Event[]> {
  const q = `singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}${query ? `&q=${encodeURIComponent(query)}` : ""}`;
  const per = await Promise.all(calendars.map(async (cal) => { try { const r = await gapi(token, "GET", `/calendars/${encodeURIComponent(cal.id)}/events?${q}`, undefined, signal); return (r.items ?? []).filter((e: any) => e.status !== "cancelled").map((e: any) => normalizeEvent(e, cal)); } catch { return [] as Event[]; } }));
  const events = per.flat().sort((a, b) => a.start.localeCompare(b.start));
  await rememberKeys(cache, events);
  return events;
}

export async function getEvent(token: string, cal: Calendar, eventId: string, signal?: AbortSignal): Promise<Event> {
  return normalizeEvent(await gapi(token, "GET", `/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}`, undefined, signal), cal);
}

/* ---------- keys ---------- */
type KeyMap = Record<string, { calendar: string; id: string }>;
/** Every event a card can name must be remembered here, listed, fetched or just created alike. */
export async function rememberKeys(cache: DiskCache, events: Event[]) {
  if (!events.length) return;
  const map = (await cache.read<KeyMap>("keys")) ?? {};
  for (const e of events) map[e.key] = { calendar: e.calendar, id: e.id };
  const entries = Object.entries(map);
  void cache.write("keys", Object.fromEntries(entries.slice(Math.max(0, entries.length - 2000))));
}
export async function resolveKey(cache: DiskCache, key: string): Promise<{ calendar: string; id: string } | undefined> {
  const k = key.trim().startsWith("#") ? key.trim() : `#${key.trim()}`;
  return ((await cache.read<KeyMap>("keys")) ?? {})[k];
}

/* ---------- writes ---------- */
export type EventBody = { summary?: string; description?: string; location?: string; start?: { dateTime?: string; date?: string; timeZone?: string }; end?: { dateTime?: string; date?: string; timeZone?: string }; attendees?: { email: string }[]; conferenceData?: unknown };

export async function createEvent(token: string, cal: Calendar, body: EventBody, meet: boolean, signal?: AbortSignal): Promise<Event> {
  const b: any = { ...body };
  if (meet) b.conferenceData = { createRequest: { requestId: `cc-${Date.now()}`, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  const r = await gapi(token, "POST", `/calendars/${encodeURIComponent(cal.id)}/events?conferenceDataVersion=1&sendUpdates=${body.attendees?.length ? "all" : "none"}`, b, signal);
  return normalizeEvent(r, cal);
}
export async function patchEvent(token: string, cal: Calendar, eventId: string, body: EventBody, signal?: AbortSignal): Promise<Event> {
  const r = await gapi(token, "PATCH", `/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, body, signal);
  return normalizeEvent(r, cal);
}
export async function rsvp(token: string, cal: Calendar, eventId: string, response: "accepted" | "declined" | "tentative", signal?: AbortSignal): Promise<Event> {
  const current = await gapi(token, "GET", `/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}`, undefined, signal);
  const attendees = (current.attendees ?? []).map((a: any) => (a.self ? { ...a, responseStatus: response } : a));
  if (!attendees.some((a: any) => a.self)) throw new Error("You are not on this event's guest list, so there is nothing to RSVP to.");
  const r = await gapi(token, "PATCH", `/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { attendees }, signal);
  return normalizeEvent(r, cal);
}
export async function deleteEvent(token: string, cal: Calendar, eventId: string, signal?: AbortSignal): Promise<void> {
  await gapi(token, "DELETE", `/calendars/${encodeURIComponent(cal.id)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, undefined, signal);
}
