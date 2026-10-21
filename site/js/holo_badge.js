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
//   クラスの文字: 六角形・丸・ひし形は Figma の見本の位置 (下の中央寄り、少し小さく、LETTER_PLACE)。角丸は大きさを変えず、
//   ほぼ形に収まる最小の距離だけ右下から内側へずらす (letterShift。字の輪郭をフォントで測る。多少の見切れは許す)
// ホロは Figma のレイヤーの画像 (img/holo/l/) を、Figma と同じブレンドモード (LAYERS) で重ねる
// 強制ダークモード (Samsung Internet など) では、重ねた見た目がブラウザに書き換えられるので、裏でキャンバスに 1 枚に描いて差し替える
// (flatten。プレイヤーカードと同じ考え方。キャンバスの色はブラウザが書き換えない)

import { HOLO_FILES } from './holo_assets.js';

/** ホロの種類 (variant の番号)。色に意味があるので、名前で使う */
export const HOLO = { rainbow: 0, gold: 1, silver: 2, normal: 3 };
/** 形 → 点 (一辺を 1 とした座標、左上が 0,0) が内側か。どれも凸なので、文字の箱の 4 隅が内側なら箱ごと内側
 * (holo_badge.css の clip-path と同じ形) */
export const SHAPES = /** @type {Record<string, (u: number, v: number) => boolean>} */ ({
  square: (u, v) => u >= 0 && u <= 1 && v >= 0 && v <= 1,
  round: (u, v) => {
    if (u < 0 || u > 1 || v < 0 || v > 1) return false;
    const cu = Math.min(Math.max(u, 0.15), 0.85), cv = Math.min(Math.max(v, 0.15), 0.85);
    return (u - cu) ** 2 + (v - cv) ** 2 <= 0.15 ** 2;
  },
  circle: (u, v) => (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25,
  hex: (u, v) => Math.abs(u - 0.5) <= 0.433 && Math.abs(v - 0.5) + Math.abs(u - 0.5) * (0.25 / 0.433) <= 0.5,
  diamond: (u, v) => Math.abs(u - 0.5) + Math.abs(v - 0.5) <= 0.5,
});
export const CROP_MIN = 0.35;

/** クラスの文字 (透過なし) の輪郭の箱。右下の角 (0, 0) からの位置、一辺に対する割合 (= 負の値)。線・影の分を少し足す。
 * フォントがまだなら null @param {string} letter @returns {{ x0: number, x1: number, y0: number, y1: number } | null} */
const boxCache = new Map();
function letterBox(letter) {
  if (boxCache.has(letter)) return boxCache.get(letter);
  const W = 740, size = W * 350 / 740;
  const font = `italic 800 ${size}px "Zalando Sans Expanded"`;
  if (!document.fonts || !document.fonts.check(font, letter)) return null;
  const ctx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
  ctx.font = font;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(letter);
  // drawLetter と同じ置き方 (右下からずらし、1.016 / 1.02 倍)
  const asc = m.fontBoundingBoxAscent || size * 0.8, desc = m.fontBoundingBoxDescent || size * 0.2;
  const y = -size + (size - (asc + desc)) / 2 + asc;
  const tx = -0.0371 * size, ty = 0.0514 * size, pad = 0.025 * size;
  const b = { x0: (tx + 1.016 * -m.actualBoundingBoxLeft - pad) / W, x1: (tx + 1.016 * m.actualBoundingBoxRight + pad) / W,
              y0: (ty + 1.02 * (y - m.actualBoundingBoxAscent) - pad) / W, y1: (ty + 1.02 * (y + m.actualBoundingBoxDescent) + pad) / W };
  boxCache.set(letter, b);
  return b;
}
/** 形で切ったとき、字の箱の幅・高さのこの割合までは各辺で形の外に出てよい (見切れても、なるべく元の位置のまま) */
const LETTER_CLIP = 0.22;
/** 六角形・丸・ひし形の文字の置き場所 (Figma の見本 133:121 など、2026-10-20 デザイナー指定): 下の中央寄り、少し小さく (k)。
 * 箱の右下からのずらし (一辺に対する割合)。丸は下が少し見切れる位置 */
const LETTER_PLACE = /** @type {Record<string, { dx: number, dy: number, k: number }>} */ ({
  hex: { dx: 0.2836, dy: -0.0229, k: 0.9153 },
  diamond: { dx: 0.2836, dy: -0.0229, k: 0.9153 },
  circle: { dx: 0.2836, dy: -0.0878, k: 0.9153 },
});
/** フォントがまだのときの箱 (一字のおおよそ) */
const BOX_GUESS = { x0: -0.38, x1: -0.01, y0: -0.37, y1: 0.01 };

/** 文字を形の内側に入れるための、右下からのずらし (dx, dy、一辺に対する割合)。入る中でずらす距離がいちばん短いもの
 * @param {string} shape @param {{ x0: number, x1: number, y0: number, y1: number }} b */
const shiftCache = new Map();
function letterShift(shape, b) {
  if (shape === 'square') return { dx: 0, dy: 0 };
  const key = `${shape}|${b.x0}|${b.x1}|${b.y0}|${b.y1}`;
  if (shiftCache.has(key)) return shiftCache.get(key);
  const inside = SHAPES[shape];
  // 多少見切れてよい: 字の箱の外側 LETTER_CLIP ずつは形の外に出てよいとし、内側の芯だけを入れる (ずらしを小さく)
  const mx = (b.x1 - b.x0) * LETTER_CLIP, my = (b.y1 - b.y0) * LETTER_CLIP;
  const x0 = b.x0 + mx, x1 = b.x1 - mx, y0 = b.y0 + my, y1 = b.y1 - my;
  const fits = (/** @type {number} */ dx, /** @type {number} */ dy) => [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]
    .every(([x, y]) => inside(1 - dx + x, 1 - dy + y));
  let best = { dx: 0.3, dy: 0.3 }, bestD = Infinity;
  const step = 0.0025;
  for (let dx = 0; dx <= 0.5; dx += step) {
    if (dx * dx >= bestD) break;
    for (let dy = 0; dy <= 0.5 && dx * dx + dy * dy < bestD; dy += step) {
      if (fits(dx, dy)) { best = { dx, dy }; bestD = dx * dx + dy * dy; break; }
    }
  }
  shiftCache.set(key, best);
  return best;
}
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

// 重ねるレイヤー (下から順) と重ね方 [名前, 重ね方, 大きさ (一辺に対する倍率、中央に置く。無ければ 1)]。
// sq = 透過なし (四角・角丸)、zk = 透過なしの丸・六角形・ひし形 (Figma の 図形_虹/金/銀 153:288 など)、sh = 透過あり、0 虹・1 金・2 銀。
// Figma の sticker (98:2) のレイヤーとブレンドモードそのまま (REST API で取得。同じ画像を別のグループで使い回している所もそのまま。
// 図形の 1 番は虹・金とも四角の金の 1 番と同じ画像、銀の 1 番は四角の銀の 1 番と同じ画像なので、それを使う)
const LAYERS = /** @type {Record<string, [string, string, number?][]>} */ ({
  sq0: [['sikaku_nizi_5', 'hard-light'], ['sikaku_nizi_4', 'color-burn'], ['sikaku_nizi_3', 'screen'], ['sikaku_nizi_2', 'color-dodge'], ['sikaku_nizi_1', 'overlay']],
  sq1: [['sikaku_kin_4', 'hard-light'], ['sikaku_kin_3', 'color-dodge'], ['sikaku_kin_2', 'plus-lighter'], ['sikaku_kin_1', 'overlay']],
  sq2: [['sikaku_gin_4', 'normal'], ['sikaku_gin_3', 'hard-light'], ['sikaku_gin_2', 'overlay'], ['sikaku_gin_1', 'overlay']],
  sh0: [['sikaku_nizi_5', 'hard-light'], ['sikaku_nizi_4', 'color-burn'], ['touka_nizi_3', 'screen'], ['touka_nizi_2', 'color-dodge'], ['touka_nizi_1', 'overlay']],
  sh1: [['touka_kin_4', 'plus-lighter'], ['touka_kin_3', 'color-burn'], ['touka_kin_2', 'plus-lighter'], ['sikaku_kin_1', 'overlay']],
  sh2: [['sikaku_gin_2', 'hard-light'], ['sikaku_gin_2', 'overlay'], ['sikaku_gin_3', 'plus-lighter'], ['sikaku_gin_1', 'overlay']],
  // 虹の 2 番 (ラメ) は Figma で 968px (一辺 740 の外へはみ出して中央に置き、形で切る)
  zk0: [['zukei_nizi_5', 'plus-lighter'], ['zukei_nizi_4', 'overlay'], ['zukei_nizi_3', 'normal'], ['zukei_nizi_2', 'color-dodge', 968 / 740], ['sikaku_kin_1', 'overlay']],
  zk1: [['zukei_kin_4', 'hard-light'], ['zukei_kin_3', 'color-dodge'], ['zukei_kin_2', 'plus-lighter'], ['sikaku_kin_1', 'overlay']],
  zk2: [['zukei_gin_4', 'normal'], ['zukei_gin_3', 'hard-light'], ['zukei_gin_2', 'overlay'], ['sikaku_gin_1', 'overlay']],
});
/** 図形用のホロを使う形 */
const ZK_SHAPES = new Set(['circle', 'hex', 'diamond']);
/** 重ねるレイヤー @param {boolean} transparent @param {number} v @param {string} shape */
const layersFor = (transparent, v, shape) => LAYERS[`${transparent ? 'sh' : ZK_SHAPES.has(shape) ? 'zk' : 'sq'}${v}`] || [];

/** @param {HTMLElement} el @param {BadgeOpts} opts */
export function renderBadge(el, opts) {
  const v = Math.max(0, Math.min(3, Number(opts.variant) || 0));
  const url = `url("${String(opts.src).replace(/"/g, '%22')}")`;
  // 形と切り取りは透過なしだけ (透過ありはアイコンの形がそのまま外形)
  const shape = !opts.transparent && opts.shape && SHAPES[opts.shape] ? opts.shape : 'square';
  const crop = opts.transparent ? 1 : Math.max(CROP_MIN, Math.min(1, Number(opts.crop) || 1));
  const letter0 = opts.cls ? String(opts.cls).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) : '';
  const box = letter0 && !opts.transparent ? letterBox(letter0) : null;
  const pl = LETTER_PLACE[shape] ? { ...LETTER_PLACE[shape] } : { ...letterShift(shape, box || BOX_GUESS), k: 1 };
  el.className = `hb ${opts.transparent ? 'hb-shape' : 'hb-square'} hb-v${v} hb-k-${shape}`;
  el.style.setProperty('--hb-img', url);
  el.style.setProperty('--hb-zoom', String(1 / crop));
  el.style.setProperty('--hb-cls-dx', String(pl.dx));
  el.style.setProperty('--hb-cls-dy', String(pl.dy));
  el.style.setProperty('--hb-cls-k', String(pl.k));
  // 層: 絵 / (透過なしならクラスの文字) / ホロのレイヤー (下から) / ポインタを乗せたときの光 / (透過ありならクラスの文字)
  const layers = layersFor(!!opts.transparent, v, shape);
  const impl = opts.impl || 'img';
  const kind = (/** @type {string} */ _name) => (impl === 'css' ? 'c' : impl === 'old' ? 'o' : 'l');
  // クラスの文字: 透過なしは絵の直上 (ホロの下)、透過ありはホロの上 (形で切り抜かない)
  const letter = opts.cls ? String(opts.cls).replace(/[^A-Za-z0-9]/g, '').slice(0, 2) : '';
  const cls = letter ? `<div class="hb-cls">${letter}</div>` : '';
  // ポインタの光 (sheen / glare) は .hb の直下 (キャンバスに差し替えたあとも、その上で重なるように)。透過ありは光も形で切り抜く
  el.innerHTML = '<div class="hb-in"><div class="hb-art"></div>' + (opts.transparent ? '' : cls) +
    layers.map(([name, mode, sc]) => `<div class="hb-${kind(name)} hb-${kind(name)}-${name}" data-mode="${mode}"${sc ? ` style="inset:${-(sc - 1) / 2 * 100}%"` : ''}></div>`).join('') +
    '</div>' + (opts.transparent ? cls : '') + '<div class="hb-sheen"></div><div class="hb-glare"></div>';
  for (const d of el.querySelectorAll('.hb-l, .hb-c, .hb-o')) /** @type {HTMLElement} */ (d).style.mixBlendMode = String(/** @type {HTMLElement} */ (d).dataset.mode);
  const fl = opts.flatten || 'auto';
  // 描き方 (キャンバスに描くとき用)。画像にする (badgeToCanvas、カードの保存) ときにも使うので、いつも覚えておく
  const fo = { src: opts.src, layers, transparent: !!opts.transparent, impl: impl === 'css' ? 'img' : impl, letter, crop, pl, shape };
  specOf.set(el, fo);
  // 形で切ったもの (角丸・丸・六角形・ひし形) もいつもキャンバスに描く: Windows の Chrome で、切り方 (clip-path でも border-radius でも)
  // とホロの重ね合わせ (mix-blend-mode) を一緒に使うと、ホロの層が描かれないことがあった (2026-10-21、丸で再発)
  if (impl !== 'css' && (fl === 'always' || (fl === 'auto' && (shape !== 'square' || forcedDarkLikely())))) {
    flatOpts.set(el, fo);
    flattenBadge(el, fo).catch(() => { /* 描けなければ重ねたまま */ });
  } else flatOpts.delete(el);
  // フォントが届いたら字の輪郭を測り直して置き直す (形で切っているときだけ)
  if (letter0 && !opts.transparent && !box && shape !== 'square' && !LETTER_PLACE[shape] && document.fonts) {
    document.fonts.load(`italic 800 100px "Zalando Sans Expanded"`, letter0).then(() => {
      const b = letterBox(letter0);
      if (!b || !el.isConnected || !el.classList.contains(`hb-k-${shape}`)) return;
      const p2 = letterShift(shape, b);
      el.style.setProperty('--hb-cls-dx', String(p2.dx));
      el.style.setProperty('--hb-cls-dy', String(p2.dy));
      const sp = specOf.get(el);
      if (sp) sp.pl = { ...p2, k: 1 };
      const fo = flatOpts.get(el);
      if (fo) { fo.pl = { ...p2, k: 1 }; flattenBadge(el, fo).catch(() => { /* 前の絵のまま */ }); }
    }).catch(() => { /* おおよその箱のまま */ });
  }
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
      // 読めたら絵にほどいておく (decode。描くときにほどくと、その分そのとき重い)
      im.onload = () => { if (im.decode) im.decode().then(() => resolve(im), () => resolve(im)); else resolve(im); };
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
 * @param {{ dx: number, dy: number, k: number }} [pl] 透過なしの形ごとのずらし (letterShift) */
function drawLetter(ctx, W, letter, shape, pl = { dx: 0, dy: 0, k: 1 }) {
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
 * @param {HTMLElement} el @param {{ src: string, layers: [string, string, number?][], transparent: boolean, impl: 'img' | 'old', letter: string, crop: number, pl: { dx: number, dy: number, k: number } }} o */
async function flattenBadge(el, o) {
  // 幅は回転・傾きを含まない大きさ (offsetWidth)。祖先を transform で縮めている所では getBoundingClientRect の方が実際の大きさ
  const css = Math.max(el.offsetWidth || 0, el.getBoundingClientRect().width) || 160;
  const W = flatWidth(css);
  flatSize.set(el, W);
  const cv = await drawBadge(o, W);
  if (!el.isConnected || flatOpts.get(el) !== o) return;   // 描いている間に作り直された
  // 置くのはキャンバスのまま (画像 (img) にすると、ブラウザの強制ダークモードが画像として暗く・色を変えてしまう。2026-10-21)。
  // ブラウザがメモリ節約でキャンバスの中身を捨てたら、重ねた表示には戻さず (丸ではホロが消える) 描き直す (裏に回っていれば表に戻ったとき)
  cv.addEventListener('contextlost', () => {
    lost.add(el);
    if (document.visibilityState !== 'hidden') setTimeout(redrawLost, 0);
  });
  cv.className = 'hb-flat';
  unflatten(el);
  const inner = el.querySelector('.hb-in');
  if (inner) inner.after(cv); else el.prepend(cv);
  el.classList.add('hb-flattened');
}

/** 形の外形の線 (holo_badge.css の clip-path と同じ) を引く @param {CanvasRenderingContext2D} ctx @param {number} W @param {string} shape */
function shapePath(ctx, W, shape) {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
  else if (shape === 'round') {
    const r = W * 0.15;
    ctx.moveTo(r, 0); ctx.arcTo(W, 0, W, W, r); ctx.arcTo(W, W, 0, W, r); ctx.arcTo(0, W, 0, 0, r); ctx.arcTo(0, 0, W, 0, r); ctx.closePath();
  } else {
    const pts = shape === 'hex' ? [[0.5, 0], [0.933, 0.25], [0.933, 0.75], [0.5, 1], [0.067, 0.75], [0.067, 0.25]]
      : shape === 'diamond' ? [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * W) : ctx.moveTo(x * W, y * W)));
    ctx.closePath();
  }
}

