// The badge engine in js/badges.js: what is earned, when, and that it is never taken back. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { S, today, dayStatus, history, dayGoals, dayTotals, weekResult, withDayIndex, weekStart } from '../js/core.js';
import { addDays } from '../js/plan.js';
import { CATALOG, BY_ID, PARTS, GROUPS, scan, tally, evaluate, merge, added, progress, unlocked, isLadder, stepsOf, settle, isRealDay } from '../js/badges.js';
import tr from '../js/tr.js';

const T = today();
const day = (off) => addDays(T, off);
const reset = () => {
  S.entries = [];
  S.days = {};
  Object.assign(S.settings, { startDate: day(-100), startKg: 86.4, targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, proteinMin: 120, steps: 8000, water: 2500 });
};
const meal = (d, kcal = 1500, p = 135, extra = {}) => S.entries.push({ id: `e${S.entries.length}`, day: d, ts: 1, kind: 'meal', status: 'ok', slot: 'lunch', kcal, p, c: 0, f: 0, fib: 0, mult: 1, tier: 'plan', ...extra });
const rec = (d, extra) => { S.days[d] = { ...(S.days[d] || { day: d }), ...extra }; };
const on = (from, n) => { for (let i = 0; i < n; i++) meal(day(from + i)); };
const earned = (id, thr) => (scan(S, T)[id] || {})[thr];
const W = weekStart(day(-21)); // a Monday, three weeks back: the whole week is over

test('the catalog: 18 unique ids, ladders of exactly 4 steps, one-shots of exactly [1], glyph = id, tier names kept out of the text', () => {
  assert.equal(CATALOG.length, 18);
  assert.equal(new Set(CATALOG.map((b) => b.id)).size, 18);
  for (const b of CATALOG) {
    assert.ok(b.steps.length === 4 || (b.steps.length === 1 && b.steps[0] === 1), b.id);
    assert.deepEqual(b.steps, [...b.steps].sort((x, y) => x - y), b.id);
    assert.equal(b.glyph, b.id);
    assert.ok(GROUPS.includes(b.group), b.id);
    assert.doesNotMatch(`${b.name} ${b.desc}`, /bronze|silver|gold|platinum/i, b.id);
    assert.ok(b.name in tr && b.desc in tr, `Turkish for ${b.id}`);
    assert.equal(b.desc.includes('{n}'), isLadder(b.id), b.id);
  }
  assert.deepEqual(GROUPS.map((g) => CATALOG.filter((b) => b.group === g).length), [3, 5, 4, 3, 3]);
});

test('every avatar part with a requirement points at a real badge id and step, and the badge lists the part', () => {
  for (const [part, { slot, req }] of Object.entries(PARTS)) {
    assert.ok(['stage', 'face', 'acc'].includes(slot), part);
    if (!req) continue;
    assert.ok(BY_ID[req[0]], part);
    assert.ok(BY_ID[req[0]].steps.includes(req[1]), part);
    assert.ok(BY_ID[req[0]].parts.some(([p, thr]) => p === part && thr === req[1]), part);
  }
  assert.equal(Object.values(PARTS).filter((p) => !p.req).length, 3);
  for (const b of CATALOG) for (const [p] of b.parts) assert.equal(PARTS[p].req[0], b.id);
});

test('unlocked: free parts, earned parts, and nothing for unknown parts', () => {
  assert.equal(unlocked('stage1', {}), true);
  assert.equal(unlocked('stage2', {}), false);
  assert.equal(unlocked('stage2', { days_on: { 30: '2026-01-01' } }), true);
  assert.equal(unlocked('stage3', { days_on: { 30: '2026-01-01' } }), false);
  assert.equal(unlocked('acc_crown', { goal: { 1: '2026-01-01' } }), true);
  assert.equal(unlocked('nope', {}), false);
  assert.equal(unlocked('__proto__', {}), false);
  assert.equal(unlocked('stage2', undefined), false);
});

test('start badges: first meal, first weigh-in, first day on plan', () => {
  reset();
  assert.deepEqual(scan(S, T), {});
  meal(day(-3), 600);
  assert.deepEqual(scan(S, T), { first_meal: { 1: day(-3) } });
  rec(day(-2), { kg: 85 });
  meal(day(-1));
  const got = scan(S, T);
  assert.equal(got.first_weigh[1], day(-2));
  assert.equal(got.first_on[1], day(-1));
});

