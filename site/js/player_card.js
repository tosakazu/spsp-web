// @ts-check
// player_card.js — プレイヤーページ最上部の選手カード (Figma「submit」: 514×333 の 1 枚絵を再現、2026-09-29)。
//   render(el, model)  model (下の PCardModel) からカードを組み立てて el に入れる。長い名前・大会名・大きい順位は文字サイズを詰め、
//                      名前と大会名は必要なら 2 行にする (fit* 関数)。フォント読み込み後にもう一度詰め直す
//   カードは 514×333 の座標系で描き、表示幅に合わせて transform: scale で縮める (css/player_card.css)
//   capture(el)          カードだけを PNG にする (保存・共有)
//   makeAchFitTester(m)  編集ページ用: 実績の並び (選んだ順) がカードに入りきるかを確かめる
//   COLORS / TEMPLATES   カードの色 (Figma の色違い) とテンプレート (今は 1 種類)
import { escapeHtml } from './html.js';

const W = 514;   // デザインの幅 (px)。高さは 333 (CSS の aspect-ratio)

/** カードの色 (Figma「work」ページの色違い Frame 18〜21 と「submit」の赤)。変えるのはアクセント色 (--pc-red) だけ */
export const COLORS = [
  { id: 'red', hex: '#df1b1b' },
  { id: 'blue', hex: '#1b25df' },
  { id: 'green', hex: '#1ca01e' },
  { id: 'purple', hex: '#ac17ec' },
  { id: 'orange', hex: '#fa7d00' },
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
 * @typedef {{ name: string, loc?: { text: string, href?: string, rank?: number | null } | null, evalDate?: string, chars: PCardChar[],
 *              color?: string, achMode?: 'auto' | 'manual',
 *              rank: number | null, pills: { text: string, title?: string }[], achievements: PCardAch[], latest?: PCardLatest | null,
 *              totalTournaments: number, totalMatches: number,
 *              labels: { evalDate: string, achievements: string, latest: string, overall: string, national: string, equivalent: string, noAch: string } }} PCardModel */

// 数字・英字・記号の並びは欧文フォント (Zalando Sans) で組む (デザインの「Lv.5」「UF 10」「#3」と同じ)
const LATIN_RUN = /[0-9A-Za-z#.+\-/]+(?:[ ][0-9A-Za-z#.+\-/]+)*/g;
/** @param {string} s @param {string} cls */
function latinRuns(s, cls) {
  let out = '', last = 0;
  s.replace(LATIN_RUN, (m, off) => {
    out += escapeHtml(s.slice(last, off)) + `<span class="${cls}">${escapeHtml(m)}</span>`;
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
  return `<span class="pc-ach-pill">${emoji ? `<span class="pc-ach-emoji">${escapeHtml(emoji)}</span>` : ''}<span class="pc-ach-text">${latinRuns(text, 'pc-lat')}</span></span>`;
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
  const pills = m.pills.map(p => `<span class="pc-pill"${p.title ? ` title="${escapeHtml(p.title)}"` : ''}>${escapeHtml(p.text)}</span>`).join('');
  return `<div class="pc-in" style="--pc-red:${colorHex(m.color)}">
    <div class="pc-head">
      ${loc}
      <div class="pc-name"><span class="pc-name-t">${escapeHtml(m.name)}</span></div>
      <div class="pc-date"><span class="pc-date-lbl">${escapeHtml(L.evalDate)}</span><span class="pc-date-v">${escapeHtml(m.evalDate || '')}</span></div>
      <div class="pc-chars">${chars}</div>
    </div>
    <div class="pc-ach"><div class="pc-label">${escapeHtml(L.achievements)}</div><div class="pc-ach-list">${ach}</div></div>
    <div class="pc-latest">${latest}</div>
    <div class="pc-overall">
      <div class="pc-bgword">Overall<br>Rank</div>
      <div class="pc-overall-lbl">${escapeHtml(L.overall)}</div>
      <div class="pc-pills">${pills}</div>
      <div class="pc-big"><span class="pc-big-h">#</span><span class="pc-big-n">${m.rank != null ? m.rank : '—'}</span></div>
      <div class="pc-tot pc-tot-t"><span class="pc-tot-lbl">Total Tournaments</span><span class="pc-tot-line"></span><span class="pc-tot-v">${m.totalTournaments.toLocaleString('en-US')}</span></div>
      <div class="pc-tot pc-tot-m"><span class="pc-tot-lbl">Total Matches</span><span class="pc-tot-line"></span><span class="pc-tot-v">${m.totalMatches.toLocaleString('en-US')}</span></div>
    </div>
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
  const name = q('.pc-name');
  if (name) fitTwoLines(name, 377, 54, 43, 26, 14);
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
  if (pills) fitWidth(pills, 186, 14, 9);
  // キャラ名は 12px (デザインの 14px より小さめ) から 10px まで詰めて、それでも入らなければ 2 行にして 12px から詰め直す (「MR. GAME & WATCH」「ポケモン/トレーナー」)。
  // 2 行のキャラがあって帯の下にはみ出すなら、キャラの列を上へずらす (評価日の下まで)
  // 折り返しは自分で改行を入れる (CSS の折り返しだと名前の箱が最大幅のままになり、■ と文字が離れる)
  //   切れ目の無い名前 (「ドンキーコング」) は 1 行のまま 8px まで詰める。
  //   2 つとも 2 行で帯に入りきらないときは、2 つ目 (サブキャラ) を 1 行に戻す
  const charEls = /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll('.pc-char')));
  /** @type {{ el: HTMLElement, nameEl: HTMLElement, text: string }[]} */
  const wrapped = [];
  for (const c of charEls) {
    const nameEl = /** @type {HTMLElement | null} */ (c.querySelector('.pc-char-name'));
    if (!nameEl || fitWidth(c, 108, 12, 10)) continue;
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
    const MAX_H = 85 - 29;   // 評価日の下 (29) から帯の下 (89) の少し上まで
    if (chars.offsetHeight > MAX_H && wrapped.length > 1) {
      const last = /** @type {{ el: HTMLElement, nameEl: HTMLElement, text: string }} */ (wrapped[wrapped.length - 1]);
      last.nameEl.textContent = last.text;
      last.el.classList.remove('pc-wrap');
      fitWidth(last.el, 108, 10, 7);
    }
    // メインとサブで文字の大きさがちぐはぐにならないよう、小さい方に揃える
    const sizes = charEls.map(c => parseFloat(c.style.fontSize) || 12);
    const common = Math.min(...sizes);
    charEls.forEach(c => { c.style.fontSize = common + 'px'; });
    chars.style.top = Math.max(29, Math.min(41, 85 - chars.offsetHeight)) + 'px';
  }
  // 実績: 上位 3 つは 1 行ずつ (長ければ詰める)。控え (4 つ目以降) は優先度の高い順に、入る行の左の隙間へ入れる。入らないものは出さない
  const list = q('.pc-ach-list');
  if (list && list.querySelector('.pc-ach-manual')) placeManual(list);
  else if (list) placeAuto(list);
  if (list) finishAch(list);
}

/** 上位 3 つは 1 行ずつ (長ければ詰める)。控え (4 つ目以降) は優先度の高い順に、入る行の左の隙間へ入れる。入らないものは出さない
 * @param {HTMLElement} list */
function placeAuto(list) {
  {
    const ROW_W = 206, GAP = 3;
    const rows = /** @type {HTMLElement[]} */ (Array.from(list.querySelectorAll('.pc-ach-row')));
    rows.forEach(r => { const p = /** @type {HTMLElement | null} */ (r.firstElementChild); if (p) fitWidth(p, ROW_W, 10, 8); });
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
  label.style.top = top + 'px';
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
    if (!fitWidth(p, ACH_ROW_W, 10, 8)) { p.remove(); ok = false; }
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
}

/** @type {WeakSet<HTMLElement>} */
const observed = new WeakSet();

/** @param {HTMLElement} el @param {PCardModel} model */
export function render(el, model) {
  // 組み立てと詰めは毎回まっさらな HTML から (詰めは実績の並べ替えや改行を入れるので、2 回目は作り直してからやる)
  const build = () => {
    el.innerHTML = cardHtml(model);
    fitAll(/** @type {HTMLElement} */ (el.querySelector('.pc-in')));
    applyScale(el);
  };
  build();
  // Web フォント (Zalando Sans / IBM Plex Sans JP) が後から来ると幅が変わるので作り直す
  const fonts = /** @type {any} */ (document).fonts;
  if (fonts && fonts.ready) fonts.ready.then(build).catch(() => {});
  if (!observed.has(el) && typeof ResizeObserver === 'function') {
    observed.add(el);
    new ResizeObserver(() => applyScale(el)).observe(el);
  }
}

/** カードだけを PNG にする (画像で保存 / X で共有)。表示中のカードは縮小されているので、
 * 画面外に 514×333 の原寸で複製して撮る (3 倍 = 1542×999)
 * @param {HTMLElement} el  render() したカードの箱 (.pcard) @returns {Promise<Blob | null>} */
export async function capture(el) {
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
  box.appendChild(clone);
  document.body.appendChild(box);
  try {
    const canvas = await w.html2canvas(clone, { backgroundColor: null, scale: 3, useCORS: true, logging: false, width: W, height: 333 });
    return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  } finally {
    box.remove();
  }
}

export default { render, capture, makeAchFitTester, COLORS, TEMPLATES };
