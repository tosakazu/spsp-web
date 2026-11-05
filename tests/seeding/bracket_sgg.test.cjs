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
