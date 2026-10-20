// @ts-check
// holo_badge.js — 実績バッジ: 大会のアイコン画像をホログラム (Figma「submit」の sticker) にして出す。
//   isTransparent(src)        アイコンが透過 (形の外が透明) か。画像を小さく描いて端と全体の透明な画素の割合で決める (JPEG は常に不透明)
//   renderBadge(el, opts)     el にバッジを組み立てる。opts = { src, variant: 0 | 1 | 2 | 3, transparent }
//   attachTilt(el)            ポインタを乗せている間 (タッチは触っている間) の傾き・虹色の筋・光だまりをポインタの位置で動かす
//   (renderBadge の flatten)  強制ダークモード対策: 裏でキャンバスに 1 枚に描いて差し替える
// 透過ありと透過なしでホロが違う (デザインどおり): レイヤーの画像も重ね方も別。透過ありは形の外を出さない
// variant (ホロの種類 3 つ、色に意味がある): 0 = 虹、1 = 金、2 = 銀 (Figma の sticker の左から。透過あり・なしで見た目は違う)
//   3 = 通常 (ホロなし。絵とクラスの文字だけ、ポインタの光は残す)
// 形と切り取り (透過なしだけ、2026-10-20): shape = square / round (角丸) / circle / hex (六角形) / diamond (ひし形) で外形を切る。
//   crop = 絵のうち見せる幅の割合 (0.35〜1)。絵だけ 1 / crop 倍に拡大し、ホロは見えている形いっぱいのまま (狭めるとホロも一緒に縮む)。
//   クラスの文字は形の内側に入るよう、形ごとに右下からずらして小さくする (SHAPES)
// ホロは Figma のレイヤーの画像 (img/holo/l/) を、Figma と同じブレンドモード (LAYERS) で重ねる
// 強制ダークモード (Samsung Internet など) では、重ねた見た目がブラウザに書き換えられるので、裏でキャンバスに 1 枚に描いて差し替える
// (flatten。プレイヤーカードと同じ考え方。キャンバスの色はブラウザが書き換えない)

import { HOLO_FILES } from './holo_assets.js';

/** ホロの種類 (variant の番号)。色に意味があるので、名前で使う */
export const HOLO = { rainbow: 0, gold: 1, silver: 2, normal: 3 };
/** 形ごとのクラスの文字の置き方: 右下の角から dx・dy (一辺に対する割合) 内側へ、大きさ k 倍。
 * 文字の箱 (一辺の約 1/3 四方) の右下の角が形の内側に入る値 (丸: 中心からの距離、六角形: 右下の辺、ひし形: |x|+|y|) に少し余裕を足した */
export const SHAPES = /** @type {Record<string, { dx: number, dy: number, k: number }>} */ ({
  square: { dx: 0, dy: 0, k: 1 },
  round: { dx: 0.05, dy: 0.05, k: 0.95 },
  circle: { dx: 0.17, dy: 0.17, k: 0.8 },
  hex: { dx: 0.12, dy: 0.25, k: 0.75 },
  diamond: { dx: 0.3, dy: 0.3, k: 0.6 },
});
export const CROP_MIN = 0.35;
/** impl: 'img' (既定、画像版: 740px の AVIF、ラメは前の画像版のまま) | 'css' (画像を使わない) | 'old' (前の画像版、740px)
 * cls: 下位クラスの文字 ('B' など。無ければ出さない)
 * flatten: キャンバスに 1 枚に描いて差し替えるか。'auto' (既定) = Samsung Internet かダークモードのときだけ、'always'、'never'
 * @typedef {{ src: string, variant?: number, transparent?: boolean, impl?: 'img' | 'css' | 'old', cls?: string | null, flatten?: 'auto' | 'always' | 'never', shape?: string, crop?: number }} BadgeOpts */

/** @type {Map<string, Promise<boolean>>} */
const cache = new Map();

/** CORS で読むときの URL。大会アイコンの配信 (R2) は、普通の読み込みには CORS の許可を付けずに返し、それを 1 年キャッシュさせる。
 * CSS の背景で一度読んだ物を CORS で読み直すと、ブラウザが許可なしの応答を使い回して失敗することがあるので、目印を付けて別物にする
 * @param {string} src */
