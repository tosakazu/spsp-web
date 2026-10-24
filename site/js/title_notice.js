// @ts-check
// title_notice.js — 持っている二つ名の取得と、新しく獲得したときのお知らせ (ヘッダーの人型アイコンの印とメニューの項目、編集ページの NEW)。
//   fetchOwned(uid)         持っている二つ名の記録 { bits, updated } (GET /api/titles。記録が無ければ bits "" / updated null)。API が無い・読めなければ null
//   newSince(bits, uid)     持っているもの (ビット列) のうち、前に見たときに無かったもの (ビット列)
//   markSeen(uid, bits)     編集ページで見たら既読にする (今の持ち物を、このブラウザに保存)
//   checkNew(uid)           ログイン中の本人について、新しい二つ名の数 (ヘッダー用。記録は 5 分ごとに読み直す)
// 持ち物の正本は記録 (D1 title_owned、docs/card_titles_design.md)。ここでは二つ名の一覧 (js/titles.js) を読まない
// (ビット列どうしの比較で足りる。一覧は大きいので、全ページのヘッダーには入れない)。
// 前に見た持ち物はこのブラウザだけに持つ。初めて見るときは何も NEW にしない (今の持ち物を既読にする)
import { bitsMinus, bitsCount } from './title_bits.js';
import SPSP_POST_CONFIG from './post_config.js';
import SpspLogin from './login.js';

const SEEN_KEY = 'spsp_titles_seen_v3';     // { uid: ビット列 } 前に見たときの持ち物
const CACHE_KEY = 'spsp_titles_new_v3';     // { uid, n, checked } ヘッダー用の数 (5 分)
// 配られてから印が出るまでのずれを小さくする (記録の読み出しは D1 の 1 行で軽い。ページを続けて移る間の重複だけ省く)
const CACHE_MS = 5 * 60 * 1000;

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

/** 記録を読む。本人の分は適用の直後にも新しいものが要るので、ブラウザのキャッシュを使わない
 * @param {number | string} uid @returns {Promise<{ bits: string, updated: string | null } | null>} */
export async function fetchOwned(uid) {
  if (!SpspLogin.apiAvailable()) return null;
  try {
    const r = await fetch(SPSP_POST_CONFIG.GAS_ENDPOINT + '/titles?uid=' + encodeURIComponent(String(uid)) + '&lang=' + titleLang() + '&t=' + Date.now(),
                          { cache: 'no-store' });
    const j = r.ok ? await r.json() : null;
    return j && j.ok && typeof j.bits === 'string' ? { bits: j.bits, updated: j.updated || null } : null;
  } catch (e) { return null; }
}

/** @param {string} bits @param {number | string} uid @returns {string} */
export function newSince(bits, uid) {
  const seen = (readJson(SEEN_KEY) || {})[String(uid)];
  if (typeof seen !== 'string') return '';   // 初めて: 何も NEW にしない
  return bitsMinus(bits, seen);
}

/** @param {number | string} uid @param {string} bits */
export function markSeen(uid, bits) {
  const m = readJson(SEEN_KEY) || {};
  m[String(uid)] = bits;
  writeJson(SEEN_KEY, m);
  writeJson(CACHE_KEY, { uid: String(uid), n: 0, checked: Date.now() });
}

/** ヘッダー用: 本人の新しい二つ名の数。読めなければ 0 @param {number | string} uid @returns {Promise<number>} */
export async function checkNew(uid) {
  const c = readJson(CACHE_KEY);
  if (c && c.uid === String(uid) && Date.now() - Number(c.checked || 0) < CACHE_MS) return Number(c.n) || 0;
  const owned = await fetchOwned(uid);
  if (!owned) return 0;
  // 初めてなら今の持ち物を既読にしておく (以後に増えた分だけがお知らせになる)
  if (typeof (readJson(SEEN_KEY) || {})[String(uid)] !== 'string') markSeen(uid, owned.bits);
  const n = bitsCount(newSince(owned.bits, uid));
  writeJson(CACHE_KEY, { uid: String(uid), n, checked: Date.now() });
  return n;
}

const API = { fetchOwned, newSince, markSeen, checkNew };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTitleNotice = API;
export default API;
