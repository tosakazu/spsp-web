// tests/frontend/card_stickers.test.cjs — カードの裏面のシール (js/card_stickers.js): 設定の正規化 (サーバの worker/src/api/card.ts と同じ規則)、
// シールのキー、選手の大会記録から持っているシール (ビルドの sticker = もらった一番上の色、下の色は全部持っている)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
/** @type {any} */
let S = null;
async function load() {
  if (!S) S = await import(pathToFileURL(path.join(ROOT, 'site/js/card_stickers.js')).href);
  return S;
}

test('normBack: 形が違うシールは外し、範囲に丸め、何も無ければ null', async () => {
  const { normBack } = await load();
  assert.strictEqual(normBack(null), null);
  assert.strictEqual(normBack({ stickers: [] }), null);
  assert.deepStrictEqual(normBack({ stickers: [], text_top: true }), { stickers: [], text_top: true, outline: false, sticker_text: false });
  assert.deepStrictEqual(normBack({ sticker_text: true }), { stickers: [], text_top: false, outline: false, sticker_text: true });
  const b = normBack({ stickers: [
    { e: '1700000:r', x: 600, y: -5, s: 9999, r: 190.04, k: 'star', c: 0.1 },   // 範囲外 → 丸め、知らない形 → 四角
    { e: '1724470B:g', x: 10.04, y: 20, s: 50, r: -45, k: 'circle', c: 0.555 },
    { e: '1700000:r', x: 1, y: 1, s: 30, r: 0 },                               // 同じキーは 1 枚だけ
    { e: 'sample1', x: 1, y: 1, s: 30, r: 0 },                                  // キーの形が違う
    { e: '1:x', x: 1, y: 1, s: 30, r: 0 },
    { e: '1:r', x: 'a', y: 1, s: 30, r: 0 },                                    // 数でない
  ] });
  assert.deepStrictEqual(b.stickers, [
    { e: '1700000:r', x: 514, y: 0, s: 520, r: -170, k: 'square', c: 0.35 },
    { e: '1724470B:g', x: 10, y: 20, s: 50, r: -45, k: 'circle', c: 0.56 },
  ]);
  // 50 枚まで
  const many = normBack({ stickers: Array.from({ length: 60 }, (_, i) => ({ e: `${i + 1}:n`, x: 1, y: 1, s: 30, r: 0 })) });
  assert.strictEqual(many.stickers.length, 50);
});

test('parseKey / tourKey: 大会キーは event_id、下位クラスは親の event_id + クラスの文字', async () => {
  const { parseKey, tourKey } = await load();
  assert.deepStrictEqual(parseKey('1700000:r'), { eid: 1700000, cls: null, variant: 0 });
  assert.deepStrictEqual(parseKey('1724470B:n'), { eid: 1724470, cls: 'B', variant: 3 });
  assert.strictEqual(parseKey('x:r'), null);
  assert.strictEqual(tourKey({ event_id: 5 }), '5');
  assert.strictEqual(tourKey({ event_id: null, parent_event_id: 9, class_letter: 'C' }), '9C');
  assert.strictEqual(tourKey({}), '');
});

test('ownedStickers / isOwned: 一番上の色から下は全部持っている', async () => {
  const { ownedStickers, isOwned } = await load();
  const owned = ownedStickers([
    { event_id: 1, sticker: 'gold' },
    { event_id: null, parent_event_id: 2, class_letter: 'B', sticker: 'rainbow' },
    { event_id: 3, sticker: 'normal' },
    { event_id: 4 },                         // 配っていない大会
    { event_id: 1, sticker: 'silver' },      // 同じ大会が 2 行あっても上の色
  ]);
  assert.deepStrictEqual(owned, { 1: 'g', '2B': 'r', 3: 'n' });
  assert.strictEqual(isOwned(owned, '1:g'), true);
  assert.strictEqual(isOwned(owned, '1:n'), true);
  assert.strictEqual(isOwned(owned, '1:r'), false);
  assert.strictEqual(isOwned(owned, '2B:r'), true);
  assert.strictEqual(isOwned(owned, '2:r'), false);     // 本戦のシールは持っていない
  assert.strictEqual(isOwned(owned, '3:s'), false);
  assert.strictEqual(isOwned(owned, '4:n'), false);
});

test('loadOwnedStickers: 大会記録に判定があればそれ、無ければプレビュー用の判定 (サイトの data/stickers_preview/)', async () => {
  const { loadOwnedStickers, hasStickerData } = await load();
  /** @type {string[]} */
  const asked = [];
  globalThis.SPSP = { root: '/jp/' };
  globalThis.fetch = async (/** @type {string} */ u) => { asked.push(String(u)); return { ok: true, json: async () => ({ 130: { 5: 'g' } }) }; };
  assert.strictEqual(hasStickerData([{ event_id: 1 }]), false);
  assert.deepStrictEqual(await loadOwnedStickers(130, [{ event_id: 1, sticker: 'silver' }]), { 1: 's' });
  assert.deepStrictEqual(asked, []);
  assert.deepStrictEqual(await loadOwnedStickers(130, [{ event_id: 1 }]), { 5: 'g' });
  assert.deepStrictEqual(asked, ['/jp/data/stickers_preview/2.json']);   // 130 % 64
  globalThis.fetch = async () => ({ ok: false, json: async () => null });
  assert.deepStrictEqual(await loadOwnedStickers(1, []), {});
});
