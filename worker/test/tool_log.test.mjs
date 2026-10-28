// 大会運営ツールの使用記録 (action tool_log、tool_logs)。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, rawPost, loginToken, OK_TOKEN, OK_USER } from './_env.mjs';
import { TOOL_LOG_MAX_PER_DAY } from '../src/config.ts';

const env = () => makeEnv({ token: OK_TOKEN, user: OK_USER });
const base = (o) => Object.assign({
  action: 'tool_log', tool: 'seed', op: 'seeding', auth: 'key', user_id: '4242', gamer_tag: 'Toko',
  tournament_id: 777, tournament_slug: 'tournament/kagaribi-15', tournament_name: '篝火#15', event_id: 555, event_name: 'Singles',
  phase_id: 999, count: 32, detail: { method: 'total', optimize: { applied: true, options: { 'so-avoid-region': true } } },
}, o || {});

test('tool_log: API キー (セッション無し) はブラウザの申告のまま verified 0 で残す', async () => {
  const e = env();
  assert.deepStrictEqual(await rawPost(e, base()), { ok: true, logged: true });
  const r = e.store.toolLogs[0];
  assert.deepStrictEqual([r.tool, r.action, r.user_id, r.gamer_tag, r.verified, r.auth], ['seed', 'seeding', '4242', 'Toko', 0, 'key']);
  assert.deepStrictEqual([r.tournament_id, r.tournament_slug, r.tournament_name, r.event_id, r.event_name, r.phase_id, r.count],
    [777, 'tournament/kagaribi-15', '篝火#15', 555, 'Singles', 999, 32]);
  assert.deepStrictEqual(JSON.parse(r.detail).optimize.options, { 'so-avoid-region': true });
  assert.match(r.ts, /\+09:00$/);
});

test('tool_log: SPSP のセッションがあればそのユーザー (申告は無視) で verified 1', async () => {
  const e = env();
  const token = await loginToken(e);
  assert.strictEqual((await rawPost(e, base({ tool: 'seed_upload', auth: 'login', token, user_id: '1', gamer_tag: 'Other' }))).ok, true);
  const r = e.store.toolLogs[0];
  assert.deepStrictEqual([r.tool, r.user_id, r.gamer_tag, r.verified, r.auth], ['seed_upload', '4242', 'Toko', 1, 'login']);
  assert.ok(!JSON.stringify(e.store.toolLogs).includes(token), 'セッションのトークンは残さない');
});

test('tool_log: 機能・操作・ユーザーが不正なら bad_request。class はブラウザからは受けない', async () => {
  const e = env();
  for (const o of [{ tool: 'class' }, { tool: 'x' }, { op: 'create' }, { user_id: 'abc' }, { user_id: undefined }]) {
    assert.strictEqual((await rawPost(e, base(o))).error.code, 'bad_request', JSON.stringify(o));
  }
  assert.strictEqual((e.store.toolLogs || []).length, 0);
});

test('tool_log: 長すぎる欄は切る・detail が長すぎれば truncated・数でない ID は null', async () => {
  const e = env();
  await rawPost(e, base({ tournament_name: 'あ'.repeat(500), detail: { x: 'y'.repeat(5000) }, event_id: 'abc', count: -1, auth: 'zzz' }));
  const r = e.store.toolLogs[0];
  assert.strictEqual(r.tournament_name.length, 200);
  assert.strictEqual(r.detail, '{"truncated":true}');
  assert.strictEqual(r.event_id, null);
  assert.strictEqual(r.count, null);
  assert.strictEqual(r.auth, '');
});

test('tool_log: 1 人 1 日の上限を超えたら rate_limited', async () => {
  const e = env();
  e.nowMs = Date.parse('2026-10-28T03:00:00Z');
  for (let i = 0; i < TOOL_LOG_MAX_PER_DAY; i++) assert.strictEqual((await rawPost(e, base())).ok, true);
  assert.strictEqual((await rawPost(e, base())).error.code, 'rate_limited');
  assert.strictEqual((await rawPost(e, base({ user_id: '5' }))).ok, true, '別の人は通る');
});
