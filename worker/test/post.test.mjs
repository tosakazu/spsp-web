// 投稿 (action: post)。gas.test.cjs を移植。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, rawPost, jst, OK_TOKEN, OK_USER } from './_env.mjs';
import { sanitizeBody } from '../src/api/post.ts';

test('happy path: currentUser の値で 1 行 append され pending が付く', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const res = await post(env, { action: 'post', code: 'CODE', body: '  こんにちは  ' });
  assert.deepStrictEqual(res, { ok: true, user: 'user/abcd1234' });
  assert.strictEqual(env.store.posts.length, 1);
  const row = env.store.posts[0];
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.strictEqual(row.user_id, '4242');
  assert.strictEqual(row.user_slug, 'user/abcd1234');
  assert.strictEqual(row.gamer_tag, 'Toko');
  assert.strictEqual(row.body, 'こんにちは');
  assert.strictEqual(row.status, 'pending');
});

test('INV-1: クライアントの自己申告値は保存されない', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  await post(env, { action: 'post', code: 'CODE', body: 'x',
    user_id: '999', user_slug: 'user/spoofed', gamer_tag: 'Spoofed', status: 'approved' });
  const row = env.store.posts[0];
  assert.strictEqual(row.user_id, '4242');
  assert.strictEqual(row.user_slug, 'user/abcd1234');
  assert.strictEqual(row.status, 'pending');
});

test('INV-2: currentUser が null / GraphQL エラーなら何も書かない', async () => {
  for (const user of [
    { status: 200, body: { data: { currentUser: null } } },
    { status: 200, body: { errors: [{ message: 'nope' }] } },
    { status: 500, body: 'x' },
  ]) {
    const env = makeEnv({ token: OK_TOKEN, user });
    const res = await post(env, { action: 'post', code: 'CODE', body: 'x' });
    assert.strictEqual(res.error.code, 'auth_failed');
    assert.strictEqual(env.store.posts.length, 0);
  }
});

test('INV-4: token / code / secret が保存にもレスポンスにも出ない', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const res = await post(env, { action: 'post', code: 'CODE-abc', body: 'x' });
  const dump = JSON.stringify(env.store.posts) + JSON.stringify(res) + JSON.stringify(env.store.errors);
  for (const secret of ['AT-secret', 'CODE-abc', 'SECRET-DO-NOT-LEAK']) {
    assert.ok(dump.indexOf(secret) === -1, 'leaked: ' + secret);
  }
});

test('token 交換に必要なパラメータを JSON body で送る', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  await post(env, { action: 'post', code: 'CODE-abc', body: 'x' });
  const tok = env.fetches.find((f) => f.url.indexOf('/oauth/access_token') !== -1);
  assert.ok(tok, 'token 交換が呼ばれていない');
  assert.strictEqual(tok.url, 'https://api.start.gg/oauth/access_token');
  assert.strictEqual(tok.init.method, 'POST');
  assert.strictEqual(tok.init.headers['Content-Type'], 'application/json');
  const sent = JSON.parse(tok.init.body);
  assert.strictEqual(sent.grant_type, 'authorization_code');
  assert.strictEqual(sent.client_id, 'test-client-id');
  assert.strictEqual(sent.code, 'CODE-abc');
  assert.strictEqual(sent.client_secret, 'SECRET-DO-NOT-LEAK');
  assert.strictEqual(sent.redirect_uri, 'https://tosakazu.github.io/spsp/callback.html');
  assert.strictEqual(sent.scope, 'user.identity');
  const gql = env.fetches.find((f) => f.url.indexOf('/gql/') !== -1);
  assert.strictEqual(gql.url, 'https://api.start.gg/gql/alpha');
  assert.strictEqual(gql.init.headers.Authorization, 'Bearer AT-secret');
  assert.match(JSON.parse(gql.init.body).query, /currentUser \{ id slug player \{ gamerTag \} \}/);
});

test('token 交換の失敗は auth_failed で、currentUser を呼ばない', async () => {
  const env = makeEnv({ token: { status: 401, body: { error: 'bad' } }, user: OK_USER });
  const res = await post(env, { action: 'post', code: 'CODE', body: 'x' });
  assert.strictEqual(res.error.code, 'auth_failed');
  assert.strictEqual(env.fetches.filter((f) => !f.url.startsWith('data:')).length, 1);
  assert.strictEqual(env.store.posts.length, 0);
});

test('access_token が欠けていたら auth_failed', async () => {
  const env = makeEnv({ token: { status: 200, body: { token_type: 'Bearer' } }, user: OK_USER });
  assert.strictEqual((await post(env, { action: 'post', code: 'C', body: 'x' })).error.code, 'auth_failed');
});

