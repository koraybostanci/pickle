// Interface language: English text is the key, js/tr.js holds the Turkish. No DOM, so it loads in Node.
// English is the default and costs nothing: t() returns its text with the {x} placeholders filled in.
const LOCALES = { en: 'en-GB', tr: 'tr-TR' };
let lang = 'en';
let uiLang = 'en'; // the language the person chose: inEnglish() changes `lang` for a moment, never this
let table = {};
export let LOCALE = LOCALES.en; // a live binding: importers see the locale of the language set last
const formats = new Map();
const plurals = new Map(); // one Intl.PluralRules per locale, dropped with the formats
const pluralRules = () => { if (!plurals.has(LOCALE)) plurals.set(LOCALE, new Intl.PluralRules(LOCALE)); return plurals.get(LOCALE); };

const fill = (text, params) => (params ? text.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(params, k) ? params[k] : m)) : text);
// A translation may be a function where the grammar needs it; it gets the params (an empty object when there are none).
// The override key is `$id`, which no {placeholder} can be named, so it never clashes with a real param.
const pick = (text, params) => {
  const key = params && params.$id ? params.$id : text;
  const v = Object.hasOwn(table, key) ? table[key] : undefined;
  return typeof v === 'function' ? v(params || {}) : v;
};

// t('Saved {name}', { name }) ; t('Open', { $id: 'menu.open' }) uses the id as the key when the text is ambiguous or churns
export const t = (text, params) => fill(pick(text, params) ?? text, params);
// The English pair is the key: tn('{n} day|{n} days', n). A Turkish value may be one string, or a pair.
export function tn(text, n, params) {
  const p = { ...params, n };
  const v = pick(text, p);
  const forms = (typeof v === 'string' ? v : text).split('|');
  return fill(forms[forms.length > 1 && pluralRules().select(n) !== 'one' ? 1 : 0], p);
}
// Marks a string in a data table so the extraction test finds it; the caller translates it at render time
export const T = (text) => text;
// Translates a string that was marked with T() in a data table, at render time (t() itself needs a literal); params fill its {placeholders}
export const td = (text, params) => fill(pick(text) ?? text, params);
// Runs fn with English text, English number and date formats, whatever the language is, and gives back what it returns.
// For what is sent to the model. fn must not be async: the language is put back when it returns.
export function inEnglish(fn) {
  const saved = [lang, table, LOCALE];
  [lang, table, LOCALE] = ['en', {}, LOCALES.en];
  try { return fn(); } finally { [lang, table, LOCALE] = saved; }
}
// Lower case for the active language ("ISPARTA" is "ısparta" in Turkish)
export const lc = (s) => String(s).toLocaleLowerCase(lang);
export const getLang = () => lang;
// The language of the screen, also while inEnglish() is running: for what depends on the person's language, not on the text being built
export const getUiLang = () => uiLang;
export const storedLang = () => { try { return localStorage.getItem('lang') === 'tr' ? 'tr' : 'en'; } catch { return 'en'; } };
export const rememberLang = (l) => { try { localStorage.setItem('lang', l); } catch { /* no storage; the setting itself is kept */ } };

// A failed load leaves the language as it was. The last call wins: a slower, older import is dropped when it finishes. After a failed load the retry asks for the file
// under a new address, because a browser may remember a failed module fetch for the old one.
let seq = 0;
let loadFailed = false;
export async function setLang(next) {
  next = next === 'tr' ? 'tr' : 'en';
  const mine = ++seq;
  let loaded = {};
  if (next === 'tr') {
    try { loaded = (await import(loadFailed ? `./tr.js?retry=${Date.now()}` : './tr.js')).default; loadFailed = false; } catch (err) { loadFailed = true; throw err; }
  }
  if (mine !== seq) return;
  lang = uiLang = next;
  table = loaded;
  LOCALE = LOCALES[next];
  formats.clear();
  plurals.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

// One Intl.DateTimeFormat per option set, built on first use and dropped when the language changes
export function dateFmt(opts) {
  const key = LOCALE + JSON.stringify(opts); // the locale is part of the key, so inEnglish() cannot get a Turkish formatter
  if (!formats.has(key)) formats.set(key, new Intl.DateTimeFormat(LOCALE, opts));
  return formats.get(key);
}

// For matching typed words: "ADIM", "adım" and "adim" all become "adim"
export const foldKey = (s) => String(s).replace(/[İIı]/g, 'i').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// "1,5" is 1.5 in both languages (a comma is never a thousands mark in English input here). In Turkish "8.200" and
// "1.234,5" use the dot for thousands: groups of exactly three digits after a first group of 1 to 3 that does not start with 0. Not a number gives NaN.
export function parseNum(s) {
  s = String(s).trim();
  if (lang === 'tr' && /^[1-9]\d{0,2}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  return /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : NaN;
}

// The text of index.html that no code renders: data-t is the element's text, and data-t-aria, -placeholder, -fill (what a chip types into
// the composer) and -content (the meta description) are attributes. The English stays in the markup, so English needs none of this to be right;
// this runs at boot and on a language change. The document is a parameter so a test can hand it a stand-in.
const STATIC_ATTRS = { 'data-t-aria': 'aria-label', 'data-t-placeholder': 'placeholder', 'data-t-fill': 'data-fill', 'data-t-content': 'content' };
export function applyStatic(doc = typeof document === 'undefined' ? null : document) {
  if (!doc) return;
  doc.documentElement.lang = lang;
  for (const el of doc.querySelectorAll('[data-t]')) el.textContent = t(el.getAttribute('data-t'));
  for (const [from, to] of Object.entries(STATIC_ATTRS)) for (const el of doc.querySelectorAll(`[${from}]`)) el.setAttribute(to, t(el.getAttribute(from)));
}