test('days_on: the qualifying day is the 7th day on plan; under-minimum and over days do not count', () => {
  reset();
  on(-10, 3); meal(day(-7), 1300); meal(day(-6), 2200); on(-5, 4);
  assert.equal(earned('days_on', 7), day(-2));
  assert.equal(tally(S, T).cur.days_on, 7);
  assert.equal(earned('days_on', 30), undefined);
});

test('best_run is the best ever run, not the current one', () => {
  reset();
  on(-20, 7); meal(day(-13), 2500); on(-12, 2);
  const got = scan(S, T);
  assert.equal(got.best_run[3], day(-18));
  assert.equal(got.best_run[7], day(-14));
  assert.equal(got.best_run[14], undefined);
  assert.equal(tally(S, T).cur.best_run, 7);
});

test('today counts for the run only once it is on plan, and an open day does not break the run', () => {
  reset();
  on(-3, 3);
  meal(T, 800); // still being eaten
  assert.equal(dayStatus(T), 'open');
  assert.equal(tally(S, T).cur.days_on, 3);
  assert.equal(tally(S, T).cur.best_run, 3);
  S.entries.pop(); meal(T);
  assert.equal(tally(S, T).cur.days_on, 4);
  assert.equal(earned('best_run', 3), day(-1));
});

test('weeks_strong: finished weeks with 6 days on plan; a 5-day week and the running week do not count', () => {
  reset();
  for (let i = 0; i < 6; i++) meal(addDays(W, i));
  for (let i = 0; i < 5; i++) meal(addDays(W, 7 + i));
  on(-2, 2);
  const got = scan(S, T);
  assert.deepEqual(got.weeks_strong, { 1: addDays(W, 6) });
  assert.equal(tally(S, T).cur.weeks_strong, 1);
  assert.equal(weekResult(addDays(W, 7)).onPlan, 5);
});

test('anniversary: days since the start date, the day the step is reached, only once something is logged', () => {
  reset();
  S.settings.startDate = day(-40);
  assert.deepEqual(scan(S, T), {});
  meal(day(-50));
  assert.equal(earned('anniversary', 30), day(-10));
  assert.equal(earned('anniversary', 90), undefined);
  assert.equal(tally(S, T).cur.anniversary, 40);
  S.settings.startDate = 'nonsense';
  assert.equal(scan(S, T).anniversary, undefined);
});

test('fresh_start: the first day on plan after 3 quiet days, once only', () => {
  reset();
  on(-20, 2);
  meal(day(-14), 2500); // logged, off plan: not quiet
  meal(day(-9), 2500); // 4 quiet days before it
  on(-7, 1); // the first day on plan after the break
  on(-3, 1); // another break of 3 quiet days: still once
  const got = scan(S, T);
  assert.deepEqual(got.fresh_start, { 1: day(-7) });
});

test('fresh_start: two quiet days are not a break; a finished rough week is', () => {
  reset();
  meal(day(-30)); meal(day(-27)); // 2 quiet days between
  assert.equal(scan(S, T).fresh_start, undefined);
  reset();
  // a tracked week with only 2 days on plan, every other day logged but over: a rough patch
  for (let i = 0; i < 7; i++) meal(addDays(W, i), i < 2 ? 1500 : 2500);
  meal(addDays(W, 7)); // the Monday after: on plan
  assert.deepEqual(scan(S, T).fresh_start, { 1: addDays(W, 7) });
});

test('fresh_start: nothing before the first thing was logged counts as a break', () => {
  reset();
  meal(day(-10));
  assert.equal(scan(S, T).fresh_start, undefined);
});

test('perfect_day: every goal done on a finished day', () => {
  reset();
  meal(day(-2)); rec(day(-2), { kg: 85, steps: 8000, water: 2500 });
  meal(day(-1)); rec(day(-1), { kg: 85, steps: 7999, water: 2500 });
  assert.deepEqual(scan(S, T).perfect_day, { 1: day(-2) });
});

test('protein_days: protein target or minimum on a day that is not under the calorie minimum', () => {
  reset();
  meal(day(-4), 1500, 120); meal(day(-3), 1500, 135); meal(day(-2), 1500, 119);
  meal(day(-1), 900, 150); // lots of protein but too little eaten: earns nothing
  assert.equal(tally(S, T).cur.protein_days, 2);
});

test('goals_days: the steps goal on a finished day, with or without food logged', () => {
  reset();
  rec(day(-3), { steps: 8000 }); rec(day(-2), { steps: 9000 }); rec(day(-1), { steps: 100 });
  assert.equal(dayGoals(day(-3)).find((g) => g.id === 'steps').done, true);
  assert.equal(tally(S, T).cur.goals_days, 2);
});

