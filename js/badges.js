// Badges: what has been earned and on which day, worked out from the log. No DOM and no storage, and `today` is passed in.
// Earned badges are never taken back: evaluate and merge only ever add, and the earliest day wins.
import { T } from './i18n.js';
import { S as CORE, withDayIndex, mealsOf, dayStatus, dayGoals, isPerfect, proteinLevel, weekStart, weekResult, WEEK_TIERS } from './core.js';
import { addDays, diffDays, dayKey, parseDay } from './plan.js';

// Avatar parts: slot, and the badge step that unlocks it (null = free). Stage 1, the plain face and no accessory are free.
export const PARTS = {
  stage1: { slot: 'stage', req: null },
  stage2: { slot: 'stage', req: ['days_on', 30] },
  stage3: { slot: 'stage', req: ['days_on', 100] },
  face_plain: { slot: 'face', req: null },
  face_smile: { slot: 'face', req: ['first_weigh', 1] },
  face_cool: { slot: 'face', req: ['best_run', 7] },
  face_star: { slot: 'face', req: ['perfect_day', 10] },
  acc_none: { slot: 'acc', req: null },
  acc_leaf: { slot: 'acc', req: ['first_on', 1] },
  acc_cap: { slot: 'acc', req: ['weeks_strong', 1] },
  acc_scarf: { slot: 'acc', req: ['kilos', 3] },
  acc_headband: { slot: 'acc', req: ['protein_days', 50] },
  acc_crown: { slot: 'acc', req: ['goal', 1] },
};
const partsOf = (id) => Object.keys(PARTS).filter((p) => PARTS[p].req && PARTS[p].req[0] === id).map((p) => [p, PARTS[p].req[1]]);

// A ladder has four steps; a one-shot has the single step 1. The glyph is the id.
const badge = (id, group, steps, name, desc) => ({ id, group, glyph: id, steps, parts: partsOf(id), name, desc });
const ladder = badge;
const once = (id, group, name, desc) => badge(id, group, [1], name, desc);

export const CATALOG = [
  once('first_meal', 'start', T('First meal'), T('Log your first meal.')),
  once('first_weigh', 'start', T('First weigh-in'), T('Log your first weigh-in.')),
  once('first_on', 'start', T('First day on plan'), T('Finish a day with your calories on plan.')),
  ladder('days_on', 'consistency', [7, 30, 100, 365], T('Days on plan'), T('Days on plan in total: {n}')),
  ladder('best_run', 'consistency', [3, 7, 14, 30], T('Longest run'), T('Days on plan in a row, your best so far: {n}')),
  ladder('weeks_strong', 'consistency', [1, 4, 8, 12], T('Strong weeks'), T('Finished weeks with at least 6 days on plan: {n}')),
  ladder('anniversary', 'consistency', [30, 90, 180, 365], T('Anniversary'), T('Days since you started: {n}')),
  once('fresh_start', 'consistency', T('Fresh start'), T('Come back after a break or a rough week, and land a day on plan.')),
  ladder('perfect_day', 'complete', [1, 10, 30, 60], T('Perfect days'), T('Days with every goal done: {n}')),
  ladder('protein_days', 'complete', [10, 50, 100, 150], T('Protein days'), T('Days with your protein reached: {n}')),
  ladder('goals_days', 'complete', [10, 50, 100, 150], T('Active days'), T('Days with your steps goal met: {n}')),
  once('protein_week', 'complete', T('Protein week'), T('Reach your protein on all 7 days of a week.')),
  ladder('weigh_days', 'habits', [7, 30, 100, 200], T('Weigh-ins'), T('Days with a weigh-in: {n}')),
  once('weigh_week', 'habits', T('Weigh-in week'), T('Weigh in on all 7 days of a week.')),
  once('log_week', 'habits', T('Logging week'), T('Log something on all 7 days of a week.')),
  ladder('kilos', 'progress', [1, 3, 5, 10], T('Kilos down'), T('Whole kilos down from your start: {n}')),
  once('halfway', 'progress', T('Halfway'), T('Reach the halfway point to your target weight.')),
  once('goal', 'progress', T('Goal reached'), T('Reach your target weight.')),
];
export const BY_ID = Object.fromEntries(CATALOG.map((b) => [b.id, b]));
export const isLadder = (id) => BY_ID[id].steps.length > 1;
export const GROUPS = ['start', 'consistency', 'complete', 'habits', 'progress'];
export const GROUP_NAME = { start: T('Start'), consistency: T('Consistency'), complete: T('Complete days'), habits: T('Habits'), progress: T('Progress') };
// Bronze to Platinum: finish n is step n of a ladder; the caller translates with td()
export const FINISH_NAME = [T('Bronze'), T('Silver'), T('Gold'), T('Platinum')];
export const ONE_SHOT_FINISH = 2; // a one-shot is drawn in Gold

