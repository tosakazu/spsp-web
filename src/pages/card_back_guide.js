// @ts-check
// src/pages/card_back_guide.js — カード編集の「裏」タブ (シール) の使い方ガイド (2026-10-28)
//   初めて裏のタブを開いたときに出す (見たかどうかは端末ごと、localStorage)。? のボタン (bz-guide) でいつでも出し直せる
//   1 段ずつ、本物の操作の欄を明るく切り抜いて (ほかは暗く) 説明の吹き出しを出す。メニューの中の物はメニューを開いて見せる
//   ガイドの間は画面の操作は止める (暗い所を押しても何も起きない)。閉じる・最後まで進むと見たことにする
import SPSPI18n from '../../site/js/i18n.js';

const $ = (/** @type {string} */ id) => /** @type {HTMLElement | null} */ (document.getElementById(id));
const i18n = (/** @type {string} */ k) => SPSPI18n.t(k);
const SEEN_KEY = 'spsp_card_back_guide_v1';
/** 下の「適用」の帯 (ce-bar) の分は吹き出しを置かない */
const BOTTOM = 72;
const GAP = 12;

/** title・body = 文言のキー (card_back.guide. の後ろ)
 * @typedef {{ key: string, title: string, body: string, targets: () => (HTMLElement | null)[], menu?: boolean, block?: ScrollLogicalPosition }} Step */
/** @type {Step[]} */
const STEPS = [
  { key: 'tray', title: 'tray.title', body: 'tray.body', targets: () => [document.querySelector('.bz-find'), $('bz-filters'), $('bz-tray')], block: 'start' },
  { key: 'stage', title: 'stage.title', body: 'stage.body', targets: () => [$('bz-stage')] },
  { key: 'tools', title: 'tools.title', body: 'tools.body', targets: () => [$('bz-tools')] },
  { key: 'latin', title: 'latin.title', body: 'latin.body', targets: () => [$('bz-latin')] },
  { key: 'name_sticker', title: 'name_sticker.title', body: 'name_sticker.body', targets: () => [$('bz-text-top'), $('bz-sticker-text')] },
  { key: 'name_place', title: 'name_place.title', body: 'name_place.body', menu: true, targets: () => ['bz-text-edit', 'bz-text-rank', 'bz-text-name', 'bz-text-title', 'bz-text-center'].map($).filter(e => e && !e.hidden) },
  { key: 'random', title: 'random.title', body: 'random.body', menu: true, targets: () => [document.querySelector('.bz-rand')] },
  { key: 'clear', title: 'clear.title', body: 'clear.body', menu: true, targets: () => [$('bz-clear')] },
  { key: 'again', title: 'again.title', body: 'again.body', targets: () => [$('bz-guide')] },
];

/** 見たことがあるか (読めない端末では見たことにする: 毎回出さない) */
export function guideSeen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return true; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* 次も出る */ }
}

/** 今出しているガイドを閉じる関数 (出していなければ null) @type {(() => void) | null} */
let closeCur = null;

