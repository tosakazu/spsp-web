'use strict';
// gas/*.gs の実ソースを vm で読み、Apps Script の API をスタブして doPost を回す。
// 目的は設計書 §2 の不変条件 (INV-1/2/4) と §6.3 の分岐の担保。
// スタブ環境は _gas_env.cjs (gas_vote.test.cjs と共有)。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { GAS_DIR, HEADER, jst, OK_TOKEN, OK_USER, makeEnv, post } = require('./_gas_env.cjs');

test('happy path: currentUser の値で 1 行 append され pending が付く', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const res = post(env, { action: 'post', code: 'CODE', body: '  こんにちは  ' });

  assert.deepStrictEqual(res, { ok: true, user: 'user/abcd1234' });
  assert.strictEqual(env.rows.length, 2);
  const row = env.rows[1];
  assert.match(row[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.strictEqual(row[1], '4242');
  assert.strictEqual(row[2], 'user/abcd1234');
  assert.strictEqual(row[3], 'Toko');
  assert.strictEqual(row[4], 'こんにちは'); // trim 済み
  assert.strictEqual(row[5], 'pending');
});

test('INV-1: クライアントの自己申告値はシートに入らない', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  post(env, {
    action: 'post', code: 'CODE', body: 'x',
    user_id: '999', user_slug: 'user/spoofed', gamer_tag: 'Spoofed', status: 'approved',
  });
  const row = env.rows[1];
  assert.strictEqual(row[1], '4242');
  assert.strictEqual(row[2], 'user/abcd1234');
  assert.strictEqual(row[3], 'Toko');
  assert.strictEqual(row[5], 'pending');
});

test('INV-2: currentUser が null なら何も書かない', () => {
  const env = makeEnv({
    token: OK_TOKEN,
    user: { status: 200, body: { data: { currentUser: null } } },
  });
  const res = post(env, { action: 'post', code: 'CODE', body: 'x' });
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error.code, 'auth_failed');
  assert.strictEqual(env.rows.length, 1);
});

test('INV-2: GraphQL エラーでも書かない', () => {
  const env = makeEnv({
    token: OK_TOKEN,
    user: { status: 200, body: { errors: [{ message: 'nope' }] } },
  });
  const res = post(env, { action: 'post', code: 'CODE', body: 'x' });
  assert.strictEqual(res.error.code, 'auth_failed');
  assert.strictEqual(env.rows.length, 1);
});

test('INV-4: token / code / secret がシートにもレスポンスにも出ない', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const res = post(env, { action: 'post', code: 'CODE-abc', body: 'x' });
  const dump = JSON.stringify(env.rows) + JSON.stringify(res);
  for (const secret of ['AT-secret', 'CODE-abc', 'SECRET-DO-NOT-LEAK']) {
    assert.ok(dump.indexOf(secret) === -1, 'leaked: ' + secret);
  }
});

test('token 交換に必要なパラメータを JSON body で送る', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  post(env, { action: 'post', code: 'CODE-abc', body: 'x' });

  const tok = env.fetches.find((f) => f.url.indexOf('/oauth/access_token') !== -1);
  assert.ok(tok, 'token 交換が呼ばれていない');
  assert.strictEqual(tok.url, 'https://api.start.gg/oauth/access_token');
  assert.strictEqual(tok.params.method, 'post');
  assert.strictEqual(tok.params.contentType, 'application/json');
  const sent = JSON.parse(tok.params.payload);
  assert.strictEqual(sent.grant_type, 'authorization_code');
  assert.strictEqual(sent.code, 'CODE-abc');
  assert.strictEqual(sent.client_secret, 'SECRET-DO-NOT-LEAK');
  assert.strictEqual(sent.redirect_uri, 'https://tosakazu.github.io/spsp/callback.html');
  assert.strictEqual(sent.scope, 'user.identity');

  const gql = env.fetches.find((f) => f.url.indexOf('/gql/') !== -1);
  assert.strictEqual(gql.params.headers.Authorization, 'Bearer AT-secret');
});

