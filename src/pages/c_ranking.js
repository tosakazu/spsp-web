// @ts-check
// src/pages/c_ranking.js — site/c/ranking.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/c_ranking.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPCharEmoji from '../../site/js/char_emoji.js';
import '../../site/js/links.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/js/format.js';
import '../../site/js/tags.js';
import '../../site/ranking-table.js';
import SPSPDetail from '../../site/player-detail.js';
import SPSPRankingPage from '../../site/js/ranking_page.js';
import '../../site/nav.js';
import '../../site/share.js';
import { SPSPTrackPage } from '../../site/nav.js';
import SPSPRankingTable from '../../site/ranking-table.js';
import SPSPShare from '../../site/share.js';
import { charName } from '../../site/js/chars.js';

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

/** @type {{ charId: number | null, charName: string | null, index: SpspCharacterIndex | null, masterMap: Map<number, SpspRankRecord>,
 *            masterMeta: SpspRankMeta | null, data: SpspRankRecord[], method: string, sortKey: string, sortDir: string, searchText: string,
 *            overseasUids?: Set<number> | null }} */
const STATE = {
  charId: null,
  charName: null,
  index: null,                 // raw character_index.json
  masterMap: new Map(),        // uid -> rec
  masterMeta: null,
  data: [],
  method: 'ensemble',
  sortKey: 'rank',
  sortDir: 'asc',
  searchText: '',
};

// escapeHtml は ../js/html.js (サイト共通)。表の骨格 (列・配線・行の展開・読み込み) は ../js/ranking_page.js
const RP = SPSPRankingPage;

function buildData() {
  const uids = (STATE.index && STATE.index.main_by_char[String(STATE.charId)]) || [];
  /** @type {SpspRankRecord[]} */
  const ranked = [];
  for (const uid of uids) {
    // 海外タグ勢 (= site/data/overseas.json) は使い手ランキングから除外.
    if (STATE.overseasUids && STATE.overseasUids.has(uid)) continue;
    const src = STATE.masterMap.get(uid);
    if (!src) continue;
    ranked.push(RP.cloneWithGlobalRanks(src));
  }
  // ensemble は global ensemble の昇順で local rank 再付番.
  return RP.rerankByGlobalEnsemble(ranked);
}

// キャラ投票 (本人申告) で決まったメインは pct を持たない (= 使用実績が無い).
// docs/post_feature_design.md §12 / v3/v4/char_vote.py.
/** @param {SpspRankRecord & { characters?: SpspCharacterUse[] }} rec @returns {number | null} */
const _mainPct = (rec) => {
  const c = (rec.characters || [])[0];
  return c && typeof c.pct === 'number' ? c.pct : null;
};

