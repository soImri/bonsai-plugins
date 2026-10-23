/**
 * Slack's compositions for the chat: ChannelView (a channel or thread, with Slack's message
 * list and composer), InboxView (recent activity grouped by conversation, mentions and DMs
 * filters), and Composer (Slack's message box with a conversation picker).
 *
 * What a card sends is a short command in plain words; `write.ts` parses it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, ErrorCard, OpenExternal, Picker, Placeholder, bare, card, footer, hoverable, muted, pad, row, v, type ConnectorUi, type UiCtx } from "../../ui/kit.tsx";

type Conv = { id: string; name: string; kind: "channel" | "private" | "dm" | "group"; topic?: string; members?: number };
type Reaction = { name: string; count: number; mine: boolean };
type Msg = { ref: string; channel: string; channelName: string; ts: string; threadTs?: string; time: string; userId?: string; user: string; initials: string; text: string; reactions: Reaction[]; replyCount: number; permalink?: string; mentionsMe: boolean; edited?: boolean; files?: { name: string; title?: string }[] };
type Composition = { view: "inbox" | "channel" | "thread"; range: string; focus: "all" | "mentions" | "dms"; fields: { reactions: boolean; threads: boolean }; by: "jev" | "fallback" };

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

function MessageRow({ m, ctx, fields, showChannel, onThread, compact }: { m: Msg; ctx: UiCtx; fields: Composition["fields"]; showChannel?: boolean; onThread?: (m: Msg) => void; compact?: boolean }) {
  const [hover, setHover] = useState(false);
  const sendReact = (name: string) => { void ctx.send(`React to ${m.channelName.startsWith("#") ? m.channelName : (ctx.details?.conversations ?? []).find((c: Conv) => c.id === m.channel)?.kind === "dm" ? `@${m.channelName}` : `#${m.channelName}`} ${m.ts}: :${name}:`); };
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: "flex", gap: 10, padding: compact ? "4px 8px" : "6px 8px", borderRadius: 8, position: "relative", background: hover ? v("interactive-hover") : m.mentionsMe ? "color-mix(in srgb, var(--kay-color-warning) 10%, transparent)" : "transparent" }}>
      <Avatar m={m} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{m.user}</span>
          <span style={{ ...muted, fontSize: 11 }}>{fmtTime(m.time)}</span>
          {showChannel ? <span style={{ ...muted, fontSize: 11 }}>in #{m.channelName}</span> : null}
          {m.edited ? <span style={{ ...muted, fontSize: 11 }}>(edited)</span> : null}
        </div>
        <Rich text={m.text} />
        {m.files?.length ? <div style={{ ...muted, fontSize: 12 }}>📎 {m.files.map(f => f.title ?? f.name).join(", ")}</div> : null}
        {(fields.reactions && m.reactions.length) || fields.threads && m.replyCount ? (
          <div style={{ ...row, marginTop: 4 }}>
            {fields.reactions ? m.reactions.map(r => <button key={r.name} type="button" onClick={() => sendReact(r.name)} title={`:${r.name}:`} style={{ ...bare, width: "auto", display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px", borderRadius: 12, fontSize: 12, border: `1px solid ${r.mine ? v("accent") : v("border")}`, background: r.mine ? "color-mix(in srgb, var(--kay-color-accent) 12%, transparent)" : v("bg-subtle"), cursor: "pointer" }}>{emoji(r.name)} {r.count}</button>) : null}
            {fields.threads && m.replyCount && onThread ? <button type="button" onClick={() => onThread(m)} style={{ ...bare, width: "auto", fontSize: 12, color: v("accent"), fontWeight: 600, cursor: "pointer" }}>{m.replyCount} {m.replyCount === 1 ? "reply" : "replies"} ›</button> : null}
          </div>
        ) : null}
      </div>
      {hover ? (
        <div style={{ position: "absolute", top: -10, right: 8, display: "inline-flex", gap: 2, padding: 2, borderRadius: 6, border: `1px solid ${v("border")}`, background: v("bg-elevated"), boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
          {QUICK.map(q => <button key={q} type="button" onClick={() => sendReact(q)} title={`React :${q}:`} {...hoverable} style={{ ...bare, width: 26, height: 24, borderRadius: 4, cursor: "pointer", fontSize: 14 }}>{emoji(q)}</button>)}
          {onThread ? <button type="button" onClick={() => onThread(m)} title="Reply in thread" {...hoverable} style={{ ...bare, width: "auto", height: 24, padding: "0 6px", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Reply</button> : null}
          {m.permalink ? <OpenExternal url={m.permalink} title="Open in Slack" onOpen={ctx.openUrl} /> : null}
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

/* ---------- ChannelView: a channel or a thread, Slack-style ---------- */
function ChannelView({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const ch: Conv | undefined = d.channel;
  const messages: Msg[] = Array.isArray(d.messages) ? d.messages : [];
  const comp: Composition = d.composition ?? { view: "channel", range: "2_weeks", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" };
  const isThread = d.view === "thread" && d.threadTs;
  const openThread = (m: Msg) => { void ctx.send(`Show thread ${m.channel}/${m.threadTs ?? m.ts}`); };
  if (!ch) return <Placeholder text="No conversation data." />;
  const days = new Map<string, Msg[]>();
  for (const m of messages) { const k = dayKey(m.time); days.set(k, [...(days.get(k) ?? []), m]); }
  const caption = note ?? (d.applied ? `Sent · ${d.applied.join(" · ")}` : d.via === "search" ? "via search (Slack's history limit is one read per minute)" : "");
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
        {!messages.length ? <div style={{ ...muted, padding: "8px" }}>No messages yet.</div> : null}
        {[...days.entries()].map(([k, items]) => (
          <div key={k}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "6px 0" }}><span style={{ flex: 1, height: 1, background: v("border") }} /><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 10px", borderRadius: 12, border: `1px solid ${v("border")}` }}>{dayLabel(items[0].time)}</span><span style={{ flex: 1, height: 1, background: v("border") }} /></div>
            {items.map((m, i) => <MessageRow key={m.ts} m={m} ctx={ctx} fields={comp.fields} onThread={isThread ? undefined : openThread} compact={isThread && i > 0} />)}
          </div>
        ))}
        <ComposeBox placeholder={isThread ? "Reply…" : `Message ${convLabel(ch)}`} draft={d.draft} sendLabel={isThread ? "Reply" : "Send"} onSend={async text => { await ctx.send(isThread ? `Reply in ${tgt} ${d.threadTs}:\n${text}` : `Post in ${tgt}:\n${text}`); }} />
      </div>
    </section>
  );
}

