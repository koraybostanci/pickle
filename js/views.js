import {
  S, today, eff, mealsOf, dayTotals, dayTarget, dayStatus, avg7, weightSeries, projection,
  weekStart, weekFlex, streak, suggest, hasKey, APP_VERSION,
} from './app.js';
import { MODELS, PRESETS, ZEN_FREE } from './ai.js';
import { MEALS, SLOTS, SLOT_NAME, FLEX, RULES, LOCALE, parseDay, addDays, diffDays, targetAt, dayKey } from './plan.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (x) => Math.round(x).toLocaleString(LOCALE);
const n1 = (x) => (Math.round(x * 10) / 10).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dLong = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', weekday: 'long' });
const dShort = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long' });
const dTiny = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
const dWeekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long' });
const dMonth = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

const ICON = {
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.6A1.5 1.5 0 0 1 10 3.7h4a1.5 1.5 0 0 1 1.3.7l1 1.6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.4" r="3.4"/></svg>',
};
const settingsButton = `<button type="button" class="icon-btn" data-act="settings" aria-label="Settings">${ICON.settings}</button>`;

// ——— Glide ruler: start weight to target weight, with the current average and today's target ———
function ruler(cur, target) {
  const s = S.settings;
  const W = 320;
  const pad = 16;
  const hi = Math.max(s.startKg, Math.min(Math.ceil(cur || s.startKg), s.startKg + 3));
  const lo = s.targetKg;
  const x = (kg) => pad + ((hi - Math.min(Math.max(kg, lo), hi)) / (hi - lo)) * (W - 2 * pad);
  let ticks = '';
  let labels = '';
  for (let k = hi * 2; k >= lo * 2; k--) {
    const kg = k / 2;
    const major = k % 2 === 0;
    ticks += `<line x1="${x(kg).toFixed(1)}" x2="${x(kg).toFixed(1)}" y1="${major ? 31 : 36}" y2="42" class="r-tick${major ? ' r-tick-major' : ''}"/>`;
    if (major) labels += `<text x="${x(kg).toFixed(1)}" y="57" text-anchor="middle" class="r-label">${kg}</text>`;
  }
  const xc = cur ? x(cur) : null;
  const xl = x(target);
  const anchor = (px) => (px < 40 ? 'start' : px > W - 40 ? 'end' : 'middle');
  const tx = (px) => (px < 40 ? px - 6 : px > W - 40 ? px + 6 : px);
  return `<svg class="ruler" viewBox="0 0 ${W} 62" role="img" aria-label="${esc(`Ruler from ${s.startKg} kg to ${s.targetKg} kg. ${cur ? `Your average is ${n1(cur)} kg.` : ''} Today’s target is ${n1(target)} kg.`)}">
    <rect x="${pad}" y="26" width="${W - 2 * pad}" height="16" rx="3" class="r-track"/>
    ${xc != null ? `<rect x="${pad}" y="26" width="${Math.max(0, xc - pad).toFixed(1)}" height="16" rx="3" class="r-fill"/>` : ''}
    ${ticks}${labels}
    <circle cx="${xl.toFixed(1)}" cy="34" r="4.5" class="r-line"/>
    ${xc != null ? `<path d="M${(xc - 6).toFixed(1)} 15h12l-6 9z" class="r-current"/><text x="${tx(xc).toFixed(1)}" y="11" text-anchor="${anchor(xc)}" class="r-value">${n1(cur)}</text>` : ''}
  </svg>`;
}

// Where the weight stands against the schedule, in plain words
function progressSummary() {
  const s = S.settings;
  const t = today();
  const a = avg7(t);
  const target = targetAt(t, s);
  const left = diffDays(t, s.targetDate);
  const toStart = diffDays(t, s.startDate);
  const started = toStart <= 0;
  const pace = ((s.startKg - s.targetKg) / diffDays(s.startDate, s.targetDate)) * 7;
  const endDate = dShort.format(parseDay(s.targetDate));
  const source = !a ? '' : a.n >= 3 ? '7-day average' : a.n === 1 ? 'Last weigh-in' : `Average of ${a.n} weigh-ins`;
  const toLose = `${n1(Math.max(0, (a ? a.kg : s.startKg) - s.targetKg))} kg`;
  const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;
  let head;
  let sub;
  let stats;
  if (!started) {
    head = `Starts ${dLong.format(parseDay(s.startDate))}`;
    sub = `${n1(s.startKg)} kg down to ${s.targetKg} kg by ${endDate}, about ${n1(pace)} kg a week.`;
    stats = [['To lose', toLose], ['Weekly pace', `${n1(pace)} kg`], ['Starts in', days(toStart)]];
  } else if (!a) {
    head = 'Enter your first weigh-in';
    sub = `The target is ${s.targetKg} kg by ${endDate}.`;
    stats = [['To lose', toLose], ['Weekly pace', `${n1(pace)} kg`], ['Days left', String(Math.max(0, left))]];
  } else {
    const diff = a.kg - target;
    if (a.kg <= s.targetKg) head = `You reached ${s.targetKg} kg`;
    else if (left <= 0) head = `${n1(a.kg - s.targetKg)} kg from the target`;
    else if (Math.abs(diff) <= 0.2) head = 'On schedule';
    else if (diff < 0) head = `${n1(-diff)} kg ahead of schedule`;
    else head = `${n1(diff)} kg behind schedule`;
    sub = `${source} ${n1(a.kg)} kg; today’s target is ${n1(target)} kg.`;
    const change = s.startKg - a.kg;
    stats = [[change < -0.05 ? 'Gained' : 'Lost', `${n1(Math.abs(change))} kg`], ['To go', toLose], ['Days left', String(Math.max(0, left))]];
  }
  return { head, sub, stats, a, target, source, started };
}

// Top of Today: where you stand, the ruler, three numbers and today's weigh-in
function glide() {
  const p = progressSummary();
  const kg = (S.days[today()] || {}).kg;
  const duplicatesStartCard = p.started && !p.a && startStep() === 1;
  return `<section class="glide" aria-label="Progress towards the target">
    ${duplicatesStartCard ? '' : `<p class="glide-head">${esc(p.head)}</p>`}
    ${ruler(p.a ? p.a.kg : null, p.target)}
    <p class="legend">${p.a ? `<span><i class="key-current"></i>${esc(lower(p.source))} ${n1(p.a.kg)} kg</span>` : ''}<span><i class="key-line"></i>${p.started ? 'today’s target' : 'start'} ${n1(p.target)} kg</span></p>
    <dl class="stats stats-3">${p.stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    <button type="button" class="row-field" data-act="num" data-kind="kg"><span>Today’s weigh-in</span><b>${kg ? n1(kg) + ' kg' : '–'}</b><i>${kg ? 'Change' : 'Enter'}</i></button>
  </section>`;
}

