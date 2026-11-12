// @ts-check
// card_flip.js — ほかのページに置いたプレイヤーカード (js/player_card_embed.js) を、プレイヤーページと同じように指・マウスで動かす (2026-11-12)。
//   attachCardFlip(wrap, front, back)  wrap = .pcard-wrap (中に .pcard-flip > 表・裏)。
//     ゆっくり動かすと傾いて裏面のシールが光り (.pc-tilt、光の層は js/player_card.js ensureGlow)、横にはじくと裏返る。縦の動きはページのスクロール。
//     裏の準備ができるまで (.pc-wait、右上に小さなグルグル = css/player_card.css) は動かせない。戻り値:
//       ready()  裏の準備ができた (動かせるようにする)
//       intro()  裏返して裏を見せ、少ししたら表に戻す (1 回だけ。触ったら止める)
//       setFlipped(on) / flipped()
// 動きと数値はプレイヤーページ (src/pages/p.js) と同じ。そちらを変えたらここも合わせる
import SPSPPlayerCard from './player_card.js';

const FLICK_PX = 40;        // はじいたとみなす横の距離 (画面の px)
const FLICK_V = 0.45;       // と速さ (px/ms、離す直前 80ms)
const TILT_DEG = 30;        // 傾きの最大 (端を押したとき)
const IDLE_MS = 1500;       // 傾けたまま指が動かなければまっすぐに戻す
const FLIP_MS = 500, SHOW_MS = 1200;

/** @param {HTMLElement} wrap @param {HTMLElement} front @param {HTMLElement} back
 * @param {{ onFlip?: (on: boolean) => void }} [opts] */
export function attachCardFlip(wrap, front, back, opts = {}) {
  wrap.classList.add('pc-wait');
  const setFlipped = (/** @type {boolean} */ on) => {
    wrap.classList.toggle('flipped', on);
    front.setAttribute('aria-hidden', String(on));
    back.setAttribute('aria-hidden', String(!on));
    if (opts.onFlip) opts.onFlip(on);
  };
  const flipped = () => wrap.classList.contains('flipped');

  // ── 紹介: wait (裏返す前) → toBack → back (裏を見せている) → toFront → 終わり。触ったら止める ──
  /** @type {'' | 'wait' | 'toBack' | 'back' | 'toFront'} */
  let introPhase = '';
  let introDone = false;
  /** @type {ReturnType<typeof setTimeout>[]} */
  let introTimers = [];
  const intro = () => {
    if (introDone) return;
    introDone = true;
    if (flipped()) return;   // もう自分で裏返している
    introPhase = 'wait';
    const at = (/** @type {number} */ ms, /** @type {() => void} */ fn) => introTimers.push(setTimeout(fn, ms));
    at(300, () => { introPhase = 'toBack'; setFlipped(true); });
    at(300 + FLIP_MS, () => { introPhase = 'back'; });
    at(300 + FLIP_MS + SHOW_MS, () => { introPhase = 'toFront'; setFlipped(false); });
    at(300 + FLIP_MS * 2 + SHOW_MS, () => { introPhase = ''; });
  };
  wrap.addEventListener('pointerdown', () => {
    if (introDone && !introPhase) return;
    introDone = true;
    introTimers.forEach(clearTimeout);
    introTimers = [];
    const was = introPhase;
    introPhase = '';
    if (was === 'toBack') setFlipped(false);
    else if (was === 'toFront') setFlipped(true);
  }, { capture: true });

  // ── 指・マウスで動かす ──
  /** @type {null | { id: number, x0: number, y0: number, pts: { x: number, t: number }[], moved: boolean }} */
  let g = null;
  let suppressClick = false;
  const clamp01 = (/** @type {number} */ v) => Math.max(0, Math.min(1, v));
  /** @type {HTMLElement[]} */
  let varEls = [];
  let pending = /** @type {{ x: number, y: number } | null} */ (null);
  let raf = 0;
  const applyTilt = () => {
    raf = 0;
    if (!pending || !g) { pending = null; return; }
    const { x: cx, y: cy } = pending;
    pending = null;
    const r = wrap.getBoundingClientRect();
    const mx = clamp01((cx - r.left) / r.width), my = clamp01((cy - r.top) / r.height);
    for (const el of varEls) {
      el.style.setProperty('--card-mx', mx.toFixed(3));
      el.style.setProperty('--card-my', my.toFixed(3));
    }
    wrap.style.transform = `perspective(900px) rotateX(${((0.5 - my) * TILT_DEG).toFixed(2)}deg) rotateY(${((mx - 0.5) * TILT_DEG).toFixed(2)}deg)`;
  };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let idleTimer = null;
  const release = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    wrap.classList.remove('pc-tilt');
    wrap.style.transition = 'transform .35s ease';
    wrap.style.transform = '';
    setTimeout(() => { if (!g) wrap.style.transition = ''; }, 400);
  };
  const tilt = (/** @type {number} */ cx, /** @type {number} */ cy) => {
    pending = { x: cx, y: cy };
    if (!raf) raf = requestAnimationFrame(applyTilt);
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      pending = null;
      g = null;
      release();
    }, IDLE_MS);
  };
  const startTilt = () => {
    SPSPPlayerCard.ensureGlow(back);
    varEls = /** @type {HTMLElement[]} */ ([...wrap.querySelectorAll('.pcard, .pcb-glow')]);
  };
  wrap.addEventListener('pointerdown', e => {
    if (g || (e.pointerType === 'mouse' && e.button !== 0) || wrap.classList.contains('pc-wait')) return;
    g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, pts: [{ x: e.clientX, t: e.timeStamp }], moved: false };
    wrap.style.transition = 'none';
  });
  wrap.addEventListener('pointermove', e => {
    if (!g || e.pointerId !== g.id) return;
    g.pts.push({ x: e.clientX, t: e.timeStamp });
    while (g.pts.length > 2 && e.timeStamp - g.pts[0].t > 80) g.pts.shift();
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 6) {
      g.moved = true;
      startTilt();
      wrap.classList.add('pc-tilt');
      try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても動く */ }
    }
    if (g.moved) tilt(e.clientX, e.clientY);
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!g || e.pointerId !== g.id) return;
    const cur = g;
    g = null;
    if (!cur.moved) { wrap.style.transition = ''; return; }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 350);
    const dx = e.clientX - cur.x0, dy = e.clientY - cur.y0;
    const p0 = cur.pts[0], dt = Math.max(1, e.timeStamp - p0.t);
    const vx = (e.clientX - p0.x) / dt;
    release();
    if (e.type === 'pointerup' && Math.abs(dx) > FLICK_PX && Math.abs(vx) > FLICK_V && Math.abs(dx) > Math.abs(dy) * 1.2) setFlipped(!flipped());
  };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  // 動かしたあとのクリックは何も起こさない
  wrap.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);

  return { ready: () => wrap.classList.remove('pc-wait'), intro, setFlipped, flipped };
}

export default { attachCardFlip };
