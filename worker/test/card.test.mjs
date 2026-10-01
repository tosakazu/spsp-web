// ログイン確認 (me) とプレイヤーカードの設定 (card_get / card_put、GET /api/card)。docs/login_design.md
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http, loginToken, OK_TOKEN, OK_USER } from './_env.mjs';
import { validateCardSettings } from '../src/api/card.ts';
import { issueSessionToken } from '../src/api/session.ts';
import { CARD_RATE_MIN_INTERVAL_MS, CARD_RATE_MAX_PER_DAY } from '../src/config.ts';

const env = (o) => makeEnv(Object.assign({ token: OK_TOKEN, user: OK_USER }, o || {}));
const GOOD = { template: 'standard', color: 'blue', ach: ['tour:{"name":"篝火#15"}', 'rank:top8'], tour: 1648718 };
const plain = (x) => JSON.parse(JSON.stringify(x));

test('me: 有効なトークンは中身 (user, exp) を返す。無効・期限切れは invalid_session で記録しない', async () => {
  const e = env();
  const token = await loginToken(e);
  const res = await post(e, { action: 'me', token });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.user, { id: '4242', slug: 'user/abcd1234', gamerTag: 'Toko' });
  assert.strictEqual(typeof res.exp, 'number');
  const fetchesBefore = e.fetches.length;
  for (const bad of [undefined, '', 'garbage', token + 'x']) {
    const r = await post(e, { action: 'me', token: bad });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, 'invalid_session');
  }
  const old = await issueSessionToken(e.cfg, { id: '4242', slug: 'user/x', gamerTag: 'T' }, Date.now() - e.cfg.sessionTtlMs - 1000);
  assert.strictEqual((await post(e, { action: 'me', token: old })).error.code, 'invalid_session');
  assert.strictEqual(e.fetches.length, fetchesBefore, 'start.gg には問い合わせない');
  assert.strictEqual(e.store.errors.length, 0, '期限切れは記録しない');
});

test('validateCardSettings: 許す形と弾く形', () => {
  assert.deepStrictEqual(plain(validateCardSettings(GOOD)), GOOD);
  assert.deepStrictEqual(plain(validateCardSettings({ template: 'standard', color: 'red' })), { template: 'standard', color: 'red', ach: null, tour: null });
  assert.deepStrictEqual(plain(validateCardSettings({ template: 'standard', color: 'red', ach: [] })), { template: 'standard', color: 'red', ach: [], tour: null });
  for (const c of ['red', 'blue', 'green', 'purple', 'orange', 'teal', 'yellow', 'gray']) assert.ok(validateCardSettings({ template: 'standard', color: c, ach: null }));
  const bads = [
    null, 'x', [], {},
    { template: 'fancy', color: 'red' }, { color: 'red' },
    { template: 'standard', color: 'black' }, { template: 'standard', color: 'RED' }, { template: 'standard' },
    { template: 'standard', color: 'red', ach: 'a' },
    { template: 'standard', color: 'red', ach: [1] },
    { template: 'standard', color: 'red', ach: [''] },
    { template: 'standard', color: 'red', ach: ['a', 'a'] },
    { template: 'standard', color: 'red', ach: ['x'.repeat(301)] },
    { template: 'standard', color: 'red', ach: Array.from({ length: 13 }, (_, i) => 'k' + i) },
    { template: 'standard', color: 'red', ach: null, extra: 1 },
  ];
  for (const b of bads) assert.strictEqual(validateCardSettings(b), null, JSON.stringify(b));
  assert.ok(validateCardSettings({ template: 'standard', color: 'red', ach: ['x'.repeat(300)] }), '300 文字ちょうどは可');
  assert.ok(validateCardSettings({ template: 'standard', color: 'red', ach: Array.from({ length: 12 }, (_, i) => 'k' + i) }), '12 個ちょうどは可');
});

test('card_put → card_get: 本人の行に書け、だれでも読める。updated_at は +09:00', async () => {
  const e = env();
  const token = await loginToken(e);
  const put = await post(e, { action: 'card_put', token, settings: GOOD });
  assert.strictEqual(put.ok, true);
  assert.deepStrictEqual(put.settings, GOOD);
  assert.match(put.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  const got = await post(e, { action: 'card_get', uid: '4242' });
  assert.deepStrictEqual(got, { ok: true, settings: GOOD, updated_at: put.updated_at });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: 7 }), { ok: true, settings: null, updated_at: null });
});

test('card_put: 書く uid はトークンのものだけ (リクエストの uid は無視)', async () => {
  const e = env();
  const token = await loginToken(e);
  await post(e, { action: 'card_put', token, uid: '9999', user_id: '9999', settings: GOOD });
  assert.deepStrictEqual([...e.store.cards.keys()], ['4242']);
  assert.strictEqual((await post(e, { action: 'card_get', uid: '9999' })).settings, null);
});

test('card_put: トークン無効は invalid_session、形が違えば bad_settings。どちらも書かず errors に残す', async () => {
  const e = env();
  const token = await loginToken(e);
  assert.strictEqual((await post(e, { action: 'card_put', token: 'garbage', settings: GOOD })).error.code, 'invalid_session');
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: { template: 'standard', color: 'pink' } })).error.code, 'bad_settings');
  assert.strictEqual((await post(e, { action: 'card_put', token })).error.code, 'bad_settings', 'settings 省略は削除ではない');
  assert.strictEqual(e.store.cards.size, 0);
  assert.strictEqual(e.store.cardWrites.length, 0, '弾いた書き込みは連投の数に入れない');
  assert.deepStrictEqual(e.store.errors.map((r) => [r.action, r.code, r.user_id]),
    [['card_put', 'invalid_session', ''], ['card_put', 'bad_settings', '4242'], ['card_put', 'bad_settings', '4242']]);
});

