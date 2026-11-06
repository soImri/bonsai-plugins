// Encode streamed page frames. No native recorder, Swift, ffmpeg or worktree lookup.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
sharp.concurrency(2); sharp.cache(false);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const inside = (root, name) => {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || /[\\/]/.test(name))
    throw new Error('Output/frame names must be plain filenames.');
  const candidate = path.join(root, name);
  if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink())
    throw new Error('Symlink output/frame paths are not allowed.');
  return candidate;
};
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const finite = value => typeof value === 'number' && Number.isFinite(value);

async function main() {
  if (!process.argv[2]) throw new Error('Usage: node make-preview-gif.cjs <take-dir> [width=800]');
  const take = path.resolve(process.argv[2]);
  const width = Number(process.argv[3] ?? 800);
  if (!Number.isInteger(width) || width < 400 || width > 1600) throw new Error('Width must be 400..1600.');
  const evidence = read(path.join(take, 'events.json'));
  if (evidence.status !== 'ok' || evidence.cleanupVerified !== true || evidence.manualCleanupRequired)
    throw new Error('Recording/cleanup did not succeed. Inspect events.json; retake after cleanup.');
  const { events, rects } = evidence;
  if (!finite(events.capture_end) || events.capture_end <= 0 || events.capture_end > 600)
    throw new Error('Invalid capture interval.');
  const source = read(path.join(take, 'frames.json')).frames;
  if (!Array.isArray(source) || !source.length) throw new Error('No source frames.');
  let previous = -Infinity;
  for (const frame of source) {
    if (!finite(frame.t) || frame.t < 0 || frame.t < previous || frame.t > events.capture_end + 0.1)
      throw new Error('Frame timestamps must be finite, ordered and within capture.');
    previous = frame.t;
    frame.path = inside(path.join(take, 'frames-raw'), frame.file);
  }
  if (source[0].t !== 0 || Math.abs(source.at(-1).t - events.capture_end) > 0.1)
    throw new Error('Missing first/final capture frame; retake.');
  const S = read(path.join(take, 'scenes.json'));
  if (!Array.isArray(S.segments) || !S.segments.length || S.segments.length > 50)
    throw new Error('Provide 1..50 segments.');
  const output = inside(take, S.out ?? 'preview.gif');
  if (!output.endsWith('.gif')) throw new Error('Output must end in .gif.');
  const first = await sharp(source[0].path).metadata();
  const win = rects?.window;
  if (!win || !finite(win.w) || !finite(win.h) || win.w <= 0 || win.h <= 0)
    throw new Error('Missing CSS viewport geometry.');
  // Refuse hot reload/resizing or mixed frames rather than silently deforming footage.
  for (const frame of source) {
    const meta = await sharp(frame.path).metadata();
    if (meta.width !== first.width || meta.height !== first.height)
      throw new Error('Source frame dimensions changed; retake.');
  }
  const scaleX = first.width / win.w, scaleY = first.height / win.h;
  const crops = { window: { left: 0, top: 0, width: first.width, height: first.height } };
  if (S.crop) {
    const { x, y, w, h } = S.crop;
    if (![x,y,w,h].every(finite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x+w > win.w || y+h > win.h)
      throw new Error('Crop must be within the measured CSS viewport.');
    crops.crop = { left: Math.round(x*scaleX), top: Math.round(y*scaleY), width: Math.round(w*scaleX), height: Math.round(h*scaleY) };
    if (crops.crop.width < 1 || crops.crop.height < 1) throw new Error('Crop is less than one pixel.');
  }
  const base = crops.crop ?? crops.window;
  const uiHeight = Math.round(width * base.height / base.width), barHeight = 104;
  const height = uiHeight + barHeight;
  const plan = [];
  let lastEnd = -Infinity;
  for (const segment of S.segments) {
    if (!Array.isArray(segment) || segment.length < 6 || segment.length > 7) throw new Error('Invalid segment tuple.');
    const [mode, scene, from, fromPad, to, toPad, view = 'window'] = segment;
    if (!['real','wait'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
    if (!Number.isInteger(scene) || scene < 1 || scene > 99) throw new Error('Scene must be 1..99.');
    const caption = S.captions?.[scene];
    if (typeof caption !== 'string' || !caption.trim() || caption.length > 55) throw new Error(`Scene ${scene} needs a 1..55 character caption.`);
    if (!crops[view]) throw new Error(`Unknown view: ${view}`);
    if (![events[from],events[to],fromPad,toPad].every(finite)) throw new Error(`Missing/invalid event or padding: ${from}/${to}`);
    const a = events[from]+fromPad, b = events[to]+toPad, span = b-a;
    if (a < 0 || b > events.capture_end+1e-6 || span <= 0 || a < lastEnd-1e-6)
      throw new Error('Segments must be ordered, positive and within captured time.');
    lastEnd = b;
    const spedUp = mode === 'wait' && span > 5;
    const count = spedUp ? Math.min(22, Math.max(10, Math.round(span/0.6))) : Math.ceil(span/0.1);
    const delay = spedUp ? 110 : 100;
    const factor = spedUp ? span/(count*delay/1000) : undefined;
    for (let i=0; i<count; i++) plan.push({ t: a+span*i/count, delay: spedUp ? delay : Math.max(10, Math.round((span/count)*1000/10)*10), scene, view, factor });
  }
  const sceneNumbers = [...new Set(plan.map(p => p.scene))];
  if (S.poster !== undefined && !sceneNumbers.includes(S.poster)) throw new Error('Poster scene is not in the plan.');
  // Preflight every output before writing any artifact.
  for (const name of ['poster.png','contact.png','gif-proof.json']) inside(take,name);
  // Include the exact endpoint as the final held frame, with no invented elapsed playback.
  const finalSegment = S.segments.at(-1);
  const endpoint = events[finalSegment[4]] + finalSegment[5];
  plan.push({ ...plan.at(-1), t: endpoint, delay: 2200, factor: undefined });
  if (height > 2400 || plan.length > 6000)
    throw new Error('Take exceeds the frame budget; shorten it or use a smaller width/crop.');
  const ink = '#202C27', paper = '#EFF3E9';
  const captionImages = new Map();
  for (const scene of sceneNumbers) {
    const image = await sharp({ text: { text: `<span foreground="${paper}">${scene}. ${esc(S.captions[scene])}</span>`, font:'sans 14', width:width-36, wrap:'word-char', rgba:true } }).png().toBuffer({resolveWithObject:true});
    if (image.info.height > 64) throw new Error(`Scene ${scene} caption does not fit; shorten it or use a wider output.`);
    captionImages.set(scene,image.data);
  }
  const rawFrames = [];
  let k = 0, lastSignature, rawBytes = 0;
  for (const p of plan) {
    while (k+1 < source.length && source[k+1].t <= p.t) k++;
    const signature = `${k}:${p.scene}:${p.view}:${p.factor ?? ''}`;
    if (signature === lastSignature) { rawFrames.at(-1).delay += p.delay; continue; }
    lastSignature = signature;
    rawBytes += width*height*3;
    if (rawBytes > 256*1024*1024) throw new Error('Take exceeds the 256 MiB unique-frame budget; shorten it or use a smaller width/crop.');
    const ui = await sharp(source[k].path).extract(crops[p.view]).removeAlpha()
      .resize(width, uiHeight, { fit: 'contain', background: ink }).toBuffer();
    const svg = `<svg width="${width}" height="${barHeight}"><rect width="100%" height="100%" fill="${ink}"/>${p.factor ? `<text x="18" y="90" fill="${paper}" font-family="Arial,sans-serif" font-size="12">Sped up ${p.factor.toFixed(1)}×</text>` : ''}</svg>`;
    const raw = await sharp({ create: { width, height, channels: 3, background: ink } })
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }, {input:captionImages.get(p.scene),top:12,left:18}, { input: ui, top: barHeight, left: 0 }])
      .removeAlpha().raw().toBuffer();
    rawFrames.push({ raw, ...p });
  }
  if (!rawFrames.length) throw new Error('No output frames.');
  rawFrames[0].delay += 800;
  await sharp(Buffer.concat(rawFrames.map(f => f.raw)), {
    raw: { width, height: height*rawFrames.length, channels: 3, pageHeight: height }, limitInputPixels: false
  }).gif({ delay: rawFrames.map(f => f.delay), loop: 0, colours: 128, effort: 4, dither: 0.15 }).toFile(output);
  const lastOf = scene => rawFrames.map(f => f.scene).lastIndexOf(scene);
  const scenes = [...new Set(rawFrames.map(f => f.scene))];
  const picks = [...new Set([0, ...scenes.map(lastOf)])];
  const rawInput = raw => sharp(raw, { raw: { width, height, channels: 3 } });
  const posterIndex = S.poster === undefined ? rawFrames.length-1 : lastOf(S.poster);
  if (posterIndex < 0) throw new Error('Poster scene is not in the plan.');
  await rawInput(rawFrames[posterIndex].raw).png().toFile(inside(take, 'poster.png'));
  await sharp({ create: { width, height: height*picks.length, channels: 3, background: ink } })
    .composite(picks.map((i,j) => ({ input: rawFrames[i].raw, raw: { width,height,channels:3 }, left:0,top:j*height })))
    .png().toFile(inside(take, 'contact.png'));
  const meta = await sharp(output, { animated:true, limitInputPixels:false }).metadata();
  const proof = { source: { width:first.width,height:first.height,frames:source.length }, crops,
    out: { file:path.basename(output),width:meta.width,height:meta.pageHeight,frames:meta.pages,
      durationMs:meta.delay.reduce((a,b)=>a+b,0),bytes:fs.statSync(output).size },
    fastForwards: [...new Set(plan.filter(p=>p.factor).map(p=>`${p.scene}:${p.factor.toFixed(1)}x`))],
    cleanupVerified: evidence.cleanupVerified };
  fs.writeFileSync(inside(take,'gif-proof.json'), JSON.stringify(proof,null,2));
  console.log(JSON.stringify(proof));
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
