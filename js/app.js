import * as db from './db.js';
import { buildSql, exportName } from './export.js';
import * as picture from './picture.js';
import { readMeta, placeLabel } from './exif.js';
import { analyze, review, check, CHECK_EDGE, shrink, costUSD, probeVision, listModels, AI_ERRORS, errorDetail, STRONG_MODEL, PRESETS, ZEN_FREE } from './ai.js';
import {
  MEALS, MEAL_BY_ID, SLOTS, SLOT_NAME, FLEX, DEFAULTS, LOCALE,
  slotByTime, dayKey, parseDay, addDays, diffDays, targetAt,
} from './plan.js';
import { renderToday, renderLog, renderCheck, renderProgress, renderPlan, renderSettings, renderEntrySheet, renderNumSheet, renderSlotSheet, renderPlanSheet, renderFrameSheet, attachChart } from './views.js';

export const APP_VERSION = '17'; // bump together with VERSION in sw.js
const SCHEMA_VERSION = 2; // 1 = original Turkish ids, 2 = English ids

// ——— State ———
export const S = {
  tab: 'today',
  settings: {
    ...DEFAULTS, schema: SCHEMA_VERSION,
    provider: 'openai', oaBase: 'https://generativelanguage.googleapis.com/v1beta/openai', oaModel: 'gemini-3.5-flash', oaKey: '', apiKey: '',
    useLocation: false, places: [], favorites: [], hideStart: false, autoReview: true,
    usage: { in: 0, out: 0, calls: 0, usd: 0 }, lastBackup: 0,
  },
  entries: [],
  days: {},
  viewDay: dayKey(new Date()),
  busy: new Set(),
  retry: new Map(), // status note shown while an analysis is retrying
  reviewing: new Set(), // days whose review is being written
  reviewErr: new Map(), // day → why the last review failed
  reviewOpen: new Map(), // day → whether its review is expanded, once the person has toggled it
  check: { photos: [], note: '', busy: false, status: '', err: '', openId: null }, // the check being put together; its photos live in memory only
  checks: [], // earlier verdicts, newest first, without photos
  urls: new Map(),
  persisted: null,
  storage: null,
  calPick: null,
  sheet: null, // open bottom sheet: {type:'settings'|'entry'|'num', ...}
  openSetting: '', // expanded section in Settings
};

const $ = (s, r = document) => r.querySelector(s);

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

// 'on' = on target, 'near' = close, 'over' = above, 'partial' = too little logged, 'none' = nothing logged
export function dayStatus(day) {
  const t = dayTotals(day);
  if (!t.n) return 'none';
  const target = dayTarget(day);
  const hasOff = mealsOf(day).some((e) => e.tier === 'off');
  if (t.kcal < target * 0.6) return 'partial';
  if (t.kcal <= target * 1.07 && t.kcal >= target * 0.75 && t.p >= S.settings.proteinMin && !hasOff) return 'on';
  if (t.kcal <= target * 1.15) return 'near';
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
    { id: 'kcal', name: 'Calories', done: t.n > 0 && t.kcal >= target * 0.75 && t.kcal <= target * 1.07 },
    { id: 'protein', name: 'Protein', done: t.p >= Math.min(s.proteinMin || s.protein, s.protein) },
    { id: 'steps', name: 'Steps', done: (dd.steps || 0) >= s.steps },
    { id: 'water', name: 'Water', done: (dd.water || 0) >= s.water },
  ];
}
export const isPerfect = (day) => dayGoals(day).every((g) => g.done);

// Whole kilos lost since the start, by the 7-day average
export function kilosDown(day = today()) {
  const a = avg7(day);
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
  const cur = avg7(today()) || avg7(w[w.length - 1].day);
  if (!cur) return null;
  const out = { slope, perWeek: slope * 7 };
  if (slope < -0.005) {
    const daysLeft = Math.ceil((cur.kg - S.settings.targetKg) / -slope);
    out.eta = daysLeft > 0 && daysLeft < 730 ? addDays(today(), daysLeft) : null;
    if (daysLeft <= 0) out.eta = today();
  }
  return out;
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
      if ((e.flags || []).includes('alcohol') || eff(e).kcal <= 250) r.small += 1;
      else r.meal += 1;
    }
  }
  return r;
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

export function suggest(day) {
  const tot = dayTotals(day);
  const rem = dayTarget(day) - tot.kcal;
  const remP = S.settings.protein - tot.p;
  const logged = new Set(mealsOf(day).map((e) => e.slot));
  const open = SLOTS.filter((s) => s.id !== 'late' && !logged.has(s.id));
  if (!open.length) {
    if (remP > 12 && rem >= 90) return { rem, remP, meal: MEAL_BY_ID['N-A'], slot: SLOTS[4], extra: true };
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
  const proteinGap = Math.max(0, Math.round(Math.min(s.proteinMin || s.protein, s.protein) - t.p));
  const off = mealsOf(day).filter((e) => e.tier === 'off').length;
  let level;
  if (delta > target * 0.15) level = 'back';
  else if (delta > target * 0.07) level = 'over';
  else if (live) level = 'open';
  else if (t.kcal < target * 0.6) level = 'thin';
  else if (t.kcal < target * 0.75) level = 'under';
  else level = proteinGap || off ? 'near' : 'on';
  const rate = planRate();
  return { level, live, target, kcal: t.kcal, delta, kg: delta / KCAL_PER_KG, share: rate.kcal > 0 ? delta / rate.kcal : 0, proteinGap, off };
}
export const VERDICT = {
  open: 'In progress', thin: 'Too little logged', on: 'In line', near: 'Mostly in line',
  under: 'Under target', over: 'Slightly over', back: 'Set you back',
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
    out.push(`${kcal} kcal over target${kg}${cost}.`);
  } else if (v.delta < -25) out.push(`${kcal} kcal under target${v.level === 'under' ? '; check that everything is logged' : ''}.`);
  else out.push('On target.');
  if (judged && v.proteinGap > 0) out.push(`Protein ${v.proteinGap} g short.`);
  if (v.off) out.push(`${v.off} off-plan ${v.off === 1 ? 'entry' : 'entries'}.`);
  return out;
}

// A review belongs to the log it was written for: it goes stale when the day's meals change, or when it was written before the day ended
export const reviewSig = (day) => `${dayTarget(day)}|${mealsOf(day).map((e) => `${e.id}:${Math.round(eff(e).kcal)}`).sort().join(',')}`;
export function reviewState(day) {
  const r = S.days[day] && S.days[day].review;
  if (!r) return 'none';
  return r.sig !== reviewSig(day) || (r.live && day !== today()) ? 'stale' : 'fresh';
}

// ——— Formatting ———
export const fmtKg = (kg) => kg.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtInt = (n) => Math.round(n).toLocaleString(LOCALE);

// ——— Storage ———
async function saveSettings() { await db.kvSet('settings', S.settings); }
async function saveDay(day, patch) {
  const d = { ...(S.days[day] || { day }), ...patch };
  S.days[day] = d;
  await db.put('days', d);
}
async function saveEntry(e) {
  const i = S.entries.findIndex((x) => x.id === e.id);
  if (i >= 0) S.entries[i] = e; else S.entries.push(e);
  await db.put('entries', e);
}

let toastTimer;
export function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = '';
  const sp = document.createElement('span');
  sp.textContent = msg;
  el.append(sp);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.onclick = () => { el.hidden = true; action.fn(); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3200);
}

