'use strict';
// 使い手ランキング (site/c/ranking.html) の使用率列が、投票由来のメインキャラ
// (= pct を持たない) で壊れないことのテスト。
// ビルド側の採用規則は spsp/char_vote.py、設計は docs/post_feature_design.md §12。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = require('../helpers/pages.cjs').pageWithScript('c/ranking.html');   // HTML + src/pages/c_ranking.js

// _mainPct の定義から CHAR_EXTRA_COLUMNS の閉じ括弧までを切り出して評価する。
const block = SRC.match(/const _mainPct[\s\S]*?\n\];\n/);
assert.ok(block, 'ranking.html から CHAR_EXTRA_COLUMNS を切り出せない');
// 文言は辞書 (site/i18n/ja.js + js/i18n.js) から引くので、同じものを読んだ i18n() を渡す
const SITE = path.resolve(__dirname, '../../site');
const ctx = { SPSP: { site: { langs: ['ja'], defaultLang: 'ja' } }, SPSP_I18N: {}, console, URL, Intl,
  localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'ja' }, location: { href: 'https://spsp.games/c/ranking.html' } };
ctx.window = ctx;
vm.runInNewContext(fs.readFileSync(path.join(SITE, 'i18n/ja.js'), 'utf8'), ctx);
vm.runInNewContext(require('../helpers/built.cjs').built('js/i18n.js'), ctx);
const COLS = vm.runInNewContext(block[0] + '\nCHAR_EXTRA_COLUMNS', { i18n: ctx.SPSPI18n.t });
const PCT = COLS.find((c) => c.id === 'char_pct');

const measured = { characters: [{ id: 1305, name: 'ロックマン', pct: 0.62 }] };
const voted = { characters: [{ id: 1305, name: 'ロックマン', src: 'vote' }] };
const none = { characters: [] };

test('使用率: 実績があれば % 表示', () => {
  assert.strictEqual(PCT.cell(measured), '62%');
  assert.strictEqual(PCT.value(measured), -0.62);
});

test('使用率: 投票由来 (pct 無し) は NaN にならず「自己申告」', () => {
  const cell = PCT.cell(voted);
  assert.ok(cell.indexOf('自己申告') !== -1, cell);
  assert.ok(cell.indexOf('NaN') === -1, cell);
  assert.strictEqual(PCT.value(voted), 0);
});

test('使用率: キャラが無ければ –', () => {
  assert.strictEqual(PCT.cell(none), '–');
  assert.strictEqual(PCT.value(none), 0);
});

test('使用率: 実績ありが投票由来より上に並ぶ', () => {
  // 列は value 昇順で並ぶ (= 使用率の高い順)。
  const rows = [voted, measured, none];
  rows.sort((a, b) => PCT.value(a) - PCT.value(b));
  assert.strictEqual(rows[0], measured);
});

test('使用率: pct が null でも壊れない (= 数値でないものは実績扱いしない)', () => {
  const nulled = { characters: [{ id: 1305, name: 'ロックマン', pct: null }] };
  assert.ok(PCT.cell(nulled).indexOf('自己申告') !== -1);
  assert.strictEqual(PCT.value(nulled), 0);
});
