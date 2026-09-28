'use strict';
// export_votes (ビルドサーバー向けエクスポート) の GAS 側テスト。
// スタブ環境は _gas_env.cjs (gas.test.cjs / gas_vote.test.cjs と共有)。
const test = require('node:test');
const assert = require('node:assert');
const { VOTES_HEADER, makeEnv, post } = require('./_gas_env.cjs');

// 鍵は保存せず STARTGG_CLIENT_SECRET から導出する。
// makeEnv の既定の secret は 'SECRET-DO-NOT-LEAK'。
// 導出値の期待は固定ベクタで持つ (= GAS 実装とは独立に決まる。ビルド側の
// tests/post/test_char_vote.py が同じベクタを検査していて、両言語の一致を縛る)。
const SECRET = 'SECRET-DO-NOT-LEAK';
const KEY = 'r_GJ1PQZlcDh4cNc85qvUxAaFBoKzoHGgPVE_pPDfhg';

/** [timestamp, user_id, user_slug, gamer_tag, char_id, char_name, status] */
function row(ts, uid, charId, status) {
  return [ts, uid, 'user/' + uid, 'Tag' + uid, charId, 'キャラ' + charId, status];
}

function envWith(rows, props) {
  return makeEnv({
    voteRows: [VOTES_HEADER.slice()].concat(rows),
    props: props,
  });
}

test('export_votes: 鍵は client secret からラベル付きで導出する', () => {
  const env = envWith([]);
  assert.strictEqual(env.sandbox.exportKey_(), KEY);
  // ラベルが違えば別の鍵になる (= 用途が分かれている)
  assert.notStrictEqual(
    env.sandbox.Utilities.base64EncodeWebSafe(
      env.sandbox.Utilities.computeHmacSha256Signature('other-label', SECRET))
      .replace(/=+$/, ''),
    KEY);
});

test('export_votes: 鍵が合えば行を返す', () => {
  const env = envWith([
    row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending'),
    row('2026-08-14T11:00:00+09:00', 222, 1271, 'approved'),
  ]);
  const res = post(env, { action: 'export_votes', key: KEY });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, 2);
  assert.deepStrictEqual(res.votes, [
    { ts: '2026-08-14T10:00:00+09:00', userId: '111', charId: '1305', charName: 'キャラ1305', status: 'pending' },
    { ts: '2026-08-14T11:00:00+09:00', userId: '222', charId: '1271', charName: 'キャラ1271', status: 'approved' },
  ]);
});

test('export_votes: slug と gamer_tag は返さない', () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')]);
  const res = post(env, { action: 'export_votes', key: KEY });
  const dump = JSON.stringify(res);
  assert.ok(dump.indexOf('user/111') === -1, 'slug が漏れている');
  assert.ok(dump.indexOf('Tag111') === -1, 'gamer_tag が漏れている');
});

test('export_votes: status=debug の行は返さない', () => {
  const env = envWith([
    row('2026-08-14T10:00:00+09:00', 111, 1305, 'debug'),
    row('2026-08-14T10:30:00+09:00', 222, 1271, 'pending'),
  ]);
  const res = post(env, { action: 'export_votes', key: KEY });
  assert.strictEqual(res.votes.length, 1);
  assert.strictEqual(res.votes[0].userId, '222');
  assert.strictEqual(res.total, 2);   // total はシートの行数そのもの
});

test('export_votes: user_id / char_id が欠けた行は返さない', () => {
  const env = envWith([
    ['2026-08-14T10:00:00+09:00', '', 'user/x', 'X', 1305, 'ロックマン', 'pending'],
    ['2026-08-14T10:10:00+09:00', 333, 'user/y', 'Y', '', '', 'pending'],
    row('2026-08-14T10:20:00+09:00', 444, 1271, 'pending'),
  ]);
  const res = post(env, { action: 'export_votes', key: KEY });
  assert.strictEqual(res.votes.length, 1);
  assert.strictEqual(res.votes[0].userId, '444');
});

