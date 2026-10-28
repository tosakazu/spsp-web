// @ts-check
// live_predict.js — 参加中の大会 (js/live.js) の予想: 今の結果でのパフォーマンス・順位評価・直対評価と、タップで全国順位の変化。
// 計算はスコアシミュレーション (sim/calc.js、ビルドの JS 移植) と同じ。違いは順位と試合を速報 (start.gg) から取ること:
//   順位   … 確定していればその順位、勝ち残っていれば place_min (= このまま次で負けたときの順位)。どちらも無ければ出さない
//   試合   … 報告済みのセットだけ (DQ・不戦勝・下位クラスのフェーズは除く)。直対評価には「次で負けたら」の負けを足さない
//            (place_min を使うのは順位評価とパフォーマンスだけ)
//   集計対象 … data/upcoming_entrants.json の大会の印 (休日・制限・身内 …) と自分の Lv で判定 (sim と同じ)。大会が載っていなければ出さない
// パフォーマンス = ビルドの perf_rank と同じ式 (spsp/output.py _perf_map_for_t): 参加者を全国順位で並べ、取った順位の帯に入る人の
// 全国順位の中央値 (自分の位置が帯の中なら自分の順位)。帯の人数は確定した人の数か、トーナメントの帯の幅 (1,1,1,1,2,2,4,4,…) の大きい方。
// 全選手の数値は data/views/sim_pop.json (sim と同じ。1 回だけ読む)。ビルドに取り込み済みの大会 (選手の出場履歴にある) は予想しない。
import SPSPCalc from '../sim/calc.js';
import SPSPViews from './views.js';
import SPSPPlayerData from './player_data.js';

const C = SPSPCalc;
/** 1 本先取のセットの変動量の倍率 (ビルドの settings.py bt_bo1_k、2026-09-25 から 0.5)。レートだけ縮め、RD はそのまま */
const BO1_K = 0.5;
/** 自分・直接の相手以外の RD (選手ファイルを読まない人。全選手の中央値 約 70 前後) */
const OTHER_RD = 90;

/** ビルドの試合の処理順 (spsp/common.py _bracket_order_key_parts): 予選・総当たり → Winners (TOP の大きい順) → Losers → Grand Final (Reset は後)
 * @param {any} s 速報のセット (label はビルドと同じ「ブラケットの位置」) @returns {number[]} */
export function bracketOrderKey(s) {
  let body = String(s.label || '');
  if (body.length >= 2 && 'BCDE'.includes(body[0]) && body[1] === '-') body = body.slice(2);
  const rt = String(s.round_text || '').toLowerCase();
  const side = rt.includes('grand final') || body === 'Grand Final' ? 3 : body.startsWith('Winners') ? 1 : body.startsWith('Losers') ? 2 : 0;
  const m = /TOP\s*(\d+)/i.exec(body);
  return [side, -(m ? parseInt(m[1], 10) : 0), rt.includes('reset') ? 1 : 0];
}

/** G2Player の更新を k 倍に縮める (ビルドの w.rating = wr + k * (w.rating - wr)) @param {any} p @param {number} r0 @param {number} k */
function scaleUpdate(p, r0, k) {
  if (k === 1) return;
  p.r = ((r0 + k * (p.rating() - r0)) - 1500) / 173.7178;
}
const W = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);

/** sim_pop の 1 人分 @typedef {{ tj: number, bt: number, btInt: number, lv: number, gray: boolean, ens: number | null, tjR: number | null, btR: number | null }} PopRec */
/** @typedef {{ rating: number, rd: number, lastTs: number | null }} OppInit */
/** 予想 1 部門分 (null の項目は出せない)
 * @typedef {{ place: number | null, final: boolean, counted: boolean | null,
 *             perf: number | null, tjpr: { delta: number, raw: number, newScore: number } | null,
 *             bt: { dPeak: number, dInt: number, peakAfter: number, n: number } | null }} LivePrediction */

