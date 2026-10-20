// @ts-check
// player_card.js — プレイヤーページ最上部の選手カード (Figma「submit」: 514×333 の 1 枚絵を再現、2026-09-29)。
//   render(el, model)  model (下の PCardModel) からカードを組み立てて el に入れる。長い名前・大会名・大きい順位は文字サイズを詰め、
//                      名前と大会名は必要なら 2 行にする (fit* 関数)。フォント読み込み後にもう一度詰め直す
//   カードは 514×333 の座標系で描き、表示幅に合わせて transform: scale で縮める (css/player_card.css)
//   renderBack(el, model) 裏面 (Figma「back」: 二つ名・名前・総合順位。実績のバッジを貼る面)
//   capture(el)          カードだけを PNG にする (保存・共有。表でも裏でも el に描いた面)
//   makeAchFitTester(m)  編集ページ用: 実績の並び (選んだ順) がカードに入りきるかを確かめる
//   COLORS / TEMPLATES   カードの色 (Figma の色違い) とテンプレート (今は 1 種類)
import { escapeHtml } from './html.js';
import { renderBadge, isTransparent, badgeToCanvas, preloadBadge } from './holo_badge.js';
import { parseKey, iconUrl, iconsNow, loadIcons } from './card_stickers.js';

const W = 514;   // デザインの幅 (px)。高さは 333 (CSS の aspect-ratio)

/** カードの色 (Figma「work」ページの色違い Frame 18〜21・34・36・41 と「submit」の赤)。変えるのはアクセント色 (--pc-red) だけ */
export const COLORS = [
  { id: 'red', hex: '#df1b1b' },
  { id: 'blue', hex: '#1b25df' },
  { id: 'green', hex: '#1ca01e' },
  { id: 'purple', hex: '#ac17ec' },
  { id: 'orange', hex: '#fa7d00' },
  { id: 'teal', hex: '#04b6aa' },
  { id: 'yellow', hex: '#ffc800' },
  { id: 'gray', hex: '#6b6b70' },
];
/** テンプレート (今は Figma「submit」の 1 種類) */
export const TEMPLATES = [{ id: 'standard' }];
/** @param {string | undefined} id */
const colorHex = id => (COLORS.find(c => c.id === id) || COLORS[0]).hex;

/** @typedef {{ name: string, href?: string, rank?: number | null, main?: boolean, emoji?: string }} PCardChar */
/** @typedef {{ label: string }} PCardAch */
/** @typedef {{ name: string, href?: string, date?: string, place?: number | null, placeUnit: string, nent?: number | null, dq?: boolean,
 *              perfRank?: number | null, perfLv?: string, perfLvNum?: number, rankBefore?: number | null, rankAfter?: number | null }} PCardLatest */
/** achMode: 'auto' = 上位 3 つを 1 行ずつ + 隙間埋め (既定) / 'manual' = achievements を選んだ順に行へ詰める (編集ページで選んだとき)
 * title = 二つ名 (前半・後半の文字。'' = なし (空欄)、null と title 自体が無いときは地域の既定。無くても名前の位置は同じ)
 * nameLatin = 裏面に出す英字の名前 (js/latin_name.js。無ければ name)
 * @typedef {{ name: string, nameLatin?: string, title?: { pre: string | null, post: string | null } | null, loc?: { text: string, href?: string, rank?: number | null } | null, evalDate?: string, chars: PCardChar[],
 *              color?: string, achMode?: 'auto' | 'manual',
 *              rank: number | null, pills: { text: string, title?: string }[], achievements: PCardAch[], latest?: PCardLatest | null,
 *              totalTournaments: number, totalMatches: number, back?: import('./card_stickers.js').CardBack | null,
 *              labels: { evalDate: string, achievements: string, latest: string, overall: string, national: string, equivalent: string, noAch: string } }} PCardModel */

// 数字・英字・記号の並びは欧文フォント (Zalando Sans) で組む (デザインの「Lv.5」「UF 10」「#3」と同じ)
// 「!」「?」も含める (「Fly High!」の ! だけ和文フォントで浮いて見えた)
const LATIN_RUN = /[0-9A-Za-z#.+\-/!?]+(?:[ ][0-9A-Za-z#.+\-/!?]+)*/g;
/** @param {string} s @param {string} cls */
/** 二つ名を選んでいないときにカードに出す二つ名 (region/config.js titleDefault)。無ければ null
 * @returns {{ pre: string, post: string } | null} */
export function defaultTitle() {
  const S = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis).SPSP;
  const d = S && S.site && S.site.titleDefault;
  return d && (d.pre || d.post) ? { pre: d.pre || '', post: d.post || '' } : null;
}

function latinRuns(s, cls) {
  let out = '', last = 0;
  s.replace(LATIN_RUN, (m, off) => {
    // 数字だけの並び (「691」「1」) には pc-num も付ける (実績の札では数字だけの並びと英字を含む並びで下げ幅が違う。player_card.css)
    // 数字だけの並びには pc-num、そのうち後ろが空白か終わり (「1 試合以上」「から 691 日」) には pc-num-sp も付ける (画像にしたときの高さが違う。player_card.css)
    const num = /^[0-9][0-9,]*$/.test(m);
    const sp = num && /^(\s|$)/.test(s.slice(off + m.length));
    out += escapeHtml(s.slice(last, off)) + `<span class="${cls}${num ? ' pc-num' : ''}${sp ? ' pc-num-sp' : ''}">${escapeHtml(m)}</span>`;
    last = off + m.length;
    return m;
  });
  return out + escapeHtml(s.slice(last));
}

// 実績の先頭の絵文字 (「🏆 篝火#15 優勝」の 🏆) を分ける。無ければ ''
const LEAD_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier}|[♀♂])*)\s*/u;
/** @param {string} label */
function splitEmoji(label) {
  const m = LEAD_EMOJI.exec(label);
  return m ? { emoji: m[1], text: label.slice(m[0].length) } : { emoji: '', text: label };
}

