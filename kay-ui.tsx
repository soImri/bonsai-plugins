/**
 * Connector cards — UI side. Linear's component library for Bonsai's chat.
 *
 * Components: TeamChip, StatusGlyph, PriorityGlyph, Picker (portal menu), PropertyPills,
 * SaveBar, CommentComposer, Description, IssueRow, GroupHeader, ProgressBar.
 * Compositions: IssueCard (core), NewIssueCard, and ComposedView (list, board, project).
 * Jev picks the composition and fields at runtime (see kay-agent.ts); this file draws them.
 *
 * Single file on purpose: Bonsai bundles a plugin's UI entry on its own, no relative imports.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Pill } from "@bonsai/plugin-ui-sdk/ui";
import { useKayActions } from "@bonsai/frontend-sdk";

/* ---------- types ---------- */
type State = { name: string; type?: string };
type Options = { states?: State[]; projects?: string[]; labels?: string[]; members?: string[] };
type Issue = {
  identifier: string; title: string; description?: string; url?: string;
  state: State; priority: number; assignee?: string; project?: string; labels?: string[];
  createdAt?: string; completedAt?: string; options?: Options; commentDraft?: string;
};
type Draft = { team: string; title: string; description?: string; state: string; priority: number; assignee?: string; project?: string; labels?: string[]; options?: Options };
type Fields = { description?: boolean; labels?: boolean; dates?: boolean; assignee?: boolean; project?: boolean };
type Composition = { view: "issue" | "list" | "board" | "project"; groupBy?: "status" | "project" | "assignee" | "priority"; sort?: "priority" | "newest" | "none"; fields: Fields; by: "jev" | "fallback"; confidence?: number };
type ViewArgs = { task: string; issues: Issue[]; options?: Options; project?: { name: string; lead?: string; targetDate?: string; description?: string } };
type RendererProps = { call?: { resultDetails?: unknown; resultText?: string }; phase: string; rawArgs?: string; rawResult?: string; sessionId: string };
type Props = { state?: State; priority: number; assignee?: string; project?: string; labels: string[] };

