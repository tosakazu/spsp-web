'use strict';
// ランキングの検索 (2026-11-05〜): 既定は名前だけ。「ID検索」(#search-by-id) のときは discriminator の前方一致も。
// uid では探さない。シード生成ツールの表だけは今までどおり名前・uid・discriminator (3 文字以上)。
// 実ソースから関数 / 絞り込みの部分を取り出して動かす (定義が変わったら落ちる)。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.resolve(__dirname, '../../site');
const read = (rel) => fs.readFileSync(path.join(SITE, rel), 'utf8');

const DISC = { 1001: 'b6dc51b7', 1002: '1849a98a', 1003: '00ff00aa' };
const links = { discOf: (u) => DISC[String(u)] || null };
const ROWS = [
  { user_id: 1001, display: 'まっすー' },
  { user_id: 1002, display: 'ニャハ' },
  { user_id: 1003, display: 'b6 player' },
  { user_id: 1849, display: 'abc' },
];

// views.js の matcher (分割データの検索 = 全国ランキング)
const V = read('js/views.js');
const mSrc = V.match(/  function matcher\(query, opts\) \{[\s\S]*?\n  \}/);
assert.ok(mSrc, 'views.js matcher が見つからない');
// eslint-disable-next-line no-eval
const matcher = eval('(function () { var global = {}; ' + mSrc[0] + '\n return matcher; })()');
const viewsHits = (q, byId) => { const hit = matcher(q, { discOf: links.discOf, byId }); return ROWS.filter((r) => hit(r.user_id, r.display)).map((r) => r.user_id); };

// ranking-table.js の絞り込み (県・キャラ・地域・全国ランキング (全件読み) とシード生成ツール)
const T = read('ranking-table.js');
const fSrc = T.match(/      const ft = \(this\.filterText \|\| ''\)\.toLowerCase\(\);\n      let filtered = this\.rows;\n      if \(ft\) \{[\s\S]*?\n      \}\n/);
assert.ok(fSrc, 'ranking-table.js の絞り込みが見つからない');
// eslint-disable-next-line no-new-func
const filterFn = new Function('SPSPLinks', 'window', fSrc[0] + 'return filtered;');
const tableHits = (q, byId, allIds) => filterFn.call({ rows: ROWS, filterText: q, filterById: byId, filterAllIds: !!allIds }, links, {}).map((r) => r.user_id);

for (const [label, hits] of [['views.js', viewsHits], ['ranking-table.js', tableHits]]) {
  test(label + ': 既定は名前だけ (uid・discriminator では当たらない)', () => {
    assert.deepStrictEqual(hits('ニャハ', false), [1002]);
    assert.deepStrictEqual(hits('b6dc', false), []);
    assert.deepStrictEqual(hits('b6', false), [1003]);       // 名前の部分一致
    assert.deepStrictEqual(hits('1849', false), []);         // uid でも discriminator でも当てない
    assert.deepStrictEqual(hits('100', false), []);
  });
  test(label + ': 「ID検索」なら discriminator の前方一致も (uid は無し)', () => {
    assert.deepStrictEqual(hits('b6dc51b7', true), [1001]);
    assert.deepStrictEqual(hits('B6DC', true), [1001]);      // 大文字でも
    assert.deepStrictEqual(hits('b6', true), [1001, 1003]);  // 名前 + discriminator
    assert.deepStrictEqual(hits('1849', true), [1002]);      // uid 1849 は当てない
    assert.deepStrictEqual(hits('51b7', true), []);          // 前方一致だけ
    assert.deepStrictEqual(hits('ニャハ', true), [1002]);
  });
}

test('シード生成ツールの表は今までどおり名前・uid・discriminator (3 文字以上)', () => {
  assert.deepStrictEqual(tableHits('1849', false, true), [1002, 1849]);
  assert.deepStrictEqual(tableHits('b6', false, true), [1003]);   // 2 文字は discriminator を見ない
  assert.deepStrictEqual(tableHits('b6d', false, true), [1001]);
  assert.match(read('seeding/app/30_core.js'), /filterAllIds: true,/);
});

test('配線: 4 つのランキングにチェックボックス・切り替えで探し直す・各ページが状態を渡す', () => {
  for (const p of ['index.html', 'c/ranking.html', 'pref/ranking.html', 'local/ranking.html']) {
    const h = read(p);
    assert.match(h, /<input type="checkbox" id="search-by-id">/, p);
    assert.doesNotMatch(h, /UID検索/, p);
  }
  const RP = read('js/ranking_page.js');
  assert.match(RP, /getElementById\('search-by-id'\);\n    if \(cb\) cb\.addEventListener\('change'/);
  assert.match(RP, /tbl\.setFilterText\(st\.filterText \|\| '', searchById\(\)\);/);
  const SRC = path.resolve(__dirname, '../../src/pages');
  for (const p of ['index.js', 'c_ranking.js', 'pref_ranking.js', 'local_ranking.js']) {
    const s = fs.readFileSync(path.join(SRC, p), 'utf8');
    assert.doesNotMatch(s, /setFilterText\([^,)]*\)/, p + ': ID の状態を渡していない');
  }
  assert.match(fs.readFileSync(path.join(SRC, 'index.js'), 'utf8'), /searchIndex\(q, \{ byId: SPSPRankingPage\.searchById\(\) \}\)/);
});
