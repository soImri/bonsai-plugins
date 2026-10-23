/**
 * Linear reads: the team, its pick lists (cached), and issues, normalised to the card's shapes.
 */
import type { DiskCache } from "../runtime.ts";
import { asList, mcpCall } from "./mcp.ts";

const META_TTL_MS = 10 * 60 * 1000;
const ISSUE_LIMIT = 50;
const DESCRIPTION_CAP = 700;

/* ---------- shapes the UI reads ---------- */
export type State = { name: string; type: string; position?: number };
export type Project = { name: string; summary?: string; lead?: string; targetDate?: string; status?: string };
export type Label = { name: string; description?: string };
export type Options = { states: State[]; projects: string[]; labels: string[]; members: string[] };
export type TeamRef = { id: string; key: string; name: string };
export type TeamMeta = TeamRef & { viewer: string; states: State[]; projects: Project[]; labels: Label[]; members: string[]; at: number };
export type Issue = {
  identifier: string; title: string; description?: string; url?: string;
  state: { name: string; type: string }; priority: number; assignee?: string; project?: string; labels: string[];
  createdAt?: string; completedAt?: string; updatedAt?: string;
};

export const PRIORITY_NAMES = ["No priority", "Urgent", "High", "Medium", "Low"];
export const optionsOf = (m: TeamMeta): Options => ({ states: m.states.map(({ name, type }) => ({ name, type })), projects: m.projects.map((p) => p.name), labels: m.labels.map((l) => l.name), members: m.members });

/* ---------- teams ---------- */
let teamsCache: { at: number; viewer: string; teams: TeamRef[] } | undefined;

export async function readTeams(token: string, signal?: AbortSignal) {
  if (teamsCache && Date.now() - teamsCache.at < META_TTL_MS) return teamsCache;
  const [t, me] = await Promise.all([mcpCall(token, "list_teams", { limit: 50 }, signal), mcpCall(token, "get_user", { id: "me" }, signal).catch(() => undefined)]);
  const teams: TeamRef[] = asList(t, "teams").map((x: any) => ({ id: x.id, key: x.key ?? x.identifier ?? String(x.name ?? "").toUpperCase(), name: x.name ?? x.key }));
  teamsCache = { at: Date.now(), viewer: (me as any)?.displayName ?? (me as any)?.name ?? "", teams };
  return teamsCache;
}

export function pickTeam(teams: TeamRef[], hint: string | undefined, text: string): TeamRef {
  const h = hint?.trim().toLowerCase();
  if (h) { const t = teams.find((t) => t.key.toLowerCase() === h || t.name.toLowerCase() === h); if (t) return t; }
  const id = text.match(/\b([A-Z][A-Z0-9]{1,9})-\d+\b/);
  if (id) { const t = teams.find((t) => t.key === id[1]); if (t) return t; }
  const lower = text.toLowerCase();
  return teams.find((t) => lower.includes(t.key.toLowerCase()) || lower.includes(t.name.toLowerCase())) ?? teams[0];
}

/* ---------- team meta (states, labels, projects, members) ---------- */
const metaCache = new Map<string, TeamMeta>();

/** Stale-while-revalidate: an old copy serves this call, a background refresh serves the next. */
export async function readMeta(token: string, team: TeamRef, viewer: string, cache: DiskCache, signal?: AbortSignal): Promise<TeamMeta> {
  const hit = metaCache.get(team.key);
  if (hit && Date.now() - hit.at < META_TTL_MS) return hit;
  const disk = hit ?? (await cache.read<TeamMeta>(`team-${team.key}`));
  if (disk) {
    metaCache.set(team.key, disk);
    if (Date.now() - disk.at >= META_TTL_MS) void fetchMeta(token, team, viewer, cache).catch(() => undefined);
    return disk;
  }
  return fetchMeta(token, team, viewer, cache, signal);
}

async function fetchMeta(token: string, team: TeamRef, viewer: string, cache: DiskCache, signal?: AbortSignal): Promise<TeamMeta> {
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
    states, members, labels,
    projects: asList(p, "projects").map((x: any) => ({ name: x.name, ...(x.summary || x.description ? { summary: String(x.summary || x.description).slice(0, 240) } : {}), ...(x.lead?.displayName || x.lead?.name || typeof x.lead === "string" ? { lead: x.lead?.displayName ?? x.lead?.name ?? x.lead } : {}), ...(x.targetDate ? { targetDate: x.targetDate } : {}), ...(x.status?.name || x.state ? { status: x.status?.name ?? x.state } : {}) })),
  };
  metaCache.set(team.key, meta);
  void cache.write(`team-${team.key}`, meta);
  return meta;
}

/** token → team → meta, the context every Linear tool starts from. */
export async function teamContext(token: string, hint: string | undefined, textForTeam: string, cache: DiskCache, signal?: AbortSignal) {
  const { teams, viewer } = await readTeams(token, signal);
  if (!teams.length) throw new Error("Bonsai's Linear account can see no teams.");
  const team = pickTeam(teams, hint, textForTeam);
  const meta = await readMeta(token, team, viewer, cache, signal);
  return { team, meta };
}

/* ---------- issues ---------- */
export const ISSUE_FIELDS = ["id", "title", "description", "priority", "url", "createdAt", "updatedAt", "completedAt", "status", "statusType", "labels", "assignee", "project", "team"];

/** Linear's MCP issue shape → the card's. `id` is the identifier (NEAT-11); priority may be {value,name} or a number. */
export function normalizeIssue(n: any): Issue {
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

export const isIdentifier = (s: string) => /^[A-Z][A-Z0-9]{1,9}-\d+$/.test(s.trim().toUpperCase());

export async function readIssues(token: string, team: TeamRef, p: { identifiers?: string[]; query?: string; project?: string; assignee?: string; limit?: number }, signal?: AbortSignal): Promise<Issue[]> {
  const ids = (p.identifiers ?? []).map((s) => s.trim().toUpperCase()).filter(isIdentifier);
  if (ids.length) {
    const got = await Promise.all(ids.map((id) => mcpCall(token, "get_issue", { id, fields: ISSUE_FIELDS }, signal).catch(() => undefined)));
    return got.filter((g) => g && (g as any).id).map(normalizeIssue);
  }
  const args: Record<string, unknown> = { team: team.name, limit: Math.min(Math.max(p.limit ?? ISSUE_LIMIT, 1), 100), orderBy: "updatedAt", fields: ISSUE_FIELDS };
  if (p.query) args.query = p.query;
  if (p.project) args.project = p.project;
  if (p.assignee) args.assignee = p.assignee;
  return asList(await mcpCall(token, "list_issues", args, signal), "issues").map(normalizeIssue);
}

export type Scope = "open" | "active" | "done" | "all";
const SCOPE_TYPES: Record<Scope, string[] | null> = { open: ["triage", "backlog", "unstarted", "started"], active: ["started"], done: ["completed"], all: null };
export const inScope = (i: Issue, s: Scope) => SCOPE_TYPES[s] === null || SCOPE_TYPES[s]!.includes(i.state.type);