function gauge(label, val, target, unit, step, lowerIsGood) {
  const max = target * 1.25;
  const v = Math.min(100, (val / max) * 100);
  const over = lowerIsGood && val > target * 1.07;
  const done = !lowerIsGood && val >= target;
  let note;
  if (lowerIsGood) note = val > target ? `${n0(val - target)} ${unit} over` : `${n0(target - val)} ${unit} left`;
  else note = done ? 'Target reached' : `${n0(target - val)} ${unit} to go`;
  return `<div class="gauge${over ? ' is-over' : ''}${done ? ' is-done' : ''}">
    <div class="gauge-head"><h2>${label}</h2><p><b>${n0(val)}</b> / ${n0(target)}${unit === 'g' ? ' g' : ''}</p></div>
    <div class="tape" role="img" aria-label="${label}: ${n0(val)} of ${n0(target)} ${unit}" style="--v:${v.toFixed(1)}%;--tick:${((step / max) * 100).toFixed(3)}%"><i></i><b></b></div>
    <p class="gauge-note">${note}</p>
  </div>`;
}

function entryState(e) {
  return S.busy.has(e.id) ? (S.retry.get(e.id) || 'Analysing') : e.status === 'error' ? 'Analysis failed' : 'Waiting for analysis';
}
const multLabel = (m) => ({ 0.5: '½', 1.5: '1½', 2: '2' }[m] || String(m));

function entryMini(e) {
  const v = eff(e);
  const ok = e.status === 'ok';
  return `<button type="button" class="entry-mini${ok ? '' : ' is-pending'}" data-act="open-entry" data-id="${e.id}">
    <span class="entry-mini-title">${esc(e.title)}${ok && e.mult && e.mult !== 1 ? ` ×${multLabel(e.mult)}` : ''}</span>
    <span class="entry-mini-meta">${ok ? `${n0(v.kcal)} kcal, ${n0(v.p)} g protein` : esc(entryState(e))}</span>
  </button>`;
}

const chip = (m, act = 'log-plan') => `<button type="button" class="chip" data-act="${act}" data-id="${m.id}">${esc(m.name)} <span>${m.kcal}</span></button>`;

// The day's meals. The next open slot carries the suggestion and the screen's one primary action.
function dayList(day) {
  const dd = S.days[day] || {};
  const isToday = day === today();
  const all = S.entries.filter((e) => e.day === day && e.kind === 'meal');
  const sg = suggest(day);
  const over = sg.rem < -50;
  const nextId = isToday && !over && sg.meal && sg.slot ? sg.slot.id : '';
  let note = '';
  if (over) note = `Over budget by ${n0(-sg.rem)} kcal.${isToday ? ' Return to the plan tomorrow and do not skip a meal to make up for it; the weekly average is what counts.' : ''}`;
  else if (!sg.meal) note = sg.remP > 12 ? `Meals done. Protein is ${n0(sg.remP)} g short.` : 'Meals done. The day is on target.';
  else if (sg.extra) note = `Meals done. Protein is ${n0(sg.remP)} g short; 150 g of plain skyr closes the gap and fits the budget.`;
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const rows = [];
  const add = (id, name, time, hint) => {
    const entries = all.filter((e) => e.slot === id).sort((x, y) => x.ts - y.ts);
    const done = entries.some((e) => e.status === 'ok');
    const logged = new Set(entries.map((e) => e.planId));
    const options = MEALS.filter((x) => x.slot === id && !(id === 'workout' && logged.has(x.id)));
    const isNext = id === nextId && (!entries.length || !!sg.extra);
    const open = S.openSlots.has(id) ? ' open' : '';
    let body = entries.map(entryMini).join('');
    let late = false;
    if (isNext) {
      const [h, m] = time.split(':').map(Number);
      late = !sg.extra && minutesNow > h * 60 + m + 120;
      const others = options.filter((x) => x.id !== sg.meal.id);
      const fit = !sg.extra && sg.tight ? ', the lightest option' : '';
      body += `<div class="slot-next">
        <p class="slot-suggest"><b>${esc(sg.meal.name)}</b><span>${sg.meal.kcal} kcal, ${n0(sg.meal.p)} g protein${fit}</span></p>
        <button type="button" class="btn btn-primary btn-wide" data-act="log-plan" data-id="${sg.meal.id}">Log this meal</button>
      </div>
      <details class="slot-options" data-slot="${id}"${open}><summary>Something else</summary><div class="chips">${others.map((x) => chip(x)).join('')}<button type="button" class="chip chip-icon" data-act="camera">${ICON.camera}Take a photo</button></div></details>`;
    } else if ((!entries.length || id === 'workout') && options.length) {
      body += `<details class="slot-options" data-slot="${id}"${open}><summary>${hint || 'Show options'}</summary><div class="chips">${options.map((x) => chip(x)).join('')}</div></details>`;
    }
    rows.push(`<li class="slot${done ? ' is-done' : ''}${isNext ? ' is-next' : ''}">
      <div class="slot-time">${time}</div>
      <div class="slot-body"><h3>${name}${late ? ' <small>not logged yet</small>' : ''}</h3>${body}</div>
    </li>`);
  };
  if (all.some((e) => e.slot === 'morning')) add('morning', SLOT_NAME.morning, '', '');
  SLOTS.filter((x) => x.id !== 'late').forEach((x) => add(x.id, x.name, x.time, ''));
  if (dd.train || all.some((e) => e.slot === 'workout')) add('workout', 'Workout extras', '', 'Banana before, skyr after');
  add('late', 'After 20:00', '20:00', 'Herbal tea; skyr if very hungry');
  return `<section class="meals"><h2>${isToday ? 'Today’s meals' : 'Meals'}</h2>
    <button type="button" class="switch" role="switch" aria-checked="${dd.train ? 'true' : 'false'}" data-act="train" data-v="${dd.train ? 0 : 1}">
      <i aria-hidden="true"></i><span>Workout day</span><small>${dd.train ? `target ${n0(S.settings.kcalTrain)} kcal, banana and skyr added` : `target ${n0(S.settings.kcalRest)} kcal`}</small>
    </button>
    ${note ? `<p class="meals-note${over ? ' is-over' : ''}">${note}</p>` : ''}
    <ol class="slots">${rows.join('')}</ol></section>`;
}

