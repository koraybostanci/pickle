// State, and the calculations on it. No DOM and no storage, so the maths loads on its own (in node, for tests).
import { MEALS, MEAL_BY_ID, SLOTS, DEFAULTS, LOCALE, dayKey, parseDay, addDays, diffDays, SMALL_TREAT_KCAL } from './plan.js';

export const APP_VERSION = '36'; // bump together with VERSION in sw.js
export const SCHEMA_VERSION = 2; // version of the stored data and of the backup file
// The app's internal id. It names the database, the caches, the backup files' marker and the SQL export's tables, and
// never follows the app's name (Pickle), so a rename touches only what people see and never the data.
export const APP_ID = 'weightplan';

// ——— State ———
// The settings of an app that has just been installed (new objects each time, so a reset never shares them)
export const freshSettings = () => ({
  ...DEFAULTS, schema: SCHEMA_VERSION,
  provider: 'openai', oaBase: 'https://generativelanguage.googleapis.com/v1beta/openai', oaModel: 'gemini-3.5-flash', oaKey: '', apiKey: '',
  useLocation: false, places: [], favorites: [], supplements: [], hideStart: false, autoReview: true,
  usage: { in: 0, out: 0, calls: 0, usd: 0 }, lastBackup: 0,
});
// What the Check screen is holding while a check is put together; its photos live in memory only
export const freshCheck = () => ({ photos: [], note: '', busy: false, status: '', err: '', openId: null });

export const S = {
  tab: 'today',
  settings: freshSettings(),
  entries: [],
  days: {},
  viewDay: dayKey(new Date()),
  busy: new Set(),
  retry: new Map(), // status note shown while an analysis is retrying
  reviewing: new Set(), // days whose review is being written
  reviewErr: new Map(), // day → why the last review failed
  coaching: new Set(), // days whose quick note is being written
  coachErr: new Map(), // day → why the last quick note failed
  reviewOpen: new Map(), // day → whether its review is expanded, once the person has toggled it
  check: freshCheck(), // the check being put together
  checks: [], // earlier verdicts, newest first, without photos
  urls: new Map(),
  persisted: null,
  storage: null,
  calPick: null,
  chartRange: 'weeks', // the weight chart: 'week' (7 days), 'weeks' (14) or 'whole' (the plan)
  sheet: null, // open bottom sheet: {type:'settings'|'entry'|'num'|'slot'|'plan'|'plan-frame', ...}
  suppEdit: '', // id of the supplement being edited in Settings
  openSetting: '', // expanded section in Settings
};


// Call configuration for the selected provider
export function aiCfg() {
  const s = S.settings;
  return s.provider === 'openai'
    ? { provider: 'openai', key: s.oaKey, model: s.oaModel, base: s.oaBase }
    : { provider: 'anthropic', key: s.apiKey, model: s.model };
}
export const hasKey = () => { const c = aiCfg(); return !!c.key && (c.provider !== 'openai' || (!!c.base && !!c.model)); };
export const today = () => dayKey(new Date());

// ——— Calculations ———
export const eff = (e) => {
  const m = e.mult || 1;
  return { kcal: (e.kcal || 0) * m, p: (e.p || 0) * m, c: (e.c || 0) * m, f: (e.f || 0) * m, fib: (e.fib || 0) * m };
};
export const mealsOf = (day) => S.entries.filter((e) => e.day === day && e.kind === 'meal' && e.status === 'ok');
export function dayTotals(day) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, fib: 0, n: 0 };
  for (const e of mealsOf(day)) {
    const v = eff(e);
    t.kcal += v.kcal; t.p += v.p; t.c += v.c; t.f += v.f; t.fib += v.fib; t.n += 1;
  }
  return t;
}
export const dayTarget = (day) => ((S.days[day] && S.days[day].train) ? S.settings.kcalTrain : S.settings.kcalRest);

// Where a day's calories sit against its target: the shares that separate 'too little', 'on target' and 'over'
export const BAND = { partial: 0.6, low: 0.75, high: 1.07, near: 1.15 };
// The protein a day has to reach: the minimum, but never more than the target itself
export const proteinFloor = () => Math.min(S.settings.proteinMin || S.settings.protein, S.settings.protein);

