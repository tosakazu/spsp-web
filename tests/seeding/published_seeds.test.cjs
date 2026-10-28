'use strict';
// 公開済みシードとの被り回避 (site/seeding/published_seeds.js、docs/seed_collision_avoidance.md §6.2.2)。
//   - 対象の大会: 前後 3 日 (100 人以上は後 21 日)・平日の除外・仮のシードの除外・本大会そのものを外す
//   - ペア: 同じプールの本大会の出場者、プール内のシード順から勝者側の最早対戦回戦
//   - 罰則: 重み × log2(規模)、実際の対戦歴とは recentAgg (max / sum) でまとめる
const test = require('node:test');
const assert = require('node:assert');
const P = ((m) => m.default || m)(require('../../site/seeding/published_seeds.js'));
const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));

const DAY = 86400;
const T0 = Date.UTC(2026, 10, 1, 3) / 1000;   // 2026-11-01 12:00 JST (本大会)

/** プール 1 つ (シード順に uid を並べる) の大会 */
function ev(eid, dayDiff, nent, poolUids, extra) {
  const entrants = [];
  let seed = 1;
  poolUids.forEach((uids, pi) => { for (const uid of uids) entrants.push({ uid, tag: 'p' + uid, seed: seed++, pg: 9000 + pi }); });
  const pools = {};
  poolUids.forEach((_, pi) => { pools[9000 + pi] = { ident: String.fromCharCode(65 + pi) + '1', url: '' }; });
  return [String(eid), Object.assign({ tournament_name: '大会' + eid, start_at: T0 + dayDiff * DAY, num_entrants: nent, is_weekend: true,
    entrants, bracket: { phase_id: 1, phase: 'Pools', pools } }, extra || {})];
}
const upOf = (...evs) => ({ generated_at: T0 - 3600, events: Object.fromEntries(evs) });
const ATT = [1, 2, 3, 4, 5, 6, 7, 8];
const sel = (up, o) => P.selectPublishedEvents(up, Object.assign({ targetEventId: 100, targetStartAt: T0, attendees: ATT }, o || {}));

test('範囲: 前後 3 日。100 人以上は後 21 日まで (前は 3 日のまま)', () => {
  const up = upOf(
    ev(1, -3, 30, [[1, 2]]), ev(2, -4, 30, [[1, 2]]), ev(3, 3, 30, [[1, 2]]), ev(4, 4, 30, [[1, 2]]),
    ev(5, 21, 100, [[1, 2]]), ev(6, 22, 100, [[1, 2]]), ev(7, -4, 150, [[1, 2]]), ev(8, 0, 20, [[1, 2]]));
  const r = sel(up);
  assert.deepStrictEqual(r.used.map((e) => e.eventId).sort(), ['1', '3', '5', '8']);
  assert.deepStrictEqual(r.skipped.filter((e) => e.reason === 'range').map((e) => e.eventId).sort(), ['2', '4', '6', '7']);
});

test('本大会そのもの・公開前 (bracket なし)・共通の出場者が 1 人以下の大会は一覧にも出さない', () => {
  const [k, noBr] = ev(2, 1, 30, [[1, 2]]); delete noBr.bracket;
  const up = upOf(ev(100, 0, 30, [[1, 2]]), [k, noBr], ev(3, 1, 30, [[1, 90, 91]]));
  const r = sel(up);
  assert.strictEqual(r.used.length, 0);
  assert.strictEqual(r.skipped.length, 0);
});

test('別々のプールにしかいなければ「同じプールの組がない」で対象外', () => {
  const r = sel(upOf(ev(1, 1, 30, [[1, 90], [2, 91]])));
  assert.strictEqual(r.used.length, 0);
  assert.strictEqual(r.skipped[0].reason, 'nopair');
});

test('平日扱いの大会は「平日大会の対戦を除く」のときだけ外す', () => {
  const up = upOf(ev(1, 1, 30, [[1, 2]], { is_weekend: false }));
  assert.strictEqual(sel(up, { excludeWeekday: true }).skipped[0].reason, 'weekday');
  assert.strictEqual(sel(up, { excludeWeekday: false }).used.length, 1);
});

test('仮のシード: 順位のある人が 5 人以上で、シードと順位の相関が 0.3 未満なら外す', () => {
  const uids = [1, 2, 3, 4, 5, 6];
  const rankRev = (u) => 7 - u;      // シード順と逆 (相関 -1)
  const rankSame = (u) => u * 10;    // シード順どおり
  const up = upOf(ev(1, 1, 30, [uids]));
  const r1 = sel(up, { rankOf: rankRev });
  assert.strictEqual(r1.skipped[0].reason, 'provisional');
  assert.ok(r1.skipped[0].r < 0.3);
  assert.strictEqual(sel(up, { rankOf: rankSame }).used.length, 1);
  // 順位のある人が 4 人なら判定しない (使う)
  assert.strictEqual(sel(up, { rankOf: (u) => (u <= 4 ? 7 - u : null) }).used.length, 1);
});

test('isProvisionalSeed はビルドの判定と同じ Spearman', () => {
  assert.strictEqual(P.spearman([1, 2, 3], [10, 20, 30]), 1);
  assert.strictEqual(P.spearman([1, 2, 3], [3, 2, 1]), -1);
  assert.strictEqual(P.spearman([1, 2, 3], [5, 5, 5]), null);
  const v = P.isProvisionalSeed([{ uid: 1, seed: 1 }, { uid: 2, seed: 2 }], () => 1);
  assert.deepStrictEqual([v.provisional, v.n], [false, 2]);
});