/** @param {string} href @param {string} inner @param {string} cls */
function maybeLink(href, inner, cls) {
  return href ? `<a class="${cls}" href="${escapeHtml(href)}">${inner}</a>` : `<span class="${cls}">${inner}</span>`;
}

const PIN_SVG = '<svg class="pc-pin" viewBox="0 0 10 15" aria-hidden="true"><path fill-rule="evenodd" d="M5 0C2.24 0 0 2.2 0 4.93 0 8.6 5 15 5 15s5-6.4 5-10.07C10 2.2 7.76 0 5 0Zm0 7.1a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2Z"/></svg>';
const ARROW_SVG = '<svg class="pc-arrow" viewBox="0 0 12 4.33" aria-hidden="true"><path d="M0 1.77h8.6V0L12 2.165 8.6 4.33V2.56H0z"/></svg>';

/** @param {PCardAch} a */
function achPill(a) {
  const { emoji, text } = splitEmoji(a.label);
  return `<span class="pc-ach-pill">${emoji ? `<span class="pc-ach-emoji">${escapeHtml(emoji)}</span>` : ''}<span class="pc-ach-text" data-text="${escapeHtml(text)}">${latinRuns(text, 'pc-lat')}</span></span>`;
}

// 実績の札の後ろの「結果」(準優勝 × 2 / 優勝 ×3 / 4位 / Top 8 以上 …)。長すぎるときもここは残し、前 (大会名など) を「…」で縮める
const ACH_TAIL = /\s+(\S+\s*[×x]\s*\d+|Top\s*\d+\s*\S*|\S+)$/;
/** 札を行の幅に収める: まず文字を 8px まで小さくし、それでも入らなければ大会名などの後ろを「…」で切る (結果の部分は残す)。入ったら true
 * @param {HTMLElement} p @param {number} maxW */
function fitPill(p, maxW) {
  // 札には max-width があり、はみ出しが幅に出ないことがあるので、測る間は外す (本来の幅で測る)
  p.style.maxWidth = 'none';
  try { return fitPillInner(p, maxW); } finally { p.style.maxWidth = ''; }
}
/** @param {HTMLElement} p @param {number} maxW */
function fitPillInner(p, maxW) {
  if (fitWidth(p, maxW, 10, 8)) return true;
  const span = /** @type {HTMLElement | null} */ (p.querySelector('.pc-ach-text'));
  const text = span ? span.getAttribute('data-text') || '' : '';
  const m = ACH_TAIL.exec(text);
  if (!span || !m) return false;
  const head = text.slice(0, m.index), tail = m[1];
  for (let n = head.length - 1; n >= 1; n--) {
    span.innerHTML = latinRuns(head.slice(0, n).replace(/\s+$/, '') + '… ' + tail, 'pc-lat');
    if (Math.max(p.scrollWidth, p.offsetWidth) <= maxW + 0.5) return true;
  }
  return false;
}

/** 二つ名「// 前半 後半」(Figma ver.1.5) の HTML。無ければ ''。表記は一覧のまま (表示の言語では変えない)。表と裏で同じ
 * 二つ名を選んでいない側 (前半・後半ごと、値 'default') は地域の既定 (region/config.js titleDefault、「スマブラSP」「プレイヤー」)。既定の無い地域 (北米) は空のまま
 * @param {PCardModel} m @param {string} cls */
function titleHtml(m, cls) {
  const def = defaultTitle() || { pre: '', post: '' };
  // 文字が null の側 (と、設定の無いとき = title null) は既定、'' の側は「なし」(空欄)
  const pre = m.title && m.title.pre != null ? m.title.pre : def.pre;
  const post = m.title && m.title.post != null ? m.title.post : def.post;
  if (!pre && !post) return '';
  return `<div class="${cls}"><span class="pc-title-sl">//</span>${
    pre ? `<span class="pc-title-pre">${escapeHtml(pre)}</span>` : ''}${post ? `<span class="pc-title-post">${escapeHtml(post)}</span>` : ''}</div>`;
}