function counters(day) {
  const dd = S.days[day] || {};
  const water = dd.water || 0;
  const litres = (ml) => (ml / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
  return `<section class="counters" aria-label="Steps and water">
    <button type="button" class="row-field" data-act="num" data-kind="steps">
      <span>Steps</span><b>${dd.steps ? n0(dd.steps) : '–'}</b><small>/ ${n0(S.settings.steps)}</small><i>${dd.steps ? 'Change' : 'Enter'}</i>
    </button>
    <div class="row-field">
      <span id="water-label">Water</span><b>${litres(water)} l</b><small>/ ${litres(S.settings.water)} l</small>
      <div class="stepper" role="group" aria-labelledby="water-label">
        <button type="button" data-act="water" data-v="-250" aria-label="Remove 250 ml"${water ? '' : ' disabled'}>−</button>
        <button type="button" data-act="water" data-v="250" aria-label="Add 250 ml">+</button>
      </div>
    </div>
  </section>`;
}

function flexBlock(day) {
  const f = weekFlex(day);
  const pips = (n, max) => Array.from({ length: Math.max(max, n) }, (_, i) => `<i class="${i < n ? (i < max ? 'on' : 'on over') : ''}"></i>`).join('');
  return `<section class="flex">
    <h2>This week’s flex budget</h2>
    <dl>
      <div><dt>Beer or small dessert</dt><dd><span class="pips">${pips(f.small, 1)}</span>${f.small} / 1</dd></div>
      <div><dt>Flexible dinner</dt><dd><span class="pips">${pips(f.meal, 1)}</span>${f.meal} / 1</dd></div>
      ${f.off ? `<div><dt>Off-plan entries</dt><dd>${f.off}</dd></div>` : ''}
    </dl>
    ${day === today() ? `<div class="chips">${FLEX.map((x) => chip(x, 'log-flex')).join('')}</div>` : ''}
  </section>`;
}

// First use: shows the single next step; disappears when finished or hidden
function startStep() {
  if (S.settings.hideStart) return 0;
  if (!Object.values(S.days).some((d) => d.kg)) return 1;
  if (!S.entries.some((e) => e.kind === 'meal' && e.status === 'ok')) return 2;
  if (!hasKey()) return 3;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  return standalone ? 0 : 4;
}
function startCard() {
  const n = startStep();
  if (!n) return '';
  const step = {
    1: ['Enter your first weigh-in', 'Progress and forecasts are calculated from your weigh-ins.', '<button type="button" class="btn btn-primary" data-act="num" data-kind="kg">Enter weight</button>'],
    2: ['Log your first meal', 'Tap “Log this meal” under Today’s meals. No key needed.', ''],
    3: ['Add a key for photo analysis', 'Gemini’s free tier is enough. Plan meals work without a key.', '<button type="button" class="btn btn-primary" data-act="settings" data-sec="analysis">Add key</button>'],
    4: ['Add to Home Screen', 'Use “Add to Home Screen” in the browser’s Share menu. Data is kept more reliably that way.', ''],
  }[n];
  return `<section class="start" aria-labelledby="start-title">
    <div class="start-head"><p>Getting started, step ${n} of 4</p><button type="button" class="link" data-act="hide-start">${n === 4 ? 'Done' : 'Hide'}</button></div>
    <h2 id="start-title">${step[0]}</h2>
    <p class="start-note">${step[1]}</p>
    ${step[2]}
  </section>`;
}

export function renderToday() {
  const day = S.viewDay;
  const isToday = day === today();
  const tot = dayTotals(day);
  const dd = S.days[day] || {};
  return `
  <header class="top">
    <div>
      <h1>${isToday ? 'Today' : esc(dShort.format(parseDay(day)))}</h1>
      <p class="sub">${isToday ? esc(dLong.format(parseDay(day))) : `${esc(dWeekday.format(parseDay(day)))}. <button type="button" class="link link-inline" data-act="day-today">Back to today</button>`}</p>
    </div>
    <div class="top-actions">
      <button type="button" class="icon-btn" data-act="day-prev" aria-label="Previous day">${ICON.prev}</button>
      <button type="button" class="icon-btn" data-act="day-next" aria-label="Next day"${isToday ? ' disabled' : ''}>${ICON.next}</button>
      ${settingsButton}
    </div>
  </header>
  ${isToday ? startCard() : ''}
  ${isToday ? glide() : `<section class="glide"><button type="button" class="row-field" data-act="num" data-kind="kg"><span>Weigh-in for this day</span><b>${dd.kg ? n1(dd.kg) + ' kg' : 'None'}</b><i>${dd.kg ? 'Change' : 'Enter'}</i></button></section>`}
  <section class="budget" aria-label="Daily budget">
    <div class="budget-grid">
      ${gauge('Calories', tot.kcal, dayTarget(day), 'kcal', 100, true)}
      ${gauge('Protein', tot.p, S.settings.protein, 'g', 10, false)}
    </div>
  </section>
  ${dayList(day)}
  ${counters(day)}
  ${flexBlock(day)}`;
}

// ——— Bottom sheets ———
export function renderNumSheet(kind, day) {
  const dd = S.days[day] || {};
  const isKg = kind === 'kg';
  const cur = isKg ? dd.kg : dd.steps;
  const isToday = day === today();
  const title = isKg
    ? (isToday ? 'Today’s weigh-in' : `Weigh-in for ${esc(dShort.format(parseDay(day)))}`)
    : (isToday ? 'Today’s steps' : `Steps for ${esc(dShort.format(parseDay(day)))}`);
  return `
  <header class="sheet-top"><h2 id="sheet-title">${title}</h2><button type="button" class="btn" data-act="close-sheet">Cancel</button></header>
  <form id="num-form" class="num" data-kind="${kind}" data-day="${day}" autocomplete="off">
    <label for="num-in" class="note">${isKg ? 'Weigh in the morning under the same conditions. A single day fluctuates; the maths uses the 7-day average.' : `Your daily step count from the phone’s Health app. Target ${n0(S.settings.steps)}.`}</label>
    <div class="num-row"><input id="num-in" type="text" inputmode="${isKg ? 'decimal' : 'numeric'}" value="${cur ? (isKg ? n1(cur) : String(cur)) : ''}" placeholder="${isKg ? n1(S.settings.startKg) : '8000'}" enterkeyhint="done"><span>${isKg ? 'kg' : 'steps'}</span></div>
    <p class="note is-error" id="num-err" role="alert" hidden></p>
    <button type="submit" class="btn btn-primary btn-wide">Save</button>
    ${cur ? `<button type="button" class="link link-danger" data-act="num-clear" data-kind="${kind}" data-day="${day}">${isKg ? 'Remove weigh-in' : 'Remove steps'}</button>` : ''}
  </form>`;
}

const TIME_SOURCE = { exif: ' (from photo)', file: ' (from file)', manual: ' (edited)', now: '' };
const placeText = (place) => (place === 'out' ? 'out' : `at ${lower(place)}`);

// Full entry, shown in the bottom sheet: photos, numbers, corrections
function entryDetail(e) {
  const when = `${hhmm(e.ts)}${TIME_SOURCE[e.timeSrc] || ''}`;
  if (e.kind === 'weight' || e.kind === 'steps') {
    return `<article class="entry">
      <div class="entry-body">
        <h3>${esc(e.title)}</h3>
        <p class="meta">${esc(dLong.format(parseDay(e.day)))}, ${when}</p>
        <div class="actions"><button type="button" class="btn btn-danger" data-act="delete" data-id="${e.id}">Delete</button></div>
      </div>
    </article>`;
  }
  const v = eff(e);
  const photos = (e.photoIds || []).map((p) => `<img data-photo="${p}" alt="Photo of the meal">`).join('');
  const meta = [when, SLOT_NAME[e.slot] || '', e.place ? esc(placeText(e.place)) : ''].filter(Boolean).join(', ');
  let body;
  if (S.busy.has(e.id)) {
    body = `<p class="status"><span class="spin" aria-hidden="true"></span>${esc(entryState(e))}</p>`;
  } else if (e.status === 'pending') {
    body = `<p class="status">${esc(e.err || 'Waiting for analysis.')}</p><div class="actions"><button type="button" class="btn btn-primary" data-act="analyze" data-id="${e.id}">Analyse</button><button type="button" class="link link-danger" data-act="delete" data-id="${e.id}">Delete</button></div>`;
  } else if (e.status === 'error') {
    body = `<p class="status is-error">${esc(e.err || 'Analysis failed.')}</p><div class="actions"><button type="button" class="btn btn-primary" data-act="analyze" data-id="${e.id}">Try again</button><button type="button" class="link link-danger" data-act="delete" data-id="${e.id}">Delete</button></div>`;
  } else {
    const tier = e.tier === 'off' ? '<span class="tag tag-off">Off plan</span>' : e.tier === 'flex' ? '<span class="tag tag-flex">Flex budget</span>' : e.planId ? '<span class="tag">Plan meal</span>' : '';
    const rough = e.conf > 0 && e.conf < 0.6 && !e.planId;
    const items = (e.items || []).length ? `<ul class="items">${e.items.map((i) => `<li><span>${esc(i.n)}</span><span>${i.g ? n0(i.g * (e.mult || 1)) + ' g' : ''}</span></li>`).join('')}</ul>` : '';
    const question = e.q ? `<div class="question"><p>${esc(e.q)}</p><div><label class="sr-only" for="answer-${e.id}">Your answer</label><input id="answer-${e.id}" type="text" placeholder="Answer briefly"><button type="button" class="btn" data-act="answer" data-id="${e.id}">Update</button></div></div>` : '';
    const mults = [0.5, 1, 1.5, 2].map((m) => `<button type="button" data-act="mult" data-id="${e.id}" data-v="${m}" aria-pressed="${(e.mult || 1) === m}">${m === 1 ? '1' : multLabel(m)}</button>`).join('');
    const slotOptions = Object.entries(SLOT_NAME).map(([k, name]) => `<option value="${k}"${e.slot === k ? ' selected' : ''}>${name}</option>`).join('');
    const canReanalyse = e.src === 'photo' || e.src === 'text';
    body = `
      <p class="entry-value"><b>${n0(v.kcal)}</b> kcal<span>${n0(v.p)} g protein, ${n0(v.c)} g carbs, ${n0(v.f)} g fat</span></p>
      ${rough ? '<p class="status">Rough estimate. Adjust the portion or add a short note.</p>' : ''}
      ${question}
      <div class="actions">
        <div class="seg seg-small" role="group" aria-label="Portion">${mults}</div>
        ${tier}
      </div>
      ${items}
      <div class="field-grid">
        <label for="edit-kcal-${e.id}">Calories<input id="edit-kcal-${e.id}" type="text" inputmode="numeric" value="${Math.round(v.kcal)}"></label>
        <label for="edit-protein-${e.id}">Protein (g)<input id="edit-protein-${e.id}" type="text" inputmode="decimal" value="${Math.round(v.p)}"></label>
        <label for="edit-slot-${e.id}">Meal<select id="edit-slot-${e.id}">${slotOptions}</select></label>
        <label for="edit-time-${e.id}">Time<input id="edit-time-${e.id}" type="time" value="${hhmm(e.ts)}"></label>
      </div>
      <div class="actions">
        <button type="button" class="btn" data-act="save-edit" data-id="${e.id}">Save changes</button>
        <button type="button" class="link" data-act="favorite" data-id="${e.id}">Add to favourites</button>
        ${canReanalyse ? `<button type="button" class="link" data-act="reanalyze" data-id="${e.id}">${S.settings.provider === 'openai' ? 'Analyse again' : 'Analyse again with Sonnet'}</button>` : ''}
        <button type="button" class="link link-danger" data-act="delete" data-id="${e.id}">Delete</button>
      </div>`;
  }
  return `<article class="entry">
    ${photos ? `<div class="entry-photos${(e.photoIds || []).length > 1 ? ' is-multi' : ''}">${photos}</div>` : ''}
    <div class="entry-body">
      <h3>${esc(e.title)}</h3>
      <p class="meta">${meta}</p>
      ${e.text && e.src === 'photo' ? `<p class="meta">Note: ${esc(e.text)}</p>` : ''}
      ${body}
    </div>
  </article>`;
}

export function renderEntrySheet(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return '';
  return `
  <header class="sheet-top"><h2 id="sheet-title">Entry</h2><button type="button" class="btn" data-act="close-sheet">Close</button></header>
  ${entryDetail(e)}`;
}

// ——— Log: one compact row per entry; the photo is a thumbnail, details open in a sheet ———
function logRow(e) {
  const ok = e.status === 'ok';
  const photoCount = (e.photoIds || []).length;
  const thumb = photoCount
    ? `<span class="log-thumb"><img data-photo="${e.photoIds[0]}" alt="">${photoCount > 1 ? `<b>${photoCount}</b>` : ''}</span>`
    : '';
  let meta;
  let value = '';
  if (e.kind !== 'meal') {
    meta = e.kind === 'weight' ? 'Weigh-in' : 'Step count';
  } else if (!ok) {
    meta = esc(entryState(e)); // the full message is in the entry sheet
    value = S.busy.has(e.id) ? '<span class="spin" aria-hidden="true"></span>' : '';
  } else {
    const v = eff(e);
    const notes = [`${n0(v.p)} g protein`];
    if (e.mult && e.mult !== 1) notes.push(`${multLabel(e.mult)} portion`);
    if (e.tier === 'off') notes.push('off plan');
    else if (e.tier === 'flex') notes.push('flex budget');
    else if (e.planId) notes.push('plan meal');
    if (e.q) notes.push('has a question');
    else if (e.conf > 0 && e.conf < 0.6 && !e.planId) notes.push('rough estimate');
    meta = notes.join(', ');
    value = `<b>${n0(v.kcal)}</b><small>kcal</small>`;
  }
  const state = e.kind === 'meal' && !ok ? (e.status === 'error' ? ' is-error' : ' is-pending') : '';
  return `<li><button type="button" class="log-row${state}${e.tier === 'off' && ok ? ' is-off' : ''}" data-act="open-entry" data-id="${e.id}" data-entry="${e.id}">
    <span class="log-time">${hhmm(e.ts)}</span>
    <span class="log-main"><span class="log-title">${esc(e.title)}</span><span class="log-meta">${meta}</span></span>
    ${thumb}
    <span class="log-value">${value}</span>
  </button></li>`;
}

export function renderLog() {
  const pending = S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id));
  const byDay = new Map();
  for (const e of S.entries.slice().sort((a, b) => b.ts - a.ts)) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const t = today();
  const dayName = (d) => (d === t ? 'Today' : d === addDays(t, -1) ? 'Yesterday' : dLong.format(parseDay(d)));
  const groups = Array.from(byDay.entries()).slice(0, 60).map(([d, entries]) => {
    const tot = dayTotals(d);
    const target = dayTarget(d);
    const st = dayStatus(d);
    const fill = Math.min(100, (tot.kcal / target) * 100).toFixed(1);
    return `<section class="log-day">
      <header><h2>${esc(dayName(d))}</h2><p>${tot.n ? `<b>${n0(tot.kcal)}</b> / ${n0(target)} kcal, ${n0(tot.p)} g protein` : ''}</p></header>
      ${tot.n ? `<div class="log-tape${st === 'on' ? ' is-on' : st === 'over' ? ' is-over' : ''}" style="--v:${fill}%" aria-hidden="true"><i></i></div>` : ''}
      <ul class="log-list">${entries.map(logRow).join('')}</ul>
    </section>`;
  }).join('');
  const keyNotice = hasKey() ? '' : `<div class="notice"><p>Photo and free-text analysis needs a model key. Plan meals, weight and steps work without one.</p><button type="button" class="btn" data-act="settings" data-sec="analysis">Add key</button></div>`;
  const pendingNotice = pending.length && hasKey() ? `<div class="notice"><p>${pending.length === 1 ? '1 entry is' : `${pending.length} entries are`} waiting for analysis.</p><button type="button" class="btn" data-act="analyze-all">Analyse all</button></div>` : '';
  return `
  <header class="top">
    <div><h1>Log</h1><p class="sub">Everything you sent, newest first. Tap an entry to correct it.</p></div>
    <div class="top-actions">${settingsButton}</div>
  </header>
  ${keyNotice}${pendingNotice}
  ${groups || `<div class="empty"><p>Nothing logged yet.</p><p>Everything you send lands here: photos, meals you type, weigh-ins, steps.</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="camera">Take a photo</button><button type="button" class="btn" data-act="library">Choose from library</button></div>
    <p>Typing works too. Tap the box below to see examples.</p></div>`}`;
}

