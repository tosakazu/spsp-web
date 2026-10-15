// 持っている二つ名の記録: ビット列 (site/js/title_bits.js)・title_sync (鍵つき、読んだときのままの行だけ書く・増えるだけ)・GET /api/titles。docs/card_titles_design.md
import './_titles_fixture.mjs';   // 二つ名の一覧はテスト用の 8 件 (ほかの import より先)
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http } from './_env.mjs';
import * as T0 from '../../site/js/titles.js';
import * as B from '../../site/js/title_bits.js';
const T = { ...B, ...T0 };
import { TITLE_SYNC_MAX_ITEMS } from '../src/config.ts';

const KEY = 'title-sync-key-DO-NOT-LEAK';
const env = (o) => makeEnv(Object.assign({ cfg: { titleSyncKey: KEY } }, o || {}));
const r0date = (e) => new Date((e.nowMs ?? Date.now()) + 9 * 3600e3).toISOString().slice(0, 10);
const sync = (e, items, extra) => post(e, Object.assign({ action: 'title_sync', key: KEY, lang: 'ja', items }, extra || {}));
/** 1 人分 (ids → ビット列、prev は前の記録) */
const it = (uid, ids, n = [0, 0], prev = null) => ({ uid, prev, bits: T.bitsFromIds(ids), n_pre: n[0], n_post: n[1] });
const pv = (ids, n = [0, 0]) => ({ bits: T.bitsFromIds(ids), n_pre: n[0], n_post: n[1] });

test('ビット列: id の通し番号が位置。作る・ある・OR・番号の一覧', () => {
  assert.strictEqual(T.titleNumber('ja-0001'), 1);
  assert.strictEqual(T.titleNumber('ja-0123'), 123);
  assert.strictEqual(T.titleNumber('ja-p-0001'), null);
  assert.strictEqual(T.bitsFromIds([]), '');
  const b = T.bitsFromIds(['ja-0001', 'ja-0005', 'ja-0123']);
  assert.match(b, /^[A-Za-z0-9_-]+$/, 'base64url (= なし)');
  assert.deepStrictEqual(T.bitsNumbers(b), [1, 5, 123]);
  assert.strictEqual(T.bitsHas(b, 'ja-0005'), true);
  assert.strictEqual(T.bitsHas(b, 'ja-0002'), false);
  assert.strictEqual(T.bitsHas(b, 'ja-0999'), false, 'ビット列より先');
  assert.strictEqual(T.bitsHas('', 'ja-0001'), false);
  assert.strictEqual(T.bitsHas(b, 'bad'), false);
  assert.deepStrictEqual(T.bitsNumbers(T.bitsOr(b, T.bitsFromIds(['ja-0002', 'ja-0005']))), [1, 2, 5, 123]);
  assert.strictEqual(T.bitsOr('', ''), '');
  assert.strictEqual(T.bitsOr(b, ''), b);
  assert.strictEqual(T.bitsFromIds(['ja-0005', 'ja-0001']), T.bitsFromIds(['ja-0001', 'ja-0005']), '並びに依らない');
  assert.strictEqual(T.bitsFromIds(['ja-0001']), 'Ag', '1 番 = 1 バイト目の下から 2 ビット目 (0x02)');
  assert.deepStrictEqual(T.bitsTitles('ja', T.bitsFromIds(['ja-0001', 'ja-0999'])).map((t) => t.id), ['ja-0001']);
});