test('protein_week, log_week, weigh_week: all 7 days of a finished week', () => {
  reset();
  for (let i = 0; i < 7; i++) { meal(addDays(W, i), 1500, 135); rec(addDays(W, i), { kg: 85 }); }
  const w2 = addDays(W, 7);
  for (let i = 0; i < 7; i++) { meal(addDays(w2, i), 1500, 100); if (i < 6) rec(addDays(w2, i), { kg: 85 }); }
  const got = scan(S, T);
  assert.deepEqual(got.protein_week, { 1: addDays(W, 6) });
  assert.deepEqual(got.log_week, { 1: addDays(W, 6) });
  assert.deepEqual(got.weigh_week, { 1: addDays(W, 6) });
  assert.equal(tally(S, T).cur.weigh_days, 13);
});

test('weekly badges need the week to be over', () => {
  reset();
  const ws = weekStart(T);
  for (let i = 0; i < 7; i++) { rec(addDays(ws, i), { kg: 85 }); meal(addDays(ws, i)); }
  const got = scan(S, addDays(ws, 5));
  assert.equal(got.weigh_week, undefined);
  assert.equal(scan(S, addDays(ws, 7)).weigh_week[1], addDays(ws, 6));
});

test('weigh_days: a ladder over days with a weigh-in', () => {
  reset();
  for (let i = 0; i < 8; i++) rec(day(-10 + i), { kg: 85 });
  assert.equal(earned('weigh_days', 7), day(-4));
});

test('kilos, halfway and goal come from the weigh-ins since the start, by the base weights', () => {
  reset(); // 86.4 -> 78: the span is 8 kg, halfway at 82.2
  rec(day(-20), { kg: 86 });
  rec(day(-19), { kg: 85.4 });
  rec(day(-17), { kg: 83.4 });
  rec(day(-15), { kg: 82.2 });
  rec(day(-10), { kg: 78 });
  const got = scan(S, T);
  assert.equal(got.kilos[1], day(-19));
  assert.equal(got.kilos[3], day(-17));
  assert.equal(got.kilos[5], day(-10));
  assert.equal(got.kilos[10], undefined);
  assert.equal(got.halfway[1], day(-15));
  assert.equal(got.goal[1], day(-10));
  // the base is the frozen start, not whatever the settings say now
  S.settings.targetKg = 90;
  assert.equal(scan(S, T, { startKg: 86.4, targetKg: 78 }).goal[1], day(-10));
  assert.equal(scan(S, T).goal, undefined);
});

test('kilos are capped at the span; steps beyond it are dropped', () => {
  reset();
  S.settings.targetKg = 84.4; // a 2 kg plan
  rec(day(-3), { kg: 85 }); rec(day(-2), { kg: 84.5 }); rec(day(-1), { kg: 84 });
  const t = tally(S, T);
  assert.deepEqual(t.got.kilos, { 1: day(-3) });
  assert.equal(t.cur.kilos, 2);
  assert.deepEqual(stepsOf('kilos', { startKg: 86.4, targetKg: 84.4 }), [1]);
  assert.deepEqual(stepsOf('kilos', { startKg: 86.4, targetKg: 78 }), [1, 3, 5]);
  assert.deepEqual(progress('kilos', { ...t, base: { startKg: 86.4, targetKg: 84.4 } }), { cur: 1, target: 1 });
  assert.deepEqual(stepsOf('kilos', { startKg: 80, targetKg: 80 }), []);
  assert.deepEqual(progress('kilos', { base: { startKg: 80, targetKg: 80 } }), { cur: 0, target: 0 });
});

test('a weigh-in that implies more than a kilo a day is skipped, and so is one before the start date', () => {
  reset();
  rec(day(-4), { kg: 85.5 });
  rec(day(-3), { kg: 70 }); // a typo: skipped, and the next one is compared with it, so it is skipped too
  rec(day(-2), { kg: 85 });
  rec(day(-1), { kg: 84.9 });
  const got = scan(S, T);
  assert.deepEqual(got.kilos, { 1: day(-1) });
  assert.equal(got.goal, undefined);
  assert.equal(got.halfway, undefined);
  rec(day(-1), { kg: 83.4 }); // 1.6 kg in a day
  assert.equal(scan(S, T).kilos, undefined);
  rec(day(-1), { kg: 84 }); // exactly 1 kg in a day is fine
  assert.deepEqual(scan(S, T).kilos, { 1: day(-1) });
  reset();
  S.settings.startDate = day(-1);
  rec(day(-3), { kg: 80 });
  assert.equal(scan(S, T).kilos, undefined);
});

