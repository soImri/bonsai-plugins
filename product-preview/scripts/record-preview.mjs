// Portable page-frame recorder. Product-specific actions live in the scenario.
import { chromium, expect } from 'playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} explicitly; no machine-specific default is used.`);
  return value;
};
const endpoint = new URL(required('DEMO_CDP'));
if (!['http:', 'https:'].includes(endpoint.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))
  throw new Error('DEMO_CDP must be a loopback HTTP(S) CDP endpoint.');
const pageURL = required('DEMO_PAGE');
const out = required('DEMO_OUT');
if (!path.isAbsolute(out)) throw new Error('DEMO_OUT must be an absolute new directory.');
const timeout = Number(process.env.DEMO_TIMEOUT_MS ?? 180000);
if (!Number.isFinite(timeout) || timeout < 100 || timeout > 600000)
  throw new Error('DEMO_TIMEOUT_MS must be 100..600000.');
if (!process.argv[2]) throw new Error('Usage: node record-preview.mjs ./scenario.mjs');
const scenario = await import(pathToFileURL(path.resolve(process.argv[2])).href);
for (const hook of ['prepare', 'run', 'cleanup'])
  if (typeof scenario[hook] !== 'function') throw new Error(`Scenario must export ${hook}().`);
await mkdir(out); // Refuse existing takes, including symlinks; never mix frames.
await mkdir(path.join(out, 'frames-raw'));
const events = {};
const frames = [];
const errors = [];
const writes = [];
const controller = new AbortController();
let browser, page, cdp, captureStarted = false, pointerSetupAttempted = false;
const pointerId = `__product_preview_pointer_${randomUUID()}`;
const ringClass = `__product_preview_ring_${randomUUID()}`;
let started = performance.now(), pending, lastSaved = -Infinity, flushTimer;
let failure, cleanupVerified = false, manualCleanupRequired = false, rects;
let acceptingFrames = false;
const elapsed = () => (performance.now() - started) / 1000;
const mark = (name, signal = controller.signal) => {
  signal.throwIfAborted();
  if (!/^[a-z][a-z0-9_]*$/.test(name) || Object.hasOwn(events, name))
    throw new Error(`Use a unique event name (lowercase/underscores): ${name}`);
  events[name] = elapsed();
};
const save = (data, t) => {
  const file = `f${String(frames.length).padStart(5, '0')}.jpg`;
  frames.push({ file, t });
  lastSaved = t;
  // Attach a rejection handler immediately; keep evidence of disk-write failures.
  writes.push(writeFile(path.join(out, 'frames-raw', file), Buffer.from(data, 'base64'))
    .catch(error => { errors.push(`frame write: ${error.message}`); }));
};
const flush = () => {
  clearTimeout(flushTimer); flushTimer = undefined;
  if (pending) { save(pending.data, pending.t); pending = undefined; }
};
const bounded = async (promise, label, ms = 10000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  })]); } finally { clearTimeout(timer); }
};
let interrupts = 0;
const interrupt = () => {
  if (++interrupts > 1) {
    console.error('Forced exit: manual demo cleanup required.'); process.exit(130);
  }
  controller.abort(new Error('Recording interrupted; cancelling the scenario and cleaning up.'));
};
process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
const deadline = async (fn, ms, label, aborter = controller) => {
  aborter.signal.throwIfAborted();
  let settled = false;
  const work = Promise.resolve().then(fn).finally(() => { settled = true; });
  work.catch(() => {});
  let clock, onAbort;
  try {
    aborter.signal.throwIfAborted();
    return await Promise.race([work, new Promise((_, reject) => {
      onAbort = () => reject(aborter.signal.reason);
      aborter.signal.addEventListener('abort', onAbort, { once: true });
      clock = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    })]);
  } catch (error) {
    if (!settled) {
      aborter.abort(error);
      // Cooperative scenarios settle when their current bounded action exits.
      await Promise.race([work.catch(() => {}), new Promise(r => setTimeout(r, 2000))]);
      if (!settled) manualCleanupRequired = true;
    }
    throw error;
  } finally { clearTimeout(clock); if (onAbort) aborter.signal.removeEventListener('abort', onAbort); }
};

