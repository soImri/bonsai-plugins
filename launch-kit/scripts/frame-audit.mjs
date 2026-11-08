#!/usr/bin/env node
// Privacy audit for preview recordings: decode EVERY frame of each input, keep one
// PNG per distinct pixel state, lay all states out on numbered contact sheets,
// OCR every state, and flag email addresses outside the allowed domains.
//
// Run it from the working folder where product-preview's scripts ran `npm ci`
// (it needs `sharp` from there). OCR uses macOS Vision through ocr.swift beside
// this file, or `tesseract` when it is on PATH; without either it still builds
// the sheets and reports OCR as unavailable.
//
// Usage:
//   node frame-audit.mjs --out <dir> [--allow-domain example.com]... <input>...
// An input is a .gif (every page is decoded) or a folder of frame images
// (.png/.jpg/.jpeg/.webp, sorted by name), such as a take's raw frames.
//
// Exit codes: 0 clean, 2 an address outside the allowed domains or an OCR error
// was found, 1 the audit itself failed.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadSharp() {
  for (const base of [process.cwd() + "/", here + "/"]) {
    try {
      return createRequire(base)("sharp");
    } catch {}
  }
  console.error("sharp not found. Run this from the folder where product-preview's scripts ran `npm ci`.");
  process.exit(1);
}

function parseArgs(argv) {
  const args = { out: null, allow: [], inputs: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--allow-domain") args.allow.push(argv[++i].toLowerCase());
    else if (a === "--help" || a === "-h") {
      console.log("node frame-audit.mjs --out <dir> [--allow-domain example.com]... <gif-or-frame-folder>...");
      process.exit(0);
    } else args.inputs.push(a);
  }
  if (!args.out || args.inputs.length === 0) {
    console.error("Need --out <dir> and at least one input. See --help.");
    process.exit(1);
  }
  return args;
}

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const esc = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const pad = (n) => String(n).padStart(4, "0");

