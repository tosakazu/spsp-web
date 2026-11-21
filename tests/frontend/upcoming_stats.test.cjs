// tests/frontend/upcoming_stats.test.cjs — 今後の大会のページの集計 (js/upcoming_stats.js): 選手の一覧との突き合わせ・並び・帯・まとめ。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console, canonicalCharId: (id) => ({ 1277: 1317 })[id] || Number(id) };
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

test('ダッシュファイターは使い手ランキングと同じ組にまとめる (デイジー → ピーチ / デイジー)', () => {
  const idx = { get: (uid) => ({ uid, name: 'd' + uid, ens: uid, lv: 3, char: uid === 1 ? 1277 : 1317, pref: 13 }) };
  const rows = St.joinEntrants({ entrants: [{ uid: 1 }, { uid: 2 }] }, idx);
  assert.deepStrictEqual(plain(rows.map((r) => r.char)), [1317, 1317]);
  assert.strictEqual(St.groupBy(rows, 'char').length, 1);
});

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
  assert.deepStrictEqual(plain(b.map((x) => [x.from, x.to, x.n])), [[1, 8, 1], [9, 16, 0], [17, 32, 0], [33, 64, 0], [65, 128, 1], [129, 256, 0], [257, 384, 0], [385, 512, 0], [513, 768, 0], [769, 1024, 0], [1025, 1536, 0], [1537, 2048, 0], [2049, 3072, 0], [3073, null, 1], [null, null, 2]]);
  assert.deepStrictEqual(plain([1, 256, 257, 512, 513, 1025, 2049, 3073].map(St.lvOfRank)), [5, 5, 4, 4, 3, 2, 1, 1]);
  assert.deepStrictEqual(plain(St.rankBands(rows.filter((r) => r.uid !== 1 && r.uid !== 3)).map((x) => [x.from, x.to, x.n])), [[65, 128, 1], [null, null, 2]], '人のいる帯の範囲だけ');
  assert.strictEqual(b.reduce((a, x) => a + x.n, 0), rows.length);
  const l = St.lvCounts(rows);
  assert.deepStrictEqual(plain(l.map((x) => [x.lv, x.n])), [[5, 1], [4, 1], [3, 0], [2, 0], [1, 1], [null, 2]]);
});

test('予選通過のラインが掛かる帯', () => {
  const bands = [{ n: 3 }, { n: 0 }, { n: 5 }, { n: 2 }];
  assert.deepStrictEqual(plain(St.cutBand(bands, 2)), { index: 0, within: 2 });
  assert.deepStrictEqual(plain(St.cutBand(bands, 3)), { index: 0, within: 3 }, '帯の最後の人まで');
  assert.deepStrictEqual(plain(St.cutBand(bands, 4)), { index: 2, within: 1 }, '0 人の帯は飛ばす');
  assert.deepStrictEqual(plain(St.cutBand(bands, 9)), { index: 3, within: 1 });
  assert.strictEqual(St.cutBand(bands, 10), null, '全員通過');
  assert.strictEqual(St.cutBand(bands, 0), null);
  assert.strictEqual(St.cutBand(bands, undefined), null);
});

test('使い手・地域ごと: 人数の多い順、同数は最上位の人の順位順、不明は最後。組の中は順位順', () => {
  const rows = St.joinEntrants(ev, index);
  const c = St.groupBy(rows, 'char');
  assert.deepStrictEqual(plain(c.map((g) => [g.key, g.rows.map((r) => r.uid)])), [[10, [1, 2]], [20, [3]], [null, [4, 9]]]);
  const p = St.groupBy(rows, 'pref');
  assert.deepStrictEqual(plain(p.map((g) => [g.key, g.rows.map((r) => r.uid)])), [[13, [1, 3]], [27, [2]], [null, [4, 9]]]);
});

test('シードとプール: 公開されている大会だけ。プールはウェーブ → 名前の順 (数字は数として)、登録順のままのシードは出さない', () => {
  const pools = { 11: { ident: 'B100', url: 'https://www.start.gg/x/11', wave: 'B', start_at: 200 }, 12: { ident: 'A1000', url: 'https://www.start.gg/x/12', wave: 'A', start_at: 100 },
                  13: { ident: 'A200', url: 'javascript:alert(1)', wave: 'A', start_at: 100 }, 14: { ident: 'C1', url: 'https://www.start.gg/x/14' } };
  const e = { bracket: { pools }, entrants: [{ uid: 1, tag: 'a', seed: 3, pg: 11 }, { uid: 2, tag: 'b', seed: 1, pg: 12 }, { uid: 3, tag: 'c', seed: 2, pg: 13 },
                                             { uid: 4, tag: 'd', seed: 4, pg: 12 }, { uid: 5, tag: 'e' }, { uid: null, tag: 'x', seed: 9, pg: 11 }, { uid: 6, tag: 'f', seed: 5, pg: 99 }] };
  const si = St.seedInfo(e);
  assert.deepStrictEqual(plain(si.pools.map((p) => [p.ident, p.wave, p.n, p.order])), [['A200', 'A', 1, 0], ['A1000', 'A', 2, 1], ['B100', 'B', 1, 2]], '人のいるプールだけ');
  assert.deepStrictEqual(plain(si.waves), [{ id: 'A', startAt: 100, n: 3 }, { id: 'B', startAt: 200, n: 1 }]);
  assert.strictEqual(si.pools[0].url, '', 'start.gg 以外のリンクは捨てる');
  assert.deepStrictEqual(plain([1, 2, 5, 6].map((u) => { const x = si.byUid.get(u); return x ? [x.seed, x.pool && x.pool.ident] : null; })), [[3, 'B100'], [1, 'A1000'], null, [5, null]]);
  assert.strictEqual(St.seedInfo({ entrants: [{ uid: 1, seed: 1 }] }), null, 'トーナメントが公開されていない');
  assert.strictEqual(St.seedInfo({ bracket: { pools }, entrants: [{ uid: 1, seed: 3, pg: 11 }, { uid: 2, seed: 2, pg: 11 }, { uid: 3, seed: 1, pg: 11 }] }), null, '登録順のまま');
  const one = St.seedInfo({ bracket: { pools: { 7: { ident: '1' } } }, entrants: [{ uid: 1, seed: 2, pg: 7 }, { uid: 2, seed: 1, pg: 7 }, { uid: 3, seed: 3, pg: 7 }] });
  assert.deepStrictEqual(plain([one.pools.length, one.waves.length, one.byUid.get(3).seed]), [1, 0, 3]);
});
