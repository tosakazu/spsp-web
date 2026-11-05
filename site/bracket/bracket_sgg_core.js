// @ts-check
// bracket_sgg_core.js — start.gg のブロックの構造 (試合のつながり) から、トーナメントプレビューの表 (bracket_core.js の poolDoubleElim と
// 同じ形 { B, winners, losers, gf, wTotal, lTotal, cut, advancers, undefeated, lbStart }) を作る (2026-11-05)。DOM / fetch 非依存。
//
// 入力 = start.gg の phaseGroup.sets (showByes) を縮めたもの (worker/src/api/bracket_struct.ts の SimSet: [id, round, 記号, …, 枠])
// と、その試合を読んだブロックのシード ID → ブロック内のシード順 (groupSeedNum)。勝ち上がりは「シード通り (小さいシードが勝つ)」。
//
// 表の形 (bracket_app.js の描き方が前提にしているもの):
//   - 勝者側: ラウンド r の i 試合目は、前のラウンドの 2i・2i+1 試合目の勝者 (a = 上・b = 下)。1 回戦は不戦勝の試合も含む (a / b が null)
//   - 敗者側: major (前の敗者側ラウンドの i 試合目の勝者 a と、勝者側から落ちてくる b。drop = 落ちてくる勝者側のラウンド) と
//     minor (前の 2i・2i+1 試合目の勝者どうし) の繰り返し。最初のラウンドは勝者側 1 回戦の敗者どうし (か、敗者側スタートの人どうし)
//   - start.gg が構造として持つ「片方が空き」の試合 (勝者側から落ちた人 vs 空き 等) は、その人がそのまま上がる扱いで畳む
// この形に収まらない構造 (ラウンドの中で major と minor が混ざる等) は null を返す (画面は従来の組み方のまま)。

/** @typedef {{ id: string, r: number, x: string, t?: string, wp: number | null, lp: number | null, sl: [string | null, string | null, number | null][] }} SimSet */
/** @typedef {{ a: number | null, b: number | null, w: number | null, l: number | null, drop?: number }} Match */

const mk = (a, b, extra) => Object.assign({ a, b, w: a == null ? b : b == null ? a : Math.min(a, b), l: a != null && b != null ? Math.max(a, b) : null }, extra || null);

/**
 * @param {SimSet[]} sets  1 ブロック分の試合
 * @param {Map<string, number | null>} seedGs  シード ID → ブロック内のシード順
 * @param {number} M  このブロックの人数
 * @returns {any | null}
 */
