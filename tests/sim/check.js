// calc.js を v3 参照値と照合する
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');  // 絶対パス直書きをやめ、repo の場所から求める
const calc = ((m) => m.default || m)(require(path.join(REPO, 'site/sim/calc.js')));
const ref = require(path.join(REPO, 'tests/sim/ref.json'));

let fails = 0;
function assertClose(a, b, tol, label) {
  if (Math.abs(a - b) > tol * Math.max(1, Math.abs(b))) {
    console.log(`FAIL ${label}: js=${a} py=${b}`);
    fails++;
  }
}

// 1) glicko2 単発
let maxErr = 0;
for (const c of ref.glicko2) {
  const [r, rd, vol, orr, ord_, won] = c.in;
  const p = new calc.G2Player(r, rd, vol);
  p.update([orr], [ord_], [won]);
  const errs = [Math.abs(p.rating() - c.out[0]), Math.abs(p.rd() - c.out[1]), Math.abs(p.vol - c.out[2])];
  maxErr = Math.max(maxErr, ...errs);
  assertClose(p.rating(), c.out[0], 1e-9, 'g2 rating');
  assertClose(p.rd(), c.out[1], 1e-9, 'g2 rd');
  assertClose(p.vol, c.out[2], 1e-9, 'g2 vol');
}
console.log(`glicko2 200件 maxErr=${maxErr.toExponential(2)}`);

// 2) glicko2 連続 8 試合
{
  const p = new calc.G2Player(2200.0, 80.0, 0.06);
  for (const s of ref.glicko2_seq) {
    p.update([s.opp[0]], [s.opp[1]], [s.won]);
    assertClose(p.rating(), s.after[0], 1e-9, 'seq rating');
    assertClose(p.rd(), s.after[1], 1e-9, 'seq rd');
    assertClose(p.vol, s.after[2], 1e-9, 'seq vol');
  }
  console.log('glicko2 連続更新 OK');
}

// 3) rounds / tier
for (const [n, pyRounds] of Object.entries(ref.rounds)) {
  const js = calc.buildDeLosersRounds(parseInt(n));
  if (JSON.stringify(js) !== JSON.stringify(pyRounds)) {
    console.log(`FAIL rounds n=${n}`);
    fails++;
  }
}
for (let p = 0; p < ref.tiers.length; p++) {
  if (calc.placementToTier(p) !== ref.tiers[p]) { console.log(`FAIL tier p=${p}`); fails++; }
}
console.log('rounds/tier OK');

// 4) TJPR 素点 (banzuke 構築込み)
{
  const { ratings, nent } = ref.tjpr_input;
  const bz = calc.buildBanzuke(ratings, nent);
  for (const lv of [1, 5]) {
    const pyScores = ref[`tjpr_raw_lv${lv}`];
    for (const [place, py] of Object.entries(pyScores)) {
      const js = calc.tjprRawForPlace(bz, lv, parseInt(place));
      assertClose(js, py, 1e-9, `tjpr lv${lv} place=${place}`);
    }
  }
  console.log('tjpr 素点 OK');
}

// 5) 集計
{
  assertClose(calc.aggregateEntries(ref.agg.entries, 5), ref.agg.top3, 1e-12, 'agg top3');
  assertClose(calc.aggregateEntries(ref.agg.entries, 1), ref.agg.top1, 1e-12, 'agg top1');
  console.log('集計 OK');
}

// 6) tier 代表順位の整合 (tierBestPlace(tier(p)) <= p)
for (let p = 1; p <= 512; p++) {
  const t = calc.placementToTier(p);
  const bp = calc.tierBestPlace(t);
  if (calc.placementToTier(bp) !== t || bp > p) { console.log(`FAIL tierBestPlace p=${p}`); fails++; }
}
console.log('tierBestPlace OK');

console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILURES`);
process.exit(fails === 0 ? 0 : 1);
