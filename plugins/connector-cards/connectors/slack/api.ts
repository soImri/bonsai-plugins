/**
 * Slack over its Web API with Bonsai's Slack sign-in (a user token), normalised to the card's shapes.
 *
 * Slack holds this app to ONE conversations.history / conversations.replies read per minute per
 * workspace, so channel reads go to history when the minute is free and fall back to search
 * (`in:#channel`, a separate budget) otherwise. Channels and people are cached for 10 minutes.
 */
import { HttpError, type DiskCache } from "../../runtime.ts";

const BASE = "https://slack.com/api";
const META_TTL_MS = 10 * 60 * 1000;
const HISTORY_WINDOW_MS = 60_000;

export type Channel = { id: string; name: string; kind: "channel" | "private" | "dm" | "group"; topic?: string; members?: number; userId?: string; isMember?: boolean };
export type Person = { id: string; name: string; display: string; initials: string; title?: string; bot?: boolean };
export type Reaction = { name: string; count: number; mine: boolean };
export type Message = {
  ref: string; channel: string; channelName: string; ts: string; threadTs?: string; time: string;
  userId?: string; user: string; initials: string; text: string; raw: string;
  reactions: Reaction[]; replyCount: number; permalink?: string; mentionsMe: boolean; edited?: boolean; files?: { name: string; title?: string }[];
};
export type Meta = { at: number; me: string; people: Record<string, Person>; channels: Channel[] };

export class SlackError extends HttpError { constructor(status: number, readonly code: string, message: string, readonly retryAfterMs?: number) { super(status, message); } }

