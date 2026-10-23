/**
 * The Linear connector module: four tools on the shared runtime.
 *
 *   linearcards_view      words → issues + a Jev-picked composition (issue / list / board / project)
 *   linearcards_issue     identifier → one issue with live pills
 *   linearcards_newissue  words (+ title) → a create dialog with Jev-picked properties
 *   linearcards_apply     the card's Save / Comment / Create → written to Linear, card redrawn from Linear's truth
 *
 * Reads and writes both go to Linear's MCP server with Bonsai's Linear sign-in. Bonsai's permission
 * gate still sits in front of `linearcards_apply` (no `permission` declared → fail-closed execute).
 */
import { HttpError, defineConnector, classify, ms, type ToolRun } from "../runtime.ts";
import { ISSUE_FIELDS, PRIORITY_NAMES, normalizeIssue, optionsOf, readIssues, teamContext, type Issue } from "./read.ts";
import { createRubric, deriveTitle, settle, viewRubric, type Composition, type Picks } from "./rubrics.ts";
import { applyChange, createIssue, describeChange, parseCardMessage, postComment, type Change, type Comment, type Create } from "./write.ts";
import { mcpCall } from "./mcp.ts";

const CALL_FIRST = "There is no need to read the skill first: Bonsai attaches it to this tool's result. After it returns, reply with at most one short line.";

const changeSchema = {
  type: "object",
  properties: {
    identifier: { type: "string" }, state: { type: "string", description: "Status name, e.g. In Progress." }, priority: { type: "integer", minimum: 0, maximum: 4 },
    assignee: { type: ["string", "null"], description: "Display name; null clears." }, project: { type: ["string", "null"], description: "Project name; null clears." },
    labels: { type: "array", items: { type: "string" }, description: "The full label list; [] clears." },
  },
  required: ["identifier"],
};