test('export_votes: 鍵が違えば何も返さない', () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')]);
  for (const key of [undefined, '', KEY.slice(0, -1), KEY + 'x', KEY.toUpperCase()]) {
    const res = post(env, { action: 'export_votes', key: key });
    assert.strictEqual(res.ok, false, 'key=' + key + ' で通ってしまった');
    assert.strictEqual(res.error.code, 'auth_failed');
    assert.ok(JSON.stringify(res).indexOf('111') === -1, '失敗時に行が漏れている');
  }
});

test('export_votes: client secret 未設定なら internal (鍵無しで通さない)', () => {
  const env = makeEnv({
    voteRows: [VOTES_HEADER.slice(), row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')],
    props: { STARTGG_CLIENT_SECRET: null },
  });
  for (const key of ['', KEY]) {
    const res = post(env, { action: 'export_votes', key: key });
    assert.strictEqual(res.error.code, 'internal');
    assert.ok(JSON.stringify(res).indexOf('111') === -1);
  }
});

test('export_votes: 鍵も client secret もレスポンスに出ない', () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')]);
  for (const body of [{ action: 'export_votes', key: KEY }, { action: 'export_votes', key: 'wrong' }]) {
    const res = post(env, body);
    const dump = JSON.stringify(res);
    assert.ok(dump.indexOf(KEY) === -1, '鍵が漏れている');
    assert.ok(dump.indexOf(SECRET) === -1, 'client secret が漏れている');
  }
});

test('export_votes: ヘッダだけなら空配列', () => {
  const env = envWith([]);
  const res = post(env, { action: 'export_votes', key: KEY });
  assert.deepStrictEqual(res.votes, []);
  assert.strictEqual(res.total, 0);
});

test('export_votes: 読み出しだけでシートに書かない', () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')]);
  post(env, { action: 'export_votes', key: KEY });
  assert.strictEqual(env.voteRows.length, 2);
  assert.strictEqual(env.rows.length, 1);
});

// ── 差分取得 (since) ──

const SINCE_ROWS = [
  row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending'),
  row('2026-08-14T11:00:00+09:00', 222, 1271, 'pending'),
  row('2026-08-14T11:00:00+09:00', 333, 1273, 'pending'),  // 同じ秒の別ユーザー
  row('2026-08-14T12:00:00+09:00', 444, 1305, 'pending'),
];

test('since: その時刻以降だけ返す (境界は含む = 同じ秒を取りこぼさない)', () => {
  const env = envWith(SINCE_ROWS);
  const res = post(env, { action: 'export_votes', key: KEY, since: '2026-08-14T11:00:00+09:00' });
  assert.deepStrictEqual(res.votes.map((v) => v.userId), ['222', '333', '444']);
  assert.strictEqual(res.since, '2026-08-14T11:00:00+09:00');
});

test('since: total は絞る前のシート行数 (削除の検知に使う)', () => {
  const env = envWith(SINCE_ROWS);
  const res = post(env, { action: 'export_votes', key: KEY, since: '2026-08-14T12:00:00+09:00' });
  assert.strictEqual(res.votes.length, 1);
  assert.strictEqual(res.total, 4);
});

test('since: 省略・空文字なら全件', () => {
  const env = envWith(SINCE_ROWS);
  for (const since of [undefined, '']) {
    const res = post(env, { action: 'export_votes', key: KEY, since: since });
    assert.strictEqual(res.votes.length, 4, 'since=' + since);
  }
});

test('since: 全部より新しい時刻なら 0 件 (total は据え置き)', () => {
  const env = envWith(SINCE_ROWS);
  const res = post(env, { action: 'export_votes', key: KEY, since: '2026-08-15T00:00:00+09:00' });
  assert.deepStrictEqual(res.votes, []);
  assert.strictEqual(res.total, 4);
});

test('since: 文字列でない値は無視して全件 (壊れた値で黙って 0 件にしない)', () => {
  const env = envWith(SINCE_ROWS);
  for (const bad of [123, {}, null, true]) {
    const res = post(env, { action: 'export_votes', key: KEY, since: bad });
    assert.strictEqual(res.votes.length, 4, 'since=' + JSON.stringify(bad));
  }
});
