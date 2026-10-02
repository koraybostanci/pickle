import * as db from './db.js';
import { readMeta, placeLabel } from './exif.js';
import { analyze, shrink, costUSD, AI_ERR_TR, STRONG_MODEL } from './ai.js';
import {
  MEALS, MEAL_BY_ID, SLOTS, SLOT_AD, FLEX, DEFAULTS,
  slotByTime, dayKey, parseDay, addDays, diffDays,
} from './plan.js';
import { renderBugun, renderAkis, renderIlerleme, renderPlan, renderSettings, attachChart } from './views.js';

// ——— Durum ———
export const S = {
  tab: 'bugun',
  set: { ...DEFAULTS, apiKey: '', useLocation: false, places: [], favs: [], usage: { in: 0, out: 0, calls: 0, usd: 0 }, lastBackup: 0 },
  entries: [],
  days: {},
  viewDay: dayKey(new Date()),
  busy: new Set(),
  urls: new Map(),
  persisted: null,
  storage: null,
  calPick: null,
};

const $ = (s, r = document) => r.querySelector(s);
export const today = () => dayKey(new Date());

// ——— Hesaplar ———
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
export const dayTarget = (day) => ((S.days[day] && S.days[day].train) ? S.set.kcalTrain : S.set.kcalRest);

export function dayStatus(day) {
  const t = dayTotals(day);
  if (!t.n) return 'yok';
  const tg = dayTarget(day);
  const hasYok = mealsOf(day).some((e) => e.tier === 'yok');
  if (t.kcal < tg * 0.6) return 'eksik';
  if (t.kcal <= tg * 1.07 && t.kcal >= tg * 0.75 && t.p >= S.set.proteinMin && !hasYok) return 'hedefte';
  if (t.kcal <= tg * 1.15) return 'yakin';
  return 'ustunde';
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

// Son 14 günün eğimi (kg/gün) ve hedefe tahmini varış
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
    const daysLeft = Math.ceil((cur.kg - S.set.targetKg) / -slope);
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
  const r = { kucuk: 0, ogun: 0, yok: 0 };
  for (const e of S.entries) {
    if (e.kind !== 'meal' || e.status !== 'ok' || e.day < ws || e.day > we) continue;
    if (e.tier === 'yok') r.yok += 1;
    else if (e.tier === 'esnek') {
      if ((e.flags || []).includes('alkol') || eff(e).kcal <= 250) r.kucuk += 1;
      else r.ogun += 1;
    }
  }
  return r;
}

export function streak() {
  let n = 0;
  let d = today();
  const st0 = dayStatus(d);
  if (st0 !== 'hedefte' && st0 !== 'yakin') d = addDays(d, -1); // bugün henüz bitmedi
  for (let i = 0; i < 400; i++) {
    const st = dayStatus(d);
    if (st === 'hedefte' || st === 'yakin') { n += 1; d = addDays(d, -1); } else break;
  }
  return n;
}

export function suggest(day) {
  const tot = dayTotals(day);
  const rem = dayTarget(day) - tot.kcal;
  const remP = S.set.protein - tot.p;
  const logged = new Set(mealsOf(day).map((e) => e.slot));
  const open = SLOTS.filter((s) => s.id !== 'gece' && !logged.has(s.id));
  if (!open.length) {
    if (remP > 12 && rem >= 90) return { rem, remP, meal: MEAL_BY_ID['N-A'], slot: SLOTS[4], extra: true };
    return { rem, remP, meal: null };
  }
  const next = open[0];
  const minK = (id) => Math.min(...MEALS.filter((m) => m.slot === id).map((m) => m.kcal));
  const reserve = open.slice(1).reduce((a, s) => a + minK(s.id), 0);
  const opts = MEALS.filter((m) => m.slot === next.id);
  const fit = opts.filter((m) => m.kcal <= rem - reserve + 40);
  const pool = fit.length ? fit : opts.slice().sort((a, b) => a.kcal - b.kcal).slice(0, 1);
  const meal = pool.slice().sort((a, b) => b.p - a.p)[0];
  return { rem, remP, meal, slot: next, tight: !fit.length };
}

// ——— Kayıt ———
async function saveSet() { await db.kvSet('settings', S.set); }
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

let toastT;
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
  clearTimeout(toastT);
  toastT = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3200);
}