// 'on' = on target, 'near' = close, 'over' = above, 'partial' = too little logged, 'none' = nothing logged
export function dayStatus(day) {
  const t = dayTotals(day);
  if (!t.n) return 'none';
  const target = dayTarget(day);
  const hasOff = mealsOf(day).some((e) => e.tier === 'off');
  if (t.kcal < target * BAND.partial) return 'partial';
  if (t.kcal <= target * BAND.high && t.kcal >= target * BAND.low && t.p >= proteinFloor() && !hasOff) return 'on';
  if (t.kcal <= target * BAND.near) return 'near';
  return 'over';
}

// The five things a day can get right. Calories count once enough is logged and the total is within budget.
export function dayGoals(day) {
  const dd = S.days[day] || {};
  const t = dayTotals(day);
  const target = dayTarget(day);
  const s = S.settings;
  return [
    { id: 'weigh', name: 'Weigh-in', done: !!dd.kg },
    { id: 'kcal', name: 'Calories', done: t.n > 0 && t.kcal >= target * BAND.low && t.kcal <= target * BAND.high },
    { id: 'protein', name: 'Protein', done: t.p >= proteinFloor() },
    { id: 'steps', name: 'Steps', done: (dd.steps || 0) >= s.steps },
    { id: 'water', name: 'Water', done: (dd.water || 0) >= s.water },
  ];
}
export const isPerfect = (day) => dayGoals(day).every((g) => g.done);

// Whole kilos lost since the start, by the latest weigh-in
export function kilosDown(day = today()) {
  const a = latestWeight(day);
  if (!a || day < S.settings.startDate) return 0;
  return Math.max(0, Math.floor(S.settings.startKg - a.kg + 1e-6));
}

// Looking back over the plan so far: days on plan, the longest run, perfect days
export function history() {
  const s = S.settings;
  const t = today();
  let onPlan = 0;
  let best = 0;
  let run = 0;
  let perfect = 0;
  for (let d = s.startDate; d <= t; d = addDays(d, 1)) {
    const st = dayStatus(d);
    if (st === 'on' || st === 'near') { onPlan += 1; run += 1; best = Math.max(best, run); } else if (d !== t) run = 0;
    if (isPerfect(d)) perfect += 1;
  }
  return { onPlan, best, perfect, days: Math.max(0, diffDays(s.startDate, t) + 1) };
}

export function avg7(day) {
  let s = 0;
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = S.days[addDays(day, -i)];
    if (d && d.kg) { s += d.kg; n += 1; }
  }
  return n ? { kg: s / n, n } : null;
}
// The latest recorded weigh-in on or before the day, shaped like an average of one
export function latestWeight(day = today()) {
  const last = weightSeries().filter((d) => d.day <= day).pop();
  return last ? { kg: last.kg, n: 1, day: last.day } : null;
}

export function weightSeries() {
  return Object.values(S.days).filter((d) => d.kg).sort((a, b) => (a.day < b.day ? -1 : 1));
}

// Slope over the last 14 days (kg/day) and the projected arrival at the target
export function projection() {
  const w = weightSeries().filter((d) => diffDays(d.day, today()) <= 14);
  if (w.length < 4 || diffDays(w[0].day, w[w.length - 1].day) < 6) return null;
  const xs = w.map((d) => diffDays(w[0].day, d.day));
  const ys = w.map((d) => d.kg);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  const slope = den ? num / den : 0;
  // Where the fitted line stands today; the 7-day average lags it by about three days on a steady loss
  const now = my + slope * (diffDays(w[0].day, today()) - mx);
  const out = { slope, perWeek: slope * 7, now }; // now: where the fitted line stands today
  if (slope < -0.005) {
    const daysLeft = Math.ceil((now - S.settings.targetKg) / -slope - 1e-6); // the 1e-6 keeps float noise from adding a day
    out.eta = daysLeft > 0 && daysLeft < 730 ? addDays(today(), daysLeft) : null;
    if (daysLeft <= 0) out.eta = today();
  }
  return out;
}