/** @param {PCardModel} m */
function cardHtml(m) {
  const L = m.labels;
  const loc = m.loc
    ? `<div class="pc-loc">${PIN_SVG}${maybeLink(m.loc.href || '', escapeHtml(m.loc.text), 'pc-loc-name')}${
        m.loc.rank != null ? `<span class="pc-loc-rank">#${m.loc.rank}</span>` : ''}</div>`
    : '';
  const chars = m.chars.slice(0, 2).map(c =>
    `<div class="pc-char${c.main ? ' main' : ''}">${c.emoji ? `<span class="pc-char-emoji">${escapeHtml(c.emoji)}</span>` : '<span class="pc-char-sq"></span>'}${maybeLink(c.href || '', escapeHtml(c.name), 'pc-char-name')}${
      c.main && c.rank != null ? `<span class="pc-char-rank">#${c.rank}</span>` : ''}</div>`).join('');
  // 実績 (fitAll が置く。ここでは控えに入れておく):
  //   auto   = 上位 3 つを 1 行ずつ (右揃え) に置き、4 つ目以降は入る行の左の隙間に詰める
  //   manual = 選んだ順に、今の行の左へ足していき、入らなければ次の行へ (3 行まで)
  const ach = !m.achievements.length ? `<span class="pc-ach-none">${escapeHtml(L.noAch)}</span>`
    : m.achMode === 'manual' ? `<div class="pc-ach-spare pc-ach-manual">${m.achievements.map(achPill).join('')}</div>`
    : m.achievements.slice(0, 3).map(a => `<div class="pc-ach-row">${achPill(a)}</div>`).join('') +
      `<div class="pc-ach-spare">${m.achievements.slice(3).map(achPill).join('')}</div>`;
  const t = m.latest;
  let latest = '';
  if (t) {
    const placeHtml = t.dq ? '<span class="pc-place-num">DQ</span>'
      : `<span class="pc-place-num">${t.place != null ? t.place : '—'}</span><span class="pc-place-unit">${escapeHtml(t.placeUnit)}</span>`;
    const perf = t.perfRank != null
      ? `<div class="pc-perf-lbl">Performance</div>${t.perfLv ? `<span class="pc-perf-lv">${escapeHtml(t.perfLv)}</span>` : ''}
         <div class="pc-perf"><span class="pc-sm">${escapeHtml(L.national)}</span><span class="pc-perf-num">${t.perfRank}</span><span class="pc-sm">${escapeHtml(t.placeUnit)}</span><span class="pc-sm pc-perf-eq">${escapeHtml(L.equivalent)}</span></div>`
      : '';
    const upd = t.rankBefore != null && t.rankAfter != null
      ? `<div class="pc-upd-lbl">Rank Update</div>
         <div class="pc-upd"><span class="pc-upd-h">#</span><span class="pc-upd-num">${t.rankBefore}</span>${ARROW_SVG}<span class="pc-upd-h">#</span><span class="pc-upd-num">${t.rankAfter}</span></div>`
      : '';
    latest = `<div class="pc-label pc-latest-lbl">${escapeHtml(L.latest)}</div>
      <div class="pc-latest-date">${escapeHtml(t.date || '')}</div>
      <div class="pc-tour">${maybeLink(t.href || '', latinRuns(t.name, 'pc-lat'), 'pc-tour-a')}</div>
      <div class="pc-place"><div class="pc-place-row">${placeHtml}</div>${t.nent != null ? `<div class="pc-place-n">/${t.nent}</div>` : ''}</div>
      ${perf || upd ? '<div class="pc-vbar"></div>' : ''}
      <div class="pc-perf-box">${perf}${upd}</div>`;
  }
  const title = titleHtml(m, 'pc-title');
  const hasTitle = !!title;
  const pills = m.pills.map(p => `<span class="pc-pill"${p.title ? ` title="${escapeHtml(p.title)}"` : ''}>${escapeHtml(p.text)}</span>`).join('');
  return `<div class="pc-in" style="--pc-red:${colorHex(m.color)}">
    <div class="pc-head${hasTitle ? ' pc-titled' : ''}">
      ${title}
      ${loc}
      <div class="pc-name"><span class="pc-name-t">${escapeHtml(m.name)}</span></div>
      <div class="pc-chars">${chars}</div>
    </div>
    <div class="pc-ach"><div class="pc-label">${escapeHtml(L.achievements)}</div><div class="pc-ach-list">${ach}</div></div>
    <div class="pc-latest">${latest}</div>
    <div class="pc-overall">
      <div class="pc-bgword">Overall<br>Rank</div>
      <div class="pc-overall-lbl">${escapeHtml(L.overall)}</div>
      <div class="pc-date"><span class="pc-date-lbl">${escapeHtml(L.evalDate)}</span><span class="pc-date-v">${escapeHtml(m.evalDate || '')}</span></div>
      <div class="pc-url">${escapeHtml(siteUrlLabel())}</div>
      <div class="pc-pills">${pills}</div>
      <div class="pc-big"><span class="pc-big-h">#</span><span class="pc-big-n">${m.rank != null ? m.rank : '—'}</span></div>
      <div class="pc-tot pc-tot-t"><span class="pc-tot-lbl">Total Tournaments</span><span class="pc-tot-line"></span><span class="pc-tot-v">${m.totalTournaments.toLocaleString('en-US')}</span></div>
      <div class="pc-tot pc-tot-m"><span class="pc-tot-lbl">Total Matches</span><span class="pc-tot-line"></span><span class="pc-tot-v">${m.totalMatches.toLocaleString('en-US')}</span></div>
    </div>
  </div>`;
}

/** 裏面 (Figma「back」: 赤地に角の欠けた枠、中央に二つ名・英字の名前・総合順位)。実績のバッジはこの上に貼る (これから)
 * @param {PCardModel} m */
function backHtml(m) {
  const title = titleHtml(m, 'pcb-title');
  // 裏面のシール (js/card_stickers.js)。置き場所だけ書き、絵 (ホロ) は組み立てたあとに paintBackStickers で。
  // 名前・二つ名・順位をシールの上に出すときは、シールの層を文字の列より前 (下) に置く
  const b = m.back;
  const st = b && b.stickers.length ? `<div class="pcb-st">${b.stickers.map((s, i) =>
    `<div class="pcb-sk" data-i="${i}" data-x="${s.x}" data-y="${s.y}" data-s="${s.s}" data-r="${s.r}" style="left:${s.x}px;top:${s.y}px;width:${s.s}px;height:${s.s}px;transform:translate(-50%,-50%) rotate(${s.r}deg)"></div>`).join('')}</div>` : '';
  const col = `<div class="pcb-col">
      ${title}
      <div class="pcb-name"><span class="pcb-name-t">${escapeHtml(m.nameLatin || m.name)}</span></div>
      <div class="pcb-rank"><span class="pcb-rank-h">#</span><span class="pcb-rank-n">${m.rank != null ? m.rank : '—'}</span></div>
    </div>`;
  return `<div class="pc-in pc-back${b && b.outline ? ' pcb-outline' : ''}" style="--pc-red:${colorHex(m.color)}">
    <span class="pcb-line pcb-t"></span><span class="pcb-line pcb-b"></span><span class="pcb-line pcb-l"></span><span class="pcb-line pcb-r"></span>
    ${b && b.text_top ? st + col : col + st}
  </div>`;
}

// ── 文字サイズの自動調整 (スケール前の 514×333 座標で測る。transform は scrollWidth に影響しない) ──
/** 1 行のまま幅に収まるまで font-size を下げる。収まったら true
 * @param {HTMLElement} el @param {number} maxW @param {number} maxPx @param {number} minPx */
function fitWidth(el, maxW, maxPx, minPx) {
  // 幅は scrollWidth (固定幅の箱からのはみ出し) と offsetWidth (中身に合わせて伸びる箱) の大きい方
  const width = () => Math.max(el.scrollWidth, el.offsetWidth);
  let s = maxPx;
  el.style.fontSize = s + 'px';
  while (width() > maxW + 0.5 && s > minPx) { s = Math.max(minPx, s - 0.5); el.style.fontSize = s + 'px'; }
  return width() <= maxW + 0.5;
}
/** 1 行で minPx まで下げても収まらなければ、2 行に折り返して高さに収まるまで下げる。高さは inner (折り返す子) で測る
 * @param {HTMLElement} el @param {number} maxW @param {number} maxH @param {number} maxPx @param {number} min1 @param {number} min2
 * @param {HTMLElement} [inner] */
function fitTwoLines(el, maxW, maxH, maxPx, min1, min2, inner) {
  el.classList.remove('pc-wrap');
  if (fitWidth(el, maxW, maxPx, min1)) return;
  el.classList.add('pc-wrap');
  let s = min1;
  el.style.fontSize = s + 'px';
  // 高さは中身 (2 行に切った子) で測る: 箱は下揃え・中央揃えなので、上へのはみ出しは scrollHeight に出ない
  inner = inner || /** @type {HTMLElement} */ (el.firstElementChild || el);
  while (inner.offsetHeight > maxH + 0.5 && s > min2) { s = Math.max(min2, s - 0.5); el.style.fontSize = s + 'px'; }
}

/** 名前を 2 行に分ける。切る場所は真ん中にいちばん近い区切り (空白・「/」「・」)、無ければ単語の境目
 * (Intl.Segmenter。「ポケモン|トレーナー」「パックン|フラワー」)。どちらも無ければ null (1 行のまま詰める)
 * @param {string} s @returns {[string, string] | null} */
function splitTwo(s) {
  const mid = s.length / 2;
  /** @param {number[]} cands */
  const nearest = cands => cands.reduce((best, i) => (best < 0 || Math.abs(i - mid) < Math.abs(best - mid) ? i : best), -1);
  const seps = [];
  for (let i = 1; i < s.length - 1; i++) if (/[ /・]/.test(s[i])) seps.push(i);
  const sep = nearest(seps);
  // 空白は落とし、「/」「・」は 1 行目の終わりに残す
  if (sep > 0) return s[sep] === ' ' ? [s.slice(0, sep), s.slice(sep + 1)] : [s.slice(0, sep + 1), s.slice(sep + 1)];
  const Seg = /** @type {any} */ (Intl).Segmenter;
  if (typeof Seg !== 'function') return null;
  const bounds = [];
  for (const seg of new Seg('ja', { granularity: 'word' }).segment(s)) if (seg.index > 0) bounds.push(seg.index);
  const cut = nearest(bounds);
  return cut > 0 ? [s.slice(0, cut), s.slice(cut)] : null;
}

/** @param {HTMLElement} root */
function fitAll(root) {
  const q = (/** @type {string} */ sel) => /** @type {HTMLElement | null} */ (root.querySelector(sel));
  const title = q('.pc-title');
  if (title) {
    // 二つ名は 1 行で、右上の地域の手前 (10px あける) まで。地域が無ければカードの右端の手前まで
    const loc = q('.pc-loc');
    const maxW = (loc ? loc.offsetLeft : W - 12) - title.offsetLeft - 10;
    fitWidth(title, Math.max(120, maxW), 16, 9);
  }
  const name = q('.pc-name');
  // 名前の箱は二つ名の欄の下から (高さ 53.6、二つ名が無くても同じ位置)。2 行にしても二つ名に重ならない高さまで
  if (name) fitTwoLines(name, 377, 52, 43, 26, 14);
  const tour = q('.pc-tour');
  if (tour) fitTwoLines(tour, 207, 34, 18, 13, 9);
  const big = q('.pc-big');
  if (big) fitWidth(big, 262, 91, 30);
  const place = q('.pc-place-row');
  if (place) fitWidth(place, 86, 30, 12);
  const upd = q('.pc-upd');
  if (upd) fitWidth(upd, 106, 15, 8);
  const perf = q('.pc-perf');
  if (perf) fitWidth(perf, 106, 15, 8);
  const pills = q('.pc-pills');
  if (pills) fitWidth(pills, 186, 18, 9);
  // キャラ名は 14px (Figma ver.1.5) から 10px まで詰めて、それでも入らなければ 2 行にして 12px から詰め直す (「MR. GAME & WATCH」「ポケモン/トレーナー」)。
  // 2 行のキャラがあって帯の下にはみ出すなら、キャラの列を上へずらす (右上の地域の下まで)
  // 折り返しは自分で改行を入れる (CSS の折り返しだと名前の箱が最大幅のままになり、■ と文字が離れる)
  //   切れ目の無い名前 (「ドンキーコング」) は 1 行のまま 8px まで詰める。
  //   2 つとも 2 行で帯に入りきらないときは、2 つ目 (サブキャラ) を 1 行に戻す
  const charEls = /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll('.pc-char')));
  /** @type {{ el: HTMLElement, nameEl: HTMLElement, text: string }[]} */
  const wrapped = [];
  for (const c of charEls) {
    const nameEl = /** @type {HTMLElement | null} */ (c.querySelector('.pc-char-name'));
    if (!nameEl || fitWidth(c, 108, 14, 10)) continue;
    const text = nameEl.textContent || '';
    const parts = splitTwo(text);
    if (!parts) { fitWidth(c, 108, 10, 8); continue; }
    nameEl.innerHTML = escapeHtml(parts[0]) + '<br>' + escapeHtml(parts[1]);
    c.classList.add('pc-wrap');
    fitWidth(c, 108, 12, 8);   // 2 行にしたら 12px から詰め直す
    wrapped.push({ el: c, nameEl, text });
  }
  const chars = q('.pc-chars');
  if (chars) {
    const MAX_H = 85 - 33;   // 地域の下 (33) から帯の下 (89) の少し上まで
    if (chars.offsetHeight > MAX_H && wrapped.length > 1) {
      const last = /** @type {{ el: HTMLElement, nameEl: HTMLElement, text: string }} */ (wrapped[wrapped.length - 1]);
      last.nameEl.textContent = last.text;
      last.el.classList.remove('pc-wrap');
      fitWidth(last.el, 108, 10, 7);
    }
    // メインとサブで文字の大きさがちぐはぐにならないよう、小さい方に揃える
    const sizes = charEls.map(c => parseFloat(c.style.fontSize) || 14);
    const common = Math.min(...sizes);
    charEls.forEach(c => { c.style.fontSize = common + 'px'; });
    chars.style.top = Math.max(33, Math.min(45, 85 - chars.offsetHeight)) + 'px';
  }
  // 実績: 上位 3 つは 1 行ずつ (長ければ詰める)。控え (4 つ目以降) は優先度の高い順に、入る行の左の隙間へ入れる。入らないものは出さない
  const list = q('.pc-ach-list');
  if (list && list.querySelector('.pc-ach-manual')) placeManual(list);
  else if (list) placeAuto(list);
  if (list) finishAch(list);
}

