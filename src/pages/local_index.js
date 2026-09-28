// @ts-check
// src/pages/local_index.js — site/local/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/local_index.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPTags from '../../site/js/tags.js';
import '../../site/js/data.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPListPage from '../../site/js/list_page.js';
import '../../site/nav.js';

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

const STATE = {
  /** @type {SpspSeriesSummary[]} */
  series: [],                    // data/series.json の series (型は types/spsp.d.ts)
  /** @type {SpspSeriesSummary[]} */
  filtered: [],
  sortKey: 'last_date',
  sortDir: 'desc',
  searchText: '',
  bucket: 'all',
};

/** @param {number} avg @returns {string} */
function bucketOf(avg) {
  if (avg >= 80) return 'big';
  if (avg >= 30) return 'mid';
  if (avg >= 10) return 'small';
  return 'mini';
}

// escapeHtml は ../js/html.js (サイト共通)

function applyFilters() {
  const ft = STATE.searchText.toLowerCase();
  STATE.filtered = STATE.series.filter(s => {
    if (ft && !s.name.toLowerCase().includes(ft)) return false;
    if (STATE.bucket === 'uchi') {
      return s.is_uchi;
    }
    if (STATE.bucket === 'special') {
      return s.is_special_rules;
    }
    if (STATE.bucket !== 'all') {
      if (bucketOf(s.avg_entrants) !== STATE.bucket) return false;
    }
    return true;
  });
  const sign = STATE.sortDir === 'asc' ? 1 : -1;
  const key = STATE.sortKey;
  STATE.filtered.sort((a, b) => {
    if (key === 'name') return sign * a.name.localeCompare(b.name, 'ja');
    if (key === 'last_date') return sign * (a.last_date < b.last_date ? -1 : (a.last_date > b.last_date ? 1 : 0));
    const va = a[key] || 0;
    const vb = b[key] || 0;
    return sign * (va - vb);
  });
}

function render() {
  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  const rows = STATE.filtered;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">${i18n('local_list.none')}</td></tr>`;
  } else {
    const html = rows.map(s => {
      const tags = [];
      if (s.is_uchi) tags.push(`<span class="tag tag-uchi">${SPSPTags.TEXT.uchi}</span>`);
      if (s.is_special_rules) tags.push(`<span class="tag tag-special">${SPSPTags.TEXT.special}</span>`);
      if (s.restricted) tags.push(`<span class="tag tag-restr">${SPSPTags.TEXT.res}</span>`);
      if (s.is_all_small) tags.push(`<span class="tag tag-allsmall" title="${i18n('local.all_small_title')}">${SPSPTags.TEXT.small}</span>`);
      const url = `${SPSP.pageHref('ranking.html')}?series=${encodeURIComponent(SPSPLinks.seriesKey(s.name))}`;
      return `
        <tr class="series-row" data-name="${escapeHtml(s.name)}">
          <td class="col-name"><a href="${url}">${escapeHtml(s.name)}</a></td>
          <td class="col-date">${s.last_date}</td>
          <td class="col-num">${s.tour_count}</td>
          <td class="col-num">${s.avg_entrants.toFixed(0)}</td>
          <td class="col-num">${s.participant_count}</td>
          <td class="col-tags">${tags.join('')}</td>
        </tr>
      `;
    }).join('');
    tbody.innerHTML = html;
  }

  SPSPListPage.updateSortIndicators(STATE.sortKey, STATE.sortDir);   // ../js/list_page.js

  const status = document.getElementById('status');
  if (status) status.textContent = i18n('local_list.status', { n: rows.length, total: STATE.series.length });
}

function setupEvents() {
  // 検索と並べ替え見出しの配線は ../js/list_page.js (一覧ページ共通)
  SPSPListPage.bindSearch(text => {
    STATE.searchText = text;
    applyFilters();
    render();
  });
  document.querySelectorAll('#filter-chips .chip').forEach(chip0 => {
    const chip = /** @type {HTMLElement} */ (chip0);
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filter-chips .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      STATE.bucket = /** @type {string} */ (chip.dataset.filter);
      applyFilters();
      render();
    });
  });
  SPSPListPage.bindSortHeaders(STATE, ['name'], () => {
    applyFilters();
    render();
  });
  // Row click → navigate
  const tbody = document.getElementById('tbody');
  if (tbody) tbody.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    const tr = /** @type {HTMLElement | null} */ (target && target.closest('tr.series-row'));
    if (!tr) return;
    if (target && target.closest('a')) return; // let link handle
    const name = tr.dataset.name;
    if (name) location.href = `${SPSP.pageHref('ranking.html')}?series=${encodeURIComponent(SPSPLinks.seriesKey(name))}`;
  });
}

async function init() {
  setupEvents();
  try {
    const t0 = performance.now();
    const res = await fetch(SPSP.data + 'data/series.json');
    if (!res.ok) throw new Error(i18n('common.fetch_failed', { file: 'series.json' }));
    const j = await res.json();
    STATE.series = j.series || [];
    const footer = document.getElementById('footer-info');
    if (footer) footer.innerHTML =
      i18n('local_list.footer', { date: escapeHtml(j.generated_at || ''), n: STATE.series.length }) + ' · ' +
      `<a href="${SPSP.langRoot}${SPSP.pageHref('index.html')}">${i18n('common.national_ranking')}</a>`;
    applyFilters();
    render();
    const status = document.getElementById('status');
    if (status) status.textContent =
      i18n('local_list.status_ms', { n: STATE.filtered.length, total: STATE.series.length, ms: (performance.now()-t0).toFixed(0) });
  } catch (e) {
    const tbody = document.getElementById('tbody');
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="6" class="empty-msg" style="color:#dc2626">${escapeHtml(/** @type {Error} */ (e).message)}</td></tr>`;
  }
}

init();