test('under-eating earns nothing: a 1,000 kcal day is not on plan, not perfect and not a protein day', () => {
  reset();
  meal(day(-1), 1000, 160); rec(day(-1), { kg: 85, steps: 9000, water: 3000 });
  const got = scan(S, T);
  for (const id of ['first_on', 'days_on', 'best_run', 'perfect_day', 'protein_days', 'fresh_start']) assert.equal(got[id], undefined, id);
});

test('scan is deterministic and evaluate is idempotent', () => {
  reset();
  on(-20, 12); for (let i = 0; i < 5; i++) rec(day(-20 + i), { kg: 86 - i * 0.4 });
  assert.deepEqual(scan(S, T), scan(S, T));
  const a = evaluate(S, T);
  const b = evaluate(S, T, { got: a });
  assert.deepEqual(b, a);
  assert.deepEqual(evaluate(S, T, { got: b }), a);
  assert.deepEqual(added(a, b), []);
  assert.equal(added({}, a).length, Object.values(a).reduce((n, x) => n + Object.keys(x).length, 0));
});

test('nothing is revoked: deleting entries or changing the calorie target keeps what was earned', () => {
  reset();
  on(-12, 10); rec(day(-12), { kg: 80 });
  const first = evaluate(S, T);
  assert.ok(first.days_on[7] && first.first_weigh && first.best_run[7]);
  S.entries = [];
  S.days = {};
  assert.deepEqual(scan(S, T), {});
  assert.deepEqual(evaluate(S, T, { got: first }), first);
  reset(); on(-12, 10);
  S.settings.kcalRest = 900; // the same food is now far over budget
  assert.equal(scan(S, T).days_on, undefined);
  assert.deepEqual(evaluate(S, T, { got: first }), merge(first, scan(S, T)));
  assert.equal(evaluate(S, T, { got: first }).days_on[7], first.days_on[7]);
});

test('merge: union with the earliest day winning, unknown ids and bad data dropped, inputs untouched', () => {
  const a = { days_on: { 7: '2026-03-05', 30: '2026-04-01' }, goal: { 1: '2026-05-01' } };
  const b = { days_on: { 7: '2026-03-01', 100: '2026-06-01' }, first_meal: { 1: '2026-01-02' }, nope: { 1: '2026-01-01' }, kilos: { 2: '2026-01-01', 1: 'x' }, __proto__: { first_on: { 1: '2026-01-01' } } };
  const snapshot = JSON.stringify([a, b]);
  const m = merge(a, b);
  assert.deepEqual(m, { days_on: { 7: '2026-03-01', 30: '2026-04-01', 100: '2026-06-01' }, goal: { 1: '2026-05-01' }, first_meal: { 1: '2026-01-02' } });
  assert.equal(JSON.stringify([a, b]), snapshot);
  assert.deepEqual(merge(m, m), m);
  assert.deepEqual(merge(null, undefined), {});
});

test('progress: the next step and where you are; the last step once all are earned', () => {
  reset();
  on(-10, 10);
  const t = tally(S, T);
  assert.deepEqual(progress('days_on', t), { cur: 10, target: 30 });
  assert.deepEqual(progress('days_on', { cur: { days_on: 3 }, got: {} }), { cur: 3, target: 7 });
  assert.deepEqual(progress('days_on', { cur: { days_on: 40 }, got: { days_on: { 7: 'x', 30: 'x' } } }), { cur: 40, target: 100 });
  assert.deepEqual(progress('days_on', { cur: { days_on: 400 }, got: { days_on: { 7: 'x', 30: 'x', 100: 'x', 365: 'x' } } }), { cur: 365, target: 365 });
  assert.deepEqual(progress('first_meal', { cur: {}, got: {} }), { cur: 0, target: 1 });
  assert.equal(progress('nope'), null);
});

