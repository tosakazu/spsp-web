'use strict';
// login (セッショントークン) と vote (キャラ投票) の GAS 側テスト。
// スタブ環境は _gas_env.cjs (gas.test.cjs と共有)。
const test = require('node:test');
const assert = require('node:assert');
const { VOTES_HEADER, jst, OK_TOKEN, OK_USER, makeEnv, post, loginToken } =
  require('./_gas_env.cjs');

// ── login ──

test('login: トークンとユーザー情報と exp を返す', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const res = post(env, { action: 'login', code: 'CODE-1' });
  assert.strictEqual(res.ok, true);
  assert.match(res.token, /^[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+$/);
  assert.deepStrictEqual(res.user, { id: '4242', slug: 'user/abcd1234', gamerTag: 'Toko' });
  assert.ok(typeof res.exp === 'number' && res.exp > Date.now());
  // ログインではどのシートにも書かない
  assert.strictEqual(env.rows.length, 1);
  assert.strictEqual(env.voteRows.length, 1);
});

test('login: SESSION_SECRET が無ければ自動生成して保存する', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  assert.strictEqual(env.props.SESSION_SECRET, undefined);
  post(env, { action: 'login', code: 'C' });
  assert.ok(typeof env.props.SESSION_SECRET === 'string' && env.props.SESSION_SECRET.length >= 32);
});

test('login: code 不正は auth_failed、レスポンスに secret 類が漏れない', () => {
  const env = makeEnv({ token: { status: 401, body: { error: 'bad' } }, user: OK_USER });
  const res = post(env, { action: 'login', code: 'CODE-x' });
  assert.strictEqual(res.error.code, 'auth_failed');
  const dump = JSON.stringify(res);
  for (const s of ['CODE-x', 'SECRET-DO-NOT-LEAK', 'AT-secret']) {
    assert.ok(dump.indexOf(s) === -1, 'leaked: ' + s);
  }
});

test('login: currentUser が null なら auth_failed (INV-2 相当)', () => {
  const env = makeEnv({ token: OK_TOKEN, user: { status: 200, body: { data: { currentUser: null } } } });
  assert.strictEqual(post(env, { action: 'login', code: 'C' }).error.code, 'auth_failed');
});

// ── vote: トークン検証 ──

test('vote: 正しいトークンで 1 行 append され pending が付く', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = loginToken(env);
  const res = post(env, { action: 'vote', token, charId: '1305' });

  assert.deepStrictEqual(res, { ok: true, user: 'user/abcd1234', charId: '1305', charName: 'ロックマン' });
  assert.strictEqual(env.voteRows.length, 2);
  const row = env.voteRows[1];
  assert.match(row[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.strictEqual(row[1], '4242');           // INV-1: トークン (= currentUser) 由来
  assert.strictEqual(row[2], 'user/abcd1234');
  assert.strictEqual(row[3], 'Toko');
  assert.strictEqual(row[4], '1305');
  assert.strictEqual(row[5], 'ロックマン');
  assert.strictEqual(row[6], 'pending');
  assert.strictEqual(env.rows.length, 1);       // posts には書かない
});

test('vote: トークン無し・改ざん・別 secret は auth_failed で何も書かない', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = loginToken(env);

  const tampered = (() => {
    const [body, sig] = token.split('.');
    const json = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    json.uid = '9999'; // 別人に書き換え
    const b2 = Buffer.from(JSON.stringify(json)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    return b2 + '.' + sig;
  })();

  const other = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const foreign = loginToken(other); // 別環境 (= 別 SESSION_SECRET) のトークン

  for (const bad of [undefined, '', 'garbage', 'a.b', token + 'x', tampered, foreign]) {
    const res = post(env, { action: 'vote', token: bad, charId: '1305' });
    assert.strictEqual(res.error.code, 'auth_failed', 'should reject: ' + String(bad).slice(0, 30));
  }
  assert.strictEqual(env.voteRows.length, 1);
});

test('vote: INV-1 相当 — クライアントの自己申告 uid は無視される', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = loginToken(env);
  post(env, { action: 'vote', token, charId: '1305', user_id: '9999', user_slug: 'user/spoofed' });
  assert.strictEqual(env.voteRows[1][1], '4242');
  assert.strictEqual(env.voteRows[1][2], 'user/abcd1234');
});

// ── vote: 入力とキャラの検証 ──

test('vote: charId 不正は bad_request / 一覧に無いキャラは bad_char', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = loginToken(env);
  for (const bad of [undefined, '', 'abc', '13.5', '-1', '1'.repeat(9)]) {
    assert.strictEqual(post(env, { action: 'vote', token, charId: bad }).error.code, 'bad_request',
      'charId=' + String(bad));
  }
  assert.strictEqual(post(env, { action: 'vote', token, charId: '9999' }).error.code, 'bad_char');
  assert.strictEqual(env.voteRows.length, 1);
});

test('vote: charId は数値で送られてきても通る', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: 1305 }).ok, true);
});

