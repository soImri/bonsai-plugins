/**
 * Connector cards — the runtime every connector runs on. Knows nothing about issues, events,
 * threads or messages.
 *
 * It registers FOUR generic tools (cards_view, cards_record, cards_draft, cards_apply) and routes
 * each call to one connector module (./connectors/<id>/index.ts), chosen in this order: the
 * `connector` argument, a record reference the connector recognises (NEAT-9, #a1b2c3), a card
 * message the connector claims ("Save NEAT-9: …"), keywords in the task, the only connector there
 * is, or Jev asked to pick among the connectors' summaries.
 *
 * It then resolves that connector's sign-in through Bonsai (the plugin's shared-identity grants,
 * one per service), hands the connector a `Run`, and wraps what comes back in the result envelope
 * the UI (kay-ui.tsx) draws from: `details = { connector, kind, …payload, timing }`.
 *
 * Also here: Jev with the hosted route's limits (at most 8 questions, most important first; a 400
 * shrinks the rubric), a small disk cache, and the error card.
 */

/** The hosted Jev route answers 400 to a rubric of more than 8 questions (measured 2026-10-23). */
export const JEV_MAX_QUESTIONS = 8;

export class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export type ToolResult = { content: { type: "text"; text: string }[]; details?: unknown };
export const text = (t: string, details?: unknown): ToolResult => ({ content: [{ type: "text", text: t }], details });
export const ms = (from: number) => `${Date.now() - from} ms`;

/* ---------- Jev ---------- */
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
export type Decide = <T>(opts: { purpose: string; timeoutMs?: number }, decide: (jev: any) => Promise<T | undefined>, fallback: () => T) => Promise<{ value: T; took: string; by: "jev" | "fallback" }>;

/* ---------- cache ---------- */
export type DiskCache = { read<T>(name: string): Promise<T | undefined>; write(name: string, value: unknown): Promise<void> };
function diskCache(dir: string | undefined): DiskCache {
  return {
    async read<T>(name: string) { if (!dir) return undefined; try { const { readFile } = await import("node:fs/promises"); return JSON.parse(await readFile(`${dir}/${name}.json`, "utf8")) as T; } catch { return undefined; } },
    async write(name: string, value: unknown) { if (!dir) return; try { const { mkdir, writeFile } = await import("node:fs/promises"); await mkdir(dir, { recursive: true }); await writeFile(`${dir}/${name}.json`, JSON.stringify(value), "utf8"); } catch { /* cache only */ } },
  };
}

