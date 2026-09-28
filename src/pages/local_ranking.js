// @ts-check
// src/pages/local_ranking.js — site/local/ranking.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/local_ranking.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPUrlKey from '../../site/js/url_key.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/js/format.js';
import SPSPTags from '../../site/js/tags.js';
import '../../site/ranking-table.js';
import SPSPDetail from '../../site/player-detail.js';
import SPSPRankingPage from '../../site/js/ranking_page.js';
import '../../site/nav.js';
import '../../site/share.js';
import { SPSPTrackPage } from '../../site/nav.js';
import SPSPRankingTable from '../../site/ranking-table.js';
import SPSPShare from '../../site/share.js';

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

/** シリーズの参加者 (series.json の participants の要素) */
/** @typedef {{ uid: number, n: number, first: string, last: string }} Participant */
/** 表に出す行 = master の記録にローカルの参加回数 / 初参加 / 最終参加を足したもの */
/** @typedef {SpspRankRecord & { localN?: number, localLast?: string, localFirst?: string }} LocalRec */

/** @type {{ series: SpspSeriesSummary | null, participants: Participant[], masterMap: Map<number, SpspRankRecord>, masterMeta: SpspRankMeta | null,
 *            data: LocalRec[], method: string, sortKey: string, sortDir: string, searchText: string, minN: number, periodDays: number,
 *            overseasUids?: Set<number> | null, charIdx?: SpspCharacterIndex | null }} */
const STATE = {
  series: null,           // series object from series.json
  participants: [],       // [{uid, n, first, last}]
  masterMap: new Map(),   // uid → master record
  masterMeta: null,
  data: [],               // current displayed records (after re-rank)
  method: 'ensemble',
  sortKey: 'rank',
  sortDir: 'asc',
  searchText: '',
  minN: 1,
  periodDays: 365,
};

// escapeHtml は ../js/html.js (サイト共通)。表の骨格 (列・配線・行の展開・読み込み) は ../js/ranking_page.js
const RP = SPSPRankingPage;

/** @returns {Participant[]} */
function filterParticipants() {
  if (!STATE.series) return [];
  let parts = /** @type {Participant[]} */ (STATE.series.participants).slice();
  parts = parts.filter(p => p.n >= STATE.minN);
  if (STATE.periodDays > 0) {
    const lastDate = new Date(STATE.series.last_date + 'T00:00:00Z');
    const cutoff = new Date(lastDate.getTime() - STATE.periodDays * 86400 * 1000);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    parts = parts.filter(p => p.last >= cutoffStr);
  }
  return parts;
}

/** @param {Participant[]} parts @returns {LocalRec[]} */
function filterAndRerank(parts) {
  // Build records from MASTER_MAP filtered by participant uid set
  /** @type {LocalRec[]} */
  const ranked = [];
  /** @type {Participant[]} */
  const missing = [];
  const partMap = new Map(parts.map(p => [p.uid, p]));
  for (const p of parts) {
    if (STATE.masterMap.has(p.uid)) {
      const rec = /** @type {LocalRec} */ (RP.cloneWithGlobalRanks(STATE.masterMap.get(p.uid)));
      rec.localN = p.n;
      rec.localLast = p.last;
      rec.localFirst = p.first;
      ranked.push(rec);
    } else {
      missing.push(p);
    }
  }
  // Ensemble は global ensemble の昇順で 1..N に再付番
  RP.rerankByGlobalEnsemble(ranked);
  // 順位/直対は全体ランキングのまま (= global rank を表示)
  // global rank を local rank に投影する必要はない (seed と同じポリシー).
  // → tjpr, bt_gated は global rank をそのまま使う.
  let next = ranked.length + 1;
  missing.sort((a, b) => (b.n - a.n) || (a.uid - b.uid));
  for (const p of missing) {
    ranked.push({
      user_id: p.uid,
      display: `(uid: ${p.uid})`,
      unranked: true,
      localN: p.n, localLast: p.last, localFirst: p.first,
      ranks: { ensemble: next, tjpr: null, bt_gated: null,
               global_ensemble: null, global_tjpr: null, global_bt_gated: null },
      scores: { tjpr_score: 0, tjpr_elo: 0, tjpr_level: 0,
                bt_gated_ordinal: 0, bt_gated_elo: 0,
                ensemble_avg_rank: null, ensemble_avg_score: null },
      metadata: { tour_count_3y: 0, bt_weekday_included: true, provisional: true, matches_count_3y: 0 },
    });
    next += 1;
  }
  return ranked;
}

