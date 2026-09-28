'use strict';
// bracket_core.js (プレビューの純粋計算コア) のテスト。
//   - phasePools が optimizer の poolsFromSeedOrder と一致 (スネーク整合)
//   - poolRounds の勝者伝播・bye 配置・projectedMatches との一致
//   - 「各プール上位k人 = 全体上位 k×P 人」のスネーク性質 (フェーズ進出の根拠)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/dicts.cjs').loadDicts();   // ラウンド名・経過日数の文言は辞書
const C = ((m) => m.default || m)(require('../../site/bracket/bracket_core.js'));
const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));

test('phasePools は poolsFromSeedOrder (uid=index) と一致する', () => {
  for (const [N, P] of [[16, 4], [100, 8], [2814, 128], [7, 3]]) {
    const ident = Array.from({ length: N }, (_, i) => i);
    const expected = O.poolsFromSeedOrder(ident, P);
    assert.deepStrictEqual(C.phasePools(N, P), expected, `N=${N} P=${P}`);
  }
});

test('スネーク性質: 各プール上位k人 = 全体シード上位 k×P 人', () => {
  for (const [N, P, k] of [[2814, 128, 2], [256, 8, 4], [100, 8, 3]]) {
    const pools = C.phasePools(N, P);
    const topK = pools.flatMap((pool) => pool.slice(0, k));
    topK.sort((a, b) => a - b);
    assert.deepStrictEqual(topK, Array.from({ length: k * P }, (_, i) => i), `N=${N} P=${P} k=${k}`);
  }
});

test('poolRounds: 構造とシード1の優勝、bye はシード上位に付く', () => {
  for (const M of [2, 3, 5, 8, 16, 24, 32]) {
    const r = C.poolRounds(M);
    assert.strictEqual(r.B, O.nextPow2(Math.max(2, M)));
    assert.strictEqual(r.rounds.length, Math.log2(r.B));
    // 最終ラウンドの勝者 = シード1
    const last = r.rounds[r.rounds.length - 1];
    assert.strictEqual(last.length, 1);
    assert.strictEqual(last[0].w, 1);
    // 1回戦の bye 数 = B - M。bye の相手はシード 1..(B-M)
    const r1 = r.rounds[0];
    const byes = r1.filter((m) => m.a == null || m.b == null);
    assert.strictEqual(byes.length, r.B - M, `M=${M}`);
    const byeSeeds = byes.map((m) => (m.a != null ? m.a : m.b)).sort((a, b) => a - b);
    assert.deepStrictEqual(byeSeeds, Array.from({ length: r.B - M }, (_, i) => i + 1));
    // 両者 null の対戦は存在しない
    for (const rd of r.rounds) for (const m of rd) assert.ok(m.a != null || m.b != null);
  }
});

test('poolMatchups は optimizer の projectedMatches と一致する', () => {
  for (const M of [2, 3, 5, 8, 15, 24, 32]) {
    const mine = C.poolMatchups(C.poolRounds(M))
      .map((m) => `${m.a}:${m.b}:${m.r}`).sort();
    const ref = O.projectedMatches(M, O.nextPow2(Math.max(2, M)))
      .map((m) => `${m.a}:${m.b}:${m.round}`).sort();
    assert.deepStrictEqual(mine, ref, `M=${M}`);
    assert.strictEqual(mine.length, M - 1, `試合数 = M-1 (M=${M})`);
  }
});

