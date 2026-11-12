// published_seeds.js — 公開済みシードとの被り回避 (docs/seed_collision_avoidance.md §6.2.2)。
//   前後の日のほかの大会で、トーナメントとシードがもう公開されているもの (data/upcoming_entrants.json の bracket) を見て、
//   そこで同じプールにいる 2 人を「近いうちに当たる見込みのペア」として直近対戦の罰則 (recentPair) に足す。
//   fetch も DOM もしない (呼び出し側が upcoming_entrants.json と選手一覧の順位を渡す)。
//   selectPublishedEvents(up, opts) → { used, skipped }   対象の大会を選ぶ (範囲・平日・仮のシード)
//   publishedPairs(used, attendees)  → ペアの一覧 (勝者側で何回戦で当たるか)
//   mergePublished(bundle, pairs, p) → buildSeedData の結果の recentPair / recentMeta に足す
import { earliestMeetRound, nextPow2, pairKey, slotOfSeedMap } from './seed_optimizer.js';

// 対象にする期間 (日)。ほかの大会が本大会より前なら BEFORE_DAYS まで、後なら AFTER_DAYS まで。
// 100 人以上の大会は後 AFTER_DAYS_BIG まで (データは取得時点から 21 日先までしか無い)。2026-10-28 決定
export const BEFORE_DAYS = 3;
export const AFTER_DAYS = 3;
export const AFTER_DAYS_BIG = 21;
export const BIG_NENT = 100;
// 仮のシード (登録順など) の判定。ビルドのランダムシード判定 (spsp/random_seed.py) と同じ値
export const PROVISIONAL_MIN_RATED = 5;
export const PROVISIONAL_MAX_R = 0.3;
// 勝者側で当たる回戦ごとの重み (1 回戦, 2 回戦, 3 回戦, それ以降)
export const ROUND_WEIGHTS = [1.0, 0.6, 0.35, 0.2];

const JST_MS = 9 * 3600000;
/** unix 秒 → JST の日付 (1970-01-01 からの日数) @param {number} sec */
export function jstDay(sec) { return Math.floor((sec * 1000 + JST_MS) / 86400000); }
/** unix 秒 → JST の 'YYYY-MM-DD' @param {number} sec */
export function jstDate(sec) { return new Date(sec * 1000 + JST_MS).toISOString().slice(0, 10); }

