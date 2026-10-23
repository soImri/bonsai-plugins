/**
 * __LABEL__ rubrics: what Jev is asked, most important first (at most 8), and the heuristics that
 * answer when Jev is not there. Every answer has a heuristic twin.
 */
import { choiceOf, yesOf, type FollowUp, type JevAnswers, type JevQuestion } from "../../runtime.ts";
import type { Record } from "./api.ts";

export type Composition = { view: "list" | "record"; fields: { body: boolean }; by: "jev" | "fallback"; confidence?: number; variant?: string; followUps?: string[] };

export function viewRubric(task: string, records: Record[]) {
  const guess: Composition = { view: records.length === 1 ? "record" : "list", fields: { body: records.length === 1 }, by: "fallback" };
  const state = { task, count: records.length, sample: records.slice(0, 8).map((r) => ({ ref: r.ref, title: r.title })) };
  const questions: { [k: string]: JevQuestion } = {
    // TODO: the compositions this connector draws, with examples of the wording that picks each.
    view: { type: "choice", instructions: "Pick the composition that answers the task.", criteria: { list: "Several records as compact rows.", record: "One record in full." } },
    body: { type: "bool", instructions: "Show each record's body text?", criteria: { true: "The task needs the content to judge or act.", false: "Titles are enough." } },
  };
  const read = (answers: JevAnswers, variant: string): Composition | undefined => {
    if (answers.view?.type !== "choice") return undefined;
    return { view: choiceOf(answers, "view", guess.view) as Composition["view"], fields: { body: yesOf(answers, "body", guess.fields.body) }, by: "jev", confidence: answers.view.confidence, variant };
  };
  return { state, questions, read, guess };
}


/* ---------- follow-ups: the few controls the card offers beside its primary surface ---------- */
// TODO: one factory per screen. At most 8 candidates; the card shows at most 3; `More` reveals the rest.
// `when` is what makes the control likely (words in the ask, the conversation context, what the person did after
// similar asks); `guess` is the heuristic twin for when Jev is unavailable.
export function recordFollowUps(task: string): FollowUp[] {
  const w = task.toLowerCase();
  return [
    { id: "title", label: "rename the record", when: "The ask or the context is about renaming or correcting it.", guess: /\b(rename|title|call it)\b/.test(w) },
    // { id: "status", label: "change its status", when: "...", guess: ... },
  ];
}
export function listFollowUps(task: string): FollowUp[] {
  const w = task.toLowerCase();
  return [
    { id: "create", label: "add a new record from here", when: "Planning or grooming where new items come up; the person said they want to add something.", guess: /\b(add|new|create)\b/.test(w) },
  ];
}
