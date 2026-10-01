// ログイン確認 (me) とプレイヤーカードの設定 (card_get / card_put、GET /api/card)。docs/login_design.md
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http, loginToken, OK_TOKEN, OK_USER } from './_env.mjs';
import { validateCardSettings } from '../src/api/card.ts';
import { issueSessionToken } from '../src/api/session.ts';
import { CARD_RATE_MIN_INTERVAL_MS, CARD_RATE_MAX_PER_DAY } from '../src/config.ts';

const env = (o) => makeEnv(Object.assign({ token: OK_TOKEN, user: OK_USER }, o || {}));
const GOOD = { template: 'standard', color: 'blue', ach: ['tour:{"name":"篝火#15"}', 'rank:top8'], tour: 1648718, title: null };
const plain = (x) => JSON.parse(JSON.stringify(x));

test('me: 有効なトークンは中身 (user, exp) を返す。無効・期限切れは invalid_session で記録しない', async () => {
  const e = env();
  const token = await loginToken(e);
  const res = await post(e, { action: 'me', token });
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.user, { id: '4242', slug: 'user/abcd1234', gamerTag: 'Toko' });
  assert.strictEqual(typeof res.exp, 'number');
  const fetchesBefore = e.fetches.length;
  for (const bad of [undefined, '', 'garbage', token + 'x']) {
    const r = await post(e, { action: 'me', token: bad });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error.code, 'invalid_session');
  }
  const old = await issueSessionToken(e.cfg, { id: '4242', slug: 'user/x', gamerTag: 'T' }, Date.now() - e.cfg.sessionTtlMs - 1000);
  assert.strictEqual((await post(e, { action: 'me', token: old })).error.code, 'invalid_session');
  assert.strictEqual(e.fetches.length, fetchesBefore, 'start.gg には問い合わせない');
  assert.strictEqual(e.store.errors.length, 0, '期限切れは記録しない');
});

test('validateCardSettings: 許す形と弾く形', () => {
  assert.deepStrictEqual(plain(validateCardSettings(GOOD)), GOOD);
  assert.deepStrictEqual(plain(validateCardSettings({ template: 'standard', color: 'red' })), { template: 'standard', color: 'red', ach: null, tour: null, title: null });
  assert.deepStrictEqual(plain(validateCardSettings({ template: 'standard', color: 'red', ach: [] })), { template: 'standard', color: 'red', ach: [], tour: null, title: null });
  for (const c of ['red', 'blue', 'green', 'purple', 'orange', 'teal', 'yellow', 'gray']) assert.ok(validateCardSettings({ template: 'standard', color: c, ach: null }));
  const bads = [
    null, 'x', [], {},
    { template: 'fancy', color: 'red' }, { color: 'red' },
    { template: 'standard', color: 'black' }, { template: 'standard', color: 'RED' }, { template: 'standard' },
    { template: 'standard', color: 'red', ach: 'a' },
    { template: 'standard', color: 'red', ach: [1] },
    { template: 'standard', color: 'red', ach: [''] },
    { template: 'standard', color: 'red', ach: ['a', 'a'] },
    { template: 'standard', color: 'red', ach: ['x'.repeat(301)] },
    { template: 'standard', color: 'red', ach: Array.from({ length: 13 }, (_, i) => 'k' + i) },
    { template: 'standard', color: 'red', ach: null, extra: 1 },
  ];
  for (const b of bads) assert.strictEqual(validateCardSettings(b), null, JSON.stringify(b));
  assert.ok(validateCardSettings({ template: 'standard', color: 'red', ach: ['x'.repeat(300)] }), '300 文字ちょうどは可');
  assert.ok(validateCardSettings({ template: 'standard', color: 'red', ach: Array.from({ length: 12 }, (_, i) => 'k' + i) }), '12 個ちょうどは可');
});

test('card_put → card_get: 本人の行に書け、だれでも読める。updated_at は +09:00', async () => {
  const e = env();
  const token = await loginToken(e);
  const put = await post(e, { action: 'card_put', token, settings: GOOD });
  assert.strictEqual(put.ok, true);
  assert.deepStrictEqual(put.settings, GOOD);
  assert.match(put.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  const got = await post(e, { action: 'card_get', uid: '4242' });
  assert.deepStrictEqual(got, { ok: true, settings: GOOD, updated_at: put.updated_at });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: 7 }), { ok: true, settings: null, updated_at: null });
});