/* ---------- InboxView: recent activity across conversations ---------- */
function InboxView({ ctx, note }: { ctx: UiCtx; note?: string }) {
  const d = ctx.details ?? {};
  const all: Msg[] = Array.isArray(d.messages) ? d.messages : [];
  const convs: Conv[] = Array.isArray(d.conversations) ? d.conversations : [];
  const comp: Composition = d.composition ?? { view: "inbox", range: "3_days", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" };
  const [focus, setFocus] = useState<Composition["focus"]>(comp.focus);
  const [openConv, setOpenConv] = useState<string | null>(null);
  useEffect(() => { setFocus(comp.focus); setOpenConv(null); }, [d]);
  const kindOf = (id: string) => convs.find(c => c.id === id)?.kind;
  const loadedFocus = comp.focus;
  const canFilter = (f: Composition["focus"]) => f === loadedFocus || loadedFocus === "all";
  const pick = (f: Composition["focus"]) => { if (canFilter(f)) setFocus(f); else void ctx.send(f === "mentions" ? "Where was I mentioned on Slack?" : f === "dms" ? "Show my Slack DMs" : "Catch me up on Slack"); };
  const msgs = all.filter(m => focus === "all" ? true : focus === "mentions" ? m.mentionsMe : kindOf(m.channel) === "dm");
  const byConv = new Map<string, Msg[]>();
  for (const m of msgs) byConv.set(m.channel, [...(byConv.get(m.channel) ?? []), m]);
  const groups = [...byConv.entries()].sort((a, b) => b[1][b[1].length - 1].time.localeCompare(a[1][a[1].length - 1].time));
  const caption = note ?? `${RANGE_LABEL[comp.range] ?? comp.range}${comp.by === "jev" ? " · picked by Jev" : ""}`;
  const openThread = (m: Msg) => { void ctx.send(`Show thread ${m.channel}/${m.threadTs ?? m.ts}`); };
  return (
    <section style={card}>
      <div style={{ ...pad, gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{focus === "mentions" ? "Mentions" : focus === "dms" ? "Direct messages" : "Activity"} <span style={{ ...muted, fontWeight: 400, fontSize: 12 }}>{msgs.length} messages</span></span>
          <span style={{ ...muted, fontSize: 12 }}>{caption}</span>
        </div>
        <div style={{ display: "flex", gap: 2 }}>
          {(["all", "mentions", "dms"] as const).map(f => <Tab key={f} on={focus === f} onClick={() => pick(f)}>{f === "all" ? "All" : f === "mentions" ? "Mentions" : "DMs"}</Tab>)}
          <span style={{ flex: 1 }} />
          {(["today", "week"] as const).filter(r => r !== comp.range).map(r => <Tab key={r} on={false} onClick={() => { void ctx.send(r === "today" ? "What's new on Slack today?" : "What did I miss on Slack this week?"); }}>{RANGE_LABEL[r]}</Tab>)}
        </div>
        {!groups.length ? <div style={{ ...muted, padding: 8 }}>Nothing here for {(RANGE_LABEL[comp.range] ?? comp.range).toLowerCase()}.</div> : null}
        {groups.map(([id, items]) => {
          const c = convs.find(x => x.id === id);
          const open = openConv === id;
          const shown = open ? items : items.slice(-2);
          return (
            <div key={id} style={{ borderTop: `1px solid ${v("border")}`, paddingTop: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 4px" }}>
                <button type="button" onClick={() => setOpenConv(o => (o === id ? null : id))} style={{ ...bare, width: "auto", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>{c ? convLabel(c) : `#${items[0].channelName}`} <span style={{ ...muted, fontWeight: 400 }}>{items.length}</span>{items.some(m => m.mentionsMe) ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "white", background: v("danger"), borderRadius: 8, padding: "1px 6px" }}>@</span> : null}</button>
                <button type="button" onClick={() => { void ctx.send(`Show ${c ? target(c) : `#${items[0].channelName}`}`); }} style={{ ...bare, width: "auto", fontSize: 12, color: v("accent"), cursor: "pointer" }}>Open ›</button>
              </div>
              {shown.map(m => <MessageRow key={m.ts} m={m} ctx={ctx} fields={comp.fields} onThread={openThread} compact />)}
              {!open && items.length > 2 ? <button type="button" onClick={() => setOpenConv(id)} style={{ ...bare, width: "auto", fontSize: 12, ...muted, cursor: "pointer", padding: "2px 8px 6px" }}>{items.length - 2} more…</button> : null}
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
      {sent ? <div style={{ ...footer, ...muted, fontSize: 12 }}>Sending to Slack…</div> : d.picks ? <div style={{ ...footer, ...muted, fontSize: 12 }}>{d.picks.by === "jev" ? "Conversation picked by Jev" : "Conversation from the ask"}</div> : null}
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
