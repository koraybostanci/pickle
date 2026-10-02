import {
  S, today, eff, mealsOf, dayTotals, dayTarget, dayStatus, avg7, weightSeries, projection,
  weekStart, weekFlex, streak, suggest, hasKey, APP_VERSION,
} from './app.js';
import { MODELS, PRESETS, ZEN_FREE } from './ai.js';
import { MEALS, SLOTS, SLOT_AD, FLEX, RULES, parseDay, addDays, diffDays, targetAt, dayKey } from './plan.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = (x) => Math.round(x).toLocaleString('tr-TR');
const n1 = (x) => (Math.round(x * 10) / 10).toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dLong = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const dShort = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' });
const dTiny = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' });
const hhmm = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

const ICON = {
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg>',
};

// ——— İniş cetveli: 86 → 78 arası, şu anki ortalama ve çizginin bugünkü yeri ———
function ruler(cur, line) {
  const s = S.set;
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
    ticks += `<line x1="${x(kg).toFixed(1)}" x2="${x(kg).toFixed(1)}" y1="${major ? 31 : 36}" y2="42" class="rt${major ? ' rt-m' : ''}"/>`;
    if (major) labels += `<text x="${x(kg).toFixed(1)}" y="57" text-anchor="middle" class="rl">${kg}</text>`;
  }
  const xc = cur ? x(cur) : null;
  const xl = x(line);
  const anchor = (px) => (px < 40 ? 'start' : px > W - 40 ? 'end' : 'middle');
  const tx = (px) => (px < 40 ? px - 6 : px > W - 40 ? px + 6 : px);
  return `<svg class="cetvel" viewBox="0 0 ${W} 62" role="img" aria-label="${esc(`${s.startKg} kilodan ${s.targetKg} kiloya cetvel. ${cur ? `Ortalaman ${n1(cur)} kilo.` : ''} Çizgi bugün ${n1(line)} kilo.`)}">
    <rect x="${pad}" y="26" width="${W - 2 * pad}" height="16" rx="3" class="r-track"/>
    ${xc != null ? `<rect x="${pad}" y="26" width="${Math.max(0, xc - pad).toFixed(1)}" height="16" rx="3" class="r-fill"/>` : ''}
    ${ticks}${labels}
    <circle cx="${xl.toFixed(1)}" cy="34" r="4.5" class="r-line"/>
    ${xc != null ? `<path d="M${(xc - 6).toFixed(1)} 15h12l-6 9z" class="r-cur"/><text x="${tx(xc).toFixed(1)}" y="11" text-anchor="${anchor(xc)}" class="r-val">${n1(cur)}</text>` : ''}
  </svg>`;
}

function lineSentence() {
  const s = S.set;
  const a = avg7(today());
  const line = targetAt(today(), s);
  const left = diffDays(today(), s.targetDate);
  const toStart = diffDays(today(), s.startDate);
  const src = !a ? '' : a.n >= 3 ? '7 günlük ortalaman' : a.n === 1 ? 'Son tartın' : `Son ${a.n} tartının ortalaması`;
  const when = toStart > 0 ? `Başlangıç ${dLong.format(parseDay(s.startDate))}` : left > 0 ? `${dShort.format(parseDay(s.targetDate))}’a ${left} gün` : 'Hedef tarihi geldi';
  let head;
  let sub;
  if (!a) {
    head = 'İlk tartını gir, çizgi oradan başlasın.';
    sub = `${when}. Hedef ${dShort.format(parseDay(s.targetDate))}, ${s.targetKg} kg.`;
  } else {
    const diff = a.kg - line;
    if (a.kg <= s.targetKg) head = `${s.targetKg} kg’a ulaştın.`;
    else if (Math.abs(diff) < 0.05) head = 'Tam çizgidesin.';
    else if (diff < 0) head = `Çizginin ${n1(-diff)} kg önündesin.`;
    else head = `Çizginin ${n1(diff)} kg gerisindesin.`;
    sub = `${src} ${n1(a.kg)} kg, çizgi bugün ${n1(line)} kg. ${when}.`;
  }
  return { head, sub, a, line, src, when };
}

// Bugün ekranının başı: cümle, cetvel, açıklama satırı ve günün tartısı
function inis() {
  const { head, a, line, src, when } = lineSentence();
  const kg = (S.days[today()] || {}).kg;
  return `<section class="inis" aria-label="Hedef çizgisi">
    ${!a && startStep() === 1 ? '' : `<p class="inis-h">${esc(head)}</p>`}
    ${ruler(a ? a.kg : null, line)}
    <p class="lej">${a ? `<span><i class="k-cur"></i>${esc(src.toLocaleLowerCase('tr-TR'))} ${n1(a.kg)}</span>` : ''}<span><i class="k-line"></i>çizgi bugün ${n1(line)}</span><span>${esc(when)}</span></p>
    <button type="button" class="satir" data-act="num" data-kind="kg"><span>Bugünkü tartı</span><b>${kg ? n1(kg) + ' kg' : '–'}</b><i>${kg ? 'Değiştir' : 'Gir'}</i></button>
  </section>`;
}

function tape(label, val, target, unit, step, lowerIsGood) {
  const max = target * 1.25;
  const v = Math.min(100, (val / max) * 100);
  const over = lowerIsGood && val > target * 1.07;
  const done = !lowerIsGood && val >= target;
  let note;
  if (lowerIsGood) note = val > target ? `${n0(val - target)} ${unit} üstünde` : `${n0(target - val)} ${unit} kaldı`;
  else note = done ? 'Hedef tamam' : `${n0(target - val)} ${unit} daha`;
  return `<div class="serit${over ? ' is-over' : ''}${done ? ' is-done' : ''}">
    <div class="serit-h"><h2>${label}</h2><p><b>${n0(val)}</b> / ${n0(target)}${unit === 'g' ? ' g' : ''}</p></div>
    <div class="tape" role="img" aria-label="${label}: ${n0(val)} / ${n0(target)} ${unit}" style="--v:${v.toFixed(1)}%;--tick:${((step / max) * 100).toFixed(3)}%"><i></i><b></b></div>
    <p class="serit-s">${note}</p>
  </div>`;
}

function entryMini(e) {
  const v = eff(e);
  const ok = e.status === 'ok';
  const state = S.busy.has(e.id) ? 'Analiz ediliyor' : e.status === 'error' ? 'Analiz edilemedi' : 'Analiz bekliyor';
  return `<button type="button" class="kayit${ok ? '' : ' kayit-p'}" data-act="open-entry" data-id="${e.id}">
    <span class="kayit-t">${esc(e.title)}${ok && e.mult && e.mult !== 1 ? ` ×${String(e.mult).replace('.', ',')}` : ''}</span>
    <span class="kayit-v">${ok ? `${n0(v.kcal)} kcal, ${n0(v.p)} g protein` : state}</span>
  </button>`;
}