function timestampFor(day, slotId) {
  if (day === today()) return Date.now();
  const sl = SLOTS.find((s) => s.id === slotId);
  const [h, m] = (sl ? sl.time : '12:00').split(':').map(Number);
  const d = parseDay(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

async function logMeal(tpl, src, day = S.viewDay) {
  const ts = timestampFor(day, tpl.slot);
  const e = {
    id: db.uid(), ts, day, createdAt: Date.now(), kind: 'meal', status: 'ok', src,
    slot: tpl.slot && tpl.slot !== 'any' ? tpl.slot : slotByTime(new Date(ts)),
    planId: src === 'plan' ? tpl.id : '', title: tpl.name,
    items: (tpl.items || []).map((i) => ({ n: i.n, g: i.g, kcal: i.kcal, p: i.p })),
    kcal: tpl.kcal, p: tpl.p, c: tpl.c, f: tpl.f, fib: tpl.fib,
    tier: tpl.tier || 'plan', flags: tpl.flags || [], conf: tpl.conf || 1, q: '', mult: 1,
    photoIds: [], timeSrc: day === today() ? 'now' : 'manual', place: null,
  };
  await saveEntry(e);
  render();
  toast(`${tpl.name} logged`, { label: 'Undo', fn: () => removeEntry(e.id, true) });
}

async function removeEntry(id, silent) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return;
  S.entries = S.entries.filter((x) => x.id !== id);
  if (S.sheet && S.sheet.type === 'entry' && S.sheet.id === id) closeSheet();
  await db.del('entries', id);
  for (const pid of e.photoIds || []) {
    await db.del('photos', pid);
    const u = S.urls.get(pid);
    if (u) { URL.revokeObjectURL(u); S.urls.delete(pid); }
  }
  if (e.kind === 'weight' && S.days[e.day] && S.days[e.day].kg === e.kg) await saveDay(e.day, { kg: null });
  if (e.kind === 'steps' && S.days[e.day] && S.days[e.day].steps === e.steps) await saveDay(e.day, { steps: null });
  render();
  if (!silent) toast('Entry deleted');
}

async function noteEntry(kind, title, extra, day = today()) {
  const e = { id: db.uid(), ts: Date.now(), day, createdAt: Date.now(), kind, status: 'ok', src: 'text', title, photoIds: [], timeSrc: 'now', ...extra };
  await saveEntry(e);
  return e;
}

const weightTitle = (kg) => `Weight ${fmtKg(kg)} kg`;
const stepsTitle = (steps) => `${fmtInt(steps)} steps`;

async function setWeight(kg, day = today(), viaLog = true) {
  await saveDay(day, { kg });
  if (viaLog) await noteEntry('weight', weightTitle(kg), { kg }, day);
  render();
  toast(`${weightTitle(kg)} saved`);
}
async function setSteps(steps, day = today(), viaLog = true) {
  await saveDay(day, { steps });
  if (viaLog) await noteEntry('steps', stepsTitle(steps), { steps }, day);
  render();
  toast(`${stepsTitle(steps)} saved`);
}

// Text that can be resolved on the device, without spending tokens
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
export function parseLocal(text) {
  const t = norm(text);
  let m = /^(?:weight|kg)?\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg)?$/.exec(t);
  if (m) {
    const kg = parseFloat(m[1].replace(',', '.'));
    if (kg >= 50 && kg <= 160) return { type: 'weight', kg: Math.round(kg * 10) / 10 };
  }
  m = /^(\d{1,2}[.,\s]?\d{3}|\d{3,5})\s*steps?$/.exec(t);
  if (m) return { type: 'steps', steps: parseInt(m[1].replace(/[.,\s]/g, ''), 10) };
  m = /^water\s*(\d+(?:[.,]\d+)?)\s*(ml|l|litres?|liters?|glass(?:es)?)?$/.exec(t);
  if (m) {
    const v = parseFloat(m[1].replace(',', '.'));
    const unit = m[2] || (v <= 10 ? 'glass' : 'ml');
    const ml = unit === 'ml' ? v : unit.startsWith('glass') ? v * 250 : v * 1000;
    return { type: 'water', ml: Math.round(ml) };
  }
  if (/^(workout|training|spinning|kettlebell|gym)( day| done)?$/.test(t)) return { type: 'train' };
  const meal = MEALS.find((x) => norm(x.id) === t || norm(x.name) === t);
  if (meal) return { type: 'plan', meal };
  const flex = FLEX.find((x) => norm(x.name) === t);
  if (flex) return { type: 'flex', flex };
  const favorite = (S.settings.favorites || []).find((x) => norm(x.name) === t);
  if (favorite) return { type: 'favorite', favorite };
  return null;
}

async function submitText(text) {
  const local = parseLocal(text);
  if (local) {
    if (local.type === 'weight') return setWeight(local.kg);
    if (local.type === 'steps') return setSteps(local.steps);
    if (local.type === 'water') {
      const cur = (S.days[today()] && S.days[today()].water) || 0;
      await saveDay(today(), { water: cur + local.ml });
      render();
      return toast(`${local.ml} ml of water added`);
    }
    if (local.type === 'train') { await saveDay(today(), { train: true }); render(); return toast(`Today is a workout day: target ${fmtInt(S.settings.kcalTrain)} kcal`); }
    if (local.type === 'plan') return logMeal(local.meal, 'plan', today());
    if (local.type === 'flex') return logMeal({ ...local.flex, slot: 'any', tier: 'flex' }, 'flex', today());
    if (local.type === 'favorite') return logMeal({ ...local.favorite, slot: 'any' }, 'favorite', today());
  }
  const now = new Date();
  const e = {
    id: db.uid(), ts: now.getTime(), day: dayKey(now), createdAt: now.getTime(), kind: 'meal', status: 'pending',
    src: 'text', text, title: text, slot: slotByTime(now), items: [], kcal: 0, p: 0, c: 0, f: 0, fib: 0,
    tier: 'plan', flags: [], conf: 0, q: '', mult: 1, photoIds: [], timeSrc: 'now', place: null,
  };
  await saveEntry(e);
  go('log');
  queueAnalyze(e.id);
}

let posCache = null;
function getPos() {
  if (!S.settings.useLocation || !navigator.geolocation) return Promise.resolve(null);
  if (posCache && Date.now() - posCache.at < 300000) return Promise.resolve(posCache);
  return new Promise((res) => {
    const t = setTimeout(() => res(null), 6000);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); posCache = { lat: p.coords.latitude, lon: p.coords.longitude, at: Date.now() }; res(posCache); },
      () => { clearTimeout(t); res(null); },
      { enableHighAccuracy: false, timeout: 5000, maximumAge: 300000 },
    );
  });
}

async function submitPhotos(files, note) {
  const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!list.length) return;
  go('log');
  toast(list.length > 1 ? `Preparing ${list.length} photos` : 'Preparing photo');
  const prepared = [];
  for (const f of list) {
    try {
      const meta = await readMeta(f);
      const small = await shrink(f);
      let ts = meta.ts;
      let timeSrc = 'exif';
      if (!ts) {
        const lm = f.lastModified || 0;
        if (lm && Date.now() - lm > 120000 && lm > Date.parse('2020-01-01')) { ts = lm; timeSrc = 'file'; } else { ts = Date.now(); timeSrc = 'now'; }
      }
      if (ts > Date.now() + 60000) { ts = Date.now(); timeSrc = 'now'; }
      prepared.push({ small, ts, timeSrc, lat: meta.lat, lon: meta.lon });
    } catch (err) {
      toast(`Could not open a photo: ${f.name}`);
    }
  }
  if (!prepared.length) return;
  prepared.sort((a, b) => a.ts - b.ts);
  // Frames of the same meal (within 3 minutes, time read from the photo) become one entry.
  const groups = [];
  for (const p of prepared) {
    const g = groups[groups.length - 1];
    if (g && p.timeSrc === 'exif' && g[0].timeSrc === 'exif' && p.ts - g[g.length - 1].ts <= 180000 && g.length < 3) g.push(p);
    else groups.push([p]);
  }
  for (const g of groups) {
    const first = g[0];
    let place = null;
    const withGps = g.find((p) => p.lat != null);
    if (S.settings.useLocation) {
      if (withGps) place = placeLabel(withGps.lat, withGps.lon, S.settings.places);
      else if (first.timeSrc === 'now') {
        const pos = await getPos();
        if (pos) place = placeLabel(pos.lat, pos.lon, S.settings.places);
      }
    }
    const photoIds = [];
    for (const p of g) {
      const pid = db.uid();
      await db.put('photos', { id: pid, buf: await p.small.blob.arrayBuffer(), type: 'image/jpeg', w: p.small.w, h: p.small.h });
      photoIds.push(pid);
    }
    const when = new Date(first.ts);
    const e = {
      id: db.uid(), ts: first.ts, day: dayKey(when), createdAt: Date.now(), kind: 'meal', status: 'pending',
      src: 'photo', text: note || '', title: 'Photo', slot: slotByTime(when), items: [], kcal: 0, p: 0, c: 0, f: 0, fib: 0,
      tier: 'plan', flags: [], conf: 0, q: '', mult: 1, photoIds, timeSrc: first.timeSrc, place,
    };
    await saveEntry(e);
    queueAnalyze(e.id);
  }
  render();
}

// ——— Analysis queue (requests go one at a time) ———
let chain = Promise.resolve();
function queueAnalyze(id, opts) {
  S.busy.add(id);
  render();
  chain = chain.then(() => analyzeEntry(id, opts)).catch(() => {});
  return chain;
}

