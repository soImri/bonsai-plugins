/**
 * Linear's compositions for the chat: IssueCard (issue view), NewIssueCard (create dialog), and
 * ComposedView (list / board / project), drawn from the payloads `index.ts` produces. Jev picks
 * which composition and which fields; this file only draws.
 *
 * What a card sends is a short command in plain words; `write.ts` parses it. Keep the three
 * shapes here (saveLine, commentMessage, createMessage) and the parser in step.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, ErrorCard, GroupHeader, LongText, OpenExternal, Picker, Placeholder, ProgressBar, SaveBar, Timing, UserGlyph, bare, card, dayShort, footer, hoverable, mono, muted, pad, row, useFollowUps, useWrite, writeNote, v, type ConnectorUi, type UiCtx } from "../../ui/kit.tsx";

/* ---------- types (the payload shapes index.ts produces) ---------- */
type State = { name: string; type?: string };
type Options = { states?: State[]; projects?: string[]; labels?: string[]; members?: string[] };
type Issue = { identifier: string; title: string; description?: string; url?: string; state: State; priority: number; assignee?: string; project?: string; labels?: string[]; createdAt?: string; completedAt?: string; options?: Options; commentDraft?: string; followUps?: string[] };
type Draft = { team: string; title: string; description?: string; state?: string; priority: number; assignee?: string; project?: string; labels?: string[]; options?: Options; followUps?: string[] };
type Fields = { description?: boolean; labels?: boolean; dates?: boolean; assignee?: boolean; project?: boolean };
type Composition = { view: "issue" | "list" | "board" | "project"; groupBy?: "status" | "project" | "assignee" | "priority"; sort?: "priority" | "newest" | "none"; scope?: string; fields: Fields; by: "jev" | "fallback" | "memory"; confidence?: number; followUps?: string[]; scopes?: string[] };
type Props = { state?: State; priority: number; assignee?: string; project?: string; labels: string[] };

const PRIORITIES = ["No priority", "Urgent", "High", "Medium", "Low"];
const DEFAULT_STATES: State[] = [{ name: "Backlog", type: "backlog" }, { name: "Todo", type: "unstarted" }, { name: "In Progress", type: "started" }, { name: "In Review", type: "started" }, { name: "Done", type: "completed" }, { name: "Canceled", type: "canceled" }];
const STATE_ORDER = ["started", "unstarted", "backlog", "completed", "canceled"];
const TIMING = { linear: "Linear", jev: "Jev" };
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
const ProjectGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><path d="M7 1.5l5 2.8v5.4L7 12.5 2 9.7V4.3z" /><path d="M2 4.3l5 2.8 5-2.8M7 7.1v5.4" /></svg>;
const LabelGlyph = () => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M2 7.2V2.5h4.7L12 7.8 7.3 12.5z" strokeLinejoin="round" /><circle cx="5" cy="5.5" r="1" fill="currentColor" stroke="none" /></svg>;
/** Linear's breadcrumb team label: the team's colour square and key, a label and nothing more. */
const TeamChip = ({ k }: { k: string }) => <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500, color: v("text-primary") }}><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: v("success") }} />{k}</span>;

/* ---------- PropertyPills: Linear's five properties as pickers ---------- */
function PropertyPills({ value, options, onChange, fields }: { value: Props; options: Options | undefined; onChange: (next: Props) => void; fields?: Fields }) {
  const states = options?.states?.length ? options.states : DEFAULT_STATES;
  const f = fields ?? {};
  const show = (k: keyof Fields) => f[k] !== false;
  return (
    <div style={row}>
      <Picker items={states} value={value.state} onPick={s => onChange({ ...value, state: s })} label="Status" lead={s => <StatusGlyph type={s?.type} />} keyOf={s => s.name} labelOf={s => s.name} emphasis />
      <Picker items={[0, 1, 2, 3, 4]} value={value.priority} onPick={p => onChange({ ...value, priority: p })} label="Priority" lead={p => <PriorityGlyph p={p ?? 0} />} keyOf={p => String(p)} labelOf={p => PRIORITIES[p]} />
      {show("assignee") ? <Picker items={options?.members ?? (value.assignee ? [value.assignee] : [])} value={value.assignee} onPick={m => onChange({ ...value, assignee: m })} label="Assignee" lead={() => <UserGlyph />} keyOf={m => m} labelOf={m => m} /> : null}
      {show("project") ? <Picker items={options?.projects ?? (value.project ? [value.project] : [])} value={value.project} onPick={p => onChange({ ...value, project: p })} label="Project" lead={() => <ProjectGlyph />} keyOf={p => p} labelOf={p => p} /> : null}
      {show("labels") ? <Picker items={options?.labels ?? value.labels} value={value.labels} multi onPick={l => onChange({ ...value, labels: value.labels.includes(l) ? value.labels.filter(x => x !== l) : [...value.labels, l] })} label="Labels" lead={() => <LabelGlyph />} keyOf={l => l} labelOf={l => l} /> : null}
    </div>
  );
}