/** バッジの絵とホロの素材を読んでおく (カードの準備完了を待つとき用)。透過かどうかも確かめる。全部読めたら true
 * @param {string} src @param {number} variant @param {string} [shape] 形 (丸・六角形・ひし形はホロの素材が違う) @returns {Promise<boolean>} */
export async function preloadBadge(src, variant, shape = 'square') {
  const tr = await isTransparent(src);
  const v = Math.max(0, Math.min(3, Number(variant) || 0));
  const layers = layersFor(tr, v, shape);
  const got = await Promise.all([loadImage(src, true).catch(() => loadImage(src)).catch(() => null), ...layers.map(([n]) => layerImage(n, 'img').catch(() => null))]);
  return got.every(Boolean);
}

/** @type {Promise<boolean> | null} */
let allHolo = null;
/** ホロの素材を全部 (全種類・全部の形) 一度に読んでおく (シールの編集用: 形や種類を変えたときに取りに行かない)。
 * 読んだ画像は持ったままにする (CSS の背景も同じ URL なので取り直さない)。何度呼んでも 1 回だけ。全部読めたら true */
export function preloadAllHolo() {
  if (!allHolo) {
    const names = [...new Set(Object.values(LAYERS).flat().map(([n]) => n))];
    allHolo = Promise.all(names.map(n => layerImage(n, 'img').then(() => true, () => false))).then(r => r.every(Boolean));
  }
  return allHolo;
}