function corsUrl(src) {
  if (/^(data|blob):/.test(src)) return src;
  return src + (src.includes('?') ? '&' : '?') + 'cors=1';
}

/** @param {string} src @returns {Promise<boolean>} */
export function isTransparent(src) {
  if (/\.jpe?g($|\?)/i.test(src)) return Promise.resolve(false);
  let p = cache.get(src);
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';   // data.spsp.games は CORS *。読めないと getImageData が例外になる
      img.onload = () => {
        try {
          const N = 32;
          const c = document.createElement('canvas');
          c.width = N; c.height = N;
          const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
          ctx.drawImage(img, 0, 0, N, N);
          const d = ctx.getImageData(0, 0, N, N).data;
          let clear = 0, edge = 0, edgeClear = 0;
          for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const a = d[(y * N + x) * 4 + 3];
            const onEdge = x === 0 || y === 0 || x === N - 1 || y === N - 1;
            if (a < 200) clear++;
            if (onEdge) { edge++; if (a < 200) edgeClear++; }
          }
          // 端の 3 割以上か全体の 1 割以上が透明なら「透過あり」
          resolve(edgeClear / edge > 0.3 || clear / (N * N) > 0.1);
        } catch (e) { resolve(false); }
      };
      img.onerror = () => resolve(false);
      img.src = corsUrl(src);
    });
    cache.set(src, p);
  }
  return p;
}

// 重ねるレイヤー (下から順) と重ね方。sq = 透過なし、sh = 透過あり、0 虹・1 金・2 銀。
// Figma の sticker (98:2) のレイヤーとブレンドモードそのまま (REST API で取得。同じ画像を別のグループで使い回している所もそのまま)
const LAYERS = {
  sq0: [['sikaku_nizi_5', 'hard-light'], ['sikaku_nizi_4', 'color-burn'], ['sikaku_nizi_3', 'screen'], ['sikaku_nizi_2', 'color-dodge'], ['sikaku_nizi_1', 'overlay']],
  sq1: [['sikaku_kin_4', 'hard-light'], ['sikaku_kin_3', 'color-dodge'], ['sikaku_kin_2', 'plus-lighter'], ['sikaku_kin_1', 'overlay']],
  sq2: [['sikaku_gin_4', 'normal'], ['sikaku_gin_3', 'hard-light'], ['sikaku_gin_2', 'overlay'], ['sikaku_gin_1', 'overlay']],
  sh0: [['sikaku_nizi_5', 'hard-light'], ['sikaku_nizi_4', 'color-burn'], ['touka_nizi_3', 'screen'], ['touka_nizi_2', 'color-dodge'], ['touka_nizi_1', 'overlay']],
  sh1: [['touka_kin_4', 'plus-lighter'], ['touka_kin_3', 'color-burn'], ['touka_kin_2', 'plus-lighter'], ['sikaku_kin_1', 'overlay']],
  sh2: [['sikaku_gin_2', 'hard-light'], ['sikaku_gin_2', 'overlay'], ['sikaku_gin_3', 'plus-lighter'], ['sikaku_gin_1', 'overlay']],
};

