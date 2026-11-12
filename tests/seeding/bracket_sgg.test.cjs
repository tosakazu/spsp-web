'use strict';
// bracket_sgg_core.js (start.gg の構造からプレビューの表を作る) のテスト (2026-11-05)。
// worker/test/fixtures/startgg_brackets.json = 終わった大会の start.gg の sets / seeds (出場者は ID だけ)。
//   - 勝者側・敗者側の対戦が、start.gg の構造をシード通りに流した結果になる
//   - 表の形: 勝者側は 2i・2i+1 → i、敗者側は major (同じ数) / minor (半分) の繰り返し、列の形は従来の組み方に揃う
//   - 敗者側スタートのある本戦 (TOP24) も組める
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('../helpers/dicts.cjs').loadDicts();
const C = ((m) => m.default || m)(require('../../site/bracket/bracket_core.js'));
const G = ((m) => m.default || m)(require('../../site/bracket/bracket_sgg_core.js'));

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, '../../worker/test/fixtures/startgg_brackets.json'), 'utf8'));
const groups = [...FX.de13, ...FX.pools, ...FX.reset].filter((g) => g.bracketType === 'DOUBLE_ELIMINATION');
const simSets = (g) => g.sets.map((s) => ({ id: String(s.id), r: s.round, x: s.identifier, wp: s.wPlacement, lp: s.lPlacement,
  sl: s.slots.map((x) => [x.prereqType, x.prereqId == null ? null : String(x.prereqId), x.prereqPlacement]) }));
const seedGs = (g) => new Map(g.seeds.map((s) => [String(s.id), s.groupSeedNum]));
const played = (m) => m.a != null && m.b != null;

test('start.gg の構造から表を作れて、形が描き方の前提どおり', () => {
  assert.ok(groups.length >= 5);
  for (const g of groups) {
    const M = g.seeds.length;
    const de = G.deFromSgg(simSets(g), seedGs(g), M);
    assert.ok(de, 'g' + g.gid);
    for (let r = 1; r < de.winners.length; r++) {
      assert.strictEqual(de.winners[r].length * 2, de.winners[r - 1].length, '勝者側は半分ずつ');
      de.winners[r].forEach((m, i) => { assert.strictEqual(m.a, de.winners[r - 1][2 * i].w); assert.strictEqual(m.b, de.winners[r - 1][2 * i + 1].w); });
    }
    for (let i = 1; i < de.losers.length; i++) {
      const n = de.losers[i].length, p = de.losers[i - 1].length;
      assert.ok(n === p || n * 2 === p, '敗者側は major か minor');
      if (n === p) de.losers[i].forEach((m, k) => { if (played(m) || m.a != null) assert.strictEqual(m.a, de.losers[i - 1][k].w); });
    }
    // 全員がどこかに出る
    const seen = new Set();
    for (const r of de.winners.concat(de.losers)) for (const m of r) for (const v of [m.a, m.b]) if (v != null) seen.add(v);
    assert.strictEqual(seen.size, M, 'g' + g.gid + ' 全員');
    // シード通り: 勝者は小さいシード
    for (const r of de.winners.concat(de.losers)) for (const m of r) if (played(m)) assert.strictEqual(m.w, Math.min(m.a, m.b));
  }
});

test('従来の組み方の列の形に揃う (ラウンド数・試合数が同じ)', () => {
  for (const g of groups) {
    const M = g.seeds.length;
    const sg = G.deFromSgg(simSets(g), seedGs(g), M);
    const app = C.poolDoubleElim(M, sg.cut ? sg.advancers.length : 0, sg.lbStart);
    const de = G.alignToApp(app, sg);
    assert.ok(de.aligned, 'g' + g.gid + ' 揃う');
    assert.strictEqual(de.winners.length, app.winners.length);
    assert.strictEqual(de.losers.length, app.losers.length);
    de.losers.forEach((r, i) => assert.strictEqual(r.length, app.losers[i].length));
  }
});

test('敗者側スタートのある本戦: 敗者側から始まる人の数と、無敗で通過する人', () => {
  const top = FX.pools.find((g) => g.seeds.some((s) => s.progressionSource));
  const de = G.deFromSgg(simSets(top), seedGs(top), top.seeds.length);
  assert.ok(de.lbStart > 0, '敗者側スタートがある');
  assert.ok(de.gf, '本戦はグランドファイナルまで');
  const pool = FX.pools.find((g) => g !== top);
  const dp = G.deFromSgg(simSets(pool), seedGs(pool), pool.seeds.length);
  assert.ok(dp.cut && dp.advancers.length > 0 && dp.undefeated.length > 0 && dp.undefeated.length < dp.advancers.length, 'プールは打ち切りで、無敗で通過する人と敗者側から通過する人がいる');
});

