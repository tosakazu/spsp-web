// ログイン確認 (me) とプレイヤーカードの設定 (card_get / card_put、GET /api/card)。docs/login_design.md
import './_titles_fixture.mjs';   // 二つ名の一覧はテスト用の 8 件 (ほかの import より先)
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http, loginToken, OK_TOKEN, OK_USER } from './_env.mjs';
import { validateCardSettings, titleTextOf } from '../src/api/card.ts';
import { issueSessionToken } from '../src/api/session.ts';
import { CARD_RATE_MIN_INTERVAL_MS, CARD_RATE_MAX_PER_DAY } from '../src/config.ts';

const env = (o) => makeEnv(Object.assign({ token: OK_TOKEN, user: OK_USER }, o || {}));
const GOOD = { template: 'standard', color: 'blue', ach: ['tour:{"name":"篝火#15"}', 'rank:top8'], tour: 1648718, title: null, latin: null };
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
  assert.deepStrictEqual(plain(validateCardSettings({ template: 'standard', color: 'red' })), { template: 'standard', color: 'red', ach: null, tour: null, title: null, latin: null });
  assert.deepStrictEqual(plain(validateCardSettings({ template: 'standard', color: 'red', ach: [] })), { template: 'standard', color: 'red', ach: [], tour: null, title: null, latin: null });
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
  assert.deepStrictEqual(got, { ok: true, settings: GOOD, updated_at: put.updated_at, title_text: null });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: 7 }), { ok: true, settings: null, updated_at: null, title_text: null });
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
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '4242' }), { ok: true, settings: null, updated_at: null, title_text: null });
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
  assert.deepStrictEqual(none.json, { ok: true, settings: null, updated_at: null, title_text: null });
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
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '5' }), { ok: true, settings: null, updated_at: null, title_text: null });
  assert.deepStrictEqual(await post(e, { action: 'card_get', uid: '6' }), { ok: true, settings: null, updated_at: null, title_text: null });
});

