/**
 * __LABEL__ over its API with Bonsai's sign-in, normalised to one plain record shape the UI reads.
 * TODO: set BASE, fill listRecords / getRecord, and normalise. Cache pick lists with `cache` (10 min).
 */
import { HttpError, type DiskCache } from "../../runtime.ts";

const BASE = "https://api.example.com"; // TODO

export type Record = { ref: string; title: string; subtitle?: string; body?: string; url?: string; fields: { [k: string]: string | number | boolean | null } };

export async function api<T = any>(token: string, method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), ...(signal ? { signal } : {}) });
  const txt = await res.text();
  if (!res.ok) throw new HttpError(res.status, `__LABEL__ answered ${res.status}: ${txt.slice(0, 200)}`);
  return (txt ? JSON.parse(txt) : undefined) as T;
}

export function normalize(raw: any): Record {
  // TODO: map the app's object to the card's shape.
  return { ref: String(raw.id), title: raw.title ?? raw.name ?? "(untitled)", fields: {} };
}

export async function listRecords(token: string, _cache: DiskCache, _filters: { query?: string; [k: string]: unknown }, signal?: AbortSignal): Promise<Record[]> {
  const r = await api(token, "GET", "/records?limit=50", undefined, signal); // TODO
  return (r.items ?? r ?? []).map(normalize);
}

export async function getRecord(token: string, _cache: DiskCache, ref: string, signal?: AbortSignal): Promise<Record | undefined> {
  const r = await api(token, "GET", `/records/${encodeURIComponent(ref)}`, undefined, signal).catch(() => undefined); // TODO
  return r ? normalize(r) : undefined;
}
