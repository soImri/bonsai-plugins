/**
 * Google Calendar card messages. A card speaks a short human grammar in the chat; the plugin parses
 * it, the agent only passes it on. Keep these shapes and the UI's senders (ui.tsx) in step.
 *
 *   Save event #a1b2c3: title → …; start → 2026-10-24 15:00; end → 2026-10-24 15:30; location → …; guests → a@x, b@y; meet → yes
 *   Create event: <title>
 *   start → 2026-10-24 15:00; end → 2026-10-24 15:30; all day → no; guests → a@x; location → …; meet → yes; calendar → <name>
 *
 *   Notes:
 *   <description…>
 *   RSVP #a1b2c3: yes | no | maybe
 *   Delete event #a1b2c3
 */
export type EventChange = { key: string; title?: string; start?: string; end?: string; location?: string | null; guests?: string[]; meet?: boolean };
export type EventCreate = { title: string; start?: string; end?: string; allDay?: boolean; guests?: string[]; location?: string; meet?: boolean; calendar?: string; description?: string };
export type CardRequest = { changes: EventChange[]; create?: EventCreate; rsvp?: { key: string; response: "accepted" | "declined" | "tentative" }; delete?: string };

const KEY = /#[0-9a-f]{6}/i;
const yes = (v: string) => /^(yes|y|true|on|add)$/i.test(v.trim());
const none = (v: string) => /^(none|null|-|—|clear)$/i.test(v.trim());
const emails = (v: string) => v.split(/[,;]\s*/).map((s) => s.trim().replace(/^<|>$/g, "")).filter((s) => s.includes("@"));

function parseProps(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of line.split(/;\s*/)) {
    const m = part.match(/^\s*([a-z ]+?)\s*(?:→|->|:)\s*(.*?)\s*$/i);
    if (m) out[m[1].trim().toLowerCase()] = m[2];
  }
  return out;
}

export function parseCardMessage(message: string): CardRequest {
  const text = message.replace(/\r/g, "").trim();
  const req: CardRequest = { changes: [] };
  const rsvp = text.match(/^RSVP\s+(#[0-9a-f]{6}):\s*(yes|no|maybe|accepted|declined|tentative)\b/i);
  if (rsvp) { const r = rsvp[2].toLowerCase(); req.rsvp = { key: rsvp[1].toLowerCase(), response: r === "yes" || r === "accepted" ? "accepted" : r === "no" || r === "declined" ? "declined" : "tentative" }; return req; }
  const del = text.match(/^Delete event\s+(#[0-9a-f]{6})\b/i);
  if (del) { req.delete = del[1].toLowerCase(); return req; }
  const create = text.match(/^Create event:\s*(.+)$/im);
  if (create && create.index === 0) {
    const lines = text.split("\n");
    const p = parseProps(lines[1] ?? "");
    const notesAt = lines.findIndex((l) => /^(Notes|Description):\s*$/i.test(l));
    const description = notesAt >= 0 ? lines.slice(notesAt + 1).join("\n").trim() : "";
    req.create = { title: create[1].trim(), ...(p.start ? { start: p.start } : {}), ...(p.end ? { end: p.end } : {}), ...(p["all day"] ? { allDay: yes(p["all day"]) } : {}), ...(p.guests && !none(p.guests) ? { guests: emails(p.guests) } : {}), ...(p.location && !none(p.location) ? { location: p.location } : {}), ...(p.meet ? { meet: yes(p.meet) } : {}), ...(p.calendar && !none(p.calendar) ? { calendar: p.calendar } : {}), ...(description ? { description } : {}) };
    return req;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^Save event\s+(#[0-9a-f]{6}):\s*(.+)$/i);
    if (!m) continue;
    const p = parseProps(m[2]);
    const c: EventChange = { key: m[1].toLowerCase() };
    if (p.title) c.title = p.title;
    if (p.start) c.start = p.start;
    if (p.end) c.end = p.end;
    if (p.location !== undefined) c.location = none(p.location) ? null : p.location;
    if (p.guests !== undefined) c.guests = none(p.guests) ? [] : emails(p.guests);
    if (p.meet !== undefined) c.meet = yes(p.meet);
    if (Object.keys(c).length > 1) req.changes.push(c);
  }
  void KEY;
  return req;
}