test('CSV 保存・読み込みで start.gg のフェーズと構造 (sgg / sgg_data) が戻る。無ければ列も出さない', () => {
  const S = ((m) => m.default || m)(require('../../site/seeding/seed_share.js'));
  const sggData = { v: 1, fetched_at: 1, phases: [{ id: '10', name: 'P', groups: [], seeds: [], templates: {} }] };
  const payload = { v: 1, ev: 'テスト, "大会"', src: 'spsp', phases: [{ name: '予選', pools: 1 }], uids: [11, 22, 33, 44], names: { 0: 'A', 1: 'B', 2: 'C', 3: 'D' }, wv: [0], sgg: ['10'], sggData };
  const csv = S.buildWorkCsv(payload, {});
  assert.match(csv.split('\r\n')[0], /,sgg,sgg_data$/);
  const back = S.workCsvToPayload(csv, {}).payload;
  assert.deepStrictEqual(back.sgg, ['10']);
  assert.deepStrictEqual(back.sggData, sggData);
  const plain = S.buildWorkCsv({ ...payload, sgg: undefined, sggData: undefined }, {});
  assert.doesNotMatch(plain.split('\r\n')[0], /sgg/);
  assert.strictEqual(S.workCsvToPayload(plain, {}).payload.sgg, undefined);
  // データ版 (突き合わせ用) は構造で変わらない
  assert.strictEqual(S.payloadVersion(payload), S.payloadVersion({ ...payload, sggData: undefined }));
});

// 2026-11-12: 開始前の後ろのフェーズ (start.gg がシードを返さない) は、試合の枠のシード ID からシード順を割り出す
test('deriveSeedGs: 開始前の後ろのフェーズのシード順を試合の構造から割り出す (検算つき)', () => {
  const fx = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/sgg_later_phases.json'), 'utf8'));
  const [top48, top8] = fx.phases;
  // TOP 48 = 前のフェーズ 2 ブロックからの通過 (勝者側 16 + 敗者側 32)
  const d48 = G.deriveSeedGs(top48.sets, top48.prevGroups);
  assert.ok(d48 && d48.M === 48);
  assert.deepStrictEqual([...d48.seedGs.values()].sort((a, b) => a - b), Array.from({ length: 48 }, (_, i) => i + 1));
  // 勝者側 1 回戦は 1-16, 2-15, … (和が 17)
  for (const s of top48.sets) {
    if (!(s.r > 0)) continue;
    const v = s.sl.filter((x) => x[0] === 'seed').map((x) => d48.seedGs.get(String(x[1])));
    if (v.length === 2) assert.strictEqual(v[0] + v[1], 17);
  }
  const sg48 = G.deFromSgg(top48.sets, d48.seedGs, 48);
  assert.ok(sg48 && sg48.lbStart === 32, '敗者側スタート 32 人');
  const base48 = C.poolDoubleElim(48, 8, 32);
  const al48 = G.alignToApp(base48, sg48);
  assert.ok(al48, '表の形に揃えられる');
  // 敗者側 1 回戦は start.gg の並び (同じブロックから来た人を離す) で、従来の推定とは違う
  assert.notDeepStrictEqual(al48.losers[0].map((m) => [m.a, m.b]), base48.losers[0].map((m) => [m.a, m.b]));
  for (const m of al48.losers[0]) assert.ok(m.a > 16 && m.b > 16, '敗者側 1 回戦は敗者側スタートの人どうし');
  // TOP 8 (勝者側 4 + 敗者側 4)
  const d8 = G.deriveSeedGs(top8.sets, top8.prevGroups);
  assert.ok(d8 && d8.M === 8);
  assert.ok(G.alignToApp(C.poolDoubleElim(8, 0, 4), G.deFromSgg(top8.sets, d8.seedGs, 8)));
  // 前のフェーズのブロック数が違う (ID の並びの読み方が合わない) と検算が合わず null = 推定のまま
  assert.strictEqual(G.deriveSeedGs(top48.sets, 5), null);
  assert.strictEqual(G.deriveSeedGs([], 2), null);
});

test('bracket_sgg.js: 管理者のトークンを先に試す・フェーズごとの反映状況を出す (配線)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/pages/bracket_sgg.js'), 'utf8');
  assert.ok(/SpspStartggManager\.load\(\)/.test(src) && /kind: 'manager'/.test(src));
  assert.ok(src.indexOf("kind: 'manager'") < src.indexOf("kind: 'identity'"), '管理者のトークンが先');
  assert.ok(/loginFromBracket\(\{ manager: /.test(src));
  assert.ok(/bracket\.sgg\.applied_all/.test(src) && /bracket\.sgg\.estimated_phase/.test(src));
  const ret = fs.readFileSync(path.resolve(__dirname, '../../src/pages/bracket_login_return.js'), 'utf8');
  assert.ok(/SpspStartggManager\.start/.test(ret));
});
