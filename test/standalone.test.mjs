import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRun, installHtml } from '../js/standalone.js';

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
