// @ts-check
// class_bracket.js — 下位クラス作成 (class/index.html) の計算部分。画面と通信は src/pages/class.js (docs/class_bracket_design.md)。
//   eventSlugOf(url)                      start.gg のイベント URL → "tournament/<t>/event/<e>" (読めなければ '')
//   selectTargets(standings, min, max)    本戦の順位から対象の選手 (min 位〜max 位、max が null なら最後まで。DQ と順位の無い人は除く)
//   seedOrder(targets, method, rankOf, rand)  シード順に並べる (random / main_result = 本戦の順位、同率はランダム / spsp = SPSP の順位、無い人は後ろにランダム)
//   participantName(p)                    Challonge の参加者名 = 「start.gg の名前 (discriminator)」
//   CHALLONGE_TOKEN_KEY / challongeToken()  Challonge でログインしたトークン (callback.js が sessionStorage に置く。期限切れは null)

/** 本戦の 1 人 (start.gg の standings の 1 件を平たくしたもの)
 * @typedef {{ userId: number, discriminator: string, gamerTag: string, placement: number | null, dq: boolean }} ClassEntrant */

/** @param {string} url */
export function eventSlugOf(url) {
  const m = /start\.gg\/(tournament\/[^/?#]+\/event\/[^/?#]+)/.exec(String(url || '').trim());
  return m ? m[1] : '';
}

/** @param {ClassEntrant[]} standings @param {number} min @param {number | null} max */
export function selectTargets(standings, min, max) {
  return standings.filter(p => !p.dq && p.placement != null && p.placement >= min && (max == null || p.placement <= max));
}

/** Fisher–Yates (rand は 0〜1 を返す関数。テストで固定できるように渡す)
 * @template T @param {T[]} arr @param {() => number} rand @returns {T[]} */
function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** @param {ClassEntrant[]} targets @param {'random' | 'main_result' | 'spsp'} method
 * @param {(userId: number) => number | null} rankOf SPSP の総合順位 (無ければ null) @param {() => number} [rand] */
export function seedOrder(targets, method, rankOf, rand = Math.random) {
  // まずランダムに並べ、同じ値の中の順番をランダムにしたうえで、安定ソートで並べ直す
  const base = shuffled(targets, rand);
  if (method === 'random') return base;
  const key = method === 'spsp'
    ? (/** @type {ClassEntrant} */ p) => { const r = rankOf(p.userId); return r == null ? Infinity : r; }
    : (/** @type {ClassEntrant} */ p) => (p.placement == null ? Infinity : p.placement);
  return base.map((p, i) => ({ p, i, k: key(p) }))
    .sort((a, b) => (a.k - b.k) || (a.i - b.i))
    .map(x => x.p);
}

/** @param {ClassEntrant} p */
export function participantName(p) {
  return p.discriminator ? `${p.gamerTag} (${p.discriminator})` : p.gamerTag;
}

export const CHALLONGE_TOKEN_KEY = 'spsp_challonge_token';

/** @param {number} [now] @returns {string | null} */
export function challongeToken(now = Date.now()) {
  try {
    const j = JSON.parse(sessionStorage.getItem(CHALLONGE_TOKEN_KEY) || 'null');
    // 期限の 1 分前からは使わない (作成の途中で切れないように)
    return j && typeof j.token === 'string' && j.exp > now + 60 * 1000 ? j.token : null;
  } catch (e) { return null; }
}

const API = { eventSlugOf, selectTargets, seedOrder, participantName, CHALLONGE_TOKEN_KEY, challongeToken };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspClassBracket = API;
export default API;
