import {
  S, today, eff, mealsOf, dayTotals, dayTarget, dayStatus, avg7, weightSeries, projection,
  weekStart, weekFlex, streak, suggest, hasKey, APP_VERSION, dayGoals, isPerfect, history, kilosDown,
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
const CHECK = '<svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';
const PLATE = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="17"/><circle cx="24" cy="24" r="10.5"/></svg>';
const settingsButton = `<button type="button" class="icon-btn" data-act="settings" aria-label="Settings">${ICON.settings}</button>`;

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
  const plan = `${toLose} to lose by ${dTiny.format(parseDay(s.targetDate))}, about ${n1(pace)} kg a week.`;
  let head; // the status, a few words
  let line; // the numbers behind it, one sentence
  let tag; // the status in two or three words, for the weight tile
  if (!started) {
    head = toStart === 1 ? 'Starts tomorrow' : toStart <= 7 ? `Starts ${dWeekday.format(parseDay(s.startDate))}` : `Starts ${dShort.format(parseDay(s.startDate))}`;
    line = plan;
    tag = head;
  } else if (!a) {
    head = 'No weigh-in yet';
    line = plan;
    tag = `${toLose} to lose`;
  } else {
    const diff = a.kg - target;
    const change = s.startKg - a.kg;
    const moved = `${n1(Math.abs(change))} kg ${change < -0.05 ? 'up' : 'down'}`;
    if (a.kg <= s.targetKg) {
      head = `You reached ${s.targetKg} kg`;
      line = `${moved} since ${dShort.format(parseDay(s.startDate))}.`;
      tag = 'Target reached';
    } else {
      if (left <= 0) head = `${n1(a.kg - s.targetKg)} kg from the target`;
      else if (Math.abs(diff) <= 0.2) head = 'On schedule';
      else if (diff < 0) head = `${n1(-diff)} kg ahead of schedule`;
      else head = `${n1(diff)} kg behind schedule`;
      line = `${moved}, ${toLose} to go${left > 0 ? `, ${days(left)} left` : ''}.`;
      tag = left <= 0 ? `${toLose} to go` : Math.abs(diff) <= 0.2 ? 'On schedule' : `${n1(Math.abs(diff))} kg ${diff < 0 ? 'ahead' : 'behind'}`;
    }
  }
  return { head, line, tag, a, target, source, started };
}

// A plain progress track from start weight to target weight: the fill is how far you are, the notch is today's target
function track(a, target, started) {
  const s = S.settings;
  const span = s.startKg - s.targetKg;
  const pct = (kg) => Math.min(100, Math.max(0, ((s.startKg - kg) / span) * 100)).toFixed(1);
  return `<span class="track" aria-hidden="true"><i style="width:${a ? pct(a.kg) : 0}%"></i>${started ? `<u style="left:${pct(target)}%"></u>` : ''}</span>`;
}

const STATUS_LABEL = { on: 'on target', near: 'close', over: 'over', partial: 'partly logged', none: 'nothing logged', future: 'still to come', before: 'before the plan started' };

// ——— Week strip: the seven days of the week as tokens. The colour is how the day went; tap one to open it. ———
function weekStrip(day) {
  const t = today();
  const ws = weekStart(day);
  const tokens = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, i) => {
    const d = addDays(ws, i);
    // Days before the plan started only count if something was logged on them
    const raw = d > t ? 'future' : dayStatus(d);
    const st = raw === 'none' && d < S.settings.startDate ? 'before' : raw;
    const perfect = d <= t && isPerfect(d);
    const cls = `day day-${st}${perfect ? ' is-perfect' : ''}${d === t ? ' is-today' : ''}${d === day ? ' is-selected' : ''}`;
    const label = `${dLong.format(parseDay(d))}: ${perfect ? 'all goals done' : STATUS_LABEL[st]}`;
    return `<li><button type="button" class="${cls}" data-act="goto-day" data-day="${d}" aria-label="${esc(label)}"${d === day ? ' aria-current="date"' : ''}${d > t ? ' disabled' : ''}><span>${letter}</span><b>${parseDay(d).getDate()}</b></button></li>`;
  }).join('');
  const goals = dayGoals(day);
  const done = goals.filter((g) => g.done).length;
  const run = streak();
  const dots = goals.map((g) => `<i class="${g.done ? 'on' : ''}"></i>`).join('');
  const left = run > 0 ? `<span class="streak">${GLYPH.flame}<b>${run}</b> day streak</span>` : '<span class="streak">A day on plan starts a streak</span>';
  return `<nav class="week" aria-label="Days of the week">
    <button type="button" class="week-nav" data-act="week-prev" aria-label="Previous week">${ICON.prev}</button>
    <ol>${tokens}</ol>
    <button type="button" class="week-nav" data-act="week-next" aria-label="Next week"${addDays(ws, 7) > t ? ' disabled' : ''}>${ICON.next}</button>
  </nav>
  <p class="week-note">${left}<span class="goal-count${done === goals.length ? ' is-done' : ''}" title="${esc(goals.map((g) => `${g.name}: ${g.done ? 'done' : 'open'}`).join(', '))}"><span class="goal-dots" aria-hidden="true">${dots}</span>${done === goals.length ? 'Perfect day' : `${done} of ${goals.length} goals`}</span></p>`;
}

