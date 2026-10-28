// 大会運営用の start.gg ログイン (manager_begin / manager_login)。scope が普段のログインと違い、アクセストークンを返す。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, rawPost, beginState, OK_USER, b64urlJson } from './_env.mjs';

const MGR_TOKEN = { status: 200, body: { access_token: 'AT-manager', token_type: 'Bearer', expires_in: 604800 } };
const env = (o) => makeEnv(Object.assign({ token: MGR_TOKEN, user: OK_USER }, o || {}));

async function managerState(e, returnPath) {
  const r = await rawPost(e, { action: 'manager_begin', nonce: 'NM', returnPath: returnPath || '/jp/seed' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  return new URL(r.url).searchParams.get('state');
}

test('manager_begin は運営用の scope と f=manager の state を載せた認可 URL を返す', async () => {
  const e = env();
  const r = await rawPost(e, { action: 'manager_begin', nonce: 'NM', returnPath: '/jp/class/' });
  const u = new URL(r.url);
  assert.strictEqual(u.origin + u.pathname, 'https://start.gg/oauth/authorize');
  assert.strictEqual(u.searchParams.get('scope'), 'user.identity tournament.manager');
  assert.strictEqual(u.searchParams.get('client_id'), 'test-client-id');
  assert.strictEqual(u.searchParams.get('redirect_uri'), e.cfg.redirectUri);
  const p = b64urlJson(u.searchParams.get('state').split('.')[0]);
  assert.strictEqual(p.f, 'manager');
  assert.strictEqual(p.r, '/jp/class/');
});

test('manager_begin: 長すぎる引数は bad_request', async () => {
  assert.strictEqual((await rawPost(env(), { action: 'manager_begin', nonce: 'a'.repeat(200) })).error.code, 'bad_request');
});

test('manager_login はセッションと start.gg のアクセストークンを返し、交換は運営用の scope で行う', async () => {
  const e = env();
  const r = await rawPost(e, { action: 'manager_login', code: 'CODE-M', state: await managerState(e) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.access_token, 'AT-manager');
  assert.strictEqual(r.expires_in, 604800);
  assert.deepStrictEqual(r.user, { id: '4242', slug: 'user/abcd1234', gamerTag: 'Toko' });
  assert.ok(typeof r.token === 'string' && r.token.length > 0);
  const ex = e.fetches.find(f => f.url.indexOf('/oauth/') !== -1);
  assert.strictEqual(JSON.parse(ex.init.body).scope, 'user.identity tournament.manager');
  // アクセストークンも秘密も記録に残らない
  assert.ok(!JSON.stringify(e.store.errors || []).includes('AT-manager'));
});

test('manager_login: 普段のログインの state は使えない / 運営用の state は普段のログインに使えない', async () => {
  const e = env();
  const a = await rawPost(e, { action: 'manager_login', code: 'C', state: await beginState(e) });
  assert.strictEqual(a.error.code, 'state_invalid');
  const b = await rawPost(e, { action: 'login', code: 'C', state: await managerState(e) });
  assert.strictEqual(b.error.code, 'state_invalid');
  assert.strictEqual(e.fetches.length, 0);   // どちらも start.gg に問い合わせない
});

test('manager_login: state は単回使用、code なしは bad_request、交換の失敗は auth_failed', async () => {
  const e = env();
  const st = await managerState(e);
  assert.strictEqual((await rawPost(e, { action: 'manager_login', code: 'C1', state: st })).ok, true);
  assert.strictEqual((await rawPost(e, { action: 'manager_login', code: 'C2', state: st })).error.code, 'state_invalid');
  assert.strictEqual((await rawPost(e, { action: 'manager_login', state: st })).error.code, 'bad_request');
  const f = env({ token: { status: 400, body: { error: 'invalid_grant' } } });
  assert.strictEqual((await rawPost(f, { action: 'manager_login', code: 'C', state: await managerState(f) })).error.code, 'auth_failed');
});
