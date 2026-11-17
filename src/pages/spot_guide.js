// @ts-check
// src/pages/spot_guide.js — 使い方ガイドの共通の動き (カード編集の裏面のガイド card_back_guide.js と同じ形。2026-11-17)
//   1 段ずつ、本物の欄を明るく切り抜いて (ほかは暗く) 説明の吹き出しを出す。欄の無い段 (targets なし) は画面の中央に出す
//   ガイドの間は画面の操作は止める。live の段だけは、切り抜いた欄をそのまま操作できる (設定の欄など。吹き出しに labels.live を添える)。閉じる・最後まで進むと見たことにする (端末ごと、localStorage の seenKey)
//   optional の段は、その欄が画面に無ければ飛ばす (ログイン前・後で欄が違う画面用)
//   once の段 (ほかの画面・ガイドと同じ内容の段) は、一度出したら自動で出すときは飛ばす (localStorage の once のキー)。ボタンから出し直すときは全部
//   見た目は css/spot_guide.css (.spg)
const GAP = 12;

/** @typedef {{ title: string, body: string, targets?: () => (Element | null)[], optional?: boolean, once?: string, live?: boolean, block?: ScrollLogicalPosition }} SpotStep */

/** once の段を見たか・見たことにする (ガイドの外で同じ内容を見せたときにも使う) @param {string} key */
export const onceSeen = key => { try { return localStorage.getItem(key) === '1'; } catch (e) { return false; } };
/** @param {string} key */
export const markOnce = key => { try { localStorage.setItem(key, '1'); } catch (e) { /* 次も出る */ } };

