/**
 * __LABEL__ rubrics: what Jev is asked, most important first (at most 8), and the heuristics that
 * answer when Jev is not there. Every answer has a heuristic twin.
 */
import { choiceOf, yesOf, type JevAnswers, type JevQuestion } from "../../runtime.ts";
import type { Record } from "./api.ts";

export type Composition = { view: "list" | "record"; fields: { body: boolean }; by: "jev" | "fallback"; confidence?: number; variant?: string };

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
