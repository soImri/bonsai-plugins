/**
 * Slack's compositions for the chat: ChannelView (a channel or thread, with Slack's message
 * list and composer), ActivityView (recent activity grouped by conversation, mentions and DMs
 * filters), and Composer (Slack's message box with a conversation picker).
 *
 * What a card sends is a short command in plain words; `write.ts` parses it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorCard, OpenExternal, Picker, Placeholder, bare, card, footer, hoverable, muted, pad, row, useFollowUps, useWrite, v, type ConnectorUi, type UiCtx } from "../../ui/kit.tsx";

type Conv = { id: string; name: string; kind: "channel" | "private" | "dm" | "group"; topic?: string; members?: number; avatar?: string };
type Reaction = { name: string; count: number; mine: boolean };
type Att = { title?: string; link?: string; text?: string; pretext?: string; color?: string; footer?: string; author?: string; fields?: { title?: string; value: string }[]; image?: string };
type Msg = { ref: string; channel: string; channelName: string; ts: string; threadTs?: string; time: string; userId?: string; user: string; initials: string; avatar?: string; bot?: boolean; text: string; attachments?: Att[]; reactions: Reaction[]; replyCount: number; permalink?: string; mentionsMe: boolean; edited?: boolean; files?: { name: string; title?: string }[] };
type Focus = "needs_me" | "mentions" | "threads" | "dms" | "all";
type Composition = { view: "activity" | "channel" | "thread"; focus: Focus; fields: { reactions: boolean; threads: boolean }; by: "jev" | "fallback" | "memory"; followUps?: string[] };

const EMOJI: Record<string, string> = { thumbsup: "👍", "+1": "👍", white_check_mark: "✅", eyes: "👀", heart: "❤️", tada: "🎉", raised_hands: "🙌", pray: "🙏", fire: "🔥", rocket: "🚀", joy: "😂", smile: "😄", thinking_face: "🤔", clap: "👏", wave: "👋", 100: "💯", ok_hand: "👌", point_up: "☝️" };
const QUICK = ["white_check_mark", "thumbsup", "eyes", "tada"];
const emoji = (name: string) => EMOJI[name] ?? `:${name}:`;
const convLabel = (c?: Conv) => (c ? (c.kind === "dm" ? c.name : `#${c.name}`) : "");
const target = (c: Conv) => (c.kind === "dm" ? `@${c.name}` : `#${c.name}`);
const initialsOf = (name: string) => name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(x => x[0]?.toUpperCase() ?? "").join("") || "?";
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtWhen = (iso: string) => { const d = new Date(iso); const same = d.toLocaleDateString("en-CA") === new Date().toLocaleDateString("en-CA"); return same ? fmtTime(iso) : `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ${fmtTime(iso)}`; };
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const dayLabel = (iso: string) => { const d = new Date(iso); const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1); const k = d.toLocaleDateString("en-CA"); return k === today.toLocaleDateString("en-CA") ? "Today" : k === y.toLocaleDateString("en-CA") ? "Yesterday" : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }); };
const hue = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const Tab = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} style={{ ...bare, width: "auto", padding: "3px 8px", borderRadius: 6, fontSize: 12, fontWeight: on ? 600 : 400, background: on ? v("bg-subtle") : "transparent", color: on ? v("text-primary") : v("text-secondary"), cursor: "pointer" }}>{children}</button>
);
/** Slack's profile picture (a public avatars.slack-edge.com URL); coloured initials until it loads or when it cannot. */
function Face({ src, initials, seed, size = 36 }: { src?: string; initials: string; seed: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size, borderRadius: Math.round(size * 0.22), flexShrink: 0, overflow: "hidden", background: `hsl(${hue(seed)} 45% 55%)`, color: "white", fontSize: Math.round(size * 0.36), fontWeight: 600 };
  if (src && !failed) return <span style={base}><img src={src} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)} style={{ width: size, height: size, objectFit: "cover", display: "block" }} /></span>;
  return <span style={base}>{initials}</span>;
}
const Avatar = ({ m }: { m: Msg }) => <Face src={m.avatar} initials={m.initials} seed={m.userId ?? m.user} />;

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