/* ---------- the pick log: what Jev chose, what the person then changed ---------- */
export type CardKind = "view" | "record" | "draft" | "apply";
type Pick = { at: string; connector: string; kind: CardKind; task: string; picked: string; correction?: string };
const STOP = new Set(["the", "a", "an", "my", "me", "i", "in", "on", "of", "for", "to", "is", "are", "what", "whats", "what's", "show", "do", "have", "this", "that", "with", "and", "please", "can", "you"]);
const words = (s: string) => new Set(String(s ?? "").toLowerCase().replace(/[^a-z0-9#' -]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));

async function readPicks(cache: DiskCache): Promise<Pick[]> { return (await cache.read<Pick[]>("picks")) ?? []; }
async function logPick(cache: DiskCache, pick: Pick) { const all = await readPicks(cache); all.push(pick); await cache.write("picks", all.slice(-300)); }
/** The last few picks for asks like this one, as plain lines Jev can read: "what's open → list, scope open". */
async function historyFor(cache: DiskCache, connector: string, kind: CardKind, task: string): Promise<string[]> {
  const want = words(task);
  if (!want.size) return [];
  const all = await readPicks(cache);
  return all.filter((p) => p.connector === connector && p.kind === kind && [...words(p.task)].some((w) => want.has(w))).slice(-5)
    .map((p) => `"${p.task}" → ${p.picked}${p.correction ? `; the person then changed: ${p.correction}` : ""}`);
}
/** A connector describes a pick ("list, scope open, grouped by status") and, for drafts, what the person changed on apply. */
export type PickSummary = { picked: string; correctionOf?: (applied: Record<string, any>) => string | undefined };

/** What a connector hands back: a one-line summary for the agent and the payload the UI draws. */
export type CardResult = {
  summary: string;
  payload: Record<string, unknown> & { kind: string };
  /** One line describing what was picked, for the pick log ("list, scope open, grouped by status"). */
  picked?: string;
  /** For apply: what the person changed versus the last draft's picks ("priority Medium → High"). */
  correction?: string;
};

export type Run = {
  connector: Connector;
  token: string;
  /** The resolved account, when Bonsai reports one (id, label, email…). */
  account?: Record<string, unknown>;
  params: Record<string, any>;
  signal?: AbortSignal;
  startedAt: number;
  jev: Decide;
  cache: DiskCache;
  /** Recent picks for asks like this one (and what the person changed afterwards). Put it in the rubric's state. */
  history: string[];
};

export type Connector = {
  /** Short id used in `connector` arguments, payloads and the UI registry: "linear", "gcal". */
  id: string;
  label: string;
  /** One line for the tool descriptions and for Jev's connector pick: "issues, projects and triage in Linear". */
  summary: string;
  /** Other names people use: ["google calendar", "calendar", "gcal"]. */
  aliases?: string[];
  auth: { serviceId: string; schemeId: string; requiredScopes?: string[]; connectServiceId?: string };
  triggers: {
    /** Words that point at this connector (lowercase). Counted; ties go to Jev. */
    keywords: string[];
    /** A record reference this connector owns, e.g. /\b[A-Z][A-Z0-9]{1,9}-\d+\b/ for NEAT-9. */
    refPattern?: RegExp;
    /** The card messages this connector's cards send, e.g. /^(Save|Comment on|Create in)\b/. */
    messagePattern?: RegExp;
  };
  /** Examples per kind, shown in the tool descriptions so the agent routes without reading a skill. */
  examples: Partial<Record<CardKind, string[]>>;
  /** Filter keys this connector understands in `filters`, with one-line docs. */
  filters?: Record<string, string>;
  /** Turns a thrown error into the one-line reason the card and the agent see. */
  explain?: (err: unknown) => string | undefined;
  view: (run: Run) => Promise<CardResult>;
  record: (run: Run) => Promise<CardResult>;
  draft: (run: Run) => Promise<CardResult>;
  apply: (run: Run) => Promise<CardResult>;
};

export const defineConnector = (c: Connector): Connector => c;

/* ---------- routing ---------- */
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export function matchConnector(connectors: Connector[], name: unknown): Connector | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return connectors.find((c) => c.id === n || norm(c.label) === n || (c.aliases ?? []).some((a) => norm(a) === n));
}

/** Decide which connector a call is for. Returns the connector and how it was chosen. */
export async function pickConnector(connectors: Connector[], kind: CardKind, params: Record<string, any>, jev: Decide): Promise<{ connector: Connector; by: string } | { error: string }> {
  const explicit = matchConnector(connectors, params.connector);
  if (explicit) return { connector: explicit, by: "named" };
  if (params.connector) return { error: `No connector called "${params.connector}". Connectors: ${connectors.map((c) => `${c.label} (${c.id})`).join(", ")}.` };
  const refs: string[] = [params.ref, ...(params.refs ?? [])].filter((r) => typeof r === "string" && r.trim());
  for (const c of connectors) if (c.triggers.refPattern && refs.some((r) => c.triggers.refPattern!.test(r))) return { connector: c, by: "reference" };
  if (kind === "apply" && typeof params.message === "string") {
    for (const c of connectors) if (c.triggers.messagePattern?.test(params.message.trim())) return { connector: c, by: "message" };
  }
  const task = norm(`${params.task ?? ""} ${params.title ?? ""} ${params.query ?? ""} ${params.message ?? ""} ${params.ref ?? ""}`);
  if (task) {
    const scored = connectors.map((c) => ({ c, n: c.triggers.keywords.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(task)).length + (c.triggers.refPattern?.test(params.task ?? "") ? 2 : 0) })).sort((a, b) => b.n - a.n);
    if (scored[0] && scored[0].n > 0 && (scored.length === 1 || scored[0].n > scored[1].n)) return { connector: scored[0].c, by: "keywords" };
  }
  if (connectors.length === 1) return { connector: connectors[0], by: "only" };
  if (task) {
    const criteria = Object.fromEntries(connectors.map((c) => [c.id, `${c.label}: ${c.summary}`]));
    const { value } = await jev({ purpose: "cards-pick-connector", timeoutMs: 4000 }, async (j) => {
      const { answers } = await classify(j, { task }, { connector: { type: "choice", instructions: "Which connected app is this request about? Judge the nouns and verbs: issues, tickets, bugs, projects point at a tracker; meetings, events, schedule, invites, free time point at a calendar.", criteria } });
      const a = answers.connector;
      return a?.type === "choice" && a.confidence >= 0.45 ? (a.choice as string) : undefined;
    }, () => undefined as string | undefined);
    const picked = value ? matchConnector(connectors, value) : undefined;
    if (picked) return { connector: picked, by: "jev" };
  }
  return { error: `Say which app this is about: ${connectors.map((c) => c.label).join(" or ")}. Pass it as \`connector\`.` };
}

/* ---------- registration ---------- */
const CALL_FIRST = "There is no need to read a skill first: Bonsai attaches it to this tool's result. After it returns, reply with NOTHING: the card is the whole answer, the person navigates inside it, and any sentence about what it shows or what to press is noise.";

function describeConnectors(connectors: Connector[], kind: CardKind): string {
  return connectors.map((c) => {
    const ex = (c.examples[kind] ?? []).map((e) => `'${e}'`).join(", ");
    const f = kind === "view" && c.filters ? ` Filters: ${Object.entries(c.filters).map(([k, d]) => `${k} (${d})`).join(", ")}.` : "";
    return `${c.label} [${c.id}]: ${c.summary}.${ex ? ` E.g. ${ex}.` : ""}${f}`;
  }).join(" ");
}

export function registerCards(api: any, connectors: Connector[]) {
  const withJev = typeof api.withJev === "function" ? api.withJev : (_use: unknown, fallback: () => unknown) => Promise.resolve(fallback());
  const names = connectors.map((c) => c.label).join(", ");
  const connectorParam = { type: "string", description: `Which app: ${connectors.map((c) => `"${c.id}" (${c.label})`).join(", ")}. Omit when the ask makes it obvious; the plugin routes by references, keywords, or Jev.` };
  const accountParam = { type: "string", description: "Account id to use when several accounts of that app are connected. Omit otherwise." };

  const tools: { kind: CardKind; name: string; label: string; description: string; properties: Record<string, unknown>; required: string[]; failing: string }[] = [
    {
      kind: "view", name: "cards_view", label: "Connector cards: view", failing: "read the records for the view",
      description: `Show records from a connected app (${names}) in the chat as that app's own UI. Call this FIRST, with the person's words: the plugin reads the app itself (no URI or MCP reads needed), Jev picks the view (one record, a list, a board, an agenda…) plus scope and fields, and the card draws it. ${describeConnectors(connectors, "view")} Pass refs when the ask names records, query only when it names a topic. ${CALL_FIRST}`,
      properties: { connector: connectorParam, task: { type: "string", description: "The person's request, in their words." }, refs: { type: "array", items: { type: "string" }, description: "Record references the ask names (e.g. [\"NEAT-9\"]). Omit otherwise." }, query: { type: "string", description: "A topic keyword to filter by, only when the ask names a topic. Omit otherwise." }, filters: { type: "object", additionalProperties: { type: "string" }, description: "Connector filters by key (see the connector's filter list). Omit otherwise." }, account: accountParam },
      required: ["task"],
    },
    {
      kind: "record", name: "cards_record", label: "Connector cards: one record", failing: "read the record",
      description: `Show ONE record from a connected app (${names}) as that app's own detail view, with live controls. Call this FIRST with just the reference. ${describeConnectors(connectors, "record")} ${CALL_FIRST}`,
      properties: { connector: connectorParam, ref: { type: "string", description: "The record reference: an identifier like NEAT-9, a card key like #a1b2c3, or a title to look up." }, draft: { type: "string", description: "Text to prefill in the card's composer (a comment, a reply). Optional." }, account: accountParam },
      required: ["ref"],
    },
    {
      kind: "draft", name: "cards_draft", label: "Connector cards: draft a new record", failing: "prepare the draft",
      description: `Draft a NEW record in a connected app (${names}) as that app's own create dialog. Call this FIRST with the person's words plus a title: the plugin reads the app's pick lists itself, Jev picks the properties, and the person edits the card and presses the create button. Do not create anything yourself; the card sends a message when the person is ready. ${describeConnectors(connectors, "draft")} ${CALL_FIRST}`,
      properties: { connector: connectorParam, task: { type: "string", description: "The person's request, in their words." }, title: { type: "string", description: "A title of at most 80 characters in the app's style. Derived from the task when omitted." }, body: { type: "string", description: "At most three short lines of description, only when the task gives real detail. Omit otherwise." }, fields: { type: "object", additionalProperties: true, description: "Structured values the ask states and the app needs, by connector: for a calendar event, start and end as ISO date-times (the person's local time, e.g. 2026-10-24T15:00) and attendees as emails. Omit what the ask does not say." }, account: accountParam },
      required: ["task"],
    },
    {
      kind: "apply", name: "cards_apply", label: "Connector cards: apply", failing: "write to the app",
      description: `Write what the person did on a card back to its app (${names}). A card sends a short command as the person's message (${connectors.map((c) => `${c.label}: ${(c.examples.apply ?? []).map((e) => `'${e}'`).join(", ")}`).join("; ")}). When a message looks like that, call this IMMEDIATELY with the whole message verbatim in \`message\`; the plugin parses it, writes, re-reads, and the card redraws from the app's truth. For your own edits pass \`connector\` and \`payload\` instead. ${CALL_FIRST}`,
      properties: { connector: connectorParam, message: { type: "string", description: "A card's message, verbatim." }, payload: { type: "object", additionalProperties: true, description: "A structured write in the connector's own shape (see its skill). Requires `connector`." }, account: accountParam },
      required: [],
    },
  ];

  for (const tool of tools) {
    api.registerTool({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: { type: "object", properties: tool.properties, required: tool.required },
      async execute(_id: string, params: Record<string, any>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
        const startedAt = Date.now();
        const jev: Decide = async (opts, decide, fallback) => {
          const t0 = Date.now();
          let by: "jev" | "fallback" = "fallback";
          const value = await withJev(async (j: any) => { const v = await decide(j); if (v !== undefined) by = "jev"; return v; }, fallback, { timeoutMs: opts.timeoutMs ?? 6000, purpose: opts.purpose, ...(signal ? { signal } : {}) });
          return { value, took: ms(t0), by };
        };
        const picked = await pickConnector(connectors, tool.kind, params ?? {}, jev);
        if ("error" in picked) return text(`Could not ${tool.failing}: ${picked.error}`, { kind: "error", error: picked.error });
        const { connector, by } = picked;
        if (!ctx?.auth?.resolveToken) return text(`Could not ${tool.failing}: sign-in is not available in this context.`, { kind: "error", connector: connector.id, error: "No sign-in available." });
        const auth = await ctx.auth.resolveToken({ serviceId: connector.auth.serviceId, schemeId: connector.auth.schemeId, ...(connector.auth.requiredScopes ? { requiredScopes: connector.auth.requiredScopes } : {}), ...(connector.auth.connectServiceId ? { connectServiceId: connector.auth.connectServiceId } : {}), ...(typeof params?.account === "string" && params.account ? { accountId: params.account } : {}) });
        if (!auth?.ok) { const why = auth?.message ?? `${connector.label} is not connected. Connect it in App Store → Installed.`; return text(`Could not ${tool.failing}: ${why}`, { kind: "error", connector: connector.id, error: why }); }
        try {
          const root = diskCache(ctx?.paths?.dataDir);
          const task = String(params?.task ?? params?.message ?? params?.ref ?? "");
          const history = tool.kind === "view" || tool.kind === "draft" ? await historyFor(root, connector.id, tool.kind, task) : [];
          const { summary, payload, picked, correction } = await connector[tool.kind]({ connector, token: auth.auth.accessToken, account: auth.auth.account, params: params ?? {}, signal, startedAt, jev, cache: diskCache(ctx?.paths?.dataDir ? `${ctx.paths.dataDir}/${connector.id}` : undefined), history });
          if (picked) void logPick(root, { at: new Date().toISOString(), connector: connector.id, kind: tool.kind, task, picked });
          if (correction) { const all = await readPicks(root); const last = [...all].reverse().find((p) => p.connector === connector.id && p.kind === "draft"); if (last) { last.correction = correction; await root.write("picks", all.slice(-300)); } }
          const timing = { ...((payload.timing as object) ?? {}), total: ms(startedAt) };
          // The agent sees one terse line; routing, picks and timings ride in `details.debug` for the card and the evals.
          return text(summary, { ...payload, connector: connector.id, connectorLabel: connector.label, timing, debug: { routedBy: by, picked: picked ?? null, timing }, ...(history.length ? { history } : {}) });
        } catch (err) {
          const e = err as Error;
          const why = connector.explain?.(err) ?? (e?.name === "AbortError" ? "The call was cancelled." : e?.message ?? String(err));
          return text(`Could not ${tool.failing} in ${connector.label}: ${why}`, { kind: "error", connector: connector.id, error: why });
        }
      },
    });
  }
}