function tsFor(day, slotId) {
  if (day === today()) return Date.now();
  const sl = SLOTS.find((s) => s.id === slotId);
  const [h, m] = (sl ? sl.saat : '12:00').split(':').map(Number);
  const d = parseDay(day);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

async function logMeal(tpl, src, day = S.viewDay) {
  const ts = tsFor(day, tpl.slot);
  const e = {
    id: db.uid(), ts, day, createdAt: Date.now(), kind: 'meal', status: 'ok', src,
    slot: tpl.slot && tpl.slot !== 'any' ? tpl.slot : slotByTime(new Date(ts)),
    planId: src === 'plan' ? tpl.id : '', title: tpl.ad,
    items: (tpl.items || []).map((i) => ({ n: i.n, g: i.g, kcal: i.kcal, p: i.p })),
    kcal: tpl.kcal, p: tpl.p, c: tpl.c, f: tpl.f, fib: tpl.fib,
    tier: tpl.tier || 'plan', flags: tpl.flags || [], conf: 1, q: '', mult: 1,
    photoIds: [], timeSrc: day === today() ? 'now' : 'manual', place: null,
  };
  await saveEntry(e);
  render();
  toast(`${tpl.ad} kaydedildi`, { label: 'Geri al', fn: () => removeEntry(e.id, true) });
}

async function removeEntry(id, silent) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return;
  S.entries = S.entries.filter((x) => x.id !== id);
  await db.del('entries', id);
  for (const pid of e.photoIds || []) {
    await db.del('photos', pid);
    const u = S.urls.get(pid);
    if (u) { URL.revokeObjectURL(u); S.urls.delete(pid); }
  }
  if (e.kind === 'weight' && S.days[e.day] && S.days[e.day].kg === e.kg) await saveDay(e.day, { kg: null });
  if (e.kind === 'steps' && S.days[e.day] && S.days[e.day].steps === e.steps) await saveDay(e.day, { steps: null });
  render();
  if (!silent) toast('Kayıt silindi');
}

async function noteEntry(kind, title, extra, day = today()) {
  const e = { id: db.uid(), ts: Date.now(), day, createdAt: Date.now(), kind, status: 'ok', src: 'text', title, photoIds: [], timeSrc: 'now', ...extra };
  await saveEntry(e);
  return e;
}

const fmtKg = (kg) => kg.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

async function setWeight(kg, day = today(), viaStream = true) {
  await saveDay(day, { kg });
  if (viaStream) await noteEntry('weight', `Tartı ${fmtKg(kg)} kg`, { kg }, day);
  render();
  toast(`Tartı ${fmtKg(kg)} kg kaydedildi`);
}
async function setSteps(steps, day = today(), viaStream = true) {
  await saveDay(day, { steps });
  if (viaStream) await noteEntry('steps', `${steps.toLocaleString('tr-TR')} adım`, { steps }, day);
  render();
  toast(`${steps.toLocaleString('tr-TR')} adım kaydedildi`);
}

// Token harcamadan çözülebilen metinler
const norm = (s) => s.toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ').trim();
export function parseLocal(text) {
  const t = norm(text);
  let m = /^(?:tartı|kilo|kg)?\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:kg|kilo)?$/.exec(t);
  if (m) {
    const kg = parseFloat(m[1].replace(',', '.'));
    if (kg >= 50 && kg <= 160) return { type: 'weight', kg: Math.round(kg * 10) / 10 };
  }
  m = /^(\d{1,2}[.\s]?\d{3}|\d{3,5})\s*adım$/.exec(t);
  if (m) return { type: 'steps', steps: parseInt(m[1].replace(/[.\s]/g, ''), 10) };
  m = /^su\s*(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litre|bardak)?$/.exec(t);
  if (m) {
    const v = parseFloat(m[1].replace(',', '.'));
    const u = m[2] || (v <= 10 ? 'bardak' : 'ml');
    const ml = u === 'ml' ? v : u === 'bardak' ? v * 250 : v * 1000;
    return { type: 'water', ml: Math.round(ml) };
  }
  if (/^(antrenman|spinning|kettlebell|spor)( yaptım| günü)?$/.test(t)) return { type: 'train' };
  const meal = MEALS.find((x) => norm(x.id) === t || norm(x.ad) === t);
  if (meal) return { type: 'plan', meal };
  const flex = FLEX.find((x) => norm(x.ad) === t);
  if (flex) return { type: 'flex', flex };
  const fav = (S.set.favs || []).find((x) => norm(x.ad) === t);
  if (fav) return { type: 'fav', fav };
  return null;
}

