/**
 * Connector cards — agent side (v2: the plugin does the work).
 *
 * One small tool call per ask. The agent passes words; the tool reads Linear through Bonsai's own
 * Linear connection (a consented shared-identity grant on linear.account), asks Jev once which
 * composition, scope and fields fit the task, and hands the UI (kay-ui.tsx) a render-ready
 * payload in the result's `details`. Writes still go through the Linear MCP behind Bonsai's
 * normal approvals; these tools never write.
 *
 * Why: measured on 2026-10-20, a create-card ask took 2m27s, of which the tool itself took ~0ms.
 * The time was nine agent round trips reading primers, schemas and pick lists. Moving the reads
 * here makes the agent's part one call with ~100 bytes of arguments.
 */
import { withResolvedAuth } from "@bonsai/plugin-sdk/kay-agent";

const LINEAR_AUTH = { serviceId: "linear.account", schemeId: "linear.mcp-oauth" } as const;
// Bonsai's Linear token is minted for Linear's MCP server (api.linear.app/graphql answers 401 to it,
// measured 2026-10-23), so reads speak MCP JSON-RPC over Streamable HTTP to that server.
const MCP_URL = "https://mcp.linear.app/mcp";
const MCP_PROTOCOL = "2025-06-18";
const META_TTL_MS = 10 * 60 * 1000;
/** The hosted Jev route answers 400 to a rubric of more than 8 questions (measured 2026-10-23: 8 answered, 9 and 10 refused). */
const JEV_MAX_QUESTIONS = 8;
const ISSUE_LIMIT = 50;
const DESCRIPTION_CAP = 700;

/* ---------- shapes the UI reads ---------- */
type State = { name: string; type: string; position?: number };
type Project = { name: string; summary?: string; lead?: string; targetDate?: string; status?: string };
type Label = { name: string; description?: string };
type Options = { states: State[]; projects: string[]; labels: string[]; members: string[] };
type TeamMeta = { id: string; key: string; name: string; viewer: string; states: State[]; projects: Project[]; labels: Label[]; members: string[]; at: number };
type Issue = {
  identifier: string; title: string; description?: string; url?: string;
  state: { name: string; type: string }; priority: number; assignee?: string; project?: string; labels: string[];
  createdAt?: string; completedAt?: string; updatedAt?: string;
};
type Scope = "open" | "active" | "done" | "all";
type Composition = {
  view: "issue" | "list" | "board" | "project"; groupBy: "status" | "project" | "assignee" | "priority"; sort: "priority" | "newest" | "none";
  scope: Scope; fields: { description: boolean; labels: boolean; dates: boolean; assignee: boolean; project: boolean };
  by: "jev" | "fallback"; confidence?: number;
};

/* ---------- Linear MCP (JSON-RPC over Streamable HTTP) ---------- */
class LinearHttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

type McpSession = { id?: string; protocol: string; at: number };
const mcpSessions = new Map<string, McpSession>(); // by token
let rpcId = 1;

function mcpHeaders(token: string, s?: McpSession): Record<string, string> {
  return {
    "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`,
    ...(s ? { "mcp-protocol-version": s.protocol } : {}), ...(s?.id ? { "mcp-session-id": s.id } : {}),
  };
}

/** One JSON-RPC response from a plain JSON or an SSE body. */
async function readRpc(res: Response, id: number): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!res.ok) throw new LinearHttpError(res.status, `Linear's MCP server answered ${res.status}: ${body.slice(0, 160)}`);
  if (!body.trim()) return undefined;
  const pick = (m: any) => (Array.isArray(m) ? m.find((x) => x?.id === id) ?? m[0] : m);
  if (ct.includes("text/event-stream")) {
    let last: any;
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try { const m = pick(JSON.parse(line.slice(5).trim())); if (m && (m.id === id || m.result || m.error)) { last = m; if (m.id === id) break; } } catch { /* keep-alive or partial */ }
    }
    return last;
  }
  return pick(JSON.parse(body));
}

