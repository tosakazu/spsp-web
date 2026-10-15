// @ts-check
// title_bits.js — 持っている二つ名のビット列 (D1 title_owned.bits、docs/card_titles_design.md「持っている二つ名の記録」)。
// ビット列 = 二つ名の通し番号 (id の 4 桁、ja-0001 → 1) を位置にしたもの。位置 n は (n >> 3) バイト目の (n & 7) ビット目 (下位から)。
// base64url (詰め物の = なし) の文字列で持つ。空 ("") = 何も持っていない。末尾の 0 のバイトは落とす (同じ中身なら同じ文字列)。
// 一覧 (js/titles.js) を読まないので、ヘッダーのお知らせ (js/title_notice.js) からも軽く使える。ページ・Worker・同期の道具で同じ関数

/** id の通し番号 (ja-0123 → 123)。形が違えば null @param {string | null | undefined} id @returns {number | null} */
export function titleNumber(id) {
  const m = /^[a-z]{2}-(\d{4})$/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
}

/** 通し番号 → id (123, 'ja' → ja-0123) @param {string} lang @param {number} n */
export function titleIdOf(lang, n) {
  return `${lang}-${String(n).padStart(4, '0')}`;
}

/** ビット列の形 (base64url・詰め物なし・maxBytes 以下)。空は正しい @param {unknown} bits @param {number} [maxBytes] */
export function bitsValid(bits, maxBytes = Infinity) {
  if (typeof bits !== 'string') return false;
  if (!/^[A-Za-z0-9_-]*$/.test(bits) || bits.length % 4 === 1) return false;
  return Math.floor(bits.length * 3 / 4) <= maxBytes;
}

/** @param {string} bits @returns {Uint8Array} */
function bitsBytes(bits) {
  const b64 = String(bits || '').replace(/-/g, '+').replace(/_/g, '/');
  if (!b64) return new Uint8Array(0);
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** @param {Uint8Array} bytes @returns {string} */
function bytesBits(bytes) {
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === 0) n--;
  let bin = '';
  for (let i = 0; i < n; i++) bin += String.fromCharCode(bytes[i]);
  return n ? btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
}

/** 通し番号の並びからビット列 @param {Iterable<number>} nums @returns {string} */
export function bitsFromNumbers(nums) {
  const xs = [...nums].filter(n => Number.isInteger(n) && n >= 0);
  const bytes = new Uint8Array(xs.length ? (Math.max(...xs) >> 3) + 1 : 0);
  for (const n of xs) bytes[n >> 3] |= 1 << (n & 7);
  return bytesBits(bytes);
}

/** id の並びからビット列 (形の違う id は無視) @param {Iterable<string>} ids @returns {string} */
export function bitsFromIds(ids) {
  /** @type {number[]} */
  const nums = [];
  for (const id of ids || []) { const n = titleNumber(id); if (n !== null) nums.push(n); }
  return bitsFromNumbers(nums);
}

/** ビット列にその id があるか @param {string} bits @param {string} id */
export function bitsHas(bits, id) {
  const n = titleNumber(id);
  if (n === null) return false;
  const bytes = bitsBytes(bits);
  return (n >> 3) < bytes.length && (bytes[n >> 3] & (1 << (n & 7))) !== 0;
}

/** 2 つのビット列の OR @param {string} a @param {string} b @returns {string} */
export function bitsOr(a, b) {
  const x = bitsBytes(a), y = bitsBytes(b);
  const out = new Uint8Array(Math.max(x.length, y.length));
  for (let i = 0; i < out.length; i++) out[i] = (x[i] || 0) | (y[i] || 0);
  return bytesBits(out);
}

/** a にあって b に無いもの (a AND NOT b) @param {string} a @param {string} b @returns {string} */
export function bitsMinus(a, b) {
  const x = bitsBytes(a), y = bitsBytes(b);
  const out = new Uint8Array(x.length);
  for (let i = 0; i < out.length; i++) out[i] = x[i] & ~(y[i] || 0);
  return bytesBits(out);
}

/** ビット列の通し番号 (昇順) @param {string} bits @returns {number[]} */
export function bitsNumbers(bits) {
  const bytes = bitsBytes(bits);
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < bytes.length; i++) for (let j = 0; j < 8; j++) if (bytes[i] & (1 << j)) out.push(i * 8 + j);
  return out;
}

/** ビット列の 1 の数 @param {string} bits */
export function bitsCount(bits) {
  return bitsNumbers(bits).length;
}

const API = { titleNumber, titleIdOf, bitsValid, bitsFromNumbers, bitsFromIds, bitsHas, bitsOr, bitsMinus, bitsNumbers, bitsCount };
// ほかの共通モジュールと同じく window にも置く
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTitleBits = API;
export default API;
