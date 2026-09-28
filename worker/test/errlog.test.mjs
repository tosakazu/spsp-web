// 失敗の記録 (errors テーブル)。errlog.test.cjs を移植。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, OK_TOKEN, OK_USER } from './_env.mjs';
import { issueSessionToken } from '../src/api/session.ts';
import { ERRORS_MAX_ROWS, ERRORS_TRIM_TO } from '../src/config.ts';

const env = (o) => makeEnv(Object.assign({ token: OK_TOKEN, user: OK_USER }, o || {}));

test('サーバー側の失敗が errors に残る', async () => {
  const e = env();
  const r = await post(e, { action: 'vote', token: 'bogus', charId: '1305' });
  assert.strictEqual(r.ok, false);
  const last = e.store.errors[e.store.errors.length - 1];
  assert.match(last.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.strictEqual(last.source, 'server');
  assert.strictEqual(last.action, 'vote');
  assert.strictEqual(last.code, 'auth_failed');
  assert.strictEqual(last.user_id, '');
  assert.strictEqual(last.note, '');
});

test('client_error は 1 行だけ足す / 不明な action は汚さない / begin_login の失敗も記録しない', async () => {
  const e = env();
  await post(e, { action: 'vote', token: 'bogus', charId: '1305' });
  assert.strictEqual(e.store.errors.length, 1);
  await post(e, { action: 'client_error', kind: 'oauth_denied' });
  assert.strictEqual(e.store.errors.length, 2);
  await post(e, { action: 'nope' });
  await post(e, { action: 'begin_login', nonce: 'a'.repeat(200) });
  assert.strictEqual(e.store.errors.length, 2);
});

test('client_error: 白リストの種別だけ受ける', async () => {
  const e = env();
  const ok = await post(e, { action: 'client_error', kind: 'account_mismatch', note: 'x' });
  assert.deepStrictEqual(ok, { ok: true, logged: true });
  const before = e.store.errors.length;
  const ng = await post(e, { action: 'client_error', kind: '<script>alert(1)</script>' });
  assert.deepStrictEqual(ng, { ok: true, logged: false });
  assert.strictEqual(e.store.errors.length, before);
  for (const kind of ['account_mismatch', 'oauth_denied', 'oauth_error', 'state_missing', 'state_mismatch', 'no_code', 'login_failed', 'network']) {
    assert.strictEqual((await post(e, { action: 'client_error', kind })).logged, true, kind);
  }
});

test('client_error: note は長さを切る、flow は action 列に (既定 vote)', async () => {
  const e = env();
  await post(e, { action: 'client_error', kind: 'oauth_error', note: 'a'.repeat(5000) });
  let last = e.store.errors[e.store.errors.length - 1];
  assert.strictEqual(last.note.length, 200);
  assert.strictEqual(last.action, 'vote');
  await post(e, { action: 'client_error', kind: 'oauth_error', flow: 'callback' });
  last = e.store.errors[e.store.errors.length - 1];
  assert.strictEqual(last.action, 'callback');
  assert.strictEqual(last.note, '');
});

test('client_error: token があれば uid を添える / 無くても記録する', async () => {
  const e = env();
  await post(e, { action: 'client_error', kind: 'state_missing' });
  let last = e.store.errors[e.store.errors.length - 1];
  assert.strictEqual(last.user_id, '');
  assert.strictEqual(last.source, 'client');
  const tok = await issueSessionToken(e.cfg, { id: '4242', slug: 'user/x', gamerTag: 'Toko' });
  await post(e, { action: 'client_error', kind: 'account_mismatch', token: tok });
  last = e.store.errors[e.store.errors.length - 1];
  assert.strictEqual(last.user_id, '4242');
});

test('記録に秘密や個人名を書かない', async () => {
  const e = env();
  const tok = await issueSessionToken(e.cfg, { id: '4242', slug: 'user/x', gamerTag: 'Toko' });
  await post(e, { action: 'client_error', kind: 'account_mismatch', token: tok, note: 'selected=1 authed=2' });
  const row = Object.values(e.store.errors[e.store.errors.length - 1]).join('|');
  for (const bad of ['Toko', 'user/x', 'sec', 'ses', tok]) assert.ok(row.indexOf(bad) === -1, '書いてはいけない値がある: ' + bad);
});

test('行数上限: MAX を超えたら古い行から削って TRIM_TO 行にする', async () => {
  const e = env();
  for (let i = 0; i < ERRORS_MAX_ROWS + 1; i++) {
    await e.store.insertError({ ts: 't' + i, source: 'client', action: 'vote', code: 'x', user_id: '', note: '' }, ERRORS_MAX_ROWS, ERRORS_TRIM_TO);
  }
  assert.strictEqual(e.store.errors.length, ERRORS_TRIM_TO);
  assert.strictEqual(e.store.errors[e.store.errors.length - 1].ts, 't' + ERRORS_MAX_ROWS);
});

test('記録に失敗しても本来の応答は返す', async () => {
  const e = env();
  e.store.insertError = async () => { throw new Error('db down'); };
  const r = await post(e, { action: 'vote', token: 'bogus', charId: '1305' });
  assert.strictEqual(r.error.code, 'auth_failed');
  assert.deepStrictEqual(await post(e, { action: 'client_error', kind: 'oauth_denied' }), { ok: true, logged: true });
});
