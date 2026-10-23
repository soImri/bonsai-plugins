/**
 * The connector registry (agent side). Add a connector by importing its module and listing it here;
 * `tools/new-connector.mjs <id> "<Label>"` scaffolds the module and does this for you.
 */
import type { Connector } from "../runtime.ts";
import { linear } from "./linear/index.ts";
import { gcal } from "./gcal/index.ts";

export const connectors: Connector[] = [
  linear,
  gcal,
  // @connectors — the scaffold inserts new connectors above this line
];
