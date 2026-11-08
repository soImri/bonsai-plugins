#!/usr/bin/env node
// Offline browser checks for launch-page.html. Reuses product-preview tools.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readKit } from './kit-data.mjs';

const options = { sizes: [{ width: 1440, height: 900 }, { width: 390, height: 844 }] };
try {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { console.log('node check-page.mjs --page <launch.html> --tools <preview-tools> --out <checks-dir> [--browser <chromium>]'); process.exit(0); }
    if (!['--page', '--tools', '--out', '--browser'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Unknown or incomplete option; see --help.');
    options[argv[i].slice(2)] = argv[++i];
  }
  if (!options.page || !options.tools || !options.out) throw Error('Need --page, --tools, and --out.');
  await main();
} catch (error) { console.error(`FAIL: ${error.stack || error.message}`); process.exitCode = 1; }

async function main() {
  const target = fs.realpathSync(options.page), out = path.resolve(options.out);
  const { kit } = readKit(fs.readFileSync(target, 'utf8'));
  const require = createRequire(path.join(path.resolve(options.tools), 'package.json'));
  let chromium, sharp;
  try { ({ chromium } = require('playwright')); sharp = require('sharp'); }
  catch { throw Error('Missing tools. Copy product-preview scripts and run npm ci in that folder; pass it as --tools.'); }
  fs.mkdirSync(out, { recursive: true });
  const report = { page: target, viewports: options.sizes, passes: 0, failures: [], cases: [], media: [] };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
    report.passes++;
  };
  const run = async (name, action) => {
    try { await action(); report.cases.push({ name, status: 'pass' }); }
    catch (error) { report.failures.push(`${name}: ${error.message}`); report.cases.push({ name, status: 'fail' }); }
  };
  await run('copy and embedded media', async () => {
    const copy = [kit.feature, kit.lead, ...kit.sections.flatMap(s => [s.label, ...s.previews.map(c => c.label)])].join('\n');
    check(!/\bFEATURE\b|BENEFIT_LEAD|TODO|PLACEHOLDER/.test(copy), 'Replace template placeholders.');
    check(!/\baudience\b|feature[ -]flag|merge[ -]state|recorded on|recording date|how[ -]it[ -]works/i.test(copy), 'Remove status or mechanism chrome.');
    for (const section of kit.sections) for (const [index, clip] of section.previews.entries()) {
      for (const field of ['src', 'poster', 'thumbnail']) {
        const uri = clip[field];
        check(/^data:image\/(gif|png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(uri), `${section.id}/${index}/${field} is not embedded.`);
        const meta = await sharp(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64'), { animated: true }).metadata();
        check(meta.width > 0 && meta.height > 0, 'Image has no dimensions.');
        check(field === 'src' ? meta.format === 'gif' && meta.pages > 1 : (meta.pages || 1) === 1 && meta.format !== 'gif', `${field} must be ${field === 'src' ? 'an animated GIF' : 'a static image'}.`);
        if (field === 'thumbnail') check(meta.width <= 320, 'Thumbnail must be at most 320 pixels wide.');
        report.media.push({ section: section.id, index, field, width: meta.width, height: meta.pageHeight || meta.height, frames: meta.pages || 1, durationMs: meta.delay?.reduce((a, b) => a + b, 0) });
      }
    }
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(options.browser ? { executablePath: path.resolve(options.browser) } : {}) });
    const tabbed = kit.sections.length > 2, fileURL = pathToFileURL(target).href;
    for (const viewport of options.sizes) await run(`${viewport.width}x${viewport.height}`, async () => {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block' });
      const page = await context.newPage(), runtimeErrors = [];
      await page.route('**/*', route => {
        const url = route.request().url();
        if (url.split('#')[0] === fileURL || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        runtimeErrors.push('Non-portable dependency: ' + url); return route.abort();
      });
      page.on('pageerror', e => runtimeErrors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') runtimeErrors.push(m.text()); });
      await page.addInitScript(() => {
        const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
        window.__kitURLs = new Set();
        URL.createObjectURL = blob => { const url = create(blob); window.__kitURLs.add(url); return url; };
        URL.revokeObjectURL = url => { window.__kitURLs.delete(url); return revoke(url); };
      });
      const decode = async () => {
        await page.evaluate(async () => { await Promise.all([...document.images].map(image => image.decode())); });
      };
      const geometry = async () => {
        const state = await page.evaluate(() => ({
          overflow: document.documentElement.scrollWidth > innerWidth,
          broken: [...document.images].filter(i => !i.complete || !i.naturalWidth).length,
          hiddenPlayers: [...document.querySelectorAll('[hidden] .player img')].length,
          liveURLs: window.__kitURLs.size
        }));
        check(!state.overflow, 'Horizontal document overflow.'); check(!state.broken, 'Broken image.');
        check(!state.hiddenPlayers, 'Inactive tab still has a loaded player.');
        return state;
      };
      const expectedActive = section => section.pending || !section.previews.length ? 0 : 1;
      const assertPlayer = async (section, index = 0, playing = true) => {
        const images = page.locator('.player img');
        check(await images.count() === expectedActive(section), 'More than the selected preview is materialized.');
        if (expectedActive(section)) {
          const actual = await images.getAttribute('data-playing');
          check(actual === String(playing), `${section.id}/${index}: expected playing=${playing}, got ${actual}.`);
          const expected = section.previews[index][playing ? 'src' : 'poster'];
          check(await images.getAttribute('src') === expected, 'Selected media bytes differ from the manifest.');
        }
      };
      try {
        await page.goto(fileURL); await decode();
        check(await page.title() === kit.feature, 'Wrong page title.');
        check(await page.getByRole('tab').count() === (tabbed ? kit.sections.length : 0), 'Single-surface layout must not force tabs.');
        check(await page.locator('h1').innerText() === kit.feature, 'Feature title missing.');
        check(await page.locator('.lead').textContent() === kit.lead, 'Value lead differs.');
        const sections = tabbed ? kit.sections : [kit.sections[1]];
        for (const section of sections) {
          const index = kit.sections.indexOf(section);
          const old = await page.locator('.player img').elementHandle();
          if (tabbed) await page.locator(`[data-tab="${section.id}"]`).click();
          await decode();
          if (old && tabbed) check(await old.evaluate(image => !image.isConnected && !image.hasAttribute('src')), 'Old player was not unloaded.');
          if (tabbed) {
            check(await page.getByRole('tabpanel').filter({ visible: true }).count() === 1, 'Exactly one tab panel must be visible.');
            check(new URL(page.url()).hash === '#' + section.id, 'Tab hash did not update.');
          }
          await assertPlayer(section);
          await geometry();
          const panel = page.locator(`[data-section="${section.id}"]`), gallery = panel.locator('.gallery');
          if (section.pending) {
            check(await panel.locator('.pending').innerText() === 'Coming soon', 'Pending unit must be a plain placeholder.');
            check(await gallery.count() === 0, 'Pending unit has invented demos.');
          } else if (section.previews.length) {
            const thumbs = gallery.locator('.thumbnail'), selected = gallery.locator('.thumbnail[aria-pressed="true"]');
            check(await thumbs.count() === section.previews.length, 'Thumbnail count differs.');
            check(JSON.stringify(await thumbs.locator('span').allTextContents()) === JSON.stringify(section.previews.map(c => c.label)), 'Task labels differ.');
            const thumbSize = await thumbs.first().locator('img').boundingBox();
            check(Math.abs(thumbSize.width / thumbSize.height - 8 / 7) < 0.02, 'Thumbnail image box is stretched.');
            for (let n = 0; n < section.previews.length; n++) {
              const previous = await page.locator('.player img').elementHandle();
              await thumbs.nth(n).click(); await decode();
              check(await previous.evaluate(image => !image.isConnected && !image.hasAttribute('src')), 'Previous clip still loaded.');
              await assertPlayer(section, n);
              check(await selected.getAttribute('aria-label') === section.previews[n].label, 'Selected thumbnail label differs.');
              check(await gallery.locator('.task').innerText() === section.previews[n].label, 'Active task label differs.');
            }
            // Reset then exercise arrows, wrapping, gallery keys, Replay and Pause.
            await thumbs.first().click();
            if (section.previews.length > 1) {
              await gallery.locator('.next').click(); await assertPlayer(section, 1);
              await gallery.locator('.previous').click(); await assertPlayer(section, 0);
            } else check(await gallery.locator('.next').isDisabled() && await gallery.locator('.previous').isDisabled(), 'Single-clip arrows must be disabled.');
            await gallery.focus(); await page.keyboard.press('ArrowLeft'); await assertPlayer(section, section.previews.length - 1);
            await page.keyboard.press('ArrowRight'); await assertPlayer(section, 0);
            await page.keyboard.press('End'); await assertPlayer(section, section.previews.length - 1);
            const rail = await selected.evaluate(e => { const a = e.getBoundingClientRect(), b = e.parentElement.getBoundingClientRect(); return { visible: a.left >= b.left - 1 && a.right <= b.right + 1, scroll: e.parentElement.scrollWidth > e.parentElement.clientWidth }; });
            check(rail.visible, 'Keyboard-selected thumbnail is offscreen.');
            if (viewport.width === 390 && section.previews.length >= 3) check(rail.scroll, 'Mobile thumbnail rail must scroll sideways when its content exceeds the width.');
            await page.keyboard.press('Home'); await assertPlayer(section, 0);
            await gallery.locator('.replay').click(); await decode();
            check((await page.locator('.player img').getAttribute('src')).startsWith('blob:'), 'Replay did not restart embedded GIF.');
            check((await geometry()).liveURLs === 1, 'Replay URL missing or leaked.');
            await gallery.locator('.replay').click(); await decode();
            check((await geometry()).liveURLs === 1, 'Repeated Replay leaked its old URL.');
            await gallery.locator('.play').click(); await assertPlayer(section, 0, false);
            check((await geometry()).liveURLs === 0, 'Pause leaked the replay URL.');
            await gallery.locator('.play').click(); await assertPlayer(section, 0, true);
            await decode();
          }
          await page.screenshot({ path: path.join(out, `${viewport.width}-${section.id}.png`), fullPage: true });
        }
        // Every direct hash must select only its own player, without warm state.
        for (const section of sections) {
          await page.goto(fileURL + (tabbed ? '#' + section.id : '')); await decode();
          await assertPlayer(section); await geometry();
          if (tabbed) {
            const tab = page.locator('[role="tab"][aria-selected="true"]');
            check(await tab.getAttribute('data-tab') === section.id, 'Direct hash selected the wrong tab.');
            const rect = await tab.boundingBox(); check(rect.x >= -1 && rect.x + rect.width <= viewport.width + 1, 'Direct hash tab is offscreen.');
          }
        }
        if (tabbed) {
          await page.locator('[role="tab"]').first().focus(); await page.keyboard.press('Home');
          await page.keyboard.press('ArrowRight'); check(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab') === kit.sections[1].id, 'Tab ArrowRight failed.');
          await page.keyboard.press('ArrowLeft'); check(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab') === 'concept', 'Tab ArrowLeft failed.');
          await page.keyboard.press('End'); check(await page.locator('[role="tab"][aria-selected="true"]').getAttribute('data-tab') === kit.sections.at(-1).id, 'Tab End failed.');
          await page.keyboard.press('Home');
        }
        const populated = sections.find(s => s.previews.length);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(fileURL + (tabbed ? '#' + populated.id : '')); await decode();
        await page.waitForFunction(() => document.querySelector('.player img')?.dataset.playing === 'false');
        await assertPlayer(populated, 0, false);
        await page.locator(`[data-section="${populated.id}"] .play`).click(); await assertPlayer(populated, 0, true);
        check(runtimeErrors.length === 0, runtimeErrors.join('; '));
      } finally { await context.close(); }
    });
  } catch (error) { report.failures.push('Browser: ' + error.message); }
  finally { await browser?.close(); }
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(`${report.failures.length ? 'FAIL' : 'PASS'}: ${report.passes} assertions; ${report.failures.length} failures; viewports 1440x900 and 390x844. Proof: ${path.join(out, 'checks.json')}`);
  for (const failure of report.failures) console.error(failure);
  if (report.failures.length) process.exitCode = 1;
}
