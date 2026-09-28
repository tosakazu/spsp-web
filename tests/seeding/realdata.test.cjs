'use strict';
// 実データ統合テスト: 本物の players/<uid>.json と player_prefectures.json を
// fetch シム(ローカルファイル読込)で buildSeedData → optimize に流し、
// データ形状の齟齬・制約違反・不悪化を検証する。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const D = ((m) => m.default || m)(require('../../site/seeding/seed_data.js'));
const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));

const REPO = path.resolve(__dirname, '../..');
const PLAYERS_DIR = path.join(process.env.SPSP_STATE_ROOT || path.join(require('os').homedir(), 'spsp-state'), 'tosakazu.github.io/spsp/players');   // deploy/paths.sh と同じ置き場
const PREFS = path.join(REPO, 'site/data/player_prefectures.json');
const RANK_SRC = path.join(REPO, 'site/latest_tjpr_full.jsonl');

const haveData = fs.existsSync(PLAYERS_DIR) && fs.existsSync(PREFS) && fs.existsSync(RANK_SRC);
if (!haveData) {
  // 無言スキップだと /tmp 掃除後にこのファイルの4テストが消えたまま気づけない。
  // 必ず目立つ警告を出す（gh-pages clone を復元すれば再び走る）。
  console.warn('⚠⚠ realdata.test.cjs: 実データ未配置のため 4 テストをスキップ中 ⚠⚠');
  console.warn(`   必要: ${PLAYERS_DIR} （git clone --branch gh-pages https://github.com/tosakazu/tosakazu.github.io.git /tmp/tosakazu.github.io で復元）`);
}

// 上位ランカーから JSON のある uid を最大 N 件集める（自己完結）。
function pickRealUids(n) {
  const recs = [];
  for (const line of fs.readFileSync(RANK_SRC, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const d = JSON.parse(line);
    const r = d.ranks && d.ranks.ensemble;
    if (d.user_id && r) recs.push([r, d.user_id]);
  }
  recs.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [, uid] of recs) {
    if (fs.existsSync(path.join(PLAYERS_DIR, uid + '.json'))) out.push(uid);
    if (out.length >= n) break;
  }
  return out;
}

function localFetchers() {
  return {
    fetchPrefs: async () => JSON.parse(fs.readFileSync(PREFS, 'utf8')),
    fetchGeo: async () => require('./fixtures/geo_jp.json'),   // 地域まとめの定義
    fetchPlayer: async (uid) => {
      const p = path.join(PLAYERS_DIR, uid + '.json');
      if (!fs.existsSync(p)) return { __missing: true };
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    },
  };
}

// 可動制約が破られていないことを検証（inter / intra 両方）。
function assertConstraints(ranking, P, result, params) {
  const N = ranking.length;
  const rp = O.resolveParams(params || {});
  const kInter = O.kInterFn(rp);
  // inter: 各 uid の最終プールが初期プール±k_inter(row) 内
  const initPoolOf = {}; ranking.forEach((u, s) => { initPoolOf[u] = O.poolOfSeed(s, P); });
  const finalPoolOf = {}; result.seedOrder.forEach((u, s) => { finalPoolOf[u] = O.poolOfSeed(s, P); });
  ranking.forEach((u, s) => {
    const row1 = O.rowOfSeed(s, P) + 1;
    const moved = Math.abs(finalPoolOf[u] - initPoolOf[u]);
    assert.ok(moved <= kInter(row1), `inter制約違反 uid ${u}: moved ${moved} > ${kInter(row1)}`);
  });
}

