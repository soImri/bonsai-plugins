#!/usr/bin/env node
// Inline the template's GIFs and static images into one offline HTML file.
import fs from 'node:fs';
import path from 'node:path';
import { readKit, jsonForHTML } from './kit-data.mjs';

function args(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { console.log('node package-page.mjs --input <index.html> --output <launch.html>'); process.exit(0); }
    if (!['--input', '--output'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('Use --input and --output. See --help.');
    result[argv[i].slice(2)] = argv[++i];
  }
  if (!result.input || !result.output) throw Error('Need --input and --output.');
  return result;
}

function main() {
  const options = args(process.argv.slice(2));
  const input = fs.realpathSync(options.input), output = path.resolve(options.output);
  if (input === output || (fs.existsSync(output) && fs.realpathSync(output) === input)) throw Error('Output must differ from input.');
  const root = path.dirname(input), html = fs.readFileSync(input, 'utf8');
  const { kit, start, end } = readKit(html);
  const shell = html.slice(0, start) + html.slice(end);
  // This packager owns this template, not arbitrary web pages or remote imports.
  const styles = [...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map(match => match[1]).join('\n');
  if (/<(?:img|video|audio|iframe|object|embed|link)\b|<script\b[^>]*\bsrc\s*=/i.test(shell) || /\burl\s*\(|@import\b/i.test(styles)) throw Error('Unexpected external resource in page shell. Keep all media in kit-data.');
  let assets = 0, bytes = 0;
  const cache = new Map();
  function inline(source, animated) {
    if (source.startsWith('data:')) {
      if (!(animated ? /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/ : /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).test(source)) throw Error('Unsupported embedded image type.');
      return source;
    }
    if (/^[a-z][a-z0-9+.-]*:|[?#]/i.test(source) || path.isAbsolute(source)) throw Error('Media must be local relative files without query or hash.');
    const file = fs.realpathSync(path.resolve(root, source));
    const relative = path.relative(root, file);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw Error('Media escapes the kit folder.');
    const key = `${animated}:${file}`;
    if (cache.has(key)) return cache.get(key);
    const buffer = fs.readFileSync(file);
    let mime;
    if (/^GIF8[79]a$/.test(buffer.subarray(0, 6).toString())) mime = 'image/gif';
    else if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mime = 'image/png';
    else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) mime = 'image/jpeg';
    else if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
    if (!mime || (animated ? mime !== 'image/gif' : mime === 'image/gif')) throw Error(`Wrong image type for ${path.basename(file)}.`);
    const uri = `data:${mime};base64,${buffer.toString('base64')}`;
    cache.set(key, uri); assets++; bytes += buffer.length;
    return uri;
  }
  for (const section of kit.sections) for (const clip of section.previews) {
    clip.src = inline(clip.src, true);
    clip.poster = inline(clip.poster, false);
    clip.thumbnail = inline(clip.thumbnail, false);
  }
  const result = html.slice(0, start) + '\n' + jsonForHTML(kit) + '\n' + html.slice(end);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, result);
  console.log(`PASS: packaged ${assets} local media files (${bytes} bytes) into one HTML file (${Buffer.byteLength(result)} bytes).`);
}
try { main(); } catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