async function submitText(text) {
  const loc = parseLocal(text);
  if (loc) {
    if (loc.type === 'weight') return setWeight(loc.kg);
    if (loc.type === 'steps') return setSteps(loc.steps);
    if (loc.type === 'water') {
      const cur = (S.days[today()] && S.days[today()].water) || 0;
      await saveDay(today(), { water: cur + loc.ml });
      render();
      return toast(`${loc.ml} ml su eklendi`);
    }
    if (loc.type === 'train') { await saveDay(today(), { train: true }); render(); return toast('Bugün antrenman günü: hedef ' + S.set.kcalTrain.toLocaleString('tr-TR') + ' kcal'); }
    if (loc.type === 'plan') return logMeal(loc.meal, 'plan', today());
    if (loc.type === 'flex') return logMeal({ ...loc.flex, slot: 'any', tier: 'esnek' }, 'flex', today());
    if (loc.type === 'fav') return logMeal({ ...loc.fav, slot: 'any' }, 'fav', today());
  }
  const now = new Date();
  const e = {
    id: db.uid(), ts: now.getTime(), day: dayKey(now), createdAt: now.getTime(), kind: 'meal', status: 'pending',
    src: 'text', text, title: text, slot: slotByTime(now), items: [], kcal: 0, p: 0, c: 0, f: 0, fib: 0,
    tier: 'plan', flags: [], conf: 0, q: '', mult: 1, photoIds: [], timeSrc: 'now', place: null,
  };
  await saveEntry(e);
  go('akis');
  queueAnalyze(e.id);
}

let posCache = null;
function getPos() {
  if (!S.set.useLocation || !navigator.geolocation) return Promise.resolve(null);
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
  go('akis');
  toast(list.length > 1 ? `${list.length} fotoğraf hazırlanıyor` : 'Fotoğraf hazırlanıyor');
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
      toast('Bir fotoğraf açılamadı: ' + f.name);
    }
  }
  if (!prepared.length) return;
  prepared.sort((a, b) => a.ts - b.ts);
  // Aynı öğünün art arda çekilmiş kareleri (3 dk içinde, saati fotodan okunmuş) tek kayıt olur.
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
    if (S.set.useLocation) {
      if (withGps) place = placeLabel(withGps.lat, withGps.lon, S.set.places);
      else if (first.timeSrc === 'now') {
        const pos = await getPos();
        if (pos) place = placeLabel(pos.lat, pos.lon, S.set.places);
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
      src: 'photo', text: note || '', title: 'Fotoğraf', slot: slotByTime(when), items: [], kcal: 0, p: 0, c: 0, f: 0, fib: 0,
      tier: 'plan', flags: [], conf: 0, q: '', mult: 1, photoIds, timeSrc: first.timeSrc, place,
    };
    await saveEntry(e);
    queueAnalyze(e.id);
  }
  render();
}