test('card_put: 書く uid はトークンのものだけ (リクエストの uid は無視)', async () => {
  const e = env();
  const token = await loginToken(e);
  await post(e, { action: 'card_put', token, uid: '9999', user_id: '9999', settings: GOOD });
  assert.deepStrictEqual([...e.store.cards.keys()], ['4242']);
  assert.strictEqual((await post(e, { action: 'card_get', uid: '9999' })).settings, null);
});

test('card_put: トークン無効は invalid_session、形が違えば bad_settings。どちらも書かず errors に残す', async () => {
  const e = env();
  const token = await loginToken(e);
  assert.strictEqual((await post(e, { action: 'card_put', token: 'garbage', settings: GOOD })).error.code, 'invalid_session');
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: { template: 'standard', color: 'pink' } })).error.code, 'bad_settings');
  assert.strictEqual((await post(e, { action: 'card_put', token })).error.code, 'bad_settings', 'settings 省略は削除ではない');
  assert.strictEqual(e.store.cards.size, 0);
  assert.strictEqual(e.store.cardWrites.length, 0, '弾いた書き込みは連投の数に入れない');
  assert.deepStrictEqual(e.store.errors.map((r) => [r.action, r.code, r.user_id]),
    [['card_put', 'invalid_session', ''], ['card_put', 'bad_settings', '4242'], ['card_put', 'bad_settings', '4242']]);
});

test('card_put: settings:null で行を消す (既定に戻す)', async () => {
  const e = env();
  const token = await loginToken(e);
  e.nowMs = Date.parse('2026-09-30T03:00:00Z');
  await post(e, { action: 'card_put', token, settings: GOOD });
  e.nowMs += CARD_RATE_MIN_INTERVAL_MS + 1;
  const del = await post(e, { action: 'card_put', token, settings: null });
  assert.deepStrictEqual(del, { ok: true, settings: null, updated_at: null });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '4242' }), { ok: true, settings: null, updated_at: null });
});

test('card_put: 連投制限 (間隔と当日件数)。弾いたときは前の設定のまま', async () => {
  const e = env();
  const token = await loginToken(e);
  let t = Date.parse('2026-09-30T00:00:00Z');   // JST 09:00
  e.nowMs = t;
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).ok, true);
  e.nowMs = t + CARD_RATE_MIN_INTERVAL_MS - 1;
  const r = await post(e, { action: 'card_put', token, settings: { ...GOOD, color: 'red' } });
  assert.strictEqual(r.error.code, 'rate_limited');
  assert.strictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings.color, 'blue');
  for (let i = 1; i < CARD_RATE_MAX_PER_DAY; i++) {
    t += CARD_RATE_MIN_INTERVAL_MS;
    e.nowMs = t;
    assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).ok, true, 'i=' + i);
  }
  e.nowMs = t + CARD_RATE_MIN_INTERVAL_MS;
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).error.code, 'rate_limited', '当日上限');
  e.nowMs = Date.parse('2026-10-01T00:00:00Z');   // 翌日
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: GOOD })).ok, true);
});

test('GET /api/card?uid=: 成功は public, max-age=60、uid 不正は bad_request で no-store', async () => {
  const e = env();
  const token = await loginToken(e);
  await post(e, { action: 'card_put', token, settings: GOOD });
  const r = await http(e, 'GET', '/api/card?uid=4242');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('Cache-Control'), 'public, max-age=60');
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepStrictEqual(r.json.settings, GOOD);
  const none = await http(e, 'GET', '/api/card?uid=1');
  assert.deepStrictEqual(none.json, { ok: true, settings: null, updated_at: null });
  for (const q of ['', '?uid=', '?uid=abc', '?uid=-1', '?uid=1234567890123']) {
    const b = await http(e, 'GET', '/api/card' + q);
    assert.strictEqual(b.json.error.code, 'bad_request', q);
    assert.strictEqual(b.headers.get('Cache-Control'), 'no-store', q);
  }
  // POST /api/card_put (パスから action を補う) でも書ける
  e.nowMs = Date.now() + CARD_RATE_MIN_INTERVAL_MS + 1;
  const p = await http(e, 'POST', '/api/card_put', { token, settings: { ...GOOD, color: 'green' } });
  assert.strictEqual(p.json.ok, true);
  assert.strictEqual(p.headers.get('Cache-Control'), 'no-store');
});

