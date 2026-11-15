import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portionItems } from '../js/core.js';

test('portionItems: the items at the entry portion, so a favourite adds up to its totals', () => {
  const e = { mult: 1.5, items: [{ n: 'egg', g: 100, kcal: 143, p: 12.6, c: 0.7 }, { n: 'bread', g: 40, kcal: 100, p: 3 }] };
  const [egg, bread] = portionItems(e);
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  assert.deepEqual(Object.keys(egg), ['n', 'g', 'kcal', 'p', 'c']);
  [[egg.g, 150], [egg.kcal, 214.5], [egg.p, 18.9], [egg.c, 1.05], [bread.g, 60], [bread.kcal, 150], [bread.p, 4.5]].forEach(([x, y]) => near(x, y));
  assert.equal(Object.hasOwn(portionItems(e)[1], 'c'), false); // an absent macro stays absent
  assert.equal(e.items[0].g, 100); // the entry is not changed
});

test('portionItems: a single portion, no portion and no items', () => {
  const items = [{ n: 'a', g: 10, kcal: 20, p: 1 }];
  assert.deepEqual(portionItems({ mult: 1, items }), items);
  assert.deepEqual(portionItems({ items }), items);
  assert.deepEqual(portionItems({}), []);
});
