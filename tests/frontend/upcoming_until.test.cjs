// tests/frontend/upcoming_until.test.cjs — 参加予定の大会をいつまで出すか (js/upcoming_until.js): 大会が終わるまで。
const test = require('node:test');
const assert = require('node:assert');

test('終了予定があればそこまで (短すぎても開始から 3 時間)、無ければ開始から 12 時間', async () => {
  const { untilSec, shown } = await import('../../site/js/upcoming_until.js');
  const S = 1_800_000_000, H = 3600;
  assert.strictEqual(untilSec({ start_at: S, end_at: S + 36 * H }), S + 36 * H);   // 2 日開催の 2 日目も出す
  assert.strictEqual(untilSec({ start_at: S, end_at: S + H }), S + 3 * H);
  assert.strictEqual(untilSec({ start_at: S }), S + 12 * H);
  assert.strictEqual(untilSec({ start_at: S, end_at: null }), S + 12 * H);
  assert.ok(shown({ start_at: S, end_at: S + 36 * H }, S + 30 * H));
  assert.ok(!shown({ start_at: S, end_at: S + 36 * H }, S + 36 * H));
  assert.ok(shown({ start_at: S }, S - 86400));   // 開催前
});