// The most kilos the plan can ask for: the span between the start and the target weight
export const kilosCap = (base) => Math.max(0, Math.floor(base.startKg - base.targetKg + 1e-6));
// The steps a badge can reach: the kilos steps beyond the span are dropped
export const stepsOf = (id, base) => (id === 'kilos' && base ? BY_ID.kilos.steps.filter((x) => x <= kilosCap(base)) : BY_ID[id].steps);

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// A day that exists on the calendar (2026-02-31 and 2026-99-99 do not)
export const isRealDay = (v) => typeof v === 'string' && DAY.test(v) && dayKey(parseDay(v)) === v;
const MAX_DAYS = 3660; // a pass looks back ten years at most
const hasData = (r) => !!r && !!(r.kg || r.steps || r.water || r.coffee || (r.taken && r.taken.length));

// One pass over the days from the first thing logged to today. Returns what is earned ({id: {threshold: day}}) and the current count of each badge.
// S must be the state core.js reads. A day counts as finished before `today`; `today` itself counts only once it is already on plan,
// and weigh-ins and meals count the day they are logged. A week counts once its Sunday is before `today`.
// base: {startKg, targetKg} for the progress badges (the settings when left out).
export function tally(S, today, base) {
  if (S !== CORE) throw new Error('badges read the state of core.js; pass its S'); // the day maths below reads that state, whatever is passed
  const s = S.settings;
  const b = base || { startKg: s.startKg, targetKg: s.targetKg };
  const cap = kilosCap(b);
  const got = {};
  const cur = {};
  const earn = (id, thr, day) => { if (!got[id]) got[id] = {}; if (!(thr in got[id])) got[id][thr] = day; };
  const lift = (id, n, day) => { cur[id] = n; for (const x of BY_ID[id].steps) if (n >= x) earn(id, x, day); };

  return withDayIndex(() => {
    const logged = new Set();
    for (const e of S.entries) if (DAY.test(e.day) && e.day <= today) logged.add(e.day);
    for (const [d, r] of Object.entries(S.days)) if (DAY.test(d) && d <= today && hasData(r)) logged.add(d);
    let first = [...logged].sort()[0];
    if (first && diffDays(first, today) > MAX_DAYS) first = addDays(today, -MAX_DAYS);

    let started = false;
    let quiet = 0; // consecutive days with nothing logged since the last logged one
    let pending = false; // a comeback is waiting for its first day on plan
    let daysOn = 0; let run = 0; let best = 0; let perfect = 0; let protein = 0; let active = 0; let weighed = 0; let strong = 0; let kmax = 0;
    let prev = null; // the previous weigh-in
    let ws = ''; let wLogged = 0; let wWeighed = 0; let wProtein = 0;

    for (let d = first; first && d <= today; d = addDays(d, 1)) {
      const w = weekStart(d);
      if (w !== ws) { ws = w; wLogged = 0; wWeighed = 0; wProtein = 0; }
      const isLogged = logged.has(d);
      if (isLogged) {
        if (started && quiet >= 3) pending = true;
        started = true; quiet = 0; wLogged += 1;
      } else if (started) quiet += 1;

      if (!got.first_meal && mealsOf(d).length) earn('first_meal', 1, d);
      const r = S.days[d];
      const kg = r && typeof r.kg === 'number' && Number.isFinite(r.kg) && r.kg > 0 ? r.kg : 0;
      if (kg) {
        earn('first_weigh', 1, d);
        weighed += 1; wWeighed += 1; lift('weigh_days', weighed, d);
        // A weigh-in that implies a change of more than a kilo a day is a typo, not a result: it moves nothing
        const sane = !prev || Math.abs(kg - prev.kg) <= diffDays(prev.day, d);
        prev = { kg, day: d };
        if (sane && d >= s.startDate && b.startKg > b.targetKg) {
          kmax = Math.max(kmax, Math.floor(b.startKg - kg + 1e-6));
          if (kmax >= 1 && cap >= 1) lift('kilos', Math.min(kmax, cap), d);
          if (kg <= b.startKg - (b.startKg - b.targetKg) / 2 + 1e-6) earn('halfway', 1, d);
          if (kg <= b.targetKg + 1e-6) earn('goal', 1, d);
        }
      }

      const st = dayStatus(d);
      if (d < today || st === 'on') {
        if (st === 'on') {
          daysOn += 1; lift('days_on', daysOn, d);
          earn('first_on', 1, d);
          run += 1;
          if (run > best) { best = run; lift('best_run', best, d); }
          if (pending) { earn('fresh_start', 1, d); pending = false; }
        } else if (d < today) run = 0;
        if (isPerfect(d)) { perfect += 1; lift('perfect_day', perfect, d); }
        if (st !== 'under' && ['target', 'min'].includes(proteinLevel(d))) { protein += 1; wProtein += 1; lift('protein_days', protein, d); }
        if (dayGoals(d).find((g) => g.id === 'steps').done && r && r.steps > 0) { active += 1; lift('goals_days', active, d); }
      }

      if (addDays(w, 6) === d && d < today) {
        const wr = weekResult(w);
        if (wr.onPlan >= 6) { strong += 1; lift('weeks_strong', strong, d); }
        if (wLogged === 7) earn('log_week', 1, d);
        if (wWeighed === 7) earn('weigh_week', 1, d);
        if (wProtein === 7) earn('protein_week', 1, d);
        const tier = WEEK_TIERS.find((x) => wr.onPlan >= x.min);
        if ((tier.tone === 'caution' || tier.tone === 'reset') && w >= first) pending = true;
      }
    }

    if (first && typeof s.startDate === 'string' && DAY.test(s.startDate)) {
      const from = s.startDate > first ? s.startDate : first; // counted from the plan's start, or from the first log when that came later
      cur.anniversary = Math.max(0, diffDays(from, today));
      for (const x of BY_ID.anniversary.steps) if (addDays(from, x) <= today) earn('anniversary', x, addDays(from, x));
    }
    for (const x of CATALOG) if (!isLadder(x.id)) cur[x.id] = got[x.id] ? 1 : 0;
    for (const x of CATALOG) if (cur[x.id] === undefined) cur[x.id] = 0;
    return { got, cur };
  });
}
export const scan = (S, today, base) => tally(S, today, base).got;