test('card_get: 保存済みの行が壊れていれば無いものとして返す', async () => {
  const e = env();
  e.store.cards.set('5', { settings: '{broken', updated_at: 'x' });
  e.store.cards.set('6', { settings: JSON.stringify({ template: 'old', color: 'red' }), updated_at: 'x' });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '5' }), { ok: true, settings: null, updated_at: null });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '6' }), { ok: true, settings: null, updated_at: null });
});

test('validateCardSettings: tour は event_id (正の整数 1〜12 桁) か null。数字の文字列は整数にする', () => {
  const base = { template: 'standard', color: 'red', ach: null };
  assert.strictEqual(validateCardSettings({ ...base, tour: 1648718 }).tour, 1648718);
  assert.strictEqual(validateCardSettings({ ...base, tour: '1648718' }).tour, 1648718);
  assert.strictEqual(validateCardSettings({ ...base, tour: null }).tour, null);
  assert.strictEqual(validateCardSettings(base).tour, null);
  assert.strictEqual(validateCardSettings({ ...base, tour: 999999999999 }).tour, 999999999999);
  for (const bad of [0, -1, 1.5, '0', '01', 'abc', '', '1e5', ' 12', 1e12, '1234567890123', true, [1], {}]) {
    assert.strictEqual(validateCardSettings({ ...base, tour: bad }), null, JSON.stringify(bad));
  }
});

test('card_put: tour を文字列で送っても整数で保存・返す', async () => {
  const e = env();
  const token = await loginToken(e);
  const put = await post(e, { action: 'card_put', token, settings: { template: 'standard', color: 'red', tour: '1702406' } });
  assert.deepStrictEqual(put.settings, { template: 'standard', color: 'red', ach: null, tour: 1702406, title: null });
  assert.strictEqual(JSON.parse(e.store.cards.get('4242').settings).tour, 1702406);
  assert.deepStrictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings, put.settings);
});

test('card_put: 追加の色 (teal / yellow / gray) も保存できる。それ以外の色は bad_settings', async () => {
  const e = env();
  const token = await loginToken(e);
  let t = Date.parse('2026-10-01T03:00:00Z');
  for (const color of ['teal', 'yellow', 'gray']) {
    e.nowMs = t; t += CARD_RATE_MIN_INTERVAL_MS + 1;
    const r = await post(e, { action: 'card_put', token, settings: { template: 'standard', color } });
    assert.strictEqual(r.ok, true, color);
    assert.strictEqual(r.settings.color, color);
    assert.strictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings.color, color);
  }
  e.nowMs = t;
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: { template: 'standard', color: 'grey' } })).error.code, 'bad_settings');
});

// ── 二つ名 (title) ── site/js/titles.js の一覧と ownedTitles をそのまま使う
import { ownedTitles, titleById, titleLang, usableIn } from '../src/api/titles.ts';

/** 選手データ (players/<uid>.json) の応答を決めた env。tours = 大会の配列 / null = 404 / 'fail' = 500 / 'throw' = 例外 / 'hang' = 返らない */
function titleEnv(tours) {
  let player;
  if (tours === null) player = { status: 404, body: {} };
  else if (tours === 'fail') player = { status: 500, body: {} };
  else if (tours === 'throw') player = null;
  else player = { status: 200, body: { user_id: 4242, tournaments: tours } };
  const e = env({ player });
  if (tours === 'hang') e.ctx.dataFetch = () => { e.hangStarted = true; return new Promise(() => {}); };
  return e;
}
/** 本戦の大会 n 個 (1 試合以上した = wins + losses >= 1)。games = 各大会の試合数 */
const toursN = (n, games = 1) => Array.from({ length: n }, (_, i) => ({ date: '2026-0' + (1 + Math.floor(i / 28)) + '-' + String(1 + (i % 28)).padStart(2, '0'), event_id: 1000 + i, wins: games > 0 ? 1 : 0, losses: Math.max(0, games - 1) }));
const withTitle = (title) => ({ template: 'standard', color: 'red', title });
/** uid 4242 が引いたランダムの二つ名 (1 試合以上した本戦 1 つにつき 2 つ) */
function drawnFor(tours) { return [...ownedTitles('ja', '4242', tours)].filter(([, v]) => v.how === 'random').map(([k]) => k); }

