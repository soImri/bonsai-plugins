#!/usr/bin/env node
// Generate disposable fixtures from solid colors only. Never captures a product.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readKit, jsonForHTML } from './kit-data.mjs';

try {
  const args = {}, argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { console.log('node smoke.mjs --out <scratch-folder> --tools <preview-tools>'); process.exit(0); }
    if (!['--out', '--tools'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Use --out and --tools.');
    args[argv[i].slice(2)] = argv[++i];
  }
  if (!args.out || !args.tools) throw Error('Need --out and --tools.');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), out = path.resolve(args.out);
  if (out === root || out.startsWith(root + path.sep)) throw Error('Write smoke output outside the skill source.');
  const sharp = createRequire(path.join(path.resolve(args.tools), 'package.json'))('sharp');
  const template = fs.readFileSync(path.join(root, 'templates/launch-page.html'), 'utf8'), { kit: original, start, end } = readKit(template);
  const base = structuredClone(original); base.feature = 'Focus'; base.lead = 'Finish your daily work without losing track of what matters.'; base.sections[0].label = 'Focus';
  base.sections[1].previews.push({ label: 'Finish a task', src: 'assets/finish.gif', poster: 'assets/finish.png', thumbnail: 'assets/finish-thumb.png' });
  const variants = {
    multi: base,
    single: { ...structuredClone(base), sections: [{ ...structuredClone(base.sections[0]), previews: [] }, structuredClone(base.sections[1])] },
    pending: { ...structuredClone(base), sections: [structuredClone(base.sections[0]), structuredClone(base.sections[1]), { id: 'later', label: 'Planning', pending: true, previews: [] }] }
  };
  const width = 800, height = 700;
  let color = 0;
  for (const [name, kit] of Object.entries(variants)) {
    const folder = path.join(out, name);
    if (fs.existsSync(folder)) throw Error(`${name} fixture already exists; choose a new scratch folder.`);
    fs.mkdirSync(path.join(folder, 'assets'), { recursive: true });
    for (const section of kit.sections) for (const clip of section.previews) {
      const stem = path.basename(clip.src, '.gif'), raw = path.join(folder, 'raw', stem);
      fs.mkdirSync(raw, { recursive: true });
      const first = await sharp({ create: { width, height, channels: 3, background: { r: (40 + color * 27) % 220, g: 90, b: 120 } } }).raw().toBuffer();
      const second = await sharp({ create: { width, height, channels: 3, background: { r: 160, g: (60 + color * 17) % 220, b: 80 } } }).raw().toBuffer();
      color++;
      await sharp(Buffer.concat([first, second]), { raw: { width, height: height * 2, channels: 3, pageHeight: height } }).gif({ delay: [5000, 5000], loop: 0 }).toFile(path.join(folder, clip.src));
      await sharp(first, { raw: { width, height, channels: 3 } }).png().toFile(path.join(raw, 'frame-0000.png'));
      await sharp(second, { raw: { width, height, channels: 3 } }).png().toFile(path.join(raw, 'frame-0001.png'));
      await sharp(second, { raw: { width, height, channels: 3 } }).png().toFile(path.join(folder, clip.poster));
      await sharp(second, { raw: { width, height, channels: 3 } }).resize({ width: 320, withoutEnlargement: true }).png().toFile(path.join(folder, clip.thumbnail));
    }
    fs.writeFileSync(path.join(folder, 'index.html'), template.slice(0, start) + '\n' + jsonForHTML(kit) + '\n' + template.slice(end));
    await sharp({ create: { width: 3200, height: 1800, channels: 3, background: '#384b40' } }).png().toFile(path.join(folder, 'cover-master.png'));
    await sharp(path.join(folder, 'cover-master.png')).resize({ width: 1600, height: 900, withoutEnlargement: true }).png().toFile(path.join(folder, 'cover.png'));
    fs.writeFileSync(path.join(folder, 'README.md'), '# Synthetic smoke kit\n\nSolid-color fixtures only. No real product footage or user data.\nEach GIF is 10 seconds with two states. The synthetic 3200x1800 cover master is downsampled to 1600x900.\nPrivacy, real captures, copy truth, and delivery are not certified by this fixture.\nRun the page checker for behavioral proof. Do not publish this test kit.\n');
  }
  for (const kind of ['missing', 'remote', 'single', 'static']) {
    const kit = structuredClone(kind === 'single' ? variants.single : variants.multi);
    if (kind === 'missing') kit.sections[0].previews[0].src = 'assets/missing.gif';
    if (kind === 'remote') kit.sections[0].previews[0].src = 'https://example.com/preview.gif';
    if (kind === 'single') kit.sections[0].previews = structuredClone(base.sections[0].previews);
    const folder = path.join(out, 'bad-' + kind); fs.mkdirSync(folder, { recursive: true });
    if (kind === 'static') {
      for (const section of kit.sections) for (const clip of section.previews) for (const field of ['src', 'poster', 'thumbnail']) {
        const file = path.join(out, 'multi', clip[field]);
        clip[field] = `data:image/${field === 'src' ? 'gif' : 'png'};base64,${fs.readFileSync(file).toString('base64')}`;
      }
      kit.sections[0].previews[0].thumbnail = kit.sections[0].previews[0].src;
    }
    fs.writeFileSync(path.join(folder, kind === 'static' ? 'launch.html' : 'index.html'), template.slice(0, start) + '\n' + jsonForHTML(kit) + '\n' + template.slice(end));
  }
  console.log('PASS: synthetic multi, single, pending, and four negative fixtures generated; 10-second two-color GIFs, downsampled covers, and test READMEs only.');
} catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
