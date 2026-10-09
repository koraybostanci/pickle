// Unlock moments: what is new, the toast's text, seen, the history line, and the cache the screens use. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLang } from '../js/i18n.js';
import { topOf, isNew, seenUpTo, viewed, unlockSummary, unseenAdded, keyedCache, settle, serial, finishOf, cellOf, freshBadges, added } from '../js/badges.js';
import { cleanBadges, restoreBadges } from '../js/backup.js';
import { fixture, views, core, day, meal } from './screens.mjs';

const { S } = core;
const got = { days_on: { 7: '2026-10-01', 30: '2026-10-05' }, first_meal: { 1: '2026-10-01' } };

test('what is new: a badge is new while its highest step is above the one seen', () => {
  assert.equal(topOf(got, 'days_on'), 30);
  assert.equal(topOf(got, 'goal'), 0);
  assert.equal(isNew('days_on', got, { days_on: 7 }), true);
  assert.equal(isNew('days_on', got, { days_on: 30 }), false);
  assert.equal(isNew('first_meal', got, {}), true);
  assert.equal(isNew('goal', got, {}), false);
  assert.equal(isNew('constructor', got, {}), false);
  assert.equal(cellOf('days_on', { got, cur: {}, seen: { days_on: 7 } }).isNew, true);
  assert.equal(cellOf('days_on', { got, cur: {} }).isNew, false); // nothing stored yet: nothing is marked
});

test('seen only ever goes up; viewing a badge marks it; nothing else changes', () => {
  const stored = { ...freshBadges(), got, seen: { days_on: 7, first_meal: 1 } };
  const v = viewed(stored, got, 'days_on');
  assert.deepEqual(v.seen, { days_on: 30, first_meal: 1 });
  assert.equal(viewed(v, got, 'days_on'), v); // already seen: the same object, so nothing is written
  assert.equal(viewed(null, got, 'days_on'), null);
  assert.equal(viewed(stored, got, 'nope'), stored);
  assert.deepEqual(seenUpTo({ days_on: 100 }, got).days_on, 100);
  assert.deepEqual(seenUpTo({}, got), { days_on: 30, first_meal: 1 });
});

test('seen is merged by the highest step on restore, and told survives the clean-up', () => {
  const a = { got, seen: { days_on: 7 }, told: true };
  const b = { got, seen: { days_on: 30, first_meal: 1 } };
  assert.deepEqual(restoreBadges(a, b).seen, { days_on: 30, first_meal: 1 });
  assert.deepEqual(restoreBadges(b, a).seen, { days_on: 30, first_meal: 1 });
  assert.equal(restoreBadges(a, b).told, true);
  assert.equal(cleanBadges({ got, told: 'yes' }).told, undefined);
  assert.equal(cleanBadges({ got, told: true }).told, true);
});

test('summary: one badge (even with several steps at once) is single; several collapse', () => {
  assert.deepEqual(unlockSummary([]), { ids: [], one: null });
  assert.deepEqual(unlockSummary([['days_on', 7, 'x'], ['days_on', 30, 'x']]).one, { id: 'days_on', step: 1 });
  assert.deepEqual(unlockSummary([['first_meal', 1, 'x']]).one, { id: 'first_meal', step: 2 });
  const s = unlockSummary([['kilos', 1, 'x'], ['first_meal', 1, 'x'], ['days_on', 7, 'x']]);
  assert.deepEqual(s.ids, ['first_meal', 'days_on', 'kilos']); // catalog order
  assert.equal(s.one, null);
  assert.equal(finishOf('days_on', 365), 3);
  assert.deepEqual(unseenAdded([['days_on', 7, 'x'], ['days_on', 30, 'x']], { days_on: 7 }), [['days_on', 30, 'x']]);
});

