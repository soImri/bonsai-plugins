/**
 * __LABEL__'s compositions for the chat. Draw what index.ts puts in `ctx.details`; mimic the app's
 * own screens (see SCREENS.md), never a form of fields. Edits batch behind Save.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorCard, LongText, MoreChip, OpenExternal, Placeholder, SaveBar, bare, card, footer, hoverable, muted, pad, useFollowUps, v, type ConnectorUi, type UiCtx } from "../../ui/kit.tsx";

type Rec = { ref: string; title: string; subtitle?: string; body?: string; url?: string; fields: { [k: string]: string | number | boolean | null } };

const saveLine = (ref: string, changes: string[]) => `Save __ID__ ${ref}: ${changes.join("; ")}`;
const createMessage = (title: string, props: string[], body: string) => `Create __ID__: ${title}\n${props.join("; ")}${body.trim() ? `\n\nBody:\n${body.trim()}` : ""}`;

function RecordCard({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const rec: Rec | undefined = ctx.details?.record;
  // TODO: editable fields. This skeleton edits only the title.
  const seed = useMemo(() => rec?.title ?? "", [rec]);
  const [title, setTitle] = useState(seed);
  const [saving, setSaving] = useState(false);
  useEffect(() => setTitle(seed), [seed]);
  // The follow-ups Jev picked: the primary surface shows always; a control shows when `fu.has(id)`; More reveals the rest.
  const fu = useFollowUps(ctx.details?.followUps ?? ctx.details?.composition?.followUps, rec);
  if (!rec) return <Placeholder text="No record data." />;
  const changes = title !== rec.title ? [`title → ${title}`] : [];
  async function save() { setSaving(true); await ctx.send(saveLine(rec!.ref, changes)); setSaving(false); }
  return (
    <section style={card}>
      <div style={pad}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ ...muted, fontSize: 12 }}>{rec.ref}</span>
          <span style={{ display: "inline-flex", gap: 6 }}>{fu.gated ? <MoreChip on={fu.more} onClick={fu.toggle} /> : null}{rec.url ? <OpenExternal url={rec.url} title="Open in __LABEL__" onOpen={ctx.openUrl} /> : null}</span>
        </div>
        {fu.has("title") ? <input style={{ ...bare, fontSize: 16, fontWeight: 600 }} value={title} onChange={e => setTitle(e.target.value)} aria-label="Title" /> : <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{rec.title}</h2>}
        {rec.subtitle ? <div style={muted}>{rec.subtitle}</div> : null}
        {rec.body ? <LongText md={rec.body} /> : null}
      </div>
      <SaveBar count={changes.length} saving={saving} savingText="Saving to __LABEL__…" onDiscard={() => setTitle(rec.title)} onSave={save} note={note} />
    </section>
  );
}

function ListCard({ ctx }: { ctx: UiCtx }) {
  const records: Rec[] = Array.isArray(ctx.details?.records) ? ctx.details.records : [];
  if (!records.length) return <ErrorCard message="No records match." />;
  if (ctx.details?.composition?.view === "record" && records.length === 1) return <RecordCard ctx={{ ...ctx, details: { ...ctx.details, record: records[0] } }} />;
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 2 }}>
        <div style={{ ...muted, fontSize: 12, marginBottom: 6 }}>{records.length} records</div>
        {records.map(r => (
          <button key={r.ref} type="button" onClick={() => { void ctx.send(`Show __ID__ ${r.ref}`); }} {...hoverable} style={{ ...bare, display: "flex", alignItems: "center", gap: 10, padding: "5px 8px", borderRadius: 8, cursor: "pointer", textAlign: "left" }}>
            <span style={{ ...muted, fontSize: 12, width: 80, flexShrink: 0 }}>{r.ref}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
            {r.subtitle ? <span style={{ ...muted, fontSize: 12 }}>{r.subtitle}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function DraftCard({ ctx }: { ctx: UiCtx }) {
  const draft = ctx.details?.draft ?? {};
  const [title, setTitle] = useState<string>(draft.title ?? "");
  const [body, setBody] = useState<string>(draft.body ?? "");
  const [sent, setSent] = useState(false);
  const touched = useRef(false);
  useEffect(() => { if (!touched.current) { setTitle(draft.title ?? ""); setBody(draft.body ?? ""); } }, [draft]);
  async function create() { setSent(true); await ctx.send(createMessage(title.trim(), [], body)); }
  return (
    <section style={card}>
      <div style={{ ...pad, paddingBottom: 12 }}>
        <input style={{ ...bare, fontSize: 16, fontWeight: 600 }} value={title} onChange={e => { touched.current = true; setTitle(e.target.value); }} placeholder="Title" aria-label="Title" disabled={sent} />
        <textarea style={{ ...bare, lineHeight: "22px" }} rows={3} value={body} onChange={e => { touched.current = true; setBody(e.target.value); }} placeholder="Add details…" aria-label="Body" disabled={sent} />
      </div>
      <div style={footer}>
        <span style={{ ...muted, fontSize: 12 }}>{sent ? "Creating in __LABEL__…" : ""}</span>
        <Button variant="primary" size="sm" disabled={sent || !title.trim()} onClick={create}>{sent ? "Creating…" : "Create"}</Button>
      </div>
    </section>
  );
}

function Ui({ ctx, note }: { ctx: UiCtx; note?: string }) {
  switch (ctx.details?.kind) {
    case "record": return <RecordCard ctx={ctx} note={note} />;
    case "draft": return <DraftCard ctx={ctx} />;
    default: return <ListCard ctx={ctx} />;
  }
}

export const __ID__Ui: ConnectorUi = { id: "__ID__", label: "__LABEL__", component: Ui, runningText: (k) => (k === "apply" ? "Saving to __LABEL__…" : "Reading __LABEL__…") };
void v;
