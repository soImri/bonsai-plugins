/**
 * Slack's compositions for the chat: ChannelView (a channel or thread, with Slack's message
 * list and composer), InboxView (recent activity grouped by conversation, mentions and DMs
 * filters), and Composer (Slack's message box with a conversation picker).
 *
 * What a card sends is a short command in plain words; `write.ts` parses it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorCard, OpenExternal, Picker, Placeholder, bare, card, footer, hoverable, muted, pad, row, useFollowUps, v, type ConnectorUi, type UiCtx } from "../../ui/kit.tsx";

type Conv = { id: string; name: string; kind: "channel" | "private" | "dm" | "group"; topic?: string; members?: number };
type Reaction = { name: string; count: number; mine: boolean };
type Att = { title?: string; link?: string; text?: string; pretext?: string; color?: string; footer?: string; author?: string; fields?: { title?: string; value: string }[]; image?: string };
type Msg = { ref: string; channel: string; channelName: string; ts: string; threadTs?: string; time: string; userId?: string; user: string; initials: string; bot?: boolean; text: string; attachments?: Att[]; reactions: Reaction[]; replyCount: number; permalink?: string; mentionsMe: boolean; edited?: boolean; files?: { name: string; title?: string }[] };
type Composition = { view: "inbox" | "channel" | "thread"; range: string; focus: "all" | "mentions" | "dms"; fields: { reactions: boolean; threads: boolean }; by: "jev" | "fallback" | "memory"; followUps?: string[] };

const RANGE_LABEL: Record<string, string> = { today: "Today", yesterday: "Yesterday", "3_days": "Last 3 days", week: "This week", "2_weeks": "Last 2 weeks" };
const EMOJI: Record<string, string> = { thumbsup: "👍", "+1": "👍", white_check_mark: "✅", eyes: "👀", heart: "❤️", tada: "🎉", raised_hands: "🙌", pray: "🙏", fire: "🔥", rocket: "🚀", joy: "😂", smile: "😄", thinking_face: "🤔", clap: "👏", wave: "👋", 100: "💯", ok_hand: "👌", point_up: "☝️" };
const QUICK = ["white_check_mark", "thumbsup", "eyes", "tada"];
const emoji = (name: string) => EMOJI[name] ?? `:${name}:`;
const convLabel = (c?: Conv) => (c ? (c.kind === "dm" ? c.name : `#${c.name}`) : "");
const target = (c: Conv) => (c.kind === "dm" ? `@${c.name}` : `#${c.name}`);
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const dayLabel = (iso: string) => { const d = new Date(iso); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1); const k = d.toLocaleDateString("en-CA"); return k === today.toLocaleDateString("en-CA") ? "Today" : k === y.toLocaleDateString("en-CA") ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); };
const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const Tab = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} style={{ ...bare, width: "auto", padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: on ? 600 : 400, background: on ? v("bg-subtle") : "transparent", color: on ? v("text-primary") : v("text-secondary"), cursor: "pointer" }}>{children}</button>
);
const Avatar = ({ m }: { m: Msg }) => <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: `hsl(${hue(m.userId ?? m.user)} 45% 55%)`, color: "white", fontSize: 13, fontWeight: 600 }}>{m.initials}</span>;

/** Slack mrkdwn, lightly: *bold*, _italic_, `code`, ```blocks```, > quotes, line breaks. */
function Rich({ text }: { text: string }) {
  const lines = text.split("\n");
  return <div style={{ lineHeight: "20px", wordBreak: "break-word" }}>{lines.map((line, i) => {
    const quote = line.startsWith("&gt; ") || line.startsWith("> ");
    const body = quote ? line.replace(/^(&gt; |> )/, "") : line;
    const parts = body.split(/(\*[^*]+\*|_[^_]+_|`[^`]+`)/g).map((p, j) => p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <b key={j}>{p.slice(1, -1)}</b> : p.startsWith("_") && p.endsWith("_") && p.length > 2 ? <i key={j}>{p.slice(1, -1)}</i> : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={j} style={{ fontSize: 12, background: v("bg-subtle"), padding: "0 4px", borderRadius: 3 }}>{p.slice(1, -1)}</code> : p);
    return <div key={i} style={quote ? { borderLeft: `3px solid ${v("border")}`, paddingLeft: 8, ...muted } : undefined}>{parts}</div>;
  })}</div>;
}

/** An app attachment or link unfurl, drawn the way Slack draws it: colour bar, linked title, text, fields, footer. */
function AttachmentCard({ a, ctx }: { a: Att; ctx: UiCtx }) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
      <span style={{ width: 4, borderRadius: 2, background: a.color ?? v("border"), flexShrink: 0 }} />
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2, fontSize: 13 }}>
        {a.pretext ? <div style={muted}>{a.pretext}</div> : null}
        {a.author ? <div style={{ ...muted, fontSize: 12 }}>{a.author}</div> : null}
        {a.title ? (a.link ? <button type="button" onClick={() => ctx.openUrl(a.link!)} style={{ ...bare, width: "auto", fontWeight: 700, color: v("accent"), cursor: "pointer", textAlign: "left" }}>{a.title}</button> : <div style={{ fontWeight: 700 }}>{a.title}</div>) : null}
        {a.text ? <Rich text={a.text.length > 280 ? `${a.text.slice(0, 280)}…` : a.text} /> : null}
        {a.fields?.length ? <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", marginTop: 2 }}>{a.fields.map((f, i) => <div key={i}>{f.title ? <div style={{ ...muted, fontSize: 11, fontWeight: 600 }}>{f.title}</div> : null}<div>{f.value}</div></div>)}</div> : null}
        {a.footer ? <div style={{ ...muted, fontSize: 11, marginTop: 2 }}>{a.footer}</div> : null}
      </div>
    </div>
  );
}

function MessageRow({ m, ctx, fields, showChannel, replies, compact, convOf, can }: { m: Msg; ctx: UiCtx; fields: Composition["fields"]; showChannel?: boolean; replies?: Msg[]; compact?: boolean; convOf: (id: string) => Conv | undefined; can: (id: string) => boolean }) {
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const conv = convOf(m.channel);
  const tgt = conv ? target(conv) : `#${m.channelName}`;
  const sendReact = (name: string) => { void ctx.send(`React to ${tgt} ${m.ts}: :${name}:`); };
  const count = Math.max(m.replyCount, replies?.length ?? 0);
  return (
    <div>
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: "flex", gap: 10, padding: compact ? "4px 8px" : "6px 8px", borderRadius: 8, position: "relative", background: hover ? v("interactive-hover") : m.mentionsMe ? "color-mix(in srgb, var(--kay-color-warning) 10%, transparent)" : "transparent" }}>
        <Avatar m={m} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{m.user}</span>
            {m.bot ? <span style={{ fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 3, background: v("bg-subtle"), color: v("text-secondary"), letterSpacing: 0.3 }}>APP</span> : null}
            <span style={{ ...muted, fontSize: 11 }}>{fmtTime(m.time)}</span>
            {showChannel ? <span style={{ ...muted, fontSize: 11 }}>in {tgt}</span> : null}
            {m.edited ? <span style={{ ...muted, fontSize: 11 }}>(edited)</span> : null}
          </div>
          {m.text ? <Rich text={m.text} /> : null}
          {m.attachments?.map((a, i) => <AttachmentCard key={i} a={a} ctx={ctx} />)}
          {m.files?.length ? <div style={{ ...muted, fontSize: 12 }}>📎 {m.files.map(f => f.title ?? f.name).join(", ")}</div> : null}
          {(fields.reactions && m.reactions.length) || (fields.threads && count) ? (
            <div style={{ ...row, marginTop: 4 }}>
              {fields.reactions ? m.reactions.map(r => <button key={r.name} type="button" onClick={can("react") ? () => sendReact(r.name) : undefined} title={`:${r.name}:`} style={{ ...bare, width: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 12, fontSize: 12, border: `1px solid ${r.mine ? v("accent") : v("border")}`, background: r.mine ? "color-mix(in srgb, var(--kay-color-accent) 12%, transparent)" : v("bg-subtle"), cursor: can("react") ? "pointer" : "default" }}>{emoji(r.name)} {r.count}</button>) : null}
              {fields.threads && count ? <button type="button" onClick={() => setOpen(o => !o)} style={{ ...bare, width: "auto", fontSize: 12, color: v("accent"), fontWeight: 600, cursor: "pointer" }}>{open ? "Hide thread" : `${count} ${count === 1 ? "reply" : "replies"} ›`}</button> : null}
            </div>
          ) : null}
        </div>
        {hover && (can("react") || can("reply") || m.permalink) ? (
          <div style={{ position: "absolute", top: -10, right: 8, display: "inline-flex", gap: 2, padding: 2, borderRadius: 6, border: `1px solid ${v("border")}`, background: v("bg-elevated"), boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
            {can("react") ? QUICK.map(q => <button key={q} type="button" onClick={() => sendReact(q)} title={`React :${q}:`} {...hoverable} style={{ ...bare, width: 26, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 14 }}>{emoji(q)}</button>) : null}
            {can("reply") ? <button type="button" onClick={() => setOpen(true)} title="Reply in thread" {...hoverable} style={{ ...bare, width: "auto", height: 24, padding: "0 6px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Reply</button> : null}
            {m.permalink ? <OpenExternal url={m.permalink} title="Open in Slack" onOpen={ctx.openUrl} /> : null}
          </div>
        ) : null}
      </div>
      {open ? (
        <div style={{ margin: "0 0 8px 44px", borderLeft: `2px solid ${v("border")}`, paddingLeft: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {(replies ?? []).map(r => <MessageRow key={r.ts} m={r} ctx={ctx} fields={{ reactions: fields.reactions, threads: false }} compact convOf={convOf} can={can} />)}
          {count > (replies?.length ?? 0) ? <div style={{ ...muted, fontSize: 12, padding: "2px 8px" }}>{count - (replies?.length ?? 0)} older {count - (replies?.length ?? 0) === 1 ? "reply is" : "replies are"} in Slack{m.permalink ? "" : ""}.</div> : null}
          {can("reply") ? <ComposeBox placeholder="Reply…" sendLabel="Reply" onSend={async text => { await ctx.send(`Reply in ${tgt} ${m.ts}:\n${text}`); }} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ComposeBox({ placeholder, draft, onSend, sendLabel = "Send" }: { placeholder: string; draft?: string; onSend: (text: string) => Promise<void>; sendLabel?: string }) {
  const [text, setText] = useState(draft ?? "");
  const [sending, setSending] = useState(false);
  useEffect(() => { if (draft) setText(draft); }, [draft]);
  async function send() { if (!text.trim()) return; setSending(true); await onSend(text.trim()); setSending(false); setText(""); }
  return (
    <div style={{ border: `1px solid ${v("border")}`, borderRadius: 8, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
      <textarea style={{ ...bare, lineHeight: "20px", minHeight: 40 }} rows={2} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} disabled={sending}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        <span style={{ ...muted, fontSize: 11 }}>⌘↩ to send</span>
        <Button variant="primary" size="sm" disabled={sending || !text.trim()} onClick={send}>{sending ? "Sending…" : sendLabel}</Button>
      </div>
    </div>
  );
}

/* ---------- threads from a flat message list ---------- */
function splitThreads(all: Msg[]): { parents: Msg[]; repliesOf: Map<string, Msg[]> } {
  const repliesOf = new Map<string, Msg[]>();
  const parents: Msg[] = [];
  for (const m of all) { if (m.threadTs) repliesOf.set(m.threadTs, [...(repliesOf.get(m.threadTs) ?? []), m]); else parents.push(m); }
  // A reply whose parent is outside the window still deserves a row: promote the earliest as a stand-in.
  for (const [ts, rs] of repliesOf) if (!parents.some(p => p.ts === ts)) { const head = rs[0]; parents.push({ ...head, replyCount: rs.length - 1 }); repliesOf.set(ts, rs.slice(1)); }
  return { parents: parents.sort((a, b) => a.ts.localeCompare(b.ts)), repliesOf };
}

/* ---------- ChannelView: a channel or a thread, Slack-style ---------- */
function ChannelView({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const ch: Conv | undefined = d.channel;
  const convs: Conv[] = Array.isArray(d.conversations) ? d.conversations : [];
  const convOf = (id: string) => convs.find(c => c.id === id);
  const all: Msg[] = Array.isArray(d.messages) ? d.messages : [];
  const comp: Composition = d.composition ?? { view: "channel", range: "2_weeks", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" };
  const isThread = d.view === "thread" && d.threadTs;
  const fu = useFollowUps(comp.followUps);
  if (!ch) return <Placeholder text="No conversation data." />;
  const { parents, repliesOf } = isThread ? { parents: all, repliesOf: new Map<string, Msg[]>() } : splitThreads(all);
  const days = new Map<string, Msg[]>();
  for (const m of parents) { const k = dayKey(m.time); days.set(k, [...(days.get(k) ?? []), m]); }
  const caption = note ?? (d.applied ? `Sent · ${d.applied.join(" · ")}` : "");
  const tgt = target(ch);
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, paddingBottom: 6, borderBottom: `1px solid ${v("border")}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{isThread ? "Thread" : convLabel(ch)}{isThread ? <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}> · {convLabel(ch)}</span> : null}{ch.kind === "private" ? <span style={{ ...muted, fontSize: 12 }}> 🔒</span> : null}</div>
            {!isThread && (ch.topic || ch.members) ? <div style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[ch.members ? `${ch.members} members` : null, ch.topic].filter(Boolean).join(" · ")}</div> : null}
          </div>
          <span style={{ ...muted, fontSize: 12, flexShrink: 0 }}>{caption}</span>
        </div>
        {!parents.length ? <div style={{ ...muted, padding: "8px" }}>No messages in the last two weeks.</div> : null}
        {[...days.entries()].map(([k, items]) => (
          <div key={k}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}><span style={{ flex: 1, height: 1, background: v("border") }} /><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12, border: `1px solid ${v("border")}` }}>{dayLabel(items[0].time)}</span><span style={{ flex: 1, height: 1, background: v("border") }} /></div>
            {items.map((m, i) => <MessageRow key={m.ts} m={m} ctx={ctx} fields={isThread ? { ...comp.fields, threads: false } : comp.fields} replies={repliesOf.get(m.ts)} compact={isThread && i > 0} convOf={convOf} can={fu.has} />)}
          </div>
        ))}
        {fu.has("compose") || d.draft ? <ComposeBox placeholder={isThread ? "Reply…" : `Message ${convLabel(ch)}`} draft={d.draft} sendLabel={isThread ? "Reply" : "Send"} onSend={async text => { await ctx.send(isThread ? `Reply in ${tgt} ${d.threadTs}:\n${text}` : `Post in ${tgt}:\n${text}`); }} /> : null}
      </div>
    </section>
  );
}

/* ---------- InboxView: recent activity across conversations, filtered in the card ---------- */
const RANGE_DAYS: Record<string, number> = { today: 0, yesterday: 1, "3_days": 3, week: 7, "2_weeks": 14 };
function InboxView({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const all: Msg[] = Array.isArray(d.messages) ? d.messages : [];
  const convs: Conv[] = Array.isArray(d.conversations) ? d.conversations : [];
  const convOf = (id: string) => convs.find(c => c.id === id);
  const comp: Composition = d.composition ?? { view: "inbox", range: "3_days", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" };
  const [focus, setFocus] = useState<Composition["focus"]>(comp.focus);
  const [range, setRange] = useState<string>(comp.range);
  const [openConv, setOpenConv] = useState<string | null>(null);
  const fu = useFollowUps(comp.followUps);
  useEffect(() => { setFocus(comp.focus); setRange(comp.range); setOpenConv(null); }, [d]);
  const cutoff = Date.now() - (RANGE_DAYS[range] + (range === "today" ? 1 : 0)) * 864e5;
  const todayKey = new Date().toLocaleDateString("en-CA");
  const inRange = (m: Msg) => range === "today" ? dayKey(m.time) === todayKey : range === "yesterday" ? dayKey(m.time) === new Date(Date.now() - 864e5).toLocaleDateString("en-CA") : new Date(m.time).getTime() >= cutoff;
  const inFocus = (m: Msg) => focus === "all" ? true : focus === "mentions" ? m.mentionsMe : convOf(m.channel)?.kind === "dm";
  const msgs = all.filter(m => inRange(m) && inFocus(m));
  const byConv = new Map<string, Msg[]>();
  for (const m of msgs) byConv.set(m.channel, [...(byConv.get(m.channel) ?? []), m]);
  const groups = [...byConv.entries()].sort((a, b) => b[1][b[1].length - 1].time.localeCompare(a[1][a[1].length - 1].time));
  const caption = note ?? "";
  const title = focus === "mentions" ? "Mentions" : focus === "dms" ? "Direct messages" : "Activity";
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title} <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>{msgs.length} messages</span></span>
          <span style={{ ...muted, fontSize: 12 }}>{caption}</span>
        </div>
        {fu.has("focus") || fu.has("ranges") ? <div style={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "center" }}>
          {fu.has("focus") ? (["all", "mentions", "dms"] as const).map(f => <Tab key={f} on={focus === f} onClick={() => setFocus(f)}>{f === "all" ? "All" : f === "mentions" ? "Mentions" : "DMs"}</Tab>) : null}
          <span style={{ flex: 1 }} />
          {fu.has("ranges") ? (["today", "3_days", "week", "2_weeks"] as const).map(r => <Tab key={r} on={range === r} onClick={() => setRange(r)}>{RANGE_LABEL[r]}</Tab>) : null}
        </div> : null}
        {!groups.length ? <div style={{ ...muted, padding: 8 }}>{focus === "mentions" ? "No mentions" : focus === "dms" ? "No direct messages" : "Nothing"} {(RANGE_LABEL[range] ?? range).toLowerCase()}.</div> : null}
        {groups.map(([id, items]) => {
          const c = convOf(id);
          const open = openConv === id;
          const { parents, repliesOf } = splitThreads(items);
          const shown = open ? parents : parents.slice(-2);
          const tgt = c ? target(c) : `#${items[0].channelName}`;
          return (
            <div key={id} style={{ borderTop: `1px solid ${v("border")}`, paddingTop: 6 }}>
              <button type="button" onClick={() => setOpenConv(o => (o === id ? null : id))} style={{ ...bare, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 4px", cursor: "pointer", textAlign: "left" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{c ? convLabel(c) : `#${items[0].channelName}`} <span style={{ ...muted, fontWeight: 400 }}>{parents.length}</span>{items.some(m => m.mentionsMe) ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "white", background: v("danger"), borderRadius: 8, padding: "1px 6px" }}>@</span> : null}</span>
                <span style={{ ...muted, fontSize: 12 }}>{open ? "Collapse" : parents.length > 2 ? `${parents.length - 2} more ›` : "Open ›"}</span>
              </button>
              {shown.map(m => <MessageRow key={m.ts} m={m} ctx={ctx} fields={comp.fields} replies={repliesOf.get(m.ts)} compact convOf={convOf} can={fu.has} />)}
              {open && fu.has("compose") ? <div style={{ padding: "4px 8px 2px" }}><ComposeBox placeholder={`Message ${c ? convLabel(c) : tgt}`} onSend={async text => { await ctx.send(`Post in ${tgt}:\n${text}`); }} /></div> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Composer: Slack's message box with a conversation picker ---------- */
function Composer({ ctx }: { ctx: UiCtx }) {
  const d = ctx.details ?? {};
  const convs: Conv[] = Array.isArray(d.conversations) ? d.conversations : [];
  const seed = useMemo(() => ({ conv: convs.find(c => c.id === d.draft?.channel?.id) ?? convs[0], text: d.draft?.text ?? "" }), [d]);
  const [conv, setConv] = useState<Conv | undefined>(seed.conv);
  const [sent, setSent] = useState(false);
  useEffect(() => { setConv(seed.conv); setSent(false); }, [seed]);
  if (!convs.length) return <Placeholder text="No conversations to post in." />;
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 8 }}>
        <div style={{ ...row, fontSize: 13 }}>
          <span style={muted}>To</span>
          <Picker items={convs} value={conv} onPick={c => setConv(c)} label="Conversation" lead={c => <span style={{ fontSize: 12 }}>{c?.kind === "dm" ? "@" : "#"}</span>} keyOf={c => c.id} labelOf={c => convLabel(c)} emphasis />
          {conv?.topic ? <span style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.topic}</span> : null}
        </div>
        <ComposeBox placeholder={`Message ${convLabel(conv)}`} draft={seed.text} onSend={async text => { if (!conv) return; setSent(true); await ctx.send(`Post in ${target(conv)}:\n${text}`); }} />
      </div>
      {sent ? <div style={{ ...footer, ...muted, fontSize: 12 }}>Sending to Slack…</div> : null}
    </section>
  );
}

function SlackUi({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  if (d.kind === "draft") return <Composer ctx={ctx} />;
  if (d.error) return <ErrorCard message={d.error} />;
  if (d.view === "inbox") return <InboxView ctx={ctx} note={note} />;
  return <ChannelView ctx={ctx} note={note} />;
}

export const slackUi: ConnectorUi = { id: "slack", label: "Slack", component: SlackUi, runningText: (k) => (k === "apply" ? "Sending to Slack…" : "Reading Slack…") };
