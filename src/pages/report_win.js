// 試合結果の報告: 勝った側が報告したときの勝利の演出と勝利画面 (src/pages/report.js から呼ぶ)。
//   showVictory(v)  演出 → 止まって勝利画面 (自分と相手・スコア・キャラ絵文字・大会名・フェーズ・ラウンド・UF)。
//                   勝利画面には X に投稿・画像を保存・閉じる。閉じたら解ける
// 演出は WIN_ANIMS から毎回ランダム (?win=… で固定)。色はサイトと同じ白・濃いグレー・赤 (#dc2626)
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import { capturePng, safeFileName } from '../../site/share.js';
'use strict';

const i18n = SPSPI18n.t;

/** 演出の案 (slash = 赤い斜めの帯で切る / stamp = 判子 / stripes = 赤白の縞が流れる / burst = 放射の線)
 * 勝利画面の地は slash が濃いグレー、ほかは白 */
export const WIN_ANIMS = ['slash', 'stamp', 'stripes', 'burst'];

/**
 * @typedef {{ name: string, emoji: string }} WinSide
 * @typedef {{ me: WinSide, op: WinSide, score: [number, number], tour: string, phase: string, pool: string, round: string,
 *   uf: number, url: string, anim?: string }} Victory
 */

/** X (Twitter) の投稿の文 @param {Victory} v */
export function tweetText(v) {
  const where = [v.tour, [v.phase, v.pool, v.round].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return i18n('report.win.tweet', { where, op: v.op.name, s: v.score[0] + '-' + v.score[1] })
    + (v.uf >= 1 ? ' ' + i18n('report.win.tweet_uf', { n: v.uf }) : '');
}

/** 勝利画面の中身 (演出のあと止まる画面。画像で保存するのもこの箱) @param {Victory} v */
function panelHtml(v) {
  const where = [v.phase, v.pool, v.round].filter(Boolean).join(' · ');
  const side = (/** @type {WinSide} */ s, /** @type {string} */ cls) => `<div class="rp-win-side ${cls}">
      <span class="rp-win-em">${escapeHtml(s.emoji || '')}</span><span class="rp-win-nm">${escapeHtml(s.name)}</span></div>`;
  return `<div class="rp-win-panel" data-win-panel>
    <i class="rp-win-shine" aria-hidden="true" data-html2canvas-ignore></i>
    <div class="rp-win-word">WIN</div>
    ${v.tour ? `<div class="rp-win-tour">${escapeHtml(v.tour)}</div>` : ''}
    ${where ? `<div class="rp-win-round">${escapeHtml(where)}</div>` : ''}
    <div class="rp-win-vs">
      ${side(v.me, 'rp-win-me')}
      <div class="rp-win-score"><b>${v.score[0]}</b><span>-</span><b>${v.score[1]}</b></div>
      ${side(v.op, 'rp-win-op')}
    </div>
    ${v.uf >= 1 ? `<div class="rp-win-uf"><b>+${v.uf}</b><span>UF</span><em>${escapeHtml(i18n('report.win.uf_label'))}</em></div>` : ''}
    <div class="rp-win-site">spsp.games</div>
  </div>`;
}

/** 演出の飾り (案ごと) @param {string} anim */
function fxHtml(anim) {
  // どの案も、演出の間は大きな WIN (b) を出し、止まったら勝利画面と入れ替える。線 (i) は止まった後もうすく残って少し動く
  const fx = (/** @type {string} */ inner) => '<div class="rp-win-fx" aria-hidden="true">' + inner + '<b>WIN</b></div>';
  if (anim === 'stripes') return fx('<i></i>'.repeat(6));
  if (anim === 'burst') return fx('<i></i>');
  if (anim === 'stamp') return fx('');
  return fx('<i></i><i></i>');   // slash
}

/** 演出 → 勝利画面。閉じたら解ける @param {Victory} v @returns {Promise<void>} */
export function showVictory(v) {
  const anim = WIN_ANIMS.includes(v.anim || '') ? /** @type {string} */ (v.anim) : WIN_ANIMS[Math.floor(Math.random() * WIN_ANIMS.length)];
  const ov = document.createElement('div');
  ov.className = 'rp-win-ov rp-win-' + anim;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', i18n('report.win.aria'));
  ov.innerHTML = `${fxHtml(anim)}${panelHtml(v)}
    <div class="rp-win-actions">
      <button type="button" class="rp-btn rp-primary" data-win-tweet>${escapeHtml(i18n('report.win.tweet_btn'))}</button>
      <button type="button" class="rp-btn" data-win-save>${escapeHtml(i18n('report.win.save'))}</button>
      <button type="button" class="rp-btn" data-win-close>${escapeHtml(i18n('report.win.close'))}</button>
    </div>
    <div class="rp-win-skip">${escapeHtml(i18n('report.match_skip'))}</div>`;
  document.body.appendChild(ov);
  // 振動: 触れたことがあるときだけ (report.js のマッチングと同じ)
  const ua = /** @type {any} */ (navigator).userActivation;
  if (!ua || ua.hasBeenActive) { try { if (navigator.vibrate) navigator.vibrate([60, 40, 120]); } catch (e) { /* 震えないだけ */ } }
  // 演出 (約 1.6 秒) → 止まって勝利画面 (.still)。演出の間のタップで飛ばす
  const still = () => { if (!ov.classList.contains('still')) ov.classList.add('still'); };
  // 動きを減らす設定のときは、すぐ勝利画面
  const reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (reduce) still();
  const timer = setTimeout(still, 1700);
  ov.addEventListener('click', (e) => { if (!ov.classList.contains('still') && !(/** @type {HTMLElement} */ (e.target)).closest('button')) still(); });
  return new Promise((res) => {
    const close = () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      ov.classList.add('out');
      setTimeout(() => { ov.remove(); res(); }, 250);
    };
    const onKey = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (!ov.classList.contains('still') && ['Enter', ' '].includes(e.key)) { e.preventDefault(); still(); }
    };
    document.addEventListener('keydown', onKey);
    /** @type {HTMLButtonElement} */ (ov.querySelector('[data-win-close]')).addEventListener('click', close);
    /** @type {HTMLButtonElement} */ (ov.querySelector('[data-win-tweet]')).addEventListener('click', () => {
      const u = 'https://x.com/intent/tweet?text=' + encodeURIComponent(tweetText(v)) + (v.url ? '&url=' + encodeURIComponent(v.url) : '');
      window.open(u, '_blank', 'noopener');
    });
    const save = /** @type {HTMLButtonElement} */ (ov.querySelector('[data-win-save]'));
    save.addEventListener('click', async () => {
      save.disabled = true;
      const label = save.textContent;
      save.textContent = i18n('share.s2');
      try {
        const blob = await capturePng(/** @type {HTMLElement} */ (ov.querySelector('[data-win-panel]')));
        if (!blob) throw new Error('png');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = safeFileName('SPSP_win_' + v.me.name + '_vs_' + v.op.name) + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        alert(i18n('share.s3') + /** @type {Error} */ (err).message);
      } finally {
        save.disabled = false; save.textContent = label;
      }
    });
  });
}

export default { showVictory, tweetText, WIN_ANIMS };
