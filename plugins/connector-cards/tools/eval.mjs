#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// Run a connector's eval set: node tools/eval.mjs <connector-id> [--session <id>] [--only parse|live]
//
// Two kinds of case live in connectors/<id>/evals.json:
//   { "parse": "<a card message>", "expect": { ...the parsed request... } }
//     Runs the connector's write.ts parser in this process. No network, no Bonsai.
//   { "ask": "<what the person said>", "tool": "view|record|draft", "args": { ... }, "expect": { ...fields of the result's details... },
//     "includes": { "composition.followUps": ["edit"] }, "excludes": { "composition.followUps": ["create"] } }
//     Invokes the plugin's tool through the Bonsai CLI in a session (no model turn), then compares
//     `expect` against the result's details with dotted paths ("composition.view": "list"); `includes` and
//     `excludes` check membership in an array at the path (the follow-ups a card must and must not offer).
//     Put the conversation around the ask in args.context: follow-ups are judged from it.
//     Needs the `kay` CLI and a session: inside an agent Bash both are set ($KAY_CLI_NAME, $KAY_SESSION_ID);
//     from a terminal pass --session <id> and have `kay` on PATH.
//
// Exit code is the number of failures (0 = green). Live cases never run apply, so nothing is written.
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [, , id, ...rest] = process.argv;
if (!id) { console.error("usage: node tools/eval.mjs <connector-id> [--session <id>] [--only parse|live]"); process.exit(2); }
const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const session = flag("--session") ?? process.env.KAY_SESSION_ID;
const only = flag("--only");
const cli = process.env.KAY_CLI_NAME ?? "kay";

const cases = JSON.parse(await readFile(join(root, "connectors", id, "evals.json"), "utf8"));
const get = (o, path) => path.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let pass = 0, fail = 0;
const report = (ok, label, detail) => { ok ? pass++ : fail++; console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `\n    ${detail}` : ""}`); };

// --- parse cases: import the connector's parser with Node's own TypeScript support.
const parseCases = cases.filter((c) => c.parse !== undefined);
if (parseCases.length && only !== "live") {
  const mod = await import(pathToFileURL(join(root, "connectors", id, "write.ts")).href);
  for (const c of parseCases) {
    const got = mod.parseCardMessage(c.parse);
    const diffs = Object.entries(c.expect).filter(([k, want]) => !same(get(got, k), want)).map(([k, want]) => `${k}: got ${JSON.stringify(get(got, k))}, want ${JSON.stringify(want)}`);
    report(diffs.length === 0, `parse  ${JSON.stringify(c.parse.split("\n")[0])}`, diffs.join("; "));
  }
}

// --- live cases: the real tool, in a session, no model.
const liveCases = cases.filter((c) => c.ask !== undefined);
if (liveCases.length && only !== "parse") {
  if (!session) { console.log(`(skipping ${liveCases.length} live cases: no session; pass --session <id>)`); }
  else for (const c of liveCases) {
    if (c.tool === "apply") { report(false, `live   ${c.ask}`, "apply cases are not run live (they would write); make it a parse case"); continue; }
    const args = { connector: id, task: c.ask, ...(c.args ?? {}) };
    const t0 = Date.now();
    const r = spawnSync(cli, ["session", "tool", "invoke", `cards_${c.tool ?? "view"}`, "--args-json", JSON.stringify(args), "--session", session], { encoding: "utf8" });
    const took = Date.now() - t0;
    let env; try { env = JSON.parse(r.stdout); } catch { report(false, `live   ${c.ask}`, `CLI returned no JSON: ${(r.stderr || r.stdout).slice(0, 200)}`); continue; }
    const details = env?.result?.details ?? {};
    const text = env?.result?.content?.[0]?.text ?? "";
    if (details.error) { report(false, `live   ${c.ask}`, `tool error: ${details.error}`); continue; }
    const diffs = Object.entries(c.expect ?? {}).filter(([k, want]) => !same(get(details, k), want)).map(([k, want]) => `${k}: got ${JSON.stringify(get(details, k))}, want ${JSON.stringify(want)}`);
    for (const [k, want] of Object.entries(c.includes ?? {})) { const got = get(details, k) ?? []; for (const w of want) if (!got.includes(w)) diffs.push(`${k}: should include ${JSON.stringify(w)}, got ${JSON.stringify(got)}`); }
    for (const [k, want] of Object.entries(c.excludes ?? {})) { const got = get(details, k) ?? []; for (const w of want) if (got.includes(w)) diffs.push(`${k}: should not include ${JSON.stringify(w)}, got ${JSON.stringify(got)}`); }
    report(diffs.length === 0, `live   ${c.ask}${c.args?.context ? ` [ctx: ${c.args.context}]` : ""}  (${took} ms; ${text.match(/routed by \w+/)?.[0] ?? ""}; ${details.timing ? Object.entries(details.timing).map(([k, v]) => `${k} ${v}`).join(", ") : ""})`, diffs.join("; "));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail);