const chip = (m, act = 'log-plan') => `<button type="button" class="chip" data-act="${act}" data-id="${m.id}">${esc(m.ad)} <span>${m.kcal}</span></button>`;
const CAM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.6A1.5 1.5 0 0 1 10 3.7h4a1.5 1.5 0 0 1 1.3.7l1 1.6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.4" r="3.4"/></svg>';

// Sıradaki öğün: ekranın tek birincil eylemi
function nextCard(day) {
  const sg = suggest(day);
  const isToday = day === today();
  if (sg.rem < -50) {
    return `<section class="sira"><h2>Bütçe ${n0(-sg.rem)} kcal aşıldı</h2><p class="sira-n">Yarın plana dön. Telafi için öğün atlama; haftalık ortalama belirleyici.</p></section>`;
  }
  if (!sg.meal) {
    return `<section class="sira"><h2>Öğünler tamam</h2><p class="sira-n">${sg.remP > 12 ? `Protein ${n0(sg.remP)} g eksik kaldı.` : 'Gün hedefte.'}</p></section>`;
  }
  if (sg.extra) {
    return `<section class="sira"><h2>Öğünler tamam</h2><p class="sira-n">Protein ${n0(sg.remP)} g eksik. 150 g sade skyr bunu kapatır ve bütçeye sığar.</p>
      <button type="button" class="btn btn-p btn-w" data-act="log-plan" data-id="${sg.meal.id}">Skyr’i kaydet, ${sg.meal.kcal} kcal</button></section>`;
  }
  const [h, m] = sg.slot.saat.split(':').map(Number);
  const now = new Date();
  const late = isToday && now.getHours() * 60 + now.getMinutes() > h * 60 + m + 120;
  const others = MEALS.filter((x) => x.slot === sg.slot.id && x.id !== sg.meal.id);
  return `<section class="sira" aria-labelledby="sira-h">
    <p class="sira-k" id="sira-h">${late ? 'Kayıt yok' : isToday ? 'Sıradaki öğün' : 'Eksik öğün'}: ${esc(sg.slot.ad.toLocaleLowerCase('tr-TR'))}, ${sg.slot.saat}</p>
    <h2>${esc(sg.meal.ad)}</h2>
    <p class="sira-n">${sg.meal.kcal} kcal, ${n0(sg.meal.p)} g protein, ${sg.tight ? 'en hafif seçenek' : 'bütçene uygun'}.</p>
    <button type="button" class="btn btn-p btn-w" data-act="log-plan" data-id="${sg.meal.id}">Kaydet</button>
    <p class="sira-d">Başka bir şey mi yedin?</p>
    <div class="chips">${others.map((x) => chip(x)).join('')}${isToday ? `<button type="button" class="chip chip-i" data-act="cam">${CAM}Fotoğrafını çek</button>` : ''}</div>
  </section>`;
}

function dayList(day) {
  const dd = S.days[day] || {};
  const all = S.entries.filter((e) => e.day === day && e.kind === 'meal');
  const sg = suggest(day);
  const nextId = sg.meal && !sg.extra && sg.slot ? sg.slot.id : '';
  const rows = [];
  const mk = (id, ad, saat, hint) => {
    const es = all.filter((e) => e.slot === id).sort((x, y) => x.ts - y.ts);
    const done = es.some((e) => e.status === 'ok');
    const logged = new Set(es.map((e) => e.planId));
    const opts = MEALS.filter((x) => x.slot === id && !(id === 'ant' && logged.has(x.id)));
    let body = es.map(entryMini).join('');
    if (id === nextId && !es.length) body += '<p class="slot-h">Yukarıdaki kartta.</p>';
    else if ((!es.length || id === 'ant') && opts.length) {
      body += `<details class="slot-d" data-slot="${id}"${S.openSlots.has(id) ? ' open' : ''}><summary>${hint || 'Seçenekleri göster'}</summary><div class="chips">${opts.map((x) => chip(x)).join('')}</div></details>`;
    }
    rows.push(`<li class="slot${done ? ' is-done' : ''}${id === nextId ? ' is-next' : ''}">
      <div class="slot-t">${saat}</div>
      <div class="slot-b"><h3>${ad}</h3>${body}</div>
    </li>`);
  };
  if (all.some((e) => e.slot === 'sabah')) mk('sabah', 'Sabah', '', '');
  SLOTS.filter((x) => x.id !== 'gece').forEach((x) => mk(x.id, x.ad, x.saat, ''));
  if (dd.train || all.some((e) => e.slot === 'ant')) mk('ant', 'Antrenman ekleri', '', 'Öncesinde muz, sonrasında skyr');
  mk('gece', SLOT_AD.gece, '20:00', 'Bitki çayı; çok açsan skyr');
  return `<section class="ogunler"><h2>Günün öğünleri</h2>
    <button type="button" class="anahtar" role="switch" aria-checked="${dd.train ? 'true' : 'false'}" data-act="train" data-v="${dd.train ? 0 : 1}">
      <i aria-hidden="true"></i><span>Antrenman günü</span><small>${dd.train ? `hedef ${n0(S.set.kcalTrain)} kcal, muz ve skyr eklenir` : `hedef ${n0(S.set.kcalRest)} kcal`}</small>
    </button>
    <ol class="slots">${rows.join('')}</ol></section>`;
}

