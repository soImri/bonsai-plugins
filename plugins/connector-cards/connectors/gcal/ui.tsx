/**
 * Google Calendar's compositions for the chat: Agenda (the schedule view), EventCard (the event
 * detail popup) and NewEventCard (the create dialog), drawn from the payloads `index.ts` produces.
 *
 * What a card sends is a short command in plain words; `write.ts` parses it. Keep the senders here
 * (saveLine, createMessage, rsvp, delete) and the parser in step.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ClockGlyph, ErrorCard, LongText, NotesGlyph, OpenExternal, PinGlyph, Picker, Placeholder, SaveBar, Timing, UserGlyph, VideoGlyph, bare, card, footer, hoverable, muted, pad, row, v, type ConnectorUi, type UiCtx } from "../../ui/kit.tsx";

type Attendee = { email: string; name?: string; response: string; self?: boolean; organizer?: boolean; optional?: boolean };
type Event = { key: string; id: string; calendar: string; calendarName: string; title: string; start: string; end: string; allDay: boolean; location?: string; description?: string; attendees: Attendee[]; organizer?: string; meet?: string; link?: string; myResponse?: string; color?: string; recurring?: boolean };
type Cal = { id: string; name: string; color?: string; writable?: boolean; primary?: boolean };
type Composition = { view: "agenda" | "event" | "month" | "free"; range: string; fields: { attendees: boolean; location: boolean; description: boolean; past: boolean; invitesOnly?: boolean }; by: "jev" | "fallback" };
type FreeDay = { date: string; weekday: string; busy: { start: string; end: string; title?: string }[]; free: { start: string; end: string }[] };
type Draft = { title: string; description?: string; start: string; end: string; allDay: boolean; attendees: string[]; location?: string; meet: boolean; calendar?: string; calendarName?: string; timeZone: string };
type Edit = { title: string; start: string; end: string; location: string; guests: string };

const TIMING = { google: "Google", jev: "Jev" };
const RANGE_LABEL: Record<string, string> = { today: "Today", tomorrow: "Tomorrow", rest_of_week: "This week", next_week: "Next week", next_7_days: "Next 7 days", next_14_days: "Next 14 days", yesterday: "Yesterday", past_week: "Past week", this_month: "This month", next_month: "Next month", day: "Day" };
const DEFAULT_COLOR = "#039be5";

/* ---------- wall time (YYYY-MM-DD HH:MM in the calendar's zone) ---------- */
function wallOf(iso: string | undefined, tz: string): string {
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const p: Record<string, string> = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const fmtTime = (w: string) => { const t = w.split(" ")[1]; if (!t) return ""; const [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${ap}`; };
const fmtDay = (w: string, long = false) => { const d = new Date(`${w.slice(0, 10)}T12:00:00Z`); return d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: long ? "long" : "short", month: long ? "long" : "short", day: "numeric" }); };
const dayNum = (w: string) => Number(w.slice(8, 10));
const timeRange = (e: { start: string; end: string; allDay: boolean }, tz: string) => e.allDay ? "All day" : `${fmtTime(wallOf(e.start, tz))} – ${fmtTime(wallOf(e.end, tz))}`;
const initials = (a: Attendee) => (a.name ?? a.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");
const responseColor = (r: string) => r === "accepted" ? v("success") : r === "declined" ? v("danger") : r === "tentative" ? v("warning") : v("text-muted");

const saveLine = (key: string, parts: string[]) => `Save event ${key}: ${parts.join("; ")}`;
const createMessage = (d: { title: string; start: string; end: string; allDay: boolean; guests: string; location: string; meet: boolean; calendarName?: string; notes: string }) =>
  `Create event: ${d.title}\nstart → ${d.start}; end → ${d.end}; all day → ${d.allDay ? "yes" : "no"}; guests → ${d.guests.trim() || "none"}; location → ${d.location.trim() || "none"}; meet → ${d.meet ? "yes" : "no"}${d.calendarName ? `; calendar → ${d.calendarName}` : ""}${d.notes.trim() ? `\n\nNotes:\n${d.notes.trim()}` : ""}`;

/* ---------- pieces ---------- */
const Dot = ({ color }: { color?: string }) => <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: color ?? DEFAULT_COLOR, flexShrink: 0 }} />;
const Line = ({ glyph, children }: { glyph: React.ReactNode; children: React.ReactNode }) => <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13 }}><span style={{ ...muted, display: "inline-flex", width: 16, justifyContent: "center", marginTop: 3 }}>{glyph}</span><div style={{ flex: 1, minWidth: 0 }}>{children}</div></div>;
const inputStyle = { ...bare, width: "auto", border: `1px solid ${v("border")}`, borderRadius: 6, padding: "3px 6px", fontSize: 13, colorScheme: "light dark" as const };

function Guests({ attendees, editing, value, onChange }: { attendees: Attendee[]; editing: boolean; value: string; onChange: (s: string) => void }) {
  if (editing) return <input style={{ ...inputStyle, width: "100%" }} value={value} onChange={e => onChange(e.target.value)} placeholder="Guests, comma-separated emails" aria-label="Guests" />;
  if (!attendees.length) return <span style={muted}>No guests</span>;
  const going = attendees.filter(a => a.response === "accepted").length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={muted}>{attendees.length} guests{going ? ` · ${going} yes` : ""}</div>
      {attendees.slice(0, 8).map(a => (
        <div key={a.email} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 11, background: v("bg-subtle"), fontSize: 10, fontWeight: 600 }}>{initials(a)}<span style={{ position: "absolute", right: -2, bottom: -2, width: 8, height: 8, borderRadius: 4, background: responseColor(a.response), border: `1.5px solid ${v("bg-elevated")}` }} /></span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name ?? a.email}{a.organizer ? <span style={muted}> · Organizer</span> : null}{a.optional ? <span style={muted}> · Optional</span> : null}</span>
        </div>
      ))}
      {attendees.length > 8 ? <div style={muted}>+{attendees.length - 8} more</div> : null}
    </div>
  );
}

/* ---------- EventCard: Google Calendar's event popup ---------- */
function EventCard({ ctx, event: given, note }: { ctx: UiCtx; event?: Event; note?: string }) {
  const tz: string = ctx.details?.timeZone ?? "UTC";
  const event: Event | undefined = given ?? ctx.details?.event;
  const seed = useMemo<Edit>(() => ({ title: event?.title ?? "", start: wallOf(event?.start, tz), end: wallOf(event?.end, tz), location: event?.location ?? "", guests: (event?.attendees ?? []).map(a => a.email).join(", ") }), [event]);
  const [saved, setSaved] = useState<Edit>(seed);
  const [cur, setCur] = useState<Edit>(seed);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rsvping, setRsvping] = useState<string | null>(null);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) { setSaved(seed); setCur(seed); setEditing(false); } }, [seed]);
  if (!event?.key) return <Placeholder text="No event data." />;
  const changes: string[] = [];
  if (cur.title !== saved.title) changes.push(`title → ${cur.title}`);
  if (cur.start !== saved.start) changes.push(`start → ${cur.start}`);
  if (cur.end !== saved.end) changes.push(`end → ${cur.end}`);
  if (cur.location !== saved.location) changes.push(`location → ${cur.location.trim() || "none"}`);
  if (cur.guests !== saved.guests) changes.push(`guests → ${cur.guests.trim() || "none"}`);
  dirty.current = changes.length > 0 || editing;
  async function save() { setSaving(true); const next = cur; await ctx.send(saveLine(event!.key, changes)); setSaved(next); setSaving(false); setEditing(false); }
  async function rsvp(answer: "yes" | "no" | "maybe") { setRsvping(answer); await ctx.send(`RSVP ${event!.key}: ${answer}`); setRsvping(null); }
  const [sd, st] = cur.start.split(" "); const [ed, et] = cur.end.split(" ");
  const sameDay = sd === ed;
  const f = (ctx.details?.composition?.fields ?? {}) as Partial<Composition["fields"]>;
  const open = () => setEditing(true);
  return (
    <section style={card}>
      <div style={pad}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ marginTop: 5 }}><Dot color={event.color} /></span>
          {editing ? <input style={{ ...bare, fontSize: 17, fontWeight: 500 }} value={cur.title} onChange={e => setCur({ ...cur, title: e.target.value })} aria-label="Title" /> : <h2 onClick={open} title="Click to edit" style={{ margin: 0, flex: 1, fontSize: 17, fontWeight: 500, lineHeight: 1.3, cursor: "text" }}>{event.title}</h2>}
          {event.link ? <OpenExternal url={event.link} title="Open in Google Calendar" onOpen={ctx.openUrl} /> : null}
        </div>
        <Line glyph={<ClockGlyph />}>
          {editing && !event.allDay ? (
            <div style={{ ...row, gap: 6 }}>
              <input type="date" style={inputStyle} value={sd} onChange={e => setCur({ ...cur, start: `${e.target.value} ${st}`, end: sameDay ? `${e.target.value} ${et}` : cur.end })} aria-label="Date" />
              <input type="time" style={inputStyle} value={st} onChange={e => setCur({ ...cur, start: `${sd} ${e.target.value}` })} aria-label="Start time" />
              <span style={muted}>–</span>
              <input type="time" style={inputStyle} value={et} onChange={e => setCur({ ...cur, end: `${ed} ${e.target.value}` })} aria-label="End time" />
            </div>
          ) : <span onClick={open} style={{ cursor: "text" }}>{fmtDay(wallOf(event.start, tz), true)}{event.allDay ? " · All day" : ` · ${timeRange(event, tz)}`}{event.recurring ? <span style={muted}> · Repeats</span> : null}</span>}
        </Line>
        {(f.location !== false || editing || event.location) ? <Line glyph={<PinGlyph />}>{editing ? <input style={{ ...inputStyle, width: "100%" }} value={cur.location} onChange={e => setCur({ ...cur, location: e.target.value })} placeholder="Add location" aria-label="Location" /> : <span onClick={open} style={{ cursor: "text", ...(event.location ? {} : muted) }}>{event.location || "Add location"}</span>}</Line> : null}
        {event.meet ? <Line glyph={<VideoGlyph />}><Button variant="primary" size="sm" onClick={() => ctx.openUrl(event.meet!)}>Join with Google Meet</Button></Line> : null}
        {(f.attendees !== false || editing || event.attendees.length) ? <Line glyph={<UserGlyph />}><Guests attendees={event.attendees} editing={editing} value={cur.guests} onChange={s => setCur({ ...cur, guests: s })} /></Line> : null}
        {event.description && f.description !== false ? <Line glyph={<NotesGlyph />}><LongText md={event.description} /></Line> : null}
        {event.myResponse && !editing ? (
          <div style={{ ...row, fontSize: 13, paddingTop: 4, borderTop: `1px solid ${v("border")}` }}>
            <span style={muted}>Going?</span>
            {(["yes", "no", "maybe"] as const).map(a => { const mine = (a === "yes" && event.myResponse === "accepted") || (a === "no" && event.myResponse === "declined") || (a === "maybe" && event.myResponse === "tentative"); return <Button key={a} variant={mine ? "primary" : "secondary"} size="sm" disabled={rsvping !== null} onClick={() => rsvp(a)}>{rsvping === a ? "…" : a[0].toUpperCase() + a.slice(1)}</Button>; })}
            <span style={{ flex: 1 }} />
            <span style={{ ...muted, fontSize: 12 }}>{event.calendarName}</span>
          </div>
        ) : null}
      </div>
      <SaveBar count={changes.length} saving={saving} savingText="Saving to Google Calendar…" onDiscard={() => { setCur(saved); setEditing(false); }} onSave={save} note={note ?? (ctx.details?.timing?.google ? `Google ${ctx.details.timing.google}` : undefined)} />
    </section>
  );
}

/* ---------- Month: Google Calendar's month grid ---------- */
const addDays = (ymd: string, n: number) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function MonthGrid({ ctx, caption }: { ctx: UiCtx; caption: string }) {
  const d = ctx.details ?? {};
  const tz: string = d.timeZone ?? "UTC";
  const m = d.month ?? {};
  const events: Event[] = Array.isArray(d.events) ? d.events : [];
  const today = (d.now ?? wallOf(new Date().toISOString(), tz)).slice(0, 10);
  const byDay = new Map<string, Event[]>();
  for (const e of events) {
    // An all-day or multi-day event occupies every day it covers; a timed one its start day.
    const s = wallOf(e.start, tz).slice(0, 10);
    const endExclusive = e.allDay ? e.end : wallOf(e.end, tz).slice(0, 10);
    for (let day = s; day < (e.allDay ? endExclusive : addDays(endExclusive, 1)) && day <= addDays(s, 31); day = addDays(day, 1)) byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const cells: string[] = [];
  for (let day = m.gridStart; day && day < m.gridEnd && cells.length < 42; day = addDays(day, 1)) cells.push(day);
  const inMonth = (day: string) => day >= m.first && day < m.next;
  const cell = { minHeight: 64, padding: "4px 4px 6px", borderTop: `1px solid ${v("border")}`, borderLeft: `1px solid ${v("border")}`, display: "flex", flexDirection: "column" as const, gap: 2, minWidth: 0 };
  return (
    <section style={{ ...card, maxWidth: 760 }}>
      <div style={{ ...pad, gap: 6, paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{m.label ?? "Month"} <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>{events.length} {events.length === 1 ? "event" : "events"}</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...muted, fontSize: 12 }}>{caption}</span>
            <Button variant="secondary" size="sm" onClick={() => { void ctx.send(`Show me ${m.label === d.now?.slice(0, 7) ? "last" : "the previous"} month on my calendar`); }} aria-label="Previous month">‹</Button>
            <Button variant="secondary" size="sm" onClick={() => { void ctx.send("Show me next month on my calendar"); }} aria-label="Next month">›</Button>
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", fontSize: 10, fontWeight: 600, letterSpacing: 0.5, ...muted, textAlign: "center" }}>{["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(w => <div key={w} style={{ padding: "2px 0 4px" }}>{w}</div>)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderRight: `1px solid ${v("border")}`, borderBottom: `1px solid ${v("border")}`, margin: "0 20px 16px" }}>
        {cells.map(day => {
          const items = byDay.get(day) ?? [];
          const shown = items.slice(0, 3);
          return (
            <div key={day} style={{ ...cell, opacity: inMonth(day) ? 1 : 0.45 }}>
              <button type="button" onClick={() => { void ctx.send(`What's on my calendar on ${day}?`); }} title={`Open ${day}`}
                style={{ ...bare, width: 24, height: 24, borderRadius: 12, alignSelf: "flex-start", fontSize: 12, fontWeight: day === today ? 700 : 500, background: day === today ? v("accent") : "transparent", color: day === today ? "white" : v("text-primary"), cursor: "pointer", textAlign: "center" }}>{Number(day.slice(8, 10))}</button>
              {shown.map(e => (
                <button key={e.key} type="button" onClick={() => { void ctx.send(`Show event ${e.key}`); }} title={`${e.title} · ${timeRange(e, tz)}`} {...hoverable}
                  style={{ ...bare, display: "flex", alignItems: "center", gap: 4, padding: "1px 4px", borderRadius: 4, fontSize: 11, lineHeight: "16px", cursor: "pointer", textAlign: "left", ...(e.allDay ? { background: e.color ?? DEFAULT_COLOR, color: "white" } : {}), ...(e.myResponse === "declined" ? { textDecoration: "line-through", ...muted } : {}) }}>
                  {!e.allDay ? <span style={{ width: 6, height: 6, borderRadius: 3, background: e.color ?? DEFAULT_COLOR, flexShrink: 0 }} /> : null}
                  {!e.allDay ? <span style={{ ...muted, flexShrink: 0 }}>{fmtTime(wallOf(e.start, tz)).replace(":00", "").replace(" ", "").toLowerCase()}</span> : null}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                </button>
              ))}
              {items.length > 3 ? <button type="button" onClick={() => { void ctx.send(`What's on my calendar on ${day}?`); }} style={{ ...bare, width: "auto", fontSize: 11, ...muted, cursor: "pointer", padding: "0 4px", textAlign: "left" }}>+{items.length - 3} more</button> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- FreeTime: Google Calendar's "Find a time" tab ---------- */
type Slot = { date: string; weekday: string; start: string; end: string };
const GRID = { start: 8, end: 19, rowPx: 34 }; // hours shown down the side
const minsOf = (w: string) => { const [h, m] = (w.split(" ")[1] ?? "00:00").split(":").map(Number); return h * 60 + m; };
const wallAt = (date: string, mins: number) => `${date} ${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const hourLabel = (h: number) => `${((h + 11) % 12) + 1} ${h >= 12 ? "PM" : "AM"}`;

function FreeTime({ ctx, caption }: { ctx: UiCtx; caption: string }) {
  const d = ctx.details ?? {};
  const f = d.free ?? {};
  const days: FreeDay[] = Array.isArray(f.days) ? f.days : [];
  const today = (d.now ?? "").slice(0, 10);
  const [duration, setDuration] = useState<number>(f.slotMinutes ?? 30);
  const [page, setPage] = useState(0);
  const [chosen, setChosen] = useState<Slot | null>(null);
  const [drafting, setDrafting] = useState(false);
  useEffect(() => { setDuration(f.slotMinutes ?? 30); setChosen(null); setDrafting(false); setPage(0); }, [d]);
  if (!days.length) return <ErrorCard message="No working days in that range." />;
  const perPage = 5;
  const shown = days.slice(page * perPage, page * perPage + perPage);
  const totalMins = (GRID.end - GRID.start) * 60;
  const top = (w: string) => ((minsOf(w) - GRID.start * 60) / totalMins) * 100;
  const height = (a: string, b: string) => ((minsOf(b) - minsOf(a)) / totalMins) * 100;
  const fits = (day: FreeDay, startMin: number) => day.free.some(g => minsOf(g.start) <= startMin && startMin + duration <= minsOf(g.end));
  const place = (day: FreeDay, e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const mins = Math.round(((e.clientY - r.top) / r.height * totalMins + GRID.start * 60) / 15) * 15;
    const start = Math.max(GRID.start * 60, Math.min(mins, GRID.end * 60 - duration));
    setChosen({ date: day.date, weekday: day.weekday, start: wallAt(day.date, start), end: wallAt(day.date, start + duration) });
  };
  const suggested: Slot[] = (Array.isArray(f.suggested) ? f.suggested : []).map((s: Slot) => ({ ...s, end: wallAt(s.date, minsOf(s.start) + duration) }));
  const chosenFits = chosen ? fits(days.find(x => x.date === chosen.date)!, minsOf(chosen.start)) : false;
  // A stable draft object: NewEventCard re-seeds its state when this identity changes.
  const draftDetails = useMemo(() => {
    if (!chosen) return null;
    const seed = f.seed ?? {};
    const draft: Draft = { title: seed.title ?? "New event", start: chosen.start, end: chosen.end, allDay: false, attendees: [], meet: Boolean(seed.meet), calendar: f.calendars?.find((c: Cal) => c.primary)?.id, timeZone: d.timeZone };
    return { ...d, kind: "draft", draft, calendars: f.calendars ?? [], picks: undefined };
  }, [chosen?.start, chosen?.end, d]);
  if (drafting && draftDetails) return <NewEventCard ctx={{ ...ctx, details: draftDetails }} onBack={() => setDrafting(false)} />;
  return (
    <section style={{ ...card, maxWidth: 760 }}>
      <div style={{ ...pad, gap: 10, paddingBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 10 }}>Find a time
            <Picker items={[15, 30, 45, 60, 90]} value={duration} onPick={m => { setDuration(m); setChosen(null); }} label="Duration" lead={() => <ClockGlyph />} keyOf={m => String(m)} labelOf={m => `${m} min`} />
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...muted, fontSize: 12 }}>
            <span>{caption}</span>
            {days.length > perPage ? <><Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)} aria-label="Earlier days">‹</Button><Button variant="secondary" size="sm" disabled={(page + 1) * perPage >= days.length} onClick={() => setPage(p => p + 1)} aria-label="Later days">›</Button></> : null}
          </span>
        </div>
        {/* day headers */}
        <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${shown.length}, 1fr)`, gap: 0 }}>
          <div />
          {shown.map(day => (
            <div key={day.date} style={{ textAlign: "center", padding: "2px 0 6px" }}>
              <div style={{ ...muted, fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>{day.weekday.toUpperCase()}</div>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 13, fontSize: 15, fontWeight: 500, background: day.date === today ? v("accent") : "transparent", color: day.date === today ? "white" : v("text-primary") }}>{Number(day.date.slice(8, 10))}</div>
            </div>
          ))}
        </div>
        {/* the grid */}
        <div style={{ display: "grid", gridTemplateColumns: `52px repeat(${shown.length}, 1fr)`, height: (GRID.end - GRID.start) * GRID.rowPx, borderTop: `1px solid ${v("border")}` }}>
          <div style={{ position: "relative" }}>
            {Array.from({ length: GRID.end - GRID.start }, (_, i) => <div key={i} style={{ position: "absolute", top: i * GRID.rowPx - 7, right: 8, ...muted, fontSize: 10 }}>{i === 0 ? "" : hourLabel(GRID.start + i)}</div>)}
          </div>
          {shown.map(day => (
            <div key={day.date} onClick={e => place(day, e)} title="Click to place the meeting" style={{ position: "relative", borderLeft: `1px solid ${v("border")}`, cursor: "crosshair", backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${GRID.rowPx - 1}px, ${v("border")} ${GRID.rowPx - 1}px, ${v("border")} ${GRID.rowPx}px)` }}>
              {day.free.map(g => <div key={g.start} style={{ position: "absolute", left: 0, right: 0, top: `${top(g.start)}%`, height: `${height(g.start, g.end)}%`, background: "color-mix(in srgb, var(--kay-color-success) 10%, transparent)" }} />)}
              {day.busy.map((b, i) => (
                <div key={i} title={`${b.title ?? "Busy"} · ${fmtTime(b.start)} – ${fmtTime(b.end)}`} style={{ position: "absolute", left: 2, right: 2, top: `${top(b.start)}%`, height: `${Math.max(2, height(b.start, b.end))}%`, borderRadius: 4, background: DEFAULT_COLOR, color: "white", fontSize: 10, lineHeight: "13px", padding: "1px 4px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", pointerEvents: "none" }}>{b.title ?? "Busy"}</div>
              ))}
              {chosen?.date === day.date ? (
                <div style={{ position: "absolute", left: 2, right: 2, top: `${top(chosen.start)}%`, height: `${height(chosen.start, chosen.end)}%`, borderRadius: 4, border: `2px dashed ${chosenFits ? v("accent") : v("danger")}`, background: chosenFits ? "color-mix(in srgb, var(--kay-color-accent) 18%, transparent)" : "color-mix(in srgb, var(--kay-color-danger) 12%, transparent)", color: v("text-primary"), fontSize: 10, lineHeight: "13px", padding: "1px 4px", overflow: "hidden", whiteSpace: "nowrap", pointerEvents: "none" }}>{f.seed?.title ?? "New event"} · {fmtTime(chosen.start)}</div>
              ) : null}
            </div>
          ))}
        </div>
        {/* suggested times, like Google's list */}
        {suggested.length ? (
          <div style={{ ...row, gap: 6 }}>
            <span style={{ ...muted, fontSize: 12 }}>Suggested times</span>
            {suggested.map(s => <Button key={`${s.date}${s.start}`} variant={chosen?.start === s.start ? "primary" : "secondary"} size="sm" onClick={() => setChosen(s)}>{s.weekday} {fmtDay(s.date).split(", ")[1]}, {fmtTime(s.start)}</Button>)}
          </div>
        ) : <div style={{ ...muted, fontSize: 12 }}>No open {duration}-minute slot in working hours; click a day to place one anyway.</div>}
      </div>
      <div style={footer}>
        <span style={{ fontSize: 13 }}>{chosen ? <>{fmtDay(chosen.date, true)} · {fmtTime(chosen.start)} – {fmtTime(chosen.end)}{chosenFits ? null : <span style={{ color: v("danger") }}> · overlaps something</span>}</> : <span style={muted}>Click a free spot or a suggested time.</span>}</span>
        <Button variant="primary" size="sm" disabled={!chosen} onClick={() => setDrafting(true)}>Use this time</Button>
      </div>
    </section>
  );
}

/* ---------- Agenda: Google Calendar's schedule view ---------- */
function Agenda({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const tz: string = d.timeZone ?? "UTC";
  const events: Event[] = Array.isArray(d.events) ? d.events : [];
  const comp: Composition = d.composition ?? { view: "agenda", range: "next_7_days", fields: { attendees: false, location: false, description: false, past: false }, by: "fallback" };
  const t0 = d.timing as Record<string, string> | undefined;
  const caption0 = note ?? (d.applied ? `Saved · ${d.applied.join(" · ")}` : `${comp.by === "jev" ? "picked by Jev" : "default pick"}${t0?.google ? ` · Google ${t0.google}` : ""}${t0?.jev ? ` · Jev ${t0.jev}` : ""}`);
  if (comp.view === "free") return <FreeTime ctx={ctx} caption={caption0} />;
  if (comp.view === "month" && d.month) return <MonthGrid ctx={ctx} caption={caption0} />;
  if (!events.length) return <ErrorCard message={`No ${comp.fields.invitesOnly ? "unanswered invitations" : "events"} ${(d.rangeLabel ?? RANGE_LABEL[comp.range] ?? "").toLowerCase()}.`} />;
  if (comp.view === "event" && events.length === 1) return <EventCard ctx={ctx} event={events[0]} note={note} />;
  const today = (d.now ?? wallOf(new Date().toISOString(), tz)).slice(0, 10);
  const days = new Map<string, Event[]>();
  for (const e of events) { const k = wallOf(e.start, tz).slice(0, 10); days.set(k, [...(days.get(k) ?? []), e]); }
  const t = d.timing as Record<string, string> | undefined;
  const caption = note ?? (d.applied ? `Saved · ${d.applied.join(" · ")}` : `${comp.by === "jev" ? "picked by Jev" : "default pick"}${t?.google ? ` · Google ${t.google}` : ""}${t?.jev ? ` · Jev ${t.jev}` : ""}`);
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{comp.fields.invitesOnly ? "Invitations" : (d.rangeLabel ?? RANGE_LABEL[comp.range] ?? "Agenda")} <span style={{ ...muted, fontWeight: 400 }}>{events.length} {events.length === 1 ? "event" : "events"}</span></span>
          <span style={{ ...muted, fontSize: 12 }}>{caption}</span>
        </div>
        {[...days.entries()].map(([day, items]) => (
          <div key={day} style={{ display: "flex", gap: 12, padding: "6px 0", borderTop: `1px solid ${v("border")}` }}>
            <div style={{ width: 44, flexShrink: 0, textAlign: "center" }}>
              <div style={{ ...muted, fontSize: 10, fontWeight: 600, letterSpacing: 0.5 }}>{fmtDay(day).split(",")[0].toUpperCase()}</div>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 15, fontSize: 18, fontWeight: 500, background: day === today ? v("accent") : "transparent", color: day === today ? "white" : v("text-primary") }}>{dayNum(day)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              {items.map(e => (
                <button key={e.key} type="button" onClick={() => { void ctx.send(`Show event ${e.key}`); }} title={`Open ${e.title}`} {...hoverable}
                  style={{ ...bare, display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
                  <Dot color={e.color} />
                  <span style={{ ...muted, fontSize: 12, width: 118, flexShrink: 0 }}>{timeRange(e, tz)}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14, ...(e.myResponse === "declined" ? { textDecoration: "line-through", ...muted } : {}) }}>{e.title}</span>
                  {comp.fields.location && e.location ? <span style={{ ...muted, fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.location}</span> : null}
                  {comp.fields.attendees && e.attendees.length ? <span style={{ ...muted, fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}><UserGlyph />{e.attendees.length}</span> : null}
                  {e.meet ? <span style={{ ...muted, display: "inline-flex" }}><VideoGlyph /></span> : null}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- NewEventCard: Google Calendar's create dialog ---------- */
function NewEventCard({ ctx, onBack }: { ctx: UiCtx; onBack?: () => void }) {
  const draft: Draft | undefined = ctx.details?.draft;
  const calendars: Cal[] = Array.isArray(ctx.details?.calendars) ? ctx.details.calendars : [];
  const seed = useMemo(() => ({ title: draft?.title ?? "", start: draft?.start ?? "", end: draft?.end ?? "", allDay: Boolean(draft?.allDay), guests: (draft?.attendees ?? []).join(", "), location: draft?.location ?? "", meet: Boolean(draft?.meet), notes: draft?.description ?? "", calendar: calendars.find(c => c.id === draft?.calendar) ?? calendars.find(c => c.primary) ?? calendars[0] }), [draft]);
  const [s, setS] = useState(seed);
  const [sent, setSent] = useState(false);
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) setS(seed); }, [seed]);
  if (!draft) return <Placeholder text="No draft data." />;
  const set = (patch: Partial<typeof s>) => { touched.current = true; setS(prev => ({ ...prev, ...patch })); };
  const [sd, st = "09:00"] = s.start.split(" "); const [ed, et = "09:30"] = s.end.split(" ");
  async function create() { setSent(true); await ctx.send(createMessage({ ...s, calendarName: s.calendar?.name })); }
  return (
    <section style={card}>
      <div style={{ ...pad, paddingBottom: 12 }}>
        {onBack ? <button type="button" onClick={onBack} style={{ ...bare, width: "auto", fontSize: 12, color: v("text-secondary"), cursor: "pointer", textAlign: "left" }}>‹ Find a time</button> : null}
        <input style={{ ...bare, fontSize: 18, fontWeight: 500, borderBottom: `1px solid ${v("border")}`, paddingBottom: 6 }} value={s.title} onChange={e => set({ title: e.target.value })} placeholder="Add title" aria-label="Title" disabled={sent} />
        <Line glyph={<ClockGlyph />}>
          <div style={{ ...row, gap: 6 }}>
            <input type="date" style={inputStyle} value={sd} onChange={e => set({ start: `${e.target.value} ${st}`, end: `${sd === ed ? e.target.value : ed} ${et}` })} aria-label="Date" disabled={sent} />
            {!s.allDay ? <><input type="time" style={inputStyle} value={st} onChange={e => set({ start: `${sd} ${e.target.value}` })} aria-label="Start time" disabled={sent} /><span style={muted}>–</span><input type="time" style={inputStyle} value={et} onChange={e => set({ end: `${ed} ${e.target.value}` })} aria-label="End time" disabled={sent} /></> : null}
            <label style={{ ...muted, display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, marginLeft: 4 }}><input type="checkbox" checked={s.allDay} onChange={e => set({ allDay: e.target.checked })} disabled={sent} />All day</label>
          </div>
        </Line>
        <Line glyph={<UserGlyph />}><input style={{ ...inputStyle, width: "100%" }} value={s.guests} onChange={e => set({ guests: e.target.value })} placeholder="Add guests (emails, comma-separated)" aria-label="Guests" disabled={sent} /></Line>
        <Line glyph={<VideoGlyph />}><label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}><input type="checkbox" checked={s.meet} onChange={e => set({ meet: e.target.checked })} disabled={sent} />Add Google Meet video conferencing</label></Line>
        <Line glyph={<PinGlyph />}><input style={{ ...inputStyle, width: "100%" }} value={s.location} onChange={e => set({ location: e.target.value })} placeholder="Add location" aria-label="Location" disabled={sent} /></Line>
        <Line glyph={<NotesGlyph />}><textarea style={{ ...bare, lineHeight: "20px", fontSize: 13 }} rows={2} value={s.notes} onChange={e => set({ notes: e.target.value })} placeholder="Add description" aria-label="Description" disabled={sent} /></Line>
        {calendars.length > 1 ? <Line glyph={<Dot color={s.calendar?.color} />}><Picker items={calendars} value={s.calendar} onPick={c => set({ calendar: c })} label="Calendar" lead={c => <Dot color={c?.color} />} keyOf={c => c.id} labelOf={c => c.name} /></Line> : s.calendar ? <Line glyph={<Dot color={s.calendar.color} />}><span style={muted}>{s.calendar.name}</span></Line> : null}
      </div>
      <div style={footer}>
        <span style={{ ...muted, fontSize: 12 }}>{sent ? "Saving to Google Calendar…" : ctx.details?.picks ? <>{ctx.details.picks.by === "jev" ? "Options picked by Jev" : "Default options"} · <Timing t={ctx.details.timing} labels={TIMING} /></> : ""}</span>
        <Button variant="primary" size="sm" disabled={sent || !s.title.trim() || !sd} onClick={create}>{sent ? "Saving…" : "Save"}</Button>
      </div>
    </section>
  );
}

/* ---------- the connector's UI entry ---------- */
function GcalUi({ ctx, note }: { ctx: UiCtx; note?: string }) {
  switch (ctx.details?.kind) {
    case "event": return <EventCard ctx={ctx} note={note ?? (ctx.details?.applied ? `Saved · ${ctx.details.applied.join(" · ")}` : undefined)} />;
    case "draft": return <NewEventCard ctx={ctx} />;
    default: return <Agenda ctx={ctx} note={note} />;
  }
}

export const gcalUi: ConnectorUi = { id: "gcal", label: "Google Calendar", component: GcalUi, runningText: (k) => (k === "apply" ? "Saving to Google Calendar…" : "Reading Google Calendar…") };
