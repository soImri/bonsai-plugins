/**
 * Linear rubrics: what Jev is asked, in what order, and what the plugin does when Jev is not there.
 *
 * Each rubric is {state, questions, read(answers)}; questions are ordered by importance because the
 * hosted route answers at most JEV_MAX_QUESTIONS and the runtime drops the tail. Every answer has a
 * heuristic twin, so a dropped question degrades to the heuristic, never to a hole.
 */
import { JEV_MAX_QUESTIONS, choiceOf, yesOf, type FollowUp, type JevAnswers, type JevQuestion } from "../../runtime.ts";
import type { Issue, Scope, TeamMeta } from "./read.ts";
import { inScope } from "./read.ts";

export type Composition = {
  view: "issue" | "list" | "board" | "project"; groupBy: "status" | "project" | "assignee" | "priority"; sort: "priority" | "newest" | "none";
  scope: Scope; fields: { description: boolean; labels: boolean; dates: boolean; assignee: boolean; project: boolean };
  by: "jev" | "fallback" | "memory"; confidence?: number; variant?: string;
  /** The follow-ups the card offers beside its primary surface (ids from issueFollowUps / listFollowUps / draftFollowUps). */
  followUps?: string[];
  /** The scope tabs this card shows: the asked scope and its neighbour; all four for a general look. */
  scopes?: Scope[];
};

/* ---------- follow-ups: additive secondary actions. The screen's own controls (pills, rows, tabs, Save) are always there and always live; a follow-up only adds something. ---------- */
const t = (task: string) => task.toLowerCase();
/** One issue: the comment box opens ready to type when answering or giving feedback is the likely next move. */
export function issueFollowUps(task: string, issue?: { commentDraft?: string }): FollowUp[] {
  const w = t(task);
  return [
    { id: "comment", label: "write a comment on it right away (the comment box opens, ready to type)", when: "The person wants to respond, give feedback, leave an update for others, or answer a question on it; or the ask passes a draft.", unless: "They are checking status, triaging, or deciding properties.", guess: Boolean(issue?.commentDraft) || /\b(comment|reply|respond|answer|feedback|tell|note|update)\b/.test(w), always: Boolean(issue?.commentDraft) },
  ];
}
/** A list or board: a + New issue button opens Linear's create dialog inside the card. */
const SCOPE_NEIGHBOUR: Record<Scope, Scope> = { open: "active", active: "open", done: "all", all: "open" };
/** The asked scope and its neighbour, or all four for a general look. */
export function scopesFor(comp: { scope: Scope }, picked: string[]): Scope[] {
  if (picked.includes("full_navigation")) return ["open", "active", "done", "all"];
  const order: Scope[] = ["open", "active", "done", "all"];
  const set = new Set<Scope>([comp.scope, SCOPE_NEIGHBOUR[comp.scope] ?? "open"]);
  return order.filter((s) => set.has(s));
}
export function listFollowUps(task: string, comp: Composition, n: number): FollowUp[] {
  const w = t(task);
  void comp;
  const named = /\b(open|progress|active|done|closed|completed|shipped|backlog|todo|triage|urgent|bug|project|mine|my |assigned)\b/.test(w);
  return [
    { id: "full_navigation", label: "move between open, in progress, done and all from here (all four scope tabs)", when: "A general look with no scope named: 'show my Linear', 'the NEAT board', 'what's going on in Linear', 'overview'.", unless: "The ask names a scope (open, in progress, done, backlog) or a specific topic: then only that scope and its neighbour are offered.", guess: !named },
    { id: "create", label: "add a new issue from here (a + New issue button opens the create dialog in the card)", when: "Planning, grooming or triage where new work usually comes up; the person said they want to add or file something; the context mentions a new idea or task.", unless: "A status check, an overview, a standup read-out.", guess: /\b(add|new|create|file|plan|groom)\w*/.test(w) && n < 40 },
  ];
}