// ——— The day's review, written by the model ———
// The day in plain lines: what the model gets to read. Text only, a few hundred tokens.
function reviewBrief(day) {
  const s = S.settings;
  const dd = S.days[day] || {};
  const t = dayTotals(day);
  const v = dayVerdict(day);
  const r = (x) => Math.round(x);
  const clock = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const date = (d) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(parseDay(d));
  const meals = mealsOf(day).sort((a, b) => a.ts - b.ts);
  const lines = [
    `Day: ${date(day)}, ${dd.train ? 'workout day' : 'rest day'}, ${v.live ? `still in progress, now ${clock(Date.now())}` : 'finished'}.`,
    `Targets: ${v.target} kcal, protein ${s.protein} g (at least ${Math.min(s.proteinMin || s.protein, s.protein)}), fibre ${s.fiber} g, ${s.steps} steps, water ${s.water / 1000} l.`,
    `Eaten: ${r(t.kcal)} kcal, protein ${r(t.p)} g, carbs ${r(t.c)} g, fat ${r(t.f)} g, fibre ${r(t.fib)} g.`,
    'Meals:',
  ];
  for (const e of meals) {
    const x = eff(e);
    const m = e.mult || 1;
    const kind = e.planId ? 'plan meal' : e.tier === 'off' ? 'off plan' : e.tier === 'flex' ? 'weekly flex' : 'fits the plan';
    const items = e.planId ? '' : (e.items || []).slice(0, 6).map((i) => `${i.n}${i.g ? ` ${r(i.g * m)} g` : ''} ${r((i.kcal || 0) * m)} kcal`).join('; ');
    lines.push(`- ${clock(e.ts)} ${(SLOT_NAME[e.slot] || '').toLowerCase()}: ${e.title}, ${r(x.kcal)} kcal, ${r(x.p)} g protein, ${kind}`
      + `${(e.flags || []).includes('alcohol') ? ', alcohol' : ''}${e.place ? `, ${e.place === 'out' ? 'eaten out' : `at ${e.place}`}` : ''}${items ? ` [${items}]` : ''}`);
  }
  const logged = new Set(meals.map((e) => e.slot));
  const open = SLOTS.filter((x) => x.id !== 'late' && !logged.has(x.id)).map((x) => x.name.toLowerCase());
  if (open.length) lines.push(`${v.live ? 'Not eaten yet' : 'Nothing logged for'}: ${open.join(', ')}.`);
  const waiting = S.entries.filter((e) => e.day === day && e.kind === 'meal' && e.status !== 'ok').length;
  if (waiting) lines.push(`${waiting} more ${waiting === 1 ? 'entry is' : 'entries are'} not analysed yet and not counted.`);
  lines.push(`Steps: ${dd.steps ? r(dd.steps) : 'not logged'}. Water: ${dd.water ? `${(dd.water / 1000).toFixed(1)} l` : 'not logged'}. Weigh-in: ${dd.kg ? `${dd.kg} kg` : 'none'}.`);
  const rate = planRate();
  let goal = `Goal: ${s.startKg} kg on ${s.startDate} to ${s.targetKg} kg on ${s.targetDate}, which needs about ${rate.kg.toFixed(2)} kg (${r(rate.kcal / 10) * 10} kcal) a day.`;
  const avg = avg7(day);
  if (day < s.startDate) goal += ' On this day the plan had not started yet.';
  else if (avg) {
    const sched = targetAt(day, s);
    const gap = avg.kg - sched;
    goal += ` Schedule for this day ${sched.toFixed(1)} kg; 7-day average ${avg.kg.toFixed(1)} kg, ${Math.abs(gap) < 0.15 ? 'on the schedule' : `${Math.abs(gap).toFixed(1)} kg ${gap > 0 ? 'above' : 'below'} the schedule`}.`;
  }
  lines.push(goal);
  const f = weekFlex(day);
  lines.push(`This week: beer or small dessert ${f.small} of 1, flexible dinner ${f.meal} of 1, off-plan entries ${f.off}.`);
  lines.push(`App verdict: ${VERDICT[v.level].toLowerCase()}. ${verdictText(v).join(' ')}`);
  return lines.join('\n');
}

function modelFailure(err, what = 'review') {
  const code = err && err.code;
  if (code === 'no_key') return `Add a model key in Settings to get a ${what}.`;
  if (code === 'no_vision') return 'This model does not accept photos. Pick a model with image support in Settings.';
  if (code === 'no_credit' || code === 'needs_billing') return `${code === 'no_credit' ? 'The provider says the account has no credit.' : 'The provider wants billing enabled before it answers.'} ${errorDetail(err, 120)}`.trim();
  if (code === 'bad_key') return 'The API key was rejected. Check it in Settings.';
  if (code === 'offline' || code === 'net') return 'No connection. Try again when you are online.';
  if (code === 'rate' || code === 'no_quota' || code === 'server') return `The provider is busy or the quota is used up. Try again a little later. ${errorDetail(err, 120)}`.trim();
  if (code === 'empty') return 'The model sent nothing usable. Try again.';
  return `The ${what} failed. ${errorDetail(err, 120)}`.trim();
}

async function runReview(day, auto) {
  try {
    const sig = reviewSig(day);
    const live = day === today();
    const { data, usage, model } = await review({ cfg: aiCfg(), brief: reviewBrief(day) });
    const u = S.settings.usage;
    u.in += usage.in; u.out += usage.out; u.calls += 1; u.usd += costUSD(model, usage);
    await saveSettings();
    // The day may have been wiped while the request was out
    if (dayTotals(day).n) await saveDay(day, { review: { ...data, ts: Date.now(), sig, live, model } });
    S.reviewErr.delete(day);
  } catch (err) {
    if (!auto) S.reviewErr.set(day, modelFailure(err)); // an automatic review that fails just leaves the button
  }
  S.reviewing.delete(day);
  render();
}
function queueReview(day, auto = false) {
  if (S.reviewing.has(day) || !dayVerdict(day)) return;
  S.reviewing.add(day);
  S.reviewErr.delete(day);
  render();
  chain = chain.then(() => runReview(day, auto)).catch(() => {});
}

// The last finished day is reviewed by itself, once: one small text request a day
const autoTried = new Set();
function autoReview() {
  if (S.settings.autoReview === false || !hasKey() || navigator.onLine === false) return;
  const t = today();
  for (let i = 1; i <= 3; i++) {
    const day = addDays(t, -i);
    const v = dayVerdict(day);
    if (!v) continue;
    if (autoTried.has(day)) return;
    const r = S.days[day] && S.days[day].review;
    const waiting = S.entries.some((e) => e.day === day && e.kind === 'meal' && e.status === 'pending');
    if (v.level !== 'thin' && !waiting && (!r || r.live)) { autoTried.add(day); queueReview(day, true); }
    return;
  }
}

// ——— Check before ordering or buying ———
const CHECK_PHOTOS = '__check'; // marks the photo picker as opened from the Check screen
const CHECK_MAX = 4; // photos per check
const CHECK_KEEP = 30; // verdicts kept
export const checkReady = () => !S.check.busy && (S.check.photos.length > 0 || S.check.note.trim().length > 2);

async function addCheckPhotos(files) {
  const room = CHECK_MAX - S.check.photos.length;
  for (const f of files.slice(0, room)) {
    try {
      const { blob } = await shrink(f, CHECK_EDGE);
      S.check.photos.push({ id: db.uid(), blob, url: URL.createObjectURL(blob) });
    } catch { toast('Could not open that photo'); }
  }
  if (files.length > room) toast(`A check takes up to ${CHECK_MAX} photos`);
  S.check.err = '';
  render();
}
function removeCheckPhoto(id) {
  const p = S.check.photos.find((x) => x.id === id);
  if (p) URL.revokeObjectURL(p.url);
  S.check.photos = S.check.photos.filter((x) => x.id !== id);
  render();
}

// What the model needs to judge a choice: where the day stands, the week's allowance, the goal, and the person's note
function checkBrief(note) {
  const s = S.settings;
  const t = today();
  const now = new Date();
  const tot = dayTotals(t);
  const target = dayTarget(t);
  const r = (x) => Math.round(x);
  const logged = new Set(mealsOf(t).map((e) => e.slot));
  const open = SLOTS.filter((x) => x.id !== 'late' && !logged.has(x.id)).map((x) => x.name.toLowerCase());
  const lines = [
    `Time ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} on ${new Intl.DateTimeFormat('en-GB', { weekday: 'long' }).format(now)}, a ${S.days[t] && S.days[t].train ? 'workout' : 'rest'} day.`,
    tot.n
      ? `Today so far: ${r(tot.kcal)} of ${target} kcal eaten, ${r(target - tot.kcal) >= 0 ? `${r(target - tot.kcal)} kcal left` : `${r(tot.kcal - target)} kcal over`}; protein ${r(tot.p)} of ${s.protein} g.${open.length ? ` Not eaten yet: ${open.join(', ')}.` : ' All meals of the day are logged.'}`
      : `Nothing eaten yet today: the whole ${target} kcal and ${s.protein} g of protein are open. The plan's meals: ${SLOTS.filter((x) => x.id !== 'late').map((x) => `${x.name.toLowerCase()} ${x.time}`).join(', ')}.`,
    `Daily targets: ${s.kcalRest} kcal on rest days, ${s.kcalTrain} on workout days, protein ${s.protein} g, fibre ${s.fiber} g.`,
  ];
  const f = weekFlex(t);
  lines.push(`This week: flexible dinner ${f.meal} of 1 used, beer or small dessert ${f.small} of 1 used, off-plan entries ${f.off}.`);
  const rate = planRate();
  let goal = `Goal: ${s.startKg} kg to ${s.targetKg} kg by ${s.targetDate}, about ${rate.kg.toFixed(2)} kg (${r(rate.kcal / 10) * 10} kcal) a day.`;
  const avg = avg7(t);
  if (avg && t >= s.startDate) {
    const gap = avg.kg - targetAt(t, s);
    goal += ` 7-day average ${avg.kg.toFixed(1)} kg, ${Math.abs(gap) < 0.15 ? 'on the schedule' : `${Math.abs(gap).toFixed(1)} kg ${gap > 0 ? 'above' : 'below'} the schedule`}.`;
  }
  lines.push(goal);
  lines.push(note ? `Note from the person: ${note}` : 'No note from the person.');
  return lines.join('\n');
}

