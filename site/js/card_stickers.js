// @ts-check
// site/js/card_stickers.js — カードの裏面に貼る大会シールの設定 (カードの設定 back、2026-10-20〜)。表示 (js/player_card.js renderBack) と
// 編集 (src/pages/card_back_edit.js) で使う。サーバの検査 (worker/src/api/card.ts validateCardBack) と同じ規則
//   back = { stickers: Sticker[], text_top: 名前・二つ名・順位をシールの上に出すか, outline: その文字に影を付けるか (前は縁取り。設定の名前はそのまま) } | null
//   Sticker = { e: シールのキー, x, y: 中心 (カードの座標 514×333), s: 一辺, r: 回転 (度), k: 形, c: 切り取り (0.35〜1) }
//   シールのキー = "<大会キー>:<色 r|g|s|n>"。大会キー = event_id (下位クラスは "<親の event_id><クラスの文字 B〜E>")
//   持っているシール = 選手の大会記録の sticker (ビルドの spsp/stickers.py。もらった一番上の色。下の色は全部持っている)。ownedStickers
//   絵は大会のアイコン (データの data/event_icons.json = { f: ファイル名の一覧, e: { event_id: f の番号 } }。
//   ビルドの deploy/build_event_icons.py が毎回作る)
import { SHAPES, CROP_MIN } from './holo_badge.js';

export const CARD_W = 514, CARD_H = 333;
/** 一辺の幅 (カードの px)。最大はカードの幅くらい */
export const S_MIN = 22, S_MAX = 520;
export const MAX_STICKERS = 50;
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
    const S = /** @type {any} */ (globalThis).SPSP;
    const get = (/** @type {string} */ base) => fetch(base + 'data/event_icons.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    // データ (R2、ビルドが作る) に無ければ、サイトに置いた表 (preview だけ、公開前の確認用) を使う
    iconsP = get(S.data).then(j => (j && j.f && j.e ? j : S.root !== S.data ? get(S.root) : null))
      .then(j => (icons = j && j.f && j.e ? j : null)).catch(() => null);
  }
  return iconsP;
}
/** 大会記録の色の名前 (ビルドの sticker) → 色の記号 */
const TIER_OF_NAME = /** @type {Record<string, string>} */ ({ rainbow: 'r', gold: 'g', silver: 's', normal: 'n' });
/** 大会記録 → 大会キー (下位クラスの仮想大会は event_id が無いので親の event_id + クラスの文字) @param {any} t */
export const tourKey = t => (t && t.event_id ? String(t.event_id) : t && t.parent_event_id && t.class_letter ? `${t.parent_event_id}${t.class_letter}` : '');
/** 選手の大会記録 → 持っているシール { 大会キー: 一番上の色の記号 r|g|s|n } @param {any[]} tours @returns {Record<string, string>} */
export function ownedStickers(tours) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const t of tours || []) {
    const c = t && TIER_OF_NAME[t.sticker];
    const k = c ? tourKey(t) : '';
    if (!k) continue;
    if (!out[k] || TIERS.indexOf(/** @type {any} */ (c)) < TIERS.indexOf(/** @type {any} */ (out[k]))) out[k] = c;
  }
  return out;
}
/** 選手の大会記録に大会シールの判定が入っているか (ビルドに入る前は無い) @param {any[]} tours */
export const hasStickerData = tours => (tours || []).some(t => t && 'sticker' in t);
/** 持っているシール。大会記録に判定が無ければ (ビルドに入る前)、preview のビルドだけが置くプレビュー用の判定
 * (サイトの data/stickers_preview/<uid % 64>.json = {uid: {大会キー: r|g|s|n}}) から。どちらも無ければ空
 * @param {number} uid @param {any[]} tours @returns {Promise<Record<string, string>>} */
export async function loadOwnedStickers(uid, tours) {
  if (hasStickerData(tours)) return ownedStickers(tours);
  try {
    const r = await fetch(/** @type {any} */ (globalThis).SPSP.root + `data/stickers_preview/${uid % 64}.json`);
    const j = r.ok ? await r.json() : null;
    return (j && j[String(uid)]) || {};
  } catch (e) { return {}; }
}
/** 持っているシールか (一番上の色以下なら持っている) @param {Record<string, string>} owned @param {string} e シールのキー */
export function isOwned(owned, e) {
  const i = e.lastIndexOf(':');
  const top = owned[e.slice(0, i)];
  return !!top && TIERS.indexOf(/** @type {any} */ (e.slice(i + 1))) >= TIERS.indexOf(/** @type {any} */ (top));
}

/** 大会の event_id → アイコンの URL (無ければ null) @param {number} eid @param {{ f: string[], e: Record<string, number> } | null} [tbl] */
export function iconUrl(eid, tbl = icons) {
  const k = tbl ? tbl.e[String(eid)] : undefined;
  return k != null && tbl && tbl.f[k] ? IMG_BASE + tbl.f[k] : null;
}

export default { CARD_W, CARD_H, S_MIN, S_MAX, MAX_STICKERS, TIERS, STICKER_KEY, IMG_BASE, normRot, normSticker, normBack, parseKey, tourKey, ownedStickers, hasStickerData, loadOwnedStickers, isOwned, iconsNow, loadIcons, iconUrl };
