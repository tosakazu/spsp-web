// @ts-check
// src/pages/pref_index.js — site/pref/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/pref_index.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPGeo from '../../site/js/geo.js';
import SPSPData from '../../site/js/data.js';
import SPSPListPage from '../../site/js/list_page.js';
import '../../site/nav.js';

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

// 都道府県の一覧・並び順・表示名は data/geo.json (定義元は smash_database の scripts/<地域>/geo.py、docs/geo_json.md)。init で読む。
/** @type {string[]} */
let PREF_ORDER = [];
/** @type {Record<string, number>} */
let PREF_INDEX = {};
/** @type {Record<string, string>} */
let PREF_NAME = {};   // unit id → 表示言語の名前 (英語ページでは Tokyo)
/** @param {SpspGeoCatalog} geo */
function setGeoCatalog(geo) {
  if (!geo || !Array.isArray(geo.units)) throw new Error('geo.json の形が違います');
  PREF_ORDER = geo.units.map((u) => u.id);
  PREF_INDEX = {}; PREF_ORDER.forEach((p, i) => { PREF_INDEX[p] = i; });
  PREF_NAME = {}; geo.units.forEach((u) => { PREF_NAME[u.id] = SPSPI18n.pick(u.name) || u.id; });
  SPSPGeo.setGeoCatalog(geo);   // リンクの URL キー (geo.js unitUrlKey: '東京都' → 'tokyo') に使う
}
/** @param {string} id @returns {string} */
const prefName = (id) => PREF_NAME[id] || id;

/** 都道府県ごとの集計 (name = 単位 id、rank_* は assignFixedRanks が付ける) */
/** @typedef {{ name: string, n: number, top_uid: number | null, top_rank: number | null, rank_top?: number, rank_n?: number, rank_name?: number, [k: string]: any }} PrefAgg */

const STATE = {
  /** @type {PrefAgg[]} */
  prefs: [],                     // [{name, n, top_uid, top_rank}]
  /** @type {Map<number, string>} */
  uid_to_display: new Map(),
  /** @type {PrefAgg[]} */
  filtered: [],
  sortKey: 'top_rank',
  sortDir: 'asc',
  searchText: '',
};

// escapeHtml は ../js/html.js (サイト共通)

// 各 sort key の canonical direction で 1..N 番号を割り当てる。
function assignFixedRanks() {
  const ps = STATE.prefs;
  const byTop = ps.slice().sort((a, b) =>
    (a.top_rank == null ? Infinity : a.top_rank) - (b.top_rank == null ? Infinity : b.top_rank));
  byTop.forEach((p, i) => { p.rank_top = i + 1; });
  const byN = ps.slice().sort((a, b) => (b.n || 0) - (a.n || 0));
  byN.forEach((p, i) => { p.rank_n = i + 1; });
  const byName = ps.slice().sort((a, b) => (PREF_INDEX[a.name] ?? 99) - (PREF_INDEX[b.name] ?? 99));
  byName.forEach((p, i) => { p.rank_name = i + 1; });
}

/** @param {PrefAgg} p */
function currentRankOf(p) {
  if (STATE.sortKey === 'name') return p.rank_name;
  if (STATE.sortKey === 'n') return p.rank_n;
  return p.rank_top;
}

function applyFilters() {
  const ft = STATE.searchText.trim();
  STATE.filtered = STATE.prefs.filter(p => !ft || p.name.includes(ft) || prefName(p.name).toLowerCase().includes(ft));
  const sign = STATE.sortDir === 'asc' ? 1 : -1;
  const key = STATE.sortKey;
  STATE.filtered.sort((a, b) => {
    if (key === 'name') return sign * ((PREF_INDEX[a.name] ?? 99) - (PREF_INDEX[b.name] ?? 99));
    if (key === 'top_rank') {
      const av = a.top_rank == null ? Infinity : a.top_rank;
      const bv = b.top_rank == null ? Infinity : b.top_rank;
      return sign * (av - bv);
    }
    return sign * ((a[key] || 0) - (b[key] || 0));
  });
}

