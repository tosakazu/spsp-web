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

/** 「勝者側Top 32進出」(側が分からなければ「Top 32進出」) @param {Advance} a */
function advText(a) {
  if (a.side === 'w') return i18n('report.win.advance_w', { phase: a.phase });
  if (a.side === 'l') return i18n('report.win.advance_l', { phase: a.phase });
  return i18n('report.win.advance', { phase: a.phase });
}
/** 進出の札 (勝利画面の中)。赤い台形 1 枚 @param {Advance} a */
const advHtml = (a) => `<b class="rp-win-tag">${escapeHtml(advText(a))}</b>`;

/** 共有のアイコン (箱から上向きの矢印) */
const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square">'
  + '<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v8h14v-8"/></svg>';
const where = (/** @type {Victory} */ v) => [v.phase, v.pool, v.round].filter(Boolean).join(' ');
const em = (/** @type {WinSide} */ s) => `<span class="rp-win-em">${escapeHtml(s.emoji || '')}</span>`;
const ufHtml = (/** @type {Victory} */ v) => (v.uf >= 1 ? `<div class="rp-win-uf rp-win-tag"><b>+${v.uf}</b><span>UPSET FACTOR</span></div>` : '');
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
const F_EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** 幅 maxW に入るまで文字を小さくして描く @param {CanvasRenderingContext2D} ctx */
function fitText(ctx, text, x, y, maxW, font, px, minPx) {
  let p = px;
  for (; p > minPx; p -= 2) { ctx.font = font.replace('{px}', p + 'px'); if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = font.replace('{px}', p + 'px');
  let t = text;
  while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  ctx.fillText(t === text ? t : t.slice(0, -1) + '…', x, y);
}
/** 自分の名前: 大きく 1 行で入らなければ 2 行 (字で折る)、それでも入らなければ小さくして末尾を … @param {CanvasRenderingContext2D} ctx */
function nameLines(ctx, text, x, y, maxW, font) {
  ctx.font = font.replace('{px}', '52px');
  if (ctx.measureText(text).width <= maxW) { ctx.fillText(text, x, y); return; }
  for (const px of [40, 34]) {
    ctx.font = font.replace('{px}', px + 'px');
    let i = 1;
    while (i < text.length && ctx.measureText(text.slice(0, i + 1)).width <= maxW) i++;
    const rest = text.slice(i);
    if (ctx.measureText(rest).width <= maxW || px === 34) {
      ctx.fillText(text.slice(0, i), x, y - px * .55);
      fitText(ctx, rest, x, y + px * .65, maxW, font, px, px);
      return;
    }
  }
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

/** 共有用の画像。演出の案によらず同じ画像 (カードは使わない)。
 * 左 = 赤い斜めの板に WIN と自分 (絵文字・名前)、右 = 白地に大会・ラウンド・スコア・相手、下に進出・UF の札 @param {Victory} v @returns {Promise<Blob | null>} */
export async function victoryPng(v) {
  const fonts = /** @type {any} */ (document).fonts;
  const all = [v.me.name, v.op.name, v.tour, where(v), v.advance ? advText(v.advance) : ''].join(' ');
  if (fonts && fonts.load) {
    await Promise.all([`700 40px ${F_JP}`, `500 40px ${F_JP}`, `italic 900 40px ${F_Z}`, `800 40px ${F_Z}`, `600 20px ${F_Z}`, `500 20px ${F_EXP}`, `600 20px ${F_EXP}`]
      .map((ft) => fonts.load(ft, all + ' WIN VS UPSET FACTOR spsp.games 0123456789+-').catch(() => null)));
  }
  const cv = document.createElement('canvas');
  cv.width = IW; cv.height = IH;
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, IW, IH);
  // 左の赤い板 (右の辺を斜めに) と、その外に細い斜線
  const edge = (/** @type {number} */ y) => 500 - 110 * y / IH;   // 板の右の辺の x
  const slant = (x0, x1) => { ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0); ctx.lineTo(x1 - 110, IH); ctx.lineTo(x0 - 110, IH); ctx.closePath(); ctx.fill(); };
  ctx.fillStyle = RED; slant(-200, 500);
  ctx.fillStyle = RED; slant(522, 536);
  ctx.fillStyle = 'rgba(223,27,27,.12)'; slant(558, 600);
  // WIN
  ctx.fillStyle = '#fff'; ctx.font = `italic 900 168px ${F_Z}`; ctx.fillText('WIN', 44, 186);
  // 自分: 絵文字の白い四角 + 名前
  const ey = 250, es = 132;
  if (v.me.emoji) {
    ctx.fillStyle = '#fff'; ctx.fillRect(56, ey, es, es);
    ctx.font = `84px ${F_EMOJI}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#222';
    ctx.fillText(v.me.emoji, 56 + es / 2, ey + es / 2 + 4);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
  const ny = v.me.emoji ? ey + es + 72 : ey + 60;
  ctx.fillStyle = '#fff';
  nameLines(ctx, v.me.name, 56, ny, edge(ny + 50) - 56 - 36, `700 {px} ${F_JP}`);
  ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.font = `500 22px ${F_Z}`; ctx.fillText('spsp.games', 56, IH - 44);
  // 右: 大会・ラウンド
  const rx = 600, rw = IW - rx - 56;
  const dy0 = v.advance || v.uf >= 1 ? 0 : 40;
  ctx.fillStyle = '#1a1a1a'; fitText(ctx, v.tour || '', rx, 104 + dy0, rw, `700 {px} ${F_JP}`, 34, 18);
  if (where(v)) { ctx.fillStyle = RED; fitText(ctx, where(v).toUpperCase(), rx, 146 + dy0, rw, `600 {px} ${F_EXP}`, 21, 13); }
  // スコア (勝った数は赤、負けた数はうすい赤)
  const sy = 368 + dy0, px = 210;
  ctx.font = `italic 900 ${px}px ${F_Z}`;
  const a = String(v.score[0]), b = String(v.score[1]);
  const wa = ctx.measureText(a).width;
  ctx.fillStyle = RED; ctx.fillText(a, rx - 8, sy);
  ctx.fillStyle = RED; ctx.beginPath();   // 斜めの短い棒 (ハイフンの代わり)
  const dx = rx - 8 + wa + 22, dy = sy - px * .3;
  ctx.moveTo(dx + 8, dy - 10); ctx.lineTo(dx + 50, dy - 10); ctx.lineTo(dx + 42, dy + 10); ctx.lineTo(dx, dy + 10); ctx.closePath(); ctx.fill();
  ctx.font = `italic 900 ${px}px ${F_Z}`; ctx.fillStyle = '#f0b4b4'; ctx.fillText(b, dx + 72, sy);
  // 相手
  const oy = 452 + dy0;
  ctx.fillStyle = RED; ctx.font = `600 20px ${F_EXP}`; spaced(ctx, 'VS', rx, oy - 4, 3);
  let ox = rx + 54;
  if (v.op.emoji) { ctx.font = `44px ${F_EMOJI}`; ctx.fillStyle = '#222'; ctx.fillText(v.op.emoji, ox, oy + 2); ox += 62; }
  ctx.fillStyle = '#3a3a3a'; fitText(ctx, v.op.name, ox, oy, IW - 56 - ox, `700 {px} ${F_JP}`, 36, 18);
  // 下: 進出・UF の札 (赤い台形)
  const tagY = 532;
  let x = rx;
  if (v.advance) x = tag(ctx, x, tagY, 58, advText(v.advance), `700 26px ${F_JP}`, true) + 8;
  if (v.uf >= 1) {
    ctx.font = `800 32px ${F_Z}`;
    const t1 = '+' + v.uf; const w1 = ctx.measureText(t1).width;
    ctx.font = `600 14px ${F_EXP}`; const w2 = ctx.measureText('UPSET FACTOR').width + 11 * 2;
    const w = w1 + w2 + 36;
    if (x + w + 12 > IW - 40) { x = rx; }   // 入らなければ次の行
    const ty = x === rx && v.advance ? tagY + 66 : tagY;
    ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x + w + 12, ty); ctx.lineTo(x + w, ty + 58); ctx.lineTo(x, ty + 58); ctx.closePath();
    ctx.fillStyle = RED; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `800 32px ${F_Z}`; ctx.fillText(t1, x + 18, ty + 41);
    ctx.font = `600 14px ${F_EXP}`; spaced(ctx, 'UPSET FACTOR', x + 30 + w1, ty + 36, 2);
  }
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
      <button type="button" class="rp-btn rp-primary rp-win-share" data-win-share>${SHARE_ICON}<span>${escapeHtml(i18n('report.win.share'))}</span></button>
      <button type="button" class="rp-btn" data-win-close>${escapeHtml(i18n('report.win.close'))}</button>
    </div>
    <div class="rp-win-note" role="status" hidden></div>
    <div class="rp-win-skip">${escapeHtml(i18n('report.match_skip'))}</div>`;
  document.body.appendChild(ov);
  // 止まった画面になったとき・進出が分かったときの続き (共有用の画像を先に描く。下で入れる)
  let onStill = () => {};
  let onAdvance = () => {};
  if (advance) advance.then((a) => {
    if (!a || !ov.isConnected) return;
    v.advance = a;   // X の投稿の文にも入れる
    const el = /** @type {HTMLElement} */ (ov.querySelector('.rp-win-adv'));
    el.innerHTML = advHtml(a);
    el.hidden = false;
    onAdvance();
  }).catch(() => { /* 出さないだけ */ });
  // 演出 → 止まって勝利画面 (.still)。演出の間のタップで飛ばす (カードを読んでいる間も)。動きを減らす設定ならすぐ
  const still = () => { if (!ov.classList.contains('still')) { ov.classList.add('go', 'still'); onStill(); } };
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
    const name = safeFileName('SPSP_win_' + v.me.name + '_vs_' + v.op.name) + '.png';
    const nav = /** @type {any} */ (navigator);
    // スマホ (共有シートで画像を渡せる端末) は、押してから描くと「押した直後」の扱いが切れて共有できないことがある (iOS)。
    // 止まった画面になったら先に描いておく。進出の札が後から分かったら描き直す
    // 押したときに見る (画面の途中で端末の扱いが変わることもある)
    const isTouch = () => !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const canShareFiles = () => isTouch() && typeof File === 'function' && !!nav.canShare && !!nav.share;
    /** @type {Promise<Blob> | null} */ let png = null;
    const getPng = () => png || (png = victoryPng(v).then((b) => { if (!b) throw new Error('png'); return b; })
      .catch((e) => { png = null; throw e; }));
    const pre = () => { if (canShareFiles() && ov.isConnected) getPng().catch(() => { /* 押したときにもう一度 */ }); };
    onStill = () => setTimeout(pre, 400);
    onAdvance = () => { png = null; if (ov.classList.contains('still')) pre(); };
    if (ov.classList.contains('still')) onStill();
    // 画像を待つのは 5 秒まで (フォントが読めないときなど)。過ぎたら画像なしで投稿画面へ
    const pngSoon = () => Promise.race([getPng(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
    /** @param {Blob} blob */
    const download = (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const note = /** @type {HTMLElement} */ (ov.querySelector('.rp-win-note'));
    const say = (/** @type {string} */ t) => { note.textContent = t; note.hidden = !t; };
    /** スマホ: 共有シートに画像と文を渡す (X を選べば画像つきの投稿になる)。渡せたら true @param {string} text */
    const shareFile = async (text) => {
      if (!canShareFiles()) return false;
      const file = new File([await getPng()], name, { type: 'image/png' });
      if (!nav.canShare({ files: [file] })) return false;
      try { await nav.share({ files: [file], text }); } catch (e) { if (/** @type {Error} */ (e).name !== 'AbortError') throw e; }
      return true;
    };
    // 共有: スマホは共有シート (画像と文。X などを選ぶ)。PC は X の投稿画面に画像を付けられないので、画像をコピーしてから X の投稿画面を開く
    // (貼り付ければ付く)。コピーできないブラウザは画像を保存してから開く
    const tweet = /** @type {HTMLButtonElement} */ (ov.querySelector('[data-win-share]'));
    tweet.addEventListener('click', async () => {
      const text = tweetText(v) + (v.url ? '\n' + v.url : '');
      const intent = 'https://x.com/intent/tweet?text=' + encodeURIComponent(tweetText(v)) + (v.url ? '&url=' + encodeURIComponent(v.url) : '');
      tweet.disabled = true;
      say('');
      try {
        try { if (await shareFile(text)) return; } catch (e) { /* 共有シートが使えない → X の投稿画面へ */ }
        const CI = /** @type {any} */ (window).ClipboardItem;
        const touch = isTouch();
        let done = '';
        if (!touch && CI && nav.clipboard && nav.clipboard.write) {
          try { await nav.clipboard.write([new CI({ 'image/png': pngSoon() })]); done = i18n('report.win.copied'); } catch (e) { /* 保存に回す */ }
        }
        if (!done && !touch) {
          try { download(await pngSoon()); done = i18n('report.win.saved'); } catch (e) { /* 画像なしで投稿画面だけ開く */ }
        }
        say(done);
        window.open(intent, '_blank', 'noopener');
      } finally {
        tweet.disabled = false;
      }
    });
  });
}

export default { showVictory, tweetText, WIN_ANIMS };