test('token 交換の失敗は auth_failed で、currentUser を呼ばない', () => {
  const env = makeEnv({ token: { status: 401, body: { error: 'bad' } }, user: OK_USER });
  const res = post(env, { action: 'post', code: 'CODE', body: 'x' });
  assert.strictEqual(res.error.code, 'auth_failed');
  assert.strictEqual(env.fetches.length, 1);
  assert.strictEqual(env.rows.length, 1);
});

test('access_token が欠けていたら auth_failed', () => {
  const env = makeEnv({ token: { status: 200, body: { token_type: 'Bearer' } }, user: OK_USER });
  assert.strictEqual(post(env, { action: 'post', code: 'C', body: 'x' }).error.code, 'auth_failed');
});

test('入力検証: code なし / body 不正', () => {
  const env = () => makeEnv({ token: OK_TOKEN, user: OK_USER });
  assert.strictEqual(post(env(), { action: 'post', body: 'x' }).error.code, 'bad_request');
  assert.strictEqual(post(env(), { action: 'post', code: '', body: 'x' }).error.code, 'bad_request');
  assert.strictEqual(post(env(), { action: 'post', code: 'C' }).error.code, 'body_invalid');
  assert.strictEqual(post(env(), { action: 'post', code: 'C', body: '   ' }).error.code, 'body_invalid');
  assert.strictEqual(
    post(env(), { action: 'post', code: 'C', body: 'a'.repeat(1001) }).error.code, 'body_invalid');
  assert.strictEqual(post(env(), { action: 'post', code: 'C', body: 'a'.repeat(1000) }).ok, true);
});

test('入力検証は start.gg を叩く前に行う', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  post(env, { action: 'post', code: 'C', body: '' });
  assert.strictEqual(env.fetches.length, 0);
});

test('未知の action / 壊れた JSON は bad_request', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  assert.strictEqual(post(env, { action: 'nope' }).error.code, 'bad_request');
  const broken = env.sandbox.doPost({ postData: { contents: '{{{' } });
  assert.strictEqual(JSON.parse(broken.text).error.code, 'bad_request');
  const empty = env.sandbox.doPost({});
  assert.strictEqual(JSON.parse(empty.text).error.code, 'bad_request');
});

test('doGet は POST のみと返す', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  assert.strictEqual(JSON.parse(env.sandbox.doGet().text).ok, false);
});

test('スクリプトプロパティ未設定は internal (secret は漏らさない)', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, props: { STARTGG_CLIENT_SECRET: null } });
  const res = post(env, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(res.error.code, 'internal');
  assert.ok(res.error.message.indexOf('STARTGG_CLIENT_SECRET') === -1);
});

test('連投: 同一ユーザーの直近 60 秒未満は rate_limited', () => {
  const now = Date.now();
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    rows: [HEADER, [jst(now - 30 * 1000), '4242', 'user/abcd1234', 'Toko', 'prev', 'pending']],
  });
  const res = post(env, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(res.error.code, 'rate_limited');
  assert.strictEqual(env.rows.length, 2);
});

test('連投: 60 秒以上空いていれば通る', () => {
  const now = Date.now();
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    rows: [HEADER, [jst(now - 90 * 1000), '4242', 'user/abcd1234', 'Toko', 'prev', 'pending']],
  });
  assert.strictEqual(post(env, { action: 'post', code: 'C', body: 'x' }).ok, true);
});

test('連投: 別ユーザーの直近投稿には引っかからない', () => {
  const now = Date.now();
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    rows: [HEADER, [jst(now - 5 * 1000), '9999', 'user/other', 'Other', 'prev', 'pending']],
  });
  assert.strictEqual(post(env, { action: 'post', code: 'C', body: 'x' }).ok, true);
});

