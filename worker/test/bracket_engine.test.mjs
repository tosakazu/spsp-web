// ブラケットの構造の計算 (src/api/bracket_engine.ts) と、写しとのつなぎ (report_bracket.ts) のテスト (2026-11-05)。
// fixtures/startgg_brackets.json = 終わった大会の start.gg の sets / seeds (出場者は ID だけ):
//   de13 = 13 人のダブルイリミ (不戦勝あり)、pools = 4 プール → TOP24、reset = グランドファイナルのやり直しがあった大会 (敗者側に直接入る人あり)。
// 確かめること: 最初のシードと各試合の勝者だけから、全部の試合の対戦者・順位・次のフェーズのシードが start.gg と一致する。
// 大きな検証 (終わった大会 数百件) は tools/bracket_verify/verify.mjs。
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { addGroup, emptyBracket, resolve, BYE, VOID } from '../src/api/bracket_engine.ts';
import { checkSnap, projectFull, projectSnap, trustedGroups } from '../src/api/report_bracket.ts';
import { absorbSeed, absorbSet, emptySnapshot } from '../src/api/report_outage.ts';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/startgg_brackets.json', import.meta.url), 'utf8'));
/** 試合の通過先のリンク (winnerProgressionSeed / loserProgressionSeed) を外した実例 (控えのきまりの検証用) */
const noLinks = (groups) => groups.map((g) => ({ ...g, sets: g.sets.map(({ winnerProgressionSeed, loserProgressionSeed, ...x }) => x) }));
const norm = (v) => (v === BYE || v === VOID || v == null ? null : v);

function build(groups) {
  const b = emptyBracket();
  const winners = {};
  for (const g of groups) {
    addGroup(b, g.gid, g.bracketType, g.sets, g.seeds);
    for (const s of g.sets) if (s.winnerId != null) winners[s.id] = String(s.winnerId);
  }
  return { b, winners };
}
function sameAsStartgg(groups, r) {
  let n = 0;
  for (const g of groups) for (const s of g.sets) {
    const actual = s.slots.map((x) => (x.entrant ? String(x.entrant.id) : null));
    assert.deepStrictEqual(r.sets[s.id].occ.map(norm), actual, `set ${s.id} ${s.identifier}`);
    n++;
  }
  return n;
}

for (const [name, groups] of [...Object.entries(FX), ...Object.entries(FX).map(([k, v]) => [k + ' (リンクなし)', noLinks(v)])]) {
  test(`実例 ${name}: 最初のシードと勝者だけで全部の試合の対戦者・順位・次のフェーズのシードが start.gg と一致する`, () => {
    const { b, winners } = build(groups);
    const r = resolve(b, winners, { fromSources: true });
    assert.ok(sameAsStartgg(groups, r) > 20);
    for (const g of groups) {
      if (g.bracketType === 'ROUND_ROBIN') continue;
      for (const sd of g.seeds) if (sd.entrant && sd.placement != null) assert.strictEqual(r.place[g.gid][String(sd.entrant.id)], sd.placement, `place ${sd.entrant.id}`);
      for (const sd of g.seeds) if (sd.progressionSource && sd.entrant) assert.strictEqual(r.seed[String(sd.id)], String(sd.entrant.id), `seed ${sd.id}`);
    }
  });
}

test('勝者が無ければ次の試合は未定のまま。不戦勝はもう片方が上がる', () => {
  const { b } = build(FX.de13);
  const r = resolve(b, {}, { fromSources: true });
  const g = FX.de13[0];
  // 1 回戦で片方が bye の試合は勝者が決まっている
  const byeSet = g.sets.find((s) => s.round === 1 && s.slots.some((x) => x.prereqType === 'bye') && s.slots.some((x) => x.prereqType === 'seed'));
  const st = r.sets[byeSet.id];
  assert.ok(st.w && st.w !== BYE && st.l === BYE);
  // グランドファイナルは未定
  const gf = g.sets.find((s) => s.round === Math.max(...g.sets.map((x) => x.round)));
  assert.deepStrictEqual(r.sets[gf.id].occ, [null, null]);
});

