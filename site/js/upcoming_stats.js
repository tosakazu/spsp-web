// @ts-check
import { canonicalCharId } from './chars.js';
// js/upcoming_stats.js — 今後の大会のページ (src/pages/upcoming.js) の集計。画面に触らない計算だけ (tests/frontend/upcoming_stats.test.cjs)。
//   joinEntrants(ev, index)   参加予定者 (data/upcoming_entrants.json の entrants) に、選手の一覧 (js/views.js の index) の順位・Lv・キャラ・地域を付ける。
//                             総合評価の順位の高い順 (順位の無い人は後ろ、名前順)。同じ uid は 1 回だけ
//   summary(rows)             人数・順位のある人数・上位の人数・順位の中央値
//   rankBands(rows)           順位の帯ごとの人数 (BANDS の順、最後が「順位なし」)。参加者のいる帯の範囲だけ (上と下の 0 人の帯は出さない)
//   cutBand(bands, n)         予選通過 n 人のラインが掛かる帯 (順位の高い順に数える)
//   lvCounts(rows)            Lv ごとの人数 (5 → 1、最後が Lv なし)
//   groupBy(rows, key)        'char' / 'pref' ごとにまとめる (人数の多い順、同数は最上位の人の順位順。値の無い人は最後の 1 組 key = null)
//   topOf(rows, n)            上から n 人
const global = typeof window !== 'undefined' ? window : globalThis;

/** @typedef {{ uid: number, name: string, rank: number | null, lv: number | null, char: number | null, pref: number | null, ovs: boolean }} UpRow */

/** 順位の帯の上端 (この順位まで)。Lv の表記の区切りと同じ (js/format.js の lvSuffix: Lv5 は 👑8 🥇16 🥈32 🥉64 +128 256、Lv4 以下は + と無印)。最後の帯はそれより下 (Lv1) */
export const BANDS = [8, 16, 32, 64, 128, 256, 384, 512, 768, 1024, 1536, 2048, 3072];
/** 帯の Lv (帯の先頭の順位で決まる) @param {number} from */
export const lvOfRank = from => (from <= 256 ? 5 : from <= 512 ? 4 : from <= 1024 ? 3 : from <= 2048 ? 2 : 1);

/** @param {{ entrants?: { uid?: number | null, tag?: string | null }[] } | null | undefined} ev
 *  @param {{ get: (uid: number) => any } | null | undefined} index @returns {UpRow[]} */
export function joinEntrants(ev, index) {
  /** @type {UpRow[]} */
  const out = [];
  const seen = new Set();
  for (const e of (ev && ev.entrants) || []) {
    const uid = Number(e && e.uid);
    if (!Number.isInteger(uid) || uid <= 0 || seen.has(uid)) continue;
    seen.add(uid);
    const r = index ? index.get(uid) : null;
    const num = (/** @type {any} */ v) => (typeof v === 'number' && v > 0 ? v : null);
    out.push({ uid, name: String((r && r.name) || (e && e.tag) || ''), rank: r ? num(r.ens) : null, lv: r ? num(r.lv) : null,
               char: r && num(r.char) ? canonicalCharId(r.char) : null, pref: r ? num(r.pref) : null, ovs: !!(r && r.ovs) });
  }
  return out.sort(byRank);
}
/** @param {UpRow} a @param {UpRow} b */
function byRank(a, b) {
  if (a.rank !== b.rank) return a.rank === null ? 1 : b.rank === null ? -1 : a.rank - b.rank;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : a.uid - b.uid;
}

/** @param {UpRow[]} rows */
export function summary(rows) {
  const ranks = rows.map(r => r.rank).filter(/** @returns {r is number} */ r => r !== null).sort((a, b) => a - b);
  const within = (/** @type {number} */ n) => ranks.filter(r => r <= n).length;
  const m = ranks.length;
  return { n: rows.length, ranked: m, top10: within(10), top100: within(100), top1000: within(1000),
           median: m ? (m % 2 ? ranks[(m - 1) / 2] : Math.round((ranks[m / 2 - 1] + ranks[m / 2]) / 2)) : null };
}

/** @param {UpRow[]} rows @returns {{ from: number | null, to: number | null, n: number }[]} from/to とも null = 順位なし、to だけ null = それより下 */
export function rankBands(rows) {
  const out = BANDS.map((to, i) => ({ from: i ? BANDS[i - 1] + 1 : 1, to: /** @type {number | null} */ (to), n: 0 }));
  out.push({ from: BANDS[BANDS.length - 1] + 1, to: null, n: 0 });
  const none = { from: /** @type {number | null} */ (null), to: /** @type {number | null} */ (null), n: 0 };
  for (const r of rows) {
    if (r.rank === null) { none.n++; continue; }
    const i = BANDS.findIndex(to => /** @type {number} */ (r.rank) <= to);
    out[i < 0 ? BANDS.length : i].n++;
  }
  // 参加者に合わせる: 人のいる最初の帯から最後の帯まで (間の 0 人は残す)
  const a = out.findIndex(x => x.n > 0);
  let b = out.length - 1;
  while (b >= 0 && !out[b].n) b--;
  return [.../** @type {{ from: number | null, to: number | null, n: number }[]} */ (a < 0 ? [] : out.slice(a, b + 1)), none];
}