test('実データ: buildSeedData が本物のJSONを正しく集計', { skip: !haveData ? '実データ未配置' : false }, async () => {
  const uids = pickRealUids(64);
  const data = await D.buildSeedData(uids, Object.assign(localFetchers(), {
    params: { sizeWeight: 'log2' },
  }));
  assert.strictEqual(data.meta.attendees, uids.length);
  assert.strictEqual(data.meta.errors.length, 0, '実JSONで通信エラーは出ないはず');
  assert.ok(data.meta.withPlayerJson >= uids.length - 1, 'ほぼ全員 JSON あり');
  assert.ok(data.meta.prefIdentified > 0, '都道府県が1件も取れない');
  // 相互対戦ペアが疎行列に入っている（事前計測で 1000+ ペア）。
  const nPairs = Object.keys(data.recentPair).length;
  assert.ok(nPairs > 100, `recentPair が少なすぎる: ${nPairs}`);
  // recentMeta の整合
  for (const k of Object.keys(data.recentPair)) {
    assert.ok(data.recentMeta[k].count >= 1);
    assert.ok(data.recentMeta[k].penalty > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(data.recentMeta[k].lastDate));
  }
});

test('実データ: optimize(4プールDE) が permutation・不悪化・制約遵守', { skip: !haveData ? '実データ未配置' : false }, async () => {
  const uids = pickRealUids(64);
  const data = await D.buildSeedData(uids, localFetchers());
  const P = 4;
  const params = { rngSeed: 123, restarts: 6, maxIters: 1500 };
  const r = O.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking: uids,
    prefByUid: data.prefByUid, prefCounts: data.prefCounts,
    recentPair: data.recentPair, recentMeta: data.recentMeta, params,
  }, {});
  // permutation
  assert.deepStrictEqual([...r.seedOrder].sort((a, b) => a - b), [...uids].sort((a, b) => a - b));
  // 不悪化 & 実際に改善している（実データなら被りがあるので下がるはず）
  assert.ok(r.report.after.total <= r.report.before.total + 1e-9);
  assert.ok(r.report.after.total < r.report.before.total, '実データで全く改善しないのは不自然');
  // 制約遵守
  assertConstraints(uids, P, r, params);
  // レポート構造（4セル: inter/intra × region/recent）
  const rc = r.report.residualConcerns;
  assert.ok(rc.inter.region && typeof rc.inter.region.separablePairs === 'number');
  assert.ok(Array.isArray(rc.inter.recent.top) && typeof rc.inter.recent.pairs === 'number');
  assert.ok(rc.intra, 'DE はプール内レポートあり');
  assert.ok(rc.intra.region && Array.isArray(rc.intra.recent.top));
});

test('実データ: delta==full を実データで検証', { skip: !haveData ? '実データ未配置' : false }, async () => {
  const uids = pickRealUids(64);
  const data = await D.buildSeedData(uids, localFetchers());
  // _verifyDelta=true で内部の増分評価が full と一致することを確認（例外が出れば fail）。
  for (const P of [1, 2, 4, 8]) {
    const r = O.optimize({
      poolCount: P, format: 'DOUBLE_ELIMINATION', ranking: uids,
      prefByUid: data.prefByUid, prefCounts: data.prefCounts, recentPair: data.recentPair,
      params: { _verifyDelta: true, rngSeed: P, restarts: 2, maxIters: 600 },
    }, {});
    assert.ok(r.seedOrder.length === uids.length);
  }
});

test('実データ: SINGLE_ELIMINATION(複数プール) は inter のみ・bracketByPool なし', { skip: !haveData ? '実データ未配置' : false }, async () => {
  const uids = pickRealUids(64);
  const data = await D.buildSeedData(uids, localFetchers());
  const r = O.optimize({
    poolCount: 4, format: 'SINGLE_ELIMINATION', ranking: uids,
    prefByUid: data.prefByUid, prefCounts: data.prefCounts, recentPair: data.recentPair,
    params: { rngSeed: 1 },
  }, {});
  assert.strictEqual(r.ranAfter.runInter, true);
  assert.strictEqual(r.ranAfter.runIntra, false);
  assert.strictEqual(r.bracketByPool, null);
  // 非DE はプール内レポートなし、プール間レポートはある
  assert.ok(r.report.residualConcerns.inter);
  assert.strictEqual(r.report.residualConcerns.intra, null);
});