// The days the weight chart spans and where its date ticks go. range: 'week', 'weeks' or 'whole'; firstDay: the first weigh-in, or ''
export function chartWindow(range, t, s, firstDay) {
  if (range === 'whole') {
    let x0 = s.startDate;
    if (firstDay && firstDay < x0) x0 = diffDays(firstDay, s.startDate) > 21 ? addDays(s.startDate, -21) : firstDay;
    return { x0, x1: s.targetDate, ticks: null };
  }
  const week = range === 'week';
  const x0 = addDays(t, week ? -6 : -13);
  const at = (i, anchor) => [addDays(x0, i), anchor];
  return { x0, x1: t, ticks: week ? [at(0, 'start'), at(2, 'middle'), at(4, 'middle'), at(6, 'end')] : [at(0, 'start'), at(7, 'middle'), at(13, 'end')] };
}

export function weekStart(day) {
  const d = parseDay(day);
  return addDays(day, -((d.getDay() + 6) % 7));
}
export function weekFlex(day) {
  const ws = weekStart(day);
  const we = addDays(ws, 6);
  const r = { small: 0, meal: 0, off: 0 };
  for (const e of S.entries) {
    if (e.kind !== 'meal' || e.status !== 'ok' || e.day < ws || e.day > we) continue;
    if (e.tier === 'off') r.off += 1;
    else if (e.tier === 'flex') {
      if ((e.flags || []).includes('alcohol') || eff(e).kcal <= SMALL_TREAT_KCAL) r.small += 1;
      else r.meal += 1;
    }
  }
  return r;
}

// Coffee is counted, with no goal; a typed beer is logged as the Beer 0.5 l extra
export const COUNT_MAX = 30; // a day's coffee tally is never above this, typed, tapped or restored
// "coffee", "a beer", "2 coffees", "beer 3". "Beer 0.33 l" has a decimal, so it never matches (it is a planned extra)
export function parseCount(t) {
  const m = /^(?:(\d{1,2}|an?|one)\s+)?(coffees?|beers?)(?:\s+(\d{1,2}))?$/.exec(t);
  if (!m || (m[1] && m[3])) return null;
  const lead = m[1] && /^\d/.test(m[1]) ? Number(m[1]) : 1;
  const n = m[3] ? Number(m[3]) : lead;
  if (n < 1 || n > 12) return null;
  return { key: m[2].startsWith('coffee') ? 'coffee' : 'beer', n };
}
// A day's coffee count and the totals for the Monday-to-Sunday week of `day` and the week before
export function drinkTally(day) {
  const on = (from, to) => Object.entries(S.days).reduce((a, [d, r]) => a + (d >= from && d <= to ? (r && Number.isFinite(r.coffee) ? r.coffee : 0) : 0), 0);
  const ws = weekStart(day);
  return { today: on(day, day), week: on(ws, addDays(ws, 6)), prev: on(addDays(ws, -7), addDays(ws, -1)) };
}

export function streak() {
  let n = 0;
  let d = today();
  const first = dayStatus(d);
  if (first !== 'on' && first !== 'near') d = addDays(d, -1); // today is not over yet
  for (let i = 0; i < 400; i++) {
    const st = dayStatus(d);
    if (st === 'on' || st === 'near') { n += 1; d = addDays(d, -1); } else break;
  }
  return n;
}

// The planned meals of the day not logged yet, in order (the late snack is only for when you are hungry)
export function openSlots(day) {
  const logged = new Set(mealsOf(day).map((e) => e.slot));
  return SLOTS.filter((s) => s.id !== 'late' && !logged.has(s.id));
}

export function suggest(day) {
  const tot = dayTotals(day);
  const rem = dayTarget(day) - tot.kcal;
  const remP = S.settings.protein - tot.p;
  const open = openSlots(day);
  if (!open.length) {
    if (remP > 12 && rem >= 90) return { rem, remP, meal: MEAL_BY_ID['N-A'], slot: SLOTS.find((s) => s.id === 'late'), extra: true };
    return { rem, remP, meal: null };
  }
  const next = open[0];
  const minKcal = (id) => Math.min(...MEALS.filter((m) => m.slot === id).map((m) => m.kcal));
  const reserve = open.slice(1).reduce((a, s) => a + minKcal(s.id), 0);
  const options = MEALS.filter((m) => m.slot === next.id);
  const fit = options.filter((m) => m.kcal <= rem - reserve + 40);
  const pool = fit.length ? fit : options.slice().sort((a, b) => a.kcal - b.kcal).slice(0, 1);
  const meal = pool.slice().sort((a, b) => b.p - a.p)[0];
  return { rem, remP, meal, slot: next, tight: !fit.length };
}