export const linear = defineConnector({
  id: "linear",
  auth: { serviceId: "linear.account", schemeId: "linear.mcp-oauth" },
  explain: (err) => (err instanceof HttpError && (err.status === 401 || err.status === 403) ? `Linear's MCP server rejected Bonsai's Linear token (HTTP ${err.status}). Reconnect Linear (service_connect linear.account) and try again.` : undefined),
  tools: [
    /* ---- view ---- */
    {
      name: "linearcards_view", label: "Linear view", failing: "read Linear for the view",
      description: `Show Linear issues in the chat as Linear's own UI. Call this FIRST, with the person's words: it reads Linear itself (no linear:// or mcp reads needed), Jev picks the view (one issue, a list, a board, or a project view) plus scope and fields, and the card draws it. Use for 'what's open', 'my issues', 'what's in progress', 'triage', 'where do we stand', 'how is <project> going', 'show NEAT-9', or any ask about issues. Pass identifiers when the ask names them, query only when it names a topic. ${CALL_FIRST}`,
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "The person's request, in their words." },
          identifiers: { type: "array", items: { type: "string" }, description: "Issue identifiers the ask names, e.g. [\"NEAT-9\"]. Omit otherwise." },
          query: { type: "string", description: "A topic keyword to filter titles and descriptions by, only when the ask names a topic (e.g. 'evals'). Omit otherwise." },
          project: { type: "string", description: "A project name when the ask is about one project. Omit otherwise." },
          assignee: { type: "string", description: "'me' for the person's own issues, or a display name. Omit otherwise." },
          team: { type: "string", description: "Team key or name, only when the ask names one. Omit otherwise." },
        },
        required: ["task"],
      },
      async run({ token, params, signal, startedAt, jev, cache, ok }: ToolRun) {
        const { team, meta } = await teamContext(token, params.team, `${params.task} ${(params.identifiers ?? []).join(" ")}`, cache, signal);
        const all = await readIssues(token, team, params, signal);
        const tLinear = ms(startedAt);
        const rubric = viewRubric(params.task, all, params);
        const { value, took: tJev } = await jev({ purpose: "linear-view" }, async (j) => { const { answers, variant } = await classify(j, rubric.state, rubric.questions); return rubric.read(answers, variant); }, () => rubric.guess);
        const { comp, issues } = settle(value as Composition, all);
        const project = comp.view === "project" ? (meta.projects.find((p) => p.name.toLowerCase() === (params.project ?? issues[0]?.project ?? "").toLowerCase()) ?? (params.project ? { name: params.project } : undefined)) : undefined;
        const who = comp.by === "jev" ? `Jev picked, ${comp.variant} questions answered` : "default pick, Jev unavailable";
        const how = comp.view === "board" || comp.view === "project" ? ` grouped by ${comp.groupBy}` : "";
        const details = { kind: "view", task: params.task, team: team.key, issues, options: optionsOf(meta), ...(project ? { project: { name: project.name, ...(project.lead ? { lead: project.lead } : {}), ...(project.targetDate ? { targetDate: project.targetDate } : {}), ...(project.summary ? { description: project.summary } : {}) } } : {}), composition: comp, timing: { linear: tLinear, jev: tJev } };
        if (!issues.length) return ok(`No ${comp.scope === "all" ? "" : `${comp.scope} `}issues in ${team.key} match. Say so in one line.`, details);
        return ok(`Showing ${issues.length} ${team.key} issue${issues.length === 1 ? "" : "s"} as a ${comp.view} view${how}, scope ${comp.scope} (${who}; Linear ${tLinear}, Jev ${tJev}). The card is the answer: reply with one short line or nothing. Never restate its fields.`, details);
      },
    },

    /* ---- issue ---- */
    {
      name: "linearcards_issue", label: "Linear issue card", failing: "read the issue",
      description: `Show one Linear issue in the chat as Linear's own issue view. Call this FIRST with just the identifier: it reads the issue and the team's pick lists itself (no linear:// read needed) and the card draws it with live pills. Use for 'show NEAT-9', 'what's the status of NEAT-9', 'open NEAT-9', and for 'comment on NEAT-9 that …' (pass commentDraft). ${CALL_FIRST}`,
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Issue identifier, e.g. NEAT-9." },
          commentDraft: { type: "string", description: "Prefill the card's comment box with this text; the person presses Comment to post. Optional." },
        },
        required: ["identifier"],
      },
      async run({ token, params, signal, startedAt, cache, ok }: ToolRun) {
        const { meta } = await teamContext(token, undefined, params.identifier, cache, signal);
        const [issue] = await readIssues(token, meta, { identifiers: [params.identifier] }, signal);
        if (!issue) return ok(`No issue ${params.identifier} is visible to Bonsai's Linear account. Say so in one line.`, { error: `No issue ${params.identifier}.` });
        const full = { ...issue, options: optionsOf(meta), ...(params.commentDraft ? { commentDraft: params.commentDraft } : {}) };
        return ok(`Showing ${issue.identifier} as a Linear issue card (Linear ${ms(startedAt)}). The card is the answer: reply with one short line or nothing.`, { kind: "issue", issue: full, timing: { linear: ms(startedAt) } });
      },
    },

    /* ---- newissue ---- */
    {
      name: "linearcards_newissue", label: "Linear new issue", failing: "prepare the draft",
      description: `Draft a new Linear issue in the chat as Linear's create dialog. Call this FIRST with the person's words plus a short title: it reads the team's states, projects, labels and members itself (no linear:// or mcp reads, no repo research), Jev picks status, priority, project, labels and assignee from the task, and the person edits the card and presses Create issue. Do not create anything yourself; the card sends a 'Create in <team>:' message when the person is ready. ${CALL_FIRST}`,
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "The person's request, in their words." },
          title: { type: "string", description: "A title of at most 80 characters, in Linear's style. Derived from the task when omitted." },
          description: { type: "string", description: "At most three short lines of Markdown, only when the task gives real detail. Omit otherwise; the person edits the card." },
          team: { type: "string", description: "Team key or name, only when the ask names one. Omit otherwise." },
        },
        required: ["task"],
      },
      async run({ token, params, signal, startedAt, jev, cache, ok }: ToolRun) {
        const { team, meta } = await teamContext(token, params.team, params.task, cache, signal);
        const tLinear = ms(startedAt);
        const title = (params.title?.trim() || deriveTitle(params.task)).slice(0, 120);
        const description = params.description?.trim() ?? "";
        const rubric = createRubric(params.task, title, description, meta);
        const { value: picks, took: tJev } = await jev({ purpose: "linear-new-issue" }, async (j) => { const { answers, variant } = await classify(j, rubric.state, rubric.questions); return rubric.read(answers, variant); }, rubric.guess) as { value: Picks; took: string };
        const draft = { team: team.key, title, description, state: picks.state, priority: picks.priority, ...(picks.assignee ? { assignee: picks.assignee } : {}), ...(picks.project ? { project: picks.project } : {}), labels: picks.labels, options: optionsOf(meta) };
        const summary = [draft.state, PRIORITY_NAMES[draft.priority], draft.project, draft.labels.join(", "), draft.assignee].filter(Boolean).join(" · ");
        return ok(
          `Draft "${title}" shown as Linear's create dialog with ${summary} (${picks.by === "jev" ? `Jev picked, ${picks.variant} questions answered` : "default pick, Jev unavailable"}; Linear ${tLinear}, Jev ${tJev}). Stop here with at most one short line. When the person presses Create issue, a message starting 'Create in ${team.key}:' arrives: call linearcards_apply with that whole message in \`message\`.`,
          { kind: "draft", draft, picks: { by: picks.by, confidence: picks.confidence }, timing: { linear: tLinear, jev: tJev } },
        );
      },
    },

    /* ---- apply ---- */
    {
      name: "linearcards_apply", label: "Apply in Linear", failing: "write to Linear",
      description: `Write what the person did on a Linear card to Linear. A card sends a short command as the person's message: 'Save NEAT-10: status → In Progress; labels → A, B' (one line per issue), 'Comment on NEAT-10:' followed by the body, or 'Create in NEAT: <title>' followed by a properties line and an optional 'Description:' block. When a message starts with Save, Comment on, or Create in, call this IMMEDIATELY with the whole message verbatim in \`message\`; the plugin parses it. For your own edits use the structured fields instead. It writes through Linear's MCP server, re-reads the touched issues, and the card redraws from Linear's truth. ${CALL_FIRST}`,
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "A card's message, verbatim: starts with 'Save <id>:', 'Comment on <id>:', or 'Create in <team>:'." },
          changes: { type: "array", items: changeSchema, description: "Pill changes, one entry per issue. Only the fields that changed." },
          comment: { type: "object", properties: { identifier: { type: "string" }, body: { type: "string" } }, required: ["identifier", "body"] },
          create: { type: "object", properties: { team: { type: "string" }, title: { type: "string" }, description: { type: "string" }, state: { type: "string" }, priority: { type: "integer", minimum: 0, maximum: 4 }, assignee: { type: "string" }, project: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, required: ["team", "title"] },
        },
      },
      async run({ token, params, signal, startedAt, cache, ok }: ToolRun) {
        const parsed = typeof params.message === "string" ? parseCardMessage(params.message) : { changes: [] as Change[] };
        const changes: Change[] = [...parsed.changes, ...(params.changes ?? [])];
        const comment: Comment | undefined = params.comment ?? parsed.comment;
        const create: Create | undefined = params.create ?? parsed.create;
        if (!changes.length && !comment && !create) return ok("Nothing to apply: the message did not parse as a card command and no changes, comment, or create were passed.", { error: "Nothing to apply." });
        const applied: string[] = [];
        const touched = new Set<string>();
        await Promise.all(changes.map(async (c) => { await applyChange(token, c, signal); applied.push(describeChange(c)); touched.add(c.identifier.toUpperCase()); }));
        if (comment) { await postComment(token, comment, signal); applied.push(`${comment.identifier}: comment posted`); touched.add(comment.identifier.toUpperCase()); }
        if (create) { const id = await createIssue(token, create, signal); applied.push(`${id}: created`); touched.add(id.toUpperCase()); }
        const tWrite = ms(startedAt);
        const hint = [...touched][0] ?? create?.team ?? "";
        const { meta } = await teamContext(token, create?.team, hint, cache, signal);
        const fresh = (await Promise.all([...touched].map((id) => mcpCall(token, "get_issue", { id, fields: ISSUE_FIELDS }, signal).catch(() => undefined)))).filter((g) => g && (g as any).id).map(normalizeIssue) as Issue[];
        const comp: Composition = { view: fresh.length === 1 ? "issue" : "list", groupBy: "status", sort: "none", scope: "all", fields: { description: fresh.length === 1, labels: true, dates: false, assignee: true, project: true }, by: "fallback" };
        return ok(
          `Saved to Linear: ${applied.join("; ")} (Linear ${tWrite}, total ${ms(startedAt)}). The card shows the updated issue${fresh.length === 1 ? "" : "s"}; reply with one short line or nothing.`,
          { kind: "view", task: "Saved", team: meta.key, issues: fresh, options: optionsOf(meta), composition: comp, applied, timing: { linear: tWrite } },
        );
      },
    },
  ],
});
