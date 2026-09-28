'use strict';
// 失敗の記録 (errors シート)。成功しか残らず「認証エラーになる」と言われても
// 種別すら追えなかったため追加した経路のテスト。
const test = require('node:test');
const assert = require('node:assert');
const { makeEnv, post } = require('./_gas_env.cjs');

const env = (o) => makeEnv(o || {});
// errors シートは GAS 側が作るのでヘッダ行も入っている。データ行だけ見る。
const errRows = (e) => (e.rowsByName['errors'] || []).slice(1);

test('サーバー側の失敗が errors シートに残る', () => {
  const e = env();
  const r = post(e, { action: 'vote', token: 'bogus', charId: '1305' });
  assert.strictEqual(r.ok, false);
  const rows = errRows(e);
  assert.ok(rows.length >= 1, '記録されていない');
  const last = rows[rows.length - 1];
  // timestamp / source / action / code / user_id / note
  assert.strictEqual(last[1], 'server');
  assert.strictEqual(last[2], 'vote');
  assert.strictEqual(last[3], 'auth_failed');
});

test('client_error は 1 行だけ足す (記録処理自体の成否は記録しない)', () => {
  const e = env();
  post(e, { action: 'vote', token: 'bogus', charId: '1305' });  // server 側の失敗で 1 行
  const before = errRows(e).length;
  assert.strictEqual(before, 1);
  post(e, { action: 'client_error', kind: 'oauth_denied' });
  assert.strictEqual(errRows(e).length, before + 1);
});

test('不明な action はシートを汚さない (雑なリクエストで埋めない)', () => {
  const e = env();
  const r = post(e, { action: 'nope' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(errRows(e).length, 0);
  assert.ok(!e.rowsByName['errors'], 'シートを作ってしまっている');
});

test('client_error: 白リストの種別だけ受ける', () => {
  const e = env();
  const ok = post(e, { action: 'client_error', kind: 'account_mismatch', note: 'x' });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.logged, true);

  const before = errRows(e).length;
  const ng = post(e, { action: 'client_error', kind: '<script>alert(1)</script>' });
  assert.strictEqual(ng.ok, true);
  assert.strictEqual(ng.logged, false, '未知の種別を受け入れている');
  assert.strictEqual(errRows(e).length, before, '未知の種別を書いている');
});

test('client_error: note は長さを切る', () => {
  const e = env();
  post(e, { action: 'client_error', kind: 'oauth_error', note: 'a'.repeat(5000) });
  const rows = errRows(e);
  assert.ok(rows[rows.length - 1][5].length <= 200, 'note が切られていない');
});

test('client_error: token があれば uid を添える / 無くても記録する', () => {
  const e = env();
  post(e, { action: 'client_error', kind: 'state_missing' });
  let last = errRows(e).slice(-1)[0];
  assert.strictEqual(last[4], '', '認証前なのに uid が入っている');
  assert.strictEqual(last[1], 'client');

  const tok = e.sandbox.issueSessionToken_({ id: 4242, slug: 'user/x', gamerTag: 'Toko' });
  post(e, { action: 'client_error', kind: 'account_mismatch', token: tok });
  last = errRows(e).slice(-1)[0];
  assert.strictEqual(last[4], 4242);
});

test('記録に秘密や個人名を書かない', () => {
  const e = env();
  const tok = e.sandbox.issueSessionToken_({ id: 4242, slug: 'user/x', gamerTag: 'Toko' });
  post(e, { action: 'client_error', kind: 'account_mismatch', token: tok, note: 'selected=1 authed=2' });
  const row = errRows(e).slice(-1)[0].join('|');
  for (const bad of ['Toko', 'user/x', 'sec', 'ses', tok]) {
    assert.ok(row.indexOf(bad) === -1, '書いてはいけない値がある: ' + bad);
  }
});

test('ヘッダは 6 列 (timestamp/source/action/code/user_id/note)', () => {
  const e = env();
  post(e, { action: 'client_error', kind: 'oauth_denied' });
  // vm サンドボックス由来の配列なので deepStrictEqual は realm 違いで落ちる
  assert.deepStrictEqual(Array.from(e.sandbox.ERRORS_HEADER),
    ['timestamp', 'source', 'action', 'code', 'user_id', 'note']);
});

test('export_votes の失敗は記録しない (定期取得でシートを埋めない)', () => {
  const e = env();
  const before = errRows(e).length;
  post(e, { action: 'export_votes', key: 'wrong' });
  assert.strictEqual(errRows(e).length, before);
});