/** バッジを 1 枚のキャンバスに描く (重ねた見た目と同じ。透過なしは形で切る)
 * @param {{ src: string, layers: [string, string, number?][], transparent: boolean, impl: 'img' | 'old', letter: string, crop: number, pl: { dx: number, dy: number, k: number }, shape?: string }} o
 * @param {number} W 一辺 (px) @returns {Promise<HTMLCanvasElement>} */
async function drawBadge(o, W) {
  // 同じ絵 (同じシール・形・大きさ) は描いたものを写すだけにする (GPU を使わずに描くので 1 枚が重い。カードの裏面は変えるたびに作り直される)
  const key = JSON.stringify([o.src, o.layers, o.transparent, o.impl, o.letter, o.crop, o.pl, o.shape || '', W]);
  let p = drawn.get(key);
  if (p) { drawn.delete(key); drawn.set(key, p); }   // 最近使った順
  else {
    p = drawBadgeNow(o, W);
    drawn.set(key, p);
    p.catch(() => drawn.delete(key));
    while (drawn.size > DRAWN_MAX) drawn.delete(/** @type {string} */ (drawn.keys().next().value));
  }
  const src = await p;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d')).drawImage(src, 0, 0);
  return cv;
}
/** 描いた絵 (key → キャンバス)。古いものから捨てる (740px で 1 枚 2MB ほど) */
/** @type {Map<string, Promise<HTMLCanvasElement>>} */
const drawn = new Map();
const DRAWN_MAX = 32;