function applyFilters() {
  const parts = filterParticipants();
  STATE.data = filterAndRerank(parts);
  // メイン rank 列 (ensemble) のみ jp-counter 化. tjpr/bt_gated は GLOBAL 順位を保持しているので
  // ローカルプール内でのカウンター化は意味を持たない → ['ensemble'] 限定.
  if (STATE.overseasUids && SPSPRankingTable && SPSPRankingTable.computeDisplayRanks) {
    SPSPRankingTable.computeDisplayRanks(STATE.data, STATE.overseasUids, ['ensemble']);
  }
  if (STATE.charIdx && SPSPRankingTable && SPSPRankingTable.attachZenichi) {
    SPSPRankingTable.attachZenichi(STATE.data, STATE.charIdx, STATE.overseasUids);
  }
}

// ローカル固有の追加列 (= 参加 / 最終参加).
const LOCAL_EXTRA_COLUMNS = [
  { id: 'n', label: i18n('local_ranking.col.n'), sortable: true, sortKey: 'n', css: 'col-n',
    value: (/** @type {LocalRec} */ rec) => -(rec.localN || 0),
    cell: (/** @type {LocalRec} */ rec) => rec.localN || '' },
  { id: 'last', label: i18n('local_ranking.col.last'), sortable: true, sortKey: 'last', css: 'col-last',
    value: (/** @type {LocalRec} */ rec) => rec.localLast || '',
    cell: (/** @type {LocalRec} */ rec) => rec.localLast || '' },
];

// 平均順位 / 平均スコアの代わりに 直対評 / 順位評 を小さい灰色で表示する (../js/ranking_page.js)
const { TJPR_SCORE_COL, BT_SCORE_COL } = RP.scoreColumns('inline');

/** @type {import('../../site/ranking-table.js').RankingTable | null} */
let TABLE = null;
function ensureTable() {
  if (TABLE) return TABLE;
  TABLE = RP.createTable({
    rows: STATE.data,
    method: STATE.method,
    sort: { key: STATE.sortKey, dir: STATE.sortDir },
    pageSize: 200,
    totalForRankFrac: 'rows',
    playerHrefPrefix: SPSP.langRoot,
    showGlobalRank: true,            // ローカル: 全国 #N バッジ
    showLocalExtras: true,           // ローカル: 参加回数 / 最終参加日 を mobile に出す
    columns: [
      'rank', 'display', BT_SCORE_COL, TJPR_SCORE_COL,
      'tjpr_lv', 'tour_count', 'bt_weekday',
      'rank_tjpr', 'rank_bt_gated',
      ...LOCAL_EXTRA_COLUMNS,
    ],
    rowClick: (rec, tr, ev) => localRowClickHandler(rec, tr, ev),
    statusEl: document.getElementById('status'),
    statusTotal: () => STATE.data.length,
  });
  return TABLE;
}

function render() {
  RP.applyState(ensureTable(), { rows: STATE.data, method: STATE.method, filterText: STATE.searchText,
                                 sort: { key: STATE.sortKey, dir: STATE.sortDir } });
}

function setupEvents() {
  RP.bindSearch(text => {
    STATE.searchText = text;
    if (TABLE) TABLE.setFilterText(STATE.searchText);
  });
  RP.bindMethodTabs(method => {
    STATE.method = method;
    syncUrl();
    if (TABLE) TABLE.setMethod(STATE.method);
  });
  // sortable / 無限スクロール / 行クリック はコンポーネント側に統合済.
  // STATE.sortKey / sortDir は filter 操作の URL ハンドリングで参照される可能性があるので残す.

  // フィルタ変更時に自動適用 + URL を更新.
  const minNEl = /** @type {HTMLInputElement | null} */ (document.getElementById('min-n'));
  const periodEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('period-sel'));
  if (!minNEl || !periodEl) return;
  const onFilterChange = () => {
    STATE.minN = Math.max(1, parseInt(minNEl.value, 10) || 1);
    STATE.periodDays = parseInt(periodEl.value, 10) || 0;
    syncUrl();
    applyFilters();
    render();
  };
  minNEl.addEventListener('input', onFilterChange);
  minNEl.addEventListener('change', onFilterChange);
  periodEl.addEventListener('change', onFilterChange);
  // 共有ボタン.
  setupShareBtn();
}