async function mcpConnect(token: string, signal?: AbortSignal): Promise<McpSession> {
  const hit = mcpSessions.get(token);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit;
  const id = rpcId++;
  const res = await fetch(MCP_URL, { method: "POST", headers: mcpHeaders(token), body: JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "connector-cards", version: "0.2" } } }), ...(signal ? { signal } : {}) });
  const msg = await readRpc(res, id);
  if (msg?.error) throw new Error(`Linear MCP initialize: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  const session: McpSession = { ...(res.headers.get("mcp-session-id") ? { id: res.headers.get("mcp-session-id")! } : {}), protocol: msg?.result?.protocolVersion ?? MCP_PROTOCOL, at: Date.now() };
  await fetch(MCP_URL, { method: "POST", headers: mcpHeaders(token, session), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), ...(signal ? { signal } : {}) }).catch(() => undefined);
  mcpSessions.set(token, session);
  return session;
}

async function mcpCall<T = any>(token: string, name: string, args: Record<string, unknown>, signal?: AbortSignal, retry = true): Promise<T> {
  const session = await mcpConnect(token, signal);
  const id = rpcId++;
  const res = await fetch(MCP_URL, { method: "POST", headers: mcpHeaders(token, session), body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }), ...(signal ? { signal } : {}) });
  if ((res.status === 404 || res.status === 400) && session.id && retry) { mcpSessions.delete(token); return mcpCall(token, name, args, signal, false); }
  const msg = await readRpc(res, id);
  if (!msg) throw new Error(`Linear MCP ${name}: empty response`);
  if (msg.error) throw new Error(`Linear MCP ${name}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  const content: any[] = msg.result?.content ?? [];
  const text = content.find((c) => c?.type === "text")?.text ?? "";
  if (msg.result?.isError) throw new Error(`Linear MCP ${name}: ${text.slice(0, 200) || "tool error"}`);
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

const asList = (r: any, key: string): any[] => (Array.isArray(r) ? r : Array.isArray(r?.[key]) ? r[key] : Array.isArray(r?.nodes) ? r.nodes : []);

type TeamRef = { id: string; key: string; name: string };
let teamsCache: { at: number; viewer: string; teams: TeamRef[] } | undefined;
const metaCache = new Map<string, TeamMeta>();

async function readTeams(token: string, signal?: AbortSignal) {
  if (teamsCache && Date.now() - teamsCache.at < META_TTL_MS) return teamsCache;
  const [t, me] = await Promise.all([mcpCall(token, "list_teams", { limit: 50 }, signal), mcpCall(token, "get_user", { id: "me" }, signal).catch(() => undefined)]);
  const teams: TeamRef[] = asList(t, "teams").map((x: any) => ({ id: x.id, key: x.key ?? x.identifier ?? String(x.name ?? "").toUpperCase(), name: x.name ?? x.key }));
  const viewer = (me as any)?.displayName ?? (me as any)?.name ?? "";
  teamsCache = { at: Date.now(), viewer, teams };
  return teamsCache;
}

function pickTeam(teams: TeamRef[], hint: string | undefined, text: string): TeamRef {
  const h = hint?.trim().toLowerCase();
  if (h) { const t = teams.find((t) => t.key.toLowerCase() === h || t.name.toLowerCase() === h); if (t) return t; }
  const id = text.match(/\b([A-Z][A-Z0-9]{1,9})-\d+\b/);
  if (id) { const t = teams.find((t) => t.key === id[1]); if (t) return t; }
  const lower = text.toLowerCase();
  const named = teams.find((t) => lower.includes(t.key.toLowerCase()) || lower.includes(t.name.toLowerCase()));
  return named ?? teams[0];
}

async function readMeta(token: string, team: TeamRef, viewer: string, dataDir: string | undefined, signal?: AbortSignal): Promise<TeamMeta> {
  const hit = metaCache.get(team.key);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit;
  const disk = hit ?? (await readDisk(dataDir, team.key));
  if (disk) {
    // Stale-while-revalidate: pick lists change rarely, so an old copy serves this call and a
    // background refresh serves the next one. Keeps the plugin's part at one Linear round trip.
    metaCache.set(team.key, disk);
    if (Date.now() - disk.at >= META_TTL_MS) void fetchMeta(token, team, viewer, dataDir).catch(() => undefined);
    return disk;
  }
  return fetchMeta(token, team, viewer, dataDir, signal);
}

async function fetchMeta(token: string, team: TeamRef, viewer: string, dataDir: string | undefined, signal?: AbortSignal): Promise<TeamMeta> {
  const t = team.name;
  const [s, l, p, u] = await Promise.all([
    mcpCall(token, "list_issue_statuses", { team: t }, signal),
    mcpCall(token, "list_issue_labels", { team: t, limit: 100 }, signal),
    mcpCall(token, "list_projects", { team: t, limit: 50 }, signal),
    mcpCall(token, "list_users", { team: t, limit: 100 }, signal),
  ]);
  const TYPE_ORDER = ["triage", "backlog", "unstarted", "started", "completed", "canceled", "duplicate"];
  const states: State[] = asList(s, "statuses").map((x: any, i: number) => ({ name: x.name, type: x.type, position: typeof x.position === "number" ? x.position : TYPE_ORDER.indexOf(x.type) * 100 + i })).filter((x: State) => x.type !== "duplicate").sort((a: State, b: State) => (a.position ?? 0) - (b.position ?? 0));
  const seen = new Set<string>();
  const labels: Label[] = asList(l, "labels").filter((x: any) => !x.isGroup && !x.retiredAt && !x.archivedAt).filter((x: any) => (seen.has(x.name) ? false : (seen.add(x.name), true))).map((x: any) => ({ name: x.name, ...(x.description ? { description: x.description } : {}) }));
  const members: string[] = asList(u, "users").filter((m: any) => m.isActive !== false).map((m: any) => m.displayName ?? m.name).filter(Boolean);
  const meta: TeamMeta = {
    // `get_user {id:"me"}` does not resolve on Linear's MCP server; on a one-person team that person is the viewer.
    id: team.id, key: team.key, name: team.name, viewer: viewer || (members.length === 1 ? members[0] : ""), at: Date.now(),
    states,
    members,
    labels,
    projects: asList(p, "projects").map((x: any) => ({ name: x.name, ...(x.summary || x.description ? { summary: String(x.summary || x.description).slice(0, 240) } : {}), ...(x.lead?.displayName || x.lead?.name || typeof x.lead === "string" ? { lead: x.lead?.displayName ?? x.lead?.name ?? x.lead } : {}), ...(x.targetDate ? { targetDate: x.targetDate } : {}), ...(x.status?.name || x.state ? { status: x.status?.name ?? x.state } : {}) })),
  };
  metaCache.set(team.key, meta);
  void writeDisk(dataDir, team.key, meta);
  return meta;
}

async function readDisk(dataDir: string | undefined, key: string): Promise<TeamMeta | undefined> {
  if (!dataDir) return undefined;
  try { const { readFile } = await import("node:fs/promises"); return JSON.parse(await readFile(`${dataDir}/team-${key}.json`, "utf8")) as TeamMeta; } catch { return undefined; }
}
async function writeDisk(dataDir: string | undefined, key: string, meta: TeamMeta) {
  if (!dataDir) return;
  try { const { writeFile } = await import("node:fs/promises"); await writeFile(`${dataDir}/team-${key}.json`, JSON.stringify(meta), "utf8"); } catch { /* cache only */ }
}

const optionsOf = (m: TeamMeta): Options => ({ states: m.states.map(({ name, type }) => ({ name, type })), projects: m.projects.map((p) => p.name), labels: m.labels.map((l) => l.name), members: m.members });

const ISSUE_FIELDS = ["id", "title", "description", "priority", "url", "createdAt", "updatedAt", "completedAt", "status", "statusType", "labels", "assignee", "project", "team"];

/** Linear's MCP issue shape → the card's. `id` is the identifier (NEAT-11); priority may be {value,name} or a number. */
function normalizeIssue(n: any): Issue {
  const desc = typeof n.description === "string" ? n.description : "";
  const pr = typeof n.priority === "object" && n.priority ? n.priority.value : n.priority;
  const assignee = typeof n.assignee === "string" ? n.assignee : n.assignee?.displayName ?? n.assignee?.name;
  const project = typeof n.project === "string" ? n.project : n.project?.name;
  const labels: string[] = Array.isArray(n.labels) ? n.labels.map((l: any) => (typeof l === "string" ? l : l?.name)).filter(Boolean) : [];
  return {
    identifier: n.identifier ?? n.id, title: n.title ?? "", ...(n.url ? { url: n.url } : {}),
    ...(desc ? { description: desc.length > DESCRIPTION_CAP ? `${desc.slice(0, DESCRIPTION_CAP)}…` : desc } : {}),
    state: { name: n.status ?? n.state?.name ?? "Unknown", type: n.statusType ?? n.state?.type ?? "unstarted" }, priority: typeof pr === "number" ? pr : 0,
    ...(assignee ? { assignee } : {}), ...(project ? { project } : {}),
    labels, ...(n.createdAt ? { createdAt: n.createdAt } : {}), ...(n.updatedAt ? { updatedAt: n.updatedAt } : {}), ...(n.completedAt ? { completedAt: n.completedAt } : {}),
  };
}

async function readIssues(token: string, team: TeamRef, p: { identifiers?: string[]; query?: string; project?: string; assignee?: string; limit?: number }, signal?: AbortSignal): Promise<Issue[]> {
  const ids = (p.identifiers ?? []).map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(s));
  if (ids.length) {
    const got = await Promise.all(ids.map((id) => mcpCall(token, "get_issue", { id, fields: ISSUE_FIELDS }, signal).catch(() => undefined)));
    return got.filter((g) => g && (g as any).id).map(normalizeIssue);
  }
  const args: Record<string, unknown> = { team: team.name, limit: Math.min(Math.max(p.limit ?? ISSUE_LIMIT, 1), 100), orderBy: "updatedAt", fields: ISSUE_FIELDS };
  if (p.query) args.query = p.query;
  if (p.project) args.project = p.project;
  if (p.assignee) args.assignee = p.assignee;
  const r = await mcpCall(token, "list_issues", args, signal);
  return asList(r, "issues").map(normalizeIssue);
}

