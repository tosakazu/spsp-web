/**
 * ブラケットの構造から、各試合の対戦者・勝者・順位を計算する (start.gg に繋がらなくても大会を進めるため。2026-11-05)。
 *
 * 入力は start.gg の phaseGroup の sets (showByes: true・hideEmpty: false) と seeds をそのまま縮めたもの:
 *   - 試合の枠 = seed (シード → 出場者) / set (前の試合の 1 = 勝者・2 = 敗者) / bye (不戦勝の空き)
 *   - 前のフェーズから来るシード = progressionSource (元のブロック・順位・同順位の中の順番)
 * 結果は「試合 → 勝った出場者」だけ (start.gg の結果と SPSP の結果を重ねたもの)。
 *
 * きまり:
 *   - 片方が空き (bye) の試合は、もう片方の勝ち・敗者は空き。両方空きなら勝者も敗者も空き。
 *   - グランドファイナルのやり直し (両方の枠が同じ試合の 1 と 2) は、グランドファイナルの勝者が敗者側の試合 (round < 0) から来た枠の人のときだけ行う。
 *     行わないときは void (その試合は無い)。
 *   - 順位 = 出場者が最後にいる「どの試合にも使われない出口」の順位 (勝者なら wPlacement・敗者なら lPlacement)。
 *   - 前のフェーズからのシード = 元のブロックで originPlacement の出口を下の順に並べた originOrder 番目。同じ順位の出口が全部決まるまでは決まらない。
 *     並び = 上位シード (groupSeedNum の小さい方) が全部勝ったとしたときにその出口に来るシード番号の順。敗者側の試合で負けて抜ける出口だけは、その試合の勝者に来るシード番号の順。
 * 総当たり (ROUND_ROBIN) は全部の試合がシード同士なので対戦者は決まるが、順位 (同率の決め方) はここでは計算しない (rr = true)。
 */

export const BYE = '#bye';
export const VOID = '#void';
/** まだ決まっていない */
export const PENDING = null;
export type Occ = string | typeof PENDING;   // 出場者 ID / BYE / VOID / null

export interface BSlot { k: 'seed' | 'set' | 'bye' | null; id: string | null; p: number | null }
export interface BSet { id: string; g: string; r: number; sl: [BSlot, BSlot]; wp: number | null; lp: number | null; ident?: string }
export interface BSeed { id: string; g: string; gs: number | null; e: string | null; src: { g: string; pl: number; ord: number } | null }
export interface BGroup { id: string; rr: boolean }
export interface Bracket { groups: Record<string, BGroup>; sets: Record<string, BSet>; seeds: Record<string, BSeed> }

export interface SetState {
  /** 2 つの枠の出場者 (BYE / VOID / null = 未定) */
  occ: [Occ, Occ];
  /** 勝者・敗者 (未定なら null) */
  w: Occ; l: Occ;
  /** グランドファイナルのやり直しで、行わないと決まった */
  void: boolean;
}

export interface Resolved {
  sets: Record<string, SetState>;
  /** ブロックごとの順位 (出場者 → 順位)。決まった人だけ */
  place: Record<string, Record<string, number>>;
  /** シード → 出場者 (前のフェーズから来るシードは決まったときだけ) */
  seed: Record<string, Occ>;
  /** 同じ順位の出口が 2 つ以上あり、並べ方 (start.gg が API で返さない) を推定で決めるブロック → 順位ごとの並び (決まったものだけ) */
  ties: Record<string, { pl: number; list: string[] }[]>;
}

/** start.gg の phaseGroup の sets・seeds から Bracket に足す */
export function addGroup(b: Bracket, gid: string, bracketType: string | null, rawSets: unknown[], rawSeeds: unknown[]): void {
  b.groups[gid] = { id: gid, rr: bracketType === 'ROUND_ROBIN' };
  for (const x of rawSets) {
    const s = x as { id?: unknown; round?: unknown; identifier?: unknown; wPlacement?: unknown; lPlacement?: unknown; slots?: unknown[] } | null;
    if (!s || s.id == null) continue;
    const sl = (Array.isArray(s.slots) ? s.slots : []).slice(0, 2).map((y): BSlot => {
      const o = (y || {}) as { prereqType?: unknown; prereqId?: unknown; prereqPlacement?: unknown };
      const k = o.prereqType === 'seed' || o.prereqType === 'set' || o.prereqType === 'bye' ? o.prereqType : null;
      return { k, id: o.prereqId == null ? null : String(o.prereqId), p: o.prereqPlacement == null ? null : Number(o.prereqPlacement) };
    });
    while (sl.length < 2) sl.push({ k: null, id: null, p: null });
    b.sets[String(s.id)] = {
      id: String(s.id), g: gid, r: Number(s.round) || 0, sl: [sl[0], sl[1]],
      wp: s.wPlacement == null ? null : Number(s.wPlacement), lp: s.lPlacement == null ? null : Number(s.lPlacement),
      ident: typeof s.identifier === 'string' ? s.identifier : undefined,
    };
  }
  for (const x of rawSeeds) {
    const s = x as { id?: unknown; groupSeedNum?: unknown; seedNum?: unknown; entrant?: { id?: unknown } | null; progressionSource?: { originPlacement?: unknown; originOrder?: unknown; originPhaseGroup?: { id?: unknown } | null } | null } | null;
    if (!s || s.id == null) continue;
    const ps = s.progressionSource;
    const src = ps && ps.originPhaseGroup && ps.originPhaseGroup.id != null && ps.originPlacement != null
      ? { g: String(ps.originPhaseGroup.id), pl: Number(ps.originPlacement), ord: Number(ps.originOrder) || 1 } : null;
    b.seeds[String(s.id)] = {
      id: String(s.id), g: gid, gs: s.groupSeedNum == null ? (s.seedNum == null ? null : Number(s.seedNum)) : Number(s.groupSeedNum),
      e: s.entrant && s.entrant.id != null ? String(s.entrant.id) : null, src,
    };
  }
}