function counters(day) {
  const dd = S.days[day] || {};
  const water = dd.water || 0;
  const lt = (ml) => (ml / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  return `<section class="sayac" aria-label="Adım ve su">
    <button type="button" class="satir" data-act="num" data-kind="steps">
      <span>Adım</span><b>${dd.steps ? n0(dd.steps) : '–'}</b><small>/ ${n0(S.set.steps)}</small><i>${dd.steps ? 'Değiştir' : 'Gir'}</i>
    </button>
    <div class="satir">
      <span id="su-l">Su</span><b>${lt(water)} l</b><small>/ ${lt(S.set.water)} l</small>
      <div class="su-c" role="group" aria-labelledby="su-l">
        <button type="button" data-act="water" data-v="-250" aria-label="250 ml azalt"${water ? '' : ' disabled'}>−</button>
        <button type="button" data-act="water" data-v="250" aria-label="250 ml ekle">+</button>
      </div>
    </div>
  </section>`;
}

function flexBlock(day) {
  const f = weekFlex(day);
  const pips = (n, max) => Array.from({ length: Math.max(max, n) }, (_, i) => `<i class="${i < n ? (i < max ? 'on' : 'on over') : ''}"></i>`).join('');
  return `<section class="hafta">
    <h2>Bu haftanın esnek bütçesi</h2>
    <dl>
      <div><dt>Bira ya da küçük tatlı</dt><dd><span class="pips">${pips(f.kucuk, 1)}</span>${f.kucuk} / 1</dd></div>
      <div><dt>Esnek akşam yemeği</dt><dd><span class="pips">${pips(f.ogun, 1)}</span>${f.ogun} / 1</dd></div>
      ${f.yok ? `<div><dt>Plan dışı kayıt</dt><dd>${f.yok}</dd></div>` : ''}
    </dl>
    ${day === today() ? `<div class="chips">${FLEX.map((x) => chip(x, 'log-flex')).join('')}</div>` : ''}
  </section>`;
}

// İlk kullanım: sıradaki tek adımı gösterir; bitince ya da gizlenince kaybolur
function startStep() {
  if (S.set.hideStart) return 0;
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
    1: ['İlk tartını gir', 'Çizgi ve tahminler tartıdan hesaplanır.', '<button type="button" class="btn btn-p" data-act="num" data-kind="kg">Tartıyı gir</button>'],
    2: ['İlk öğününü kaydet', 'Aşağıdaki kartta “Kaydet”e dokun. Anahtar gerekmez.', ''],
    3: ['Fotoğraf analizi için anahtar ekle', 'Gemini’nin ücretsiz katmanı yeterli. Plan öğünleri anahtarsız çalışır.', '<button type="button" class="btn btn-p" data-act="settings" data-sec="analiz">Anahtar ekle</button>'],
    4: ['Ana ekrana ekle', 'Tarayıcının Paylaş menüsünden “Ana Ekrana Ekle”. Veriler böyle daha kalıcı olur.', ''],
  }[n];
  return `<section class="basla" aria-labelledby="basla-h">
    <div class="basla-h"><p>Başlarken, adım ${n} / 4</p><button type="button" class="lnk" data-act="hide-start">${n === 4 ? 'Tamam' : 'Gizle'}</button></div>
    <h2 id="basla-h">${step[0]}</h2>
    <p class="basla-n">${step[1]}</p>
    ${step[2]}
  </section>`;
}

export function renderBugun() {
  const day = S.viewDay;
  const isToday = day === today();
  const tot = dayTotals(day);
  const tg = dayTarget(day);
  const dd = S.days[day] || {};
  return `
  <header class="top">
    <div>
      <h1>${isToday ? 'Bugün' : esc(dShort.format(parseDay(day)))}</h1>
      <p class="sub">${isToday ? esc(dLong.format(parseDay(day))) : `${esc(new Intl.DateTimeFormat('tr-TR', { weekday: 'long' }).format(parseDay(day)))}. <button type="button" class="lnk lnk-i" data-act="day-today">Bugüne dön</button>`}</p>
    </div>
    <div class="top-r">
      <button type="button" class="ib" data-act="day-prev" aria-label="Önceki gün">${ICON.prev}</button>
      <button type="button" class="ib" data-act="day-next" aria-label="Sonraki gün"${isToday ? ' disabled' : ''}>${ICON.next}</button>
      <button type="button" class="ib" data-act="settings" aria-label="Ayarlar">${ICON.gear}</button>
    </div>
  </header>
  ${isToday ? startCard() : ''}
  ${isToday ? inis() : `<section class="inis"><button type="button" class="satir" data-act="num" data-kind="kg"><span>Bu günün tartısı</span><b>${dd.kg ? n1(dd.kg) + ' kg' : 'Yok'}</b><i>${dd.kg ? 'Değiştir' : 'Gir'}</i></button></section>`}
  <section class="butce" aria-label="Günlük bütçe">
    <div class="butce-g">
      ${tape('Kalori', tot.kcal, tg, 'kcal', 100, true)}
      ${tape('Protein', tot.p, S.set.protein, 'g', 10, false)}
    </div>
  </section>
  ${nextCard(day)}
  ${dayList(day)}
  ${counters(day)}
  ${flexBlock(day)}`;
}

// ——— Alt sayfalar ———
export function renderNumSheet(kind, day) {
  const dd = S.days[day] || {};
  const isKg = kind === 'kg';
  const cur = isKg ? dd.kg : dd.steps;
  const dayTxt = day === today() ? 'Bugünkü' : esc(dShort.format(parseDay(day)));
  return `
  <header class="sh-top"><h2 id="sheet-title">${dayTxt} ${isKg ? 'tartı' : 'adım'}</h2><button type="button" class="btn" data-act="close-sheet">Vazgeç</button></header>
  <form id="num-form" class="num" data-kind="${kind}" data-day="${day}" autocomplete="off">
    <label for="num-in" class="dip">${isKg ? 'Sabah, aynı koşulda tartıl. Tek günlük sayı oynar; hesap 7 günlük ortalamadan yapılır.' : `Telefonun Sağlık uygulamasındaki günlük adım sayısı. Hedef ${n0(S.set.steps)}.`}</label>
    <div class="num-r"><input id="num-in" type="text" inputmode="${isKg ? 'decimal' : 'numeric'}" value="${cur ? (isKg ? n1(cur) : String(cur)) : ''}" placeholder="${isKg ? n1(S.set.startKg) : '8000'}" enterkeyhint="done"><span>${isKg ? 'kg' : 'adım'}</span></div>
    <p class="dip is-err" id="num-err" role="alert" hidden></p>
    <button type="submit" class="btn btn-p btn-w">Kaydet</button>
    ${cur ? `<button type="button" class="lnk lnk-del" data-act="num-clear" data-kind="${kind}" data-day="${day}">${isKg ? 'Tartıyı sil' : 'Adımı sil'}</button>` : ''}
  </form>`;
}

export function renderEntrySheet(id) {
  const e = S.entries.find((x) => x.id === id);
  if (!e) return '';
  return `
  <header class="sh-top"><h2 id="sheet-title">Kayıt</h2><button type="button" class="btn" data-act="close-sheet">Kapat</button></header>
  ${entryCard(e, true)}`;
}

