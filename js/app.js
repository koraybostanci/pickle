import * as db from './db.js';
import { readMeta, placeLabel } from './exif.js';
import { analyze, shrink, costUSD, probeVision, listModels, AI_ERRORS, STRONG_MODEL, PRESETS, ZEN_FREE } from './ai.js';
import {
  MEALS, MEAL_BY_ID, SLOTS, SLOT_NAME, FLEX, DEFAULTS, LOCALE,
  slotByTime, dayKey, parseDay, addDays, diffDays,
} from './plan.js';
import { renderToday, renderLog, renderProgress, renderPlan, renderSettings, renderEntrySheet, renderNumSheet, attachChart } from './views.js';

export const APP_VERSION = '8'; // bump together with VERSION in sw.js
const SCHEMA_VERSION = 2; // 1 = original Turkish ids, 2 = English ids

// ——— State ———
export const S = {
  tab: 'today',
  settings: {
    ...DEFAULTS, schema: SCHEMA_VERSION,
    provider: 'openai', oaBase: 'https://generativelanguage.googleapis.com/v1beta/openai', oaModel: 'gemini-3.5-flash', oaKey: '', apiKey: '',
    useLocation: false, places: [], favorites: [], hideStart: false,
    usage: { in: 0, out: 0, calls: 0, usd: 0 }, lastBackup: 0,
  },
  entries: [],
  days: {},
  viewDay: dayKey(new Date()),
  busy: new Set(),
  retry: new Map(), // status note shown while an analysis is retrying
  urls: new Map(),
  persisted: null,
  storage: null,
  calPick: null,
  sheet: null, // open bottom sheet: {type:'settings'|'entry'|'num', ...}
  openSlots: new Set(), // meal options left expanded on Today
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
    tier: tpl.tier || 'plan', flags: tpl.flags || [], conf: 1, q: '', mult: 1,
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
      onRetry: (n, of, alt) => { S.retry.set(id, alt ? `Model busy, trying ${alt}` : `Provider busy, retrying (${n}/${of})`); render(); },
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
      } else {
        const items = Array.isArray(data.items) ? data.items.slice(0, 12).map((i) => ({ n: String(i.n || ''), g: +i.g || 0, kcal: +i.kcal || 0, p: +i.p || 0 })) : [];
        const sumKcal = items.reduce((a, i) => a + i.kcal, 0);
        Object.assign(e, {
          planId: '', title: String(data.title || e.text || 'Meal').slice(0, 80), items,
          kcal: Math.round(+data.kcal || sumKcal), p: +data.p || items.reduce((a, i) => a + i.p, 0),
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
    const waiting = ['no_key', 'offline', 'net', 'no_credit', 'no_vision', 'bad_model', 'bad_key', 'server', 'rate'].includes(code);
    const detail = ['bad_request', 'http', 'bad_model', 'server'].includes(code) ? ' ' + String(err.message).slice(0, 140) : '';
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

async function exportBackup(withPhotos) {
  const { apiKey, oaKey, ...settingsNoKeys } = S.settings;
  const data = { app: 'kantar', v: SCHEMA_VERSION, at: new Date().toISOString(), settings: settingsNoKeys, entries: S.entries, days: Object.values(S.days) };
  if (withPhotos) data.photos = (await db.all('photos')).map((p) => ({ id: p.id, type: p.type, w: p.w, h: p.h, b64: b64FromBuf(p.buf) }));
  const name = `kantar-backup-${today()}.json`;
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  let shared = false;
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      shared = true;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return;
  }
  if (!shared) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  S.settings.lastBackup = Date.now();
  await saveSettings();
  render();
  toast('Backup ready');
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Could not read the file'); }
  if (!data || data.app !== 'kantar' || !Array.isArray(data.entries)) return toast('This is not a Kantar backup');
  await db.putMany('entries', data.entries.map(migrateEntry));
  await db.putMany('days', data.days || []);
  if (Array.isArray(data.photos)) await db.putMany('photos', data.photos.map((p) => ({ id: p.id, type: p.type, w: p.w, h: p.h, buf: bufFromB64(p.b64) })));
  if (data.settings) { S.settings = { ...S.settings, ...migrateSettings(data.settings), apiKey: S.settings.apiKey, oaKey: S.settings.oaKey }; await saveSettings(); }
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
  const fn = { today: renderToday, log: renderLog, progress: renderProgress, plan: renderPlan }[S.tab];
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
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
  window.scrollTo(0, y);
  if (S.sheet && S.sheet.type === 'entry') {
    const html = renderEntrySheet(S.sheet.id);
    if (html) { $('#sheet-body').innerHTML = html; hydratePhotos(); } else closeSheet();
  }
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
  'day-prev': () => { S.viewDay = addDays(S.viewDay, -1); render(); },
  'day-next': () => { if (S.viewDay < today()) { S.viewDay = addDays(S.viewDay, 1); render(); } },
  'day-today': () => { S.viewDay = today(); render(); },
  'log-plan': (el) => logMeal(MEAL_BY_ID[el.dataset.id], 'plan'),
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
  'camera': () => $('#f-cam').click(),
  'library': () => $('#f-lib').click(),
  'hint': (el) => {
    const inp = $('#composer-input');
    inp.value = el.dataset.fill;
    inp.focus();
    inp.setSelectionRange(inp.value.length, inp.value.length);
  },
  'train': async (el) => { await saveDay(S.viewDay, { train: el.dataset.v === '1' }); render(); },
  'water': async (el) => {
    const cur = (S.days[S.viewDay] && S.days[S.viewDay].water) || 0;
    await saveDay(S.viewDay, { water: Math.max(0, cur + Number(el.dataset.v)) });
    render();
  },
  'mult': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    if (e) { await saveEntry({ ...e, mult: Number(el.dataset.v) }); render(); }
  },
  'delete': (el) => removeEntry(el.dataset.id),
  'analyze': (el) => queueAnalyze(el.dataset.id),
  'analyze-all': () => { S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id)).forEach((e) => queueAnalyze(e.id)); },
  'reanalyze': (el) => queueAnalyze(el.dataset.id, { strong: true }),
  'answer': (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    const inp = document.getElementById('answer-' + el.dataset.id);
    if (!e || !inp || !inp.value.trim()) return;
    queueAnalyze(e.id, { hint: `Earlier question: ${e.q}\nAnswer: ${inp.value.trim()}` });
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
    if (kcal >= 0) { next.kcal = Math.round(kcal / (e.mult || 1)); next.conf = 1; next.planId = ''; }
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
  'goto-day': (el) => { S.viewDay = el.dataset.day; go('today'); },
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
    const why = (err) => (err.code === 'no_credit' ? 'The account has no credit; the key and the connection are fine.' : (AI_ERRORS[err.code] || 'Failed.').replace('; the entry is waiting', '') + ' ' + String(err.message || '').slice(0, 140));
    out.textContent = 'Testing text…';
    let textLine;
    try {
      const r = await analyze({ cfg, text: '1 medium apple', when: new Date() });
      await add(r.usage);
      textLine = `Text works: “${r.data.title}”, ${Math.round(r.data.kcal)} kcal (${r.usage.in} input and ${r.usage.out} output tokens).`;
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
    if (!window.confirm('All entries, photos and weigh-ins on this device will be deleted. Do you have a backup? Continue?')) return;
    await db.clear('entries'); await db.clear('photos'); await db.clear('days');
    S.entries = []; S.days = {};
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

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'f-cam' || el.id === 'f-lib') {
    const files = Array.from(el.files || []);
    const note = $('#composer-input').value.trim();
    el.value = '';
    if (files.length) { $('#composer-input').value = ''; submitPhotos(files, note); }
    return;
  }
  if (el.id === 'set-import') { if (el.files[0]) importBackup(el.files[0]); el.value = ''; return; }
  if (el.dataset.act === 'loc-toggle') return ACT['loc-toggle'](el);
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
  if (d.matches('details.slot-options')) { if (d.open) S.openSlots.add(d.dataset.slot); else S.openSlots.delete(d.dataset.slot); }
  if (d.matches('details.setting')) {
    if (d.open) {
      S.openSetting = d.dataset.sec;
      document.querySelectorAll('details.setting[open]').forEach((o) => { if (o !== d) o.open = false; });
    } else if (S.openSetting === d.dataset.sec) S.openSetting = '';
  }
}, true);

// Tapping an example chip must not take focus away from the composer input
document.addEventListener('pointerdown', (ev) => { if (ev.target.closest('[data-act="hint"]')) ev.preventDefault(); });

$('#btn-cam').addEventListener('click', () => $('#f-cam').click());
$('#btn-lib').addEventListener('click', () => $('#f-lib').click());
$('#composer').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inp = $('#composer-input');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  submitText(t);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

// If the app stayed open past midnight, move on to the new day
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = today();
  if (lastToday !== t && S.viewDay === lastToday) S.viewDay = t;
  lastToday = t;
  render();
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
})();

// For tests and debugging
if (location.hostname === 'localhost') window.__kantar = { S, parseLocal, render, submitPhotos, migrateEntry, migrateSettings };

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
