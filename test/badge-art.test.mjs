// The badge art in js/badge-art.js: well-formed SVG for every id, finish and state, and the glyphs sit inside their shapes. `node --test`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../js/badges.js';
import { badgeSvg, rim, GLYPHS, SHAPES, SHAPE_OF, PLACE, FINISH } from '../js/badge-art.js';

const IDS = CATALOG.map((b) => b.id);
const shapeOf = (id) => SHAPE_OF[CATALOG.find((b) => b.id === id).group];

// A conservative well-formedness check: tags nest and close, attributes are quoted, no stray < or & in text
function checkXml(s) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let pos = 0, m;
  while ((m = re.exec(s))) {
    const text = s.slice(pos, m.index);
    assert.ok(!/[<>]/.test(text) && !/&(?!amp;|lt;|gt;|quot;|#39;)/.test(text), `stray markup in text: ${text}`);
    pos = re.lastIndex;
    if (m[1]) assert.equal(stack.pop(), m[2], `unbalanced </${m[2]}>`);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.equal(s.slice(pos), '', 'trailing text');
  assert.deepEqual(stack, [], 'unclosed tags');
}

test('every id x 4 finishes x earned/locked is well-formed, has one title, honours size and label', () => {
  for (const id of IDS) for (const state of ['earned', 'locked']) for (let step = 0; step < 4; step++) {
    const svg = badgeSvg(id, { step, state, size: 28, label: 'Name, Tier' });
    checkXml(svg);
    assert.equal(svg.match(/<title>/g).length, 1, id);
    assert.ok(svg.includes('<title>Name, Tier</title>') && svg.includes('role="img"') && svg.includes('aria-label="Name, Tier"'));
    assert.ok(svg.startsWith('<svg width="28" height="28" viewBox="0 0 48 48"'));
    assert.ok(!/NaN|undefined/.test(svg), `${id} ${state} ${step}`);
  }
  assert.ok(badgeSvg('goal', { size: 64 }).includes('width="64" height="64"'));
});

test('a hostile label cannot inject markup or break out of the attribute', () => {
  const evil = '"><script>alert(1)</script><g onload=\'x\'> & </title>';
  for (const state of ['earned', 'locked']) {
    const svg = badgeSvg('days_on', { step: 1, state, label: evil });
    checkXml(svg);
    assert.ok(!svg.includes('<script') && !svg.includes('onload=\'') && !/aria-label="[^"]*"[^>]*"><script/.test(svg));
    assert.equal(svg.match(/<title>/g).length, 1);
    assert.equal(svg.match(/<\/title>/g).length, 1);
  }
});

test('size: a missing or silly size falls back, a non-finite step is clamped', () => {
  assert.ok(badgeSvg('goal', { label: 'x' }).includes('width="48"'));
  assert.ok(badgeSvg('goal', { size: 'abc', label: 'x' }).includes('width="48"'));
  assert.equal(badgeSvg('goal', { step: 9, label: 'x' }), badgeSvg('goal', { step: 3, label: 'x' }));
  assert.equal(badgeSvg('goal', { step: -1, label: 'x' }), badgeSvg('goal', { step: 0, label: 'x' }));
});

// Silver and Gold are the finishes the app draws most; Bronze and Platinum are measured too. No exceptions were needed.
test('each badge is under 1.5 KB', () => {
  for (const id of IDS) for (const state of ['earned', 'locked']) for (let step = 0; step < 4; step++) {
    const n = Buffer.byteLength(badgeSvg(id, { step, state, label: 'Days on plan, Silver' }));
    assert.ok(n < 1500, `${id} ${state} ${step}: ${n} bytes`);
  }
});

test('one-shots are drawn at Gold: the caller passes step 2 (default), which differs from the other finishes', () => {
  const gold = badgeSvg('first_meal', { label: 'x' });
  assert.equal(gold, badgeSvg('first_meal', { step: 2, label: 'x' }));
  assert.ok(gold.includes('var(--t3)'));
});

test('the four finish rims differ pairwise in every shape, and the finishes differ in geometry, not only colour', () => {
  for (const shape of Object.keys(SHAPES)) {
    const strip = (s) => s.replace(/var\(--t\d\)/g, 'FILL'); // the fill colour is the one thing that must not carry the tier alone
    const rims = [0, 1, 2, 3].map((st) => strip(rim(shape, st)));
    assert.equal(new Set(rims).size, 4, shape);
  }
  const sigs = FINISH.map((f) => `${f.o}|${f.inset}|${f.w}|${f.op}|${f.c}`);
  assert.equal(new Set(sigs).size, 4);
});

test('glyph keys are exactly the catalog ids, and every shape has a placement', () => {
  assert.deepEqual(Object.keys(GLYPHS).sort(), [...IDS].sort());
  assert.equal(IDS.length, 18);
  for (const id of IDS) assert.ok(SHAPES[shapeOf(id)] && PLACE[shapeOf(id)], id);
  assert.deepEqual(Object.keys(PLACE).sort(), Object.keys(SHAPES).sort());
  for (const shape of Object.keys(SHAPES)) assert.ok(Object.values(SHAPE_OF).includes(shape), `unused shape ${shape}`);
});

test('a locked badge is the shape and a padlock only: no glyph markup', () => {
  for (const id of IDS) {
    const svg = badgeSvg(id, { state: 'locked', label: 'x' });
    assert.ok(!svg.includes('var(--on-t)') && !svg.includes('fill-opacity') && !svg.includes('--k'), id);
    assert.ok(svg.includes('stroke-dasharray="3 3"'));
    assert.equal((svg.match(/<g /g) || []).length, 2); // the dashed shape and the padlock
  }
});

test('numeric strokes only: no --k or calc, and the drawn stroke is 2.25 in every shape; a week badge differs from its day twin in the glyph itself', () => {
  for (const [shape, p] of Object.entries(PLACE)) assert.ok(Math.abs(p.sw * p.s - 2.25) < 0.02, `${shape}: ${p.sw * p.s}`);
  for (const id of IDS) for (const size of [28, 64]) assert.ok(!/calc|--k/.test(badgeSvg(id, { size, label: 'x' })));
  for (const [week, day] of [['weeks_strong', 'days_on'], ['protein_week', 'protein_days'], ['weigh_week', 'first_weigh'], ['log_week', 'first_meal']]) assert.notEqual(GLYPHS[week], GLYPHS[day], week);
  for (const id of ['weeks_strong', 'protein_week', 'weigh_week', 'log_week']) assert.ok(!badgeSvg(id, { size: 28, label: 'x' }).includes('stroke-dasharray'), id);
});

// ---- bounding boxes ----
// A path bounding box by sampling: lines exactly, curves and arcs at 24 points (a tiny underestimate at most, far inside the margins used below)
function pathPoints(d) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const pts = [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, cmd = '';
  const n = () => parseFloat(toks[i++]);
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { x = sx; y = sy; continue; }
    if (C === 'M') { x = ox + n(); y = oy + n(); sx = x; sy = y; pts.push([x, y]); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { x = ox + n(); y = oy + n(); pts.push([x, y]); }
    else if (C === 'H') { x = (rel ? x : 0) + n(); pts.push([x, y]); }
    else if (C === 'V') { y = (rel ? y : 0) + n(); pts.push([x, y]); }
    else if (C === 'C') {
      const p = [[x, y], [ox + n(), oy + n()], [ox + n(), oy + n()], [ox + n(), oy + n()]];
      for (let t = 0; t <= 24; t++) { const u = t / 24, v = 1 - u; pts.push([0, 1].map((k) => v * v * v * p[0][k] + 3 * v * v * u * p[1][k] + 3 * v * u * u * p[2][k] + u * u * u * p[3][k])); }
      [x, y] = p[3];
    } else if (C === 'A') {
      let rx = Math.abs(n()), ry = Math.abs(n()); const rot = n() * Math.PI / 180, fa = n(), fs = n();
      const ex = ox + n(), ey = oy + n();
      const c = Math.cos(rot), s = Math.sin(rot), dx = (x - ex) / 2, dy = (y - ey) / 2;
      const x1 = c * dx + s * dy, y1 = -s * dx + c * dy;
      const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
      const k = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
      const cxp = k * rx * y1 / ry, cyp = -k * ry * x1 / rx;
      const cx = c * cxp - s * cyp + (x + ex) / 2, cy = s * cxp + c * cyp + (y + ey) / 2;
      const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
      let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
      if (!fs && dth > 0) dth -= 2 * Math.PI; else if (fs && dth < 0) dth += 2 * Math.PI;
      for (let t = 0; t <= 24; t++) { const a = th1 + dth * t / 24; pts.push([cx + c * rx * Math.cos(a) - s * ry * Math.sin(a), cy + s * rx * Math.cos(a) + c * ry * Math.sin(a)]); }
      x = ex; y = ey;
    } else throw new Error(`path command ${cmd}`);
  }
  return pts;
}

// Points of a glyph in its 24-unit box; the stroke half-width (in 24-unit box units of the drawn line) is added by the caller
function glyphPoints(g) {
  const out = [];
  const grab = (markup, f) => {
    for (const m of markup.matchAll(/<path d="([^"]+)"/g)) for (const p of pathPoints(m[1])) out.push(f(p));
    for (const m of markup.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
      const [x, y, w, h] = m.slice(1).map(Number);
      for (const p of [[x, y], [x + w, y + h]]) out.push(f(p));
    }
    for (const m of markup.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
      const [cx, cy, r] = m.slice(1).map(Number);
      for (const p of [[cx - r, cy - r], [cx + r, cy + r]]) out.push(f(p));
    }
  };
  grab(g, (p) => p);
  return out;
}

// Safe rects in the 48-unit badge box: what fits inside the inner ring of each shape (Platinum's, the tightest). Chosen by hand from the outlines:
// circle: inscribed square of the ring; square: the ring minus the corner radius; shield: its straight middle, clear of the point; diamond and hex: their inscribed squares/boxes.
const SAFE = {
  circle: [11, 11, 37, 37],
  square: [9, 9, 39, 39],
  shield: [11, 9.5, 37, 36],
  diamond: 15.3, // not a rect: the L1 radius |x-24|+|y-24| of the inner ring's centre line (half-diagonal 16.1 less half its stroke)
  hex: [11, 10.5, 37, 37.5],
};

test('every glyph, placed in its shape and with its stroke, stays inside the safe rect', () => {
  for (const id of IDS) {
    const shape = shapeOf(id), P = PLACE[shape];
    const half = 2.25 / 2; // the drawn stroke is 2.25 in every shape
    const pts = glyphPoints(GLYPHS[id]).map(([x, y]) => [24 + P.dx + (x - 12) * P.s, 24 + P.dy + (y - 12) * P.s]);
    const pad = half;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (shape === 'diamond') {
      const l1 = Math.max(...pts.map(([x, y]) => Math.abs(x - 24) + Math.abs(y - 24))) + pad * Math.SQRT2; // a stroke corner reaches pad * sqrt2 along the diagonal
      assert.ok(l1 <= SAFE.diamond, `${id} reaches ${l1.toFixed(2)} of ${SAFE.diamond}`);
      continue;
    }
    const [x0, y0, x1, y1] = SAFE[shape];
    const bb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
    assert.ok(bb[0] >= x0 && bb[1] >= y0 && bb[2] <= x1 && bb[3] <= y1, `${id} (${shape}) bbox ${bb.map((v) => v.toFixed(1))} outside ${SAFE[shape]}`);
  }
});

test('the bbox helper is honest: a half-circle arc and a cubic are measured', () => {
  const a = pathPoints('M4 12h16a8 7 0 0 1-16 0z');
  assert.ok(Math.abs(Math.max(...a.map((p) => p[1])) - 19) < 0.05); // bowl bottom: 12 + ry 7
  const c = pathPoints('M0 0C0 10 10 10 10 0');
  assert.ok(Math.abs(Math.max(...c.map((p) => p[1])) - 7.5) < 0.05);
});
