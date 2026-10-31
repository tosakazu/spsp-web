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
import { safeFileName } from '../../site/share.js';
import { cardSettled, mountNoDataCard, mountPlayerCard } from '../../site/js/player_card_embed.js';
import { capture as captureCard } from '../../site/js/player_card.js';
'use strict';

const i18n = SPSPI18n.t;

export const WIN_ANIMS = ['card', 'letters', 'ribbon', 'confetti'];

/**
 * @typedef {{ name: string, emoji: string, uid?: string | null }} WinSide
 * @typedef {{ phase: string, side: 'w' | 'l' | null }} Advance  次のフェーズへの進出 (side = そのフェーズの勝者側 / 敗者側)
 * @typedef {{ me: WinSide, op: WinSide, score: [number, number], tour: string, phase: string, pool: string, round: string,
 *   uf: number, url: string, anim?: string, advance?: Advance | null }} Victory
 */

/** X (Twitter) の投稿の文 @param {Victory} v */
export function tweetText(v) {
  const where = [v.tour, [v.phase, v.pool, v.round].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  return i18n('report.win.tweet', { where, op: v.op.name, s: v.score[0] + '-' + v.score[1] })
    + (v.uf >= 1 ? ' ' + i18n('report.win.tweet_uf', { n: v.uf }) : '')
    + (v.advance ? '\n' + advText(v.advance) : '');
}

/** 「Top 32 進出 (勝者側)」 @param {Advance} a */
function advText(a) {
  const side = a.side === 'w' ? i18n('report.win.side_w') : a.side === 'l' ? i18n('report.win.side_l') : '';
  return i18n('report.win.advance', { phase: a.phase }) + (side ? ' (' + side + ')' : '');
}
/** 進出の札 (勝利画面の中) @param {Advance} a */
function advHtml(a) {
  const side = a.side === 'w' ? i18n('report.win.side_w') : a.side === 'l' ? i18n('report.win.side_l') : '';
  return `<b>${escapeHtml(i18n('report.win.advance', { phase: a.phase }))}</b>${side ? `<span class="rp-win-adv-side">${escapeHtml(side)}</span>` : ''}`;
}
/** @param {Advance | null | undefined} a */
const sideText = (a) => (!a ? '' : a.side === 'w' ? i18n('report.win.side_w') : a.side === 'l' ? i18n('report.win.side_l') : '');

const where = (/** @type {Victory} */ v) => [v.phase, v.pool, v.round].filter(Boolean).join(' · ');
const em = (/** @type {WinSide} */ s) => `<span class="rp-win-em">${escapeHtml(s.emoji || '')}</span>`;
const ufHtml = (/** @type {Victory} */ v) => (v.uf >= 1 ? `<div class="rp-win-uf"><b>+${v.uf}</b><span>UPSET FACTOR</span></div>` : '');
const scoreHtml = (/** @type {Victory} */ v) => `<div class="rp-win-score"><b>${v.score[0]}</b><i>-</i><b>${v.score[1]}</b></div>`;
const shine = '<i class="rp-win-shine" aria-hidden="true"></i>';
const site = '<div class="rp-win-site">spsp.games</div>';
const advSlot = (/** @type {Victory} */ v) => `<div class="rp-win-adv"${v.advance ? '' : ' hidden'}>${v.advance ? advHtml(v.advance) : ''}</div>`;
const tags = (/** @type {Victory} */ v) => `<div class="rp-win-tags">${advSlot(v)}${ufHtml(v)}</div>`;
const lbl = (/** @type {string} */ t) => `<div class="rp-win-lbl">${t}</div>`;

/** 勝利画面 (止まる画面)。カードと同じ作り (角ばった赤い枠・赤い帯)。案ごとに形が違う @param {Victory} v @param {string} anim */
function panelHtml(v, anim) {
  const tour = v.tour ? `<div class="rp-win-tour">${escapeHtml(v.tour)}</div>` : '';
  const round = where(v) ? `<div class="rp-win-round">${escapeHtml(where(v))}</div>` : '';
  const vs = `<div class="rp-win-vs">
      <div class="rp-win-side rp-win-me">${em(v.me)}<span class="rp-win-nm">${escapeHtml(v.me.name)}</span></div>
      ${scoreHtml(v)}
      <div class="rp-win-side rp-win-op">${em(v.op)}<span class="rp-win-nm">${escapeHtml(v.op.name)}</span></div>
    </div>`;
  if (anim === 'card') {
    // 自分のカード (そのまま) + たすき。下に結果
    return `<div class="rp-win-panel rp-win-p-card" data-win-panel>
      <div class="rp-win-cardwrap"><div class="rp-win-pcard pcard"></div><div class="rp-win-sash"><span>WIN</span></div></div>
      <div class="rp-win-strip">
        <div class="rp-win-line">${scoreHtml(v)}<span class="rp-win-against"><em>VS</em>${em(v.op)}<span class="rp-win-nm">${escapeHtml(v.op.name)}</span></span></div>
        ${tour}${round}${tags(v)}${site}
      </div>
    </div>`;
  }
  // ribbon = 赤い帯に白の WIN / letters・confetti = 白地に赤の WIN と赤い線。どちらも赤い枠
  const band = anim === 'ribbon';
  return `<div class="rp-win-panel rp-win-p-board${band ? ' rp-win-p-band' : ''}" data-win-panel>
    <div class="rp-win-head">${band ? shine : ''}<span class="rp-win-word">WIN</span>${round}</div>
    <div class="rp-win-body">${tour}${lbl('RESULT')}${vs}${tags(v)}${site}</div>
    ${band ? '' : shine}
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

// ── 画像で保存 (1200×675、X の画像と同じ横長) ─────────────────────────────────
// 画面を撮る (html2canvas) と、縮小・回転・動き・光がそのまま写って崩れるので、保存用の画像は Canvas で描く。
// カードの案は、カードだけカードの撮り方 (player_card.js の capture、原寸を 3 倍) で撮って貼る
const IW = 1200, IH = 675, RED = '#df1b1b', GRAY = '#626262', PALE = '#f3f3f3';
const F_EXP = '"Zalando Sans Expanded", sans-serif', F_Z = '"Zalando Sans", sans-serif', F_JP = '"IBM Plex Sans JP", "Hiragino Sans", sans-serif';

/** 幅 maxW に入るまで文字を小さくして描く @param {CanvasRenderingContext2D} ctx */
function fitText(ctx, text, x, y, maxW, font, px, minPx) {
  let p = px;
  for (; p > minPx; p -= 2) { ctx.font = font.replace('{px}', p + 'px'); if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = font.replace('{px}', p + 'px');
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  ctx.fillText(t === text ? t : t.slice(0, -1) + '…', x, y);
}
/** 字間をあけて描く (英字の小見出し) @param {CanvasRenderingContext2D} ctx */
function spaced(ctx, text, x, y, gap) {
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + gap; }
  return cx - gap;
}
/** 赤い札 (右の端を斜めに切る) と白抜きの札。右端の x を返す @param {CanvasRenderingContext2D} ctx */
function tag(ctx, x, y, h, text, font, fill) {
  ctx.font = font;
  const w = ctx.measureText(text).width + 36;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w + 12, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  if (fill) { ctx.fillStyle = RED; ctx.fill(); ctx.fillStyle = '#fff'; } else { ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = RED; ctx.stroke(); ctx.fillStyle = RED; }
  ctx.textBaseline = 'middle'; ctx.fillText(text, x + 18, y + h / 2 + 1); ctx.textBaseline = 'alphabetic';
  return x + w + 12;
}

/** 保存用の画像 @param {Victory} v @param {HTMLElement | null} cardEl カードの案ならカードの箱 @returns {Promise<Blob | null>} */
export async function victoryPng(v, cardEl) {
  const fonts = /** @type {any} */ (document).fonts;
  const all = [v.me.name, v.op.name, v.tour, where(v), v.advance ? i18n('report.win.advance', { phase: v.advance.phase }) + sideText(v.advance) : ''].join(' ');
  if (fonts && fonts.load) {
    await Promise.all([`700 40px ${F_JP}`, `500 40px ${F_JP}`, `italic 900 40px ${F_Z}`, `800 40px ${F_Z}`, `500 20px ${F_EXP}`, `600 20px ${F_EXP}`]
      .map((ft) => fonts.load(ft, all + ' WIN RESULT UPSET FACTOR spsp.games 0123456789+-').catch(() => null)));
  }
  let cardImg = null;
  if (cardEl && cardEl.querySelector('.pc-in')) {
    const b = await captureCard(cardEl).catch(() => null);
    if (b) cardImg = await createImageBitmap(b).catch(() => null);
  }
  const cv = document.createElement('canvas');
  cv.width = IW; cv.height = IH;
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  ctx.fillStyle = PALE; ctx.fillRect(0, 0, IW, IH);
  // 上の赤い帯: WIN と、大会・ラウンド
  const HB = 150;
  ctx.fillStyle = RED; ctx.fillRect(0, 0, IW, HB);
  ctx.fillStyle = '#fff'; ctx.font = `italic 900 132px ${F_Z}`; ctx.fillText('WIN', 44, 128);
  const hx = 360, hw = IW - hx - 48;
  ctx.textAlign = 'right';
  if (v.tour) { ctx.fillStyle = '#fff'; fitText(ctx, v.tour, IW - 48, 70, hw, `700 {px} ${F_JP}`, 34, 18); }
  if (where(v)) { ctx.fillStyle = 'rgba(255,255,255,.82)'; fitText(ctx, where(v).toUpperCase(), IW - 48, 116, hw, `500 {px} ${F_EXP}`, 22, 14); }
  ctx.textAlign = 'left';
  // 中: 両者とスコア (カードの案は左にカード、右に結果)
  const tagY = 548;
  const scoreAt = (cx, y, px) => {
    ctx.font = `italic 900 ${px}px ${F_Z}`; ctx.textBaseline = 'alphabetic';
    const a = String(v.score[0]), b = String(v.score[1]), d = '-';
    const wa = ctx.measureText(a).width, wb = ctx.measureText(b).width;
    ctx.font = `500 ${px * .45}px ${F_Z}`; const wd = ctx.measureText(d).width + 24;
    let x = cx - (wa + wd + wb) / 2;
    ctx.font = `italic 900 ${px}px ${F_Z}`; ctx.fillStyle = RED; ctx.fillText(a, x, y); x += wa;
    ctx.font = `500 ${px * .45}px ${F_Z}`; ctx.fillStyle = '#c9c9c9'; ctx.fillText(d, x + 12, y - px * .22); x += wd;
    ctx.font = `italic 900 ${px}px ${F_Z}`; ctx.fillStyle = '#e8a3a3'; ctx.fillText(b, x, y);
  };
  ctx.fillStyle = GRAY; ctx.font = `600 18px ${F_EXP}`;
  if (cardImg) {
    // カード (514×333 の比) を左に。赤い枠はカードが持っている
    const cw = 560, ch = Math.round(cw * 333 / 514), cx = 44, cy = HB + 30;
    ctx.drawImage(cardImg, cx, cy, cw, ch);
    // たすき
    ctx.save(); ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
    ctx.translate(cx + cw - 70, cy + 62); ctx.rotate(35 * Math.PI / 180);
    ctx.fillStyle = '#fff'; ctx.fillRect(-150, -30, 300, 60);
    ctx.fillStyle = RED; ctx.fillRect(-150, -24, 300, 48);
    ctx.fillStyle = '#fff'; ctx.font = `italic 900 34px ${F_Z}`; ctx.textAlign = 'center'; ctx.fillText('WIN', 0, 12); ctx.textAlign = 'left';
    ctx.restore();
    const rx = 650, rw = IW - rx - 48;
    ctx.fillStyle = GRAY; ctx.font = `600 18px ${F_EXP}`; spaced(ctx, 'RESULT', rx, HB + 62, 3);
    scoreAt(rx + rw / 2, HB + 210, 150);
    ctx.fillStyle = GRAY; ctx.font = `600 18px ${F_EXP}`; spaced(ctx, 'VS', rx, HB + 280, 3);
    ctx.fillStyle = '#222'; ctx.font = `64px ${F_JP}`;
    let nx = rx;
    if (v.op.emoji) { ctx.fillText(v.op.emoji, rx, HB + 352); nx = rx + 84; }
    ctx.fillStyle = '#222'; fitText(ctx, v.op.name, nx, HB + 340, IW - 48 - nx, `700 {px} ${F_JP}`, 40, 20);
  } else {
    ctx.fillStyle = GRAY; ctx.font = `600 18px ${F_EXP}`; spaced(ctx, 'RESULT', 48, HB + 52, 3);
    const side = (/** @type {WinSide} */ p, cx, me) => {
      // キャラ絵文字の四角 (自分は赤い下線)
      ctx.fillStyle = '#fff'; ctx.fillRect(cx - 60, HB + 90, 120, 120);
      if (me) { ctx.fillStyle = RED; ctx.fillRect(cx - 60, HB + 202, 120, 8); }
      if (p.emoji) { ctx.font = `72px ${F_JP}`; ctx.textAlign = 'center'; ctx.fillStyle = '#222'; ctx.fillText(p.emoji, cx, HB + 177); }
      ctx.textAlign = 'center'; ctx.fillStyle = me ? '#111' : GRAY;
      fitText(ctx, p.name, cx, HB + 270, 340, `${me ? 700 : 500} {px} ${F_JP}`, 40, 20);
      ctx.textAlign = 'left';
    };
    side(v.me, 230, true);
    side(v.op, IW - 230, false);
    scoreAt(IW / 2, HB + 230, 170);
  }
  // 下: 進出・UF の札、サイト
  let x = cardImg ? 650 : 48;
  if (v.advance) {
    x = tag(ctx, x, tagY, 58, i18n('report.win.advance', { phase: v.advance.phase }), `700 28px ${F_JP}`, true) + 10;
    if (sideText(v.advance)) x = tag(ctx, x, tagY, 58, sideText(v.advance), `700 24px ${F_JP}`, false) + 10;
  }
  if (v.uf >= 1) {
    ctx.font = `800 34px ${F_Z}`;
    const t1 = '+' + v.uf; const w1 = ctx.measureText(t1).width;
    ctx.font = `600 15px ${F_EXP}`; const w2 = ctx.measureText('UPSET FACTOR').width + 11 * 2;
    const w = w1 + w2 + 48;
    ctx.fillStyle = '#fff'; ctx.fillRect(x, tagY, w, 58); ctx.lineWidth = 3; ctx.strokeStyle = RED; ctx.strokeRect(x + 1.5, tagY + 1.5, w - 3, 55);
    ctx.fillStyle = RED; ctx.font = `800 34px ${F_Z}`; ctx.fillText(t1, x + 18, tagY + 42);
    ctx.font = `600 15px ${F_EXP}`; spaced(ctx, 'UPSET FACTOR', x + 30 + w1, tagY + 37, 2);
  }
  ctx.fillStyle = GRAY; ctx.font = `500 20px ${F_Z}`; ctx.textAlign = 'right'; ctx.fillText('spsp.games', IW - 44, IH - 32); ctx.textAlign = 'left';
  // 外の赤い枠 (カードと同じ)
  ctx.lineWidth = 12; ctx.strokeStyle = RED; ctx.strokeRect(6, 6, IW - 12, IH - 12);
  return new Promise((r) => cv.toBlob(r, 'image/png'));
}

/** 演出 → 勝利画面。閉じたら解ける。advance = 次のフェーズへの進出 (報告の後に start.gg を読み直して分かる。分かったら札を出す)
 * @param {Victory} v @param {Promise<Advance | null>} [advance] @returns {Promise<void>} */
export async function showVictory(v, advance) {
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
  if (advance) advance.then((a) => {
    if (!a || !ov.isConnected) return;
    v.advance = a;   // X の投稿の文にも入れる
    const el = /** @type {HTMLElement} */ (ov.querySelector('.rp-win-adv'));
    el.innerHTML = advHtml(a);
    el.hidden = false;
  }).catch(() => { /* 出さないだけ */ });
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
        const blob = await victoryPng(v, cardEl);
        if (!blob) throw new Error('png');
        const name = safeFileName('SPSP_win_' + v.me.name + '_vs_' + v.op.name) + '.png';
        // スマホ: 共有シート (画像を保存・X に画像つきで投稿などを選べる)。無ければダウンロード
        const file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
        const nav = /** @type {any} */ (navigator);
        if (file && nav.canShare && nav.canShare({ files: [file] })) {
          try { await nav.share({ files: [file], text: tweetText(v) + (v.url ? '\n' + v.url : '') }); return; }
          catch (e) { if (/** @type {Error} */ (e).name === 'AbortError') return; }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
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