/** @param {HTMLElement} el @param {BadgeOpts} opts */
export function renderBadge(el, opts) {
  const v = Math.max(0, Math.min(3, Number(opts.variant) || 0));
  const url = `url("${String(opts.src).replace(/"/g, '%22')}")`;
  // 形と切り取りは透過なしだけ (透過ありはアイコンの形がそのまま外形)
  const shape = !opts.transparent && opts.shape && SHAPES[opts.shape] ? opts.shape : 'square';
  const crop = opts.transparent ? 1 : Math.max(CROP_MIN, Math.min(1, Number(opts.crop) || 1));
  const pl = SHAPES[shape];
  el.className = `hb ${opts.transparent ? 'hb-shape' : 'hb-square'} hb-v${v} hb-k-${shape}`;
  el.style.setProperty('--hb-img', url);
  el.style.setProperty('--hb-zoom', String(1 / crop));
  el.style.setProperty('--hb-cls-dx', String(pl.dx));
  el.style.setProperty('--hb-cls-dy', String(pl.dy));
  el.style.setProperty('--hb-cls-k', String(pl.k));
  // 層: 絵 / (透過なしならクラスの文字) / ホロのレイヤー (下から) / ポインタを乗せたときの光 / (透過ありならクラスの文字)
  const layers = LAYERS[`${opts.transparent ? 'sh' : 'sq'}${v}`] || [];
  const impl = opts.impl || 'img';
  const kind = (/** @type {string} */ _name) => (impl === 'css' ? 'c' : impl === 'old' ? 'o' : 'l');
  // クラスの文字: 透過なしは絵の直上 (ホロの下)、透過ありはホロの上 (形で切り抜かない)
  const letter = opts.cls ? String(opts.cls).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) : '';
  const cls = letter ? `<div class="hb-cls">${letter}</div>` : '';
  // ポインタの光 (sheen / glare) は .hb の直下 (キャンバスに差し替えたあとも、その上で重なるように)。透過ありは光も形で切り抜く
  el.innerHTML = '<div class="hb-in"><div class="hb-art"></div>' + (opts.transparent ? '' : cls) +
    layers.map(([name, mode]) => `<div class="hb-${kind(name)} hb-${kind(name)}-${name}" data-mode="${mode}"></div>`).join('') +
    '</div>' + (opts.transparent ? cls : '') + '<div class="hb-sheen"></div><div class="hb-glare"></div>';
  for (const d of el.querySelectorAll('.hb-l, .hb-c, .hb-o')) /** @type {HTMLElement} */ (d).style.mixBlendMode = String(/** @type {HTMLElement} */ (d).dataset.mode);
  const fl = opts.flatten || 'auto';
  if (impl !== 'css' && (fl === 'always' || (fl === 'auto' && forcedDarkLikely()))) {
    const fo = { src: opts.src, layers, transparent: !!opts.transparent, impl, letter, crop, pl };
    flatOpts.set(el, fo);
    flattenBadge(el, fo).catch(() => { /* 描けなければ重ねたまま */ });
  } else flatOpts.delete(el);
}

/** ブラウザが色を書き換えるかもしれないとき (プレイヤーカードの needsImage と同じ判定)。
 * Samsung Internet のダークモードは prefers-color-scheme に出ないことがあるので、Samsung Internet は常に */
function forcedDarkLikely() {
  try {
    if (/SamsungBrowser/i.test(navigator.userAgent)) return true;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) { return false; }
}

/** CSS の mix-blend-mode → キャンバスの globalCompositeOperation */
const CANVAS_OP = /** @type {Record<string, GlobalCompositeOperation>} */ ({
  normal: 'source-over', 'plus-lighter': 'lighter', 'hard-light': 'hard-light', 'color-burn': 'color-burn', 'color-dodge': 'color-dodge',
  overlay: 'overlay', screen: 'screen', multiply: 'multiply', 'soft-light': 'soft-light', color: 'color', luminosity: 'luminosity',
});

/** @type {Map<string, Promise<HTMLImageElement>>} */
const imgCache = new Map();
/** @param {string} url @param {boolean} [cors] */
function loadImage(url, cors = false) {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image ' + url));
      im.src = cors ? corsUrl(url) : url;
    });
    imgCache.set(url, p);
    p.catch(() => imgCache.delete(url));
  }
  return p;
}

/** 素材画像の場所 (holo_badge.css と同じ場所の ../img/holo/)。CSS の link から求める */
function holoBase() {
  const link = /** @type {HTMLLinkElement | null} */ (document.querySelector('link[href*="holo_badge"]'));
  return new URL('../img/holo/', link ? link.href : location.href).href;
}

/** 1 枚のレイヤー画像 (画像版は AVIF、読めなければ前の画像版の WebP) @param {string} name @param {'img' | 'old'} impl */
async function layerImage(name, impl) {
  const f = HOLO_FILES[name] || {};
  const base = holoBase();
  if (impl === 'img' && f.l) {
    try { return await loadImage(base + f.l); } catch (e) { /* AVIF が使えない → WebP */ }
  }
  if (!f.l740) throw new Error('no file ' + name);
  return loadImage(base + f.l740);
}

