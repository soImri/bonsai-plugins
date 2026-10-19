/**
 * Connector cards — agent side.
 *
 * Two tools whose only job is to carry structured fields into the chat, where
 * this plugin's UI (kay-ui.tsx) draws them as Linear's own issue view and
 * create dialog. The agent reads from linear:// and creates through the Linear
 * MCP; these tools never touch Linear.
 */
const stateSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Workflow state name as Linear shows it, e.g. Todo, In Progress, Done." },
    type: { type: "string", enum: ["backlog", "unstarted", "started", "completed", "canceled"], description: "Linear state type." },
  },
  required: ["name"],
};

const issueFields = {
  identifier: { type: "string", description: "Issue identifier, e.g. NEAT-9." },
  title: { type: "string" },
  description: { type: "string", description: "Markdown body. Optional." },
  url: { type: "string", description: "Linear web URL. Optional." },
  state: stateSchema,
  priority: { type: "integer", minimum: 0, maximum: 4, description: "0 none, 1 urgent, 2 high, 3 medium, 4 low." },
  assignee: { type: "string", description: "Display name. Optional." },
  project: { type: "string", description: "Project name. Optional." },
  labels: { type: "array", items: { type: "string" } },
  createdAt: { type: "string", description: "ISO date. Optional." },
  completedAt: { type: "string", description: "ISO date. Optional." },
  commentDraft: { type: "string", description: "Prefill the card's comment box with this text (the person presses Comment to post). Optional." },
  options: {
    type: "object",
    description: "The team's pick lists so the card's pills can change values. Optional but recommended.",
    properties: {
      states: { type: "array", items: stateSchema },
      projects: { type: "array", items: { type: "string" } },
      labels: { type: "array", items: { type: "string" } },
      members: { type: "array", items: { type: "string" } },
    },
  },
};

const text = (t: string) => ({ content: [{ type: "text", text: t }], details: undefined });

const issueItem = { type: "object", properties: issueFields, required: ["identifier", "title", "state", "priority"] };
const optionsSchema = issueFields.options;

