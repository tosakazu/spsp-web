// @ts-check
// src/pages/p_badges.js — site/p/badges.html (カードの裏面に実績バッジを貼る。試作、あとでカード編集に入れる)
//   持っているバッジ = 出場した大会のうちアイコンのあるもの (大会 → アイコン = data/event_icons.json、tools/badges/build_event_icons.mjs)
//   色は仮: 優勝 = 虹、2・3 位 = 金、ほか = 銀 (js/holo_badge.js の variant)。下位クラスはクラスの文字を重ねる
//   貼ったバッジ: ドラッグで移動、角のつまみ (↻) で回転と大きさ、2 本指でも回転と大きさ。重ねてよい (並びの後ろほど上)
//   保存はこのブラウザだけ (localStorage、選手ごと)。1 枚 = { e: event_id, x, y: 中心 (カードの座標 514×333), s: 一辺 (px), r: 回転 (度) }
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPFormat from '../../site/js/format.js';
import '../../site/nav.js';
import SPSPPlayerCard from '../../site/js/player_card.js';
import { loadCardData, buildCardModel, fetchAppliedCard } from '../../site/js/player_card_model.js';
import { isTransparent, renderBadge, reflatten } from '../../site/js/holo_badge.js';

SPSPI18n.apply(document);
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(location.search);
const DISC = (params.get('d') || '').trim().toLowerCase();
const IMG_BASE = 'https://data.spsp.games/images/tournament/h/';
const W = 514, H = 333;
/** 大きさ (一辺、カードの px) の幅。小さめ〜大きめ。スライダーは対数で (小さい所も細かく選べるように) */
const S_MIN = 22, S_MAX = 260, S_DEF = 84;
const MAX_STICKERS = 30;
const PAGE = 60;
const STORE_KEY = 'spsp_card_badges_draft_v1';
const HOLO_NAMES = ['虹', '金', '銀'];

/** @typedef {{ e: number, x: number, y: number, s: number, r: number }} Sticker */
/** @typedef {{ e: number, name: string, date: string, place: number | null, nent: number | null, file: string, variant: number, cls: string | null }} Badge */

// ── 保存 (このブラウザ) ──
/** @param {number} uid @returns {Sticker[]} */
function loadStickers(uid) {
  try {
    const m = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const a = m && Array.isArray(m[String(uid)]) ? m[String(uid)] : [];
    return a.filter((/** @type {any} */ s) => s && Number.isFinite(s.e) && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.s) && Number.isFinite(s.r))
      .map((/** @type {any} */ s) => ({ e: s.e, x: s.x, y: s.y, s: clampSize(s.s), r: s.r }));
  } catch (e) { return []; }
}
/** @param {number} uid @param {Sticker[]} list */
function saveStickers(uid, list) {
  try {
    const m = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    if (list.length) m[String(uid)] = list.map(s => ({ e: s.e, x: round1(s.x), y: round1(s.y), s: round1(s.s), r: round1(s.r) }));
    else delete m[String(uid)];
    localStorage.setItem(STORE_KEY, JSON.stringify(m));
  } catch (e) { /* 保存できない環境では何もしない */ }
}
const round1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
const clampSize = (/** @type {number} */ s) => Math.max(S_MIN, Math.min(S_MAX, s));
/** 回転を -180〜180 に @param {number} r */
const normRot = r => { let v = ((r + 180) % 360 + 360) % 360 - 180; return v === -180 ? 180 : v; };
// スライダー (0〜1000) ⇔ 大きさ (対数)
const sizeToSlider = (/** @type {number} */ s) => Math.round(1000 * Math.log(s / S_MIN) / Math.log(S_MAX / S_MIN));
const sliderToSize = (/** @type {number} */ v) => S_MIN * Math.pow(S_MAX / S_MIN, v / 1000);

/** 出場大会 → 持っているバッジ (アイコンのある大会だけ、新しい順)
 * @param {any[]} tours @param {{ f: string[], e: Record<string, number> } | null} icons @returns {Badge[]} */
