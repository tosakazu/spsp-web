// @ts-check
// src/pages/p_badges.js — site/p/badges.html (カードの裏面に実績シールを貼る。試作、あとでカード編集に入れる)
//   持っているシール = 大会シールの判定 (spsp_scripts feat/stickers の spsp/stickers.py) で配られた色のうち、アイコンのある大会のもの
//   (大会 → アイコン = data/event_icons.json、tools/badges/build_event_icons.mjs)。下位クラスはクラスの文字を重ね、アイコンは親の大会のもの
//   判定の結果はビルドに入るまでプレビュー専用の data/stickers_preview/<uid % 64>.json ({uid: {大会キー: r|g|s|n}}) から読む
//   1 つの大会で、一番上の色から下の色まで全部持つ (優勝なら 虹・金・銀・通常 の 4 枚)
//   貼ったシール: ドラッグで移動、角のつまみ (↻) で回転と大きさ、2 本指でも回転と大きさ。重ねてよい (並びの後ろほど上)
//   操作の欄は選んでいてもいなくても同じ高さ (一覧がずれない)。大きさ・回転・切り取りは 1 本のスライダーを切り替える。元に戻す・やり直すあり
//   一覧は大会ごと。大会を押すといちばん上の色、色の丸を押すとその色を貼る
//   透過なしのシールは形 (四角・角丸・丸・六角形・ひし形) と切り取り (絵の何割を見せるか) を選べる。切り取りは絵の縮尺を保ったまま
//   シールを小さくする (はさみで外側を切る)。ホロは見えている形いっぱいに縮む (js/holo_badge.js の shape / crop)
//   保存はこのブラウザだけ (localStorage、選手ごと)。1 枚 = { e: シールのキー, x, y: 中心 (カードの座標 514×333), s: 一辺 (px), r: 回転 (度),
//   k: 形, c: 切り取り (0.35〜1) }
//   シールのキー = "<大会キー>:<色 r|g|s|n>"。大会キー = event_id (下位クラスは "<親の event_id><クラスの文字>")
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPFormat from '../../site/js/format.js';
import '../../site/nav.js';
import SPSPPlayerCard from '../../site/js/player_card.js';
import { loadCardData, buildCardModel, fetchAppliedCard } from '../../site/js/player_card_model.js';
import { isTransparent, renderBadge, reflatten, SHAPES, CROP_MIN } from '../../site/js/holo_badge.js';

SPSPI18n.apply(document);
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(location.search);
const DISC = (params.get('d') || '').trim().toLowerCase();
const IMG_BASE = 'https://data.spsp.games/images/tournament/h/';
const W = 514, H = 333;
/** 大きさ (一辺、カードの px) の幅。小さめ〜大きめ。スライダーは対数で (小さい所も細かく選べるように) */
const S_MIN = 22, S_MAX = 520, S_DEF = 84;   // 最大はカードの幅くらい
const MAX_STICKERS = 30;
const PAGE = 60;
const STORE_KEY = 'spsp_card_badges_draft_v1';
const TEXT_TOP_KEY = 'spsp_card_badges_text_top_v1';   // 名前・二つ名・順位をシールの上に出すか (選手ごと、{uid: 1})
const HOLO_NAMES = ['虹', '金', '銀', '通常'];
/** 色の記号 (判定のデータ) → js/holo_badge.js の variant。上の色から順 */
const TIERS = /** @type {const} */ (['r', 'g', 's', 'n']);
const STICKER_SHARDS = 64;

// Figma の見本 (back の Frame 43 にシールを貼った画像、2026-10-16 にユーザーから) の再現。だれのページでも出せるよう、
// シールは見本用 (e が負、持っているかに関係なく出す)。位置・大きさ・回転は画像に重ねて合わせた (スマパは同じアイコンを 3 枚ずらして重ねてある)
/** @type {Badge[]} */
const SAMPLE_BADGES = [
  { e: 'sample1', name: '見本: 極冠#15', date: '', place: null, nent: null, file: '0195a75b2a4fbbafc4a819f19b792f2f.png', variant: 2, cls: null },
  { e: 'sample2', name: '見本: 渋谷大乱 第一陣', date: '', place: null, nent: null, file: '065e7fbef3c1df6b0581b65ff0962525.jpg', variant: 2, cls: null },
  { e: 'sample3', name: '見本: 篝火#10', date: '', place: null, nent: null, file: 'c30cb17425f4aa0b8668c1e4afb28866.png', variant: 0, cls: null },
  { e: 'sample4', name: '見本: スマパ (3 枚目)', date: '', place: null, nent: null, file: 'ed7fedc76cf5a6047242fc827f4f7548.png', variant: 2, cls: null },
  { e: 'sample5', name: '見本: スマパ (2 枚目)', date: '', place: null, nent: null, file: 'ed7fedc76cf5a6047242fc827f4f7548.png', variant: 2, cls: null },
  { e: 'sample6', name: '見本: スマパ', date: '', place: null, nent: null, file: 'ed7fedc76cf5a6047242fc827f4f7548.png', variant: 2, cls: null },
];
/** 下から順 @type {Sticker[]} */
const SAMPLE_LAYOUT = /** @type {Sticker[]} */ ([
  { e: 'sample1', x: 425, y: 220, s: 346, r: 0 },
  { e: 'sample2', x: 103, y: 288, s: 168, r: 6 },
  { e: 'sample3', x: 40, y: 162, s: 167, r: -24 },
  { e: 'sample4', x: 183, y: 50, s: 345, r: -8 },
  { e: 'sample5', x: 168, y: 38, s: 345, r: -8 },
  { e: 'sample6', x: 153, y: 26, s: 345, r: -8 },
].map(s => ({ ...s, k: 'square', c: 1 })));