/** 裏面の詰め: 名前は 45px (Figma) から 36px まで 1 行で詰め、入らなければ区切り (「/」・空白・単語の境目) で 2 行にして
 * 39px (Figma の 2 行の例) から詰める (どちらも 7px まで。区切りの無い長い名前は 1 行のまま小さくなる)。二つ名・順位も枠の内側 (445px) に収める
 * @param {HTMLElement} root */
function fitBack(root) {
  const q = (/** @type {string} */ sel) => /** @type {HTMLElement | null} */ (root.querySelector(sel));
  const title = q('.pcb-title');
  if (title) fitWidth(title, 445, 16, 9);
  const name = q('.pcb-name');
  const nameT = q('.pcb-name-t');
  if (name && nameT && !fitWidth(name, 445, 45, 36)) {
    const text = nameT.textContent || '';
    const parts = splitTwo(text);
    if (parts) {
      nameT.innerHTML = escapeHtml(parts[0]) + '<br>' + escapeHtml(parts[1]);
      name.classList.add('pc-wrap');
      fitWidth(name, 445, 39, 7);
    } else fitWidth(name, 445, 36, 7);   // 45 文字 (英字名の上限) の「WWW…」でも枠に収まる (約 8px)
  }
  const rank = q('.pcb-rank');
  if (rank) fitWidth(rank, 445, 29, 14);
}