test('card_put: settings:null で行を消す (既定に戻す)', async () => {
  const e = env();
  const token = await loginToken(e);
  e.nowMs = Date.parse('2026-09-30T03:00:00Z');
  await post(e, { action: 'card_put', token, settings: GOOD });
  e.nowMs += CARD_RATE_MIN_INTERVAL_MS + 1;
  const del = await post(e, { action: 'card_put', token, settings: null });
  assert.deepStrictEqual(del, { ok: true, settings: null, updated_at: null });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '4242' }), { ok: true, settings: null, updated_at: null });
});

test('card_put: 連投制限 (間隔と当日件数)。弾いたときは前の設定のまま', async () => {
  const e = env();
  const token = await loginToken(e);
  let t = Date.parse('2026-09-30T00:00:00Z');   // JST 09:00
  e.nowMs = t;
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).ok, true);
  e.nowMs = t + CARD_RATE_MIN_INTERVAL_MS - 1;
  const r = await post(e, { action: 'card_put', token, settings: { ...GOOD, color: 'red' } });
  assert.strictEqual(r.error.code, 'rate_limited');
  assert.strictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings.color, 'blue');
  for (let i = 1; i < CARD_RATE_MAX_PER_DAY; i++) {
    t += CARD_RATE_MIN_INTERVAL_MS;
    e.nowMs = t;
    assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).ok, true, 'i=' + i);
  }
  e.nowMs = t + CARD_RATE_MIN_INTERVAL_MS;
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).error.code, 'rate_limited', '当日上限');
  e.nowMs = Date.parse('2026-10-01T00:00:00Z');   // 翌日
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).ok, true);
});

test('GET /api/card?uid=: 成功は public, max-age=60、uid 不正は bad_request で no-store', async () => {
  const e = env();
  const token = await loginToken(e);
  await post(e, { action: 'card_put', token, settings: GOOD });
  const r = await http(e, 'GET', '/api/card?uid=4242');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('Cache-Control'), 'public, max-age=60');
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepStrictEqual(r.json.settings, GOOD);
  const none = await http(e, 'GET', '/api/card?uid=1');
  assert.deepStrictEqual(none.json, { ok: true, settings: null, updated_at: null });
  for (const q of ['', '?uid=', '?uid=abc', '?uid=-1', '?uid=1234567890123']) {
    const b = await http(e, 'GET', '/api/card' + q);
    assert.strictEqual(b.json.error.code, 'bad_request', q);
    assert.strictEqual(b.headers.get('Cache-Control'), 'no-store', q);
  }
  // POST /api/card_put (パスから action を補う) でも書ける
  e.nowMs = Date.now() + CARD_RATE_MIN_INTERVAL_MS + 1;
  const p = await http(e, 'POST', '/api/card_put', { token, settings: { ...GOOD, color: 'green' } });
  assert.strictEqual(p.json.ok, true);
  assert.strictEqual(p.headers.get('Cache-Control'), 'no-store');
});

test('card_get: 保存済みの行が壊れていれば無いものとして返す', async () => {
  const e = env();
  e.store.cards.set('5', { settings: '{broken', updated_at: 'x' });
  e.store.cards.set('6', { settings: JSON.stringify({ template: 'old', color: 'red' }), updated_at: 'x' });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '5' }), { ok: true, settings: null, updated_at: null });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '6' }), { ok: true, settings: null, updated_at: null });
});

test('validateCardSettings: tour は event_id (正の整数 1〜12 桁) か null。数字の文字列は整数にする', () => {
  const base = { template: 'standard', color: 'red', ach: null };
  assert.strictEqual(validateCardSettings({ ...base, tour: 1648718 }).tour, 1648718);
  assert.strictEqual(validateCardSettings({ ...base, tour: '1648718' }).tour, 1648718);
  assert.strictEqual(validateCardSettings({ ...base, tour: null }).tour, null);
  assert.strictEqual(validateCardSettings(base).tour, null);
  assert.strictEqual(validateCardSettings({ ...base, tour: 999999999999 }).tour, 999999999999);
  for (const bad of [0, -1, 1.5, '0', '01', 'abc', '', '1e5', ' 12', 1e12, '1234567890123', true, [1], {}]) {
    assert.strictEqual(validateCardSettings({ ...base, tour: bad }), null, JSON.stringify(bad));
  }
});

test('card_put: tour を文字列で送っても整数で保存・返す', async () => {
  const e = env();
  const token = await loginToken(e);
  const put = await post(e, { action: 'card_put', token, settings: { template: 'standard', color: 'red', tour: '1702406' } });
  assert.deepStrictEqual(put.settings, { template: 'standard', color: 'red', ach: null, tour: 1702406 });
  assert.strictEqual(JSON.parse(e.store.cards.get('4242').settings).tour, 1702406);
  assert.deepStrictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings, put.settings);
});

test('card_put: 追加の色 (teal / yellow / gray) も保存できる。それ以外の色は bad_settings', async () => {
  const e = env();
  const token = await loginToken(e);
  let t = Date.parse('2026-10-01T03:00:00Z');
  for (const color of ['teal', 'yellow', 'gray']) {
    e.nowMs = t; t += CARD_RATE_MIN_INTERVAL_MS + 1;
    const r = await post(e, { action: 'card_put', token, settings: { template: 'standard', color } });
    assert.strictEqual(r.ok, true, color);
    assert.strictEqual(r.settings.color, color);
    assert.strictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings.color, color);
  }
  e.nowMs = t;
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: { template: 'standard', color: 'grey' } })).error.code, 'bad_settings');
});
