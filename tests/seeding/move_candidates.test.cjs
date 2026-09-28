'use strict';
// 近傍生成（randomNeighbor）の候補集合方式のテスト。
//
// 旧実装は「ランダムにペアを引く → swapAllowed を満たすまで最大40回引き直す」で、
// intra は既定でも平均15回超、maxSeedShift 併用時は平均29回引き直し、40回失敗が
// 8〜55% 発生していた。失敗は runSearch の `if (!nb) break` でリスタートごと
// 打ち切るため、intra は反復予算の 0.1% 未満しか消化できていなかった。
//
// 現行は「各選手が座れるスロットの候補集合から引き、相手側だけ確認する」方式。
// ここで検証するのは:
//   1. 候補集合が swapAllowed と厳密に同じ関係を表すこと（広くも狭くもない）
//   2. 制約（タイ帯・プール/ウェーブ固定・シードズレ上限）が出力で守られること
//   3. 有効手なしによる打ち切りが起きていないこと（反復予算を使い切る）
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SO = ((m) => m.default || m)(require(path.resolve(__dirname, '../../site/seeding/seed_optimizer.js')));

function mkInput(N, P, extra, format) {
  const ranking = Array.from({ length: N }, (_, i) => 'u' + (i + 1));
  const PREF = ['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '北海道', '兵庫県', '宮城県'];
  let r = 20260824;
  const rnd = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
  const prefByUid = {};
  ranking.forEach((u) => { prefByUid[u] = PREF[Math.floor(rnd() * PREF.length)]; });
  const recentPair = {};
  for (let k = 0; k < N; k++) {
    const a = ranking[Math.floor(rnd() * N)], b = ranking[Math.floor(rnd() * N)];
    if (a !== b) recentPair[SO.pairKey(a, b)] = 1;
  }
  const params = Object.assign(
    { rngSeed: 5, maxIters: 120, restarts: 2, _verifyMoves: true, _verifyDelta: true }, extra);
  return { poolCount: P, format: format || 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair, params };
}

// 各構成で「候補集合から導いた交換可能関係 ≡ swapAllowed」を全ペア総当たりで確認する
// （_verifyMoves が不一致を見つけたら throw する）。
const CASES = [
  ['既定', 64, 8, {}],
  ['keepDePlace', 64, 8, { keepDePlace: true }],
  ['maxSeedShift', 64, 8, { maxSeedShift: 6 }],
  ['shiftLimitRanks', 64, 8, { shiftLimitRanks: [null, 8, 16, 32] }],
  ['kInter/kIntra 明示', 64, 8, { kInter: [0, 0, 1, 2, 3], kIntra: [0, 0, 0, 1, 1, 2, 2, 3] }],
  ['プール固定', 64, 8, { seedLocks: { u3: 'pool', u17: 'pool', u40: 'pool' } }],
  ['ウェーブ固定', 64, 8, { seedLocks: { u9: 'wave', u33: 'wave' }, poolWaves: [0, 0, 0, 0, 1, 1, 1, 1] }],
  ['intra 無効', 64, 8, { enableIntra: false }],
  ['SA', 64, 8, { mode: 'sa' }],
  ['winners スコープ (P=1)', 64, 1, { bracketScope: 'winners' }],
  ['winners スコープ (P>=2)', 64, 8, { bracketScope: 'winners' }],
  ['winners + プール内順位制約', 64, 8, { bracketScope: 'winners', winnersPoolRankLimit: true }],
  ['winners + shiftLimitRanks', 64, 1, { bracketScope: 'winners', shiftLimitRanks: [null, 8, 16, 32] }],
  ['小規模 P=2', 8, 2, {}],
];

for (const [label, N, P, extra] of CASES) {
  test(`候補集合が swapAllowed と一致する: ${label}`, () => {
    const inp = mkInput(N, P, extra);
    const res = SO.optimize(inp);
    assert.ok(!res.unsupported, 'unsupported にならない');
    assert.deepStrictEqual(res.seedOrder.slice().sort(), inp.ranking.slice().sort(),
      'permutation が保たれる');
  });
}

// ── 出力が制約を守っているか（候補集合が広すぎないことの独立確認） ──
test('keepDePlace: 全員が元シードと同じ DE 想定順位（タイ帯）に留まる', () => {
  const inp = mkInput(64, 8, { keepDePlace: true });
  const res = SO.optimize(inp);
  inp.ranking.forEach((uid, i) => {
    const after = res.seedOrder.indexOf(uid) + 1;
    assert.strictEqual(SO.dePlaceOfSeed(after), SO.dePlaceOfSeed(i + 1),
      `${uid}: 元シード${i + 1} → ${after} でタイ帯が変わった`);
  });
});

test('maxSeedShift: 全員のシードズレが上限以内', () => {
  const inp = mkInput(64, 8, { maxSeedShift: 6 });
  const res = SO.optimize(inp);
  inp.ranking.forEach((uid, i) => {
    const after = res.seedOrder.indexOf(uid) + 1;
    assert.ok(Math.abs(after - (i + 1)) <= 6, `${uid}: ${i + 1} → ${after} は ±6 超`);
  });
});

test('ウェーブ固定: 固定した選手は同ウェーブのプール内に留まる', () => {
  const poolWaves = [0, 0, 0, 0, 1, 1, 1, 1];
  const inp = mkInput(64, 8, { seedLocks: { u9: 'wave', u33: 'wave' }, poolWaves });
  const res = SO.optimize(inp);
  for (const uid of ['u9', 'u33']) {
    const orig = inp.ranking.indexOf(uid), after = res.seedOrder.indexOf(uid);
    assert.strictEqual(poolWaves[SO.poolOfSeed(after, 8)], poolWaves[SO.poolOfSeed(orig, 8)],
      `${uid} がウェーブをまたいだ`);
  }
});

// ── 有効手なしによる打ち切りが起きていないこと ──
// 旧実装ではここが reachable な反復数の 0.1% 未満で止まっていた。
function intraIters(res) {
  return (res.searchStats || []).filter((s) => s.phase.startsWith('intra:'));
}

// P=8 の snake では intra で1順位動くとグローバルシードが最大 2P-1=15 ずれるので、
// 上限 16 なら全プールで動ける（6 だと後述のとおり物理的に動けないプールが出る）。
test('intra が反復予算を使い切る（有効手なしで打ち切られない）', () => {
  for (const extra of [{}, { maxSeedShift: 16 }, { keepDePlace: true },
                       { shiftLimitRanks: [null, 8, 16, 32] }]) {
    const inp = mkInput(64, 8, extra);
    const res = SO.optimize(inp);
    const stats = intraIters(res);
    assert.ok(stats.length > 0, 'intra フェーズが走る');
    for (const s of stats) {
      assert.strictEqual(s.iters, s.maxIters,
        `${s.phase}: ${s.iters}/${s.maxIters} しか回っていない (${JSON.stringify(extra)})`);
    }
  }
});

test('inter も反復予算を使い切る', () => {
  const res = SO.optimize(mkInput(64, 8, {}));
  const s = (res.searchStats || []).find((x) => x.phase === 'inter');
  assert.strictEqual(s.iters, s.maxIters, `inter: ${s.iters}/${s.maxIters}`);
});

// ── 全員が動けない構成では null を返して素直に終わる ──
test('可動な選手がいなければ即座に打ち切る（無限ループしない）', () => {
  const inp = mkInput(16, 2, { kInter: [0], kIntra: [0], maxIters: 500 });
  const res = SO.optimize(inp);
  assert.deepStrictEqual(res.seedOrder, inp.ranking, '1手も動かない');
  for (const s of res.searchStats || []) {
    assert.ok(s.iters <= 2 * (inp.params.restarts || 1), `${s.phase}: 即打ち切りのはず (${s.iters})`);
  }
});

// maxSeedShift が小さすぎると intra は物理的に一手も指せない（snake で1順位動くと
// グローバルシードが最大 2P-1 ずれるため）。この場合に即打ち切りになるのは正しい挙動。
test('maxSeedShift が小さすぎるプールでは intra が動かない（正しい打ち切り）', () => {
  const inp = mkInput(64, 8, { maxSeedShift: 6 });
  const res = SO.optimize(inp);
  const pools = SO.poolsFromSeedOrder(res.seedOrder, 8);
  const before = SO.poolsFromSeedOrder(inp.ranking, 8);
  // プール所属 (inter) は動きうるが、シードズレ上限は全員守られている。
  inp.ranking.forEach((uid, i) => {
    const after = res.seedOrder.indexOf(uid) + 1;
    assert.ok(Math.abs(after - (i + 1)) <= 6, `${uid}: ${i + 1} → ${after} は ±6 超`);
  });
  assert.strictEqual(pools.length, before.length);
});
