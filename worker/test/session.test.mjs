// セッショントークンと署名付き state (gas_state.test.cjs / gas_vote.test.cjs の該当分を移植)。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, rawPost, beginState, loginToken, OK_TOKEN, OK_USER, b64urlJson } from './_env.mjs';
import { issueSessionToken, verifySessionToken, verifyState, signState, base64UrlEncode, base64UrlDecode, timingSafeEq } from '../src/api/session.ts';

const env = (o) => makeEnv(Object.assign({ token: OK_TOKEN, user: OK_USER }, o || {}));

test('base64url は GAS と同じ詰め物つきで出し、無しでも読める', () => {
  const bytes = new TextEncoder().encode('ab');
  assert.strictEqual(base64UrlEncode(bytes), 'YWI=');
  assert.strictEqual(new TextDecoder().decode(base64UrlDecode('YWI')), 'ab');
  assert.strictEqual(new TextDecoder().decode(base64UrlDecode('YWI=')), 'ab');
  // '+' '/' は '-' '_' に
  assert.strictEqual(base64UrlEncode(new Uint8Array([0xfb, 0xff])), '-_8=');
});

test('timingSafeEq: 型・長さ・内容', () => {
  assert.strictEqual(timingSafeEq('abc', 'abc'), true);
  assert.strictEqual(timingSafeEq('abc', 'abd'), false);
  assert.strictEqual(timingSafeEq('abc', 'ab'), false);
  assert.strictEqual(timingSafeEq(undefined, 'ab'), false);
});

