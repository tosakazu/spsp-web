// キャラ投票 (action: vote)。gas_vote.test.cjs を移植。
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, jst, loginToken, OK_TOKEN, OK_USER } from './_env.mjs';
import { voteCandidates } from '../src/api/vote.ts';
import { DOUBLE_MAIN_PCT_GAP } from '../src/config.ts';

test('vote: 正しいトークンで 1 行 append され pending が付く', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = await loginToken(env);
  const res = await post(env, { action: 'vote', token, charId: '1305' });
  assert.deepStrictEqual(res, { ok: true, user: 'user/abcd1234', charId: '1305', charName: 'ロックマン' });
  assert.strictEqual(env.store.votes.length, 1);
  const row = env.store.votes[0];
  assert.match(row.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.strictEqual(row.ts_ms > 0, true);
  assert.strictEqual(row.user_id, '4242');           // INV-1: トークン (= currentUser) 由来
  assert.strictEqual(row.user_slug, 'user/abcd1234');
  assert.strictEqual(row.gamer_tag, 'Toko');
  assert.strictEqual(row.char_id, '1305');
  assert.strictEqual(row.char_name, 'ロックマン');
  assert.strictEqual(row.status, 'pending');
  assert.strictEqual(env.store.posts.length, 0);      // posts には書かない
  // 公開データは GAS と同じパスを読む
  assert.ok(env.fetches.some((f) => f.url === 'data:/data/char_emoji.json'));
  assert.ok(env.fetches.some((f) => f.url === 'data:/players/4242.json'));
});

test('vote: トークン無し・改ざん・別 secret は auth_failed で何も書かない', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = await loginToken(env);
  const [body, sig] = token.split('.');
  const json = JSON.parse(Buffer.from(body, 'base64url').toString());
  json.uid = '9999';
  const tampered = Buffer.from(JSON.stringify(json)).toString('base64url') + '.' + sig;
  const other = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const foreign = await loginToken(other);
  for (const bad of [undefined, '', 'garbage', 'a.b', token + 'x', tampered, foreign]) {
    const res = await post(env, { action: 'vote', token: bad, charId: '1305' });
    assert.strictEqual(res.error.code, 'auth_failed', 'should reject: ' + String(bad).slice(0, 30));
    assert.match(res.error.message, /ログインが無効か期限切れ/);
  }
  assert.strictEqual(env.store.votes.length, 0);
  // 失敗は errors に残る (uid は引けないので空)
  assert.ok(env.store.errors.every((r) => r.code === 'auth_failed' && r.action === 'vote' && r.user_id === ''));
});

test('vote: INV-1 相当 — クライアントの自己申告 uid は無視される', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = await loginToken(env);
  await post(env, { action: 'vote', token, charId: '1305', user_id: '9999', user_slug: 'user/spoofed' });
  assert.strictEqual(env.store.votes[0].user_id, '4242');
  assert.strictEqual(env.store.votes[0].user_slug, 'user/abcd1234');
});

test('vote: charId 不正は bad_request / 一覧に無いキャラは bad_char', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = await loginToken(env);
  for (const bad of [undefined, '', 'abc', '13.5', '-1', '1'.repeat(9), null]) {
    assert.strictEqual((await post(env, { action: 'vote', token, charId: bad })).error.code, 'bad_request', 'charId=' + String(bad));
  }
  const r = await post(env, { action: 'vote', token, charId: '9999' });
  assert.strictEqual(r.error.code, 'bad_char');
  assert.strictEqual(r.error.message, 'そのキャラは選択できません。');
  assert.strictEqual(env.store.votes.length, 0);
  // 失敗ログには uid が添えられる
  assert.ok(env.store.errors.some((e) => e.code === 'bad_char' && e.user_id === '4242'));
});

test('vote: charId は数値で送られてきても通る', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = await loginToken(env);
  assert.strictEqual((await post(env, { action: 'vote', token, charId: 1305 })).ok, true);
});

test('vote: キャラ一覧の取得失敗は internal で何も書かない', async () => {
  for (const charEmoji of [{ status: 500, body: 'oops' }, { status: 200, body: 'not json' }, null]) {
    const env = makeEnv({ token: OK_TOKEN, user: OK_USER, charEmoji });
    const token = await loginToken(env);
    const r = await post(env, { action: 'vote', token, charId: '1305' });
    assert.strictEqual(r.error.code, 'internal');
    assert.match(r.error.message, /キャラ一覧の取得に失敗/);
    assert.strictEqual(env.store.votes.length, 0);
  }
});

