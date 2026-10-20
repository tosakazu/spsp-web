// @ts-check
// site/js/card_stickers.js — カードの裏面に貼る大会シールの設定 (カードの設定 back、2026-10-20〜)。表示 (js/player_card.js renderBack) と
// 編集 (src/pages/card_back_edit.js) で使う。サーバの検査 (worker/src/api/card.ts validateCardBack) と同じ規則
//   back = { stickers: Sticker[], text_top: 名前・二つ名・順位をシールの上に出すか, outline: その文字に縁取りを付けるか } | null
//   Sticker = { e: シールのキー, x, y: 中心 (カードの座標 514×333), s: 一辺, r: 回転 (度), k: 形, c: 切り取り (0.35〜1) }
//   シールのキー = "<大会キー>:<色 r|g|s|n>"。大会キー = event_id (下位クラスは "<親の event_id><クラスの文字 B〜E>")
//   絵は大会のアイコン (data/event_icons.json = { f: ファイル名の一覧, e: { event_id: f の番号 } }、tools/badges/build_event_icons.mjs)
import { SHAPES, CROP_MIN } from './holo_badge.js';

export const CARD_W = 514, CARD_H = 333;
/** 一辺の幅 (カードの px)。最大はカードの幅くらい */
export const S_MIN = 22, S_MAX = 520;
export const MAX_STICKERS = 30;
/** 色の記号 → holo_badge.js の variant (0 虹・1 金・2 銀・3 素) */
export const TIERS = /** @type {const} */ (['r', 'g', 's', 'n']);
export const STICKER_KEY = /^[1-9]\d{0,11}[A-E]?:[rgsn]$/;
export const IMG_BASE = 'https://data.spsp.games/images/tournament/h/';

/** @typedef {{ e: string, x: number, y: number, s: number, r: number, k: string, c: number }} Sticker */
/** @typedef {{ stickers: Sticker[], text_top: boolean, outline: boolean }} CardBack */

const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.max(lo, Math.min(hi, v));
/** 回転を -180〜180 に @param {number} r */
export const normRot = r => { const v = ((r + 180) % 360 + 360) % 360 - 180; return v === -180 ? 180 : v; };

/** 1 枚を正規化 (形が違えば null) @param {any} s @returns {Sticker | null} */
export function normSticker(s) {
  if (!s || typeof s !== 'object' || typeof s.e !== 'string' || !STICKER_KEY.test(s.e)) return null;
  const n = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
  const x = n(s.x), y = n(s.y), size = n(s.s), rot = n(s.r);
  if ([x, y, size, rot].some(Number.isNaN)) return null;
  return { e: s.e, x: r1(clamp(x, 0, CARD_W)), y: r1(clamp(y, 0, CARD_H)), s: r1(clamp(size, S_MIN, S_MAX)), r: r1(normRot(rot)),
           k: typeof s.k === 'string' && SHAPES[s.k] ? s.k : 'square', c: Math.round(clamp(Number.isFinite(s.c) ? s.c : 1, CROP_MIN, 1) * 100) / 100 };
}
/** 裏面の設定を正規化。何も無ければ (シール 0 枚・どちらも既定) null @param {any} b @returns {CardBack | null} */
export function normBack(b) {
  if (!b || typeof b !== 'object') return null;
  const seen = new Set();
  /** @type {Sticker[]} */
  const stickers = [];
  for (const s of Array.isArray(b.stickers) ? b.stickers : []) {
    const t = normSticker(s);
    if (t && !seen.has(t.e) && stickers.length < MAX_STICKERS) { seen.add(t.e); stickers.push(t); }
  }
  const back = { stickers, text_top: b.text_top === true, outline: b.outline === true };
  return stickers.length || back.text_top || back.outline ? back : null;
}

/** シールのキー → { 大会の event_id (下位クラスは親), クラスの文字, variant } @param {string} e */
export function parseKey(e) {
  const m = /^(\d+)([A-E]?):([rgsn])$/.exec(e);
  if (!m) return null;
  return { eid: Number(m[1]), cls: m[2] || null, variant: TIERS.indexOf(/** @type {any} */ (m[3])) };
}

/** @type {{ f: string[], e: Record<string, number> } | null} */
let icons = null;
/** @type {Promise<{ f: string[], e: Record<string, number> } | null> | null} */
let iconsP = null;
/** 大会 → アイコンの表 (読み込み済みなら同期で) */
export const iconsNow = () => icons;
/** 大会 → アイコンの表を読む (1 回だけ)。サイトの配信ファイル (SPSP.root) @returns {Promise<{ f: string[], e: Record<string, number> } | null>} */
export function loadIcons() {
  if (!iconsP) {
    iconsP = fetch(/** @type {any} */ (globalThis).SPSP.root + 'data/event_icons.json')
      .then(r => (r.ok ? r.json() : null)).then(j => (icons = j && j.f && j.e ? j : null)).catch(() => null);
  }
  return iconsP;
}
/** 大会の event_id → アイコンの URL (無ければ null) @param {number} eid @param {{ f: string[], e: Record<string, number> } | null} [tbl] */
export function iconUrl(eid, tbl = icons) {
  const k = tbl ? tbl.e[String(eid)] : undefined;
  return k != null && tbl && tbl.f[k] ? IMG_BASE + tbl.f[k] : null;
}

// シールの影を消して見比べる (?shadow=0、プレイヤーページ・カード編集とも。見た目の確認用で保存しない)
try { if (new URLSearchParams(location.search).get('shadow') === '0') document.documentElement.classList.add('no-sticker-shadow'); } catch (e) { /* 無視 */ }

export default { CARD_W, CARD_H, S_MIN, S_MAX, MAX_STICKERS, TIERS, STICKER_KEY, IMG_BASE, normRot, normSticker, normBack, parseKey, iconsNow, loadIcons, iconUrl };
