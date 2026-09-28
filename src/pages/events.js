// @ts-check
// src/pages/events.js — site/events/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/events.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import '../../site/js/data.js';
import SPSPListPage from '../../site/js/list_page.js';
import SPSPTags from '../../site/js/tags.js';
import '../../site/nav.js';
/** 地域の暦日の時差 (region/config.js utcOffset。無ければ止まらないよう空 = UTC ではなく、設定は必ずある前提) */
const SITE_UTC_OFFSET = /** @type {SpspSiteConfig} */ (window.SPSP.site).utcOffset;

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

/** data/tournaments.json の 1 件 (大会一覧の行。タグの判定キーは ../js/tags.js) */
/** @typedef {{ event_id: number, tournament_name: string, event_name?: string, series?: string | null, city?: string | null, venue?: string | null,
 *              date: string, nent: number, has_detail?: boolean, is_weekend?: boolean, is_weekend_real?: boolean, is_pre?: boolean,
 *              is_restricted?: boolean, is_lower_class?: boolean, is_uchi?: boolean, is_special_rules?: boolean, is_small?: boolean,
 *              is_awaiting_resume?: boolean, is_gf_missing?: boolean,
 *              top_players?: { uid: number, display?: string | null, rank?: number | null }[], [k: string]: any }} EventRow */

const STATE = {
  /** @type {EventRow[]} */
  events: [],
  /** @type {EventRow[]} */
  filtered: [],
  searchText: '',
  minNent: 0,
  periodDays: 0,
  /** @type {Set<string>} */
  activeTags: new Set(),  // {weekend, weekday, pre, restricted, lower, uchi}
  sortKey: 'date',
  sortDir: 'desc',
  cap: 200,  // initial render cap
  showAll: false,
};

const INITIAL_CAP = 200;
const PAGE_INCREMENT = 200;

// escapeHtml は ../js/html.js (サイト共通)

function applyFilters() {
  const ft = STATE.searchText.toLowerCase();
  const now = Date.now();
  const cutoff = STATE.periodDays > 0 ? (now - STATE.periodDays * 86400 * 1000) : null;
  STATE.filtered = STATE.events.filter(e => {
    if (ft) {
      const hay = (e.tournament_name + ' ' + (e.event_name || '') + ' ' + (e.series || '') + ' ' + (e.city || '') + ' ' + (e.venue || '')).toLowerCase();
      if (!hay.includes(ft)) return false;
    }
    if (e.nent < STATE.minNent) return false;
    if (cutoff != null) {
      const t = Date.parse(e.date + 'T00:00:00' + SITE_UTC_OFFSET);   // 暦日は地域の時差 (region/config.js)
      if (Number.isFinite(t) && t < cutoff) return false;
    }
    const tags = STATE.activeTags;
    if (tags.size > 0) {
      // どれかの tag に match (= OR で絞る). weekend / weekday は排他に扱う.
      if (tags.has('weekend') && !e.is_weekend) return false;
      if (tags.has('weekday') && e.is_weekend) return false;
      if (tags.has('pre') && !e.is_pre) return false;
      if (tags.has('restricted') && !e.is_restricted) return false;
      if (tags.has('lower') && !e.is_lower_class) return false;
      if (tags.has('uchi') && !e.is_uchi) return false;
      if (tags.has('special') && !e.is_special_rules) return false;
      if (tags.has('awaiting') && !e.is_awaiting_resume) return false;
      if (tags.has('gfmissing') && !e.is_gf_missing) return false;
    }
    return true;
  });
  const sign = STATE.sortDir === 'asc' ? 1 : -1;
  const k = STATE.sortKey;
  STATE.filtered.sort((a, b) => {
    if (k === 'date') return sign * (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0));
    if (k === 'name') return sign * a.tournament_name.localeCompare(b.tournament_name, 'ja');
    if (k === 'series') return sign * (a.series || '').localeCompare(b.series || '', 'ja');
    if (k === 'city') return sign * (a.city || '').localeCompare(b.city || '', 'ja');
    if (k === 'nent') return sign * (a.nent - b.nent);
    return 0;
  });
}