// ——— Progress ———
let chartData = null;

function weightChart() {
  const s = S.settings;
  const series = weightSeries();
  const W = 340;
  const H = 210;
  const m = { l: 30, r: 34, t: 16, b: 26 };
  let x0 = s.startDate;
  if (series.length && series[0].day < x0) x0 = diffDays(series[0].day, s.startDate) > 21 ? addDays(s.startDate, -21) : series[0].day;
  const x1 = s.targetDate;
  const span = diffDays(x0, x1);
  const visible = series.filter((d) => d.day >= x0 && d.day <= x1);
  const maxW = Math.max(s.startKg, ...visible.map((d) => d.kg));
  const minW = Math.min(s.targetKg, ...visible.map((d) => d.kg));
  const y1 = Math.ceil(maxW + 0.3);
  const y0 = Math.floor(minW - 0.3);
  const X = (day) => m.l + (diffDays(x0, day) / span) * (W - m.l - m.r);
  const Y = (kg) => m.t + ((y1 - kg) / (y1 - y0)) * (H - m.t - m.b);
  let grid = '';
  const stepY = y1 - y0 > 10 ? 2 : 1;
  for (let k = y0; k <= y1; k += stepY) {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(k).toFixed(1)}" y2="${Y(k).toFixed(1)}" class="c-grid"/><text x="${m.l - 6}" y="${(Y(k) + 3.5).toFixed(1)}" text-anchor="end" class="c-axis">${k}</text>`;
  }
  let xTicks = '';
  for (let i = 0; i <= span; i++) {
    const d = addDays(x0, i);
    if (d.endsWith('-01') || i === 0) {
      const px = X(d);
      if (i !== 0 && px - m.l < 26) continue;
      xTicks += `<text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : 'middle'}" class="c-axis">${i === 0 ? esc(dTiny.format(parseDay(d))) : esc(dMonth.format(parseDay(d)))}</text>`;
    }
  }
  const target = `<line x1="${X(s.startDate).toFixed(1)}" y1="${Y(s.startKg).toFixed(1)}" x2="${X(s.targetDate).toFixed(1)}" y2="${Y(s.targetKg).toFixed(1)}" class="c-target"/>
    <text x="${(X(s.targetDate) + 6).toFixed(1)}" y="${(Y(s.targetKg) + 4).toFixed(1)}" class="c-label">${s.targetKg} kg</text>`;
  const dots = visible.map((d) => `<circle cx="${X(d.day).toFixed(1)}" cy="${Y(d.kg).toFixed(1)}" r="2.2" class="c-dot"/>`).join('');
  const avgPoints = [];
  if (visible.length) {
    const last = visible[visible.length - 1].day;
    for (let d = visible[0].day; d <= last; d = addDays(d, 1)) {
      const a = avg7(d);
      if (a) avgPoints.push({ day: d, kg: a.kg });
    }
  }
  const path = avgPoints.map((p, i) => `${i ? 'L' : 'M'}${X(p.day).toFixed(1)} ${Y(p.kg).toFixed(1)}`).join(' ');
  const end = avgPoints[avgPoints.length - 1];
  const todayLine = today() >= x0 && today() <= x1 ? `<line x1="${X(today()).toFixed(1)}" x2="${X(today()).toFixed(1)}" y1="${m.t}" y2="${H - m.b}" class="c-today"/>` : '';
  chartData = { x0, span, m, W, H, avg: Object.fromEntries(avgPoints.map((p) => [p.day, p.kg])) };
  return `<div class="chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight chart: target line, daily weigh-ins and 7-day average">
      ${grid}${xTicks}${todayLine}${target}${dots}
      ${path ? `<path d="${path}" class="c-avg"/>` : ''}
      ${end ? `<circle cx="${X(end.day).toFixed(1)}" cy="${Y(end.kg).toFixed(1)}" r="4.5" class="c-end"/>` : ''}
      <line id="c-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" class="c-cross" visibility="hidden"/>
    </svg>
    <div class="tip" id="c-tip" hidden></div>
    <p class="legend"><span><i class="key-avg"></i>7-day average</span><span><i class="key-target"></i>target line</span><span><i class="key-dot"></i>daily weigh-in</span></p>
  </div>`;
}

