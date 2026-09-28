// @ts-check
// url_key.js — URL クエリに載せる ASCII のキー (2026-09-24、日本語 URL をやめる: docs/frontend_i18n_review.md §6-4)。
//   asciiSlug(s)       NFKC → 小文字 → 英数字以外の連続を '-' → 両端の '-' を除去。結果が [a-z0-9-] だけなら返す、そうでなければ ''
//   hashKey(s)         '_' + FNV-1a 32bit の base36 (例 '_1x9k2p')。slug は '_' を含まないので衝突しない
//   nameKey(s)         asciiSlug(s) があればそれ、無ければ hashKey(s)。大会シリーズの ?series= に使う
// 旧 URL (?pref=東京都 / ?series=シカブラ) はページ側が名前でも引けるようにして、読めたら replaceState で新しいキーに書き換える。

/** @param {string} s @returns {string} */
export function asciiSlug(s) {
  var t = String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return /^[a-z0-9-]+$/.test(t) ? t : '';
}

/** @param {string} s @returns {string} */
export function hashKey(s) {
  var h = 0x811c9dc5;
  var str = String(s || '');
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return '_' + h.toString(36);
}

/** @param {string} s @returns {string} */
export function nameKey(s) { return asciiSlug(s) || hashKey(s); }

/** 今の URL の param を key に書き換える (履歴は増やさない)。同じなら何もしない。
 *  @param {string} param @param {string} key */
export function canonicalizeParam(param, key) {
  try {
    var url = new URL(location.href);
    if (url.searchParams.get(param) === key) return;
    url.searchParams.set(param, key);
    history.replaceState(history.state, '', url.toString());
  } catch (_) { /* 古いブラウザ・テスト環境では URL をそのままにする */ }
}

var api = { asciiSlug: asciiSlug, hashKey: hashKey, nameKey: nameKey, canonicalizeParam: canonicalizeParam };
var global = typeof window !== 'undefined' ? window : globalThis;
global.SPSPUrlKey = api;
(global.SPSP = global.SPSP || {}).urlKey = api;
export default api;