test('入力検証: code なし / body 不正', async () => {
  const env = () => makeEnv({ token: OK_TOKEN, user: OK_USER });
  assert.strictEqual((await post(env(), { action: 'post', body: 'x' })).error.code, 'bad_request');
  assert.strictEqual((await post(env(), { action: 'post', code: '', body: 'x' })).error.code, 'bad_request');
  assert.strictEqual((await post(env(), { action: 'post', code: 'C' })).error.code, 'body_invalid');
  assert.strictEqual((await post(env(), { action: 'post', code: 'C', body: '   ' })).error.code, 'body_invalid');
  assert.strictEqual((await post(env(), { action: 'post', code: 'C', body: 'a'.repeat(1001) })).error.code, 'body_invalid');
  assert.strictEqual((await post(env(), { action: 'post', code: 'C', body: 'a'.repeat(1000) })).ok, true);
});

test('入力検証は start.gg を叩く前に行う', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  await post(env, { action: 'post', code: 'C', body: '' });
  assert.strictEqual(env.fetches.length, 0);
});

test('post フローも state 検証を通る', async () => {
  const e = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const r = await rawPost(e, { action: 'post', code: 'C', body: '本文' });
  assert.strictEqual(r.error.code, 'state_invalid');
  assert.strictEqual((await post(e, { action: 'post', code: 'C', body: '本文' })).ok, true);
});

test('secret 未設定は internal (secret 名は漏らさない)', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, cfg: { clientSecret: null } });
  const res = await post(env, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(res.error.code, 'internal');
  assert.ok(res.error.message.indexOf('STARTGG_CLIENT_SECRET') === -1);
  // 例外は errors に残る (原因追跡)
  assert.ok(env.store.errors.some((r) => r.code === 'exception' && r.action === 'doPost'));
});

test('連投: 同一ユーザーの直近 60 秒未満は rate_limited', async () => {
  const now = Date.now();
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER,
    postRows: [[jst(now - 30 * 1000), '4242', 'user/abcd1234', 'Toko', 'prev', 'pending']] });
  const res = await post(env, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(res.error.code, 'rate_limited');
  assert.match(res.error.message, /1分ほど/);
  assert.strictEqual(env.store.posts.length, 1);
});

test('連投: 60 秒以上空いていれば通る / 別ユーザーには引っかからない', async () => {
  const now = Date.now();
  const a = makeEnv({ token: OK_TOKEN, user: OK_USER,
    postRows: [[jst(now - 90 * 1000), '4242', 'user/abcd1234', 'Toko', 'prev', 'pending']] });
  assert.strictEqual((await post(a, { action: 'post', code: 'C', body: 'x' })).ok, true);
  const b = makeEnv({ token: OK_TOKEN, user: OK_USER,
    postRows: [[jst(now - 5 * 1000), '9999', 'user/other', 'Other', 'prev', 'pending']] });
  assert.strictEqual((await post(b, { action: 'post', code: 'C', body: 'x' })).ok, true);
});

test('当日 10 件で rate_limited、9 件なら通る', async () => {
  const now = Date.now();
  const mk = (n) => {
    const rows = [];
    for (let i = 0; i < n; i++) rows.push([jst(now - (120 + i * 60) * 1000), '4242', 'user/abcd1234', 'Toko', 'p', 'pending']);
    return rows;
  };
  const nine = makeEnv({ token: OK_TOKEN, user: OK_USER, postRows: mk(9) });
  assert.strictEqual((await post(nine, { action: 'post', code: 'C', body: 'x' })).ok, true);
  const ten = makeEnv({ token: OK_TOKEN, user: OK_USER, postRows: mk(10) });
  const res = await post(ten, { action: 'post', code: 'C', body: 'x' });
  assert.strictEqual(res.error.code, 'rate_limited');
  assert.match(res.error.message, /10件/);
  assert.strictEqual(ten.store.posts.length, 10);
});

test('前日の投稿は当日カウントに入らない', async () => {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push([jst(now - 26 * 3600 * 1000 - i * 60000), '4242', 'user/abcd1234', 'Toko', 'p', 'pending']);
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, postRows: rows });
  assert.strictEqual((await post(env, { action: 'post', code: 'C', body: 'x' })).ok, true);
});

test('gamerTag が無くても空文字で通る', async () => {
  const env = makeEnv({ token: OK_TOKEN,
    user: { status: 200, body: { data: { currentUser: { id: 7, slug: 'user/x', player: null } } } } });
  assert.strictEqual((await post(env, { action: 'post', code: 'C', body: 'x' })).ok, true);
  assert.strictEqual(env.store.posts[0].gamer_tag, '');
  assert.strictEqual(env.store.posts[0].user_id, '7');
});

test('本文の HTML タグは残す (エスケープはビルド側の責務)、制御文字は落とす', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  await post(env, { action: 'post', code: 'C', body: '<script>x</script> & "q"' });
  assert.strictEqual(env.store.posts[0].body, '<script>x</script> & "q"');
  assert.strictEqual(sanitizeBody(' a\r\nb\rc\td\x00e\x7f\x85 '), 'a\nb\nc\tde');
});
