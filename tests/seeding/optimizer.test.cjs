'use strict';
// seed_optimizer.js のユニットテスト。 実行: node --test tests/seeding/
const test = require('node:test');
const assert = require('node:assert');
const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));

// ───────── snake（実データで確定した形状） ─────────
test('snake: P=4 の実データ配置と一致', () => {
  const P = 4;
  // seed(1始まり) -> pool(1始まり) を確認。実大会で観測した割当。
  const poolOf1 = (seed1) => O.poolOfSeed(seed1 - 1, P) + 1;
  // 行1: 1→P1,2→P2,3→P3,4→P4
  assert.deepStrictEqual([1, 2, 3, 4].map(poolOf1), [1, 2, 3, 4]);
  // 行2(反転): 5→P4,6→P3,7→P2,8→P1
  assert.deepStrictEqual([5, 6, 7, 8].map(poolOf1), [4, 3, 2, 1]);
  // 行3: 9→P1,10→P2,11→P3,12→P4
  assert.deepStrictEqual([9, 10, 11, 12].map(poolOf1), [1, 2, 3, 4]);
  // 観測: P1={1,8,9,16,17,...}, P4={4,5,12,13,...}
  assert.strictEqual(poolOf1(8), 1);
  assert.strictEqual(poolOf1(16), 1);
  assert.strictEqual(poolOf1(13), 4);
});

test('snake: 端数行は先頭プールから埋まり末尾が1人少ない（155÷4）', () => {
  const P = 4, N = 155;
  const order = Array.from({ length: N }, (_, i) => 1000 + i); // ダミー uid
  const pools = O.poolsFromSeedOrder(order, P);
  const sizes = pools.map((p) => p.length);
  assert.deepStrictEqual(sizes, [39, 39, 39, 38]); // 実データと一致
});

test('snake: seedOrder ⇄ pools のラウンドトリップ', () => {
  const P = 5, N = 37;
  const order = Array.from({ length: N }, (_, i) => i + 1);
  const pools = O.poolsFromSeedOrder(order, P);
  const back = O.seedOrderFromPools(pools, P, N);
  assert.deepStrictEqual(back, order);
});

