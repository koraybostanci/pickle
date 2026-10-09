// Finds every t( / tn( / T( call in the code, with its literal text and key. Shared by the i18n tests.
import { readFileSync, readdirSync } from 'node:fs';

// ——— Extraction: every t( / tn( / T( call in the code, and what tr.js must hold for it ———
export const ROOT = new URL('../', import.meta.url);
export const sources = [...readdirSync(new URL('js/', ROOT)).filter((f) => f.endsWith('.js') && f !== 'i18n.js' && f !== 'tr.js').map((f) => `js/${f}`), 'index.html'];
const CALL = /(?<![\w$.])(tn|t|T)\(/g;

// Reads a string literal starting at i; returns { text, end } or null when it is not a plain literal
export function literal(src, i) {
  const q = src[i];
  if (q !== "'" && q !== '"' && q !== '`') return null;
  let text = '';
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { text += src[j + 1] === 'n' ? '\n' : src[j + 1]; j++; continue; }
    if (c === q) return { text, end: j + 1 };
    if (q === '`' && c === '$' && src[j + 1] === '{') return null;
    text += c;
  }
  return null;
}
const skipSpace = (src, i) => { while (/\s/.test(src[i])) i++; return i; };
// The id override of one call: `$id: 'name'` among its own arguments, not inside a call nested in them
function idOf(src, from) {
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    const c = src[j];
    if (c === "'" || c === '"' || c === '`') { j = (skipLiteral(src, j) || j + 1) - 1; continue; }
    if (c === '(') depth++;
    else if (c === ')') { if (depth === 0) return null; depth--; } else if (depth === 0 && src.startsWith('$id', j)) {
      const m = /^\$id\s*:\s*/.exec(src.slice(j));
      const lit = m && literal(src, j + m[0].length);
      if (lit) return lit.text;
    }
  }
  return null;
}
// Skips any quoted text, template literals with ${} included (for walking, not for reading keys)
function skipLiteral(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j + 1;
  }
  return null;
}

export function scan(file, src) {
  const found = []; // { file, line, fn, text, key }
  const problems = [];
  for (const m of src.matchAll(CALL)) {
    const line = src.slice(0, m.index).split('\n').length;
    const lit = literal(src, skipSpace(src, m.index + m[0].length));
    if (!lit) { problems.push(`${file}:${line} ${m[1]}( needs a plain string literal as its first argument`); continue; }
    const next = src[skipSpace(src, lit.end)];
    if (next !== ',' && next !== ')') { problems.push(`${file}:${line} ${m[1]}( first argument is built by concatenation`); continue; }
    found.push({ file, line, fn: m[1], text: lit.text, key: idOf(src, lit.end) ?? lit.text });
  }
  if (file.endsWith('.html')) for (const m of src.matchAll(/\bdata-t(?:-aria)?="([^"]*)"/g)) found.push({ file, line: 0, fn: 'data-t', text: m[1], key: m[1] });
  return { found, problems };
}
export function extract() {
  const all = { found: [], problems: [] };
  for (const file of sources) {
    const r = scan(file, readFileSync(new URL(file, ROOT), 'utf8'));
    all.found.push(...r.found);
    all.problems.push(...r.problems);
  }
  return all;
}