/* ---------- heuristics ---------- */
export function guessScope(task: string): Scope {
  const t = task.toLowerCase();
  if (/\b(done|shipped|completed|closed|finished)\b/.test(t)) return "done";
  if (/\b(in progress|working on|wip|being worked)\b/.test(t)) return "active";
  if (/\b(all|everything|every issue|whole|entire|where do we stand|overview|board)\b/.test(t)) return "all";
  return "open";
}
export function guessComposition(task: string, n: number, projectNamed: boolean): Composition {
  const t = task.toLowerCase();
  const view = n === 1 ? "issue" : projectNamed || /\bproject\b|how is .+ going|what'?s left in/.test(t) ? "project" : /\b(board|standup|where do we stand|overview|blocked|progress|who owns|per person|workload)\b/.test(t) ? "board" : "list";
  const groupBy = /\b(who|per person|workload|owns)\b/.test(t) ? "assignee" : /\b(urgent|priority|importance)\b/.test(t) ? "priority" : /\b(across projects|per project|each project)\b/.test(t) ? "project" : "status";
  return { view, groupBy, sort: /\b(new|recent|latest|came in)\b/.test(t) ? "newest" : "priority", scope: guessScope(task), fields: { description: n === 1, labels: true, dates: /\b(new|recent|stale|week|deadline|when|old)\b/.test(t), assignee: true, project: !projectNamed }, by: "fallback" };
}
export function guessPriority(text: string): number {
  const t = text.toLowerCase();
  if (/\burgent\b|\bp0\b|asap|critical/.test(t)) return 1;
  if (/\bhigh\b|\bp1\b|important/.test(t)) return 2;
  if (/\bmedium\b|\bp2\b|normal/.test(t)) return 3;
  if (/\blow\b|\bp3\b|minor|someday/.test(t)) return 4;
  return 0;
}
export function deriveTitle(task: string): string {
  let t = task.trim().replace(/^(please\s+)?(can you\s+|could you\s+)?(create|open|file|make|add|log|draft)\s+(a\s+|an\s+)?(new\s+)?(linear\s+)?(ticket|issue|task|bug|story)\s*(to|for|about|that|:|-|—)?\s*/i, "");
  t = t.split(/[.;\n]|,\s*(set|with|priority|assign)/i)[0].trim();
  if (!t) t = task.trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t;
}

