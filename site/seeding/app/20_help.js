// @ts-check
// seeding/app/20_help.js — SPSP シードツール本体の一部: ヘルプアイコン (?)。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { i18n } from './10_skeleton.js';
'use strict';

// ── ヘルプアイコン (?) ────────────────────────────────────────────────
// オプションやボタンの意味を、マウスオーバーでもタップでも読めるようにする。
// title 属性はホバーでしか出ず、スマホでは読めないので独自ポップに置き換える。
//
// 説明文は HELP_TEXT を優先し、無ければ既存の title 属性を流用する
// (= 既に title を書いてある要素は id を並べるだけでアイコンが付く)。
// アイコンを付けた要素の title は消す (ネイティブのツールチップと二重に出さない)。
const HELP_TEXT = {
  // 何の機能で、どういうときに使うのかだけを書く。細かい挙動は書かない。
  // ── 取得まわり ──
  'token': i18n('seed.help.s1'),
  'event-url': i18n('seed.help.s2'),
  'fetch-btn': i18n('seed.help.s3'),
  'phase-select': i18n('seed.help.s4'),
  'pc-group-count': i18n('seed.help.s5'),
  'pc-phase-name': i18n('seed.help.s6'),

  // ── 出力 ──
  'csv-btn': i18n('seed.help.s7'),
  'upload-btn': i18n('seed.help.s8'),
  'so-auto-apply': i18n('seed.help.s22'),
  'so-reset-defaults': i18n('seed.help.s23'),
  'spec-export': i18n('seed.help.s9'),
  'bracket-preview': i18n('seed.help.s10'),

  // ── 被り回避 ──
  'so-pools': i18n('seed.help.s11'),
  'so-run': i18n('seed.help.s12'),
  'so-stop': i18n('seed.help.s13'),
  'so-orderpow-label': i18n('seed.help.s14'),
  'so-mode': i18n('seed.help.s15'),
  'so-avoid-series': i18n('seed.help.s16'),
  'so-series-select': i18n('seed.help.s17'),
  'so-shiftlimit-label': i18n('seed.help.s18'),
  'so-maxshift': i18n('seed.help.s19'),

  // ── 表示・操作 ──
  'search': i18n('seed.help.s20'),
};

// アイコンを付ける対象。ここに id を並べるだけで付く。
const HELP_TARGETS = [
  'token', 'event-url', 'fetch-btn', 'phase-select', 'pc-group-count', 'pc-phase-name',
  'csv-btn', 'upload-btn', 'so-auto-apply', 'spec-export', 'bracket-preview',
  'so-pools', 'so-waves', 'so-run', 'so-stop', 'so-cancel', 'so-reset-defaults',
  'so-enable-intra', 'so-avoid-region', 'so-avoid-recent', 'so-keep-deplace',
  'so-scope-winners', 'so-include-weekday',
  'so-orderpow-label', 'so-shiftlimit-label', 'so-maxshift',
  'so-avoid-series', 'so-series-select', 'so-seriesmult',
  'so-mode', 'so-itersscale', 'so-worder', 'so-decaypoints',
  'so-kinter', 'so-kintra',
];

// ids を渡すと HELP_TARGETS の代わりにそれに付ける (geo.json 読込後に描く地域まとめトグルなど)
/** @param {ParentNode | null} root @param {string[]} [ids] */
export function injectHelpIcons(root, ids) {
  if (!root) return;
  for (const id of (ids || HELP_TARGETS)) {
    const el = root.querySelector('#' + id);
    if (!el) continue;
    // 説明の持ち主: 外付け <label for>, 囲っている <label>, なければ要素自身。
    const outerLabel = root.querySelector('label[for="' + id + '"]');
    const wrapLabel = el.closest('label');
    const host = outerLabel || wrapLabel || el;
    const text = HELP_TEXT[id] || host.getAttribute('title') || el.getAttribute('title');
    if (!text) continue;
    host.removeAttribute('title');
    el.removeAttribute('title');
    const ico = document.createElement('button');
    ico.type = 'button';
    ico.className = 'help-ico';
    ico.textContent = '?';
    ico.dataset.help = text;
    ico.setAttribute('aria-label', i18n('seed.help.s21'));
    ico.setAttribute('aria-expanded', 'false');
    // 置き場所は「ラベル文字の直後」。
    //   外付け label      → その末尾 (入力は別行なので末尾 = 文字の直後)
    //   囲い label + チェック → 末尾 (<input> テキスト の順で並ぶため)
    //   囲い label + それ以外 → 入力の**前** (テキスト <input display:block> の順なので、
    //                            末尾に置くと入力の下に落ちてしまう)
    //   label 無し        → 要素の直後
    const isCheck = /** @type {HTMLInputElement} */ (el).type === 'checkbox' || /** @type {HTMLInputElement} */ (el).type === 'radio';
    if (outerLabel) outerLabel.appendChild(ico);
    else if (wrapLabel && isCheck) wrapLabel.appendChild(ico);
    else if (wrapLabel) wrapLabel.insertBefore(ico, el);
    else if (el.parentNode) el.parentNode.insertBefore(ico, el.nextSibling);
    // 対象が隠れているときはアイコンも隠す (ボタンは処理の進み具合で出し入れされる)
    bindHelpVisibility(ico, el);
  }
}

