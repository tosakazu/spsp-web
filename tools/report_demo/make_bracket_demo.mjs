// 結果報告の見本 (?demo=bracket) のトーナメント表のデータを作る (2026-11-05)。
// worker/test/fixtures/startgg_brackets.json の pools (4 プール → TOP24、終わった大会。出場者は ID だけ) を途中の時刻で切り、
// 名前は「選手 N」に置き換える。書き出し = site/report/demo_bracket.json (画面が見本のときだけ読む)。
// 使い方: node tools/report_demo/make_bracket_demo.mjs
import fs from 'node:fs';
import { addGroup, emptyBracket, resolve, BYE, VOID } from '../../worker/src/api/bracket_engine.ts';

const FX = JSON.parse(fs.readFileSync(new URL('../../worker/test/fixtures/startgg_brackets.json', import.meta.url), 'utf8'));
const groups = FX.pools;
const top = groups.find((g) => g.seeds.some((s) => s.progressionSource));
const pools = groups.filter((g) => g !== top).sort((a, b) => Number(a.gid) - Number(b.gid));
const real = (v) => v && v !== BYE && v !== VOID;
// 途中の時刻: プール 1〜3 は終わり、プール 4 は |round| <= 3 まで、TOP24 は始まったばかり (勝者側 1 回戦の 1 試合だけ)
const done = new Set();
for (const g of pools.slice(0, 3)) for (const s of g.sets) done.add(String(s.id));
for (const s of pools[3].sets) if (Math.abs(s.round) <= 3) done.add(String(s.id));
const b = emptyBracket();
const winners = {};
for (const g of groups) { addGroup(b, g.gid, g.bracketType, g.sets, g.seeds); for (const s of g.sets) if (s.winnerId != null) winners[s.id] = String(s.winnerId); }
const allR = resolve(b, winners, { fromSources: true });
const top1 = top.sets.find((s) => s.round === 1 && s.slots.every((x) => x.prereqType === 'seed'));
done.add(String(top1.id));
const w = Object.fromEntries(Object.entries(winners).filter(([id]) => done.has(String(id))));
// SPSP にある未反映の結果 (1 試合) と、対戦中 (1 試合)
const p4open = pools[3].sets.filter((s) => !done.has(String(s.id)) && !s.slots.some((x) => x.prereqType === 'bye'));
const resNow = resolve(b, w, { fromSources: true });
const ready = p4open.filter((s) => resNow.sets[s.id].occ.every(real));
const held = ready[0]; const live = ready[1];
const r = resolve(b, { ...w, [held.id]: String(held.winnerId) }, { fromSources: true });
// 名前: 出場者 ID → 選手 N (シード順)
const order = new Map();
for (const g of pools) for (const sd of g.seeds) if (sd.entrant) order.set(String(sd.entrant.id), sd.seedNum);
const ids = [...order.keys()].sort((a, c) => order.get(a) - order.get(c));
const name = new Map(ids.map((id, i) => [id, '選手 ' + (i + 1)]));
const roundText = (g, s) => {
  const ws = g.sets.filter((x) => x.round > 0).map((x) => x.round); const ls = g.sets.filter((x) => x.round < 0).map((x) => -x.round);
  const wmax = Math.max(...ws); const lmax = ls.length ? Math.max(...ls) : 0;
  if (s.round > 0) return g === top && s.round === wmax ? 'Grand Final' : s.round === wmax - (g === top ? 1 : 0) ? 'Winners Final' : 'Winners Round ' + s.round;
  return -s.round === lmax ? 'Losers Final' : 'Losers Round ' + (-s.round);
};
const view = {};
for (const g of groups) {
  const ents = {};
  const sets = g.sets.map((s) => {
    const st = r.sets[s.id];
    const isDone = done.has(String(s.id));
    // start.gg に出ている枠 = 終わった試合の結果から決まる枠 (計算の枠 pd は SPSP の未反映の結果・まだ start.gg が埋めていない次のフェーズ)
    const shown = resolve(b, w, { fromSources: false }).sets[s.id];
    const sl = s.slots.map((x, k) => {
      const e = real(st.occ[k]) ? st.occ[k] : null;
      const onSgg = real(shown.occ[k]) && !(g === top && x.prereqType === 'seed');
      if (e) ents[e] = name.get(e) || '選手';
      const win = isDone && e && String(s.winnerId) === e;
      const row = { e, sc: isDone && e ? (win ? 2 : (Number(e) % 2)) : null, pd: e && !onSgg ? 1 : 0, pt: x.prereqType, pi: x.prereqId == null ? null : String(x.prereqId), pp: x.prereqPlacement };
      if (s === held && e) row.hs = String(held.winnerId) === e ? 3 : 1;   // start.gg 未反映の結果のスコア (2026-11-10)
      return row;
    });
    return { i: String(s.id), r: s.round, t: roundText(g, s), x: s.identifier, s: isDone ? 3 : s === live ? 2 : 1, w: isDone ? String(s.winnerId) : null,
      st: s === live ? 7 : null, hw: s === held ? String(held.winnerId) : null, sl };
  });
  view[g.gid] = { group: { id: g.gid, name: g === top ? 'TOP24' : 'Pools ' + (pools.indexOf(g) + 1), b: g.bracketType, bad: false }, sets, ents };
}
const me = String(held.winnerId);
const out = {
  v: 1, me: [me],
  groups: [...pools.map((g, i) => ({ id: g.gid, name: 'Pools ' + (i + 1), d: String(i + 1), b: g.bracketType })), { id: top.gid, name: 'TOP24', d: '1', b: top.bracketType }],
  view,
};
fs.writeFileSync(new URL('../../site/report/demo_bracket.json', import.meta.url), JSON.stringify(out));
console.log('wrote demo_bracket.json', JSON.stringify(out).length, 'bytes; me', name.get(me), 'held', held.identifier, 'live', live && live.identifier);