/** 上位 3 つは 1 行ずつ (長ければ詰める)。控え (4 つ目以降) は優先度の高い順に、入る行の左の隙間へ入れる。入らないものは出さない
 * @param {HTMLElement} list */
function placeAuto(list) {
  {
    const ROW_W = 206, GAP = 3;
    const rows = /** @type {HTMLElement[]} */ (Array.from(list.querySelectorAll('.pc-ach-row')));
    rows.forEach(r => { const p = /** @type {HTMLElement | null} */ (r.firstElementChild); if (p) fitPill(p, ROW_W); });
    /** @param {HTMLElement} r */
    const rowWidth = r => Array.from(r.children).reduce((w, c, i) => w + /** @type {HTMLElement} */ (c).offsetWidth + (i ? GAP : 0), 0);
    const spare = list.querySelector('.pc-ach-spare');
    if (spare) {
      for (const p0 of Array.from(spare.children)) {
        const p = /** @type {HTMLElement} */ (p0);
        const row = rows.find(r => { r.insertBefore(p, r.firstChild); const ok = rowWidth(r) <= ROW_W; if (!ok) spare.appendChild(p); return ok; });
        if (!row) p.remove();
      }
      spare.remove();
    }
  }
}

/** 実績の箱の仕上げ: 行に 2 つ以上詰めたら左ぞろえ (1 行 1 つなら右ぞろえのまま)。
 * 「主な実績」の見出しは箱の上の定位置 (実績の数で動かさない)。実績の並びは、見出しの下の残りの高さの上下の真ん中に置く
 * (箱の中の高さ 105 = 110 から下の線 5 を引いたもの。3 行なら残りいっぱいで、今までと同じ位置)
 * @param {HTMLElement} list */
function finishAch(list) {
  const rows = Array.from(list.querySelectorAll('.pc-ach-row'));
  list.classList.toggle('pc-ach-left', rows.some(r => r.children.length > 1));
  const box = list.parentElement;
  const label = /** @type {HTMLElement | null} */ (box && box.querySelector('.pc-label'));
  if (!label) return;
  const GAP = 3, INNER_H = 105;
  const full = label.offsetHeight + GAP + 3 * 23 + 2 * GAP;   // 3 行のときの高さ
  const top = Math.max(4, Math.round((INNER_H - full) / 2));   // 見出しの位置 (固定)
  const areaTop = top + label.offsetHeight + GAP;
  const areaH = INNER_H - top - areaTop;                        // 見出しの下の残り (上の余白と同じだけ下も空ける)
  label.style.top = (top + 2) + 'px';   // 見出しの字面を Figma (箱の上から 10px) に合わせる (並びの位置はそのまま)
  list.style.top = (areaTop + Math.max(0, Math.round((areaH - list.offsetHeight) / 2))) + 'px';
}

const ACH_ROW_W = 206, ACH_GAP = 3, ACH_ROWS = 3;
/** @param {HTMLElement} r */
const achRowWidth = r => Array.from(r.children).reduce((w, c, i) => w + /** @type {HTMLElement} */ (c).offsetWidth + (i ? ACH_GAP : 0), 0);

/** 選んだ順の実績 (.pc-ach-manual の中) を行に置く: 今の行の左に足し、入らなければ次の行へ (3 行まで)。
 * 行の先頭の 1 つだけは長ければ 8px まで詰める。全部入ったら true (入らない分は出さない)
 * @param {HTMLElement} list @returns {boolean} */
function placeManual(list) {
  const spare = /** @type {HTMLElement} */ (list.querySelector('.pc-ach-manual'));
  /** @type {HTMLElement | null} */
  let row = null;
  let rows = 0, ok = true;
  const newRow = () => { const r = document.createElement('div'); r.className = 'pc-ach-row'; list.insertBefore(r, spare); rows++; return r; };
  for (const p0 of Array.from(spare.children)) {
    const p = /** @type {HTMLElement} */ (p0);
    if (row) {
      row.insertBefore(p, row.firstChild);
      if (achRowWidth(row) <= ACH_ROW_W) continue;
      row.removeChild(p);
      row = null;
    }
    if (rows >= ACH_ROWS) { p.remove(); ok = false; continue; }
    row = newRow();
    row.appendChild(p);
    if (!fitPill(p, ACH_ROW_W)) { p.remove(); ok = false; }
  }
  spare.remove();
  return ok;
}

