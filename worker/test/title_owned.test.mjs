// 持っている二つ名の記録: ビット列 (site/js/titles.js)・title_sync (鍵つき、OR だけ)・GET /api/titles。docs/card_titles_design.md
import './_titles_fixture.mjs';   // 二つ名の一覧はテスト用の 8 件 (ほかの import より先)
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http } from './_env.mjs';
import * as T from '../../site/js/titles.js';
import { TITLE_SYNC_MAX_ITEMS } from '../src/config.ts';

const KEY = 'title-sync-key-DO-NOT-LEAK';
const env = (o) => makeEnv(Object.assign({ cfg: { titleSyncKey: KEY } }, o || {}));
const r0date = (e) => new Date((e.nowMs ?? Date.now()) + 9 * 3600e3).toISOString().slice(0, 10);
const sync = (e, items, extra) => post(e, Object.assign({ action: 'title_sync', key: KEY, lang: 'ja', items }, extra || {}));

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

test('title_sync: 記録に OR する。消さない。増えた人だけ updated を変える', async () => {
  const e = env();
  e.nowMs = Date.parse('2026-10-02T03:00:00Z');   // JST 12:00
  let r = await sync(e, [{ uid: 4242, ids: ['ja-0001', 'ja-0005'] }, { uid: '7', ids: ['ja-0003'] }, { uid: 8, ids: [] }]);
  assert.deepStrictEqual(r, { ok: true, changed: 2, received: 3, items: [
    { uid: 4242, bits: T.bitsFromIds(['ja-0001', 'ja-0005']), updated: '2026-10-02' },
    { uid: 7, bits: T.bitsFromIds(['ja-0003']), updated: '2026-10-02' },
    { uid: 8, bits: '', updated: null },
  ] });
  assert.deepStrictEqual(await post(e, { action: 'title_get', uid: '4242', lang: 'ja' }),
    { ok: true, bits: T.bitsFromIds(['ja-0001', 'ja-0005']), updated: '2026-10-02' });
  assert.deepStrictEqual(await post(e, { action: 'title_get', uid: 8, lang: 'ja' }), { ok: true, bits: '', updated: null }, '何も持っていなければ行を作らない');
  // 翌日: 4242 は 1 つ減って届いても消さない (増えていないので updated もそのまま)。7 は増える
  e.nowMs += 24 * 3600e3;
  r = await sync(e, [{ uid: 4242, ids: ['ja-0001'] }, { uid: 7, ids: ['ja-0003', 'ja-0006'] }]);
  assert.strictEqual(r.changed, 1);
  // 応答は OR 後の記録 (減って届いた 4242 も記録どおり、日付も前のまま)
  assert.deepStrictEqual(r.items, [
    { uid: 4242, bits: T.bitsFromIds(['ja-0001', 'ja-0005']), updated: '2026-10-02' },
    { uid: 7, bits: T.bitsFromIds(['ja-0003', 'ja-0006']), updated: '2026-10-03' },
  ]);
  assert.deepStrictEqual(await post(e, { action: 'title_get', uid: 4242, lang: 'ja' }),
    { ok: true, bits: T.bitsFromIds(['ja-0001', 'ja-0005']), updated: '2026-10-02' });
  assert.deepStrictEqual(await post(e, { action: 'title_get', uid: 7, lang: 'ja' }),
    { ok: true, bits: T.bitsFromIds(['ja-0003', 'ja-0006']), updated: '2026-10-03' });
  // date を指定できる。同じ uid が 2 回来たら合わせる
  r = await sync(e, [{ uid: 4242, ids: ['ja-0002'] }, { uid: 4242, ids: ['ja-0004'] }], { date: '2026-09-30' });
  assert.strictEqual(r.changed, 1);
  const g = await post(e, { action: 'title_get', uid: 4242, lang: 'ja' });
  assert.deepStrictEqual(T.bitsNumbers(g.bits), [1, 2, 4, 5]);
  assert.strictEqual(g.updated, '2026-09-30');
  // 言語ごとに別
  assert.strictEqual((await sync(e, [{ uid: 4242, ids: ['en-0002'] }], { lang: 'en' })).changed, 1);
  assert.deepStrictEqual(T.bitsNumbers((await post(e, { action: 'title_get', uid: 4242, lang: 'en' })).bits), [2]);
  assert.deepStrictEqual(T.bitsNumbers((await post(e, { action: 'title_get', uid: 4242, lang: 'ja' })).bits), [1, 2, 4, 5]);
});