function showCheckResult() {
  const el = document.getElementById('check-result');
  if (el) el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

async function runCheck() {
  const c = S.check;
  if (!checkReady()) return;
  if (!hasKey()) { c.err = modelFailure({ code: 'no_key' }, 'check'); return render(); }
  if (navigator.onLine === false) { c.err = modelFailure({ code: 'offline' }, 'check'); return render(); }
  const note = c.note.trim().slice(0, 300);
  const blobs = c.photos.map((p) => p.blob);
  c.busy = true; c.err = ''; c.status = '';
  render();
  try {
    const { data, usage, model } = await check({
      cfg: aiCfg(), blobs, brief: checkBrief(note),
      onRetry: (n, of, alt, why) => { c.status = alt ? `${why === 'server' ? 'Model busy' : 'Quota reached'}, trying ${alt}` : `Provider busy, retrying (${n}/${of})`; render(); },
    });
    const u = S.settings.usage;
    u.in += usage.in; u.out += usage.out; u.calls += 1; u.usd += costUSD(model, usage);
    await saveSettings();
    if (data.kind === 'none' || !data.options.length) {
      // Nothing to judge: the photos stay, so one more can be added
      c.err = data.answer || 'Nothing to judge was found. Try a closer or sharper photo.';
    } else {
      const rec = { id: db.uid(), ts: Date.now(), ...data, note, photos: blobs.length, model };
      S.checks = [rec, ...S.checks].slice(0, CHECK_KEEP);
      await db.kvSet('checks', S.checks);
      c.photos.forEach((p) => URL.revokeObjectURL(p.url));
      c.photos = []; c.note = ''; c.openId = rec.id;
    }
  } catch (err) {
    c.err = modelFailure(err, 'check');
  }
  c.busy = false; c.status = '';
  render();
  if (!c.err) showCheckResult();
}

async function removeCheck(id) {
  S.checks = S.checks.filter((x) => x.id !== id);
  if (S.check.openId === id) S.check.openId = null;
  await db.kvSet('checks', S.checks);
  render();
}

// "I am having this": the chosen option goes into today's log with the check's estimate
async function logCheckOption(id, i) {
  const rec = S.checks.find((x) => x.id === id);
  const o = rec && rec.options[i];
  if (!o) return;
  await logMeal({
    name: o.name, slot: 'any', kcal: o.kcal, p: o.p, c: o.c, f: o.f, fib: o.fib, tier: o.tier, conf: 0.5,
    items: [{ n: o.portion ? `${o.name} (${o.portion})` : o.name, g: 0, kcal: o.kcal, p: o.p }],
  }, 'check', today());
}

// ——— Pictures of the plan's meals: the person's own photos, kept apart from the log ———
let photoTarget = null; // the plan meal waiting for the photo picker, if any
async function storePlanPhoto(mealId, blob, w, h) {
  const old = (S.settings.planPhotos || {})[mealId];
  const id = db.uid();
  await db.put('photos', { id, buf: await blob.arrayBuffer(), type: 'image/jpeg', w, h, plan: mealId });
  S.settings.planPhotos = { ...(S.settings.planPhotos || {}), [mealId]: id };
  await saveSettings();
  if (old) { await db.del('photos', old); const u = S.urls.get(old); if (u) { URL.revokeObjectURL(u); S.urls.delete(old); } }
}
// Framing step: the photo is opened with the house treatment applied, the person centres the plate in the
// circle, and only that square is stored. The original never touches the database.
let frame = null; // { id, src, zoom, cx, cy }
const frameCanvas = () => document.getElementById('frame-canvas');
function paintFrame() {
  const c = frameCanvas();
  if (c && frame) picture.drawFrame(c, frame.src, frame.zoom, frame.cx, frame.cy);
}
function moveFrame(dxCss, dyCss) {
  const c = frameCanvas();
  if (!c || !frame) return;
  const { side } = picture.frameRect(frame.src, frame.zoom, frame.cx, frame.cy);
  const perCss = side / c.getBoundingClientRect().width; // source pixels per CSS pixel
  const half = side / 2;
  frame.cx = Math.min(frame.src.width - half, Math.max(half, frame.cx - dxCss * perCss));
  frame.cy = Math.min(frame.src.height - half, Math.max(half, frame.cy - dyCss * perCss));
  paintFrame();
}
function zoomFrame(z) {
  if (!frame) return;
  frame.zoom = Math.min(3, Math.max(1, z));
  moveFrame(0, 0); // keeps the centre inside the photo at the new zoom
  const r = document.getElementById('frame-zoom');
  if (r && Math.abs(Number(r.value) - frame.zoom) > 0.005) r.value = String(frame.zoom);
}
async function openFrame(mealId, file) {
  if (!MEAL_BY_ID[mealId]) return;
  let src;
  try { src = await picture.prepare(file); } catch (err) { return toast('Could not open that photo'); }
  frame = { id: mealId, src, zoom: 1, cx: src.width / 2, cy: src.height / 2 };
  openSheet(renderFrameSheet(mealId), { type: 'plan-frame', id: mealId });
  paintFrame();
  const c = frameCanvas();
  const pts = new Map();
  let pinch = 0;
  c.addEventListener('pointerdown', (ev) => { c.setPointerCapture(ev.pointerId); pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); pinch = 0; });
  c.addEventListener('pointermove', (ev) => {
    const p = pts.get(ev.pointerId);
    if (!p) return;
    if (pts.size === 1) moveFrame(ev.clientX - p.x, ev.clientY - p.y);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pts.size === 2) {
      const [a, b] = Array.from(pts.values());
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) zoomFrame(frame.zoom * (dist / pinch));
      pinch = dist;
    }
  });
  const end = (ev) => { pts.delete(ev.pointerId); pinch = 0; };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}
async function saveFrame() {
  if (!frame) return;
  const { id, src, zoom, cx, cy } = frame;
  try {
    await storePlanPhoto(id, await picture.render(src, zoom, cx, cy), picture.PICTURE_SIZE, picture.PICTURE_SIZE);
  } catch (err) {
    return toast('Could not save the picture');
  }
  frame = null;
  openSheet(renderPlanSheet(id), { type: 'plan', id });
  render();
  toast('Picture saved');
}
function cancelFrame() {
  const id = frame ? frame.id : S.sheet && S.sheet.id;
  frame = null;
  if (id) openSheet(renderPlanSheet(id), { type: 'plan', id }); else closeSheet();
  hydratePhotos();
}
async function removePlanPhoto(mealId) {
  const id = (S.settings.planPhotos || {})[mealId];
  if (!id) return;
  const { [mealId]: gone, ...rest } = S.settings.planPhotos;
  S.settings.planPhotos = rest;
  await saveSettings();
  await db.del('photos', id);
  const u = S.urls.get(id);
  if (u) { URL.revokeObjectURL(u); S.urls.delete(id); }
  render();
}

async function photoBlob(pid) {
  const p = await db.get('photos', pid);
  return p ? new Blob([p.buf], { type: p.type || 'image/jpeg' }) : null;
}