test('poolDoubleElim: 構造・実試合数 2M-2・順位予測', () => {
  for (const M of [4, 8, 15, 16, 24, 32]) {
    const de = C.poolDoubleElim(M);
    const k = Math.log2(de.B);
    // ラウンド数: 勝者側 k、敗者側 2k-2
    assert.strictEqual(de.winners.length, k, `M=${M}`);
    assert.strictEqual(de.losers.length, 2 * k - 2, `M=${M}`);
    // 実試合数 (bye を除く) = 2M-2 (勝者側 M-1 + 敗者側 M-2 + GF 1)
    const real = (ms) => ms.filter((m) => m.a != null && m.b != null).length;
    const wReal = de.winners.reduce((s, r) => s + real(r), 0);
    const lReal = de.losers.reduce((s, r) => s + real(r), 0);
    const gfReal = (de.gf.a != null && de.gf.b != null) ? 1 : 0;
    assert.strictEqual(wReal, M - 1, `勝者側 M=${M}`);
    assert.strictEqual(wReal + lReal + gfReal, 2 * M - 2, `合計 M=${M}`);
    // シード通り: GF = 1 vs 2 (シード2は決勝で落ちて敗者側を勝ち上がる)、優勝=1
    assert.deepStrictEqual([de.gf.a, de.gf.b, de.gf.w], [1, 2, 1], `GF M=${M}`);
    // 敗者側決勝 = シード2 vs シード3
    const lbFinal = de.losers[de.losers.length - 1][0];
    assert.deepStrictEqual([Math.min(lbFinal.a, lbFinal.b), Math.max(lbFinal.a, lbFinal.b)], [2, 3], `LB決勝 M=${M}`);
    // 各選手は敗者側に高々1回しか「入場」しない (ドロップの重複なし)
    const dropped = de.losers.flatMap((r) => r.filter((m) => m.drop).map((m) => m.b)).filter((x) => x != null);
    const l1 = de.losers[0].flatMap((m) => [m.a, m.b]).filter((x) => x != null);
    const all = dropped.concat(l1);
    assert.strictEqual(new Set(all).size, all.length, `敗者側入場の重複 M=${M}`);
    // 勝者(1) は敗者側に現れない
    assert.ok(!all.includes(1));
  }
});

test('poolDoubleElim: 最初のドロップは反転で WR1 の即再戦を回避 (M=8)', () => {
  const de = C.poolDoubleElim(8);
  // WR1: (1v8)(4v5)(2v7)(3v6) → 敗者 [8,5,7,6]。L1: (8v5)(7v6) → 勝者 [5,6]
  assert.deepStrictEqual(de.losers[0].map((m) => [m.a, m.b]), [[8, 5], [7, 6]]);
  // WR2 敗者 [4,3] を反転 [3,4] → L2: (5v3)(6v4)。反転しないと (5v4) が WR1 の再戦になる
  assert.deepStrictEqual(de.losers[1].map((m) => [m.a, m.b]), [[5, 3], [6, 4]]);
  for (const m of de.losers[1]) {
    const wr1pairs = de.winners[0].map((x) => `${Math.min(x.a, x.b)}:${Math.max(x.a, x.b)}`);
    assert.ok(!wr1pairs.includes(`${Math.min(m.a, m.b)}:${Math.max(m.a, m.b)}`), 'WR1 の即再戦が発生');
  }
});

test('poolDoubleElim: ドロップ配置は start.gg 実ブラケットから解読した規則 (M=64)', () => {
  // 規則 (docs/seed_preview_design.md): 落ちる先の敗者側ラウンド番号基準で
  //   L4 (=W2敗者, losers[1]) = 全反転
  //   L6 (=W3敗者, losers[3]) = 半分ごとに反転
  //   L8 (=W4敗者, losers[5]) = 半分入替
  //   L10以降 (=W5+, losers[7]...) = そのまま
  // スマパ#241 (64人フルDE) 等 実5大会の prereq グラフ全ラウンド一致で検証済み。
  const de = C.poolDoubleElim(64);
  const dropsAt = (li) => de.losers[li].map((m) => m.b);   // major の b 側 = ドロップ
  const losersOf = (wr) => de.winners[wr].map((m) => m.l); // 試合順の敗者列
  const rev = (a) => a.slice().reverse();
  const revHalves = (a) => rev(a.slice(0, a.length / 2)).concat(rev(a.slice(a.length / 2)));
  const halfSwap = (a) => a.slice(a.length / 2).concat(a.slice(0, a.length / 2));
  assert.deepStrictEqual(dropsAt(1), rev(losersOf(1)), 'L4 = 全反転');
  assert.deepStrictEqual(dropsAt(3), revHalves(losersOf(2)), 'L6 = 半分ごと反転');
  assert.deepStrictEqual(dropsAt(5), halfSwap(losersOf(3)), 'L8 = 半分入替');
  assert.deepStrictEqual(dropsAt(7), losersOf(4), 'L10 = そのまま');
  assert.deepStrictEqual(dropsAt(9), losersOf(5), 'L12 = そのまま');
});

