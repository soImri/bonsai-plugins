/**
 * Linear over its MCP server, as a JSON-RPC client (Streamable HTTP).
 *
 * Bonsai's Linear token is minted for this server: api.linear.app/graphql answers 401 to it
 * (measured 2026-10-23), so every read and write here is a `tools/call` on mcp.linear.app.
 */
import { HttpError } from "../runtime.ts";

const MCP_URL = "https://mcp.linear.app/mcp";
const MCP_PROTOCOL = "2025-06-18";

type McpSession = { id?: string; protocol: string; at: number };
const sessions = new Map<string, McpSession>(); // by token
let rpcId = 1;

function headers(token: string, s?: McpSession): Record<string, string> {
  return {
    "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`,
    ...(s ? { "mcp-protocol-version": s.protocol } : {}), ...(s?.id ? { "mcp-session-id": s.id } : {}),
  };
}

/** One JSON-RPC response from a plain JSON or an SSE body. */
async function readRpc(res: Response, id: number): Promise<any> {
  const ct = res.headers.get("content-type") ?? "";
  const body = await res.text();
  if (!res.ok) throw new HttpError(res.status, `Linear's MCP server answered ${res.status}: ${body.slice(0, 160)}`);
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

async function connect(token: string, signal?: AbortSignal): Promise<McpSession> {
  const hit = sessions.get(token);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit;
  const id = rpcId++;
  const res = await fetch(MCP_URL, { method: "POST", headers: headers(token), body: JSON.stringify({ jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "connector-cards", version: "0.3" } } }), ...(signal ? { signal } : {}) });
  const msg = await readRpc(res, id);
  if (msg?.error) throw new Error(`Linear MCP initialize: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  const session: McpSession = { ...(res.headers.get("mcp-session-id") ? { id: res.headers.get("mcp-session-id")! } : {}), protocol: msg?.result?.protocolVersion ?? MCP_PROTOCOL, at: Date.now() };
  await fetch(MCP_URL, { method: "POST", headers: headers(token, session), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), ...(signal ? { signal } : {}) }).catch(() => undefined);
  sessions.set(token, session);
  return session;
}

/** Call one Linear MCP tool and return its JSON (or text) payload. */
export async function mcpCall<T = any>(token: string, name: string, args: Record<string, unknown>, signal?: AbortSignal, retry = true): Promise<T> {
  const session = await connect(token, signal);
  const id = rpcId++;
  const res = await fetch(MCP_URL, { method: "POST", headers: headers(token, session), body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }), ...(signal ? { signal } : {}) });
  if ((res.status === 404 || res.status === 400) && session.id && retry) { sessions.delete(token); return mcpCall(token, name, args, signal, false); }
  const msg = await readRpc(res, id);
  if (!msg) throw new Error(`Linear MCP ${name}: empty response`);
  if (msg.error) throw new Error(`Linear MCP ${name}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  const content: any[] = msg.result?.content ?? [];
  const body = content.find((c) => c?.type === "text")?.text ?? "";
  if (msg.result?.isError) throw new Error(`Linear MCP ${name}: ${body.slice(0, 200) || "tool error"}`);
  try { return JSON.parse(body) as T; } catch { return body as unknown as T; }
}

/** Linear's list tools answer `{<key>: [...]}`, a bare array, or `{nodes}`; take whichever came. */
export const asList = (r: any, key: string): any[] => (Array.isArray(r) ? r : Array.isArray(r?.[key]) ? r[key] : Array.isArray(r?.nodes) ? r.nodes : []);