function CommentComposer({ identifier, draft, ctx, startOpen }: { identifier: string; draft?: string; ctx: UiCtx; startOpen?: boolean }) {
  const [text, setText] = useState(draft ?? "");
  const [open, setOpen] = useState(Boolean(draft) || Boolean(startOpen));
  useEffect(() => { if (startOpen) setOpen(true); }, [startOpen]);
  const [posted, setPosted] = useState<string[]>([]);
  const w = useWrite(ctx);
  useEffect(() => { if (draft) { setText(draft); setOpen(true); } }, [draft]);
  async function post() {
    const body = text.trim();
    // The comment shows under the box at once; the plugin posts it in the background.
    setPosted(p => [...p, body]); setText(""); setOpen(false);
    await w.run(commentMessage(identifier, body), { revert: () => { setPosted(p => p.filter(x => x !== body)); setText(body); setOpen(true); } });
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {posted.map((p, i) => <div key={i} style={{ display: "flex", gap: 8, paddingTop: 6, borderTop: `1px solid ${v("border")}`, fontSize: 13 }}><UserGlyph /><span style={{ flex: 1, whiteSpace: "pre-wrap" }}>{p}</span><span style={{ ...muted, fontSize: 11 }}>{w.status === "saving" && i === posted.length - 1 ? "posting…" : "you"}</span></div>)}
      {w.status === "failed" ? <div style={{ fontSize: 12, color: v("danger") }}>Comment failed: {w.error}</div> : null}
      {!open ? <button type="button" onClick={() => setOpen(true)} style={{ ...bare, textAlign: "left", cursor: "text", color: v("text-placeholder"), padding: "8px 0 0" }}>Leave a comment…</button> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: `1px solid ${v("border")}` }}>
          <textarea autoFocus style={{ ...bare, lineHeight: "22px" }} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder="Leave a comment…" aria-label="Comment" />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="secondary" size="sm" onClick={() => { setOpen(false); setText(""); }}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={!text.trim()} onClick={post}>Comment</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Where a card's follow-ups live: on the issue (record), on the composition (view), or at the top of details. */
function followUpsOf(d: any, issue: any): string[] | undefined {
  const f = issue?.followUps ?? d?.followUps ?? d?.composition?.followUps;
  return Array.isArray(f) ? f : undefined;
}

/* ---------- IssueCard: Linear's issue view ---------- */
function IssueCard({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const issue = ctx.details?.issue as Issue | undefined;
  const states = issue?.options?.states?.length ? issue.options.states : DEFAULT_STATES;
  const initial = useMemo<Props>(() => (issue ? propsOf(issue, states) : { priority: 0, labels: [] }), [issue]);
  const [saved, setSaved] = useState<Props>(initial);
  const [cur, setCur] = useState<Props>(initial);
  const w = useWrite(ctx);
  const saving = w.status === "saving";
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) { setSaved(initial); setCur(initial); } }, [initial]);
  const offered: string[] | undefined = followUpsOf(ctx.details, issue);
  const fu = useFollowUps(offered);
  if (!issue?.title) return <Placeholder text="No issue data." />;
  const changes = diff(saved, cur); dirty.current = changes.length > 0;
  // Save shows the new state at once; the plugin writes it in the background; a failure puts the edits back as unsaved.
  async function save() { const prev = saved, next = cur; setSaved(next); await w.run(saveLine(issue!.identifier, changes), { revert: () => { setSaved(prev); setCur(next); } }); }
  return (
    <section style={card}>
      <div style={pad}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ ...row, fontSize: 12, ...muted }}><TeamChip k={issue.identifier.split("-")[0]} /><span>›</span><span style={mono}>{issue.identifier}</span></div>
          {issue.url ? <OpenExternal url={issue.url} title="Open in Linear" onOpen={ctx.openUrl} /> : null}
        </div>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.35 }}>{issue.title}</h2>
        {issue.description ? <LongText md={issue.description} /> : null}
        <div style={{ pointerEvents: saving ? "none" : "auto", opacity: saving ? 0.7 : 1 }}><PropertyPills value={cur} options={issue.options} onChange={setCur} /></div>
        {issue.createdAt ? <div style={{ ...muted, fontSize: 12 }}>Created {dayShort(issue.createdAt)}{issue.completedAt ? ` · Done ${dayShort(issue.completedAt)}` : ""}</div> : null}
        <CommentComposer identifier={issue.identifier} draft={issue.commentDraft} ctx={ctx} startOpen={fu.picked("comment")} />
      </div>
      <SaveBar count={changes.length} saving={false} savingText="Saving to Linear…" onDiscard={() => setCur(saved)} onSave={save} note={writeNote(w, { saving: "Saving to Linear…" }) ?? note} />
    </section>
  );
}

