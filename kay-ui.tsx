/**
 * Connector cards — UI side.
 *
 * Registers two inline tool renderers so `linearcards_issue` and
 * `linearcards_newissue` draw as Linear's issue view and create dialog inside
 * the chat. Single file on purpose: Bonsai bundles a plugin's UI entry on its
 * own, without relative imports.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button, Pill } from "@bonsai/plugin-ui-sdk/ui";
import { useKayActions } from "@bonsai/frontend-sdk";

type State = { name: string; type?: string };
type Issue = {
  identifier: string;
  title: string;
  description?: string;
  url?: string;
  state: State;
  priority: number;
  assignee?: string;
  project?: string;
  labels?: string[];
  createdAt?: string;
  completedAt?: string;
};
type Draft = {
  team: string;
  title: string;
  description?: string;
  state: string;
  priority: number;
  assignee?: string;
  project?: string;
  labels?: string[];
  options?: { states?: State[]; projects?: string[]; labels?: string[]; members?: string[] };
};
type RendererProps = { phase: string; rawArgs?: string; rawResult?: string; sessionId: string };

const v = (n: string) => `var(--kay-color-${n})`;
const PRIORITIES = ["No priority", "Urgent", "High", "Medium", "Low"];
const DEFAULT_STATES: State[] = [
  { name: "Backlog", type: "backlog" },
  { name: "Todo", type: "unstarted" },
  { name: "In Progress", type: "started" },
  { name: "In Review", type: "started" },
  { name: "Done", type: "completed" },
  { name: "Canceled", type: "canceled" },
];

const card: CSSProperties = { border: `1px solid ${v("border")}`, borderRadius: 12, background: v("bg-elevated"), overflow: "hidden", maxWidth: 680, color: v("text-primary"), fontSize: 14 };
const pad: CSSProperties = { padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: 12 };
const bare: CSSProperties = { width: "100%", background: "transparent", border: 0, outline: "none", padding: 0, color: v("text-primary"), font: "inherit", resize: "none" };
const muted: CSSProperties = { color: v("text-secondary") };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 };

function parse<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}
const day = (s?: string) => (s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

/* Glyphs: Linear's status circles and priority bars, as small inline SVGs. */
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
const TeamChip = ({ k }: { k: string }) => <Pill size="sm" surface="glass" lead={<span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: v("success") }} />}>{k}</Pill>;

