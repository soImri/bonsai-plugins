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
export type CardRequest = { changes: Change[]; comment?: Comment; create?: Create };

/**
 * The card speaks a small human grammar in the chat, so the bubble reads like a command and the
 * plugin, not the agent, turns it into writes. Lines:
 *   Save NEAT-10: status → In Progress; priority → Low; assignee → none; project → Evals v1; labels → A, B
 *   Comment on NEAT-10:\n<body…>
 *   Create in NEAT: <title>\nstatus → …; priority → …; assignee → …; project → …; labels → …\n\nDescription:\n<markdown…>
 */
const ID = /^[A-Z][A-Z0-9]{1,9}-\d+$/;
const priorityOf = (v: string): number | undefined => { const t = v.trim().toLowerCase(); return ({ "no priority": 0, none: 0, "0": 0, urgent: 1, "1": 1, high: 2, "2": 2, medium: 3, "3": 3, low: 4, "4": 4 } as Record<string, number>)[t]; };
const none = (v: string) => /^(none|null|-|—)$/i.test(v.trim());

function parseProps(line: string): Omit<Change, "identifier"> {
  const out: Omit<Change, "identifier"> = {};
  for (const part of line.split(/;\s*/)) {
    const m = part.match(/^\s*([a-z ]+?)\s*(?:→|->|:)\s*(.*?)\s*$/i);
    if (!m) continue;
    const key = m[1].trim().toLowerCase(); const v = m[2];
    if (key === "status" || key === "state") out.state = v.trim();
    else if (key === "priority") { const p = priorityOf(v); if (p !== undefined) out.priority = p; }
    else if (key === "assignee") out.assignee = none(v) ? null : v.trim();
    else if (key === "project") out.project = none(v) ? null : v.trim();
    else if (key === "labels" || key === "label") out.labels = none(v) ? [] : v.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  }
  return out;
}

export function parseCardMessage(message: string): CardRequest {
  const text = message.replace(/\r/g, "").trim();
  const req: CardRequest = { changes: [] };
  const comment = text.match(/^Comment on\s+([A-Z][A-Z0-9]{1,9}-\d+):\s*([\s\S]*)$/im);
  if (comment && comment.index === 0) { req.comment = { identifier: comment[1].toUpperCase(), body: comment[2].trim() }; return req; }
  const create = text.match(/^Create in\s+(\S+):\s*(.+)$/im);
  if (create && create.index === 0) {
    const lines = text.split("\n");
    const props = parseProps(lines[1] ?? "");
    const descAt = lines.findIndex((l) => /^Description:\s*$/i.test(l));
    const description = descAt >= 0 ? lines.slice(descAt + 1).join("\n").trim() : "";
    req.create = { team: create[1], title: create[2].trim(), ...(description ? { description } : {}), ...(props.state ? { state: props.state } : {}), ...(props.priority !== undefined ? { priority: props.priority } : {}), ...(props.assignee ? { assignee: props.assignee } : {}), ...(props.project ? { project: props.project } : {}), ...(props.labels?.length ? { labels: props.labels } : {}) };
    return req;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^Save\s+([A-Z][A-Z0-9]{1,9}-\d+):\s*(.+)$/i);
    if (!m || !ID.test(m[1].toUpperCase())) continue;
    const props = parseProps(m[2]);
    if (Object.keys(props).length) req.changes.push({ identifier: m[1].toUpperCase(), ...props });
  }
  return req;
}

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