// ——— Akış ———
function entryCard(e, inSheet = false) {
  const busy = S.busy.has(e.id);
  const when = `${hhmm(e.ts)}${{ exif: ', saat fotodan', file: ', saat dosyadan', manual: ', elle', now: '' }[e.timeSrc] || ''}`;
  if (e.kind === 'weight' || e.kind === 'steps') {
    return `<article class="not" data-entry="${e.id}">
      <p><b>${esc(e.title)}</b><span>${when}</span></p>
      <button type="button" class="lnk" data-act="del" data-id="${e.id}">Sil</button>
    </article>`;
  }
  const v = eff(e);
  const photos = (e.photoIds || []).map((p) => `<img data-photo="${p}" alt="Öğün fotoğrafı">`).join('');
  const meta = [when, SLOT_AD[e.slot] || '', e.place ? (e.place === 'dışarı' ? 'dışarıda' : esc(e.place)) : ''].filter(Boolean).join(', ');
  let body;
  if (busy) {
    body = `<p class="durum"><span class="spin" aria-hidden="true"></span>${esc(S.retry.get(e.id) || 'Analiz ediliyor')}</p>`;
  } else if (e.status === 'pending') {
    body = `<p class="durum">${esc(e.err || 'Analiz bekliyor.')}</p><div class="k-act"><button type="button" class="btn" data-act="analyze" data-id="${e.id}">Analiz et</button><button type="button" class="lnk" data-act="del" data-id="${e.id}">Sil</button></div>`;
  } else if (e.status === 'error') {
    body = `<p class="durum is-err">${esc(e.err || 'Analiz başarısız oldu.')}</p><div class="k-act"><button type="button" class="btn" data-act="analyze" data-id="${e.id}">Tekrar dene</button><button type="button" class="lnk" data-act="del" data-id="${e.id}">Sil</button></div>`;
  } else {
    const tier = e.tier === 'yok' ? '<span class="tag tag-yok">Plan dışı</span>' : e.tier === 'esnek' ? '<span class="tag tag-esnek">Esnek bütçe</span>' : e.planId ? '<span class="tag">Plan öğünü</span>' : '';
    const low = e.conf > 0 && e.conf < 0.6 && !e.planId;
    const items = (e.items || []).length ? `<ul class="icerik">${e.items.map((i) => `<li><span>${esc(i.n)}</span><span>${i.g ? n0(i.g * (e.mult || 1)) + ' g' : ''}</span></li>`).join('')}</ul>` : '';
    const q = e.q ? `<div class="soru"><p>${esc(e.q)}</p><div><label class="sr" for="ans-${e.id}">Yanıtın</label><input id="ans-${e.id}" type="text" placeholder="Kısaca yanıtla"><button type="button" class="btn" data-act="answer" data-id="${e.id}">Düzelt</button></div></div>` : '';
    const mults = [0.5, 1, 1.5, 2].map((m) => `<button type="button" data-act="mult" data-id="${e.id}" data-v="${m}" aria-pressed="${(e.mult || 1) === m}">${{ 0.5: '½', 1: '1', 1.5: '1½', 2: '2' }[m]}</button>`).join('');
    const slotOpts = Object.entries(SLOT_AD).map(([k, ad]) => `<option value="${k}"${e.slot === k ? ' selected' : ''}>${ad}</option>`).join('');
    body = `
      <p class="deger"><b>${n0(v.kcal)}</b> kcal<span>${n0(v.p)} g protein, ${n0(v.c)} g karbonhidrat, ${n0(v.f)} g yağ</span></p>
      ${low ? '<p class="durum">Tahmin belirsiz. Porsiyonu düzelt ya da kısa bir not ekle.</p>' : ''}
      ${e.planId ? '' : items}${q}
      <div class="k-act">
        <div class="seg seg-s" role="group" aria-label="Porsiyon">${mults}</div>
        ${tier}
      </div>
      <details class="duzen"${inSheet ? ' open' : ''}>
        <summary>${e.planId ? 'İçerik ve düzenleme' : 'Düzenle'}</summary>
        ${e.planId ? items : ''}
        <div class="duzen-g">
          <label for="ek-${e.id}">Kalori<input id="ek-${e.id}" type="text" inputmode="numeric" value="${n0(v.kcal).replace(/\./g, '')}"></label>
          <label for="ep-${e.id}">Protein (g)<input id="ep-${e.id}" type="text" inputmode="decimal" value="${n0(v.p)}"></label>
          <label for="es-${e.id}">Öğün<select id="es-${e.id}">${slotOpts}</select></label>
          <label for="et-${e.id}">Saat<input id="et-${e.id}" type="time" value="${hhmm(e.ts)}"></label>
        </div>
        <div class="k-act">
          <button type="button" class="btn" data-act="save-edit" data-id="${e.id}">Kaydet</button>
          <button type="button" class="lnk" data-act="fav" data-id="${e.id}">Sık yenenlere ekle</button>
          ${e.src !== 'plan' && e.src !== 'fav' && e.src !== 'flex' ? `<button type="button" class="lnk" data-act="reanalyze" data-id="${e.id}">${S.set.provider === 'openai' ? 'Yeniden analiz et' : 'Sonnet ile yeniden analiz et'}</button>` : ''}
          <button type="button" class="lnk lnk-del" data-act="del" data-id="${e.id}">Sil</button>
        </div>
      </details>`;
  }
  return `<article class="kart${inSheet ? ' kart-s' : ''}" data-entry="${e.id}">
    ${photos ? `<div class="kart-f${(e.photoIds || []).length > 1 ? ' kart-f-n' : ''}">${photos}</div>` : ''}
    <div class="kart-b">
      <h3>${esc(e.title)}</h3>
      <p class="meta">${meta}</p>
      ${e.text && e.src === 'photo' ? `<p class="meta">Not: ${esc(e.text)}</p>` : ''}
      ${body}
    </div>
  </article>`;
}

export function renderAkis() {
  const pend = S.entries.filter((e) => e.status === 'pending' && !S.busy.has(e.id));
  const byDay = new Map();
  for (const e of S.entries.slice().sort((a, b) => b.ts - a.ts)) {
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day).push(e);
  }
  const t = today();
  const dayName = (d) => (d === t ? 'Bugün' : d === addDays(t, -1) ? 'Dün' : dLong.format(parseDay(d)));
  const groups = Array.from(byDay.entries()).slice(0, 45).map(([d, es]) => {
    const tot = dayTotals(d);
    return `<section class="gun">
      <header><h2>${esc(dayName(d))}</h2><p>${tot.n ? `${n0(tot.kcal)} / ${n0(dayTarget(d))} kcal, ${n0(tot.p)} g protein` : ''}</p></header>
      ${es.map(entryCard).join('')}
    </section>`;
  }).join('');
  const keyHint = hasKey() ? '' : `<div class="uyari"><p>Fotoğraf ve serbest metin analizi için bir model anahtarı gerekiyor. Plan öğünleri, tartı ve adım anahtarsız çalışır.</p><button type="button" class="btn" data-act="settings" data-sec="analiz">Anahtar ekle</button></div>`;
  const pendBar = pend.length && hasKey() ? `<div class="uyari"><p>${pend.length} kayıt analiz bekliyor.</p><button type="button" class="btn" data-act="analyze-all">Hepsini analiz et</button></div>` : '';
  return `
  <header class="top">
    <div><h1>Akış</h1><p class="sub">Gönderdiklerin, yeniden eskiye.</p></div>
    <div class="top-r"><button type="button" class="ib" data-act="settings" aria-label="Ayarlar">${ICON.gear}</button></div>
  </header>
  ${keyHint}${pendBar}
  ${groups || `<div class="bos"><p>Henüz kayıt yok.</p><p>Gönderdiğin her şey burada sıralanır: fotoğraf, yazdığın öğün, tartı, adım.</p>
    <div class="k-act"><button type="button" class="btn btn-p" data-act="cam">Fotoğraf çek</button><button type="button" class="btn" data-act="lib">Galeriden seç</button></div>
    <p>Yazarak da olur. Aşağıdaki kutuya dokununca örnekler çıkar.</p></div>`}`;
}