const GLYPH = {
  flame: '<svg class="glyph g-flame" viewBox="0 0 20 20" aria-hidden="true"><path d="M10.4 1.8c.7 3 3.9 4.4 3.9 8.6a4.3 4.3 0 0 1-8.6.3c0-2.1 1-3.2 1.6-4.7.8 1 1.3 1.5 1.9 1.6-.1-2.2.1-4 1.2-5.8z"/></svg>',
  scale: '<svg class="glyph g-scale" viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="3.5" width="14" height="13" rx="3.5"/><path d="M7 7.5a4.2 4.2 0 0 1 6 0M10 7.2v2.3"/></svg>',
  egg: '<svg class="glyph g-egg" viewBox="0 0 20 20" aria-hidden="true"><ellipse cx="10" cy="10.6" rx="6.4" ry="7.6"/><circle cx="10" cy="11.6" r="3"/></svg>',
  steps: '<svg class="glyph g-steps" viewBox="0 0 20 20" aria-hidden="true"><ellipse cx="6.8" cy="12.4" rx="2.9" ry="4.8" transform="rotate(-10 6.8 12.4)"/><ellipse cx="13.6" cy="7.4" rx="2.6" ry="4.4" transform="rotate(10 13.6 7.4)"/></svg>',
  drop: '<svg class="glyph g-drop" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.2c3 3.7 5.1 6.2 5.1 8.9a5.1 5.1 0 0 1-10.2 0c0-2.7 2.1-5.2 5.1-8.9z"/></svg>',
};