// ───────── bracket 形状 ─────────
test('seedSlotOrder 標準シード', () => {
  assert.deepStrictEqual(O.seedSlotOrder(2), [1, 2]);
  assert.deepStrictEqual(O.seedSlotOrder(4), [1, 4, 2, 3]);
  assert.deepStrictEqual(O.seedSlotOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('earliestMeetRound: seed1 と seed2 は決勝でのみ当たる', () => {
  const B = 8;
  const slotOf = O.slotOfSeedMap(B);
  // seed1 vs seed2 → 3回戦（=決勝, B=8）
  assert.strictEqual(O.earliestMeetRound(slotOf[1], slotOf[2]), 3);
  // seed1 vs seed8 → 1回戦
  assert.strictEqual(O.earliestMeetRound(slotOf[1], slotOf[8]), 1);
  // seed1 vs seed4/seed5 → 2回戦 (準々…) 確認: 上位ハーフ内
  assert.strictEqual(O.earliestMeetRound(slotOf[1], slotOf[4]), 2);
});

// ───────── 評価関数 ─────────
test('地域罰則: 同県は罰則、別県/不明は0、重みは inv_sqrt', () => {
  const prefByUid = { 1: '東京都', 2: '東京都', 3: '大阪府', 4: null };
  const prefCounts = { 東京都: 4, 大阪府: 1 };
  const params = O.resolveParams({});
  const pp = O.buildPairPenalty(params, prefByUid, prefCounts, {});
  // 同県(東京4人) → W_region * 1/sqrt(4) = 1.0 * 0.5
  assert.ok(Math.abs(pp(1, 2) - 0.5) < 1e-12);
  // 別県 → 0
  assert.strictEqual(pp(1, 3), 0);
  // 不明 → 0
  assert.strictEqual(pp(1, 4), 0);
});

test('直近対戦罰則: recentPair を W_recent で加味', () => {
  const params = O.resolveParams({});
  const pp = O.buildPairPenalty(params, {}, {}, { '1:2': 10 });
  assert.ok(Math.abs(pp(1, 2) - params.W_recent * 10) < 1e-12);
  assert.ok(Math.abs(pp(2, 1) - params.W_recent * 10) < 1e-12); // 対称
});

test('トグル: avoidRegion=false で地域罰則が消える / avoidRecent=false で直近罰則が消える', () => {
  const prefByUid = { 1: '東京都', 2: '東京都' };
  const prefCounts = { 東京都: 2 };
  const recent = { '1:2': 10 };
  // 地域 OFF（直近のみ）。
  const ppNoReg = O.buildPairPenalty(O.resolveParams({ avoidRegion: false }), prefByUid, prefCounts, recent);
  assert.ok(Math.abs(ppNoReg(1, 2) - 0.3 * 10) < 1e-12, '地域成分は0・直近のみ: ' + ppNoReg(1, 2));
  // 直近 OFF（地域のみ）。東京2人 → 1.0 * 1/sqrt(2)。
  const ppNoRec = O.buildPairPenalty(O.resolveParams({ avoidRecent: false }), prefByUid, prefCounts, recent);
  assert.ok(Math.abs(ppNoRec(1, 2) - 1.0 / Math.sqrt(2)) < 1e-12, '直近成分は0・地域のみ: ' + ppNoRec(1, 2));
  // 両方 OFF → 常に0。
  const ppNone = O.buildPairPenalty(O.resolveParams({ avoidRegion: false, avoidRecent: false }), prefByUid, prefCounts, recent);
  assert.strictEqual(ppNone(1, 2), 0);
});

test('トグル: enableIntra=false（P>=2）で intra を走らせない / P==1 では無視して常に実行', () => {
  const base = (extra) => Object.assign({
    poolCount: 2, format: 'DOUBLE_ELIMINATION',
    ranking: [1, 2, 3, 4, 5, 6, 7, 8], prefByUid: {}, recentPair: {},
    params: { rngSeed: 1 },
  }, extra);
  // P=2, intra OFF → runIntra false・bracketByPool は null。
  const off = O.optimize(base({ params: { rngSeed: 1, enableIntra: false } }), {});
  assert.strictEqual(off.ranAfter.runIntra, false);
  assert.strictEqual(off.bracketByPool, null);
  // P=2, 既定（intra ON）。
  const on = O.optimize(base({}), {});
  assert.strictEqual(on.ranAfter.runIntra, true);
  // P=1×DE は enableIntra=false でも intra が唯一の手段＝常に実行。
  const p1 = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION',
    ranking: [1, 2, 3, 4], prefByUid: {}, recentPair: {},
    params: { rngSeed: 1, enableIntra: false },
  }, {});
  assert.strictEqual(p1.ranAfter.runIntra, true);
  assert.strictEqual(p1.ranAfter.runInter, false);
});

// ───────── 各トグルの「動作」結合テスト（プール/回戦への実効果） ─────────
// 基準 snake（P=2,N=8）: pool0={seed1,4,5,8}, pool1={seed2,3,6,7}。
const _sp = (order, a, b) => O.poolsFromSeedOrder(order, 2).some((p) => p.includes(a) && p.includes(b));
const _meet = (order, a, b) => {
  for (const pool of O.poolsFromSeedOrder(order, 2)) {
    const ia = pool.indexOf(a), ib = pool.indexOf(b);
    if (ia >= 0 && ib >= 0) { const sm = O.slotOfSeedMap(O.nextPow2(pool.length)); return O.earliestMeetRound(sm[ia + 1], sm[ib + 1]); }
  }
  return null;
};

test('動作: avoidRegion ON は同地域ペアを別プールへ分離 / OFF は基準のまま', () => {
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  // uid1(seed1,固定) と uid5(seed5,可動) は基準では同プール0。
  const data = { prefByUid: { 1: 'X', 5: 'X' }, prefCounts: { X: 2 }, recentPair: {} };
  const run = (extra) => O.optimize(Object.assign({ poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking }, data,
    { params: Object.assign({ rngSeed: 1 }, extra) }), {}).seedOrder;
  assert.ok(_sp(ranking, 1, 5), '前提: 基準は同プール');
  assert.strictEqual(_sp(run({}), 1, 5), false, 'ON → 分離');
  assert.strictEqual(_sp(run({ avoidRegion: false }), 1, 5), true, 'OFF → 基準のまま同プール');
});

test('動作: avoidRecent ON は直近対戦ペアを別プールへ分離 / OFF は基準のまま', () => {
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  const data = { prefByUid: {}, prefCounts: {}, recentPair: { '1:5': 5 } };
  const run = (extra) => O.optimize(Object.assign({ poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking }, data,
    { params: Object.assign({ rngSeed: 1 }, extra) }), {}).seedOrder;
  assert.strictEqual(_sp(run({}), 1, 5), false, 'ON → 分離');
  assert.strictEqual(_sp(run({ avoidRecent: false }), 1, 5), true, 'OFF → 基準のまま同プール');
});

test('動作: enableIntra ON は同プール強制ペアの当たり回戦を遅らせる / OFF は基準ブラケット', () => {
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  // kInter=[0] で inter を封じ、uid1(pool0 rank1) と uid8(pool0 rank4) を強制同プール＝基準では R1 で当たる。
  const data = { prefByUid: { 1: 'Y', 8: 'Y' }, prefCounts: { Y: 2 }, recentPair: {} };
  const run = (intra) => O.optimize(Object.assign({ poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking }, data,
    { params: { rngSeed: 1, kInter: [0], enableIntra: intra } }), {});
  const off = run(false), on = run(true);
  assert.ok(_sp(off.seedOrder, 1, 8) && _sp(on.seedOrder, 1, 8), '前提: inter 封鎖で常に同プール');
  // OFF: intra 走らせない → ブラケット未生成・基準のまま R1。
  assert.strictEqual(off.bracketByPool, null);
  assert.strictEqual(off.ranAfter.runIntra, false);
  assert.strictEqual(_meet(off.seedOrder, 1, 8), 1);
  // ON: プール内を並べ替えて R2 へ遅延。
  assert.ok(on.bracketByPool);
  assert.strictEqual(on.ranAfter.runIntra, true);
  assert.strictEqual(_meet(on.seedOrder, 1, 8), 2);
});

// ───────── W_region と W_recent の大小は自由（2026-07 に強制を撤廃） ─────────
test('W_region <= W_recent でも例外にならない（どちらを優先するかは運用判断）', () => {
  assert.doesNotThrow(() => O.resolveParams({ W_region: 0.3, W_recent: 0.3 }));
  assert.doesNotThrow(() => O.resolveParams({ W_region: 0.1, W_recent: 0.5 }));
  assert.doesNotThrow(() => O.resolveParams({ W_region: 0.1, W_recent: 0.5, avoidRegion: false }));
  assert.doesNotThrow(() => O.resolveParams({ W_region: 0.1, W_recent: 0.5, avoidRecent: false }));
});

test('形式ゲーティング: 1プール×非DE は非対応（計算しない）', () => {
  const base = {
    poolCount: 1, format: 'SINGLE_ELIMINATION',
    ranking: [1, 2, 3, 4], prefByUid: {}, recentPair: {},
  };
  const r = O.optimize(base, {});
  assert.strictEqual(r.unsupported, true);
  assert.ok(/非対応/.test(r.reason));
});

test('形式ゲーティング: 分岐マトリクス', () => {
  assert.deepStrictEqual(O.gateFormat(4, 'DOUBLE_ELIMINATION'), { runInter: true, runIntra: true });
  assert.deepStrictEqual(O.gateFormat(4, 'SINGLE_ELIMINATION'), { runInter: true, runIntra: false });
  assert.deepStrictEqual(O.gateFormat(4, 'ROUND_ROBIN'), { runInter: true, runIntra: false });
  assert.deepStrictEqual(O.gateFormat(1, 'DOUBLE_ELIMINATION'), { runInter: false, runIntra: true });
  assert.strictEqual(O.gateFormat(1, 'SINGLE_ELIMINATION').unsupported, true);
});

// ───────── delta == full（増分評価の正しさ） ─────────
function randomCase(rng, N, P) {
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const prefs = ['東京都', '大阪府', '北海道', '福岡県', null];
  const prefByUid = {};
  for (const uid of ranking) prefByUid[uid] = prefs[Math.floor(rng() * prefs.length)];
  const recentPair = {};
  for (let t = 0; t < N; t++) {
    const a = 1 + Math.floor(rng() * N), b = 1 + Math.floor(rng() * N);
    if (a !== b) recentPair[O.pairKey(a, b)] = rng() * 5;
  }
  return { ranking, prefByUid, recentPair };
}

test('inter/intra の delta は full 再計算と一致（_verifyDelta）', () => {
  const rng = O.makeRng(99);
  for (let trial = 0; trial < 5; trial++) {
    const N = 24 + Math.floor(rng() * 20);
    const P = 1 + Math.floor(rng() * 4);
    const c = randomCase(rng, N, P);
    const r = O.optimize({
      poolCount: P, format: 'DOUBLE_ELIMINATION',
      ranking: c.ranking, prefByUid: c.prefByUid, recentPair: c.recentPair,
      params: { _verifyDelta: true, restarts: 3, maxIters: 400, rngSeed: 7 + trial },
    }, {});
    // 例外が出なければ delta は full と一致している。
    assert.ok(r.seedOrder);
  }
});

// ───────── 多点スタートの初期攪乱（Worker経由用） ─────────
test('_perturbStart: 攪乱スタートでも permutation & inter制約遵守 & delta整合', () => {
  const N = 40, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const recentPair = {};
  for (let a = 1; a <= N; a++) for (let b = a + 1; b <= N; b++) recentPair[a + ':' + b] = 1;
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { _perturbStart: true, _verifyDelta: true, restarts: 1, maxIters: 400, rngSeed: 4 },
  }, {});
  // permutation
  assert.deepStrictEqual([...r.seedOrder].sort((a, b) => a - b), [...ranking].sort((a, b) => a - b));
  // inter 制約（初期プール±k_inter(row)）は攪乱後も守られる
  const kInter = O.kInterFn(O.resolveParams({}));
  const initPool = {}; ranking.forEach((u, s) => { initPool[u] = O.poolOfSeed(s, P); });
  const finalPool = {}; r.seedOrder.forEach((u, s) => { finalPool[u] = O.poolOfSeed(s, P); });
  ranking.forEach((u, s) => {
    const row1 = O.rowOfSeed(s, P) + 1;
    assert.ok(Math.abs(finalPool[u] - initPool[u]) <= kInter(row1), `uid ${u} が制約超過`);
  });
});

