// SQL export: one text file that builds the Kantar tables in any SQLite database.
//   sqlite3 -bail kantar.db < kantar-export-2026-10-03.sql
// (-bail stops at the first error, so a failed load is rolled back instead of leaving half the tables.)
// Loading the file again replaces the kantar_* tables and views and touches nothing else.
import { targetAt, dayKey } from './plan.js';

export const EXPORT_SCHEMA = 1;
export const exportName = (now = new Date()) => `kantar-export-${dayKey(now)}.sql`;

const text = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/\u0000/g, '').replace(/'/g, "''")}'`);
const num = (v, digits = 2) => (v == null || v === '' || !Number.isFinite(+v) ? 'NULL' : String(+(+v).toFixed(digits)));
const int = (v) => (v == null || v === '' || !Number.isFinite(+v) ? 'NULL' : String(Math.round(+v)));
const pad = (n) => String(n).padStart(2, '0');
const localTime = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const SCHEMA = `
CREATE TABLE kantar_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE kantar_days (
  day              TEXT PRIMARY KEY,            -- YYYY-MM-DD
  weight_kg        REAL,                        -- that day's weigh-in
  steps            INTEGER,
  water_ml         INTEGER,
  workout          INTEGER NOT NULL DEFAULT 0,  -- 1 on workout days
  target_kcal      INTEGER NOT NULL,            -- the day's calorie target under the current Targets, so changing them changes past rows
  target_weight_kg REAL                         -- where the schedule stood on the day; NULL before the start date
);

CREATE TABLE kantar_meals (
  id         TEXT PRIMARY KEY,
  day        TEXT NOT NULL,                     -- YYYY-MM-DD
  logged_at  TEXT NOT NULL,                     -- local time, YYYY-MM-DD HH:MM:SS
  slot       TEXT,                              -- morning, lunch, snack1, snack2, dinner, late, workout
  title      TEXT,
  source     TEXT,                              -- plan, flex, favorite, photo, text, check
  plan_id    TEXT,                              -- id of the plan meal, if it was one
  tier       TEXT,                              -- plan, flex, off
  status     TEXT NOT NULL,                     -- ok, pending, error; only ok rows have numbers
  portion    REAL NOT NULL DEFAULT 1,           -- 0.5, 1, 1.5 or 2
  kcal       REAL,                              -- kcal and the macros are already multiplied by portion
  protein_g  REAL,
  carbs_g    REAL,
  fat_g      REAL,
  fibre_g    REAL,
  confidence REAL,                              -- 0 to 1: the model's own estimate; 1 for meals you tapped or edited; NULL when unknown
  place      TEXT,                              -- Home, Office or out, when photo location is on
  note       TEXT,                              -- what was typed
  photos     INTEGER NOT NULL DEFAULT 0,        -- number of photos; the photos themselves are not exported
  flags      TEXT                               -- comma-separated, for example alcohol
);
CREATE INDEX kantar_meals_day ON kantar_meals (day);

CREATE TABLE kantar_meal_items (
  meal_id   TEXT NOT NULL REFERENCES kantar_meals (id),
  position  INTEGER NOT NULL,
  name      TEXT,
  grams     REAL,                               -- multiplied by the meal's portion, like kcal and protein_g
  kcal      REAL,
  protein_g REAL,
  PRIMARY KEY (meal_id, position)
);

-- One row per day: the day's own values, the 7-day weight average the app uses, and the meal totals.
CREATE VIEW kantar_daily AS
SELECT
  d.day,
  d.weight_kg,
  (SELECT ROUND(AVG(w.weight_kg), 2) FROM kantar_days w
    WHERE w.weight_kg IS NOT NULL AND w.day BETWEEN date(d.day, '-6 days') AND d.day) AS weight_avg7_kg,
  d.target_weight_kg,
  d.steps,
  d.water_ml,
  d.workout,
  d.target_kcal,
  COALESCE(m.meals, 0)                AS meals,
  ROUND(COALESCE(m.kcal, 0), 1)       AS kcal,
  ROUND(COALESCE(m.protein_g, 0), 1)  AS protein_g,
  ROUND(COALESCE(m.carbs_g, 0), 1)    AS carbs_g,
  ROUND(COALESCE(m.fat_g, 0), 1)      AS fat_g,
  ROUND(COALESCE(m.fibre_g, 0), 1)    AS fibre_g
FROM kantar_days d
LEFT JOIN (
  SELECT day, COUNT(*) AS meals, SUM(kcal) AS kcal, SUM(protein_g) AS protein_g,
         SUM(carbs_g) AS carbs_g, SUM(fat_g) AS fat_g, SUM(fibre_g) AS fibre_g
  FROM kantar_meals WHERE status = 'ok' GROUP BY day
) m ON m.day = d.day;
`;

/**
 * @param {{settings: object, entries: object[], days: object[], appVersion: string, now?: Date}} data
 * @returns {{sql: string, counts: {days: number, meals: number, items: number}}}
 */
export function buildSql({ settings: s, entries, days, appVersion, now = new Date() }) {
  const out = [];
  out.push(
    `-- Kantar export, ${localTime(now.getTime())} (app version ${appVersion}, export schema ${EXPORT_SCHEMA})`,
    '-- Load it into a new or existing SQLite database:',
    `--   sqlite3 -bail kantar.db < ${exportName(now)}`,
    '-- Loading again replaces the kantar_* tables and the kantar_daily view; nothing else in the database is touched.',
    '-- Not included: photos, API keys, the coordinates of saved places.',
    '',
    'BEGIN TRANSACTION;',
    'DROP VIEW IF EXISTS kantar_daily;',
    'DROP TABLE IF EXISTS kantar_meal_items;',
    'DROP TABLE IF EXISTS kantar_meals;',
    'DROP TABLE IF EXISTS kantar_days;',
    'DROP TABLE IF EXISTS kantar_settings;',
    SCHEMA,
  );

  const settings = [
    ['export_schema', EXPORT_SCHEMA], ['exported_at', localTime(now.getTime())], ['app_version', appVersion],
    ['start_date', s.startDate], ['target_date', s.targetDate], ['start_weight_kg', s.startKg], ['target_weight_kg', s.targetKg],
    ['kcal_rest_day', s.kcalRest], ['kcal_workout_day', s.kcalTrain], ['protein_g', s.protein], ['fibre_g', s.fiber],
    ['steps', s.steps], ['water_ml', s.water],
  ];
  for (const [k, v] of settings) out.push(`INSERT INTO kantar_settings (key, value) VALUES (${text(k)}, ${text(v)});`);
  out.push('');

  // Every day that has a day record or a meal gets a row, so kantar_daily has no gaps where something was logged
  const meals = entries.filter((e) => e.kind === 'meal').sort((a, b) => a.ts - b.ts);
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const e of meals) if (!byDay.has(e.day)) byDay.set(e.day, { day: e.day });
  const dayRows = Array.from(byDay.values()).filter((d) => d.day).sort((a, b) => (a.day < b.day ? -1 : 1));
  for (const d of dayRows) {
    const targetKg = d.day >= s.startDate ? targetAt(d.day, s) : null;
    out.push(`INSERT INTO kantar_days (day, weight_kg, steps, water_ml, workout, target_kcal, target_weight_kg) VALUES (${text(d.day)}, ${num(d.kg)}, ${int(d.steps)}, ${int(d.water)}, ${d.train ? 1 : 0}, ${int(d.train ? s.kcalTrain : s.kcalRest)}, ${num(targetKg)});`);
  }
  out.push('');

  let items = 0;
  for (const e of meals) {
    const ok = e.status === 'ok';
    const m = e.mult || 1;
    const v = (x) => (ok ? num((x || 0) * m) : 'NULL');
    out.push(`INSERT INTO kantar_meals (id, day, logged_at, slot, title, source, plan_id, tier, status, portion, kcal, protein_g, carbs_g, fat_g, fibre_g, confidence, place, note, photos, flags) VALUES (${[
      text(e.id), text(e.day), text(localTime(e.ts)), text(e.slot), text(e.title), text(e.src), text(e.planId), text(ok ? e.tier : null),
      text(e.status), num(m), v(e.kcal), v(e.p), v(e.c), v(e.f), v(e.fib), ok && e.conf > 0 ? num(e.conf) : 'NULL',
      text(e.place), text(e.text), int((e.photoIds || []).length), text((e.flags || []).join(',')),
    ].join(', ')});`);
    if (!ok) continue;
    (e.items || []).forEach((it, i) => {
      items += 1;
      out.push(`INSERT INTO kantar_meal_items (meal_id, position, name, grams, kcal, protein_g) VALUES (${text(e.id)}, ${i + 1}, ${text(it.n)}, ${it.g ? num(it.g * m) : 'NULL'}, ${num((it.kcal || 0) * m)}, ${num((it.p || 0) * m)});`);
    });
  }
  out.push('', 'COMMIT;', '');
  return { sql: out.join('\n'), counts: { days: dayRows.length, meals: meals.length, items } };
}