// ——— İlerleme ———
let chartData = null;

function weightChart() {
  const s = S.set;
  const ws = weightSeries();
  const W = 340;
  const H = 210;
  const m = { l: 30, r: 34, t: 16, b: 26 };
  let x0 = s.startDate;
  if (ws.length && ws[0].day < x0) x0 = diffDays(ws[0].day, s.startDate) > 21 ? addDays(s.startDate, -21) : ws[0].day;
  const x1 = s.targetDate;
  const span = diffDays(x0, x1);
  const vis = ws.filter((d) => d.day >= x0 && d.day <= x1);
  const maxW = Math.max(s.startKg, ...vis.map((d) => d.kg));
  const minW = Math.min(s.targetKg, ...vis.map((d) => d.kg));
  const y1 = Math.ceil(maxW + 0.3);
  const y0 = Math.floor(minW - 0.3);
  const X = (day) => m.l + (diffDays(x0, day) / span) * (W - m.l - m.r);
  const Y = (kg) => m.t + ((y1 - kg) / (y1 - y0)) * (H - m.t - m.b);
  let grid = '';
  const stepY = y1 - y0 > 10 ? 2 : 1;
  for (let k = y0; k <= y1; k += stepY) {
    grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(k).toFixed(1)}" y2="${Y(k).toFixed(1)}" class="c-grid"/><text x="${m.l - 6}" y="${(Y(k) + 3.5).toFixed(1)}" text-anchor="end" class="c-ax">${k}</text>`;
  }
  let xt = '';
  const mon = new Intl.DateTimeFormat('tr-TR', { month: 'short' });
  for (let i = 0; i <= span; i++) {
    const d = addDays(x0, i);
    if (d.endsWith('-01') || i === 0) {
      const px = X(d);
      if (i !== 0 && px - m.l < 26) continue;
      xt += `<text x="${px.toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : 'middle'}" class="c-ax">${i === 0 ? esc(dTiny.format(parseDay(d))) : esc(mon.format(parseDay(d)))}</text>`;
    }
  }
  const tgt = `<line x1="${X(s.startDate).toFixed(1)}" y1="${Y(s.startKg).toFixed(1)}" x2="${X(s.targetDate).toFixed(1)}" y2="${Y(s.targetKg).toFixed(1)}" class="c-tgt"/>
    <text x="${(X(s.targetDate) + 6).toFixed(1)}" y="${(Y(s.targetKg) + 4).toFixed(1)}" class="c-lbl">${s.targetKg} kg</text>`;
  const dots = vis.map((d) => `<circle cx="${X(d.day).toFixed(1)}" cy="${Y(d.kg).toFixed(1)}" r="2.2" class="c-dot"/>`).join('');
  const avgPts = [];
  if (vis.length) {
    const last = vis[vis.length - 1].day;
    for (let d = vis[0].day; d <= last; d = addDays(d, 1)) {
      const a = avg7(d);
      if (a) avgPts.push({ day: d, kg: a.kg });
    }
  }
  const path = avgPts.map((p, i) => `${i ? 'L' : 'M'}${X(p.day).toFixed(1)} ${Y(p.kg).toFixed(1)}`).join(' ');
  const end = avgPts[avgPts.length - 1];
  const tx = today() >= x0 && today() <= x1 ? `<line x1="${X(today()).toFixed(1)}" x2="${X(today()).toFixed(1)}" y1="${m.t}" y2="${H - m.b}" class="c-today"/>` : '';
  chartData = { x0, span, m, W, H, avg: Object.fromEntries(avgPts.map((p) => [p.day, p.kg])) };
  return `<div class="grafik">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Kilo grafiği: hedef çizgisi, günlük tartılar ve 7 günlük ortalama">
      ${grid}${xt}${tx}${tgt}${dots}
      ${path ? `<path d="${path}" class="c-avg"/>` : ''}
      ${end ? `<circle cx="${X(end.day).toFixed(1)}" cy="${Y(end.kg).toFixed(1)}" r="4.5" class="c-end"/>` : ''}
      <line id="c-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" class="c-cross" visibility="hidden"/>
    </svg>
    <div class="tip" id="c-tip" hidden></div>
    <p class="lej"><span><i class="k-avg"></i>7 günlük ortalama</span><span><i class="k-tgt"></i>hedef çizgisi</span><span><i class="k-dot"></i>günlük tartı</span></p>
  </div>`;
}

export function attachChart(root) {
  const svg = root.querySelector('.grafik svg');
  const tip = root.querySelector('#c-tip');
  const cross = root.querySelector('#c-cross');
  if (!svg || !chartData) return;
  const { x0, span, m, W } = chartData;
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
    if (d && d.kg) rows.push([n1(d.kg) + ' kg', 'tartı']);
    if (chartData.avg[day]) rows.push([n1(chartData.avg[day]) + ' kg', 'ortalama']);
    if (day >= S.set.startDate) rows.push([n1(targetAt(day, S.set)) + ' kg', 'çizgi']);
    tip.innerHTML = '';
    rows.forEach(([v, l], k) => {
      const p = document.createElement('p');
      const b = document.createElement(k ? 'b' : 'span');
      b.textContent = v;
      p.append(b);
      if (l) { const sp = document.createElement('span'); sp.textContent = ' ' + l; p.append(sp); }
      tip.append(p);
    });
    tip.hidden = false;
    const left = (cx / W) * r.width;
    tip.style.left = Math.min(Math.max(left, 64), r.width - 64) + 'px';
  };
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}