test('プール間移動した選手もプール内で ±kIntra まで動ける（旧: 完全固定）', () => {
  const N = 32, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // 同一プール(P0)に集まる seed に同地域を割り当て、inter に分散(=移動)を強制する。
  const p0uids = ranking.filter((u, i) => O.poolOfSeed(i, P) === 0); // {1,8,9,16,17,24,25,32}
  const prefByUid = {};
  prefByUid[p0uids[0]] = 'R'; prefByUid[p0uids[1]] = 'R';
  prefByUid[p0uids[2]] = 'S'; prefByUid[p0uids[3]] = 'S';
  prefByUid[p0uids[4]] = 'T'; prefByUid[p0uids[5]] = 'T';
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: {},
    params: { rngSeed: 8, restarts: 8, maxIters: 1500 },
  }, {});
  const kIntra = O.kIntraFn(O.resolveParams({}));
  const initPool = {}, initRow = {};
  ranking.forEach((u, s) => { initPool[u] = O.poolOfSeed(s, P); initRow[u] = O.rowOfSeed(s, P); });
  const finalPool = {}, finalRow = {};
  r.seedOrder.forEach((u, s) => { finalPool[u] = O.poolOfSeed(s, P); finalRow[u] = O.rowOfSeed(s, P); });
  const M = N / P;
  let movers = 0;
  for (const u of ranking) {
    if (finalPool[u] !== initPool[u]) {
      movers++;
      // 移動者も他と同じ ±kIntra(初期プール内順位) 内に収まる（固定はされない）。
      const k = kIntra(initRow[u] + 1, M);
      assert.ok(Math.abs(finalRow[u] - initRow[u]) <= k,
        `移動した uid ${u} の intra 変位 ${Math.abs(finalRow[u] - initRow[u])} > ±${k}`);
    }
  }
  assert.ok(movers > 0, 'プール間移動が一度も起きていない（テスト不成立）');
});

// ───────── 可動制約の遵守 ─────────
test('inter: プール内1位は固定、2位は±1（初期順位基準）', () => {
  const N = 16, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // 全ペア罰則を強くして攪乱を最大化
  const recentPair = {};
  for (let a = 1; a <= N; a++) for (let b = a + 1; b <= N; b++) recentPair[a + ':' + b] = 1;
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { restarts: 6, maxIters: 2000, rngSeed: 3 },
  }, {});
  // 各 uid の最終プールを計算し、初期プールとの差が k_inter(row) 以内か検証。
  const initPoolOf = (seed1) => O.poolOfSeed(seed1 - 1, P);
  const finalPoolOf = {};
  r.seedOrder.forEach((uid, s) => { finalPoolOf[uid] = O.poolOfSeed(s, P); });
  for (let s = 0; s < N; s++) {
    const uid = ranking[s];              // uid==seed1 のときの初期 seed index = uid-1
    const row1 = Math.floor((uid - 1) / P) + 1;
    // default kInter: row 1,2 = 0（固定）、row>=3 は 2^(row-3)（kInterFn と同式）。
    const kMax = row1 <= 2 ? 0 : Math.pow(2, row1 - 3);
    const moved = Math.abs(finalPoolOf[uid] - initPoolOf(uid));
    assert.ok(moved <= kMax, `uid ${uid} (row ${row1}) moved ${moved} > ${kMax}`);
  }
});

test('intra: 上位1/4は動かない（初期 within-pool 順位基準・既定凸ランプ）', () => {
  const N = 16, P = 1; // 1プール DE → intra のみ
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const recentPair = {};
  for (let a = 1; a <= N; a++) for (let b = a + 1; b <= N; b++) recentPair[a + ':' + b] = 1;
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { restarts: 6, maxIters: 2000, rngSeed: 5 },
  }, {});
  const q = Math.ceil(N / 4);   // 上位1/4は allowance 0 = 固定
  const finalRankOf = {};
  r.pools[0].forEach((uid, idx) => { finalRankOf[uid] = idx + 1; });
  for (let rank1 = 1; rank1 <= q; rank1++) {
    const uid = ranking[rank1 - 1];
    assert.strictEqual(finalRankOf[uid], rank1, `上位1/4 uid ${uid} が動いた`);
  }
});

// ───────── ハイパラ: 配列指定の可動制約 ─────────
test('kInter / kIntra に配列を渡せる（上級者編集用）', () => {
  const fnI = O.kInterFn({ kInter: [0, 1, 2] });
  assert.strictEqual(fnI(1), 0);
  assert.strictEqual(fnI(2), 1);
  assert.strictEqual(fnI(5), 2);   // 範囲外は末尾
  const fnA = O.kIntraFn({ kIntra: [0, 0, 3] });
  assert.strictEqual(fnA(1, 16), 0);
  assert.strictEqual(fnA(3, 16), 3);
  assert.strictEqual(fnA(9, 16), 3);  // 範囲外は末尾
  // 既定（配列なし）は「上位1/4=0, 残り=1」。M=16 → 1-4:0, 5-16:1。
  const fnD = O.kIntraFn({});
  assert.deepStrictEqual([1, 4, 5, 8, 12, 16].map(r => fnD(r, 16)), [0, 0, 1, 1, 1, 1]);
});

// ───────── 改善・不悪化・出力妥当性 ─────────
test('最適化はスコアを悪化させない（after <= before）', () => {
  const rng = O.makeRng(1);
  for (let trial = 0; trial < 4; trial++) {
    const N = 32, P = 4;
    const c = randomCase(rng, N, P);
    const r = O.optimize({
      poolCount: P, format: 'DOUBLE_ELIMINATION',
      ranking: c.ranking, prefByUid: c.prefByUid, recentPair: c.recentPair,
      params: { rngSeed: 11 + trial },
    }, {});
    assert.ok(r.report.after.total <= r.report.before.total + 1e-9,
      `after ${r.report.after.total} > before ${r.report.before.total}`);
  }
});

test('構築ケース: 同県の早期被りを実際に解消する', () => {
  // 4プール、seed1..4 が全員「東京都」。snake だと別プールに散るので、地域被りはむしろ
  // プール内最適化の効きを見る: 同プールに同県が来ないように。
  // ここでは 8人2プールで、seed1,seed4 を同県にし pp を確認。
  const N = 8, P = 2;
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  // 東京都を seed4,seed5 に（snake で同じプール: P1={1,4,5,8}）。これを分離できるはず。
  const prefByUid = { 4: '東京都', 5: '東京都' };
  const before = O.optimize({
    poolCount: P, format: 'ROUND_ROBIN', ranking, prefByUid, recentPair: {},
    params: { rngSeed: 2, restarts: 8, maxIters: 1000 },
  }, {});
  // ROUND_ROBIN なので inter のみ。改善後は同県ペアが同プールに無いことを期待。
  const pools = before.pools;
  let sameTokyoSamePool = false;
  for (const pool of pools) {
    const tk = pool.filter((u) => prefByUid[u] === '東京都');
    if (tk.length >= 2) sameTokyoSamePool = true;
  }
  assert.strictEqual(sameTokyoSamePool, false, '東京都2人が同プールに残った');
});

test('出力妥当性: seedOrder は ranking の置換、プールサイズは snake 通り', () => {
  const N = 30, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 100);
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: {},
    params: { rngSeed: 9 },
  }, {});
  assert.deepStrictEqual([...r.seedOrder].sort((a, b) => a - b),
    [...ranking].sort((a, b) => a - b));
  assert.deepStrictEqual(r.pools.map((p) => p.length),
    O.poolsFromSeedOrder(ranking, P).map((p) => p.length));
});