// ——— The day's calories as a budget that burns down, the way an error budget does.
// The solid line is what is left after each meal, the dashed line is the plan's pace,
// and from "now" the forecast runs on with the meals still to come. ———
function budgetTile(day) {
  const isToday = day === today();
  const target = dayTarget(day);
  const meals = mealsOf(day).slice().sort((a, b) => a.ts - b.ts);
  const eaten = meals.reduce((a, e) => a + eff(e).kcal, 0);
  const rem = target - eaten;
  const hourOf = (ts) => { const d = new Date(ts); return d.getHours() + d.getMinutes() / 60; };
  const H0 = 6;
  const H1 = 24;
  const now = isToday ? Math.min(H1, Math.max(H0, hourOf(Date.now()))) : H1;

  // The plan's pace: each slot spends its average plan meal, scaled so the day ends at zero
  const slots = SLOTS.filter((x) => x.id !== 'late').map((x) => {
    const options = MEALS.filter((m) => m.slot === x.id);
    const [h, m] = x.time.split(':').map(Number);
    return { id: x.id, at: h + m / 60, kcal: options.reduce((a, o) => a + o.kcal, 0) / (options.length || 1) };
  });
  const scale = target / (slots.reduce((a, x) => a + x.kcal, 0) || 1);
  slots.forEach((x) => { x.kcal *= scale; });
  const plannedByNow = slots.filter((x) => x.at <= now).reduce((a, x) => a + x.kcal, 0);
  const logged = new Set(meals.map((e) => e.slot));
  const open = isToday ? slots.filter((x) => !logged.has(x.id)) : [];
  const forecast = rem - open.reduce((a, x) => a + x.kcal, 0);

  // Geometry
  const X0 = 30;
  const X1 = 322;
  const YT = 8;
  const Y0 = 66;
  const YB = 78;
  const x = (h) => X0 + ((Math.min(H1, Math.max(H0, h)) - H0) / (H1 - H0)) * (X1 - X0);
  const y = (v) => (v >= 0 ? YT + ((target - Math.min(v, target)) / target) * (Y0 - YT) : Y0 + Math.min(1, -v / (target * 0.25)) * (YB - Y0));
  const f = (n) => n.toFixed(1);
  let plan = `M${f(x(H0))} ${f(y(target))}`;
  let left = target;
  for (const sl of slots) { plan += `H${f(x(sl.at))}`; left -= sl.kcal; plan += `V${f(y(left))}`; }
  plan += `H${f(x(H1))}`;
  let actual = `M${f(x(H0))} ${f(y(target))}`;
  let r = target;
  let dots = '';
  for (const e of meals) {
    const t = Math.min(now, Math.max(H0, hourOf(e.ts)));
    actual += `H${f(x(t))}`;
    r -= eff(e).kcal;
    actual += `V${f(y(r))}`;
    dots += `<circle cx="${f(x(t))}" cy="${f(y(r))}" r="2.6" class="burn-dot"/>`;
  }
  actual += `H${f(x(now))}`;
  const area = `${actual}V${f(Y0)}H${f(x(H0))}Z`;
  let ahead = '';
  if (isToday && now < H1) {
    ahead = `M${f(x(now))} ${f(y(rem))}`;
    let v = rem;
    for (const sl of open) { ahead += `H${f(x(Math.max(now, sl.at)))}`; v -= sl.kcal; ahead += `V${f(y(v))}`; }
    ahead += `H${f(x(H1))}`;
  }

  // The verdict, in the budget's own terms
  const over = rem < -target * 0.07;
  const rate = plannedByNow > 0 ? eaten / plannedByNow : 0;
  let tone = 'calm';
  let verdict;
  if (!isToday) {
    verdict = rem >= 0 ? `Ended ${n0(rem)} under` : `Ended ${n0(-rem)} over`;
    tone = over ? 'bad' : meals.length ? 'good' : 'calm';
  } else if (rem < 0) { verdict = 'Budget spent'; tone = 'bad'; }
  else if (!meals.length) verdict = plannedByNow > 0 ? 'Nothing spent yet' : 'Full budget';
  else if (plannedByNow === 0) verdict = 'Early start';
  else if (rate > 1.25) { verdict = `Burning ${rate.toLocaleString(LOCALE, { maximumFractionDigits: 1 })}× plan`; tone = 'warn'; }
  else if (rate < 0.7) verdict = 'Under plan so far';
  else { verdict = 'On pace'; tone = 'good'; }
  const pct = Math.round((Math.max(0, rem) / target) * 100);
  let foot;
  if (!isToday || now >= H1) foot = `${n0(eaten)} of ${n0(target)} kcal spent`;
  else if (!open.length) foot = rem >= 0 ? `All meals in, ${n0(rem)} kcal to spare` : `All meals in, ${n0(-rem)} kcal over`;
  else foot = Math.abs(forecast) < 10 ? 'Forecast: ends on budget' : forecast > 0 ? `Forecast: ends ${n0(forecast)} kcal under` : `Forecast: ends ${n0(-forecast)} kcal over`;
  const forecastBad = isToday && open.length > 0 && forecast < -target * 0.07;
  const label = `Calorie budget: ${n0(eaten)} of ${n0(target)} kcal spent, ${rem >= 0 ? `${n0(rem)} left` : `${n0(-rem)} over`}. ${verdict}. ${foot}.`;
  return `<div class="tile tile-budget${rem < 0 ? ' is-over' : ''}" role="group" aria-label="${esc(label)}">
    <div class="budget-head">
      <p class="budget-big"><b>${n0(Math.abs(rem))}</b><span>kcal ${rem >= 0 ? 'left' : 'over'}</span></p>
      <i class="pill pill-${tone}">${esc(verdict)}</i>
    </div>
    <svg class="burn" viewBox="0 0 330 92" aria-hidden="true">
      <rect x="${X0}" y="${Y0}" width="${X1 - X0}" height="${YB - Y0}" class="burn-red"/>
      <path d="${area}" class="burn-area"/>
      <path d="${plan}" class="burn-plan"/>
      <path d="M${X0} ${Y0}H${X1}" class="burn-zero"/>
      ${ahead ? `<path d="${ahead}" class="burn-ahead${forecastBad ? ' is-bad' : ''}"/>` : ''}
      <path d="${actual}" class="burn-line"/>
      ${dots}
      ${isToday && now < H1 ? `<path d="M${f(x(now))} ${YT - 4}V${YB}" class="burn-now"/><circle cx="${f(x(now))}" cy="${f(y(rem))}" r="4.5" class="burn-head"/>` : ''}
      <text x="${X0 - 5}" y="${YT + 4}" text-anchor="end" class="burn-axis">${target >= 1000 ? (target / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 2 }) + 'k' : n0(target)}</text>
      <text x="${X0 - 5}" y="${Y0 + 4}" text-anchor="end" class="burn-axis">0</text>
      ${[6, 12, 18, 24].map((h) => `<text x="${f(x(h))}" y="90" text-anchor="${h === 6 ? 'start' : h === 24 ? 'end' : 'middle'}" class="burn-axis">${String(h).padStart(2, '0')}</text>`).join('')}
    </svg>
    <p class="budget-foot"><span>${pct}% of budget left</span><span${forecastBad ? ' class="is-bad"' : ''}>${esc(foot)}</span></p>
  </div>`;
}

