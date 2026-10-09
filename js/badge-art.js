// Badge art: every badge drawn from tables, as SVG strings. No DOM, no storage; the caller supplies the localized label.
// Shape = group, finish = step (0 Bronze .. 3 Platinum), glyph = id. A one-shot badge is drawn at finish 2 (Gold): the caller passes that step.
// Colours come from the --t1..--t4, --on-t and --hi tokens in styles.css and the app's own --ink, --bg, --track, --edge and --ink3.
// The avatar at the end of the file is the app icon pickle on a 128 box.
import { BY_ID, PARTS, DEFAULT_AV } from './badges.js';

// The 48-unit badge outlines, one per group
export const SHAPES = {
  circle: '<circle cx="24" cy="24" r="21"/>',
  square: '<rect x="4" y="4" width="40" height="40" rx="11"/>',
  shield: '<path d="M24 3 L42 9 V23 C42 34 34 41 24 45.5 C14 41 6 34 6 23 V9 Z"/>',
  diamond: '<path d="M24 2.5 L45.5 24 L24 45.5 L2.5 24 Z"/>',
  hex: '<path d="M24 2.5 L43 13.5 V34.5 L24 45.5 L5 34.5 V13.5 Z"/>',
};
export const SHAPE_OF = { start: 'circle', consistency: 'square', complete: 'shield', habits: 'diamond', progress: 'hex' };

// Where the 24-unit glyph sits in each shape: dx, dy, s = placement; sw = stroke so the drawn line stays 2.25 whatever s is; ap = apothem for the rim insets
export const PLACE = {
  circle: { dx: 0, dy: 0, s: 1, sw: 2.25, ap: 21 },
  square: { dx: 0, dy: 0, s: 1, sw: 2.25, ap: 20 },
  shield: { dx: 0, dy: -1, s: 0.92, sw: 2.45, ap: 18 },
  diamond: { dx: 0, dy: 0, s: 0.77, sw: 2.922, ap: 15.2 },
  hex: { dx: 0, dy: 0, s: 0.94, sw: 2.39, ap: 19 },
};

// The four finishes: outer stroke, inset of the inner ring, and the ring's stroke, opacity and colour. The rims differ so a tier never relies on colour.
export const FINISH = [
  { o: 1.8, inset: 0 },
  { o: 1.8, inset: 3.2, w: 1.7, op: 0.6, c: 'var(--ink)' },
  { o: 2.2, inset: 3.4, w: 1.7, op: 1, c: 'var(--ink)' },
  { o: 3.2, inset: 3.8, w: 1.6, op: 0.9, c: 'var(--ring-p)' },
];

const Q = ' fill="currentColor" fill-opacity=".2"';
const SCALE = `<rect x="4" y="4" width="16" height="16" rx="4"${Q}/><path d="M7.5 14a4.5 4.5 0 0 1 9 0"/><path d="M12 14l2-2.8"/>`;
const CAL = `<rect x="4" y="5" width="16" height="15" rx="3"${Q}/><path d="M4 10h16M8.5 3v4M15.5 3v4"/><path d="M9 15l2.2 2.2L15.5 13"/>`;
const LOG = `<rect x="5" y="3.5" width="14" height="17" rx="2.5"${Q}/><path d="M9 9h6M9 13h6M9 17h3"/>`;
const EGG = `<path d="M12 4.5c3.6 0 6 5.2 6 9.2a6 6 0 0 1-12 0c0-4 2.4-9.2 6-9.2z"${Q}/>`;
// The week badges draw their twin's icon at .8 above a 7-segment bar. The strokes are computed per shape (see glyphMarkup) so they stay 2.25 / 2.8 drawn
export const WEEK_SHIFT = 'translate(2.4 1) scale(.8)';
export const WEEK_BAR = 'M3.85 21h16.3';
export const WEEK_IDS = ['weeks_strong', 'protein_week', 'weigh_week', 'log_week'];
export const BAR_MIN = 40; // below this size the bar blurs the icon, so it is left out: the label carries the week