test('title_sync: 行が無ければ作る・あれば読んだときのまま (prev) のときだけ書く。updated はビットが増えたときだけ', async () => {
  const e = env();
  e.nowMs = Date.parse('2026-10-02T03:00:00Z');   // JST 12:00
  let r = await sync(e, [it(4242, ['ja-0001', 'ja-0005']), it('7', ['ja-0003'], [3, 1])]);
  assert.deepStrictEqual(r, { ok: true, changed: 2, received: 2, conflicts: [] });
  assert.deepStrictEqual(await post(e, { action: 'title_get', uid: '4242', lang: 'ja' }),
    { ok: true, bits: T.bitsFromIds(['ja-0001', 'ja-0005']), updated: '2026-10-02' });
  assert.deepStrictEqual(await post(e, { action: 'title_get', uid: 8, lang: 'ja' }), { ok: true, bits: '', updated: null }, '記録が無い');
  // 翌日: 7 は増える。4242 は prev が違う (ほかの同期が先に書いた) ので書かない。9 は「無ければ作る」なのに作れない、は起きない (無いので作る)
  e.nowMs += 24 * 3600e3;
  r = await sync(e, [
    it(7, ['ja-0003', 'ja-0006'], [6, 1], pv(['ja-0003'], [3, 1])),
    it(4242, ['ja-0001', 'ja-0005', 'ja-0002'], [3, 0], pv(['ja-0001'])),
    it(9, ['ja-0002']),
  ]);
  assert.deepStrictEqual(r, { ok: true, changed: 2, received: 3, conflicts: [4242] });
  assert.deepStrictEqual(await post(e, { action: 'title_get', uid: 7, lang: 'ja' }),
    { ok: true, bits: T.bitsFromIds(['ja-0003', 'ja-0006']), updated: '2026-10-03' });
  assert.deepStrictEqual(T.bitsNumbers((await post(e, { action: 'title_get', uid: 4242, lang: 'ja' })).bits), [1, 5], '書いていない');
  // 「無ければ作る」でもう行がある → 書かない
  r = await sync(e, [it(9, ['ja-0002', 'ja-0004'])]);
  assert.deepStrictEqual(r.conflicts, [9]);
  // 回数だけ増えた (ビットは同じ) → updated はそのまま
  e.nowMs += 24 * 3600e3;
  r = await sync(e, [it(7, ['ja-0003', 'ja-0006'], [9, 1], pv(['ja-0003', 'ja-0006'], [6, 1]))]);
  assert.strictEqual(r.changed, 1);
  assert.strictEqual((await post(e, { action: 'title_get', uid: 7, lang: 'ja' })).updated, '2026-10-03');
  assert.deepStrictEqual((await post(e, { action: 'title_export', key: KEY, lang: 'ja' })).items.find((x) => x.uid === 7),
    { uid: 7, bits: T.bitsFromIds(['ja-0003', 'ja-0006']), updated: '2026-10-03', n_pre: 9, n_post: 1 });
  // date を指定できる。言語ごとに別
  r = await sync(e, [it(7, ['ja-0003', 'ja-0006', 'ja-0008'], [9, 1], pv(['ja-0003', 'ja-0006'], [9, 1]))], { date: '2026-09-30' });
  assert.strictEqual((await post(e, { action: 'title_get', uid: 7, lang: 'ja' })).updated, '2026-09-30');
  assert.strictEqual((await sync(e, [it(4242, ['en-0002'])], { lang: 'en' })).changed, 1);
  assert.deepStrictEqual(T.bitsNumbers((await post(e, { action: 'title_get', uid: 4242, lang: 'en' })).bits), [2]);
});

test('title_sync: 一覧に無い番号も受ける (Worker の一覧が同期の道具より古いとき)。表示 (card_get) と card_put は一覧にあるものだけ', async () => {
  const e = env();
  const r = await sync(e, [it(5, ['ja-0002', 'ja-0999', 'ja-7000'])]);
  assert.strictEqual(r.changed, 1);
  assert.deepStrictEqual(T.bitsNumbers((await post(e, { action: 'title_get', uid: 5, lang: 'ja' })).bits), [2, 999, 7000]);
  assert.deepStrictEqual(T.bitsTitles('ja', (await post(e, { action: 'title_get', uid: 5, lang: 'ja' })).bits).map((x) => x.id), ['ja-0002']);
});