// ——— The day against the plan ———
const KCAL_PER_KG = 7700; // roughly a kilo of body fat
// What the schedule asks of one day, in kg and in kcal
export function planRate() {
  const s = S.settings;
  const days = diffDays(s.startDate, s.targetDate);
  const kg = days > 0 ? Math.max(0, (s.startKg - s.targetKg) / days) : 0;
  return { kg, kcal: kg * KCAL_PER_KG };
}

// How a day compares with the plan and what it did to the schedule. Worked out on the device, no model involved.
// level: 'open' (today, still within budget), 'thin' (too little logged to judge), 'on', 'near' (calories fine, something else is not),
// 'under', 'over' (slightly) or 'back' (clearly over)
export function dayVerdict(day) {
  const t = dayTotals(day);
  if (!t.n) return null;
  const s = S.settings;
  const target = dayTarget(day);
  const delta = Math.round(t.kcal - target);
  const live = day === today();
  const proteinGap = Math.max(0, Math.ceil(proteinFloor() - t.p - 1e-6)); // rounded up: any shortfall is a missed goal, as the goal ring says
  const off = mealsOf(day).filter((e) => e.tier === 'off').length;
  let level;
  if (delta > target * (BAND.near - 1)) level = 'back';
  else if (delta > target * (BAND.high - 1)) level = 'over';
  else if (live) level = 'open';
  else if (t.kcal < target * BAND.partial) level = 'thin';
  else if (t.kcal < target * BAND.low) level = 'under';
  else level = proteinGap || off ? 'near' : 'on';
  const rate = planRate();
  return { level, live, target, kcal: t.kcal, delta, kg: delta / KCAL_PER_KG, share: rate.kcal > 0 ? delta / rate.kcal : 0, proteinGap, off };
}
export const VERDICT = {
  open: 'In progress', thin: 'Too little logged', on: 'In line', near: 'Mostly in line',
  under: 'Under budget', over: 'A bit over', back: 'Well over',
};
// The verdict in sentences: calories against the target, what a surplus costs on the schedule, protein, off-plan entries
export function verdictText(v) {
  const out = [];
  const kcal = fmtInt(Math.abs(v.delta));
  const judged = v.level !== 'thin' && v.level !== 'open';
  if (v.level === 'thin') out.push(`Only ${fmtInt(v.kcal)} kcal logged, too little to judge the day.`);
  else if (v.level === 'open') out.push(v.delta < -25 ? `${kcal} kcal left for today.` : 'The budget for today is used up.');
  else if (v.delta > 25) {
    const kg = v.kg >= 0.005 ? `: about ${v.kg.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg` : '';
    const cost = !kg || v.share <= 0 ? '' : v.share >= 1.5 ? `, ${v.share.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} days of the schedule`
      : v.share >= 0.95 ? ', all of what the day was meant to lose' : `, ${Math.round(v.share * 100)}% of what the day was meant to lose`;
    out.push(`${kcal} kcal over budget${kg}${cost}.`);
  } else if (v.delta < -25) out.push(`${kcal} kcal under budget${v.level === 'under' ? '; check that everything is logged' : ''}.`);
  else out.push('On budget.');
  if (judged && v.proteinGap > 0) out.push(`Protein ${v.proteinGap} g short.`);
  if (v.off) out.push(`${v.off} off-plan ${v.off === 1 ? 'entry' : 'entries'}.`);
  return out;
}