test('グランドファイナルのやり直し: 勝者側から来た人が勝てば行わない (void)、敗者側から来た人が勝てば行う', () => {
  const b = emptyBracket();
  // 4 人のダブルイリミの最後だけ: 勝者側決勝 W (1 vs 2)、敗者側決勝 L (3 vs W の敗者)、GF = W の勝者 vs L の勝者、R = GF の 1 vs 2
  addGroup(b, 'g', 'DOUBLE_ELIMINATION', [
    { id: 'W', round: 2, wPlacement: 1, lPlacement: 3, slots: [{ prereqType: 'seed', prereqId: 's1' }, { prereqType: 'seed', prereqId: 's2' }] },
    { id: 'L', round: -2, wPlacement: 2, lPlacement: 3, slots: [{ prereqType: 'set', prereqId: 'W', prereqPlacement: 2 }, { prereqType: 'seed', prereqId: 's3' }] },
    { id: 'GF', round: 3, wPlacement: 1, lPlacement: 2, slots: [{ prereqType: 'set', prereqId: 'W', prereqPlacement: 1 }, { prereqType: 'set', prereqId: 'L', prereqPlacement: 1 }] },
    { id: 'R', round: 3, wPlacement: 1, lPlacement: 2, slots: [{ prereqType: 'set', prereqId: 'GF', prereqPlacement: 1 }, { prereqType: 'set', prereqId: 'GF', prereqPlacement: 2 }] },
  ], [{ id: 's1', groupSeedNum: 1, entrant: { id: 'A' } }, { id: 's2', groupSeedNum: 2, entrant: { id: 'B' } }, { id: 's3', groupSeedNum: 3, entrant: { id: 'C' } }]);
  let r = resolve(b, { W: 'A', L: 'B', GF: 'A' });
  assert.strictEqual(r.sets.R.void, true);
  assert.deepStrictEqual([r.place.g.A, r.place.g.B, r.place.g.C], [1, 2, 3]);
  r = resolve(b, { W: 'A', L: 'B', GF: 'B' });
  assert.deepStrictEqual(r.sets.R.occ, ['B', 'A']);
  assert.strictEqual(r.place.g.A, undefined, 'やり直しの結果が出るまで順位は未定');
  r = resolve(b, { W: 'A', L: 'B', GF: 'B', R: 'A' });
  assert.deepStrictEqual([r.place.g.A, r.place.g.B], [1, 2]);
});

test('通過先のリンクがあれば確かめなくても次のフェーズが埋まり、確かめる並び (ties) も出ない', () => {
  const { b, winners } = build(FX.pools);
  const top = FX.pools.find((g) => g.seeds.some((s) => s.progressionSource));
  const r = resolve(b, winners, { fromSources: true, confirmed: () => false });
  assert.deepStrictEqual(r.ties, {});
  for (const sd of top.seeds) if (sd.progressionSource && sd.entrant) assert.strictEqual(r.seed[String(sd.id)], String(sd.entrant.id));
});

