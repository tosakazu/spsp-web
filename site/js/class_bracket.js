// @ts-check
// class_bracket.js — 下位クラス作成 (class/index.html) の計算部分。画面と通信は src/pages/class.js (docs/class_bracket_design.md)。
//   parseStartggUrl(url)                  start.gg の URL → { tournamentSlug, eventSlug } (大会のページでもよい。eventSlug は無ければ null。読めなければ null)
//   pickEvents(events)                    大会のイベントから候補 (スマブラSP の 1on1。無ければ全部)
//   selectTargets(standings, min, max, excludeDq)  本戦の順位から対象の選手 (min 位〜max 位、max が null なら最後まで。順位の無い人は除く。excludeDq なら DQ も除く)
//   seedOrder(targets, method, rankOf, rand)  シード順に並べる (random / main_result = 本戦の順位、同率はランダム /
//                                         main_spsp = 本戦の順位、同率は SPSP の順位 (無い人はその中で後ろにランダム) / spsp = SPSP の順位、無い人は後ろにランダム)
//   participantName(p)                    Challonge の参加者名 = 「start.gg の名前 (discriminator)」
//   CHALLONGE_TOKEN_KEY / challongeToken()  Challonge でログインしたトークン (callback.js が sessionStorage に置く。期限切れは null)
//   challongeUser()                        そのログインの Challonge のアカウント名 (表示用。分からなければ null)

/** 本戦の 1 人 (start.gg の standings の 1 件を平たくしたもの)
 * @typedef {{ userId: number, discriminator: string, gamerTag: string, placement: number | null, dq: boolean }} ClassEntrant */

/** シード機能 (seeding/app/40_startgg.js の parseEventUrl) と同じ読み方: イベントの URL・大会の URL (/details などが付いてもよい)・slug
 * @param {string} url @returns {{ tournamentSlug: string, eventSlug: string | null } | null} */
export function parseStartggUrl(url) {
  const s = String(url || '').trim();
  const m = s.match(/tournament\/([^/\s?#]+)\/event\/([^/\s?#]+)/);
  if (m) return { tournamentSlug: m[1], eventSlug: m[2] };
  const t = s.match(/tournament\/([^/\s?#]+)(?:\/(?!event\/)[^\s?#]*)?(?:[?#].*)?$/);
  return t ? { tournamentSlug: t[1], eventSlug: null } : null;
}

const SSBU_VIDEOGAME_ID = 1386;
const SINGLES_EVENT_TYPE = 1;

/** @template {{ videogame?: { id: number | string } | null, type?: number | string | null }} E @param {E[]} events @returns {E[]} */
export function pickEvents(events) {
  const ssbu = events.filter(e => e.videogame && Number(e.videogame.id) === SSBU_VIDEOGAME_ID && Number(e.type) === SINGLES_EVENT_TYPE);
  return ssbu.length ? ssbu : events.slice();
}

/** @param {ClassEntrant[]} standings @param {number} min @param {number | null} max @param {boolean} [excludeDq] */
export function selectTargets(standings, min, max, excludeDq = true) {
  return standings.filter(p => !(excludeDq && p.dq) && p.placement != null && p.placement >= min && (max == null || p.placement <= max));
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

/** @param {ClassEntrant[]} targets @param {'random' | 'main_result' | 'main_spsp' | 'spsp'} method
 * @param {(userId: number) => number | null} rankOf SPSP の総合順位 (無ければ null) @param {() => number} [rand] */
export function seedOrder(targets, method, rankOf, rand = Math.random) {
  // まずランダムに並べ、同じ値の中の順番をランダムにしたうえで、安定ソートで並べ直す
  const base = shuffled(targets, rand);
  if (method === 'random') return base;
  const spsp = (/** @type {ClassEntrant} */ p) => { const r = rankOf(p.userId); return r == null ? Infinity : r; };
  const place = (/** @type {ClassEntrant} */ p) => (p.placement == null ? Infinity : p.placement);
  // 比べる値の組 (前から順に。同じなら次、全部同じならシャッフル順)
  const keys = method === 'spsp' ? [spsp] : method === 'main_spsp' ? [place, spsp] : [place];
  const cmp = (/** @type {number} */ a, /** @type {number} */ b) => (a === b ? 0 : a < b ? -1 : 1);
  return base.map((p, i) => ({ p, i, k: keys.map(f => f(p)) }))
    .sort((a, b) => { for (let j = 0; j < a.k.length; j++) { const c = cmp(a.k[j], b.k[j]); if (c) return c; } return a.i - b.i; })
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

/** @param {number} [now] @returns {string | null} */
export function challongeUser(now = Date.now()) {
  if (!challongeToken(now)) return null;
  try {
    const j = JSON.parse(sessionStorage.getItem(CHALLONGE_TOKEN_KEY) || 'null');
    return j && typeof j.user === 'string' && j.user ? j.user : null;
  } catch (e) { return null; }
}

const API = { parseStartggUrl, challongeUser, pickEvents, selectTargets, seedOrder, participantName, CHALLONGE_TOKEN_KEY, challongeToken };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspClassBracket = API;
export default API;