/** 編集ページ用: 実績の並び (選んだ順) がカードに入りきるか。画面外に原寸のカードを 1 枚置いて、実績の箱だけ入れ替えて測る
 * (Web フォントを読み終えてから使う)
 * @param {PCardModel} model @returns {{ fits: (labels: string[]) => boolean, destroy: () => void }} */
export function makeAchFitTester(model) {
  const box = document.createElement('div');
  box.className = 'pcard pc-offscreen';
  box.innerHTML = cardHtml({ ...model, achievements: [], achMode: 'manual' });
  document.body.appendChild(box);
  const list = /** @type {HTMLElement} */ (box.querySelector('.pc-ach-list'));
  return {
    fits(labels) {
      list.innerHTML = `<div class="pc-ach-spare pc-ach-manual">${labels.map(label => achPill({ label })).join('')}</div>`;
      return placeManual(list);
    },
    destroy() { box.remove(); },
  };
}

/** 表示幅に合わせて 514×333 を縮める (または広げる)
 * @param {HTMLElement} el */
function applyScale(el) {
  const inner = /** @type {HTMLElement | null} */ (el.querySelector('.pc-in'));
  if (!inner || !el.clientWidth) return;
  inner.style.transform = `scale(${el.clientWidth / W})`;
  const glow = /** @type {HTMLElement | null} */ (el.querySelector('.pcb-glow'));
  if (glow) glow.style.transform = inner.style.transform;
}

/** @type {WeakSet<HTMLElement>} */
const observed = new WeakSet();

/** @param {HTMLElement} el @param {PCardModel} model
 * @param {{ live?: boolean }} [opts] live = 編集中のプレビュー (変えるたびに描き直す)。強制ダークモード用の画像は、
 *   古い画像を外して HTML のカードをすぐ見せ、手が止まってから (1.5 秒) 撮り直す */
export function render(el, model, opts = {}) {
  mount(el, () => cardHtml(model), fitAll, !!opts.live);
  trackReady(el, Promise.resolve());
}

// ── 描き終わりを待つ (プレイヤーページが、描きかけのカードを見せないように) ──
/** @type {WeakMap<HTMLElement, Promise<boolean>>} */
const readyOf = new WeakMap();
/** 最後に描いたときの準備: Web フォント・(裏面のシールの絵とホロの素材)・(強制ダークモードなら重ねる画像)。
 * extra が false で終わったら (シールの絵が読めなかった・間に合わなかった) 「描き終わっていない」
 * @param {HTMLElement} el @param {Promise<unknown>} extra */
function trackReady(el, extra) {
  readyOf.set(el, (async () => {
    const fonts = /** @type {any} */ (document).fonts;
    if (fonts && fonts.ready) await fonts.ready.catch(() => {});
    const ok = await extra.then(v => v !== false, () => false);
    if (needsImage()) await (imageDone.get(el) || Promise.resolve());
    return ok;
  })());
}
/** el のカードが描き終わるのを待つ (待つ間に描き直されたら、その分も待つ)。全部描けたら true、
 * シールの絵などが読めなかった・間に合わなかったら false。描いていなければ true
 * @param {HTMLElement} el @returns {Promise<boolean>} */
export async function ready(el) {
  for (let i = 0; i < 5; i++) {
    const p = readyOf.get(el);
    if (!p) return true;
    const ok = await p;
    if (readyOf.get(el) === p) return ok;
  }
  return false;
}

/** 裏面を el に描く (表の render と同じく、表示幅に合わせて縮め、強制ダークモードでは画像を重ねる)
 * @param {HTMLElement} el @param {PCardModel} model @param {{ live?: boolean }} [opts] */
export function renderBack(el, model, opts = {}) {
  const want = !!(model.back && model.back.stickers.length);
  // 光の層 (傾けたときのキラキラ) は初めて傾けたときに作る (ensureGlow)。描き直したら作り直す
  glowModel.set(el, model);
  mount(el, () => backHtml(model), root => { fitBack(root); if (want) paintBackStickers(root, model); }, !!opts.live);
  // 大会のアイコンの表がまだなら、読んでから描き直す (1 回だけ。描き直したらそちらの準備を待つ)
  if (want && !iconsNow()) {
    const again = loadIcons().then(t => { if (t && el.isConnected) renderBack(el, model, opts); return !!t; });
    trackReady(el, again);
    return;
  }
  // シールの絵とホロの素材 (と透過かどうか) を読み終えるまでを準備に入れる (時間では打ち切らない)。読めなかったら「描き終わっていない」
  trackReady(el, want ? Promise.all((model.back?.stickers || []).map(s => {
    const p = parseKey(s.e);
    const src = p ? iconUrl(p.eid) : null;
    return src && p ? preloadBadge(src, p.variant, s.k) : true;   // アイコンの無いシールは出さないので待たない
  })).then(a => a.every(Boolean)) : Promise.resolve(true));
}

/** 裏面に描いたモデル (光の層を後から作る用) @type {WeakMap<HTMLElement, PCardModel>} */
const glowModel = new WeakMap();
/** 裏面の光の層を用意する (無ければ作る)。カードを傾け始めたときに呼ぶ (プレイヤーページ) @param {HTMLElement} el .pcard (裏面) */
export function ensureGlow(el) {
  const m = glowModel.get(el);
  if (m && !el.querySelector('.pcb-glow')) paintGlow(el, m);
}

/** シールの光 (カードを傾けている間のキラキラ、.pc-tilt) の層。シールと同じ所・形に光 (holo_badge.css の .hb-sheen / .hb-glare) だけを置き、
 * カードのいちばん上 (強制ダークモードでカードを画像に差し替えていても、その上) に重ねる。座標はカード (514×333) で、.pc-in と同じ倍率
 * @param {HTMLElement} el .pcard @param {PCardModel} m */