test('トークン往復: 発行 → 検証で同じユーザーと exp', async () => {
  const e = env();
  const now = 1_800_000_000_000;
  const tok = await issueSessionToken(e.cfg, { id: '4242', slug: 'user/x', gamerTag: 'Toko' }, now);
  assert.match(tok, /^[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/);
  const s = await verifySessionToken(e.cfg, tok, now + 1000);
  assert.deepStrictEqual(s, { id: '4242', slug: 'user/x', gamerTag: 'Toko', exp: now + e.cfg.sessionTtlMs });
  const payload = b64urlJson(tok.split('.')[0]);
  assert.deepStrictEqual(Object.keys(payload).sort(), ['exp', 'iat', 'slug', 'tag', 'uid', 'v']);
});

test('トークン: 改ざん・別 secret・形式不正・長すぎは null', async () => {
  const e = env();
  const tok = await issueSessionToken(e.cfg, { id: '4242', slug: 'user/x', gamerTag: 'Toko' });
  const [body, sig] = tok.split('.');
  const o = b64urlJson(body);
  o.uid = '9999';
  const tampered = Buffer.from(JSON.stringify(o)).toString('base64url') + '.' + sig;
  const other = env();
  const foreign = await issueSessionToken(other.cfg, { id: '4242', slug: 'user/x', gamerTag: 'Toko' });
  for (const bad of [undefined, null, '', 'garbage', 'a.b', 'a.b.c', tok + 'x', tampered, foreign, 'x'.repeat(5000)]) {
    assert.strictEqual(await verifySessionToken(e.cfg, bad), null, 'should reject: ' + String(bad).slice(0, 30));
  }
  assert.ok(await verifySessionToken(e.cfg, tok));
});

test('トークン: 期限切れは null (境界は exp を含む)', async () => {
  const e = env();
  const now = 1_800_000_000_000;
  const tok = await issueSessionToken(e.cfg, { id: '1', slug: '', gamerTag: '' }, now);
  assert.ok(await verifySessionToken(e.cfg, tok, now + e.cfg.sessionTtlMs));
  assert.strictEqual(await verifySessionToken(e.cfg, tok, now + e.cfg.sessionTtlMs + 1), null);
});

test('トークン: SESSION_SECRET 未設定なら発行が例外 (= dispatch では internal)', async () => {
  const e = env({ cfg: { sessionSecret: null } });
  await assert.rejects(() => issueSessionToken(e.cfg, { id: '1', slug: '', gamerTag: '' }), /SESSION_SECRET/);
  const r = await post(e, { action: 'login', code: 'C', state: 'x.y' });
  assert.strictEqual(r.error.code, 'internal');
  assert.ok(r.error.message.indexOf('SESSION_SECRET') === -1);
});

test('セッションの有効期間は 180 日 (半年)', async () => {
  const e = env();
  const before = Date.now();
  const res = await post(e, { action: 'login', code: 'C' });
  const days = (res.exp - before) / (24 * 3600 * 1000);
  assert.ok(days > 179 && days <= 181, 'exp が半年になっていない: ' + days + ' 日');
});

// ── 署名付き state ──

test('begin_login は署名付き state を返す', async () => {
  const r = await rawPost(env(), { action: 'begin_login', nonce: 'N1', returnPath: '/spsp/vote.html' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.split('.').length, 2, 'payload.署名 の形になっていない');
  assert.ok(r.state.split('.')[1].length > 20, '署名が短すぎる');
  assert.strictEqual(r.ttlMs, 5 * 60 * 1000);
});

test('state が無い login は通らない', async () => {
  const r = await rawPost(env(), { action: 'login', code: 'CODE-1' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'state_invalid');
});

test('自作の state は通らない (署名を作れない)', async () => {
  const payload = Buffer.from(JSON.stringify({ n: 'x', r: '/', t: Date.now() })).toString('base64url');
  const r = await rawPost(env(), { action: 'login', code: 'CODE-1', state: payload + '.FAKE' });
  assert.strictEqual(r.error.code, 'state_invalid');
});

test('payload を書き換えた state は通らない', async () => {
  const e = env();
  const st = await beginState(e);
  const [body, sig] = st.split('.');
  const o = b64urlJson(body);
  o.t = Date.now() + 60 * 60 * 1000;               // 期限を伸ばそうとする
  const tampered = Buffer.from(JSON.stringify(o)).toString('base64url') + '.' + sig;
  const r = await rawPost(e, { action: 'login', code: 'CODE-1', state: tampered });
  assert.strictEqual(r.error.code, 'state_invalid');
});

test('単回使用: 同じ state は 2 回使えない (ログイン CSRF 対策の本体)', async () => {
  const e = env();
  const st = await beginState(e);
  const first = await rawPost(e, { action: 'login', code: 'CODE-1', state: st });
  assert.strictEqual(first.ok, true);
  const second = await rawPost(e, { action: 'login', code: 'CODE-2', state: st });
  assert.strictEqual(second.error.code, 'state_invalid');
});

test('期限切れ・未来日付は通らない、期限内なら通る', async () => {
  const e = env();
  const now = 1_800_000_000_000;
  const st = await signState(e.cfg, 'N', '/spsp/vote.html', 'login', now);
  assert.ok(await verifyState(e.cfg, e.store, st, false, now + e.cfg.stateTtlMs));
  assert.strictEqual(await verifyState(e.cfg, e.store, st, false, now + e.cfg.stateTtlMs + 1), null);
  assert.strictEqual(await verifyState(e.cfg, e.store, st, false, now - 1), null);
});

test('consume=false は使用済みにしない', async () => {
  const e = env();
  const st = await beginState(e);
  assert.ok(await verifyState(e.cfg, e.store, st, false));
  assert.ok(await verifyState(e.cfg, e.store, st, true));
  assert.strictEqual(await verifyState(e.cfg, e.store, st, false), null);
});

test('誰になるかは code だけで決まる (state を差し替えてもなりすませない)', async () => {
  const e = env();
  const a = await rawPost(e, { action: 'login', code: 'CODE-A', state: await beginState(e, 'NA') });
  const b = await rawPost(e, { action: 'login', code: 'CODE-B', state: await beginState(e, 'NB') });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, true);
  assert.strictEqual(String(a.user.id), '4242');
  assert.strictEqual(String(b.user.id), '4242');
});

test('state に秘密は入らない (payload は読める前提で作る)', async () => {
  const e = env();
  const st = await beginState(e, 'NONCE-1', '/spsp/vote.html');
  const o = b64urlJson(st.split('.')[0]);
  assert.deepStrictEqual(Object.keys(o).sort(), ['f', 'n', 'r', 't']);
  assert.strictEqual(o.n, 'NONCE-1');
  assert.strictEqual(o.r, '/spsp/vote.html');
  assert.strictEqual(o.f, 'login');
  const raw = JSON.stringify(o);
  for (const bad of ['SECRET', 'secret', e.cfg.sessionSecret]) {
    assert.ok(raw.indexOf(bad) === -1, '秘密が入っている: ' + bad);
  }
});

test('長すぎる入力は拒否する', async () => {
  const e = env();
  assert.strictEqual((await rawPost(e, { action: 'begin_login', nonce: 'a'.repeat(200) })).error.code, 'bad_request');
  assert.strictEqual((await rawPost(e, { action: 'begin_login', returnPath: 'a'.repeat(600) })).error.code, 'bad_request');
  assert.strictEqual((await rawPost(e, { action: 'begin_login', nonce: 'a'.repeat(128), returnPath: 'a'.repeat(512) })).ok, true);
});

test('失敗した login は errors に残る (原因追跡)', async () => {
  const e = env();
  await rawPost(e, { action: 'login', code: 'CODE-1' });
  assert.ok(e.store.errors.some((r) => r.code === 'state_invalid' && r.source === 'server' && r.action === 'login'));
});

test('flow: 省略は login / post は post / 知らない値は login に倒す', async () => {
  const e = env();
  const f = async (flow) => b64urlJson((await rawPost(e, { action: 'begin_login', nonce: 'N', flow })).state.split('.')[0]).f;
  assert.strictEqual(await f(undefined), 'login');
  assert.strictEqual(await f('post'), 'post');
  assert.strictEqual(await f('../evil'), 'login');
});

test('login: トークンとユーザー情報と exp を返し、何も書かない', async () => {
  const e = env();
  const res = await post(e, { action: 'login', code: 'CODE-1' });
  assert.strictEqual(res.ok, true);
  assert.match(res.token, /^[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/);
  assert.deepStrictEqual(res.user, { id: '4242', slug: 'user/abcd1234', gamerTag: 'Toko' });
  assert.ok(typeof res.exp === 'number' && res.exp > Date.now());
  assert.strictEqual(e.store.votes.length, 0);
  assert.strictEqual(e.store.posts.length, 0);
  const tok = await loginToken(e);
  assert.ok(await verifySessionToken(e.cfg, tok));
});

test('login: code 不正は auth_failed、レスポンスに secret 類が漏れない、理由が errors の note に残る', async () => {
  const e = env({ token: { status: 401, body: { error: 'bad' } } });
  const res = await post(e, { action: 'login', code: 'CODE-x' });
  assert.strictEqual(res.error.code, 'auth_failed');
  assert.match(res.error.message, /認証を拒否/);
  const dump = JSON.stringify(res);
  for (const s of ['CODE-x', 'SECRET-DO-NOT-LEAK', 'AT-secret']) assert.ok(dump.indexOf(s) === -1, 'leaked: ' + s);
  const last = e.store.errors[e.store.errors.length - 1];
  assert.strictEqual(last.note, 'auth_rejected');
});

test('login: 失敗理由ごとのメッセージ (4xx / 5xx / 本文 error / 通信断 / no_user)', async () => {
  const cases = [
    [{ token: { status: 400, body: {} } }, /期限切れか、既に使用済み/],
    [{ token: { status: 503, body: 'down' } }, /混雑・障害中/],
    [{ token: { status: 200, body: 'not json' } }, /混雑・障害中/],
    [{ token: { status: 200, body: { error: 'invalid_grant' } } }, /期限切れか、既に使用済み/],
    [{ token: { status: 200, body: { error: 'invalid_client' } } }, /認証を拒否/],
    [{ token: null }, /接続できません/],
    [{ user: { status: 200, body: { data: { currentUser: null } } } }, /アカウント情報を読み取れません/],
  ];
  for (const [o, re] of cases) {
    const r = await post(env(o), { action: 'login', code: 'C' });
    assert.strictEqual(r.error.code, 'auth_failed', JSON.stringify(o));
    assert.match(r.error.message, re, JSON.stringify(o));
  }
});
