/**
 * The connector registry (UI side). Mirrors ./index.ts: one entry per connector's ui.tsx.
 * `tools/new-connector.mjs` adds new ones above the marker.
 */
import type { ConnectorUi } from "../ui/kit.tsx";
import { linearUi } from "./linear/ui.tsx";
import { gcalUi } from "./gcal/ui.tsx";
import { slackUi } from "./slack/ui.tsx";

export const connectorUis: ConnectorUi[] = [
  linearUi,
  gcalUi,
  slackUi,
  // @connectors — the scaffold inserts new connectors above this line
];