test('withDayIndex: the same results as without it, and cleared after use, also when fn throws', () => {
  reset();
  on(-12, 10); meal(day(-3), 300, 10, { kind: 'photo' }); meal(day(-2), 300, 10, { status: 'pending' }); rec(day(-5), { kg: 85, steps: 9000 });
  const probe = () => [history(), dayGoals(day(-5)), dayStatus(day(-5)), dayTotals(day(-4)), weekResult(weekStart(day(-8)))];
  const before = JSON.parse(JSON.stringify(probe()));
  assert.deepEqual(withDayIndex(() => JSON.parse(JSON.stringify(probe()))), before);
  assert.deepEqual(JSON.parse(JSON.stringify(probe())), before);
  assert.equal(withDayIndex(() => withDayIndex(() => 7)), 7);
  assert.throws(() => withDayIndex(() => { throw new Error('boom'); }), /boom/);
  // cleared: a meal added afterwards is seen
  meal(day(-30));
  assert.equal(dayTotals(day(-30)).n, 1);
  withDayIndex(() => { assert.equal(dayTotals(day(-30)).n, 1); });
  assert.throws(() => withDayIndex(() => { throw new Error('x'); }));
  meal(day(-31));
  assert.equal(dayTotals(day(-31)).n, 1);
});

test('scan leaves the state alone and does not depend on the order of the entries', () => {
  reset();
  on(-15, 12);
  const copy = JSON.stringify([S.entries, S.days]);
  const got = scan(S, T);
  assert.equal(JSON.stringify([S.entries, S.days]), copy);
  S.entries.reverse();
  assert.deepEqual(scan(S, T), got);
});

test('performance: 1000 days of 5 entries scan in about a second at most', () => {
  reset();
  S.settings.startDate = day(-1000);
  for (let i = -1000; i < 0; i++) for (let k = 0; k < 5; k++) meal(day(i), 320, 28, { slot: 'lunch' });
  for (let i = -1000; i < 0; i += 2) rec(day(i), { kg: 86 - i / 1000, steps: 9000, water: 2600 });
  const t0 = performance.now();
  const got = scan(S, T);
  const ms = performance.now() - t0;
  assert.ok(got.days_on[365], 'a long history earns the top steps');
  assert.ok(ms < 1000, `${Math.round(ms)} ms`);
});

test('merge drops days that are not on the calendar', () => {
  const m = merge({ days_on: { 7: '2026-99-99', 30: '2026-02-31', 100: '2026-02-28' }, first_meal: { 1: '0000-01-01' } }, { days_on: { 7: '2026-03-01' } });
  assert.deepEqual(m, { days_on: { 7: '2026-03-01', 100: '2026-02-28' } });
  assert.ok(isRealDay('2028-02-29'));
  for (const bad of ['2027-02-29', '2026-13-01', '2026-00-10', '26-01-01', null, 5, {}]) assert.equal(isRealDay(bad), false, String(bad));
});

test('scan refuses a state that is not the one core.js reads', () => {
  reset();
  assert.throws(() => scan({ settings: S.settings, entries: [], days: {} }, T), /core\.js/);
  assert.doesNotThrow(() => scan(S, T));
});

test('settle: nothing is stored for an empty log, base is frozen once, a second run changes nothing', () => {
  reset();
  assert.deepEqual(settle(null, S, T), { next: null, added: [], changed: false });
  on(-3, 3);
  const a = settle(null, S, T);
  assert.equal(a.changed, true);
  assert.deepEqual(a.next.base, { startKg: 86.4, targetKg: 78 });
  assert.deepEqual(a.next.got.first_meal, { 1: day(-3) });
  assert.deepEqual(a.next.av, { stage: 'stage1', face: 'face_plain', acc: 'acc_none' });
  // moving the goals later does not move base, and nothing new means no write
  S.settings.startKg = 100; S.settings.targetKg = 99;
  const b = settle(a.next, S, T);
  assert.equal(b.changed, false);
  assert.equal(b.next, a.next);
  assert.deepEqual(b.next.base, { startKg: 86.4, targetKg: 78 });
  // new qualifying data is added and base still holds
  rec(day(-2), { kg: 86 });
  const c = settle(a.next, S, T);
  assert.equal(c.changed, true);
  assert.deepEqual(c.added.map((x) => x[0]), ['first_weigh']);
  assert.deepEqual(c.next.base, { startKg: 86.4, targetKg: 78 });
  assert.equal(settle(c.next, S, T).changed, false);
});

test('clearing the log keeps what was earned; a factory reset starts again', () => {
  reset();
  on(-10, 10);
  const had = settle(null, S, T).next;
  assert.ok(had.got.days_on);
  reset(); // the log is gone
  const after = settle(had, S, T);
  assert.equal(after.changed, false);
  assert.deepEqual(after.next.got, had.got);
  assert.equal(after.next.base, had.base);
  // factory reset: kv is emptied (db.clear('kv') in js/app.js), so the next run has no stored copy and an empty log
  assert.deepEqual(settle(null, S, T), { next: null, added: [], changed: false });
});
