// @ts-check
// src/pages/news.js — site/news/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/news.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/js/data.js';
import '../../site/nav.js';

/** news.json の 1 件 (announcements / auto_news の要素に type を足したもの) */
/** @typedef {{ type: 'announcement' | 'auto', date?: string, title?: string, body?: string, signature?: string }} NewsEntry */

const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に
/** @type {Record<string, string>} */
const TYPE_LABEL = { auto: i18n('news.type.auto'), announcement: i18n('news.type.announcement') };
/** @type {NewsEntry[]} */
let ALL_ENTRIES = [];
// Initial filter from URL ?filter=auto|announcement|all
const _urlFilter = new URLSearchParams(location.search).get('filter');
let CURRENT_FILTER = (_urlFilter === 'auto' || _urlFilter === 'announcement') ? _urlFilter : 'all';

// escapeHtml は ../js/html.js (サイト共通)
// markdown-like bold/italic: **text** → <strong>, *text* → <em>. escapeHtml の後に適用.
// 太字を先に消費するので入れ子は不可 (太字の中で強調したいときは斜体を使う).
/** @param {string} s @returns {string} */
function renderMD(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function render() {
  const list = document.getElementById('news-list');
  if (!list) return;
  const filtered = CURRENT_FILTER === 'all'
    ? ALL_ENTRIES
    : ALL_ENTRIES.filter(e => e.type === CURRENT_FILTER);
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-msg">${i18n('news.none')}</div>`;
    return;
  }
  list.innerHTML = filtered.map(e => `
    <div class="news-card">
      <div class="meta-row">
        <span class="date">${escapeHtml(e.date || '')}</span>
        <span class="type-badge ${e.type}">${TYPE_LABEL[e.type] || e.type}</span>
      </div>
      <div class="title">${escapeHtml(e.title || '')}</div>
      ${e.body ? `<p class="body">${renderMD(e.body)}</p>` : ''}
      ${e.signature ? `<div class="signature">${renderMD(e.signature)}</div>` : ''}
    </div>
  `).join('');
}

// Apply URL-based initial tab state
document.querySelectorAll('.filter-tab').forEach(t0 => {
  const t = /** @type {HTMLElement} */ (t0);
  t.classList.toggle('active', t.dataset.filter === CURRENT_FILTER);
});

fetch(SPSP.data + 'news.json').then(r => r.json()).then(data => {
  /** @type {NewsEntry[]} */
  const entries = [];
  (data.announcements || []).forEach((/** @type {NewsEntry} */ e) => entries.push({...e, type: 'announcement'}));
  (data.auto_news || []).forEach((/** @type {NewsEntry} */ e) => entries.push({...e, type: 'auto'}));
  // Sort by date desc (newer on top)
  entries.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  ALL_ENTRIES = entries;
  render();
}).catch(err => {
  const list = document.getElementById('news-list');
  if (!list) return;
  list.innerHTML =
    `<div class="empty-msg">${i18n('news.load_failed', { message: escapeHtml(err.message) })}</div>`;
});

const filterTabs = document.getElementById('filter-tabs');
if (filterTabs) filterTabs.addEventListener('click', (e) => {
  const tab = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('.filter-tab') : null);
  if (!tab) return;
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  CURRENT_FILTER = /** @type {string} */ (tab.dataset.filter);
  // Sync URL ?filter=
  const u = new URL(location.href);
  if (CURRENT_FILTER === 'all') u.searchParams.delete('filter');
  else u.searchParams.set('filter', CURRENT_FILTER);
  history.replaceState({}, '', u);
  render();
});