test('titles: 一覧は site/js/titles.js のもの、言語は地域から (北米は en)', () => {
  assert.strictEqual(titleById('ja', 'ja-0001').part, 'pre');
  assert.strictEqual(titleById('ja', 'ja-0005').part, 'post');
  assert.strictEqual(titleById('ja', 'ja-0003').part, 'both');
  assert.strictEqual(titleById('ja', 'ja-9999'), null);
  assert.ok(usableIn(titleById('ja', 'ja-0003'), 'pre') && usableIn(titleById('ja', 'ja-0003'), 'post'));
  assert.ok(!usableIn(titleById('ja', 'ja-0001'), 'post'));
  assert.strictEqual(titleLang('/na'), 'en');
  assert.strictEqual(titleLang('/jp'), 'ja');
  assert.strictEqual(titleLang(undefined), 'ja');
});

test('card_put: 最初から持っている二つ名は保存でき、card_get がそのまま返す', async () => {
  const e = titleEnv([]);
  const token = await loginToken(e);
  const r = await post(e, { action: 'card_put', token, settings: withTitle({ pre: 'ja-0001', post: 'ja-0005' }) });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(r.settings.title, { pre: 'ja-0001', post: 'ja-0005' });
  assert.deepStrictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings.title, { pre: 'ja-0001', post: 'ja-0005' });
  assert.ok(e.fetches.some((f) => f.url === 'data:/players/4242.json'), '公開データを読む');
});

test('二つ名の獲得: 1 試合以上した本戦 1 つにつき 2 つ。試合 0 の大会・下位クラスの仮想大会は数えない', () => {
  assert.strictEqual(drawnFor([]).length, 0);
  assert.strictEqual(drawnFor(toursN(1)).length, 2);
  assert.strictEqual(drawnFor(toursN(2)).length, 4);
  assert.strictEqual(drawnFor(toursN(3, 0)).length, 0, '試合 0 (wins + losses = 0) は数えない');
  assert.strictEqual(drawnFor([{ date: '2026-02-01', event_id: 5, wins: 0, losses: 1 }]).length, 2, '負けだけでも 1 試合');
  assert.strictEqual(drawnFor([{ date: '2026-02-01', event_id: 6, parent_event_id: 5, wins: 3, losses: 1 }]).length, 0, '下位クラスの仮想大会');
  assert.deepStrictEqual(drawnFor(toursN(1)), drawnFor(toursN(1)), '同じ入力なら同じ結果');
});

test('card_put: 1 試合以上した大会 1 つで引いた 2 つは保存でき、引いていないもの・試合 0 なら title_not_owned', async () => {
  const tours = toursN(1);
  const drawn = drawnFor(tours);
  assert.strictEqual(drawn.length, 2);
  const id = drawn[0];
  const slot = usableIn(titleById('ja', id), 'pre') ? 'pre' : 'post';
  const put = (x) => withTitle(slot === 'pre' ? { pre: x, post: null } : { pre: null, post: x });
  let e = titleEnv(tours);
  let token = await loginToken(e);
  const ok1 = await post(e, { action: 'card_put', token, settings: put(id) });
  assert.strictEqual(ok1.ok, true, JSON.stringify(ok1));
  // 同じ位置に使えるランダム解放で、引いていないもの
  const other = ['ja-0002', 'ja-0003', 'ja-0004', 'ja-0006', 'ja-0007', 'ja-0008']
    .find((x) => !drawn.includes(x) && usableIn(titleById('ja', x), slot));
  assert.ok(other, '引いていない候補がある');
  e = titleEnv(tours);
  token = await loginToken(e);
  const ng = await post(e, { action: 'card_put', token, settings: put(other) });
  assert.strictEqual(ng.error.code, 'title_not_owned');
  assert.strictEqual(e.store.cards.size, 0);
  // 試合 0 の大会ばかりならランダムは持っていない
  e = titleEnv(toursN(5, 0));
  token = await loginToken(e);
  assert.strictEqual((await post(e, { action: 'card_put', token, settings: put(id) })).error.code, 'title_not_owned');
});