test('vote: キャラ一覧の取得失敗は internal で何も書かない', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, charEmoji: { status: 500, body: 'oops' } });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1305' }).error.code, 'internal');
  assert.strictEqual(env.voteRows.length, 1);
});

// ── vote: 資格判定 ──

test('vote: SPSP にデータが無い選手は not_player (理由がメッセージに載る)', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 404, body: 'not found' } });
  const token = loginToken(env);
  const res = post(env, { action: 'vote', token, charId: '1305' });
  assert.strictEqual(res.error.code, 'not_player');
  assert.match(res.error.message, /SPSP にデータがある選手のみ/);
  assert.strictEqual(env.voteRows.length, 1);
});

test('vote: すでにキャラ情報がある選手は char_exists (理由がメッセージに載る)', () => {
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242,
      characters: [{ id: 1305, name: 'ロックマン', pct: 1 }] } },
  });
  const token = loginToken(env);
  const res = post(env, { action: 'vote', token, charId: '1271' });
  assert.strictEqual(res.error.code, 'char_exists');
  assert.match(res.error.message, /キャラ情報が無い選手か、メインキャラ判定が僅差の選手のみ/);
  assert.strictEqual(env.voteRows.length, 1);
});

test('vote: 投票由来だけのキャラ (pct 無し) は実績ではないので再投票できる', () => {
  // ビルドは使用実績ゼロの選手に、投票したキャラを pct 無しで足す
  // (spsp/char_vote.py)。それを「使用実績あり」と誤判定すると
  // 一度投票した人が二度と直せなくなる。
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242,
      characters: [{ id: 1305, name: 'ロックマン', src: 'vote' }] } },
  });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1271' }).ok, true);
});

test('vote: 選手データの取得失敗 (500) は internal で書かない', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 500, body: 'oops' } });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1305' }).error.code, 'internal');
  assert.strictEqual(env.voteRows.length, 1);
});

test('vote: 資格がある間の再投票は通る (最新行が有効の想定)', () => {
  const now = Date.now();
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    voteRows: [VOTES_HEADER,
      [jst(now - 120 * 1000), '4242', 'user/abcd1234', 'Toko', '1271', 'ベヨネッタ', 'pending']],
  });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1305' }).ok, true);
  assert.strictEqual(env.voteRows.length, 3);
  assert.strictEqual(env.voteRows[2][4], '1305');
});

// ── vote: 連投制御 (char_votes シートで判定。posts とは独立) ──

test('vote: 60 秒未満の連投は rate_limited', () => {
  const now = Date.now();
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    voteRows: [VOTES_HEADER,
      [jst(now - 10 * 1000), '4242', 'user/abcd1234', 'Toko', '1271', 'ベヨネッタ', 'pending']],
  });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1305' }).error.code, 'rate_limited');
  assert.strictEqual(env.voteRows.length, 2);
});

test('vote: posts 側の直近投稿には引っかからない (シート独立)', () => {
  const now = Date.now();
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    rows: [['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'body', 'status'],
      [jst(now - 5 * 1000), '4242', 'user/abcd1234', 'Toko', 'recent post', 'pending']],
  });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1305' }).ok, true);
});

// ── 期限切れ ──

test('vote: 期限切れトークンは auth_failed', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  // sandbox 内の issueSessionToken_ を期限切れ payload で直接呼ぶ代わりに、
  // SESSION_TTL_MS を負にして発行させる (実ソースの検証経路をそのまま通す)。
  env.sandbox.SESSION_TTL_MS = -1000;
  const res = post(env, { action: 'login', code: 'C' });
  assert.strictEqual(res.ok, true); // 発行自体はできる (exp が過去になる)
  const out = post(env, { action: 'vote', token: res.token, charId: '1305' });
  assert.strictEqual(out.error.code, 'auth_failed');
  assert.strictEqual(env.voteRows.length, 1);
});

// ── トークンの中身 ──

test('トークン payload に access token や secret が入っていない', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = loginToken(env);
  const body = Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
  for (const s of ['AT-secret', 'SECRET-DO-NOT-LEAK', 'CODE-login']) {
    assert.ok(body.indexOf(s) === -1, 'leaked in token: ' + s);
  }
  const payload = JSON.parse(body);
  assert.deepStrictEqual(Object.keys(payload).sort(), ['exp', 'iat', 'slug', 'tag', 'uid', 'v']);
});

test('セッションの有効期間は 180 日 (半年)', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const before = Date.now();
  const res = post(env, { action: 'login', code: 'C' });
  const days = (res.exp - before) / (24 * 3600 * 1000);
  assert.ok(days > 179 && days <= 181, 'exp が半年になっていない: ' + days + ' 日');
});

// ── ダブルメイン圏 (メインキャラ判定が僅差) ──

const DOUBLE_CHARS = [
  { id: 1305, name: 'ロックマン', pct: 0.52 },
  { id: 1271, name: 'ベヨネッタ', pct: 0.45 },   // 差 0.07 <= 0.10 → 候補
  { id: 1273, name: 'クッパ', pct: 0.03 },       // 差 0.49 → 候補外
];