const SCOPE_TYPES: Record<Scope, string[] | null> = { open: ["triage", "backlog", "unstarted", "started"], active: ["started"], done: ["completed"], all: null };
const inScope = (i: Issue, s: Scope) => SCOPE_TYPES[s] === null || SCOPE_TYPES[s]!.includes(i.state.type);

/* ---------- heuristics (the behaviour without Jev) ---------- */
function guessScope(task: string): Scope {
  const t = task.toLowerCase();
  if (/\b(done|shipped|completed|closed|finished)\b/.test(t)) return "done";
  if (/\b(in progress|working on|wip|being worked)\b/.test(t)) return "active";
  if (/\b(all|everything|every issue|whole|entire|where do we stand|overview|board)\b/.test(t)) return "all";
  return "open";
}
function guessComposition(task: string, n: number, projectNamed: boolean): Composition {
  const t = task.toLowerCase();
  const view = n === 1 ? "issue" : projectNamed || /\bproject\b|how is .+ going|what'?s left in/.test(t) ? "project" : /\b(board|standup|where do we stand|overview|blocked|progress|who owns|per person|workload)\b/.test(t) ? "board" : "list";
  const groupBy = /\b(who|per person|workload|owns)\b/.test(t) ? "assignee" : /\b(urgent|priority|importance)\b/.test(t) ? "priority" : /\b(across projects|per project|each project)\b/.test(t) ? "project" : "status";
  return { view, groupBy, sort: /\b(new|recent|latest|came in)\b/.test(t) ? "newest" : "priority", scope: guessScope(task), fields: { description: n === 1, labels: true, dates: /\b(new|recent|stale|week|deadline|when|old)\b/.test(t), assignee: true, project: !projectNamed }, by: "fallback" };
}
function guessPriority(text: string): number {
  const t = text.toLowerCase();
  if (/\burgent\b|\bp0\b|asap|critical/.test(t)) return 1;
  if (/\bhigh\b|\bp1\b|important/.test(t)) return 2;
  if (/\bmedium\b|\bp2\b|normal/.test(t)) return 3;
  if (/\blow\b|\bp3\b|minor|someday/.test(t)) return 4;
  return 0;
}
function deriveTitle(task: string): string {
  let t = task.trim().replace(/^(please\s+)?(can you\s+|could you\s+)?(create|open|file|make|add|log|draft)\s+(a\s+|an\s+)?(new\s+)?(linear\s+)?(ticket|issue|task|bug|story)\s*(to|for|about|that|:|-|—)?\s*/i, "");
  t = t.split(/[.;\n]|,\s*(set|with|priority|assign)/i)[0].trim();
  if (!t) t = task.trim();
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 80 ? `${t.slice(0, 77).trimEnd()}…` : t;
}