/* ---------- the view rubric ---------- */
export function viewRubric(task: string, all: Issue[], p: { identifiers?: string[]; project?: string }) {
  const projectNamed = Boolean(p.project);
  const guess = { ...guessComposition(task, all.length, projectNamed), scope: p.identifiers?.length ? "all" as const : guessScope(task) };
  const count = (s: Scope) => all.filter((i) => inScope(i, s)).length;
  const state = {
    task, openCount: count("open"), activeCount: count("active"), doneCount: count("done"), totalCount: all.length,
    identifiersNamed: (p.identifiers ?? []).join(", ") || "none", projectNamed: p.project ?? "none", distinctProjects: new Set(all.map((i) => i.project).filter(Boolean)).size,
    sample: all.slice(0, 8).map((i) => ({ identifier: i.identifier, title: i.title, state: i.state.name, stateType: i.state.type, priority: i.priority, project: i.project ?? "none", assignee: i.assignee ?? "none", labels: i.labels.join(", ") || "none", hasDescription: Boolean(i.description) })),
  };
  // Most important first: the tail is what the size-limited route loses. `project` (show the project column) stays heuristic.
  const questions: Record<string, JevQuestion> = {
    view: { type: "choice", instructions: "Pick the Linear composition that answers the task. Judge the wording first, then the counts. Examples: 'show NEAT-9', one identifier -> issue; 'what's open', 'my issues', 'triage', 'list the bugs' -> list; 'where do we stand', 'how is the team doing', 'standup', 'what's blocked', 'overview' -> board; 'how is <project> going', 'what's left in <project>', 'project status' -> project.",
      criteria: { issue: "One issue in full: title, description, properties, comment box. The task names or is about a single issue.", list: "Several issues as compact editable rows. The task is to see, scan, pick from, or triage issues; grouping would not help.", board: "Several issues grouped under headers. The task is about where things stand, progress, what is blocked, an overview, a standup.", project: "A project header with a progress bar and its issues grouped. The task is about one project as a whole." } },
    scope: { type: "choice", instructions: "Which issues does the task want to see? Judge the wording. Examples: 'what's open', 'my issues', 'todo', 'triage', 'what's left', 'backlog' -> open; 'in progress', 'what's being worked on', 'wip' -> active; 'what shipped', 'what's done', 'completed', 'closed' -> done; 'everything', 'all issues', 'where do we stand', 'overview', 'board', or the task names specific identifiers -> all.",
      criteria: { open: "Unfinished work: triage, backlog, todo, in progress, in review.", active: "Only work that has started: in progress, in review.", done: "Only completed issues.", all: "Every issue regardless of state." } },
    groupBy: { type: "choice", instructions: "If the view groups issues, by which property? Examples: 'where do we stand', 'what's done', 'blocked' -> status; 'across projects', 'per project' -> project; 'who owns what', 'per person', 'workload' -> assignee; 'what's urgent', 'by importance', 'triage' -> priority.",
      criteria: { status: "The task is about progress, completion, or blockage.", project: "The task compares or splits work across projects.", assignee: "The task is about who owns what, workload, or hand-offs.", priority: "The task is about urgency or importance." } },
    sort: { type: "choice", instructions: "Order of the rows within the view or within each group.",
      criteria: { priority: "Urgent first. The default for triage, open work, what to do next.", newest: "Most recently created first. The task is about what came in, what is new, recent activity.", none: "Keep Linear's order. The task does not care about order." } },
    description: { type: "bool", instructions: "Show each issue's description text?", criteria: { true: "The task needs the body to judge or act (review, decide, understand one issue).", false: "Titles and properties are enough (scan, status, overview, triage)." } },
    assignee: { type: "bool", instructions: "Show the assignee?", criteria: { true: "Ownership matters, more than one person is involved, or the task asks who.", false: "One person does everything here, or ownership is beside the point." } },
    labels: { type: "bool", instructions: "Show labels?", criteria: { true: "The task mentions a label or category (bug, decision, design), or triage.", false: "Labels do not help the task." } },
    dates: { type: "bool", instructions: "Show created and done dates?", criteria: { true: "Timing matters: recent, new, stale, how long, this week, deadlines.", false: "Timing does not matter." } },
  };
  const read = (answers: JevAnswers, variant: string): Composition | undefined => {
    if (answers.view?.type !== "choice") return undefined;
    const groupBy = choiceOf(answers, "groupBy", guess.groupBy) as Composition["groupBy"];
    return {
      view: answers.view.choice, groupBy, sort: choiceOf(answers, "sort", guess.sort) as Composition["sort"],
      scope: p.identifiers?.length ? "all" : (choiceOf(answers, "scope", guess.scope) as Scope),
      fields: { description: yesOf(answers, "description", guess.fields.description), labels: yesOf(answers, "labels", guess.fields.labels), dates: yesOf(answers, "dates", guess.fields.dates), assignee: yesOf(answers, "assignee", guess.fields.assignee), project: guess.fields.project && groupBy !== "project" },
      by: "jev", confidence: answers.view.confidence, variant,
    };
  };
  return { state, questions, read, guess };
}

/** Tidy a composition against the issues that survived the scope filter. */
export function settle(comp: Composition, all: Issue[]): { comp: Composition; issues: Issue[] } {
  let issues = all.filter((i) => inScope(i, comp.scope));
  if (!issues.length && all.length) { issues = all; comp.scope = "all"; }
  if (issues.length === 1 && comp.view !== "project") comp.view = "issue";
  if (issues.length > 1 && comp.view === "issue") comp.view = "list";
  if (comp.view === "project" && comp.groupBy === "project") comp.groupBy = "status";
  if (comp.view === "issue") comp.fields.description = true;
  return { comp, issues };
}

/* ---------- the create rubric ---------- */
export type Picks = { state?: string; priority: number; project?: string; labels: string[]; assignee?: string; by: "jev" | "fallback" | "memory"; confidence?: number; variant?: string };