// Earned so far, plus whatever the log earns now. Union only: nothing in `prior` is ever lost.
export function evaluate(S, today, { got = {}, base } = {}) {
  return merge(got, scan(S, today, base));
}

// The union of two earned sets: the earliest day wins. Unknown ids, steps that are not on the ladder and malformed days are dropped.
export function merge(a, b) {
  const out = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== 'object') continue;
    for (const [id, steps] of Object.entries(src)) {
      if (!Object.hasOwn(BY_ID, id) || !steps || typeof steps !== 'object') continue;
      for (const [thr, day] of Object.entries(steps)) {
        if (!BY_ID[id].steps.includes(Number(thr)) || !isRealDay(day)) continue;
        if (!out[id]) out[id] = {};
        if (!Object.hasOwn(out[id], thr) || day < out[id][thr]) out[id][thr] = day;
      }
    }
  }
  return out;
}

// What was earned between two sets: [[id, threshold, day], ...]
export function added(before, after) {
  const out = [];
  for (const [id, steps] of Object.entries(after || {})) for (const [thr, day] of Object.entries(steps)) if (!before || !before[id] || !Object.hasOwn(before[id], thr)) out.push([id, Number(thr), day]);
  return out;
}

// Where a badge stands: ctx is {cur, got, base} (cur from tally). The target is the next step not earned yet, or the last one when all are.
export function progress(id, ctx = {}) {
  if (!Object.hasOwn(BY_ID, id)) return null;
  const steps = stepsOf(id, ctx.base);
  if (!steps.length) return { cur: 0, target: 0 };
  const have = (ctx.got && ctx.got[id]) || {};
  const cur = (ctx.cur && ctx.cur[id]) || 0;
  const next = steps.find((x) => !Object.hasOwn(have, x));
  return next === undefined ? { cur: steps[steps.length - 1], target: steps[steps.length - 1] } : { cur: Math.min(cur, next), target: next };
}