/** 予選通過の人数 n を順位の高い順に数えたとき、ラインが掛かる帯。index = bands の位置、within = その帯のうちラインの内側の人数。
 *  n が無い・全員通過 (n ≥ 人数) なら null
 *  @param {{ n: number }[]} bands rankBands の結果 @param {number | null | undefined} n @returns {{ index: number, within: number } | null} */
export function cutBand(bands, n) {
  const total = bands.reduce((a, b) => a + b.n, 0);
  if (!n || !(n > 0) || n >= total) return null;
  let cum = 0;
  for (let i = 0; i < bands.length; i++) {
    if (cum + bands[i].n >= n) return { index: i, within: n - cum };
    cum += bands[i].n;
  }
  return null;
}

/** @param {UpRow[]} rows @returns {{ lv: number | null, n: number }[]} */
export function lvCounts(rows) {
  const out = [5, 4, 3, 2, 1].map(lv => ({ lv: /** @type {number | null} */ (lv), n: 0 }));
  const none = { lv: /** @type {number | null} */ (null), n: 0 };
  for (const r of rows) {
    const o = out.find(x => x.lv === r.lv);
    (o || none).n++;
  }
  return [...out, none];
}

/** @param {UpRow[]} rows 順位順に並んでいること @param {'char' | 'pref'} key
 *  @returns {{ key: number | null, rows: UpRow[] }[]} */
export function groupBy(rows, key) {
  /** @type {Map<number | null, UpRow[]>} */
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    const a = m.get(k);
    if (a) a.push(r); else m.set(k, [r]);
  }
  const best = (/** @type {UpRow[]} */ a) => (a[0].rank === null ? Infinity : a[0].rank);
  return [...m.entries()].map(([k, a]) => ({ key: k, rows: a }))
    .sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || b.rows.length - a.rows.length || best(a.rows) - best(b.rows));
}

/** @param {UpRow[]} rows @param {number} n */
export const topOf = (rows, n) => rows.slice(0, n);

/** @typedef {{ id: string, ident: string, url: string, wave: string | null, startAt: number | null, n: number, order: number }} UpPool */
/** @typedef {{ id: string, startAt: number | null, n: number }} UpWave */
/** シードとプール (start.gg でトーナメントとシードが公開されている大会だけ。smash_database が bracket と entrants[].seed / pg を付ける)。
 *  出ていない大会は null。シードが登録順のまま (参加者の並びとちょうど逆順 = 主催者がまだ並べていない) の大会も null (プレイヤーページと同じ判定)。
 *  pools は ウェーブ → プール名の順 (数字は数として比べる。order = その位置)、人のいるプールだけ。waves はウェーブのある大会だけ
 *  @param {any} ev @returns {{ byUid: Map<number, { seed: number, pool: UpPool | null }>, pools: UpPool[], waves: UpWave[] } | null} */
export function seedInfo(ev) {
  const b = ev && ev.bracket;
  const en = /** @type {any[]} */ ((ev && ev.entrants) || []);
  if (!b || !b.pools || typeof b.pools !== 'object') return null;
  const s = en.map(x => x && x.seed);
  if (s.length >= 2 && s.every((v, i) => typeof v === 'number' && (i === 0 || v === s[i - 1] - 1))) return null;
  /** @type {Map<string, UpPool>} */
  const pools = new Map();
  /** @type {Map<number, { seed: number, pool: UpPool | null }>} */
  const byUid = new Map();
  for (const e of en) {
    const uid = Number(e && e.uid);
    if (!Number.isInteger(uid) || uid <= 0 || byUid.has(uid) || typeof e.seed !== 'number' || !(e.seed > 0)) continue;
    const pid = e.pg === null || e.pg === undefined ? '' : String(e.pg);
    let pool = pools.get(pid) || null;
    if (!pool && pid && Object.prototype.hasOwnProperty.call(b.pools, pid)) {
      const p = b.pools[pid] || {};
      const str = (/** @type {any} */ v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
      pool = { id: pid, ident: str(p.ident), url: /^https:\/\/www\.start\.gg\//.test(str(p.url)) ? str(p.url) : '',
               wave: str(p.wave) || null, startAt: typeof p.start_at === 'number' && p.start_at > 0 ? p.start_at : null, n: 0, order: 0 };
      pools.set(pid, pool);
    }
    if (pool) pool.n++;
    byUid.set(uid, { seed: e.seed, pool });
  }
  if (!byUid.size) return null;
  const nat = (/** @type {string} */ a, /** @type {string} */ c) => a.localeCompare(c, undefined, { numeric: true });
  const list = [...pools.values()].sort((a, c) => (a.wave === null ? 1 : 0) - (c.wave === null ? 1 : 0) || nat(a.wave || '', c.wave || '') || nat(a.ident, c.ident) || nat(a.id, c.id));
  list.forEach((p, i) => { p.order = i; });
  /** @type {UpWave[]} */
  const waves = [];
  for (const p of list) {
    if (p.wave === null) continue;
    const w = waves.find(x => x.id === p.wave);
    if (w) { w.n += p.n; if (w.startAt === null || (p.startAt !== null && p.startAt < w.startAt)) w.startAt = p.startAt; } else waves.push({ id: p.wave, startAt: p.startAt, n: p.n });
  }
  return { byUid, pools: list, waves };
}

const api = { BANDS, lvOfRank, joinEntrants, summary, rankBands, cutBand, lvCounts, groupBy, topOf, seedInfo };
/** @type {any} */ (global).SpspUpcomingStats = api;
export default api;
