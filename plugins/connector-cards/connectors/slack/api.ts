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
export type Person = { id: string; name: string; display: string; initials: string; title?: string; bot?: boolean; avatar?: string };
export type Reaction = { name: string; count: number; mine: boolean };
/** An app/bot attachment or link unfurl, in Slack's own shape: a colour bar, a title (linked), text, fields, a footer. */
export type Attachment = { title?: string; link?: string; text?: string; pretext?: string; color?: string; footer?: string; author?: string; fields?: { title?: string; value: string }[]; image?: string };
export type Message = {
  ref: string; channel: string; channelName: string; ts: string; threadTs?: string; time: string;
  userId?: string; user: string; initials: string; avatar?: string; bot?: boolean; text: string; raw: string;
  attachments: Attachment[];
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
    const avatar = u.profile?.image_72 ?? u.profile?.image_48 ?? u.profile?.image_32;
    people[u.id] = { id: u.id, name: u.name, display, initials: initialsOf(display), ...(u.profile?.title ? { title: u.profile.title } : {}), ...(u.is_bot ? { bot: true } : {}), ...(avatar ? { avatar } : {}) };
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

/** Block Kit → text: section/context/header text, rich_text runs, with mrkdwn kept for the renderer. */
function blocksText(blocks: any[]): string {
  const out: string[] = [];
  const rich = (els: any[]): string => els.map((e) => e.type === "text" ? (e.style?.bold ? `*${e.text}*` : e.style?.code ? `\`${e.text}\`` : e.text) : e.type === "link" ? (e.text ? `<${e.url}|${e.text}>` : `<${e.url}>`) : e.type === "user" ? `<@${e.user_id}>` : e.type === "channel" ? `<#${e.channel_id}>` : e.type === "emoji" ? `:${e.name}:` : e.type === "broadcast" ? `<!${e.range}>` : "").join("");
  for (const b of blocks ?? []) {
    if (b.type === "section") { if (b.text?.text) out.push(b.text.text); for (const f of b.fields ?? []) if (f.text) out.push(f.text); }
    else if (b.type === "header" && b.text?.text) out.push(`*${b.text.text}*`);
    else if (b.type === "context") out.push((b.elements ?? []).map((e: any) => e.text ?? "").filter(Boolean).join(" "));
    else if (b.type === "rich_text") out.push((b.elements ?? []).map((el: any) => el.type === "rich_text_list" ? (el.elements ?? []).map((li: any) => `• ${rich(li.elements ?? [])}`).join("\n") : el.type === "rich_text_quote" ? `> ${rich(el.elements ?? [])}` : el.type === "rich_text_preformatted" ? `\`\`\`${rich(el.elements ?? [])}\`\`\`` : rich(el.elements ?? [])).join("\n"));
  }
  return out.filter(Boolean).join("\n");
}

function normalizeAttachment(a: any, meta: Meta): Attachment | undefined {
  let text: string = a.text ?? (Array.isArray(a.blocks) ? blocksText(a.blocks) : "");
  let title: string | undefined = a.title;
  let link: string | undefined = a.title_link ?? a.from_url ?? a.original_url;
  // Block Kit attachments (Linear, GitHub…) open with a linked title line rather than a title field.
  if (!title) { const m = text.match(/^\s*<(https?:\/\/[^|>]+)\|([^>]+)>\s*\n?/); if (m) { link ??= m[1]; title = m[2]; text = text.slice(m[0].length); } }
  // Trailing "App | 2 hours ago" lines are Slack's context row, not content.
  text = text.replace(/\n[^\n]{0,40}\|[^\n]{0,40}$/, "").trim();
  const att: Attachment = {
    ...(title ? { title: plainText(title, meta.people, meta.channels) } : {}), ...(link ? { link } : {}),
    ...(text ? { text: plainText(String(text).slice(0, 600), meta.people, meta.channels) } : {}), ...(a.pretext ? { pretext: plainText(a.pretext, meta.people, meta.channels) } : {}),
    ...(a.color ? { color: a.color.startsWith("#") ? a.color : `#${a.color}` } : {}), ...(a.footer ? { footer: plainText(a.footer, meta.people, meta.channels) } : a.service_name ? { footer: a.service_name } : {}),
    ...(a.author_name ? { author: a.author_name } : {}), ...(Array.isArray(a.fields) && a.fields.length ? { fields: a.fields.slice(0, 6).map((f: any) => ({ ...(f.title ? { title: f.title } : {}), value: plainText(String(f.value ?? ""), meta.people, meta.channels) })) } : {}),
    ...(a.image_url ?? a.thumb_url ? { image: a.image_url ?? a.thumb_url } : {}),
  };
  return att.title || att.text || att.pretext || att.fields ? att : undefined;
}

export function normalizeMessage(m: any, channel: Channel, meta: Meta): Message {
  // An app's post (Linear, GitHub…) carries a username but no user id; the app is still a member in users.list, with its icon.
  const byName = (name?: string) => (name ? Object.values(meta.people).find((p) => p.display.toLowerCase() === name.toLowerCase() || p.name.toLowerCase() === name.toLowerCase()) : undefined);
  const person = meta.people[m.user] ?? byName(m.username) ?? byName(m.bot_profile?.name) ?? (m.username ? { id: m.user ?? "", name: m.username, display: m.username, initials: initialsOf(m.username) } : undefined);
  const bot = Boolean(m.subtype === "bot_message" || (m.bot_id && !m.user) || (m.username && !m.user) || person?.bot);
  const attachments = (Array.isArray(m.attachments) ? m.attachments : []).map((a: any) => normalizeAttachment(a, meta)).filter(Boolean) as Attachment[];
  // An app's name comes from its bot profile or username; Linear-style webhook posts carry neither, so the attachment's footer or the link's host stands in.
  const appName = m.bot_profile?.name ?? m.username ?? attachments.find((a) => a.footer)?.footer ?? (attachments.find((a) => a.link)?.link?.match(/^https?:\/\/(?:www\.)?([^./]+)/)?.[1]);
  const user = person?.display ?? (bot ? (appName ? appName[0].toUpperCase() + appName.slice(1) : "App") : "Unknown");
  // Search results carry no thread_ts field; the permalink of a reply has ?thread_ts=<parent>.
  const fromLink = typeof m.permalink === "string" ? m.permalink.match(/[?&]thread_ts=(\d{10}\.\d{6})/)?.[1] : undefined;
  const parent = m.thread_ts ?? fromLink;
  const threadTs = parent && parent !== m.ts ? parent : undefined;
  // Bots put their content in blocks or attachments; the text field is often empty or a fallback line.
  const raw: string = m.text || (Array.isArray(m.blocks) && m.blocks.length ? blocksText(m.blocks) : "") || (attachments.length ? "" : (m.attachments?.[0]?.fallback ?? ""));
  return {
    ref: `${channel.id}/${m.ts}`, channel: channel.id, channelName: channel.name, ts: m.ts, ...(threadTs ? { threadTs } : {}),
    time: new Date(Number(m.ts) * 1000).toISOString(),
    ...(m.user ? { userId: m.user } : {}), user, initials: person?.initials ?? initialsOf(user), ...((person?.avatar ?? m.bot_profile?.icons?.image_72 ?? m.bot_profile?.icons?.image_48 ?? m.icons?.image_72 ?? m.icons?.image_48) ? { avatar: person?.avatar ?? m.bot_profile?.icons?.image_72 ?? m.bot_profile?.icons?.image_48 ?? m.icons?.image_72 ?? m.icons?.image_48 } : {}), ...(bot ? { bot: true } : {}),
    text: plainText(raw, meta.people, meta.channels), raw, attachments,
    reactions: (m.reactions ?? []).map((r: any) => ({ name: r.name, count: r.count, mine: (r.users ?? []).includes(meta.me) })),
    replyCount: m.reply_count ?? 0, ...(m.permalink ? { permalink: m.permalink } : {}),
    mentionsMe: raw.includes(`<@${meta.me}>`) || /<!(channel|here|everyone)>/.test(raw), ...(m.edited ? { edited: true } : {}),
    ...(Array.isArray(m.files) && m.files.length ? { files: m.files.map((f: any) => ({ name: f.name, ...(f.title ? { title: f.title } : {}) })) } : {}),
  };
}

/* ---------- the one-per-minute history budget, tracked per method in this process ---------- */
const lastRead: Record<string, number> = {};
const budgetFree = (method: string) => Date.now() - (lastRead[method] ?? 0) >= HISTORY_WINDOW_MS;
const dedupe = (ms: Message[]) => { const seen = new Set<string>(); return ms.filter((m) => (seen.has(m.ref) ? false : (seen.add(m.ref), true))).sort((a, b) => a.ts.localeCompare(b.ts)); };
const afterDate = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

async function searchMessages(token: string, meta: Meta, query: string, limit: number, signal?: AbortSignal): Promise<Message[]> {
  const r = await slack(token, "search.messages", { query, sort: "timestamp", sort_dir: "desc", count: Math.min(limit, 100) }, signal);
  return (r.messages?.matches ?? []).map((m: any) => {
    const ch: Channel = meta.channels.find((c) => c.id === m.channel?.id) ?? { id: m.channel?.id ?? "?", name: m.channel?.name ?? "?", kind: m.channel?.is_im ? "dm" : m.channel?.is_mpim ? "group" : m.channel?.is_private ? "private" : "channel" };
    return normalizeMessage(m, ch, meta);
  });
}

/**
 * A channel's last two weeks, replies included: search `in:#name` (its own budget, returns thread
 * replies too) merged with one history read when the minute is free (exact recent ordering, every
 * subtype). The card then opens threads and pages days without another call.
 */
export async function readChannel(token: string, meta: Meta, channel: Channel, days: number, signal?: AbortSignal): Promise<{ messages: Message[]; via: string }> {
  const q = channel.kind === "dm" ? `with:@${meta.people[channel.userId ?? ""]?.name ?? ""} after:${afterDate(days)}` : `in:#${channel.name} after:${afterDate(days)}`;
  const [searched, recent] = await Promise.all([
    searchMessages(token, meta, q, 100, signal).catch((err) => { if (err instanceof SlackError && err.code === "ratelimited") return [] as Message[]; throw err; }),
    budgetFree("conversations.history") ? (async () => { lastRead["conversations.history"] = Date.now(); try { const r = await slack(token, "conversations.history", { channel: channel.id, limit: 50 }, signal); return (r.messages ?? []).filter((m: any) => !m.subtype || m.subtype === "thread_broadcast" || m.subtype === "bot_message").map((m: any) => normalizeMessage(m, channel, meta)); } catch (err) { if (err instanceof SlackError && err.code === "ratelimited") return []; throw err; } })() : Promise.resolve([] as Message[]),
  ]);
  return { messages: dedupe([...searched, ...recent]), via: recent.length ? "history+search" : "search" };
}

/** One thread in full (spends the replies minute). */
export async function readThread(token: string, meta: Meta, channel: Channel, ts: string, signal?: AbortSignal): Promise<Message[]> {
  lastRead["conversations.replies"] = Date.now();
  const r = await slack(token, "conversations.replies", { channel: channel.id, ts, limit: 100 }, signal);
  return (r.messages ?? []).map((m: any) => normalizeMessage(m, channel, meta));
}

/** Everything the person can see from the last `days` days, replies included; the card filters by focus and range itself. */
export async function readInbox(token: string, meta: Meta, days: number, query: string | undefined, signal?: AbortSignal): Promise<Message[]> {
  return dedupe(await searchMessages(token, meta, `${query ?? ""} after:${afterDate(days)}`.trim(), 100, signal));
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
