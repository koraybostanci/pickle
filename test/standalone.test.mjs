import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRun, installHtml, installLang } from '../js/standalone.js';

const win = ({ standalone, display, host = 'pickle.example', protocol = 'https:' } = {}) => ({
  navigator: { standalone },
  matchMedia: () => ({ matches: !!display }),
  location: { hostname: host, protocol },
});

test('an installed app runs (iOS flag or display-mode)', () => {
  assert.equal(canRun(win({ standalone: true })), true);
  assert.equal(canRun(win({ display: true })), true);
});
test('a browser tab does not run', () => {
  assert.equal(canRun(win()), false);
  assert.equal(canRun(win({ standalone: false })), false);
});
test('localhost and file: stay open for development', () => {
  assert.equal(canRun(win({ host: 'localhost' })), true);
  assert.equal(canRun(win({ host: '127.0.0.1' })), true);
  assert.equal(canRun(win({ host: '[::1]' })), true);
  assert.equal(canRun(win({ host: '', protocol: 'file:' })), true);
});
test('a browser without matchMedia does not run, and the install screen names the Home Screen', () => {
  const w = win(); delete w.matchMedia;
  assert.equal(canRun(w), false);
  assert.match(installHtml(), /Home Screen/);
});

test('the install screen: English is the same as ever, Turkish is chosen at once, an unknown language means English', () => {
  const en = installHtml('en');
  assert.match(en, /<h1>Add Pickle to your Home Screen<\/h1>/);
  assert.equal(installHtml('xx'), en);
  assert.equal((en.match(/<li>/g) || []).length, 3);
  assert.ok(!/ lang=/.test(en));
  const tr = installHtml('tr');
  assert.match(tr, /^<div class="empty install" lang="tr">/);
  assert.match(tr, /Ana Ekran/);
  assert.ok(!/Home Screen/.test(tr));
  assert.equal((tr.match(/<li>/g) || []).length, 3);
});

test('the install screen picks its language from the mirror only; the phone language is never guessed', () => {
  const save = [Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), Object.getOwnPropertyDescriptor(globalThis, 'navigator')];
  const set = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  try {
    set('navigator', { language: 'tr-TR' });
    delete globalThis.localStorage;
    assert.equal(installLang(), 'en'); // no mirror: English, whatever the browser's language
    set('localStorage', { getItem: () => null });
    assert.equal(installLang(), 'en');
    set('localStorage', { getItem: () => 'de' });
    assert.equal(installLang(), 'en');
    set('localStorage', { getItem: () => 'en' });
    assert.equal(installLang(), 'en'); // the mirror wins
    set('navigator', { language: 'en-GB' });
    set('localStorage', { getItem: () => 'tr' });
    assert.equal(installLang(), 'tr');
    set('localStorage', { getItem() { throw new Error('blocked'); } });
    assert.equal(installLang(), 'en');
    assert.match(installHtml(), /Add Pickle to your Home Screen/);
  } finally {
    save.forEach((d, i) => { const name = ['localStorage', 'navigator'][i]; if (d) Object.defineProperty(globalThis, name, d); else delete globalThis[name]; });
  }
});