/* ---------- NewIssueCard: Linear's create dialog ---------- */
function NewIssueCard({ ctx, onCreated }: { ctx: UiCtx; onCreated?: (issue: Issue) => void }) {
  const draft = ctx.details?.draft as Draft | undefined;
  const states = draft?.options?.states?.length ? draft.options.states : DEFAULT_STATES;
  const seed = useMemo<Props & { title: string; desc: string }>(() => ({ title: draft?.title ?? "", desc: draft?.description ?? "", state: states.find(s => s.name === draft?.state) ?? states[1], priority: draft?.priority ?? 0, assignee: draft?.assignee, project: draft?.project, labels: draft?.labels ?? [] }), [draft]);
  const [title, setTitle] = useState(seed.title);
  const [desc, setDesc] = useState(seed.desc);
  const [props, setProps] = useState<Props>(seed);
  const [sent, setSent] = useState(false);
  const [created, setCreated] = useState<Issue | null>(null);
  const w = useWrite(ctx);
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) { setTitle(seed.title); setDesc(seed.desc); setProps(seed); setSent(false); setCreated(null); } }, [seed]);
  if (!draft?.team) return <Placeholder text="No draft data." />;
  async function create() {
    setSent(true);
    await w.run(createMessage(draft!.team, title.trim(), props, desc), { keepSaved: true, revert: () => setSent(false), onDone: (details) => { const made = details?.issues?.[0] ?? details?.issue; if (made) { setCreated({ ...made, options: made.options ?? draft!.options }); onCreated?.(made); } } });
  }
  if (created) return <IssueCard ctx={{ ...ctx, details: { kind: "issue", issue: created } }} note={`Created ${created.identifier}`} />;
  return (
    <section style={card}>
      <div style={{ ...pad, paddingBottom: 12 }}>
        <TeamChip k={draft.team} />
        <input style={{ ...bare, fontSize: 16, fontWeight: 600 }} value={title} onChange={e => { touched.current = true; setTitle(e.target.value); }} placeholder="Issue title" aria-label="Issue title" disabled={sent} />
        <textarea style={{ ...bare, lineHeight: "22px" }} rows={3} value={desc} onChange={e => { touched.current = true; setDesc(e.target.value); }} placeholder="Add description…" aria-label="Add description" disabled={sent} />
        <div style={{ pointerEvents: sent ? "none" : "auto", opacity: sent ? 0.7 : 1 }}><PropertyPills value={props} options={draft.options} onChange={p => { touched.current = true; setProps(p); }} /></div>
      </div>
      <div style={footer}>
        <span style={{ ...muted, fontSize: 12, ...(w.status === "failed" ? { color: v("danger") } : {}) }}>{w.status === "failed" ? `Failed: ${w.error}` : sent ? "Creating in Linear…" : ""}</span>
        <Button variant="primary" size="sm" disabled={sent || !title.trim()} onClick={create}>{sent ? "Creating…" : "Create issue"}</Button>
      </div>
    </section>
  );
}

