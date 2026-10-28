// tests/frontend/live_predict.test.cjs — 参加中の大会の予想 (js/live_predict.js)。
// パフォーマンスの式・試合の順・帯の幅と、予想の出し分け (取り込み済み・集計対象外・大会が不明)、
// 直対評価の向き (1 本先取は半分、DQ と下位クラスのフェーズは数えない)。ビルドとの数値の突き合わせは PR の説明を参照。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console, Math, Date, Promise, Map, Set, SPSPViews: {}, SPSPPlayerData: {} };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('sim/calc.js'), ctx);
  vm.runInContext(built('js/live_predict.js'), ctx);
  return ctx.SpspLivePredict;
}
const LP = load();

test('パフォーマンス: ビルドの perf_rank と同じ (帯の中央値、帯の中にいれば自分の順位、優勝は 1 枠)', () => {
  const rank = { 1: 10, 2: 20, 3: 30, 4: 40, 5: 50, 6: null };
  const r = (u) => rank[u] ?? null;
  const ent = [1, 2, 3, 4, 5, 6].map((u) => ({ uid: u, place: null }));
  // 5 位 (帯 2 人) の uid 6 (順位なし = 最後尾): シード 5・6 番目 = uid 5 と 6 → 順位があるのは 50 だけ
  assert.strictEqual(LP.perfRank(ent.map((e) => ({ ...e, place: 1 })), r, 6, 5, 2), 50);
  // 3 位 (帯 1 人) の uid 5: シード 3 番目 = uid 3 → 30
  assert.strictEqual(LP.perfRank(ent.map((e) => ({ ...e, place: 1 })), r, 5, 3, 1), 30);
  // 自分のシード位置が帯の中なら自分の順位
  assert.strictEqual(LP.perfRank(ent.map((e) => ({ ...e, place: 1 })), r, 4, 3, 2), 40);
  // 優勝はトップシード 1 枠
  assert.strictEqual(LP.perfRank(ent.map((e) => ({ ...e, place: 1 })), r, 6, 1, 4), 10);
  // 偶数人の帯は真ん中 2 人の平均
  assert.strictEqual(LP.perfRank(ent.map((e) => ({ ...e, place: 1 })), r, 6, 1 + 1, 2), 25);
});

test('帯の幅と試合の順 (ビルドの _bracket_order_key と同じ)', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 7, 9, 13, 17, 25].map(LP.bracketBandSize), [1, 1, 1, 1, 2, 2, 4, 4, 8, 8]);
  const sets = [{ label: 'Grand Final', round_text: 'Grand Final Reset' }, { label: 'Grand Final', round_text: 'Grand Final' },
    { label: 'Losers TOP 4' }, { label: 'Losers TOP 8' }, { label: 'Winners TOP 2' }, { label: 'B-Winners TOP 8' }, { label: '総当たり' }];
  const order = sets.map((s, i) => ({ k: LP.bracketOrderKey(s), i })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]).map((x) => x.i);
  assert.deepStrictEqual(order, [6, 5, 4, 3, 2, 1, 0]);
});

const ME = 100;
const player = (extra = {}) => ({
  scores: { shared_cascade_lv: 1, bt_internal_elo: 1500, bt_gated_elo: 1500, tjpr_score: 0 },
  bt_timeline_g2: [{ date: '2026-10-01', rating: 1500, rd: 80 }], tournaments: [], ranks: { ensemble: 500, tjpr: 400, bt_gated: 600 }, ...extra,
});
const POP = new Map([[ME, { tj: 0, bt: 1500, btInt: 1500, lv: 1, gray: false, ens: 500, tjR: 400, btR: 600 }],
  [200, { tj: 5, bt: 1700, btInt: 1700, lv: 1, gray: false, ens: 100, tjR: 100, btR: 100 }],
  [300, { tj: 1, bt: 1400, btInt: 1400, lv: 1, gray: false, ens: 900, tjR: 900, btR: 900 }],
  [400, { tj: 1, bt: 1450, btInt: 1450, lv: 1, gray: false, ens: 800, tjR: 800, btR: 800 }]]);
