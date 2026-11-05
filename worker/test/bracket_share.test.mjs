// トーナメントプレビューの短い URL (src/api/bracket_share.ts) のテスト (2026-11-05)
import test from 'node:test';
import assert from 'node:assert';
import { handleBracketShareCreate, handleBracketShareGet } from '../src/api/bracket_share.ts';
import { MemStore } from './_mem_store.mjs';

const DAY = 86400000;
const body = (r) => JSON.parse(JSON.stringify(r.body));

test('作って読める・保存期間 (1 / 3 / 7 日、既定 3 日) を過ぎたら読めない・形式の違うものは断る', async () => {
  const store = new MemStore();
  const frag = 'v=1&ph=0&wd=1&d=abcDEF_-123';
  const c = body(await handleBracketShareCreate(store, { frag, days: 7 }, 1000));
  assert.strictEqual(c.ok, true);
  assert.match(c.id, /^[A-Za-z2-9]{8}$/);
  assert.strictEqual(c.expires_ms, 1000 + 7 * DAY);
  assert.deepStrictEqual(body(await handleBracketShareGet(store, { id: c.id }, 1000 + 6 * DAY)).frag, frag);
  assert.strictEqual(body(await handleBracketShareGet(store, { id: c.id }, 1000 + 8 * DAY)).error.code, 'not_found');
  const d = body(await handleBracketShareCreate(store, { frag: '#' + frag, days: 99 }, 1000));
  assert.strictEqual(d.expires_ms, 1000 + 3 * DAY, '既定 3 日');
  for (const bad of ['', 'x=1', 'v=1&ph=0', 'v=1&d=a<b', 'v=1&d=' + 'a'.repeat(130000)]) {
    assert.strictEqual(body(await handleBracketShareCreate(store, { frag: bad }, 1000)).error.code, 'bad_request', bad.slice(0, 20));
  }
  assert.strictEqual(body(await handleBracketShareGet(store, { id: '../x' }, 1000)).error.code, 'not_found');
});
