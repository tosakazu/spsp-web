// @ts-check
// title_notice.js — 二つ名を新しく獲得したときのお知らせ (ヘッダーの人型アイコンの印とメニューの項目、編集ページの NEW)。
//   newSince(owned, uid)    持っている二つ名 (js/titles.js ownedTitles) のうち、まだ見ていない新しいもの (id の配列)
//   markSeen(uid, owned)    編集ページで見たら既読にする (このブラウザに保存)
//   checkNew(uid)           ログイン中の本人について、新しい二つ名の数 (ヘッダー用。選手のデータは 6 時間ごとにだけ読み直す)
// 既読はこのブラウザだけ (localStorage)。お知らせは獲得から NOTICE_DAYS 日まで (それより古いものは既読扱い)
import { ownedTitles, TITLE_LAUNCH } from './titles.js';

const SEEN_KEY = 'spsp_titles_seen_v1';     // { uid: 'YYYY-MM-DD' } ここまでに獲得したものは既読
const CACHE_KEY = 'spsp_titles_new_v1';     // { uid, n, checked } ヘッダー用の数 (6 時間)
const CACHE_MS = 6 * 3600 * 1000;
export const NOTICE_DAYS = 14;

const S = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis).SPSP || {};
const titleLang = () => (S.site && S.site.titleLang) || 'ja';

/** @param {string} key @returns {any} */
function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}
/** @param {string} key @param {any} v */
function writeJson(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 保存できなければお知らせが残るだけ */ }
}

/** 今日から n 日前 (YYYY-MM-DD、日本時間で十分) @param {number} n */
function daysAgo(n) {
  return new Date(Date.now() + 9 * 3600e3 - n * 864e5).toISOString().slice(0, 10);
}

/** @param {Map<string, { at: string }>} owned @param {number | string} uid @returns {string[]} */
export function newSince(owned, uid) {
  const seenMap = readJson(SEEN_KEY) || {};
  const seen = String(seenMap[String(uid)] || TITLE_LAUNCH);
  const from = daysAgo(NOTICE_DAYS);
  return [...owned.entries()].filter(([, v]) => v.at > seen && v.at >= from).map(([id]) => id);
}

/** @param {number | string} uid @param {Map<string, { at: string }>} owned */
export function markSeen(uid, owned) {
  let latest = TITLE_LAUNCH;
  for (const v of owned.values()) if (v.at > latest) latest = v.at;
  const seenMap = readJson(SEEN_KEY) || {};
  seenMap[String(uid)] = latest;
  writeJson(SEEN_KEY, seenMap);
  writeJson(CACHE_KEY, { uid: String(uid), n: 0, checked: Date.now() });
}

/** ヘッダー用: 本人の新しい二つ名の数。読めなければ 0 @param {number | string} uid @returns {Promise<number>} */
export async function checkNew(uid) {
  const c = readJson(CACHE_KEY);
  if (c && c.uid === String(uid) && Date.now() - Number(c.checked || 0) < CACHE_MS) return Number(c.n) || 0;
  try {
    // 大会の一覧は players/<uid>.json だけで足りる (一覧ファイル players_current.json は重いので読まない)
    const r = await fetch(S.data + 'players/' + encodeURIComponent(String(uid)) + '.json', { cache: 'no-cache' });
    const p = r.ok ? await r.json() : null;
    const n = p ? newSince(ownedTitles(titleLang(), uid, p.tournaments || []), uid).length : 0;
    writeJson(CACHE_KEY, { uid: String(uid), n, checked: Date.now() });
    return n;
  } catch (e) { return 0; }
}

const API = { newSince, markSeen, checkNew, NOTICE_DAYS };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTitleNotice = API;
export default API;
