// @ts-check
// tour_icons.js — 大会アイコンの縮小版 (一覧・最新の大会結果に並べる 96px WebP)。
// 置き場は site.tourIcons (= https://data.spsp.games/images/tournament/)。spsp-build の deploy/sync_tournament_images.py が
// t/<MD5>.webp と、部門 ID → 縮小版の表 events.json ({"files":[…],"e":{"<部門 ID>":<files の位置>}}) を書く。
//   html(eventId, cls)   アイコンの <img> (src はまだ入れない)。site.tourIcons が無い地域・部門 ID が無いときは ''
//   fill(root)           root の中のアイコンのうち、画面に近づいたものから src を入れる。表 (events.json) は
//                        最初に 1 枚が見えそうになったときに 1 回だけ読む。表に無い部門のアイコンは外す
import { escapeHtml } from './html.js';

const W = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);
/** @type {Promise<any> | null} */
let table = null;
/** @type {IntersectionObserver | null} */
let observer = null;

export function base() {
  return (W.SPSP && W.SPSP.site && W.SPSP.site.tourIcons) || '';
}

/** @param {number | string | null | undefined} eventId @param {string} [cls] */
export function html(eventId, cls) {
  if (!base() || eventId == null || eventId === '') return '';
  return `<img class="tour-icon${cls ? ' ' + cls : ''}" data-eid="${escapeHtml(String(eventId))}" alt="" decoding="async">`;
}

function loadTable() {
  if (!table) {
    table = fetch(base() + 'events.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  }
  return table;
}

/** @param {HTMLImageElement} img */
async function show(img) {
  if (img.dataset.done) return;
  img.dataset.done = '1';
  const t = await loadTable();
  const i = t && t.e ? t.e[img.dataset.eid || ''] : undefined;
  if (i == null || !t.files[i]) { img.remove(); return; }
  img.src = base() + t.files[i];
}

/** @param {ParentNode | null} root */
export function fill(root) {
  if (!root || !base()) return;
  const imgs = /** @type {HTMLImageElement[]} */ (Array.from(root.querySelectorAll('img.tour-icon[data-eid]:not([data-done])')));
  if (!imgs.length) return;
  if (typeof W.IntersectionObserver !== 'function') { imgs.forEach(show); return; }
  if (!observer) {
    observer = new W.IntersectionObserver((/** @type {IntersectionObserverEntry[]} */ entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        /** @type {IntersectionObserver} */ (observer).unobserve(e.target);
        show(/** @type {HTMLImageElement} */ (e.target));
      }
    }, { rootMargin: '200px' });
  }
  for (const img of imgs) /** @type {IntersectionObserver} */ (observer).observe(img);
}

const api = { base, html, fill };
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspTourIcons = api;
export default api;
