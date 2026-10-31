// 試合結果の報告: 勝った側が報告したときの勝利の演出と勝利画面 (src/pages/report.js から呼ぶ)。
//   showVictory(v)  演出 → 止まって勝利画面 (自分と相手・スコア・キャラ絵文字・大会名・フェーズ・ラウンド・UF)。
//                   勝利画面には X に投稿・画像を保存・閉じる。閉じたら解ける
// 色はサイトと同じ白と赤 (#dc2626) だけ (黒・グレーの地は使わない)。演出と勝利画面の組は WIN_ANIMS から毎回ランダム (?win=… で固定)
//   card     自分のプレイヤーカードが回って入り、赤いたすき「WIN」が掛かる → カードの下に結果 (カードはゆっくり浮く)
//   letters  W・I・N が 1 字ずつ入り、赤い細線が左右に伸びる → 白い結果の紙 (細線がゆっくり脈打つ)
//   ribbon   赤いリボンが横に走って「VICTORY」→ 上が赤い帯の結果 (帯の上を光が流れる)
//   confetti 赤とピンクの紙吹雪が弾けて WIN → 白い結果の紙 (紙吹雪がゆっくり降り続ける)
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import { capturePng, safeFileName } from '../../site/share.js';
import { cardSettled, mountNoDataCard, mountPlayerCard } from '../../site/js/player_card_embed.js';
'use strict';

const i18n = SPSPI18n.t;

export const WIN_ANIMS = ['card', 'letters', 'ribbon', 'confetti'];

/**
 * @typedef {{ name: string, emoji: string, uid?: string | null }} WinSide
 * @typedef {{ me: WinSide, op: WinSide, score: [number, number], tour: string, phase: string, pool: string, round: string,
 *   uf: number, url: string, anim?: string }} Victory
 */