async function analyzeEntry(id, opts = {}) {
  const original = S.entries.find((x) => x.id === id);
  if (!original) { S.busy.delete(id); return; }
  const e = { ...original };
  try {
    const blobs = [];
    for (const pid of e.photoIds || []) { const b = await photoBlob(pid); if (b) blobs.push(b); }
    const cfg = aiCfg();
    if (opts.strong && cfg.provider === 'anthropic') cfg.model = STRONG_MODEL;
    const { data, usage, model: usedModel } = await analyze({
      cfg, blobs, text: e.text, when: new Date(e.ts), place: e.place, hint: opts.hint,
      onRetry: (n, of, alt, why) => { S.retry.set(id, alt ? `${why === 'server' ? 'Model busy' : 'Quota reached'}, trying ${alt}` : `Provider busy, retrying (${n}/${of})`); render(); },
    });
    const u = S.settings.usage;
    u.in += usage.in; u.out += usage.out; u.calls += 1; u.usd += costUSD(usedModel, usage);
    await saveSettings();
    e.model = usedModel;
    e.err = '';
    if (data.kind === 'weight' && data.kg >= 50 && data.kg <= 160) {
      const kg = Math.round(data.kg * 10) / 10;
      Object.assign(e, { kind: 'weight', status: 'ok', kg, title: weightTitle(kg) });
      await saveDay(e.day, { kg });
    } else if (data.kind === 'steps' && data.steps > 0) {
      const steps = Math.round(data.steps);
      Object.assign(e, { kind: 'steps', status: 'ok', steps, title: stepsTitle(steps) });
      await saveDay(e.day, { steps });
    } else if (data.kind === 'meal') {
      const plan = MEAL_BY_ID[data.plan];
      if (plan) {
        Object.assign(e, {
          planId: plan.id, title: plan.name, items: plan.items.map((i) => ({ n: i.n, g: i.g, kcal: i.kcal, p: i.p })),
          kcal: plan.kcal, p: plan.p, c: plan.c, f: plan.f, fib: plan.fib, tier: 'plan',
        });
        // A plan meal without a picture takes this photo as its own
        if (blobs[0] && !(S.settings.planPhotos || {})[plan.id]) {
          try {
            const src = await picture.prepare(blobs[0]);
            await storePlanPhoto(plan.id, await picture.render(src), picture.PICTURE_SIZE, picture.PICTURE_SIZE);
          } catch (err) { /* the picture is optional; the entry itself is fine */ }
        }
      } else {
        const items = Array.isArray(data.items) ? data.items.slice(0, 12).map((i) => ({ n: String(i.n || ''), g: +i.g || 0, kcal: +i.kcal || 0, p: +i.p || 0 })) : [];
        const sumKcal = items.reduce((a, i) => a + i.kcal, 0);
        Object.assign(e, {
          planId: '', title: String(data.title || e.text || 'Meal').slice(0, 80), items,
          // The item list is what explains the total, so the total is their sum whenever items carry calories
          kcal: Math.round(sumKcal || +data.kcal || 0), p: +data.p || items.reduce((a, i) => a + i.p, 0), edited: false,
          c: +data.c || 0, f: +data.f || 0, fib: +data.fib || 0,
          tier: ['plan', 'flex', 'off'].includes(data.tier) ? data.tier : 'plan',
        });
      }
      Object.assign(e, {
        kind: 'meal', status: 'ok',
        slot: SLOT_NAME[data.slot] ? data.slot : e.slot,
        flags: Array.isArray(data.flags) ? data.flags.map(String).slice(0, 4) : [],
        conf: Math.max(0, Math.min(1, +data.conf || 0)), q: String(data.q || '').slice(0, 160),
      });
    } else {
      Object.assign(e, { status: 'error', err: 'Nothing to log was found: no food, weight or step count.' });
    }
  } catch (err) {
    const code = err && err.code;
    const waiting = ['no_key', 'offline', 'net', 'no_credit', 'needs_billing', 'no_quota', 'no_vision', 'bad_model', 'bad_key', 'server', 'rate'].includes(code);
    const detail = ['bad_request', 'http', 'bad_model', 'server', 'rate', 'no_quota', 'no_credit', 'needs_billing'].includes(code) ? ' ' + errorDetail(err, 140) : '';
    Object.assign(e, { status: waiting ? 'pending' : 'error', err: (AI_ERRORS[code] || 'Analysis failed.') + detail });
  }
  S.busy.delete(id);
  S.retry.delete(id);
  if (S.entries.some((x) => x.id === id)) await saveEntry(e);
  render();
}

// ——— Migration from the original Turkish ids (schema 1) ———
const V1_SLOT = { sabah: 'morning', ogle: 'lunch', ara1: 'snack1', ara2: 'snack2', aksam: 'dinner', gece: 'late', ant: 'workout' };
const V1_TIER = { esnek: 'flex', yok: 'off' };
const V1_PLACE = { Ev: 'Home', Ofis: 'Office', 'dışarı': 'out' };
const V1_FLEX = { 'Bira 0,33 l': 'Beer 0.33 l', 'Bira 0,5 l': 'Beer 0.5 l' };

function migrateEntry(e) {
  const out = { ...e };
  if (V1_SLOT[out.slot]) out.slot = V1_SLOT[out.slot];
  if (V1_TIER[out.tier]) out.tier = V1_TIER[out.tier];
  if (V1_PLACE[out.place]) out.place = V1_PLACE[out.place];
  if (Array.isArray(out.flags)) out.flags = out.flags.map((f) => (f === 'alkol' ? 'alcohol' : f));
  if (out.src === 'fav') out.src = 'favorite';
  const plan = out.planId && MEAL_BY_ID[out.planId];
  if (plan) { out.title = plan.name; out.items = plan.items.map((i) => ({ n: i.n, g: i.g, kcal: i.kcal, p: i.p })); }
  if (V1_FLEX[out.title]) out.title = V1_FLEX[out.title];
  if (out.kind === 'weight' && out.kg) out.title = weightTitle(out.kg);
  if (out.kind === 'steps' && out.steps) out.title = stepsTitle(out.steps);
  if (out.title === 'Fotoğraf') out.title = 'Photo';
  if (out.status !== 'ok' && out.err) out.err = ''; // stale message in the old language
  return out;
}
function migrateSettings(st) {
  const out = { ...st };
  if (Array.isArray(out.favs)) {
    out.favorites = out.favs.map((f) => {
      const { ad, ...rest } = f;
      return { ...rest, name: V1_FLEX[f.name || ad] || f.name || ad, tier: V1_TIER[f.tier] || f.tier, flags: (f.flags || []).map((x) => (x === 'alkol' ? 'alcohol' : x)) };
    });
    delete out.favs;
  }
  if (Array.isArray(out.places)) out.places = out.places.map((p) => ({ ...p, name: V1_PLACE[p.name] || p.name }));
  out.schema = SCHEMA_VERSION;
  return out;
}

// ——— Backup ———
const b64FromBuf = (buf) => {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const bufFromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

// Hands a file to the share sheet where that is possible (Save to Files on iOS), otherwise downloads it.
// Returns false when the person cancelled.
async function deliverFile(name, content, type) {
  const blob = new Blob([content], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return true;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return false;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}

async function exportBackup(withPhotos) {
  const { apiKey, oaKey, ...settingsNoKeys } = S.settings;
  const data = { app: 'kantar', v: SCHEMA_VERSION, at: new Date().toISOString(), settings: settingsNoKeys, entries: S.entries, days: Object.values(S.days), checks: S.checks };
  // The plan's pictures always travel with the backup; photos of logged meals only when asked for
  const planIds = new Set(Object.values(S.settings.planPhotos || {}));
  const photos = (await db.all('photos')).filter((p) => withPhotos || planIds.has(p.id));
  if (photos.length) data.photos = photos.map((p) => ({ id: p.id, type: p.type, w: p.w, h: p.h, plan: p.plan, b64: b64FromBuf(p.buf) }));
  const done = await deliverFile(`kantar-backup-${today()}.json`, JSON.stringify(data), 'application/json');
  if (!done) return;
  S.settings.lastBackup = Date.now();
  await saveSettings();
  render();
  toast('Backup ready');
}

// For analysis elsewhere: a .sql file that builds the tables in any SQLite database
async function exportSql() {
  const { sql, counts } = buildSql({ settings: S.settings, entries: S.entries, days: Object.values(S.days), appVersion: APP_VERSION });
  const done = await deliverFile(exportName(), sql, 'text/plain');
  if (done) toast(`Exported ${counts.days} ${counts.days === 1 ? 'day' : 'days'} and ${counts.meals} ${counts.meals === 1 ? 'meal' : 'meals'}`);
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Could not read the file'); }
  if (!data || data.app !== 'kantar' || !Array.isArray(data.entries)) return toast('This is not a Kantar backup');
  await db.putMany('entries', data.entries.map(migrateEntry));
  await db.putMany('days', data.days || []);
  if (Array.isArray(data.photos)) await db.putMany('photos', data.photos.map((p) => ({ id: p.id, type: p.type, w: p.w, h: p.h, plan: p.plan, buf: bufFromB64(p.b64) })));
  if (data.settings) { S.settings = { ...S.settings, ...migrateSettings(data.settings), apiKey: S.settings.apiKey, oaKey: S.settings.oaKey }; await saveSettings(); }
  if (Array.isArray(data.checks)) {
    const have = new Set(S.checks.map((c) => c.id));
    await db.kvSet('checks', S.checks.concat(data.checks.filter((c) => c && c.id && !have.has(c.id))).sort((a, b) => b.ts - a.ts).slice(0, CHECK_KEEP));
  }
  await load();
  render();
  toast(`${data.entries.length} entries restored`);
}

// ——— Loading and rendering ———
async function load() {
  const stored = await db.kvGet('settings', null);
  S.entries = await db.all('entries');
  // Entries without stored settings can only come from a release that had not saved any yet, so they are checked too
  const needsMigration = stored ? (stored.schema || 1) < SCHEMA_VERSION : S.entries.length > 0;
  if (stored) {
    const st = needsMigration ? migrateSettings(stored) : stored;
    S.settings = { ...S.settings, ...st, usage: { ...S.settings.usage, ...(st.usage || {}) } };
    if (!stored.provider) S.settings.provider = stored.apiKey ? 'anthropic' : 'openai'; // settings saved before provider choice existed
  }
  if (needsMigration) {
    S.entries = S.entries.map(migrateEntry);
    await db.putMany('entries', S.entries);
    await saveSettings();
  }
  S.days = Object.fromEntries((await db.all('days')).map((d) => [d.day, d]));
  S.checks = await db.kvGet('checks', []);
}

async function refreshStorage() {
  try {
    if (navigator.storage && navigator.storage.persisted) S.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) S.storage = await navigator.storage.estimate();
  } catch { /* not supported */ }
}

export function go(tab) {
  S.tab = tab;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const v = $('#view');
  const y = window.scrollY;
  const fn = { today: renderToday, log: renderLog, check: renderCheck, progress: renderProgress, plan: renderPlan }[S.tab];
  const focusId = document.activeElement && v.contains(document.activeElement) ? document.activeElement.id : '';
  v.innerHTML = fn();
  v.dataset.view = S.tab;
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  // Whatever is typed is always logged to today, so the composer hides on past days
  const showComposer = S.tab === 'log' || (S.tab === 'today' && S.viewDay === today());
  $('#composer').hidden = !showComposer;
  document.body.classList.toggle('has-composer', showComposer);
  renderFavorites();
  hydratePhotos();
  if (S.tab === 'progress') attachChart(v);
  checkWins();
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
  window.scrollTo(0, y);
  if (S.sheet && S.sheet.type === 'plan') { $('#sheet-body').innerHTML = renderPlanSheet(S.sheet.id); hydratePhotos(); }
  if (S.sheet && S.sheet.type === 'entry') {
    const html = renderEntrySheet(S.sheet.id);
    if (html) { $('#sheet-body').innerHTML = html; hydratePhotos(); } else closeSheet();
  }
}

// ——— Small celebrations: a kilo milestone, a day with all five goals done ———
function celebrate() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 20; i++) {
    const p = document.createElement('i');
    p.className = 'c' + (i % 4);
    p.style.setProperty('--x', `${Math.round((Math.random() * 2 - 1) * 44)}vw`);
    p.style.setProperty('--r', `${Math.round(Math.random() * 720 - 360)}deg`);
    p.style.setProperty('--d', `${(Math.random() * 0.2).toFixed(2)}s`);
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 1900);
}
let winsBusy = false;
async function checkWins() {
  if (winsBusy) return;
  const t = today();
  const kilos = kilosDown(t);
  const perfect = isPerfect(t);
  const w = S.settings.wins;
  // First run with this feature: note where things stand without celebrating the past
  const next = w ? { ...w } : { kilos, perfect: perfect ? t : '' };
  let msg = '';
  if (w) {
    if (kilos > (w.kilos || 0)) { msg = kilos === 1 ? 'First kilo down' : `${kilos} kilos down`; next.kilos = kilos; }
    if (perfect && w.perfect !== t) { msg = msg || 'Perfect day: all five goals done'; next.perfect = t; }
    if (!msg) return;
  }
  winsBusy = true;
  S.settings.wins = next;
  try { await saveSettings(); } finally { winsBusy = false; }
  if (msg) { celebrate(); toast(msg); }
}