/* A pill that opens a list. Plain React: the plugin UI SDK exposes Pill but no menu. */
function Picker<T>({ items, value, onPick, label, lead, keyOf, labelOf, emphasis, multi }: {
  items: T[]; value: T | T[] | undefined; onPick: (t: T) => void; label: string;
  lead: (t: T | undefined) => ReactNode; keyOf: (t: T) => string; labelOf: (t: T) => string; emphasis?: boolean; multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const selected = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const text = selected.length ? selected.map(labelOf).join(", ") : label;
  const isSel = (t: T) => selected.some(s => keyOf(s) === keyOf(t));
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <Pill tone={emphasis ? "emphasis" : "neutral"} surface={emphasis ? "bare" : "glass"} caret lead={lead(Array.isArray(value) ? undefined : value)} onClick={() => setOpen(o => !o)} aria-expanded={open}>{text}</Pill>
      {open ? (
        <div role="listbox" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, minWidth: 180, padding: 4, borderRadius: 8, border: `1px solid ${v("border")}`, background: v("bg-floating"), boxShadow: "0 8px 24px rgba(0,0,0,.12)" }}>
          {items.map(t => (
            <button key={keyOf(t)} type="button" role="option" aria-selected={isSel(t)} onClick={() => { onPick(t); if (!multi) setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", border: 0, borderRadius: 6, background: "transparent", color: v("text-primary"), font: "inherit", fontSize: 13, textAlign: "left", cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.background = v("interactive-hover"))} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
              <span style={{ display: "inline-flex", width: 14, justifyContent: "center", color: v("text-secondary") }}>{lead(t)}</span>
              <span style={{ flex: 1 }}>{labelOf(t)}</span>
              {isSel(t) ? <span style={{ color: v("accent") }}>✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
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

/* ---------- Issue view ---------- */
function IssueCard({ phase, rawArgs }: RendererProps) {
  const issue = useMemo(() => parse<Issue>(rawArgs), [rawArgs]);
  if (!issue) return <div style={{ ...card, ...pad, ...muted }}>{phase === "running" ? "Loading issue…" : "No issue data."}</div>;
  const team = issue.identifier.split("-")[0];
  return (
    <section style={{ ...card, ...pad }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ ...row, fontSize: 12, ...muted }}><TeamChip k={team} /><span>›</span><span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{issue.identifier}</span></div>
        {issue.url ? <a href={issue.url} target="_blank" rel="noreferrer" aria-label="Open in Linear" style={{ ...muted, display: "inline-flex" }}><svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13h7a1.5 1.5 0 0 0 1.5-1.5V9M9 2h4v4M13 2L7 8" /></svg></a> : null}
      </div>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{issue.title}</h2>
      {issue.description ? <Description md={issue.description} /> : null}
      <div style={{ ...row, paddingTop: 2 }}>
        <Pill tone="emphasis" lead={<StatusGlyph type={issue.state.type} />}>{issue.state.name}</Pill>
        <Pill surface="glass" lead={<PriorityGlyph p={issue.priority} />}>{PRIORITIES[issue.priority] ?? "No priority"}</Pill>
        {issue.assignee ? <Pill surface="glass" lead={<UserGlyph />}>{issue.assignee}</Pill> : null}
        {issue.project ? <Pill surface="glass" lead={<ProjectGlyph />}>{issue.project}</Pill> : null}
        {(issue.labels ?? []).map(l => <Pill key={l} surface="glass" lead={<LabelGlyph />}>{l}</Pill>)}
      </div>
      {issue.createdAt ? <div style={{ ...muted, fontSize: 12 }}>Created {day(issue.createdAt)}{issue.completedAt ? ` · Done ${day(issue.completedAt)}` : ""}</div> : null}
    </section>
  );
}

/* ---------- Create dialog ---------- */
function NewIssueCard({ phase, rawArgs, sessionId }: RendererProps) {
  const draft = useMemo(() => parse<Draft>(rawArgs), [rawArgs]);
  const actions = useKayActions(sessionId);
  const states = draft?.options?.states?.length ? draft.options.states : DEFAULT_STATES;
  const [title, setTitle] = useState(draft?.title ?? "");
  const [desc, setDesc] = useState(draft?.description ?? "");
  const [state, setState] = useState<State | undefined>(() => states.find(s => s.name === draft?.state) ?? states[1]);
  const [priority, setPriority] = useState(draft?.priority ?? 0);
  const [assignee, setAssignee] = useState<string | undefined>(draft?.assignee);
  const [project, setProject] = useState<string | undefined>(draft?.project);
  const [labels, setLabels] = useState<string[]>(draft?.labels ?? []);
  const [sent, setSent] = useState(false);
  if (!draft) return <div style={{ ...card, ...pad, ...muted }}>{phase === "running" ? "Preparing draft…" : "No draft data."}</div>;
  const members = draft.options?.members ?? (assignee ? [assignee] : []);
  const projects = draft.options?.projects ?? (project ? [project] : []);
  const labelOptions = draft.options?.labels ?? labels;
  const locked = sent;

  async function create() {
    const final = { team: draft!.team, title: title.trim(), description: desc.trim(), state: state?.name, priority, assignee, project, labels };
    const summary = [state?.name, PRIORITIES[priority], assignee, project, labels.length ? labels.join(", ") : null].filter(Boolean).join(" · ");
    setSent(true);
    await actions.sendMessage(`Create Linear issue in ${draft!.team}: "${final.title}" — ${summary}\n\n\`\`\`json\n${JSON.stringify(final, null, 2)}\n\`\`\``);
  }

  return (
    <section style={card}>
      <div style={pad}>
        <TeamChip k={draft.team} />
        <input style={{ ...bare, fontSize: 16, fontWeight: 600 }} value={title} onChange={e => setTitle(e.target.value)} placeholder="Issue title" aria-label="Issue title" disabled={locked} />
        <textarea style={{ ...bare, lineHeight: "22px" }} rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Add description…" aria-label="Add description" disabled={locked} />
        <div style={{ ...row, pointerEvents: locked ? "none" : "auto", opacity: locked ? 0.7 : 1 }}>
          <Picker items={states} value={state} onPick={setState} label="Status" lead={s => <StatusGlyph type={s?.type} />} keyOf={s => s.name} labelOf={s => s.name} emphasis />
          <Picker items={[0, 1, 2, 3, 4]} value={priority} onPick={setPriority} label="Priority" lead={p => <PriorityGlyph p={p ?? 0} />} keyOf={p => String(p)} labelOf={p => PRIORITIES[p]} />
          <Picker items={members} value={assignee} onPick={setAssignee} label="Assignee" lead={() => <UserGlyph />} keyOf={m => m} labelOf={m => m} />
          <Picker items={projects} value={project} onPick={setProject} label="Project" lead={() => <ProjectGlyph />} keyOf={p => p} labelOf={p => p} />
          <Picker items={labelOptions} value={labels} multi onPick={l => setLabels(ls => ls.includes(l) ? ls.filter(x => x !== l) : [...ls, l])} label="Labels" lead={() => <LabelGlyph />} keyOf={l => l} labelOf={l => l} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${v("border")}`, padding: "10px 16px" }}>
        <span style={{ ...muted, fontSize: 12 }}>{sent ? "Creating in Linear…" : ""}</span>
        <Button variant="primary" size="sm" disabled={locked || !title.trim()} onClick={create}>{sent ? "Creating…" : "Create issue"}</Button>
      </div>
    </section>
  );
}

export default function activate(api) {
  const presentation = { venue: "inline", grouping: "standalone", disclosure: "always-open" } as const;
  const a = api.slots.registerToolRenderer("linearcards_issue", IssueCard, presentation);
  const b = api.slots.registerToolRenderer("linearcards_newissue", NewIssueCard, presentation);
  return { dispose() { a.dispose(); b.dispose(); } };
}