/** @typedef {{ e: string, x: number, y: number, s: number, r: number, k: string, c: number }} Sticker */
/** @typedef {{ e: string, name: string, date: string, place: number | null, nent: number | null, file: string, variant: number, cls: string | null }} Badge */

// ── 保存 (このブラウザ) ──
/** @param {number} uid @returns {Sticker[]} */
function loadStickers(uid) {
  try {
    const m = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const a = m && Array.isArray(m[String(uid)]) ? m[String(uid)] : [];
    return a.filter((/** @type {any} */ s) => s && typeof s.e === 'string' && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.s) && Number.isFinite(s.r))
      .map((/** @type {any} */ s) => ({ e: s.e, x: s.x, y: s.y, s: clampSize(s.s), r: s.r, k: SHAPES[s.k] ? String(s.k) : 'square', c: clampCrop(s.c ?? 1) }));
  } catch (e) { return []; }
}
/** @param {number} uid @param {Sticker[]} list */
function saveStickers(uid, list) {
  try {
    const m = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    if (list.length) m[String(uid)] = list.map(s => ({ e: s.e, x: round1(s.x), y: round1(s.y), s: round1(s.s), r: round1(s.r), k: s.k, c: Math.round(s.c * 100) / 100 }));
    else delete m[String(uid)];
    localStorage.setItem(STORE_KEY, JSON.stringify(m));
  } catch (e) { /* 保存できない環境では何もしない */ }
}
const round1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
const clampSize = (/** @type {number} */ s) => Math.max(S_MIN, Math.min(S_MAX, s));
const clampCrop = (/** @type {number} */ c) => Math.max(CROP_MIN, Math.min(1, Number(c) || 1));
/** 回転を -180〜180 に @param {number} r */
const normRot = r => { let v = ((r + 180) % 360 + 360) % 360 - 180; return v === -180 ? 180 : v; };
// スライダー (0〜1000) ⇔ 大きさ (対数)
const sizeToSlider = (/** @type {number} */ s) => Math.round(1000 * Math.log(s / S_MIN) / Math.log(S_MAX / S_MIN));
const sliderToSize = (/** @type {number} */ v) => S_MIN * Math.pow(S_MAX / S_MIN, v / 1000);

/** 大会記録 → 大会キー (下位クラスの仮想大会は event_id が無いので親の event_id + クラスの文字) @param {any} t */
const tourKey = t => (t.event_id ? String(t.event_id) : t.parent_event_id && t.class_letter ? `${t.parent_event_id}${t.class_letter}` : '');

/** 出場大会 → 持っているシール (アイコンのある大会だけ。新しい大会から、同じ大会は上の色から)
 * @param {any[]} tours @param {{ f: string[], e: Record<string, number> } | null} icons
 * @param {Record<string, string> | null} got 判定の結果 {大会キー: 一番上の色 r|g|s|n} @returns {Badge[]} */
function badgesOf(tours, icons, got) {
  if (!icons || !got) return [];
  /** @type {Badge[]} */
  const out = [];
  const seen = new Set();
  for (const t of tours || []) {
    const key = tourKey(t);
    const top = key ? got[key] : undefined;
    if (!top || seen.has(key)) continue;
    const k = (t.event_id ? icons.e[String(t.event_id)] : undefined) ?? (t.parent_event_id ? icons.e[String(t.parent_event_id)] : undefined);
    if (k == null || !icons.f[k]) continue;
    seen.add(key);
    const place = Number.isFinite(t.place) ? Number(t.place) : null;
    for (let v = TIERS.indexOf(/** @type {any} */ (top)); v >= 0 && v < TIERS.length; v++) {
      out.push({ e: `${key}:${TIERS[v]}`, name: String(t.name || ''), date: String(t.date || ''), place, nent: t.nent ?? null, file: icons.f[k],
                 variant: v, cls: t.class_letter ? String(t.class_letter) : null });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));   // 安定ソート: 同じ大会は上の色から
  return out;
}

/** 順位の表示 @param {Badge} b */
const placeText = b => (b.place == null ? '' : b.place === 1 ? '優勝' : `${b.place}位`) + (b.nent ? ` / ${b.nent}人` : '');