// ——— Analiz kuyruğu (istekler sırayla gider) ———
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
  const e0 = S.entries.find((x) => x.id === id);
  if (!e0) { S.busy.delete(id); return; }
  const e = { ...e0 };
  try {
    const blobs = [];
    for (const pid of e.photoIds || []) { const b = await photoBlob(pid); if (b) blobs.push(b); }
    const model = opts.model || S.set.model;
    const { data, usage } = await analyze({
      apiKey: S.set.apiKey, model, blobs, text: e.text, when: new Date(e.ts), place: e.place, hint: opts.hint,
    });
    const u = S.set.usage;
    u.in += usage.in; u.out += usage.out; u.calls += 1; u.usd += costUSD(model, usage);
    await saveSet();
    e.model = model;
    e.err = '';
    if (data.kind === 'weight' && data.kg >= 50 && data.kg <= 160) {
      const kg = Math.round(data.kg * 10) / 10;
      Object.assign(e, { kind: 'weight', status: 'ok', kg, title: `Tartı ${fmtKg(kg)} kg` });
      await saveDay(e.day, { kg });
    } else if (data.kind === 'steps' && data.steps > 0) {
      const steps = Math.round(data.steps);
      Object.assign(e, { kind: 'steps', status: 'ok', steps, title: `${steps.toLocaleString('tr-TR')} adım` });
      await saveDay(e.day, { steps });
    } else if (data.kind === 'meal') {
      const plan = MEAL_BY_ID[data.plan];
      if (plan) {
        Object.assign(e, {
          planId: plan.id, title: plan.ad, items: plan.items.map((i) => ({ n: i.n, g: i.g, kcal: i.kcal, p: i.p })),
          kcal: plan.kcal, p: plan.p, c: plan.c, f: plan.f, fib: plan.fib, tier: 'plan',
        });
      } else {
        const items = Array.isArray(data.items) ? data.items.slice(0, 12).map((i) => ({ n: String(i.n || ''), g: +i.g || 0, kcal: +i.kcal || 0, p: +i.p || 0 })) : [];
        const sumK = items.reduce((a, i) => a + i.kcal, 0);
        Object.assign(e, {
          planId: '', title: String(data.title || e.text || 'Öğün').slice(0, 80), items,
          kcal: Math.round(+data.kcal || sumK), p: +data.p || items.reduce((a, i) => a + i.p, 0),
          c: +data.c || 0, f: +data.f || 0, fib: +data.fib || 0,
          tier: ['plan', 'esnek', 'yok'].includes(data.tier) ? data.tier : 'plan',
        });
      }
      Object.assign(e, {
        kind: 'meal', status: 'ok',
        slot: SLOT_AD[data.slot] ? data.slot : e.slot,
        flags: Array.isArray(data.flags) ? data.flags.map(String).slice(0, 4) : [],
        conf: Math.max(0, Math.min(1, +data.conf || 0)), q: String(data.q || '').slice(0, 160),
      });
    } else {
      Object.assign(e, { status: 'error', err: 'Kaydedilecek bir yiyecek, tartı ya da adım bulunamadı.' });
    }
  } catch (err) {
    const code = err && err.code;
    const waiting = code === 'no_key' || code === 'offline';
    Object.assign(e, { status: waiting ? 'pending' : 'error', err: (AI_ERR_TR[code] || 'Analiz başarısız oldu.') + (code === 'bad_request' || code === 'http' ? ' ' + String(err.message).slice(0, 140) : '') });
  }
  S.busy.delete(id);
  if (S.entries.some((x) => x.id === id)) await saveEntry(e);
  render();
}

// ——— Yedek ———
const b64FromBuf = (buf) => {
  const u8 = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const bufFromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;

async function exportBackup(withPhotos) {
  const { apiKey, ...setNoKey } = S.set;
  const data = { app: 'kantar', v: 1, at: new Date().toISOString(), settings: setNoKey, entries: S.entries, days: Object.values(S.days) };
  if (withPhotos) data.photos = (await db.all('photos')).map((p) => ({ id: p.id, type: p.type, w: p.w, h: p.h, b64: b64FromBuf(p.buf) }));
  const name = `kantar-yedek-${today()}.json`;
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
  S.set.lastBackup = Date.now();
  await saveSet();
  render();
  toast('Yedek hazırlandı');
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('Dosya okunamadı'); }
  if (!data || data.app !== 'kantar' || !Array.isArray(data.entries)) return toast('Bu bir Kantar yedeği değil');
  await db.putMany('entries', data.entries);
  await db.putMany('days', data.days || []);
  if (Array.isArray(data.photos)) await db.putMany('photos', data.photos.map((p) => ({ id: p.id, type: p.type, w: p.w, h: p.h, buf: bufFromB64(p.b64) })));
  if (data.settings) { S.set = { ...S.set, ...data.settings, apiKey: S.set.apiKey }; await saveSet(); }
  await load();
  render();
  toast(`${data.entries.length} kayıt geri yüklendi`);
}

// ——— Yükleme ve çizim ———
async function load() {
  const st = await db.kvGet('settings', null);
  if (st) S.set = { ...S.set, ...st, usage: { ...S.set.usage, ...(st.usage || {}) } };
  S.entries = await db.all('entries');
  S.days = Object.fromEntries((await db.all('days')).map((d) => [d.day, d]));
}

async function refreshStorage() {
  try {
    if (navigator.storage && navigator.storage.persisted) S.persisted = await navigator.storage.persisted();
    if (navigator.storage && navigator.storage.estimate) S.storage = await navigator.storage.estimate();
  } catch { /* desteklenmiyor */ }
}

