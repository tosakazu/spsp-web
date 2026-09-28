// 入口 (dispatch / handleApiRequest) の応答の形と、index.ts の配信まわり。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, rawPost, http, OK_TOKEN, OK_USER } from './_env.mjs';
import { dispatch } from '../src/api/router.ts';
import worker, { legacyRedirectTarget, langDirRedirectTarget, withSecurityHeaders, CALLBACK_CSP } from '../src/index.ts';

const env = () => makeEnv({ token: OK_TOKEN, user: OK_USER });

test('未知の action / 空 / 配列 / 文字列は bad_request (メッセージは GAS と同じ)', async () => {
  const e = env();
  assert.deepStrictEqual(await rawPost(e, { action: 'nope' }), { ok: false, error: { code: 'bad_request', message: '不明な action です。' } });
  assert.deepStrictEqual(await rawPost(e, {}), { ok: false, error: { code: 'bad_request', message: '不明な action です。' } });
  assert.deepStrictEqual(await dispatch(e.ctx, undefined), { ok: false, error: { code: 'bad_request', message: 'リクエストが空です。' } });
  for (const bad of [null, 'str', 42, [1]]) {
    assert.deepStrictEqual(await dispatch(e.ctx, bad), { ok: false, error: { code: 'bad_request', message: 'リクエストの形式が不正です。' } });
  }
});