/** @param {{ seenKey: string, steps: () => SpotStep[], labels: { prev: string, next: string, done: string, skip: string, live?: string }, bottom?: number }} o */
export function createGuide(o) {
  const BOTTOM = o.bottom || 0;
  const seen = () => { try { return localStorage.getItem(o.seenKey) === '1'; } catch (e) { return true; } };
  const markSeen = () => { try { localStorage.setItem(o.seenKey, '1'); } catch (e) { /* 次も出る */ } };
  /** @type {(() => void) | null} */
  let closeCur = null;
  const shown = (/** @type {Element | null} */ e) => !!e && !e.closest('[hidden]');

  /** @param {boolean} [auto] 自動で出すとき = 一度見た once の段は飛ばす */
  function start(auto) {
    if (closeCur) closeCur();
    const STEPS = o.steps().filter(s => (!s.optional || !s.targets || s.targets().some(shown)) && !(auto && s.once && onceSeen(s.once)));
    if (!STEPS.length) return;
    const root = document.createElement('div');
    root.className = 'spg';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = '<div class="spg-shield"></div><div class="spg-hole"></div><div class="spg-tip" role="document"><div class="spg-step"></div><div class="spg-title"></div>' +
      '<div class="spg-body"></div><div class="spg-live" hidden></div><div class="spg-btns"><button type="button" class="spg-skip"></button><span class="spg-sp"></span>' +
      '<button type="button" class="spg-prev"></button><button type="button" class="spg-next"></button></div></div>';
    document.body.appendChild(root);
    // 覆いは CSS が古い (キャッシュ) ときにも効くように、ここでも置く。live でない段はどのボタンも押せない
    root.style.pointerEvents = 'none';
    for (const sel of ['.spg-shield', '.spg-tip']) /** @type {HTMLElement} */ (root.querySelector(sel)).style.pointerEvents = 'auto';
    Object.assign(/** @type {HTMLElement} */ (root.querySelector('.spg-shield')).style, { position: 'fixed', inset: '0' });
    const hole = /** @type {HTMLElement} */ (root.querySelector('.spg-hole'));
    const shield = /** @type {HTMLElement} */ (root.querySelector('.spg-shield'));
    const liveNote = /** @type {HTMLElement} */ (root.querySelector('.spg-live'));
    const tip = /** @type {HTMLElement} */ (root.querySelector('.spg-tip'));
    const prev = /** @type {HTMLButtonElement} */ (root.querySelector('.spg-prev'));
    const next = /** @type {HTMLButtonElement} */ (root.querySelector('.spg-next'));
    const skip = /** @type {HTMLButtonElement} */ (root.querySelector('.spg-skip'));
    prev.textContent = o.labels.prev;
    skip.textContent = o.labels.skip;
    for (const t of ['pointerdown', 'pointerup', 'click', 'touchstart', 'wheel']) {
      root.addEventListener(t, e => { e.stopPropagation(); if (t !== 'wheel' && t !== 'touchstart' && !(/** @type {HTMLElement} */ (e.target)).closest('button')) e.preventDefault(); }, { passive: false });
    }
    let i = 0;
    const els = () => ((STEPS[i].targets ? /** @type {() => (Element | null)[]} */ (STEPS[i].targets)() : []).filter(shown));
    /** 切り抜く四角 (画面の座標、見えている所だけ) */
    const rectOf = () => {
      const rs = els().map(e => /** @type {Element} */ (e).getBoundingClientRect()).filter(r => r.width || r.height);
      if (!rs.length) return null;
      const vh = window.innerHeight;
      const l = Math.min(...rs.map(r => r.left)), t = Math.max(0, Math.min(...rs.map(r => r.top)));
      const rr = Math.max(...rs.map(r => r.right)), b = Math.min(vh - BOTTOM + 8, Math.max(...rs.map(r => r.bottom)));
      return { l: l - 6, t: t - 6, w: rr - l + 12, h: Math.max(0, b - t) + 12 };
    };
    const layout = () => {
      const r = rectOf();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      hole.classList.toggle('spg-none', !r);
      if (r) Object.assign(hole.style, { left: r.l + 'px', top: r.t + 'px', width: r.w + 'px', height: r.h + 'px' });
      else Object.assign(hole.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
      // live の段: 切り抜きの中だけ、下の画面に届くようにする (覆いに穴を開ける)
      const x0 = r ? Math.max(0, r.l) : 0, y0 = r ? Math.max(0, r.t) : 0, x1 = r ? r.l + r.w : 0, y1 = r ? r.t + r.h : 0;
      shield.style.clipPath = r && STEPS[i].live
        ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x0}px ${y0}px, ${x1}px ${y0}px, ${x1}px ${y1}px, ${x0}px ${y1}px, ${x0}px ${y0}px)` : '';
      // 吹き出し: 切り抜きの下に入れば下、入らなければ上、どちらも無理なら画面の下寄せ。欄の無い段は中央
      const tw = Math.min(340, vw - 2 * 16);
      tip.style.width = tw + 'px';
      const th = tip.offsetHeight;
      let top;
      if (!r) top = Math.max(8, (vh - th) / 2);
      else if (r.t + r.h + GAP + th <= vh - BOTTOM) top = r.t + r.h + GAP;
      else if (r.t - GAP - th >= 8) top = r.t - GAP - th;
      else top = Math.max(8, vh - BOTTOM - th - 8);
      const cx = r ? r.l + r.w / 2 : vw / 2;
      tip.style.left = Math.max(16, Math.min(vw - 16 - tw, cx - tw / 2)) + 'px';
      tip.style.top = top + 'px';
    };
    const show = () => {
      const s = STEPS[i];
      if (s.once) markOnce(s.once);
      /** @type {HTMLElement} */ (root.querySelector('.spg-step')).textContent = `${i + 1} / ${STEPS.length}`;
      /** @type {HTMLElement} */ (root.querySelector('.spg-title')).textContent = s.title;
      /** @type {HTMLElement} */ (root.querySelector('.spg-body')).textContent = s.body;
      liveNote.textContent = o.labels.live || '';
      liveNote.hidden = !(s.live && o.labels.live);
      prev.style.visibility = i ? '' : 'hidden';
      next.textContent = i === STEPS.length - 1 ? o.labels.done : o.labels.next;
      const first = els()[0];
      if (first && first.scrollIntoView) first.scrollIntoView({ block: s.block || 'center', behavior: 'instant' });
      layout();
      setTimeout(layout, 120);   // スクロールが終わってから置き直す (iPhone の Safari)
      next.focus({ preventScroll: true });
    };
    const close = () => {
      markSeen();
      root.remove();
      window.removeEventListener('resize', layout);
      window.removeEventListener('scroll', layout, true);
      document.removeEventListener('keydown', onKey, true);
      for (const t of ['click', 'change', 'input']) document.removeEventListener(t, relayout, true);
      closeCur = null;
    };
    /** 欄を操作して形が変わったら、切り抜きを置き直す */
    const relayout = () => { setTimeout(layout, 60); setTimeout(layout, 400); };
    /** @param {KeyboardEvent} e */
    const onKey = e => {
      // live の段で欄の中を操作しているキーはそのまま通す (Esc だけはガイドを閉じる)
      if (e.key !== 'Escape' && STEPS[i].live && els().some(x => /** @type {Element} */ (x).contains(/** @type {Node} */ (e.target)))) return;
      const onBtn = !!(/** @type {HTMLElement} */ (e.target)).closest && !!(/** @type {HTMLElement} */ (e.target)).closest('.spg button');
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && onBtn) { e.stopPropagation(); return; }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else { if (e.key !== 'Tab') e.stopPropagation(); return; }
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
    for (const t of ['click', 'change', 'input']) document.addEventListener(t, relayout, true);
    closeCur = close;
    show();
  }

  let pending = false;
  /** 初めてなら少し待って出す (画面を組み立て終わってから) @param {number} [delay] */
  function maybeStart(delay) {
    if (pending || closeCur || seen()) return;
    pending = true;
    setTimeout(() => { pending = false; if (!closeCur && !seen()) start(true); }, delay === undefined ? 500 : delay);
  }
  return { seen, start, maybeStart, close: () => { if (closeCur) closeCur(); } };
}