// ——— The day at a glance: the calorie budget with weight and protein beside it. Steps and water, which fill up
// over the day, come as a second pair after the meals. ———
function bento(day, part) {
  const s = S.settings;
  const isToday = day === today();
  const dd = S.days[day] || {};
  const tot = dayTotals(day);
  const top = (glyph, name, done, hint = '') => `<span class="tile-top">${glyph}<span>${name}</span>${done ? CHECK : ''}${hint ? `<em>${hint}</em>` : ''}</span>`;

  let weight;
  if (isToday) {
    const p = progressSummary();
    const value = dd.kg ? n1(dd.kg) : p.a ? n1(p.a.kg) : '–';
    weight = `<button type="button" class="tile tile-weight${dd.kg ? ' is-done' : ''}" data-act="num" data-kind="kg" aria-label="${esc(`Weight. ${p.head}. ${p.line} ${dd.kg ? `Today’s weigh-in ${n1(dd.kg)} kg. Change` : 'Enter today’s weigh-in'}`)}">
      ${top(GLYPH.scale, 'Weight', !!dd.kg, dd.kg ? '' : 'tap to weigh in')}
      <span class="tile-val"><b>${value}</b>${value === '–' ? '' : ' kg'}<em>${esc(p.tag)}</em></span>
      ${track(p.a, p.target, p.started)}
    </button>`;
  } else {
    weight = `<button type="button" class="tile tile-weight${dd.kg ? ' is-done' : ''}" data-act="num" data-kind="kg" aria-label="Weigh-in on this day: ${dd.kg ? n1(dd.kg) + ' kg. Change' : 'none. Add'}">
      ${top(GLYPH.scale, 'Weight', !!dd.kg, dd.kg ? '' : 'tap to add')}
      <span class="tile-val"><b>${dd.kg ? n1(dd.kg) : '–'}</b>${dd.kg ? ' kg' : ''}</span>
    </button>`;
  }

  const pGoal = Math.min(s.proteinMin || s.protein, s.protein);
  const pDone = tot.p >= pGoal;
  const steps = dd.steps || 0;
  const stepsDone = steps >= s.steps;
  const water = dd.water || 0;
  const waterDone = water >= s.water;
  const litres = (ml) => (ml / 1000).toLocaleString(LOCALE, { maximumFractionDigits: 2 });
  const glasses = Math.max(1, Math.min(12, Math.round(s.water / 250)));
  const full = Math.min(glasses, Math.floor(water / 250));
  const pct = (v, of) => Math.min(100, (v / of) * 100).toFixed(1);
  if (part === 'top') return `<section class="bento" aria-label="The day at a glance">
    ${budgetTile(day)}
    ${weight}
    <div class="tile${pDone ? ' is-done' : ''}" role="group" aria-label="Protein: ${n0(tot.p)} of ${n0(s.protein)} g">
      ${top(GLYPH.egg, 'Protein', pDone)}
      <span class="tile-val"><b>${n0(tot.p)}</b> / ${n0(s.protein)} g</span>
      <span class="bar" style="--v:${pct(tot.p, s.protein)}%"><i></i></span>
    </div>
  </section>`;
  return `<section class="bento bento-more" aria-label="Steps and water">
    <button type="button" class="tile${stepsDone ? ' is-done' : ''}" data-act="num" data-kind="steps" aria-label="Steps: ${steps ? n0(steps) : 'none'} of ${n0(s.steps)}. Enter">
      ${top(GLYPH.steps, 'Steps', stepsDone)}
      <span class="tile-val"><b>${steps ? n0(steps) : '–'}</b> / ${n0(s.steps)}</span>
      <span class="bar" style="--v:${pct(steps, s.steps)}%"><i></i></span>
    </button>
    <div class="tile tile-water${waterDone ? ' is-done' : ''}">
      <button type="button" class="tile-main" data-act="water" data-v="250" aria-label="Water: ${litres(water)} of ${litres(s.water)} litres. Add a glass">
        ${top(GLYPH.drop, 'Water', waterDone, water ? '' : 'tap +1 glass')}
        <span class="tile-val"><b>${litres(water)}</b> / ${litres(s.water)} l</span>
        <span class="glasses" aria-hidden="true">${Array.from({ length: glasses }, (_, i) => `<i class="${i < full ? 'on' : ''}"></i>`).join('')}</span>
      </button>
      ${water ? '<button type="button" class="tile-minus" data-act="water" data-v="-250" aria-label="Remove a glass of water">−</button>' : ''}
    </div>
  </section>`;
}

function entryState(e) {
  return S.busy.has(e.id) ? (S.retry.get(e.id) || 'Analysing') : e.status === 'error' ? 'Analysis failed' : 'Waiting for analysis';
}
const multLabel = (m) => ({ 0.5: '½', 1.5: '1½', 2: '2' }[m] || String(m));

const chip = (m, act = 'log-plan') => `<button type="button" class="chip" data-act="${act}" data-id="${m.id}">${esc(m.name)} <span>${m.kcal}</span></button>`;

// The day's meals. The next open slot carries the suggestion and the screen's one primary action.
// Which slots a day shows, and what the plan offers in each
function daySlots(day) {
  const dd = S.days[day] || {};
  const all = S.entries.filter((e) => e.day === day && e.kind === 'meal');
  const has = (id) => all.some((e) => e.slot === id);
  const isToday = day === today();
  const list = [];
  if (has('morning')) list.push({ id: 'morning', name: SLOT_NAME.morning, time: '' });
  SLOTS.filter((x) => x.id !== 'late').forEach((x) => list.push({ id: x.id, name: x.name, time: x.time }));
  if (dd.train || has('workout')) list.push({ id: 'workout', name: 'Workout extras', time: '', hint: 'Banana before, skyr after' });
  // The late slot only shows once it matters: in the evening, when something is in it, or when skyr would close a protein gap
  const sg = suggest(day);
  if (has('late') || (isToday && (new Date().getHours() >= 19 || sg.extra))) list.push({ id: 'late', name: 'After 20:00', time: '20:00', hint: 'Herbal tea; skyr if very hungry' });
  return { list, all, sg, isToday };
}
const slotOptions = (id, entries) => {
  const logged = new Set(entries.map((e) => e.planId));
  return MEALS.filter((x) => x.slot === id && !(id === 'workout' && logged.has(x.id)));
};