function MessageRow({ m, ctx, fields, showChannel, replies, compact, convOf }: { m: Msg; ctx: UiCtx; fields: Composition["fields"]; showChannel?: boolean; replies?: Msg[]; compact?: boolean; convOf: (id: string) => Conv | undefined }) {
  const [hover, setHover] = useState(false);
  const [open, setOpen] = useState(false);
  const replyPost = usePost(ctx);
  const conv = convOf(m.channel);
  const tgt = conv ? target(conv) : `#${m.channelName}`;
  // Reactions land in the background: the pill flips at once, the plugin writes it, and only a failure undoes it.
  const [reactions, setReactions] = useState<Reaction[]>(m.reactions);
  const [reactErr, setReactErr] = useState<string | null>(null);
  useEffect(() => { setReactions(m.reactions); setReactErr(null); }, [m]);
  const sendReact = (name: string) => {
    const before = reactions;
    const cur = before.find(r => r.name === name);
    const removing = Boolean(cur?.mine);
    const next = removing
      ? before.map(r => (r.name === name ? { ...r, count: r.count - 1, mine: false } : r)).filter(r => r.count > 0)
      : cur ? before.map(r => (r.name === name ? { ...r, count: r.count + 1, mine: true } : r)) : [...before, { name, count: 1, mine: true }];
    setReactions(next); setReactErr(null);
    const msg = `${removing ? "Unreact to" : "React to"} ${tgt} ${m.ts}: :${name}:`;
    void ctx.apply(msg).then(r => {
      if (r.ok) return;
      if (r.unavailable) { void ctx.send(msg); return; }
      setReactions(before); setReactErr(r.error);
    });
  };
  const allReplies = [...(replies ?? []), ...replyPost.local];
  const count = Math.max(m.replyCount, allReplies.length);
  return (
    <div>
      <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: "flex", gap: 10, padding: compact ? "4px 8px" : "6px 8px", borderRadius: 8, position: "relative", background: hover ? v("interactive-hover") : m.mentionsMe ? "color-mix(in srgb, var(--kay-color-warning) 10%, transparent)" : "transparent" }}>
        <Avatar m={m} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{m.user}</span>
            {m.bot ? <span style={{ fontSize: 9, fontWeight: 700, padding: "0 4px", borderRadius: 3, background: v("bg-subtle"), color: v("text-secondary"), letterSpacing: 0.3 }}>APP</span> : null}
            <span style={{ ...muted, fontSize: 11 }}>{fmtWhen(m.time)}</span>
            {showChannel ? <span style={{ ...muted, fontSize: 11 }}>in {tgt}</span> : null}
            {m.edited ? <span style={{ ...muted, fontSize: 11 }}>(edited)</span> : null}
          </div>
          {m.text ? <Rich text={m.text} /> : null}
          {m.attachments?.map((a, i) => <AttachmentCard key={i} a={a} ctx={ctx} />)}
          {m.files?.length ? <div style={{ ...muted, fontSize: 12 }}>📎 {m.files.map(f => f.title ?? f.name).join(", ")}</div> : null}
          {reactErr ? <div style={{ fontSize: 11, color: v("danger"), marginTop: 2 }}>Reaction failed: {reactErr}</div> : null}
          {(fields.reactions && reactions.length) || (fields.threads && count) ? (
            <div style={{ ...row, marginTop: 4 }}>
              {fields.reactions ? reactions.map(r => <button key={r.name} type="button" onClick={() => sendReact(r.name)} title={`:${r.name}:`} style={{ ...bare, width: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 12, fontSize: 12, border: `1px solid ${r.mine ? v("accent") : v("border")}`, background: r.mine ? "color-mix(in srgb, var(--kay-color-accent) 12%, transparent)" : v("bg-subtle"), cursor: "pointer" }}>{emoji(r.name)} {r.count}</button>) : null}
              {fields.threads && count ? <button type="button" onClick={() => setOpen(o => !o)} style={{ ...bare, width: "auto", fontSize: 12, color: v("accent"), fontWeight: 600, cursor: "pointer" }}>{open ? "Hide thread" : `${count} ${count === 1 ? "reply" : "replies"} ›`}</button> : null}
            </div>
          ) : null}
        </div>
        {hover ? (
          <div style={{ position: "absolute", top: -10, right: 8, display: "inline-flex", gap: 2, padding: 2, borderRadius: 6, border: `1px solid ${v("border")}`, background: v("bg-elevated"), boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
            {QUICK.map(q => <button key={q} type="button" onClick={() => sendReact(q)} title={`React :${q}:`} {...hoverable} style={{ ...bare, width: 26, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 14 }}>{emoji(q)}</button>)}
            <button type="button" onClick={() => setOpen(true)} title="Reply in thread" {...hoverable} style={{ ...bare, width: "auto", height: 24, padding: "0 6px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Reply</button>
            {m.permalink ? <OpenExternal url={m.permalink} title="Open in Slack" onOpen={ctx.openUrl} /> : null}
          </div>
        ) : null}
      </div>
      {open ? (
        <div style={{ margin: "0 0 8px 44px", borderLeft: `2px solid ${v("border")}`, paddingLeft: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {allReplies.map(r => <MessageRow key={r.ts} m={r} ctx={ctx} fields={{ reactions: fields.reactions, threads: false }} compact convOf={convOf} />)}
          {count > allReplies.length ? <div style={{ ...muted, fontSize: 12, padding: "2px 8px" }}>{count - allReplies.length} older {count - allReplies.length === 1 ? "reply is" : "replies are"} in Slack.</div> : null}
          {replyPost.failed ? <div style={{ fontSize: 12, color: v("danger"), padding: "0 8px" }}>Reply failed: {replyPost.failed}</div> : null}
          <ComposeBox placeholder="Reply…" sendLabel="Reply" onSend={async text => { await replyPost.post(`Reply in ${tgt} ${m.ts}:\n${text}`, mineNow(ctx.details, m.channel, m.channelName, text, m.ts)); }} />
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

/* ---------- a message of mine, drawn before the plugin has posted it ---------- */
let localSeq = 0;
function mineNow(d: any, channel: string, channelName: string, text: string, threadTs?: string): Msg {
  const me = d?.meProfile ?? { name: "you", initials: "?" };
  const now = new Date();
  const ts = `${Math.floor(now.getTime() / 1000)}.local${String(localSeq++).padStart(4, "0")}`;
  return { ref: `${channel}/${ts}`, channel, channelName, ts, ...(threadTs ? { threadTs } : {}), time: now.toISOString(), userId: d?.me, user: me.name, initials: me.initials, ...(me.avatar ? { avatar: me.avatar } : {}), text, reactions: [], replyCount: 0, mentionsMe: false };
}
/** Writes that append a message: the row appears at once, the plugin posts in the background, a failure removes it and shows why. */
function usePost(ctx: UiCtx) {
  const w = useWrite(ctx);
  const [local, setLocal] = useState<Msg[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => { setLocal([]); setFailed(null); }, [ctx.details]);
  const [failedRow, setFailedRow] = useState<Msg | null>(null);
  const post = async (message: string, row: Msg) => {
    setLocal(l => [...l, row]); setFailed(null); setFailedRow(null);
    const ok = await w.run(message, { revert: () => { setLocal(l => l.filter(x => x.ts !== row.ts)); setFailedRow(row); } });
    if (!ok) setFailed("could not send");
  };
  const failedIn = (channel: string) => (w.status === "failed" && failedRow?.channel === channel ? (w.error ?? failed ?? "could not send") : null);
  return { local, failed: w.status === "failed" ? (w.error ?? failed ?? "could not send") : null, failedIn, post, status: w.status };
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
  const channelPost = usePost(ctx);
  const all: Msg[] = [...(Array.isArray(d.messages) ? d.messages : []), ...channelPost.local];
  const comp: Composition = d.composition ?? { view: "channel", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" };
  const isThread = d.view === "thread" && d.threadTs;
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
            <div style={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>{!isThread && ch.kind === "dm" ? <Face src={ch.avatar} initials={initialsOf(ch.name)} seed={ch.id} size={22} /> : null}{isThread ? "Thread" : convLabel(ch)}{isThread ? <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}> · {convLabel(ch)}</span> : null}{ch.kind === "private" ? <span style={{ ...muted, fontSize: 12 }}> 🔒</span> : null}</div>
            {!isThread && (ch.topic || ch.members) ? <div style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[ch.members ? `${ch.members} members` : null, ch.topic].filter(Boolean).join(" · ")}</div> : null}
          </div>
          <span style={{ ...muted, fontSize: 12, flexShrink: 0 }}>{caption}</span>
        </div>
        {!parents.length ? <div style={{ ...muted, padding: "8px" }}>No messages in the last two weeks.</div> : null}
        {[...days.entries()].map(([k, items]) => (
          <div key={k}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}><span style={{ flex: 1, height: 1, background: v("border") }} /><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12, border: `1px solid ${v("border")}` }}>{dayLabel(items[0].time)}</span><span style={{ flex: 1, height: 1, background: v("border") }} /></div>
            {items.map((m, i) => <MessageRow key={m.ts} m={m} ctx={ctx} fields={isThread ? { ...comp.fields, threads: false } : comp.fields} replies={repliesOf.get(m.ts)} compact={isThread && i > 0} convOf={convOf} />)}
          </div>
        ))}
        {channelPost.failed ? <div style={{ fontSize: 12, color: v("danger"), padding: "0 8px" }}>Send failed: {channelPost.failed}</div> : null}
        <ComposeBox placeholder={isThread ? "Reply…" : `Message ${convLabel(ch)}`} draft={d.draft} sendLabel={isThread ? "Reply" : "Send"} onSend={async text => { await channelPost.post(isThread ? `Reply in ${tgt} ${d.threadTs}:\n${text}` : `Post in ${tgt}:\n${text}`, mineNow(d, ch.id, ch.name, text, isThread ? d.threadTs : undefined)); }} />
      </div>
    </section>
  );
}

/* ---------- ActivityView: Slack's Activity: what involves the person (mentions, threads they are in, DMs), newest first; reply and react in place ---------- */
type Section = { id: "mentions" | "threads" | "dms" | "all"; title: string; groups: { key: string; conv?: Conv; label: string; parent?: Msg; items: Msg[]; replies: Msg[]; threadTs?: string }[] };
function ActivityView({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const convs: Conv[] = Array.isArray(d.conversations) ? d.conversations : [];
  const me: string = d.me ?? "";
  const convOf = (id: string) => convs.find(c => c.id === id);
  const comp: Composition = d.composition ?? { view: "activity", focus: "needs_me", fields: { reactions: true, threads: true }, by: "fallback" };
  const fu = useFollowUps(comp.followUps);
  const [posting, setPosting] = useState(false);
  const dmPost = usePost(ctx);
  const all: Msg[] = [...(Array.isArray(d.messages) ? d.messages : []), ...dmPost.local];
  useEffect(() => { setPosting(false); }, [d]);
  const mine = (m: Msg) => Boolean(me) && m.userId === me;
  const isDm = (m: Msg) => convOf(m.channel)?.kind === "dm";
  const byTs = new Map(all.map(m => [`${m.channel}/${m.ts}`, m]));
  const parentOf = (m: Msg) => (m.threadTs ? byTs.get(`${m.channel}/${m.threadTs}`) : undefined);
  const repliesOf = (channel: string, ts: string) => all.filter(x => x.channel === channel && x.threadTs === ts).sort((p, q) => p.ts.localeCompare(q.ts));
  const latest = (ms: Msg[]) => ms.reduce((t, m) => (m.time > t ? m.time : t), "");
  const caption = note ?? "";

  // Threads the person is in: started, replied in, or mentioned in.
  const threadKeys = new Set<string>();
  for (const m of all) { if (mine(m) || m.mentionsMe) { const k = m.threadTs ? `${m.channel}/${m.threadTs}` : m.replyCount > 0 ? `${m.channel}/${m.ts}` : ""; if (k) threadKeys.add(k); } }
  const threadGroups = [...threadKeys].map(k => { const [channel, ts] = k.split("/"); const parent = byTs.get(k); const replies = repliesOf(channel, ts); const c = convOf(channel); return { key: k, conv: c, label: c ? convLabel(c) : `#${(parent ?? replies[0])?.channelName ?? ""}`, parent, items: parent ? [parent] : replies.slice(0, 1), replies: parent ? replies : replies.slice(1), threadTs: ts }; })
    .filter(g => g.parent || g.replies.length).sort((p, q) => latest([...q.items, ...q.replies]).localeCompare(latest([...p.items, ...p.replies])));
  // Mentions of the person by others, outside threads they are already in (those show as threads).
  const mentionMsgs = all.filter(m => m.mentionsMe && !mine(m) && !isDm(m) && !threadKeys.has(`${m.channel}/${m.threadTs ?? m.ts}`)).sort((p, q) => q.time.localeCompare(p.time));
  const mentionGroups = mentionMsgs.map(m => { const c = convOf(m.channel); const p = parentOf(m); return { key: `m/${m.channel}/${m.ts}`, conv: c, label: c ? convLabel(c) : `#${m.channelName}`, parent: p, items: [m], replies: m.threadTs ? [] : repliesOf(m.channel, m.ts), threadTs: m.threadTs ?? (m.replyCount ? m.ts : undefined) }; });
  // DMs, one group per person, newest first.
  const dmMap = new Map<string, Msg[]>();
  for (const m of all) if (isDm(m)) dmMap.set(m.channel, [...(dmMap.get(m.channel) ?? []), m]);
  const dmGroups = [...dmMap.entries()].map(([id, items]) => { const c = convOf(id)!; const sorted = items.sort((p, q) => p.ts.localeCompare(q.ts)); return { key: `dm/${id}`, conv: c, label: convLabel(c), items: sorted.slice(-3), replies: [], threadTs: undefined }; }).sort((p, q) => latest(q.items).localeCompare(latest(p.items)));
  // Everything, by channel (a broad scan or a topic search).
  const chMap = new Map<string, Msg[]>();
  for (const m of all) if (!isDm(m) && !m.threadTs) chMap.set(m.channel, [...(chMap.get(m.channel) ?? []), m]);
  const allGroups = [...chMap.entries()].map(([id, items]) => { const c = convOf(id); const sorted = items.sort((p, q) => p.ts.localeCompare(q.ts)); return { key: `c/${id}`, conv: c, label: c ? convLabel(c) : `#${items[0].channelName}`, items: sorted.slice(-4), replies: [], threadTs: undefined }; }).sort((p, q) => latest(q.items).localeCompare(latest(p.items)));

  const sections: Section[] = (comp.focus === "all" ? [{ id: "all", title: d.task && d.query ? `Results for “${d.query}”` : "Recent", groups: allGroups }]
    : [
      ...(comp.focus === "needs_me" || comp.focus === "mentions" ? [{ id: "mentions" as const, title: "Mentions", groups: mentionGroups }] : []),
      ...(comp.focus === "needs_me" || comp.focus === "threads" ? [{ id: "threads" as const, title: "Threads", groups: threadGroups }] : []),
      ...(comp.focus === "needs_me" || comp.focus === "dms" ? [{ id: "dms" as const, title: "Direct messages", groups: dmGroups }] : []),
    ]).filter(sec => comp.focus === "needs_me" ? sec.groups.length > 0 : true);
  const total = sections.reduce((n, sec) => n + sec.groups.length, 0);
  const title = comp.focus === "mentions" ? "Mentions" : comp.focus === "threads" ? "Threads" : comp.focus === "dms" ? "Direct messages" : comp.focus === "all" ? "Slack" : "Activity";
  const summary = comp.focus === "needs_me" ? [mentionGroups.length ? `${mentionGroups.length} mention${mentionGroups.length === 1 ? "" : "s"}` : "", threadGroups.length ? `${threadGroups.length} thread${threadGroups.length === 1 ? "" : "s"}` : "", dmGroups.length ? `${dmGroups.length} DM${dmGroups.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ") : `${total}`;
  const empty = comp.focus === "needs_me" ? "Nothing needs you: no mentions, no threads of yours with replies, no DMs in the last two weeks." : comp.focus === "mentions" ? "No one mentioned you in the last two weeks." : comp.focus === "threads" ? "No threads of yours with activity in the last two weeks." : comp.focus === "dms" ? "No direct messages in the last two weeks." : "Nothing in the last two weeks.";
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title} <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>{summary}</span></span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ ...muted, fontSize: 12 }}>{caption}</span>
            {fu.picked("post") ? <Button variant={posting ? "secondary" : "primary"} size="sm" onClick={() => setPosting(p => !p)}>{posting ? "Cancel" : "New message"}</Button> : null}
          </span>
        </div>
        {posting ? <InlineComposer ctx={ctx} convs={convs} onDone={() => setPosting(false)} /> : null}
        {!total ? <div style={{ ...muted, padding: 8 }}>{empty}</div> : null}
        {sections.map(sec => (
          <div key={sec.id}>
            {sections.length > 1 ? <div style={{ ...muted, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", padding: "8px 8px 2px" }}>{sec.title}</div> : null}
            {sec.groups.map(g => {
              const tgt = g.conv ? target(g.conv) : `#${(g.items[0] ?? g.replies[0])?.channelName ?? ""}`;
              const head = g.items[0];
              return (
                <div key={g.key} style={{ borderTop: `1px solid ${v("border")}`, padding: "6px 0 2px" }}>
                  <div style={{ ...muted, fontSize: 12, fontWeight: 600, padding: "0 8px 2px", display: "flex", alignItems: "center", gap: 6 }}>{sec.id === "dms" && g.conv ? <Face src={g.conv.avatar} initials={initialsOf(g.conv.name)} seed={g.conv.id} size={18} /> : null}{g.label}{g.threadTs && head && !head.threadTs ? <span style={{ fontWeight: 400 }}> · thread</span> : null}</div>
                  {g.parent && head && head.threadTs ? <MessageRow m={g.parent} ctx={ctx} fields={{ ...comp.fields, threads: false }} compact convOf={convOf} /> : null}
                  {g.items.map(m => <MessageRow key={m.ts} m={m} ctx={ctx} fields={comp.fields} replies={g.threadTs && !m.threadTs ? g.replies : undefined} compact convOf={convOf} />)}
                  {sec.id === "dms" && g.conv ? <div style={{ padding: "2px 8px 4px" }}>{dmPost.failedIn(g.conv.id) ? <div style={{ fontSize: 12, color: v("danger"), paddingBottom: 4 }}>Send failed: {dmPost.failedIn(g.conv.id)}</div> : null}<ComposeBox placeholder={`Message ${convLabel(g.conv)}`} onSend={async text => { await dmPost.post(`Post in ${tgt}:\n${text}`, mineNow(d, g.conv!.id, g.conv!.name, text)); }} /></div> : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

/** The composer with a conversation picker, inline inside another card (the activity card's "New message"). */
function InlineComposer({ ctx, convs, onDone }: { ctx: UiCtx; convs: Conv[]; onDone: () => void }) {
  const [conv, setConv] = useState<Conv | undefined>(convs[0]);
  const [sent, setSent] = useState<{ to: string; text: string } | null>(null);
  const w = useWrite(ctx);
  if (!convs.length) return null;
  if (sent) return <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, background: v("bg-subtle"), fontSize: 13 }}><span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><span style={muted}>{w.status === "failed" ? `Failed to send to ${sent.to}: ${w.error}` : w.status === "saving" ? `Sending to ${sent.to}…` : `Sent to ${sent.to}`}</span>{w.status === "failed" ? "" : ` · ${sent.text}`}</span>{w.status === "failed" ? <Button variant="secondary" size="sm" onClick={() => setSent(null)}>Edit</Button> : null}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 8px 8px", borderRadius: 8, border: `1px solid ${v("border")}`, background: v("bg-subtle") }}>
      <div style={{ ...row, fontSize: 13 }}>
        <span style={muted}>To</span>
        <Picker items={convs} value={conv} onPick={c => setConv(c)} label="Conversation" lead={c => c?.kind === "dm" ? <Face src={c.avatar} initials={initialsOf(c.name)} seed={c.id} size={16} /> : <span style={{ fontSize: 12 }}>#</span>} keyOf={c => c.id} labelOf={c => convLabel(c)} />
      </div>
      <ComposeBox placeholder={`Message ${convLabel(conv)}`} onSend={async text => { if (!conv) return; setSent({ to: convLabel(conv), text }); void w.run(`Post in ${target(conv)}:\n${text}`, { keepSaved: true }); void onDone; }} />
    </div>
  );
}

/* ---------- Composer: Slack's message box with a conversation picker ---------- */
function Composer({ ctx }: { ctx: UiCtx }) {
  const d = ctx.details ?? {};
  const convs: Conv[] = Array.isArray(d.conversations) ? d.conversations : [];
  const seed = useMemo(() => ({ conv: convs.find(c => c.id === d.draft?.channel?.id) ?? convs[0], text: d.draft?.text ?? "" }), [d]);
  const [conv, setConv] = useState<Conv | undefined>(seed.conv);
  const [sent, setSent] = useState<string | null>(null);
  const w = useWrite(ctx);
  useEffect(() => { setConv(seed.conv); setSent(null); }, [seed]);
  if (!convs.length) return <Placeholder text="No conversations to post in." />;
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 8 }}>
        <div style={{ ...row, fontSize: 13 }}>
          <span style={muted}>To</span>
          <Picker items={convs} value={conv} onPick={c => setConv(c)} label="Conversation" lead={c => <span style={{ fontSize: 12 }}>{c?.kind === "dm" ? "@" : "#"}</span>} keyOf={c => c.id} labelOf={c => convLabel(c)} emphasis />
          {conv?.topic ? <span style={{ ...muted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{conv.topic}</span> : null}
        </div>
        {sent ? <div style={{ display: "flex", gap: 10, padding: "4px 0" }}><Face src={d.meProfile?.avatar} initials={d.meProfile?.initials ?? "?"} seed={d.me ?? "me"} /><div><div style={{ fontWeight: 700, fontSize: 14 }}>{d.meProfile?.name ?? "you"} <span style={{ ...muted, fontSize: 11 }}>{fmtTime(new Date().toISOString())}</span></div><div style={{ whiteSpace: "pre-wrap" }}>{sent}</div></div></div>
          : <ComposeBox placeholder={`Message ${convLabel(conv)}`} draft={seed.text} onSend={async text => { if (!conv) return; setSent(text); void w.run(`Post in ${target(conv)}:\n${text}`, { keepSaved: true, revert: () => setSent(null) }); }} />}
      </div>
      {sent || w.status !== "idle" ? <div style={{ ...footer, ...muted, fontSize: 12, ...(w.status === "failed" ? { color: v("danger") } : {}) }}>{w.status === "failed" ? `Failed: ${w.error}` : w.status === "saving" ? `Sending to ${convLabel(conv)}…` : `Sent to ${convLabel(conv)}`}</div> : null}
    </section>
  );
}

function SlackUi({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  if (d.kind === "draft") return <Composer ctx={ctx} />;
  if (d.error) return <ErrorCard message={d.error} />;
  if (d.view === "activity" || d.view === "inbox") return <ActivityView ctx={ctx} note={note} />;
  return <ChannelView ctx={ctx} note={note} />;
}

export const slackUi: ConnectorUi = { id: "slack", label: "Slack", component: SlackUi, runningText: (k) => (k === "apply" ? "Sending to Slack…" : "Reading Slack…") };
