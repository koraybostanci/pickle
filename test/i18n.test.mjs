// The interface language: js/i18n.js, the Turkish table js/tr.js and the extraction check that keeps them in step. `node --test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { t, tn, T, lc, foldKey, parseNum, setLang, getLang, dateFmt, storedLang, rememberLang, LOCALE } from '../js/i18n.js';
import * as i18n from '../js/i18n.js';
import tr from '../js/tr.js';
import { cleanSettings } from '../js/backup.js';
import { freshSettings, fmtInt } from '../js/core.js';
import { LOCALE as PLAN_LOCALE } from '../js/plan.js';
import { scan, extract, literal } from './extract.mjs';

// Release gate: when true, every string in the code needs a Turkish entry. Partial Turkish is allowed while it is being written.
const REQUIRE_FULL_PARITY = true;

const ORIGINAL_TR = { ...tr };
const added = [];
const addTr = (k, v) => { tr[k] = v; added.push(k); };
afterEach(async () => {
  added.length = 0;
  for (const k of Object.keys(tr)) delete tr[k];
  Object.assign(tr, ORIGINAL_TR); // the tests add and replace entries; the table goes back to what tr.js holds
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

// ——— Extraction: every t( / tn( / T( call in the code, and what tr.js must hold for it (test/extract.mjs) ———
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

test('tr.js: no value is a left-over copy of its English, and no stray characters', () => {
  // A value may equal its key only when nothing but placeholders, tags, units, numbers and the words Turkish shares with English is left
  const SHARED = /\b(?:protein|Protein|Plan|Model|kg|kcal|mg|ml|g|l|MB)\b/g;
  const copies = Object.entries(tr).filter(([k, v]) => typeof v === 'string' && k === v && /\p{L}/u.test(v.replace(/\{\w+\}|<[^>]*>/g, '').replace(SHARED, '')));
  assert.deepEqual(copies.map(([k]) => k), []);
  // Latin letters only (with the Turkish ones), digits, spaces, punctuation and symbols: no other script, no control characters
  const stray = new Set();
  for (const v of Object.values(tr)) if (typeof v === 'string') for (const c of v) if (!/[\p{Script=Latin}\p{N}\s\p{P}\p{S}]/u.test(c) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(c)) stray.add(c);
  assert.deepEqual([...stray], []);
  for (const [k, v] of Object.entries(tr)) if (typeof v === 'string') assert.equal(v, v.normalize('NFC'), `${k} is not in composed form`);
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