test('決定性: 同じ rngSeed なら同じ結果', () => {
  const N = 28, P = 4;
  const rng = O.makeRng(42);
  const c = randomCase(rng, N, P);
  const inp = {
    poolCount: P, format: 'DOUBLE_ELIMINATION',
    ranking: c.ranking, prefByUid: c.prefByUid, recentPair: c.recentPair,
    params: { rngSeed: 777 },
  };
  const r1 = O.optimize(inp, {});
  const r2 = O.optimize(inp, {});
  assert.deepStrictEqual(r1.seedOrder, r2.seedOrder);
});

// ───────── レポート: 少数派/多数派の地域被り分類 ─────────
test('レポート: 少数派(分離可能)と多数派(不可避)の地域被りを分類', () => {
  const N = 8, P = 2;
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  // X県=2名(<=P=2, 分離可能), Y県=6名(>P, 鳩の巣で不可避)
  const prefByUid = { 1: 'X', 2: 'X', 3: 'Y', 4: 'Y', 5: 'Y', 6: 'Y', 7: 'Y', 8: 'Y' };
  const r = O.optimize({
    poolCount: P, format: 'ROUND_ROBIN', ranking, prefByUid, recentPair: {},
    params: { rngSeed: 3, restarts: 8, maxIters: 800 },
  }, {});
  const reg = r.report.residualConcerns.inter.region;
  // プール間×同一地域レポート構造（4セルの①）
  assert.ok(reg.separable && typeof reg.separablePairs === 'number');
  assert.ok(reg.majority && typeof reg.majorityPairs === 'number');
  // Y(6名/2プール)は必ず同プール被りが残る → majority に計上
  assert.ok(reg.majority['Y'] > 0, 'Y が多数派被りに無い');
  assert.ok(reg.majorityPairs > 0);
  // X(2名)は分離可能 → 理想は separable 被り 0
  assert.strictEqual(reg.separablePairs, 0, 'X(少数派)が分離されていない');
  // 地域バランス: poolComposition は P 個、spread の total が県人数と一致
  assert.strictEqual(reg.poolComposition.length, 2);
  assert.strictEqual(reg.spread['Y'].total, 6);
  assert.strictEqual(reg.spread['X'].total, 2);
  // 各プールの内訳合計（既知+不明）= プールサイズ
  for (const pc of reg.poolComposition) {
    const known = Object.values(pc.counts).reduce((s, n) => s + n, 0);
    assert.strictEqual(known + pc.unknown, pc.size);
  }
});

test('レポート: 直近対戦は半年(reportRecentMaxDays)以内のみ表示（スコアは全期間）', () => {
  const ranking = [1, 2, 3, 4];
  const recentPair = { '1:2': 5, '3:4': 5 };   // 両ペアともスコアには効く
  const recentMeta = {
    '1:2': { penalty: 5, count: 1, lastDate: '2026-03-01', lastDeltaDays: 100 },  // 半年以内
    '3:4': { penalty: 5, count: 1, lastDate: '2025-12-01', lastDeltaDays: 200 },  // 半年超
  };
  const r = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair, recentMeta,
    params: { rngSeed: 1, restarts: 2, maxIters: 200 },   // reportRecentMaxDays 既定182.5
  }, {});
  const top = r.report.residualConcerns.inter.recent.top;
  const keys = top.map(c => (c.a < c.b ? c.a + ':' + c.b : c.b + ':' + c.a));
  assert.ok(keys.includes('1:2'), '半年以内のペアが出ていない');
  assert.ok(!keys.includes('3:4'), '半年超のペアが出ている');
  assert.strictEqual(r.report.residualConcerns.inter.recent.pairs, 1);
});

// ───────── 中断 ─────────
test('shouldStop で途中打ち切り（stoppedEarly）', () => {
  const N = 40, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  let calls = 0;
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: {},
    params: { rngSeed: 1, restarts: 50, maxIters: 100000 },
  }, { shouldStop: () => (++calls > 3) });
  assert.ok(r.seedOrder);   // best-so-far を返す
});

// ───────── レビュー修正の回帰テスト ─────────

test('resolveParams: 退行系パラメータは黙って受理せず throw', () => {
  // roundWeights 空/負 → 以前は NaN スコアで無言の恒等解になっていた。
  assert.throws(() => O.resolveParams({ roundWeights: [] }), /roundWeights/);
  assert.throws(() => O.resolveParams({ roundWeights: [1, -0.5] }), /roundWeights/);
  // kInter/kIntra の負値 → 以前は全 swap 拒否で無言の恒等解。
  assert.throws(() => O.resolveParams({ kInter: [0, -1] }), /kInter/);
  assert.throws(() => O.resolveParams({ kIntra: [0, NaN] }), /kIntra/);
  // 未知 mode → 以前は単発 hillclimb に無言降格。
  assert.throws(() => O.resolveParams({ mode: 'simulated-annealing' }), /mode/);
  // 正常系はそのまま通る。
  assert.doesNotThrow(() => O.resolveParams({ mode: 'multistart-sa', roundWeights: [1, 0.5], kInter: [0, 1], kIntra: [0, 1] }));
});

test('report: recentPair のみ（recentMeta なし＝docs §8.1 の契約）でも直対成分が載る', () => {
  const N = 8, P = 2;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const recentPair = { '1:4': 2 };   // snake で uid1,4 は同プール
  const base = {
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { restarts: 2, maxIters: 500, rngSeed: 1 },
  };
  const noMeta = O.optimize(base, {});
  const withMeta = O.optimize(Object.assign({}, base, {
    recentMeta: { '1:4': { penalty: 2, count: 1, lastDate: '2026-06-01', lastDeltaDays: 10 } },
  }), {});
  // 以前は recentMeta なしだと before/after から直対成分が消えていた。
  assert.ok(noMeta.report.before.total > 0, 'recentMeta なしで before.total が 0');
  assert.ok(Math.abs(noMeta.report.before.total - withMeta.report.before.total) < 1e-12);
  assert.ok(Math.abs(noMeta.report.after.total - withMeta.report.after.total) < 1e-12);
});

test('動作: 両罰則 OFF は恒等出力（W_order による攪乱もしない）', () => {
  const N = 16, P = 2;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const prefByUid = { 1: '東京都', 4: '東京都', 2: '大阪府', 7: '大阪府' };
  const recentPair = { '1:4': 3, '2:7': 3 };
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair,
    params: { avoidRegion: false, avoidRecent: false, restarts: 3, maxIters: 1000, rngSeed: 7 },
  }, {});
  assert.deepStrictEqual(r.seedOrder, ranking);
  assert.strictEqual(r.report.after.total, 0);
});

test('intra: 非2冪プール(M=13, bye あり)で有限スコア・不悪化・上位固定・決定的', () => {
  const N = 13, P = 1;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const recentPair = {};
  for (let a = 1; a <= N; a++) for (let b = a + 1; b <= N; b++) recentPair[a + ':' + b] = 1;
  const input = {
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { restarts: 4, maxIters: 2000, rngSeed: 9 },
  };
  const r = O.optimize(input, {});
  assert.ok(Number.isFinite(r.report.after.total), 'NaN スコア');
  assert.ok(r.report.after.total <= r.report.before.total + 1e-9, '悪化');
  // 上位 rank1 <= M/4 (= 3.25 → 1..3) は kIntra 既定で固定。
  r.pools[0].slice(0, 3).forEach((uid, i) => assert.strictEqual(uid, i + 1, `上位固定が破れた: ${r.pools[0]}`));
  // 決定性
  const r2 = O.optimize(input, {});
  assert.deepStrictEqual(r2.seedOrder, r.seedOrder);
});