function render() {
  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  const rows = STATE.filtered;
  const shown = rows.slice(0, STATE.cap);
  if (shown.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-msg">${i18n('events.none')}</td></tr>`;
  } else {
    const html = shown.map(e => {
      const tags = [];
      // タグの文言・判定は ../js/tags.js。ここでは .tag のクラス名だけ
      const st = SPSPTags.statusTag(e, { resume: 'tag tag-resume', gf: 'tag tag-gf' });
      if (st) tags.push(st);
      tags.push(SPSPTags.dayTag(e, { wk: 'tag tag-wk', wd: 'tag tag-wd' }));
      tags.push(...SPSPTags.flagTags(e, { pre: 'tag tag-pre', res: 'tag tag-restr', lc: 'tag tag-low', uchi: 'tag tag-uchi', special: 'tag tag-special', small: 'tag tag-small' }));
      const seriesLink = e.series
        ? SPSPLinks.a(SPSPLinks.seriesRankingHref(SPSP.langRoot, e.series), escapeHtml(e.series), ' onclick="event.stopPropagation()"')
        : '';
      const evtSuffix = e.event_name && !/^Singles\s*$|^Ultimate Singles\s*$|^1on1\s*$/i.test(e.event_name)
        ? `<span class="event-suffix">/ ${escapeHtml(e.event_name)}</span>` : '';
      const nameCell = e.has_detail
        ? SPSPLinks.tournamentLink(SPSP.langRoot, e.event_id, escapeHtml(e.tournament_name))
        : `<span class="no-detail">${escapeHtml(e.tournament_name)}</span>`;
      const medalEmoji = ['🥇', '🥈', '🥉'];
      const topPlayersHtml = (e.top_players && e.top_players.length)
        ? `<div class="top-players">${e.top_players.map((p, i) => {
            const m = medalEmoji[Math.min(i, 2)];
            const nameLink = p.display
              ? SPSPLinks.playerLink(SPSP.langRoot, p.uid, escapeHtml(p.display), ' onclick="event.stopPropagation()"')
              : `<span style="color:#9ca3af">(uid: ${p.uid})</span>`;
            const rankPart = (p.rank != null) ? `<span class="rank">#${p.rank}</span>` : '';
            return `<span><span class="place">${m}</span>${nameLink}${rankPart}</span>`;
          }).join('<span class="sep">·</span>')}</div>`
        : '';
      const cityText = e.city ? escapeHtml(e.city) : '';
      return `
        <tr class="event-row">
          <td class="col-date">${e.date}</td>
          <td class="col-name">${nameCell}${evtSuffix}${topPlayersHtml}</td>
          <td class="col-nent">${e.nent}</td>
          <td class="col-city" title="${e.venue ? escapeHtml(e.venue) : ''}">${cityText}</td>
          <td class="col-series">${seriesLink}</td>
          <td class="col-tags">${tags.join('')}</td>
        </tr>
      `;
    }).join('');
    let extra = '';
    if (rows.length > shown.length) {
      extra = `<tr><td colspan="6" class="empty-msg">${i18n('events.load_more', { n: rows.length - shown.length })}</td></tr>`;
    }
    tbody.innerHTML = html + extra;
  }
  SPSPListPage.updateSortIndicators(STATE.sortKey, STATE.sortDir);   // ../js/list_page.js
  const status = document.getElementById('status');
  if (status) status.textContent = i18n('events.status', { n: rows.length, total: STATE.events.length });
}

function syncUrl() {
  const url = new URL(location.href);
  /** @param {string} k @param {string | number | null} v @param {string | number} def */
  const set = (k, v, def) => {
    if (v == null || String(v) === String(def)) url.searchParams.delete(k);
    else url.searchParams.set(k, String(v));
  };
  set('q', STATE.searchText, '');
  set('minNent', STATE.minNent, 0);
  set('period', STATE.periodDays, 0);
  set('tags', [...STATE.activeTags].join(','), '');
  set('sort', STATE.sortKey, 'date');
  set('dir', STATE.sortDir, 'desc');
  history.replaceState(null, '', url.toString());
}

function readUrl() {
  const url = new URL(location.href);
  const q = url.searchParams.get('q');
  if (q) STATE.searchText = q;
  const mn = parseInt(url.searchParams.get('minNent') || '0', 10);
  if (Number.isFinite(mn) && mn >= 0) STATE.minNent = mn;
  const pd = parseInt(url.searchParams.get('period') || '0', 10);
  if (Number.isFinite(pd) && pd >= 0) STATE.periodDays = pd;
  const tg = url.searchParams.get('tags');
  if (tg) tg.split(',').filter(Boolean).forEach(t => STATE.activeTags.add(t));
  const sk = url.searchParams.get('sort');
  if (sk && ['date', 'name', 'nent', 'series'].includes(sk)) STATE.sortKey = sk;
  const sd = url.searchParams.get('dir');
  if (sd === 'asc' || sd === 'desc') STATE.sortDir = sd;
  // Reflect to UI
  const search = /** @type {HTMLInputElement | null} */ (document.getElementById('search'));
  if (search) search.value = STATE.searchText;
  document.querySelectorAll('#filter-nent .chip').forEach(c0 => {
    const c = /** @type {HTMLElement} */ (c0);
    c.classList.toggle('active', parseInt(/** @type {string} */ (c.dataset.nent), 10) === STATE.minNent);
  });
  document.querySelectorAll('#filter-period .chip').forEach(c0 => {
    const c = /** @type {HTMLElement} */ (c0);
    c.classList.toggle('active', parseInt(/** @type {string} */ (c.dataset.period), 10) === STATE.periodDays);
  });
  document.querySelectorAll('#filter-tags .chip').forEach(c0 => {
    const c = /** @type {HTMLElement} */ (c0);
    c.classList.toggle('active', STATE.activeTags.has(/** @type {string} */ (c.dataset.tag)));
  });
}

function setupEvents() {
  // 検索と並べ替え見出しの配線は ../js/list_page.js (一覧ページ共通)
  SPSPListPage.bindSearch(text => {
    STATE.searchText = text;
    syncUrl(); applyFilters(); STATE.cap = INITIAL_CAP; render();
  });
  document.querySelectorAll('#filter-nent .chip').forEach(chip0 => {
    const chip = /** @type {HTMLElement} */ (chip0);
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filter-nent .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      STATE.minNent = parseInt(/** @type {string} */ (chip.dataset.nent), 10) || 0;
      syncUrl(); applyFilters(); STATE.cap = INITIAL_CAP; render();
    });
  });
  document.querySelectorAll('#filter-period .chip').forEach(chip0 => {
    const chip = /** @type {HTMLElement} */ (chip0);
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filter-period .chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      STATE.periodDays = parseInt(/** @type {string} */ (chip.dataset.period), 10) || 0;
      syncUrl(); applyFilters(); STATE.cap = INITIAL_CAP; render();
    });
  });
  document.querySelectorAll('#filter-tags .chip').forEach(chip0 => {
    const chip = /** @type {HTMLElement} */ (chip0);
    chip.addEventListener('click', () => {
      const t = /** @type {string} */ (chip.dataset.tag);
      if (STATE.activeTags.has(t)) {
        STATE.activeTags.delete(t);
        chip.classList.remove('active');
      } else {
        // weekend / weekday は排他
        if (t === 'weekend' && STATE.activeTags.has('weekday')) {
          STATE.activeTags.delete('weekday');
          const other = document.querySelector('#filter-tags .chip[data-tag="weekday"]');
          if (other) other.classList.remove('active');
        } else if (t === 'weekday' && STATE.activeTags.has('weekend')) {
          STATE.activeTags.delete('weekend');
          const other = document.querySelector('#filter-tags .chip[data-tag="weekend"]');
          if (other) other.classList.remove('active');
        }
        STATE.activeTags.add(t);
        chip.classList.add('active');
      }
      syncUrl(); applyFilters(); STATE.cap = INITIAL_CAP; render();
    });
  });
  SPSPListPage.bindSortHeaders(STATE, ['name', 'series', 'city'], () => {
    syncUrl(); applyFilters(); render();
  });
  // Infinite scroll: extend cap as user scrolls.
  window.addEventListener('scroll', () => {
    if (STATE.cap >= STATE.filtered.length) return;
    const scrollBottom = window.innerHeight + window.scrollY;
    const docHeight = document.documentElement.scrollHeight;
    if (scrollBottom > docHeight - 400) {
      STATE.cap = Math.min(STATE.filtered.length, STATE.cap + PAGE_INCREMENT);
      render();
    }
  });
}

async function init() {
  setupEvents();
  try {
    const t0 = performance.now();
    const res = await fetch(SPSP.data + 'data/tournaments.json');
    if (!res.ok) throw new Error(i18n('common.fetch_failed', { file: 'tournaments.json' }));
    const j = await res.json();
    STATE.events = j.tournaments || [];
    const footer = document.getElementById('footer-info');
    if (footer) footer.innerHTML =
      i18n('events.footer', { date: escapeHtml(j.generated_at || ''), n: STATE.events.length }) + ' · ' +
      `<a href="${SPSP.langRoot}${SPSP.pageHref('index.html')}">${i18n('common.national_ranking')}</a> · <a href="${SPSP.langRoot}local/">${i18n('local_ranking.title')}</a>`;
    readUrl();
    applyFilters();
    render();
    const status = document.getElementById('status');
    if (status) status.textContent =
      i18n('events.status_ms', { n: STATE.filtered.length, total: STATE.events.length, ms: (performance.now()-t0).toFixed(0) });
  } catch (e) {
    const tbody = document.getElementById('tbody');
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="6" class="empty-msg" style="color:#dc2626">${escapeHtml(/** @type {Error} */ (e).message)}</td></tr>`;
  }
}

init();