export function go(tab) {
  S.tab = tab;
  render();
  $('#view').scrollTop = 0;
  window.scrollTo(0, 0);
}

function render() {
  const v = $('#view');
  const y = window.scrollY;
  const fn = { bugun: renderBugun, akis: renderAkis, ilerleme: renderIlerleme, plan: renderPlan }[S.tab];
  const focusId = document.activeElement && v.contains(document.activeElement) ? document.activeElement.id : '';
  v.innerHTML = fn();
  v.dataset.tab = S.tab;
  document.querySelectorAll('.tabs button').forEach((b) => {
    if (b.dataset.tab === S.tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  const showYaz = S.tab === 'bugun' || S.tab === 'akis';
  $('#yaz').hidden = !showYaz;
  document.body.classList.toggle('has-yaz', showYaz);
  renderFavRow();
  hydratePhotos();
  if (S.tab === 'ilerleme') attachChart(v);
  if (focusId) { const el = document.getElementById(focusId); if (el) el.focus({ preventScroll: true }); }
  window.scrollTo(0, y);
}

function renderFavRow() {
  const row = $('#favrow');
  const favs = S.set.favs || [];
  const show = S.tab === 'akis';
  row.hidden = !show;
  if (!show) return;
  row.innerHTML = '';
  const mk = (label, kcal, act, id) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.act = act;
    b.dataset.id = id;
    b.append(label + ' ');
    const s = document.createElement('span');
    s.textContent = String(Math.round(kcal));
    b.append(s);
    return b;
  };
  favs.forEach((f) => row.append(mk(f.ad, f.kcal, 'log-fav', f.id)));
  FLEX.forEach((f) => row.append(mk(f.ad, f.kcal, 'log-flex', f.id)));
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

function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet').hidden = false;
  document.body.classList.add('sheet-open');
  const h = $('#sheet-body h2');
  if (h) { h.tabIndex = -1; h.focus(); }
}
function closeSheet() {
  $('#sheet').hidden = true;
  document.body.classList.remove('sheet-open');
}
async function openSettings() {
  await refreshStorage();
  openSheet(renderSettings());
}

// ——— Olaylar ———
const ACT = {
  'tab': (el) => go(el.dataset.tab),
  'settings': () => openSettings(),
  'close-sheet': () => closeSheet(),
  'day-prev': () => { S.viewDay = addDays(S.viewDay, -1); render(); },
  'day-next': () => { if (S.viewDay < today()) { S.viewDay = addDays(S.viewDay, 1); render(); } },
  'day-today': () => { S.viewDay = today(); render(); },
  'log-plan': (el) => logMeal(MEAL_BY_ID[el.dataset.id], 'plan'),
  'log-flex': (el) => { const f = FLEX.find((x) => x.id === el.dataset.id); if (f) logMeal({ ...f, slot: 'any', tier: 'esnek' }, 'flex', today()); },
  'log-fav': (el) => { const f = (S.set.favs || []).find((x) => x.id === el.dataset.id); if (f) logMeal({ ...f, slot: 'any' }, 'fav', today()); },
  'open-entry': (el) => {
    go('akis');
    requestAnimationFrame(() => { const c = document.querySelector(`[data-entry="${el.dataset.id}"]`); if (c) c.scrollIntoView({ block: 'center' }); });
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
  'del': (el) => removeEntry(el.dataset.id),
  'analyze': (el) => queueAnalyze(el.dataset.id),
  'analyze-all': () => { S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id)).forEach((e) => queueAnalyze(e.id)); },
  'reanalyze': (el) => queueAnalyze(el.dataset.id, { model: STRONG_MODEL }),
  'answer': (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    const inp = document.getElementById('ans-' + el.dataset.id);
    if (!e || !inp || !inp.value.trim()) return;
    queueAnalyze(e.id, { hint: `Önceki soru: ${e.q}\nYanıt: ${inp.value.trim()}` });
  },
  'fav': async (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    if (!e) return;
    const favs = S.set.favs || [];
    if (favs.some((f) => f.ad === e.title)) return toast('Zaten sık yenenlerde');
    const v = eff(e);
    favs.push({ id: db.uid(), ad: e.title, slot: 'any', kcal: Math.round(v.kcal), p: v.p, c: v.c, f: v.f, fib: v.fib, tier: e.tier, flags: e.flags || [], items: e.items || [] });
    S.set.favs = favs;
    await saveSet();
    render();
    toast('Sık yenenlere eklendi. Bir dahaki sefere tek dokunuş.');
  },
  'fav-del': async (el) => {
    S.set.favs = (S.set.favs || []).filter((f) => f.id !== el.dataset.id);
    await saveSet();
    openSettings();
  },
  'save-edit': async (el) => {
    const id = el.dataset.id;
    const e = S.entries.find((x) => x.id === id);
    if (!e) return;
    const g = (k) => document.getElementById(`${k}-${id}`);
    const kcal = parseFloat(g('ek').value.replace(',', '.'));
    const p = parseFloat(g('ep').value.replace(',', '.'));
    const slot = g('es').value;
    const tm = g('et').value;
    const ne = { ...e, slot };
    if (kcal >= 0) { ne.kcal = Math.round(kcal / (e.mult || 1)); ne.conf = 1; ne.planId = ''; }
    if (p >= 0) ne.p = Math.round((p / (e.mult || 1)) * 10) / 10;
    if (/^\d{2}:\d{2}$/.test(tm)) {
      const d = new Date(e.ts);
      d.setHours(+tm.slice(0, 2), +tm.slice(3, 5), 0, 0);
      if (d.getTime() !== e.ts) { ne.ts = d.getTime(); ne.timeSrc = 'manual'; }
    }
    await saveEntry(ne);
    render();
    toast('Kayıt güncellendi');
  },
  'cal': (el) => { S.calPick = S.calPick === el.dataset.day ? null : el.dataset.day; render(); },
  'goto-day': (el) => { S.viewDay = el.dataset.day; go('bugun'); },
  // Ayarlar
  'save-key': async () => {
    S.set.apiKey = $('#set-key').value.trim();
    S.set.model = $('#set-model').value;
    await saveSet();
    toast(S.set.apiKey ? 'Anahtar bu cihaza kaydedildi' : 'Anahtar silindi');
    if (S.set.apiKey) ACT['analyze-all']();
  },
  'test-key': async () => {
    await ACT['save-key']();
    if (!S.set.apiKey) return;
    const out = $('#key-test');
    out.textContent = 'Deneniyor…';
    try {
      const r = await analyze({ apiKey: S.set.apiKey, model: S.set.model, text: '1 orta boy elma', when: new Date() });
      S.set.usage.in += r.usage.in; S.set.usage.out += r.usage.out; S.set.usage.calls += 1; S.set.usage.usd += costUSD(S.set.model, r.usage);
      await saveSet();
      out.textContent = `Çalışıyor. Deneme: “${r.data.title}”, ${Math.round(r.data.kcal)} kcal. ${r.usage.in} giriş ve ${r.usage.out} çıkış token harcandı.`;
    } catch (err) {
      out.textContent = (AI_ERR_TR[err.code] || 'Başarısız.') + ' ' + String(err.message || '').slice(0, 160);
    }
  },
  'save-targets': async () => {
    const num = (id) => parseFloat($(id).value.replace(',', '.'));
    const patch = {
      startDate: $('#set-start').value, targetDate: $('#set-end').value,
      startKg: num('#set-startkg'), targetKg: num('#set-endkg'),
      kcalRest: Math.round(num('#set-rest')), kcalTrain: Math.round(num('#set-train')), protein: Math.round(num('#set-prot')),
    };
    if (!patch.startDate || !patch.targetDate || patch.targetDate <= patch.startDate || !(patch.startKg > patch.targetKg) || !(patch.kcalRest >= 1200) || !(patch.kcalTrain >= patch.kcalRest) || !(patch.protein > 50)) {
      return toast('Değerleri kontrol et: bitiş başlangıçtan sonra, hedef kilo başlangıçtan düşük, kalori en az 1.200 olmalı');
    }
    S.set = { ...S.set, ...patch, proteinMin: Math.round(patch.protein * 0.89) };
    await saveSet();
    render();
    toast('Hedefler kaydedildi');
  },
  'loc-toggle': async (el) => { S.set.useLocation = el.checked; await saveSet(); openSettings(); },
  'loc-save': async (el) => {
    const out = $('#loc-out');
    out.textContent = 'Konum alınıyor…';
    posCache = null;
    const was = S.set.useLocation;
    S.set.useLocation = true;
    const pos = await getPos();
    S.set.useLocation = was;
    if (!pos) { out.textContent = 'Konum alınamadı. Tarayıcıya konum izni verildiğini kontrol et.'; return; }
    const name = el.dataset.name;
    S.set.places = (S.set.places || []).filter((p) => p.name !== name).concat([{ name, lat: pos.lat, lon: pos.lon }]);
    await saveSet();
    openSettings();
    toast(`Bulunduğun yer “${name}” olarak kaydedildi`);
  },
  'export': () => exportBackup(false),
  'export-photos': () => exportBackup(true),
  'import': () => $('#set-import').click(),
  'persist': async () => {
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* yok */ }
    openSettings();
  },
  'wipe': async () => {
    if (!window.confirm('Bu cihazdaki tüm kayıtlar, fotoğraflar ve tartılar silinecek. Yedeğin var mı? Devam edilsin mi?')) return;
    await db.clear('entries'); await db.clear('photos'); await db.clear('days');
    S.entries = []; S.days = {};
    closeSheet();
    render();
    toast('Tüm kayıtlar silindi');
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act],[data-tab],[data-close-sheet]');
  if (!el) return;
  if (el.matches('input[type=checkbox]')) return; // change olayında işlenir
  if (el.dataset.closeSheet !== undefined) return closeSheet();
  const act = el.dataset.act || (el.dataset.tab ? 'tab' : '');
  if (ACT[act]) { ev.preventDefault(); ACT[act](el); }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'f-cam' || el.id === 'f-lib') {
    const files = Array.from(el.files || []);
    const note = $('#yaz-in').value.trim();
    el.value = '';
    if (files.length) { $('#yaz-in').value = ''; submitPhotos(files, note); }
    return;
  }
  if (el.id === 'set-import') { if (el.files[0]) importBackup(el.files[0]); el.value = ''; return; }
  if (el.dataset.act === 'loc-toggle') return ACT['loc-toggle'](el);
  if (el.dataset.chg === 'kg') {
    const kg = parseFloat(el.value.replace(',', '.'));
    if (kg >= 50 && kg <= 160) setWeight(Math.round(kg * 10) / 10, S.viewDay, false);
    else if (el.value.trim() === '') { await saveDay(S.viewDay, { kg: null }); render(); }
    return;
  }
  if (el.dataset.chg === 'steps') {
    const st = parseInt(el.value.replace(/\D/g, ''), 10);
    if (st >= 0) setSteps(st, S.viewDay, false);
  }
});

