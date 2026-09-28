// @ts-check
// char_emoji.js — キャラ絵文字の表 (data/char_emoji.json = { char_id: { name, emoji } })。2026-09-28 から表はフロント (spsp-web) が持つ。
//   表はサイトと一緒に配信する (SPSP.root + 'data/char_emoji.json')。データの置き場 (R2) の同名ファイルは旧サイト用で、見ない。
//   url()                    表の URL
//   load()                   表を 1 度だけ読む (Promise。読み込み時に自動で始める)。失敗しても null で解決する
//   emojiOf(charId)          キャラ ID → 絵文字 (表が未読込 / 無い ID は '')
//   rowEmoji(rec)            ランキング行のメインキャラ絵文字: main_char_id を表で引く
//                            (ビルドは絵文字を持たない。2026-09-29 に行の main_char_emoji を廃止し、表はここだけ)
const global = typeof window !== 'undefined' ? window : globalThis;

/** @type {Record<string, { name?: string, emoji?: string }> | null} */
var TABLE = null;
/** @type {Promise<Record<string, { name?: string, emoji?: string }> | null> | null} */
var PENDING = null;

export function url() {
  var S = /** @type {any} */ (global).SPSP || {};
  return (S.root || '') + 'data/char_emoji.json';
}

export function load() {
  if (TABLE) return Promise.resolve(TABLE);
  if (!PENDING) {
    PENDING = (typeof fetch === 'function' ? fetch(url()) : Promise.reject(new Error('no fetch')))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { TABLE = j && typeof j === 'object' ? j : null; return TABLE; })
      .catch(function () { PENDING = null; return null; });
  }
  return PENDING;
}

/** @param {number | string | null | undefined} charId */
export function emojiOf(charId) {
  if (charId == null || !TABLE) return '';
  var e = TABLE[String(charId)];
  return (e && e.emoji) || '';
}

/** @param {{ main_char_id?: number | string | null }} rec */
export function rowEmoji(rec) {
  return rec && rec.main_char_id != null ? emojiOf(rec.main_char_id) : '';
}

var api = { url: url, load: load, emojiOf: emojiOf, rowEmoji: rowEmoji };
/** @type {any} */ (global).SPSPCharEmoji = api;
(/** @type {any} */ (global).SPSP = /** @type {any} */ (global).SPSP || {}).charEmoji = api;
if (/** @type {any} */ (global).document) load();   // ページでは読み込み時に始める (ランキング表の描画までに読み終わる)
export default api;
