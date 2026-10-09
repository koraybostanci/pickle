// The interface language: js/i18n.js, the Turkish table js/tr.js and the extraction check that keeps them in step. `node --test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { t, tn, T, tEn, lc, foldKey, parseNum, setLang, getLang, dateFmt, storedLang, rememberLang, LOCALE } from '../js/i18n.js';
import * as i18n from '../js/i18n.js';
import tr from '../js/tr.js';
import { cleanSettings } from '../js/backup.js';
import { freshSettings, fmtInt } from '../js/core.js';
import { LOCALE as PLAN_LOCALE } from '../js/plan.js';

// Release gate: when true, every string in the code needs a Turkish entry. Partial Turkish is allowed while it is being written.
const REQUIRE_FULL_PARITY = false;

const added = [];
const addTr = (k, v) => { tr[k] = v; added.push(k); };
afterEach(async () => {
  for (const k of added.splice(0)) delete tr[k];
  delete globalThis.document;
  delete globalThis.localStorage;
  await setLang('en');
});

test('English: t fills placeholders, strips the id override and leaves unknown placeholders alone', () => {
  assert.equal(t('Saved {name}', { name: 'Oats' }), 'Saved Oats');
  assert.equal(t('Open', { $id: 'menu.open' }), 'Open');
  assert.equal(t('{a} and {b}', { a: 1 }), '1 and {b}');
  assert.equal(t('No params {x}'), 'No params {x}');
  assert.equal(t('Count {n}', { n: 0 }), 'Count 0');
  assert.equal(T('Breakfast'), 'Breakfast');
  assert.equal(tEn('Hi {x}', { x: 2 }), 'Hi 2');
});

test('English: tn picks the pair by the plural rule', () => {
  assert.equal(tn('{n} day|{n} days', 1), '1 day');
  assert.equal(tn('{n} day|{n} days', 0), '0 days');
  assert.equal(tn('{n} day|{n} days', 3), '3 days');
  assert.equal(tn('{n} day|{n} days, {who}', 2, { who: 'me' }), '2 days, me');
});

test('LOCALE is a live binding and plan.js re-exports the same one', async () => {
  assert.equal(LOCALE, 'en-GB');
  assert.equal(PLAN_LOCALE, 'en-GB');
  await setLang('tr');
  assert.equal(i18n.LOCALE, 'tr-TR');
  assert.equal(PLAN_LOCALE, 'tr-TR');
  assert.equal(fmtInt(8200), (8200).toLocaleString('tr-TR'));
});

test('setLang: Turkish falls back to English for a missing entry and uses a present one', async () => {
  await setLang('tr');
  assert.equal(getLang(), 'tr');
  assert.equal(t('Not in the table {x}', { x: 1 }), 'Not in the table 1');
  addTr('Saved {name}', 'Kaydedildi: {name}');
  addTr('menu.open', 'Aç');
  addTr('{n} day|{n} days', '{n} gün');
  addTr('Fn {x}', (p) => `F:${p.x}`);
  assert.equal(t('Saved {name}', { name: 'Yulaf' }), 'Kaydedildi: Yulaf');
  assert.equal(t('Open', { $id: 'menu.open' }), 'Aç');
  assert.equal(tn('{n} day|{n} days', 5), '5 gün');
  assert.equal(t('Fn {x}', { x: 7 }), 'F:7');
  assert.equal(tEn('Saved {name}', { name: 'Oats' }), 'Saved Oats');
  await setLang('en');
  assert.equal(t('Saved {name}', { name: 'Oats' }), 'Saved Oats');
  assert.equal(tn('{n} day|{n} days', 5), '5 days');
});

test('setLang: unknown names mean English, and <html lang> is set only when there is a document', async () => {
  await setLang('xx');
  assert.equal(getLang(), 'en');
  globalThis.document = { documentElement: { lang: '' } };
  await setLang('tr');
  assert.equal(document.documentElement.lang, 'tr');
  await setLang('en');
  assert.equal(document.documentElement.lang, 'en');
});

test('Turkish casing: lc follows the active language', async () => {
  assert.equal(lc('ISPARTA'), 'isparta');
  await setLang('tr');
  assert.equal(lc('ISPARTA'), 'ısparta');
  assert.equal(lc('İSTANBUL'), 'istanbul');
});

test('foldKey folds Turkish letters and case for matching', () => {
  for (const w of ['ADIM', 'adım', 'adim', 'Adım', 'ADİM']) assert.equal(foldKey(w), 'adim');
  assert.equal(foldKey('Çay ŞEKER Öğün Üzüm'), 'cay seker ogun uzum');
  assert.equal(foldKey('Water'), 'water');
});

