const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require('sharp');
const encoder = path.join(__dirname, 'make-preview-gif.cjs');
async function fixture(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'preview-fixture-'));
  try {
    await fs.mkdir(path.join(dir, 'frames-raw'));
    for (const [file, colour] of [['a.jpg','#e6efe1'], ['b.jpg','#336655'], ['c.jpg','#aad0bb']])
      await sharp({create:{width:400,height:200,channels:3,background:colour}}).jpeg().toFile(path.join(dir,'frames-raw',file));
    await fs.writeFile(path.join(dir,'frames.json'),JSON.stringify({frames:[{file:'a.jpg',t:0},{file:'b.jpg',t:0.5},{file:'c.jpg',t:8}]}));
    const evidence={status:'ok',cleanupVerified:true,manualCleanupRequired:false,events:{capture_start:0,start:0,sent:0.5,result:7.8,end:8,capture_end:8},rects:{window:{w:400,h:200}}};
    const scenes={captions:{1:'Start the task',2:'See the result'},segments:[['real',1,'start',0,'sent',0],['wait',1,'sent',0,'result',0],['real',2,'result',0,'end',0]],poster:2};
    await fs.writeFile(path.join(dir,'events.json'),JSON.stringify(evidence));
    await fs.writeFile(path.join(dir,'scenes.json'),JSON.stringify(scenes));
    const run=(width=400)=>spawnSync(process.execPath,[encoder,dir,String(width)],{encoding:'utf8',cwd:os.tmpdir()});
    await fn({dir,evidence,scenes,run});
  } finally { await fs.rm(dir,{recursive:true,force:true}); }
}
const update=async(dir,name,value)=>fs.writeFile(path.join(dir,name),JSON.stringify(value));

test('encodes from outside any checkout and writes review/proof artifacts',()=>fixture(async({dir,run})=>{
 const r=run();assert.equal(r.status,0,r.stderr);
 for(const name of ['preview.gif','contact.png','poster.png','gif-proof.json'])assert.ok((await fs.stat(path.join(dir,name))).size>0);
 const proof=JSON.parse(await fs.readFile(path.join(dir,'gif-proof.json'),'utf8'));
 assert.equal(proof.out.width,400);assert.equal(proof.cleanupVerified,true);assert.ok(proof.fastForwards.length);assert.ok(proof.out.durationMs<11000);
 const gif=await sharp(path.join(dir,'preview.gif'),{animated:true}).metadata();assert.equal(gif.loop,0);assert.ok(gif.pages>1);
}));
test('uses the exact endpoint snapshot for the poster',()=>fixture(async({dir,run})=>{
 const r=run();assert.equal(r.status,0,r.stderr);
 const {data,info}=await sharp(path.join(dir,'poster.png')).raw().toBuffer({resolveWithObject:true});
 const offset=((info.height-5)*info.width+200)*info.channels;
 assert.ok(Math.abs(data[offset]-170)<5 && Math.abs(data[offset+1]-208)<5,'Poster must show final green snapshot, not the previous source frame');
}));
test('wraps a long caption at the smallest width',()=>fixture(async({dir,scenes,run})=>{scenes.captions[1]='W'.repeat(55);await update(dir,'scenes.json',scenes);assert.equal(run().status,0);}));
test('validates poster before writing the GIF',()=>fixture(async({dir,scenes,run})=>{scenes.poster=99;await update(dir,'scenes.json',scenes);assert.notEqual(run().status,0);await assert.rejects(fs.stat(path.join(dir,'preview.gif')));}));
test('accepts a measured CSS crop',()=>fixture(async({dir,scenes,run})=>{
 scenes.crop={x:20,y:20,w:300,h:160};scenes.segments[0][6]='crop';await update(dir,'scenes.json',scenes);assert.equal(run().status,0);
}));
test('rejects failed cleanup',()=>fixture(async({dir,evidence,run})=>{evidence.cleanupVerified=false;await update(dir,'events.json',evidence);assert.match(run().stderr,/cleanup did not succeed/);}));
test('rejects a failed take',()=>fixture(async({dir,evidence,run})=>{evidence.status='failed';await update(dir,'events.json',evidence);assert.notEqual(run().status,0);}));
test('rejects an event missing from the capture',()=>fixture(async({dir,scenes,run})=>{scenes.segments[0][2]='absent';await update(dir,'scenes.json',scenes);assert.match(run().stderr,/Missing\/invalid event/);}));
test('rejects a scene beyond capture end',()=>fixture(async({dir,scenes,run})=>{scenes.segments[2][5]=1;await update(dir,'scenes.json',scenes);assert.match(run().stderr,/within captured time/);}));
test('rejects output traversal',()=>fixture(async({dir,scenes,run})=>{scenes.out='../escape.gif';await update(dir,'scenes.json',scenes);assert.match(run().stderr,/plain filenames/);}));
test('rejects frame traversal',()=>fixture(async({dir,run})=>{await update(dir,'frames.json',{frames:[{file:'../a.jpg',t:0}]});assert.notEqual(run().status,0);}));
test('rejects mixed dimensions',()=>fixture(async({dir,run})=>{await sharp({create:{width:401,height:200,channels:3,background:'#fff'}}).jpeg().toFile(path.join(dir,'frames-raw','b.jpg'));assert.match(run().stderr,/dimensions changed/);}));
test('rejects invalid mode',()=>fixture(async({dir,scenes,run})=>{scenes.segments[0][0]='magic';await update(dir,'scenes.json',scenes);assert.match(run().stderr,/Unknown mode/);}));
test('rejects reversed or overlapping time ranges',()=>fixture(async({dir,scenes,run})=>{scenes.segments[1][3]=-0.2;await update(dir,'scenes.json',scenes);assert.match(run().stderr,/ordered, positive/);}));
test('rejects an out-of-bounds crop',()=>fixture(async({dir,scenes,run})=>{scenes.crop={x:390,y:0,w:20,h:10};await update(dir,'scenes.json',scenes);assert.match(run().stderr,/within the measured/);}));
test('recorder has no implicit endpoint',()=>{
 const env={...process.env};delete env.DEMO_CDP;delete env.DEMO_PAGE;delete env.DEMO_OUT;
 const r=spawnSync(process.execPath,[path.join(__dirname,'record-preview.mjs'),path.join(__dirname,'scenario.example.mjs')],{env,encoding:'utf8'});
 assert.notEqual(r.status,0);assert.match(r.stderr,/Set DEMO_CDP explicitly/);
});