export function attachChart(root) {
  const svg = root.querySelector('.chart svg');
  const tip = root.querySelector('#c-tip');
  const cross = root.querySelector('#c-cross');
  if (!svg || !chartData) return;
  const { x0, span, m, W } = chartData;
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - m.l) / (W - m.l - m.r)) * span);
    if (i < 0 || i > span) { hide(); return; }
    const day = addDays(x0, i);
    const cx = m.l + (i / span) * (W - m.l - m.r);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.setAttribute('visibility', 'visible');
    const d = S.days[day];
    const rows = [[dShort.format(parseDay(day)), '']];
    if (d && d.kg) rows.push([n1(d.kg) + ' kg', 'weigh-in']);
    if (chartData.avg[day]) rows.push([n1(chartData.avg[day]) + ' kg', 'average']);
    if (day >= S.settings.startDate) rows.push([n1(targetAt(day, S.settings)) + ' kg', 'target']);
    tip.innerHTML = '';
    rows.forEach(([value, label], k) => {
      const p = document.createElement('p');
      const b = document.createElement(k ? 'b' : 'span');
      b.textContent = value;
      p.append(b);
      if (label) { const sp = document.createElement('span'); sp.textContent = ' ' + label; p.append(sp); }
      tip.append(p);
    });
    tip.hidden = false;
    const left = (cx / W) * r.width;
    tip.style.left = Math.min(Math.max(left, 64), r.width - 64) + 'px';
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}

