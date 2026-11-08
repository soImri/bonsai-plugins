#!/usr/bin/env node
// Keep the shared frame audit unchanged. Fail closed on empty coverage or a
// failed installed OCR engine that the shared script reports as unavailable.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

try {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('node audit-privacy.mjs --out <NEW-directory> [--allow-domain example.com]... <gif-or-frame-folder>...');
    process.exit(0);
  }
  let out; const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out' || argv[i] === '--allow-domain') {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Missing option value.');
      if (argv[i] === '--out') out = path.resolve(argv[i + 1]);
      i++;
    } else if (argv[i].startsWith('--')) throw Error('Unknown option; see --help.');
    else inputs.push(path.resolve(argv[i]));
  }
  if (!out || !inputs.length) throw Error('Need --out and at least one input.');
  if (fs.existsSync(out)) throw Error('Audit output already exists. Choose a new directory; never reuse stale evidence.');
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frame-audit.mjs');
  const run = spawnSync(process.execPath, [script, ...argv], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.error) throw run.error;
  if (run.status !== 0) { process.exitCode = run.status || 1; }
  else {
    const coverage = JSON.parse(fs.readFileSync(path.join(out, 'coverage.json'), 'utf8'));
    const findings = JSON.parse(fs.readFileSync(path.join(out, 'findings.json'), 'utf8'));
    const errors = [];
    if (coverage.inputs.length !== inputs.length || coverage.inputs.some((entry, i) => path.resolve(entry.input) !== inputs[i])) errors.push('Input coverage does not match the requested inputs.');
    for (const entry of coverage.inputs) {
      if (!entry.frames?.length || !entry.states?.length || !entry.sheets?.length) errors.push(`No frame coverage for ${entry.input}.`);
    }
    if (findings.ocrEngine === 'unavailable' && /macOS Vision OCR failed:/i.test(run.stderr || '')) errors.push('Installed OCR failed without a successful fallback. Resolve it before delivery.');
    if (findings.ocrEngine !== 'unavailable' && findings.ocrStates !== coverage.totals.states) errors.push('OCR did not cover every distinct state.');
    if (findings.ocrErrors.length || findings.disallowedEmails.length) errors.push('OCR errors or disallowed addresses remain.');
    fs.writeFileSync(path.join(out, 'gate.json'), JSON.stringify({ passed: !errors.length, errors, visualReviewRequired: true, ocrUnavailable: findings.ocrEngine === 'unavailable' }, null, 2));
    if (errors.length) { console.error('FAIL: ' + errors.join(' ')); process.exitCode = 2; }
    else console.log('PASS: nonempty per-input frame coverage. Visual review of every state is still required.');
  }
} catch (error) { console.error('FAIL: ' + error.message); process.exitCode = 1; }