/** 同順位は平均順位 @param {number[]} vals */
function ranksOf(vals) {
  const order = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const r = new Array(vals.length).fill(0);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && vals[order[j + 1]] === vals[order[i]]) j++;
    for (let k = i; k <= j; k++) r[order[k]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
/** Spearman の順位相関 (分散 0 なら null) @param {number[]} xs @param {number[]} ys */
export function spearman(xs, ys) {
  const rx = ranksOf(xs), ry = ranksOf(ys), n = rx.length;
  if (n < 2) return null;
  const mx = rx.reduce((s, v) => s + v, 0) / n, my = ry.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/**
 * 仮のシードか (シード順と SPSP の総合評価の順位がほとんど相関しない)。順位のある人が少なければ判定しない (false)
 * @param {{ uid?: number | null, seed?: number | null }[]} entrants
 * @param {(uid: number) => number | null | undefined} rankOf
 */
export function isProvisionalSeed(entrants, rankOf) {
  const xs = [], ys = [];
  for (const e of entrants) {
    if (e.uid == null || e.seed == null) continue;
    const r = rankOf(e.uid);
    if (r == null || !(r > 0)) continue;
    xs.push(e.seed); ys.push(r);
  }
  if (xs.length < PROVISIONAL_MIN_RATED) return { provisional: false, n: xs.length, r: null };
  const r = spearman(xs, ys);
  return { provisional: r != null && r < PROVISIONAL_MAX_R, n: xs.length, r };
}

/** upcoming_entrants.json の events (配信は object、古い形は配列) を [eventId, ev] の列に @param {any} up */
function eventEntries(up) {
  const evs = up && up.events;
  if (!evs) return [];
  if (Array.isArray(evs)) return evs.map((e) => [String(e.event_id != null ? e.event_id : e.id), e]);
  return Object.entries(evs);
}

/**
 * @typedef {{ eventId: string, name: string, date: string, dayDiff: number, nent: number,
 *   pools: { ident: string, seeds: { uid: number | null, seed: number }[] }[], common: number }} PublishedEvent
 * @typedef {{ eventId: string, name: string, date: string, dayDiff: number, nent: number, common: number,
 *   reason: 'range' | 'weekday' | 'provisional' | 'nopair', r?: number | null }} SkippedEvent
 */
/**
 * 対象にする大会を選ぶ。本大会の出場者が 2 人以上同じプールにいる、公開済みの大会だけを見る (それ以外は一覧にも出さない)。
 * @param {any} up upcoming_entrants.json
 * @param {{ targetEventId?: string | number | null, targetStartAt: number, attendees: Iterable<number>,
 *   excludeWeekday?: boolean, rankOf?: (uid: number) => number | null | undefined }} opts
 * @returns {{ used: PublishedEvent[], skipped: SkippedEvent[] }}
 */
export function selectPublishedEvents(up, opts) {
  const att = new Set(Array.from(opts.attendees, Number));
  const day0 = jstDay(opts.targetStartAt);
  const rankOf = opts.rankOf || (() => null);
  /** @type {PublishedEvent[]} */ const used = [];
  /** @type {SkippedEvent[]} */ const skipped = [];
  for (const [eid, ev] of eventEntries(up)) {
    if (!ev || !ev.bracket || !ev.start_at || !Array.isArray(ev.entrants)) continue;
    if (opts.targetEventId != null && String(opts.targetEventId) === String(eid)) continue;   // 本大会そのもの
    // プールごとに、本大会の出場者を数える (シードのある人だけ)
    /** @type {Map<string, { uid: number | null, seed: number }[]>} */
    const byPool = new Map();
    let common = 0;
    for (const e of ev.entrants) {
      if (e.pg == null || e.seed == null) continue;
      const k = String(e.pg);
      if (!byPool.has(k)) byPool.set(k, []);
      /** @type {any[]} */ (byPool.get(k)).push({ uid: e.uid != null ? Number(e.uid) : null, seed: Number(e.seed) });
      if (e.uid != null && att.has(Number(e.uid))) common++;
    }
    const sharing = [...byPool.values()].some((ps) => ps.filter((p) => p.uid != null && att.has(p.uid)).length >= 2);
    if (common < 2) continue;
    const nent = Number(ev.num_entrants) || ev.entrants.length;
    const dayDiff = jstDay(ev.start_at) - day0;
    const base = { eventId: String(eid), name: String(ev.tournament_name || ''), date: jstDate(ev.start_at), dayDiff, nent, common };
    const inRange = dayDiff < 0 ? -dayDiff <= BEFORE_DAYS : dayDiff <= (nent >= BIG_NENT ? AFTER_DAYS_BIG : AFTER_DAYS);
    if (!inRange) { skipped.push({ ...base, reason: 'range' }); continue; }
    if (opts.excludeWeekday && ev.is_weekend === false) { skipped.push({ ...base, reason: 'weekday' }); continue; }
    if (!sharing) { skipped.push({ ...base, reason: 'nopair' }); continue; }
    const pv = isProvisionalSeed(ev.entrants, rankOf);
    if (pv.provisional) { skipped.push({ ...base, reason: 'provisional', r: pv.r }); continue; }
    const pools = [...byPool.entries()].map(([pg, seeds]) => ({
      ident: String((ev.bracket.pools && ev.bracket.pools[pg] && ev.bracket.pools[pg].ident) || ''),
      seeds: seeds.sort((a, b) => a.seed - b.seed),
    }));
    used.push({ ...base, pools });
  }
  const byDay = (/** @type {{ dayDiff: number, name: string }} */ a, /** @type {{ dayDiff: number, name: string }} */ b) =>
    Math.abs(a.dayDiff) - Math.abs(b.dayDiff) || a.dayDiff - b.dayDiff || (a.name < b.name ? -1 : 1);
  used.sort(byDay); skipped.sort(byDay);
  return { used, skipped };
}

/** 回戦 → 重み @param {number} round */
export function roundWeight(round) { return ROUND_WEIGHTS[Math.min(round, ROUND_WEIGHTS.length) - 1]; }

/**
 * 対象の大会で同じプールにいる、本大会の出場者のペア。回戦はプールの中のシード順から標準の配置で (§4.3 と同じ計算)
 * @param {PublishedEvent[]} used @param {Iterable<number>} attendees
 * @returns {{ a: number, b: number, round: number, w: number, ev: PublishedEvent, pool: string }[]}
 */
export function publishedPairs(used, attendees) {
  const att = new Set(Array.from(attendees, Number));
  const out = [];
  for (const ev of used) {
    for (const pool of ev.pools) {
      const M = pool.seeds.length;
      if (M < 2) continue;
      const slotOf = slotOfSeedMap(nextPow2(M));
      const idx = [];
      pool.seeds.forEach((s, i) => { if (s.uid != null && att.has(s.uid)) idx.push(i); });
      for (let x = 0; x < idx.length; x++) {
        for (let y = x + 1; y < idx.length; y++) {
          const i = idx[x], j = idx[y];
          const round = earliestMeetRound(slotOf[i + 1], slotOf[j + 1]);
          out.push({ a: /** @type {number} */ (pool.seeds[i].uid), b: /** @type {number} */ (pool.seeds[j].uid), round, w: roundWeight(round), ev, pool: pool.ident });
        }
      }
    }
  }
  return out;
}

/**
 * buildSeedData の結果に足す。罰則 = 重み × 規模の重み (直近 1 か月以内に 1 回当たったのと同じ尺度)。
 * 同じペアの実際の対戦歴・ほかの大会の分とは recentAgg に従ってまとめる (既定 max = 大きい方だけ)。
 * recentMeta[key].published に [{date, tournament, nent, round, pool}] を足す (count は実際の対戦数のまま)。
 * @param {{ recentPair: Record<string, number>, recentMeta: Record<string, any> }} bundle
 * @param {ReturnType<typeof publishedPairs>} pairs
 * @param {{ recentAgg?: string, sizeWeight?: (n: number) => number }} [p]
 * @returns {number} 罰則を足したペアの数
 */
export function mergePublished(bundle, pairs, p) {
  const useMax = !p || p.recentAgg !== 'sum';
  const sw = (p && p.sizeWeight) || ((/** @type {number} */ n) => Math.log2(Math.max(n, 2)));
  const touched = new Set();
  for (const x of pairs) {
    const key = pairKey(x.a, x.b);
    const val = x.w * sw(x.ev.nent);
    bundle.recentPair[key] = useMax ? Math.max(bundle.recentPair[key] || 0, val) : (bundle.recentPair[key] || 0) + val;
    const meta = bundle.recentMeta[key] || (bundle.recentMeta[key] = {
      penalty: 0, count: 0, lastDate: null, lastDeltaDays: null, lastTournament: null, lastNent: null,
      seriesCount: 0, seriesLastDate: null, matches: [],
    });
    meta.penalty = useMax ? Math.max(meta.penalty || 0, val) : (meta.penalty || 0) + val;
    (meta.published || (meta.published = [])).push({ date: x.ev.date, tournament: x.ev.name, nent: x.ev.nent, round: x.round, pool: x.pool });
    touched.add(key);
  }
  for (const key of touched) bundle.recentMeta[key].published.sort((/** @type {any} */ u, /** @type {any} */ v) => u.round - v.round || (u.date < v.date ? -1 : 1));
  return touched.size;
}

const API = { selectPublishedEvents, publishedPairs, mergePublished, isProvisionalSeed, spearman, roundWeight, jstDay, jstDate,
  BEFORE_DAYS, AFTER_DAYS, AFTER_DAYS_BIG, BIG_NENT, ROUND_WEIGHTS };
const global = typeof window !== 'undefined' ? window : globalThis;   // テストは app/*.js の import を外して連結するので名前でも引けるように
/** @type {any} */ (global).SPSPPublishedSeeds = API;
export default API;
