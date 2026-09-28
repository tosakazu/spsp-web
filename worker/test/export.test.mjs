// export_votes / export_errors (gas_export.test.cjs を移植) + GET 経路。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http, SECRET } from './_env.mjs';
import { deriveExportKey, keyMatches } from '../src/api/export.ts';

// 導出値の固定ベクタ (tests/post/gas_export.test.cjs / tests/post/test_char_vote.py と同じ)。
const KEY = 'r_GJ1PQZlcDh4cNc85qvUxAaFBoKzoHGgPVE_pPDfhg';

/** [timestamp, user_id, user_slug, gamer_tag, char_id, char_name, status] */
function row(ts, uid, charId, status) {
  return [ts, uid, 'user/' + uid, 'Tag' + uid, charId, 'キャラ' + charId, status];
}
const envWith = (rows, cfg) => makeEnv({ voteRows: rows, cfg });

test('export_votes: 鍵は client secret からラベル付きで導出する (固定ベクタ)', async () => {
  assert.strictEqual(await deriveExportKey(SECRET), KEY);
  assert.notStrictEqual(await deriveExportKey('other-secret'), KEY);
  assert.strictEqual(keyMatches(KEY, KEY), true);
  assert.strictEqual(keyMatches(KEY.slice(0, -1), KEY), false);
  assert.strictEqual(keyMatches(undefined, KEY), false);
});

test('export_votes: 鍵が合えば行を返す (JSON の形はビルドが読む char_votes と同じ)', async () => {
  const env = envWith([
    row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending'),
    row('2026-08-14T11:00:00+09:00', 222, 1271, 'approved'),
  ]);
  const res = await post(env, { action: 'export_votes', key: KEY });
  assert.deepStrictEqual(res, {
    ok: true,
    votes: [
      { ts: '2026-08-14T10:00:00+09:00', userId: '111', charId: '1305', charName: 'キャラ1305', status: 'pending' },
      { ts: '2026-08-14T11:00:00+09:00', userId: '222', charId: '1271', charName: 'キャラ1271', status: 'approved' },
    ],
    total: 2,
    since: '',
  });
});

test('export_votes: slug と gamer_tag は返さない', async () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')]);
  const dump = JSON.stringify(await post(env, { action: 'export_votes', key: KEY }));
  assert.ok(dump.indexOf('user/111') === -1, 'slug が漏れている');
  assert.ok(dump.indexOf('Tag111') === -1, 'gamer_tag が漏れている');
});

test('export_votes: status=debug の行は返さない (total には入る)', async () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'debug'), row('2026-08-14T10:30:00+09:00', 222, 1271, 'pending')]);
  const res = await post(env, { action: 'export_votes', key: KEY });
  assert.strictEqual(res.votes.length, 1);
  assert.strictEqual(res.votes[0].userId, '222');
  assert.strictEqual(res.total, 2);
});

test('export_votes: user_id / char_id が欠けた行は返さない', async () => {
  const env = envWith([
    ['2026-08-14T10:00:00+09:00', '', 'user/x', 'X', 1305, 'ロックマン', 'pending'],
    ['2026-08-14T10:10:00+09:00', 333, 'user/y', 'Y', '', '', 'pending'],
    row('2026-08-14T10:20:00+09:00', 444, 1271, 'pending'),
  ]);
  const res = await post(env, { action: 'export_votes', key: KEY });
  assert.strictEqual(res.votes.length, 1);
  assert.strictEqual(res.votes[0].userId, '444');
  assert.strictEqual(res.total, 3);
});

test('export_votes: 鍵が違えば何も返さない', async () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')]);
  for (const key of [undefined, '', KEY.slice(0, -1), KEY + 'x', KEY.toUpperCase(), 123]) {
    const res = await post(env, { action: 'export_votes', key });
    assert.strictEqual(res.ok, false, 'key=' + key + ' で通ってしまった');
    assert.strictEqual(res.error.code, 'auth_failed');
    assert.strictEqual(res.error.message, 'エクスポート鍵が違います。');
    assert.ok(JSON.stringify(res).indexOf('111') === -1, '失敗時に行が漏れている');
  }
});

test('export_votes: client secret も EXPORT_KEY も未設定なら internal (鍵無しで通さない)', async () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')], { clientSecret: null });
  for (const key of ['', KEY]) {
    const res = await post(env, { action: 'export_votes', key });
    assert.strictEqual(res.error.code, 'internal');
    assert.ok(JSON.stringify(res).indexOf('111') === -1);
  }
});

test('export_votes: EXPORT_KEY secret があればそれでも読める (導出鍵も引き続き有効)', async () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')], { exportKey: 'extra-key-123' });
  assert.strictEqual((await post(env, { action: 'export_votes', key: 'extra-key-123' })).ok, true);
  assert.strictEqual((await post(env, { action: 'export_votes', key: KEY })).ok, true);
  assert.strictEqual((await post(env, { action: 'export_votes', key: 'wrong' })).error.code, 'auth_failed');
  // client secret 無しでも EXPORT_KEY だけで読める
  const only = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')], { clientSecret: null, exportKey: 'extra-key-123' });
  assert.strictEqual((await post(only, { action: 'export_votes', key: 'extra-key-123' })).ok, true);
});

