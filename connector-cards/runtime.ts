/**
 * Connector cards — the runtime every connector module runs on.
 *
 * Knows nothing about issues, threads or messages. It owns:
 *   - the tool envelope: auth binding (`withResolvedAuth`), timing, the result shape the UI
 *     reads (`details`), and the error card;
 *   - Jev: `classify` with the hosted route's 8-question cap, importance ordering, and a
 *     required fallback;
 *   - a tiny disk cache under the plugin's data dir.
 *
 * A connector module (see ./linear/index.ts) is `defineConnector({...})`: its auth binding and a
 * list of tools whose `run` receives a `ToolRun` with the token, a Jev handle, the cache, and the
 * result helpers. `registerConnector` turns that into Bonsai tool registrations.
 */
import { withResolvedAuth } from "@bonsai/plugin-sdk/kay-agent";

/** The hosted Jev route answers 400 to a rubric of more than 8 questions (measured 2026-10-23: 8 answered, 9 and 10 refused). */
export const JEV_MAX_QUESTIONS = 8;

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export type ToolResult = { content: { type: "text"; text: string }[]; details?: unknown };
export const text = (t: string, details?: unknown): ToolResult => ({ content: [{ type: "text", text: t }], details });
export const ms = (from: number) => `${Date.now() - from} ms`;

export type JevQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> } | { type: "bool"; instructions: string; criteria?: { true: string; false: string } };
export type JevAnswers = Record<string, any>;

/**
 * Jev with a shrinking rubric. Questions are passed most-important-first; on a gateway 400 the
 * tail is dropped and the call retried, so the caller always gets the answers that matter most.
 * `variant` reports how many of the asked questions were answered ("8/9").
 */
export async function classify(jev: any, state: object, questions: Record<string, JevQuestion>): Promise<{ answers: JevAnswers; variant: string }> {
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

/** Answer readers that fall back to a heuristic when the shrunken rubric dropped the question. */
export const choiceOf = (a: JevAnswers, k: string, fallback: string): string => (a[k]?.type === "choice" ? a[k].choice : fallback);
export const yesOf = (a: JevAnswers, k: string, fallback: boolean, threshold = 0.5): boolean => (a[k]?.type === "bool" ? a[k].probability >= threshold : fallback);

/** Jev or the fallback, timed. `decide` returns undefined to decline. */
export type Decide<T> = (opts: { purpose: string; timeoutMs?: number }, decide: (jev: any) => Promise<T | undefined>, fallback: () => T) => Promise<{ value: T; took: string }>;

export type DiskCache = { read<T>(name: string): Promise<T | undefined>; write(name: string, value: unknown): Promise<void> };
function diskCache(dir: string | undefined): DiskCache {
  return {
    async read<T>(name: string) { if (!dir) return undefined; try { const { readFile } = await import("node:fs/promises"); return JSON.parse(await readFile(`${dir}/${name}.json`, "utf8")) as T; } catch { return undefined; } },
    async write(name: string, value: unknown) { if (!dir) return; try { const { writeFile } = await import("node:fs/promises"); await writeFile(`${dir}/${name}.json`, JSON.stringify(value), "utf8"); } catch { /* cache only */ } },
  };
}

export type ToolRun = {
  token: string;
  params: Record<string, any>;
  signal?: AbortSignal;
  startedAt: number;
  jev: Decide<any>;
  cache: DiskCache;
  ok: (summary: string, details: unknown) => ToolResult;
};

export type ConnectorTool = {
  name: string; label: string; description: string;
  parameters: Record<string, unknown>;
  /** Named in the failure text: "Could not <failing> …". */
  failing: string;
  run: (r: ToolRun) => Promise<ToolResult>;
};

export type Connector = {
  id: string;
  auth: { serviceId: string; schemeId: string };
  /** Turns a thrown error into the one-line reason the card and the agent see. */
  explain?: (err: unknown) => string | undefined;
  tools: ConnectorTool[];
};

export const defineConnector = (c: Connector): Connector => c;

export function registerConnector(api: any, connector: Connector) {
  const withJev = typeof api.withJev === "function" ? api.withJev : (_use: unknown, fallback: () => unknown) => Promise.resolve(fallback());
  for (const tool of connector.tools) {
    api.registerTool(withResolvedAuth(
      { name: tool.name, label: tool.label, description: tool.description, parameters: tool.parameters },
      connector.auth,
      async (_id: string, params: Record<string, any>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any, auth: { accessToken: string }) => {
        const startedAt = Date.now();
        const jev: Decide<any> = async (opts, decide, fallback) => {
          const t0 = Date.now();
          const value = await withJev(decide, fallback, { timeoutMs: opts.timeoutMs ?? 6000, purpose: opts.purpose, ...(signal ? { signal } : {}) });
          return { value, took: ms(t0) };
        };
        try {
          return await tool.run({ token: auth.accessToken, params, signal, startedAt, jev, cache: diskCache(ctx?.paths?.dataDir), ok: (summary, details) => text(summary, details) });
        } catch (err) {
          const e = err as Error;
          const why = connector.explain?.(err) ?? (e?.name === "AbortError" ? "The call was cancelled." : e?.message ?? String(err));
          return text(`Could not ${tool.failing}: ${why}`, { error: why });
        }
      },
    ));
  }
}