/** X (Twitter) の投稿の文 @param {Victory} v */
export function tweetText(v) {
  const where = [v.tour, [v.phase, v.pool, v.round].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return i18n('report.win.tweet', { where, op: v.op.name, s: v.score[0] + '-' + v.score[1] })
    + (v.uf >= 1 ? ' ' + i18n('report.win.tweet_uf', { n: v.uf }) : '');
}

const where = (/** @type {Victory} */ v) => [v.phase, v.pool, v.round].filter(Boolean).join(' · ');
const em = (/** @type {WinSide} */ s) => `<span class="rp-win-em">${escapeHtml(s.emoji || '')}</span>`;
const ufHtml = (/** @type {Victory} */ v) => (v.uf >= 1 ? `<div class="rp-win-uf"><b>+${v.uf}</b><span>Upset Factor</span></div>` : '');
const scoreHtml = (/** @type {Victory} */ v) => `<div class="rp-win-score"><b>${v.score[0]}</b><i>-</i><b>${v.score[1]}</b></div>`;
const shine = '<i class="rp-win-shine" aria-hidden="true" data-html2canvas-ignore></i>';
const site = '<div class="rp-win-site">spsp.games</div>';

/** 勝利画面 (止まる画面。画像で保存するのもこの箱)。案ごとに形が違う @param {Victory} v @param {string} anim */
function panelHtml(v, anim) {
  const head = `${v.tour ? `<div class="rp-win-tour">${escapeHtml(v.tour)}</div>` : ''}${where(v) ? `<div class="rp-win-round">${escapeHtml(where(v))}</div>` : ''}`;
  const names = `<div class="rp-win-vs">
      <div class="rp-win-side rp-win-me">${em(v.me)}<span class="rp-win-nm">${escapeHtml(v.me.name)}</span></div>
      ${scoreHtml(v)}
      <div class="rp-win-side rp-win-op">${em(v.op)}<span class="rp-win-nm">${escapeHtml(v.op.name)}</span></div>
    </div>`;
  if (anim === 'card') {
    // 自分のカード + たすき。下に「vs 相手 2-1」と大会
    return `<div class="rp-win-panel rp-win-p-card" data-win-panel>
      <div class="rp-win-cardwrap"><div class="rp-win-pcard pcard"></div><div class="rp-win-sash"><span>WIN</span></div>${shine}</div>
      <div class="rp-win-strip">
        <div class="rp-win-line">${scoreHtml(v)}<span class="rp-win-against">vs ${em(v.op)}<span class="rp-win-nm">${escapeHtml(v.op.name)}</span></span></div>
        ${head}${ufHtml(v)}
      </div>${site}
    </div>`;
  }
  if (anim === 'ribbon') {
    // 上が赤い帯 (WIN)、下に白で結果
    return `<div class="rp-win-panel rp-win-p-band" data-win-panel>
      <div class="rp-win-band">${shine}<span class="rp-win-word">WIN</span></div>
      <div class="rp-win-body">${head}${names}${ufHtml(v)}${site}</div>
    </div>`;
  }
  // letters / confetti: 白い紙。上に WIN、赤い細線
  return `<div class="rp-win-panel rp-win-p-sheet" data-win-panel>
    ${shine}<div class="rp-win-word">WIN</div><div class="rp-win-rule"></div>${head}${names}${ufHtml(v)}${site}
  </div>`;
}

/** 演出の飾り @param {string} anim */
function fxHtml(anim) {
  if (anim === 'letters') return '<div class="rp-win-fx" aria-hidden="true"><i class="l"></i><i class="r"></i><b><span>W</span><span>I</span><span>N</span></b></div>';
  if (anim === 'ribbon') return '<div class="rp-win-fx" aria-hidden="true"><i class="rb"><span>VICTORY</span></i></div>';
  if (anim === 'confetti') {
    // 紙吹雪: 位置・色・回り方・落ちる速さを散らす (毎回同じ並び。見た目が安定するように)
    let h = '';
    for (let k = 0; k < 36; k++) {
      const x = (k * 37) % 100, d = 2.6 + ((k * 13) % 10) / 4, delay = -((k * 7) % 30) / 10, rot = (k * 47) % 360;
      const c = ['#dc2626', '#f87171', '#fecaca', '#ef4444'][k % 4];
      h += `<i class="cf" style="left:${x}%;--d:${d}s;--dl:${delay}s;--r:${rot}deg;--c:${c};--dx:${((k * 29) % 60) - 30}vw"></i>`;
    }
    return '<div class="rp-win-fx" aria-hidden="true">' + h + '<b>WIN</b></div>';
  }
  return '<div class="rp-win-fx" aria-hidden="true"></div>';   // card: 飾りはカードの上 (たすき)
}

/** 演出 → 勝利画面。閉じたら解ける @param {Victory} v @returns {Promise<void>} */
export async function showVictory(v) {
  const anim = WIN_ANIMS.includes(v.anim || '') ? /** @type {string} */ (v.anim) : WIN_ANIMS[Math.floor(Math.random() * WIN_ANIMS.length)];
  const ov = document.createElement('div');
  ov.className = 'rp-win-ov rp-win-' + anim;
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', i18n('report.win.aria'));
  ov.innerHTML = `${fxHtml(anim)}${panelHtml(v, anim)}
    <div class="rp-win-actions">
      <button type="button" class="rp-btn rp-primary" data-win-tweet>${escapeHtml(i18n('report.win.tweet_btn'))}</button>
      <button type="button" class="rp-btn" data-win-save>${escapeHtml(i18n('report.win.save'))}</button>
      <button type="button" class="rp-btn" data-win-close>${escapeHtml(i18n('report.win.close'))}</button>
    </div>
    <div class="rp-win-skip">${escapeHtml(i18n('report.match_skip'))}</div>`;
  document.body.appendChild(ov);
  // 演出 → 止まって勝利画面 (.still)。演出の間のタップで飛ばす (カードを読んでいる間も)。動きを減らす設定ならすぐ
  const still = () => { if (!ov.classList.contains('still')) ov.classList.add('go', 'still'); };
  ov.addEventListener('click', (e) => { if (!ov.classList.contains('still') && !(/** @type {HTMLElement} */ (e.target)).closest('button')) still(); });
  // card: カードを描いてフォントがそろってから動かす (たいてい VS のときに読み終えている。最大 1.5 秒)
  const cardEl = /** @type {HTMLElement | null} */ (ov.querySelector('.rp-win-pcard'));
  if (cardEl) {
    const nd = () => mountNoDataCard(cardEl, v.me.name);
    const mount = v.me.uid ? mountPlayerCard(cardEl, v.me.uid).then((ok) => { if (!ok) nd(); }).catch(nd) : Promise.resolve(nd());
    await Promise.race([mount.then(() => cardSettled(cardEl)), new Promise((r) => setTimeout(r, 1500))]);
  }
  ov.classList.add('go');
  // 振動: 触れたことがあるときだけ (report.js のマッチングと同じ)。飛ばしたときは鳴らさない
  const ua = /** @type {any} */ (navigator).userActivation;
  if (!ov.classList.contains('still') && (!ua || ua.hasBeenActive)) { try { if (navigator.vibrate) navigator.vibrate([60, 40, 120]); } catch (e) { /* 震えないだけ */ } }
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) still();
  const timer = setTimeout(still, anim === 'card' ? 1900 : 1700);
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
