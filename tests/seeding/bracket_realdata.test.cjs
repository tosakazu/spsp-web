'use strict';
// 実データ統合テスト (トーナメントプレビュー):
//   実ランキング (latest_tjpr_full.jsonl) + 実 players/<uid>.json で
//   ペイロード encode/decode 往復・URL長・プール割り・buildSeedData 連携を検証する。
//   realdata.test.cjs と同じデータ配置を前提とし、無ければ警告付きで skip。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = ((m) => m.default || m)(require('../../site/seeding/seed_share.js'));
const C = ((m) => m.default || m)(require('../../site/bracket/bracket_core.js'));
const D = ((m) => m.default || m)(require('../../site/seeding/seed_data.js'));

const REPO = path.resolve(__dirname, '../..');
// site/players は gh-pages clone への symlink (deploy/paths.sh 参照)。clone の場所に依存しないよう repo 経由で読む
const PLAYERS_DIR = path.join(REPO, 'site', 'players');
const PREFS = path.join(REPO, 'site/data/player_prefectures.json');
const RANK_SRC = path.join(REPO, 'site/latest_tjpr_full.jsonl');

const haveData = fs.existsSync(PLAYERS_DIR) && fs.existsSync(PREFS) && fs.existsSync(RANK_SRC);
if (!haveData) {
  console.warn('⚠⚠ bracket_realdata.test.cjs: 実データ未配置のためスキップ中 ⚠⚠');
  console.warn(`   必要: ${PLAYERS_DIR} / ${PREFS} / ${RANK_SRC}`);
}
const skip = haveData ? false : '実データ未配置';

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

function realPayload(uids) {
  return {
    v: 1, ev: '実データ検証', src: 'spsp',
    phases: [{ name: '予選', pools: 8, adv: 4 }, { name: 'Top 32', pools: 1, adv: 0 }],
    wv: S.chunkWaveMap(8, 2),
    uids, names: {},
  };
}

test('実uid 256人: encode→decode 往復と URL 長', { skip }, async () => {
  const uids = pickRealUids(256);
  assert.ok(uids.length === 256, '実 uid が足りない: ' + uids.length);
  const p = realPayload(uids);
  const blob = await S.encodePayload(p);
  const back = await S.decodePayload(blob);
  assert.deepStrictEqual(back, p);
  console.log(`    (256人: blob ${blob.length.toLocaleString()} 字)`);
  assert.ok(blob.length < 8000, '256人で 8,000 字を超えるのは想定外: ' + blob.length);
});

test('実uid 2048人: 往復と URL 長が設計想定内 (<20,000字)', { skip }, async () => {
  const uids = pickRealUids(2048);
  if (uids.length < 2048) { console.warn(`    (実uidが ${uids.length} 人しか無いので縮小)`); }
  const p = realPayload(uids);
  p.phases = [{ name: '予選', pools: 128, adv: 2 }, { name: 'Top 256', pools: 8, adv: 4 }, { name: 'Top 32', pools: 1, adv: 0 }];
  p.wv = S.chunkWaveMap(128, 2);
  const blob = await S.encodePayload(p);
  const back = await S.decodePayload(blob);
  assert.deepStrictEqual(back.uids, p.uids);
  console.log(`    (${uids.length}人: blob ${blob.length.toLocaleString()} 字)`);
  assert.ok(blob.length < 20000, '2048人で 20,000 字を超える: ' + blob.length);
});

test('実データ: プール割り → buildSeedData (プール単位) → 注記データの形状', { skip }, async () => {
  const uids = pickRealUids(256);
  const p = realPayload(uids);
  const counts = S.phaseEntrantCounts(p.phases, p.uids.length);
  assert.deepStrictEqual(counts, [256, 32]);
  const pools = C.phasePools(counts[0], 8);
  assert.strictEqual(pools.length, 8);
  assert.ok(pools.every((pl) => pl.length === 32));
  // プール1つ分の集計を実 players JSON で回す
  const members = pools[0].map((gi) => p.uids[gi]);
  const agg = await D.buildSeedData(members, Object.assign({ prefsOptional: true }, localFetchers()));
  assert.strictEqual(agg.meta.attendees, 32);
  assert.ok(agg.meta.withPlayerJson > 0, 'players JSON が1件も読めていない');
  // recentMeta のエントリはプール内ペアのみ / matches が日付降順
  for (const key of Object.keys(agg.recentMeta)) {
    const [a, b] = key.split(':').map(Number);
    assert.ok(members.includes(a) && members.includes(b), 'プール外ペアが混入: ' + key);
    const ms = agg.recentMeta[key].matches;
    for (let i = 1; i < ms.length; i++) assert.ok(ms[i - 1].date >= ms[i].date);
  }
  // ブラケット構造: 32人 → 5ラウンド、試合数 31
  const rounds = C.poolRounds(pools[0].length);
  assert.strictEqual(rounds.rounds.length, 5);
  assert.strictEqual(C.poolMatchups(rounds).length, 31);
});

test('実データ: フェーズ2 (Top32) の予測メンバー = 各プール上位4人', { skip }, async () => {
  const uids = pickRealUids(256);
  const p = realPayload(uids);
  const counts = S.phaseEntrantCounts(p.phases, p.uids.length);
  const qualPools = C.phasePools(counts[0], 8);
  const advancers = qualPools.flatMap((pl) => pl.slice(0, 4)).sort((a, b) => a - b);
  // スネーク性質: 進出者 = 全体シード上位 32 人 → Top32 フェーズの参加者と一致
  assert.deepStrictEqual(advancers, Array.from({ length: 32 }, (_, i) => i));
  const finalPool = C.phasePools(counts[1], 1)[0];
  assert.deepStrictEqual(finalPool, advancers);
});
