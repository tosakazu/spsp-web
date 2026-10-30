// @ts-check
// player_card_embed.js — プレイヤーページと同じプレイヤーカードを、ほかのページ (結果報告など) に置く (2026-10-30)。
//   mountPlayerCard(el, uid, opts)  el (.pcard を付ける) に uid のカードを描く。データ・設定・二つ名・フォントはプレイヤーページと同じ
//   cardDataOf(uid) / appliedOf(uid) 読んだものはページの中で使い回す (同じ選手を何度も読まない)
//   cardTitleOf(uid)                カードに出る二つ名の文字 (前半 + 後半、既定の「スマブラSPプレイヤー」も含む)。選手のデータが無ければ ''
//   mountNoDataCard(el, name)        SPSP にデータが無い人のカード (既定の見た目・名前だけ・NO DATA)
//   ensureCardFonts()               カードの Web フォント (IBM Plex Sans JP / Zalando Sans) を読む <link> を足す (p/index.html と同じもの)
// 見た目の CSS は css/player_card.css (ページの <head> で読む)。描くのは js/player_card.js の render (プレイヤーページと同じ)
import SPSPPlayerCard, { shownTitle } from './player_card.js';
import SPSPViews from './views.js';
import { buildCardModel, fetchAppliedCard, loadCardData, noDataCardModel } from './player_card_model.js';

/** p/index.html・p/edit.html と同じフォント (変えるときは 3 か所とも) */
export const CARD_FONTS_URL = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@500;600;700&family=Zalando+Sans+Expanded:wght@400;500;600&family=Zalando+Sans:ital,wght@0,500..900;1,900&display=swap';

export function ensureCardFonts() {
  if (typeof document === 'undefined' || document.querySelector(`link[href="${CARD_FONTS_URL}"]`)) return;
  for (const [href, cross] of [['https://fonts.googleapis.com', false], ['https://fonts.gstatic.com', true]]) {
    const p = document.createElement('link');
    p.rel = 'preconnect'; p.href = /** @type {string} */ (href);
    if (cross) p.crossOrigin = '';
    document.head.appendChild(p);
  }
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = CARD_FONTS_URL;
  document.head.appendChild(l);
}

/** @type {Map<string, Promise<any>>} */
const DATA = new Map();
/** @type {Map<string, Promise<any>>} */
const APPLIED = new Map();

/** カードのデータ (読めなければ null)。古い形の選手 JSON (display / ranks が無い) は、プレイヤーページと同じく表の行を rec にする
 * @param {string} uid */
export function cardDataOf(uid) {
  if (!DATA.has(uid)) {
    DATA.set(uid, (async () => {
      const d = await loadCardData(Number(uid));
      if (!d) return null;
      if (!(d.player && d.player.display && d.player.ranks)) {
        const row = (await SPSPViews.rowsByUids([Number(uid)], { plain: true }).catch(() => []))[0];
        if (!row) return null;
        d.rec = row;
      }
      return d;
    })().catch(() => null));
  }
  return /** @type {Promise<any>} */ (DATA.get(uid));
}

/** 適用済みのカードの設定と二つ名 (読めなければ null) @param {string} uid */
export function appliedOf(uid) {
  if (!APPLIED.has(uid)) APPLIED.set(uid, fetchAppliedCard(Number(uid)).catch(() => null));
  return /** @type {Promise<any>} */ (APPLIED.get(uid));
}

/** カードに出る二つ名の文字 (カードと同じ: 設定の二つ名、選んでいない側は地域の既定) @param {string} uid @returns {Promise<string>} */
export async function cardTitleOf(uid) {
  const [data, x] = await Promise.all([cardDataOf(uid), appliedOf(uid)]);
  if (!data) return '';
  const t = shownTitle(buildCardModel(data, x ? x.settings : null, x ? x.titleText : null));
  return t ? t.pre + t.post : '';
}

/**
 * el にカードを描く。プレイヤーページと同じく、設定は 2 秒まで待ち (遅ければ既定で描いて、届いたら描き直す)。
 * 戻り値: 描けたら true、選手のデータが無ければ false (el は触らない。呼ぶ側が「読み込めませんでした」などを出す)
 * @param {HTMLElement} el @param {string} uid
 */
export async function mountPlayerCard(el, uid) {
  ensureCardFonts();
  el.classList.add('pcard');
  const data = await cardDataOf(uid);
  if (!data || !el.isConnected) return !!data;
  const settingsP = appliedOf(uid);
  let drawn = false;
  const draw = (/** @type {any} */ x) => {
    if (!el.isConnected) return;
    drawn = true;
    SPSPPlayerCard.render(el, buildCardModel(data, x ? x.settings : null, x ? x.titleText : null));
  };
  const timer = setTimeout(() => { if (!drawn) draw(null); }, 2000);
  const x = await settingsP;
  clearTimeout(timer);
  if (!drawn || (x && x.settings)) draw(x);
  return true;
}

/** SPSP にデータが無い人のカード @param {HTMLElement} el @param {string} name */
export function mountNoDataCard(el, name) {
  ensureCardFonts();
  el.classList.add('pcard');
  SPSPPlayerCard.render(el, noDataCardModel(name));
}

export default { mountPlayerCard, mountNoDataCard, cardDataOf, appliedOf, cardTitleOf, ensureCardFonts, CARD_FONTS_URL };