/* ---------- results ---------- */
const text = (t: string, details?: unknown) => ({ content: [{ type: "text" as const, text: t }], details });
const ms = (from: number) => `${Date.now() - from} ms`;
function failure(err: unknown, context: string) {
  const e = err as Error & { status?: number };
  const why = e instanceof LinearHttpError
    ? (e.status === 401 || e.status === 403 ? `Linear's MCP server rejected Bonsai's Linear token (HTTP ${e.status}). Reconnect Linear (service_connect linear.account) and try again.` : e.message)
    : (e?.name === "AbortError" ? "The call was cancelled." : (e?.message ?? String(err)));
  return text(`Could not ${context}: ${why}`, { error: why });
}

type ToolParams = Record<string, any>;

/**
 * Jev with a shrinking rubric. The hosted gateway answers 400 (in ~50 ms) to a rubric above some
 * size: measured 2026-10-23, 10 questions failed in every envelope shape and 1 question answered.
 * Questions are passed most-important-first; on a 400 the tail is dropped and the call retried, so
 * the caller always gets the answers that matter most. The size that answered is reported.
 */
async function classifyAdaptive(jev: any, state: object, questions: Record<string, any>): Promise<{ answers: Record<string, any>; variant: string }> {
  const keys = Object.keys(questions);
  const sizes = [Math.min(keys.length, JEV_MAX_QUESTIONS), 6, 4, 2, 1].filter((n, i, a) => n >= 1 && n <= keys.length && a.indexOf(n) === i);
  let lastErr: unknown;
  for (const n of sizes) {
    try {
      const { answers } = await jev.classify({ state, questions: Object.fromEntries(keys.slice(0, n).map((k) => [k, questions[k]])) });
      return { answers, variant: `${n}/${keys.length}` };
    } catch (err) {
      lastErr = err;
      if ((err as any)?.kind !== "http" || (err as any)?.status !== 400) throw err;
    }
  }
  throw lastErr;
}