// The 18 glyphs on a 24-unit box, keyed by catalog id. A week id holds its twin's icon; glyphMarkup adds the shift and the bar
export const GLYPHS = {
  first_meal: `<path d="M4 12h16a8 7 0 0 1-16 0z"${Q}/><path d="M9 4c-1 1.5 1 2.5 0 4M15 4c-1 1.5 1 2.5 0 4"/>`,
  first_weigh: SCALE,
  first_on: `<path d="M12 20v-9"/><path d="M12 12C12 8 9.5 6 5 6c0 4 2.5 6 7 6z"${Q}/><path d="M12 14.5c0-3 2-4.5 6.5-4.5 0 3-2 4.5-6.5 4.5z"${Q}/>`,
  days_on: CAL,
  best_run: `<path d="M3.5 20L10 8.5l4.5 7 2-3L20.5 20z"${Q}/><path d="M10 8.5V3.5"/><path d="M10 3.5l5 1.75-5 1.75z" fill="currentColor"/>`,
  weeks_strong: CAL,
  anniversary: `<path d="M5 20v-6.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2V20z"${Q}/><path d="M12 11.5V8.5"/><path d="M12 3.5c1.2 1.2 1.2 2.4 0 3.6-1.2-1.2-1.2-2.4 0-3.6z"/>`,
  fresh_start: '<path d="M3.5 18.5h17"/><path d="M7 18.5a5 5 0 0 1 10 0"/><path d="M12 4.5V8M5.2 9.2l1.6 1.6M18.8 9.2l-1.6 1.6"/>',
  perfect_day: `<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z"${Q}/>`,
  protein_days: EGG,
  goals_days: `<path d="M4 19.5V7.5h3.8l1.5 3.5c1.5 1.7 3.4 2 5.7 2.4 2.8.5 4.5 1.4 4.5 3.6v2z"${Q}/>`,
  protein_week: EGG,
  weigh_days: '<path d="M3.5 4L8.5 11.5 12 8.5 16.5 16 20.5 20"/>',
  weigh_week: SCALE,
  log_week: LOG,
  kilos: '<path d="M12 3.5v11M7 10.5l5 5 5-5M5.5 20h13"/>',
  halfway: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  goal: `<path d="M5 19.5L4 8.5l5 4 3-7 3 7 5-4-1 11z"${Q}/>`,
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const num = (n) => +n.toFixed(3);

// The outline and, from Silver up, the inner ring
export function rim(shape, step) {
  const F = FINISH[step], S = PLACE[shape];
  let h = `<g fill="var(--t${step + 1})" stroke="var(--ink)" stroke-width="${F.o}">${SHAPES[shape]}</g>`;
  if (F.inset) {
    const k = 1 - F.inset / S.ap;
    h += `<g fill="none" stroke="${F.c}" stroke-opacity="${F.op}" stroke-width="${num(F.w / k)}" transform="translate(24 24) scale(${num(k)}) translate(-24 -24)">${SHAPES[shape]}</g>`;
  }
  return h;
}

// A glyph's markup in its shape: the week ids get their shifted twin and, when bar is true, the bar
export function glyphMarkup(id, shape, bar = true) {
  if (!WEEK_IDS.includes(id)) return GLYPHS[id];
  const s = PLACE[shape].s;
  const g = `<g transform="${WEEK_SHIFT}" stroke-width="${num(2.8125 / s)}">${GLYPHS[id]}</g>`;
  return bar ? `${g}<path d="${WEEK_BAR}" stroke-linecap="butt" stroke-dasharray="1.6 .85" stroke-width="${num(2.8 / s)}"/>` : g;
}

// The padlock of a locked badge
const LOCK = '<g transform="translate(15.5 15.5)"><circle cx="8.5" cy="8.5" r="8.5" fill="var(--bg)" stroke="var(--edge)"/><rect x="5" y="8.2" width="7" height="5.4" rx="1.1" fill="var(--ink3)"/><path d="M6.4 8.2V6.8a2.1 2.1 0 0 1 4.2 0v1.4" fill="none" stroke="var(--ink3)" stroke-width="1.4"/></g>';

// opts: step 0-3 (finish; a one-shot is passed 2), state 'earned' | 'locked', size in px, label (already localized, escaped here).
// A locked badge is the dashed shape and a padlock, never the glyph.
export function badgeSvg(id, { step = 2, state = 'earned', size = 48, label = '' } = {}) {
  const shape = SHAPE_OF[BY_ID[id].group];
  const S = PLACE[shape];
  const st = Math.max(0, Math.min(3, Math.trunc(step) || 0));
  const l = esc(label);
  const px = Math.max(1, Math.round(+size) || 48);
  let h = `<svg width="${px}" height="${px}" viewBox="0 0 48 48" role="img" aria-label="${l}" stroke-linejoin="round" stroke-linecap="round"><title>${l}</title>`;
  if (state === 'locked') {
    h += `<g fill="var(--track)" stroke="var(--edge)" stroke-width="1.8" stroke-dasharray="3 3">${SHAPES[shape]}</g>${LOCK}`;
  } else {
    h += rim(shape, st);
    h += `<g fill="none" stroke="var(--on-t)" color="var(--on-t)" stroke-width="${S.sw}" transform="translate(${24 + S.dx} ${24 + S.dy}) scale(${S.s}) translate(-12 -12)">${glyphMarkup(id, shape, px >= BAR_MIN)}</g>`;
  }
  return h + '</svg>';
}

// ——— The avatar: the app-icon pickle (green body, light highlight, darker warts, brass stem) with three slots ———
// Colours are the --pickle, --pickle-hi and --pickle-d tokens plus the badge tokens; the face and outlines use --on-t, which is dark in both themes.
// A growth stage is the body's half-width and half-height, and the face scale (the gherkin is small, so its face is drawn a little smaller).
// Stage 3 also grows warts on its outline, so it differs from stage 2 in silhouette, not only in size.
const STAGE = { stage1: { rx: 22, ry: 36, k: 0.9, dots: 2 }, stage2: { rx: 26, ry: 43, k: 1, dots: 3 }, stage3: { rx: 30, ry: 48, k: 1, dots: 5 } };
const WARTS = [-148, -112, -62, -22, 18, 52, 96, 134, 172]; // degrees round the body of a well-brined pickle, none at the stem
const DOTS = [[-0.55, 0.42], [0.5, 0.52], [0.05, 0.68], [0.58, -0.3], [-0.62, -0.28]]; // seeds, as fractions of rx and ry
const CY = 70;
const OUT = 'stroke="var(--on-t)" stroke-width="2.4"';
const r1 = (n) => +n.toFixed(1);

// The face on the eye line ey. All dark marks use --on-t.
function face(f, ey) {
  const eye = (x, r) => `<circle cx="${x}" cy="${ey}" r="${r}"/>`;
  const m = (d, w) => `<path d="${d}" fill="none" stroke-width="${w}"/>`;
  const star = (x) => `<path d="M${x} ${ey - 7}l2.3 4.7 5.2.7-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.7z" fill="var(--t3)" stroke="none"/>`;
  const my = ey + 13;
  let h;
  if (f === 'face_cool') h = `<rect x="44" y="${ey - 6}" width="18" height="12" rx="3.5"/><rect x="66" y="${ey - 6}" width="18" height="12" rx="3.5"/>${m(`M62 ${ey - 2}h4`, 2)}${m(`M55 ${my}q9 6 18 0`, 2.8)}`;
  else if (f === 'face_star') h = star(52) + star(76) + m(`M51 ${my - 1}q13 11 26 0`, 2.8);
  else if (f === 'face_smile') h = eye(52, 3.4) + eye(76, 3.4) + m(`M50 ${my - 1}q14 13 28 0`, 3);
  else h = eye(53, 3.2) + eye(75, 3.2) + m(`M57 ${my + 1}q7 4 14 0`, 2.6);
  return `<g fill="var(--on-t)" stroke="var(--on-t)" stroke-linecap="round" stroke-linejoin="round">${h}</g>`;
}

// What is worn, placed from the body: hw(y) is the body's half-width at height y
function worn(a, rx, ry) {
  const top = CY - ry;
  const hw = (y) => rx * Math.sqrt(Math.max(0, 1 - ((y - CY) / ry) ** 2));
  if (a === 'acc_leaf') return `<path d="M64 ${top - 5}c-2-9 4-17 14-18-1 10-6 17-14 18z" fill="var(--good)" stroke="var(--pickle-d)" stroke-width="2"/>`;
  if (a === 'acc_cap') {
    const y = top + 17, w = r1(hw(y) + 1);
    return `<path d="M${r1(64 - w)} ${y}Q${r1(64 - w)} ${top - 14} 64 ${top - 14}T${r1(64 + w)} ${y}z" fill="var(--prot)" ${OUT}/><path d="M${r1(64 + w * 0.3)} ${y}h${r1(w * 0.95)}" fill="none" stroke="var(--on-t)" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (a === 'acc_headband') {
    const y1 = top + 0.15 * ry, y2 = y1 + 8, w1 = r1(hw(y1) + 1.5), w2 = r1(hw(y2 + 5) + 1.5);
    return `<path d="M${r1(64 - w1)} ${r1(y1)}Q64 ${r1(y1 + 8)} ${r1(64 + w1)} ${r1(y1)}L${r1(64 + w2)} ${r1(y2)}Q64 ${r1(y2 + 8)} ${r1(64 - w2)} ${r1(y2)}z" fill="var(--tape)" ${OUT}/>`;
  }
  if (a === 'acc_scarf') {
    const y1 = CY + 0.46 * ry, y2 = y1 + 10, w1 = r1(hw(y1) + 1.5), w2 = r1(hw(y2 + 4) + 1.5);
    return `<path d="M${r1(64 - w1)} ${r1(y1)}Q64 ${r1(y1 + 8)} ${r1(64 + w1)} ${r1(y1)}L${r1(64 + w2)} ${r1(y2)}Q64 ${r1(y2 + 8)} ${r1(64 - w2)} ${r1(y2)}z" fill="var(--t1)" ${OUT}/><path d="M${r1(64 + w2 * 0.45)} ${r1(y2 + 4)}v14l5-3.5 4.5 4.5v-15z" fill="var(--t1)" ${OUT}/>`;
  }
  if (a === 'acc_crown') {
    const y = top + 8, w = r1(hw(y) * 0.8 + 3), h = r1(w * 0.95 + 4);
    return `<path d="M${-w} ${y}l-3-${h} ${r1(w * 0.5 + 1.5)} ${r1(h * 0.45)} ${r1(w * 0.5 + 1.5)}-${r1(h * 0.4)} ${r1(w * 0.5 + 1.5)} ${r1(h * 0.4)} ${r1(w * 0.5 + 1.5)}-${r1(h * 0.45)}l-3 ${h}z" transform="translate(64 0)" fill="var(--t3)" ${OUT} stroke-linejoin="round"/>`;
  }
  return '';
}

// opts: size in px, label (already localized, escaped here). av holds part ids; a missing or unknown part is the default of its slot.
export function avatarSvg(av, { size = 128, label = '' } = {}) {
  const a = av && typeof av === 'object' ? av : {};
  const pick = (slot) => (typeof a[slot] === 'string' && Object.hasOwn(PARTS, a[slot]) && PARTS[a[slot]].slot === slot ? a[slot] : DEFAULT_AV[slot]);
  const stage = pick('stage'), f = pick('face'), acc = pick('acc');
  const { rx, ry, k, dots } = STAGE[stage];
  const l = esc(label);
  const px = Math.max(1, Math.round(+size) || 128);
  const ey = r1(CY - ry * 0.22);
  const warts = stage === 'stage3' ? WARTS.map((d) => `<circle cx="${r1(64 + rx * Math.cos(d * Math.PI / 180))}" cy="${r1(CY + ry * Math.sin(d * Math.PI / 180))}" r="6"/>`).join('') : '';
  const body = `<ellipse cx="64" cy="${CY}" rx="${rx}" ry="${ry}"/>${warts}`;
  const seeds = DOTS.slice(0, dots).map(([x, y]) => `<circle cx="${r1(64 + x * rx)}" cy="${r1(CY + y * ry)}" r="2.3"/>`).join('');
  const fk = k === 1 ? '' : ` transform="translate(64 ${ey}) scale(${k}) translate(-64 -${ey})"`;
  return `<svg width="${px}" height="${px}" viewBox="0 0 128 128" role="img" aria-label="${l}"><title>${l}</title>`
    + `<rect x="58" y="${CY - ry - 9}" width="12" height="14" rx="3.5" fill="var(--tape)" ${OUT}/>`
    + `<g fill="var(--pickle-d)" stroke="var(--pickle-d)" stroke-width="5" stroke-linejoin="round">${body}</g><g fill="var(--pickle)">${body}</g>`
    + `<path d="M${r1(64 - rx * 0.62)} ${r1(CY - ry * 0.5)}Q${r1(64 - rx * 0.86)} ${CY} ${r1(64 - rx * 0.6)} ${r1(CY + ry * 0.4)}" fill="none" stroke="var(--pickle-hi)" stroke-width="3.6" stroke-linecap="round"/>`
    + `<g fill="var(--pickle-d)" fill-opacity=".75">${seeds}</g><g${fk}>${face(f, ey)}</g>${worn(acc, rx, ry)}</svg>`;
}