/** @param {any[]} rows @param {string[]} cols @returns {Map<number, PopRec>} */
function popMap(rows, cols) {
  /** @type {Record<string, number>} */
  const c = {};
  cols.forEach((k, i) => { c[k] = i; });
  const m = new Map();
  for (const r of rows) {
    m.set(r[c.uid], {
      tj: r[c.tjpr_score] || 0, bt: r[c.bt_gated_elo] || 0, btInt: r[c.bt_internal_elo] || 0, lv: r[c.lv] || 0,
      gray: !!r[c.gray], ens: r[c.ens] || null, tjR: r[c.tjpr] || null, btR: r[c.bt] || null,
    });
  }
  return m;
}

/** 暦日 'YYYY-MM-DD' (地域の時差) → epoch 秒 @param {string} d @param {string} off */
const dayTs = (d, off) => new Date(d + 'T00:00:00' + off).getTime() / 1000;

/** 最終参加日 (sim の lastSeenOf と同じ: 直対の履歴の最終日と出場大会の最終 ts の大きい方) @param {any} pj @param {string} off */
export function lastSeenOf(pj, off) {
  const tl = pj.bt_timeline_g2 || [];
  let last = tl.length ? dayTs(tl[tl.length - 1].date, off) : null;
  const ts = (pj.tournaments || []).reduce((/** @type {number} */ m, /** @type {any} */ t) => (t.ts && t.ts > m ? t.ts : m), 0);
  if (ts > (last || 0)) last = ts;
  return last;
}

/** ビルドの perf_rank と同じ式。entries = [{uid, place}] (place は確定 or 仮)、rankOf(uid) = 大会前の全国順位 (無ければ null)
 * @param {{ uid: number | null, place: number | null }[]} entries @param {(uid: number | null) => number | null} rankOf
 * @param {number | null} myUid @param {number} myPlace @param {number} size 自分の順位の帯の人数 @returns {number | null} */
export function perfRank(entries, rankOf, myUid, myPlace, size) {
  const ent = entries.filter(e => e.place != null);
  const BIG = 1e9;
  const seeded = ent.slice().sort((a, b) => ((rankOf(a.uid) ?? BIG) - (rankOf(b.uid) ?? BIG)) || ((a.uid ?? BIG) - (b.uid ?? BIG)));
  if (myPlace === 1) size = 1;
  const pos = seeded.findIndex(e => e.uid === myUid) + 1;
  const own = rankOf(myUid);
  if (own != null && pos >= myPlace && pos <= myPlace + size - 1) return own;
  const ranks = seeded.slice(myPlace - 1, myPlace - 1 + size).map(e => rankOf(e.uid)).filter(r => r != null).sort((a, b) => /** @type {number} */ (a) - /** @type {number} */ (b));
  if (!ranks.length) return null;
  const n = ranks.length, mid = n >> 1;
  const med = n % 2 ? /** @type {number} */ (ranks[mid]) : (/** @type {number} */ (ranks[mid - 1]) + /** @type {number} */ (ranks[mid])) / 2;
  return Math.round(med);   // Python の round (偶数丸め) と .5 のときだけ違いうる (帯の中央値が x.5 になるのは 2 人の平均のとき)
}

/** トーナメントの順位 p の帯の幅 (1,2,3,4 は 1 人、5,7 は 2 人、9,13 は 4 人 …) @param {number} p */
export function bracketBandSize(p) {
  const tier = C.placementToTier(p);
  return C.tierBestPlace(tier + 1) - C.tierBestPlace(tier);
}

/**
 * @param {{ uid: number, player: any, data: string, meta?: any, utcOffset: string,
 *           pop?: () => Promise<Map<number, PopRec> | null>, upcoming?: () => Promise<any>, oppInit?: (uid: number) => Promise<OppInit> }} o
 *   player = プレイヤーページが読んだ選手 (組み立て後)。pop / upcoming / oppInit はテスト用に差し替えられる
 */