/** ガイドを出す (出していれば最初から) */
export function startGuide() {
  if (closeCur) closeCur();
  const menu = /** @type {HTMLDetailsElement | null} */ ($('bz-menu'));
  const root = document.createElement('div');
  root.className = 'bzg';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = '<div class="bzg-hole"></div><div class="bzg-tip" role="document"><div class="bzg-step"></div><div class="bzg-title"></div>' +
    '<div class="bzg-body"></div><div class="bzg-btns"><button type="button" class="bzg-skip"></button><span class="bzg-sp"></span>' +
    '<button type="button" class="bzg-prev"></button><button type="button" class="bzg-next"></button></div></div>';
  document.body.appendChild(root);
  const hole = /** @type {HTMLElement} */ (root.querySelector('.bzg-hole'));
  const tip = /** @type {HTMLElement} */ (root.querySelector('.bzg-tip'));
  const prev = /** @type {HTMLButtonElement} */ (root.querySelector('.bzg-prev'));
  const next = /** @type {HTMLButtonElement} */ (root.querySelector('.bzg-next'));
  const skip = /** @type {HTMLButtonElement} */ (root.querySelector('.bzg-skip'));
  prev.textContent = i18n('card_back.guide.prev');
  skip.textContent = i18n('card_back.guide.skip');
  // 画面の操作は止める (メニューの「外を押したら閉じる」にも届かないように)
  for (const t of ['pointerdown', 'pointerup', 'click', 'touchstart', 'wheel']) {
    root.addEventListener(t, e => { e.stopPropagation(); if (t !== 'wheel' && t !== 'touchstart' && !(/** @type {HTMLElement} */ (e.target)).closest('button')) e.preventDefault(); }, { passive: false });
  }
  let i = 0;
  /** 切り抜く四角 (画面の座標、見えている所だけ) */
  const rectOf = () => {
    const rs = STEPS[i].targets().filter(Boolean).map(e => /** @type {HTMLElement} */ (e).getBoundingClientRect()).filter(r => r.width || r.height);
    if (!rs.length) return null;
    const vh = window.innerHeight;
    const l = Math.min(...rs.map(r => r.left)), t = Math.max(0, Math.min(...rs.map(r => r.top)));
    const rr = Math.max(...rs.map(r => r.right)), b = Math.min(vh - BOTTOM + 8, Math.max(...rs.map(r => r.bottom)));
    return { l: l - 6, t: t - 6, w: rr - l + 12, h: Math.max(0, b - t) + 12 };
  };
  const layout = () => {
    const r = rectOf();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (r) {
      hole.style.display = '';
      Object.assign(hole.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
    } else hole.style.display = 'none';
    // 吹き出し: 切り抜きの下に入れば下、入らなければ上、どちらも無理なら画面の下寄せ
    const tw = Math.min(340, vw - 2 * 16);
    tip.style.width = tw + 'px';
    const th = tip.offsetHeight;
    let top;
    if (!r) top = (vh - th) / 2;
    else if (r.t + r.h + GAP + th <= vh - BOTTOM) top = r.t + r.h + GAP;
    else if (r.t - GAP - th >= 8) top = r.t - GAP - th;
    else top = Math.max(8, vh - BOTTOM - th);
    const cx = r ? r.l + r.w / 2 : vw / 2;
    tip.style.left = Math.max(16, Math.min(vw - 16 - tw, cx - tw / 2)) + 'px';
    tip.style.top = top + 'px';
  };
  const show = () => {
    const s = STEPS[i];
    if (menu) menu.open = !!s.menu;
    /** @type {HTMLElement} */ (root.querySelector('.bzg-step')).textContent = `${i + 1} / ${STEPS.length}`;
    /** @type {HTMLElement} */ (root.querySelector('.bzg-title')).textContent = i18n('card_back.guide.' + s.title);
    /** @type {HTMLElement} */ (root.querySelector('.bzg-body')).textContent = i18n('card_back.guide.' + s.body);
    prev.style.visibility = i ? '' : 'hidden';
    next.textContent = i === STEPS.length - 1 ? i18n('card_back.guide.done') : i18n('card_back.guide.next');
    // メニューの中の物はメニューごと (いちばん上の段)、ほかはその物を画面に入れてから
    const first = s.menu ? menu : s.targets().find(Boolean);
    if (first && first.scrollIntoView) first.scrollIntoView({ block: s.block || 'center', behavior: 'instant' });
    layout();
    // スクロールが終わってから置き直す (iPhone の Safari はすぐに終わらないことがある)
    setTimeout(layout, 120);
    next.focus({ preventScroll: true });
  };
  const close = () => {
    markSeen();
    if (menu) menu.open = false;
    root.remove();
    window.removeEventListener('resize', layout);
    window.removeEventListener('scroll', layout, true);
    document.removeEventListener('keydown', onKey, true);
    closeCur = null;
  };
  /** @param {KeyboardEvent} e */
  const onKey = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  /** @param {number} d */
  const go = d => {
    if (i + d >= STEPS.length) { close(); return; }
    i = Math.max(0, i + d);
    show();
  };
  next.addEventListener('click', () => go(1));
  prev.addEventListener('click', () => go(-1));
  skip.addEventListener('click', close);
  window.addEventListener('resize', layout);
  window.addEventListener('scroll', layout, true);
  document.addEventListener('keydown', onKey, true);
  closeCur = close;
  show();
}

/** 出す予定がある (待っている) か */
let pending = false;
/** 初めてなら、少し待って (裏返しの動きが終わってから) 裏の欄が見えていればガイドを出す。裏の欄を見せるたびに呼ぶ @param {HTMLElement} pane */
export function maybeStartGuide(pane) {
  if (pending || closeCur || guideSeen()) return;
  pending = true;
  setTimeout(() => {
    pending = false;
    if (!closeCur && !guideSeen() && pane.style.display !== 'none' && pane.offsetParent) startGuide();
  }, 700);
}
