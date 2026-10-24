// sim/ の全選手の数値を data/views/sim_pop.json から作ったときに、latest_tjpr_full.jsonl から作ったときと
// シミュレーションの数値 (仮の順位・総合評価の予測) が同じになるか (src/pages/sim.js の loadJsonl / loadSimPop と同じ組み立て)。
// データ = tests/views/fixtures/build (同じビルドの jsonl と views)
const path = require('path');
const fs = require('fs');
const REPO = path.resolve(__dirname, '..', '..');
const C = ((m) => m.default || m)(require(path.join(REPO, 'site/sim/calc.js')));
const FIX = process.env.SIM_VIEWS_DATA || path.join(REPO, 'tests/views/fixtures/build');   // 本物のビルド (data/views/ 入り) でも走らせられる

function fromJsonl() {
  const M = new Map();
  for (const line of fs.readFileSync(path.join(FIX, 'latest_tjpr_full.jsonl'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line), sc = rec.scores || {};
    M.set(rec.user_id, {
      display: rec.display, tjpr_score: sc.tjpr_score || 0, bt_gated_elo: sc.bt_gated_elo || 0, bt_internal_elo: sc.bt_internal_elo || 0,
      lv: sc.shared_cascade_lv || 0, gray: !!(rec.metadata && rec.metadata.provisional),
      tjpr_rank: rec.ranks ? rec.ranks.tjpr : 0, bt_rank: rec.ranks ? rec.ranks.bt_gated : 0, ens_rank: rec.ranks ? rec.ranks.ensemble : 0,
    });
  }
  const ovs = new Set(JSON.parse(fs.readFileSync(path.join(FIX, 'data/overseas.json'))).uids || []);
  M.forEach((v, uid) => { if (ovs.has(uid)) v.gray = true; });
  return M;
}
function fromViews() {
  const V = path.join(FIX, 'data/views');
  const pop = JSON.parse(fs.readFileSync(path.join(V, 'sim_pop.json')));
  const idx = JSON.parse(fs.readFileSync(path.join(V, 'players_index.json')));
  const names = new Map(idx.rows.map((r) => [r[idx.columns.indexOf('uid')], r[idx.columns.indexOf('name')]]));
  const c = {}; pop.columns.forEach((k, i) => { c[k] = i; });
  const M = new Map();
  for (const r of pop.rows) {
    M.set(r[c.uid], {
      display: names.get(r[c.uid]), tjpr_score: r[c.tjpr_score] || 0, bt_gated_elo: r[c.bt_gated_elo] || 0, bt_internal_elo: r[c.bt_internal_elo] || 0,
      lv: r[c.lv] || 0, gray: !!r[c.gray], tjpr_rank: r[c.tjpr], bt_rank: r[c.bt], ens_rank: r[c.ens],
    });
  }
  return M;
}
// sim.js buildRankArrays と同じ
function arrays(M, UID) {
  const tj = [], bt = [], others = [];
  M.forEach((v, uid) => {
    if (uid === UID) return;
    tj.push({ score: v.tjpr_score, gray: v.gray, uid });
    if (v.bt_gated_elo > 0) bt.push({ score: v.bt_gated_elo, gray: v.gray, uid });
    others.push({ lv: v.lv, tj: v.tjpr_score, bt: v.bt_gated_elo, gray: v.gray, uid });
  });
  tj.sort((a, b) => b.score - a.score); bt.sort((a, b) => b.score - a.score);
  return { tj, bt, others };
}

let fails = 0;
const A = fromJsonl(), B = fromViews();
if (A.size !== B.size) { console.log(`FAIL 人数 ${A.size} != ${B.size}`); fails++; }
A.forEach((v, uid) => {
  const w = B.get(uid);
  if (!w || JSON.stringify(v) !== JSON.stringify(w)) { if (fails < 5) console.log('FAIL', uid, JSON.stringify(v), JSON.stringify(w)); fails++; }
});
let n = 0;
for (const UID of [...A.keys()].slice(0, 40)) {
  const me = A.get(UID);
  const a = arrays(A, UID), b = arrays(B, UID);
  const self = { lv: me.lv || 1, uid: UID, tj: me.tjpr_score, bt: me.bt_gated_elo };
  const pa = C.createEnsemblePredictor(a.others, self), pb = C.createEnsemblePredictor(b.others, self);
  for (const d of [-50, 0, 30, 120]) {
    const tjS = me.tjpr_score + d, btS = me.bt_gated_elo + d;
    const ra = [C.provisionalRank(a.tj, tjS, UID), C.provisionalRank(a.bt, btS, UID), pa.predictRaw(tjS, btS)];
    const rb = [C.provisionalRank(b.tj, tjS, UID), C.provisionalRank(b.bt, btS, UID), pb.predictRaw(tjS, btS)];
    if (JSON.stringify(ra) !== JSON.stringify(rb)) { if (fails < 10) console.log('FAIL', UID, d, ra, rb); fails++; }
    n++;
  }
}
console.log(`sim_pop と jsonl: ${A.size} 人の数値と ${n} 通りの仮順位・総合評価予測が ${fails ? '不一致' : '一致'}`);
process.exit(fails ? 1 : 0);
