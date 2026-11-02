'use strict';
// ランキング表に出す名前の整形。
// チームタグと「/name」「[補足]」は一覧・プレイヤーカード・直対で落とす。末尾の空白も落とす。整形は js/format.js shortName
// (ranking-table.js の displayName はそれ、中で stripTeamTag を使う。2026-11-02 から直対と同じ)。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.resolve(__dirname, '../../site');
const SRC = require('../helpers/built.cjs').built('ranking-table.js');

// 実ソースから関数だけ取り出して動かす (定義が変わったら落ちる)
const FMT = fs.readFileSync(path.join(SITE, 'js', 'format.js'), 'utf8');
const fnSrc = FMT.match(/function stripTeamTag\(name\) \{[\s\S]*?\n  \}/);
const fixSrc = FMT.match(/var SHORT_NAME_FIX = .*;/);
const shortSrc = FMT.match(/function shortName\(name\) \{[\s\S]*?\n  \}/);
assert.ok(fnSrc && shortSrc, 'stripTeamTag / shortName が見つからない');
assert.ok(/const displayName = SPSPFormat\.shortName;/.test(SRC), 'ranking-table.js の displayName は shortName (直対と同じ)');
// eslint-disable-next-line no-eval
const displayName = eval('(() => { ' + fnSrc[0] + '\n' + fixSrc[0] + '\n' + shortSrc[0] + '\n return shortName; })()');

test('チームタグを落とす', () => {
  assert.strictEqual(displayName('ZETA | あcola'), 'あcola');
  assert.strictEqual(displayName('Mindset | Riko'), 'Riko');
  assert.strictEqual(displayName('TSM|Leo'), 'Leo');       // 空白なしの区切りも
  assert.strictEqual(displayName('タグ無し'), 'タグ無し');
});

test('「名前/name」は名前だけ (直対と同じ)', () => {
  assert.strictEqual(displayName('れの/Reno'), 'れの');
  assert.strictEqual(displayName('BUZZ | たいけい/Taikei'), 'たいけい');
  assert.strictEqual(displayName('とみさ／Tomisa'), 'とみさ');       // 全角
  assert.strictEqual(displayName('リノハ [休日は…]'), 'リノハ');
  assert.strictEqual(displayName('[RE]キの'), '[RE]キの');           // 区切りが先頭なら切らない
  assert.strictEqual(displayName('TG(トリグリ)'), 'TG(トリグリ)');
  assert.strictEqual(displayName('PND/あまねこ'), 'あまねこ');       // 手で直す人
  assert.strictEqual(displayName('ABC | PND/あまねこ'), 'あまねこ');
});

test('プレイヤーカードも同じ', () => {
  const card = fs.readFileSync(path.join(SITE, 'js', 'player_card_model.js'), 'utf8');
  assert.doesNotMatch(card, /name: SPSPFormat\.stripTeamTag/, 'カードの名前が stripTeamTag のまま');
  assert.match(card, /name: SPSPFormat\.shortName\(rec\.display\)/);
});

test('末尾・先頭の空白を落とす (半角・全角とも)', () => {
  assert.strictEqual(displayName('しもじ '), 'しもじ');
  assert.strictEqual(displayName('しもじ　'), 'しもじ');   // 全角
  assert.strictEqual(displayName('　まる　'), 'まる');
  assert.strictEqual(displayName('ZETA |  あcola  '), 'あcola');
});

test('名前を空にしない (壊れた表記でも何か出す)', () => {
  for (const n of ['|', 'ZETA |', '　', '']) {
    assert.ok(displayName(n).length > 0 || n === '', '空になった: ' + JSON.stringify(n));
  }
  assert.strictEqual(displayName('ZETA |'), 'ZETA |');
});

test('並べ替え・絞り込みは元の表記のまま (タグで検索できる)', () => {
  const i = SRC.indexOf('    display: {');
  const col = SRC.slice(i, SRC.indexOf('cell: (rec, ctx) => {', i));
  assert.match(col, /value: \(rec\) => rec\.display/, 'value まで整形すると検索が効かなくなる');
  assert.match(col, /sortKey: 'display'/);
});

test('表示にだけ適用する', () => {
  const cell = SRC.slice(SRC.indexOf('const shown = displayName(rec.display);'),
    SRC.indexOf('// メイン使用キャラの絵文字'));
  assert.match(cell, /escapeHtml\(shown\)/);
  assert.doesNotMatch(cell, /escapeHtml\(rec\.display\)/, '整形前の名前が残っている');
});

test('プレイヤーページ側は整形しない (所属を見せる)', () => {
  const { pageWithScript } = require('../helpers/pages.cjs');
  for (const f of ['p/index.html', 'player-detail.js']) {
    const src = f.endsWith('.html') ? pageWithScript(f) : fs.readFileSync(path.join(SITE, f), 'utf8');
    assert.doesNotMatch(src, /displayName\(/, f + ' でも整形している');
  }
});