test('poolDoubleElim: bye (M<B) は敗者側へ null 伝播し両者 null も許容', () => {
  const de = C.poolDoubleElim(5);   // B=8, bye 3
  // 構造が壊れていないこと (ラウンド数・GF)
  assert.strictEqual(de.losers.length, 4);
  assert.deepStrictEqual([de.gf.a, de.gf.b], [1, 2]);
  // 実試合合計 = 2*5-2 = 8
  const real = (ms) => ms.filter((m) => m.a != null && m.b != null).length;
  const total = de.winners.reduce((s, r) => s + real(r), 0)
    + de.losers.reduce((s, r) => s + real(r), 0) + 1;
  assert.strictEqual(total, 8);
});

test('poolDoubleElim: M=2/3 の縮退', () => {
  const de2 = C.poolDoubleElim(2);
  assert.strictEqual(de2.losers.length, 0);
  assert.deepStrictEqual([de2.gf.a, de2.gf.b, de2.gf.w], [1, 2, 1]);
  const de3 = C.poolDoubleElim(3);   // B=4
  assert.strictEqual(de3.losers.length, 2);
  assert.deepStrictEqual([de3.gf.a, de3.gf.b], [1, 2]);
});

test('roundName / fmtRelDays', () => {
  assert.strictEqual(C.roundName(1, 5), '1回戦');
  assert.strictEqual(C.roundName(4, 5), '準決勝');
  assert.strictEqual(C.roundName(5, 5), '決勝');
  assert.strictEqual(C.fmtRelDays(0), '今日');
  assert.strictEqual(C.fmtRelDays(3), '3日前');
  assert.strictEqual(C.fmtRelDays(13), '1週間前');
  assert.strictEqual(C.fmtRelDays(45), '1ヶ月前');
  assert.strictEqual(C.fmtRelDays(400), '1.1年前');
  assert.strictEqual(C.fmtRelDays(null), '');
});

// ── 進出人数による打ち切り ────────────────────────────────
// 予選プールは「通過者が決まったところ」で終わる (2人抜けのプールに GF は無い)。
// 打ち切り位置は start.gg の実ブラケットと突き合わせて決めた:
//   ・脱落は敗者側 (と GF) の試合でしか起きないので、残り = 進出人数 になるまで進める
//   ・その後、次に脱落者が出るまでの勝者側ラウンドは実施される (順位決定のため)
const realPools = [
  // [ラベル, プール人数, 進出人数, 実際の勝者側各Rの試合数, 実際の敗者側各Rの試合数]
  ['りぷぶらSP15 予選 (phase 2341773)', 11, 6, [3, 4, 2], [3, 2]],
  ['篝火15 Phase1 A100 (phase 2132353)', 21, 12, [5, 8, 4], [5, 4]],
];

test('poolDoubleElim(M, adv): start.gg 実プールのラウンド構成と一致する', () => {
  const real = (round) => round.filter((m) => m.a != null && m.b != null).length;
  for (const [label, M, adv, wReal, lReal] of realPools) {
    const de = C.poolDoubleElim(M, adv);
    // 全 bye のラウンドは start.gg 側に存在しないので除いて比較する
    assert.deepStrictEqual(de.winners.map(real).filter((n) => n > 0), wReal, label + ' 勝者側');
    assert.deepStrictEqual(de.losers.map(real).filter((n) => n > 0), lReal, label + ' 敗者側');
    assert.strictEqual(de.gf, null, label + ': GF は実施されない');
    assert.strictEqual(de.advancers.length, adv, label + ': 通過人数');
    assert.strictEqual(de.cut, true);
  }
});

