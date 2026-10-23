/**
 * The connector registry (agent side). Add a connector by importing its module and listing it here;
 * `tools/new-connector.mjs <id> "<Label>"` scaffolds the module and does this for you.
 */
import type { Connector } from "../runtime.ts";
import { linear } from "./linear/index.ts";
import { gcal } from "./gcal/index.ts";
import { slack } from "./slack/index.ts";

export const connectors: Connector[] = [
  linear,
  gcal,
  slack,
  // @connectors — the scaffold inserts new connectors above this line
];