async function decodeInput(sharp, input) {
  const frames = [];
  if (statSync(input).isDirectory()) {
    const files = readdirSync(input)
      .filter((f) => [".png", ".jpg", ".jpeg", ".webp"].includes(extname(f).toLowerCase()))
      .sort();
    for (const f of files) {
      const { data, info } = await sharp(join(input, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      frames.push({ source: f, pixels: data, width: info.width, height: info.height, channels: info.channels });
    }
    return { kind: "frames", frames };
  }
  const meta = await sharp(input, { animated: true, limitInputPixels: false }).metadata();
  const { data, info } = await sharp(input, { animated: true, limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pages = meta.pages ?? 1;
  const height = meta.pageHeight ?? info.height;
  const size = info.width * height * info.channels;
  let ms = 0;
  for (let i = 0; i < pages; i++) {
    const delay = Array.isArray(meta.delay) ? meta.delay[i] ?? 0 : 0;
    frames.push({
      source: `page ${i}`,
      startMs: ms,
      pixels: data.subarray(i * size, (i + 1) * size),
      width: info.width,
      height,
      channels: info.channels,
    });
    ms += delay;
  }
  return { kind: "gif", frames, durationMs: ms };
}

async function buildSheets(sharp, label, states, outDir) {
  const sheets = [];
  const tileW = Math.min(800, Math.max(...states.map((s) => s.width)));
  const tileH = Math.max(...states.map((s) => Math.round((s.height * tileW) / s.width)));
  const per = 6;
  for (let start = 0; start < states.length; start += per) {
    const chunk = states.slice(start, start + per);
    const composite = [];
    for (let j = 0; j < chunk.length; j++) {
      const left = (j % 2) * tileW;
      const top = Math.floor(j / 2) * (tileH + 24);
      const caption = `${label} · state ${chunk[j].state} · first frame ${chunk[j].firstFrame}`;
      composite.push({
        input: Buffer.from(
          `<svg width="${tileW}" height="24"><rect width="100%" height="100%" fill="white"/><text x="8" y="17" font-size="13" font-family="Helvetica, Arial, sans-serif" fill="black">${esc(caption)}</text></svg>`,
        ),
        left,
        top,
      });
      composite.push({
        input: await sharp(chunk[j].path).resize(tileW, tileH, { fit: "contain", background: "#808080" }).png().toBuffer(),
        left,
        top: top + 24,
      });
    }
    const file = join(outDir, `sheet-${pad(start / per)}.png`);
    await sharp({
      create: { width: tileW * 2, height: Math.ceil(chunk.length / 2) * (tileH + 24), channels: 3, background: "#ffffff" },
    })
      .composite(composite)
      .png()
      .toFile(file);
    sheets.push({ path: file, states: chunk.map((s) => s.state) });
  }
  return sheets;
}

function runOcr(paths, outDir) {
  const listFile = join(outDir, "ocr-paths.json");
  writeFileSync(listFile, JSON.stringify(paths, null, 2));
  const resultFile = join(outDir, "ocr.json");
  const swiftScript = join(here, "ocr.swift");
  const hasSwift = process.platform === "darwin" && spawnSync("swift", ["--version"], { stdio: "ignore" }).status === 0;
  if (hasSwift && existsSync(swiftScript)) {
    const run = spawnSync("swift", [swiftScript, listFile, resultFile], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (run.status === 0 && existsSync(resultFile)) {
      return { engine: "macos-vision", results: JSON.parse(readFileSync(resultFile, "utf8")) };
    }
    console.error("macOS Vision OCR failed:", (run.stderr || "").slice(0, 500));
  }
  if (spawnSync("tesseract", ["--version"], { stdio: "ignore" }).status === 0) {
    const results = paths.map((file) => {
      const run = spawnSync("tesseract", [file, "-", "--psm", "11"], { encoding: "utf8" });
      if (run.status !== 0) return { file, error: (run.stderr || "tesseract failed").slice(0, 300) };
      return { file, lines: run.stdout.split("\n").filter(Boolean).map((text) => ({ text })) };
    });
    writeFileSync(resultFile, JSON.stringify(results, null, 2));
    return { engine: "tesseract", results };
  }
  return { engine: "unavailable", results: [] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sharp = loadSharp();
  sharp.concurrency(1);
  sharp.cache(false);
  const out = resolve(args.out);
  mkdirSync(out, { recursive: true });

  const coverage = { inputs: [], totals: { frames: 0, states: 0, sheets: 0 } };
  const allStates = [];
  for (const [index, input] of args.inputs.entries()) {
    const label = `${index + 1}-${basename(input).replace(/[^A-Za-z0-9._-]+/g, "_")}`;
    const dir = join(out, label);
    mkdirSync(dir, { recursive: true });
    const decoded = await decodeInput(sharp, resolve(input));
    const seen = new Map();
    const states = [];
    const frames = decoded.frames.map((f, i) => {
      const digest = sha(f.pixels);
      let state = seen.get(digest);
      if (state === undefined) {
        state = states.length;
        seen.set(digest, state);
        states.push({ state, firstFrame: i, hash: digest, width: f.width, height: f.height, f });
      }
      return { frame: i, source: f.source, startMs: f.startMs, state };
    });
    for (const s of states) {
      s.path = join(dir, `state-${pad(s.state)}.png`);
      await sharp(s.f.pixels, { raw: { width: s.width, height: s.height, channels: s.f.channels } }).png().toFile(s.path);
      delete s.f;
    }
    const sheets = await buildSheets(sharp, label, states, dir);
    coverage.inputs.push({ input: resolve(input), kind: decoded.kind, durationMs: decoded.durationMs, frames, states, sheets });
    coverage.totals.frames += frames.length;
    coverage.totals.states += states.length;
    coverage.totals.sheets += sheets.length;
    for (const s of states) allStates.push({ input: label, ...s });
  }

  const ocr = runOcr(allStates.map((s) => s.path), out);
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  const findings = { ocrEngine: ocr.engine, ocrStates: ocr.results.length, ocrErrors: [], emails: [], disallowedEmails: [] };
  const textLines = [];
  for (const r of ocr.results) {
    if (r.error) {
      findings.ocrErrors.push({ file: r.file, error: r.error });
      continue;
    }
    for (const line of r.lines ?? []) {
      textLines.push(`${basename(dirname(r.file))}/${basename(r.file)}\t${line.text}`);
      for (const email of line.text.match(emailRe) ?? []) {
        const domain = email.split("@")[1].toLowerCase();
        const allowed = args.allow.some((d) => domain === d || domain.endsWith("." + d));
        const hit = { email, file: r.file, allowed };
        findings.emails.push(hit);
        if (!allowed) findings.disallowedEmails.push(hit);
      }
    }
  }
  writeFileSync(join(out, "coverage.json"), JSON.stringify(coverage, null, 2));
  writeFileSync(join(out, "findings.json"), JSON.stringify(findings, null, 2));
  writeFileSync(join(out, "ocr-text.tsv"), textLines.join("\n") + "\n");

  const summary = {
    out,
    frames: coverage.totals.frames,
    distinctStates: coverage.totals.states,
    contactSheets: coverage.totals.sheets,
    ocrEngine: ocr.engine,
    ocrStates: findings.ocrStates,
    ocrErrors: findings.ocrErrors.length,
    emailsFound: findings.emails.length,
    disallowedEmails: findings.disallowedEmails.map((h) => h.email),
    next: "Open every sheet-*.png at full size and skim ocr-text.tsv for private titles, DMs and outside data.",
  };
  console.log(JSON.stringify(summary, null, 2));
  if (ocr.engine === "unavailable") console.error("OCR unavailable: review every contact sheet by eye and say OCR was not run.");
  process.exitCode = findings.disallowedEmails.length > 0 || findings.ocrErrors.length > 0 ? 2 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