test('vote: SPSP にデータが無い選手は not_player (理由がメッセージに載る)', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 404, body: 'not found' } });
  const token = await loginToken(env);
  const res = await post(env, { action: 'vote', token, charId: '1305' });
  assert.strictEqual(res.error.code, 'not_player');
  assert.match(res.error.message, /SPSP にデータがある選手のみ/);
  assert.strictEqual(env.store.votes.length, 0);
});

test('vote: すでにキャラ情報がある選手は char_exists (理由がメッセージに載る)', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [{ id: 1305, name: 'ロックマン', pct: 1 }] } } });
  const token = await loginToken(env);
  const res = await post(env, { action: 'vote', token, charId: '1271' });
  assert.strictEqual(res.error.code, 'char_exists');
  assert.match(res.error.message, /キャラ情報が無い選手か、メインキャラ判定が僅差の選手のみ/);
  assert.strictEqual(env.store.votes.length, 0);
});

test('vote: 投票由来だけのキャラ (pct 無し) は実績ではないので再投票できる', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [{ id: 1305, name: 'ロックマン', src: 'vote' }] } } });
  const token = await loginToken(env);
  assert.strictEqual((await post(env, { action: 'vote', token, charId: '1271' })).ok, true);
});

test('vote: 選手データの取得失敗 (500 / 壊れた JSON / 通信断) は internal で書かない', async () => {
  for (const player of [{ status: 500, body: 'oops' }, { status: 200, body: '{{' }, null]) {
    const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player });
    const token = await loginToken(env);
    const r = await post(env, { action: 'vote', token, charId: '1305' });
    assert.strictEqual(r.error.code, 'internal');
    assert.match(r.error.message, /選手データの取得に失敗/);
    assert.strictEqual(env.store.votes.length, 0);
  }
});

test('vote: 資格がある間の再投票は通る (最新行が有効の想定)', async () => {
  const now = Date.now();
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER,
    voteRows: [[jst(now - 120 * 1000), '4242', 'user/abcd1234', 'Toko', '1271', 'ベヨネッタ', 'pending']] });
  const token = await loginToken(env);
  assert.strictEqual((await post(env, { action: 'vote', token, charId: '1305' })).ok, true);
  assert.strictEqual(env.store.votes.length, 2);
  assert.strictEqual(env.store.votes[1].char_id, '1305');
});

test('vote: 60 秒未満の連投は rate_limited', async () => {
  const now = Date.now();
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER,
    voteRows: [[jst(now - 10 * 1000), '4242', 'user/abcd1234', 'Toko', '1271', 'ベヨネッタ', 'pending']] });
  const token = await loginToken(env);
  assert.strictEqual((await post(env, { action: 'vote', token, charId: '1305' })).error.code, 'rate_limited');
  assert.strictEqual(env.store.votes.length, 1);
});

test('vote: 当日 10 件で rate_limited', async () => {
  const now = Date.now();
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push([jst(now - (120 + i * 60) * 1000), '4242', 'user/abcd1234', 'Toko', '1271', 'ベヨネッタ', 'pending']);
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, voteRows: rows });
  const token = await loginToken(env);
  assert.strictEqual((await post(env, { action: 'vote', token, charId: '1305' })).error.code, 'rate_limited');
});

test('vote: 同時投票で条件付き INSERT が弾いた場合も rate_limited', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = await loginToken(env);
  // recentActivity は空を返す (判定を通す) が、insert は競合で失敗する状況を作る
  env.store.recentActivity = async () => ({ latestMs: null, todayCount: 0 });
  env.store.insertVote = async () => false;
  const r = await post(env, { action: 'vote', token, charId: '1305' });
  assert.strictEqual(r.error.code, 'rate_limited');
});

test('vote: posts 側の直近投稿には引っかからない (テーブル独立)', async () => {
  const now = Date.now();
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER,
    postRows: [[jst(now - 5 * 1000), '4242', 'user/abcd1234', 'Toko', 'recent post', 'pending']] });
  const token = await loginToken(env);
  assert.strictEqual((await post(env, { action: 'vote', token, charId: '1305' })).ok, true);
});

test('vote: 期限切れトークンは auth_failed', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, cfg: { sessionTtlMs: -1000 } });
  const res = await post(env, { action: 'login', code: 'C' });
  assert.strictEqual(res.ok, true); // 発行自体はできる (exp が過去になる)
  const out = await post(env, { action: 'vote', token: res.token, charId: '1305' });
  assert.strictEqual(out.error.code, 'auth_failed');
  assert.strictEqual(env.store.votes.length, 0);
});