function badgesOf(tours, icons) {
  if (!icons) return [];
  /** @type {Badge[]} */
  const out = [];
  const seen = new Set();
  for (const t of tours || []) {
    const id = Number(t.event_id);
    if (!id || seen.has(id)) continue;
    const k = icons.e[String(id)] ?? (t.parent_event_id ? icons.e[String(t.parent_event_id)] : undefined);
    if (k == null || !icons.f[k]) continue;
    seen.add(id);
    const place = Number.isFinite(t.place) ? Number(t.place) : null;
    out.push({ e: id, name: String(t.name || ''), date: String(t.date || ''), place, nent: t.nent ?? null, file: icons.f[k],
               variant: place === 1 ? 0 : place != null && place <= 3 ? 1 : 2,
               cls: t.class_letter ? String(t.class_letter) : null });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

/** 順位の表示 @param {Badge} b */
const placeText = b => (b.place == null ? '' : b.place === 1 ? '優勝' : `${b.place}位`) + (b.nent ? ` / ${b.nent}人` : '');

// ── 本体 ──
async function main() {
  let uid = parseInt(params.get('uid') || '0');
  if (!uid && DISC) {
    await SPSPLinks.loadDiscriminators(SPSP.data);
    uid = SPSPLinks.uidOfDisc(DISC) || 0;
  }
  const notFound = () => { $('loading').style.display = 'none'; $('not-found').style.display = ''; };
  if (!uid) { notFound(); return; }
  const [data, card, icons] = await Promise.all([
    loadCardData(uid).catch(() => null),
    fetchAppliedCard(uid).catch(() => null),
    fetch(SPSP.root + 'data/event_icons.json').then(r => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  if (!data || !data.meta) { notFound(); return; }
  document.title = `${SPSPFormat.stripTeamTag(data.rec.display)} | SPSP`;
  /** @type {HTMLAnchorElement} */ ($('bz-back')).href = './' + (DISC ? '?d=' + encodeURIComponent(DISC) : '?uid=' + uid);
  $('loading').style.display = 'none';
  $('bz-root').style.display = '';

  // 裏面 (適用済みの設定・二つ名で)
  SPSPPlayerCard.renderBack($('bz-card'), buildCardModel(data, card ? card.settings : null, card ? card.titleText : null));

  const badges = badgesOf((data.player && data.player.tournaments) || [], icons);
  const byE = new Map(badges.map(b => [b.e, b]));
  /** @type {Sticker[]} */
  let stickers = loadStickers(uid).filter(s => byE.has(s.e));
  /** @type {number | null} 選んでいるバッジ (event_id) */
  let sel = null;
  const save = () => saveStickers(uid, stickers);

  // ── 貼る層: 位置・大きさはカードの座標 (514×333) で持ち、画面には表示幅に合わせた px で置く
  //    (層ごと transform で縮めると、ブラウザによってはバッジが粗く見えるので、1 枚ずつ実際の大きさで描く) ──
  const stage = $('bz-stage');
  const layer = $('bz-layer');   // バッジ (カードの外は切る)
  const over = $('bz-over');     // 選んでいるバッジの枠とつまみ (カードの外にはみ出してよい)
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
  /** @type {Map<number, HTMLElement>} */
  const els = new Map();
  // 強制ダークモード対策でキャンバスに描いたバッジ (js/holo_badge.js の flatten) は、描いたときの大きさの絵なので、
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
    const paintBadge = (/** @type {boolean} */ tr) => {
      el.classList.toggle('bz-shape', tr);
      renderBadge(holder, { src, variant: b.variant, transparent: tr, cls: b.cls });
    };
    paintBadge(false);
    isTransparent(src).then(tr => { if (tr) paintBadge(true); });
    return el;
  }
  /** 位置・大きさ・回転・重なり順を要素に写す */
  function place() {
    stickers.forEach((s, i) => {
      let el = els.get(s.e);
      if (!el) { el = makeEl(s); els.set(s.e, el); }
      el.style.left = s.x * scale + 'px';
      el.style.top = s.y * scale + 'px';
      el.style.width = el.style.height = s.s * scale + 'px';
      el.style.transform = `translate(-50%, -50%) rotate(${s.r}deg)`;
      el.style.zIndex = String(i + 1);
      el.classList.toggle('on', s.e === sel);
      if (layer.children[i] !== el) layer.insertBefore(el, layer.children[i] || null);
    });
    for (const [e, el] of els) if (!stickers.some(s => s.e === e)) { el.remove(); els.delete(e); }
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

  // ── 操作の欄 ──
  const sizeIn = /** @type {HTMLInputElement} */ ($('bz-size'));
  const rotIn = /** @type {HTMLInputElement} */ ($('bz-rot'));
  function paintTools() {
    const s = cur();
    $('bz-hint').style.display = s ? 'none' : '';
    $('bz-sel').style.display = s ? '' : 'none';
    if (!s) return;
    const b = /** @type {Badge} */ (byE.get(s.e));
    $('bz-sel-name').textContent = `${b.name} (${HOLO_NAMES[b.variant]}${b.place != null ? '・' + placeText(b) : ''})`;
    if (document.activeElement !== sizeIn) sizeIn.value = String(sizeToSlider(s.s));
    if (document.activeElement !== rotIn) rotIn.value = String(Math.round(s.r));
    $('bz-size-v').textContent = Math.round(s.s / S_DEF * 100) + '%';
    $('bz-rot-v').textContent = Math.round(s.r) + '°';
    const i = stickers.indexOf(s);
    /** @type {HTMLButtonElement} */ ($('bz-up')).disabled = /** @type {HTMLButtonElement} */ ($('bz-front')).disabled = i === stickers.length - 1;
    /** @type {HTMLButtonElement} */ ($('bz-down')).disabled = /** @type {HTMLButtonElement} */ ($('bz-backmost')).disabled = i === 0;
  }
  const changed = () => { place(); save(); };
  sizeIn.addEventListener('input', () => { const s = cur(); if (s) { s.s = clampSize(sliderToSize(Number(sizeIn.value))); changed(); } });
  rotIn.addEventListener('input', () => { const s = cur(); if (s) { s.r = normRot(Number(rotIn.value)); changed(); } });
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
  $('bz-reset-tf').addEventListener('click', () => { const s = cur(); if (s) { s.r = 0; changed(); } });
  const remove = (/** @type {number} */ e) => { stickers = stickers.filter(s => s.e !== e); if (sel === e) sel = null; changed(); paintTray(); };
  $('bz-del').addEventListener('click', () => { if (sel != null) remove(sel); });
  $('bz-clear').addEventListener('click', () => {
    if (!stickers.length || !confirm('貼ったバッジを全部外しますか?')) return;
    stickers = []; sel = null; changed(); paintTray();
  });

  // ── ドラッグ (移動)・つまみ (回転と大きさ)・2 本指 (回転と大きさ) ──
  /** @type {Map<number, { x: number, y: number }>} 押している指 (カードの座標) */
  const ptrs = new Map();
  /** @type {null | { kind: 'move', s: Sticker, dx: number, dy: number } | { kind: 'rot', s: Sticker, a0: number, d0: number, r0: number, s0: number }
   *          | { kind: 'pinch', s: Sticker, a0: number, d0: number, r0: number, s0: number, c0: { x: number, y: number }, x0: number, y0: number }} */
  let drag = null;
  const angle = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const dist = (/** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) => Math.hypot(b.x - a.x, b.y - a.y);
  /** 0° の近くは 0° に吸い付ける (まっすぐに戻しやすく) @param {number} r */
  const snap = r => (Math.abs(normRot(r)) < 4 ? 0 : normRot(r));
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
    const s = onRot ? cur() : stEl ? stickers.find(x => x.e === Number(stEl.dataset.e)) : null;
    if (!s) { sel = null; drag = null; place(); return; }
    e.preventDefault();
    sel = s.e;
    if (onRot) {
      drag = { kind: 'rot', s, a0: angle(s, pt), d0: Math.max(1, dist(s, pt)), r0: s.r, s0: s.s };
    } else {
      drag = { kind: 'move', s, dx: pt.x - s.x, dy: pt.y - s.y };
    }
    place();
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const pt = toCard(e.clientX, e.clientY);
    ptrs.set(e.pointerId, pt);
    if (!drag) return;
    const s = drag.s;
    if (drag.kind === 'move') {
      s.x = Math.max(0, Math.min(W, pt.x - drag.dx));
      s.y = Math.max(0, Math.min(H, pt.y - drag.dy));
    } else if (drag.kind === 'rot') {
      s.r = snap(drag.r0 + angle(s, pt) - drag.a0);
      s.s = clampSize(drag.s0 * dist(s, pt) / drag.d0);
    } else {
      const [p, q] = [...ptrs.values()];
      if (!p || !q) return;
      s.r = snap(drag.r0 + angle(p, q) - drag.a0);
      s.s = clampSize(drag.s0 * dist(p, q) / drag.d0);
      s.x = Math.max(0, Math.min(W, drag.x0 + (p.x + q.x) / 2 - drag.c0.x));
      s.y = Math.max(0, Math.min(H, drag.y0 + (p.y + q.y) / 2 - drag.c0.y));
    }
    place();
  });
  const end = (/** @type {PointerEvent} */ e) => {
    if (!ptrs.delete(e.pointerId)) return;
    if (drag) save();
    // 2 本指の片方を離したら、残った指で移動を続ける
    if (ptrs.size === 1 && drag && drag.kind === 'pinch') {
      const [p] = [...ptrs.values()];
      drag = { kind: 'move', s: drag.s, dx: p.x - drag.s.x, dy: p.y - drag.s.y };
    } else if (!ptrs.size) drag = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);

  // ── 持っているバッジの一覧 ──
  let filter = 'all';
  let shown = PAGE;
  const tray = $('bz-tray');
  $('bz-count').textContent = `${badges.length} 枚`;
  for (const btn of $('bz-filters').querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      filter = String(/** @type {HTMLElement} */ (btn).dataset.f);
      shown = PAGE;
      for (const x of $('bz-filters').querySelectorAll('button')) x.classList.toggle('on', x === btn);
      paintTray();
    });
  }
  $('bz-more').addEventListener('click', () => { shown += PAGE; paintTray(); });
  function paintTray() {
    const on = new Set(stickers.map(s => s.e));
    const list = badges.filter(b => filter === 'all' ? true : filter === 'win' ? b.place === 1
      : filter === 'top3' ? b.place != null && b.place <= 3 : on.has(b.e));
    tray.innerHTML = '';
    if (!list.length) {
      tray.innerHTML = `<div class="bz-empty">${filter === 'placed' ? 'まだ貼っていません' : 'ありません'}</div>`;
    }
    for (const b of list.slice(0, shown)) {
      const it = document.createElement('button');
      it.type = 'button';
      it.className = 'bz-item' + (on.has(b.e) ? ' on' : '');
      it.innerHTML = `<span class="bz-thumb bz-v${b.variant}"><img loading="lazy" alt=""><span class="bz-chip">${HOLO_NAMES[b.variant]}</span>${on.has(b.e) ? '<span class="bz-on">貼付中</span>' : ''}</span>
        <span class="bz-iname"></span><span class="bz-imeta"></span>`;
      /** @type {HTMLImageElement} */ (it.querySelector('img')).src = IMG_BASE + b.file;
      /** @type {HTMLElement} */ (it.querySelector('.bz-iname')).textContent = b.name;
      /** @type {HTMLElement} */ (it.querySelector('.bz-imeta')).textContent = `${b.date.replace(/-/g, '/')} ${placeText(b)}`;
      it.addEventListener('click', () => addOrSelect(b));
      tray.appendChild(it);
    }
    $('bz-more').style.display = list.length > shown ? '' : 'none';
  }
  /** 一覧から押した: まだなら貼る (真ん中あたり、少しずつずらす)、貼ってあれば選ぶ @param {Badge} b */
  function addOrSelect(b) {
    if (!stickers.some(s => s.e === b.e)) {
      if (stickers.length >= MAX_STICKERS) { alert(`貼れるのは ${MAX_STICKERS} 枚までです`); return; }
      const n = stickers.length;
      stickers.push({ e: b.e, x: W / 2 + ((n * 37) % 160) - 80, y: H / 2 + ((n * 23) % 100) - 50, s: S_DEF, r: 0 });
      save();
      paintTray();
    }
    sel = b.e;
    place();
    if (stage.scrollIntoView) stage.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  fitLayer();
  if (typeof ResizeObserver === 'function') new ResizeObserver(fitLayer).observe(stage);
  place();
  paintTray();
}

main();
