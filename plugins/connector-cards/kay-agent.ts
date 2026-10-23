/**
 * Connector cards — agent entrypoint.
 *
 * Four generic tools (cards_view, cards_record, cards_draft, cards_apply) over a registry of
 * connector modules. `runtime.ts` owns the tools, routing, sign-in, Jev and the result envelope;
 * each `connectors/<id>/` owns one app's reads, rubrics, writes and (in ui.tsx) compositions.
 * The UI side (`kay-ui.tsx`) draws whatever a connector puts in its result's `details`.
 *
 * Why this shape: measured 2026-10-20, a create-card ask took 2m27s, of which the tool itself took
 * ~0 ms; the time was nine agent round trips. With the plugin doing the reads, the Jev picks and
 * the writes, the agent's part is one call with ~100 bytes of arguments.
 */
import { registerCards } from "./runtime.ts";
import { connectors } from "./connectors/index.ts";

export function activate(api: any) {
  registerCards(api, connectors);
}

export default activate;
