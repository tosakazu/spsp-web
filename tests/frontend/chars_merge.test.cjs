'use strict';
// js/chars.js mergeCharUses: プレイヤーページの使用キャラを使い手ランキングと同じ 4 組でまとめる (2026-09-30)。
// まとめないと「サムス / ダークサムス · ダークサムス」の重複や、ダークサムスがメインの人だけまとめた名前にならないずれが出ていた。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

const DICT = { 'char.1328': 'サムス / ダークサムス', 'char.1408': 'ダークサムス', 'char.1320': 'ピット / ブラックピット', 'char.1278': 'ブラックピット' };
function load() {
  const w = { SPSPI18n: { has: (k) => k in DICT, t: (k) => DICT[k] } };
  w.window = w; w.globalThis = w;
  vm.runInNewContext(built('js/chars.js'), w);
  return w.SPSPChars;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('同じ組は 1 つにまとめ、pct を足し、代表 id とまとめた名前にする', () => {
  const C = load();
  const out = C.mergeCharUses([{ id: 1328, name: 'サムス', pct: 0.6774 }, { id: 1408, name: 'ダークサムス', pct: 0.3226 }]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(plain(out[0]), { id: 1328, name: 'サムス / ダークサムス', pct: 0.6774 + 0.3226, ids: [1328, 1408] });
  assert.strictEqual(C.charName(out[0].id, out[0].name), 'サムス / ダークサムス', '表示名は charName(代表 id)');
});

test('派生側がメインでも代表 id になり、メインのまま先頭', () => {
  const C = load();
  const out = C.mergeCharUses([{ id: 1408, name: 'ダークサムス', pct: 0.5 }, { id: 1453, name: 'ジョーカー', pct: 0.3 }, { id: 1328, name: 'サムス', pct: 0.2 }]);
  assert.deepStrictEqual(plain(out.map((c) => c.id)), [1328, 1453]);
  assert.strictEqual(out[0].name, 'サムス / ダークサムス');
  assert.ok(Math.abs(out[0].pct - 0.7) < 1e-12);
});

test('先頭 (メイン、投票で決まることがある) は合計が小さくても先頭。残りは合計 pct の高い順', () => {
  const C = load();
  const out = C.mergeCharUses([{ id: 1453, name: 'ジョーカー', pct: 0.3 }, { id: 1293, name: 'フォックス', pct: 0.3 }, { id: 1320, name: 'ピット', pct: 0.25 }, { id: 1278, name: 'ブラックピット', pct: 0.15 }]);
  assert.deepStrictEqual(plain(out.map((c) => c.id)), [1453, 1320, 1293]);
});

test('組に入らないキャラ・本人申告 (pct 無し) はそのまま。空は空', () => {
  const C = load();
  const src = [{ id: 1453, name: 'ジョーカー', pct: 0.5 }, { id: 1293, name: 'フォックス' }, { id: 1302, name: 'マリオ', pct: 0.1 }];
  assert.deepStrictEqual(plain(C.mergeCharUses(src).map((c) => c.id)), [1453, 1302, 1293]);
  assert.strictEqual(C.mergeCharUses(src)[0].name, 'ジョーカー');
  assert.deepStrictEqual(plain(C.mergeCharUses([])), []);
  assert.deepStrictEqual(plain(C.mergeCharUses(undefined)), []);
});