const STATUS_LABEL = { on: 'on target', near: 'close', over: 'over', partial: 'partly logged', none: 'nothing logged' };

function calendar() {
  const s = S.settings;
  const t = today();
  const first = weekStart(s.startDate);
  const weeks = Math.ceil((diffDays(first, s.targetDate) + 1) / 7);
  let rows = '';
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(first, w * 7);
    let label = '';
    for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (d.endsWith('-01') || (w === 0 && i === 0)) label = dMonth.format(parseDay(d)); }
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d < s.startDate || d > s.targetDate) { cells += '<span class="cell cell-out"></span>'; continue; }
      if (d > t) { cells += `<span class="cell cell-future" title="${esc(dShort.format(parseDay(d)))}"></span>`; continue; }
      const st = dayStatus(d);
      cells += `<button type="button" class="cell cell-${st}${d === t ? ' cell-today' : ''}${S.calPick === d ? ' cell-selected' : ''}" data-act="cal" data-day="${d}" aria-label="${esc(dShort.format(parseDay(d)))}: ${STATUS_LABEL[st]}"></button>`;
    }
    rows += `<div class="cal-row"><span class="cal-month">${esc(label)}</span>${cells}</div>`;
  }
  let pick = '';
  if (S.calPick) {
    const d = S.calPick;
    const tot = dayTotals(d);
    const dd = S.days[d] || {};
    pick = `<p class="cal-pick"><b>${esc(dLong.format(parseDay(d)))}</b>: ${tot.n ? `${n0(tot.kcal)} / ${n0(dayTarget(d))} kcal, ${n0(tot.p)} g protein` : 'no meals logged'}${dd.kg ? `, weigh-in ${n1(dd.kg)} kg` : ''}. <button type="button" class="link link-inline" data-act="goto-day" data-day="${d}">Open day</button></p>`;
  }
  return `<div class="calendar">
    <div class="cal-row cal-head"><span class="cal-month"></span>${['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((x) => `<span>${x}</span>`).join('')}</div>
    ${rows}
    <p class="legend"><span><i class="cell cell-on"></i>on target</span><span><i class="cell cell-near"></i>close</span><span><i class="cell cell-over"></i>over</span><span><i class="cell cell-none"></i>nothing logged</span></p>
    ${pick}
  </div>`;
}

function checkpoints() {
  const s = S.settings;
  const total = diffDays(s.startDate, s.targetDate);
  const points = [];
  for (let i = 28; i < total - 6; i += 28) points.push(addDays(s.startDate, i));
  points.push(s.targetDate);
  const t = today();
  return `<table class="table"><thead><tr><th scope="col">Date</th><th scope="col">Target</th><th scope="col">Your average</th></tr></thead><tbody>
    ${points.map((d) => { const a = d <= t ? avg7(d) : null; return `<tr><td>${esc(dShort.format(parseDay(d)))}</td><td>${n1(targetAt(d, s))} kg</td><td>${a ? n1(a.kg) + ' kg' : '–'}</td></tr>`; }).join('')}
  </tbody></table>`;
}

function adjustNotice() {
  const s = S.settings;
  const t = today();
  if (diffDays(s.startDate, t) < 14) return '';
  const a = avg7(t);
  const b = avg7(addDays(t, -7));
  if (!a || !b || a.n < 3 || b.n < 3) return '';
  if (a.kg - targetAt(t, s) > 0.7 && b.kg - targetAt(addDays(t, -7), s) > 0.7) {
    return `<div class="notice"><p>Your average has been more than 0.7 kg behind schedule for two weeks. Cut 100 kcal a day or add 2,000 steps. Do not go below ${n0(Math.max(1500, s.kcalRest - 100))} kcal.</p><button type="button" class="btn" data-act="settings" data-sec="targets">Open targets</button></div>`;
  }
  return '';
}

