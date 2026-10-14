// 本物の二つ名の一覧 (site/js/titles_ja.js) で title_sync を通す: 大会に多く出た人 500 人分が 1 回の上限 (人数・body) に収まり、
// 一覧の最後の番号まで記録・表示できること。_titles_fixture.mjs (8 件の一覧) は読まない
import test from 'node:test';
import assert from 'node:assert';
import { makeEnv, post, http } from './_env.mjs';
import * as T from '../../site/js/titles.js';
import * as B from '../../site/js/title_bits.js';
import { TITLE_BITS_MAX_BYTES, TITLE_SYNC_MAX_ITEMS } from '../src/config.ts';
import { TITLE_SYNC_MAX_BODY_BYTES } from '../src/api/router.ts';

const KEY = 'title-sync-key-DO-NOT-LEAK';

/** 公開日から毎日 1 大会 (本戦 5 試合) を n 回 */
const tours = (n) => Array.from({ length: n }, (_, i) => ({ event_id: 1 + i, date: new Date(Date.parse(T.TITLE_LAUNCH) + i * 864e5).toISOString().slice(0, 10), wins: 3, losses: 2 }));

test('本物の一覧: 全部引き切った人のビット列も上限に収まり、500 人分 (今と前) が 1 回の body に収まる', async () => {
  const list = T.TITLES.ja;
  const maxNo = Math.max(...list.map((t) => B.titleNumber(t.id)));
  assert.ok((maxNo >> 3) + 1 <= TITLE_BITS_MAX_BYTES, '一覧の最後の番号がビット列の上限に入る');
  // 3 年分 (毎日 1 大会) 出た人: 抽選の二つ名を全部持つ
  const heavy = T.advanceTitles('ja', 1, null, T.drawTargets(tours(1100)), { chars: [1293], pref: '神奈川県' }, '2029-12-31');
  const random = list.filter((t) => t.unlock === 'random').length;
  assert.ok(B.bitsCount(heavy.bits) >= random, `全部引き切る (${B.bitsCount(heavy.bits)} / ${random})`);
  const half = T.advanceTitles('ja', 1, null, { pre: heavy.n_pre >> 1, post: heavy.n_post >> 1 }, { chars: [1293], pref: '神奈川県' }, '2029-12-31');
  const items = Array.from({ length: TITLE_SYNC_MAX_ITEMS }, (_, i) => ({ uid: 100000 + i, prev: half, ...heavy }));
  const body = JSON.stringify({ action: 'title_sync', key: KEY, lang: 'ja', items });
  assert.ok(body.length < TITLE_SYNC_MAX_BODY_BYTES * 0.75, `body ${body.length} bytes`);
});

test('本物の一覧: 同期 → 記録 → 一覧の文字に戻せる (最後の番号まで)', async () => {
  const e = makeEnv({ cfg: { titleSyncKey: KEY } });
  const st = T.advanceTitles('ja', 4242, null, T.drawTargets(tours(30)), { chars: [1293] }, '2026-12-31');
  const t0 = Date.now();
  const r = await http(e, 'POST', '/api/title_sync', { action: 'title_sync', key: KEY, lang: 'ja',
    items: Array.from({ length: TITLE_SYNC_MAX_ITEMS }, (_, i) => ({ uid: 4242 + i, prev: null, ...st })) });
  assert.strictEqual(r.json.ok, true, JSON.stringify(r.json).slice(0, 200));
  assert.strictEqual(r.json.changed, TITLE_SYNC_MAX_ITEMS);
  assert.ok(Date.now() - t0 < 5000, '500 人の確かめが重すぎない');
  const got = await post(e, { action: 'title_get', uid: 4242, lang: 'ja' });
  assert.strictEqual(got.bits, st.bits);
  const titles = T.bitsTitles('ja', got.bits);
  assert.strictEqual(titles.length, B.bitsCount(st.bits), '全部一覧にある');
  assert.ok(titles.some((t) => t.unlock === 'char'), 'キャラの二つ名も入る');
  const last = T.TITLES.ja.reduce((a, b) => (B.titleNumber(a.id) > B.titleNumber(b.id) ? a : b));
  const withLast = B.bitsOr(st.bits, B.bitsFromIds([last.id]));
  assert.ok(T.bitsTitles('ja', withLast).some((t) => t.id === last.id));
});