export async function slack<T = any>(token: string, method: string, args: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null) body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const res = await fetch(`${BASE}/${method}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/x-www-form-urlencoded" }, body, ...(signal ? { signal } : {}) });
  if (res.status === 429) { const ra = Number(res.headers.get("retry-after") ?? "60"); throw new SlackError(429, "ratelimited", `Slack is rate-limiting ${method}; try again in ${ra}s.`, ra * 1000); }
  const txt = await res.text();
  if (!res.ok) throw new SlackError(res.status, "http", `Slack answered ${res.status} to ${method}: ${txt.slice(0, 160)}`);
  const json = JSON.parse(txt);
  if (!json.ok) throw new SlackError(200, String(json.error ?? "unknown"), `Slack ${method}: ${json.error ?? "unknown error"}`);
  return json as T;
}

/* ---------- people and channels (cached) ---------- */
let metaMem: Meta | undefined;

export const initialsOf = (name: string) => name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";

export async function readMeta(token: string, cache: DiskCache, signal?: AbortSignal): Promise<Meta> {
  if (metaMem && Date.now() - metaMem.at < META_TTL_MS) return metaMem;
  const disk = metaMem ?? (await cache.read<Meta>("meta"));
  if (disk) { metaMem = disk; if (Date.now() - disk.at >= META_TTL_MS) void fetchMeta(token, cache).catch(() => undefined); return disk; }
  return fetchMeta(token, cache, signal);
}
async function fetchMeta(token: string, cache: DiskCache, signal?: AbortSignal): Promise<Meta> {
  const [auth, users, convs] = await Promise.all([
    slack(token, "auth.test", {}, signal),
    slack(token, "users.list", { limit: 500 }, signal),
    slack(token, "conversations.list", { types: "public_channel,private_channel,mpim,im", exclude_archived: true, limit: 500 }, signal),
  ]);
  const people: Record<string, Person> = {};
  for (const u of users.members ?? []) {
    if (u.deleted) continue;
    const display = u.profile?.display_name || u.profile?.real_name || u.real_name || u.name;
    people[u.id] = { id: u.id, name: u.name, display, initials: initialsOf(display), ...(u.profile?.title ? { title: u.profile.title } : {}), ...(u.is_bot ? { bot: true } : {}) };
  }
  const byName = (n: string) => Object.values(people).find((p) => p.name === n)?.display ?? n;
  const channels: Channel[] = (convs.channels ?? []).map((c: any): Channel => {
    if (c.is_im) { const p = people[c.user]; return { id: c.id, name: p?.display ?? c.user, kind: "dm", userId: c.user, isMember: true }; }
    if (c.is_mpim) return { id: c.id, name: String(c.name ?? "").replace(/^mpdm-/, "").replace(/-\d+$/, "").split("--").map(byName).join(", "), kind: "group", isMember: true };
    return { id: c.id, name: c.name, kind: c.is_private ? "private" : "channel", ...(c.topic?.value ? { topic: c.topic.value } : {}), ...(typeof c.num_members === "number" ? { members: c.num_members } : {}), isMember: Boolean(c.is_member) };
  });
  const meta: Meta = { at: Date.now(), me: auth.user_id, people, channels };
  metaMem = meta;
  void cache.write("meta", meta);
  return meta;
}

export function findChannel(meta: Meta, ref: string): Channel | undefined {
  const r = ref.trim().replace(/^[#@]/, "").toLowerCase();
  return meta.channels.find((c) => c.id === ref.trim())
    ?? meta.channels.find((c) => c.kind !== "dm" && c.name.toLowerCase() === r)
    ?? meta.channels.find((c) => c.kind === "dm" && (c.name.toLowerCase() === r || meta.people[c.userId ?? ""]?.name.toLowerCase() === r))
    ?? meta.channels.find((c) => c.name.toLowerCase().includes(r));
}

/* ---------- messages ---------- */
/** Slack mrkdwn → plain text with names: <@U1> → @name, <#C1|x> → #x, <url|label> → label, &amp; etc. */
export function plainText(raw: string, people: Record<string, Person>, channels: Channel[]): string {
  return String(raw ?? "")
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id) => `@${people[id]?.display ?? id}`)
    .replace(/<#([A-Z0-9]+)\|?([^>]*)>/g, (_, id, name) => `#${name || channels.find((c) => c.id === id)?.name || id}`)
    .replace(/<!(channel|here|everyone)>/g, "@$1")
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<(https?:\/\/[^>]+)>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export function normalizeMessage(m: any, channel: Channel, meta: Meta): Message {
  const person = meta.people[m.user] ?? (m.username ? { id: m.user ?? "", name: m.username, display: m.username, initials: initialsOf(m.username) } : undefined);
  const user = person?.display ?? (m.bot_profile?.name ?? "Unknown");
  const raw: string = m.text ?? "";
  return {
    ref: `${channel.id}/${m.ts}`, channel: channel.id, channelName: channel.name, ts: m.ts, ...(m.thread_ts && m.thread_ts !== m.ts ? { threadTs: m.thread_ts } : {}),
    time: new Date(Number(m.ts) * 1000).toISOString(),
    ...(m.user ? { userId: m.user } : {}), user, initials: person?.initials ?? initialsOf(user),
    text: plainText(raw, meta.people, meta.channels), raw,
    reactions: (m.reactions ?? []).map((r: any) => ({ name: r.name, count: r.count, mine: (r.users ?? []).includes(meta.me) })),
    replyCount: m.reply_count ?? 0, ...(m.permalink ? { permalink: m.permalink } : {}),
    mentionsMe: raw.includes(`<@${meta.me}>`) || /<!(channel|here|everyone)>/.test(raw), ...(m.edited ? { edited: true } : {}),
    ...(Array.isArray(m.files) && m.files.length ? { files: m.files.map((f: any) => ({ name: f.name, ...(f.title ? { title: f.title } : {}) })) } : {}),
  };
}

/* ---------- the one-per-minute history budget, tracked per method in this process ---------- */
const lastRead: Record<string, number> = {};
const budgetFree = (method: string) => Date.now() - (lastRead[method] ?? 0) >= HISTORY_WINDOW_MS;

/** Recent messages in one channel: history when the minute is free, else search `in:#name`. */
export async function readChannel(token: string, meta: Meta, channel: Channel, limit: number, signal?: AbortSignal): Promise<{ messages: Message[]; via: "history" | "search" }> {
  if (budgetFree("conversations.history")) {
    try {
      lastRead["conversations.history"] = Date.now();
      const r = await slack(token, "conversations.history", { channel: channel.id, limit }, signal);
      return { messages: (r.messages ?? []).filter((m: any) => !m.subtype || m.subtype === "thread_broadcast" || m.subtype === "bot_message").map((m: any) => normalizeMessage(m, channel, meta)).reverse(), via: "history" };
    } catch (err) { if (!(err instanceof SlackError && err.code === "ratelimited")) throw err; }
  }
  const q = channel.kind === "dm" ? `with:@${meta.people[channel.userId ?? ""]?.name ?? ""}` : `in:#${channel.name}`;
  const r = await slack(token, "search.messages", { query: q, sort: "timestamp", sort_dir: "desc", count: limit }, signal);
  return { messages: (r.messages?.matches ?? []).map((m: any) => normalizeMessage(m, channel, meta)).reverse(), via: "search" };
}

export async function readThread(token: string, meta: Meta, channel: Channel, ts: string, signal?: AbortSignal): Promise<Message[]> {
  lastRead["conversations.replies"] = Date.now();
  const r = await slack(token, "conversations.replies", { channel: channel.id, ts, limit: 100 }, signal);
  return (r.messages ?? []).map((m: any) => normalizeMessage(m, channel, meta));
}

/** Recent activity across the workspace via search (its own budget): a date window, optionally mentions or DMs only. */
export async function readInbox(token: string, meta: Meta, opts: { after: string; mentionsOnly?: boolean; dmsOnly?: boolean; query?: string; limit?: number }, signal?: AbortSignal): Promise<Message[]> {
  const parts = [opts.query ?? "", `after:${opts.after}`];
  if (opts.mentionsOnly) parts.push(`<@${meta.me}>`);
  if (opts.dmsOnly) parts.push("is:dm");
  const r = await slack(token, "search.messages", { query: parts.filter(Boolean).join(" "), sort: "timestamp", sort_dir: "desc", count: opts.limit ?? 50 }, signal);
  return (r.messages?.matches ?? []).map((m: any) => {
    const ch: Channel = meta.channels.find((c) => c.id === m.channel?.id) ?? { id: m.channel?.id ?? "?", name: m.channel?.name ?? "?", kind: m.channel?.is_im ? "dm" : "channel" };
    return normalizeMessage(m, ch, meta);
  });
}

/* ---------- writes ---------- */
export async function postMessage(token: string, channelId: string, text: string, threadTs?: string, signal?: AbortSignal): Promise<{ ts: string }> {
  const r = await slack(token, "chat.postMessage", { channel: channelId, text, ...(threadTs ? { thread_ts: threadTs } : {}) }, signal);
  return { ts: r.ts };
}
export async function react(token: string, channelId: string, ts: string, name: string, signal?: AbortSignal): Promise<void> {
  try { await slack(token, "reactions.add", { channel: channelId, timestamp: ts, name: name.replace(/:/g, "") }, signal); }
  catch (err) { if (!(err instanceof SlackError && err.code === "already_reacted")) throw err; }
}
