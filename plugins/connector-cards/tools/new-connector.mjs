#!/usr/bin/env node
// Scaffold a connector: node tools/new-connector.mjs <id> "<Label>" <serviceId> <schemeId>
//   e.g. node tools/new-connector.mjs slack "Slack" slack.account slack.oauth
//
// Creates connectors/<id>/{index.ts, api.ts, rubrics.ts, write.ts, ui.tsx, SCREENS.md, evals.json}
// from tools/template, registers the connector in connectors/index.ts and connectors/ui.ts, and adds
// the sign-in to kay-plugin.json. Then prints what is left for a human: the install-row grant.
import { mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [, , id, label, serviceId, schemeId] = process.argv;
if (!id || !label || !serviceId || !schemeId || !/^[a-z][a-z0-9]*$/.test(id)) {
  console.error('usage: node tools/new-connector.mjs <id: lowercase letters/digits> "<Label>" <serviceId> <schemeId>');
  process.exit(2);
}
const dir = join(root, "connectors", id);
try { await access(dir); console.error(`connectors/${id} already exists; nothing written.`); process.exit(1); } catch { /* good */ }

const fill = (s) => s.replaceAll("__ID__", id).replaceAll("__LABEL__", label).replaceAll("__SERVICE__", serviceId).replaceAll("__SCHEME__", schemeId);
await mkdir(dir, { recursive: true });
for (const f of await readdir(join(root, "tools", "template"))) await writeFile(join(dir, f), fill(await readFile(join(root, "tools", "template", f), "utf8")));

async function insert(file, importLine, entry) {
  const p = join(root, file);
  let s = await readFile(p, "utf8");
  const mark = "  // @connectors";
  if (!s.includes(mark)) throw new Error(`${file}: marker '// @connectors' not found`);
  const lastImport = s.lastIndexOf("\nimport ");
  const endOfImports = s.indexOf("\n", lastImport + 1);
  s = `${s.slice(0, endOfImports + 1)}${importLine}\n${s.slice(endOfImports + 1)}`.replace(mark, `  ${entry},\n${mark}`);
  await writeFile(p, s);
}
await insert("connectors/index.ts", `import { ${id} } from "./${id}/index.ts";`, id);
await insert("connectors/ui.ts", `import { ${id}Ui } from "./${id}/ui.tsx";`, `${id}Ui`);

const manifestPath = join(root, "kay-plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const auth = ((manifest.permissions ??= { byTarget: {} }).byTarget["kay.agent"] ??= {}).auth ??= [];
if (!auth.some((g) => g.service === serviceId)) auth.push({ service: serviceId, schemes: [schemeId], operations: ["resolve"], purposes: [`Read and write ${label} records to draw and apply the ${label} cards.`] });
manifest.description = manifest.description.replace(/ today;/, `, ${label} today;`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Scaffolded connectors/${id}/ (${label}) and registered it.

Next:
  1. Fill the TODOs: api.ts (the calls), rubrics.ts (what Jev is asked), write.ts (the card grammar), ui.tsx (the screens), SCREENS.md.
  2. The sign-in grant is the human's: add to the plugin's row in config://settings/installs
       - target: plugin
         slug: auth.shared-identity
         envelope:
           service: ${serviceId}
     Until it is granted, the whole agent target is refused (auth-grant-shared-identity-not-granted).
  3. node tools/eval.mjs ${id} --only parse   (then live cases from a fresh session)
  4. git commit  → the plugin reloads; test in a fresh chat ("what's new in ${label}?").`);