test('report: P==1 の improvementPct は intra 成分基準（定数 inter で希釈しない）', () => {
  const N = 8, P = 1;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const recentPair = { '1:8': 1, '2:5': 1 };
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { restarts: 4, maxIters: 2000, rngSeed: 11 },
  }, {});
  const rep = r.report;
  // inter(プール所属ペア罰則) は P=1 で不変。
  assert.ok(Math.abs(rep.before.inter - rep.after.inter) < 1e-12);
  const expected = rep.before.intra > 0 ? (1 - rep.after.intra / rep.before.intra) * 100 : 0;
  assert.ok(Math.abs(rep.improvementPct - expected) < 1e-9,
    `improvementPct=${rep.improvementPct} expected=${expected}`);
});

// ───────── intra オフでもプール内レポートは出す（既定ブラケット順の当たり） ─────────
test('レポート: enableIntra=false でもプール内(intra)レポートが出る（DE のみ）', () => {
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  // snake P=2: pool0={1,4,5,8}。1×5 は同プールで早期回戦に当たり得る。
  const recentPair = { '1:5': 3 };
  const r = O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION',
    ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1, enableIntra: false, avoidRegion: false, avoidRecent: false },
  }, {});
  // 両罰則 OFF ＝ 恒等出力だが、レポートには既定ブラケット順の当たりが載る。
  assert.strictEqual(r.ranAfter.runIntra, false);
  assert.strictEqual(r.bracketByPool, null);
  const intra = r.report.residualConcerns.intra;
  assert.ok(intra, 'enableIntra=false で intra レポートが消えている');
  assert.ok(intra.recent.pairs >= 1, 'プール内直近対戦ペアが載っていない');
  for (const it of intra.recent.top) assert.ok(typeof it.round === 'number', 'round が数値でない');
  // プール間レポート側の round も数値が入る（DE なら当たり回戦は確定しているため）。
  for (const it of r.report.residualConcerns.inter.recent.top) {
    assert.ok(typeof it.round === 'number');
  }
  // 非 DE（プール内の当たり回戦が確定しない形式）では従来どおり intra レポートなし。
  const rr = O.optimize({
    poolCount: 2, format: 'ROUND_ROBIN',
    ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1 },
  }, {});
  assert.strictEqual(rr.report.residualConcerns.intra, null);
});

// ───────── maxSeedShift（シード番号ベースの変位キャップ） ─────────
test('maxSeedShift: 変位がキャップ内に収まり、0 で恒等、null は無制限', () => {
  const N = 16, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // snake P=4: pool0={1,8,9,16}。9×16 を強い直近対戦ペアにして分離させたい状況を作る。
  const recentPair = { '9:16': 10 };
  const maxAbsDelta = (r) => {
    let m = 0;
    r.seedOrder.forEach((u, i) => { m = Math.max(m, Math.abs((i + 1) - u)); }); // uid=元順位
    return m;
  };
  const run = (extra) => O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION',
    ranking, prefByUid: {}, recentPair,
    params: Object.assign({ rngSeed: 1 }, extra),
  }, {});
  // 無制限（既定）: ペアを分離するために誰かが動く。
  const free = run({});
  assert.ok(maxAbsDelta(free) >= 1, '基準ケースで誰も動かない（フィクスチャ不良）');
  // キャップ 1: 全員 |Δ| <= 1 かつ permutation。
  const cap1 = run({ maxSeedShift: 1 });
  assert.ok(maxAbsDelta(cap1) <= 1, `maxSeedShift=1 なのに |Δ|=${maxAbsDelta(cap1)}`);
  assert.deepStrictEqual(cap1.seedOrder.slice().sort((a, b) => a - b), ranking);
  // キャップ 0: 恒等出力。
  const cap0 = run({ maxSeedShift: 0 });
  assert.deepStrictEqual(cap0.seedOrder, ranking);
});

test('maxSeedShift: intra との合成後も元順位比でキャップされる', () => {
  const N = 16, P = 2;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // P=2 は intra ±1 行で snake 上 |Δ| が最大 2P-1=3 になり得る。キャップ 2 で抑える。
  const recentPair = { '1:4': 5, '5:8': 5, '9:12': 5 };
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION',
    ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 7, maxSeedShift: 2 },
  }, {});
  let m = 0;
  r.seedOrder.forEach((u, i) => { m = Math.max(m, Math.abs((i + 1) - u)); });
  assert.ok(m <= 2, `maxSeedShift=2 なのに |Δ|=${m}`);
  assert.deepStrictEqual(r.seedOrder.slice().sort((a, b) => a - b), ranking);
});

test('resolveParams: maxSeedShift の負値/非数は throw', () => {
  assert.throws(() => O.resolveParams({ maxSeedShift: -1 }), /maxSeedShift/);
  assert.throws(() => O.resolveParams({ maxSeedShift: 'abc' }), /maxSeedShift/);
  assert.doesNotThrow(() => O.resolveParams({ maxSeedShift: null }));
  assert.doesNotThrow(() => O.resolveParams({ maxSeedShift: 0 }));
  assert.doesNotThrow(() => O.resolveParams({ maxSeedShift: 5 }));
});

test('デフォルト: orderPow は 2（大移動を2乗で抑制）', () => {
  assert.strictEqual(O.resolveParams({}).orderPow, 2);
  assert.strictEqual(O.DEFAULT_PARAMS.orderPow, 2);
});

test('dePlaceOfSeed: DE 想定順位のタイ帯 (1,2,3,4,5,5,7,7,9×4,13×4,17×8,…)', () => {
  const got = Array.from({ length: 32 }, (_, i) => O.dePlaceOfSeed(i + 1));
  assert.deepStrictEqual(got, [
    1, 2, 3, 4,
    5, 5, 7, 7,
    9, 9, 9, 9, 13, 13, 13, 13,
    17, 17, 17, 17, 17, 17, 17, 17,
    25, 25, 25, 25, 25, 25, 25, 25,
  ]);
  // 帯境界のスポットチェック (帯幅は2段ごとに倍: 16×2 → 32×2 …)
  assert.strictEqual(O.dePlaceOfSeed(33), 33);
  assert.strictEqual(O.dePlaceOfSeed(48), 33);
  assert.strictEqual(O.dePlaceOfSeed(49), 49);
  assert.strictEqual(O.dePlaceOfSeed(64), 49);
  assert.strictEqual(O.dePlaceOfSeed(65), 65);
  assert.strictEqual(O.dePlaceOfSeed(96), 65);
  assert.strictEqual(O.dePlaceOfSeed(97), 97);
  assert.strictEqual(O.dePlaceOfSeed(128), 97);
  assert.strictEqual(O.dePlaceOfSeed(129), 129);
});