test('card_put: どちらでも使える二つ名 (both、ja-0003) は前半にも後半にも置ける。同じ id を前後両方に置くのも今は許す', async () => {
  // ja-0003 を引く大会の数を探す (同じ入力なら必ず同じ結果)
  let n = 1;
  while (n <= 20 && !ownedTitles('ja', '4242', toursN(n)).has('ja-0003')) n += 1;
  assert.ok(n <= 20, 'ja-0003 を引ける');
  for (const title of [{ pre: 'ja-0003', post: 'ja-0005' }, { pre: 'ja-0001', post: 'ja-0003' }, { pre: 'ja-0003', post: 'ja-0003' }]) {
    const e = titleEnv(toursN(n));
    const token = await loginToken(e);
    const r = await post(e, { action: 'card_put', token, settings: withTitle(title) });
    assert.strictEqual(r.ok, true, JSON.stringify(title) + ' ' + JSON.stringify(r));
    assert.deepStrictEqual(r.settings.title, title);
  }
});

test('card_put: 前後の取り違え・一覧に無い id・形の違いは bad_settings (選手データは読まない)', async () => {
  for (const title of [
    { pre: 'ja-0005', post: null }, { pre: null, post: 'ja-0001' },
    { pre: 'ja-9999', post: null }, { pre: 'en-0001', post: null },
  ]) {
    const e = titleEnv([]);
    const token = await loginToken(e);
    const before = e.fetches.length;
    const r = await post(e, { action: 'card_put', token, settings: withTitle(title) });
    assert.strictEqual(r.error.code, 'bad_settings', JSON.stringify(title));
    assert.strictEqual(e.fetches.length, before, '選手データは読まない');
  }
  for (const title of [{ pre: 'JA-0001', post: null }, { pre: 'ja-1', post: null }, { pre: 'ja-p-0001', post: null }, { pre: 1, post: null }, { pre: null, post: null, x: 1 }, 'ja-p-0001', []]) {
    assert.strictEqual(validateCardSettings(withTitle(title)), null, JSON.stringify(title));
  }
});

test('card_put: title が null・両方 null・省略なら付けない (選手データは読まない)', async () => {
  for (const title of [null, { pre: null, post: null }, undefined]) {
    const e = titleEnv('throw');
    const token = await loginToken(e);
    const s = { template: 'standard', color: 'red' };
    if (title !== undefined) s.title = title;
    const r = await post(e, { action: 'card_put', token, settings: s });
    assert.strictEqual(r.ok, true, JSON.stringify(title));
    assert.strictEqual(r.settings.title, null);
    assert.ok(!e.fetches.some((f) => String(f.url).includes('/players/')));
  }
});

test('card_put: 選手データが読めなければ title_unverified で保存しない (失敗・例外・時間切れ)。404 は大会 0 件として扱う', async () => {
  for (const tours of ['fail', 'throw']) {
    const e = titleEnv(tours);
    const token = await loginToken(e);
    const r = await post(e, { action: 'card_put', token, settings: withTitle({ pre: 'ja-0001', post: null }) });
    assert.strictEqual(r.error.code, 'title_unverified', String(tours));
    assert.strictEqual(e.store.cards.size, 0);
  }
  const e404 = titleEnv(null);
  const t404 = await loginToken(e404);
  assert.strictEqual((await post(e404, { action: 'card_put', token: t404, settings: withTitle({ pre: 'ja-0001', post: null }) })).ok, true);
});

test('card_put: 選手データが 5 秒返らなければ title_unverified', async (t) => {
  const e = titleEnv('hang');
  const token = await loginToken(e);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const p = post(e, { action: 'card_put', token, settings: withTitle({ pre: 'ja-0001', post: null }) });
  // 選手データを読みに行く (= 時間切れの setTimeout が仕掛けられる) まで待ってから 5 秒進める。
  // その前のトークン検証 (crypto.subtle) は実時間で進むので、setImmediate で待つ
  for (let i = 0; i < 100000 && !e.hangStarted; i++) await new Promise((r) => setImmediate(r));
  assert.ok(e.hangStarted);
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(4999);
  t.mock.timers.tick(1);
  assert.strictEqual((await p).error.code, 'title_unverified');
});
