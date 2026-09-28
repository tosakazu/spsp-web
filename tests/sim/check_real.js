// 実プレイヤー: extractEntries → 再集計 ≈ tjpr_score を確認
const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');  // 絶対パス直書きをやめ、repo の場所から求める
const fs = require('fs');
const calc = ((m) => m.default || m)(require(path.join(REPO, 'site/sim/calc.js')));
const P = path.join(REPO, 'site/players');
const uids = process.argv.slice(2);
let fails = 0, maxDiff = 0, n = 0;
for (const uid of uids) {
  let d;
  try { d = JSON.parse(fs.readFileSync(`${P}/${uid}.json`)); } catch (e) { continue; }
  const lv = d.scores.shared_cascade_lv;
  if (!lv) continue;
  n++;
  const agg = calc.aggregateEntries(calc.extractEntries(d), lv);
  const diff = Math.abs(agg - d.scores.tjpr_score);
  maxDiff = Math.max(maxDiff, diff);
  if (diff > 0.05) {
    fails++;
    console.log(`FAIL ${uid} lv=${lv} agg=${agg.toFixed(4)} score=${d.scores.tjpr_score} diff=${diff.toFixed(4)}`);
  }
}
console.log(`checked=${n} fails=${fails} maxDiff=${maxDiff.toExponential(2)}`);
process.exit(fails ? 1 : 0);
