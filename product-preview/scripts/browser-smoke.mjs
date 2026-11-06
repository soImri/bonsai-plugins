// Isolated synthetic page only. Never attaches to a user's browser or runs a model.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const temp=await mkdtemp(path.join(tmpdir(),'preview-browser-'));
const child=spawn(chromium.executablePath(),['--headless','--no-sandbox','--remote-debugging-port=0',`--user-data-dir=${path.join(temp,'profile')}`,'about:blank'],{stdio:'ignore'});
let browser;
try {
 let port;
 for(let i=0;i<100;i++){try{port=(await readFile(path.join(temp,'profile','DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
 assert.ok(port,'Synthetic Chromium did not open its debug port');
 const endpoint=`http://127.0.0.1:${port}`;
 browser=await chromium.connectOverCDP(endpoint);
 const page=browser.contexts()[0].pages()[0];
 await page.goto('data:text/html,<title>Preview fixture</title><body><input aria-label="Demo"><button>Show result</button><p id="result"></p><script>document.querySelector("button").onclick=()=>document.querySelector("p").textContent="Real fixture result"</script>');
 const fixtureURL=page.url();
 const scenario=path.join(temp,'scenario.mjs');
 await writeFile(scenario,`export async function prepare({page,expect}){await expect(page.getByLabel('Demo')).toBeVisible();}
export async function run({page,mark,type,glide,wait,expect}){mark('task_start');await type(page.getByLabel('Demo'),'A safe fixture');await glide(page.getByRole('button'));mark('task_sent');await expect(page.locator('#result')).toHaveText('Real fixture result');mark('result');await wait(250);mark('end');}
export async function cleanup({page,expect}){await page.getByLabel('Demo').fill('');await expect(page.getByLabel('Demo')).toHaveValue('');}`);
 const env={...process.env,DEMO_CDP:endpoint,DEMO_PAGE:fixtureURL,DEMO_OUT:path.join(temp,'take')};
 const record=spawn(process.execPath,[path.join(root,'record-preview.mjs'),scenario],{env,stdio:['ignore','pipe','pipe']});
 let log='';record.stdout.on('data',b=>log+=b);record.stderr.on('data',b=>log+=b);const [code]=await once(record,'exit');
 assert.equal(code,0,log);const evidence=JSON.parse(await readFile(path.join(env.DEMO_OUT,'events.json'),'utf8'));
 assert.equal(evidence.status,'ok');assert.equal(evidence.cleanupVerified,true);
 assert.equal(await page.locator('[id^="__product_preview_pointer"]').count(),0);
 assert.equal(await page.getByLabel('Demo').inputValue(),'');assert.equal(page.isClosed(),false,'Recorder closed the existing page');
 // Existing directory must be refused, not silently overwrite evidence.
 const repeat=spawn(process.execPath,[path.join(root,'record-preview.mjs'),scenario],{env,stdio:'ignore'});const [repeatCode]=await once(repeat,'exit');assert.notEqual(repeatCode,0);
 // Failing run must still clean up and leave failure evidence.
 await writeFile(scenario,`export async function prepare(){};export async function run({page}){await page.getByLabel('Demo').fill('owned work');throw new Error('deliberate fixture failure')};export async function cleanup({page}){await page.getByLabel('Demo').fill('')}`);
 const failedDir=path.join(temp,'failed');
 const failure=spawn(process.execPath,[path.join(root,'record-preview.mjs'),scenario],{env:{...env,DEMO_OUT:failedDir},stdio:'ignore'});const [failedCode]=await once(failure,'exit');assert.notEqual(failedCode,0);
 const failed=JSON.parse(await readFile(path.join(failedDir,'events.json'),'utf8'));assert.equal(failed.status,'failed');assert.equal(failed.cleanupVerified,true);assert.equal(await page.getByLabel('Demo').inputValue(),'');assert.equal(await page.locator('[id^="__product_preview_pointer"]').count(),0);
 // A cooperative timeout must use fresh, working helpers in cleanup.
 await writeFile(scenario,`export async function prepare(){};export async function run({wait}){await wait(10000)};export async function cleanup({page,wait,type}){await wait(10);await type(page.getByLabel('Demo'),'cleanup works');await page.getByLabel('Demo').fill('')}`);
 const timedDir=path.join(temp,'timed');
 const timed=spawn(process.execPath,[path.join(root,'record-preview.mjs'),scenario],{env:{...env,DEMO_OUT:timedDir,DEMO_TIMEOUT_MS:'100'},stdio:'ignore'});const [timedCode]=await once(timed,'exit');assert.notEqual(timedCode,0);
 const timeoutEvidence=JSON.parse(await readFile(path.join(timedDir,'events.json'),'utf8'));assert.equal(timeoutEvidence.cleanupVerified,true);assert.equal(timeoutEvidence.manualCleanupRequired,false);
 // A cleanup exception must not leave pointer/rings behind or erase the run error.
 await writeFile(scenario,`export async function prepare(){};export async function run(){throw new Error('original run error')};export async function cleanup(){throw new Error('cleanup error')}`);
 const cleanupDir=path.join(temp,'cleanup-failed');const cleanup=spawn(process.execPath,[path.join(root,'record-preview.mjs'),scenario],{env:{...env,DEMO_OUT:cleanupDir},stdio:'ignore'});await once(cleanup,'exit');
 const cleanupEvidence=JSON.parse(await readFile(path.join(cleanupDir,'events.json'),'utf8'));assert.match(cleanupEvidence.failure,/original run error/);assert.ok(cleanupEvidence.errors.some(e=>e.includes('cleanup error')));assert.equal(await page.locator('[id^="__product_preview_pointer"]').count(),0);
 console.log('PASS: CDP capture/input, success/failure/timeout cleanup, preserved errors, overlay teardown, overwrite refusal, disconnect without app shutdown.');
}finally{
 await browser?.close().catch(()=>{});
 if(child.exitCode===null){const stopped=once(child,'exit');child.kill();await stopped;}
 await rm(temp,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