test('トークン payload に access token や secret が入っていない', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const token = await loginToken(env);
  const body = Buffer.from(token.split('.')[0], 'base64url').toString();
  for (const s of ['AT-secret', 'SECRET-DO-NOT-LEAK', 'CODE-login']) assert.ok(body.indexOf(s) === -1, 'leaked in token: ' + s);
});

// ── ダブルメイン圏 ──

const DOUBLE_CHARS = [
  { id: 1305, name: 'ロックマン', pct: 0.52 },
  { id: 1271, name: 'ベヨネッタ', pct: 0.45 },   // 差 0.07 → 候補
  { id: 1273, name: 'クッパ', pct: 0.03 },       // 差 0.49 → 候補外
];
const THREE_CHARS = { 1305: { name: 'ロックマン' }, 1271: { name: 'ベヨネッタ' }, 1273: { name: 'クッパ' } };

test('voteCandidates: 純粋規則 (null / [] / 候補、最大 pct 基準、pct 無しは数えない)', () => {
  assert.strictEqual(DOUBLE_MAIN_PCT_GAP, 0.20);
  assert.strictEqual(voteCandidates(undefined), null);
  assert.strictEqual(voteCandidates([]), null);
  assert.strictEqual(voteCandidates([{ id: 1, name: 'a' }]), null);                  // 投票由来のみ
  assert.deepStrictEqual(voteCandidates([{ id: 1, name: 'a', pct: 1 }]), []);        // 明確なメイン
  assert.deepStrictEqual(voteCandidates(DOUBLE_CHARS), [{ id: '1305', name: 'ロックマン' }, { id: '1271', name: 'ベヨネッタ' }]);
  // 先頭が最大とは限らない (ビルドが並びを変える)
  assert.deepStrictEqual(voteCandidates([{ id: 2, name: 'b', pct: 0.3 }, { id: 1, name: 'a', pct: 0.5 }, { id: 3, name: 'c', pct: 0.2 }]),
    [{ id: '2', name: 'b' }, { id: '1', name: 'a' }]);
  // pct が読めない (文字列) は数えない
  assert.deepStrictEqual(voteCandidates([{ id: 1, name: 'a', pct: 'x' }, { id: 2, name: 'b', pct: 0.45 }]), []);
  // id の無いものは数えない
  assert.deepStrictEqual(voteCandidates([{ name: 'a', pct: 0.5 }, { id: 2, name: 'b', pct: 0.45 }]), []);
});

test('double: 僅差の候補の中からなら投票できる', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 200, body: { user_id: 4242, characters: DOUBLE_CHARS } } });
  const token = await loginToken(env);
  const res = await post(env, { action: 'vote', token, charId: '1271' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(env.store.votes[0].char_id, '1271');
});

test('double: 候補外のキャラは not_candidate (候補名がメッセージに載る)', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 200, body: { user_id: 4242, characters: DOUBLE_CHARS } } });
  assert.strictEqual((await post(env, { action: 'vote', token: await loginToken(env), charId: '1305' })).ok, true);
  const env2 = makeEnv({ token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: DOUBLE_CHARS } }, charEmoji: { status: 200, body: THREE_CHARS } });
  const res2 = await post(env2, { action: 'vote', token: await loginToken(env2), charId: '1273' });
  assert.strictEqual(res2.error.code, 'not_candidate');
  assert.strictEqual(res2.error.message, 'メインキャラ判定が僅差の ロックマン / ベヨネッタ の中から選んでください。');
  assert.strictEqual(env2.store.votes.length, 0);
});

test('double: 明確なメイン (差 > 閾値) は char_exists のまま', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 200, body: { user_id: 4242, characters: [
    { id: 1305, name: 'ロックマン', pct: 0.80 }, { id: 1271, name: 'ベヨネッタ', pct: 0.20 }] } } });
  const res = await post(env, { action: 'vote', token: await loginToken(env), charId: '1271' });
  assert.strictEqual(res.error.code, 'char_exists');
  assert.match(res.error.message, /僅差/);
});

test('double: 境界値 — 差がちょうど閾値なら候補、僅かに超えたら対象外', async () => {
  const mk = (secondPct) => makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 200, body: { user_id: 4242, characters: [
    { id: 1305, name: 'ロックマン', pct: 0.50 }, { id: 1271, name: 'ベヨネッタ', pct: secondPct }] } } });
  const at = mk(0.30);
  assert.strictEqual((await post(at, { action: 'vote', token: await loginToken(at), charId: '1271' })).ok, true);
  const over = mk(0.299);
  assert.strictEqual((await post(over, { action: 'vote', token: await loginToken(over), charId: '1271' })).error.code, 'char_exists');
});

