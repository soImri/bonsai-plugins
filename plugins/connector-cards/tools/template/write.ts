/**
 * __LABEL__ card messages. A card speaks a short human grammar in the chat; the plugin parses it,
 * the agent passes it on verbatim. Keep these shapes and ui.tsx's senders in step.
 *
 *   Save __ID__ <ref>: field → value; other → value
 *   Create __ID__: <title>
 *   field → value; other → value
 *
 *   Body:
 *   <text…>
 */
export type Change = { ref: string; fields: { [k: string]: string | null } };
export type Create = { title: string; fields: { [k: string]: string }; body?: string };
export type CardRequest = { changes: Change[]; create?: Create };

const none = (v: string) => /^(none|null|-|—)$/i.test(v.trim());
function parseProps(line: string): { [k: string]: string } {
  const out: { [k: string]: string } = {};
  for (const part of line.split(/;\s*/)) { const m = part.match(/^\s*([a-z ]+?)\s*(?:→|->|:)\s*(.*?)\s*$/i); if (m) out[m[1].trim().toLowerCase()] = m[2]; }
  return out;
}

export function parseCardMessage(message: string): CardRequest {
  const text = message.replace(/\r/g, "").trim();
  const req: CardRequest = { changes: [] };
  const create = text.match(/^Create __ID__:\s*(.+)$/im);
  if (create && create.index === 0) {
    const lines = text.split("\n");
    const bodyAt = lines.findIndex((l) => /^Body:\s*$/i.test(l));
    req.create = { title: create[1].trim(), fields: parseProps(lines[1] ?? ""), ...(bodyAt >= 0 ? { body: lines.slice(bodyAt + 1).join("\n").trim() } : {}) };
    return req;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^Save __ID__\s+(\S+):\s*(.+)$/i);
    if (!m) continue;
    const props = parseProps(m[2]);
    req.changes.push({ ref: m[1], fields: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, none(v) ? null : v])) });
  }
  return req;
}