function calendar() {
  const s = S.set;
  const t = today();
  const first = weekStart(s.startDate);
  const weeks = Math.ceil((diffDays(first, s.targetDate) + 1) / 7);
  const mon = new Intl.DateTimeFormat('tr-TR', { month: 'short' });
  const LBL = { hedefte: 'hedefte', yakin: 'yakın', ustunde: 'üstünde', eksik: 'eksik kayıt', yok: 'kayıt yok' };
  let rows = '';
  for (let w = 0; w < weeks; w++) {
    const ws = addDays(first, w * 7);
    let label = '';
    for (let i = 0; i < 7; i++) { const d = addDays(ws, i); if (d.endsWith('-01') || (w === 0 && i === 0)) label = mon.format(parseDay(d)); }
    let cells = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d < s.startDate || d > s.targetDate) { cells += '<span class="g g-out"></span>'; continue; }
      if (d > t) { cells += `<span class="g g-fut" title="${esc(dShort.format(parseDay(d)))}"></span>`; continue; }
      const st = dayStatus(d);
      cells += `<button type="button" class="g g-${st}${d === t ? ' g-today' : ''}${S.calPick === d ? ' g-sel' : ''}" data-act="cal" data-day="${d}" aria-label="${esc(dShort.format(parseDay(d)))}: ${LBL[st]}"></button>`;
    }
    rows += `<div class="tk-r"><span class="tk-m">${esc(label)}</span>${cells}</div>`;
  }
  let pick = '';
  if (S.calPick) {
    const d = S.calPick;
    const tot = dayTotals(d);
    const dd = S.days[d] || {};
    pick = `<p class="tk-p"><b>${esc(dLong.format(parseDay(d)))}</b>: ${tot.n ? `${n0(tot.kcal)} / ${n0(dayTarget(d))} kcal, ${n0(tot.p)} g protein` : 'öğün kaydı yok'}${dd.kg ? `, tartı ${n1(dd.kg)} kg` : ''}. <button type="button" class="lnk lnk-i" data-act="goto-day" data-day="${d}">Günü aç</button></p>`;
  }
  return `<div class="takvim">
    <div class="tk-r tk-head"><span class="tk-m"></span>${['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map((x) => `<span>${x}</span>`).join('')}</div>
    ${rows}
    <p class="lej"><span><i class="g g-hedefte"></i>hedefte</span><span><i class="g g-yakin"></i>yakın</span><span><i class="g g-ustunde"></i>üstünde</span><span><i class="g g-yok"></i>kayıt yok</span></p>
    ${pick}
  </div>`;
}

function checkpoints() {
  const s = S.set;
  const total = diffDays(s.startDate, s.targetDate);
  const pts = [];
  for (let i = 28; i < total - 6; i += 28) pts.push(addDays(s.startDate, i));
  pts.push(s.targetDate);
  const t = today();
  return `<table class="tablo"><thead><tr><th scope="col">Tarih</th><th scope="col">Çizgi</th><th scope="col">Ortalaman</th></tr></thead><tbody>
    ${pts.map((d) => { const a = d <= t ? avg7(d) : null; return `<tr><td>${esc(dShort.format(parseDay(d)))}</td><td>${n1(targetAt(d, s))} kg</td><td>${a ? n1(a.kg) + ' kg' : '–'}</td></tr>`; }).join('')}
  </tbody></table>`;
}

function adjustBanner() {
  const s = S.set;
  const t = today();
  if (diffDays(s.startDate, t) < 14) return '';
  const a = avg7(t);
  const b = avg7(addDays(t, -7));
  if (!a || !b || a.n < 3 || b.n < 3) return '';
  if (a.kg - targetAt(t, s) > 0.7 && b.kg - targetAt(addDays(t, -7), s) > 0.7) {
    return `<div class="uyari"><p>Ortalaman iki haftadır çizginin 0,7 kg’dan fazla üstünde. Günlük kaloriyi 100 kcal düş ya da 2.000 adım ekle. ${n0(Math.max(1500, s.kcalRest - 100))} kcal’in altına inme.</p><button type="button" class="btn" data-act="settings">Hedefleri aç</button></div>`;
  }
  return '';
}