export const emptyBracket = (): Bracket => ({ groups: {}, sets: {}, seeds: {} });

/**
 * 計算する。winners = 試合 → 勝った出場者 ID。
 * opts.fromSources = 前のフェーズから来るシードを元のブロックの順位から計算する (false なら seeds の e をそのまま使う)
 */
export function resolve(b: Bracket, winners: Record<string, string | null | undefined>,
  opts: { fromSources?: boolean; confirmed?: (g: string) => boolean } = {}): Resolved {
  const out: Resolved = { sets: {}, place: {}, seed: {}, ties: {} };
  // 使われる側: (試合, 1|2) → それを枠に持つ試合
  const consumers = new Map<string, string[]>();
  for (const s of Object.values(b.sets)) for (const sl of s.sl) if (sl.k === 'set' && sl.id) {
    const key = sl.id + '#' + (sl.p || 1);
    const a = consumers.get(key); if (a) a.push(s.id); else consumers.set(key, [s.id]);
  }
  const seedsOfGroup = new Map<string, BSeed[]>();
  for (const s of Object.values(b.seeds)) { const a = seedsOfGroup.get(s.g); if (a) a.push(s); else seedsOfGroup.set(s.g, [s]); }

  const visiting = new Set<string>();
  const placing = new Set<string>();

  const seedOcc = (seedId: string | null): Occ => {
    if (!seedId) return BYE;
    if (seedId in out.seed) return out.seed[seedId];
    const sd = b.seeds[seedId];
    let v: Occ;
    if (!sd) v = PENDING;   // 写しに無いシード
    else if (sd.src && opts.fromSources) v = fromSource(sd);
    else v = sd.e === null ? (sd.src ? PENDING : BYE) : sd.e;
    out.seed[seedId] = v;
    return v;
  };

  const fromSource = (sd: BSeed): Occ => {
    const src = sd.src!;
    const pl = placeOf(src.g);
    if (!pl) return PENDING;
    const tied = pl.byPlace.get(src.pl);
    if (!tied || !tied.done) return PENDING;
    // 同じ順位が 2 人以上 = 並べ方を推定で決める。確かめた (confirmed) ブロックだけ埋める
    if (tied.list.length > 1 && opts.confirmed && !opts.confirmed(src.g)) return PENDING;
    const e = tied.list[src.ord - 1];
    return e === undefined ? BYE : e;
  };

  const occOf = (sl: BSlot): Occ => {
    if (sl.k === 'bye' || sl.k === null) return BYE;
    if (sl.k === 'seed') return seedOcc(sl.id);
    if (!sl.id || !b.sets[sl.id]) return PENDING;
    const st = stateOf(sl.id);
    return sl.p === 2 ? st.l : st.w;
  };

  const stateOf = (id: string): SetState => {
    const done = out.sets[id];
    if (done) return done;
    if (visiting.has(id)) throw new Error('bracket cycle at ' + id);
    visiting.add(id);
    const s = b.sets[id];
    const occ: [Occ, Occ] = [occOf(s.sl[0]), occOf(s.sl[1])];
    let st: SetState = { occ, w: PENDING, l: PENDING, void: false };
    // グランドファイナルのやり直し: 両方の枠が同じ試合の 1 と 2
    const reset = s.sl[0].k === 'set' && s.sl[1].k === 'set' && s.sl[0].id === s.sl[1].id && s.sl[0].id !== null;
    if (reset) {
      const gf = stateOf(s.sl[0].id!);
      if (gf.w === PENDING) st = { occ: [PENDING, PENDING], w: PENDING, l: PENDING, void: false };
      else if (gf.w === BYE || gf.w === VOID || !fromLosers(s.sl[0].id!, gf)) st = { occ: [VOID, VOID], w: VOID, l: VOID, void: true };
    }
    if (!st.void && st.occ[0] !== PENDING && st.occ[1] !== PENDING) {
      const [a, c] = st.occ;
      if (a === VOID || c === VOID) { st.w = VOID; st.l = VOID; st.void = true; }
      else if (a === BYE && c === BYE) { st.w = BYE; st.l = BYE; }
      else if (a === BYE) { st.w = c; st.l = BYE; }
      else if (c === BYE) { st.w = a; st.l = BYE; }
      else {
        const win = winners[id];
        if (win != null && (win === a || win === c)) { st.w = win; st.l = win === a ? c : a; }
      }
    }
    visiting.delete(id);
    out.sets[id] = st;
    return st;
  };

  /** グランドファイナルの勝者が敗者側から来た枠の人か (その枠の前の試合が敗者側 = round < 0)。
   *  前のフェーズから敗者側に直接入る人もいるので「このブロックで負けたか」ではなく枠で見る */
  const fromLosers = (gfId: string, gf: SetState): boolean => {
    const g = b.sets[gfId];
    const k = gf.occ[0] === gf.w ? 0 : 1;
    const sl = g.sl[k];
    return sl.k === 'set' && !!sl.id && !!b.sets[sl.id] && b.sets[sl.id].r < 0;
  };

  type Places = { byPlace: Map<number, { list: string[]; done: boolean }>; of: Record<string, number> };
  const placeCache = new Map<string, Places | null>();
  const placeOf = (g: string): Places | null => {
    if (placeCache.has(g)) return placeCache.get(g)!;
    const grp = b.groups[g];
    if (!grp || grp.rr) { placeCache.set(g, null); return null; }
    if (placing.has(g)) throw new Error('progression cycle at ' + g);
    placing.add(g);
    // 出口 = どの (行う) 試合にも使われない (試合, 1|2)
    const exits: { pl: number; occ: Occ; rank: number }[] = [];
    const proj = projected(g);
    for (const s of Object.values(b.sets)) {
      if (s.g !== g) continue;
      const st = stateOf(s.id);
      if (st.void) continue;
      for (const p of [1, 2] as const) {
        const users = (consumers.get(s.id + '#' + p) || []).filter((c) => !stateOf(c).void);
        if (users.length) continue;
        const pl = p === 1 ? s.wp : s.lp;
        if (pl === null) continue;
        // 同じ順位の出口の並び (start.gg の originOrder、2026-11-05 に 245 件で確かめた): 上位シードが全部勝ったときにその出口に来るシード番号の順。
        // ただし敗者側の試合で負けて抜ける出口は、その試合の勝者に来るシード番号の順
        const own = proj.get(s.id + '#' + p) ?? 1e9;
        const key = p === 2 && s.r < 0 ? (proj.get(s.id + '#1') ?? 1e9) : own;
        exits.push({ pl, occ: p === 1 ? st.w : st.l, rank: key * 1e4 + Math.min(own, 1e4 - 1) });
      }
    }
    const byPlace = new Map<number, { list: string[]; done: boolean }>();
    const of: Record<string, number> = {};
    exits.sort((x, y) => x.rank - y.rank);
    for (const x of exits) {
      let t = byPlace.get(x.pl); if (!t) { t = { list: [], done: true }; byPlace.set(x.pl, t); }
      if (x.occ === PENDING) t.done = false;
      else if (x.occ !== BYE && x.occ !== VOID) { t.list.push(x.occ); of[x.occ] = x.pl; }
    }
    const r = { byPlace, of };
    placing.delete(g);
    placeCache.set(g, r);
    return r;
  };

  /** 上位シードが全部勝ったとしたときの、各出口 (試合#1|2) に来るシード番号 (このブロックのシード順)。同じ順位の出口はこの順に並べる */
  const projected = (g: string): Map<string, number> => {
    const res = new Map<string, number>();
    const memo = new Map<string, [number, number]>();   // 試合 → [勝者, 敗者] のシード番号 (空き = Infinity)
    const occ = (sl: BSlot): number => {
      if (sl.k === 'seed') { const sd = sl.id ? b.seeds[sl.id] : null; return sd && sd.gs != null ? sd.gs : Infinity; }
      if (sl.k === 'set' && sl.id && b.sets[sl.id] && b.sets[sl.id].g === g) { const m = run(sl.id); return sl.p === 2 ? m[1] : m[0]; }
      return Infinity;
    };
    const run = (id: string): [number, number] => {
      const m = memo.get(id); if (m) return m;
      memo.set(id, [Infinity, Infinity]);
      const s = b.sets[id];
      const a = occ(s.sl[0]), c = occ(s.sl[1]);
      const r: [number, number] = a <= c ? [a, c] : [c, a];
      memo.set(id, r);
      return r;
    };
    for (const s of Object.values(b.sets)) if (s.g === g) { const m = run(s.id); res.set(s.id + '#1', m[0]); res.set(s.id + '#2', m[1]); }
    return res;
  };

  for (const id of Object.keys(b.sets)) stateOf(id);
  for (const g of Object.keys(b.groups)) { const p = placeOf(g); if (p) out.place[g] = p.of; }
  const fed = new Set(Object.values(b.seeds).filter((x) => x.src).map((x) => x.src!.g));
  for (const g of fed) {
    const p = placeOf(g);
    if (!p) continue;
    const t = [...p.byPlace.entries()].filter(([, v]) => v.done && v.list.length > 1).map(([pl, v]) => ({ pl, list: v.list.slice() })).sort((x, y) => x.pl - y.pl);
    if (t.length) out.ties[g] = t;
  }
  for (const id of Object.keys(b.seeds)) seedOcc(id);
  return out;
}
