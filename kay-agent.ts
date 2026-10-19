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
      },
      required: ["task", "issues"],
    },
    async execute(_id, params, signal) {
      const issues = params.issues ?? [];
      const n = issues.length;
      const byCount = () => ({ view: n === 1 ? "issue" : n > 6 ? "board" : "list", fields: { description: n === 1, labels: true, dates: n === 1, assignee: true }, by: "fallback" });
      const composition = await withJev(
        async (jev) => {
          const { answers } = await jev.classify({
            state: {
              task: params.task,
              count: n,
              sample: issues.slice(0, 6).map((i) => ({ identifier: i.identifier, title: i.title, state: i.state?.name, priority: i.priority, hasDescription: Boolean(i.description) })),
            },
            questions: {
              view: {
                type: "choice",
                instructions: "Pick the Linear view that answers the task best. Judge the task wording and how many issues there are.",
                criteria: {
                  issue: "One issue in full: title, description, properties. The task is about a single issue.",
                  list: "Several issues as compact rows, to scan or triage.",
                  board: "Several issues grouped by status, to see where work stands or what is blocked.",
                },
              },
              description: { type: "bool", instructions: "Should the view show each issue's description?", criteria: { true: "The task needs the body text to judge the issue.", false: "Titles and properties are enough." } },
              labels: { type: "bool", instructions: "Should the view show labels?", criteria: { true: "Labels help the task (categories, decisions, bugs).", false: "Labels are noise for this task." } },
              dates: { type: "bool", instructions: "Should the view show created and done dates?", criteria: { true: "Timing matters for the task.", false: "Timing does not matter." } },
              assignee: { type: "bool", instructions: "Should the view show the assignee?", criteria: { true: "Who owns each issue matters.", false: "Ownership does not matter for this task." } },
            },
          });
          const v = answers.view;
          if (v?.type !== "choice") return undefined;
          const yes = (k) => answers[k]?.type === "bool" && answers[k].probability >= 0.5;
          return { view: n === 1 && v.choice !== "issue" ? "issue" : v.choice, fields: { description: yes("description"), labels: yes("labels"), dates: yes("dates"), assignee: yes("assignee") }, by: "jev", confidence: v.confidence };
        },
        byCount,
        { timeoutMs: 4000, purpose: "linear-view", ...(signal ? { signal } : {}) },
      );
      const who = composition.by === "jev" ? "Jev picked" : "default pick, Jev unavailable";
      return {
        content: [{ type: "text", text: `Composed a ${composition.view} view of ${n} issue${n === 1 ? "" : "s"} (${who}). The card is the answer; add at most one short line.` }],
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