test('poolDoubleElim(M, adv): 2人抜けは GF だけが落ちる / 最終フェーズは優勝まで', () => {
  for (const M of [4, 8, 16, 32, 5, 11, 24]) {
    const cut = C.poolDoubleElim(M, 2);
    const full = C.poolDoubleElim(M);
    assert.strictEqual(cut.gf, null, `M=${M}: 2人抜けに GF は不要`);
    assert.strictEqual(cut.winners.length, full.winners.length, `M=${M}: 勝者側は最後まで`);
    assert.strictEqual(cut.losers.length, full.losers.length, `M=${M}: 敗者側決勝までは必要`);
    assert.deepStrictEqual(cut.advancers, [1, 2], `M=${M}: 通過はシード1,2`);
    // adv 未指定 / 0 は優勝まで (打ち切らない)
    assert.ok(full.gf, `M=${M}: 最終フェーズには GF がある`);
    assert.strictEqual(full.cut, false);
    assert.strictEqual(full.advancers, null);
    assert.strictEqual(C.poolDoubleElim(M, 0).gf != null, true);
  }
});

test('poolDoubleElim(M, adv): 通過人数ぶんだけ生き残り、脱落者は敗者側の試合数と一致する', () => {
  for (const M of [4, 5, 8, 11, 12, 16, 21, 24, 32, 48, 64]) {
    for (const adv of [1, 2, 3, 4, 6, 8]) {
      if (adv >= M) continue;
      const de = C.poolDoubleElim(M, adv);
      const elims = de.losers.reduce(
        (n, r) => n + r.filter((m) => m.a != null && m.b != null).length, 0) + (de.gf ? 1 : 0);
      assert.strictEqual(M - elims, de.advancers ? de.advancers.length : 1, `M=${M} adv=${adv}`);
      if (de.advancers) {
        // シード通りなら上位 adv 人がそのまま通過する
        assert.deepStrictEqual(de.advancers, Array.from({ length: de.advancers.length }, (_, i) => i + 1),
          `M=${M} adv=${adv}`);
        assert.ok(de.advancers.length >= adv, `M=${M} adv=${adv}: 通過が足りない`);
      }
      // 打ち切っても表示名用のラウンド総数は残る
      assert.ok(de.wTotal >= de.winners.length && de.lTotal >= de.losers.length);
    }
  }
});

test('playOrder: W1 → L1 → W2 → major → minor … → GF の実施順', () => {
  const de = C.poolDoubleElim(8);
  const seq = C.playOrder(de).map((s) => s.k + (s.i != null ? s.i : ''));
  assert.deepStrictEqual(seq, ['W0', 'L0', 'W1', 'L1', 'L2', 'W2', 'L3', 'G']);
});

// ── 敗者側スタート (トップカット) ────────────────────────────
// 「予選1位は勝者側、2位以下は敗者側から」構成。start.gg の実ブラケット2件と
// ラウンド構成・試合数・敗者側初戦の組み合わせまで一致することを固定する。
const splitPools = [
  {
    label: '篝火15 Phase2 D100 (24人 = 勝者側8+敗者側16, 3抜け)',
    M: 24, adv: 3, lb: 16, w: [4, 2, 1], l: [8, 4, 4, 2, 2, 1],
    lbFirst: ['9v19', '10v20', '11v17', '12v18', '13v23', '14v24', '15v21', '16v22'],
  },
  {
    label: 'りぷぶらSP15 Aクラス (48人 = 勝者側16+敗者側32, 8抜け)',
    M: 48, adv: 8, lb: 32, w: [8, 4], l: [16, 8, 8, 4, 4],
    // 敗者側初戦の並びは大会ごとに違う (この大会は 篝火/ウメブラ 系と別配列)。
    // 顔ぶれ (下位32人) だけ確認する。
    lbFirst: null,
  },
];