test('double: 3 体が僅差なら 3 体とも候補', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 200, body: { user_id: 4242, characters: [
    { id: 1305, name: 'ロックマン', pct: 0.35 }, { id: 1271, name: 'ベヨネッタ', pct: 0.33 }, { id: 1273, name: 'クッパ', pct: 0.30 }] } },
    charEmoji: { status: 200, body: THREE_CHARS } });
  assert.strictEqual((await post(env, { action: 'vote', token: await loginToken(env), charId: '1273' })).ok, true);
});

test('double: pct が読めないデータは安全側 (char_exists) / 1 体しか無ければ char_exists', async () => {
  const a = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 200, body: { user_id: 4242, characters: [
    { id: 1305, name: 'ロックマン' }, { id: 1271, name: 'ベヨネッタ', pct: 0.45 }] } } });
  assert.strictEqual((await post(a, { action: 'vote', token: await loginToken(a), charId: '1305' })).error.code, 'char_exists');
  const b = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 200, body: { user_id: 4242, characters: [
    { id: 1305, name: 'ロックマン', pct: 1 }] } } });
  assert.strictEqual((await post(b, { action: 'vote', token: await loginToken(b), charId: '1305' })).error.code, 'char_exists');
});

test('デバッグモードは無い — debug 系のフィールドを送っても効かない', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER });
  const res = await post(env, { action: 'vote', charId: '1305', debug: 1, debugUid: '4242', debugTag: 'TK | Toko' });
  assert.strictEqual(res.error.code, 'auth_failed');
  assert.strictEqual(env.store.votes.length, 0);
  const env2 = makeEnv({ token: OK_TOKEN, user: OK_USER,
    player: { status: 200, body: { user_id: 4242, characters: [{ id: 1305, name: 'ロックマン', pct: 1 }] } } });
  assert.strictEqual((await post(env2, { action: 'vote', token: await loginToken(env2), charId: '1271', debug: 1 })).error.code, 'char_exists');
  assert.strictEqual(env2.store.votes.length, 0);
});

test('tester: VOTE_TESTER_UIDS の uid はメインが明確でも投票でき、status=debug で保存 (集計されない)', async () => {
  const player = { status: 200, body: { user_id: 4242, characters: [{ id: 1305, name: 'ロックマン', pct: 1 }] } };
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, player, cfg: { voteTesterUids: ['4242'] } });
  const res = await post(env, { action: 'vote', token: await loginToken(env), charId: '1271' });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.test, true);
  assert.strictEqual(env.store.votes.length, 1);
  assert.strictEqual(env.store.votes[0].status, 'debug');
  // 対象外の uid は従来どおり char_exists
  const other = makeEnv({ token: OK_TOKEN, user: OK_USER, player, cfg: { voteTesterUids: ['1'] } });
  assert.strictEqual((await post(other, { action: 'vote', token: await loginToken(other), charId: '1271' })).error.code, 'char_exists');
});

test('tester: 資格がある場合は通常どおり pending (test フラグ無し)、not_player は免除しない', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, cfg: { voteTesterUids: ['4242'] } });
  const res = await post(env, { action: 'vote', token: await loginToken(env), charId: '1305' });
  assert.deepStrictEqual(res, { ok: true, user: 'user/abcd1234', charId: '1305', charName: 'ロックマン' });
  assert.strictEqual(env.store.votes[0].status, 'pending');
  const np = makeEnv({ token: OK_TOKEN, user: OK_USER, player: { status: 404, body: {} }, cfg: { voteTesterUids: ['4242'] } });
  assert.strictEqual((await post(np, { action: 'vote', token: await loginToken(np), charId: '1305' })).error.code, 'not_player');
});

test('tester: 僅差の候補外を選んでも debug で保存', async () => {
  const env = makeEnv({ token: OK_TOKEN, user: OK_USER, cfg: { voteTesterUids: ['4242'] }, player: { status: 200, body: { user_id: 4242, characters: [
    { id: 1305, name: 'ロックマン', pct: 0.50 }, { id: 1273, name: 'クッパ', pct: 0.45 }] } } });
  const res = await post(env, { action: 'vote', token: await loginToken(env), charId: '1271' });
  assert.strictEqual(res.test, true);
  assert.strictEqual(env.store.votes[0].status, 'debug');
});