const CHAR_EXTRA_COLUMNS = [
  { id: 'char_pct', label: i18n('char_ranking.col.pct'), sortable: true, sortKey: 'char_pct', css: 'col-other-rank',
    // 昇順ソートなので -pct で使用率の高い順。実績なし (投票由来) は 0 で末尾へ。
    /** @param {SpspRankRecord} rec */
    value: (rec) => {
      const p = _mainPct(rec);
      return p === null ? 0 : -p;
    },
    /** @param {SpspRankRecord & { characters?: SpspCharacterUse[] }} rec */
    cell: (rec) => {
      const c = (rec.characters || [])[0];
      if (!c) return '–';
      const p = _mainPct(rec);
      if (p === null) {
        return `<span style="color:#9ca3af" title="${i18n('char_ranking.self_declared_title')}">${i18n('char_ranking.self_declared')}</span>`;
      }
      return `${(p * 100).toFixed(0)}%`;
    },
  },
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
    showGlobalRank: true,
    columns: [
      'rank', 'display', BT_SCORE_COL, TJPR_SCORE_COL,
      'tjpr_lv', 'tour_count', 'bt_weekday',
      'rank_tjpr', 'rank_bt_gated',
      ...CHAR_EXTRA_COLUMNS,
    ],
    rowClick: (rec, tr, ev) => charRowClickHandler(rec, tr, ev),
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
  STATE.charId = parseInt(/** @type {string} */ (RP.getQueryParam('char')), 10);
  const titleH1 = document.getElementById('title-h1');
  const tbody = document.getElementById('tbody');
  const footer = document.getElementById('footer-info');
  const status = document.getElementById('status');
  if (!STATE.charId) {
    if (titleH1) titleH1.textContent = i18n('char_ranking.no_char');
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="11" class="empty-msg"><a href="./" style="color:#dc2626">${i18n('char_ranking.back_to_list')}</a></td></tr>`;
    return;
  }
  try {
    const t0 = performance.now();
    const [idxRes, master, emojiRes] = await Promise.all([
      fetch(SPSP.data + 'data/character_index.json'),
      RP.loadMaster(SPSP.data, { overseas: true }),
      fetch(SPSPCharEmoji.url()).catch(() => null),
    ]);
    if (!idxRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'character_index.json' }));
    STATE.overseasUids = master.overseasUids;
    const index = /** @type {SpspCharacterIndex} */ (await idxRes.json());
    STATE.index = index;
    STATE.masterMeta = /** @type {SpspRankMeta} */ (master.meta);
    const charInfo = index.characters.find(c => c.id === STATE.charId);
    if (!charInfo) {
      if (titleH1) titleH1.textContent = i18n('char_ranking.not_found', { id: STATE.charId });
      if (tbody) tbody.innerHTML =
        `<tr><td colspan="11" class="empty-msg"><a href="./" style="color:#dc2626">${i18n('char_ranking.back_to_list')}</a></td></tr>`;
      return;
    }
    const name = charName(charInfo.id, charInfo.name);   // 表示言語の名前
    STATE.charName = name;
    // キャラ絵文字 (見出しの左に表示)。
    let charEmoji = '';
    if (emojiRes && emojiRes.ok) {
      try { const ce = await emojiRes.json(); charEmoji = (ce[String(STATE.charId)] || {}).emoji || ''; } catch (e) {}
    }

    for (const rec of master.recs) STATE.masterMap.set(rec.user_id, rec);

    STATE.data = buildData();
    // 海外勢は buildData で既に除外済み. computeDisplayRanks は呼ばない
    // (= 呼ぶと supplementary 列 rank_tjpr/rank_bt_gated がローカルプール内 jp-counter に
    //  置換され GLOBAL 順位の意味が失われるため).
    if (STATE.index && SPSPRankingTable && SPSPRankingTable.attachZenichi) {
      SPSPRankingTable.attachZenichi(STATE.data, STATE.index, STATE.overseasUids);
    }

    document.title = i18n('char_ranking.doc_title', { name: name });
    if (titleH1) titleH1.textContent = (charEmoji ? charEmoji + ' ' : '') + i18n('char_ranking.heading', { name: name });
    if (SPSPTrackPage) {
      SPSPTrackPage(document.title, `/c/${encodeURIComponent(name)}`);
    }
    const meta = STATE.masterMeta;
    if (footer) footer.innerHTML =
      i18n('ranking.footer.eval_date', { date: escapeHtml(meta.eval_date || ''), n: meta.n_players }) + ' · ' +
      `<a href="./">${i18n('char_ranking.footer_back')}</a> · <a href="${SPSP.langRoot}${SPSP.pageHref('index.html')}">${i18n('common.national_ranking')}</a>`;

    render();
    if (status) status.textContent =
      i18n('ranking.status.loaded_people', { n: STATE.data.length, ms: (performance.now() - t0).toFixed(0) });
  } catch (e) {
    console.error(e);
    if (tbody) tbody.innerHTML =
      `<tr><td colspan="11" class="empty-msg" style="color:#dc2626">${escapeHtml(/** @type {Error} */ (e).message)}</td></tr>`;
  }
}

// Detail panel (大会別の詳細 / 直接対決) は player-detail.js (SPSPDetail) に集約.
function getDetailCfg() {
  return {
    getMeta: () => STATE.masterMeta || {},
    getDataArray: () => STATE.data,
    getMasterMap: () => STATE.masterMap,
    pathPrefix: SPSP.langRoot, dataPrefix: SPSP.data,
  };
}

// 行クリック → 大会別詳細 / 直接対決 を inline 展開。展開行の中のクリック処理も共通 (../js/ranking_page.js)
/** @param {SpspRankRecord} rec @param {HTMLTableRowElement} tr @param {Event} _ev */
function charRowClickHandler(rec, tr, _ev) {
  RP.rowClickHandler(rec, tr, { cfg: getDetailCfg(), colspan: 11 });
}
RP.bindDetailClicks(document.getElementById('tbody'), getDetailCfg);

init();

SPSPShare.setup(document.getElementById('share-icon-btn'), () => {
  const name = STATE.charName || i18n('char_ranking.share_default_name');
  return {
    title: i18n('char_ranking.doc_title', { name }),
    text:  i18n('char_ranking.share.text', { name }),
    url:   location.href,
  };
});
