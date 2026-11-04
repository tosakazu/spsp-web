/**
 * 結果報告: ブラケットの写し (report_outage.ts の Snapshot) と構造の計算 (bracket_engine.ts) をつなぐ (2026-11-05)。
 *
 *   - checkSnap: start.gg が読めるあいだ、写しの構造と勝者から計算した対戦者を start.gg の対戦者と突き合わせる。
 *     食い違ったブロックは「信用しない」(snap.chk.bad) にして、障害中もそのブロックは計算で埋めない (運営の「次の試合を指定」に任せる)。
 *   - projectSnap: 障害中、SPSP に残した結果 (未反映) も勝者として数え、まだ start.gg に出ていない対戦者を計算で埋めた写しを作る。
 *     選手の画面・報告の確かめ・トーナメント表はこれを使う。埋めた枠は pd = 1。
 */
import { addGroup, BYE, emptyBracket, resolve, VOID } from './bracket_engine.ts';
import type { Bracket, Resolved } from './bracket_engine.ts';
import type { Snapshot, SnapSet, SnapSlot } from './report_outage.ts';

/** 写しに構造の計算に要るもの (不戦勝の試合・勝ったときの順位・シード) が揃っているか (2026-11-05 より前の写しには無い) */
export function snapHasStructure(snap: Snapshot): boolean {
  const sets = Object.values(snap.sets);
  return !!snap.seeds && Object.keys(snap.seeds).length > 0 && sets.length > 0 && sets.every((s) => s.wp !== undefined);
}

/** 写し → 計算の入力 */
export function bracketOfSnap(snap: Snapshot): Bracket {
  const b = emptyBracket();
  const setsByGroup = new Map<string, SnapSet[]>();
  for (const s of Object.values(snap.sets)) { const a = setsByGroup.get(s.g); if (a) a.push(s); else setsByGroup.set(s.g, [s]); }
  const seedsByGroup = new Map<string, unknown[]>();
  for (const [id, sd] of Object.entries(snap.seeds || {})) {
    const raw = { id, groupSeedNum: sd.gs, entrant: sd.e ? { id: sd.e } : null,
      progressionSource: sd.src ? { originPlacement: sd.src.pl, originOrder: sd.src.ord, originPhaseGroup: { id: sd.src.g } } : null };
    const a = seedsByGroup.get(sd.g); if (a) a.push(raw); else seedsByGroup.set(sd.g, [raw]);
  }
  const gids = new Set([...setsByGroup.keys(), ...seedsByGroup.keys()]);
  for (const g of gids) {
    const sets = (setsByGroup.get(g) || []).map((s) => ({
      id: s.i, round: s.r, identifier: s.x, wPlacement: s.wp ?? null, lPlacement: s.lp,
      winnerProgressionSeed: s.wn ? { id: s.wn } : null, loserProgressionSeed: s.ln ? { id: s.ln } : null,
      slots: s.sl.map((x) => ({ prereqType: x.pt, prereqId: x.pi, prereqPlacement: x.pp })),
    }));
    addGroup(b, g, snap.groups[g] ? snap.groups[g].b || null : null, sets, seedsByGroup.get(g) || []);
  }
  return b;
}

/** start.gg で結果の出た試合の勝者 */
export function snapWinners(snap: Snapshot): Record<string, string> {
  const w: Record<string, string> = {};
  for (const s of Object.values(snap.sets)) if (s.s === 3 && s.w) w[s.i] = s.w;
  return w;
}

export const VERIFIED_TYPES = new Set(['DOUBLE_ELIMINATION', 'SINGLE_ELIMINATION', 'ROUND_ROBIN']);

const real = (v: string | null): v is string => !!v && v !== BYE && v !== VOID;

/**
 * 照合: 計算した対戦者と start.gg の対戦者。start.gg に出場者がいる枠が計算と違えば、そのブロックは信用しない。
 * (計算で未定・start.gg にいる = 前のフェーズの総当たり等で計算できないだけなので食い違いにしない。
 *  計算でいる・start.gg に未だいない = start.gg が遅れているだけなので食い違いにしない)
 */