// The day's meals as one short list: what is logged, what is next (with a one-tap suggestion), what is still open.
// Tapping an open meal brings up its options in a sheet.
function dayList(day) {
  const dd = S.days[day] || {};
  const { list, all, sg, isToday } = daySlots(day);
  const over = sg.rem < -50;
  const nextId = isToday && !over && sg.meal && sg.slot ? sg.slot.id : '';
  let note = '';
  if (over) note = `Over budget by ${n0(-sg.rem)} kcal.${isToday ? ' Return to the plan tomorrow and do not skip a meal to make up for it; the weekly average is what counts.' : ''}`;
  else if (!sg.meal) note = sg.remP > 12 ? `Meals done. Protein is ${n0(sg.remP)} g short.` : 'Meals done. The day is on target.';
  else if (sg.extra) note = `Meals done. Protein is ${n0(sg.remP)} g short; 150 g of plain skyr closes the gap and fits the budget.`;
  const now = new Date();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const rows = [];
  let done = 0;
  const main = SLOTS.filter((x) => x.id !== 'late').length;
  for (const sl of list) {
    const entries = all.filter((e) => e.slot === sl.id).sort((x, y) => x.ts - y.ts);
    if (entries.some((e) => e.status === 'ok') && SLOTS.some((x) => x.id === sl.id && x.id !== 'late')) done += 1;
    for (const e of entries) {
      const ok = e.status === 'ok';
      const v = eff(e);
      rows.push(`<li class="meal ${ok ? 'is-done' : 'is-pending'}"><button type="button" class="meal-main" data-act="open-entry" data-id="${e.id}">
        <i class="meal-mark" aria-hidden="true">${ok ? CHECK : ''}</i>
        <span class="meal-text"><b>${sl.name}<small>${hhmm(e.ts)}</small></b><span>${esc(e.title)}${ok && e.mult && e.mult !== 1 ? ` ×${multLabel(e.mult)}` : ''}</span></span>
        <span class="meal-kcal">${ok ? `<b>${n0(v.kcal)}</b> kcal` : esc(entryState(e))}</span>
      </button></li>`);
    }
    const options = slotOptions(sl.id, entries);
    const isNext = sl.id === nextId && (!entries.length || !!sg.extra);
    if (isNext) {
      const [h, m] = (sl.time || '0:0').split(':').map(Number);
      const late = !sg.extra && sl.time && minutesNow > h * 60 + m + 120;
      rows.push(`<li class="meal is-next"><button type="button" class="meal-main" data-act="slot" data-slot="${sl.id}" aria-label="${esc(`${sl.name}: other options`)}">
        <i class="meal-mark" aria-hidden="true"></i>
        <span class="meal-text"><b>${sl.name}<small>${late ? 'not logged yet' : sl.time}</small></b><span>${esc(sg.meal.name)}, ${sg.meal.kcal} kcal${!sg.extra && sg.tight ? ', the lightest option' : ''}</span></span>
      </button><button type="button" class="btn btn-primary meal-log" data-act="log-plan" data-id="${sg.meal.id}" aria-label="${esc(`Log ${sg.meal.name}`)}">Log</button></li>`);
    } else if ((!entries.length || sl.id === 'workout') && options.length) {
      rows.push(`<li class="meal"><button type="button" class="meal-main" data-act="slot" data-slot="${sl.id}" aria-label="${esc(`${sl.name}: choose a meal`)}">
        <i class="meal-mark" aria-hidden="true"></i>
        <span class="meal-text"><b>${sl.name}<small>${sl.time}</small></b>${sl.hint ? `<span>${sl.hint}</span>` : ''}</span>
        <span class="meal-add" aria-hidden="true">+</span>
      </button></li>`);
    }
  }
  return `<section class="meals">
    <div class="meals-head"><h2>${isToday ? 'Today’s meals' : 'Meals'}<small>${done} of ${main}</small></h2>
      <button type="button" class="toggle" role="switch" aria-checked="${dd.train ? 'true' : 'false'}" data-act="train" data-v="${dd.train ? 0 : 1}" aria-label="Workout day: budget ${n0(S.settings.kcalTrain)} kcal, banana and skyr added"><i aria-hidden="true"></i>Workout day</button>
    </div>
    ${note ? `<p class="meals-note${over ? ' is-over' : ''}">${note}</p>` : ''}
    <ul class="meal-list">${rows.join('')}</ul></section>`;
}