export const activate = (api) => {
  // Bonsai's Jev lane, when the host binds one. Without it the fallback decides.
  const withJev = typeof api.withJev === "function" ? api.withJev : (_use, fallback) => Promise.resolve(fallback());

  api.registerTool({
    name: "linearcards_view",
    label: "Linear view",
    description:
      "Show one or more Linear issues in the chat. Pass the person's request as task and the issues you read from linear:// (compact fields). Bonsai's Jev picks the view (one issue in full, a list of rows, or a board grouped by status) and which fields to show; the card draws it. Use for 'what's open', 'my issues', 'what's in progress', 'triage', or any ask about several issues.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "The person's request, in their words." },
        issues: { type: "array", items: issueItem },
        options: optionsSchema,
        project: { type: "object", description: "When the task is about one project, its header facts. Optional.", properties: { name: { type: "string" }, lead: { type: "string" }, targetDate: { type: "string" }, description: { type: "string" } }, required: ["name"] },
      },
      required: ["task", "issues"],
    },
    async execute(_id, params, signal) {
      const issues = params.issues ?? [];
      const n = issues.length;
      const byCount = () => ({ view: n === 1 ? "issue" : n > 6 ? "board" : "list", groupBy: "status", sort: "priority", fields: { description: n === 1, labels: true, dates: n === 1, assignee: true, project: true }, by: "fallback" });
      const composition = await withJev(
        async (jev) => {
          const sample = issues.slice(0, 8).map((i) => ({ identifier: i.identifier, title: i.title, state: i.state?.name, stateType: i.state?.type, priority: i.priority, project: i.project, assignee: i.assignee, labels: i.labels, hasDescription: Boolean(i.description) }));
          const projects = [...new Set(issues.map((i) => i.project).filter(Boolean))];
          const { answers } = await jev.classify({
            state: { task: params.task, count: n, distinctProjects: projects.length, projectNamed: params.project?.name ?? null, sample },
            questions: {
              view: {
                type: "choice",
                instructions: "Pick the Linear composition that answers the task. Judge the wording of the task first, then the count and shape of the issues. Examples: 'show NEAT-9' -> issue; 'what's open', 'my issues', 'triage', 'list the bugs' -> list; 'where do we stand', 'how is the team doing', 'standup', 'what's blocked', 'overview' -> board; 'how is <project> going', 'what's left in <project>', 'project status' -> project.",
                criteria: {
                  issue: "One issue in full: title, description, properties, comment box. The task names or is about a single issue, or there is exactly one issue.",
                  list: "Several issues as compact editable rows. The task is to see, scan, pick from, or triage issues; grouping would not help.",
                  board: "Several issues grouped under headers. The task is about where things stand, progress, what is blocked, an overview, a standup.",
                  project: "A project header with a progress bar and its issues grouped. The task is about one project as a whole: how it is going, what is left, its status.",
                },
              },
              groupBy: {
                type: "choice",
                instructions: "If the view groups issues, by which property? Examples: 'where do we stand', 'what's done', 'blocked' -> status; 'across projects', 'per project', 'what's left in each project' -> project; 'who owns what', 'per person', 'workload' -> assignee; 'what's urgent', 'by importance', 'triage' -> priority.",
                criteria: {
                  status: "The task is about progress, completion, or blockage.",
                  project: "The task compares or splits work across projects.",
                  assignee: "The task is about who owns what, workload, or hand-offs.",
                  priority: "The task is about urgency or importance.",
                },
              },
              sort: {
                type: "choice",
                instructions: "Order of the rows within the view or within each group.",
                criteria: {
                  priority: "Urgent first. The default for triage, open work, what to do next.",
                  newest: "Most recently created first. The task is about what came in, what is new, recent activity.",
                  none: "Keep Linear's order. The task does not care about order.",
                },
              },
              description: { type: "bool", instructions: "Show each issue's description text?", criteria: { true: "The task needs the body to judge or act (review, decide, understand one issue).", false: "Titles and properties are enough (scan, status, overview, triage)." } },
              labels: { type: "bool", instructions: "Show labels?", criteria: { true: "The task mentions a label or category (bug, decision, design), or triage.", false: "Labels do not help the task." } },
              dates: { type: "bool", instructions: "Show created and done dates?", criteria: { true: "Timing matters: recent, new, stale, how long, this week, deadlines.", false: "Timing does not matter." } },
              assignee: { type: "bool", instructions: "Show the assignee?", criteria: { true: "Ownership matters, more than one person is involved, or the task asks who.", false: "One person does everything here, or ownership is beside the point." } },
              project: { type: "bool", instructions: "Show the project of each issue?", criteria: { true: "Issues span more than one project, or the task mentions projects.", false: "All issues share one project, or the view already groups by project." } },
            },
          });
          const v = answers.view;
          if (v?.type !== "choice") return undefined;
          const pick = (k) => (answers[k]?.type === "choice" ? answers[k].choice : undefined);
          const yes = (k) => answers[k]?.type === "bool" && answers[k].probability >= 0.5;
          const view = n === 1 && v.choice !== "project" ? "issue" : v.choice;
          const groupBy = view === "project" ? (pick("groupBy") === "project" ? "status" : pick("groupBy") ?? "status") : pick("groupBy") ?? "status";
          return {
            view, groupBy, sort: pick("sort") ?? "priority",
            fields: { description: yes("description"), labels: yes("labels"), dates: yes("dates"), assignee: yes("assignee"), project: yes("project") && groupBy !== "project" },
            by: "jev", confidence: v.confidence,
          };
        },
        byCount,
        { timeoutMs: 5000, purpose: "linear-view", ...(signal ? { signal } : {}) },
      );
      const who = composition.by === "jev" ? "Jev picked" : "default pick, Jev unavailable";
      const how = composition.view === "board" || composition.view === "project" ? `, grouped by ${composition.groupBy}` : "";
      return {
        content: [{ type: "text", text: `Composed a ${composition.view} view of ${n} issue${n === 1 ? "" : "s"}${how} (${who}). The card is the answer; add at most one short line.` }],
        details: { composition },
      };
    },
  });

  api.registerTool({
    name: "linearcards_issue",
    label: "Linear issue card",
    description:
      "Show one Linear issue in the chat as a card in Linear's own issue layout (identifier, title, description, status, priority, assignee, project, labels). Read the issue from linear:// first, then pass its fields here, plus the team's pick lists in options so the pills are live. Use instead of describing an issue in prose.",
    parameters: { type: "object", properties: issueFields, required: ["identifier", "title", "state", "priority"] },
    async execute(_id, params) {
      return text(`Showing ${params.identifier} as a Linear issue card.`);
    },
  });

  api.registerTool({
    name: "linearcards_newissue",
    label: "Linear new issue",
    description:
      "Draft a new Linear issue in the chat as Linear's create dialog, prefilled with your proposal. The person edits title, description, status, priority, assignee, project and labels on the card and presses Create issue; the card then sends the final values back as a message. Call this instead of creating the issue yourself. Pass the team's real option lists (read from linear://) so the pickers are accurate.",
    parameters: {
      type: "object",
      properties: {
        team: { type: "string", description: "Team key, e.g. NEAT." },
        title: { type: "string" },
        description: { type: "string" },
        state: { type: "string", description: "Proposed state name, e.g. Todo." },
        priority: { type: "integer", minimum: 0, maximum: 4 },
        assignee: { type: "string" },
        project: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        options: {
          type: "object",
          description: "The team's pick lists, from linear://.",
          properties: {
            states: { type: "array", items: stateSchema },
            projects: { type: "array", items: { type: "string" } },
            labels: { type: "array", items: { type: "string" } },
            members: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["team", "title", "state", "priority"],
    },
    async execute(_id, params) {
      return text(
        `Draft of "${params.title}" shown as Linear's create dialog. Stop here. The person edits it on the card and presses Create issue; the card then sends a message with the final values. Create the issue only when that message arrives, then show the result with linearcards_issue.`,
      );
    },
  });
};