/* ---------- tokens and helpers ---------- */
const v = (n: string) => `var(--kay-color-${n})`;
const PRIORITIES = ["No priority", "Urgent", "High", "Medium", "Low"];
const DEFAULT_STATES: State[] = [
  { name: "Backlog", type: "backlog" }, { name: "Todo", type: "unstarted" }, { name: "In Progress", type: "started" },
  { name: "In Review", type: "started" }, { name: "Done", type: "completed" }, { name: "Canceled", type: "canceled" },
];
const STATE_ORDER = ["started", "unstarted", "backlog", "completed", "canceled"];
const card: CSSProperties = { border: `1px solid ${v("border")}`, borderRadius: 12, background: v("bg-elevated"), overflow: "hidden", maxWidth: 720, color: v("text-primary"), fontSize: 14 };
const pad: CSSProperties = { padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: 12 };
const bare: CSSProperties = { width: "100%", background: "transparent", border: 0, outline: "none", padding: 0, color: v("text-primary"), font: "inherit", resize: "none" };
const muted: CSSProperties = { color: v("text-secondary") };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 };
const mono: CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
const footer: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${v("border")}`, padding: "10px 16px" };
function parse<T>(raw: string | undefined): T | null { if (!raw) return null; try { return JSON.parse(raw) as T; } catch { return null; } }
/**
 * v2: the tool returns the render payload in its result's `details`. Bonsai hands a renderer that
 * object as `call.resultDetails`; `rawResult` is only the result's prose text (and is cut to 4 KB on
 * reload), so it is parsed only as a last resort. v1 passed the payload in the arguments.
 */
function detailsOf(call: RendererProps["call"], rawResult: string | undefined): any {
  const d = call?.resultDetails;
  if (d && typeof d === "object") return d;
  const r = parse<any>(rawResult);
  return r?.details ?? (r && typeof r === "object" && ("issues" in r || "issue" in r || "draft" in r) ? r : null);
}
function ErrorCard({ message }: { message: string }) { return <div style={{ ...card, ...pad, ...muted }}>{message}</div>; }
function Timing({ t }: { t?: { linear?: string; jev?: string } }) { if (!t) return null; return <span>{[t.linear ? `Linear ${t.linear}` : null, t.jev ? `Jev ${t.jev}` : null].filter(Boolean).join(" · ")}</span>; }
const day = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const propsOf = (i: Issue, states: State[]): Props => ({ state: states.find(s => s.name === i.state?.name) ?? i.state, priority: i.priority ?? 0, assignee: i.assignee, project: i.project, labels: i.labels ?? [] });
function diff(a: Props, b: Props): string[] {
  const out: string[] = [];
  if (a.state?.name !== b.state?.name) out.push(`status → ${b.state?.name}`);
  if (a.priority !== b.priority) out.push(`priority → ${PRIORITIES[b.priority]}`);
  if (a.assignee !== b.assignee) out.push(`assignee → ${b.assignee ?? "none"}`);
  if (a.project !== b.project) out.push(`project → ${b.project ?? "none"}`);
  if (a.labels.join("|") !== b.labels.join("|")) out.push(`labels → ${b.labels.length ? b.labels.join(", ") : "none"}`);
  return out;
}
/**
 * What a card sends is a short command in plain words; the plugin parses it (linear/write.ts
 * `parseCardMessage`), the agent only passes it on. Keep these three shapes and the parser in step.
 */
const saveLine = (identifier: string, changes: string[]) => `Save ${identifier}: ${changes.join("; ")}`;
const commentMessage = (identifier: string, body: string) => `Comment on ${identifier}:\n${body}`;
const createMessage = (team: string, title: string, p: Props, description: string) =>
  `Create in ${team}: ${title}\nstatus → ${p.state?.name ?? "none"}; priority → ${PRIORITIES[p.priority]}; assignee → ${p.assignee ?? "none"}; project → ${p.project ?? "none"}; labels → ${p.labels.length ? p.labels.join(", ") : "none"}${description.trim() ? `\n\nDescription:\n${description.trim()}` : ""}`;

/* ---------- glyphs ---------- */
function StatusGlyph({ type }: { type?: string }) {
  const c = type === "completed" ? v("success") : type === "started" ? v("warning") : type === "canceled" ? v("text-muted") : v("text-secondary");
  if (type === "completed") return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill={c} /><path d="M4 7.2l2 2 4-4.4" stroke="white" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (type === "canceled") return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="6.5" fill={c} /><path d="M4.5 4.5l5 5M9.5 4.5l-5 5" stroke="white" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (type === "started") return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke={c} strokeWidth="1.5" fill="none" /><path d="M7 2.5a4.5 4.5 0 0 1 0 9z" fill={c} /></svg>;
  return <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" stroke={c} strokeWidth="1.5" fill="none" strokeDasharray={type === "backlog" ? "2 2" : undefined} /></svg>;
}
function PriorityGlyph({ p }: { p: number }) {
  if (p === 1) return <svg width="14" height="14" viewBox="0 0 14 14"><rect x="1" y="1" width="12" height="12" rx="2.5" fill={v("warning")} /><path d="M7 3.5v4M7 9.8v.4" stroke="white" strokeWidth="1.6" strokeLinecap="round" /></svg>;
  if (p === 0) return <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 7h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  const lit = p === 2 ? 3 : p === 3 ? 2 : 1;
  return <svg width="14" height="14" viewBox="0 0 14 14">{[0, 1, 2].map(i => <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={4 + i * 3} rx="0.8" fill="currentColor" opacity={i < lit ? 1 : 0.28} />)}</svg>;
}
const UserGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="4.5" r="2.6" fill="currentColor" /><path d="M2 12.5c.6-2.9 2.4-4.3 5-4.3s4.4 1.4 5 4.3z" fill="currentColor" /></svg>;
const ProjectGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M7 1.5l5 2.8v5.4L7 12.5 2 9.7V4.3z" /><path d="M2 4.3l5 2.8 5-2.8M7 7.1v5.4" /></svg>;
const LabelGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 7.2V2.5h4.7L12 7.8 7.3 12.5z" strokeLinejoin="round" /><circle cx="5" cy="5.5" r="1" fill="currentColor" stroke="none" /></svg>;
const OpenGlyph = () => <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13h7a1.5 1.5 0 0 0 1.5-1.5V9M9 2h4v4M13 2L7 8" /></svg>;
const TeamChip = ({ k }: { k: string }) => <Pill size="sm" surface="glass" lead={<span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: v("success") }} />}>{k}</Pill>;

/* ---------- Picker: a pill (or a bare glyph) that opens a portaled list ---------- */
function Picker<T>({ items, value, onPick, label, lead, keyOf, labelOf, emphasis, multi, compact, title }: {
  items: T[]; value: T | T[] | undefined; onPick: (t: T) => void; label: string;
  lead: (t: T | undefined) => ReactNode; keyOf: (t: T) => string; labelOf: (t: T) => string; emphasis?: boolean; multi?: boolean; compact?: boolean; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = Math.min(items.length, 8) * 34 + 10;
    const below = r.bottom + 6 + h <= window.innerHeight;
    setPos({ top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h), left: Math.min(r.left, window.innerWidth - 200) });
  }, [open, items.length]);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { const t = e.target as Node; if (!trigger.current?.contains(t) && !menu.current?.contains(t)) setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener("mousedown", down); window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => { document.removeEventListener("mousedown", down); window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [open]);
  const selected = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const text = selected.length ? selected.map(labelOf).join(", ") : label;
  const isSel = (t: T) => selected.some(s => keyOf(s) === keyOf(t));
  const single = Array.isArray(value) ? undefined : value;
  return (
    <div ref={trigger} style={{ display: "inline-flex" }} onClick={e => e.stopPropagation()}>
      {compact
        ? <button type="button" title={title ?? `${label}: ${text}`} aria-label={`${label}: ${text}`} aria-expanded={open} onClick={() => setOpen(o => !o)}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 22, height: 22, border: 0, borderRadius: 5, background: open ? v("interactive-hover") : "transparent", color: v("text-secondary"), cursor: "pointer", padding: "0 3px" }}
            onMouseEnter={e => (e.currentTarget.style.background = v("interactive-hover"))} onMouseLeave={e => (e.currentTarget.style.background = open ? v("interactive-hover") : "transparent")}>
            {lead(single)}
          </button>
        : <Pill tone={emphasis ? "emphasis" : "neutral"} surface={emphasis ? "bare" : "glass"} caret lead={lead(single)} onClick={() => setOpen(o => !o)} aria-expanded={open}>{text}</Pill>}
      {open && pos ? createPortal(
        <div ref={menu} role="listbox" style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 1000, minWidth: 180, maxHeight: 290, overflowY: "auto", padding: 4, borderRadius: 8, border: `1px solid ${v("border")}`, background: v("bg-floating"), boxShadow: "0 8px 24px rgba(0,0,0,.14)", color: v("text-primary"), fontSize: 13 }}>
          {items.length === 0 ? <div style={{ padding: "6px 8px", color: v("text-secondary") }}>No options</div> : null}
          {items.map(t => (
            <button key={keyOf(t)} type="button" role="option" aria-selected={isSel(t)} onClick={() => { onPick(t); if (!multi) setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: 0, borderRadius: 6, background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.background = v("interactive-hover"))} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: v("text-secondary") }}>{lead(t)}</span>
              <span style={{ flex: 1 }}>{labelOf(t)}</span>
              {isSel(t) ? <span style={{ color: v("accent") }}>✓</span> : null}
            </button>
          ))}
        </div>, document.body) : null}
    </div>
  );
}

/* ---------- PropertyPills: Linear's five properties as pickers ---------- */
function PropertyPills({ value, options, onChange, fields }: { value: Props; options: Options | undefined; onChange: (next: Props) => void; fields?: Fields }) {
  const states = options?.states?.length ? options.states : DEFAULT_STATES;
  const members = options?.members ?? (value.assignee ? [value.assignee] : []);
  const projects = options?.projects ?? (value.project ? [value.project] : []);
  const labelOptions = options?.labels ?? value.labels;
  const f = fields ?? {};
  const show = (k: keyof Fields) => f[k] !== false;
  return (
    <div style={row}>
      <Picker items={states} value={value.state} onPick={s => onChange({ ...value, state: s })} label="Status" lead={s => <StatusGlyph type={s?.type} />} keyOf={s => s.name} labelOf={s => s.name} emphasis />
      <Picker items={[0, 1, 2, 3, 4]} value={value.priority} onPick={p => onChange({ ...value, priority: p })} label="Priority" lead={p => <PriorityGlyph p={p ?? 0} />} keyOf={p => String(p)} labelOf={p => PRIORITIES[p]} />
      {show("assignee") ? <Picker items={members} value={value.assignee} onPick={m => onChange({ ...value, assignee: m })} label="Assignee" lead={() => <UserGlyph />} keyOf={m => m} labelOf={m => m} /> : null}
      {show("project") ? <Picker items={projects} value={value.project} onPick={p => onChange({ ...value, project: p })} label="Project" lead={() => <ProjectGlyph />} keyOf={p => p} labelOf={p => p} /> : null}
      {show("labels") ? <Picker items={labelOptions} value={value.labels} multi onPick={l => onChange({ ...value, labels: value.labels.includes(l) ? value.labels.filter(x => x !== l) : [...value.labels, l] })} label="Labels" lead={() => <LabelGlyph />} keyOf={l => l} labelOf={l => l} /> : null}
    </div>
  );
}

function SaveBar({ count, saving, onDiscard, onSave, note }: { count: number; saving: boolean; onDiscard: () => void; onSave: () => void; note?: string }) {
  if (count === 0 && !saving) return note ? <div style={{ ...footer, ...muted, fontSize: 12 }}>{note}</div> : null;
  return (
    <div style={footer}>
      <span style={{ ...muted, fontSize: 12 }}>{saving ? "Saving to Linear…" : `${count} ${count === 1 ? "change" : "changes"}`}</span>
      <span style={{ display: "inline-flex", gap: 8 }}>
        <Button variant="secondary" size="sm" disabled={saving} onClick={onDiscard}>Discard</Button>
        <Button variant="primary" size="sm" disabled={saving || count === 0} onClick={onSave}>{saving ? "Saving…" : "Save changes"}</Button>
      </span>
    </div>
  );
}

function CommentComposer({ identifier, draft, sessionId }: { identifier: string; draft?: string; sessionId: string }) {
  const actions = useKayActions(sessionId);
  const [text, setText] = useState(draft ?? "");
  const [open, setOpen] = useState(Boolean(draft));
  const [posting, setPosting] = useState(false);
  useEffect(() => { if (draft) { setText(draft); setOpen(true); } }, [draft]);
  async function post() {
    setPosting(true);
    await actions.sendMessage(commentMessage(identifier, text.trim()));
    setPosting(false); setText(""); setOpen(false);
  }
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={{ ...bare, textAlign: "left", cursor: "text", color: v("text-placeholder"), padding: "8px 0 0" }}>Leave a comment…</button>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: `1px solid ${v("border")}` }}>
      <textarea autoFocus style={{ ...bare, lineHeight: "22px" }} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Leave a comment…" aria-label="Comment" disabled={posting} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="secondary" size="sm" disabled={posting} onClick={() => { setOpen(false); setText(""); }}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={posting || !text.trim()} onClick={post}>{posting ? "Posting…" : "Comment"}</Button>
      </div>
    </div>
  );
}

function Description({ md }: { md: string }) {
  const [open, setOpen] = useState(false);
  const lines = md.replace(/`/g, "").split("\n").filter(l => l.trim());
  const shown = open ? lines : lines.slice(0, 3);
  return (
    <div style={{ ...muted, lineHeight: "22px" }}>
      {shown.map((l, i) => l.startsWith("#") ? <div key={i} style={{ fontWeight: 500, color: v("text-primary"), marginTop: 4 }}>{l.replace(/^#+\s*/, "")}</div> : <div key={i}>{l.replace(/^[*-]\s+/, "• ")}</div>)}
      {lines.length > 3 ? <button type="button" onClick={() => setOpen(o => !o)} style={{ ...bare, width: "auto", marginTop: 4, fontSize: 12, color: v("text-secondary"), cursor: "pointer" }}>{open ? "Show less" : `Show more (${lines.length - 3} lines)`}</button> : null}
    </div>
  );
}

/* ---------- IssueCard: the core view ---------- */
function IssueCard({ call, phase, rawArgs, rawResult, sessionId, note }: RendererProps & { note?: string }) {
  const details = useMemo(() => detailsOf(call, rawResult), [call?.resultDetails, rawResult]);
  const issue = useMemo<Issue | null>(() => details?.issue ?? parse<Issue>(rawArgs), [details, rawArgs]);
  const actions = useKayActions(sessionId);
  const states = issue?.options?.states?.length ? issue.options.states : DEFAULT_STATES;
  const initial = useMemo<Props>(() => (issue ? propsOf(issue, states) : { priority: 0, labels: [] }), [issue]);
  const [saved, setSaved] = useState<Props>(initial);
  const [cur, setCur] = useState<Props>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) { setSaved(initial); setCur(initial); } }, [initial]);
  if (details?.error) return <ErrorCard message={details.error} />;
  if (!issue?.title || phase === "running") return <div style={{ ...card, ...pad, ...muted }}>{phase === "running" ? "Reading Linear…" : "No issue data."}</div>;
  const changes = diff(saved, cur); dirty.current = changes.length > 0;
  async function save() { setSaving(true); const next = cur; await actions.sendMessage(saveLine(issue!.identifier, changes)); setSaved(next); setSaving(false); }
  return (
    <section style={card}>
      <div style={pad}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ ...row, fontSize: 12, ...muted }}><TeamChip k={issue.identifier.split("-")[0]} /><span>›</span><span style={mono}>{issue.identifier}</span></div>
          {issue.url ? <a href={issue.url} target="_blank" rel="noreferrer" aria-label="Open in Linear" style={{ ...muted, display: "inline-flex" }}><OpenGlyph /></a> : null}
        </div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{issue.title}</h2>
        {issue.description ? <Description md={issue.description} /> : null}
        <div style={{ pointerEvents: saving ? "none" : "auto", opacity: saving ? 0.7 : 1 }}>
          <PropertyPills value={cur} options={issue.options} onChange={setCur} />
        </div>
        {issue.createdAt ? <div style={{ ...muted, fontSize: 12 }}>Created {day(issue.createdAt)}{issue.completedAt ? ` · Done ${day(issue.completedAt)}` : ""}</div> : null}
        <CommentComposer identifier={issue.identifier} draft={issue.commentDraft} sessionId={sessionId} />
      </div>
      <SaveBar count={changes.length} saving={saving} onDiscard={() => setCur(saved)} onSave={save} note={note ?? (details?.timing?.linear ? `Linear ${details.timing.linear}` : undefined)} />
    </section>
  );
}