export function create(o) {
  const UID = o.uid;
  const me = o.player;
  if (o.meta && o.meta.params && o.meta.params.LV_FILTERS_EFFECTIVE) C.setLvFilters(o.meta.params.LV_FILTERS_EFFECTIVE);
  /** @type {Promise<Map<number, PopRec> | null> | null} */
  let popP = null;
  const pop = () => popP || (popP = (o.pop ? o.pop() : SPSPViews.simPop().then((/** @type {any} */ p) => (p ? popMap(p.rows || [], p.columns || []) : null)))
    .catch(() => null));
  /** @type {Promise<any> | null} */
  let upP = null;
  const upcoming = () => upP || (upP = (o.upcoming ? o.upcoming() : fetch(o.data + 'data/upcoming_entrants.json').then(r => (r.ok ? r.json() : null)))
    .catch(() => null));
  /** @type {Map<number, Promise<OppInit>>} */
  const oppCache = new Map();
  /** @param {number} uid @param {PopRec | undefined} m @returns {Promise<OppInit>} */
  function oppInit(uid, m) {
    if (o.oppInit) return o.oppInit(uid);
    const base = { rating: m && m.btInt > 0 ? m.btInt : 1500, rd: 350, lastTs: null };
    if (!m) return Promise.resolve(base);
    let p = oppCache.get(uid);
    if (!p) {
      p = SPSPPlayerData.load(o.data, uid, { history: false }).then((/** @type {any} */ pj) => {
        if (!pj) return base;
        const tl = pj.bt_timeline_g2 || [];
        return { rating: base.rating, rd: tl.length ? tl[tl.length - 1].rd : 350, lastTs: lastSeenOf(pj, o.utcOffset) };
      }).catch(() => base);
      oppCache.set(uid, p);
    }
    return p;
  }

  const sc = (me && me.scores) || {};
  const myLv = sc.shared_cascade_lv || 1;
  const tl = (me && me.bt_timeline_g2) || [];
  const self = {
    lv: myLv,
    entries: me ? C.extractEntries(me) : [],
    rating: sc.bt_internal_elo > 0 ? sc.bt_internal_elo : 1500,
    rd: tl.length ? tl[tl.length - 1].rd : 350,
    lastSeenTs: me ? lastSeenOf(me, o.utcOffset) : null,
    history: tl.map((/** @type {any} */ x) => ({ ts: dayTs(x.date, o.utcOffset), rating: x.rating })),
  };
  const reflected = new Set(((me && me.tournaments) || []).map((/** @type {any} */ t) => String(t.event_id != null ? t.event_id : t.parent_event_id)));

  /** 集計対象か (sim の gateInfo と同じ。大会が upcoming_entrants に無ければ null) @param {any} ev @param {number} nent */
  function gate(ev, nent) {
    if (!ev) return null;
    if (ev.is_non_serious || nent < 5) return false;
    return C.tournamentPassesLv(myLv, { nent, isWeekend: !!ev.is_weekend, isCapped: !!(ev.is_restricted || ev.is_lower_class) });
  }

  /** @param {any} doc 速報の部門 @returns {Promise<LivePrediction | null>} */
  async function predict(doc) {
    // プレビューの見本 (live/sample/、doc.sample) は取り込み済みの大会なので、確認用にそのまま予想する (値は二重に数えたもの)
    if (!me || !doc || (!doc.sample && reflected.has(String(doc.event_id)))) return null;
    const ents = doc.entrants || {};
    const myId = Object.keys(ents).find(k => String(ents[k].uid) === String(UID));
    if (myId == null) return null;
    const [P, up] = await Promise.all([pop(), upcoming()]);
    if (!P) return null;
    const e = ents[myId];
    const nent = Object.keys(ents).length || doc.num_entrants || 0;
    let ev = up && up.events ? up.events[String(doc.event_id)] : null;
    if (!ev && doc.sample && !o.upcoming) {   // 見本は過去の大会で参加予定に無いので、大会ファイルの印を使う (プレビューの確認用)
      ev = await fetch(o.data + 'tournaments/' + doc.event_id + '.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    }
    const counted = gate(ev, nent);
    const final = e.placement != null && !!e.final;
    const place = final ? e.placement : (e.place_min != null ? e.place_min : null);
    const rankOf = (/** @type {number | null} */ u) => { const m = u != null ? P.get(u) : null; return m && !m.gray && m.ens ? m.ens : null; };
    // ---- パフォーマンス ----
    /** @type {number | null} */
    let perf = null;
    if (place != null) {
      const list = Object.values(ents).map((/** @type {any} */ x) => ({
        uid: x.uid ?? null, place: x.uid === e.uid ? place : (x.final ? x.placement : (x.place_min ?? x.placement ?? null)) }));
      const same = list.filter(x => x.place === place).length;
      perf = perfRank(list, rankOf, e.uid, place, Math.max(same, Math.min(bracketBandSize(place), nent - place + 1)));
    }
    // ---- 順位評価 ----
    /** @type {LivePrediction["tjpr"]} */
    let tjpr = null;
    if (counted && place != null) {
      const ratings = Object.values(ents).map((/** @type {any} */ x) => { const m = x.uid != null ? P.get(x.uid) : null; return m && m.btInt > 0 ? m.btInt : 1500; });
      const raw = C.tjprRawForPlace(C.buildBanzuke(ratings, nent), myLv, place);
      const base = C.aggregateEntries(self.entries, myLv);
      const delta = C.aggregateEntries(self.entries.concat([raw]), myLv) - base;
      tjpr = { delta, raw, newScore: (sc.tjpr_score || 0) + delta };
    }
    // ---- 直対評価 ----
    // ビルドと同じく部門の全セットを順に流す (相手のレートも大会中に動くため。自分の試合だけだと 1 前後ずれる)。
    // RD と最終参加日は自分と直接の相手だけ選手ファイルから取り、他の人は RD = OTHER_RD・非活動なし (2026-10 の検証で誤差は全員分と同程度)
    /** @type {LivePrediction["bt"]} */
    let bt = null;
    if (counted) {
      const cls = new Set();
      for (const p of doc.phases || []) if (p.cls) for (const g of p.groups || []) cls.add(String(g.id));
      const sets = (doc.sets || []).filter((/** @type {any} */ s) => s.winner != null && !s.bye && !cls.has(String(s.pg))
        && (s.e || []).length === 2 && !(s.score || []).some((/** @type {any} */ v) => v === -1))
        .map((/** @type {any} */ s, /** @type {number} */ i) => ({ s, k: bracketOrderKey(s), i }))
        .sort((a, b) => (a.k[0] - b.k[0]) || (a.k[1] - b.k[1]) || (a.k[2] - b.k[2]) || (a.i - b.i)).map(x => x.s);
      const mine = sets.filter((/** @type {any} */ s) => s.e.map(String).includes(myId));
      if (mine.length) {
        const ts = doc.start_at || Date.now() / 1000;
        const oppUids = new Set();
        for (const s of mine) for (const x of s.e) { const u = (ents[String(x)] || {}).uid; if (u != null && String(x) !== myId) oppUids.add(u); }
        const inits = new Map(await Promise.all([...oppUids].map(async u => /** @type {[number, OppInit]} */ ([u, await oppInit(u, P.get(u))]))));
        /** @type {Map<string, { p: any, lv: number }>} */
        const pl = new Map();
        /** @param {string} id entrant id */
        const playerOf = (id) => {
          let q = pl.get(id);
          if (q) return q;
          const x = ents[id] || {};
          const m = x.uid != null ? P.get(x.uid) : undefined;
          let p;
          if (id === myId) {
            p = new C.G2Player(self.rating, self.rd, 0.06);
            if (self.lastSeenTs) C.applyInactivity(p, (ts - self.lastSeenTs) / 86400);
          } else if (x.uid != null && inits.has(x.uid)) {
            const it = /** @type {OppInit} */ (inits.get(x.uid));
            p = new C.G2Player(it.rating, it.rd, 0.06);
            if (it.lastTs) C.applyInactivity(p, (ts - it.lastTs) / 86400);
          } else {
            p = m && m.btInt > 0 ? new C.G2Player(m.btInt, OTHER_RD, 0.06) : new C.G2Player(1500, 350, 0.06);
          }
          q = { p, lv: id === myId ? myLv : (m ? m.lv || 1 : 1) };
          pl.set(id, q);
          return q;
        };
        const tmeta = { nent, isWeekend: !!ev.is_weekend, isCapped: !!(ev.is_restricted || ev.is_lower_class) };
        const me2 = playerOf(myId).p;
        const before = me2.rating();
        for (const s of sets) {
          const wId = String(s.winner), lId = String(s.e[String(s.e[0]) === wId ? 1 : 0]);
          const w = playerOf(wId), l = playerOf(lId);
          const wr = w.p.rating(), wrd = w.p.rd(), lr = l.p.rating(), lrd = l.p.rd();
          const sc2 = s.score || [];
          const k = Math.max(sc2[0] ?? 0, sc2[1] ?? 0) === 1 ? BO1_K : 1;   // 勝った側のスコアが 1 = 1 本先取
          if (wId === myId || C.tournamentPassesLv(w.lv, tmeta)) { w.p.update([lr], [lrd], [1]); scaleUpdate(w.p, wr, k); }
          if (lId === myId || C.tournamentPassesLv(l.lv, tmeta)) { l.p.update([wr], [wrd], [0]); scaleUpdate(l.p, lr, k); }
        }
        const after = me2.rating();
        const peakAfter = Math.max(C.peakAt(self.history, ts, after), after);
        bt = { dPeak: peakAfter - (sc.bt_gated_elo || 0), dInt: after - before, peakAfter, n: mine.length };
      }
    }
    return { place, final, counted, perf, tjpr, bt };
  }

  /** @type {{ ens: ReturnType<typeof C.createEnsemblePredictor>, raw0: number, tjArr: any[], btArr: any[] } | null} */
  let ENS = null;
  /** タップで: 全国順位 (総合・順位評価・直対評価) の今 → 予想 @param {LivePrediction} pr */
  async function rankChange(pr) {
    const P = await pop();
    if (!P || !me) return null;
    if (!ENS) {
      /** @type {any[]} */ const others = [];
      /** @type {any[]} */ const tjArr = [];
      /** @type {any[]} */ const btArr = [];
      P.forEach((v, uid) => {
        if (uid === UID) return;
        others.push({ lv: v.lv, tj: v.tj, bt: v.bt, gray: v.gray, uid });
        tjArr.push({ score: v.tj, gray: v.gray, uid });
        if (v.bt > 0) btArr.push({ score: v.bt, gray: v.gray, uid });
      });
      tjArr.sort((a, b) => b.score - a.score);
      btArr.sort((a, b) => b.score - a.score);
      const ens = C.createEnsemblePredictor(others, { lv: myLv, uid: UID, tj: sc.tjpr_score || 0, bt: sc.bt_gated_elo || 0 });
      ENS = { ens, raw0: ens.predictRaw(sc.tjpr_score || 0, sc.bt_gated_elo || 0), tjArr, btArr };
    }
    const rk = me.ranks || {};
    const tj = pr.tjpr ? pr.tjpr.newScore : (sc.tjpr_score || 0);
    const btv = pr.bt ? pr.bt.peakAfter : (sc.bt_gated_elo || 0);
    const cur = rk.ensemble || 0;
    return {
      ens: { cur, next: Math.max(1, cur + ENS.ens.predictRaw(tj, btv) - ENS.raw0) },
      lv: { cur: myLv, next: ENS.ens.predictLv(tj, btv) },
      tjpr: pr.tjpr ? { cur: rk.tjpr || 0, next: C.provisionalRank(ENS.tjArr, tj, UID) } : null,
      bt: pr.bt ? { cur: rk.bt_gated || 0, next: C.provisionalRank(ENS.btArr, btv, UID) } : null,
    };
  }

  return { predict, rankChange };
}

const api = { create, perfRank, bracketBandSize, lastSeenOf, bracketOrderKey };
export default api;
if (typeof window !== 'undefined') W.SpspLivePredict = api;