test('当日 10 件で rate_limited、9 件なら通る', () => {
  const now = Date.now();
  const mk = (n) => {
    const rows = [HEADER];
    for (let i = 0; i < n; i++) {
      // すべて当日、かつ直近 60 秒より前
      rows.push([jst(now - (120 + i * 60) * 1000), '4242', 'user/abcd1234', 'Toko', 'p', 'pending']);
    }
    return rows;
  };
  const nine = makeEnv({ token: OK_TOKEN, user: OK_USER, rows: mk(9) });
  assert.strictEqual(post(nine, { action: 'post', code: 'C', body: 'x' }).ok, true);

  const ten = makeEnv({ token: OK_TOKEN, user: OK_USER, rows: mk(10) });
  const res = post(ten, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(res.error.code, 'rate_limited');
  assert.strictEqual(ten.rows.length, 11); // 増えていない
});

test('前日の投稿は当日カウントに入らない', () => {
  const now = Date.now();
  const rows = [HEADER];
  for (let i = 0; i < 12; i++) {
    rows.push([jst(now - 26 * 3600 * 1000 - i * 60000), '4242', 'user/abcd1234', 'Toko', 'p', 'pending']);
  }
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, rows });
  assert.strictEqual(post(env, { action: 'post', code: 'C', body: 'x' }).ok, true);
});

test('timestamp 列が Date 値になっていても連投判定が効く', () => {
  // Sheets が ISO 文字列を日時値に変換してしまった場合の保険
  const now = Date.now();
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    rows: [HEADER, [new Date(now - 10 * 1000), '4242', 'user/abcd1234', 'Toko', 'p', 'pending']],
  });
  assert.strictEqual(post(env, { action: 'post', code: 'C', body: 'x' }).error.code, 'rate_limited');
});

test('gamerTag が無くても空文字で通る', () => {
  const env = makeEnv({
    token: OK_TOKEN,
    user: { status: 200, body: { data: { currentUser: { id: 7, slug: 'user/x', player: null } } } },
  });
  assert.strictEqual(post(env, { action: 'post', code: 'C', body: 'x' }).ok, true);
  assert.strictEqual(env.rows[1][3], '');
});

test('本文の HTML タグは残す (エスケープはビルド側の責務)', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  post(env, { action: 'post', code: 'C', body: '<script>x</script> & "q"' });
  assert.strictEqual(env.rows[1][4], '<script>x</script> & "q"');
});

test('既存シートへの投稿は書式設定をやり直さない', () => {
  // 毎回 setNumberFormat すると書き込み操作が 1 回増え、何も追記していない
  // リクエスト (rate_limited 等) でもシートの更新時刻が動いてしまう。
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  post(env, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(env.counts.setNumberFormat, 0);
  assert.strictEqual(env.counts.insertSheet, 0);
});

test('シートを新規作成するときは書式とヘッダを置く', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, sheetMissing: true });
  assert.strictEqual(post(env, { action: 'post', code: 'C', body: 'x' }).ok, true);
  assert.strictEqual(env.counts.insertSheet, 1);
  assert.strictEqual(env.counts.setNumberFormat, 1);
  assert.deepStrictEqual(env.rows[0], HEADER);
});

test('1 リクエストでシートを開くのは 1 回だけ', () => {
  // スパム判定と append の 2 か所から呼ばれるが、openById は 1 回で済ませる
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  post(env, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(env.counts.openById, 1);
});

test('INV-3/5: ソースに secret 直書きと共有設定の変更が無い', () => {
  // コメント (「setSharing は書かない」等の注意書き) は検査対象から外す
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const all = fs.readdirSync(GAS_DIR)
    .filter((f) => f.endsWith('.gs'))
    .map((f) => strip(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'))).join('\n');
  assert.ok(!/client_secret\s*[:=]\s*['"][^'"{]/.test(all), 'client secret がコードに直書きされている');
  assert.ok(!/setSharing|addEditor|addViewer|setAnyoneCanEdit/.test(all), '共有設定を変更している');
  assert.ok(all.indexOf("requireProp_('STARTGG_CLIENT_SECRET')") !== -1,
    'secret はスクリプトプロパティから読むこと');
});