/* ---------- NewIssueCard: Linear's create dialog ---------- */
function NewIssueCard({ call, phase, rawArgs, rawResult, sessionId }: RendererProps) {
  const details = useMemo(() => detailsOf(call, rawResult), [call?.resultDetails, rawResult]);
  const draft = useMemo<Draft | null>(() => details?.draft ?? parse<Draft>(rawArgs), [details, rawArgs]);
  const actions = useKayActions(sessionId);
  const states = draft?.options?.states?.length ? draft.options.states : DEFAULT_STATES;
  const seed = useMemo<Props & { title: string; desc: string }>(() => ({
    title: draft?.title ?? "", desc: draft?.description ?? "",
    state: states.find(s => s.name === draft?.state) ?? states[1], priority: draft?.priority ?? 0, assignee: draft?.assignee, project: draft?.project, labels: draft?.labels ?? [],
  }), [draft]);
  const [title, setTitle] = useState(seed.title);
  const [desc, setDesc] = useState(seed.desc);
  const [props, setProps] = useState<Props>(seed);
  const [sent, setSent] = useState(false);
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) { setTitle(seed.title); setDesc(seed.desc); setProps(seed); } }, [seed]);
  if (details?.error) return <ErrorCard message={details.error} />;
  if (!draft?.team || phase === "running") return <div style={{ ...card, ...pad, ...muted }}>{phase === "running" ? "Reading Linear…" : "No draft data."}</div>;
  async function create() {
    setSent(true);
    await actions.sendMessage(createMessage(draft!.team, title.trim(), props, desc));
  }
  return (
    <section style={card}>
      <div style={{ ...pad, paddingBottom: 12 }}>
        <TeamChip k={draft.team} />
        <input style={{ ...bare, fontSize: 16, fontWeight: 600 }} value={title} onChange={e => { touched.current = true; setTitle(e.target.value); }} placeholder="Issue title" aria-label="Issue title" disabled={sent} />
        <textarea style={{ ...bare, lineHeight: "22px" }} rows={3} value={desc} onChange={e => { touched.current = true; setDesc(e.target.value); }} placeholder="Add description…" aria-label="Add description" disabled={sent} />
        <div style={{ pointerEvents: sent ? "none" : "auto", opacity: sent ? 0.7 : 1 }}>
          <PropertyPills value={props} options={draft.options} onChange={p => { touched.current = true; setProps(p); }} />
        </div>
      </div>
      <div style={footer}>
        <span style={{ ...muted, fontSize: 12 }}>{sent ? "Creating in Linear…" : details?.picks ? <>{details.picks.by === "jev" ? "Fields picked by Jev" : "Default fields"}{details.timing ? <> · <Timing t={details.timing} /></> : null}</> : ""}</span>
        <Button variant="primary" size="sm" disabled={sent || !title.trim()} onClick={create}>{sent ? "Creating…" : "Create issue"}</Button>
      </div>
    </section>
  );
}