export function deFromSgg(sets, seedGs, M) {
  const byId = new Map(sets.map((s) => [s.id, s]));
  const isW = (s) => s && s.r > 0;
  const isL = (s) => s && s.r < 0;
  const slotSet = (sl) => (sl[0] === 'set' && sl[1] != null ? byId.get(sl[1]) || null : null);
  // やり直し (両方の枠が同じ試合) と、グランドファイナル (勝者側と敗者側の勝者が当たる)
  const isReset = (s) => s.sl.length === 2 && s.sl[0][0] === 'set' && s.sl[1][0] === 'set' && s.sl[0][1] === s.sl[1][1];
  const isGf = (s) => isW(s) && !isReset(s) && s.sl.some((x) => { const p = slotSet(x); return isL(p) && x[2] === 1; });
  const gfSet = sets.find(isGf) || null;
  const wSets = sets.filter((s) => isW(s) && !isReset(s) && s !== gfSet);
  const lSets = sets.filter(isL);
  const seedVal = (sl) => (sl[0] === 'seed' && sl[1] != null && seedGs.has(sl[1]) ? seedGs.get(sl[1]) : null);

  // ── 勝者側: 終わりの試合 (勝者がほかの勝者側の試合に行かない) から上→下に組む ──
  const fedW = new Set();
  for (const s of wSets) for (const x of s.sl) { const p = slotSet(x); if (p && isW(p) && x[2] === 1) fedW.add(p.id); }
  // ノード = { s: 試合 } か { v: シード (null = 空き) } (シードがそのまま上がる不戦勝の枠)
  const childW = (n) => (n.s ? n.s.sl.map((x) => { const p = slotSet(x); return p && isW(p) && x[2] === 1 ? { s: p } : { v: x[0] === 'seed' ? seedVal(x) : null }; }) : [{ v: n.v }, { v: null }]);
  const projW = new Map();   // 試合 ID → { w, l }
  const valW = (n) => {
    if (!n.s) return { w: n.v, l: null };
    const hit = projW.get(n.s.id); if (hit) return hit;
    const [c0, c1] = childW(n).map(valW);
    const m = mk(c0.w, c1.w);
    projW.set(n.s.id, m);
    return m;
  };
  /** @type {any[]} */
  let top = wSets.filter((s) => !fedW.has(s.id)).map((s) => ({ s }));
  if (!top.length) return null;
  for (const n of top) valW(n);   // 勝者側の全部の試合の勝ち負けを先に (敗者側が「勝者側の試合の敗者」を引く)
  top.sort((p, q) => (valW(p).w ?? 1e9) - (valW(q).w ?? 1e9));
  /** @type {any[][]} */
  const wLevels = [top];
  for (let guard = 0; guard < 20; guard++) {
    const cur = wLevels[wLevels.length - 1];
    if (!cur.some((n) => n.s)) { wLevels.pop(); break; }   // 全部シードの枠 = 1 回戦の下 (試合ではない)
    wLevels.push(cur.flatMap(childW));
  }
  const winners = wLevels.slice().reverse().map((lv) => lv.map((n) => (n.s ? (() => { const [c0, c1] = childW(n).map(valW); return mk(c0.w, c1.w); })() : mk(n.v, null))));
  if (!winners.length) return null;
  for (let r = 0; r < winners.length; r++) if (winners[r].length !== winners[0].length / 2 ** r) return null;
  const wRoundOf = new Map();   // 勝者側の試合 ID → ラウンド (1 始まり)
  wLevels.slice().reverse().forEach((lv, r) => lv.forEach((n) => { if (n.s) wRoundOf.set(n.s.id, r + 1); }));

  // ── 敗者側 ──
  // 段 = start.gg の敗者側のラウンド番号 (|round|)。start.gg は最初に「中身のない」ラウンド (空き vs 空き、勝者側から落ちた人 vs 空き) を
  // 構造として持つので、試合が 2 人の実際の対戦になりうるラウンドからを表にする。中身のない試合はその人がそのまま上がる扱いで畳む
  const lv = (s) => -s.r;
  // 「中身のない」試合: 実際の枠 (前の試合 / シード) が 1 つ以下 (もう片方が空き) = 2 人の対戦にならない。その 1 人がそのまま上がる
  const hollow = (s) => s.sl.filter((y) => y[0] && y[0] !== 'bye').length <= 1;
  // 畳んだ値: 試合なら { s }、落ちてくる人 { drop }、シード { seed }、空き { v: null }
  const lSlot = (x, depth = 0) => {
    if (depth > 60) return { v: null };
    if (x[0] === 'seed') return { seed: seedVal(x) };
    const p = slotSet(x);
    if (!p) return { v: null };
    if (isW(p)) return x[2] === 2 ? { drop: p.id } : { v: null };
    if (!isL(p)) return { v: null };
    if (hollow(p)) {
      const kid = p.sl.find((y) => y[0] && y[0] !== 'bye');
      return kid ? lSlot(kid, depth + 1) : { v: null };
    }
    return { s: p };
  };
  const childL = (s) => s.sl.map((x) => lSlot(x));
  const fromW = (x) => x[0] === 'set' && isW(slotSet(x)) && x[2] === 2;
  const leafVal = (c) => (c.seed !== undefined ? c.seed : c.drop !== undefined ? (projW.get(c.drop) || { l: null }).l : null);
  const projL = new Map();
  const valOf = (c) => (c.s ? valL(c.s) : leafVal(c));
  const valL = (st) => {
    const hit = projL.get(st.id); if (hit !== undefined) return hit;
    const [c0, c1] = childL(st).map(valOf);
    const w = c0 == null ? c1 : c1 == null ? c0 : Math.min(c0, c1);
    projL.set(st.id, w);
    return w;
  };
  const real = lSets.filter((x) => !hollow(x));
  const fedL = new Set();
  for (const x of real) for (const y of x.sl) { const c = lSlot(y); if (c.s && y[2] === 1) fedL.add(c.s.id); }
  const lRoots = real.filter((x) => !fedL.has(x.id));
  lRoots.sort((p, q) => (valL(p) ?? 1e9) - (valL(q) ?? 1e9));
  /** @type {Match[][]} */
  const losers = [];
  const lbSeeds = new Set();
  for (const x of lSets) for (const y of x.sl) { const v = y[0] === 'seed' ? seedVal(y) : null; if (v != null) lbSeeds.add(v); }
  if (lRoots.length) {
    const topLv = Math.max(...lRoots.map(lv));
    if (lRoots.some((x) => lv(x) !== topLv)) return null;
    // ノード = { s } (この段の試合) か { up: 値の元 } (この段では試合が無く、下の段から上がってくるだけ = 空きの試合)
    /** @type {any[]} */
    let cur = lRoots.map((x) => ({ s: x }));
    const levels = [];
    for (let k = topLv; k >= 1 && cur.length; k--) {
      // major = 枠の片方が勝者側の試合の敗者 (直接)、minor = どちらも敗者側から (中身のない試合を畳んだ結果が落ちてくる人でも敗者側の枠)
      const kinds = cur.filter((n) => n.s).map((n) => (n.s.sl.filter(fromW).length === 1 ? 'major' : 'minor'));
      if (!kinds.length) break;
      const kind = kinds.every((x) => x === kinds[0]) ? kinds[0] : null;
      if (!kind) return null;
      levels.push({ nodes: cur, kind });
      const next = [];
      const push = (c) => {
        // 1 つ下の段の試合ならそのまま、もっと下なら空きの試合として上げる
        if (c && c.s && lv(c.s) === k - 1) next.push({ s: c.s });
        else next.push({ up: c || { v: null } });
      };
      for (const n of cur) {
        const c = n.s ? childL(n.s) : null;
        if (kind === 'major') {
          if (!c) { push(n.up && n.up.s ? n.up : null); continue; }
          const k0 = fromW(n.s.sl[0]) ? 1 : 0;
          push(c[k0]);
        } else {
          if (!c) { push(n.up && n.up.s ? n.up : null); push(null); continue; }
          push(c[0]); push(c[1]);
        }
      }
      if (!next.some((n) => n.s || (n.up && n.up.s))) break;
      cur = next.map((n) => (n.up && n.up.s && lv(n.up.s) === k - 1 ? { s: n.up.s } : n));
    }
    for (const L of levels.slice().reverse()) {
      losers.push(L.nodes.map((n) => {
        if (!n.s) return mk(n.up ? valOf(n.up) : null, null);
        const c = childL(n.s);
        if (L.kind === 'major') {
          const kd = fromW(n.s.sl[0]) ? 0 : 1;   // 勝者側から落ちてくる枠
          const dropC = c[kd];
          return mk(valOf(c[1 - kd]), leafVal(dropC), { drop: (dropC.drop && wRoundOf.get(dropC.drop)) || 1 });
        }
        return mk(valOf(c[0]), valOf(c[1]));
      }));
    }
    for (let i = 1; i < losers.length; i++) {
      const same = losers[i].length === losers[i - 1].length;
      const half = losers[i].length * 2 === losers[i - 1].length;
      if (!same && !half) return null;
    }
  }
  const lbStart = lbSeeds.size;
  const gf = gfSet ? mk(winners[winners.length - 1][0].w, losers.length ? losers[losers.length - 1][0].w : null) : null;
  // 打ち切り (そのブロックから次のフェーズへ進む): グランドファイナルが無く、出口がある
  const cut = !gfSet && M > 1;
  /** @type {number[] | null} */
  let advancers = null;
  /** @type {number[] | null} */
  let undefeated = null;
  if (cut) {
    const elim = new Set();
    for (const r of losers) for (const m of r) if (m.a != null && m.b != null && m.l != null) elim.add(m.l);
    const adv = [];
    for (let s = 1; s <= M; s++) if (!elim.has(s)) adv.push(s);
    advancers = adv;
    // 無敗で通過 = 負けていない・敗者側スタートでもない
    const lost = new Set(lbSeeds);
    for (const r of winners.concat(losers)) for (const m of r) if (m.a != null && m.b != null && m.l != null) lost.add(m.l);
    undefeated = adv.filter((s) => !lost.has(s));
  }
  return { B: winners[0].length * 2, winners, losers, gf, wTotal: winners.length, lTotal: losers.length, cut, advancers, undefeated, lbStart, lbEntryEstimated: false, sgg: true };
}