test('title_sync: 鍵が違えば auth_failed、鍵が未設定なら internal。どちらも書かない', async () => {
  const e = env();
  for (const key of [undefined, '', 'wrong', KEY + 'x']) {
    const r = await post(e, { action: 'title_sync', key, lang: 'ja', items: [it(1, ['ja-0001'])] });
    assert.strictEqual(r.error.code, 'auth_failed', String(key));
  }
  assert.strictEqual(e.store.titleOwned.size, 0);
  const noKey = makeEnv({});
  assert.strictEqual((await sync(noKey, [it(1, ['ja-0001'])])).error.code, 'internal');
  assert.ok(!JSON.stringify(e.store.errors).includes(KEY), '鍵は記録しない');
});

test('title_sync: 入力の誤りは bad_request で何も書かない (消す送り方・回数を戻す・形・uid の重複・人数・言語・日付)', async () => {
  const e = env();
  const bads = [
    [{ items: [it(1, ['ja-0001']), it(2, ['ja-0002'], [0, 0], pv(['ja-0002', 'ja-0003']))] }, 'bad:shrink'],
    [{ items: [it(2, ['ja-0002'], [2, 0], pv(['ja-0002'], [3, 0]))] }, 'bad:shrink'],
    [{ items: [{ ...it(1, []), bits: 'a+b' }] }, 'bad:bits'],
    [{ items: [{ ...it(1, []), bits: 'AgA' }] }, 'bad:bits'],                       // 末尾の 0 を落としていない
    [{ items: [{ ...it(1, []), bits: 'A'.repeat(8000) }] }, 'bad:bits'],            // 長すぎる
    [{ items: [{ ...it(1, []), n_pre: -1 }] }, 'bad:n'],
    [{ items: [{ ...it(1, []), n_post: 1.5 }] }, 'bad:n'],
    [{ items: [{ ...it(1, []), prev: { bits: 'Ag' } }] }, 'bad:prev'],
    [{ items: [{ ...it(1, []), prev: undefined }] }, 'bad:prev'],
    [{ items: [it(1, []), it('1', [])] }, 'bad:uid'],
    [{ items: [it('abc', [])] }, 'bad:uid'],
    [{ items: 'x' }, 'bad:items'],
    [{ items: Array.from({ length: TITLE_SYNC_MAX_ITEMS + 1 }, (_, i) => it(i + 1, [])) }, 'bad:items'],
    [{ lang: 'fr', items: [] }, 'bad:lang'],
    [{ date: '2026/10/02', items: [] }, 'bad:date'],
  ];
  for (const [extra, note] of bads) {
    const r = await post(e, Object.assign({ action: 'title_sync', key: KEY, lang: 'ja' }, extra));
    assert.strictEqual(r.error && r.error.code, 'bad_request', note + ' ' + JSON.stringify(r).slice(0, 200));
    assert.strictEqual(e.store.errors.at(-1).note, note);
  }
  assert.strictEqual(e.store.titleOwned.size, 0);
  assert.deepStrictEqual(await sync(e, Array.from({ length: TITLE_SYNC_MAX_ITEMS }, (_, i) => it(i + 1, ['ja-0001']))),
    { ok: true, changed: TITLE_SYNC_MAX_ITEMS, received: TITLE_SYNC_MAX_ITEMS, conflicts: [] }, 'ちょうど上限は可');
  assert.strictEqual(r0date(e).length, 10);
});

test('GET /api/titles?uid=&lang=: だれでも読める (public, max-age=60)。lang 省略は ja、不正は bad_request で no-store', async () => {
  const e = env();
  await sync(e, [it(4242, ['ja-0003'])], { date: '2026-10-01' });
  const r = await http(e, 'GET', '/api/titles?uid=4242&lang=ja');
  assert.strictEqual(r.headers.get('Cache-Control'), 'public, max-age=60');
  assert.deepStrictEqual(r.json, { ok: true, bits: T.bitsFromIds(['ja-0003']), updated: '2026-10-01' });
  assert.deepStrictEqual((await http(e, 'GET', '/api/titles?uid=4242')).json.bits, T.bitsFromIds(['ja-0003']));
  assert.deepStrictEqual((await http(e, 'GET', '/api/titles?uid=1&lang=ja')).json, { ok: true, bits: '', updated: null });
  for (const q of ['', '?uid=abc', '?uid=1&lang=fr', '?uid=0']) {
    const b = await http(e, 'GET', '/api/titles' + q);
    assert.strictEqual(b.json.error.code, 'bad_request', q);
    assert.strictEqual(b.headers.get('Cache-Control'), 'no-store', q);
  }
});