// The options for one meal, in a bottom sheet
export function renderSlotSheet(slotId, day) {
  const { list, all, sg, isToday } = daySlots(day);
  const sl = list.find((x) => x.id === slotId) || { id: slotId, name: SLOT_NAME[slotId] || 'Meal', time: '' };
  const options = slotOptions(slotId, all.filter((e) => e.slot === slotId));
  const suggested = sg.meal && sg.slot && sg.slot.id === slotId ? sg.meal.id : '';
  const ordered = options.slice().sort((a, b) => (a.id === suggested ? -1 : b.id === suggested ? 1 : 0));
  const pics = S.settings.planPhotos || {};
  const anyPic = options.some((m) => pics[m.id]); // thumbnails only when there is at least one to show
  const thumb = (m) => (!anyPic ? '' : pics[m.id] ? `<span class="meal-thumb"><img data-photo="${pics[m.id]}" alt=""></span>` : `<span class="meal-thumb is-empty">${PLATE}</span>`);
  return `
  <header class="sheet-top"><h2 id="sheet-title">${sl.name}</h2><button type="button" class="btn" data-act="close-sheet">Close</button></header>
  <p class="note">${sl.hint ? sl.hint + '. ' : ''}Tap what you ${isToday ? 'are having' : 'had'}.</p>
  <ul class="meal-list option-list">${ordered.map((m) => `<li class="meal"><button type="button" class="meal-main" data-act="log-plan" data-id="${m.id}">
      ${thumb(m)}
      <span class="meal-text"><b>${esc(m.name)}${m.id === suggested ? '<small>suggested</small>' : ''}</b><span>${n0(m.p)} g protein</span></span>
      <span class="meal-kcal"><b>${m.kcal}</b> kcal</span>
    </button></li>`).join('')}</ul>
  ${isToday ? `<p class="note">Something that is not on the plan:</p>
  <div class="actions"><button type="button" class="btn" data-act="slot-camera">Take a photo</button><button type="button" class="btn" data-act="compose">Type it</button></div>` : ''}`;
}

