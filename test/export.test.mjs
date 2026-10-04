// The SQL export (js/export.js), loaded into a real SQLite and queried the way the README does. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildSql } from '../js/export.js';

const settings = { startDate: '2026-10-05', targetDate: '2026-12-31', startKg: 86, targetKg: 78, kcalRest: 1550, kcalTrain: 1750, protein: 135, fiber: 30, steps: 8000, water: 2500 };
const meal = (id, day, extra) => ({ id, day, ts: new Date(`${day}T12:00:00`).getTime(), kind: 'meal', status: 'ok', slot: 'lunch', title: `It's ${id}`, src: 'text', kcal: 800, p: 40, c: 50, f: 30, fib: 5, mult: 1, tier: 'plan', conf: 0.7, photoIds: [], flags: [], items: [{ n: 'egg', g: 100, kcal: 143, p: 12 }], ...extra });
const entries = [
  meal('a', '2026-10-06', {}),
  meal('b', '2026-10-06', { kcal: 1000, tier: 'off', title: "semi;colon -- and 'quotes'\nnewline", mult: 1.5 }),
  meal('c', '2026-10-07', { status: 'pending', kcal: 0 }),
  meal('d', '2026-10-06', { title: 'Beer 0.5 l', src: 'flex', tier: 'flex', slot: 'late', kcal: 215, flags: ['alcohol'], items: [] }),
];
const days = [{ day: '2026-10-06', kg: 85.4, steps: 8200, water: 2000, coffee: 2 }, { day: '2026-10-07', kg: 85.0, train: true }];
const load = (db) => db.exec(buildSql({ settings, entries, days, appVersion: 'test' }).sql);
const rows = (db, sql) => db.prepare(sql).all();

test('the file loads, twice, and the numbers are multiplied by the portion', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  load(db); // a newer export replaces the tables
  assert.equal(rows(db, 'SELECT COUNT(*) AS n FROM weightplan_meals')[0].n, 4);
  const b = rows(db, "SELECT kcal, title, portion FROM weightplan_meals WHERE id = 'b'")[0];
  assert.equal(b.kcal, 1500);
  assert.equal(b.portion, 1.5);
  assert.equal(b.title, "semi;colon -- and 'quotes'\nnewline"); // quoting survives
});

test('only meals with status ok carry numbers', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  assert.equal(rows(db, "SELECT kcal FROM weightplan_meals WHERE id = 'c'")[0].kcal, null);
});

test('the README queries run', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  assert.equal(rows(db, 'SELECT day, weight_kg, weight_avg7_kg, target_weight_kg FROM weightplan_daily ORDER BY day').length, 2);
  assert.equal(rows(db, 'SELECT day, kcal, target_kcal FROM weightplan_daily WHERE kcal > target_kcal')[0].day, '2026-10-06');
  assert.equal(rows(db, "SELECT day, title, kcal FROM weightplan_meals WHERE tier = 'off' AND status = 'ok' ORDER BY kcal DESC").length, 1);
  assert.deepEqual(rows(db, "SELECT date(day, 'weekday 0', '-6 days') AS week, SUM(beers) AS beers, SUM(COALESCE(coffee_cups, 0)) AS coffees FROM weightplan_daily GROUP BY week ORDER BY week").map((r) => ({ ...r })),
    [{ week: '2026-10-05', beers: 1, coffees: 2 }]);
});

test('coffee and beers per day: the tally, and the flex entries flagged alcohol', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  const [a, b] = rows(db, 'SELECT coffee_cups, beers FROM weightplan_daily ORDER BY day');
  assert.deepEqual({ ...a }, { coffee_cups: 2, beers: 1 });
  assert.deepEqual({ ...b }, { coffee_cups: null, beers: 0 });
});

test('loading leaves other tables in the database alone', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE mine (x TEXT); INSERT INTO mine VALUES ('keep');");
  load(db);
  assert.equal(rows(db, 'SELECT x FROM mine')[0].x, 'keep');
});

test('the 7-day weight average is over the calendar days, as in the app', () => {
  const db = new DatabaseSync(':memory:');
  load(db);
  const r = rows(db, "SELECT weight_avg7_kg FROM weightplan_daily WHERE day = '2026-10-07'")[0];
  assert.equal(r.weight_avg7_kg, 85.2); // (85.4 + 85.0) / 2
});