// Whether an avatar part is free or its badge step is in `got`
export function unlocked(part, got) {
  if (!Object.hasOwn(PARTS, part)) return false;
  const req = PARTS[part].req;
  return !req || !!(got && Object.hasOwn(got, req[0]) && got[req[0]] && Object.hasOwn(got[req[0]], req[1]));
}

// ——— What is stored ———
// kv `badges`: {v:1, got, seen:{id: highest step seen}, told?, av:{stage,face,acc}, base:{startKg,targetKg}|null}
// `told` (true, or absent) is set once the history on this device has been taken in once (marked seen, with the one "from your history" line); an older record has none.
export const DEFAULT_AV = { stage: 'stage1', face: 'face_plain', acc: 'acc_none' };
export const freshBadges = () => ({ v: 1, got: {}, seen: {}, av: { ...DEFAULT_AV }, base: null });

// ——— What is new ———
// The highest step of a badge in `got`, or 0
export const topOf = (got, id) => { const have = (got && Object.hasOwn(got, id) && got[id]) || {}; return Math.max(0, ...Object.keys(have).map(Number)); };
// A badge is new while its highest earned step is above the one seen
export const isNew = (id, got, seen) => topOf(got, id) > ((seen && Object.hasOwn(seen, id) && seen[id]) || 0);
// `seen` with the given badges (all earned ones when ids is left out) raised to their highest earned step. The same object when nothing changes.
export function seenUpTo(seen, got, ids) {
  let out = seen || {};
  for (const id of ids || Object.keys(got || {})) {
    const top = topOf(got, id);
    if (top > (out[id] || 0)) out = { ...out, [id]: top };
  }
  return out;
}
// After the badge sheet is viewed: the stored record with that badge marked seen (the same object when it was not new)
export function viewed(stored, got, id) {
  if (!stored || !Object.hasOwn(BY_ID, id)) return stored;
  const seen = seenUpTo(stored.seen, got, [id]);
  return seen === stored.seen ? stored : { ...stored, seen };
}
// The finish a step is drawn in (a one-shot is Gold)
export const finishOf = (id, thr) => (isLadder(id) ? BY_ID[id].steps.indexOf(thr) : ONE_SHOT_FINISH);
// What to tell about new steps ([[id, thr, day], ...]): the distinct badges in catalog order, and for a single badge the finish it reached
export function unlockSummary(news) {
  const top = {};
  for (const [id, thr] of news || []) if (Object.hasOwn(BY_ID, id)) top[id] = Math.max(top[id] || 0, thr);
  const ids = CATALOG.map((b) => b.id).filter((id) => Object.hasOwn(top, id));
  return { ids, one: ids.length === 1 ? { id: ids[0], step: finishOf(ids[0], top[ids[0]]) } : null };
}
// The new steps the person has not seen already (the sheet may have been opened before the step was stored)
export const unseenAdded = (news, seen) => (news || []).filter(([id, thr]) => thr > ((seen && Object.hasOwn(seen, id) && seen[id]) || 0));
// A one-slot cache: compute(...args) again only when an element of `key` changed (compared with ===)
export function keyedCache(compute) {
  let last = null;
  let value;
  return (key, ...args) => {
    if (last && last.length === key.length && key.every((x, i) => x === last[i])) return value;
    value = compute(...args);
    last = key;
    return value;
  };
}