test('poolDoubleElim(M, adv, lbStart): start.gg 実トップカットと一致する', () => {
  const real = (round) => round.filter((m) => m.a != null && m.b != null);
  for (const c of splitPools) {
    const de = C.poolDoubleElim(c.M, c.adv, c.lb);
    assert.deepStrictEqual(de.winners.map((r) => real(r).length).filter((n) => n > 0), c.w, c.label + ' 勝者側');
    assert.deepStrictEqual(de.losers.map((r) => real(r).length).filter((n) => n > 0), c.l, c.label + ' 敗者側');
    assert.strictEqual(de.gf, null, c.label + ': GF は実施されない');
    assert.strictEqual(de.advancers.length, c.adv, c.label + ': 通過人数');
    // 敗者側初戦の組み合わせ (直入り勢のシード配置)
    const got = real(de.losers[0]).map((m) => Math.min(m.a, m.b) + 'v' + Math.max(m.a, m.b)).sort();
    if (c.lbFirst) assert.deepStrictEqual(got, c.lbFirst.slice().sort(), c.label + ' 敗者側初戦');
    // 勝者側は上位 w 人だけ / 敗者側初戦は下位 d 人だけ
    const wbSeeds = new Set();
    for (const m of de.winners[0]) { if (m.a != null) wbSeeds.add(m.a); if (m.b != null) wbSeeds.add(m.b); }
    assert.ok(Math.max(...wbSeeds) <= c.M - c.lb, c.label + ': 勝者側に下位シードが混ざっている');
    for (const m of real(de.losers[0])) assert.ok(Math.min(m.a, m.b) > c.M - c.lb, c.label + ': 敗者側初戦に上位シード');
  }
});

test('poolDoubleElim: 敗者側スタートでも脱落数と通過人数が整合する', () => {
  for (const M of [8, 12, 16, 24, 32, 48, 64]) {
    for (const lb of [M / 2, M / 4, (M * 3) / 4]) {
      if (!Number.isInteger(lb) || lb < 1 || lb > M - 2) continue;
      for (const adv of [1, 2, 4, 8]) {
        if (adv >= M) continue;
        const de = C.poolDoubleElim(M, adv, lb);
        const elims = de.losers.reduce(
          (n, r) => n + r.filter((m) => m.a != null && m.b != null).length, 0) + (de.gf ? 1 : 0);
        const alive = de.advancers ? de.advancers.length : 1;
        assert.strictEqual(M - elims, alive, `M=${M} lb=${lb} adv=${adv}`);
        // 打ち切らなければ全員がどこかに 1 回は現れる (取りこぼしなし)
        const seen = new Set();
        const full = C.poolDoubleElim(M, 0, lb);
        for (const r of full.winners.concat(full.losers)) {
          for (const m of r) { if (m.a != null) seen.add(m.a); if (m.b != null) seen.add(m.b); }
        }
        assert.strictEqual(seen.size, M, `M=${M} lb=${lb}: 参加者の欠落`);
      }
    }
  }
});

test('poolDoubleElim: 敗者側スタートは優勝までなら GF が残る', () => {
  const de = C.poolDoubleElim(24, 0, 16);
  assert.ok(de.gf, 'GF が無い');
  assert.strictEqual(de.cut, false);
  // 勝者側は 8 人ぶん (3 ラウンド)。敗者側スタート勢は 1 敗で終わりなので、
  // 総試合数は (M-1) + (勝者側スタート人数-1) = M+w-2 (完全 DE の 2M-2 ではない)
  assert.strictEqual(de.winners.length, 3);
  const matches = de.winners.concat(de.losers).reduce(
    (n, r) => n + r.filter((m) => m.a != null && m.b != null).length, 0) + 1;
  assert.strictEqual(matches, 24 + 8 - 2);
});

// ── start.gg 実プール一括検証 ─────────────────────────────
// tests/seeding/fixtures/startgg_pools.json は完了済みの実ブラケットから機械的に
// 導いた構造 (tools/fetch_startgg_pools.cjs で再生成)。人数・通過人数・敗者側スタートの
// 組み合わせを横断して poolDoubleElim と突き合わせる。
const FIXTURE = path.resolve(__dirname, 'fixtures/startgg_pools.json');
const FX = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : null;
const fxSkip = FX ? false : 'startgg_pools.json が無い (tools/fetch_startgg_pools.cjs で生成)';
const realMatches = (round) => round.filter((m) => m.a != null && m.b != null);
const pairKeys = (round) => realMatches(round)
  .map((m) => Math.min(m.a, m.b) + 'v' + Math.max(m.a, m.b)).sort();