/* ---------- rows, groups, progress ---------- */
function IssueRow({ issue, value, onChange, options, fields, onOpen }: { issue: Issue; value: Props; onChange: (p: Props) => void; options?: Options; fields: Fields; onOpen: (id: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 8 }}
      onMouseEnter={e => (e.currentTarget.style.background = v("interactive-hover"))} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      <Picker compact items={[0, 1, 2, 3, 4]} value={value.priority} onPick={p => onChange({ ...value, priority: p })} label="Priority" lead={p => <PriorityGlyph p={p ?? 0} />} keyOf={p => String(p)} labelOf={p => PRIORITIES[p]} />
      <span style={{ ...muted, ...mono, fontSize: 12, width: 62, flexShrink: 0 }}>{issue.identifier}</span>
      <Picker compact items={options?.states?.length ? options.states : DEFAULT_STATES} value={value.state} onPick={s => onChange({ ...value, state: s })} label="Status" lead={s => <StatusGlyph type={s?.type} />} keyOf={s => s.name} labelOf={s => s.name} />
      <button type="button" onClick={() => onOpen(issue.identifier)} title={`Open ${issue.identifier}`} style={{ ...bare, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", cursor: "pointer", fontSize: 14 }}>{issue.title}</button>
      {fields.labels !== false ? <Picker compact items={options?.labels ?? value.labels} value={value.labels} multi onPick={l => onChange({ ...value, labels: value.labels.includes(l) ? value.labels.filter(x => x !== l) : [...value.labels, l] })} label="Labels" lead={() => value.labels.length ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}><LabelGlyph />{value.labels.length}</span> : <LabelGlyph />} keyOf={l => l} labelOf={l => l} /> : null}
      {fields.assignee !== false ? <Picker compact items={options?.members ?? (value.assignee ? [value.assignee] : [])} value={value.assignee} onPick={m => onChange({ ...value, assignee: m })} label="Assignee" lead={() => <UserGlyph />} keyOf={m => m} labelOf={m => m} title={`Assignee: ${value.assignee ?? "none"}`} /> : null}
      {fields.dates !== false && issue.createdAt ? <span style={{ ...muted, fontSize: 12, flexShrink: 0, width: 44, textAlign: "right" }}>{day(issue.createdAt)}</span> : null}
    </div>
  );
}
function GroupHeader({ lead, label, count }: { lead: ReactNode; label: string; count: number }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 8px", fontSize: 13, fontWeight: 600 }}>{lead}{label}<span style={{ ...muted, fontWeight: 400 }}>{count}</span></div>;
}
function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: v("bg-subtle"), overflow: "hidden" }}><div style={{ width: `${pct}%`, height: "100%", background: v("success") }} /></div>
      <span style={{ ...muted, fontSize: 12, width: 96, textAlign: "right" }}>{done}/{total} done · {pct}%</span>
    </div>
  );
}

