// @ts-check
// title_notice.js — 二つ名を新しく獲得したときのお知らせ (ヘッダーの人型アイコンの印とメニューの項目、編集ページの NEW)。
//   newSince(owned, uid)    持っている二つ名のうち、前に見たときに無かったもの (id の配列)
//   markSeen(uid, owned)    編集ページで見たら既読にする (今の持ち物を、このブラウザに保存)
//   checkNew(uid)           ログイン中の本人について、新しい二つ名の数 (ヘッダー用。選手のファイルは 6 時間ごとにだけ読み直す)
// 持ち物の正本は記録 (D1) で、ビルドが players/<uid>.json に title_bits として写す (docs/card_titles_design.md)。
// 前に見た持ち物はこのブラウザだけに持つ。初めて見るときは何も NEW にしない (今の持ち物を既読にする)
import { ownedFromPlayer } from './titles.js';

const SEEN_KEY = 'spsp_titles_seen_v2';     // { uid: [id, ...] } 前に見たときの持ち物
const CACHE_KEY = 'spsp_titles_new_v2';     // { uid, n, checked } ヘッダー用の数 (6 時間)
const CACHE_MS = 6 * 3600 * 1000;

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

/** @param {Map<string, unknown>} owned @param {number | string} uid @returns {string[]} */
export function newSince(owned, uid) {
  const seen = (readJson(SEEN_KEY) || {})[String(uid)];
  if (!Array.isArray(seen)) return [];   // 初めて: 何も NEW にしない
  const had = new Set(seen);
  return [...owned.keys()].filter(id => !had.has(id));
}

/** @param {number | string} uid @param {Map<string, unknown>} owned */
export function markSeen(uid, owned) {
  const m = readJson(SEEN_KEY) || {};
  m[String(uid)] = [...owned.keys()];
  writeJson(SEEN_KEY, m);
  writeJson(CACHE_KEY, { uid: String(uid), n: 0, checked: Date.now() });
}

/** ヘッダー用: 本人の新しい二つ名の数。読めなければ 0 @param {number | string} uid @returns {Promise<number>} */
export async function checkNew(uid) {
  const c = readJson(CACHE_KEY);
  if (c && c.uid === String(uid) && Date.now() - Number(c.checked || 0) < CACHE_MS) return Number(c.n) || 0;
  try {
    // 持ち物は players/<uid>.json だけで足りる (一覧ファイル players_current.json は重いので読まない)
    const r = await fetch(S.data + 'players/' + encodeURIComponent(String(uid)) + '.json', { cache: 'no-cache' });
    const p = r.ok ? await r.json() : null;
    const owned = p ? ownedFromPlayer(titleLang(), uid, p) : new Map();
    // 初めてなら今の持ち物を既読にしておく (以後に増えた分だけがお知らせになる)
    if (p && !Array.isArray((readJson(SEEN_KEY) || {})[String(uid)])) markSeen(uid, owned);
    const n = newSince(owned, uid).length;
    writeJson(CACHE_KEY, { uid: String(uid), n, checked: Date.now() });
    return n;
  } catch (e) { return 0; }
}

const API = { newSince, markSeen, checkNew };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTitleNotice = API;
export default API;
