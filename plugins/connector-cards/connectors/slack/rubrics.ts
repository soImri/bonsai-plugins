/**
 * Slack rubrics: what Jev is asked (≤ 8, most important first) and the heuristic twins.
 *
 * Which conversation an ask is about is decided by routing (a #channel or @person reference), not
 * by Jev. Jev picks the shape of the feed: how far back, whether only mentions or DMs, which
 * fields, and for a draft, which channel among the likely ones.
 */
import { yesOf, type FollowUp, type JevAnswers, type JevQuestion } from "../../runtime.ts";
import type { Channel, Message } from "./api.ts";

export type Focus = "needs_me" | "mentions" | "threads" | "dms" | "all";
export type Composition = { view: "activity" | "channel" | "thread"; focus: Focus; fields: { reactions: boolean; threads: boolean }; by: "jev" | "fallback" | "memory"; confidence?: number; variant?: string; followUps?: string[] };

/** What the person wants from the workspace: by default what involves them (mentions, threads they are in, DMs), as Slack's Activity view. */
export function guessFocus(task: string): Focus {
  const t = task.toLowerCase();
  if (/\b(mention|mentions|mentioned|pinged|tagged|@me|asked me|addressed to me)\b/.test(t)) return "mentions";
  if (/\b(dm|dms|direct message|direct messages|private message)\b/.test(t)) return "dms";
  if (/\b(thread|threads|discussion|discussions|replies|conversation about)\b/.test(t)) return "threads";
  if (/\b(everything|all channels|what's new|whats new|new on slack|latest on slack|what happened)\b/.test(t)) return "all";
  return "needs_me";
}

export function viewRubric(task: string, view: Composition["view"], sample: Message[], channel?: Channel) {
  const guess: Composition = { view, focus: guessFocus(task), fields: { reactions: true, threads: true }, by: "fallback" };
  const state = { task, view, wordingSuggests: `focus ${guess.focus}`, channel: channel ? `#${channel.name}` : "the whole workspace", messagesSeen: sample.length, sample: sample.slice(0, 8).map((m) => ({ channel: m.channelName, from: m.user, mentionsMe: m.mentionsMe, inThread: Boolean(m.threadTs), text: m.text.slice(0, 80) })) };
  const questions: Record<string, JevQuestion> = {
    focus: { type: "choice", instructions: "What does the person want from Slack? Judge the wording; lean on wordingSuggests when the task is short. 'catch me up', 'what did I miss', 'anything for me', 'what needs me' -> needs_me; 'where was I mentioned', 'did anyone ping me' -> mentions; 'my threads', 'the discussion about', 'replies' -> threads; 'my DMs', 'messages from Seb' -> dms; 'what's new on Slack', 'everything', 'all channels' -> all.",
      criteria: { needs_me: "What involves the person: messages mentioning them, threads they are in, direct messages. The default for a catch-up.", mentions: "Only messages addressed to the person (@mentions, @channel/@here).", threads: "Only threads the person started, replied in, or was mentioned in.", dms: "Only direct messages.", all: "Everything recent in every channel, grouped by channel: a broad scan." } },
    threads: { type: "bool", instructions: "Let threads open in place with their replies?", criteria: { true: "The task is about discussions, decisions, replies, or following up.", false: "A quick scan of headlines is enough." } },
    reactions: { type: "bool", instructions: "Show emoji reactions?", criteria: { true: "Reactions help gauge responses, votes, acknowledgements.", false: "Reactions are noise for this task." } },
  };
  const read = (answers: JevAnswers, variant: string): Composition | undefined => {
    if (answers.focus?.type !== "choice") return undefined;
    return { view, focus: answers.focus.choice as Focus, fields: { reactions: yesOf(answers, "reactions", true), threads: yesOf(answers, "threads", true) }, by: "jev", confidence: answers.focus.confidence, variant };
  };
  return { state, questions, read, guess };
}

/* ---------- the draft rubric: which conversation to post in ---------- */
export type Picks = { channel?: string; by: "jev" | "fallback"; confidence?: number; variant?: string };

export function draftRubric(task: string, text: string, candidates: Channel[]) {
  const named = candidates.find((c) => new RegExp(`[#@]${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(task));
  const guess = (): Picks => ({ channel: (named ?? candidates.find((c) => /general|all-/i.test(c.name)) ?? candidates[0])?.id, by: "fallback" });
  const top = candidates.slice(0, 8);
  const questions: Record<string, JevQuestion> = {
    channel: { type: "choice", instructions: "Where should this message be posted, judged by the task and the message against each conversation's name and topic?", criteria: Object.fromEntries(top.map((c, i) => [`c${i}`, `${c.kind === "dm" ? `DM with ${c.name}` : `#${c.name}`}${c.topic ? `: ${c.topic}` : ""}`])) },
  };
  const state = { task, message: text.slice(0, 300), conversations: top.map((c) => (c.kind === "dm" ? `DM ${c.name}` : `#${c.name}`)).join(", ") };
  const read = (answers: JevAnswers, variant: string): Picks | undefined => {
    if (answers.channel?.type !== "choice") return undefined;
    const c = top[Number(String(answers.channel.choice).slice(1))];
    return { channel: named?.id ?? c?.id ?? guess().channel, by: "jev", confidence: answers.channel.confidence, variant };
  };
  return { state, questions, read, guess, named };
}

/* ---------- follow-ups: additive secondary actions on the activity card ---------- */
export function activityFollowUps(task: string): FollowUp[] {
  const w = task.toLowerCase();
  return [
    { id: "post", label: "write a new message to a channel or a person from here (a composer with a conversation picker opens at the top of the card)", when: "The person wants to tell, announce, ask, ping or share something: 'let the team know', 'ping Seb', 'post an update', or the context says they have news to publish.", unless: "A read-only catch-up.", guess: /\b(tell|announce|let .* know|ping|post|share|publish|send|message|ask)\b/.test(w) },
  ];
}
