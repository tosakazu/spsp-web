// tests/frontend/upcoming_stats.test.cjs — 今後の大会のページの集計 (js/upcoming_stats.js): 選手の一覧との突き合わせ・並び・帯・まとめ。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/upcoming_stats.js'), ctx);
  return ctx.SpspUpcomingStats;
}
const St = load();
const INDEX = new Map([
  [1, { uid: 1, name: 'T | あ', ens: 5, lv: 5, char: 10, pref: 13, ovs: 0 }],
  [2, { uid: 2, name: 'い', ens: 120, lv: 4, char: 10, pref: 27, ovs: 0 }],
  [3, { uid: 3, name: 'う', ens: 4000, lv: 1, char: 20, pref: 13, ovs: 0 }],
  [4, { uid: 4, name: 'え', ens: null, lv: null, char: null, pref: null, ovs: 1 }],
]);
const index = { get: (uid) => INDEX.get(uid) || null };
const ev = { entrants: [{ uid: 3, tag: 'う' }, { uid: 9, tag: '新人' }, { uid: 2, tag: 'い' }, { uid: 1, tag: 'あ' }, { uid: 4, tag: 'え' }, { uid: 2, tag: '重複' }, { uid: null, tag: 'x' }] };
const plain = (v) => JSON.parse(JSON.stringify(v));

test('参加予定者に順位などを付けて、順位の高い順に並べる。順位の無い人は後ろ・同じ人は 1 回', () => {
  const rows = St.joinEntrants(ev, index);
  assert.deepStrictEqual(plain(rows.map((r) => r.uid)), [1, 2, 3, 4, 9]);
  assert.deepStrictEqual(plain(rows[0]), { uid: 1, name: 'T | あ', rank: 5, lv: 5, char: 10, pref: 13, ovs: false });
  assert.deepStrictEqual(plain(rows[4]), { uid: 9, name: '新人', rank: null, lv: null, char: null, pref: null, ovs: false }, '一覧に居ない人は登録名');
  assert.deepStrictEqual(plain(St.joinEntrants(ev, null).map((r) => r.rank)), [null, null, null, null, null], '一覧が読めなくても止まらない');
  assert.deepStrictEqual(plain(St.joinEntrants(null, index)), []);
});

test('数字: 人数・順位のある人数・上位の人数・中央値', () => {
  const s = St.summary(St.joinEntrants(ev, index));
  assert.deepStrictEqual(plain(s), { n: 5, ranked: 3, top10: 1, top100: 1, top1000: 2, median: 120 });
  assert.strictEqual(St.summary([]).median, null);
  assert.strictEqual(St.summary([{ rank: 10 }, { rank: 21 }]).median, 16, '偶数は真ん中 2 人の平均 (四捨五入)');
});

test('順位の帯と Lv の人数。合計は人数と同じ', () => {
  const rows = St.joinEntrants(ev, index);
  const b = St.rankBands(rows);
  assert.deepStrictEqual(plain(b.map((x) => [x.from, x.to, x.n])), [[1, 8, 1], [9, 16, 0], [17, 32, 0], [33, 64, 0], [65, 128, 1], [129, 256, 0], [257, 512, 0], [513, 1024, 0], [1025, 2048, 0], [2049, 4096, 1], [null, null, 2]]);
  assert.deepStrictEqual(plain(St.rankBands(rows.filter((r) => r.uid !== 1 && r.uid !== 3)).map((x) => [x.from, x.to, x.n])), [[65, 128, 1], [null, null, 2]], '人のいる帯の範囲だけ');
  assert.strictEqual(b.reduce((a, x) => a + x.n, 0), rows.length);
  const l = St.lvCounts(rows);
  assert.deepStrictEqual(plain(l.map((x) => [x.lv, x.n])), [[5, 1], [4, 1], [3, 0], [2, 0], [1, 1], [null, 2]]);
});

test('使い手・地域ごと: 人数の多い順、同数は最上位の人の順位順、不明は最後。組の中は順位順', () => {
  const rows = St.joinEntrants(ev, index);
  const c = St.groupBy(rows, 'char');
  assert.deepStrictEqual(plain(c.map((g) => [g.key, g.rows.map((r) => r.uid)])), [[10, [1, 2]], [20, [3]], [null, [4, 9]]]);
  const p = St.groupBy(rows, 'pref');
  assert.deepStrictEqual(plain(p.map((g) => [g.key, g.rows.map((r) => r.uid)])), [[13, [1, 3]], [27, [2]], [null, [4, 9]]]);
});