/* ---------- ComposedView: Jev picked issue / list / board / project ---------- */
function readComposition(rawResult: string | undefined, n: number): Composition {
  const fallback: Composition = { view: n === 1 ? "issue" : n > 6 ? "board" : "list", groupBy: "status", sort: "priority", fields: { description: n === 1, labels: true, dates: n === 1, assignee: true, project: true }, by: "fallback" };
  if (!rawResult) return fallback;
  const r = parse<any>(rawResult);
  const c = r?.details?.composition ?? r?.composition;
  if (c?.view) return { ...fallback, ...c, fields: { ...fallback.fields, ...(c.fields ?? {}) } };
  const m = rawResult.match(/"composition":(\{[^{}]*\{[^{}]*\}[^{}]*\})/);
  if (m) { const c2 = parse<Composition>(m[1]); if (c2?.view) return { ...fallback, ...c2, fields: { ...fallback.fields, ...(c2.fields ?? {}) } }; }
  return fallback;
}

function ComposedView({ call, phase, rawArgs, rawResult, sessionId, runningText }: RendererProps & { runningText?: string }) {
  const details = useMemo(() => detailsOf(call, rawResult), [call?.resultDetails, rawResult]);
  const args = useMemo<ViewArgs | null>(() => (Array.isArray(details?.issues) ? (details as ViewArgs) : parse<ViewArgs>(rawArgs)), [details, rawArgs]);
  const actions = useKayActions(sessionId);
  const issues = args?.issues ?? [];
  const comp = useMemo<Composition>(() => {
    const c = details?.composition;
    const fb = readComposition(undefined, issues.length);
    return c?.view ? { ...fb, ...c, fields: { ...fb.fields, ...(c.fields ?? {}) } } : readComposition(rawResult, issues.length);
  }, [details, rawResult, issues.length]);
  const states = args?.options?.states?.length ? args.options.states : DEFAULT_STATES;
  const seed = useMemo(() => Object.fromEntries(issues.map(i => [i.identifier, propsOf(i, states)])) as Record<string, Props>, [args]);
  const [saved, setSaved] = useState(seed);
  const [cur, setCur] = useState(seed);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) { setSaved(seed); setCur(seed); } }, [seed]);
  if (details?.error) return <ErrorCard message={details.error} />;
  if (!args || phase === "running") return <div style={{ ...card, ...pad, ...muted }}>{phase === "running" ? (runningText ?? "Reading Linear…") : "No issues."}</div>;
  if (!issues.length) return <ErrorCard message={`No ${(comp as any).scope && (comp as any).scope !== "all" ? `${(comp as any).scope} ` : ""}issues match.`} />;
  const applied: string[] | undefined = Array.isArray(details?.applied) ? details.applied : undefined;
  const savedNote = applied ? `Saved · ${applied.join(" · ")}${details?.timing?.linear ? ` · Linear ${details.timing.linear}` : ""}` : undefined;

  if (comp.view === "issue" && issues.length >= 1) {
    const one = { ...issues[0], options: issues[0].options ?? args.options };
    if (comp.fields.description === false) delete (one as any).description;
    return <IssueCard phase={phase} rawArgs={JSON.stringify(one)} sessionId={sessionId} note={savedNote} />;
  }

  const changedIds = issues.filter(i => saved[i.identifier] && cur[i.identifier] && diff(saved[i.identifier], cur[i.identifier]).length).map(i => i.identifier);
  const changes = changedIds.map(id => saveLine(id, diff(saved[id], cur[id])));
  dirty.current = changes.length > 0;
  async function save() { setSaving(true); const next = cur; await actions.sendMessage(changes.join("\n")); setSaved(next); setSaving(false); }
  const open = (id: string) => { void actions.sendMessage(`Show ${id}`); };
  const team = issues[0]?.identifier.split("-")[0] ?? "";
  const sorted = [...issues].sort((a, b) => comp.sort === "newest" ? (b.createdAt ?? "").localeCompare(a.createdAt ?? "") : comp.sort === "priority" ? ((a.priority || 9) - (b.priority || 9)) : 0);
  const gb = comp.view === "board" || comp.view === "project" ? (comp.groupBy ?? "status") : undefined;
  const stateOf = (i: Issue) => cur[i.identifier]?.state ?? i.state;
  const keyFor = (i: Issue) => gb === "status" ? stateOf(i).name : gb === "project" ? (cur[i.identifier]?.project ?? "No project") : gb === "assignee" ? (cur[i.identifier]?.assignee ?? "Unassigned") : gb === "priority" ? PRIORITIES[cur[i.identifier]?.priority ?? 0] : "all";
  const leadFor = (sample: Issue) => gb === "status" ? <StatusGlyph type={stateOf(sample).type} /> : gb === "project" ? <ProjectGlyph /> : gb === "assignee" ? <UserGlyph /> : gb === "priority" ? <PriorityGlyph p={cur[sample.identifier]?.priority ?? 0} /> : null;
  const groupsMap = new Map<string, Issue[]>();
  for (const i of sorted) { const k = keyFor(i); groupsMap.set(k, [...(groupsMap.get(k) ?? []), i]); }
  const groups = [...groupsMap.entries()].sort((a, b) => gb === "status" ? STATE_ORDER.indexOf(stateOf(a[1][0]).type ?? "") - STATE_ORDER.indexOf(stateOf(b[1][0]).type ?? "") : gb === "priority" ? PRIORITIES.indexOf(a[0]) - PRIORITIES.indexOf(b[0]) : a[0].localeCompare(b[0]));
  const done = issues.filter(i => stateOf(i).type === "completed").length;
  const inProgress = issues.filter(i => stateOf(i).type === "started").length;
  const viewName = comp.view === "list" ? "List" : comp.view === "board" ? `Board by ${gb}` : "Project";
  const t = details?.timing as { linear?: string; jev?: string } | undefined;
  const caption = savedNote ?? `${viewName} view · ${comp.by === "jev" ? "picked by Jev" : "default pick"}${t?.linear ? ` · Linear ${t.linear}` : ""}${t?.jev ? ` · Jev ${t.jev}` : ""}`;

  return (
    <section style={card}>
      <div style={{ ...pad, gap: 8 }}>
        {comp.view === "project" ? (
          <>
            <div style={{ ...row, fontSize: 12, ...muted }}>{team ? <TeamChip k={team} /> : null}<span>›</span><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ProjectGlyph />Project</span></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{args.project?.name ?? issues[0]?.project ?? "Project"}</h2>
            {args.project?.description ? <div style={{ ...muted, lineHeight: "22px" }}>{args.project.description}</div> : null}
            <ProgressBar done={done} total={issues.length} />
            <div style={{ ...row, fontSize: 12, ...muted }}>
              {args.project?.lead ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><UserGlyph />{args.project.lead}</span> : null}
              {args.project?.targetDate ? <span>Target {day(args.project.targetDate)}</span> : null}
              <span>{inProgress} in progress</span>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ ...row, fontSize: 12, ...muted }}>{team ? <TeamChip k={team} /> : null}<span>{issues.length} {issues.length === 1 ? "issue" : "issues"}</span></div>
            <span style={{ ...muted, fontSize: 12, maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{args.task}</span>
          </div>
        )}
        <div style={{ pointerEvents: saving ? "none" : "auto", opacity: saving ? 0.7 : 1 }}>
          {groups.map(([key, items], gi) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: gi === 0 ? 2 : 10 }}>
              {gb ? <GroupHeader lead={leadFor(items[0])} label={key} count={items.length} /> : null}
              {items.map(i => <IssueRow key={i.identifier} issue={i} value={cur[i.identifier] ?? propsOf(i, states)} onChange={p => setCur(c => ({ ...c, [i.identifier]: p }))} options={args.options} fields={comp.fields} onOpen={open} />)}
            </div>
          ))}
        </div>
      </div>
      <SaveBar count={changes.length} saving={saving} onDiscard={() => setCur(saved)} onSave={save} note={caption} />
    </section>
  );
}

export default function activate(api) {
  const presentation = { venue: "inline", grouping: "standalone", disclosure: "always-open" } as const;
  const a = api.slots.registerToolRenderer("linearcards_issue", IssueCard, presentation);
  const b = api.slots.registerToolRenderer("linearcards_newissue", NewIssueCard, presentation);
  const c = api.slots.registerToolRenderer("linearcards_view", ComposedView, presentation);
  const d = api.slots.registerToolRenderer("linearcards_apply", (p: RendererProps) => <ComposedView {...p} runningText="Saving to Linear…" />, presentation);
  return { dispose() { a.dispose(); b.dispose(); c.dispose(); d.dispose(); } };
}