test('HTTP: text/plain の JSON を POST /api で受ける (GAS の /exec と同じ)', async () => {
  const e = env();
  const r = await http(e, 'POST', '/api', { action: 'begin_login', nonce: 'N', returnPath: '/jp/vote.html' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  assert.strictEqual(r.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual(r.json.ok, true);
  assert.ok(r.json.state);
  // 末尾スラッシュ付きも同じ
  assert.strictEqual((await http(e, 'POST', '/api/', { action: 'begin_login', nonce: 'N' })).json.ok, true);
});

test('HTTP: 壊れた JSON / 空 body / 大きすぎる body は bad_request (200 で JSON)', async () => {
  const e = env();
  const broken = await http(e, 'POST', '/api', '{{{');
  assert.strictEqual(broken.status, 200);
  assert.strictEqual(broken.json.error.code, 'bad_request');
  assert.strictEqual(broken.json.error.message, 'リクエストの形式が不正です。');
  const empty = await http(e, 'POST', '/api', '');
  assert.strictEqual(empty.json.error.message, 'リクエストが空です。');
  const big = await http(e, 'POST', '/api', '"' + 'a'.repeat(70000) + '"');
  assert.strictEqual(big.json.error.code, 'bad_request');
});

test('HTTP: GET /api は POST のみと返す (doGet)、OPTIONS は preflight に応える', async () => {
  const e = env();
  const r = await http(e, 'GET', '/api');
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json, { ok: false, error: { code: 'bad_request', message: 'このエンドポイントは POST のみ受け付けます。' } });
  assert.strictEqual((await http(e, 'GET', '/api/vote')).json.error.code, 'bad_request');
  const o = await http(e, 'OPTIONS', '/api');
  assert.strictEqual(o.status, 204);
  assert.strictEqual(o.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.strictEqual((await http(e, 'PUT', '/api', {})).json.error.code, 'bad_request');
});

test('HTTP: POST /api/<action> は body の action を補う (body 側が優先)', async () => {
  const e = env();
  const r = await http(e, 'POST', '/api/begin_login', { nonce: 'N' });
  assert.strictEqual(r.json.ok, true);
  const r2 = await http(e, 'POST', '/api/vote', { action: 'begin_login', nonce: 'N' });
  assert.strictEqual(r2.json.ok, true);
  const r3 = await http(e, 'POST', '/api/client_error', { kind: 'oauth_denied' });
  assert.deepStrictEqual(r3.json, { ok: true, logged: true });
  const r4 = await http(e, 'POST', '/api/nope', {});
  assert.strictEqual(r4.json.error.message, '不明な action です。');
});

test('エラー応答の形は { ok:false, error:{ code, message } } で、他のキーは無い', async () => {
  const e = env();
  const codes = new Set();
  const r1 = await rawPost(e, { action: 'vote', token: 'x', charId: '1' });
  const r2 = await rawPost(e, { action: 'login', code: 'C' });
  const r3 = await rawPost(e, { action: 'post', code: 'C' });
  const r4 = await rawPost(e, { action: 'export_votes', key: 'x' });
  for (const r of [r1, r2, r3, r4]) {
    assert.deepStrictEqual(Object.keys(r).sort(), ['error', 'ok']);
    assert.deepStrictEqual(Object.keys(r.error).sort(), ['code', 'message']);
    assert.strictEqual(typeof r.error.message, 'string');
    codes.add(r.error.code);
  }
  assert.deepStrictEqual([...codes].sort(), ['auth_failed', 'body_invalid', 'state_invalid']);
});

test('ハンドラの例外は internal になり、内容はレスポンスに出ない', async () => {
  const e = env();
  const state = (await rawPost(e, { action: 'begin_login', nonce: 'N' })).state;
  e.store.checkState = async () => { throw new Error('D1 exploded: secret-ish detail'); };
  const r = await rawPost(e, { action: 'login', code: 'C', state });
  assert.deepStrictEqual(r, { ok: false, error: { code: 'internal', message: 'サーバー側でエラーが発生しました。' } });
  // 例外は errors に残る (message は内部の手掛かりとしてだけ)
  const last = e.store.errors[e.store.errors.length - 1];
  assert.strictEqual(last.code, 'exception');
  assert.strictEqual(last.action, 'doPost');
});

// ── index.ts ──

test('旧 URL の付け替え: /p/?uid= → /jp/p/?uid=、地域配下と未知はそのまま', () => {
  assert.strictEqual(legacyRedirectTarget('/p/', '/jp'), '/jp/p/');
  assert.strictEqual(legacyRedirectTarget('/t/123.html', '/jp'), '/jp/t/123.html');
  assert.strictEqual(legacyRedirectTarget('/vote.html', '/jp'), '/jp/vote.html');
  assert.strictEqual(legacyRedirectTarget('/en/index.html', '/jp'), '/jp/en/index.html');
  assert.strictEqual(legacyRedirectTarget('/jp/p/', '/jp'), null);
  assert.strictEqual(legacyRedirectTarget('/na/p/', '/jp'), null);
  assert.strictEqual(legacyRedirectTarget('/b/foo/p/', '/jp'), null);
  assert.strictEqual(legacyRedirectTarget('/unknown/', '/jp'), null);
  assert.strictEqual(legacyRedirectTarget('/api/x', '/jp'), null);
});

test('fetch handler: / は 301 /jp/、旧 URL はクエリを保って 301、それ以外は ASSETS にヘッダを足す', async () => {
  const calls = [];
  const fakeEnv = {
    SITE_PREFIX: '/jp',
    ASSETS: { fetch: async (req) => { calls.push(req.url); return new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }); } },
    DB: {},
  };
  const root = await worker.fetch(new Request('https://spsp.games/'), fakeEnv);
  assert.strictEqual(root.status, 301);
  assert.strictEqual(root.headers.get('location'), 'https://spsp.games/jp/');
  const legacy = await worker.fetch(new Request('https://spsp.games/p/?uid=123'), fakeEnv);
  assert.strictEqual(legacy.status, 301);
  assert.strictEqual(legacy.headers.get('location'), 'https://spsp.games/jp/p/?uid=123');
  const page = await worker.fetch(new Request('https://spsp.games/jp/vote.html'), fakeEnv);
  assert.strictEqual(page.status, 200);
  assert.strictEqual(page.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.strictEqual(page.headers.get('content-security-policy'), null);
  assert.deepStrictEqual(calls, ['https://spsp.games/jp/vote.html']);
});

test('callback.html には CSP (connect-src は自分自身) と no-referrer を付ける', async () => {
  const res = withSecurityHeaders(new Response('x', { status: 200 }), '/jp/callback.html');
  assert.strictEqual(res.headers.get('content-security-policy'), CALLBACK_CSP);
  assert.match(CALLBACK_CSP, /default-src 'none'/);
  assert.match(CALLBACK_CSP, /script-src 'self'/);
  assert.match(CALLBACK_CSP, /connect-src 'self'/);
  assert.ok(!/google/.test(CALLBACK_CSP));
  assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer');
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  const other = withSecurityHeaders(new Response('x'), '/jp/index.html');
  assert.strictEqual(other.headers.get('content-security-policy'), null);
});

test('fetch handler: /api は D1 を使う (D1 が無い偽 env でも例外は internal に畳まれる)', async () => {
  const fakeEnv = { SITE_PREFIX: '/jp', ASSETS: { fetch: async () => new Response('') }, DB: {}, SESSION_SECRET: 's' };
  const res = await worker.fetch(new Request('https://spsp.games/api', { method: 'POST', body: JSON.stringify({ action: 'begin_login', nonce: 'N' }) }), fakeEnv);
  assert.strictEqual(res.status, 200);
  const json = await res.json();
  assert.strictEqual(json.ok, true);   // begin_login は D1 に触らない
  const res2 = await worker.fetch(new Request('https://spsp.games/api', { method: 'POST', body: JSON.stringify({ action: 'login', code: 'C', state: json.state }) }), fakeEnv);
  const j2 = await res2.json();
  assert.strictEqual(j2.error.code, 'internal');   // DB.prepare が無い → 例外 → internal
});

test('言語別の木だった URL → 同じページ + ?lang (他のクエリは残す)', () => {
  assert.strictEqual(langDirRedirectTarget('/jp/en/', ''), '/jp/?lang=en');
  assert.strictEqual(langDirRedirectTarget('/jp/en', ''), '/jp/?lang=en');
  assert.strictEqual(langDirRedirectTarget('/jp/en/p/', '?d=830dec1e'), '/jp/p/?d=830dec1e&lang=en');
  assert.strictEqual(langDirRedirectTarget('/na/ja/c/ranking.html', '?char=1304'), '/na/c/ranking.html?char=1304&lang=ja');
  assert.strictEqual(langDirRedirectTarget('/jp/p/', '?d=1'), null);
  assert.strictEqual(langDirRedirectTarget('/jp/events/', ''), null);
});

test('旧サイトのドメインだけ差し替えた URL (/spsp/…) と /local/ も /jp/ へ', () => {
  assert.strictEqual(legacyRedirectTarget('/spsp/', '/jp'), '/jp/');
  assert.strictEqual(legacyRedirectTarget('/spsp', '/jp'), '/jp/');
  assert.strictEqual(legacyRedirectTarget('/spsp/p/', '/jp'), '/jp/p/');
  assert.strictEqual(legacyRedirectTarget('/spsp/c/ranking.html', '/jp'), '/jp/c/ranking.html');
  assert.strictEqual(legacyRedirectTarget('/local/ranking.html', '/jp'), '/jp/local/ranking.html');
  assert.strictEqual(legacyRedirectTarget('/spspx/', '/jp'), null);
});