function syncUrl() {
  // 現在の STATE.minN / periodDays / method を URL クエリに反映 (履歴を増やさず replaceState).
  const url = new URL(location.href);
  url.searchParams.set('minN', String(STATE.minN));
  url.searchParams.set('period', String(STATE.periodDays));
  url.searchParams.set('method', STATE.method);
  history.replaceState(null, '', url.toString());
}

function setupShareBtn() {
  SPSPShare.setup(document.getElementById('share-icon-btn'), () => {
    const name = STATE.series ? STATE.series.name : i18n('local_ranking.title');
    return {
      title: i18n('local_ranking.heading', { name }),
      text:  i18n('local_ranking.share.text', { name }),
      url:   location.href,
    };
  });
}

function readUrlFilters() {
  // URL から minN / period / method を初期値として読む.
  const url = new URL(location.href);
  const minNRaw = url.searchParams.get('minN');
  if (minNRaw != null) {
    const v = parseInt(minNRaw, 10);
    if (Number.isFinite(v) && v >= 1) STATE.minN = v;
  }
  const periodRaw = url.searchParams.get('period');
  if (periodRaw != null) {
    const v = parseInt(periodRaw, 10);
    if (Number.isFinite(v) && v >= 0) STATE.periodDays = v;
  }
  const methodRaw = url.searchParams.get('method');
  if (methodRaw && ['ensemble', 'tjpr', 'bt_gated'].includes(methodRaw)) {
    STATE.method = methodRaw;
  }
  // UI に反映.
  const minNEl = /** @type {HTMLInputElement | null} */ (document.getElementById('min-n'));
  if (minNEl) minNEl.value = String(STATE.minN);
  const periodSel = /** @type {HTMLSelectElement | null} */ (document.getElementById('period-sel'));
  if (periodSel && [...periodSel.options].some(o => o.value === String(STATE.periodDays))) {
    periodSel.value = String(STATE.periodDays);
  }
  document.querySelectorAll('.method-tab').forEach(t0 => {
    const t = /** @type {HTMLElement} */ (t0);
    t.classList.toggle('active', t.dataset.method === STATE.method);
  });
}