function renderFavorites() {
  const row = $('#favorites');
  const favorites = S.settings.favorites || [];
  const show = S.tab === 'log' && favorites.length > 0;
  row.hidden = !show;
  row.innerHTML = '';
  if (!show) return;
  const label = document.createElement('span');
  label.className = 'favorites-label';
  label.textContent = 'Favourites';
  row.append(label);
  for (const f of favorites) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.act = 'log-favorite';
    b.dataset.id = f.id;
    b.append(f.name + ' ');
    const sp = document.createElement('span');
    sp.textContent = String(Math.round(f.kcal));
    b.append(sp);
    row.append(b);
  }
}

async function hydratePhotos() {
  for (const img of document.querySelectorAll('img[data-photo]')) {
    const pid = img.dataset.photo;
    let url = S.urls.get(pid);
    if (!url) {
      const b = await photoBlob(pid);
      if (!b) continue;
      url = URL.createObjectURL(b);
      S.urls.set(pid, url);
    }
    img.src = url;
  }
}

let sheetOpener = null;
function openSheet(html, state, focusSel, keepFocus) {
  const wasHidden = $('#sheet').hidden;
  if (wasHidden) { sheetOpener = document.activeElement; $('#toast').hidden = true; }
  const body = $('#sheet-body');
  const keep = !wasHidden && S.sheet && S.sheet.type === state.type ? body.scrollTop : 0;
  S.sheet = state;
  body.innerHTML = html;
  body.dataset.type = state.type;
  $('#sheet').hidden = false;
  document.body.classList.add('sheet-open');
  body.scrollTop = keep;
  if (!keepFocus) {
    const f = focusSel ? body.querySelector(focusSel) : body.querySelector('h2');
    if (f) { if (!focusSel) f.tabIndex = -1; f.focus({ preventScroll: true }); if (focusSel && f.select) f.select(); }
  }
  hydratePhotos();
}
function closeSheet() {
  $('#sheet').hidden = true;
  S.sheet = null;
  frame = null; // a photo being framed is dropped with the sheet
  document.body.classList.remove('sheet-open');
  if (sheetOpener && document.contains(sheetOpener)) sheetOpener.focus({ preventScroll: true });
  sheetOpener = null;
}
async function openSettings(section) {
  if (section) S.openSetting = section;
  await refreshStorage();
  const wasOpen = !!(S.sheet && S.sheet.type === 'settings');
  openSheet(renderSettings(), { type: 'settings' }, null, wasOpen);
}