test('parseNum: a comma is a decimal; in Turkish a dot with exactly three digits is thousands', async () => {
  assert.equal(parseNum('1,5'), 1.5);
  assert.equal(parseNum('2.5'), 2.5);
  assert.equal(parseNum('8.200'), 8.2);
  assert.ok(Number.isNaN(parseNum('abc')));
  await setLang('tr');
  assert.equal(parseNum('8.200'), 8200);
  assert.equal(parseNum('1.234.567'), 1234567);
  assert.equal(parseNum('1.234,5'), 1234.5);
  assert.equal(parseNum('8.20'), 8.2);
  assert.equal(parseNum('0.500'), 0.5);
  assert.equal(parseNum('1,5'), 1.5);
  assert.equal(parseNum('8200'), 8200);
});

test('date formatters are rebuilt when the language changes', async () => {
  const d = new Date(Date.UTC(2026, 2, 5, 12));
  const opts = { month: 'long', weekday: 'long', timeZone: 'UTC' };
  const en = dateFmt(opts).format(d);
  assert.equal(dateFmt(opts), dateFmt(opts));
  await setLang('tr');
  const trk = dateFmt(opts).format(d);
  assert.notEqual(en, trk);
  assert.match(trk, /Mart/);
  await setLang('en');
  assert.equal(dateFmt(opts).format(d), en);
});

test('the language mirror works without localStorage and with it', () => {
  assert.equal(storedLang(), 'en');
  assert.doesNotThrow(() => rememberLang('tr'));
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  rememberLang('tr');
  assert.equal(storedLang(), 'tr');
  store.lang = 'de';
  assert.equal(storedLang(), 'en');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(storedLang(), 'en');
  assert.doesNotThrow(() => rememberLang('tr'));
});

test('settings: lang starts as en and a backup keeps only a valid one', () => {
  assert.equal(freshSettings().lang, 'en');
  assert.equal(cleanSettings({ lang: 'tr' }).lang, 'tr');
  assert.equal(cleanSettings({ lang: 'en' }).lang, 'en');
  assert.equal('lang' in cleanSettings({ lang: 'de' }), false);
  assert.equal('lang' in cleanSettings({ lang: { x: 1 } }), false);
  assert.equal('lang' in cleanSettings({}), false); // an older backup leaves the device's language alone
});


test('table lookups ignore inherited names', () => {
  assert.equal(t('constructor'), 'constructor');
  assert.equal(t('toString'), 'toString');
  assert.equal(t('{x}', { x: 'a', $id: '__proto__' }), 'a');
  assert.equal(tn('constructor|hasOwnProperty', 2), 'hasOwnProperty');
});

test('function translations get the params, also from tn, and tn never splits a function', async () => {
  await setLang('tr');
  addTr('Fn {x}', (p) => `F:${p.x}`);
  addTr('{n} fn|{n} fns', (p) => `${p.n}/${p.who}`);
  addTr('Bare', (p) => `bare:${Object.keys(p).length}`);
  assert.equal(t('Bare'), 'bare:0');
  assert.equal(tn('{n} fn|{n} fns', 3, { who: 'me' }), '3/me');
  assert.equal(tn('{n} fn|{n} fns', 1), '1/undefined');
});

test('setLang: the last call wins when two overlap', async () => {
  const slow = setLang('tr');
  const fast = setLang('en');
  await Promise.all([slow, fast]);
  assert.equal(getLang(), 'en');
  assert.equal(i18n.LOCALE, 'en-GB');
  const a = setLang('en');
  const b = setLang('tr');
  await Promise.all([a, b]);
  assert.equal(getLang(), 'tr');
});

test('the override key cannot clash with a placeholder', () => {
  assert.equal(t('Your id is {id}', { id: 7, $id: 'x.y' }), 'Your id is 7');
});