/** 大会ごとにまとめた一覧の 1 つ (色は持っているものだけ、上の色から) @typedef {{ key: string, name: string, date: string, place: number | null,
 *   nent: number | null, file: string, cls: string | null, tiers: Badge[], sample: boolean }} EventGroup */
/** シールのキー → 大会キー @param {string} e */
const groupKey = e => e.split(':')[0];

/** 押してから動かしたとみなすまでの距離 (画面の px)。これより小さい動きはタップ (選ぶだけ) */
const DRAG_SLOP = 4;
/** 回転を吸い付ける角度と幅 (度) */
const SNAP_ANGLES = [0, 90, -90, 180, -180, 45, -45, 135, -135];
const SNAP_DEG = 4;
const HISTORY_MAX = 100;

// ── 本体 ──
async function main() {
  let uid = parseInt(params.get('uid') || '0');
  if (!uid && DISC) {
    await SPSPLinks.loadDiscriminators(SPSP.data);
    uid = SPSPLinks.uidOfDisc(DISC) || 0;
  }
  const notFound = () => { $('loading').style.display = 'none'; $('not-found').style.display = ''; };
  if (!uid) { notFound(); return; }
  const [data, card, icons, stickerShard] = await Promise.all([
    loadCardData(uid).catch(() => null),
    fetchAppliedCard(uid).catch(() => null),
    fetch(SPSP.root + 'data/event_icons.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch(SPSP.root + `data/stickers_preview/${uid % STICKER_SHARDS}.json`).then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!data || !data.meta) { notFound(); return; }
  document.title = `${SPSPFormat.stripTeamTag(data.rec.display)} | SPSP`;
  /** @type {HTMLAnchorElement} */ ($('bz-back')).href = './' + (DISC ? '?d=' + encodeURIComponent(DISC) : '?uid=' + uid);
  $('loading').style.display = 'none';
  $('bz-root').style.display = '';

  // 裏面 (適用済みの設定・二つ名で)
  const cardModel = buildCardModel(data, card ? card.settings : null, card ? card.titleText : null);
  SPSPPlayerCard.renderBack($('bz-card'), cardModel);

  // ── 名前・二つ名・順位をシールの上に出す (裏面の複製の文字だけを、シールの層の上に重ねる) ──
  const textTopBtn = $('bz-text-top');
  const readTextTop = () => { try { return !!(JSON.parse(localStorage.getItem(TEXT_TOP_KEY) || '{}') || {})[String(uid)]; } catch (e) { return false; } };
  let textTop = readTextTop();
  const paintTextTop = () => {
    textTopBtn.setAttribute('aria-pressed', String(textTop));
    $('bz-text').style.display = textTop ? '' : 'none';
    if (textTop && !$('bz-text').firstChild) SPSPPlayerCard.renderBack($('bz-text'), cardModel);
  };
  paintTextTop();
  textTopBtn.addEventListener('click', () => {
    textTop = !textTop;
    paintTextTop();
    try {
      const m = JSON.parse(localStorage.getItem(TEXT_TOP_KEY) || '{}') || {};
      if (textTop) m[String(uid)] = 1; else delete m[String(uid)];
      localStorage.setItem(TEXT_TOP_KEY, JSON.stringify(m));
    } catch (e) { /* 保存できない環境では何もしない */ }
  });

  // ── 持っているシール ──
  const badges = badgesOf((data.player && data.player.tournaments) || [], icons, stickerShard ? stickerShard[String(uid)] || {} : null);
  const byE = new Map([...badges, ...SAMPLE_BADGES].map(b => [b.e, b]));
  /** 大会ごと (新しい順)。見本はシールごとに 1 つ (貼ったものの絞り込みでだけ出す) @type {EventGroup[]} */
  const groups = [];
  /** @type {Map<string, EventGroup>} */
  const groupOf = new Map();
  for (const b of [...badges, ...SAMPLE_BADGES]) {
    const sample = !b.date;
    const k = sample ? b.e : groupKey(b.e);
    let g = groupOf.get(k);
    if (!g) {
      g = { key: k, name: b.name, date: b.date, place: b.place, nent: b.nent, file: b.file, cls: b.cls, tiers: [], sample };
      groupOf.set(k, g); groups.push(g);
    }
    g.tiers.push(b);
  }

  /** @type {Sticker[]} */
  let stickers = loadStickers(uid).filter(s => byE.has(s.e));
  /** @type {string | null} 選んでいるシール (シールのキー) */
  let sel = null;

  // ── 元に戻す・やり直す (続けて動かしたものは 1 回にまとめる) ──
  const snap = () => JSON.stringify(stickers);
  /** @type {string[]} */
  const past = [snap()];
  /** @type {string[]} */
  let future = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let histTimer = null;
  const flushHistory = () => {
    if (histTimer) { clearTimeout(histTimer); histTimer = null; }
    const now = snap();
    if (now !== past[past.length - 1]) {
      past.push(now);
      if (past.length > HISTORY_MAX) past.shift();
      future = [];
    }
    paintHistory();
  };
  const paintHistory = () => {
    /** @type {HTMLButtonElement} */ ($('bz-undo')).disabled = past.length < 2 && snap() === past[0];
    /** @type {HTMLButtonElement} */ ($('bz-redo')).disabled = !future.length;
  };
  /** 変えたものを保存し、少し手が止まったら履歴に積む */
  const commit = () => {
    saveStickers(uid, stickers);
    if (histTimer) clearTimeout(histTimer);
    histTimer = setTimeout(flushHistory, 400);
    paintHistory();
  };
  /** @param {string} json */
  const restore = json => {
    stickers = JSON.parse(json);
    if (sel != null && !stickers.some(s => s.e === sel)) sel = null;
    saveStickers(uid, stickers);
    place(); paintTray(); paintHistory();
  };
  const undo = () => {
    flushHistory();
    if (past.length < 2) return;
    future.push(/** @type {string} */ (past.pop()));
    restore(past[past.length - 1]);
  };
  const redo = () => {
    flushHistory();
    const next = future.pop();
    if (next == null) return;
    past.push(next);
    restore(next);
  };
  $('bz-undo').addEventListener('click', undo);
  $('bz-redo').addEventListener('click', redo);

  // ── 貼る層: 位置・大きさはカードの座標 (514×333) で持ち、画面には表示幅に合わせた px で置く
  //    (層ごと transform で縮めると、ブラウザによってはシールが粗く見えるので、1 枚ずつ実際の大きさで描く) ──
  const stage = $('bz-stage');
  const layer = $('bz-layer');   // シール (カードからはみ出した所は切る)
  const frame = $('bz-frame');
  let scale = 0;   // 画面の px / カードの px
  const fitLayer = () => {
    const k = stage.clientWidth / W || 1;
    if (k === scale) return;
    scale = k;
    place();
  };

  /** 画面の座標 → カードの座標 @param {number} cx @param {number} cy */
  const toCard = (cx, cy) => {
    const r = layer.getBoundingClientRect();
    return { x: (cx - r.left) / scale, y: (cy - r.top) / scale };
  };

  const cur = () => stickers.find(s => s.e === sel) || null;
  /** @type {Map<string, HTMLElement>} */
  const els = new Map();
  /** シールを描き直す関数 (形・切り取りを変えたとき) @type {Map<string, () => void>} */
  const paints = new Map();
  /** 透過ありのアイコンのシール (形・切り取りは選べない) @type {Set<string>} */
  const trans = new Set();
  // 強制ダークモード対策でキャンバスに描いたシール (js/holo_badge.js の flatten) は、描いたときの大きさの絵なので、
  // 大きくしたら手が止まってから今の大きさで描き直す (そのままだと引き伸ばされて粗くなる)
  /** @type {ReturnType<typeof setTimeout> | null} */
  let reflatTimer = null;
  const scheduleReflatten = () => {
    if (reflatTimer) clearTimeout(reflatTimer);
    reflatTimer = setTimeout(() => {
      for (const el of els.values()) {
        const hb = /** @type {HTMLElement | null} */ (el.querySelector('.hb'));
        if (hb) reflatten(hb);
      }
    }, 250);
  };
  /** 1 枚の要素を作る (中身のホロは透過かどうか分かってから) @param {Sticker} s */
  function makeEl(s) {
    const b = /** @type {Badge} */ (byE.get(s.e));
    const el = document.createElement('div');
    el.className = 'bz-st';
    el.dataset.e = String(s.e);
    el.innerHTML = '<div class="bz-badge"></div>';
    const src = IMG_BASE + b.file;
    const holder = /** @type {HTMLElement} */ (el.querySelector('.bz-badge'));
    const paintBadge = () => {
      const now = stickers.find(x => x.e === s.e) || s;
      const tr = trans.has(s.e);
      el.classList.toggle('bz-shape', tr);
      el.dataset.kc = `${now.k}|${now.c}`;
      renderBadge(holder, { src, variant: b.variant, transparent: tr, cls: b.cls, shape: now.k, crop: now.c });
    };
    paints.set(s.e, paintBadge);
    paintBadge();
    isTransparent(src).then(tr => { if (tr) { trans.add(s.e); paintBadge(); paintTools(); } });
    return el;
  }
  /** 位置・大きさ・回転・重なり順を要素に写す */
  function place() {
    stickers.forEach((s, i) => {
      let el = els.get(s.e);
      if (!el) { el = makeEl(s); els.set(s.e, el); }
      else if (el.dataset.kc !== `${s.k}|${s.c}`) paints.get(s.e)?.();
      el.style.left = s.x * scale + 'px';
      el.style.top = s.y * scale + 'px';
      el.style.width = el.style.height = s.s * scale + 'px';
      el.style.transform = `translate(-50%, -50%) rotate(${s.r}deg)`;
      el.style.zIndex = String(i + 1);
      el.classList.toggle('on', s.e === sel);
      if (layer.children[i] !== el) layer.insertBefore(el, layer.children[i] || null);
    });
    for (const [e, el] of els) if (!stickers.some(s => s.e === e)) { el.remove(); els.delete(e); paints.delete(e); }
    const s = cur();
    frame.style.display = s ? '' : 'none';
    if (s) {
      frame.style.left = s.x * scale + 'px';
      frame.style.top = s.y * scale + 'px';
      frame.style.width = frame.style.height = s.s * scale + 'px';
      frame.style.transform = `translate(-50%, -50%) rotate(${s.r}deg)`;
    }
    stage.classList.toggle('bz-has-sel', !!s);
    paintTools();
    scheduleReflatten();
  }
  /** 選ぶ (null = 外す)。一覧の印も変わる @param {string | null} e */
  const select = e => {
    if (sel === e) return;
    sel = e;
    place();
    paintTray();
  };

  // ── 操作の欄: 形・重なり順・剥がす、大きさ/回転/切り取りは 1 本のスライダーを切り替えて使う ──
  const tools = $('bz-tools');
  const slider = /** @type {HTMLInputElement} */ ($('bz-slider'));
  /** @type {'size' | 'rot' | 'crop'} */
  let tab = 'size';
  const TAB_LABEL = { size: '大きさ', rot: '回転', crop: '切り取り' };
  /** スライダーの範囲と今の値 @param {Sticker} s */
  const sliderOf = s => tab === 'size' ? { min: 0, max: 1000, v: sizeToSlider(s.s), text: Math.round(s.s / S_DEF * 100) + '%' }
    : tab === 'rot' ? { min: -180, max: 180, v: Math.round(s.r), text: Math.round(s.r) + '°' }
    : { min: Math.round(CROP_MIN * 100), max: 100, v: Math.round(s.c * 100), text: Math.round(s.c * 100) + '%' };
  function paintTools() {
    const s = cur();
    tools.classList.toggle('bz-none', !s);
    const name = $('bz-sel-name');
    name.classList.toggle('bz-hint', !s);
    if (!s) {
      name.textContent = stickers.length ? 'シールを押すと選べます。ドラッグで移動、↻ で回転と大きさ (2 本指でも)' : '下の一覧から押すとカードに貼れます';
      return;
    }
    const b = /** @type {Badge} */ (byE.get(s.e));
    name.textContent = `${b.name}${b.cls ? ` ${b.cls}クラス` : ''} · ${HOLO_NAMES[b.variant]}${b.place != null ? ' · ' + placeText(b) : ''}`;
    const tr = trans.has(s.e);
    for (const x of $('bz-shapes').querySelectorAll('button')) {
      const btn = /** @type {HTMLButtonElement} */ (x);
      btn.classList.toggle('on', !tr && btn.dataset.k === s.k);
      btn.disabled = tr;
      btn.title = tr ? '透過のアイコンは形を変えられません' : String(btn.dataset.title || btn.title);
    }
    const cropBtn = /** @type {HTMLButtonElement} */ ($('bz-tabs').querySelector('[data-t="crop"]'));
    cropBtn.disabled = tr;
    if (tr && tab === 'crop') tab = 'size';
    for (const x of $('bz-tabs').querySelectorAll('button')) x.classList.toggle('on', /** @type {HTMLElement} */ (x).dataset.t === tab);
    const sv = sliderOf(s);
    slider.min = String(sv.min); slider.max = String(sv.max);
    if (document.activeElement !== slider) slider.value = String(sv.v);
    slider.setAttribute('aria-label', TAB_LABEL[tab]);
    $('bz-val').textContent = sv.text;
    $('bz-val').title = tab === 'size' ? '標準の大きさに戻す' : tab === 'rot' ? 'まっすぐに戻す' : '切り取らない (100%) に戻す';
    const i = stickers.indexOf(s);
    /** @type {HTMLButtonElement} */ ($('bz-up')).disabled = /** @type {HTMLButtonElement} */ ($('bz-front')).disabled = i === stickers.length - 1;
    /** @type {HTMLButtonElement} */ ($('bz-down')).disabled = /** @type {HTMLButtonElement} */ ($('bz-backmost')).disabled = i === 0;
  }
  for (const x of $('bz-shapes').querySelectorAll('button')) /** @type {HTMLElement} */ (x).dataset.title = /** @type {HTMLElement} */ (x).title;
  const changed = () => { place(); commit(); };
  for (const btn of $('bz-tabs').querySelectorAll('button')) {
    btn.addEventListener('click', () => { tab = /** @type {any} */ (/** @type {HTMLElement} */ (btn).dataset.t); paintTools(); });
  }
  slider.addEventListener('input', () => {
    const s = cur(); if (!s) return;
    const v = Number(slider.value);
    if (tab === 'size') s.s = clampSize(sliderToSize(v));
    else if (tab === 'rot') s.r = snapRot(v);
    else {
      // 切り取り: 絵の縮尺はそのまま、外側を切った分だけシールが小さくなる
      const c = clampCrop(v / 100);
      s.s = clampSize(s.s * c / s.c);
      s.c = c;
    }
    changed();
  });
  // 値を押すと既定に戻す
  $('bz-val').addEventListener('click', () => {
    const s = cur(); if (!s) return;
    if (tab === 'size') s.s = S_DEF;
    else if (tab === 'rot') s.r = 0;
    else { s.s = clampSize(s.s / s.c); s.c = 1; }
    changed();
  });
  for (const btn of $('bz-shapes').querySelectorAll('button')) {
    btn.addEventListener('click', () => { const s = cur(); if (s) { s.k = String(/** @type {HTMLElement} */ (btn).dataset.k); changed(); } });
  }
  /** 重なり順を動かす @param {number} to 動かす先 (-Infinity = いちばん下、Infinity = いちばん上、±1 = 1 つ) */
  const move = to => {
    const s = cur(); if (!s) return;
    const i = stickers.indexOf(s);
    const j = to === Infinity ? stickers.length - 1 : to === -Infinity ? 0 : Math.max(0, Math.min(stickers.length - 1, i + to));
    stickers.splice(i, 1);
    stickers.splice(j, 0, s);
    changed();
  };
  $('bz-up').addEventListener('click', () => move(1));
  $('bz-down').addEventListener('click', () => move(-1));
  $('bz-front').addEventListener('click', () => move(Infinity));
  $('bz-backmost').addEventListener('click', () => move(-Infinity));
  const remove = (/** @type {string} */ e) => {
    stickers = stickers.filter(s => s.e !== e);
    if (sel === e) sel = null;
    changed(); paintTray();
    toast('剥がしました', '元に戻す', undo);
  };
  $('bz-del').addEventListener('click', () => { if (sel != null) remove(sel); });

  // その他のメニュー
  const menu = /** @type {HTMLDetailsElement} */ ($('bz-menu'));
  document.addEventListener('pointerdown', e => { if (menu.open && !menu.contains(/** @type {Node} */ (e.target))) menu.open = false; });
  $('bz-sample').addEventListener('click', () => {
    menu.open = false;
    stickers = SAMPLE_LAYOUT.map(s => ({ ...s, k: 'square', c: 1 })); sel = null; changed(); paintTray();
    toast('見本の並びにしました', '元に戻す', undo);
  });
  $('bz-clear').addEventListener('click', () => {
    menu.open = false;
    if (!stickers.length) return;
    stickers = []; sel = null; changed(); paintTray();
    toast('全部剥がしました', '元に戻す', undo);
  });

  // ── 一時的なお知らせ (取り消しのボタン付き) ──
  /** @type {HTMLElement | null} */
  let toastEl = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let toastTimer = null;
  /** @param {string} text @param {string} [action] @param {() => void} [fn] */
  function toast(text, action, fn) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'bz-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.innerHTML = '';
    toastEl.append(text);
    if (action && fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'bz-toast-act'; b.textContent = action;
      b.addEventListener('click', () => { fn(); hideToast(); });
      toastEl.append(b);
    }
    toastEl.style.opacity = '1';
    toastEl.style.pointerEvents = action ? 'auto' : 'none';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4000);
  }
  function hideToast() { if (toastEl) { toastEl.style.opacity = '0'; toastEl.style.pointerEvents = 'none'; } }

  // ── ドラッグ (移動)・つまみ (回転と大きさ)・2 本指 (回転と大きさ) ──
  /** @type {Map<number, { x: number, y: number }>} 押している指 (カードの座標) */
  const ptrs = new Map();
  /** @type {null | { kind: 'move', s: Sticker, dx: number, dy: number, sx: number, sy: number, moved: boolean }
   *          | { kind: 'rot', s: Sticker, a0: number, d0: number, r0: number, s0: number }
   *          | { kind: 'pinch', s: Sticker, a0: number, d0: number, r0: number, s0: number, c0: { x: number, y: number }, x0: number, y0: number }} */
  let drag = null;
  const angle = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const dist = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => Math.hypot(b.x - a.x, b.y - a.y);
  /** 0°・90°・45° の刻みの近くは吸い付ける (まっすぐ・斜めに合わせやすく) @param {number} r */
  function snapRot(r) {
    const n = normRot(r);
    for (const a of SNAP_ANGLES) if (Math.abs(n - a) < SNAP_DEG) return normRot(a);
    return n;
  }
  const startPinch = () => {
    const s = cur();
    const [p, q] = [...ptrs.values()];
    if (!s || !p || !q) return;
    drag = { kind: 'pinch', s, a0: angle(p, q), d0: Math.max(1, dist(p, q)), r0: s.r, s0: s.s, c0: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, x0: s.x, y0: s.y };
  };
  stage.addEventListener('pointerdown', e => {
    const pt = toCard(e.clientX, e.clientY);
    const t = /** @type {HTMLElement} */ (e.target);
    if (t.closest('.bz-h-del')) { e.preventDefault(); if (sel != null) remove(sel); return; }
    const onRot = !!t.closest('.bz-h-rot');
    const stEl = /** @type {HTMLElement | null} */ (t.closest('.bz-st'));
    ptrs.set(e.pointerId, pt);
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 取れなくても動く */ }
    if (ptrs.size === 2) { startPinch(); return; }
    if (ptrs.size > 2) return;
    const s = onRot ? cur() : stEl ? stickers.find(x => x.e === stEl.dataset.e) : null;
    if (!s) { drag = null; select(null); return; }
    e.preventDefault();
    if (onRot) {
      drag = { kind: 'rot', s, a0: angle(s, pt), d0: Math.max(1, dist(s, pt)), r0: s.r, s0: s.s };
    } else {
      drag = { kind: 'move', s, dx: pt.x - s.x, dy: pt.y - s.y, sx: e.clientX, sy: e.clientY, moved: false };
    }
    select(s.e);
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const pt = toCard(e.clientX, e.clientY);
    ptrs.set(e.pointerId, pt);
    if (!drag) return;
    const s = drag.s;
    if (drag.kind === 'move') {
      // 少し動くまではタップ (選ぶだけ) とみなして動かさない (押しただけでずれないように)
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < DRAG_SLOP) return;
      drag.moved = true;
      s.x = Math.max(0, Math.min(W, pt.x - drag.dx));
      s.y = Math.max(0, Math.min(H, pt.y - drag.dy));
    } else if (drag.kind === 'rot') {
      s.r = snapRot(drag.r0 + angle(s, pt) - drag.a0);
      s.s = clampSize(drag.s0 * dist(s, pt) / drag.d0);
    } else {
      const [p, q] = [...ptrs.values()];
      if (!p || !q) return;
      s.r = snapRot(drag.r0 + angle(p, q) - drag.a0);
      s.s = clampSize(drag.s0 * dist(p, q) / drag.d0);
      s.x = Math.max(0, Math.min(W, drag.x0 + (p.x + q.x) / 2 - drag.c0.x));
      s.y = Math.max(0, Math.min(H, drag.y0 + (p.y + q.y) / 2 - drag.c0.y));
    }
    place();
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (drag) commit();
    // 2 本指の片方を離したら、残った指で移動を続ける
    if (ptrs.size === 1 && drag && drag.kind === 'pinch') {
      const [p] = [...ptrs.values()];
      drag = { kind: 'move', s: drag.s, dx: p.x - drag.s.x, dy: p.y - drag.s.y, sx: 0, sy: 0, moved: true };
    } else if (!ptrs.size) drag = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // ── キーボード (パソコン): 矢印で 1px (Shift で 10px)、Delete で剥がす、Esc で外す、Ctrl+Z / Ctrl+Shift+Z ──
  document.addEventListener('keydown', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    if (t && (t.tagName === 'INPUT' && /** @type {HTMLInputElement} */ (t).type !== 'range' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
    const s = cur();
    if (!s) return;
    if (t && t.tagName === 'INPUT') return;   // スライダーの矢印はスライダーに
    if (e.key === 'Escape') { select(null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(s.e); return; }
    const d = e.shiftKey ? 10 : 1;
    const mv = /** @type {Record<string, [number, number]>} */ ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] })[e.key];
    if (mv) {
      e.preventDefault();
      s.x = Math.max(0, Math.min(W, s.x + mv[0]));
      s.y = Math.max(0, Math.min(H, s.y + mv[1]));
      changed();
    }
  });

  // ── 持っているシールの一覧 (大会ごと。色の丸で色を選ぶ) ──
  /** 絞り込み: all / r g s n (その大会で取ったいちばん上の色) / placed */
  let filter = 'all';
  let shown = PAGE;
  const tray = $('bz-tray');
  const topV = (/** @type {EventGroup} */ g) => g.tiers[0].variant;
  const real = groups.filter(g => !g.sample);
  const isPlaced = (/** @type {EventGroup} */ g) => g.tiers.some(b => stickers.some(s => s.e === b.e));
  const listOf = (/** @type {string} */ f) => f === 'all' ? real : f === 'placed' ? groups.filter(isPlaced)
    : real.filter(g => topV(g) === TIERS.indexOf(/** @type {any} */ (f)));
  const paintCounts = () => {
    for (const btn of $('bz-filters').querySelectorAll('button')) {
      const f = String(/** @type {HTMLElement} */ (btn).dataset.f);
      let n = btn.querySelector('.bz-n');
      if (!n) { n = document.createElement('span'); n.className = 'bz-n'; btn.appendChild(n); }
      n.textContent = String(listOf(f).length);
    }
  };
  for (const btn of $('bz-filters').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      filter = String(/** @type {HTMLElement} */ (btn).dataset.f);
      shown = PAGE;
      $('bz-scroll').scrollTop = 0;
      for (const x of $('bz-filters').querySelectorAll('button')) x.classList.toggle('on', x === btn);
      paintTray();
    });
  }
  $('bz-more').addEventListener('click', () => { shown += PAGE; paintTray(); });
  // 一覧の箱の高さ = 画面の下までの残り (ページはなるべくスクロールさせず、一覧だけ動かす)。狭い画面でも 200px は取る
  const scroller = $('bz-scroll');
  const fitScroll = () => {
    const top = scroller.getBoundingClientRect().top + window.scrollY;
    scroller.style.height = Math.max(200, Math.floor(window.innerHeight - top)) + 'px';
  };
  fitScroll();
  window.addEventListener('resize', fitScroll);
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitScroll).observe($('bz-top'));
  // 一覧の下まで来たら続きを出す (「もっと見る」を押さなくても)
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver(es => {
      if (es.some(x => x.isIntersecting) && $('bz-more').style.display !== 'none') { shown += PAGE; paintTray(); }
    }, { root: scroller, rootMargin: '200px' }).observe($('bz-more'));
  }
  const TIER_SHORT = ['虹', '金', '銀', '通'];
  function paintTray() {
    const on = new Set(stickers.map(s => s.e));
    const list = listOf(filter);
    tray.innerHTML = '';
    if (!list.length) {
      tray.innerHTML = `<div class="bz-empty">${filter === 'placed' ? 'まだ貼っていません' : 'ありません'}</div>`;
    }
    for (const g of list.slice(0, shown)) {
      const it = document.createElement('div');
      it.className = 'bz-ev' + (g.tiers.some(b => b.e === sel) ? ' on' : '');
      it.innerHTML = `<button type="button" class="bz-thumb"><img loading="lazy" alt="">${g.cls ? `<span class="bz-cls">${g.cls}</span>` : ''}</button>
        <div class="bz-tiers"></div><span class="bz-iname"></span><span class="bz-imeta"></span>`;
      const img = /** @type {HTMLImageElement} */ (it.querySelector('img'));
      img.src = IMG_BASE + g.file;
      const thumb = /** @type {HTMLButtonElement} */ (it.querySelector('.bz-thumb'));
      thumb.title = `${g.name} — ${HOLO_NAMES[topV(g)]}を貼る`;
      // 大会を押す: まだ貼っていない色のうちいちばん上を貼る (全部貼ってあれば、いちばん上を選ぶ)
      thumb.addEventListener('click', () => addOrSelect(g.tiers.find(b => !on.has(b.e)) || g.tiers[0]));
      const tiers = /** @type {HTMLElement} */ (it.querySelector('.bz-tiers'));
      for (const b of g.tiers) {
        const d = document.createElement('button');
        d.type = 'button';
        d.className = `bz-tier t${b.variant}` + (on.has(b.e) ? ' on' : '');
        d.textContent = TIER_SHORT[b.variant];
        d.title = `${HOLO_NAMES[b.variant]}${on.has(b.e) ? ' (貼っています。押すと選ぶ)' : 'を貼る'}`;
        d.addEventListener('click', () => addOrSelect(b));
        tiers.appendChild(d);
      }
      /** @type {HTMLElement} */ (it.querySelector('.bz-iname')).textContent = g.name + (g.cls ? ` ${g.cls}` : '');
      /** @type {HTMLElement} */ (it.querySelector('.bz-imeta')).textContent = g.date ? `${g.date.replace(/-/g, '/')} ${g.place == null ? '' : g.place === 1 ? '優勝' : g.place + '位'}` : '';
      tray.appendChild(it);
    }
    $('bz-more').style.display = list.length > shown ? '' : 'none';
    paintCounts();
  }
  /** 一覧から押した: まだなら貼る (空いていそうな所、少しずつずらす)、貼ってあれば選ぶ @param {Badge} b */
  function addOrSelect(b) {
    if (!stickers.some(s => s.e === b.e)) {
      if (stickers.length >= MAX_STICKERS) { toast(`貼れるのは ${MAX_STICKERS} 枚までです`); return; }
      const n = stickers.length;
      stickers.push({ e: b.e, x: W / 2 + ((n * 37) % 160) - 80, y: H / 2 + ((n * 23) % 100) - 50, s: S_DEF, r: 0, k: 'square', c: 1 });
      sel = b.e;
      place();
      const el = els.get(b.e);
      if (el) { el.classList.remove('bz-pop'); void el.offsetWidth; el.classList.add('bz-pop'); }
      commit();
      paintTray();
    } else select(b.e);
  }

  fitLayer();
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitLayer).observe(stage);
  place();
  paintTray();
  paintHistory();
}

main();
