// The avatar: the art, the parts a record may wear, the picker and the choice being saved. `node --test`
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PARTS, DEFAULT_AV, wornAv, avatarChoices, wear, serial, unlocked, PART_NAME } from '../js/badges.js';
import { avatarSvg } from '../js/badge-art.js';
import { cleanBadges, restoreBadges } from '../js/backup.js';
import { setLang } from '../js/i18n.js';
import { fixture, views, core } from './screens.mjs';

afterEach(() => setLang('en'));
const SLOTS = { stage: ['stage1', 'stage2', 'stage3'], face: ['face_plain', 'face_smile', 'face_cool', 'face_star'], acc: ['acc_none', 'acc_leaf', 'acc_cap', 'acc_scarf', 'acc_headband', 'acc_crown'] };

function checkXml(s) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/g;
  let pos = 0, m;
  while ((m = re.exec(s))) {
    assert.ok(!/[<>]/.test(s.slice(pos, m.index)), 'stray markup in text');
    pos = re.lastIndex;
    if (m[1]) assert.equal(stack.pop(), m[2]);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.equal(s.slice(pos), '');
  assert.deepEqual(stack, []);
}

test('every part is listed in the slots, and every combination (72) draws well-formed, small and with one title', () => {
  assert.deepEqual(Object.keys(PARTS).sort(), Object.values(SLOTS).flat().sort());
  let n = 0;
  for (const stage of SLOTS.stage) for (const face of SLOTS.face) for (const acc of SLOTS.acc) {
    const svg = avatarSvg({ stage, face, acc }, { size: 34, label: 'Your pickle' });
    checkXml(svg);
    assert.equal(svg.match(/<title>/g).length, 1);
    assert.match(svg, /^<svg width="34" height="34" viewBox="0 0 128 128" role="img" aria-label="Your pickle">/);
    assert.ok(svg.length < 3072, `${stage} ${face} ${acc}: ${svg.length} bytes`);
    n++;
  }
  assert.equal(n, 72);
});

test('stage 2 and stage 3 differ in silhouette (body markup and outline), not only in colour', () => {
  const body = (stage) => avatarSvg({ stage }).match(/<g fill="var\(--pickle\)">(.*?)<\/g>/)[1];
  const [b1, b2, b3] = ['stage1', 'stage2', 'stage3'].map(body);
  assert.equal(new Set([b1, b2, b3]).size, 3);
  assert.equal(b2.match(/<circle/g), null); // smooth
  assert.ok(b3.match(/<circle/g).length >= 6); // warts on the outline
  const rx = (b) => +b.match(/rx="([\d.]+)"/)[1];
  assert.ok(rx(b1) < rx(b2) && rx(b2) < rx(b3));
});

test('unknown, missing or misplaced parts fall back to the defaults; the label is escaped', () => {
  const d = avatarSvg(DEFAULT_AV, { label: 'x' });
  for (const av of [undefined, null, 'x', {}, { stage: 'stage9', face: 'nope', acc: 7 }, { stage: 'face_cool', face: 'acc_cap', acc: 'stage3' }, { stage: '__proto__', face: 'toString', acc: 'constructor' }]) assert.equal(avatarSvg(av, { label: 'x' }), d, JSON.stringify(av));
  const svg = avatarSvg(DEFAULT_AV, { label: `a"<b>&'`, size: 'big' });
  checkXml(svg);
  assert.ok(svg.includes('aria-label="a&quot;&lt;b&gt;&amp;&#39;"'));
  assert.ok(svg.includes('width="128"'));
});

const GOT = { days_on: { 7: '2026-03-01', 30: '2026-03-02' }, first_weigh: { 1: '2026-03-01' }, first_on: { 1: '2026-03-01' } };
const REC = (av, got = GOT) => ({ v: 1, got, seen: {}, av: { ...DEFAULT_AV, ...av }, base: null });

test('wornAv: an unearned or unknown part is the default, an earned one is kept', () => {
  assert.deepEqual(wornAv(null), DEFAULT_AV);
  assert.deepEqual(wornAv(REC({ stage: 'stage2', face: 'face_smile', acc: 'acc_leaf' })), { stage: 'stage2', face: 'face_smile', acc: 'acc_leaf' });
  assert.deepEqual(wornAv(REC({ stage: 'stage3', face: 'face_star', acc: 'acc_crown' })), DEFAULT_AV);
  assert.deepEqual(wornAv(REC({ stage: 'nope', face: 'acc_leaf', acc: 'face_smile' })), DEFAULT_AV);
  assert.deepEqual(wornAv({ got: GOT }), DEFAULT_AV);
});

test('cleanBadges and restoreBadges never keep a part that is not earned', () => {
  const bad = { stage: 'stage3', face: 'face_cool', acc: 'acc_crown' };
  assert.deepEqual(cleanBadges({ got: GOT, av: bad }).av, DEFAULT_AV);
  assert.deepEqual(cleanBadges({ got: GOT, av: { stage: 'stage2', face: 'face_cool', acc: 'acc_leaf' } }).av, { stage: 'stage2', face: 'face_plain', acc: 'acc_leaf' });
  // a backup whose av wears parts its own badges do not unlock, restored onto nothing and onto a device that has other badges
  assert.deepEqual(restoreBadges(null, { got: GOT, av: bad }).av, DEFAULT_AV);
  assert.deepEqual(restoreBadges(REC({}, { first_meal: { 1: '2026-03-01' } }), { got: GOT, av: { stage: 'stage2', face: 'face_smile', acc: 'acc_none' } }).av, DEFAULT_AV); // this device's choice wins
  assert.deepEqual(restoreBadges(REC({ acc: 'acc_crown' }, {}), { got: GOT, av: { stage: 'stage2', face: 'face_smile', acc: 'acc_leaf' } }).av, DEFAULT_AV); // its own unearned part is dropped
  assert.deepEqual(restoreBadges({ got: GOT, av: { stage: 'stage2' } }, { got: {} }).av, { ...DEFAULT_AV, stage: 'stage2' });
});