export function renderProgress() {
  const s = S.settings;
  const { head, sub, a, target } = progressSummary();
  const pr = projection();
  const series = weightSeries();
  const lost = a ? s.startKg - a.kg : 0;
  const run = streak();
  const rows = series.slice().reverse().slice(0, 120).map((d) => {
    const avg = avg7(d.day);
    const tot = dayTotals(d.day);
    return `<tr><td>${esc(dTiny.format(parseDay(d.day)))}</td><td>${n1(d.kg)}</td><td>${avg ? n1(avg.kg) : '–'}</td><td>${d.day >= s.startDate ? n1(targetAt(d.day, s)) : '–'}</td><td>${tot.n ? n0(tot.kcal) : '–'}</td></tr>`;
  }).join('');
  return `
  <header class="top">
    <div><h1>Progress</h1><p class="sub">${esc(dShort.format(parseDay(s.startDate)))} to ${esc(dShort.format(parseDay(s.targetDate)))}, ${s.startKg} kg to ${s.targetKg} kg</p></div>
    <div class="top-actions">${settingsButton}</div>
  </header>
  ${adjustNotice()}
  <section class="glide">
    <p class="glide-head">${esc(head)}</p>
    ${ruler(a ? a.kg : null, target)}
    <p class="glide-note">${esc(sub)}</p>
  </section>
  <section>
    ${weightChart()}
    <dl class="stats">
      <div><dt>Lost</dt><dd>${a ? n1(Math.max(0, lost)) + ' kg' : '–'}</dd></div>
      <div><dt>To go</dt><dd>${a ? n1(Math.max(0, a.kg - s.targetKg)) + ' kg' : n1(s.startKg - s.targetKg) + ' kg'}</dd></div>
      <div><dt>Weekly rate</dt><dd>${pr ? n1(pr.perWeek).replace('-', '−') + ' kg' : '–'}</dd></div>
      <div><dt>Projected arrival</dt><dd>${pr && pr.eta ? esc(dTiny.format(parseDay(pr.eta))) : '–'}</dd></div>
    </dl>
    ${pr ? '' : '<p class="note">Weekly rate and projected arrival appear after 4 weigh-ins spread over at least a week.</p>'}
  </section>
  <section>
    <h2>Consistency calendar</h2>
    <p class="note">${run > 0 ? `${run} ${run === 1 ? 'day' : 'days'} on plan in a row.` : 'Days on target or close build a streak.'}</p>
    ${calendar()}
  </section>
  <section>
    <h2>Checkpoints</h2>
    ${checkpoints()}
  </section>
  <section>
    <details class="table-details">
      <summary>Weigh-in table</summary>
      ${rows ? `<table class="table"><thead><tr><th scope="col">Day</th><th scope="col">Weigh-in</th><th scope="col">Avg</th><th scope="col">Target</th><th scope="col">kcal</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="note">No weigh-ins yet. Enter one on Today, or type a number into the log.</p>'}
    </details>
  </section>`;
}

// ——— Plan ———
export function renderPlan() {
  const s = S.settings;
  const section = (id, title, note) => `<section class="plan-meal">
    <h2>${title}</h2>${note ? `<p class="note">${note}</p>` : ''}
    ${MEALS.filter((m) => m.slot === id).map((m) => `<details class="plan-option">
      <summary><span>${esc(m.name)}</span><span class="plan-value">${m.kcal} kcal, ${n0(m.p)} g protein</span></summary>
      <ul class="items">${m.items.map((i) => `<li><span>${esc(i.n)}</span><span>${i.g} g${i.measure ? ` (${esc(i.measure)})` : ''}</span></li>`).join('')}</ul>
      <p class="note">Carbs ${n0(m.c)} g, fat ${n0(m.f)} g, fibre ${n0(m.fib)} g.</p>
    </details>`).join('')}
  </section>`;
  const list = (items) => `<ul class="rules">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `
  <header class="top">
    <div><h1>Plan</h1><p class="sub">Rest day ${n0(s.kcalRest)} kcal, workout day ${n0(s.kcalTrain)} kcal. Protein ${s.protein} g, fibre at least ${s.fiber} g.</p></div>
    <div class="top-actions">${settingsButton}</div>
  </header>
  ${section('lunch', 'Lunch, 12:00', 'The first meal of the day. One of four options.')}
  ${section('snack1', 'Snack 1', 'Most of the day’s protein comes from here: 250 g of skyr.')}
  ${section('snack2', 'Snack 2', 'On meatball or salmon days the cottage cheese option tops up the protein.')}
  ${section('dinner', 'Dinner, 18:00', 'Meat, chicken and fish by raw weight.')}
  ${section('workout', 'Workout-day extras', 'Only on workout days; together about 200 kcal.')}
  ${section('late', 'After 20:00', 'Herbal tea by default.')}
  <section><h2>Dinner rotation</h2><p class="note">Fish twice and legumes twice a week.</p>
    <table class="table"><tbody>${RULES.rotation.map(([day, meal]) => `<tr><th scope="row">${day}</th><td>${esc(meal)}</td></tr>`).join('')}</tbody></table>
  </section>
  <section><h2>Every day</h2>${list(RULES.daily)}</section>
  <section><h2>Weekly flex budget</h2>${list(RULES.weekly)}</section>
  <section><h2>Off for the whole period</h2>${list(RULES.off)}</section>
  <section><h2>Training and movement</h2>${list(RULES.training)}</section>
  <section><h2>Process rules</h2>${list(RULES.process)}</section>`;
}