async function init() {
  readUrlFilters();
  setupEvents();
  const seriesKey = RP.getQueryParam('series');   // URL キー (url_key.js nameKey)。旧 URL のシリーズ名も引ける
  let seriesName = seriesKey;
  const titleH1 = document.getElementById('title-h1');
  const tbody = document.getElementById('tbody');
  const metaRow = document.getElementById('meta-row');
  const footer = document.getElementById('footer-info');
  const status = document.getElementById('status');
  if (!seriesName) {
    if (titleH1) titleH1.textContent = i18n('local_ranking.no_series');
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="11" class="empty-msg"><a href="./" style="color:#dc2626">${i18n('local_ranking.back_to_list')}</a></td></tr>`;
    return;
  }
  try {
    const t0 = performance.now();
    const [seriesRes, master] = await Promise.all([
      fetch(SPSP.data + 'data/series.json'),
      RP.loadMaster(SPSP.data, { overseas: true, charIdx: true }),
    ]);
    if (!seriesRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'series.json' }));
    STATE.overseasUids = master.overseasUids;
    STATE.charIdx = master.charIdx;
    const seriesJson = await seriesRes.json();
    STATE.masterMeta = /** @type {SpspRankMeta} */ (master.meta);
    const seriesList = /** @type {SpspSeriesSummary[]} */ (seriesJson.series || []);
    STATE.series = seriesList.find(s => SPSPLinks.seriesKey(s.name) === seriesKey) || seriesList.find(s => s.name === seriesKey) || null;
    if (STATE.series) {
      seriesName = STATE.series.name;
      SPSPUrlKey.canonicalizeParam('series', SPSPLinks.seriesKey(seriesName));
    }
    if (!STATE.series) {
      if (titleH1) titleH1.textContent = i18n('local_ranking.not_found', { name: seriesName });
      if (tbody) tbody.innerHTML =
        `<tr><td colspan="11" class="empty-msg"><a href="./" style="color:#dc2626">${i18n('local_ranking.back_to_list')}</a></td></tr>`;
      return;
    }
    for (const rec of master.recs) STATE.masterMap.set(rec.user_id, rec);

    // Update header
    document.title = i18n('local_ranking.doc_title', { name: seriesName });
    if (titleH1) titleH1.textContent = i18n('local_ranking.heading', { name: seriesName });
    if (SPSPTrackPage) {
      SPSPTrackPage(document.title, `/local/${encodeURIComponent(seriesName)}`);
    }
    const s = STATE.series;
    const tags = [];
    if (s.is_uchi) tags.push(`<span style="color:#6b21a8;background:rgba(168,85,247,0.12);padding:1px 6px;border-radius:8px;font-size:11px">${SPSPTags.TEXT.uchi}</span>`);
    if (s.is_special_rules) tags.push(`<span style="color:#be185d;background:rgba(236,72,153,0.10);padding:1px 6px;border-radius:8px;font-size:11px">${SPSPTags.TEXT.special}</span>`);
    if (s.restricted) tags.push(`<span style="color:#d97706;background:rgba(217,119,6,0.10);padding:1px 6px;border-radius:8px;font-size:11px">${SPSPTags.TEXT.res}</span>`);
    if (s.is_all_small) tags.push(`<span title="${i18n('local.all_small_title')}" style="color:#4b5563;background:rgba(107,114,128,0.12);padding:1px 6px;border-radius:8px;font-size:11px">${SPSPTags.TEXT.small}</span>`);
    if (metaRow) metaRow.innerHTML =
      `<span><b>${i18n('local_ranking.meta.total')}</b>${i18n('local_ranking.meta.times', { n: s.tour_count })}</span>` +
      `<span><b>${i18n('local_ranking.meta.latest')}</b>${s.last_date}</span>` +
      `<span><b>${i18n('local_ranking.meta.first')}</b>${s.first_date}</span>` +
      `<span><b>${i18n('local_ranking.meta.avg')}</b>${i18n('local_ranking.meta.people', { n: s.avg_entrants.toFixed(0) })}</span>` +
      `<span><b>${i18n('local_ranking.meta.participants')}</b>${i18n('local_ranking.meta.people', { n: s.participant_count })}</span>` +
      tags.join(' ');
    const meta = STATE.masterMeta;
    if (footer) footer.innerHTML =
      i18n('local_ranking.footer.generated', { date: escapeHtml(meta.eval_date || ''), n: meta.n_players }) + ' · ' +
      `<a href="./">${i18n('local_ranking.footer_back')}</a> · <a href="${SPSP.langRoot}${SPSP.pageHref('index.html')}">${i18n('common.national_ranking')}</a>`;

    applyFilters();
    render();
    if (status) status.textContent =
      i18n('ranking.status.loaded_people', { n: STATE.data.length, ms: (performance.now() - t0).toFixed(0) });
  } catch (e) {
    console.error(e);
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="11" class="empty-msg" style="color:#dc2626">${escapeHtml(/** @type {Error} */ (e).message)}</td></tr>`;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 詳細パネル (大会別の詳細 / 直接対決) は ../player-detail.js (= canonical
// site/index.html の inline 実装を移植した SPSPDetail) に集約.
// 本ファイルは SPSPDetail.buildDetailContent / fetchPlayerDetail を呼び出すだけ.
// ─────────────────────────────────────────────────────────────────────
function getDetailCfg() {
  return {
    getMeta: () => STATE.masterMeta || {},
    getDataArray: () => STATE.data,
    getMasterMap: () => STATE.masterMap,  // STATE.data に居ない uid の opp は master から解決
    pathPrefix: SPSP.langRoot, dataPrefix: SPSP.data,
  };
}

// 展開行の中のクリック処理 (tab 切替 / H2H expand / 並べ替え / さらに表示) と
// main-row クリック → 展開行の出し入れは ../js/ranking_page.js。
RP.bindDetailClicks(document.getElementById('tbody'), getDetailCfg);
/** @param {SpspRankRecord} rec @param {HTMLTableRowElement} tr @param {Event} _ev */
function localRowClickHandler(rec, tr, _ev) {
  RP.rowClickHandler(rec, tr, { cfg: getDetailCfg(), colspan: 11 });
}

init();
