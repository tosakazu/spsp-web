// ログインの引き継ぎ (src/api/login.ts、2026-11-05)
import test from 'node:test';
import assert from 'node:assert';
import { handleBeginLogin, checkStateToken } from '../src/api/session.ts';
import { handleLogin, handleLoginHandoff, handoffHash, LOGIN_HANDOFF_TTL_MS } from '../src/api/login.ts';
import { SESSION_TTL_MS_DEFAULT, STATE_TTL_MS_DEFAULT } from '../src/config.ts';
import { MemStore } from './_mem_store.mjs';

const cfg = { clientId: 'cid', redirectUri: 'https://x/callback.html', clientSecret: 'CS', sessionSecret: 'sess-handoff', sessionTtlMs: SESSION_TTL_MS_DEFAULT, stateTtlMs: STATE_TTL_MS_DEFAULT, tsOffsetMin: 540 };
const body = (r) => JSON.parse(JSON.stringify(r.body));
// start.gg の code 交換と /me
const fetchFn = async (url) => {
  const u = String(url);
  if (u.includes('oauth/access_token') || u.includes('/oauth/token')) return new Response(JSON.stringify({ access_token: 'AT-x', expires_in: 604800, refresh_token: 'RT-x' }), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response(JSON.stringify({ data: { currentUser: { id: 42, slug: 'user/abc', player: { gamerTag: 'P' } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const S = 'A'.repeat(10) + 'b_c-' + 'z'.repeat(29);   // 43 文字の乱数の代わり

test('別のブラウザで戻ったときだけ置き、始めた画面が s で 1 回だけ取れる。ハッシュ (state に載る値) では取れない', async () => {
  const store = new MemStore();
  const h = await handoffHash(S);
  const st = body(await handleBeginLogin(cfg, { nonce: 'n', returnPath: '/jp/report/', flow: 'login', handoff_h: h }, 1000)).state;
  const p = await checkStateToken(cfg, store, st, false, 1000);
  assert.strictEqual(p.payload.h, h, '署名つき state にハッシュ');
  assert.ok(!st.includes(S));
  // 同じブラウザで戻った (handoff: false): 置かない
  const st2 = body(await handleBeginLogin(cfg, { nonce: 'n', returnPath: '/', flow: 'login', handoff_h: h }, 1000)).state;
  const same = body(await handleLogin(cfg, store, fetchFn, { code: 'C1', state: st2, handoff: false }, 2000));
  assert.strictEqual(same.ok, true, JSON.stringify(same));
  assert.deepStrictEqual(body(await handleLoginHandoff(cfg, store, { s: S }, 3000)), { ok: true, pending: true });
  // 別のブラウザ (handoff: true): 置く
  const r = body(await handleLogin(cfg, store, fetchFn, { code: 'C2', state: st, handoff: true }, 2000));
  assert.strictEqual(r.ok, true);
  assert.ok(![...store.handoffs.values()][0].data.includes('AT-x'), '暗号化して置く');
  assert.deepStrictEqual(body(await handleLoginHandoff(cfg, store, { s: h }, 3000)), { ok: true, pending: true }, 'ハッシュでは取れない');
  const got = body(await handleLoginHandoff(cfg, store, { s: S }, 3000));
  assert.deepStrictEqual([got.token, got.user.id, got.startgg.access_token], [r.token, r.user.id, 'AT-x']);
  assert.deepStrictEqual(body(await handleLoginHandoff(cfg, store, { s: S }, 3001)), { ok: true, pending: true }, '1 回だけ');
  // 記録: 普通のログイン 2 回 (同じ画面・別の画面) + 置いた + 取れた
  assert.deepStrictEqual(store.logins.map((l) => l.flow), ['login', 'login', 'handoff_put', 'handoff']);
  assert.ok(store.logins.every((l) => l.user_id === '42'));
  assert.strictEqual(body(await handleLoginHandoff(cfg, store, { s: 'x' }, 3000)).error.code, 'bad_request');
});

test('期限 (15 分) を過ぎたら取れない・ハッシュの形が違えば state に入れない', async () => {
  const store = new MemStore();
  const st = body(await handleBeginLogin(cfg, { nonce: 'n', returnPath: '/', flow: 'login', handoff_h: await handoffHash(S) }, 1000)).state;
  assert.strictEqual(body(await handleLogin(cfg, store, fetchFn, { code: 'C', state: st, handoff: true }, 2000)).ok, true);
  assert.deepStrictEqual(body(await handleLoginHandoff(cfg, store, { s: S }, 2000 + LOGIN_HANDOFF_TTL_MS + 1)), { ok: true, pending: true });
  const bad = body(await handleBeginLogin(cfg, { nonce: 'n', returnPath: '/', flow: 'login', handoff_h: 'short' }, 1000)).state;
  assert.strictEqual((await checkStateToken(cfg, store, bad, false, 1000)).payload.h, undefined);
  // 運営用のフローには付けない
  const mgr = body(await handleBeginLogin(cfg, { nonce: 'n', returnPath: '/', flow: 'post', handoff_h: await handoffHash(S) }, 1000)).state;
  assert.strictEqual((await checkStateToken(cfg, store, mgr, false, 1000)).payload.h, undefined);
});