// ——— Settings: every section starts collapsed and shows its current state in the heading ———
export function renderSettings() {
  const s = S.settings;
  const u = s.usage || { in: 0, out: 0, calls: 0, usd: 0 };
  const storage = S.storage;
  const mb = (b) => (b / 1048576).toLocaleString(LOCALE, { maximumFractionDigits: 1 });
  const places = s.places || [];
  const favorites = s.favorites || [];
  const openai = s.provider === 'openai';
  const backupAge = s.lastBackup ? diffDays(dayKey(new Date(s.lastBackup)), today()) : null;
  const backupStatus = backupAge == null ? 'No backup yet' : backupAge === 0 ? 'Last backup today' : `Last backup ${backupAge} ${backupAge === 1 ? 'day' : 'days'} ago`;
  const preset = PRESETS.find((p) => p.base === s.oaBase);
  const analysisStatus = !hasKey() ? 'No key' : openai ? `${preset ? preset.name.split(' (')[0] : 'OpenAI-compatible'}, ${s.oaModel}` : `Claude, ${(MODELS[s.model] || { name: s.model }).name.split(' (')[0]}`;
  const section = (id, title, status, body) => `<details class="setting" data-sec="${id}"${S.openSetting === id ? ' open' : ''}>
    <summary><span>${title}</span><small>${esc(status)}</small></summary>
    <div class="setting-body">${body}</div>
  </details>`;

  const analysis = `
    <p class="note">Analysis goes straight from this phone to the provider you choose. The key is stored only on this device and is never written to a backup.</p>
    <label for="set-prov">Provider</label>
    <select id="set-prov" data-chg="provider">
      <option value="openai"${openai ? ' selected' : ''}>Gemini, OpenCode, OpenRouter (OpenAI-compatible)</option>
      <option value="anthropic"${openai ? '' : ' selected'}>Claude (needs prepaid credit)</option>
    </select>
    ${openai ? `
    <label for="set-preset">Preset</label>
    <select id="set-preset" data-chg="preset"><option value="">Choose, or fill in the fields below</option>${PRESETS.map((p) => `<option value="${p.id}"${p.base === s.oaBase ? ' selected' : ''}>${p.name}</option>`).join('')}</select>
    <label for="set-oakey">Key</label>
    <input id="set-oakey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaKey)}">
    ${preset && preset.id === 'gemini' ? '<p class="note">Get a free key at aistudio.google.com with “Get API key”.</p>' : ''}
    <label for="set-oamodel">Model</label>
    <input id="set-oamodel" type="text" list="oa-models" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaModel)}" placeholder="model id">
    <datalist id="oa-models">${ZEN_FREE.map((m) => `<option value="${m}"></option>`).join('')}</datalist>
    <label for="set-base">Address</label>
    <input id="set-base" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaBase)}" placeholder="https://…/v1">
    <div class="actions"><button type="button" class="btn btn-primary" data-act="test-key">Save and test</button><button type="button" class="btn" data-act="save-key">Save only</button></div>
    <p class="note pre" id="key-test" role="status"></p>
    <p class="note">If the model does not read photos: <button type="button" class="link link-inline" data-act="find-vision">find a model that reads photos</button>. It tries the provider’s models one by one with a small test image.</p>` : `
    <label for="set-key">Key</label>
    <input id="set-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.apiKey)}" placeholder="sk-ant-…">
    <label for="set-model">Model</label>
    <select id="set-model">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}"${s.model === k ? ' selected' : ''}>${m.name}</option>`).join('')}</select>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="test-key">Save and test</button><button type="button" class="btn" data-act="save-key">Save only</button></div>
    <p class="note pre" id="key-test" role="status"></p>`}
    <p class="note">So far ${n0(u.calls)} calls, ${n0(u.in)} input and ${n0(u.out)} output tokens.${openai ? '' : ` Estimated cost $${u.usd.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 3 })}.`}</p>`;

  const targets = `
    <div class="field-grid">
      <label for="set-start">Start<input id="set-start" type="date" value="${s.startDate}"></label>
      <label for="set-end">End<input id="set-end" type="date" value="${s.targetDate}"></label>
      <label for="set-startkg">Start weight<input id="set-startkg" type="text" inputmode="decimal" value="${n1(s.startKg)}"></label>
      <label for="set-endkg">Target weight<input id="set-endkg" type="text" inputmode="decimal" value="${n1(s.targetKg)}"></label>
      <label for="set-rest">Rest-day kcal<input id="set-rest" type="text" inputmode="numeric" value="${s.kcalRest}"></label>
      <label for="set-train">Workout-day kcal<input id="set-train" type="text" inputmode="numeric" value="${s.kcalTrain}"></label>
      <label for="set-prot">Protein (g)<input id="set-prot" type="text" inputmode="numeric" value="${s.protein}"></label>
    </div>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="save-targets">Save targets</button></div>`;

  const location = `
    <label class="check"><input type="checkbox" data-act="loc-toggle"${s.useLocation ? ' checked' : ''}> Use the photo’s location</label>
    <p class="note">Location is read on the device and matched to your saved places here. The model only gets the word “Home”, “Office” or “out”; coordinates never leave the phone. When you choose from the library, location only comes through if Location is switched on under Options in the picker.</p>
    <div class="actions">
      <button type="button" class="btn" data-act="loc-save" data-name="Home">I am here: Home</button>
      <button type="button" class="btn" data-act="loc-save" data-name="Office">I am here: Office</button>
    </div>
    <p class="note" id="loc-out" role="status">${places.length ? 'Saved places: ' + places.map((p) => esc(p.name)).join(', ') + '.' : 'No saved places.'}</p>`;

  const backup = `
    <p class="note">Data lives only on this device. iOS can delete web data when storage runs low; save a backup to Files once a week.</p>
    <div class="actions">
      <button type="button" class="btn btn-primary" data-act="export">Save backup</button>
      <button type="button" class="btn" data-act="export-photos">With photos</button>
      <button type="button" class="btn" data-act="import">Restore from backup</button>
    </div>
    <input id="set-import" type="file" accept="application/json,.json" hidden>
    <p class="note">For analysis on a computer: one .sql file with your days, meals and targets that loads into any SQLite database. Photos, keys and saved places are left out.</p>
    <div class="actions"><button type="button" class="btn" data-act="export-sql">Export for SQLite</button></div>
    <p class="note">${S.persisted === true ? 'Persistent storage is on.' : S.persisted === false ? 'Persistent storage has not been granted yet. Adding the app to the Home Screen makes that more likely.' : ''} ${storage && storage.usage != null ? `Space used: ${mb(storage.usage)} MB.` : ''}</p>
    ${S.persisted === false ? '<div class="actions"><button type="button" class="btn" data-act="persist">Request persistent storage</button></div>' : ''}`;

  const favoritesBody = favorites.length
    ? `<ul class="items">${favorites.map((f) => `<li><span>${esc(f.name)}, ${n0(f.kcal)} kcal</span><button type="button" class="link" data-act="favorite-remove" data-id="${f.id}">Remove</button></li>`).join('')}</ul>`
    : '<p class="note">Open an entry and tap “Add to favourites”. It then logs with one tap from the Log tab.</p>';

  const version = `
    <p class="note">The app looks for a new version when it opens and when it comes to the front; if it finds one it reloads. Your entries are not affected.</p>
    <div class="actions"><button type="button" class="btn btn-primary" data-act="check-update">Check for updates</button><button type="button" class="btn" data-act="hard-reload">Clear cache and reload</button></div>
    <p class="note" id="update-out" role="status"></p>`;

  const reset = `
    <p class="note">All entries, photos and weigh-ins are deleted from this device. Settings and keys stay.</p>
    <div class="actions"><button type="button" class="btn btn-danger" data-act="wipe">Delete all entries</button></div>`;

  return `
  <header class="sheet-top"><h2 id="sheet-title">Settings</h2><button type="button" class="btn" data-act="close-sheet">Close</button></header>
  <div class="settings">
    ${section('analysis', 'Photo and text analysis', analysisStatus, analysis)}
    ${section('targets', 'Targets', `${n1(s.startKg)} kg to ${n1(s.targetKg)} kg by ${dShort.format(parseDay(s.targetDate))}`, targets)}
    ${section('backup', 'Backup and export', backupStatus, backup)}
    ${section('location', 'Location', s.useLocation ? (places.length ? 'On: ' + places.map((p) => p.name).join(', ') : 'On, no saved places') : 'Off', location)}
    ${section('favorites', 'Favourites', favorites.length ? `${favorites.length} ${favorites.length === 1 ? 'meal' : 'meals'}` : 'None yet', favoritesBody)}
    ${section('version', 'Version and updates', `Version ${APP_VERSION}`, version)}
    ${section('reset', 'Reset', '', reset)}
  </div>
  <footer class="brand"><img src="icons/icon.svg" width="44" height="44" alt=""><p><b>Kantar</b><span>Version ${APP_VERSION}. Your data stays on this device.</span></p></footer>`;
}