export function createRubric(task: string, title: string, description: string, meta: TeamMeta) {
  const defaultState = meta.states.find((s) => s.type === "unstarted") ?? meta.states.find((s) => s.type === "backlog") ?? meta.states[0];
  const guess = (): Picks => ({
    state: defaultState?.name, priority: guessPriority(task), labels: [],
    assignee: /\b(me|my|myself|i'?ll)\b/i.test(task) || meta.members.length === 1 ? meta.viewer || undefined : undefined, by: "fallback",
  });
  // Plain token keys only (p0, s1, label_2): names with spaces or punctuation are mapped back after the answer.
  const projects = meta.projects.slice(0, 12);
  const projectCriteria: Record<string, string> = { none: "The task does not belong to any listed project." };
  projects.forEach((p, i) => { projectCriteria[`p${i}`] = p.summary ? `Project "${p.name}": ${p.summary}` : `The project named "${p.name}".`; });
  const openStates = meta.states.filter((s) => s.type !== "completed" && s.type !== "canceled");
  const stateCriteria: Record<string, string> = {};
  openStates.forEach((s, i) => { stateCriteria[`s${i}`] = s.type === "unstarted" ? `"${s.name}": normal new work, ready to pick up. The default.` : s.type === "backlog" ? `"${s.name}": someday, not now, parked, low commitment.` : s.type === "started" ? `"${s.name}": already being worked on right now.` : `"${s.name}": needs triage first.`; });
  // Order = importance: priority and project, then the labels (where Jev adds the most), then state; assignee stays heuristic when cut.
  const labelsAsked = meta.labels.slice(0, JEV_MAX_QUESTIONS - 3);
  const questions: Record<string, JevQuestion> = {
    priority: { type: "choice", instructions: "Which priority does the task state or imply? Explicit words win: 'urgent', 'high', 'medium', 'low'. Without a word: a blocker or outage -> urgent; a must-do soon -> high; ordinary work -> medium; nice-to-have -> low; no signal -> none.", criteria: { none: "No priority stated or implied.", urgent: "Urgent, critical, blocker, ASAP, P0.", high: "High, important, soon, P1.", medium: "Medium, normal, P2, or ordinary planned work.", low: "Low, minor, someday, P3." } },
    project: { type: "choice", instructions: "Which project does this issue belong to, judged by its name and summary against the task? Choose none when no project fits well.", criteria: projectCriteria },
  };
  labelsAsked.forEach((l, i) => { questions[`label_${i}`] = { type: "bool", instructions: `Apply the label "${l.name}"?`, criteria: { true: l.description ? `The task matches this label: ${l.description}` : `The task is about ${l.name.toLowerCase()}.`, false: "The label does not fit the task." } }; });
  questions.state = { type: "choice", instructions: "Which workflow state should the new issue start in? Default to the ordinary 'ready to pick up' state unless the task says it is already in progress or parked for later.", criteria: stateCriteria };
  questions.assignToMe = { type: "bool", instructions: "Should the issue be assigned to the person asking?", criteria: { true: "The task says me, my, I will, mine, or the team has one member who does everything.", false: "The task names someone else or says nothing about ownership on a multi-person team." } };
  const state = { task, title, description: description || "none", teamMembers: meta.members.join(", ") || "none", viewer: meta.viewer || "unknown" };
  const read = (answers: JevAnswers, variant: string): Picks | undefined => {
    if (answers.priority?.type !== "choice") return undefined;
    const g = guess();
    const pr = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }[answers.priority.choice as string] ?? 0;
    const projectPick = answers.project?.type === "choice" && answers.project.choice !== "none" && answers.project.confidence >= 0.4 ? projects[Number(String(answers.project.choice).slice(1))] : undefined;
    const statePick = answers.state?.type === "choice" ? openStates[Number(String(answers.state.choice).slice(1))] : undefined;
    return {
      state: statePick?.name ?? defaultState?.name, priority: guessPriority(task) || pr, project: projectPick?.name,
      labels: labelsAsked.filter((_, i) => yesOf(answers, `label_${i}`, false, 0.6)).map((l) => l.name),
      assignee: answers.assignToMe?.type === "bool" ? (answers.assignToMe.probability >= 0.5 ? meta.viewer || undefined : undefined) : g.assignee,
      by: "jev", confidence: answers.priority.confidence, variant,
    };
  };
  return { state, questions, read, guess };
}