try {
  browser = await chromium.connectOverCDP(endpoint.href, { timeout: 15000 });
  const matches = browser.contexts().flatMap(c => c.pages()).filter(p => p.url() === pageURL);
  if (matches.length !== 1)
    throw new Error(`DEMO_PAGE must match exactly one page; matched ${matches.length}. Select a unique page URL.`);
  [page] = matches;
  page.setDefaultTimeout(10000);
  const viewport = () => bounded(page.evaluate(() => ({ w: innerWidth, h: innerHeight })), 'viewport read');
  rects = { window: await viewport() };
  const errorListener = error => errors.push(`page error: ${error.message}`);
  page.on('pageerror', errorListener);
  const makeContext = signal => {
    const check = () => signal.throwIfAborted();
    return {
    page, expect, mark: name => mark(name, signal), signal,
    wait: async ms => { check(); await delay(ms, undefined, { signal }); check(); },
    glide: async (locator, options = {}) => {
      check();
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      if (!box) throw new Error('No visible box for demo target.');
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      await page.mouse.move(x, y, { steps: 20 });
      await page.evaluate(({ x, y, click, pointerId, ringClass }) => {
        const pointer = document.getElementById(pointerId);
        if (pointer) pointer.style.transform = `translate(${x - 4}px,${y - 3}px)`;
        if (click) {
          const ring = document.createElement('div');
          ring.className = ringClass;
          ring.style.cssText = `position:fixed;left:${x-14}px;top:${y-14}px;width:28px;height:28px;border:2px solid #888;border-radius:50%;pointer-events:none;z-index:2147483646`;
          document.body.append(ring); setTimeout(() => ring.remove(), 350);
        }
      }, { x, y, click: options.click !== false, pointerId, ringClass });
      await delay(120, undefined, { signal }); check();
      if (options.click !== false) { check(); await locator.click(); }
    },
    type: async (locator, text) => {
      check(); await locator.focus(); await locator.pressSequentially(text, { delay: 22 });
      const actual = await locator.evaluate(el => 'value' in el ? el.value : el.textContent);
      if (String(actual).replace(/\s+/g, ' ').trim() !== text.replace(/\s+/g, ' ').trim())
        throw new Error('Typed text did not land completely; no message was sent.');
      check();
    }
    };
  };
  const ctx = makeContext(controller.signal);
  // Cleanup is registered before preparation; the scenario owns its specific scope.
  try {
    await deadline(() => scenario.prepare(ctx), 30000, 'prepare');
    if (await bounded(page.evaluate(() => !!document.querySelector('[id^="__product_preview_pointer"]')), 'existing pointer check'))
      throw new Error('A preview pointer already exists; another take may be active.');
    pointerSetupAttempted = true;
    await bounded(page.evaluate(pointerId => {
      const pointer = document.createElement('div'); pointer.id = pointerId;
      pointer.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px)';
      pointer.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 3v17l5-5 4 7 3-2-4-7h7Z" fill="#202020" stroke="white" stroke-width="1.5"/></svg>';
      document.body.append(pointer);
    }, pointerId), 'pointer setup');
    rects = { window: await viewport() };
    cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', event => {
      cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(error => {
        if (acceptingFrames) errors.push(`frame acknowledgement: ${error.message}`);
      });
      if (!acceptingFrames) return;
      const t = elapsed();
      if (t - lastSaved >= 0.1) { pending = undefined; save(event.data, t); }
      else {
        pending = { data: event.data, t };
        flushTimer ??= setTimeout(flush, Math.max(1, (0.1 - (t-lastSaved))*1000));
      }
    });
    started = performance.now();
    const first = await bounded(cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }), 'first snapshot');
    save(first.data, 0);
    events.capture_start = 0;
    acceptingFrames = true;
    captureStarted = true;
    await bounded(cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 }), 'capture start');
    await deadline(() => scenario.run(ctx), timeout, 'run');
    const after = await viewport();
    if (after.w !== rects.window.w || after.h !== rects.window.h)
      throw new Error('Viewport changed during the take; record a separate take for each size.');
    await bounded(cdp.send('Page.stopScreencast'), 'capture stop'); captureStarted = false; acceptingFrames = false;
    flush();
    const last = await bounded(cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 90 }), 'last snapshot');
    events.capture_end = elapsed(); save(last.data, events.capture_end);
    if (errors.length) throw new Error('Capture/page errors occurred; inspect events.json and retake.');
  } catch (error) {
    failure = String(error.stack ?? error);
    throw error;
  } finally {
    acceptingFrames = false;
    if (captureStarted) await bounded(cdp.send('Page.stopScreencast'), 'capture teardown').catch(error => errors.push(error.message));
    flush();
    try {
      if (!manualCleanupRequired) {
        const cleanupController = new AbortController();
        await deadline(() => scenario.cleanup(makeContext(cleanupController.signal)), 30000, 'cleanup', cleanupController);
        cleanupVerified = true;
      }
    } catch (error) {
      errors.push(`cleanup: ${error.message}`);
      failure ??= String(error.stack ?? error);
    } finally {
      if (pointerSetupAttempted) await bounded(page.evaluate(({ pointerId, ringClass }) => {
        document.getElementById(pointerId)?.remove();
        document.getElementsByClassName(ringClass).length && [...document.getElementsByClassName(ringClass)].forEach(el => el.remove());
      }, { pointerId, ringClass }), 'overlay teardown').catch(error => errors.push(error.message));
      page.off('pageerror', errorListener);
    }
  }
} catch (error) {
  failure ??= String(error.stack ?? error);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(flushTimer);
  process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
  if (cdp) await bounded(cdp.detach(), 'CDP disconnect').catch(error => errors.push(error.message));
  if (browser) await bounded(browser.close(), 'browser disconnect').catch(error => errors.push(error.message)); // Disconnect from CDP; do not close the existing app.
  await Promise.all(writes);
  if (errors.length && !failure) { failure = errors.join('\n'); process.exitCode = 1; }
  const status = !failure && cleanupVerified && !manualCleanupRequired ? 'ok' : 'failed';
  await writeFile(path.join(out, 'events.json'), JSON.stringify({
    status, events, rects, errors, failure, cleanupVerified, manualCleanupRequired
  }, null, 2));
  await writeFile(path.join(out, 'frames.json'), JSON.stringify({ frames }, null, 2));
  if (status !== 'ok') process.exitCode = 1;
  console.log(JSON.stringify({ status, frames: frames.length, cleanupVerified, manualCleanupRequired }));
}