test('settle: a normal save marks nothing seen; a backfill marks everything seen, says how many, and is told once', () => {
  fixture();
  S.badges = null;
  const normal = settle(null, S, core.today());
  assert.ok(normal.added.length > 0);
  assert.deepEqual(normal.next.seen, {}); // so the new ones show the dot
  assert.equal(normal.intro, undefined);
  const b = settle(null, S, core.today(), { backfill: { from: {} } });
  assert.equal(b.intro, Object.keys(b.next.got).length);
  assert.ok(b.intro > 0);
  for (const id of Object.keys(b.next.got)) assert.equal(isNew(id, b.next.got, b.next.seen), false, id);
  assert.equal(b.next.told, true);
  // already settled: nothing to write, and no second line from the same record
  const again = settle(b.next, S, core.today(), { backfill: { from: b.next.got } });
  assert.equal(again.changed, false);
  assert.equal(again.intro, 0);
  // a record from before `told` is taken in once
  const old = { ...b.next, told: undefined, seen: {} };
  const t1 = settle(old, S, core.today(), { backfill: { from: {} } });
  assert.equal(t1.changed, true);
  assert.equal(t1.next.told, true);
  // a restore counts only the badges the device did not have
  const some = { first_meal: b.next.got.first_meal };
  assert.equal(settle(b.next, S, core.today(), { backfill: { from: some } }).intro, Object.keys(b.next.got).length - 1);
  // an empty log stores nothing, even as a backfill
  S.entries = []; S.days = {};
  assert.equal(settle(null, S, core.today(), { backfill: { from: {} } }).changed, false);
});

test('the cache recomputes only when its key changes', () => {
  let n = 0;
  const f = keyedCache((x) => ({ x, n: ++n }));
  const a = [1, 'a'];
  const r1 = f([1, a], 'one');
  assert.equal(f([1, a], 'two'), r1);
  assert.equal(n, 1);
  assert.notEqual(f([2, a], 'three'), r1);
  assert.notEqual(f([2, [1, 'a']], 'four').n, 2); // a replaced list is a different key
  assert.equal(n, 3);
  assert.equal(f([2], 'five').n, 4); // a key of another length
});

test('the badge screens never serve stale data after a save, a replaced log or a new day', () => {
  fixture();
  S.badges = null;
  const first = views.badgeContext();
  assert.equal(views.badgeContext().got, first.got); // same state: served from the cache
  const before = first.cur.days_on;
  // a change made in place, announced by the save path the way app.js does
  S.days[day(1)] = { day: day(1) };
  assert.equal(views.badgeContext().got, first.got); // an in-place change that nobody announced is not seen: that is why every save moves S.rev
  S.rev++;
  const second = views.badgeContext();
  assert.notEqual(second, first);
  // an edit that changes the answer
  S.entries.push(meal(day(0), 9, 'breakfast', 'x', 1, 1));
  S.rev++;
  assert.ok(views.badgeContext().cur.days_on >= 0);
  // replacing the lists (clear log, restore) is seen without S.rev
  const kept = views.badgeContext();
  S.entries = []; S.days = {};
  const cleared = views.badgeContext();
  assert.notEqual(cleared, kept);
  assert.equal(cleared.cur.days_on, 0);
  assert.ok(before >= 0);
  // the stored record: a replaced one is seen, its seen is read fresh each time
  S.badges = { ...freshBadges(), got: { first_meal: { 1: day(-1) } }, seen: {} };
  assert.equal(views.badgeContext().seen, S.badges.seen);
  assert.ok(views.badgeContext().got.first_meal);
  S.badges = { ...S.badges, seen: { first_meal: 1 } };
  assert.equal(views.badgeContext().seen.first_meal, 1);
  S.badges = null;
});