// ───────── keepDePlace（DE 想定順位不変制約） ─────────
test('keepDePlace: 全員の DE 想定順位が元シードから不変（inter/intra 合成後）', () => {
  const N = 16, P = 2;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // 可動域を広く取り（kInter/kIntra=9）、強い直近対戦ペアを複数入れて
  // 制約なしなら DE 想定順位を跨ぐ移動が起きる状況を作る。
  const wide = Array.from({ length: 16 }, () => 9);
  const recentPair = { '1:4': 10, '5:8': 10, '9:12': 10, '13:16': 10 };
  const run = (extra) => O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION',
    ranking, prefByUid: {}, recentPair,
    params: Object.assign({ rngSeed: 1, kInter: wide, kIntra: wide }, extra),
  }, {});
  const deChanged = (r) =>
    r.seedOrder.filter((u, i) => O.dePlaceOfSeed(i + 1) !== O.dePlaceOfSeed(u)).length;
  // 基準: 制約なしでは DE 想定順位が変わる移動が起きる（フィクスチャ確認）。
  const free = run({});
  assert.ok(deChanged(free) >= 1, '基準ケースで DE 想定順位が誰も変わらない（フィクスチャ不良）');
  // keepDePlace=true: 全員不変 & permutation 維持。
  const kept = run({ keepDePlace: true });
  kept.seedOrder.forEach((u, i) => {
    assert.strictEqual(O.dePlaceOfSeed(i + 1), O.dePlaceOfSeed(u),
      `uid=${u}: seed ${u}→${i + 1} で DE 想定順位 ${O.dePlaceOfSeed(u)}→${O.dePlaceOfSeed(i + 1)}`);
  });
  assert.deepStrictEqual(kept.seedOrder.slice().sort((a, b) => a - b), ranking);
});

test('keepDePlace: 同タイ帯内の移動は許可され、改善はできる', () => {
  const N = 16, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // pool0={1,8,9,16}。9×16 は seed16↔13/14/15（全員タイ帯13）の inter 入替で
  // タイ帯を変えずに分離できる。
  const recentPair = { '9:16': 10 };
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION',
    ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1, keepDePlace: true },
  }, {});
  r.seedOrder.forEach((u, i) => {
    assert.strictEqual(O.dePlaceOfSeed(i + 1), O.dePlaceOfSeed(u));
  });
  // 9 と 16 が別プールに分離されている（同タイ帯内の入替で達成可能）。
  const poolOfUid = {};
  r.seedOrder.forEach((u, i) => { poolOfUid[u] = O.poolOfSeed(i, P); });
  assert.notStrictEqual(poolOfUid[9], poolOfUid[16], '同タイ帯内の入替による分離ができていない');
  assert.ok(r.report.after.total < r.report.before.total, 'スコアが改善していない');
});

test('keepDePlace: 既定は false・truthy 値は boolean に正規化', () => {
  assert.strictEqual(O.DEFAULT_PARAMS.keepDePlace, false);
  assert.strictEqual(O.resolveParams({}).keepDePlace, false);
  assert.strictEqual(O.resolveParams({ keepDePlace: true }).keepDePlace, true);
  assert.strictEqual(O.resolveParams({ keepDePlace: 1 }).keepDePlace, true);
  assert.strictEqual(O.resolveParams({ keepDePlace: 'yes' }).keepDePlace, true);
  assert.strictEqual(O.resolveParams({ keepDePlace: null }).keepDePlace, false);
});

test('レポート: 直近対戦ペアに個別対戦履歴 (matches) が通る（無ければ null）', () => {
  const ranking = [1, 2, 3, 4];
  const recentPair = { '1:2': 5, '3:4': 5 };
  const recentMeta = {
    '1:2': { penalty: 5, count: 2, lastDate: '2026-06-20', lastDeltaDays: 3,
             lastTournament: '大会B', lastNent: 16,
             matches: [{ date: '2026-06-20', tournament: '大会B', nent: 16 },
                       { date: '2026-05-01', tournament: '大会A', nent: 64 }] },
    '3:4': { penalty: 5, count: 1, lastDate: '2026-06-20', lastDeltaDays: 3 },  // 旧形式 (matches なし)
  };
  const r = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair, recentMeta,
    params: { rngSeed: 1, restarts: 2, maxIters: 200 },
  }, {});
  const top = r.report.residualConcerns.intra.recent.top;
  const k = (c) => (c.a < c.b ? c.a + ':' + c.b : c.b + ':' + c.a);
  const i12 = top.find((c) => k(c) === '1:2');
  const i34 = top.find((c) => k(c) === '3:4');
  assert.ok(i12, '1:2 がレポートに無い');
  assert.deepStrictEqual(i12.matches.map((m) => m.tournament), ['大会B', '大会A']);
  assert.ok(i34, '3:4 がレポートに無い');
  assert.strictEqual(i34.matches, null);
});

// ───────── bracketScope: 'winners'（勝者側ブラケット最適化） ─────────
test('winners: DE想定順位不変・permutation維持・seed1-4不動・delta==full', () => {
  const N = 24;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // 動きが起きるように強い直近ペアを散らす（同タイ帯内で解消可能なものを含む）。
  const recentPair = { '8:9': 10, '5:12': 10, '17:24': 10, '13:16': 5 };
  const r = O.optimize({
    poolCount: 4, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1, bracketScope: 'winners', _verifyDelta: true },
  }, {});
  assert.ok(!r.unsupported);
  r.seedOrder.forEach((u, i) => {
    assert.strictEqual(O.dePlaceOfSeed(i + 1), O.dePlaceOfSeed(u),
      `uid=${u}: seed ${u}→${i + 1} で DE 想定順位が変化`);
  });
  assert.deepStrictEqual(r.seedOrder.slice().sort((a, b) => a - b), ranking);
  assert.deepStrictEqual(r.seedOrder.slice(0, 4), [1, 2, 3, 4]);  // 単独タイ帯は不動
  // 勝者側は「追加」フェーズ: P>=2 ではプール最適化 (inter/intra) も実行される。
  assert.deepStrictEqual(r.ranAfter, { runInter: true, runIntra: true, runWinners: true });
});

test('winners: kIntra 級の±幅を超える帯内移動で R1 地域被りを解消できる', () => {
  const N = 16;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // 16 ブラケットの R1: (1,16),(8,9),(4,13),(5,12),(2,15),(7,10),(3,14),(6,11)。
  // uid7,8,9 を同地域にすると初期 R1 の (8,9) が被り。seed10 は 7 と当たるので、
  // uid9 はタイ帯 {9..12} 内で seed11/12 へ動く（変位 2-3 = kIntra 既定±1 では不可能）必要がある。
  const prefByUid = { 7: '東京都', 8: '東京都', 9: '東京都' };
  const run = (extra) => O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: {},
    params: Object.assign({ rngSeed: 1, bracketScope: 'winners' }, extra),
  }, {});
  const r = run({});
  const pos1 = (res, uid) => res.seedOrder.indexOf(uid) + 1;   // 1始まりシード
  const slotOf = O.slotOfSeedMap(16);
  const r1opp = (res, uid) => {
    const s = slotOf[pos1(res, uid)];
    const partnerSlot = (s % 2 === 0) ? s + 1 : s - 1;
    const partnerSeed = O.seedSlotOrder(16)[partnerSlot];
    return res.seedOrder[partnerSeed - 1];
  };
  // R1 の同地域被りが全て解消されている。
  for (const uid of [7, 8, 9]) {
    const opp = r1opp(r, uid);
    assert.notStrictEqual(prefByUid[opp], '東京都', `uid=${uid} が R1 で同地域 ${opp} と当たる`);
  }
  // uid9 は ±1 を超えて動いている（勝者側スコープでは可動制約が無いことの確認）。
  assert.ok(Math.abs(pos1(r, 9) - 9) >= 2, `uid9 の変位が ${pos1(r, 9) - 9}（±1 内 = 可動制約が効いてしまっている）`);
  // タイ帯不変は維持。
  r.seedOrder.forEach((u, i) => assert.strictEqual(O.dePlaceOfSeed(i + 1), O.dePlaceOfSeed(u)));
});

