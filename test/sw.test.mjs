// The service worker's SHELL against the files on disk: a file the app loads but SHELL lacks is missing on an offline
// launch, a listed file that does not exist makes the install fail, and the release number is written in one place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const SW = read('sw.js');
const SHELL = [...SW.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('SHELL lists every script, font and icon the app ships', () => {
  const want = [
    ...readdirSync(new URL('js/', ROOT)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('fonts/', ROOT)).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`),
    ...readdirSync(new URL('icons/', ROOT)).map((f) => `icons/${f}`),
    'index.html', 'styles.css', 'manifest.webmanifest',
  ];
  assert.deepEqual(want.filter((f) => !SHELL.includes(f)), []);
});

test('every file in SHELL exists, and none is listed twice', () => {
  assert.deepEqual(SHELL.filter((f) => f !== './' && !existsSync(new URL(f, ROOT))), []);
  assert.equal(new Set(SHELL).size, SHELL.length);
});

test('the release number is written once, in js/version.js, and sw.js and js/core.js both read it', () => {
  assert.match(read('js/version.js'), /^globalThis\.WEIGHTPLAN_VERSION = '\d+';/m);
  assert.match(SW, /^importScripts\('js\/version\.js'\);$/m);
  assert.match(SW, /const VERSION = `weightplan-v\$\{self\.WEIGHTPLAN_VERSION\}`;/);
  assert.doesNotMatch(SW, /weightplan-v\d/); // no number of its own
  assert.match(read('js/core.js'), /export const APP_VERSION = globalThis\.WEIGHTPLAN_VERSION;/);
});
