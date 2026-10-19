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

export const activate = (api) => {
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