test('export_votes: 鍵も client secret もレスポンスに出ない', async () => {
  const env = envWith([row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending')]);
  for (const body of [{ action: 'export_votes', key: KEY }, { action: 'export_votes', key: 'wrong' }]) {
    const dump = JSON.stringify(await post(env, body));
    assert.ok(dump.indexOf(KEY) === -1, '鍵が漏れている');
    assert.ok(dump.indexOf(SECRET) === -1, 'client secret が漏れている');
  }
});

test('export_votes: 行が無ければ空配列、読み出しだけで書かない、失敗は errors に記録しない', async () => {
  const env = envWith([]);
  assert.deepStrictEqual(await post(env, { action: 'export_votes', key: KEY }), { ok: true, votes: [], total: 0, since: '' });
  await post(env, { action: 'export_votes', key: 'wrong' });
  assert.strictEqual(env.store.votes.length, 0);
  assert.strictEqual(env.store.errors.length, 0);
});

// ── 差分取得 (since) ──

const SINCE_ROWS = [
  row('2026-08-14T10:00:00+09:00', 111, 1305, 'pending'),
  row('2026-08-14T11:00:00+09:00', 222, 1271, 'pending'),
  row('2026-08-14T11:00:00+09:00', 333, 1273, 'pending'),  // 同じ秒の別ユーザー
  row('2026-08-14T12:00:00+09:00', 444, 1305, 'pending'),
];

test('since: その時刻以降だけ返す (境界は含む)、total は絞る前の行数', async () => {
  const env = envWith(SINCE_ROWS);
  const res = await post(env, { action: 'export_votes', key: KEY, since: '2026-08-14T11:00:00+09:00' });
  assert.deepStrictEqual(res.votes.map((v) => v.userId), ['222', '333', '444']);
  assert.strictEqual(res.since, '2026-08-14T11:00:00+09:00');
  const r2 = await post(env, { action: 'export_votes', key: KEY, since: '2026-08-14T12:00:00+09:00' });
  assert.strictEqual(r2.votes.length, 1);
  assert.strictEqual(r2.total, 4);
  const r3 = await post(env, { action: 'export_votes', key: KEY, since: '2026-08-15T00:00:00+09:00' });
  assert.deepStrictEqual(r3.votes, []);
  assert.strictEqual(r3.total, 4);
});

test('since: 省略・空文字・文字列でない値は全件', async () => {
  const env = envWith(SINCE_ROWS);
  for (const since of [undefined, '', 123, {}, null, true]) {
    const res = await post(env, { action: 'export_votes', key: KEY, since });
    assert.strictEqual(res.votes.length, 4, 'since=' + JSON.stringify(since));
  }
});

// ── GET 経路 (ビルドの取得先を URL にできる) ──

test('GET /api/export/votes?key=&since= は action export_votes と同じ JSON', async () => {
  const env = envWith(SINCE_ROWS);
  const viaPost = await post(env, { action: 'export_votes', key: KEY, since: '2026-08-14T11:00:00+09:00' });
  const viaGet = await http(env, 'GET', '/api/export/votes?key=' + encodeURIComponent(KEY) + '&since=' + encodeURIComponent('2026-08-14T11:00:00+09:00'));
  assert.strictEqual(viaGet.status, 200);
  assert.deepStrictEqual(viaGet.json, viaPost);
  const bad = await http(env, 'GET', '/api/export/votes?key=wrong');
  assert.strictEqual(bad.status, 200);           // GAS と同じく JSON は常に 200
  assert.strictEqual(bad.json.error.code, 'auth_failed');
});

// ── export_errors ──

test('export_errors: 末尾 limit 件を古い順で返し、total は全体', async () => {
  const env = envWith([]);
  for (let i = 0; i < 5; i++) {
    await env.store.insertError({ ts: '2026-08-14T10:0' + i + ':00+09:00', source: 'client', action: 'vote', code: 'oauth_denied', user_id: i ? String(i) : '', note: 'n' + i }, 3000, 2000);
  }
  const res = await post(env, { action: 'export_errors', key: KEY, limit: 2 });
  assert.deepStrictEqual(res, { ok: true, total: 5, errors: [
    { ts: '2026-08-14T10:03:00+09:00', source: 'client', action: 'vote', code: 'oauth_denied', userId: '3', note: 'n3' },
    { ts: '2026-08-14T10:04:00+09:00', source: 'client', action: 'vote', code: 'oauth_denied', userId: '4', note: 'n4' },
  ] });
  assert.strictEqual((await post(env, { action: 'export_errors', key: KEY })).errors.length, 5);         // 既定 100
  assert.strictEqual((await post(env, { action: 'export_errors', key: KEY, limit: 'x' })).errors.length, 5);
  assert.strictEqual((await post(env, { action: 'export_errors', key: 'wrong' })).error.code, 'auth_failed');
  const empty = envWith([]);
  assert.deepStrictEqual(await post(empty, { action: 'export_errors', key: KEY }), { ok: true, errors: [], total: 0 });
  const viaGet = await http(env, 'GET', '/api/export/errors?key=' + encodeURIComponent(KEY) + '&limit=2');
  assert.deepStrictEqual(viaGet.json, res);
});
