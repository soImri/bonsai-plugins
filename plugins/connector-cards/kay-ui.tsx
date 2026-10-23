/**
 * Connector cards — UI entrypoint. One renderer per generic tool; each reads the result's
 * `details.connector` and hands the payload to that connector's compositions (connectors/<id>/ui.tsx).
 *
 * The payload arrives as `call.resultDetails` (Bonsai hands a renderer the result's `details`
 * object; `rawResult` is only the prose line, cut to 4 KB on reload).
 */
import { useMemo } from "react";
import { useKayActions, useKayFrontendContext } from "@bonsai/frontend-sdk";
import { ErrorCard, Placeholder, parse, type ConnectorUi, type UiCtx } from "./ui/kit.tsx";
import { connectorUis } from "./connectors/ui.ts";

type RendererProps = { call?: { resultDetails?: unknown; resultText?: string }; phase: string; rawArgs?: string; rawResult?: string; sessionId: string };
type Kind = "view" | "record" | "draft" | "apply";

function detailsOf(call: RendererProps["call"], rawResult: string | undefined): any {
  const d = call?.resultDetails;
  if (d && typeof d === "object") return d;
  return parse<any>(rawResult)?.details ?? null;
}
const uiFor = (id: unknown): ConnectorUi | undefined => connectorUis.find(u => u.id === id || u.label.toLowerCase() === String(id ?? "").toLowerCase());

function CardRenderer({ kind, call, phase, rawArgs, rawResult, sessionId }: RendererProps & { kind: Kind }) {
  const details = useMemo(() => detailsOf(call, rawResult), [call?.resultDetails, rawResult]);
  const actions = useKayActions(sessionId);
  const { kayApi } = useKayFrontendContext();
  const named = useMemo(() => parse<any>(rawArgs)?.connector, [rawArgs]);
  const ui = uiFor(details?.connector ?? named);
  if (phase === "running" || !details) {
    const what = ui?.runningText?.(kind) ?? (kind === "apply" ? "Saving…" : "Reading…");
    return <Placeholder text={phase === "running" ? what : "No card data."} />;
  }
  if (details.kind === "error" || details.error) return <ErrorCard message={details.error ?? "Something went wrong."} />;
  if (!ui) return <ErrorCard message={`No cards for connector "${details.connector ?? "unknown"}".`} />;
  const ctx: UiCtx = {
    details, phase, sessionId,
    send: async (text) => { await actions.sendMessage(text); },
    openUrl: (url) => { void kayApi.openExternalUrl(url); },
  };
  const C = ui.component;
  return <C ctx={ctx} />;
}

export default function activate(api: any) {
  const presentation = { venue: "inline", grouping: "standalone", disclosure: "always-open" } as const;
  const regs = (["view", "record", "draft", "apply"] as Kind[]).map(kind => api.slots.registerToolRenderer(`cards_${kind}`, (p: RendererProps) => <CardRenderer {...p} kind={kind} />, presentation));
  return { dispose() { for (const r of regs) r.dispose(); } };
}
