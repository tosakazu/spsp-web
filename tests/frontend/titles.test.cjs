// tests/frontend/titles.test.cjs — 二つ名の一覧と、持っている二つ名の計算 (js/titles.js、docs/card_titles_design.md)。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/titles.js'), ctx);
  return ctx.SpspTitles;
}

/** n 回の本戦 (日付は start から 1 日ずつ) @param {number} n @param {string} start */
function tours(n, start = '2026-01-01') {
  const d0 = Date.parse(start + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => ({ event_id: 1000 + i, date: new Date(d0 + i * 864e5).toISOString().slice(0, 10) }));
}

test('一覧: id は重複なし・言語の接頭辞と連番・使える位置 (part)・日付の形', () => {
  const T = load();
  for (const [lang, list] of Object.entries(T.TITLES)) {
    const ids = new Set();
    for (const t of list) {
      assert.ok(!ids.has(t.id), `重複 ${t.id}`);
      ids.add(t.id);
      assert.match(t.id, new RegExp(`^${lang}-\\d{4}$`));
      assert.ok(['pre', 'post', 'both'].includes(t.part), t.id);
      assert.ok(t.text && t.text.length <= 30, t.id);
      assert.ok(['initial', 'random'].includes(t.unlock), t.id);
      assert.match(t.added, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test('最初から持っているもの: 大会に出ていなくても initial は全部', () => {
  const T = load();
  const owned = T.ownedTitles('ja', 123, []);
  const initial = T.TITLES.ja.filter(t => t.unlock === 'initial').map(t => t.id).sort();
  assert.strictEqual(JSON.stringify([...owned.keys()].sort()), JSON.stringify(initial));
});

test('ランダム解放: 10 回ごとに 1 つ・同じ入力なら同じ結果・下位クラスの仮想大会は数えない', () => {
  const T = load();
  const base = T.TITLES.ja.filter(t => t.unlock === 'initial').length;
  assert.strictEqual(T.ownedTitles('ja', 7, tours(9)).size, base);
  assert.strictEqual(T.ownedTitles('ja', 7, tours(10)).size, base + 1);
  assert.strictEqual(T.ownedTitles('ja', 7, tours(25)).size, base + 2);
  const a = [...T.ownedTitles('ja', 7, tours(30)).keys()];
  const b = [...T.ownedTitles('ja', 7, tours(30)).keys()];
  assert.deepStrictEqual(a, b);
  const withClass = tours(9).concat([{ event_id: 'c', date: '2026-02-01', parent_event_id: 1000 }]);
  assert.strictEqual(T.ownedTitles('ja', 7, withClass).size, base);
});

test('あとで二つ名を足しても、それより前に引いたものは変わらない', () => {
  const T = load();
  const before = T.ownedTitles('ja', 42, tours(30, '2026-10-02'));
  // 11/01 に 3 つ追加 (30 回目の大会は 10/31 なので、どの抽選にも入らない)
  for (let i = 0; i < 3; i++) T.TITLES.ja.push({ id: `ja-90${i}0`, part: 'pre', text: 'x' + i, unlock: 'random', added: '2026-11-01' });
  const after = T.ownedTitles('ja', 42, tours(30, '2026-10-02'));
  assert.deepStrictEqual([...after.entries()], [...before.entries()]);
  // 追加日より後の抽選には出うる
  const later = T.ownedTitles('ja', 42, tours(40, '2026-10-02'));
  assert.strictEqual(later.size, before.size + 1);
});

test('廃止したものは廃止日より後の抽選に出ない・持っている人は持ったまま', () => {
  const T = load();
  const owned = T.ownedTitles('ja', 5, tours(10, '2026-10-02'));
  const drawn = [...owned.entries()].find(([, v]) => v.how === 'random');
  assert.ok(drawn);
  const t = T.TITLES.ja.find(x => x.id === drawn[0]);
  t.retired = '2026-12-01';
  assert.ok(T.ownedTitles('ja', 5, tours(10, '2026-10-02')).has(drawn[0]));   // 引いたのは廃止日より前
  t.retired = '2026-10-05';
  assert.ok(!T.ownedTitles('ja', 5, tours(10, '2026-10-02')).has(drawn[0]));  // 引く日に廃止済みなら出ない
});

test('公開日より前の大会での抽選は公開日の一覧から (日付は公開日)', () => {
  const T = load();
  const owned = T.ownedTitles('ja', 9, tours(10, '2025-01-01'));
  const r = [...owned.values()].find(v => v.how === 'random');
  assert.strictEqual(r.at, T.TITLE_LAUNCH);
});

test('二つ名の文字はすべてフォント (site/fonts/corporate-logo-title.woff2) に入っている (足りなければ tools/fonts/build_title_font.mjs)', () => {
  const T = load();
  const fs = require('fs');
  const path = require('path');
  const have = new Set(fs.readFileSync(path.resolve(__dirname, '../../site/fonts/corporate-logo-title.chars.txt'), 'utf8').replace(/\n$/, ''));
  const missing = [];
  for (const list of Object.values(T.TITLES)) for (const t of list) for (const ch of t.text) if (!have.has(ch)) missing.push(`${t.id}:${ch}`);
  assert.deepStrictEqual(missing, []);
});

test('使える位置: both は前半・後半どちらでも、pre / post はその位置だけ', () => {
  const T = load();
  const t = (part) => ({ id: 'ja-9999', part, text: 'x', unlock: 'random', added: '2026-10-01' });
  assert.strictEqual(T.usableIn(t('both'), 'pre') && T.usableIn(t('both'), 'post'), true);
  assert.strictEqual(T.usableIn(t('pre'), 'pre'), true);
  assert.strictEqual(T.usableIn(t('pre'), 'post'), false);
  assert.strictEqual(T.usableIn(t('post'), 'pre'), false);
});