// ——— The day's calories as one budget ———
export const PACE = { fast: 1.25, slow: 0.7 }; // eaten / planned-by-now: above fast is ahead of the plan, below slow behind it
// What the plan has spent at each meal time: each main slot spends the average of its options, scaled so the day ends at its budget
export function planSteps(target) {
  const steps = SLOTS.filter((x) => x.id !== 'late').map((x) => {
    const options = MEALS.filter((m) => m.slot === x.id);
    const [h, m] = x.time.split(':').map(Number);
    return { id: x.id, name: x.name, time: x.time, at: h + m / 60, kcal: options.reduce((a, o) => a + o.kcal, 0) / (options.length || 1) };
  });
  const scale = target / (steps.reduce((a, x) => a + x.kcal, 0) || 1);
  steps.forEach((x) => { x.kcal *= scale; });
  return steps;
}
export const plannedBy = (target, hour) => planSteps(target).filter((x) => x.at <= hour).reduce((a, x) => a + x.kcal, 0);
// The day's calories against its budget and, for a day in progress (planned = kcal the plan has spent by now), against the plan's pace.
// planned === null means a finished day. → { level: '' | 'over' | 'back', tone: 'good' | 'warn' | 'bad' | 'calm', text }
export function budgetVerdict({ target, eaten: kcal, planned }) {
  const eaten = Math.round(kcal); // as dayVerdict rounds it
  const rem = target - eaten;
  const n = (x) => fmtInt(Math.abs(x));
  const past = planned == null;
  const level = rem < -target * (BAND.near - 1) ? 'back' : rem < -target * (BAND.high - 1) ? 'over' : '';
  if (level) return { level, tone: level === 'back' ? 'bad' : 'warn', text: past ? `Ended ${n(rem)} over` : level === 'back' ? 'Well over budget' : 'A bit over budget' };
  if (past) {
    if (!eaten) return { level, tone: 'calm', text: 'Nothing logged' };
    const text = Math.abs(rem) <= 25 ? 'Ended on budget' : rem > 0 ? `Ended ${n(rem)} under` : `Ended ${n(rem)} over`;
    return { level, tone: eaten < target * BAND.low ? 'calm' : 'good', text };
  }
  if (rem <= 0) return planned >= target - 1 ? { level, tone: 'good', text: 'Budget used' } : { level, tone: 'warn', text: 'Budget used early' }; // within the slack still counts as on target, once the plan has spent it too
  if (!planned) return { level, tone: 'calm', text: '' };
  if (!eaten) return { level, tone: 'calm', text: 'Nothing eaten yet' };
  const rate = eaten / planned;
  if (rate > PACE.fast) return { level, tone: 'warn', text: `${n(eaten - planned)} over plan pace` };
  if (rate < PACE.slow) return { level, tone: 'calm', text: `${n(eaten - planned)} under plan pace` };
  return { level, tone: 'good', text: 'On plan pace' };
}
// Where the bar's marks sit, as shares of its width: the width is the budget, or what was eaten when that is more
export function budgetMeter({ target, eaten, planned }) {
  const D = Math.max(target, eaten) || 1;
  return { eat: eaten / D, cap: target / D, plan: planned > 0 && planned < target - 1 ? planned / D : null };
}

// A review belongs to the log it was written for: it goes stale when the day's meals change, or when it was written before the day ended
export const reviewSig = (day) => `${dayTarget(day)}|${mealsOf(day).map((e) => `${e.id}:${Math.round(eff(e).kcal)}`).sort().join(',')}`;
export function reviewState(day) {
  const r = S.days[day] && S.days[day].review;
  if (!r) return 'none';
  return r.sig !== reviewSig(day) || (r.live && day !== today()) ? 'stale' : 'fresh';
}

// The quick note on the day so far goes stale when the day's meals change
export function coachState(day) {
  const c = S.days[day] && S.days[day].coach;
  if (!c) return 'none';
  return c.sig === reviewSig(day) && day === today() ? 'fresh' : 'stale';
}

// ——— Formatting ———
export const fmtKg = (kg) => (Math.round(kg * 10) / 10 || 0).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 }); // `|| 0`: never "-0.0"
export const fmtInt = (n) => Math.round(n).toLocaleString(LOCALE);

export const SUPP_MAX = 12; // supplements in the list
// The supplements taken on a day, as ids of supplements that are still in the list
export const suppTaken = (day) => {
  const have = new Set((S.settings.supplements || []).map((x) => x.id));
  return ((S.days[day] && S.days[day].taken) || []).filter((id) => have.has(id));
};

export const CHECK_MAX = 4; // photos per check
export const checkReady = () => !S.check.busy && (S.check.photos.length > 0 || S.check.note.trim().length > 2);
