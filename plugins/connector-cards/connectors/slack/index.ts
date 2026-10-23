/**
 * The Slack connector: conversations as Slack's own UI.
 *
 *   view    words → a channel's recent messages, a thread, or the inbox (recent activity across the
 *           workspace, optionally mentions or DMs only), in a Jev-picked range
 *   record  "#channel", "@person" or "<channelId>/<ts>" → that conversation or thread
 *   draft   words (+ text) → Slack's composer, with the conversation Jev picks
 *   apply   the card's Send / Reply / React → written, card redrawn from Slack's truth
 *
 * Reads and writes use Slack's Web API with Bonsai's Slack sign-in. Channel history is limited to
 * one read per minute per workspace, so channel views fall back to search when the minute is used.
 */
import { HttpError, defineConnector, classify, ms, type Run, type CardResult, remembered } from "../../runtime.ts";
import { SlackError, findChannel, postMessage, react, readChannel, readInbox, readMeta, readThread, type Channel, type Message, type Meta } from "./api.ts";
import { RANGE_DAYS, RANGE_LABEL, draftRubric, viewRubric, type Composition, type Picks } from "./rubrics.ts";
import { inboxChips, inboxFollowUps } from "./rubrics.ts";
import { parseCardMessage } from "./write.ts";

const CHANNEL_REF = /(?:^|\s)#[a-z0-9][\w.'-]{1,}/i;
const THREAD_REF = /\b[A-Z][A-Z0-9]{6,}\/\d{10}\.\d{6}\b/;
const DM_REF = /(?:^|\s)@[a-z0-9][\w.'-]+/i;

const channelInfo = (c: Channel) => ({ id: c.id, name: c.name, kind: c.kind, ...(c.topic ? { topic: c.topic } : {}), ...(c.members !== undefined ? { members: c.members } : {}) });
const conversationsFor = (meta: Meta) => meta.channels.filter((c) => c.isMember !== false).map(channelInfo);
const dateAfter = (days: number) => new Date(Date.now() - Math.max(days, 0) * 864e5 - (days === 0 ? 0 : 0)).toISOString().slice(0, 10);

function resolve(meta: Meta, text: string): { channel?: Channel; ts?: string } {
  const thread = text.match(THREAD_REF)?.[0];
  if (thread) { const [id, ts] = thread.split("/"); const c = meta.channels.find((x) => x.id === id); if (c) return { channel: c, ts }; }
  const ch = text.match(CHANNEL_REF)?.[0]?.trim();
  if (ch) { const c = findChannel(meta, ch); if (c) return { channel: c }; }
  const dm = text.match(DM_REF)?.[0]?.trim();
  if (dm) { const c = findChannel(meta, dm); if (c?.kind === "dm") return { channel: c }; }
  return {};
}

export const slack = defineConnector({
  id: "slack",
  label: "Slack",
  summary: "channels, threads, DMs and mentions in the person's Slack workspace, and posting to them",
  aliases: ["slack workspace", "channels", "dms"],
  auth: { serviceId: "slack.account", schemeId: "slack.oauth" },
  triggers: {
    keywords: ["slack", "channel", "channels", "thread", "threads", "dm", "dms", "direct message", "mention", "mentions", "mentioned", "pinged", "post", "message", "messages", "what did i miss", "catch me up", "unread", "unreads", "reply", "react"],
    refPattern: /(?:^|\s)#[a-z][\w.'-]{2,}|\b[A-Z][A-Z0-9]{6,}\/\d{10}\.\d{6}\b/i,
    messagePattern: /^(Post in|Reply in|React to)\s+\S+/,
  },
  examples: {
    view: ["what's new in #neat-build", "catch me up on Slack", "anything for me on Slack", "my DMs", "what did I miss this week"],
    record: ["show #neat-build", "open the thread C0C6QSB2ULR/1783350000.000100", "my DM with Seb"],
    draft: ["post in #neat-build that the eval set is ready", "message Seb on Slack: …", "tell the team in #all-neat …"],
    apply: ["Post in #neat-build:\\n…", "Reply in #neat-build 1783350000.000100:\\n…", "React to #neat-build 1783350000.000100: :thumbsup:"],
  },
  filters: { channel: "a channel name or @person for a DM", days: "how many days back (number)" },
  explain: (err) => {
    if (err instanceof SlackError) {
      if (err.code === "ratelimited") return `${err.message} Slack allows this app one channel-history read per minute; the card falls back to search when it can.`;
      if (err.code === "missing_scope" || err.code === "not_allowed_token_type") return `Slack refused (${err.code}): Bonsai's Slack sign-in lacks a scope this needs. Reconnect Slack in App Store → Installed → Slack → Connections.`;
      if (err.code === "invalid_auth" || err.code === "token_revoked" || err.status === 401) return "Slack rejected Bonsai's sign-in. Reconnect Slack in App Store → Installed → Slack → Connections.";
      if (err.code === "not_in_channel") return "You are not a member of that channel, so Slack will not show or post to it.";
      return err.message;
    }
    return err instanceof HttpError ? err.message : undefined;
  },

  async view({ token, params, signal, startedAt, jev, cache, history, followUps, recall }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const task: string = params.task ?? "";
    const f = params.filters ?? {};
    const refText = [f.channel, ...(params.refs ?? []), task].filter(Boolean).join(" ");
    const { channel, ts } = resolve(meta, refText);
    const view: Composition["view"] = ts ? "thread" : channel ? "channel" : "inbox";
    // The card filters range, focus and threads itself, so the read is a two-week superset (replies included).
    let messages: Message[] = [];
    let via = "search";
    if (view === "thread" && channel && ts) { messages = await readThread(token, meta, channel, ts, signal); via = "replies"; }
    else if (view === "channel" && channel) { const r = await readChannel(token, meta, channel, 14, signal); messages = r.messages; via = r.via; }
    else messages = await readInbox(token, meta, 14, params.query, signal);
    const tSlack = ms(startedAt);
    const rubric = viewRubric(task, view, messages, channel);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const [{ value, took: tJev }, fu] = await Promise.all([
      remembered(recall, () => jev({ purpose: "slack-view" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, () => rubric.guess)),
      followUps("slack-follow-ups", { task, shape: view }, view === "inbox" ? inboxFollowUps(task) : []),
    ]);
    const comp = value as Composition;
    comp.followUps = fu.actions;
    if (view === "inbox") Object.assign(comp, inboxChips(comp, fu.actions));
    if (typeof f.days === "string" && /^\d+$/.test(f.days)) comp.range = (Object.entries(RANGE_DAYS).find(([, d]) => d >= Number(f.days))?.[0] as any) ?? "2_weeks";
    // What the initial filter shows, for the agent's one line and for the pick log; the card recomputes the same.
    const cutoff = Date.now() - (RANGE_DAYS[comp.range] + (comp.range === "today" ? 1 : 0)) * 864e5;
    const dmIds = new Set(meta.channels.filter((c) => c.kind === "dm").map((c) => c.id));
    const shown = messages.filter((m) => view !== "inbox" || (new Date(m.time).getTime() >= cutoff && (comp.focus === "all" || (comp.focus === "mentions" ? m.mentionsMe : dmIds.has(m.channel)))));
    const payload = { kind: "view", task, me: meta.me, view, ...(channel ? { channel: channelInfo(channel) } : {}), ...(ts ? { threadTs: ts } : {}), messages, conversations: conversationsFor(meta), composition: comp, via, timing: { slack: tSlack, jev: tJev } };
    const picked = `${view}, ${comp.range}, ${comp.focus}`;
    const label = view === "thread" ? "thread" : view === "channel" ? `#${channel!.name}` : `inbox (${RANGE_LABEL[comp.range]}${comp.focus !== "all" ? `, ${comp.focus}` : ""})`;
    if (!messages.length) return { summary: `No messages for ${label}; the card says so. Reply with nothing.`, payload, picked, offered: fu.actions, remember: comp };
    return { summary: `Card shown (${shown.length} messages, ${label}). Reply with nothing: the card is the whole answer, and the person navigates inside it.`, payload, picked, offered: fu.actions, remember: comp };
  },

  async record({ token, params, signal, startedAt, cache }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const ref = String(params.ref ?? "").trim();
    const { channel, ts } = resolve(meta, ref) ;
    const c = channel ?? findChannel(meta, ref);
    if (!c) throw new Error(`No Slack conversation matches "${ref}". Channels you can name: ${meta.channels.filter((x) => x.kind !== "dm").slice(0, 12).map((x) => `#${x.name}`).join(", ")}.`);
    if (ts) {
      const messages = await readThread(token, meta, c, ts, signal);
      return { summary: `Card shown (thread in #${c.name}). Reply with nothing.`, payload: { kind: "view", view: "thread", me: meta.me, channel: channelInfo(c), threadTs: ts, messages, conversations: conversationsFor(meta), composition: { view: "thread", range: "2_weeks", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" }, via: "replies", ...(params.draft ? { draft: params.draft } : {}), timing: { slack: ms(startedAt) } } };
    }
    const r = await readChannel(token, meta, c, 14, signal);
    return { summary: `Card shown (#${c.name}). Reply with nothing.`, picked: "channel", payload: { kind: "view", view: "channel", me: meta.me, channel: channelInfo(c), messages: r.messages, conversations: conversationsFor(meta), composition: { view: "channel", range: "2_weeks", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" }, via: r.via, ...(params.draft ? { draft: params.draft } : {}), timing: { slack: ms(startedAt) } } };
  },

  async draft({ token, params, signal, startedAt, jev, cache, history }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const task: string = params.task ?? "";
    const text: string = (params.body ?? params.title ?? "").trim() || task.replace(/^(please\s+)?(post|say|tell|write|message|dm|ping|send)\s+(in|to|on)?\s*[#@]?[\w.'-]*\s*(on slack)?\s*(that|:)?\s*/i, "").trim();
    const candidates = meta.channels.filter((c) => c.isMember !== false && c.kind !== "group");
    const named = resolve(meta, [params.fields?.channel, params.filters?.channel, task].filter(Boolean).join(" ")).channel;
    const rubric = draftRubric(task, text, named ? [named, ...candidates.filter((c) => c.id !== named.id)] : candidates);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const { value: picks, took: tJev } = named
      ? { value: { channel: named.id, by: "fallback" as const } as Picks, took: "0 ms" }
      : await jev({ purpose: "slack-draft" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, rubric.guess) as { value: Picks; took: string };
    const channel = meta.channels.find((c) => c.id === picks.channel) ?? candidates[0];
    return {
      summary: `Composer shown. Reply with nothing and stop; do not describe the draft or tell the person what to press. When a message starting 'Post in #…:' arrives, call cards_apply with it verbatim in \`message\`.`,
      payload: { kind: "draft", draft: { channel: channel ? channelInfo(channel) : undefined, text }, conversations: conversationsFor(meta), picks: { by: picks.by, confidence: picks.confidence }, timing: { slack: ms(startedAt), jev: tJev } },
      picked: channel ? `${channel.kind === "dm" ? "DM " : "#"}${channel.name}` : "no channel",
    };
  },

  async apply({ token, params, signal, startedAt, cache }: Run): Promise<CardResult> {
    const meta = await readMeta(token, cache, signal);
    const parsed = typeof params.message === "string" ? parseCardMessage(params.message) : {};
    const p = params.payload ?? {};
    const post = p.post ?? parsed.post;
    const reply = p.reply ?? parsed.reply;
    const reaction = p.reaction ?? parsed.reaction;
    if (!post && !reply && !reaction) throw new Error("Nothing to apply: the message did not parse as a Slack card command and no payload was passed.");
    const target = findChannel(meta, (post ?? reply ?? reaction)!.channel);
    if (!target) throw new Error(`No Slack conversation matches "${(post ?? reply ?? reaction)!.channel}".`);
    const applied: string[] = [];
    let threadTs: string | undefined;
    if (post) { const r = await postMessage(token, target.id, post.text, undefined, signal); applied.push(`posted in ${target.kind === "dm" ? `DM with ${target.name}` : `#${target.name}`} (${r.ts})`); }
    if (reply) { await postMessage(token, target.id, reply.text, reply.ts, signal); applied.push(`replied in #${target.name}`); threadTs = reply.ts; }
    if (reaction) { await react(token, target.id, reaction.ts, reaction.emoji, signal); applied.push(`reacted :${reaction.emoji}:`); threadTs = reaction.ts; }
    const tWrite = ms(startedAt);
    const used = [...(post ? ["compose"] : []), ...(reply ? ["reply"] : []), ...(reaction ? ["react"] : [])];
    // Redraw from Slack's truth: the thread when we touched one, else the channel (history budget permitting, search otherwise).
    let messages: Message[]; let via: string; let view: Composition["view"];
    if (threadTs && !post) { messages = await readThread(token, meta, target, threadTs, signal); via = "replies"; view = "thread"; }
    else { const r = await readChannel(token, meta, target, 14, signal); messages = r.messages; via = r.via; view = "channel"; }
    return {
      summary: `Sent to Slack: ${applied.join("; ")}. The card shows the result; reply with nothing.`, used,
      payload: { kind: "view", view, me: meta.me, channel: channelInfo(target), ...(threadTs && !post ? { threadTs } : {}), messages, conversations: conversationsFor(meta), composition: { view, range: "2_weeks", focus: "all", fields: { reactions: true, threads: true }, by: "fallback" }, via, applied, timing: { slack: tWrite } },
    };
  },
});
