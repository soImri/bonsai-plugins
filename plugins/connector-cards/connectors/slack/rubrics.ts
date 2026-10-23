/**
 * Slack rubrics: what Jev is asked (≤ 8, most important first) and the heuristic twins.
 *
 * Which conversation an ask is about is decided by routing (a #channel or @person reference), not
 * by Jev. Jev picks the shape of the feed: how far back, whether only mentions or DMs, which
 * fields, and for a draft, which channel among the likely ones.
 */
import { choiceOf, yesOf, type FollowUp, type JevAnswers, type JevQuestion } from "../../runtime.ts";
import type { Channel, Message } from "./api.ts";

export type Range = "today" | "yesterday" | "3_days" | "week" | "2_weeks";
export const RANGE_LABEL: Record<Range, string> = { today: "Today", yesterday: "Yesterday", "3_days": "Last 3 days", week: "This week", "2_weeks": "Last 2 weeks" };
export const RANGE_DAYS: Record<Range, number> = { today: 0, yesterday: 1, "3_days": 3, week: 7, "2_weeks": 14 };

export type Composition = { view: "inbox" | "channel" | "thread"; range: Range; focus: "all" | "mentions" | "dms"; fields: { reactions: boolean; threads: boolean; followUps?: string[]; focuses?: string[]; ranges?: string[] }; by: "jev" | "fallback" | "memory"; confidence?: number; variant?: string };

export function guessRange(task: string): Range {
  const t = task.toLowerCase();
  if (/\byesterday\b/.test(t)) return "yesterday";
  if (/\b(two weeks|2 weeks|fortnight)\b/.test(t)) return "2_weeks";
  if (/\b(week|while i was (out|away|off)|since (monday|last))\b/.test(t)) return "week";
  if (/\b(today|this morning|now|latest|just now)\b/.test(t)) return "today";
  return "3_days";
}
export function guessFocus(task: string): Composition["focus"] {
  const t = task.toLowerCase();
  if (/\b(mention|mentions|mentioned|pinged|tagged|@me|need me|needs me|waiting on me|for me|asked me|addressed to me)\b/.test(t)) return "mentions";
  if (/\b(dm|dms|direct message|direct messages|private message)\b/.test(t)) return "dms";
  return "all";
}

export function viewRubric(task: string, view: Composition["view"], sample: Message[], channel?: Channel) {
  const guess: Composition = { view, range: guessRange(task), focus: guessFocus(task), fields: { reactions: true, threads: true }, by: "fallback" };
  // The heuristic's reading rides along as a hint; Jev still decides, but it sees the wording cue it would otherwise miss.
  const state = { task, view, wordingSuggests: `focus ${guess.focus}, range ${guess.range}`, channel: channel ? `#${channel.name}` : "the whole workspace", messagesSeen: sample.length, sample: sample.slice(0, 8).map((m) => ({ channel: m.channelName, from: m.user, text: m.text.slice(0, 80), replies: m.replyCount, mentionsMe: m.mentionsMe })) };
  const questions: Record<string, JevQuestion> = {
    range: { type: "choice", instructions: "How far back does the task look? 'what's new', 'latest', 'today', 'this morning' -> today; 'yesterday' -> yesterday; 'catch me up', 'what did I miss' with no time word -> 3_days; 'this week', 'while I was out' -> week; 'last two weeks' -> 2_weeks.",
      criteria: { today: "Today only.", yesterday: "Yesterday only.", "3_days": "The last three days; the default for a catch-up.", week: "The last seven days.", "2_weeks": "The last fourteen days." } },
    focus: { type: "choice", instructions: "Which messages matter for the task? Judge the wording, and lean on wordingSuggests when the task is short. 'anything for me', 'anything I need to see', 'where was I mentioned', 'did anyone ping me', 'waiting on me', 'is anyone waiting on me' -> mentions; 'my DMs', 'direct messages', 'who messaged me' -> dms; 'catch me up', 'what's new', 'what did I miss', 'what's happening' -> all.",
      criteria: { all: "Every message in scope: a general catch-up.", mentions: "Only messages addressed to the person: @mentions, @channel/@here, things that need their answer.", dms: "Only direct messages." } },
    threads: { type: "bool", instructions: "Show reply counts and let threads open?", criteria: { true: "The task is about discussions, decisions, or following up.", false: "A quick scan of headlines is enough." } },
    reactions: { type: "bool", instructions: "Show emoji reactions?", criteria: { true: "Reactions help gauge responses, votes, acknowledgements.", false: "Reactions are noise for this task." } },
  };
  const read = (answers: JevAnswers, variant: string): Composition | undefined => {
    if (answers.range?.type !== "choice") return undefined;
    return { view, range: answers.range.choice as Range, focus: choiceOf(answers, "focus", guess.focus) as Composition["focus"], fields: { reactions: yesOf(answers, "reactions", true), threads: yesOf(answers, "threads", true) }, by: "jev", confidence: answers.range.confidence, variant };
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

/* ---------- navigation: which chips the inbox shows (the chip row is our adaptation, tailored to the ask) ---------- */
const NEXT_RANGE: Record<string, string> = { today: "3_days", yesterday: "3_days", "3_days": "week", week: "2_weeks", "2_weeks": "week" };
export function inboxChips(comp: { focus: string; range: string }, picked: string[]): { focuses: string[]; ranges: string[] } {
  if (picked.includes("full_navigation")) return { focuses: ["all", "mentions", "dms"], ranges: ["today", "3_days", "week", "2_weeks"] };
  const focuses = ["all", "mentions", "dms"].filter((f) => f === comp.focus || f === "all");
  const r = new Set([comp.range, NEXT_RANGE[comp.range] ?? "week"]);
  return { focuses, ranges: ["today", "3_days", "week", "2_weeks"].filter((k) => r.has(k)) };
}
export function inboxFollowUps(task: string): FollowUp[] {
  const w = task.toLowerCase();
  const named = /\b(dm|dms|direct|mention|mentions|for me|today|yesterday|week|days|since|while)\b/.test(w);
  return [
    { id: "full_navigation", label: "move around the whole inbox (All / Mentions / DMs and every range offered)", when: "A general catch-up with no focus or range named: 'catch me up on Slack', 'what did I miss', 'anything new on Slack'.", unless: "The ask names DMs, mentions, 'for me', or a range: then only that focus and its neighbour are offered.", guess: !named },
  ];
}