function paintGlow(el, m) {
  el.querySelector('.pcb-glow')?.remove();
  const list = (m.back && m.back.stickers) || [];
  if (!list.length) return;
  const glow = document.createElement('div');
  glow.className = 'pcb-glow';
  glow.setAttribute('aria-hidden', 'true');
  for (const s of list) {
    const p = parseKey(s.e);
    const src = p ? iconUrl(p.eid) : null;
    if (!p || !src) continue;
    const g = document.createElement('div');
    g.style.cssText = `left:${s.x}px;top:${s.y}px;width:${s.s}px;height:${s.s}px;transform:translate(-50%,-50%) rotate(${s.r}deg)`;
    g.style.setProperty('--hb-img', `url("${src.replace(/"/g, '%22')}")`);
    const shape = (/** @type {boolean} */ tr) => { g.className = tr ? 'hb hb-shape' : `hb hb-square hb-k-${s.k}`; };
    shape(false);
    isTransparent(src).then(tr => { if (tr) shape(true); });
    g.innerHTML = '<div class="hb-sheen"></div><div class="hb-glare"></div>';
    glow.appendChild(g);
  }
  el.appendChild(glow);
  const inner = /** @type {HTMLElement | null} */ (el.querySelector('.pc-in'));
  if (inner) glow.style.transform = inner.style.transform;
}

/** シールの影 (player_card.css .pcb-sk の drop-shadow と同じ値。カードを画像にするときに絵に入れる) */
const STICKER_SHADOW = { dx: 1, dy: 1, blur: 1, color: 'rgba(0, 0, 0, .3)' };

/** 裏面のシールの絵 (js/holo_badge.js)。アイコンの無い大会のシールは出さない
 * @param {HTMLElement} root .pc-in @param {PCardModel} m */
function paintBackStickers(root, m) {
  const list = (m.back && m.back.stickers) || [];
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('.pcb-sk'))) {
    const s = list[Number(el.dataset.i)];
    const p = s ? parseKey(s.e) : null;
    const src = p ? iconUrl(p.eid) : null;
    if (!s || !p || !src) { el.remove(); continue; }
    const holder = document.createElement('div');
    el.appendChild(holder);
    const draw = (/** @type {boolean} */ tr) => renderBadge(holder, { src, variant: p.variant, transparent: tr, cls: p.cls, shape: s.k, crop: s.c });
    draw(false);
    isTransparent(src).then(tr => { if (tr && holder.isConnected) draw(true); });
  }
}

/** @param {HTMLElement} el @param {() => string} html @param {(root: HTMLElement) => void} fit @param {boolean} live */
function mount(el, html, fit, live) {
  // 組み立てと詰めは毎回まっさらな HTML から (詰めは実績の並べ替えや改行を入れるので、2 回目は作り直してからやる)
  const build = () => {
    // 重ねている画像 (強制ダークモード用) は撮り直すまで残す (消すと一瞬黒いカードが見える)。編集中は古い画像を外す
    const keep = live ? null : el.querySelector('.pc-img');
    el.innerHTML = html();
    if (keep) el.appendChild(keep);
    fit(/** @type {HTMLElement} */ (el.querySelector('.pc-in')));
    applyScale(el);
  };
  build();
  scheduleImage(el, live ? 1500 : 300);
  // Web フォント (Zalando Sans / IBM Plex Sans JP) が後から来ると幅が変わるので作り直す (読み込み済みなら不要)
  const fonts = /** @type {any} */ (document).fonts;
  if (fonts && fonts.ready && fonts.status !== 'loaded') fonts.ready.then(() => { build(); scheduleImage(el, live ? 1500 : 300); }).catch(() => {});
  if (!observed.has(el) && typeof ResizeObserver === 'function') {
    observed.add(el);
    new ResizeObserver(() => applyScale(el)).observe(el);
  }
}

/** カードに出すサイトの URL (「spsp.games/jp/」)。ドメインは本番の spsp.games に固定 (preview で撮っても同じ)、地域の部分は設定の正規 URL から */
function siteUrlLabel() {
  const site = /** @type {any} */ (typeof window !== 'undefined' ? window : {}).SPSPSite || {};
  const base = String((site.canonical && site.canonical.base) || '/');
  return 'spsp.games' + (/^\/(jp|na)\/$/.test(base) ? base : '/' + String(site.region || 'jp').toLowerCase() + '/');
}

/** ブラウザの強制ダークモード (Samsung Internet など。color-scheme: only light を無視して色を書き換える) では、
 * カードを画像 (保存と同じ capture) にして上に重ねる。画像の色はブラウザが書き換えないので、デザインどおりに見える。
 * 重いので、Samsung Internet か、ダークモードの設定のときだけ (ページが実際に暗くされているかはページからは分からない。
 * Samsung Internet のダークモードは prefers-color-scheme に出ないことがあるので、Samsung Internet は常に)。
 * 描き直すたびに少し待ってから撮り直す (続けて変えたときは最後の 1 回だけ撮る) */
function needsImage() {
  try {
    if (/SamsungBrowser/i.test(navigator.userAgent)) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) { return false; }
}
/** @type {WeakMap<HTMLElement, ReturnType<typeof setTimeout>>} */
const imageTimers = new WeakMap();
/** 重ねる画像を撮り終えたら resolve (撮れなくても)。撮る前に描き直されて撮り直しになっても、同じ待ちのまま
 * (前の予約を取り消したときに、その待ちが終わらないまま残っていた。裏返しの紹介が止まった) @type {WeakMap<HTMLElement, Promise<void>>} */