export function renderIlerleme() {
  const s = S.set;
  const { head, sub, a, line } = lineSentence();
  const pr = projection();
  const ws = weightSeries();
  const lost = a ? s.startKg - a.kg : 0;
  const st = streak();
  const rows = ws.slice().reverse().slice(0, 120).map((d) => {
    const av = avg7(d.day);
    const tot = dayTotals(d.day);
    return `<tr><td>${esc(dTiny.format(parseDay(d.day)))}</td><td>${n1(d.kg)}</td><td>${av ? n1(av.kg) : '–'}</td><td>${d.day >= s.startDate ? n1(targetAt(d.day, s)) : '–'}</td><td>${tot.n ? n0(tot.kcal) : '–'}</td></tr>`;
  }).join('');
  return `
  <header class="top">
    <div><h1>İlerleme</h1><p class="sub">${esc(dShort.format(parseDay(s.startDate)))} – ${esc(dShort.format(parseDay(s.targetDate)))}, ${s.startKg} kg’dan ${s.targetKg} kg’a</p></div>
    <div class="top-r"><button type="button" class="ib" data-act="settings" aria-label="Ayarlar">${ICON.gear}</button></div>
  </header>
  ${adjustBanner()}
  <section class="inis">
    <p class="inis-h">${esc(head)}</p>
    ${ruler(a ? a.kg : null, line)}
    <p class="inis-s">${esc(sub)}</p>
  </section>
  <section>
    ${weightChart()}
    <dl class="ozet">
      <div><dt>Verilen</dt><dd>${a ? n1(Math.max(0, lost)) + ' kg' : '–'}</dd></div>
      <div><dt>Kalan</dt><dd>${a ? n1(Math.max(0, a.kg - s.targetKg)) + ' kg' : n1(s.startKg - s.targetKg) + ' kg'}</dd></div>
      <div><dt>Haftalık hız</dt><dd>${pr ? n1(pr.perWeek).replace('-', '−') + ' kg' : '–'}</dd></div>
      <div><dt>Tahmini varış</dt><dd>${pr && pr.eta ? esc(dTiny.format(parseDay(pr.eta))) : '–'}</dd></div>
    </dl>
    ${pr ? '' : '<p class="dip">Haftalık hız ve tahmini varış, en az bir haftaya yayılmış 4 tartıdan sonra görünür.</p>'}
  </section>
  <section>
    <h2>Uyum takvimi</h2>
    <p class="dip">${st > 0 ? `${st} gündür plandasın.` : 'Hedefte ya da yakın geçen günler seri oluşturur.'}</p>
    ${calendar()}
  </section>
  <section>
    <h2>Kontrol noktaları</h2>
    ${checkpoints()}
  </section>
  <section>
    <details class="tablo-d">
      <summary>Tartı tablosu</summary>
      ${rows ? `<table class="tablo"><thead><tr><th scope="col">Gün</th><th scope="col">Tartı</th><th scope="col">Ort.</th><th scope="col">Çizgi</th><th scope="col">kcal</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="dip">Henüz tartı yok. Bugün ekranından ya da akışa sayı yazarak gir.</p>'}
    </details>
  </section>`;
}

// ——— Plan ———
export function renderPlan() {
  const s = S.set;
  const sec = (id, title, note) => `<section class="p-ogun">
    <h2>${title}</h2>${note ? `<p class="dip">${note}</p>` : ''}
    ${MEALS.filter((m) => m.slot === id).map((m) => `<details class="p-sec">
      <summary><span>${esc(m.ad)}</span><span class="p-v">${m.kcal} kcal, ${n0(m.p)} g protein</span></summary>
      <ul class="icerik">${m.items.map((i) => `<li><span>${esc(i.n)}</span><span>${i.g} g${i.olcu ? ` (${esc(i.olcu)})` : ''}</span></li>`).join('')}</ul>
      <p class="dip">Karbonhidrat ${n0(m.c)} g, yağ ${n0(m.f)} g, lif ${n0(m.fib)} g.</p>
    </details>`).join('')}
  </section>`;
  const list = (items) => `<ul class="kural">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `
  <header class="top">
    <div><h1>Plan</h1><p class="sub">Dinlenme günü ${n0(s.kcalRest)} kcal, antrenman günü ${n0(s.kcalTrain)} kcal. Protein ${s.protein} g, lif en az ${s.fiber} g.</p></div>
    <div class="top-r"><button type="button" class="ib" data-act="settings" aria-label="Ayarlar">${ICON.gear}</button></div>
  </header>
  ${sec('ogle', 'Öğle, saat 12:00', 'Günün ilk öğünü. Dört seçenekten biri.')}
  ${sec('ara1', '1. ara öğün', 'Proteinin büyük kısmı buradan gelir; skyr 250 g.')}
  ${sec('ara2', '2. ara öğün', 'Köfte ya da somon günlerinde cottage seçeneği proteini tamamlar.')}
  ${sec('aksam', 'Akşam, saat 18:00', 'Et, tavuk ve balık çiğ ağırlıkla.')}
  ${sec('ant', 'Antrenman günü ekleri', 'Yalnızca antrenman günlerinde, ikisi birlikte yaklaşık 200 kcal.')}
  ${sec('gece', 'Saat 20:00 sonrası', 'Varsayılan bitki çayı.')}
  <section><h2>Akşam yemeği rotasyonu</h2><p class="dip">Haftada 2 balık, 2 baklagil.</p>
    <table class="tablo"><tbody>${RULES.rotasyon.map(([g, y]) => `<tr><th scope="row">${g}</th><td>${esc(y)}</td></tr>`).join('')}</tbody></table>
  </section>
  <section><h2>Her gün</h2>${list(RULES.hergun)}</section>
  <section><h2>Haftalık esnek bütçe</h2>${list(RULES.haftalik)}</section>
  <section><h2>Süreç boyunca yok</h2>${list(RULES.yok)}</section>
  <section><h2>Spor ve hareket</h2>${list(RULES.spor)}</section>
  <section><h2>Süreç kuralları</h2>${list(RULES.surec)}</section>`;
}