test('winners: maxSeedShift は勝者側スコープでも有効', () => {
  const N = 16;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const prefByUid = { 7: '東京都', 8: '東京都', 9: '東京都' };
  const r = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: {},
    params: { rngSeed: 1, bracketScope: 'winners', maxSeedShift: 1 },
  }, {});
  r.seedOrder.forEach((u, i) => {
    assert.ok(Math.abs((i + 1) - u) <= 1, `uid=${u} が maxSeedShift=1 を超えて seed ${i + 1} に移動`);
  });
});

test('winners: 非DEは unsupported、未知 bracketScope は throw', () => {
  const ranking = Array.from({ length: 8 }, (_, i) => i + 1);
  const r = O.optimize({
    poolCount: 2, format: 'ROUND_ROBIN', ranking, prefByUid: {}, recentPair: {},
    params: { rngSeed: 1, bracketScope: 'winners' },
  }, {});
  assert.ok(r.unsupported, '非DEで unsupported が返らない');
  assert.throws(() => O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: {},
    params: { bracketScope: 'winner' },
  }, {}), /bracketScope/);
});

test('winners: 決定性（同じ rngSeed → 同じ結果）と改善レポート', () => {
  const N = 32;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const prefByUid = {};
  // タイ帯内で分離可能な地域被りを複数作る（帯 {17..24} に同地域4人など）。
  for (const u of [17, 18, 19, 20]) prefByUid[u] = '大阪府';
  for (const u of [9, 10]) prefByUid[u] = '福岡県';
  const input = () => ({
    poolCount: 4, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: { '25:32': 5 },
    params: { rngSeed: 7, bracketScope: 'winners' },
  });
  const a = O.optimize(input(), {});
  const b = O.optimize(input(), {});
  assert.deepStrictEqual(a.seedOrder, b.seedOrder);
  // レポートは P=1 視点（intra=勝者側ブラケット成分）で、改善している。
  assert.ok(a.report.after.intra <= a.report.before.intra, '勝者側成分が改善していない');
  assert.ok(a.report.improvementPct >= 0);
  // 出力プールは実際の P (=4) で導出される。
  assert.strictEqual(a.pools.length, 4);
  assert.strictEqual(a.pools.reduce((s, p) => s + p.length, 0), N);
});

test('winners: 既定回戦重みは R1,R2 強・R3以降は緩やかな単調減少（遅らせる勾配が決勝まである）', () => {
  // 形状: [1, 0.5, 0.2, 0.2×0.9, 0.2×0.9², …] — 厳密単調減少・8回戦目でも ~0.12 で無視されない。
  const w8 = O.winnersRoundWeights(8);
  assert.strictEqual(w8.length, 8);
  assert.strictEqual(w8[0], 1.0);
  assert.strictEqual(w8[1], 0.5);
  assert.strictEqual(w8[2], 0.2);
  for (let i = 1; i < w8.length; i++) assert.ok(w8[i] < w8[i - 1], `R${i + 1} が単調減少でない`);
  assert.ok(w8[7] > 0.1, `決勝 (R8) の重み ${w8[7]} が無視レベル`);
  const run = (N, recentPair, extra) => O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION',
    ranking: Array.from({ length: N }, (_, i) => i + 1), prefByUid: {}, recentPair,
    params: Object.assign({ rngSeed: 1, bracketScope: 'winners' }, extra),
  }, {});
  // (a) R2 の直近対戦被りは後段に押し出される: B=16 で 4v5 は R2、4v6 は R4 (別ハーフ)。
  const slot16 = O.slotOfSeedMap(16);
  assert.strictEqual(O.earliestMeetRound(slot16[4], slot16[5]), 2);
  assert.strictEqual(O.earliestMeetRound(slot16[4], slot16[6]), 4);
  const a = run(16, { '4:5': 5 }, {});
  assert.strictEqual(a.seedOrder[4], 6, 'R2 被りがタイ帯 {5,6} 内の交換で押し出されていない');
  assert.strictEqual(a.seedOrder[5], 5);
  // (b) 後段にも意味: B=128 のシード通り QF は (4,5)。5↔6 交換で uid4-uid5 の対戦自体が消える。
  const b = run(128, { '4:5': 5 }, {});
  assert.strictEqual(b.seedOrder[4], 6, '後段の射影対戦 (4,5) を解消する交換が起きていない');
});

test('winners: シード通り勝ち上がり時に当たらないペアは目的に入らない', () => {
  const N = 128;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // (3,5) はシード通りでは対戦しない (5 は QF で 4 に負け、3 とは合流前に敗退)。
  const pm = O.projectedMatches(N, N);
  assert.ok(!pm.some(m => m.a === 3 && m.b === 5), 'フィクスチャ不良: (3,5) が射影対戦にある');
  const r = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: { '3:5': 100 },
    params: { rngSeed: 1, bracketScope: 'winners' },
  }, {});
  // 大罰則を付けても射影対戦に無いので誰も動かない (W_order が恒等を保つ)。
  assert.deepStrictEqual(r.seedOrder, ranking);
});

test('projectedMatches: シード通りの実対戦一覧 (フル/bye 込み)', () => {
  // B=8 フル: R1 (1,8),(4,5),(2,7),(3,6) / R2 (1,4),(2,3) / R3 (1,2) = 7 試合。
  const key = (m) => `${m.a}:${m.b}@${m.round}`;
  const full = O.projectedMatches(8, 8);
  assert.deepStrictEqual(full.map(key).sort(), [
    '1:2@3', '1:4@2', '1:8@1', '2:3@2', '2:7@1', '3:6@1', '4:5@1',
  ].sort());
  // N=6 (7,8 は bye): R1 は (4,5),(3,6) のみ・1,2 は不戦勝。試合数 = N-1 = 5。
  const bye = O.projectedMatches(6, 8);
  assert.strictEqual(bye.length, 5);
  assert.deepStrictEqual(bye.map(key).sort(), [
    '1:2@3', '1:4@2', '2:3@2', '3:6@1', '4:5@1',
  ].sort());
});

// ───────── searchStats / postPool レポート / winnersPoolRankLimit ─────────
test('searchStats: 両スコープでフェーズ別ステップ統計が返る', () => {
  const ranking = Array.from({ length: 16 }, (_, i) => i + 1);
  const recentPair = { '8:9': 5, '5:12': 5 };
  const w = O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1, bracketScope: 'winners', restarts: 1 },
  }, {});
  // 追加モード: プールフェーズ (inter/intra) + 勝者側フェーズの統計が全部載る。
  const wPhases = w.searchStats.map(s => s.phase);
  assert.ok(wPhases.includes('inter') && wPhases.includes('intra:0') && wPhases.includes('winners'),
    String(wPhases));
  const wStat = w.searchStats.find(s => s.phase === 'winners');
  assert.ok(wStat.iters > 0 && wStat.iters <= wStat.maxIters,
    `iters=${wStat.iters} maxIters=${wStat.maxIters}`);
  const p = O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1, restarts: 1 },
  }, {});
  const phases = p.searchStats.map(s => s.phase);
  assert.ok(phases.includes('inter'), String(phases));
  assert.ok(phases.includes('intra:0') && phases.includes('intra:1'), String(phases));
  for (const s of p.searchStats) assert.ok(s.iters <= s.maxIters);
});