// One evaluation of the log against what is stored (`prev`, or null on the first run). Pure: the caller writes `next` when `changed`.
// `base` (the weights the progress badges are measured from) is frozen at the first evaluation that has something logged and is never
// replaced after that, so moving the goals later cannot earn halfway or goal. Nothing is stored while the log is empty.
// backfill ({from: earned set before}, or null): taking in a history, not earning anything new. Everything earned is marked seen, `told` is set,
// and `intro` counts the badges that were not in `from` (for the one "from your history" line).
export function settle(prev, S, today, { backfill = null } = {}) {
  const cur = prev || freshBadges();
  let base = cur.base;
  if (!base && (S.entries.length || Object.keys(S.days).length)) {
    const { startKg, targetKg } = S.settings;
    if ([startKg, targetKg].every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 30 && x <= 300)) base = { startKg, targetKg };
  }
  const got = evaluate(S, today, { got: cur.got, base: base || undefined });
  const news = added(cur.got, got);
  const seen = backfill ? seenUpTo(cur.seen, got) : cur.seen;
  const changed = news.length > 0 || (!cur.base && !!base) || seen !== cur.seen || (!!backfill && !!prev && !prev.told);
  const intro = backfill ? Object.keys(got).filter((id) => !(backfill.from && Object.hasOwn(backfill.from, id))).length : 0;
  return { next: changed ? { ...cur, got, base, seen, told: true } : prev, added: news, changed, ...(backfill ? { intro } : {}) };
}

// ——— What the collection screen shows ———
// ctx for the screens: the stored earned set, plus whatever the log earns now (union only), and the counts to measure progress by.
// `stored` is S.badges (or null); the weights it froze are used, and the settings until it has any.
export function context(S, today, stored) {
  const base = (stored && stored.base) || { startKg: S.settings.startKg, targetKg: S.settings.targetKg };
  const { got, cur } = tally(S, today, base);
  return { got: merge(stored && stored.got, got), cur, base };
}
// The same, measured once per state: `key` is what the result depends on (see views.js), compared with ===
export const cachedContext = keyedCache(context);

// The steps to list for a badge: those it can reach, and any already earned
export function shownSteps(id, ctx = {}) {
  const have = (ctx.got && ctx.got[id]) || {};
  const can = stepsOf(id, ctx.base);
  return BY_ID[id].steps.filter((x) => can.includes(x) || Object.hasOwn(have, x));
}

// One badge as the grid and the sheet need it. step is the finish to draw (the highest step earned; a one-shot is Gold); day is when that step was earned.
export function cellOf(id, ctx = {}) {
  const b = BY_ID[id];
  const have = (ctx.got && ctx.got[id]) || {};
  const reached = b.steps.filter((x) => Object.hasOwn(have, x));
  const top = reached.length ? reached[reached.length - 1] : null;
  const ladder = isLadder(id);
  const prog = progress(id, ctx);
  if (top !== null && prog && prog.cur < top) prog.cur = top; // earned stays earned: the count never reads below the step already won
  return {
    id, group: b.group, ladder,
    state: top === null ? 'locked' : 'earned',
    step: top === null ? 0 : ladder ? b.steps.indexOf(top) : ONE_SHOT_FINISH,
    earned: reached.length,
    total: shownSteps(id, ctx).length,
    day: top === null ? '' : have[top],
    isNew: top !== null && !!ctx.seen && isNew(id, ctx.got, ctx.seen),
    cur: Math.max((ctx.cur && ctx.cur[id]) || 0, top || 0),
    prog,
  };
}

// The grid: the cells by group in catalog order, and how many badges have at least one step
export function collection(ctx = {}) {
  const groups = GROUPS.map((group) => ({ group, cells: CATALOG.filter((b) => b.group === group).map((b) => cellOf(b.id, ctx)) }));
  const all = groups.flatMap((g) => g.cells);
  return { groups, earned: all.filter((c) => c.state === 'earned').length, total: all.length };
}

// The rows of a ladder's step list: each threshold with the finish it earns, the day it was earned (state earned or locked), and which one comes next
export function stepRows(id, ctx = {}) {
  if (!isLadder(id)) return [];
  const have = (ctx.got && ctx.got[id]) || {};
  let next = true;
  return shownSteps(id, ctx).map((n) => {
    const day = Object.hasOwn(have, n) ? have[n] : '';
    const row = { n, step: BY_ID[id].steps.indexOf(n), day, state: day ? 'earned' : 'locked', next: !day && next };
    if (!day) next = false;
    return row;
  });
}

// Runs async functions one after another, each starting when the one before has settled (a failure does not stop the chain).
// Every write to the stored badges goes through one, and works from the latest state inside its turn, so no write is based on an older copy.
export function serial() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}