test('リンクが無いとき: 同じ順位の通過順は確かめたブロックだけ使う (confirmed)。総当たりからの通過は計算しない', () => {
  const { b, winners } = build(noLinks(FX.pools));
  const pools = FX.pools.filter((g) => g.seeds.every((s) => !s.progressionSource));
  const top = FX.pools.find((g) => g.seeds.some((s) => s.progressionSource));
  const r0 = resolve(b, winners, { fromSources: true, confirmed: () => false });
  const tied = top.seeds.filter((s) => s.progressionSource && FX.pools.length);
  assert.ok(tied.some((s) => r0.seed[String(s.id)] === null), '確かめていなければ同じ順位の人は未定');
  assert.ok(Object.keys(r0.ties).length >= pools.length - 1, '通過順の並びを返す');
  const r1 = resolve(b, winners, { fromSources: true, confirmed: () => true });
  for (const s of tied) assert.strictEqual(r1.seed[String(s.id)], String(s.entrant.id));
  // 総当たりのブロックからの通過は順位を計算しない
  const rr = emptyBracket();
  addGroup(rr, 'p', 'ROUND_ROBIN', [{ id: 'x', round: 1, slots: [{ prereqType: 'seed', prereqId: 'a' }, { prereqType: 'seed', prereqId: 'b' }] }],
    [{ id: 'a', groupSeedNum: 1, entrant: { id: 'A' } }, { id: 'b', groupSeedNum: 2, entrant: { id: 'B' } }]);
  addGroup(rr, 'q', 'DOUBLE_ELIMINATION', [], [{ id: 'n1', groupSeedNum: 1, entrant: null, progressionSource: { originPlacement: 1, originOrder: 1, originPhaseGroup: { id: 'p' } } }]);
  assert.strictEqual(resolve(rr, { x: 'A' }, { fromSources: true }).seed.n1, null);
});

/** 前のフェーズから来るシードの枠 (start.gg はプールが終わるまで空) */
const progSeed = (g, x) => x.prereqType === 'seed' && g.seeds.some((sd) => String(sd.id) === String(x.prereqId) && sd.progressionSource);
/** 実例を写し (Snapshot) にする。cut = この試合 ID の集合だけ start.gg に結果がある (ほかは結果も次の枠も空) */
function snapOf(groups, done) {
  const snap = emptySnapshot();
  const { b, winners } = build(groups);
  const w = Object.fromEntries(Object.entries(winners).filter(([id]) => done.has(String(id))));
  const r = resolve(b, w, { fromSources: true, confirmed: () => true });
  for (const g of groups) {
    for (const s of g.sets) {
      const st = r.sets[s.id];
      if (st.void) continue;
      const raw = { ...s, state: done.has(String(s.id)) ? 3 : 1, winnerId: done.has(String(s.id)) ? s.winnerId : null, phaseGroup: { id: g.gid, displayIdentifier: '1', bracketType: g.bracketType, phase: { id: 'p' + g.gid, name: 'P', groupCount: 1 } },
        slots: s.slots.map((x, k) => ({ ...x, entrant: norm(st.occ[k]) && !progSeed(g, x) ? { id: st.occ[k], name: 'E' + st.occ[k], participants: [] } : null })) };
      absorbSet(snap, { ...raw, id: s.id }, 1);
    }
    for (const sd of g.seeds) absorbSeed(snap, { ...sd, phaseGroup: { id: g.gid }, entrant: sd.progressionSource ? null : sd.entrant });
  }
  snap.full = true;
  return snap;
}

test('写し: 照合で一致すれば信用し、障害中の SPSP の結果から次の試合を計算で埋める (pd)。食い違えば信用しない', () => {
  const groups = FX.de13;
  const sets = groups[0].sets.filter((s) => s.round === 1).map((s) => String(s.id));
  const snap = snapOf(groups, new Set(sets));
  checkSnap(snap, 1);
  assert.deepStrictEqual(snap.chk.bad, {});
  assert.ok(trustedGroups(snap).has(groups[0].gid));
  // 2 回戦の 1 試合の結果が SPSP にだけある → その次の試合の枠が埋まる
  const r2 = groups[0].sets.find((s) => s.round === 2 && s.winnerId);
  const nextOf = groups[0].sets.find((s) => s.slots.some((x) => x.prereqType === 'set' && String(x.prereqId) === String(r2.id) && x.prereqPlacement === 1));
  const before = snap.sets[String(nextOf.id)].sl.map((x) => x.e);
  const pj = projectSnap(snap, { [String(r2.id)]: String(r2.winnerId) });
  const after = pj.sets[String(nextOf.id)].sl;
  const k = nextOf.slots.findIndex((x) => String(x.prereqId) === String(r2.id));
  assert.strictEqual(before[k], null);
  assert.strictEqual(after[k].e, String(r2.winnerId));
  assert.strictEqual(after[k].pd, 1);
  assert.strictEqual(snap.sets[String(nextOf.id)].sl[k].e, null, 'もとの写しは変えない');
  // start.gg の枠が計算と違う → そのブロックは信用しない・埋めない
  const bad = snapOf(groups, new Set(sets));
  const some = Object.values(bad.sets).find((s) => s.r === 2 && s.sl[0].e && s.sl[1].e);
  some.sl[0].e = some.sl[1].e === 'X' ? 'Y' : 'X';
  checkSnap(bad, 1);
  assert.ok(bad.chk.bad[groups[0].gid]);
  assert.strictEqual(projectSnap(bad, { [String(r2.id)]: String(r2.winnerId) }), bad);
});