// ——— Actions ———
const ACT = {
  'tab': (el) => go(el.dataset.tab),
  'settings': (el) => openSettings(el && el.dataset.sec),
  'close-sheet': () => closeSheet(),
  'week-prev': () => { S.viewDay = addDays(S.viewDay, -7); render(); },
  'week-next': () => { const d = addDays(S.viewDay, 7); S.viewDay = d > today() ? today() : d; render(); },
  'day-today': () => { S.viewDay = today(); render(); },
  'log-plan': (el) => { if (S.sheet && S.sheet.type === 'slot') closeSheet(); return logMeal(MEAL_BY_ID[el.dataset.id], 'plan'); },
  'slot': (el) => openSheet(renderSlotSheet(el.dataset.slot, S.viewDay), { type: 'slot', slot: el.dataset.slot }),
  'slot-camera': () => { closeSheet(); photoTarget = null; $('#f-cam').click(); },
  'compose': () => { closeSheet(); const inp = $('#composer-input'); inp.focus(); },
  'log-flex': (el) => { const f = FLEX.find((x) => x.id === el.dataset.id); if (f) logMeal({ ...f, slot: 'any', tier: 'flex' }, 'flex', today()); },
  'log-favorite': (el) => { const f = (S.settings.favorites || []).find((x) => x.id === el.dataset.id); if (f) logMeal({ ...f, slot: 'any' }, 'favorite', today()); },
  'open-entry': (el) => {
    const html = renderEntrySheet(el.dataset.id);
    if (html) openSheet(html, { type: 'entry', id: el.dataset.id });
  },
  'num': (el) => {
    const kind = el.dataset.kind;
    openSheet(renderNumSheet(kind, S.viewDay), { type: 'num', kind }, '#num-in');
  },
  'num-clear': async (el) => {
    await saveDay(el.dataset.day, el.dataset.kind === 'kg' ? { kg: null } : { steps: null });
    closeSheet();
    render();
    toast(el.dataset.kind === 'kg' ? 'Weight removed' : 'Steps removed');
  },
  'hide-start': async () => { S.settings.hideStart = true; await saveSettings(); render(); },
  'camera': () => { photoTarget = null; $('#f-cam').click(); },
  'library': () => { photoTarget = null; $('#f-lib').click(); },
  // Plan: a meal's details, and its picture
  'plan-meal': (el) => openSheet(renderPlanSheet(el.dataset.id), { type: 'plan', id: el.dataset.id }),
  'check-cam': () => { photoTarget = CHECK_PHOTOS; $('#f-cam').click(); },
  'check-lib': () => { photoTarget = CHECK_PHOTOS; $('#f-lib').click(); },
  'check-photo-remove': (el) => removeCheckPhoto(el.dataset.id),
  'check-run': () => runCheck(),
  'check-open': (el) => { S.check.openId = el.dataset.id; render(); showCheckResult(); },
  'check-remove': (el) => removeCheck(el.dataset.id),
  'check-log': (el) => logCheckOption(el.dataset.id, Number(el.dataset.i)),
  'plan-photo-cam': (el) => { photoTarget = el.dataset.id; $('#f-cam').click(); },
  'plan-photo-lib': (el) => { photoTarget = el.dataset.id; $('#f-lib').click(); },
  'plan-photo-remove': (el) => removePlanPhoto(el.dataset.id),
  'frame-save': () => saveFrame(),
  'frame-cancel': () => cancelFrame(),
  'log-plan-today': (el) => { closeSheet(); return logMeal(MEAL_BY_ID[el.dataset.id], 'plan', today()); },
  'hint': (el) => {
    const inp = $('#composer-input');
    inp.value = el.dataset.fill;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  },
  'train': async (el) => { await saveDay(S.viewDay, { train: el.dataset.v === '1' }); render(); },
  'water': async (el) => {
    const day = S.viewDay;
    const cur = (S.days[day] && S.days[day].water) || 0;
    const next = Math.max(0, cur + Number(el.dataset.v));
    await saveDay(day, { water: next });
    render();
    if (next > cur) toast('A glass of water added', { label: 'Undo', fn: async () => { await saveDay(day, { water: cur }); render(); } });
  },
  'mult': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    if (e) { await saveEntry({ ...e, mult: Number(el.dataset.v) }); render(); }
  },
  'delete': (el) => removeEntry(el.dataset.id),
  'analyze': (el) => queueAnalyze(el.dataset.id),
  'analyze-all': () => { S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id)).forEach((e) => queueAnalyze(e.id)); },
  'reanalyze': (el) => queueAnalyze(el.dataset.id, { strong: true }),
  // The person tells the model what the photo does not show; the model revises its own item list
  'answer': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    const inp = document.getElementById('answer-' + el.dataset.id);
    const said = inp ? inp.value.trim() : '';
    if (!e || !said) return;
    const earlier = (e.items || []).map((i) => `${i.n} ${Math.round(i.g || 0)} g ${Math.round(i.kcal || 0)} kcal`).join('; ');
    // The correction is kept as part of the entry's note, so a later re-analysis still knows it
    await saveEntry({ ...e, text: [e.text, said].filter(Boolean).join('; ').slice(0, 400) });
    queueAnalyze(e.id, { hint: `${earlier ? `Your earlier estimate: ${earlier}.\n` : ''}${e.q ? `Your earlier question: ${e.q}\n` : ''}Correction from the person: ${said}\nRevise the estimate with this correction and keep the items it does not mention.` });
  },
  'favorite': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    if (!e) return;
    const favorites = S.settings.favorites || [];
    if (favorites.some((f) => f.name === e.title)) return toast('Already in favourites');
    const v = eff(e);
    favorites.push({ id: db.uid(), name: e.title, slot: 'any', kcal: Math.round(v.kcal), p: v.p, c: v.c, f: v.f, fib: v.fib, tier: e.tier, flags: e.flags || [], items: e.items || [] });
    S.settings.favorites = favorites;
    await saveSettings();
    render();
    toast('Added to favourites. One tap next time.');
  },
  'favorite-remove': async (el) => {
    S.settings.favorites = (S.settings.favorites || []).filter((f) => f.id !== el.dataset.id);
    await saveSettings();
    openSettings();
  },
  'save-edit': async (el) => {
    const id = el.dataset.id;
    const e = S.entries.find((x) => x.id === id);
    if (!e) return;
    const field = (k) => document.getElementById(`${k}-${id}`);
    const kcal = parseFloat(field('edit-kcal').value.replace(',', '.'));
    const p = parseFloat(field('edit-protein').value.replace(',', '.'));
    const slot = field('edit-slot').value;
    const time = field('edit-time').value;
    const next = { ...e, slot };
    if (kcal >= 0 && Math.round(kcal) !== Math.round(eff(e).kcal)) { next.kcal = Math.round(kcal / (e.mult || 1)); next.conf = 1; next.planId = ''; next.edited = true; }
    if (p >= 0) next.p = Math.round((p / (e.mult || 1)) * 10) / 10;
    if (/^\d{2}:\d{2}$/.test(time)) {
      const d = new Date(e.ts);
      d.setHours(+time.slice(0, 2), +time.slice(3, 5), 0, 0);
      if (d.getTime() !== e.ts) { next.ts = d.getTime(); next.timeSrc = 'manual'; }
    }
    await saveEntry(next);
    render();
    toast('Entry updated');
  },
  'cal': (el) => { S.calPick = S.calPick === el.dataset.day ? null : el.dataset.day; render(); },
  'goto-day': (el) => { if (el.dataset.day <= today()) { S.viewDay = el.dataset.day; go('today'); } },
  // Settings
  'save-key': async () => {
    if (S.settings.provider === 'openai') {
      S.settings.oaBase = $('#set-base').value.trim().replace(/\/+$/, '');
      S.settings.oaModel = $('#set-oamodel').value.trim();
      S.settings.oaKey = $('#set-oakey').value.trim();
    } else {
      S.settings.apiKey = $('#set-key').value.trim();
      S.settings.model = $('#set-model').value;
    }
    await saveSettings();
    toast(aiCfg().key ? 'Saved on this device' : 'Key removed');
    render();
    await openSettings();
    if (hasKey()) ACT['analyze-all']();
  },
  'test-key': async () => {
    await ACT['save-key']();
    const out = $('#key-test');
    if (!hasKey()) { out.textContent = S.settings.provider === 'openai' ? 'Address, model and key are all required.' : 'A key is required.'; return; }
    const cfg = aiCfg();
    const add = async (u) => { S.settings.usage.in += u.in; S.settings.usage.out += u.out; S.settings.usage.calls += 1; S.settings.usage.usd += costUSD(cfg.model, u); await saveSettings(); };
    // Always show what the provider said, so the cause can be checked
    const gemini = cfg.provider === 'openai' && /generativelanguage\.googleapis\.com/.test(cfg.base || '');
    const limitsHint = (err) => (gemini && ['rate', 'no_quota', 'no_credit', 'needs_billing'].includes(err.code) ? ' Your plan and limits: aistudio.google.com/rate-limit' : '');
    const said = (err) => { const d = errorDetail(err, 300); return !d ? '' : ['rate', 'no_quota'].includes(err.code) ? ` ${d}` : ` The provider said: “${d}”`; };
    const why = (err) => `${(AI_ERRORS[err.code] || 'Failed.').replace('; the entry is waiting', '').replace(' Tap “Analyse” a little later.', '')}${said(err)}${limitsHint(err)}`;
    out.textContent = 'Testing text…';
    let textLine;
    try {
      const r = await analyze({ cfg, text: '1 medium apple', when: new Date() });
      await add(r.usage);
      textLine = `Text works: “${r.data.title}”, ${Math.round(r.data.kcal)} kcal (${r.usage.in} input and ${r.usage.out} output tokens).`;
      if (r.model !== cfg.model) {
        // The chosen model was out of quota or busy and a fallback answered
        const from = cfg.model;
        const reason = why(r.fallbackFrom);
        cfg.model = r.model;
        if (r.fallbackFrom.code === 'no_quota') {
          S.settings.oaModel = r.model;
          await saveSettings();
          const inp = $('#set-oamodel');
          if (inp) inp.value = r.model;
          textLine = `${from}: ${reason}\nSwitched to ${r.model}. ${textLine}`;
        } else {
          textLine = `${from}: ${reason}\nFor now ${r.model} answers instead. ${textLine}`;
        }
      }
    } catch (err) {
      out.textContent = 'Text: ' + why(err);
      return;
    }
    out.textContent = textLine + ' Testing photo…';
    try {
      const v = await probeVision(cfg);
      await add(v.usage);
      out.textContent = textLine + (v.ok ? ' Photos work: the model read the number in the test image.' : ' Photos do not work: the model could not read the test image. Pick a model with image support.');
    } catch (err) {
      out.textContent = textLine + ' Photo: ' + why(err);
    }
  },
  'find-vision': async () => {
    await ACT['save-key']();
    const out = $('#key-test');
    if (!S.settings.oaBase || !S.settings.oaKey) { out.textContent = 'Enter the address and key first.'; return; }
    const base = { provider: 'openai', key: S.settings.oaKey, base: S.settings.oaBase };
    out.textContent = 'Fetching the model list…';
    let ids = await listModels(base);
    const zen = /opencode\.ai\/zen\/v1$/.test(S.settings.oaBase);
    if (zen) ids = ids.filter((id) => /free|big-pickle/i.test(id));
    if (!ids.length && zen) ids = ZEN_FREE.slice();
    if (S.settings.oaModel && !ids.includes(S.settings.oaModel)) ids.unshift(S.settings.oaModel);
    ids = ids.slice(0, 16);
    if (!ids.length) { out.textContent = 'Could not fetch the model list. Type a model name and tap “Save and test”.'; return; }
    const lines = [];
    let found = '';
    for (const id of ids) {
      out.textContent = lines.concat(`${id}: testing…`).join('\n');
      try {
        const v = await probeVision({ ...base, model: id });
        lines.push(`${id}: ${v.ok ? 'read the photo' : 'could not read the photo'}`);
        if (v.ok && !found) found = id;
      } catch (err) {
        lines.push(`${id}: ${(AI_ERRORS[err.code] || 'error').split('.')[0].toLowerCase()}`);
        if (err.code === 'net' || err.code === 'offline' || err.code === 'bad_key') break;
      }
    }
    if (found) {
      S.settings.oaModel = found;
      await saveSettings();
      const inp = $('#set-oamodel');
      if (inp) inp.value = found;
      lines.push(`Selected model: ${found}. Now tap “Save and test”.`);
    } else lines.push('No model that reads photos was found.');
    out.textContent = lines.join('\n');
    render();
  },
  'save-targets': async () => {
    const num = (id) => parseFloat($(id).value.replace(',', '.'));
    const patch = {
      startDate: $('#set-start').value, targetDate: $('#set-end').value,
      startKg: num('#set-startkg'), targetKg: num('#set-endkg'),
      kcalRest: Math.round(num('#set-rest')), kcalTrain: Math.round(num('#set-train')), protein: Math.round(num('#set-prot')),
    };
    if (!patch.startDate || !patch.targetDate || patch.targetDate <= patch.startDate || !(patch.startKg > patch.targetKg) || !(patch.kcalRest >= 1200) || !(patch.kcalTrain >= patch.kcalRest) || !(patch.protein > 50)) {
      return toast('Check the values: the end must be after the start, the target weight below the start weight, and calories at least 1,200');
    }
    S.settings = { ...S.settings, ...patch, proteinMin: Math.round(patch.protein * 0.89) };
    await saveSettings();
    render();
    toast('Targets saved');
  },
  'loc-toggle': async (el) => { S.settings.useLocation = el.checked; await saveSettings(); openSettings(); },
  'review-toggle': async (el) => { S.settings.autoReview = el.checked; await saveSettings(); },
  'review-day': (el) => {
    if (!hasKey()) return toast('Add a model key in Settings to get a review');
    if (navigator.onLine === false) return toast('No connection. Try again when you are online');
    queueReview(el.dataset.day);
  },
  'loc-save': async (el) => {
    const out = $('#loc-out');
    out.textContent = 'Getting your location…';
    posCache = null;
    const was = S.settings.useLocation;
    S.settings.useLocation = true;
    const pos = await getPos();
    S.settings.useLocation = was;
    if (!pos) { out.textContent = 'Could not get a location. Check that the browser has location permission.'; return; }
    const name = el.dataset.name;
    S.settings.places = (S.settings.places || []).filter((p) => p.name !== name).concat([{ name, lat: pos.lat, lon: pos.lon }]);
    await saveSettings();
    openSettings();
    toast(`This spot is saved as “${name}”`);
  },
  'export': () => exportBackup(false),
  'export-photos': () => exportBackup(true),
  'export-sql': () => exportSql(),
  'import': () => $('#set-import').click(),
  'persist': async () => {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* not supported */ }
    openSettings();
  },
  'check-update': async () => {
    const out = $('#update-out');
    if (!swReg) { out.textContent = 'Offline caching is off in this browser; reloading the page is enough.'; return; }
    out.textContent = 'Checking…';
    try {
      await swReg.update();
      // A new version installs itself and the page reloads on its own
      setTimeout(() => { if (document.contains(out)) out.textContent = swReg.installing || swReg.waiting ? 'Installing the new version…' : 'Up to date: this is the latest version.'; }, 1500);
    } catch {
      out.textContent = 'Could not check. Check your internet connection.';
    }
  },
  'hard-reload': async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch { /* not supported */ }
    location.reload();
  },
  'wipe': async () => {
    if (!window.confirm('All entries, their photos, weigh-ins and checks on this device will be deleted. Do you have a backup? Continue?')) return;
    const keep = new Set(Object.values(S.settings.planPhotos || {})); // the plan's own pictures stay
    await db.clear('entries'); await db.clear('days'); await db.kvSet('checks', []);
    for (const p of await db.all('photos')) if (!keep.has(p.id)) await db.del('photos', p.id);
    S.entries = []; S.days = {}; S.checks = []; S.check.openId = null;
    closeSheet();
    render();
    toast('All entries deleted');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act],.tabs [data-tab],[data-close-sheet]');
  if (!el) return;
  if (el.matches('input[type=checkbox]')) return; // handled on change
  if (el.dataset.closeSheet !== undefined) return closeSheet();
  const act = el.dataset.act || (el.dataset.tab ? 'tab' : '');
  if (ACT[act]) { ev.preventDefault(); ACT[act](el); }
});