test('title_sync: 鍵が違えば auth_failed、鍵が未設定なら internal。どちらも書かない', async () => {
  const e = env();
  for (const key of [undefined, '', 'wrong', KEY + 'x']) {
    const r = await post(e, { action: 'title_sync', key, lang: 'ja', items: [{ uid: 1, ids: ['ja-0001'] }] });
    assert.strictEqual(r.error.code, 'auth_failed', String(key));
  }
  assert.strictEqual(e.store.titleOwned.size, 0);
  const noKey = makeEnv({});
  assert.strictEqual((await sync(noKey, [{ uid: 1, ids: ['ja-0001'] }])).error.code, 'internal');
  assert.ok(!JSON.stringify(e.store.errors).includes(KEY), '鍵は記録しない');
});

test('title_sync: 入力の誤りは bad_request で何も書かない (一覧に無い id・uid・人数・言語・日付)', async () => {
  const e = env();
  const bads = [
    [{ items: [{ uid: 1, ids: ['ja-0001'] }, { uid: 2, ids: ['ja-9999'] }] }, 'bad:id'],
    [{ items: [{ uid: 1, ids: ['en-0001'] }] }, 'bad:id'],
    [{ items: [{ uid: 'abc', ids: [] }] }, 'bad:uid'],
    [{ items: [{ uid: 1 }] }, 'bad:ids'],
    [{ items: 'x' }, 'bad:items'],
    [{ items: Array.from({ length: TITLE_SYNC_MAX_ITEMS + 1 }, (_, i) => ({ uid: i + 1, ids: [] })) }, 'bad:items'],
    [{ lang: 'fr', items: [] }, 'bad:lang'],
    [{ date: '2026/10/02', items: [] }, 'bad:date'],
  ];
  for (const [extra, note] of bads) {
    const r = await post(e, Object.assign({ action: 'title_sync', key: KEY, lang: 'ja' }, extra));
    assert.strictEqual(r.error.code, 'bad_request', note);
    assert.strictEqual(e.store.errors.at(-1).note, note);
  }
  assert.strictEqual(e.store.titleOwned.size, 0);
  assert.deepStrictEqual(await sync(e, Array.from({ length: TITLE_SYNC_MAX_ITEMS }, (_, i) => ({ uid: i + 1, ids: ['ja-0001'] }))),
    { ok: true, changed: TITLE_SYNC_MAX_ITEMS, received: TITLE_SYNC_MAX_ITEMS,
      items: Array.from({ length: TITLE_SYNC_MAX_ITEMS }, (_, i) => ({ uid: i + 1, bits: T.bitsFromIds(['ja-0001']), updated: r0date(e) })) }, 'ちょうど上限は可');
});

test('GET /api/titles?uid=&lang=: だれでも読める (public, max-age=60)。lang 省略は ja、不正は bad_request で no-store', async () => {
  const e = env();
  await sync(e, [{ uid: 4242, ids: ['ja-0003'] }], { date: '2026-10-01' });
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
  await sync(e, [5, 1, 9, 3, 7].map((uid) => ({ uid, ids: ['ja-000' + (uid % 8 || 1)] })), { date: '2026-10-01' });
  await sync(e, [{ uid: 2, ids: ['en-0002'] }], { lang: 'en', date: '2026-10-01' });
  const ex = (o) => post(e, Object.assign({ action: 'title_export', key: KEY, lang: 'ja' }, o || {}));
  let r = await ex({ limit: 2 });
  assert.deepStrictEqual(r.items.map((x) => x.uid), [1, 3]);
  assert.strictEqual(r.next_after, 3);
  assert.deepStrictEqual(r.items[0], { uid: 1, bits: T.bitsFromIds(['ja-0001']), updated: '2026-10-01' });
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