const played = (m) => !!m && m.a != null && m.b != null;
/**
 * 従来の組み方 (app = bracket_core.poolDoubleElim の結果) の列の形に、start.gg から作った表 (sg = deFromSgg) の中身を入れる (2026-11-05)。
 * start.gg は全部が不戦勝の敗者側のラウンドを構造として持たないことがあり、従来の表はその空の列も出すので、後ろ (決勝側) から揃える。
 * 揃えたラウンドの試合数が違う・はみ出したラウンドに実際の対戦がある、などで揃えられなければ start.gg の表をそのまま返す。
 * @param {any} app @param {any} sg
 */
export function alignToApp(app, sg) {
  if (!app || !sg) return sg;
  const fit = (A, S) => {
    const out = A.map((r) => r.map((m) => Object.assign({}, m)));
    const off = A.length - S.length;
    if (off < 0) {
      // start.gg のほうがラウンドが多い: 多い分 (前のほう) に実際の対戦があれば揃えられない
      if (S.slice(0, -off).some((r) => r.some(played))) return null;
      S = S.slice(-off);
    }
    const o = Math.max(0, off);
    for (let i = 0; i < o; i++) if (A[i].some(played)) return null;   // 従来の表にだけある列に対戦がある
    for (let i = 0; i < S.length; i++) {
      if (A[o + i].length !== S[i].length) return null;
      out[o + i] = S[i].map((m, k) => Object.assign({}, m, A[o + i][k] && A[o + i][k].drop && !m.drop ? { drop: A[o + i][k].drop } : null));
    }
    for (let i = 0; i < o; i++) out[i] = A[i].map(() => ({ a: null, b: null, w: null, l: null, ...(A[i][0] && A[i][0].drop ? { drop: A[i][0].drop } : {}) }));
    return out;
  };
  const winners = fit(app.winners, sg.winners);
  const losers = fit(app.losers, sg.losers);
  if (!winners || !losers || !!app.gf !== !!sg.gf) return sg;
  return Object.assign({}, sg, { B: app.B, winners, losers, wTotal: app.wTotal, lTotal: app.lTotal, aligned: true });
}


const API = { deFromSgg, alignToApp };
export default API;