test('start.gg 実プール: ラウンド構成 (各ラウンドの試合数・GF の有無) が全件一致する', { skip: fxSkip }, () => {
  const bad = [];
  for (const p of FX.pools) {
    const de = C.poolDoubleElim(p.M, p.adv, p.lbStart);
    const w = de.winners.map((r) => realMatches(r).length).filter((n) => n > 0);
    const l = de.losers.map((r) => realMatches(r).length).filter((n) => n > 0);
    if (JSON.stringify(w) !== JSON.stringify(p.w) || JSON.stringify(l) !== JSON.stringify(p.l)
        || (!!de.gf) !== p.gf) {
      bad.push(`${p.src}: M=${p.M} adv=${p.adv} lb=${p.lbStart} ` +
        `予測 W[${w}] L[${l}] GF=${!!de.gf} / 実 W[${p.w}] L[${p.l}] GF=${p.gf}`);
    }
  }
  assert.deepStrictEqual(bad, []);
  // 検証の幅が痩せていないこと (フィクスチャを更新したときの見張り)
  assert.ok(FX.pools.length >= 60, 'プール数が少なすぎる: ' + FX.pools.length);
  const sizes = new Set(FX.pools.map((p) => p.M));
  assert.ok(sizes.size >= 20, '人数のバリエーションが少ない: ' + sizes.size);
  assert.ok(FX.pools.some((p) => p.lbStart > 0), '敗者側スタートの実例が無い');
});

// 勝者側1回戦はシードだけで決まるので組み合わせまで比較できる。
// 例外 2 件は同じ人数の他プール (M=12 は3件が一致) と食い違っており、
// TO による手動シード変更や DQ 後の再生成と考えられる。増えたら気付けるよう固定する。
const WFIRST_EXCEPTIONS = new Set([
  3400344,   // 上野スマコミ#521 本戦トーナメント (M=12)
  3410889,   // 剱〜Tsurugi〜#4 Aクラス (M=12)
  2878807,   // MSC#3 Kagaribi édition (M=7。篝火本体ではなくフランスのサイドイベント)
  972274, 972275, 972276,   // ウメブラ JapanMajor2019 Round2 (M=16。2019年の並びは現行と違う)
]);