test('validateCardSettings: latin は英字名 (半角の英字・数字・一部の記号と空白 1〜45 文字、前後・連続の空白なし) か null', () => {
  const base = { template: 'standard', color: 'red' };
  assert.strictEqual(validateCardSettings({ ...base, latin: 'kaworu' }).latin, 'kaworu');
  assert.strictEqual(validateCardSettings({ ...base, latin: 'Mild na H.O' }).latin, 'Mild na H.O');
  assert.strictEqual(validateCardSettings({ ...base, latin: "Fly High! K.O-kun's_2+&?" }).latin, "Fly High! K.O-kun's_2+&?");
  assert.strictEqual(validateCardSettings({ ...base, latin: 'x'.repeat(45) }).latin, 'x'.repeat(45));
  assert.strictEqual(validateCardSettings({ ...base, latin: null }).latin, null);
  assert.strictEqual(validateCardSettings(base).latin, null);
  for (const bad of ['', ' a', 'a ', 'a  b', 'x'.repeat(46), 'カヲル', 'ａｂ', 'a\tb', 'a\nb', 'a/b', 'a(b)', 'a#', '!!', 1, true, ['a']])
    assert.strictEqual(validateCardSettings({ ...base, latin: bad }), null, JSON.stringify(bad));
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
  assert.deepStrictEqual(put.settings, { template: 'standard', color: 'red', ach: null, tour: 1702406, title: null, latin: null });
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

// ── 二つ名 (title) ── 一覧と位置の判定は site/js/titles.js、持っているかは記録 (D1 title_owned)
import { bitsFromIds, titleById, titleLang, usableIn } from '../src/api/titles.ts';

const withTitle = (title) => ({ template: 'standard', color: 'red', title });
/** 記録 (title_owned) を ids で入れた env。ids = null なら記録なし */
function titleEnv(ids) {
  const e = env();
  if (ids) e.store.titleOwned.set('4242|ja', { bits: bitsFromIds(ids), updated: '2026-10-02' });
  return e;
}
async function putTitle(e, title) {
  const token = await loginToken(e);
  return post(e, { action: 'card_put', token, settings: withTitle(title) });
}

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

test('card_put: 記録にある二つ名は保存でき、card_get がそのまま返す (公開データは読まない)', async () => {
  const e = titleEnv(['ja-0001', 'ja-0003', 'ja-0005']);
  for (const title of [{ pre: 'ja-0003', post: 'ja-0005' }, { pre: 'ja-0001', post: 'ja-0003' }, { pre: 'ja-0003', post: 'ja-0003' }]) {
    e.nowMs = (e.nowMs || Date.now()) + 60000;
    const r = await putTitle(e, title);
    assert.strictEqual(r.ok, true, JSON.stringify(title) + ' ' + JSON.stringify(r));
    assert.deepStrictEqual(r.settings.title, title);
    const got = await post(e, { action: 'card_get', uid: '4242' });
    assert.deepStrictEqual(got.settings.title, title);
    // 文字も返す (プレイヤーページは一覧を読まない)
    assert.deepStrictEqual(got.title_text, { pre: titleById('ja', title.pre).text, post: titleById('ja', title.post).text });
  }
  assert.ok(!e.fetches.some((f) => String(f.url).includes('/players/')), '公開データは読まない');
});

test('card_get: title_text は付けていなければ null、片方だけなら片方は ""', async () => {
  const e = titleEnv(['ja-0003']);
  const token = await loginToken(e);
  await post(e, { action: 'card_put', token, settings: withTitle({ pre: null, post: 'ja-0003' }) });
  assert.deepStrictEqual((await post(e, { action: 'card_get', uid: '4242' })).title_text, { pre: '', post: titleById('ja', 'ja-0003').text });
  e.nowMs = (e.nowMs || Date.now()) + 60000;
  await post(e, { action: 'card_put', token, settings: withTitle(null) });
  assert.strictEqual((await post(e, { action: 'card_get', uid: '4242' })).title_text, null);
});

test('card_put: 記録に無いランダムの二つ名は title_not_owned (記録があれば最初からの二つ名も記録どおり)', async () => {
  let e = titleEnv(['ja-0001', 'ja-0005']);
  let r = await putTitle(e, { pre: 'ja-0003', post: null });
  assert.strictEqual(r.error.code, 'title_not_owned');
  assert.strictEqual(e.store.cards.size, 0);
  // 記録があっても最初からの二つ名は持っている扱い (初回の記録より前に一覧に足された initial でも使える)
  e = titleEnv(['ja-0003']);
  r = await putTitle(e, { pre: 'ja-0001', post: 'ja-0005' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

test('card_put: 記録がまだ無い選手は、最初から持っている二つ名だけ使える', async () => {
  let e = titleEnv(null);
  assert.strictEqual((await putTitle(e, { pre: 'ja-0001', post: 'ja-0005' })).ok, true);
  e = titleEnv(null);
  assert.strictEqual((await putTitle(e, { pre: null, post: 'ja-0006' })).error.code, 'title_not_owned');
});

test('card_put: 位置の取り違え・一覧に無い id・形の違いは bad_settings', async () => {
  for (const title of [
    { pre: 'ja-0005', post: null }, { pre: null, post: 'ja-0001' },
    { pre: 'ja-9999', post: null }, { pre: 'en-0001', post: null },
  ]) {
    const e = titleEnv(['ja-0001', 'ja-0005', 'ja-9999']);
    assert.strictEqual((await putTitle(e, title)).error.code, 'bad_settings', JSON.stringify(title));
  }
  for (const title of [{ pre: 'JA-0001', post: null }, { pre: 'ja-1', post: null }, { pre: 'ja-p-0001', post: null }, { pre: 1, post: null }, { pre: null, post: null, x: 1 }, 'ja-0001', []]) {
    assert.strictEqual(validateCardSettings(withTitle(title)), null, JSON.stringify(title));
  }
});

test('card_put: title が null・両方既定 (default)・省略なら設定なし (null)。記録は見ない', async () => {
  for (const title of [null, { pre: 'default', post: 'default' }, { post: 'default', pre: 'default' }, undefined]) {
    const e = titleEnv(null);
    e.store.getTitleOwned = async () => { throw new Error('must not read'); };
    const token = await loginToken(e);
    const st = { template: 'standard', color: 'red' };
    if (title !== undefined) st.title = title;
    const r = await post(e, { action: 'card_put', token, settings: st });
    assert.strictEqual(r.ok, true, JSON.stringify(title));
    assert.strictEqual(r.settings.title, null);
  }
});

test('card_put: 記録が読めない (D1 の失敗) は internal で保存しない', async () => {
  const e = titleEnv(null);
  e.store.getTitleOwned = async () => { throw new Error('D1 down'); };
  const r = await putTitle(e, { pre: 'ja-0001', post: null });
  assert.strictEqual(r.error.code, 'internal');
  assert.strictEqual(e.store.cards.size, 0);
});

test('card_put: 「なし」(null) と既定 (default) は記録を見ずに保存。「なし / なし」は空欄として残す (null にまとめない)', async () => {
  for (const title of [{ pre: null, post: null }, { pre: null, post: 'default' }, { pre: 'default', post: null }]) {
    const e = titleEnv(null);
    e.store.getTitleOwned = async () => { throw new Error('must not read'); };
    const token = await loginToken(e);
    const r = await post(e, { action: 'card_put', token, settings: { template: 'standard', color: 'red', title } });
    assert.strictEqual(r.ok, true, JSON.stringify(title));
    assert.deepStrictEqual(r.settings.title, title);
  }
  for (const title of [{ pre: 'Default', post: null }, { pre: 'none', post: null }, { pre: '', post: null }]) {
    assert.strictEqual(validateCardSettings(withTitle(title)), null, JSON.stringify(title));
  }
});

test('titleTextOf: 既定は null、「なし」は ""、設定なしは null', () => {
  assert.strictEqual(titleTextOf('ja', null), null);
  assert.deepStrictEqual(titleTextOf('ja', { pre: 'default', post: null }), { pre: null, post: '' });
});

const PLAYER_NO_STICKER = { status: 200, body: { user_id: 4242, characters: [], tournaments: [{ event_id: 1700000 }] } };
/** シールを持っている選手のデータ (ビルドの大会記録の sticker) */
const STICKER_PLAYER = { status: 200, body: { user_id: 4242, characters: [], tournaments: [
  { event_id: 1700000, sticker: 'rainbow' }, { event_id: null, parent_event_id: 1724470, class_letter: 'B', sticker: 'gold' },
  { event_id: 1800000, sticker: 'silver' }, { event_id: 1900000 } ] } };

test('card_put: 裏面のシール (back) を確かめて保存。形が違えば bad_settings、何も無ければ欄なし', async () => {
  const e = env({ player: STICKER_PLAYER });
  const token = await loginToken(e);
  let now = Date.parse('2026-10-20T00:00:00Z');
  e.nowMs = now;
  const back = { stickers: [{ e: '1724470B:g', x: 100.04, y: 50, s: 120, r: -10.26, k: 'circle', c: 0.6 }, { e: '1700000:r', x: 0, y: 333, s: 22, r: 180 }], text_top: true, outline: false };
  const put = await post(e, { action: 'card_put', token, settings: { ...GOOD, back } });
  assert.strictEqual(put.ok, true, JSON.stringify(put));
  assert.deepStrictEqual(put.settings.back, { stickers: [{ e: '1724470B:g', x: 100, y: 50, s: 120, r: -10.3, k: 'circle', c: 0.6 },
    { e: '1700000:r', x: 0, y: 333, s: 22, r: 180, k: 'square', c: 1 }], text_top: true, outline: true, sticker_text: false });
  assert.deepStrictEqual((await post(e, { action: 'card_get', uid: '4242' })).settings.back, put.settings.back);
  const bad = async (b) => (await post(e, { action: 'card_put', token, settings: { ...GOOD, back: b } })).error?.code;
  for (const b of [{ stickers: [{ e: 'sample1:r', x: 1, y: 1, s: 30, r: 0 }] }, { stickers: [{ e: '1:x', x: 1, y: 1, s: 30, r: 0 }] },
    { stickers: [{ e: '1:r', x: 600, y: 1, s: 30, r: 0 }] }, { stickers: [{ e: '1:r', x: 1, y: 1, s: 30, r: 0, k: 'star' }] },
    { stickers: [{ e: '1:r', x: 1, y: 1, s: 30, r: 0 }, { e: '1:r', x: 2, y: 2, s: 30, r: 0 }] }, { foo: 1 },
    { stickers: Array.from({ length: 51 }, (_, i) => ({ e: `${i + 1}:n`, x: 1, y: 1, s: 30, r: 0 })) }]) {
    assert.strictEqual(await bad(b), 'bad_settings', JSON.stringify(b).slice(0, 80));
  }
  e.nowMs = now += 60_000;   // 書き込み間隔
  const empty = await post(e, { action: 'card_put', token, settings: { ...GOOD, back: { stickers: [], text_top: false, outline: false } } });
  assert.strictEqual('back' in empty.settings, false);
});

test('card_put: preview (cardOpenEdit) だけ、ログインなしで uid を指定して書ける', async () => {
  const e = env();
  e.nowMs = Date.parse('2026-10-20T00:00:00Z');
  assert.strictEqual((await post(e, { action: 'card_put', uid: '777', settings: GOOD })).error.code, 'invalid_session', '本番は不可');
  e.cfg.cardOpenEdit = true;
  const put = await post(e, { action: 'card_put', uid: '777', settings: GOOD });
  assert.strictEqual(put.ok, true, JSON.stringify(put));
  assert.deepStrictEqual((await post(e, { action: 'card_get', uid: '777' })).settings, GOOD);  // 持っていない二つ名でも通す (preview の確認用)
  e.nowMs += 60_000;
  const t = await post(e, { action: 'card_put', uid: '777', settings: { ...GOOD, title: { pre: 'ja-0003', post: null } } });
  assert.strictEqual(t.ok, true, JSON.stringify(t));
});

test('card_put: シールは持っているものだけ (選手のデータの sticker = 一番上の色、下の色は全部持っている)', async () => {
  const e = env({ player: STICKER_PLAYER });
  const token = await loginToken(e);
  let now = Date.parse('2026-10-21T00:00:00Z');
  const put = async (/** @type {string[]} */ keys) => {
    e.nowMs = now += 60_000;
    return post(e, { action: 'card_put', token, settings: { ...GOOD, back: { stickers: keys.map((k, i) => ({ e: k, x: 10 + i, y: 10, s: 50, r: 0 })) } } });
  };
  assert.strictEqual((await put(['1700000:r', '1700000:n', '1724470B:g', '1724470B:s', '1800000:s'])).ok, true);
  for (const k of ['1724470B:r', '1800000:g', '1900000:n', '1724470:g', '1234567:n']) {
    const r = await put([k]);
    assert.strictEqual(r.error && r.error.code, 'sticker_not_owned', k);
  }
  // 選手のデータが読めないときは保存しない (シールが無ければ読まない)
  const e2 = env({ player: { status: 500, body: {} } });
  const t2 = await loginToken(e2);
  e2.nowMs = now;
  assert.strictEqual((await post(e2, { action: 'card_put', token: t2, settings: { ...GOOD, back: { stickers: [{ e: '1700000:r', x: 1, y: 1, s: 30, r: 0 }] } } })).error.code, 'internal');
  assert.strictEqual((await post(e2, { action: 'card_put', token: t2, settings: { ...GOOD, back: { stickers: [], text_top: true } } })).ok, true);
});

test('card_put: preview (stickersPreview) だけ、選手のデータにシールが無ければプレビュー用の判定で確かめる', async () => {
  const e = env({ player: PLAYER_NO_STICKER });
  const token = await loginToken(e);
  e.nowMs = Date.parse('2026-10-22T00:00:00Z');
  const put = (k) => post(e, { action: 'card_put', token, settings: { ...GOOD, back: { stickers: [{ e: k, x: 1, y: 1, s: 30, r: 0 }] } } });
  assert.strictEqual((await put('1700000:g')).error.code, 'sticker_not_owned', '本番はプレビュー用を見ない');
  e.cfg.stickersPreview = true;
  e.previewShard = { 4242: { 1700000: 'g', '1724470B': 'n' } };
  e.nowMs += 60_000;
  assert.strictEqual((await put('1700000:s')).ok, true);
  e.nowMs += 60_000;
  assert.strictEqual((await put('1700000:r')).error.code, 'sticker_not_owned');
});