$('#btn-cam').addEventListener('click', () => $('#f-cam').click());
$('#btn-lib').addEventListener('click', () => $('#f-lib').click());
$('#yaz').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const inp = $('#yaz-in');
  const t = inp.value.trim();
  if (!t) return;
  inp.value = '';
  submitText(t);
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

// Gün değişince (uygulama açık kalmışsa) bugüne geç
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const t = today();
    if (S._lastToday && S._lastToday !== t && S.viewDay === S._lastToday) S.viewDay = t;
    S._lastToday = t;
    render();
  }
});

(async function start() {
  try {
    await load();
  } catch (err) {
    $('#view').innerHTML = '<div class="bos"><h1>Veritabanı açılamadı</h1><p>Tarayıcının gizli modunda yerel depolama kapalı olabilir. Normal pencerede ya da ana ekrana ekleyerek aç.</p></div>';
    return;
  }
  S._lastToday = today();
  render();
  refreshStorage();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then((p) => { S.persisted = p; }); } catch { /* yok */ }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Yeni sürüm hazır', { label: 'Yenile', fn: () => location.reload() });
        });
      });
    }).catch(() => {});
  }
  // Yarım kalan analizler: anahtar varsa ve çevrimiçiyse sürdür
  if (S.set.apiKey && navigator.onLine) S.entries.filter((e) => e.status === 'pending').forEach((e) => queueAnalyze(e.id));
})();

// Test ve hata ayıklama için
if (location.hostname === 'localhost') window.__kantar = { S, parseLocal, render, submitPhotos };

// Klavye açılınca yazma alanını klavyenin üstünde tut
if (window.visualViewport) {
  const vv = window.visualViewport;
  const onVV = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', kb + 'px');
    document.body.classList.toggle('kb-open', kb > 120);
  };
  vv.addEventListener('resize', onVV);
  vv.addEventListener('scroll', onVV);
}