test('レポート: 予選抜け後 (postPool) に閾値超回戦の再対戦/同地域ペアが載る', () => {
  const N = 16;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // seed1×2 は B=16 の決勝 (R4) でのみ当たる = earlyRound(3) 超 → postPool.recent 対象。
  const recentPair = { '1:2': 5 };
  // 京都2名は seed1,2 (不動)。北海道3名を最多地域にして京都が除外されないようにする。
  const prefByUid = { 1: '京都府', 2: '京都府', 13: '北海道', 14: '北海道', 15: '北海道' };
  const r = O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair,
    params: { rngSeed: 1, restarts: 1 },
  }, {});
  const pp2 = r.report.residualConcerns.postPool;
  assert.ok(pp2, 'postPool セクションが無い');
  assert.strictEqual(pp2.threshold, 3);
  const rec12 = pp2.recent.top.find(c => (c.a === 1 && c.b === 2) || (c.a === 2 && c.b === 1));
  assert.ok(rec12, '1×2 の決勝再対戦想定が postPool.recent に無い');
  assert.strictEqual(rec12.round, 4);
  assert.ok(rec12.seedA === 1 && rec12.seedB === 2);
  const reg12 = pp2.region.top.find(c => c.region === '京都府');
  assert.ok(reg12, '京都府ペアが postPool.region に無い');
  // winners スコープでも同セクションが出る。
  const w = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair,
    params: { rngSeed: 1, bracketScope: 'winners', restarts: 1 },
  }, {});
  assert.ok(w.report.residualConcerns.postPool.recent.pairs >= 1);
});

test('winners: winnersPoolRankLimit=true で kIntra 級の±制約が復活する', () => {
  const N = 16;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const prefByUid = { 7: '東京都', 8: '東京都', 9: '東京都' };
  const run = (extra) => O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: {},
    params: Object.assign({ rngSeed: 1, bracketScope: 'winners' }, extra),
  }, {});
  // OFF (既定): uid9 は ±2 以上動いて R1 被りを解消できる (既存テストと同じ挙動)。
  const off = run({});
  const disp = (res, uid) => Math.abs((res.seedOrder.indexOf(uid) + 1) - uid);
  assert.ok(disp(off, 9) >= 2, 'OFF なのに大きく動けていない');
  // ON: P=1 ではプール内順位 = グローバル順位。kIntra 既定 = 上位1/4固定・残り±1。
  const on = run({ winnersPoolRankLimit: true });
  on.seedOrder.forEach((u, i) => {
    const rank1 = u;  // uid = 元順位
    const lim = rank1 <= N / 4 ? 0 : 1;
    assert.ok(Math.abs((i + 1) - rank1) <= lim,
      `uid=${u} が制約 ±${lim} を超えて seed ${i + 1} に移動`);
  });
});

// ───────── shiftLimitRanks（順位帯ごとのシードズレ上限） ─────────
test('shiftLimitRanks: 順位帯ごとの±上限が全スコープの swap を制約する', () => {
  // winners スコープ: [null, 8, 16, 32] = 1-8位 ±1 / 9-16位 ±2 / 17-32位 ±3 / 33位〜無制限。
  const N = 64;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const recentPair = {};
  // 動きが出るよう射影対戦 (シード通りの実対戦) に広く罰則を撒く。
  for (const m of O.projectedMatches(N, N)) recentPair[`${m.a}:${m.b}`] = 3;
  const limits = [null, 8, 16, 32];
  const capOf = (rank1) => (rank1 <= 8 ? 1 : rank1 <= 16 ? 2 : rank1 <= 32 ? 3 : Infinity);
  const r = O.optimize({
    poolCount: 4, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1, bracketScope: 'winners', shiftLimitRanks: limits },
  }, {});
  let movedSomewhere = 0;
  r.seedOrder.forEach((u, i) => {
    const shift = Math.abs((i + 1) - u);   // uid = 元順位
    if (shift > 0) movedSomewhere++;
    assert.ok(shift <= capOf(u), `uid=${u} (上限±${capOf(u)}) が ${shift} ずれた`);
  });
  assert.ok(movedSomewhere > 0, '誰も動いていない (フィクスチャ不良)');
  // pools スコープでも同じ制約が効く (maxSeedShift の順位依存版として共通)。
  const p = O.optimize({
    poolCount: 4, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { rngSeed: 1, shiftLimitRanks: [null, 4] },   // 1-4位は±1・5位〜無制限
  }, {});
  p.seedOrder.forEach((u, i) => {
    if (u <= 4) assert.ok(Math.abs((i + 1) - u) <= 1, `pools: uid=${u} が±1を超えた`);
  });
});

test('shiftLimitRanks: ±0 tier で固定・バリデーション (昇順違反/不正値は throw)', () => {
  const N = 16;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  // [8] = 1-8位固定。R2 で当たる射影対戦 (4,5) に罰則を付けても動けない。
  const r = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: { '4:5': 100 },
    params: { rngSeed: 1, bracketScope: 'winners', shiftLimitRanks: [8] },
  }, {});
  assert.deepStrictEqual(r.seedOrder.slice(0, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.throws(() => O.resolveParams({ shiftLimitRanks: [16, 8] }), /昇順/);
  assert.throws(() => O.resolveParams({ shiftLimitRanks: [0] }), /shiftLimitRanks/);
  assert.throws(() => O.resolveParams({ shiftLimitRanks: 8 }), /shiftLimitRanks/);
  // shiftCapFn 単体: tier 外は Infinity。
  const cap = O.shiftCapFn(O.resolveParams({ shiftLimitRanks: [null, 8, 16] }));
  assert.strictEqual(cap(3), 1);
  assert.strictEqual(cap(9), 2);
  assert.strictEqual(cap(17), Infinity);
});

test('winners: 追加モード (P>=2) はプール分離も行い、タイ帯不変を全フェーズで維持する', () => {
  // 基準 snake (P=2): pool0={1,4,5,8}, pool1={2,3,6,7}。uid1×uid5 の同地域被りは
  // タイ帯 {5,6} 内の 5↔6 交換で分離できる (勝者側スコープでも inter が走る)。
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  const r = O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking,
    prefByUid: { 1: 'X', 5: 'X' }, prefCounts: { X: 2 }, recentPair: {},
    params: { rngSeed: 1, bracketScope: 'winners' },
  }, {});
  const pools = O.poolsFromSeedOrder(r.seedOrder, 2);
  assert.ok(!pools.some(p => p.includes(1) && p.includes(5)), '同地域ペアが別プールに分離されていない');
  r.seedOrder.forEach((u, i) => assert.strictEqual(O.dePlaceOfSeed(i + 1), O.dePlaceOfSeed(u),
    `uid=${u} の DE 想定順位が変化 (全フェーズ keepDePlace 強制が効いていない)`));
  // レポートには winners 成分が載り、total に合算される。
  assert.ok(r.report.after.winners != null);
  assert.ok(Math.abs(r.report.after.total - (r.report.after.inter + r.report.after.intra + r.report.after.winners)) < 1e-9);
});

test('initialSeedOrder: 探索開始点の差し替え (permutation 検証・origRank は ranking 基準)', () => {
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  // permutation でない initialSeedOrder は throw。
  assert.throws(() => O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: {},
    initialSeedOrder: [1, 2, 3, 4, 5, 6, 7, 9],
    params: { rngSeed: 1 },
  }, {}), /permutation/);
  // 有効な permutation なら通り、レポートの before は ranking 基準のまま。
  const init = [2, 1, 3, 4, 5, 6, 7, 8];
  const r = O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: {},
    initialSeedOrder: init,
    params: { rngSeed: 1, maxIters: 50 },
  }, {});
  assert.deepStrictEqual(r.seedOrder.slice().sort((a, b) => a - b), ranking);
});