const imageDone = new WeakMap();
/** まだ撮り終えていない待ちを終わらせる関数 @type {WeakMap<HTMLElement, () => void>} */
const imagePending = new WeakMap();
/** @param {HTMLElement} el @param {number} delay 撮るまで待つ時間 (ms) */
function scheduleImage(el, delay) {
  if (!needsImage()) return;
  const old = imageTimers.get(el);
  if (old) clearTimeout(old);
  // 撮り終えていない待ちがあればそれを使い続ける (取り消した予約の待ちを残さない)
  let done = imagePending.get(el);
  if (!done) {
    /** @type {() => void} */
    let r0 = () => {};
    imageDone.set(el, new Promise(r => { r0 = r; }));
    done = () => { imagePending.delete(el); r0(); };
    imagePending.set(el, done);
  }
  const finish = done;
  imageTimers.set(el, setTimeout(() => {
    // Samsung Internet のダークモードは <img> も暗くするので、canvas をそのまま重ねる (canvas は暗くされない。実機で確認)
    captureCanvas(el).then(node => {
      if (!node) return;
      const prev = el.querySelector('.pc-img');
      node.classList.add('pc-img');
      // html2canvas は canvas に原寸の幅・高さ (514px など) を直接書くので、カードの箱いっぱいに合わせ直す
      node.style.width = '100%';
      node.style.height = '100%';
      el.appendChild(node);
      if (prev) prev.remove();
      const glow = el.querySelector('.pcb-glow');
      if (glow) el.appendChild(glow);   // シールの光は画像の上に
    }).catch(() => { /* 撮れなければ HTML のカードのまま */ }).finally(() => finish());   // 重ねてから「撮り終えた」に
  }, delay));
}

/** カードだけを PNG にする (画像で保存 / X で共有)。表示中のカードは縮小されているので、
 * 画面外に 514×333 の原寸で複製して撮る (3 倍 = 1542×999)
 * @param {HTMLElement} el  render() したカードの箱 (.pcard) @returns {Promise<Blob | null>} */
export async function capture(el) {
  const canvas = await captureCanvas(el);
  if (!canvas) return null;
  return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/** capture の元 (原寸 3 倍の canvas) @param {HTMLElement} el @returns {Promise<HTMLCanvasElement | null>} */
async function captureCanvas(el) {
  const src = el.querySelector('.pc-in');
  if (!src) return null;
  const w = /** @type {any} */ (window);
  if (!w.html2canvas) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  const box = document.createElement('div');
  box.className = 'pcard pc-offscreen';   // 色の変数 (--pc-red など) は .pcard が持つ
  const clone = /** @type {HTMLElement} */ (src.cloneNode(true));
  clone.style.transform = 'none';
  // 裏面のシール: html2canvas はホロの重ね方 (ブレンド)・マスク・形の切り取りを描けない (複製したキャンバスも空になる) ので、
  // 1 枚ずつ自前で描いた絵 (3 倍の細かさ) に差し替える。描けなかったシールは外す。
  // 絵は入れ物 (translate(-50%) + rotate の .pcb-sk) の中に入れず、カードの上の正しい位置に直接置いて回転だけかける
  // (html2canvas は変形した要素の中の、はみ出して置いた子の位置を誤る。影の余白の分だけ右下にずれていた)
  const sks = [...src.querySelectorAll('.pcb-sk')], cks = [...clone.querySelectorAll('.pcb-sk')];
  await Promise.all(sks.map(async (sk, i) => {
    const ck = /** @type {HTMLElement | undefined} */ (cks[i]);
    if (!ck) return;
    try {
      const hb = /** @type {HTMLElement | null} */ (sk.querySelector('.hb'));
      const cv = hb ? await badgeToCanvas(hb, (parseFloat(ck.style.width) || 100) * 3) : null;
      if (!cv) throw new Error('no badge');
      // 影 (画面の drop-shadow と同じ: 右下へ 1px・ぼかし 1px・黒 30%。html2canvas は filter を描かないので絵に入れる)。
      // 影がはみ出す分だけ周りに余白を足す。絵ごと回すので影も一緒に回る (画面と同じ)
      const k = cv.width / (parseFloat(ck.style.width) || 100);   // カードの px → 絵の px
      const pad = Math.ceil(STICKER_SHADOW.blur * 2 * k + Math.max(STICKER_SHADOW.dx, STICKER_SHADOW.dy) * k);
      const out = document.createElement('canvas');
      out.width = out.height = cv.width + pad * 2;
      const octx = /** @type {CanvasRenderingContext2D} */ (out.getContext('2d'));
      octx.shadowColor = STICKER_SHADOW.color;
      octx.shadowOffsetX = STICKER_SHADOW.dx * k;
      octx.shadowOffsetY = STICKER_SHADOW.dy * k;
      octx.shadowBlur = STICKER_SHADOW.blur * k;
      octx.drawImage(cv, pad, pad);
      const img = document.createElement('img');
      img.src = out.toDataURL('image/png');   // アイコンが CORS で読めずキャンバスが汚れていると、ここで例外
      const p = pad / k;
      const x = Number(ck.dataset.x), y = Number(ck.dataset.y), size = Number(ck.dataset.s), rot = Number(ck.dataset.r) || 0;
      const box = size + 2 * p;
      img.className = 'pcb-sk-img';
      img.style.cssText = `display:block;position:absolute;left:${x - box / 2}px;top:${y - box / 2}px;width:${box}px;height:${box}px;max-width:none;transform:rotate(${rot}deg)`;
      await img.decode().catch(() => {});
      ck.replaceWith(img);
    } catch (e) { ck.remove(); }
  }));
  box.appendChild(clone);
  document.body.appendChild(box);
  // html2canvas は画面のスクロール位置を動かすことがある (編集中に画面ごと動いて見えた)。前の位置に戻す
  const sx = window.scrollX, sy = window.scrollY;
  try {
    return await w.html2canvas(clone, { backgroundColor: null, scale: 3, useCORS: true, logging: false, width: W, height: 333, scrollX: 0, scrollY: 0 });
  } finally {
    box.remove();
    if (window.scrollX !== sx || window.scrollY !== sy) window.scrollTo(sx, sy);
  }
}

export default { render, renderBack, ready, ensureGlow, capture, makeAchFitTester, COLORS, TEMPLATES };