// ——— Ayarlar: her bölüm kapalı gelir, başlıkta güncel durum yazar ———
export function renderSettings() {
  const s = S.set;
  const u = s.usage || { in: 0, out: 0, calls: 0, usd: 0 };
  const st = S.storage;
  const mb = (b) => (b / 1048576).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
  const places = s.places || [];
  const favs = s.favs || [];
  const oa = s.provider === 'openai';
  const backupAge = s.lastBackup ? diffDays(dayKey(new Date(s.lastBackup)), today()) : null;
  const backupTxt = backupAge == null ? 'Henüz alınmadı' : backupAge === 0 ? 'Son yedek bugün' : `Son yedek ${backupAge} gün önce`;
  const preset = PRESETS.find((p) => p.base === s.oaBase);
  const aiTxt = !hasKey() ? 'Anahtar yok' : oa ? `${preset ? preset.ad.split(' (')[0] : 'OpenAI uyumlu'}, ${s.oaModel}` : `Claude, ${(MODELS[s.model] || { ad: s.model }).ad.split(' (')[0]}`;
  const sec = (id, title, status, body) => `<details class="ayar" data-sec="${id}"${S.setOpen === id ? ' open' : ''}>
    <summary><span>${title}</span><small>${esc(status)}</small></summary>
    <div class="ayar-b">${body}</div>
  </details>`;

  const analiz = `
    <p class="dip">Analiz, seçtiğin sağlayıcıya doğrudan bu telefondan gider. Anahtar yalnızca bu cihazda saklanır ve yedeğe yazılmaz.</p>
    <label for="set-prov">Sağlayıcı</label>
    <select id="set-prov" data-chg="prov">
      <option value="openai"${oa ? ' selected' : ''}>Gemini, OpenCode, OpenRouter (OpenAI uyumlu)</option>
      <option value="anthropic"${oa ? '' : ' selected'}>Claude (ön ödemeli kredi ister)</option>
    </select>
    ${oa ? `
    <label for="set-preset">Hazır ayar</label>
    <select id="set-preset" data-chg="preset"><option value="">Seç ya da aşağıyı elle doldur</option>${PRESETS.map((p) => `<option value="${p.id}"${p.base === s.oaBase ? ' selected' : ''}>${p.ad}</option>`).join('')}</select>
    <label for="set-oakey">Anahtar</label>
    <input id="set-oakey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaKey)}">
    ${preset && preset.id === 'gemini' ? '<p class="dip">Ücretsiz anahtarı aistudio.google.com adresinde “Get API key” ile alırsın.</p>' : ''}
    <label for="set-oamodel">Model</label>
    <input id="set-oamodel" type="text" list="oa-models" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaModel)}" placeholder="model kimliği">
    <datalist id="oa-models">${ZEN_FREE.map((m) => `<option value="${m}"></option>`).join('')}</datalist>
    <label for="set-base">Adres</label>
    <input id="set-base" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.oaBase)}" placeholder="https://…/v1">
    <div class="k-act"><button type="button" class="btn btn-p" data-act="test-key">Kaydet ve dene</button><button type="button" class="btn" data-act="save-key">Yalnızca kaydet</button></div>
    <p class="dip pre" id="key-test" role="status"></p>
    <p class="dip">Model fotoğraf okumuyorsa: <button type="button" class="lnk lnk-i" data-act="find-vision">fotoğraf okuyan modeli bul</button>. Sağlayıcının modellerini küçük bir test resmiyle tek tek dener.</p>` : `
    <label for="set-key">Anahtar</label>
    <input id="set-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(s.apiKey)}" placeholder="sk-ant-…">
    <label for="set-model">Model</label>
    <select id="set-model">${Object.entries(MODELS).map(([k, m]) => `<option value="${k}"${s.model === k ? ' selected' : ''}>${m.ad}</option>`).join('')}</select>
    <div class="k-act"><button type="button" class="btn btn-p" data-act="test-key">Kaydet ve dene</button><button type="button" class="btn" data-act="save-key">Yalnızca kaydet</button></div>
    <p class="dip pre" id="key-test" role="status"></p>`}
    <p class="dip">Şimdiye kadar ${n0(u.calls)} çağrı, ${n0(u.in)} giriş ve ${n0(u.out)} çıkış token.${oa ? '' : ` Tahmini maliyet ${u.usd.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} $.`}</p>`;

  const hedef = `
    <div class="duzen-g">
      <label for="set-start">Başlangıç<input id="set-start" type="date" value="${s.startDate}"></label>
      <label for="set-end">Bitiş<input id="set-end" type="date" value="${s.targetDate}"></label>
      <label for="set-startkg">Başlangıç kilosu<input id="set-startkg" type="text" inputmode="decimal" value="${n1(s.startKg)}"></label>
      <label for="set-endkg">Hedef kilo<input id="set-endkg" type="text" inputmode="decimal" value="${n1(s.targetKg)}"></label>
      <label for="set-rest">Dinlenme günü kcal<input id="set-rest" type="text" inputmode="numeric" value="${s.kcalRest}"></label>
      <label for="set-train">Antrenman günü kcal<input id="set-train" type="text" inputmode="numeric" value="${s.kcalTrain}"></label>
      <label for="set-prot">Protein (g)<input id="set-prot" type="text" inputmode="numeric" value="${s.protein}"></label>
    </div>
    <div class="k-act"><button type="button" class="btn btn-p" data-act="save-targets">Hedefleri kaydet</button></div>`;

  const konum = `
    <label class="chk"><input type="checkbox" data-act="loc-toggle"${s.useLocation ? ' checked' : ''}> Fotoğrafın konumunu kullan</label>
    <p class="dip">Konum cihazda okunur ve kayıtlı yerlerle burada eşleştirilir. Modele yalnızca “Ev”, “Ofis” ya da “dışarı” kelimesi gider; koordinat gitmez. Galeriden seçerken konumun gelmesi için seçicide Seçenekler altında Konum açık olmalı.</p>
    <div class="k-act">
      <button type="button" class="btn" data-act="loc-save" data-name="Ev">Buradayım: Ev</button>
      <button type="button" class="btn" data-act="loc-save" data-name="Ofis">Buradayım: Ofis</button>
    </div>
    <p class="dip" id="loc-out" role="status">${places.length ? 'Kayıtlı yerler: ' + places.map((p) => esc(p.name)).join(', ') + '.' : 'Kayıtlı yer yok.'}</p>`;

  const yedek = `
    <p class="dip">Veriler yalnızca bu cihazda. iOS depolama sıkışınca web verisini silebilir; haftada bir yedeği Dosyalar’a kaydet.</p>
    <div class="k-act">
      <button type="button" class="btn btn-p" data-act="export">Yedeği kaydet</button>
      <button type="button" class="btn" data-act="export-photos">Fotoğraflarla birlikte</button>
      <button type="button" class="btn" data-act="import">Yedekten geri yükle</button>
    </div>
    <input id="set-import" type="file" accept="application/json,.json" hidden>
    <p class="dip">${S.persisted === true ? 'Kalıcı depolama açık.' : S.persisted === false ? 'Kalıcı depolama henüz verilmedi. Uygulamayı ana ekrana eklemek bunu kolaylaştırır.' : ''} ${st && st.usage != null ? `Kullanılan alan ${mb(st.usage)} MB.` : ''}</p>
    ${S.persisted === false ? '<div class="k-act"><button type="button" class="btn" data-act="persist">Kalıcı depolama iste</button></div>' : ''}`;

  const sik = favs.length
    ? `<ul class="icerik">${favs.map((f) => `<li><span>${esc(f.ad)}, ${n0(f.kcal)} kcal</span><button type="button" class="lnk" data-act="fav-del" data-id="${f.id}">Kaldır</button></li>`).join('')}</ul>`
    : '<p class="dip">Bir kaydın “Düzenle” bölümünden “Sık yenenlere ekle”ye dokun. Sonra Akış’ta tek dokunuşla girilir.</p>';

  const surum = `
    <p class="dip">Uygulama açılırken ve öne geldiğinde yeni sürümü kendisi arar; bulursa yenilenir. Kayıtların bundan etkilenmez.</p>
    <div class="k-act"><button type="button" class="btn btn-p" data-act="check-update">Güncellemeyi denetle</button><button type="button" class="btn" data-act="hard-reload">Önbelleği temizle ve yeniden yükle</button></div>
    <p class="dip" id="upd-out" role="status"></p>`;

  const sifirla = `
    <p class="dip">Tüm kayıtlar, fotoğraflar ve tartılar bu cihazdan silinir. Ayarlar ve anahtar kalır.</p>
    <div class="k-act"><button type="button" class="btn btn-del" data-act="wipe">Tüm kayıtları sil</button></div>`;

  return `
  <header class="sh-top"><h2 id="sheet-title">Ayarlar</h2><button type="button" class="btn" data-act="close-sheet">Kapat</button></header>
  <div class="ayarlar">
    ${sec('analiz', 'Fotoğraf ve metin analizi', aiTxt, analiz)}
    ${sec('hedef', 'Hedefler', `${n1(s.startKg)} kg’dan ${n1(s.targetKg)} kg’a, ${dShort.format(parseDay(s.targetDate))}`, hedef)}
    ${sec('yedek', 'Yedek', backupTxt, yedek)}
    ${sec('konum', 'Konum', s.useLocation ? (places.length ? 'Açık: ' + places.map((p) => p.name).join(', ') : 'Açık, kayıtlı yer yok') : 'Kapalı', konum)}
    ${sec('sik', 'Sık yenenler', favs.length ? `${favs.length} öğün` : 'Henüz yok', sik)}
    ${sec('surum', 'Sürüm ve güncelleme', `Sürüm ${APP_VERSION}`, surum)}
    ${sec('sifirla', 'Sıfırla', '', sifirla)}
  </div>`;
}