export function activate(api: any) {
  const withJev = typeof api.withJev === "function" ? api.withJev : (_use: unknown, fallback: () => unknown) => Promise.resolve(fallback());

  // Shared: token → team → meta, one place so every tool sees the same caches.
  async function context(token: string, hint: string | undefined, textForTeam: string, ctx: any, signal?: AbortSignal) {
    const { teams, viewer } = await readTeams(token, signal);
    if (!teams.length) throw new Error("Bonsai's Linear account can see no teams.");
    const team = pickTeam(teams, hint, textForTeam);
    const meta = await readMeta(token, team, viewer, ctx?.paths?.dataDir, signal);
    return { team, meta };
  }

  /* ---- linearcards_view ---- */
  api.registerTool(withResolvedAuth(
    {
      name: "linearcards_view",
      label: "Linear view",
      description:
        "Show Linear issues in the chat as Linear's own UI. Call this FIRST, with the person's words: it reads Linear itself (no linear:// or mcp reads needed), Jev picks the view (one issue, a list, a board, or a project view) plus scope and fields, and the card draws it. Use for 'what's open', 'my issues', 'what's in progress', 'triage', 'where do we stand', 'how is <project> going', 'show NEAT-9', or any ask about issues. Pass identifiers when the ask names them, query only when it names a topic. After it returns, reply with at most one short line.",
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
    },
    LINEAR_AUTH,
    async (_id: string, params: ToolParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any, auth: { accessToken: string }) => {
      const t0 = Date.now();
      try {
        const { team, meta } = await context(auth.accessToken, params.team, `${params.task} ${(params.identifiers ?? []).join(" ")}`, ctx, signal);
        const all = await readIssues(auth.accessToken, team, params, signal);
        const tFetch = ms(t0);
        const projectNamed = Boolean(params.project);
        const byType = { open: all.filter((i) => inScope(i, "open")).length, active: all.filter((i) => inScope(i, "active")).length, done: all.filter((i) => inScope(i, "done")).length, total: all.length };
        const sample = all.slice(0, 8).map((i) => ({ identifier: i.identifier, title: i.title, state: i.state.name, stateType: i.state.type, priority: i.priority, project: i.project ?? "none", assignee: i.assignee ?? "none", labels: i.labels.join(", ") || "none", hasDescription: Boolean(i.description) }));
        const tJev0 = Date.now();
        const comp: Composition = await withJev(
          async (jev: any) => {
            const { answers, variant } = await classifyAdaptive(jev,
              { task: params.task, openCount: byType.open, activeCount: byType.active, doneCount: byType.done, totalCount: byType.total, identifiersNamed: (params.identifiers ?? []).join(", ") || "none", projectNamed: params.project ?? "none", distinctProjects: new Set(all.map((i) => i.project).filter(Boolean)).size, sample },
              // Most important first: the tail is what a size-limited Jev route loses.
              {
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
                // 8 is the hosted route's limit; `project` (show the project column) comes from the heuristic.
              },
            );
            const pick = (k: string) => (answers[k]?.type === "choice" ? answers[k].choice : undefined);
            const guess = guessComposition(params.task, all.length, projectNamed);
            // A question the shrunken rubric dropped falls back to the heuristic's answer for that field.
            const yes = (k: keyof Composition["fields"]) => (answers[k]?.type === "bool" ? answers[k].probability >= 0.5 : guess.fields[k]);
            if (!pick("view")) return undefined;
            const groupBy = (pick("groupBy") ?? guess.groupBy) as Composition["groupBy"];
            return { view: pick("view"), groupBy, sort: pick("sort") ?? guess.sort, scope: (params.identifiers?.length ? "all" : pick("scope") ?? guess.scope), fields: { description: yes("description"), labels: yes("labels"), dates: yes("dates"), assignee: yes("assignee"), project: yes("project") && groupBy !== "project" }, by: "jev", confidence: answers.view.confidence, variant } as Composition & { variant: string };
          },
          () => ({ ...guessComposition(params.task, all.length, projectNamed), scope: params.identifiers?.length ? "all" : guessScope(params.task) } as Composition),
          { timeoutMs: 6000, purpose: "linear-view", ...(signal ? { signal } : {}) },
        );
        const tJev = ms(tJev0);
        let issues = all.filter((i) => inScope(i, comp.scope));
        if (!issues.length && all.length) { issues = all; comp.scope = "all"; }
        if (issues.length === 1 && comp.view !== "project") comp.view = "issue";
        if (issues.length > 1 && comp.view === "issue") comp.view = "list";
        if (comp.view === "project" && comp.groupBy === "project") comp.groupBy = "status";
        if (comp.view === "issue") comp.fields.description = true;
        const project = comp.view === "project" ? (meta.projects.find((p) => p.name.toLowerCase() === (params.project ?? issues[0]?.project ?? "").toLowerCase()) ?? (params.project ? { name: params.project } : undefined)) : undefined;
        const who = comp.by === "jev" ? `Jev picked, ${(comp as any).variant} questions answered` : "default pick, Jev unavailable";
        const how = comp.view === "board" || comp.view === "project" ? ` grouped by ${comp.groupBy}` : "";
        if (!issues.length) return text(`No ${comp.scope === "all" ? "" : `${comp.scope} `}issues in ${team.key} match. Say so in one line.`, { kind: "view", task: params.task, team: team.key, issues: [], options: optionsOf(meta), composition: comp, timing: { linear: tFetch, jev: tJev } });
        return text(
          `Showing ${issues.length} ${team.key} issue${issues.length === 1 ? "" : "s"} as a ${comp.view} view${how}, scope ${comp.scope} (${who}; Linear ${tFetch}, Jev ${tJev}). The card is the answer: reply with one short line or nothing. Never restate its fields.`,
          { kind: "view", task: params.task, team: team.key, issues, options: optionsOf(meta), ...(project ? { project: { name: project.name, ...(project.lead ? { lead: project.lead } : {}), ...(project.targetDate ? { targetDate: project.targetDate } : {}), ...(project.summary ? { description: project.summary } : {}) } } : {}), composition: comp, timing: { linear: tFetch, jev: tJev } },
        );
      } catch (err) { return failure(err, "read Linear for the view"); }
    },
  ));

  /* ---- linearcards_issue ---- */
  api.registerTool(withResolvedAuth(
    {
      name: "linearcards_issue",
      label: "Linear issue card",
      description:
        "Show one Linear issue in the chat as Linear's own issue view. Call this FIRST with just the identifier: it reads the issue and the team's pick lists itself (no linear:// read needed) and the card draws it with live pills. Use for 'show NEAT-9', 'what's the status of NEAT-9', 'open NEAT-9', and for 'comment on NEAT-9 that …' (pass commentDraft). After it returns, reply with at most one short line.",
      parameters: {
        type: "object",
        properties: {
          identifier: { type: "string", description: "Issue identifier, e.g. NEAT-9." },
          commentDraft: { type: "string", description: "Prefill the card's comment box with this text; the person presses Comment to post. Optional." },
        },
        required: ["identifier"],
      },
    },
    LINEAR_AUTH,
    async (_id: string, params: ToolParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any, auth: { accessToken: string }) => {
      const t0 = Date.now();
      try {
        const { meta } = await context(auth.accessToken, undefined, params.identifier, ctx, signal);
        const [issue] = await readIssues(auth.accessToken, { id: meta.id, key: meta.key, name: meta.name }, { identifiers: [params.identifier] }, signal);
        if (!issue) return text(`No issue ${params.identifier} is visible to Bonsai's Linear account. Say so in one line.`, { error: `No issue ${params.identifier}.` });
        const full = { ...issue, options: optionsOf(meta), ...(params.commentDraft ? { commentDraft: params.commentDraft } : {}) };
        return text(`Showing ${issue.identifier} as a Linear issue card (Linear ${ms(t0)}). The card is the answer: reply with one short line or nothing.`, { kind: "issue", issue: full, timing: { linear: ms(t0) } });
      } catch (err) { return failure(err, `read ${params.identifier}`); }
    },
  ));

  /* ---- linearcards_newissue ---- */
  api.registerTool(withResolvedAuth(
    {
      name: "linearcards_newissue",
      label: "Linear new issue",
      description:
        "Draft a new Linear issue in the chat as Linear's create dialog. Call this FIRST, in your first step, with the person's words plus a short title: it reads the team's states, projects, labels and members itself (no linear:// or mcp reads, no repo research), Jev picks status, priority, project, labels and assignee from the task, and the person edits the card and presses Create issue. Do not create anything yourself. After it returns, stop; the card sends a 'Create Linear issue' message when the person is ready.",
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
    },
    LINEAR_AUTH,
    async (_id: string, params: ToolParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any, auth: { accessToken: string }) => {
      const t0 = Date.now();
      try {
        const { team, meta } = await context(auth.accessToken, params.team, params.task, ctx, signal);
        const tFetch = ms(t0);
        const title = (params.title?.trim() || deriveTitle(params.task)).slice(0, 120);
        const description = params.description?.trim() ?? "";
        const defaultState = meta.states.find((s) => s.type === "unstarted") ?? meta.states.find((s) => s.type === "backlog") ?? meta.states[0];
        const fallback = () => ({
          state: defaultState?.name, priority: guessPriority(params.task), project: undefined as string | undefined, labels: [] as string[],
          assignee: /\b(me|my|myself|i'?ll)\b/i.test(params.task) || meta.members.length === 1 ? meta.viewer : undefined, by: "fallback" as const,
        });
        const tJev0 = Date.now();
        const picks = await withJev(
          async (jev: any) => {
            // Plain token keys only (p0, s1, label_2): names with spaces or punctuation are mapped back after the answer.
            const projects = meta.projects.slice(0, 12);
            const projectCriteria: Record<string, string> = { none: "The task does not belong to any listed project." };
            projects.forEach((p, i) => { projectCriteria[`p${i}`] = p.summary ? `Project "${p.name}": ${p.summary}` : `The project named "${p.name}".`; });
            const openStates = meta.states.filter((s) => s.type !== "completed" && s.type !== "canceled");
            const stateCriteria: Record<string, string> = {};
            openStates.forEach((s, i) => { stateCriteria[`s${i}`] = s.type === "unstarted" ? `"${s.name}": normal new work, ready to pick up. The default.` : s.type === "backlog" ? `"${s.name}": someday, not now, parked, low commitment.` : s.type === "started" ? `"${s.name}": already being worked on right now.` : `"${s.name}": needs triage first.`; });
            // Order = importance; the hosted route answers at most 8. Priority and project first, then
            // the labels (where Jev adds the most), then state; assignee stays on the heuristic when cut.
            const labelsAsked = meta.labels.slice(0, JEV_MAX_QUESTIONS - 3);
            const questions: Record<string, any> = {
              priority: { type: "choice", instructions: "Which priority does the task state or imply? Explicit words win: 'urgent', 'high', 'medium', 'low'. Without a word: a blocker or outage -> urgent; a must-do soon -> high; ordinary work -> medium; nice-to-have -> low; no signal -> none.", criteria: { none: "No priority stated or implied.", urgent: "Urgent, critical, blocker, ASAP, P0.", high: "High, important, soon, P1.", medium: "Medium, normal, P2, or ordinary planned work.", low: "Low, minor, someday, P3." } },
              project: { type: "choice", instructions: "Which project does this issue belong to, judged by its name and summary against the task? Choose none when no project fits well.", criteria: projectCriteria },
            };
            labelsAsked.forEach((l, i) => { questions[`label_${i}`] = { type: "bool", instructions: `Apply the label "${l.name}"?`, criteria: { true: l.description ? `The task matches this label: ${l.description}` : `The task is about ${l.name.toLowerCase()}.`, false: "The label does not fit the task." } }; });
            questions.state = { type: "choice", instructions: "Which workflow state should the new issue start in? Default to the ordinary 'ready to pick up' state unless the task says it is already in progress or parked for later.", criteria: stateCriteria };
            questions.assignToMe = { type: "bool", instructions: "Should the issue be assigned to the person asking?", criteria: { true: "The task says me, my, I will, mine, or the team has one member who does everything.", false: "The task names someone else or says nothing about ownership on a multi-person team." } };
            const { answers, variant } = await classifyAdaptive(jev, { task: params.task, title, description: description || "none", teamMembers: meta.members.join(", ") || "none", viewer: meta.viewer || "unknown" }, questions);
            if (answers.priority?.type !== "choice") return undefined;
            const pr = { none: 0, urgent: 1, high: 2, medium: 3, low: 4 }[answers.priority.choice as string] ?? 0;
            const explicit = guessPriority(params.task);
            const labels = labelsAsked.filter((_, i) => answers[`label_${i}`]?.type === "bool" && answers[`label_${i}`].probability >= 0.6).map((l) => l.name);
            const projectPick = answers.project?.type === "choice" && answers.project.choice !== "none" && answers.project.confidence >= 0.4 ? projects[Number(String(answers.project.choice).slice(1))] : undefined;
            const project = projectPick?.name;
            const statePick = answers.state?.type === "choice" ? openStates[Number(String(answers.state.choice).slice(1))] : undefined;
            const assignee = answers.assignToMe?.type === "bool" ? (answers.assignToMe.probability >= 0.5 ? meta.viewer : undefined) : fallback().assignee;
            return { state: statePick?.name ?? defaultState?.name, priority: explicit || pr, project, labels, assignee, by: "jev" as const, confidence: answers.priority.confidence, variant };
          },
          fallback,
          { timeoutMs: 6000, purpose: "linear-new-issue", ...(signal ? { signal } : {}) },
        );
        const tJev = ms(tJev0);
        const draft = { team: team.key, title, description, state: picks.state, priority: picks.priority, ...(picks.assignee ? { assignee: picks.assignee } : {}), ...(picks.project ? { project: picks.project } : {}), labels: picks.labels, options: optionsOf(meta) };
        const summary = [draft.state, ["No priority", "Urgent", "High", "Medium", "Low"][draft.priority], draft.project, draft.labels.join(", "), draft.assignee].filter(Boolean).join(" · ");
        return text(
          `Draft "${title}" shown as Linear's create dialog with ${summary} (${picks.by === "jev" ? `Jev picked, ${(picks as any).variant} questions answered` : "default pick, Jev unavailable"}; Linear ${tFetch}, Jev ${tJev}). Stop here with at most one short line. The person edits the card and presses Create issue; a 'Create Linear issue' message then arrives with the final JSON. Only then create it: mcp(server: "linear", tool: "save_issue", args: {team, title, description, state, priority, assignee, project, labels}), then call linearcards_issue with the new identifier.`,
          { kind: "draft", draft, picks: { by: picks.by, confidence: (picks as any).confidence }, timing: { linear: tFetch, jev: tJev } },
        );
      } catch (err) { return failure(err, "prepare the draft"); }
    },
  ));
}

export default activate;
