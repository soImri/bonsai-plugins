/**
 * The Linear connector: issues, projects and triage as Linear's own UI.
 *
 *   view    words → issues + a Jev-picked composition (issue / list / board / project)
 *   record  NEAT-9 → one issue with live pills
 *   draft   words (+ title) → Linear's create dialog with Jev-picked properties
 *   apply   the card's Save / Comment / Create → written to Linear, card redrawn from Linear's truth
 *
 * Reads and writes both go to Linear's MCP server with Bonsai's Linear sign-in.
 */
import { HttpError, defineConnector, classify, ms, type Run, type CardResult } from "../../runtime.ts";
import { ISSUE_FIELDS, PRIORITY_NAMES, normalizeIssue, optionsOf, readIssues, teamContext, type Issue } from "./read.ts";
import { createRubric, deriveTitle, settle, viewRubric, type Composition, type Picks } from "./rubrics.ts";
import { applyChange, createIssue, describeChange, parseCardMessage, postComment, type Change, type Comment, type Create } from "./write.ts";
import { mcpCall } from "./mcp.ts";

const ID = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;

export const linear = defineConnector({
  id: "linear",
  label: "Linear",
  summary: "issues, tickets, bugs, projects and triage in Linear",
  aliases: ["linear app", "issues", "tickets"],
  auth: { serviceId: "linear.account", schemeId: "linear.mcp-oauth" },
  triggers: {
    keywords: ["linear", "issue", "issues", "ticket", "tickets", "bug", "bugs", "backlog", "triage", "sprint", "cycle", "in progress", "todo", "assignee", "label", "labels", "priority", "neat"],
    refPattern: ID,
    messagePattern: /^(Save|Comment on|Create in)\s+\S+:/,
  },
  examples: {
    view: ["what's open", "my issues", "where do we stand on NEAT", "how is Evals v1 going", "triage the bugs"],
    record: ["show NEAT-9", "status of NEAT-9", "comment on NEAT-9 that …"],
    draft: ["create a ticket for …", "file a bug: …", "log an issue to …"],
    apply: ["Save NEAT-10: status → In Progress; labels → A, B", "Comment on NEAT-10:\\n…", "Create in NEAT: <title>\\n<properties line>"],
  },
  filters: { project: "project name", assignee: "'me' or a display name", team: "team key or name" },
  explain: (err) => (err instanceof HttpError && (err.status === 401 || err.status === 403) ? `Linear's MCP server rejected Bonsai's Linear token (HTTP ${err.status}). Reconnect Linear (App Store → Installed → Linear → Connections) and try again.` : undefined),

  async view({ token, params, signal, startedAt, jev, cache, history }: Run): Promise<CardResult> {
    const f = params.filters ?? {};
    const identifiers: string[] = (params.refs ?? []).filter((r: string) => ID.test(r));
    const { team, meta } = await teamContext(token, f.team, `${params.task} ${identifiers.join(" ")}`, cache, signal);
    const all = await readIssues(token, team, { identifiers, query: params.query, project: f.project, assignee: f.assignee }, signal);
    const tLinear = ms(startedAt);
    const rubric = viewRubric(params.task, all, { identifiers, project: f.project });
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const { value, took: tJev } = await jev({ purpose: "linear-view" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, () => rubric.guess);
    const { comp, issues } = settle(value as Composition, all);
    const project = comp.view === "project" ? (meta.projects.find((p) => p.name.toLowerCase() === (f.project ?? issues[0]?.project ?? "").toLowerCase()) ?? (f.project ? { name: f.project } : undefined)) : undefined;
    const who = comp.by === "jev" ? `Jev picked, ${comp.variant} questions answered` : "default pick, Jev unavailable";
    const how = comp.view === "board" || comp.view === "project" ? ` grouped by ${comp.groupBy}` : "";
    const payload = { kind: "view", task: params.task, team: team.key, issues, allIssues: all, options: optionsOf(meta), projects: meta.projects.map((p) => ({ name: p.name, ...(p.lead ? { lead: p.lead } : {}), ...(p.targetDate ? { targetDate: p.targetDate } : {}), ...(p.summary ? { description: p.summary } : {}) })), ...(project ? { project: { name: project.name, ...(project.lead ? { lead: project.lead } : {}), ...(project.targetDate ? { targetDate: project.targetDate } : {}), ...(project.summary ? { description: project.summary } : {}) } } : {}), composition: comp, timing: { linear: tLinear, jev: tJev } };
    const picked = `${comp.view} view, scope ${comp.scope}${how}, sorted by ${comp.sort}`;
    void who;
    if (!issues.length) return { summary: `No ${comp.scope === "all" ? "" : `${comp.scope} `}issues in ${team.key} match. Say so in five words or fewer.`, payload, picked };
    return { summary: `Card shown (${issues.length} ${team.key} issue${issues.length === 1 ? "" : "s"}). Reply with nothing: the card is the whole answer, and the person navigates inside it.`, payload, picked };
  },

  async record({ token, params, signal, startedAt, cache }: Run): Promise<CardResult> {
    const ref = String(params.ref ?? "").trim().toUpperCase();
    if (!ID.test(ref)) throw new Error(`"${params.ref}" is not a Linear identifier (expected something like NEAT-9).`);
    const { meta } = await teamContext(token, undefined, ref, cache, signal);
    const [issue] = await readIssues(token, meta, { identifiers: [ref] }, signal);
    if (!issue) throw new Error(`No issue ${ref} is visible to Bonsai's Linear account.`);
    const full = { ...issue, options: optionsOf(meta), ...(params.draft ? { commentDraft: params.draft } : {}) };
    return { summary: `Card shown (${issue.identifier}). Reply with nothing.`, payload: { kind: "issue", issue: full, timing: { linear: ms(startedAt) } } };
  },

  async draft({ token, params, signal, startedAt, jev, cache, history }: Run): Promise<CardResult> {
    const { team, meta } = await teamContext(token, params.fields?.team ?? params.filters?.team, params.task, cache, signal);
    const tLinear = ms(startedAt);
    const title = (params.title?.trim() || deriveTitle(params.task)).slice(0, 120);
    const description = params.body?.trim() ?? "";
    const rubric = createRubric(params.task, title, description, meta);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    const { value: picks, took: tJev } = await jev({ purpose: "linear-new-issue" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, rubric.guess) as { value: Picks; took: string };
    const draft = { team: team.key, title, description, state: picks.state, priority: picks.priority, ...(picks.assignee ? { assignee: picks.assignee } : {}), ...(picks.project ? { project: picks.project } : {}), labels: picks.labels, options: optionsOf(meta) };
    const summary = [draft.state, PRIORITY_NAMES[draft.priority], draft.project, draft.labels.join(", "), draft.assignee].filter(Boolean).join(" · ");
    void tLinear; void tJev;
    return {
      summary: `Create dialog shown. Reply with nothing and stop; do not describe the draft or tell the person what to press. When a message starting 'Create in ${team.key}:' arrives, call cards_apply with it verbatim in \`message\`.`,
      payload: { kind: "draft", draft, picks: { by: picks.by, confidence: picks.confidence }, timing: { linear: tLinear, jev: tJev } },
      picked: summary,
    };
  },

  async apply({ token, params, signal, startedAt, cache }: Run): Promise<CardResult> {
    const parsed = typeof params.message === "string" ? parseCardMessage(params.message) : { changes: [] as Change[] };
    const p = params.payload ?? {};
    const changes: Change[] = [...parsed.changes, ...(p.changes ?? [])];
    const comment: Comment | undefined = p.comment ?? parsed.comment;
    const create: Create | undefined = p.create ?? parsed.create;
    if (!changes.length && !comment && !create) throw new Error("Nothing to apply: the message did not parse as a Linear card command and no payload was passed.");
    const applied: string[] = [];
    const touched = new Set<string>();
    await Promise.all(changes.map(async (c) => { await applyChange(token, c, signal); applied.push(describeChange(c)); touched.add(c.identifier.toUpperCase()); }));
    if (comment) { await postComment(token, comment, signal); applied.push(`${comment.identifier}: comment posted`); touched.add(comment.identifier.toUpperCase()); }
    let correction: string | undefined;
    if (create) {
      const id = await createIssue(token, create, signal); applied.push(`${id}: created`); touched.add(id.toUpperCase());
      // What the person kept versus what the draft proposed is the signal the next draft learns from.
      correction = [create.state, PRIORITY_NAMES[create.priority ?? 0], create.project, (create.labels ?? []).join(", "), create.assignee].filter(Boolean).join(" · ");
    }
    const tWrite = ms(startedAt);
    const { meta } = await teamContext(token, create?.team, [...touched][0] ?? create?.team ?? "", cache, signal);
    const fresh = (await Promise.all([...touched].map((id) => mcpCall(token, "get_issue", { id, fields: ISSUE_FIELDS }, signal).catch(() => undefined)))).filter((g) => g && (g as any).id).map(normalizeIssue) as Issue[];
    const comp: Composition = { view: fresh.length === 1 ? "issue" : "list", groupBy: "status", sort: "none", scope: "all", fields: { description: fresh.length === 1, labels: true, dates: false, assignee: true, project: true }, by: "fallback" };
    return {
      summary: `Saved to Linear: ${applied.join("; ")}. The card shows the result; reply with nothing.`,
      payload: { kind: "view", task: "Saved", team: meta.key, issues: fresh, options: optionsOf(meta), composition: comp, applied, timing: { linear: tWrite } },
      ...(correction ? { correction: `created with ${correction}` } : {}),
    };
  },
});