test('the unlock toast: one badge shows name and finish, several one line with names, in English and Turkish', async () => {
  fixture();
  await setLang('en');
  let u = views.unlockToast([['days_on', 7, day(0)], ['days_on', 30, day(0)]]);
  assert.deepEqual([u.id, u.msg, u.sub], ['days_on', 'Days on plan', 'Silver']);
  assert.match(u.mark, /^<svg/);
  u = views.unlockToast([['first_weigh', 1, day(0)]]);
  assert.deepEqual([u.id, u.msg, u.sub], ['first_weigh', 'First weigh-in', 'New badge']);
  u = views.unlockToast([['first_meal', 1, 'x'], ['days_on', 7, 'x'], ['kilos', 1, 'x']]);
  assert.deepEqual([u.id, u.msg, u.sub, u.mark], ['', '3 new badges', 'First meal, Days on plan, Kilos down', '']);
  u = views.unlockToast([['first_meal', 1, 'x'], ['days_on', 7, 'x'], ['kilos', 1, 'x'], ['goal', 1, 'x']]);
  assert.equal(u.msg, '4 new badges');
  assert.match(u.sub, / and more$/);
  assert.equal(views.unlockToast([]), null);
  assert.equal(views.unlockToast([['nope', 1, 'x']]), null);
  await setLang('tr');
  u = views.unlockToast([['days_on', 7, 'x']]);
  assert.deepEqual([u.msg, u.sub], ['Planda geçen günler', 'Bronz']);
  u = views.unlockToast([['first_meal', 1, 'x'], ['days_on', 7, 'x']]);
  assert.equal(u.msg, '2 yeni rozet');
  assert.doesNotMatch(`${u.msg}${u.sub}`, /[{}]/);
  u = views.unlockToast([['first_meal', 1, 'x']]);
  assert.equal(u.sub, 'Yeni rozet');
  S.tab = 'progress';
  S.badges = { ...freshBadges(), got: {}, seen: {} };
  S.badgeIntro = 12;
  assert.match(views.renderProgress(), /Geçmişinden 12 rozet/);
  S.badgeIntro = 1;
  await setLang('en');
  assert.match(views.renderProgress(), /1 badge from your history/);
  S.badgeIntro = 0;
  assert.doesNotMatch(views.renderProgress(), /from your history/);
  S.badges = null;
});

test('the New dot and pill: text as well as a dot, and gone once seen', async () => {
  fixture();
  await setLang('en');
  S.tab = 'progress';
  const html = views.renderProgress();
  const dots = [...html.matchAll(/id="badge-(\w+)"[^>]*>\s*<i class="bd-dot"/g)].map((m) => m[1]);
  assert.ok(dots.includes('days_on') && dots.includes('best_run'));
  assert.ok(!dots.includes('first_meal') && !dots.includes('protein_days')); // seen
  assert.match(html, /id="badge-days_on"[^>]*aria-label="[^"]*, New"/);
  S.badges = { ...S.badges, seen: seenUpTo(S.badges.seen, views.badgeContext().got) };
  assert.doesNotMatch(views.renderProgress(), /bd-new/);
});

test('reduced motion: the reveal is switched off in the stylesheet', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.toast-mark \{[^}]*animation: bd-reveal/);
  const rm = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(rm.slice(0, rm.indexOf('\n}')), /\.toast-mark \{ animation: none; \}/);
  assert.match(css, /@keyframes bd-reveal \{ from \{ transform: scale\(\.9\); opacity: 0; \} to \{ transform: none; opacity: 1; \} \}/);
});

test('serial: a slow write cannot be overtaken or built on a stale copy (the save, then the look at the sheet)', async () => {
  const disk = { badges: null };
  const slow = (v) => new Promise((r) => setTimeout(() => { disk.badges = v; r(); }, 30)); // a store that is busy
  let mem = { ...freshBadges() };
  const q = serial();
  const gotNow = { first_weigh: { 1: '2026-10-09' } };
  // the save: earns first_weigh, writes slowly
  const save = q(async () => { const next = { ...mem, got: gotNow }; mem = next; await slow(next); });
  // the sheet is opened while that write is pending: it must build on the earned state
  const view = q(async () => { const next = viewed(mem, gotNow, 'first_weigh'); if (next === mem) return; mem = next; await slow(next); });
  await Promise.all([save, view]);
  assert.deepEqual(disk.badges.got, gotNow);
  assert.deepEqual(disk.badges.seen, { first_weigh: 1 });
  assert.deepEqual(mem, disk.badges);
  // a failure does not stop the queue, and its caller hears of it
  const bad = q(async () => { throw new Error('x'); });
  await assert.rejects(bad);
  assert.equal(await q(async () => 7), 7);
});
