/**
 * Linear writes, through the same MCP server and token the reads use. One `save_issue` per
 * changed issue, one `save_comment` per comment, one `save_issue` per create; then the touched
 * issues are re-read so the card shows what Linear actually saved.
 */
import { PRIORITY_NAMES } from "./read.ts";
import { mcpCall } from "./mcp.ts";

export type Change = { identifier: string; state?: string; priority?: number; assignee?: string | null; project?: string | null; labels?: string[] };
export type Create = { team: string; title: string; description?: string; state?: string; priority?: number; assignee?: string; project?: string; labels?: string[] };
export type Comment = { identifier: string; body: string };

const clean = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

/** Human line for one change, e.g. "NEAT-10: status → In Progress; labels → Decision, Design". */
export function describeChange(c: Change): string {
  const parts: string[] = [];
  if (c.state !== undefined) parts.push(`status → ${c.state}`);
  if (c.priority !== undefined) parts.push(`priority → ${PRIORITY_NAMES[c.priority] ?? c.priority}`);
  if (c.assignee !== undefined) parts.push(`assignee → ${c.assignee ?? "none"}`);
  if (c.project !== undefined) parts.push(`project → ${c.project ?? "none"}`);
  if (c.labels !== undefined) parts.push(`labels → ${c.labels.length ? c.labels.join(", ") : "none"}`);
  return `${c.identifier}: ${parts.join("; ")}`;
}

export async function applyChange(token: string, c: Change, signal?: AbortSignal): Promise<void> {
  const args = clean({ id: c.identifier, state: c.state, priority: c.priority, assignee: c.assignee, project: c.project, labels: c.labels });
  await mcpCall(token, "save_issue", args, signal);
}

export async function postComment(token: string, c: Comment, signal?: AbortSignal): Promise<void> {
  await mcpCall(token, "save_comment", { issueId: c.identifier, body: c.body }, signal);
}

/** Returns the new issue's identifier. */
export async function createIssue(token: string, c: Create, signal?: AbortSignal): Promise<string> {
  const args = clean({ team: c.team, title: c.title, description: c.description, state: c.state, priority: c.priority, assignee: c.assignee, project: c.project, labels: c.labels?.length ? c.labels : undefined });
  const r: any = await mcpCall(token, "save_issue", args, signal);
  const id = r?.identifier ?? r?.id ?? r?.issue?.identifier ?? r?.issue?.id;
  if (typeof id !== "string") throw new Error(`Linear created the issue but returned no identifier (${JSON.stringify(r).slice(0, 120)}).`);
  return id;
}