const doc = (sets, extra = {}) => ({
  event_id: 77, start_at: Date.parse('2026-10-25T03:00:00Z') / 1000,
  phases: [{ name: 'Main', groups: [{ id: 1 }] }, { name: 'Bクラス', cls: true, groups: [{ id: 2 }] }],
  entrants: {
    e1: { uid: ME, placement: null, final: false, place_min: 3 }, e2: { uid: 200, placement: null, final: false, place_min: 3 },
    e3: { uid: 300, placement: 4, final: true }, e4: { uid: 400, placement: 3, final: true }, e5: { uid: null, placement: 5, final: true },
  },
  sets, ...extra,
});
const UP = { events: { 77: { is_weekend: true } } };
const mk = (o = {}) => LP.create({ uid: ME, player: player(o.player), data: '', utcOffset: '+09:00',
  pop: async () => POP, upcoming: async () => (o.up === undefined ? UP : o.up),
  oppInit: async (u) => ({ rating: POP.get(u).btInt, rd: 80, lastTs: null }) });
const win = (opp, score = [2, 0], extra = {}) => ({ id: Math.random(), pg: 1, label: 'Winners TOP 4', e: ['e1', opp], score, winner: 'e1', ...extra });

test('予想: 勝ち残りは place_min で。格上に勝てば直対評価が上がる。1 本先取は約半分。DQ と下位クラスは数えない', async () => {
  const p = mk();
  const r = await p.predict(doc([win('e2')]));
  assert.strictEqual(r.place, 3);
  assert.strictEqual(r.final, false);
  assert.strictEqual(r.counted, true);
  assert.ok(r.perf != null);
  assert.ok(r.tjpr && r.tjpr.raw > 0 && r.tjpr.delta > 0);
  assert.ok(r.bt && r.bt.dInt > 0 && r.bt.n === 1);
  assert.deepStrictEqual(Object.values(r.bt.perSet).map((d) => +d.toFixed(9)), [+r.bt.dInt.toFixed(9)]);   // 1 試合なら合計と同じ
  const bo1 = await mk().predict(doc([win('e2', [1, 0])]));
  assert.ok(Math.abs(bo1.bt.dInt - r.bt.dInt / 2) < 1e-9, `${bo1.bt.dInt} vs ${r.bt.dInt}`);
  const extra = await mk().predict(doc([win('e2'), win('e3', [-1, 0]), { ...win('e4'), pg: 2 }]));
  assert.ok(Math.abs(extra.bt.dInt - r.bt.dInt) < 1e-9);
  assert.strictEqual(extra.bt.n, 1);
  // 全国順位の変化 (タップ): 上がる向き
  const rc = await p.rankChange(r);
  assert.ok(rc.ens.next <= rc.ens.cur && rc.bt.next <= rc.bt.cur && rc.tjpr.next <= rc.tjpr.cur, JSON.stringify(rc));
});

test('予想しない・一部だけ: 取り込み済みの大会は null、集計対象外はパフォーマンスだけ、大会が不明なら集計の予想なし', async () => {
  assert.strictEqual(await mk({ player: { tournaments: [{ event_id: 77 }] } }).predict(doc([win('e2')])), null);
  const ng = await mk({ up: { events: { 77: { is_non_serious: true } } } }).predict(doc([win('e2')]));
  assert.strictEqual(ng.counted, false);
  assert.ok(ng.perf != null && ng.tjpr === null && ng.bt === null);
  const unk = await mk({ up: null }).predict(doc([win('e2')]));
  assert.strictEqual(unk.counted, null);
  assert.ok(unk.perf != null && unk.tjpr === null && unk.bt === null);
  // 自分が出ていない部門・確定も place_min も無い (総当たりの途中) なら順位系は出さない
  assert.strictEqual(await mk().predict({ event_id: 78, entrants: { x: { uid: 1 } }, sets: [] }), null);
  const d = doc([win('e2')]);
  d.entrants.e1.place_min = null;
  const rr = await mk().predict(d);
  assert.ok(rr.place === null && rr.perf === null && rr.tjpr === null && rr.bt);
});