/** @param {Parameters<typeof drawBadge>[0]} o @param {number} W @returns {Promise<HTMLCanvasElement>} */
async function drawBadgeNow(o, W) {
  const [icon, ...imgs] = await Promise.all([loadImage(o.src, true).catch(() => loadImage(o.src)), ...o.layers.map(([n]) => layerImage(n, o.impl))]);
  if (o.letter && document.fonts) {
    try { await document.fonts.load(`italic 800 ${W / 3}px "Zalando Sans Expanded"`, o.letter); } catch (e) { /* 別の字体で描く */ }
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = W;
  // 丸と角丸 (曲線で切る形) は GPU を使わずに描く (willReadFrequently)。形で切る (clip) のも最後にする: Android の Chrome で、丸く切った中に
  // ホロを重ね合わせるとホロが描かれないことがあった (CSS でもキャンバスでも、別の形から丸にしたときに。2026-10-21)。
  // GPU を使わないと 1 枚が重いので、直線だけの形 (四角・六角形・ひし形) は GPU のまま
  const cpu = o.shape === 'circle' || o.shape === 'round';
  const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', cpu ? { willReadFrequently: true } : undefined));
  const clip = !o.transparent && o.shape && o.shape !== 'square';
  // 絵: 透過なしは cover、透過ありは contain (CSS と同じ)
  const iw = icon.naturalWidth || W, ih = icon.naturalHeight || W;
  const s = o.transparent ? Math.min(W / iw, W / ih) : Math.max(W / iw, W / ih) / o.crop;   // 切り取り = 絵だけ拡大 (CSS の --hb-zoom)
  const dw = iw * s, dh = ih * s, dx = (W - dw) / 2, dy = (W - dh) / 2;
  ctx.drawImage(icon, dx, dy, dw, dh);
  if (o.letter && !o.transparent) drawLetter(ctx, W, o.letter, false, o.pl);
  o.layers.forEach(([, mode, sc = 1], i) => {
    ctx.globalCompositeOperation = CANVAS_OP[mode] || 'source-over';
    ctx.drawImage(imgs[i], -(sc - 1) / 2 * W, -(sc - 1) / 2 * W, W * sc, W * sc);
  });
  if (o.transparent) {
    // 形の外を消す (CSS の mask と同じ)
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(icon, dx, dy, dw, dh);
    ctx.globalCompositeOperation = 'source-over';
    if (o.letter) drawLetter(ctx, W, o.letter, true);
  }
  if (clip) {
    // 形の外を消す (重ね終わってから)
    ctx.globalCompositeOperation = 'destination-in';
    shapePath(ctx, W, String(o.shape));
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  return cv;
}

/** renderBadge で組み立てたバッジを、一辺 W px のキャンバスに描く (カードを画像にするとき: html2canvas はブレンド・マスク・clip-path を
 * 描けないので、シールはこの絵に差し替えて撮る)。組み立てていない要素なら null
 * @param {HTMLElement} el @param {number} W @returns {Promise<HTMLCanvasElement | null>} */
export async function badgeToCanvas(el, W) {
  const o = specOf.get(el);
  return o ? drawBadge(o, Math.max(16, Math.round(W))) : null;
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

/** 組み立てたバッジの描き方 (renderBadge のたびに。badgeToCanvas 用) */
/** @type {WeakMap<HTMLElement, { src: string, layers: [string, string, number?][], transparent: boolean, impl: 'img' | 'old', letter: string, crop: number, pl: { dx: number, dy: number, k: number }, shape?: string }>} */
const specOf = new WeakMap();
/** キャンバスに差し替えたときの描き方 (描き直す用) */
/** @type {WeakMap<HTMLElement, { src: string, layers: [string, string, number?][], transparent: boolean, impl: 'img' | 'old', letter: string, crop: number, pl: { dx: number, dy: number, k: number }, shape?: string }>} */
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

const API = { HOLO, isTransparent, renderBadge, attachTilt, reflatten, badgeToCanvas, preloadBadge, preloadAllHolo };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むため)
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspHoloBadge = API;
export default API;
