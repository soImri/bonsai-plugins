/**
 * The __LABEL__ connector. Fill the TODOs top to bottom; CONNECTORS.md explains each step.
 *
 *   view    words → records in a Jev-picked composition
 *   record  one reference → one record with live controls
 *   draft   words (+ title) → the app's create dialog with Jev-picked properties
 *   apply   the card's Save / Create → written, card redrawn from the app's truth
 */
import { HttpError, defineConnector, classify, ms, remembered, type Run, type CardResult } from "../../runtime.ts";
import { getRecord, listRecords, type Record } from "./api.ts";
import { listFollowUps, recordFollowUps, viewRubric, type Composition } from "./rubrics.ts";
import { parseCardMessage } from "./write.ts";

/** TODO: how this app's record references look in text, e.g. /\b[A-Z]+-\d+\b/ or /#[0-9a-f]{6}/. */
const REF = /\b__ID__-[A-Za-z0-9]+\b/;

export const __ID__ = defineConnector({
  id: "__ID__",
  label: "__LABEL__",
  summary: "TODO one line: what people look at and change in __LABEL__",
  aliases: ["__ID__"],
  auth: { serviceId: "__SERVICE__", schemeId: "__SCHEME__" },
  triggers: {
    keywords: ["__ID__"], // TODO: the nouns people use for this app's records
    refPattern: REF,
    messagePattern: /^(Save __ID__|Create __ID__)\b/,
  },
  examples: {
    view: ["TODO 'what's new in …'"],
    record: ["TODO 'show …'"],
    draft: ["TODO 'create a …'"],
    apply: ["Save __ID__ <ref>: field → value", "Create __ID__: <title>\\n<properties line>"],
  },
  filters: {},
  explain: (err) => (err instanceof HttpError && (err.status === 401 || err.status === 403) ? `__LABEL__ rejected Bonsai's sign-in (HTTP ${err.status}). Reconnect it in App Store → Installed.` : undefined),

  async view({ token, params, signal, startedAt, jev, cache, history, followUps, recall }: Run): Promise<CardResult> {
    const records = await listRecords(token, cache, { query: params.query, ...(params.filters ?? {}) }, signal);
    const tApp = ms(startedAt);
    const rubric = viewRubric(params.task ?? "", records);
    const state = { ...rubric.state, pastPicksForSimilarAsks: history.length ? history.join(" | ") : "none" };
    // Composition and follow-ups: two Jev calls in parallel (same wall time). A proven recipe for a similar ask answers both from memory.
    const [{ value, took: tJev }, fu] = await Promise.all([
      remembered(recall, () => jev({ purpose: "__ID__-view" }, async (j) => { const { answers, variant } = await classify(j, state, rubric.questions); return rubric.read(answers, variant); }, () => rubric.guess)),
      followUps("__ID__-follow-ups", { task: params.task, recordCount: records.length }, records.length === 1 ? recordFollowUps(params.task ?? "") : listFollowUps(params.task ?? "")),
    ]);
    const comp = value as Composition;
    comp.followUps = fu.actions;
    const payload = { kind: "view", task: params.task, records, composition: comp, timing: { __ID__: tApp, jev: tJev } };
    const picked = `${comp.view} view`;
    if (!records.length) return { summary: "No records match. Say so in one line.", payload, picked, offered: fu.actions, remember: comp };
    return { summary: `Showing ${records.length} __LABEL__ record(s) as a ${comp.view} view (${comp.by === "jev" ? `Jev picked, ${comp.variant}` : "default pick"}; __LABEL__ ${tApp}, Jev ${tJev}). The card is the answer: reply with one short line or nothing.`, payload, picked, offered: fu.actions , remember: comp };
  },

  async record({ token, params, signal, startedAt, cache, followUps, context }: Run): Promise<CardResult> {
    const rec = await getRecord(token, cache, String(params.ref ?? ""), signal);
    if (!rec) throw new Error(`No __LABEL__ record matches "${params.ref}".`);
    const fu = await followUps("__ID__-follow-ups", { task: params.ref, record: rec.title }, recordFollowUps(`${params.ref} ${context ?? ""}`));
    // TODO: put `followUps: fu.actions` on the payload and return `offered: fu.actions`; in apply, return `used`.
    void fu;
    return { summary: `Showing "${rec.title}" as a __LABEL__ card (__LABEL__ ${ms(startedAt)}). The card is the answer: reply with one short line or nothing.`, payload: { kind: "record", record: rec, timing: { __ID__: ms(startedAt) } } };
  },

  async draft({ params, startedAt }: Run): Promise<CardResult> {
    // TODO: read pick lists, build a create rubric (see connectors/linear/rubrics.ts createRubric), let Jev pick properties.
    const title = (params.title?.trim() || String(params.task ?? "").slice(0, 80));
    const draft = { title, body: params.body?.trim() ?? "" };
    return { summary: `Draft "${title}" shown as __LABEL__'s create dialog (${ms(startedAt)}). Stop here with at most one short line; when the person confirms, a 'Create __ID__:' message arrives: call cards_apply with it verbatim.`, payload: { kind: "draft", draft, timing: { __ID__: ms(startedAt) } }, picked: "defaults" };
  },

  async apply({ params }: Run): Promise<CardResult> {
    const parsed = typeof params.message === "string" ? parseCardMessage(params.message) : { changes: [] };
    const p = params.payload ?? {};
    const changes = [...parsed.changes, ...(p.changes ?? [])];
    const create = p.create ?? parsed.create;
    if (!changes.length && !create) throw new Error("Nothing to apply: the message did not parse as a __LABEL__ card command and no payload was passed.");
    // TODO: write each change / the create through the app's API with `token`, then re-read what you touched.
    throw new Error("__LABEL__ writes are not implemented yet (connectors/__ID__/index.ts apply).");
  },
});