test('ペア: プールの中のシード順から勝者側の最早対戦回戦 (出場していない人もプールの大きさに数える)', () => {
  // 8 人プール (シード 1..8)。本大会に出るのは 1,2,3 と 8 (uid 1,2,3,8)
  const r = sel(upOf(ev(1, 1, 64, [[1, 2, 3, 90, 91, 92, 93, 8]])));
  const pairs = P.publishedPairs(r.used, ATT);
  const slot = O.slotOfSeedMap(8);
  const want = (sa, sb) => O.earliestMeetRound(slot[sa], slot[sb]);
  const byKey = Object.fromEntries(pairs.map((x) => [x.a + '-' + x.b, x]));
  assert.strictEqual(byKey['1-8'].round, 1);           // 1 vs 8 は 1 回戦
  assert.strictEqual(byKey['1-8'].round, want(1, 8));
  assert.strictEqual(byKey['2-3'].round, want(2, 3));  // 2 vs 3 は 2 回戦
  assert.strictEqual(byKey['1-2'].round, 3);           // 1 vs 2 は 3 回戦 (決勝)
  assert.strictEqual(byKey['1-8'].w, 1.0);
  assert.strictEqual(byKey['2-3'].w, 0.6);
  assert.strictEqual(byKey['1-2'].w, 0.35);
  assert.strictEqual(pairs.length, 6);
  assert.strictEqual(byKey['1-8'].pool, 'A1');
  assert.strictEqual(P.roundWeight(4), 0.2);
  assert.strictEqual(P.roundWeight(7), 0.2);
});

test('罰則を足す: 重み × log2(規模)。既定 max は実際の対戦歴と大きい方、sum は足す', () => {
  const r = sel(upOf(ev(1, 1, 64, [[1, 8]])));
  const pairs = P.publishedPairs(r.used, ATT);   // 1 vs 8 (2 人プール = 1 回戦)
  const key = O.pairKey(1, 8);
  const mk = () => ({ recentPair: { [key]: 2 }, recentMeta: { [key]: { penalty: 2, count: 1, lastDate: '2026-10-20', matches: [{ date: '2026-10-20' }] } } });
  const b1 = mk();
  assert.strictEqual(P.mergePublished(b1, pairs), 1);
  assert.strictEqual(b1.recentPair[key], 6);       // max(2, 1.0 × log2 64)
  assert.strictEqual(b1.recentMeta[key].count, 1); // 実際の対戦数はそのまま
  assert.deepStrictEqual(b1.recentMeta[key].published, [{ date: '2026-11-02', tournament: '大会1', nent: 64, round: 1, pool: 'A1' }]);
  const b2 = mk();
  P.mergePublished(b2, pairs, { recentAgg: 'sum' });
  assert.strictEqual(b2.recentPair[key], 8);
  // 対戦歴の無いペアは meta を新しく作る (count 0)
  const b3 = { recentPair: {}, recentMeta: {} };
  P.mergePublished(b3, pairs, { sizeWeight: (n) => Math.sqrt(n) });
  assert.strictEqual(b3.recentPair[key], 8);
  assert.strictEqual(b3.recentMeta[key].count, 0);
});

test('最適化のレポートに published が載る (同じプールに置いたままなら懸念ペアとして出る)', () => {
  const r = sel(upOf(ev(1, 1, 64, [[1, 2]])));
  const bundle = { recentPair: {}, recentMeta: {} };
  P.mergePublished(bundle, P.publishedPairs(r.used, ATT));
  const ranking = [1, 2, 3, 4];
  const res = O.optimize({ poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, prefCounts: {},
    recentPair: bundle.recentPair, recentMeta: bundle.recentMeta, params: { mode: 'hillclimb', restarts: 1, maxSeedShift: 0, rngSeed: 1 } });
  const items = res.report.residualConcerns.inter.recent.top;
  const it = items.find((x) => (x.a === 1 && x.b === 2) || (x.a === 2 && x.b === 1));
  assert.ok(it, JSON.stringify(items));
  assert.strictEqual(it.published[0].tournament, '大会1');
});

test('壊れた・欠けたデータでも落ちない (events が無い・配列・null、出場者の欠け)', () => {
  for (const up of [null, {}, { events: null }, { events: [] }, { events: { 1: null } }]) {
    assert.deepStrictEqual(sel(up), { used: [], skipped: [] });
  }
  const [, e1] = ev(1, 1, 30, [[1, 2, 3]]);
  e1.entrants.push({ uid: 4, seed: null, pg: 9000 }, { uid: null, seed: 9, pg: 9000 }, { uid: 5, seed: 10, pg: null });
  delete e1.bracket.pools;   // プール名が無い
  const r = sel({ events: [Object.assign({ event_id: 1 }, e1)] });
  assert.strictEqual(r.used.length, 1);
  assert.deepStrictEqual(r.used[0].pools[0].seeds.map((s) => s.uid), [1, 2, 3, null]);
  const pairs = P.publishedPairs(r.used, ATT);
  assert.strictEqual(pairs.length, 3);
  assert.ok(pairs.every((x) => x.pool === '' && x.w > 0));
});
