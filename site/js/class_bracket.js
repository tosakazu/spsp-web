// @ts-check
// class_bracket.js — 下位クラス作成 (class/index.html) の計算部分。画面と通信は src/pages/class.js (docs/class_bracket_design.md)。
//   parseStartggUrl(url)                  start.gg の URL → { tournamentSlug, eventSlug } (大会のページでもよい。eventSlug は無ければ null。読めなければ null)
//   pickEvents(events)                    大会のイベントから候補 (スマブラSP の 1on1。無ければ全部)
//   selectTargets(standings, min, max, excludeDq)  本戦の順位から対象の選手 (min 位〜max 位、max が null なら最後まで。順位の無い人は除く。excludeDq なら DQ も除く)
//   seedOrder(targets, method, rankOf, rand)  シード順に並べる (random / main_result = 本戦の順位、同率はランダム /
//                                         main_spsp = 本戦の順位、同率は SPSP の順位 (無い人はその中で後ろにランダム) / spsp = SPSP の順位、無い人は後ろにランダム)
//   participantName(p)                    Challonge の参加者名 = 「start.gg の名前 (discriminator)」
//   CHALLONGE_TOKEN_KEY                    Challonge のログインを置く sessionStorage のキー (callback.js が置く)
//   challongeLogin(app) / challongeLogins()  Challonge のログイン (アプリの番号ごと。期限切れは無い扱い)
//   saveChallongeLogin(app, v) / dropChallongeLogin(app)
//   challongeToken() / challongeUser()     0 番のアプリのトークン・アカウント名 (前からある形)
//
// Challonge アプリを複数使う (worker/src/api/challonge.ts): トークンはログインしたアプリのもので、そのアプリで作った下位クラスにしか
// 使えない。どのアプリを使うかは大会ごとに Worker が決めるので、ログインはアプリの番号ごとに持つ。
// sessionStorage の形: { apps: { "<番号>": { token, exp, user, tag } } }。tag = どのアプリのトークンかの印 (Worker が返す。作成のときに添える)。
// 前の形 { token, exp, user } は 0 番として読む

/** 本戦の 1 人 (start.gg の standings の 1 件を平たくしたもの)
 * extra = 本戦に出ていない人を手で足した (シードは本戦の最速敗退と同じ、SPSP には常に集計しない。Challonge の misc に :nocount)
 * @typedef {{ userId: number, discriminator: string, gamerTag: string, placement: number | null, dq: boolean, extra?: boolean }} ClassEntrant */

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

/** Challonge のログイン 1 つ。app = アプリの番号、tag = どのアプリのトークンかの印 (無ければ null)
 * @typedef {{ app: number, token: string, exp: number, user: string | null, tag: string | null }} ChallongeLogin */

/** 置いてあるものを番号ごとに (期限は見ない) @returns {Record<string, any>} */
function storedLogins() {
  try {
    const j = JSON.parse(sessionStorage.getItem(CHALLONGE_TOKEN_KEY) || 'null');
    if (!j || typeof j !== 'object') return {};
    if (j.apps && typeof j.apps === 'object') return j.apps;
    return typeof j.token === 'string' ? { 0: j } : {};   // 前の形 = 0 番
  } catch (e) { return {}; }
}

/** 今使えるログイン (番号の小さい順) @param {number} [now] @returns {ChallongeLogin[]} */
export function challongeLogins(now = Date.now()) {
  const apps = storedLogins();
  /** @type {ChallongeLogin[]} */
  const out = [];
  for (const k of Object.keys(apps)) {
    const v = apps[k];
    const app = Number(k);
    // 期限の 1 分前からは使わない (作成の途中で切れないように)
    if (!Number.isInteger(app) || app < 0 || !v || typeof v.token !== 'string' || !v.token || !(v.exp > now + 60 * 1000)) continue;
    out.push({ app, token: v.token, exp: v.exp, user: typeof v.user === 'string' && v.user ? v.user : null, tag: typeof v.tag === 'string' && v.tag ? v.tag : null });
  }
  return out.sort((a, b) => a.app - b.app);
}

/** その番号のアプリのログイン (無い・期限切れは null) @param {number} app @param {number} [now] @returns {ChallongeLogin | null} */
export function challongeLogin(app, now = Date.now()) {
  return challongeLogins(now).find(x => x.app === app) || null;
}

/** @param {number} app @param {{ token: string, exp: number, user?: string | null, tag?: string | null }} v */
export function saveChallongeLogin(app, v) {
  const apps = storedLogins();
  apps[String(app)] = { token: v.token, exp: v.exp, user: v.user || null, tag: v.tag || null };
  sessionStorage.setItem(CHALLONGE_TOKEN_KEY, JSON.stringify({ apps }));
}

/** @param {number} app */
export function dropChallongeLogin(app) {
  const apps = storedLogins();
  delete apps[String(app)];
  try { sessionStorage.setItem(CHALLONGE_TOKEN_KEY, JSON.stringify({ apps })); } catch (e) { /* 表示だけ変わる */ }
}

/** @param {number} [now] @returns {string | null} */
export function challongeToken(now = Date.now()) {
  const l = challongeLogin(0, now);
  return l ? l.token : null;
}

/** @param {number} [now] @returns {string | null} */
export function challongeUser(now = Date.now()) {
  const l = challongeLogin(0, now);
  return l ? l.user : null;
}

const API = { parseStartggUrl, challongeUser, pickEvents, selectTargets, seedOrder, participantName, CHALLONGE_TOKEN_KEY, challongeToken,
  challongeLogins, challongeLogin, saveChallongeLogin, dropChallongeLogin };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspClassBracket = API;
export default API;