test('double: 僅差の候補の中からなら投票できる', () => {
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: DOUBLE_CHARS } },
  });
  const token = loginToken(env);
  const res = post(env, { action: 'vote', token, charId: '1271' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(env.voteRows[1][4], '1271');
});

test('double: 候補外のキャラは not_candidate (候補名がメッセージに載る)', () => {
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: DOUBLE_CHARS } },
  });
  const token = loginToken(env);
  // クッパ (候補外だが本人の使用キャラ) も、一覧に無い 1272 も弾く
  // ※ 1273 はスタブの char_emoji に無いので先に一覧チェックへ足す
  const res = post(env, { action: 'vote', token, charId: '1305' });
  assert.strictEqual(res.ok, true); // トップ側は当然 OK

  const env2 = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: DOUBLE_CHARS } },
    charEmoji: { status: 200, body: { 1305: { name: 'ロックマン' }, 1271: { name: 'ベヨネッタ' }, 1273: { name: 'クッパ' } } },
  });
  const token2 = loginToken(env2);
  const res2 = post(env2, { action: 'vote', token: token2, charId: '1273' });
  assert.strictEqual(res2.error.code, 'not_candidate');
  assert.match(res2.error.message, /ロックマン \/ ベヨネッタ/);
  assert.strictEqual(env2.voteRows.length, 1);
});

test('double: 明確なメイン (差 > 閾値) は char_exists のまま', () => {
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [
      { id: 1305, name: 'ロックマン', pct: 0.80 },
      { id: 1271, name: 'ベヨネッタ', pct: 0.20 },
    ] } },
  });
  const token = loginToken(env);
  const res = post(env, { action: 'vote', token, charId: '1271' });
  assert.strictEqual(res.error.code, 'char_exists');
  assert.match(res.error.message, /僅差/);
});

test('double: 境界値 — 差がちょうど閾値なら候補、僅かに超えたら対象外', () => {
  const mk = (secondPct) => makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [
      { id: 1305, name: 'ロックマン', pct: 0.50 },
      { id: 1271, name: 'ベヨネッタ', pct: secondPct },
    ] } },
  });
  const at = mk(0.30);   // 差 0.20 = 閾値ちょうど
  assert.strictEqual(post(at, { action: 'vote', token: loginToken(at), charId: '1271' }).ok, true);
  const over = mk(0.299); // 差 0.201 > 閾値
  assert.strictEqual(
    post(over, { action: 'vote', token: loginToken(over), charId: '1271' }).error.code, 'char_exists');
});

test('double: 3 体が僅差なら 3 体とも候補', () => {
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [
      { id: 1305, name: 'ロックマン', pct: 0.35 },
      { id: 1271, name: 'ベヨネッタ', pct: 0.33 },
      { id: 1273, name: 'クッパ', pct: 0.30 },
    ] } },
    charEmoji: { status: 200, body: { 1305: { name: 'ロックマン' }, 1271: { name: 'ベヨネッタ' }, 1273: { name: 'クッパ' } } },
  });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1273' }).ok, true);
});

test('double: pct が読めないデータは安全側 (char_exists)', () => {
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [
      { id: 1305, name: 'ロックマン' }, // pct 無し
      { id: 1271, name: 'ベヨネッタ', pct: 0.45 },
    ] } },
  });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1305' }).error.code, 'char_exists');
});

test('double: 1 体しか登録が無ければ char_exists (明確なメイン)', () => {
  const env = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [
      { id: 1305, name: 'ロックマン', pct: 1 },
    ] } },
  });
  const token = loginToken(env);
  assert.strictEqual(post(env, { action: 'vote', token, charId: '1305' }).error.code, 'char_exists');
});

test('投票の status は常に pending (回帰)', () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = loginToken(env);
  post(env, { action: 'vote', token, charId: '1305' });
  assert.strictEqual(env.voteRows[1][6], 'pending');
});

test('デバッグモードは撤去済み — debug 系のフィールドを送っても効かない', () => {
  // 2026-08-14 の公開に合わせて ?debug=1 の経路を消した (gas/vote.gs)。
  // 認証・資格判定を飛ばせる抜け道が復活していないことを縛る。
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const res = post(env,
    { action: 'vote', charId: '1305', debug: 1, debugUid: '4242', debugTag: 'TK | Toko' });
  assert.strictEqual(res.error.code, 'auth_failed');
  assert.strictEqual(env.voteRows.length, 1);

  // token があっても資格判定は飛ばせない (明確なメインなら弾かれる)
  const env2 = makeEnv({
    token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242,
      characters: [{ id: 1305, name: 'ロックマン', pct: 1 }] } },
  });
  const token = loginToken(env2);
  assert.strictEqual(
    post(env2, { action: 'vote', token, charId: '1271', debug: 1 }).error.code, 'char_exists');
  assert.strictEqual(env2.voteRows.length, 1);
});

