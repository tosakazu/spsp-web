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

test('normBack: 形が違うシールは外し、範囲に丸め、設定が無ければ null (空の設定は残す)', async () => {
  const { normBack } = await load();
  assert.strictEqual(normBack(null), null);
  assert.deepStrictEqual(normBack({ stickers: [] }), { stickers: [], text_top: false, outline: false, sticker_text: false });   // 全部剥がした
  assert.deepStrictEqual(normBack({ stickers: [], text_top: true }), { stickers: [], text_top: true, outline: true, sticker_text: false });
  assert.strictEqual(normBack({ text_top: true, sticker_text: true }).outline, false);   // 白フチなら影なし
  assert.strictEqual(normBack({ text_top: false, outline: true }).outline, false);   // 前の設定の outline は見ない
  // 名前・二つ名・順位の位置: 真ん中 (0, 0) は書かない、幅の外は端に、小数 1 桁
  assert.strictEqual(normBack({ text_xy: { x: 0, y: 0 } }).text_xy, undefined);
  assert.deepStrictEqual(normBack({ text_xy: { x: 12.34, y: -999 } }).text_xy, { x: 12.3, y: -167 });
  assert.strictEqual(normBack({ text_top: true, text_xy: { x: 'a', y: 1 } }).text_xy, undefined);
  // 回転・大きさ: 既定 (0°・1 倍) は書かない、幅の外は端に
  assert.deepStrictEqual(normBack({ text_r: 0, text_s: 1 }), { stickers: [], text_top: false, outline: false, sticker_text: false });
  assert.deepStrictEqual(normBack({ text_r: 370.04, text_s: 9 }), { stickers: [], text_top: false, outline: false, sticker_text: false, text_r: 10, text_s: 2 });
  assert.deepStrictEqual(normBack({ sticker_text: true }), { stickers: [], text_top: false, outline: false, sticker_text: true });
  // 部品ごとのずれ: 白フチのときだけ、既定の値・部品・知らない部品は書かない、幅の外は端に
  assert.deepStrictEqual(normBack({ sticker_text: true, text_parts: { name: { x: 10.04, y: 0, r: 0, s: 1 }, rank: { s: 9 }, title: { x: 0 }, foo: { x: 1 } } }).text_parts,
    { name: { x: 10 }, rank: { s: 2 } });
  assert.strictEqual(normBack({ sticker_text: true, text_parts: { name: { x: 0 } } }).text_parts, undefined);
  assert.strictEqual(normBack({ text_top: true, text_parts: { name: { x: 5 } } }).text_parts, undefined);   // 普通の文字なら捨てる
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

test('loadOwnedStickers: 大会記録に判定があればそれ、無ければ (preview だけ) プレビュー用の判定 (サイトの data/stickers_preview/)', async () => {
  const { loadOwnedStickers, hasStickerData } = await load();
  /** @type {string[]} */
  const asked = [];
  globalThis.SPSP = { root: '/jp/' };
  globalThis.fetch = async (/** @type {string} */ u) => { asked.push(String(u)); return { ok: true, json: async () => ({ 130: { 5: 'g' } }) }; };
  assert.strictEqual(hasStickerData([{ event_id: 1 }]), false);
  assert.deepStrictEqual(await loadOwnedStickers(130, [{ event_id: 1, sticker: 'silver' }]), { 1: 's' });
  assert.deepStrictEqual(asked, []);
  // プレビュー用の判定を読むのは preview の Worker だけ (本番では取りに行かない)
  globalThis.location = /** @type {any} */ ({ hostname: 'spsp.games' });
  assert.deepStrictEqual(await loadOwnedStickers(130, [{ event_id: 1 }]), {});
  assert.deepStrictEqual(asked, []);
  globalThis.location = /** @type {any} */ ({ hostname: 'spsp-web-preview.example.workers.dev' });
  assert.deepStrictEqual(await loadOwnedStickers(130, [{ event_id: 1 }]), { 5: 'g' });
  assert.deepStrictEqual(asked, ['/jp/data/stickers_preview/2.json']);   // 130 % 64
  globalThis.fetch = async () => ({ ok: false, json: async () => null });
  assert.deepStrictEqual(await loadOwnedStickers(1, []), {});
});

test('defaultBack: 順位評価の高い順に 20 大会・高いものが上・名前シールを上に。同じ選手なら何度作っても同じで、シールが増えても前からのシールは動かない', async () => {
  const { defaultBack, defaultSticker, DEFAULT_BACK_N } = await load();
  const tours = Array.from({ length: 30 }, (_, i) => ({ event_id: 1000 + i, tjpr_raw: i, sticker: 'gold' }));
  tours.push({ event_id: 5000, tjpr_raw: 999, sticker: 'rainbow' });   // アイコンが無い大会は出さない
  tours.push({ parent_event_id: 1029, class_letter: 'B', tjpr_raw: 500, sticker: 'silver' });
  const owned = Object.fromEntries(tours.map(t => [t.event_id ? String(t.event_id) : `${t.parent_event_id}${t.class_letter}`, { gold: 'g', rainbow: 'r', silver: 's' }[t.sticker]]));
  const tbl = { f: ['a.png'], e: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(1000 + i), 0])) };
  const a = defaultBack(77, tours, owned, tbl);
  assert.strictEqual(a.stickers.length, DEFAULT_BACK_N);
  assert.strictEqual(a.text_top, true); assert.strictEqual(a.sticker_text, true); assert.strictEqual(a.outline, false);
  assert.strictEqual(a.stickers[a.stickers.length - 1].e, '1029B:s', 'いちばん高いものがいちばん上 (配列の最後)');
  assert.strictEqual(a.stickers[a.stickers.length - 2].e, '1029:g');
  assert.ok(!a.stickers.some(s => s.e.startsWith('5000')));
  assert.deepStrictEqual(defaultBack(77, tours.slice().reverse(), owned, tbl), a, '大会記録の並びが変わっても同じ');
  assert.deepStrictEqual(defaultBack('77', tours, owned, tbl), a);
  assert.notDeepStrictEqual(defaultBack(78, tours, owned, tbl).stickers[0], a.stickers[0], '選手が違えば置き方も違う');
  // シールが増えても、残っているシールの置き方は同じ
  const more = [...tours, { event_id: 1005, tjpr_raw: 0 }, { event_id: 2000, tjpr_raw: 700, sticker: 'gold' }];
  const b = defaultBack(77, more, { ...owned, 2000: 'g' }, { f: tbl.f, e: { ...tbl.e, 2000: 0 } });
  for (const s of b.stickers) { const old = a.stickers.find(x => x.e === s.e); if (old) assert.deepStrictEqual(s, old); }
  assert.deepStrictEqual(defaultSticker(77, '1029:g'), a.stickers.find(s => s.e === '1029:g'));
  for (const s of a.stickers) assert.ok(['square', 'round'].includes(s.k) && s.x >= 0 && s.x <= 514 && s.y >= 0 && s.y <= 333);
  assert.strictEqual(defaultBack(77, tours, {}, tbl), null);
  assert.strictEqual(defaultBack(77, tours, owned, null), null);
});
