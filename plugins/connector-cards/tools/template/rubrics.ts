/**
 * __LABEL__ rubrics: what Jev is asked, most important first (at most 8), and the heuristics that
 * answer when Jev is not there. Every answer has a heuristic twin.
 */
import { choiceOf, yesOf, type FollowUp, type JevAnswers, type JevQuestion } from "../../runtime.ts";
import type { Record } from "./api.ts";

export type Composition = { view: "list" | "record"; fields: { body: boolean }; by: "jev" | "fallback" | "memory"; confidence?: number; variant?: string; followUps?: string[] };

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


/* ---------- follow-ups: additive secondary actions. The screen's own controls are always drawn and always live; a follow-up only adds something. ---------- */
// TODO: list the few additive actions per screen (a composer already open, a + New button). Many screens have none.
export function recordFollowUps(task: string): FollowUp[] {
  void task;
  return [];
}
export function listFollowUps(task: string): FollowUp[] {
  const w = task.toLowerCase();
  return [
    { id: "create", label: "add a new record from here (a + New button opens the create dialog in the card)", when: "Planning or grooming where new items come up; the person said they want to add something.", guess: /\b(add|new|create)\b/.test(w) },
  ];
}