/** 文字を CSS と同じ位置・見た目で描く (holo_badge.css の .hb-square / .hb-shape .hb-cls の数値と同じ)
 * @param {CanvasRenderingContext2D} ctx @param {number} W @param {string} letter @param {boolean} shape
 * @param {{ dx: number, dy: number, k: number }} [pl] 透過なしの形ごとの置き方 (SHAPES) */
function drawLetter(ctx, W, letter, shape, pl = SHAPES.square) {
  const size = W * (shape ? 220 : 350) / 740 * (shape ? 1 : pl.k);
  ctx.save();
  ctx.font = `italic 800 ${size}px "Zalando Sans Expanded", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(letter);
  // CSS は line-height 1 の箱を右下に置き、右下を原点にずらして (透過なしは少し大きく) する:
  // 字の基準線 = 箱の上 + (字の高さ - (上 + 下)) / 2 + 上
  const asc = m.fontBoundingBoxAscent || size * 0.8, desc = m.fontBoundingBoxDescent || size * 0.2;
  const tx = (shape ? -0.0955 : -0.0371) * size, ty = (shape ? -0.5227 : 0.0514) * size;
  ctx.translate(W * (1 - (shape ? 0 : pl.dx)) + tx, W * (1 - (shape ? 0 : pl.dy)) + ty);
  if (!shape) ctx.scale(1.016, 1.02);
  const x = 0, y = -size + (size - (asc + desc)) / 2 + asc;
  if (shape) {
    ctx.lineWidth = 0.0273 * size; ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round';
    ctx.strokeText(letter, x, y);
    ctx.fillStyle = 'rgb(203 203 203 / .9)'; ctx.fillText(letter, x, y);
  } else {
    ctx.lineWidth = 0.01429 * size; ctx.strokeStyle = '#bab9b9';
    // 影 (CSS の drop-shadow と同じ: 黒 50%、0.0057em ずらし・ぼかし。shadow はキャンバスの座標 = 拡大前で効くので素直に)
    ctx.shadowColor = 'rgb(0 0 0 / .75)'; ctx.shadowOffsetX = ctx.shadowOffsetY = 0.0057 * size; ctx.shadowBlur = 0.0057 * size;
    ctx.strokeText(letter, x, y);
  }
  ctx.restore();
}

/** 重ねた見た目をキャンバスに 1 枚に描いて、上に置く (下の重ねた要素は隠す)
 * @param {HTMLElement} el @param {{ src: string, layers: string[][], transparent: boolean, impl: 'img' | 'old', letter: string, crop: number, pl: { dx: number, dy: number, k: number } }} o */
async function flattenBadge(el, o) {
  // 幅は回転・傾きを含まない大きさ (offsetWidth)。祖先を transform で縮めている所では getBoundingClientRect の方が実際の大きさ
  const css = Math.max(el.offsetWidth || 0, el.getBoundingClientRect().width) || 160;
  const W = flatWidth(css);
  flatSize.set(el, W);
  const [icon, ...imgs] = await Promise.all([loadImage(o.src, true).catch(() => loadImage(o.src)), ...o.layers.map(([n]) => layerImage(n, o.impl))]);
  if (o.letter && document.fonts) {
    try { await document.fonts.load(`italic 800 ${W / 3}px "Zalando Sans Expanded"`, o.letter); } catch (e) { /* 別の字体で描く */ }
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  // 絵: 透過なしは cover、透過ありは contain (CSS と同じ)
  const iw = icon.naturalWidth || W, ih = icon.naturalHeight || W;
  const s = o.transparent ? Math.min(W / iw, W / ih) : Math.max(W / iw, W / ih) / o.crop;   // 切り取り = 絵だけ拡大 (CSS の --hb-zoom)
  const dw = iw * s, dh = ih * s, dx = (W - dw) / 2, dy = (W - dh) / 2;
  ctx.drawImage(icon, dx, dy, dw, dh);
  if (o.letter && !o.transparent) drawLetter(ctx, W, o.letter, false, o.pl);
  o.layers.forEach(([, mode], i) => {
    ctx.globalCompositeOperation = CANVAS_OP[mode] || 'source-over';
    ctx.drawImage(imgs[i], 0, 0, W, W);
  });
  if (o.transparent) {
    // 形の外を消す (CSS の mask と同じ)
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(icon, dx, dy, dw, dh);
    ctx.globalCompositeOperation = 'source-over';
    if (o.letter) drawLetter(ctx, W, o.letter, true);
  }
  if (!el.isConnected || flatOpts.get(el) !== o) return;   // 描いている間に作り直された
  cv.className = 'hb-flat';
  // ブラウザがメモリ節約でキャンバスの中身を捨てたら (裏に回ったタブ・閉じて復元したタブ)、すぐ重ねた表示に戻し、表に戻ったら描き直す
  cv.addEventListener('contextlost', () => { unflatten(el); lost.add(el); });
  el.querySelector('.hb-flat')?.remove();
  const inner = el.querySelector('.hb-in');
  if (inner) inner.after(cv); else el.prepend(cv);
  el.classList.add('hb-flattened');
}

/** キャンバスの一辺 (画面の大きさ × 画素の密度、64〜740) @param {number} css */
const flatWidth = css => Math.max(64, Math.min(740, Math.round(css * (window.devicePixelRatio || 1))));
/** 描いた (描いている) キャンバスの一辺 */
/** @type {WeakMap<HTMLElement, number>} */
const flatSize = new WeakMap();
/** キャンバスに差し替えたバッジを、今の表示の大きさで描き直す (大きくしたときに粗くならないように。小さくしたときと、
 * キャンバスにしていないバッジは何もしない)。描き直したら true @param {HTMLElement} el */
export function reflatten(el) {
  const o = flatOpts.get(el);
  if (!o || !el.isConnected) return false;
  const css = Math.max(el.offsetWidth || 0, el.getBoundingClientRect().width);
  if (!css || flatWidth(css) <= (flatSize.get(el) || 0) * 1.1) return false;
  flattenBadge(el, o).catch(() => { /* 前の絵のまま */ });
  return true;
}

/** キャンバスに差し替えたときの描き方 (描き直す用) */
/** @type {WeakMap<HTMLElement, { src: string, layers: string[][], transparent: boolean, impl: 'img' | 'old', letter: string, crop: number, pl: { dx: number, dy: number, k: number } }>} */
const flatOpts = new WeakMap();
/** 中身を捨てられたバッジ (表に戻ったら描き直す) */
/** @type {Set<HTMLElement>} */
const lost = new Set();
/** @param {HTMLElement} el */
function unflatten(el) {
  el.querySelector('.hb-flat')?.remove();
  el.classList.remove('hb-flattened');
}
function redrawLost() {
  if (document.visibilityState === 'hidden') return;
  for (const el of [...lost]) {
    lost.delete(el);
    const o = flatOpts.get(el);
    if (o && el.isConnected) flattenBadge(el, o).catch(() => { /* 重ねたまま */ });
  }
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', redrawLost);
  window.addEventListener('pageshow', redrawLost);
}

/** @param {HTMLElement} el */
export function attachTilt(el) {
  // 0〜1 に抑える: タッチは指がバッジの外に出ても位置が届き続けるので、そのままだと虹色の筋の模様の継ぎ目が
  // バッジの中に入って切れ目に見え、傾きも大きくなりすぎる
  const clamp = (/** @type {number} */ t) => Math.max(0, Math.min(1, t));
  const set = (/** @type {number} */ x, /** @type {number} */ y) => {
    el.style.setProperty('--hb-mx', clamp(x).toFixed(3));
    el.style.setProperty('--hb-my', clamp(y).toFixed(3));
  };
  el.addEventListener('pointermove', e => {
    const r = el.getBoundingClientRect();
    set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  });
  el.addEventListener('pointerleave', () => set(0.5, 0.5));
  // タッチには hover が無いので、触っている間だけキラキラを出す
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    set((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    el.classList.add('hb-live');
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => el.classList.remove('hb-live'));
}

const API = { HOLO, isTransparent, renderBadge, attachTilt, reflatten };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspHoloBadge = API;
export default API;
