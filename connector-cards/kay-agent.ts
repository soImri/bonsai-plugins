/**
 * Connector cards — agent entrypoint.
 *
 * The framework is two layers: `runtime.ts` (auth binding, Jev with its limits, result envelope,
 * cache, error card) and one module per connector (`linear/`: reads, rubrics, writes, and the
 * tools that compose them). The UI side (`kay-ui.tsx`) draws whatever a tool puts in its result's
 * `details`. Adding a connector means adding a module folder and registering it here.
 *
 * Why this shape: measured 2026-10-20, a create-card ask took 2m27s, of which the tool itself took
 * ~0 ms; the time was nine agent round trips. With the plugin doing the reads, the Jev picks, and
 * (since v0.3) the writes, the agent's part is one call with ~100 bytes of arguments.
 */
import { registerConnector } from "./runtime.ts";
import { linear } from "./linear/index.ts";

export function activate(api: any) {
  registerConnector(api, linear);
}

export default activate;