test('every part with a requirement resolves to a badge step that unlocks exactly that part', () => {
  for (const [p, { req }] of Object.entries(PARTS)) {
    assert.ok(PART_NAME[p], p);
    if (!req) { assert.equal(unlocked(p, {}), true); continue; }
    assert.equal(unlocked(p, {}), false);
    assert.equal(unlocked(p, { [req[0]]: { [req[1]]: '2026-03-01' } }), true);
  }
});

test('avatarChoices: free parts, locked parts and the worn one', () => {
  const g = avatarChoices(REC({ stage: 'stage2' }));
  assert.deepEqual(g.map((x) => x.slot), ['stage', 'face', 'acc']);
  const flat = Object.fromEntries(g.flatMap((x) => x.parts).map((p) => [p.part, p]));
  assert.equal(flat.stage1.locked, false);
  assert.equal(flat.stage2.selected, true);
  assert.equal(flat.stage1.selected, false);
  assert.equal(flat.stage3.locked, true);
  assert.deepEqual(flat.stage3.req, ['days_on', 100]);
  assert.equal(flat.face_smile.locked, false);
  assert.equal(flat.face_plain.selected, true);
  assert.equal(flat.acc_crown.locked, true);
  assert.equal(avatarChoices(null).flatMap((x) => x.parts).filter((p) => !p.locked).length, 3);
});

test('wear: only an earned part is worn; the same object comes back when nothing changes', () => {
  const rec = REC({});
  const next = wear(rec, 'stage2');
  assert.equal(next.av.stage, 'stage2');
  assert.equal(rec.av.stage, 'stage1'); // not mutated
  assert.equal(wear(next, 'stage2'), next);
  assert.equal(wear(rec, 'stage3'), rec);
  assert.equal(wear(rec, 'acc_crown'), rec);
  assert.equal(wear(rec, 'nope'), rec);
  assert.equal(wear(rec, '__proto__'), rec);
  assert.equal(wear(null, 'stage1'), null);
  assert.equal(wear(REC({ acc: 'acc_crown' }), 'acc_none').av.acc, 'acc_none'); // a stored unearned part can be replaced
  assert.deepEqual(wear(wear(rec, 'face_smile'), 'acc_leaf').av, { stage: 'stage1', face: 'face_smile', acc: 'acc_leaf' });
});

test('choices written through the serial queue each build on the latest record, and a failed write rolls back', async () => {
  let S = REC({});
  let disk = S;
  const q = serial();
  const choose = (part, fail) => q(async () => {
    const next = wear(S, part);
    if (next === S) return false;
    const before = S;
    S = next;
    try { if (fail) throw new Error('disk'); disk = next; } catch (e) { S = before; throw e; }
    return true;
  });
  const all = await Promise.allSettled([choose('stage2'), choose('face_smile'), choose('acc_leaf', true), choose('acc_none')]);
  assert.deepEqual(all.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled']);
  assert.deepEqual(disk.av, { stage: 'stage2', face: 'face_smile', acc: 'acc_none' });
  assert.deepEqual(S, disk);
});

test('the picker renders in English and Turkish: chips, locks, hints, pressed state', async () => {
  fixture();
  let h = views.renderAvatarSheet();
  assert.equal((h.match(/data-act="avatar-pick"/g) || []).length, 13);
  assert.match(h, /<h3 class="av-slot" id="av-stage">Growth<\/h3>/);
  assert.match(h, /aria-pressed="true">Dill</);
  assert.match(h, /data-part="stage3" data-hint="Earn Days on plan: 100" aria-pressed="false">/);
  assert.match(h, /data-hint="Earn Kilos down: 3 kg"/);
  assert.match(h, /data-hint="Earn Goal reached"/);
  assert.match(h, /data-hint="Earn Perfect days: 10"/);
  assert.doesNotMatch(h, /data-part="stage2"[^>]*data-hint/); // earned: no hint
  assert.equal((h.match(/ is-locked/g) || []).length, 5);
  assert.match(h, /aria-label="Your pickle, Dill, Smile, Leaf"/);
  await setLang('tr');
  h = views.renderAvatarSheet();
  assert.match(h, /Büyüme/);
  assert.match(h, /data-hint="Kazan: Planda geçen günler \(100\)"/);
  assert.match(h, /data-hint="Kazan: Hedefe ulaşıldı"/);
  assert.match(h, /aria-label="Turşun, Dereotlu, Gülümseme, Yaprak"/);
  assert.match(h, /Kornişon/);
});

test('the header carries the avatar button next to Settings, and shows a plain pickle when the record wears what is not earned', () => {
  fixture();
  let h = views.renderToday();
  assert.match(h, /<button type="button" class="icon-btn av-btn" id="btn-avatar" data-act="avatar" aria-label="Your pickle">.*?<\/button><button type="button" class="icon-btn" data-act="settings"/s);
  core.S.badges.av = { stage: 'stage3', face: 'face_star', acc: 'acc_crown' };
  h = views.renderToday();
  assert.match(h, /aria-label="Your pickle, Gherkin, Calm, None"/);
  core.S.badges = null;
  assert.match(views.renderToday(), /aria-label="Your pickle, Gherkin, Calm, None"/);
});
