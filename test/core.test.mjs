// The calculations in js/core.js: no DOM, no storage, so they run as they are. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  S, BAND, proteinFloor, dayStatus, dayGoals, dayVerdict, currentAvg, avg7, kilosDown, projection, openSlots, suggest,
  fmtKg, isLegacyData, today, SCHEMA_VERSION, MIN_SCHEMA_VERSION,
} from '../js/core.js';
import { addDays, hhmm, planDigest, planFoods, FOODS, MEALS } from '../js/plan.js';

const T = today();
const day = (off) => addDays(T, off);
const reset = () => {
  S.entries = [];
  S.days = {};
  Object.assign(S.settings, { startDate: day(-40), startKg: 86.4, targetDate: day(60), targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, proteinMin: 120 });
};
const meal = (d, kcal, p, extra = {}) => S.entries.push({ id: `e${S.entries.length}`, day: d, ts: Date.now(), kind: 'meal', status: 'ok', slot: 'lunch', kcal, p, c: 0, f: 0, fib: 0, mult: 1, tier: 'plan', ...extra });

test('the protein goal, the day status and the verdict agree at 119.6 g with a 120 g minimum', () => {
  reset(); meal(day(-1), 1500, 119.6);
  const goal = dayGoals(day(-1)).find((g) => g.id === 'protein').done;
  assert.equal(goal, false);
  assert.notEqual(dayStatus(day(-1)), 'on');
  assert.ok(dayVerdict(day(-1)).proteinGap > 0);
});

test('a protein minimum above the target is capped at the target', () => {
  reset(); S.settings.proteinMin = 140;
  assert.equal(proteinFloor(), 135);
  meal(day(-1), 1500, 135);
  assert.equal(dayStatus(day(-1)), 'on');
});

test('calorie bands decide the verdict level', () => {
  reset(); meal(day(-1), 1550 * 1.16, 135);
  assert.equal(dayVerdict(day(-1)).level, 'back');
  assert.equal(dayStatus(day(-1)), 'over');
  S.entries = []; meal(day(-1), 1550 * 1.10, 135);
  assert.equal(dayVerdict(day(-1)).level, 'over');
  assert.equal(dayStatus(day(-1)), 'near');
  assert.ok(BAND.low < BAND.high && BAND.high < BAND.near);
});

test('a week without weighing keeps the last average, so progress does not reset', () => {
  reset();
  for (const o of [-20, -19, -18]) S.days[day(o)] = { day: day(o), kg: 84 };
  assert.equal(avg7(T), null);
  assert.equal(currentAvg(T).kg, 84);
  assert.equal(kilosDown(T), 2);
});

test('no weigh-in at all: no average, no kilos', () => {
  reset();
  assert.equal(currentAvg(T), null);
  assert.equal(kilosDown(T), 0);
});

test('the arrival date follows the fitted line (a steady 0.1 kg a day)', () => {
  reset(); S.settings.targetKg = 80;
  for (let i = 13; i >= 0; i--) S.days[day(-i)] = { day: day(-i), kg: Math.round((85 - 0.1 * (13 - i)) * 100) / 100 };
  assert.equal(projection().eta, day(37)); // 83.7 kg today, 3.7 kg to go
});

test('too few weigh-ins: no projection', () => {
  reset(); S.days[day(0)] = { day: day(0), kg: 85 };
  assert.equal(projection(), null);
});

test('the late snack is suggested only when every planned meal is logged', () => {
  reset();
  assert.deepEqual(openSlots(T).map((s) => s.id), ['lunch', 'snack1', 'snack2', 'dinner']);
  for (const slot of ['lunch', 'snack1', 'snack2', 'dinner']) meal(T, 100, 5, { slot });
  const s = suggest(T);
  assert.equal(s.extra, true);
  assert.equal(s.slot.id, 'late');
});

test('weights never print as -0.0', () => {
  assert.equal(fmtKg(-0.028), '0.0');
  assert.equal(fmtKg(-0.4), '-0.4');
  assert.equal(fmtKg(85.44), '85.4');
});

test('hhmm takes a Date or a timestamp', () => {
  assert.equal(hhmm(new Date(2026, 0, 1, 7, 5)), '07:05');
  assert.equal(hhmm(new Date(2026, 0, 1, 7, 5).getTime()), '07:05');
});

test('data from the first release is recognised, current data and a fresh install are not', () => {
  assert.equal(isLegacyData({ schema: 1 }, 5), true);
  assert.equal(isLegacyData({}, 5), true); // settings saved before the version was stamped
  assert.equal(isLegacyData(null, 5), true); // entries but no settings
  assert.equal(isLegacyData({ schema: SCHEMA_VERSION }, 5), false);
  assert.equal(isLegacyData(null, 0), false); // a fresh install
  assert.ok(MIN_SCHEMA_VERSION <= SCHEMA_VERSION);
});

test('a food added to the plan without a short name does not put "undefined" in the model digest', () => {
  FOODS.testfood = { name: 'Test food', v: [1, 1, 1, 1, 1] };
  MEALS[0].ingredients.push(['testfood', 10]);
  try {
    assert.ok(!/undefined/.test(planDigest()));
    assert.ok(!/undefined/.test(planFoods()));
  } finally {
    MEALS[0].ingredients.pop();
    delete FOODS.testfood;
  }
});
