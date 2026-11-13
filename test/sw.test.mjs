// The service worker's SHELL against the files on disk: a file the app loads but SHELL lacks is missing on an offline
// launch, a listed file that does not exist makes the install fail, and the two version numbers move together.
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

test('VERSION in sw.js and APP_VERSION in js/core.js carry the same number', () => {
  const sw = SW.match(/const VERSION = 'weightplan-v(\d+)'/)[1];
  const app = read('js/core.js').match(/export const APP_VERSION = '(\d+)'/)[1];
  assert.equal(sw, app);
});
