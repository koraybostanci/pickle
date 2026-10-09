// English snapshot: the screens' markup must stay byte-identical while their strings move into t() calls.
// The baseline in test/fixtures/en-snapshot.json was captured from the code before any wrapping.
// Regenerate it deliberately with `UPDATE_SNAPSHOT=1 node --test test/snapshot.test.mjs` after an intended English copy change.
// The fixture and the screens live in test/screens.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { screens } from './screens.mjs';

const FILE = new URL('./fixtures/en-snapshot.json', import.meta.url);

test('English screens render byte-identical to the baseline', () => {
  const got = screens();
  if (process.env.UPDATE_SNAPSHOT) { writeFileSync(FILE, JSON.stringify(got, null, 1) + '\n'); return; }
  const want = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.deepEqual(Object.keys(got), Object.keys(want));
  for (const k of Object.keys(want)) assert.equal(got[k], want[k], `screen "${k}" changed`);
});