// The zoom slider of the framing step
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'frame-zoom') zoomFrame(Number(ev.target.value));
  // What is typed for a check is kept in state, so a re-render does not lose it
  if (ev.target.id === 'check-note') {
    S.check.note = ev.target.value;
    const run = document.querySelector('[data-act="check-run"]');
    if (run) run.disabled = !checkReady();
  }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'f-cam' || el.id === 'f-lib') {
    const files = Array.from(el.files || []);
    el.value = '';
    // A photo asked for from the Plan screen becomes that meal's picture and is not logged
    const target = photoTarget;
    photoTarget = null;
    if (target === CHECK_PHOTOS) { if (files.length) addCheckPhotos(files); return; }
    if (target) { if (files.length) openFrame(target, files[0]); return; }
    const note = $('#composer-input').value.trim();
    if (files.length) { $('#composer-input').value = ''; submitPhotos(files, note); }
    return;
  }
  if (el.id === 'set-import') { if (el.files[0]) importBackup(el.files[0]); el.value = ''; return; }
  if (el.dataset.act === 'loc-toggle') return ACT['loc-toggle'](el);
  if (el.dataset.act === 'review-toggle') return ACT['review-toggle'](el);
  if (el.dataset.chg === 'provider') { S.settings.provider = el.value; await saveSettings(); render(); return openSettings(); }
  if (el.dataset.chg === 'preset') {
    const p = PRESETS.find((x) => x.id === el.value);
    if (p) { $('#set-base').value = p.base; $('#set-oamodel').value = p.model; }
  }
});

// Number sheet: saves a weigh-in or a step count
document.addEventListener('submit', (ev) => {
  const f = ev.target;
  if (f.id !== 'num-form') return;
  ev.preventDefault();
  const raw = $('#num-in').value.trim();
  const err = $('#num-err');
  const day = f.dataset.day;
  if (f.dataset.kind === 'kg') {
    const kg = parseFloat(raw.replace(',', '.'));
    if (!(kg >= 50 && kg <= 160)) { err.textContent = 'Enter a value between 50 and 160 kg. Example: 85.4'; err.hidden = false; return; }
    closeSheet();
    setWeight(Math.round(kg * 10) / 10, day, false);
  } else {
    const steps = parseInt(raw.replace(/\D/g, ''), 10);
    if (!(steps >= 0 && steps <= 100000)) { err.textContent = 'Enter the step count in digits. Example: 8200'; err.hidden = false; return; }
    closeSheet();
    setSteps(steps, day, false);
  }
});

// Expanded sections survive re-renders (toggle does not bubble, so listen in the capture phase)
document.addEventListener('toggle', (ev) => {
  const d = ev.target;
  if (!d.matches) return;
  if (d.matches('details.setting')) {
    if (d.open) {
      S.openSetting = d.dataset.sec;
      document.querySelectorAll('details.setting[open]').forEach((o) => { if (o !== d) o.open = false; });
    } else if (S.openSetting === d.dataset.sec) S.openSetting = '';
  }
  if (d.matches('details.review-ai')) S.reviewOpen.set(d.dataset.day, d.open);
}, true);

// Tapping an example chip must not take focus away from the composer input
document.addEventListener('pointerdown', (ev) => { if (ev.target.closest('[data-act="hint"]')) ev.preventDefault(); });

$('#btn-cam').addEventListener('click', () => { photoTarget = null; $('#f-cam').click(); });
$('#btn-lib').addEventListener('click', () => { photoTarget = null; $('#f-lib').click(); });
$('#composer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inp = $('#composer-input');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  submitText(t);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  // Enter in the correction box sends it
  if (ev.key === 'Enter' && ev.target.id === 'check-note') { ev.preventDefault(); ev.target.blur(); runCheck(); }
  if (ev.key === 'Enter' && ev.target.id && ev.target.id.startsWith('answer-')) {
    ev.preventDefault();
    ACT.answer({ dataset: { id: ev.target.id.slice(7) } });
  }
});

// If the app stayed open past midnight, move on to the new day
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = today();
  if (lastToday !== t && S.viewDay === lastToday) S.viewDay = t;
  lastToday = t;
  render();
  autoReview();
});

// ——— Updates ———
// When a new service worker takes control the page is still running old files, so it reloads.
let swReg = null;
function safeToReload() {
  return $('#sheet').hidden && !$('#composer-input').value && !S.busy.size && !(document.activeElement && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName));
}
function setupUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // no reload needed on first install
    if (safeToReload()) { reloading = true; location.reload(); } else toast('A new version is ready', { label: 'Reload', fn: () => location.reload() });
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => { swReg = reg; }).catch(() => {});
  // A Home Screen app that was waiting in the background also checks when it comes forward
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && swReg) swReg.update().catch(() => {}); });
}

(async function start() {
  try {
    await load();
  } catch (err) {
    $('#view').innerHTML = '<div class="empty"><h1>Could not open the database</h1><p>Local storage may be off in private browsing. Open the app in a normal window or add it to the Home Screen.</p></div>';
    return;
  }
  render();
  refreshStorage();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then((p) => { S.persisted = p; }); } catch { /* not supported */ }
  setupUpdates();
  // Unfinished analyses resume when there is a key and a connection
  if (hasKey() && navigator.onLine) S.entries.filter((e) => e.status === 'pending').forEach((e) => queueAnalyze(e.id));
  autoReview();
})();

// For tests and debugging
if (location.hostname === 'localhost') window.__kantar = { S, parseLocal, render, submitPhotos, migrateEntry, migrateSettings, dayVerdict, verdictText, reviewBrief, autoReview, checkBrief };

// Keep the composer above the on-screen keyboard
if (window.visualViewport) {
  const vv = window.visualViewport;
  const onViewport = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kb-open', kb > 120);
  };
  vv.addEventListener('resize', onViewport);
  vv.addEventListener('scroll', onViewport);
}