function render() {
  const tbody = document.getElementById('tbody');
  if (!tbody) return;
  const rows = STATE.filtered;
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-msg">${i18n('common.none')}</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(p => {
      const url = `${SPSP.pageHref('ranking.html')}?pref=${encodeURIComponent(SPSPGeo.unitUrlKey(p.name))}`;
      let topHtml = '<span style="color:#9ca3af">—</span>';
      if (p.top_uid != null) {
        const disp = STATE.uid_to_display.get(p.top_uid) || `uid:${p.top_uid}`;
        const rankFrag = p.top_rank ? `<span class="top-rank">#${p.top_rank}</span>` : '';
        topHtml = SPSPLinks.playerLink(SPSP.langRoot, p.top_uid, escapeHtml(disp)) + rankFrag;
      }
      return `
        <tr class="pref-row" onclick="if(event.target.closest('a'))return;location.href='${url}'">
          <td class="col-idx">${currentRankOf(p)}</td>
          <td class="col-name"><a href="${url}">${escapeHtml(prefName(p.name))}</a></td>
          <td class="col-num">${p.n}</td>
          <td class="col-top">${topHtml}</td>
        </tr>`;
    }).join('');
  }
  SPSPListPage.updateSortIndicators(STATE.sortKey, STATE.sortDir);   // ../js/list_page.js
  const status = document.getElementById('status');
  if (status) status.textContent = i18n('pref_list.status', { n: rows.length, total: STATE.prefs.length });
}

function setupEvents() {
  // 検索と並べ替え見出しの配線は ../js/list_page.js (一覧ページ共通)
  SPSPListPage.bindSearch(text => { STATE.searchText = text; applyFilters(); render(); });
  SPSPListPage.bindSortHeaders(STATE, ['name', 'top_rank'], () => { applyFilters(); render(); });
}

async function init() {
  setupEvents();
  try {
    const [prefRes, jsonlRes, overseasRes, geoRes] = await Promise.all([
      fetch(SPSP.data + 'data/player_prefectures.json'),
      fetch(SPSP.data + 'latest_tjpr_full.jsonl'),
      fetch(SPSP.data + 'data/overseas.json').catch(() => null),
      fetch(SPSP.data + 'data/geo.json'),
    ]);
    if (!prefRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'player_prefectures.json' }));
    if (!geoRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'geo.json' }));
    setGeoCatalog(await geoRes.json());
    if (!jsonlRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'latest_tjpr_full.jsonl' }));
    const prefMap = await prefRes.json();
    /** @type {Set<number> | null} */
    let overseasUids = null;
    if (overseasRes && overseasRes.ok) {
      try { overseasUids = new Set((await overseasRes.json()).uids || []); } catch (e) {}
    }
    // jsonl を走査し、ランク付き選手を都道府県別に集計。
    /** @type {Record<string, { n: number, top_uid: number | null, top_rank: number | null }>} */
    const agg = {};   // pref -> {n, top_uid, top_rank}
    for (const rec of /** @type {SpspRankRecord[]} */ (SPSPData.parseJsonl(await jsonlRes.text()))) {   // ../js/data.js
      const pref = prefMap[String(rec.user_id)];
      if (!pref) continue;
      const ens = (rec.ranks && rec.ranks.ensemble) || null;
      const a = agg[pref] || (agg[pref] = { n: 0, top_uid: null, top_rank: null });
      a.n++;
      // 全一 = 海外勢を除いた最上位 (ens 最小)。
      if (!(overseasUids && overseasUids.has(rec.user_id)) && ens != null
          && (a.top_rank == null || ens < a.top_rank)) {
        a.top_rank = ens; a.top_uid = rec.user_id;
        STATE.uid_to_display.set(rec.user_id, rec.display);
      }
    }
    STATE.prefs = Object.keys(agg).map(name => ({ name, ...agg[name] }));
    assignFixedRanks();
    applyFilters(); render();
    const total = STATE.prefs.reduce((s, p) => s + p.n, 0);
    const footer = document.getElementById('footer-info');
    if (footer) footer.innerHTML =
      i18n('pref_list.footer', { n: STATE.prefs.length, total }) + '<br>' +
      `<a href="${SPSP.langRoot}">${i18n('common.back_to_national')}</a>`;
  } catch (e) {
    const tbody = document.getElementById('tbody');
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="4" class="empty-msg">${i18n('common.load_error', { message: escapeHtml(/** @type {Error} */ (e).message) })}</td></tr>`;
    const status = document.getElementById('status');
    if (status) status.textContent = '';
  }
}
init();