test('title_export: 鍵つき。uid の昇順にページ送り (next_after)、言語ごと', async () => {
  const e = env();
  await sync(e, [5, 1, 9, 3, 7].map((uid) => it(uid, ['ja-000' + (uid % 8 || 1)])), { date: '2026-10-01' });
  await sync(e, [it(2, ['en-0002'])], { lang: 'en', date: '2026-10-01' });
  const ex = (o) => post(e, Object.assign({ action: 'title_export', key: KEY, lang: 'ja' }, o || {}));
  let r = await ex({ limit: 2 });
  assert.deepStrictEqual(r.items.map((x) => x.uid), [1, 3]);
  assert.strictEqual(r.next_after, 3);
  assert.deepStrictEqual(r.items[0], { uid: 1, bits: T.bitsFromIds(['ja-0001']), updated: '2026-10-01', n_pre: 0, n_post: 0 });
  r = await ex({ limit: 2, after_uid: 3 });
  assert.deepStrictEqual(r.items.map((x) => x.uid), [5, 7]);
  r = await ex({ limit: 2, after_uid: r.next_after });
  assert.deepStrictEqual(r.items.map((x) => x.uid), [9]);
  assert.strictEqual(r.next_after, null);
  assert.deepStrictEqual((await ex()).items.map((x) => x.uid), [1, 3, 5, 7, 9]);
  assert.deepStrictEqual((await ex({ lang: 'en' })).items.map((x) => x.uid), [2]);
  assert.strictEqual((await ex({ key: 'wrong' })).error.code, 'auth_failed');
  for (const o of [{ limit: 0 }, { limit: 2001 }, { limit: 1.5 }, { after_uid: 'x' }, { lang: 'fr' }]) {
    assert.strictEqual((await ex(o)).error.code, 'bad_request', JSON.stringify(o));
  }
  assert.strictEqual((await post(makeEnv({}), { action: 'title_export', key: '', lang: 'ja' })).error.code, 'internal');
});

test('title_sync の大きな body: POST /api/title_sync だけ 2 MB まで (action も title_sync のときだけ)。/api は 64 KB のまま', async () => {
  const e = env();
  // 300 人 × 番号 1000 まで (125 バイト) で body を 64 KB より大きくする
  const items = Array.from({ length: 300 }, (_, i) => ({ uid: 100000 + i, prev: null, bits: T.bitsFromNumbers(Array.from({ length: 1000 }, (_, k) => k + 1)), n_pre: 0, n_post: 0 }));
  const body = { action: 'title_sync', key: KEY, lang: 'ja', items };
  assert.ok(JSON.stringify(body).length > 64 * 1024);
  const big = await http(e, 'POST', '/api/title_sync', body);
  assert.strictEqual(big.json.ok, true, JSON.stringify(big.json));
  assert.strictEqual(big.json.received, 300);
  // /api には大きすぎる
  const viaRoot = await http(e, 'POST', '/api', body);
  assert.strictEqual(viaRoot.json.error.code, 'bad_request');
  // パスが title_sync でも、ほかの action の大きな body は断る
  const other = await http(e, 'POST', '/api/title_sync', Object.assign({}, body, { action: 'post' }));
  assert.strictEqual(other.json.error.code, 'bad_request');
  assert.strictEqual(other.json.error.message, 'リクエストの形式が不正です。');
});
