// tests/frontend/my_notice.test.cjs — 本人へのお知らせ (js/my_notice.js): 全国順位・Lv が上がったとき・二つ名を入手したときだけ出て、× で閉じると消える。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const store = new Map();
  const ctx = {
    console,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    SPSPI18n: { t: (k, p) => k + JSON.stringify(p || {}) },
    SpspTitleNotice: { checkNew: async () => 0 },
    SpspLogin: { verify: async () => null, session: () => null },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/my_notice.js'), ctx);
  return ctx.SpspMyNotice;
}
const kinds = (list) => list.map((x) => x.kind + (x.from != null ? `:${x.from}->${x.to}` : '') + (x.n != null ? `:${x.n}` : '')).join(',');

test('初めて見たときは何も出さない (今の値が基準)', () => {
  const N = load();
  N.observe(1, { rank: 50, lv: 3 });
  assert.strictEqual(kinds(N.items(1)), '');
});

test('順位が上がったら出る。Lv も上がったら追加で出る。× で消える', () => {
  const N = load();
  N.observe(1, { rank: 50, lv: 3 });
  N.observe(1, { rank: 40, lv: 3 });
  assert.strictEqual(kinds(N.items(1)), 'rank:50->40');
  N.observe(1, { rank: 30, lv: 4 });
  assert.strictEqual(kinds(N.items(1)), 'rank:50->30,lv:3->4');   // 閉じるまでは前に閉じたときの値と比べる
  N.dismiss(1);
  assert.strictEqual(kinds(N.items(1)), '');
  N.observe(1, { rank: 30, lv: 4 });
  assert.strictEqual(kinds(N.items(1)), '');
});

test('下がったときは出さず、基準を下げる (次に上がった分だけ出す)', () => {
  const N = load();
  N.observe(1, { rank: 50, lv: 3 });
  N.observe(1, { rank: 60, lv: 2 });
  assert.strictEqual(kinds(N.items(1)), '');
  N.observe(1, { rank: 55, lv: 3 });
  assert.strictEqual(kinds(N.items(1)), 'rank:60->55,lv:2->3');
});

test('圏外 (null) になったら基準も消え、また載ったときは出さない', () => {
  const N = load();
  N.observe(1, { rank: 50, lv: 3 });
  N.observe(1, { rank: null, lv: null });
  N.observe(1, { rank: 70, lv: 2 });
  assert.strictEqual(kinds(N.items(1)), '');
});

test('二つ名: 新しい数が閉じた数より多いときだけ。編集ページで見て 0 に戻ったら閉じた数も戻る', async () => {
  const N = load();
  N.observe(1, { rank: 50, lv: 3 });
  assert.strictEqual(kinds(N.items(1, 2)), 'titles:2');
  N.dismiss(1, 2);
  assert.strictEqual(kinds(N.items(1, 2)), '');
  assert.strictEqual(kinds(N.items(1, 3)), 'titles:3');
  assert.strictEqual(await N.titlesNew(1), 0);   // checkNew が 0 (編集ページで既読)
  assert.strictEqual(kinds(N.items(1, 1)), 'titles:1');
});

test('人ごとに別', () => {
  const N = load();
  N.observe(1, { rank: 50, lv: 3 });
  N.observe(2, { rank: 10, lv: 5 });
  N.observe(1, { rank: 45, lv: 3 });
  assert.strictEqual(kinds(N.items(1)), 'rank:50->45');
  assert.strictEqual(kinds(N.items(2)), '');
});