// ——— Extraction: every t( / tn( / T( call in the code, and what tr.js must hold for it ———
const ROOT = new URL('../', import.meta.url);
const sources = [...readdirSync(new URL('js/', ROOT)).filter((f) => f.endsWith('.js') && f !== 'i18n.js' && f !== 'tr.js').map((f) => `js/${f}`), 'index.html'];
const CALL = /(?<![\w$.])(tn|t|T)\(/g;

// Reads a string literal starting at i; returns { text, end } or null when it is not a plain literal
function literal(src, i) {
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

function scan(file, src) {
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
function extract() {
  const all = { found: [], problems: [] };
  for (const file of sources) {
    const r = scan(file, readFileSync(new URL(file, ROOT), 'utf8'));
    all.found.push(...r.found);
    all.problems.push(...r.problems);
  }
  return all;
}
const holes = (s) => [...new Set(s.match(/\{\w+\}/g) || [])].sort().join();
const tags = (s) => (s.match(/<\/?[a-zA-Z][\w-]*/g) || []).sort().join();
// What is wrong with a Turkish table against the strings found in the code
function checkTable(map, found) {
  const byKey = new Map(found.map((f) => [f.key, f]));
  const errors = [];
  for (const [key, value] of Object.entries(map)) {
    const f = byKey.get(key);
    if (!f) { errors.push(`orphan entry: ${JSON.stringify(key)}`); continue; }
    if (typeof value !== 'string') continue; // a function value takes the call's params; nothing to compare
    if (holes(value) !== holes(f.text)) errors.push(`placeholders differ for ${JSON.stringify(key)}`);
    if (tags(value) !== tags(f.text)) errors.push(`HTML tags differ for ${JSON.stringify(key)}`);
  }
  return errors;
}

test('extraction: no dynamic or concatenated keys in the code', () => {
  assert.deepEqual(extract().problems, []);
});

test('tr.js: no orphan entries, and placeholders and tags match the English', () => {
  assert.deepEqual(checkTable(tr, extract().found), []);
});

test('the table check fires on an orphan, a placeholder mismatch and a tag mismatch', () => {
  const found = [{ text: 'Saved {name}', key: 'Saved {name}' }, { text: 'Go <b>now</b>', key: 'Go <b>now</b>' }, { text: 'Open', key: 'menu.open' }];
  assert.deepEqual(checkTable({ 'Saved {name}': 'Kaydedildi: {name}', 'Go <b>now</b>': 'Git <b>şimdi</b>', 'menu.open': 'Aç' }, found), []);
  assert.deepEqual(checkTable({ Gone: 'x' }, found), ['orphan entry: "Gone"']);
  assert.deepEqual(checkTable({ 'Saved {name}': 'Kaydedildi: {isim}' }, found), ['placeholders differ for "Saved {name}"']);
  assert.deepEqual(checkTable({ 'Saved {name}': 'Kaydedildi' }, found), ['placeholders differ for "Saved {name}"']);
  assert.deepEqual(checkTable({ 'Go <b>now</b>': 'Git şimdi' }, found), ['HTML tags differ for "Go <b>now</b>"']);
  assert.deepEqual(checkTable({ 'Go <b>now</b>': 'Git <i>şimdi</i>' }, found), ['HTML tags differ for "Go <b>now</b>"']);
});

test('tr.js: full parity (enforced only when REQUIRE_FULL_PARITY is true)', (ctx) => {
  if (!REQUIRE_FULL_PARITY) return ctx.skip('partial Turkish is allowed during development');
  const missing = [...new Set(extract().found.map((f) => f.key))].filter((k) => !(k in tr));
  assert.deepEqual(missing, []);
});

test('scan: literals, ids after nested calls, tn with an id, multiline calls, and what it rejects', () => {
  const src = [
    "const a = t('Plain {x}', { x: 1 });",
    "const b = t('Outer {y}', { y: t('Inner', { $id: 'inner.id' }), $id: 'outer.id' });",
    "const c = tn('{n} day|{n} days', n, { $id: 'days.n' });",
    "const d = t(\n  'Multi',\n  { x: 1,\n    $id: 'multi.id' },\n);",
    "const e = t('Only inner {y}', { y: t('Deep', { $id: 'deep.id' }) });",
    "const f = t(name);",
    "const g = t('a' + b);",
    "const h = t(`tpl ${x}`);",
    "const i = obj.t('skipped'); const j = at('skipped');",
    "const k = T('Breakfast');",
  ].join('\n');
  const { found, problems } = scan('x.js', src);
  assert.deepEqual(found.map((f) => [f.fn, f.text, f.key]), [
    ['t', 'Plain {x}', 'Plain {x}'],
    ['t', 'Outer {y}', 'outer.id'],
    ['t', 'Inner', 'inner.id'],
    ['tn', '{n} day|{n} days', 'days.n'],
    ['t', 'Multi', 'multi.id'],
    ['t', 'Only inner {y}', 'Only inner {y}'],
    ['t', 'Deep', 'deep.id'],
    ['T', 'Breakfast', 'Breakfast'],
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /x\.js:10 t\(/);
  assert.match(problems[1], /concatenation/);
  assert.match(problems[2], /x\.js:12/);
  assert.deepEqual(scan('i.html', '<b data-t="Chip" data-t-aria="Close">').found.map((f) => f.key), ['Chip', 'Close']);
});

test('literal reads quotes and escapes and refuses interpolation', () => {
  assert.equal(literal("'a\\'b' x", 0).text, "a'b");
  assert.equal(literal('`a ${x}`', 0), null);
  assert.equal(literal('x', 0), null);
});