/* ---------- rows ---------- */
function IssueRow({ issue, value, onChange, options, fields, onOpen }: { issue: Issue; value: Props; onChange: (p: Props) => void; options?: Options; fields: Fields; onOpen: (id: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 8 }} {...hoverable}>
      <Picker compact items={[0, 1, 2, 3, 4]} value={value.priority} onPick={p => onChange({ ...value, priority: p })} label="Priority" lead={p => <PriorityGlyph p={p ?? 0} />} keyOf={p => String(p)} labelOf={p => PRIORITIES[p]} />
      <span style={{ ...muted, ...mono, fontSize: 12, width: 62, flexShrink: 0 }}>{issue.identifier}</span>
      <Picker compact items={options?.states?.length ? options.states : DEFAULT_STATES} value={value.state} onPick={s => onChange({ ...value, state: s })} label="Status" lead={s => <StatusGlyph type={s?.type} />} keyOf={s => s.name} labelOf={s => s.name} />
      <button type="button" onClick={() => onOpen(issue.identifier)} title={`Open ${issue.identifier}`} style={{ ...bare, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", cursor: "pointer", fontSize: 14 }}>{issue.title}</button>
      {fields.labels !== false ? <Picker compact items={options?.labels ?? value.labels} value={value.labels} multi onPick={l => onChange({ ...value, labels: value.labels.includes(l) ? value.labels.filter(x => x !== l) : [...value.labels, l] })} label="Labels" lead={() => value.labels.length ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 }}><LabelGlyph />{value.labels.length}</span> : <LabelGlyph />} keyOf={l => l} labelOf={l => l} /> : null}
      {fields.assignee !== false ? <Picker compact items={options?.members ?? (value.assignee ? [value.assignee] : [])} value={value.assignee} onPick={m => onChange({ ...value, assignee: m })} label="Assignee" lead={() => <UserGlyph />} keyOf={m => m} labelOf={m => m} title={`Assignee: ${value.assignee ?? "none"}`} /> : null}
      {fields.dates !== false && issue.createdAt ? <span style={{ ...muted, fontSize: 12, flexShrink: 0, width: 44, textAlign: "right" }}>{dayShort(issue.createdAt)}</span> : null}
    </div>
  );
}

/* ---------- ComposedView: Jev picked list / board / project (or one issue); the person switches inside the card ---------- */
type Scope = "open" | "active" | "done" | "all";
const SCOPE_TYPES: Record<Scope, string[] | null> = { open: ["triage", "backlog", "unstarted", "started"], active: ["started"], done: ["completed"], all: null };
const SCOPE_LABEL: Record<Scope, string> = { open: "Open", active: "In progress", done: "Done", all: "All" };
const Tab = ({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} style={{ ...bare, width: "auto", padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: on ? 600 : 400, background: on ? v("bg-subtle") : "transparent", color: on ? v("text-primary") : v("text-secondary"), cursor: "pointer" }}>{children}</button>
);