// The week's treats: one small one and one flexible dinner. A coin is whole until it is spent.
function treats(day) {
  const f = weekFlex(day);
  const row = (name, used, max) => {
    const state = used > max ? 'is-over' : used >= max ? 'is-used' : '';
    const text = used > max ? `${used - max} over` : used >= max ? 'Used' : `${max - used} left`;
    return `<li class="${state}"><i class="coin" aria-hidden="true"></i><span>${name}</span><b>${text}</b></li>`;
  };
  return `<section class="treats">
    <h2>This week’s treats</h2>
    <ul>
      ${row('Beer or small dessert', f.small, 1)}
      ${row('Flexible dinner', f.meal, 1)}
      ${f.off ? `<li class="is-over"><i class="coin" aria-hidden="true"></i><span>Off-plan entries</span><b>${f.off}</b></li>` : ''}
    </ul>
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
    1: ['Enter your first weigh-in', 'Tap “Weigh in” below. Progress and forecasts are calculated from your weigh-ins.', ''],
    2: ['Log your first meal', 'Tap “Log” next to the suggested meal under Today’s meals. No key needed.', ''],
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
  return `
  <header class="top">
    <div>
      <h1>${isToday ? 'Today' : esc(dWeekday.format(parseDay(day)))}</h1>
      <p class="sub">${esc(dShort.format(parseDay(day)))}${isToday ? '' : '. <button type="button" class="link link-inline" data-act="day-today">Back to today</button>'}</p>
    </div>
    <div class="top-actions">${settingsButton}</div>
  </header>
  ${isToday ? startCard() : ''}
  ${weekStrip(day)}
  ${bento(day, 'top')}
  ${dayList(day)}
  ${bento(day, 'more')}
  ${treats(day)}`;
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
    const mult = e.mult || 1;
    const canReanalyse = e.src === 'photo' || e.src === 'text';
    // Item table: what the total is made of. A last row accounts for any difference, so the column always adds up.
    const list = e.items || [];
    const itemSum = list.reduce((a, i) => a + (i.kcal || 0), 0) * mult;
    const rest = Math.round(v.kcal - itemSum);
    const restRow = list.length && itemSum > 0 && Math.abs(rest) >= 5
      ? `<tr class="items-rest"><th scope="row">${e.edited || (e.conf === 1 && !e.planId) ? 'Your edit' : 'Not itemised'}</th><td></td><td>${rest > 0 ? '+' : '−'}${n0(Math.abs(rest))}</td></tr>` : '';
    const items = list.length ? `<table class="items-table">
        <thead><tr><th scope="col">Item</th><th scope="col">Amount</th><th scope="col">kcal</th></tr></thead>
        <tbody>${list.map((i) => `<tr><th scope="row">${esc(i.n)}</th><td>${i.g ? n0(i.g * mult) + ' g' : ''}</td><td>${i.kcal ? n0(i.kcal * mult) : '–'}</td></tr>`).join('')}${restRow}</tbody>
      </table>` : '';
    // The person can always tell the model what it could not see; if the model asked, its question is the prompt
    const prompt = e.q || (e.src === 'photo' ? 'Something the photo does not show?' : 'Something to correct?');
    const question = canReanalyse ? `<div class="question${e.q ? ' is-asked' : ''}"><p id="ask-${e.id}">${esc(prompt)}</p><div><input id="answer-${e.id}" type="text" aria-labelledby="ask-${e.id}" enterkeyhint="send" autocomplete="off" placeholder="${e.q ? 'Answer briefly' : 'e.g. 2 eggs, low-fat cheese, baked'}"><button type="button" class="btn" data-act="answer" data-id="${e.id}">Update</button></div><p class="note">The model revises the items with your note.</p></div>` : '';
    const mults = [0.5, 1, 1.5, 2].map((m) => `<button type="button" data-act="mult" data-id="${e.id}" data-v="${m}" aria-pressed="${(e.mult || 1) === m}">${m === 1 ? '1' : multLabel(m)}</button>`).join('');
    const slotOptions = Object.entries(SLOT_NAME).map(([k, name]) => `<option value="${k}"${e.slot === k ? ' selected' : ''}>${name}</option>`).join('');
    body = `
      <p class="entry-value"><b>${n0(v.kcal)}</b> kcal<span>${n0(v.p)} g protein, ${n0(v.c)} g carbs, ${n0(v.f)} g fat</span></p>
      ${rough ? '<p class="status">Rough estimate. A short note below tightens it.</p>' : ''}
      ${items}
      ${question}
      <div class="actions">
        <div class="seg seg-small" role="group" aria-label="Portion">${mults}</div>
        ${tier}
      </div>
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
  const { head, line, a, target, started } = progressSummary();
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
    <p class="glide-note">${esc(line)}</p>
    ${track(a, target, started)}
    <p class="track-ends"><span>${s.startKg} kg</span><span>${s.targetKg} kg</span></p>
  </section>
  ${wins()}
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

// What has been collected so far: one token per kilo, and the runs of good days
function wins() {
  const s = S.settings;
  const a = avg7(today());
  const marks = [];
  for (let k = Math.ceil(s.startKg) - 1; k >= Math.ceil(s.targetKg); k--) marks.push(k);
  if (!Number.isInteger(s.targetKg)) marks.push(s.targetKg);
  const got = (kg) => !!a && today() >= s.startDate && a.kg <= kg + 1e-6;
  const reached = marks.filter(got).length;
  const h = history();
  const run = streak();
  const tokens = marks.map((kg, i) => `<li class="${got(kg) ? 'is-got' : ''}${i === marks.length - 1 ? ' is-goal' : ''}"${got(kg) ? '' : ' aria-label="' + kg + ' kg, not reached yet"'}>${kg}</li>`).join('');
  return `<section class="wins" aria-labelledby="wins-title">
    <h2 id="wins-title">${reached ? `${reached} of ${marks.length} kilos collected` : 'Kilos to collect'}</h2>
    <p class="note">Each one is yours when the 7-day average reaches it.</p>
    <ol class="kilos">${tokens}</ol>
    <dl class="stats">
      <div><dt>Streak</dt><dd>${run} ${run === 1 ? 'day' : 'days'}</dd></div>
      <div><dt>Best streak</dt><dd>${Math.max(h.best, run)} ${Math.max(h.best, run) === 1 ? 'day' : 'days'}</dd></div>
      <div><dt>On plan</dt><dd>${h.onPlan} of ${h.days}</dd></div>
      <div><dt>Perfect days</dt><dd>${h.perfect}</dd></div>
    </dl>
  </section>`;
}

// ——— Plan ———
// The picture of a plan meal: the person's own photo, or an invitation to add one
function planPic(id, emptyText) {
  const pid = (S.settings.planPhotos || {})[id];
  return `<span class="plan-pic${pid ? '' : ' is-empty'}"><span class="plan-pic-empty">${PLATE}${emptyText ? `<em>${emptyText}</em>` : ''}</span>${pid ? `<img data-photo="${pid}" alt="">` : ''}</span>`;
}

export function renderPlan() {
  const s = S.settings;
  const pictured = MEALS.filter((m) => (s.planPhotos || {})[m.id]).length;
  const slot = (id, title, time, note) => {
    const meals = MEALS.filter((m) => m.slot === id);
    return `<section class="plan-slot">
    <h2>${title}${time ? `<small>${time}</small>` : ''}</h2>${note ? `<p class="note">${note}</p>` : ''}
    <div class="plan-row${meals.length === 1 ? ' is-single' : ''}">${meals.map((m) => `<button type="button" class="plan-card" data-act="plan-meal" data-id="${m.id}" aria-label="${esc(`${m.name}, ${m.kcal} kcal, ${n0(m.p)} g protein. Details`)}">
        ${planPic(m.id, 'Add photo')}
        <span class="plan-name">${esc(m.name)}</span>
        <span class="plan-meta"><b>${m.kcal}</b> kcal<i>${n0(m.p)} g protein</i></span>
      </button>`).join('')}</div>
  </section>`;
  };
  const list = (items) => `<ul class="rules">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  const group = (title, body) => `<details class="rule-group"><summary><span>${title}</span></summary><div class="rule-body">${body}</div></details>`;
  return `
  <header class="top">
    <div><h1>Plan</h1><p class="sub">${pictured ? `${pictured} of ${MEALS.length} meals show your own photo.` : 'Tap a meal for its ingredients, and to add a photo of your own plate.'}</p></div>
    <div class="top-actions">${settingsButton}</div>
  </header>
  <ul class="plan-targets" aria-label="Daily targets">
    <li>Rest day <b>${n0(s.kcalRest)}</b> kcal</li>
    <li>Workout day <b>${n0(s.kcalTrain)}</b> kcal</li>
    <li>Protein <b>${s.protein}</b> g</li>
    <li>Fibre <b>${s.fiber}</b> g</li>
  </ul>
  ${slot('lunch', 'Lunch', '12:00', 'The first meal of the day.')}
  ${slot('snack1', 'Snack 1', '14:30', 'Most of the day’s protein: 250 g of skyr.')}
  ${slot('snack2', 'Snack 2', '16:00', 'On meatball or salmon days, cottage cheese tops up the protein.')}
  ${slot('dinner', 'Dinner', '18:00', 'Meat, chicken and fish by raw weight.')}
  ${slot('workout', 'Workout-day extras', '', 'Only on workout days; together about 200 kcal.')}
  ${slot('late', 'After 20:00', '', 'Herbal tea by default.')}
  <section class="plan-rules">
    <h2>The rules</h2>
    ${group('Dinner rotation', `<p class="note">Fish twice and legumes twice a week.</p><table class="table"><tbody>${RULES.rotation.map(([day, meal]) => `<tr><th scope="row">${day}</th><td>${esc(meal)}</td></tr>`).join('')}</tbody></table>`)}
    ${group('Every day', list(RULES.daily))}
    ${group('The week’s treats', list(RULES.weekly))}
    ${group('Off for the whole period', list(RULES.off))}
    ${group('Training and movement', list(RULES.training))}
    ${group('Process', list(RULES.process))}
  </section>`;
}

// Framing a new plan picture: the photo already has the house treatment; the circle shows what will be kept
export function renderFrameSheet(id) {
  const m = MEALS.find((x) => x.id === id);
  return `
  <header class="sheet-top"><h2 id="sheet-title">Frame the picture</h2><button type="button" class="btn" data-act="frame-cancel">Cancel</button></header>
  <p class="note">${esc(m ? m.name : '')}. Drag until the plate sits in the circle, zoom until it fills it.</p>
  <div class="frame-stage"><canvas id="frame-canvas" width="640" height="640" aria-label="Preview of the picture. Drag to move."></canvas><span class="frame-ring" aria-hidden="true"></span></div>
  <label class="frame-zoom" for="frame-zoom">Zoom<input id="frame-zoom" type="range" min="1" max="3" step="0.01" value="1"></label>
  <p class="note">Light and colour are evened out so all plan pictures match. Only this framed picture is stored, not the original photo.</p>
  <div class="actions"><button type="button" class="btn btn-primary btn-wide" data-act="frame-save">Use this picture</button></div>`;
}

// One plan meal: its picture, what goes into it, and a button to log it
export function renderPlanSheet(id) {
  const m = MEALS.find((x) => x.id === id);
  if (!m) return '';
  const has = !!(S.settings.planPhotos || {})[id];
  return `
  <header class="sheet-top"><h2 id="sheet-title">${esc(m.name)}</h2><button type="button" class="btn" data-act="close-sheet">Close</button></header>
  <div class="plan-photo">${planPic(id, 'No photo yet. Take one the next time you make this.')}</div>
  <div class="actions">
    <button type="button" class="btn" data-act="plan-photo-cam" data-id="${id}">${has ? 'Retake' : 'Take a photo'}</button>
    <button type="button" class="btn" data-act="plan-photo-lib" data-id="${id}">Choose a photo</button>
    ${has ? `<button type="button" class="link link-danger" data-act="plan-photo-remove" data-id="${id}">Remove photo</button>` : ''}
  </div>
  <p class="entry-value"><b>${m.kcal}</b> kcal<span>${n0(m.p)} g protein, ${n0(m.c)} g carbs, ${n0(m.f)} g fat, ${n0(m.fib)} g fibre</span></p>
  <table class="items-table">
    <thead><tr><th scope="col">Item</th><th scope="col">Amount</th><th scope="col">kcal</th></tr></thead>
    <tbody>${m.items.map((i) => `<tr><th scope="row">${esc(i.n)}${i.measure ? `<small>${esc(i.measure)}</small>` : ''}</th><td>${i.g} g</td><td>${n0(i.kcal)}</td></tr>`).join('')}</tbody>
  </table>
  <div class="actions"><button type="button" class="btn btn-primary btn-wide" data-act="log-plan-today" data-id="${id}">Log for today</button></div>`;
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