test('写し (リンクなし): プールが終わっても、同じ順位の通過順は運営が確かめるまで次のフェーズを埋めない', () => {
  const groups = noLinks(FX.pools);
  const top = groups.find((g) => g.seeds.some((s) => s.progressionSource));
  const poolSets = groups.filter((g) => g !== top).flatMap((g) => g.sets.map((s) => String(s.id)));
  const snap = snapOf(groups, new Set(poolSets));
  checkSnap(snap, 1);
  assert.deepStrictEqual(snap.chk.bad, {});
  const a = projectFull(snap, {}, [], new Set());
  assert.ok(Object.keys(a.ties).length > 0, '確かめる並びがある');
  const r1 = top.sets.find((s) => s.round === 1 && s.slots.every((x) => x.prereqType === 'seed'));
  const tiedSeed = (sl) => { const sd = top.seeds.find((x) => String(x.id) === String(sl.prereqId)); return sd && sd.progressionSource; };
  const k = r1.slots.findIndex(tiedSeed);
  // 確かめていない並びのシードは空のまま (1 位通過など同じ順位が 1 人だけのシードは埋まる)
  const all = new Set(Object.keys(a.ties));
  const b = projectFull(snap, {}, [], all);
  const filled = (pj) => top.sets.filter((s) => s.round === 1).reduce((n, s) => n + pj.sets[String(s.id)].sl.filter((x) => x.e).length, 0);
  assert.ok(filled(b.snap) > filled(a.snap), '確かめると埋まる');
  assert.ok(k >= 0);
  // 確かめた並びで埋めたものは start.gg の本当の本戦と一致する
  const truth = build(groups);
  const tr = resolve(truth.b, truth.winners, { fromSources: true });
  for (const s of top.sets.filter((x) => x.round === 1)) {
    const sl = b.snap.sets[String(s.id)].sl;
    for (let i = 0; i < 2; i++) if (sl[i].e) assert.strictEqual(sl[i].e, norm(tr.sets[s.id].occ[i]));
  }
});

test('写し (リンクあり): プールが終われば確かめなくても次のフェーズが埋まり、start.gg の本戦と一致する', () => {
  const groups = FX.pools;
  const top = groups.find((g) => g.seeds.some((s) => s.progressionSource));
  const snap = snapOf(groups, new Set(groups.filter((g) => g !== top).flatMap((g) => g.sets.map((s) => String(s.id)))));
  checkSnap(snap, 1);
  assert.deepStrictEqual(snap.chk.bad, {});
  const a = projectFull(snap, {}, [], new Set());
  assert.deepStrictEqual(a.ties, {});
  const truth = build(groups);
  const tr = resolve(truth.b, truth.winners, { fromSources: true });
  let filled = 0;
  // 本戦でシードから入る枠 (勝者側 1 回戦と、敗者側に直接入る人)
  for (const s of top.sets.filter((x) => x.slots.some((y) => y.prereqType === 'seed'))) {
    const sl = a.snap.sets[String(s.id)].sl;
    for (let i = 0; i < 2; i++) { if (norm(tr.sets[s.id].occ[i])) { assert.strictEqual(sl[i].e, norm(tr.sets[s.id].occ[i])); filled++; } }
  }
  assert.ok(filled > 10);
});
