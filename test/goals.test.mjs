// Settings → Goals: validateGoals (js/onboarding.js) holds the limits setup and a restore apply, goalError (js/views.js) words them. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateGoals } from '../js/onboarding.js';
import { cleanSettings } from '../js/backup.js';
import { views } from './screens.mjs'; // views.js needs the stand-ins screens.mjs sets up

const { goalError, GOAL_FIELD_IDS } = views;

// As the Settings fields hold them: text
const ok = { startDate: '2026-10-05', targetDate: '2026-12-31', startKg: '87', targetKg: '78', kcalMinDay: '1500', kcalRest: '1550', kcalTrain: '1750', protein: '135' };
const codes = (input) => validateGoals({ ...ok, ...input }).errors.map((e) => `${e.field}:${e.code}`);

test('validateGoals: sound goals pass and come back as numbers', () => {
  const r = validateGoals(ok);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { startDate: '2026-10-05', targetDate: '2026-12-31', startKg: 87, targetKg: 78, kcalMinDay: 1500, kcalRest: 1550, kcalTrain: 1750, protein: 135 });
  assert.deepEqual(validateGoals({ ...ok, startKg: '87,4', kcalRest: '1.550' }).value.startKg, 87.4); // decimal comma, thousands dot as setup reads them
});

test('validateGoals: what it passes, a restore keeps', () => {
  const { value } = validateGoals({ ...ok, protein: '50', kcalTrain: '6000', startKg: '300', targetKg: '30', kcalMinDay: '500', kcalRest: '500' });
  assert.deepEqual(cleanSettings(value), value);
});

test('validateGoals: the limits and the order of the checks', () => {
  assert.deepEqual(codes({ protein: '50' }), []); // setup takes 50 g, and so does Settings now
  assert.deepEqual(codes({ protein: '49' }), ['protein:below_min']);
  assert.deepEqual(codes({ protein: '401' }), ['protein:range']);
  assert.deepEqual(codes({ kcalRest: '6001', kcalTrain: '6001' }), ['kcalRest:range', 'kcalTrain:range']);
  assert.deepEqual(codes({ kcalRest: '1400' }), ['kcalRest:below_min_day']); // under the minimum kcal
  assert.deepEqual(codes({ kcalTrain: '1500' }), ['kcalTrain:below_rest']);
  assert.deepEqual(codes({ kcalMinDay: '499', kcalRest: '1550' }), ['kcalMinDay:below_floor']);
  assert.deepEqual(codes({ startKg: '301' }), ['startKg:range']);
  assert.deepEqual(codes({ targetKg: '87' }), ['targetKg:not_below_start']);
  assert.deepEqual(codes({ targetDate: '2026-10-05' }), ['targetDate:not_after_start']);
  assert.deepEqual(codes({ startDate: '', targetDate: '' }), ['startDate:required', 'targetDate:required']);
  assert.deepEqual(codes({ startDate: '2026-02-31' }), ['startDate:invalid']);
  assert.deepEqual(codes({ startKg: '87kg' }), ['startKg:invalid']);
  assert.deepEqual(codes({ protein: '' }), ['protein:required']);
});

test('goalError: every code validateGoals gives has words, and each field has its element', () => {
  const inputs = [{ protein: '49' }, { protein: '401' }, { kcalRest: '6001', kcalTrain: '6001' }, { kcalRest: '1400' }, { kcalTrain: '1500' }, { kcalMinDay: '499' },
    { startKg: '301' }, { targetKg: '87' }, { targetDate: '2026-10-05' }, { startDate: '', targetDate: '', startKg: '', targetKg: '', kcalMinDay: '', kcalRest: '', kcalTrain: '', protein: '' }, { startDate: 'x', startKg: 'y' }];
  for (const input of inputs) {
    const r = validateGoals({ ...ok, ...input });
    for (const e of r.errors) {
      assert.ok(GOAL_FIELD_IDS[e.field], e.field);
      const msg = goalError(e.field, e.code, r.value);
      assert.ok(msg && (msg !== 'Check this value' || (e.code === 'invalid' && !/Date$/.test(e.field))), `${e.field}:${e.code} → ${msg}`); // only a number typed wrong gets the general words
    }
  }
  assert.equal(goalError('kcalRest', 'below_min_day', { kcalMinDay: 1500 }), 'At least the minimum (1,500)');
  assert.equal(goalError('protein', 'below_min'), 'Enter at least 50 g');
});
