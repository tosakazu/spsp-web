// @ts-check
// src/pages/pref_ranking.js — site/pref/ranking.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/pref_ranking.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/js/links.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/js/format.js';
import '../../site/js/tags.js';
import '../../site/ranking-table.js';
import '../../site/player-detail.js';
import SPSPRankingPage from '../../site/js/ranking_page.js';
import '../../site/nav.js';
import SPSPGeo from '../../site/js/geo.js';
import SPSPUrlKey from '../../site/js/url_key.js';

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

const STATE = {
  /** @type {string | null} */
  pref: null,
  /** @type {Record<string, string> | null} */
  prefMap: null,               // uid(str) -> 都道府県
  /** @type {Map<number, SpspRankRecord>} */
  masterMap: new Map(),        // uid -> rec
  /** @type {SpspRankMeta | null} */
  masterMeta: null,
  /** @type {SpspRankRecord[]} */
  data: [],
  method: 'ensemble',
  sortKey: 'rank',
  sortDir: 'asc',
  searchText: '',
};

// escapeHtml は ../js/html.js (サイト共通)。表の骨格 (列・配線・行の展開・読み込み) は ../js/ranking_page.js
const RP = SPSPRankingPage;

function buildData() {
  /** @type {SpspRankRecord[]} */
  const ranked = [];
  const prefMap = /** @type {Record<string, string>} */ (STATE.prefMap);   // init で読んでから呼ばれる
  for (const [uid, src] of STATE.masterMap) {
    if (prefMap[String(uid)] !== STATE.pref) continue;
    ranked.push(RP.cloneWithGlobalRanks(src));
  }
  return RP.rerankByGlobalEnsemble(ranked);
}

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
    showGlobalRank: true,
    columns: [
      'rank', 'display', BT_SCORE_COL, TJPR_SCORE_COL,
      'tjpr_lv', 'tour_count', 'bt_weekday',
      'rank_tjpr', 'rank_bt_gated',
    ],
    rowClick: (rec, tr, ev) => prefRowClickHandler(rec, tr, ev),
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
    if (TABLE) TABLE.setMethod(STATE.method);
  });
}

async function init() {
  setupEvents();
  STATE.pref = RP.getQueryParam('pref');
  const titleH1 = document.getElementById('title-h1');
  const tbody = document.getElementById('tbody');
  const footer = document.getElementById('footer-info');
  const status = document.getElementById('status');
  if (!STATE.pref) {
    if (titleH1) titleH1.textContent = i18n('pref_ranking.no_pref');
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="11" class="empty-msg"><a href="./" style="color:#dc2626">${i18n('pref_ranking.back_to_list')}</a></td></tr>`;
    return;
  }
  try {
    const t0 = performance.now();
    const [prefRes, master] = await Promise.all([
      fetch(SPSP.data + 'data/player_prefectures.json'),
      RP.loadMaster(SPSP.data),
      SPSPGeo.loadGeo(/** @type {string} */ (SPSP.data)).catch(() => null),   // 都道府県の表示名 (英語ページでは Tokyo)。無くても id で出す
    ]);
    // ?pref= は URL キー ('tokyo' / 北米 'CA')。旧 URL の '東京都' も引ける。読めたら URL を新しいキーに書き換える
    const prefId = SPSPGeo.unitFromUrlKey(STATE.pref);
    if (prefId) {
      STATE.pref = prefId;
      SPSPUrlKey.canonicalizeParam('pref', SPSPGeo.unitUrlKey(prefId));
    }
    const prefName = SPSPGeo.unitName(STATE.pref);
    if (!prefRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'player_prefectures.json' }));
    STATE.prefMap = await prefRes.json();
    STATE.masterMeta = /** @type {SpspRankMeta} */ (master.meta);

    for (const rec of master.recs) STATE.masterMap.set(rec.user_id, rec);
    STATE.data = buildData();

    document.title = i18n('pref_ranking.doc_title', { pref: prefName });
    if (titleH1) titleH1.textContent = i18n('pref_ranking.heading', { pref: prefName });
    if (footer) footer.innerHTML =
      i18n('ranking.footer.eval_date', { date: escapeHtml(STATE.masterMeta.eval_date || ''), n: STATE.data.length }) + ' · ' +
      `<a href="./">${i18n('pref_ranking.footer_back')}</a> · <a href="${SPSP.langRoot}${SPSP.pageHref('index.html')}">${i18n('common.national_ranking')}</a>`;

    if (STATE.data.length === 0) {
      if (tbody) tbody.innerHTML =
        `<tr><td colspan="11" class="empty-msg">${i18n('pref_ranking.empty', { pref: escapeHtml(prefName) })}<br><a href="./" style="color:#dc2626">${i18n('pref_ranking.back_to_list')}</a></td></tr>`;
    } else {
      render();
    }
    if (status) status.textContent =
      i18n('ranking.status.loaded_people', { n: STATE.data.length, ms: (performance.now() - t0).toFixed(0) });
  } catch (e) {
    console.error(e);
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="11" class="empty-msg" style="color:#dc2626">${escapeHtml(/** @type {Error} */ (e).message)}</td></tr>`;
  }
}

// 行クリック → 大会別詳細 / 直接対決 を inline 展開 (c/ranking.html と同形, player-detail.js)。
function getDetailCfg() {
  return {
    getMeta: () => STATE.masterMeta || {},
    getDataArray: () => STATE.data,
    getMasterMap: () => STATE.masterMap,
    pathPrefix: SPSP.langRoot, dataPrefix: SPSP.data,
  };
}
// 展開行の中のクリック処理 (tab 切替 / H2H expand / 並べ替え / さらに表示) も共通 (../js/ranking_page.js)
/** @param {SpspRankRecord} rec @param {HTMLTableRowElement} tr @param {Event} _ev */
function prefRowClickHandler(rec, tr, _ev) {
  RP.rowClickHandler(rec, tr, { cfg: getDetailCfg(), colspan: 11 });
}
RP.bindDetailClicks(document.getElementById('tbody'), getDetailCfg);

init();