test('start.gg 実プール: 勝者側1回戦の組み合わせが一致する (既知の例外を除く)', { skip: fxSkip }, () => {
  const bad = [];
  for (const p of FX.pools) {
    const de = C.poolDoubleElim(p.M, p.adv, p.lbStart);
    const got = pairKeys(de.winners[0]);
    if (JSON.stringify(got) === JSON.stringify(p.wFirst.slice().sort())) {
      assert.ok(!WFIRST_EXCEPTIONS.has(p.groupId), `例外リストの ${p.groupId} が一致した (リストから外す)`);
      continue;
    }
    if (WFIRST_EXCEPTIONS.has(p.groupId)) continue;
    bad.push(`${p.src}: M=${p.M} 予測 ${got.join(' ')} / 実 ${p.wFirst.join(' ')}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('start.gg 実プール: 敗者側スタート勢は全員が初戦に1回ずつ出る', { skip: fxSkip }, () => {
  // 直入り勢の「組み合わせ」は大会ごとに違う (下の注記参照) が、
  // 誰が敗者側から始まるかは一致していなければならない。
  for (const p of FX.pools) {
    if (!p.lbStart) continue;
    const de = C.poolDoubleElim(p.M, p.adv, p.lbStart);
    const seen = [];
    for (const m of realMatches(de.losers[0])) seen.push(m.a, m.b);
    seen.sort((a, b) => a - b);
    const expect = Array.from({ length: p.lbStart }, (_, i) => p.M - p.lbStart + 1 + i);
    assert.deepStrictEqual(seen, expect, `${p.src}: 敗者側初戦の顔ぶれ`);
    // 実ブラケットの顔ぶれとも一致する
    const realSeen = p.lbFirst.flatMap((s) => s.split('v').map(Number)).sort((a, b) => a - b);
    assert.deepStrictEqual(realSeen, expect, `${p.src}: 実データ側の顔ぶれ`);
  }
});

// 敗者側直入りの「組み合わせ」は同じ形でも大会ごとに違う (前フェーズのプール被り回避などが
// 効いていると思われる)。bracket_core は **篝火 / ウメブラ で観測した並び**を採る方針なので、
// それ以外の並びになる実プールを例外として固定する。増減したら気付けるようにしておく。
const LBFIRST_EXCEPTIONS = new Set([
  3405206,   // TO WIN#12 Top24 (24=8+16。直入り勢どうしの上位・下位が混ざる)
  3360249,   // ユニブラ#8 Top16 (16=8+8。[1,0,3,2] — ウメブラSP10 の全反転を採用したため例外)
  3367375,   // IMPACT MAJOR#4 Aクラス (48=16+32)
  3355696,   // 極冠#15 TOP48 (48=16+32)
  3393958,   // みどブラRevival#14.5 TOP24 (24=8+16)
  3377315,   // 【第10回】Moon! TOP24 (24=8+16)
  3405542,   // 四闘-Quattro-#5 本線 (16=8+8。[2,3,0,1] — 3大会で3通りに割れる形)
  2770352,   // 篝火#13 Phase4 TOP64 (64=32+32。同形のウメブラと食い違うのでウメブラ側を採用)
  2322441, 2322442,   // ウメブラSP#10 (24=8+16。同大会の他フェーズや SP9/11/12 と食い違う)
  1067366,   // ウメブラSP5 Top24 (24=8+16)
  1028190,   // ウメブラSP4 Top24 (24=8+16)
]);

test('敗者側直入り 勝64+敗128 (グランドスラム19 ベスト192 実測 = i XOR 21)', () => {
  // 192人 = 勝64 + 敗128 (32プール6抜け → 192人本戦)。2026-08-20 に
  // 第19回グランドスラム (event 1651150, phase 2321780) の実ブラケットから採取。
  // フィクスチャ (startgg_pools.json) は M≤128 しか持たないためここに直接固定する。
  const de = C.poolDoubleElim(192, 8, 128);
  const got = pairKeys(de.losers[0]);
  const real = ['100v183', '101v178', '102v177', '103v180', '104v179', '105v190', '106v189',
    '107v192', '108v191', '109v186', '110v185', '111v188', '112v187', '113v166', '114v165',
    '115v168', '116v167', '117v162', '118v161', '119v164', '120v163', '121v174', '122v173',
    '123v176', '124v175', '125v170', '126v169', '127v172', '128v171', '65v150', '66v149',
    '67v152', '68v151', '69v146', '70v145', '71v148', '72v147', '73v158', '74v157', '75v160',
    '76v159', '77v154', '78v153', '79v156', '80v155', '81v134', '82v133', '83v136', '84v135',
    '85v130', '86v129', '87v132', '88v131', '89v142', '90v141', '91v144', '92v143', '93v138',
    '94v137', '95v140', '96v139', '97v182', '98v181', '99v184'].sort();
  assert.deepStrictEqual(got, real);
});

test('lbEntryEstimated: 実測テーブルに無い形だけ「推定」フラグが立つ', () => {
  // 実測テーブルにある形 → 推定ではない
  for (const [M, lb] of [[192, 128], [96, 64], [64, 32], [48, 32], [32, 16], [24, 16], [16, 8], [12, 8]]) {
    const de = C.poolDoubleElim(M, 0, lb);
    assert.strictEqual(!!de.lbEntryEstimated, false, `M=${M} lb=${lb} は実測済みのはず`);
  }
  // d <= target (ペア無し・そのまま埋めるだけ) も推定要素なし
  assert.strictEqual(!!C.poolDoubleElim(12, 0, 4).lbEntryEstimated, false);
  // テーブルに無い形 (勝128+敗256 = '128:64' 等) → 推定フラグ
  assert.strictEqual(C.poolDoubleElim(384, 0, 256).lbEntryEstimated, true);
  // API からも判定できる
  assert.strictEqual(C.lbEntryObserved(64, 128), true);
  assert.strictEqual(C.lbEntryObserved(128, 256), false);
});

test('start.gg 実プール: 敗者側直入りの組み合わせ (既知の例外を除く)', { skip: fxSkip }, () => {
  const bad = [], unexpectedOk = [];
  for (const p of FX.pools) {
    if (!p.lbStart) continue;
    const de = C.poolDoubleElim(p.M, p.adv, p.lbStart);
    const same = JSON.stringify(pairKeys(de.losers[0])) === JSON.stringify(p.lbFirst.slice().sort());
    if (LBFIRST_EXCEPTIONS.has(p.groupId)) {
      if (same) unexpectedOk.push(p.src);
    } else if (!same) {
      bad.push(`${p.src}: ${p.M}=${p.M - p.lbStart}+${p.lbStart} 予測 ${pairKeys(de.losers[0]).join(' ')} / 実 ${p.lbFirst.join(' ')}`);
    }
  }
  assert.deepStrictEqual(bad, []);
  assert.deepStrictEqual(unexpectedOk, [], '例外リストから外せるものがある');
});

test('篝火 / ウメブラ のプールが再現できている', { skip: fxSkip }, () => {
  const real = (round) => round.filter((m) => m.a != null && m.b != null);
  for (const [label, re, minPools] of [['篝火', /篝火|KAGARIBI|kagaribi/, 40], ['ウメブラ', /ウメブラ|Umebura/, 40]]) {
    const pools = FX.pools.filter((p) => re.test(p.src));
    assert.ok(pools.length >= minPools, `${label}: プール数が少ない (${pools.length})`);
    for (const p of pools) {
      const de = C.poolDoubleElim(p.M, p.adv, p.lbStart);
      const w = de.winners.map((r) => real(r).length).filter((n) => n > 0);
      const l = de.losers.map((r) => real(r).length).filter((n) => n > 0);
      // ラウンド構成は例外なく一致すること
      assert.deepStrictEqual(w, p.w, `${p.src} 勝者側`);
      assert.deepStrictEqual(l, p.l, `${p.src} 敗者側`);
      assert.strictEqual(!!de.gf, p.gf, `${p.src} GF`);
    }
  }
});

test('poolDoubleElim: undefeated = 無敗のまま通過した人 (次フェーズを勝者側から始める人)', () => {
  // 8人2抜け: 優勝候補だけが無敗、もう1人は勝者側決勝で負けて敗者側から通過
  const a = C.poolDoubleElim(8, 2);
  assert.deepStrictEqual(a.advancers, [1, 2]);
  assert.deepStrictEqual(a.undefeated, [1]);
  // 24人 = 勝8+敗16 の6抜け: 勝者側に残るのは2人だけ
  const b = C.poolDoubleElim(24, 6, 16);
  assert.deepStrictEqual(b.advancers, [1, 2, 3, 4, 5, 6]);
  assert.deepStrictEqual(b.undefeated, [1, 2]);
  // 敗者側スタート勢は勝ち上がっても「無敗」にはならない
  const c = C.poolDoubleElim(16, 8, 8);
  assert.ok(c.undefeated.every((s) => s <= 8), JSON.stringify(c.undefeated));
  // 打ち切らない (優勝まで) なら undefeated は持たない
  assert.strictEqual(C.poolDoubleElim(8, 0).undefeated, null);
});

test('undefeated は敗者側の試合数と整合する (無敗 = 一度も l に出ない)', () => {
  for (const M of [8, 11, 16, 24, 32]) {
    for (const adv of [1, 2, 3, 4, 6, 8]) {
      for (const lb of [0, Math.floor(M / 2)]) {
        if (adv >= M || lb > M - 2) continue;
        const de = C.poolDoubleElim(M, adv, lb);
        if (!de.advancers) continue;
        const lost = new Set();
        for (let s = M - lb + 1; s <= M; s++) lost.add(s);   // 敗者側スタートは1敗扱い
        for (const r of de.winners.concat(de.losers)) {
          for (const m of r) if (m.a != null && m.b != null && m.l != null) lost.add(m.l);
        }
        assert.deepStrictEqual(de.undefeated, de.advancers.filter((s) => !lost.has(s)),
          `M=${M} adv=${adv} lb=${lb}`);
      }
    }
  }
});