function ComposedView({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const base: Issue[] = Array.isArray(d.allIssues) && d.allIssues.length ? d.allIssues : Array.isArray(d.issues) ? d.issues : [];
  const options: Options | undefined = d.options;
  const jevComp = useMemo<Composition>(() => { const n = (d.issues ?? base).length; const fb: Composition = { view: n === 1 ? "issue" : n > 6 ? "board" : "list", groupBy: "status", sort: "priority", scope: "open", fields: { description: n === 1, labels: true, dates: n === 1, assignee: true, project: true }, by: "fallback" }; const c = d.composition; return c?.view ? { ...fb, ...c, fields: { ...fb.fields, ...(c.fields ?? {}) } } : fb; }, [d]);
  const [view, setView] = useState<Composition["view"]>(jevComp.view);
  const [scope, setScope] = useState<Scope>((jevComp.scope as Scope) ?? "open");
  const [groupBy, setGroupBy] = useState<NonNullable<Composition["groupBy"]>>(jevComp.groupBy ?? "status");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const fu = useFollowUps(jevComp.followUps);
  useEffect(() => { setView(jevComp.view); setScope((jevComp.scope as Scope) ?? "open"); setGroupBy(jevComp.groupBy ?? "status"); setOpenId(null); setCreating(false); }, [jevComp]);
  const states = options?.states?.length ? options.states : DEFAULT_STATES;
  const seed = useMemo(() => Object.fromEntries(base.map(i => [i.identifier, propsOf(i, states)])) as Record<string, Props>, [d]);
  const [saved, setSaved] = useState(seed);
  const [cur, setCur] = useState(seed);
  const [added, setAdded] = useState<Issue[]>([]);
  const w = useWrite(ctx);
  const saving = w.status === "saving";
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) { setSaved(seed); setCur(seed); } setAdded([]); }, [seed]);
  const all: Issue[] = [...base, ...added];
  const stateOf = (i: Issue) => cur[i.identifier]?.state ?? i.state;
  const issues = all.filter(i => SCOPE_TYPES[scope] === null || SCOPE_TYPES[scope]!.includes(stateOf(i).type ?? ""));
  const applied: string[] | undefined = Array.isArray(d.applied) ? d.applied : undefined;
  const savedNote = note ?? (applied ? `Saved · ${applied.join(" · ")}` : undefined);
  const comp = jevComp;

  if (view === "issue" && all.length === 1) {
    const one = { ...all[0], options: all[0].options ?? options, ...(comp.followUps ? { followUps: comp.followUps } : {}) };
    if (comp.fields.description === false) delete (one as any).description;
    return <IssueCard ctx={{ ...ctx, details: { ...d, kind: "issue", issue: one } }} note={savedNote} />;
  }

  const changedIds = all.filter(i => saved[i.identifier] && cur[i.identifier] && diff(saved[i.identifier], cur[i.identifier]).length).map(i => i.identifier);
  const changes = changedIds.map(id => saveLine(id, diff(saved[id], cur[id])));
  dirty.current = changes.length > 0;
  async function save() { const prev = saved, next = cur; setSaved(next); await w.run(changes.join("\n"), { revert: () => { setSaved(prev); setCur(next); } }); }
  const open = (id: string) => setOpenId(o => (o === id ? null : id));
  const team = d.team ?? all[0]?.identifier.split("-")[0] ?? "";
  const sorted = [...issues].sort((a, b) => comp.sort === "newest" ? (b.createdAt ?? "").localeCompare(a.createdAt ?? "") : comp.sort === "priority" ? ((a.priority || 9) - (b.priority || 9)) : 0);
  const projects: string[] = [...new Set(all.map(i => i.project).filter(Boolean) as string[])];
  const projectInfo = d.project ?? (projects.length === 1 ? (d.projects ?? []).find((p: any) => p.name === projects[0]) ?? { name: projects[0] } : undefined);
  const effectiveView = view === "project" && !projectInfo ? "board" : view === "issue" ? "list" : view;
  const gb = effectiveView === "board" || effectiveView === "project" ? groupBy : undefined;
  const keyFor = (i: Issue) => gb === "status" ? stateOf(i).name : gb === "project" ? (cur[i.identifier]?.project ?? "No project") : gb === "assignee" ? (cur[i.identifier]?.assignee ?? "Unassigned") : gb === "priority" ? PRIORITIES[cur[i.identifier]?.priority ?? 0] : "all";
  const leadFor = (sample: Issue): ReactNode => gb === "status" ? <StatusGlyph type={stateOf(sample).type} /> : gb === "project" ? <ProjectGlyph /> : gb === "assignee" ? <UserGlyph /> : gb === "priority" ? <PriorityGlyph p={cur[sample.identifier]?.priority ?? 0} /> : null;
  const groupsMap = new Map<string, Issue[]>();
  for (const i of sorted) { const k = keyFor(i); groupsMap.set(k, [...(groupsMap.get(k) ?? []), i]); }
  const groups = [...groupsMap.entries()].sort((a, b) => gb === "status" ? STATE_ORDER.indexOf(stateOf(a[1][0]).type ?? "") - STATE_ORDER.indexOf(stateOf(b[1][0]).type ?? "") : gb === "priority" ? PRIORITIES.indexOf(a[0]) - PRIORITIES.indexOf(b[0]) : a[0].localeCompare(b[0]));
  const projIssues = effectiveView === "project" && projectInfo ? all.filter(i => i.project === projectInfo.name) : issues;
  const done = projIssues.filter(i => stateOf(i).type === "completed").length;
  const inProgress = projIssues.filter(i => stateOf(i).type === "started").length;
  const row_ = (i: Issue) => (
    <div key={i.identifier}>
      <IssueRow issue={i} value={cur[i.identifier] ?? propsOf(i, states)} onChange={p => setCur(c => ({ ...c, [i.identifier]: p }))} options={options} fields={comp.fields} onOpen={open} />
      {openId === i.identifier ? <div style={{ margin: "2px 0 8px 30px", borderLeft: `2px solid ${v("border")}`, paddingLeft: 8 }}><IssueCard ctx={{ ...ctx, details: { kind: "issue", issue: { ...i, options: i.options ?? options, followUps: [] } } }} /></div> : null}
    </div>
  );
  const switcher = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
      <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
        <Tab on={effectiveView === "list"} onClick={() => setView("list")}>List</Tab>
        <Tab on={effectiveView === "board"} onClick={() => setView("board")}>Board</Tab>
        {projectInfo ? <Tab on={effectiveView === "project"} onClick={() => setView("project")}>Project</Tab> : null}
        {gb ? <Picker items={["status", "project", "assignee", "priority"] as const} value={groupBy} onPick={g => setGroupBy(g)} label="Group" lead={() => null} keyOf={g => g} labelOf={g => `by ${g}`} /> : null}
        {fu.picked("create") && options ? <Tab on={creating} onClick={() => setCreating(c => !c)}>+ New issue</Tab> : null}
      </span>
      <span style={{ display: "inline-flex", gap: 2 }}>
        {((Array.isArray(comp.scopes) && comp.scopes.length ? comp.scopes : ["open", "active", "done", "all"]) as Scope[]).map(sc => <Tab key={sc} on={scope === sc} onClick={() => setScope(sc)}>{SCOPE_LABEL[sc]}</Tab>)}
      </span>
    </div>
  );
  const creator = creating && options ? <NewIssueCard ctx={{ ...ctx, details: { kind: "draft", draft: { team, title: "", description: "", priority: 0, labels: [], options } } }} onCreated={made => { setAdded(a => [...a, made]); setCur(c => ({ ...c, [made.identifier]: propsOf(made, states) })); setSaved(c => ({ ...c, [made.identifier]: propsOf(made, states) })); setCreating(false); }} /> : null;
  const emptyNote = !issues.length ? <div style={{ ...muted, padding: "8px 8px 2px" }}>No {SCOPE_LABEL[scope].toLowerCase()} issues.</div> : null;

  return (
    <section style={card}>
      <div style={{ ...pad, gap: 8 }}>
        {effectiveView === "project" && projectInfo ? (
          <>
            <div style={{ ...row, fontSize: 12, ...muted }}>{team ? <TeamChip k={team} /> : null}<span>›</span><span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ProjectGlyph />Project</span></div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{projectInfo.name}</h2>
            {projectInfo.description ? <div style={{ ...muted, fontSize: 13 }}>{projectInfo.description}</div> : null}
            <div style={{ ...row, fontSize: 12, ...muted }}>{projectInfo.lead ? <span>Lead {projectInfo.lead}</span> : null}{projectInfo.targetDate ? <span>· Target {dayShort(projectInfo.targetDate)}</span> : null}<span>· {inProgress} in progress</span></div>
            <ProgressBar done={done} total={projIssues.length} />
          </>
        ) : (
          <div style={{ ...row, fontSize: 12, ...muted }}>{team ? <TeamChip k={team} /> : null}<span>{issues.length} {issues.length === 1 ? "issue" : "issues"}</span>{savedNote ? <span>· {savedNote}</span> : null}</div>
        )}
        {switcher}
        {creator}
        <div style={{ display: "flex", flexDirection: "column", pointerEvents: saving ? "none" : "auto", opacity: saving ? 0.7 : 1 }}>
          {emptyNote}
          {groups.map(([key, items], gi) => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: gi === 0 ? 2 : 10 }}>
              {gb ? <GroupHeader lead={leadFor(items[0])} label={key} count={items.length} /> : null}
              {items.map(row_)}
            </div>
          ))}
        </div>
      </div>
      <SaveBar count={changes.length} saving={false} savingText="Saving to Linear…" onDiscard={() => setCur(saved)} onSave={save} note={writeNote(w, { saving: "Saving to Linear…" })} />
    </section>
  );
}

/* ---------- the connector's UI entry ---------- */
function LinearUi({ ctx, note }: { ctx: UiCtx; note?: string }) {
  switch (ctx.details?.kind) {
    case "issue": return <IssueCard ctx={ctx} note={note} />;
    case "draft": return <NewIssueCard ctx={ctx} />;
    default: return <ComposedView ctx={ctx} note={note} />;
  }
}

export const linearUi: ConnectorUi = { id: "linear", label: "Linear", component: LinearUi, runningText: (k) => (k === "apply" ? "Saving to Linear…" : "Reading Linear…") };
