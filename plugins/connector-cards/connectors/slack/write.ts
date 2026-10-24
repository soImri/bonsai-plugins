/**
 * Slack card messages. A card speaks a short human grammar in the chat; the plugin parses it, the
 * agent passes it on verbatim. Keep these shapes and ui.tsx's senders in step.
 *
 *   Post in #neat-build:
 *   <text…>
 *   Reply in #neat-build 1783350000.000100:
 *   <text…>
 *   React to #neat-build 1783350000.000100: :thumbsup:
 *   Unreact to #neat-build 1783350000.000100: :thumbsup:
 *
 * A DM target is written `@name`. The `<ts>` is Slack's message timestamp, as the cards carry it.
 */
export type Post = { channel: string; text: string };
export type Reply = { channel: string; ts: string; text: string };
export type ReactionReq = { channel: string; ts: string; emoji: string; remove?: boolean };
export type CardRequest = { post?: Post; reply?: Reply; reaction?: ReactionReq };

const TS = /\d{10}\.\d{6}/;

export function parseCardMessage(message: string): CardRequest {
  const text = message.replace(/\r/g, "").trim();
  const react = text.match(/^(React|Unreact) to\s+([#@][\w.'-]+|[A-Z][A-Z0-9]{6,})\s+(\d{10}\.\d{6}):\s*:?([a-z0-9_+-]+):?\s*$/i);
  if (react) return { reaction: { channel: react[2], ts: react[3], emoji: react[4].toLowerCase(), ...(react[1].toLowerCase() === "unreact" ? { remove: true } : {}) } };
  const reply = text.match(/^Reply in\s+([#@][\w.'-]+|[A-Z][A-Z0-9]{6,})\s+(\d{10}\.\d{6}):\s*\n?([\s\S]*)$/i);
  if (reply && TS.test(reply[2])) return { reply: { channel: reply[1], ts: reply[2], text: reply[3].trim() } };
  const post = text.match(/^Post in\s+([#@][\w.'-]+|[A-Z][A-Z0-9]{6,}):\s*\n?([\s\S]*)$/i);
  if (post) return { post: { channel: post[1], text: post[2].trim() } };
  return {};
}
