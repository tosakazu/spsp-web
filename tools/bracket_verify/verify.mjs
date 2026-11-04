// ブラケットの構造の再現の検証: 終わった大会の sets / seeds (corpus.mjs が集めたもの) から、
// 最初のフェーズのシードと各試合の勝者だけで、全部の試合の対戦者・順位・次のフェーズのシードが start.gg と一致するか。
// 使い方: node tools/bracket_verify/verify.mjs <cache dir> [--show N]
import fs from 'node:fs';
import path from 'node:path';
import { addGroup, emptyBracket, resolve, BYE, VOID } from '../../worker/src/api/bracket_engine.ts';

const dir = process.argv[2];
const show = Number((process.argv.find((a) => a.startsWith('--show=')) || '--show=5').split('=')[1]);
const byEvent = new Map();
for (const f of fs.readdirSync(dir)) {
  if (!/^g\d+\.json$/.test(f)) continue;
  const g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const a = byEvent.get(g.event); if (a) a.push(g); else byEvent.set(g.event, [g]);
}
const st = { events: 0, groups: 0, types: {}, sets: 0, occOk: 0, occBad: 0, placeOk: 0, placeBad: 0, progOk: 0, progBad: 0, progPending: 0,
  fullOk: 0, fullBad: 0, fullEventsOk: 0, fullEventsBad: 0, skippedEvents: 0, rrProgEvents: 0 };
const bad = { occ: [], place: [], prog: [], full: [] };
const norm = (v) => (v === BYE || v === VOID || v == null ? null : v);
for (const [ev, groups] of byEvent) {
  st.events++;
  const b = emptyBracket();
  const actualOcc = {}; const winners = {};
  for (const g of groups) {
    st.groups++; st.types[g.bracketType] = (st.types[g.bracketType] || 0) + 1;
    addGroup(b, String(g.gid), g.bracketType, g.sets, g.seeds);
    for (const s of g.sets) {
      actualOcc[s.id] = (s.slots || []).slice(0, 2).map((x) => (x && x.entrant ? String(x.entrant.id) : null));
      if (s.winnerId != null) winners[s.id] = String(s.winnerId);
    }
  }
  const supported = groups.every((g) => g.bracketType === 'DOUBLE_ELIMINATION' || g.bracketType === 'SINGLE_ELIMINATION' || g.bracketType === 'ROUND_ROBIN');
  if (!supported) { st.skippedEvents++; continue; }
  // 1) 対戦者 (シードは start.gg の値)
  let r;
  try { r = resolve(b, winners, { fromSources: false }); } catch (e) { bad.occ.push(`${ev} throw ${e.message}`); st.occBad++; continue; }
  for (const g of groups) for (const s of g.sets) {
    st.sets++;
    const p = r.sets[s.id].occ.map(norm); const a = actualOcc[s.id];
    // start.gg が行わなかったやり直しの試合は返らない。返ってきた試合の枠は一致するはず
    const ok = (p[0] === a[0] && p[1] === a[1]);
    if (ok) st.occOk++; else { st.occBad++; if (bad.occ.length < 200) bad.occ.push(`ev ${ev} g ${g.gid} set ${s.id} ${s.identifier} r${s.round} pred ${p} actual ${a} slots ${JSON.stringify(s.slots.map((x) => [x.prereqType, x.prereqId, x.prereqPlacement]))}`); }
  }
  // 2) 順位 (総当たり以外)
  for (const g of groups) {
    if (g.bracketType === 'ROUND_ROBIN') continue;
    const pl = r.place[String(g.gid)] || {};
    for (const sd of g.seeds) {
      if (!sd.entrant || sd.placement == null) continue;
      const e = String(sd.entrant.id);
      if (pl[e] === sd.placement) st.placeOk++; else { st.placeBad++; if (bad.place.length < 200) bad.place.push(`ev ${ev} g ${g.gid} ${g.bracketType} entrant ${e} pred ${pl[e]} actual ${sd.placement}`); }
    }
  }
  // 3) 次のフェーズのシード (元のブロックの順位から)
  const r2 = (() => { try { return resolve(b, winners, { fromSources: true }); } catch (e) { bad.full.push(`${ev} throw ${e.message}`); return null; } })();
  if (!r2) { st.fullEventsBad++; continue; }
  const rrSrc = groups.some((g) => g.seeds.some((sd) => sd.progressionSource && groups.find((x) => String(x.gid) === String(sd.progressionSource.originPhaseGroup && sd.progressionSource.originPhaseGroup.id))?.bracketType === 'ROUND_ROBIN'));
  if (rrSrc) { st.rrProgEvents++; }
  for (const g of groups) for (const sd of g.seeds) {
    if (!sd.progressionSource || !sd.entrant) continue;
    const og = groups.find((x) => String(x.gid) === String(sd.progressionSource.originPhaseGroup && sd.progressionSource.originPhaseGroup.id));
    if (!og || og.bracketType === 'ROUND_ROBIN') continue;
    const p = r2.seed[String(sd.id)];
    if (p == null) { st.progPending++; if (bad.prog.length < 200) bad.prog.push(`ev ${ev} seed ${sd.id} pending src ${JSON.stringify(sd.progressionSource)}`); }
    else if (p === String(sd.entrant.id)) st.progOk++;
    else { st.progBad++; if (bad.prog.length < 200) bad.prog.push(`ev ${ev} g ${g.gid} seed ${sd.id} pred ${p} actual ${sd.entrant.id} src pl${sd.progressionSource.originPlacement} ord${sd.progressionSource.originOrder} og ${og.gid}`); }
  }
  // 4) 最初のシード + 勝者だけで全部 (総当たりから進むイベントは除く)
  if (!rrSrc) {
    let evOk = true;
    for (const g of groups) for (const s of g.sets) {
      const p = r2.sets[s.id].occ.map(norm); const a = actualOcc[s.id];
      if (p[0] === a[0] && p[1] === a[1]) st.fullOk++; else { st.fullBad++; evOk = false; if (bad.full.length < 200) bad.full.push(`ev ${ev} g ${g.gid} set ${s.id} ${s.identifier} pred ${p} actual ${a}`); }
    }
    if (evOk) st.fullEventsOk++; else st.fullEventsBad++;
  }
}
console.log(JSON.stringify(st, null, 1));
for (const k of Object.keys(bad)) { if (bad[k].length) { console.log('--', k, bad[k].length); for (const x of bad[k].slice(0, show)) console.log('  ', x); } }
