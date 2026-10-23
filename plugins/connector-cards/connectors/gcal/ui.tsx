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
type Composition = { view: "agenda" | "event"; range: string; fields: { attendees: boolean; location: boolean; description: boolean; past: boolean }; by: "jev" | "fallback" };
type Draft = { title: string; description?: string; start: string; end: string; allDay: boolean; attendees: string[]; location?: string; meet: boolean; calendar?: string; calendarName?: string; timeZone: string };
type Edit = { title: string; start: string; end: string; location: string; guests: string };

const TIMING = { google: "Google", jev: "Jev" };
const RANGE_LABEL: Record<string, string> = { today: "Today", tomorrow: "Tomorrow", rest_of_week: "This week", next_week: "Next week", next_7_days: "Next 7 days", next_14_days: "Next 14 days", yesterday: "Yesterday", past_week: "Past week" };
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

/* ---------- Agenda: Google Calendar's schedule view ---------- */
function Agenda({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const tz: string = d.timeZone ?? "UTC";
  const events: Event[] = Array.isArray(d.events) ? d.events : [];
  const comp: Composition = d.composition ?? { view: "agenda", range: "next_7_days", fields: { attendees: false, location: false, description: false, past: false }, by: "fallback" };
  if (!events.length) return <ErrorCard message={`No events ${(RANGE_LABEL[comp.range] ?? "").toLowerCase()}.`} />;
  if (comp.view === "event" && events.length === 1) return <EventCard ctx={ctx} event={events[0]} note={note} />;
  const today = (d.now ?? wallOf(new Date().toISOString(), tz)).slice(0, 10);
  const days = new Map<string, Event[]>();
  for (const e of events) { const k = wallOf(e.start, tz).slice(0, 10); days.set(k, [...(days.get(k) ?? []), e]); }
  const t = d.timing as Record<string, string> | undefined;
  const caption = note ?? (d.applied ? `Saved · ${d.applied.join(" · ")}` : `${RANGE_LABEL[comp.range] ?? "Agenda"} · ${comp.by === "jev" ? "picked by Jev" : "default pick"}${t?.google ? ` · Google ${t.google}` : ""}${t?.jev ? ` · Jev ${t.jev}` : ""}`);
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{RANGE_LABEL[comp.range] ?? "Agenda"} <span style={{ ...muted, fontWeight: 400 }}>{events.length} {events.length === 1 ? "event" : "events"}</span></span>
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
function NewEventCard({ ctx }: { ctx: UiCtx }) {
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