export function checkSnap(snap: Snapshot, now: number): void {
  if (!snapHasStructure(snap)) { delete snap.chk; return; }
  let r: Resolved;
  const bad: Record<string, string> = {};
  try { r = resolve(bracketOfSnap(snap), snapWinners(snap), { fromSources: true }); } catch (e) {
    for (const g of Object.keys(snap.groups)) bad[g] = 'error:' + String((e as Error).message || e).slice(0, 60);
    snap.chk = { ms: now, ok: 0, bad };
    return;
  }
  let ok = 0;
  for (const s of Object.values(snap.sets)) {
    const st = r.sets[s.i];
    if (!st) continue;
    for (let k = 0; k < 2; k++) {
      const actual = s.sl[k] ? s.sl[k].e : null;
      const pred = st.occ[k];
      if (!actual) {
        // start.gg では空き。計算で人がいて、start.gg の試合が終わっている (= その枠は空きのまま決着) なら食い違い
        if (real(pred) && s.s === 3) bad[s.g] = bad[s.g] || `set ${s.i} slot ${k}: pred ${pred} actual empty`;
        continue;
      }
      if (pred === null) continue;
      if (pred !== actual) bad[s.g] = bad[s.g] || `set ${s.i} slot ${k}: pred ${pred} actual ${actual}`;
      else ok++;
    }
  }
  snap.chk = { ms: now, ok, bad };
}

/** 信用してよいブロック (照合済みで食い違いなし) */
export function trustedGroups(snap: Snapshot): Set<string> {
  const out = new Set<string>();
  if (!snap.chk || !snapHasStructure(snap)) return out;
  // 検証した形式だけ (2026-11-05 に終わった大会で確かめた)。スイス等は試合がその場で作られるので計算しない
  for (const [g, x] of Object.entries(snap.groups)) if (!snap.chk.bad[g] && x.b && VERIFIED_TYPES.has(x.b)) out.add(g);
  return out;
}

/** 運営の DQ (まだ start.gg に入っていない): scope w = 勝者側の次の試合 / l = 敗者側の次の試合 / a = 残り全部 / s = その試合だけ */
export interface HeldDq { entrant: string; scope: string; set_id?: string }

/**
 * 計算で埋めた写し。extra = SPSP にある (start.gg に未反映の) 結果 試合 → 勝った出場者。
 * 信用しないブロックは埋めない。もとの写しは変えない。
 */
export function projectSnap(snap: Snapshot, extra: Record<string, string>, dqs: HeldDq[] = [], confirmed: Set<string> = new Set()): Snapshot {
  return projectFull(snap, extra, dqs, confirmed).snap;
}

/** projectSnap と、運営の確認待ちの通過順 (同じ順位が 2 人以上で、まだ確かめていないブロック) */
export function projectFull(snap: Snapshot, extra: Record<string, string>, dqs: HeldDq[] = [], confirmed: Set<string> = new Set()):
  { snap: Snapshot; ties: Record<string, { pl: number; list: string[] }[]> } {
  const trusted = trustedGroups(snap);
  if (!trusted.size) return { snap, ties: {} };
  const b = bracketOfSnap(snap);
  const winners: Record<string, string> = { ...snapWinners(snap), ...extra };
  // 前のフェーズからの通過: 同じ順位が 2 人以上の並べ方は start.gg が API で返さないので、運営が確かめたブロックだけ (それ以外は未定のまま)
  const opts = { fromSources: true, confirmed: (g: string) => confirmed.has(g) };
  let r = resolve(b, winners, opts);
  // DQ: その人の (側の合う) 結果の無い試合を相手の勝ちにする。前の試合が決まると次の試合が出てくるので、変わらなくなるまで
  for (let round = 0; round < 64 && dqs.length; round++) {
    let changed = false;
    for (const d of dqs) {
      for (const s of Object.values(b.sets)) {
        const st = r.sets[s.id];
        if (!st || winners[s.id] || !st.occ.includes(d.entrant)) continue;
        const opp = st.occ[0] === d.entrant ? st.occ[1] : st.occ[0];
        if (!real(opp)) continue;
        const side = s.r < 0 ? 'l' : 'w';
        if (d.scope === 's' ? d.set_id !== s.id : !(d.scope === 'a' || d.scope === side)) continue;
        winners[s.id] = opp; changed = true;
      }
    }
    if (!changed) break;
    r = resolve(b, winners, opts);
  }
  const sets: Record<string, SnapSet> = {};
  for (const [id, s] of Object.entries(snap.sets)) {
    const st = r.sets[id];
    if (!trusted.has(s.g) || !st) { sets[id] = s; continue; }
    if (st.void) continue;   // 行わないやり直しのグランドファイナル
    const sl: SnapSlot[] = s.sl.map((x, k) => (x.e || !real(st.occ[k]) ? x : { ...x, e: st.occ[k], pd: 1 as const }));
    sets[id] = { ...s, sl };
  }
  // start.gg がまだ次のフェーズを埋めていない (= 計算が要る) ブロックの並びだけ返す
  const ties: Record<string, { pl: number; list: string[] }[]> = {};
  for (const [g, t] of Object.entries(r.ties)) {
    if (!trusted.has(g)) continue;
    const waiting = Object.values(snap.seeds || {}).some((sd) => sd.src && sd.src.g === g && !sd.e);
    if (waiting) ties[g] = t;
  }
  return { snap: { ...snap, sets }, ties };
}
