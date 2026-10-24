/**
 * Connector cards — app entrypoint: the background route.
 *
 * Registers one endpoint, `cards.write`, that a card calls directly (through Bonsai's extension
 * endpoint bus) for quick actions that should not go through the chat: a reaction, an RSVP. The
 * payload is the same short message the card would otherwise have sent, so the connectors'
 * parsers and writes are shared with the `cards_apply` tool; the result is the refreshed data,
 * which the card may use or ignore (it already showed the change).
 */
import type { KayAppActivate } from "@bonsai/plugin-sdk/kay-app";
import { applyDirect } from "./runtime.ts";
import { connectors } from "./connectors/index.ts";

/** The manifest's declared purpose per service (permissions.byTarget["kay.app"].auth[].purposes); keep in sync. */
const PURPOSE: Record<string, string> = {
  "linear.account": "Read and write Linear issues to draw and apply the Linear cards.",
  "google.account": "Read and write Google Calendar events to draw and apply the calendar cards.",
  "slack.account": "Read and write Slack records to draw and apply the Slack cards.",
};

const activate: KayAppActivate = (app) => {
  const dataDir = (() => { try { return app.storage?.dataDir?.open(); } catch { return undefined; } })();
  app.endpoints.register("write", async (payload) => {
    const p = (payload && typeof payload === "object" ? payload : {}) as { connector?: string; message?: string; payload?: Record<string, unknown> };
    if (!p.message && !p.payload) return { ok: false, error: "Nothing to apply." };
    return applyDirect(connectors, p, async (req) => {
      if (!app.auth) return { ok: false, message: "Sign-in is not available to the background route; the card will fall back to the chat." };
      try {
        const c = await app.auth.resolve({ serviceId: req.serviceId, schemeId: req.schemeId, purpose: PURPOSE[req.serviceId] ?? "" });
        return { ok: true, auth: { accessToken: c.accessToken, account: c.accountId } };
      } catch (err) { return { ok: false, message: (err as Error)?.message ?? String(err) }; }
    }, dataDir);
  });
};

export default activate;
