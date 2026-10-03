// Everything read from a backup file is checked before it is stored or shown (js/backup.js). `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupProblem, cleanEntry, cleanDay, cleanCheck, cleanPhoto, cleanSettings, b64FromBuf } from '../js/backup.js';
import { SCHEMA_VERSION } from '../js/core.js';

const good = {
  id: 'abc123', ts: 1759300000000, day: '2026-10-01', kind: 'meal', status: 'ok', slot: 'lunch', title: 'Egg', kcal: 500, p: 30, c: 5, f: 20, fib: 2,
  tier: 'plan', flags: ['alcohol'], conf: 0.8, mult: 1.5, photoIds: ['p1'], items: [{ n: 'egg', g: 100, kcal: 143, p: 12 }],
  place: 'Home', timeSrc: 'exif', src: 'photo', q: '', planId: 'L-A', edited: true,
};

test('backupProblem: what can be restored and what cannot', () => {
  const ok = { app: 'denge', v: SCHEMA_VERSION, entries: [] };
  assert.equal(backupProblem(ok), '');
  assert.equal(backupProblem({ ...ok, app: 'kantar' }), ''); // backups made under the app's first name still restore
  for (const bad of [null, 5, 'x', [], {}, { app: 'other', v: 2, entries: [] }, { app: 'denge', v: 2 }]) assert.match(backupProblem(bad), /not a Denge backup/);
  assert.match(backupProblem({ ...ok, v: 1 }), /first release.*Turkish ids/);
  assert.match(backupProblem({ ...ok, v: SCHEMA_VERSION + 1 }), /newer version/);
  for (const v of [undefined, '2', 2.5, null, NaN]) assert.match(backupProblem({ ...ok, v }), /no valid version/, String(v));
});

test('an entry with a hostile id, a bad day or the wrong shape is dropped', () => {
  assert.equal(cleanEntry({ id: '"><img src=x onerror=1>', day: '2026-10-01', ts: 1 }), null);
  assert.equal(cleanEntry({ id: 'a1', day: 'not-a-day', ts: 1 }), null);
  for (const x of [null, 5, 'x', []]) assert.equal(cleanEntry(x), null);
});

test('a good entry comes through unchanged', () => {
  const c = cleanEntry(good);
  for (const k of Object.keys(good)) assert.deepEqual(c[k], good[k], k);
});

test('entry fields are clamped and given the right type', () => {
  assert.equal(cleanEntry({ ...good, slot: 'constructor' }).slot, 'dinner');
  const c = cleanEntry({ ...good, kcal: 1e9, p: -5, c: 'abc', f: NaN, fib: null });
  assert.deepEqual([c.kcal, c.p, c.c, c.f, c.fib], [6000, 0, 0, 0, 0]);
  assert.equal(cleanEntry({ ...good, kcal: Infinity }).kcal, 0);
  assert.equal(cleanEntry({ ...good, place: { x: 1 } }).place, null);
  assert.deepEqual(cleanEntry({ ...good, photoIds: ['ok1', '"><b>', 5, 'x'.repeat(50)] }).photoIds, ['ok1']);
});

test('a weigh-in keeps only the fields it had', () => {
  const c = cleanEntry({ id: 'w1', ts: 5, day: '2026-10-01', kind: 'weight', status: 'ok', title: 'Weight 85.4 kg', kg: 85.4, src: 'text', photoIds: [], timeSrc: 'now' });
  assert.equal(c.kg, 85.4);
  assert.equal('slot' in c, false);
  assert.equal('kcal' in c, false);
});

test('a day: a review whose lists are strings or null does not break; bad days are dropped', () => {
  const d = cleanDay({ day: '2026-10-01', kg: 85, review: { head: 'h', good: 'one thing', cut: null, next: 'n', sig: 's', ts: 1, live: true } });
  assert.deepEqual(d.review.good, ['one thing']);
  assert.deepEqual(d.review.cut, []);
  assert.equal(cleanDay({ day: '2026-13-45x' }), null);
  assert.equal(cleanDay({ day: '2026-10-01' }).kg, null);
});

test('settings: what the app talks to is never taken from a file', () => {
  const s = cleanSettings({
    provider: 'openai', oaBase: 'https://evil.example/v1', oaModel: 'm', model: 'm', apiKey: 'k', oaKey: 'k', usage: { in: 1 }, lastBackup: 9,
    startKg: 90, startDate: '2026-10-05', places: [{ name: 'Home', lat: 1, lon: 2 }],
  });
  for (const k of ['provider', 'oaBase', 'oaModel', 'model', 'apiKey', 'oaKey', 'usage', 'lastBackup']) assert.equal(k in s, false, k);
  assert.equal(s.startKg, 90);
  assert.equal(s.places.length, 1);
});

test('settings: junk values and unknown plan meals are dropped', () => {
  const s = cleanSettings({ startKg: '90', targetKg: 1e9, startDate: '"><x>', kcalRest: -1, protein: 135, planPhotos: { 'L-A': 'p1', constructor: 'p2', 'D-A': '"><x' } });
  assert.deepEqual(Object.keys(s).sort(), ['planPhotos', 'protein']);
  assert.deepEqual(s.planPhotos, { 'L-A': 'p1' });
});

test('a check: ratings, sizes and ids are made safe', () => {
  const c = cleanCheck({ id: 'c1', ts: 5, kind: 'menu', title: 't', answer: 'a', options: [{ name: 'Soup', rating: 99, fit: 'evil', kcal: 1e9, tier: 'x' }], photos: 99 });
  assert.equal(c.options[0].rating, 5);
  assert.equal(c.options[0].fit, 'ok');
  assert.equal(c.options[0].kcal, 5000);
  assert.equal(c.photos, 4);
  assert.equal(cleanCheck({ id: '<b>', ts: 1 }), null);
});

test('a photo is always stored as JPEG, and damaged base64 is skipped', () => {
  assert.equal(cleanPhoto({ id: 'p1', type: 'image/svg+xml', w: 10, h: 10, b64: btoa('abc') }).type, 'image/jpeg');
  assert.equal(cleanPhoto({ id: 'p1', b64: '!!!not base64!!!' }), null);
  const bytes = [0, 1, 2, 250, 251, 255];
  const back = cleanPhoto({ id: 'p', b64: b64FromBuf(new Uint8Array(bytes).buffer) }).buf;
  assert.deepEqual([...new Uint8Array(back)], bytes);
});
