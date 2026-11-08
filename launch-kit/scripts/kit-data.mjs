// Shared data contract for the template, packager, and checker. No dependencies.
export function readKit(html) {
  const matches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(m => /\bid\s*=\s*["']kit-data["']/i.test(m[1]) && /\btype\s*=\s*["']application\/json["']/i.test(m[1]));
  if (matches.length !== 1) throw Error('Need exactly one application/json script with id="kit-data".');
  const match = matches[0];
  const kit = JSON.parse(match[2]);
  validateKit(kit);
  const start = match.index + match[0].indexOf('>') + 1;
  return { kit, start, end: start + match[2].length };
}

export function validateKit(kit) {
  const text = (value, name) => {
    if (typeof value !== 'string' || !value.trim()) throw Error(`${name} must be nonempty text.`);
  };
  if (kit.schemaVersion !== 1) throw Error('Unsupported kit schemaVersion; expected 1.');
  text(kit.feature, 'feature'); text(kit.lead, 'lead');
  if (!Array.isArray(kit.sections) || kit.sections.length < 2) throw Error('Need the concept followed by at least one natural unit.');
  if (!kit.sections.slice(1).some(s => !s.pending && Array.isArray(s.previews) && s.previews.length)) throw Error('Need at least one populated natural unit.');
  const ids = new Set();
  kit.sections.forEach((section, index) => {
    if (!/^[a-z][a-z0-9-]*$/.test(section.id) || ids.has(section.id)) throw Error('Section ids must be unique lowercase slugs.');
    ids.add(section.id); text(section.label, 'section label');
    if ((index === 0) !== (section.id === 'concept')) throw Error('The first and only concept section must have id "concept".');
    if (section.pending !== undefined && typeof section.pending !== 'boolean') throw Error('pending must be boolean.');
    if (!Array.isArray(section.previews)) throw Error('Every section needs a previews array.');
    const conceptOnly = index === 0 && kit.sections.length === 2;
    if (section.pending || conceptOnly) {
      if (index === 0 && section.pending) throw Error('The concept cannot be pending.');
      if (section.previews.length) throw Error('Pending units and a single-surface concept need previews: [].');
    } else if (!section.previews.length) throw Error('Every populated tab or unit needs a preview.');
    section.previews.forEach(clip => {
      for (const field of ['label', 'src', 'poster', 'thumbnail']) text(clip[field], `preview ${field}`);
    });
  });
  return kit;
}

export function jsonForHTML(value) {
  return JSON.stringify(value, null, 2).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}