// 対象要素の表示/非表示にアイコンを追従させる。
// アイコンは対象の兄弟なので、祖先が隠れれば一緒に隠れる。自分自身の
// display:none / hidden だけを見ればよい。
const HELP_VIS_OBS = (typeof MutationObserver !== 'undefined')
  ? new MutationObserver((records) => {
      for (const r of records) syncHelpVisibility(r.target);
    })
  : null;
const HELP_ICO_BY_TARGET = new WeakMap();

function isElementHidden(el) {
  if (el.hidden) return true;
  if (el.style && el.style.display === 'none') return true;
  try {
    const cs = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (cs && cs.display === 'none') return true;
  } catch (e) { /* 計算できない環境では inline 指定のみで判断 */ }
  return false;
}

function syncHelpVisibility(target) {
  const ico = HELP_ICO_BY_TARGET.get(target);
  if (!ico) return;
  const hide = isElementHidden(target);
  ico.hidden = hide;
  if (hide && HELP_OPEN_ICO === ico) hideHelp();
}

function bindHelpVisibility(ico, target) {
  HELP_ICO_BY_TARGET.set(target, ico);
  syncHelpVisibility(target);
  if (HELP_VIS_OBS) {
    HELP_VIS_OBS.observe(target, { attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
  }
}

// ポップは 1 つを使い回す (開くたびに DOM を作らない)。
/** @type {HTMLDivElement | null} */
let HELP_POP = null;
/** @type {HTMLElement | null} */
let HELP_OPEN_ICO = null;

function helpPopEl() {
  if (!HELP_POP) {
    HELP_POP = document.createElement('div');
    HELP_POP.className = 'help-pop';
    HELP_POP.hidden = true;
    HELP_POP.setAttribute('role', 'tooltip');
    document.body.appendChild(HELP_POP);
  }
  return HELP_POP;
}

/** @param {HTMLElement} ico */
function showHelp(ico) {
  const pop = helpPopEl();
  pop.textContent = ico.dataset.help || '';
  pop.hidden = false;
  // まず表示してから実寸で位置決めする (幅が確定しないと画面外判定ができない)
  const r = ico.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.left + r.width / 2 - pr.width / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
  // 下に入らなければ上に出す
  let top = r.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = Math.max(8, r.top - pr.height - 6);
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  if (HELP_OPEN_ICO && HELP_OPEN_ICO !== ico) HELP_OPEN_ICO.setAttribute('aria-expanded', 'false');
  ico.setAttribute('aria-expanded', 'true');
  HELP_OPEN_ICO = ico;
}

function hideHelp() {
  if (HELP_POP) HELP_POP.hidden = true;
  if (HELP_OPEN_ICO) {
    HELP_OPEN_ICO.setAttribute('aria-expanded', 'false');
    delete HELP_OPEN_ICO.dataset.pinned;
  }
  HELP_OPEN_ICO = null;
}

document.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const ico = /** @type {HTMLElement | null} */ (t.closest && t.closest('.help-ico'));
  if (ico) {
    // label の中に置くので、そのままだとチェックボックスが反応してしまう
    e.preventDefault();
    e.stopPropagation();
    if (HELP_OPEN_ICO === ico && ico.dataset.pinned === '1') {
      hideHelp();
    } else {
      showHelp(ico);
      ico.dataset.pinned = '1';
    }
    return;
  }
  if (!t.closest || !t.closest('.help-pop')) hideHelp();
}, true);

document.addEventListener('mouseover', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const ico = /** @type {HTMLElement | null} */ (t.closest && t.closest('.help-ico'));
  if (ico && ico !== HELP_OPEN_ICO) showHelp(ico);
});
document.addEventListener('mouseout', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const ico = /** @type {HTMLElement | null} */ (t.closest && t.closest('.help-ico'));
  // クリックで開いたものはホバーが外れても閉じない
  if (ico && ico === HELP_OPEN_ICO && ico.dataset.pinned !== '1') hideHelp();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideHelp(); });
window.addEventListener('resize', hideHelp);
window.addEventListener('scroll', hideHelp, true);

injectHelpIcons(document.getElementById('seed-app-root'));
