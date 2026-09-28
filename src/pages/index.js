// @ts-check
// src/pages/index.js — site/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/index.js にする。
import '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/js/links.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/js/format.js';
import '../../site/js/tags.js';
import SPSPRankingTable from '../../site/ranking-table.js';
import SPSPDetail from '../../site/player-detail.js';
import SPSPRankingPage from '../../site/js/ranking_page.js';
import '../../site/logo.js';
import '../../site/nav.js';
import '../../site/share.js';
import SPSPLogo from '../../site/logo.js';
import SPSPShare from '../../site/share.js';
/** 地域の暦日の時差 (region/config.js utcOffset。無ければ止まらないよう空 = UTC ではなく、設定は必ずある前提) */
const SITE_UTC_OFFSET = /** @type {SpspSiteConfig} */ (window.SPSP.site).utcOffset;

const t = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に
/** @type {SpspRankRecord[]} */
const DATA = [];
/** meta.json (トップはヘッダに generated_at、列構成に ranking_method も使う) */
/** @typedef {SpspRankMeta & { generated_at?: string, ranking_method?: string }} MainMeta */
/** @type {MainMeta | null} */
let META = null;
let currentMethod = 'ensemble';
let filterText = '';
// page-level state. sort / cap / filtered rows は TABLE (= SPSPRankingTable) 内部で保持.
// tourSortMode は SPSPDetail 内部で管理. PAGE_INCREMENT は infinite scroll の 1 段分.
const PAGE_INCREMENT = 512;

// トップだけはロゴのアニメーションを最後まで見せてから表を出す。
// 読み込みが先に終わっても待つ (画面のどこかをタップ/クリックすれば即スキップ)。
// 逆にアニメーションが先に終わったら、データが届き次第すぐ描く。
const INTRO_GATE = (SPSPLogo && SPSPLogo.introGate)
  ? SPSPLogo.introGate() : Promise.resolve();

async function loadData() {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = t('ranking.status.downloading');
  const t0 = performance.now();
  try {
    // meta.json + latest_tjpr_full.jsonl (+ overseas.json / character_index.json) は js/ranking_page.js
    const master = await SPSPRankingPage.loadMaster(SPSP.data, { overseas: true, charIdx: true });
    const meta = /** @type {MainMeta} */ (master.meta);
    META = meta;
    const overseasUids = master.overseasUids;
    const charIdx = master.charIdx;
    // ヘッダ (nav bar) に「最終更新時刻 · バージョン」を表示
    const genTime = (meta.generated_at || meta.eval_date || '').split('.')[0].replace('T', ' ');
    const SITE_VERSION_FULL = '__SITE_VERSION__';
    const versionShort = SITE_VERSION_FULL.split(' · ')[0] || SITE_VERSION_FULL;
    const navMeta = document.getElementById('meta-info');
    if (navMeta) navMeta.textContent = t('nav.meta.updated_version', { time: genTime, version: versionShort });
    const footer = document.getElementById('footer-info');
    if (footer) footer.innerHTML =
      t('ranking.footer.summary', { date: meta.eval_date, n: meta.n_players, days: meta.lookback_days }) + ' · ' +
      `<a href="${SPSP.root}${SPSP.pageHref('overview.html')}" style="color:#dc2626">${t('ranking.footer.overview')}</a> · ` +
      `<a href="${SPSP.root}${SPSP.pageHref('details.html')}" style="color:#dc2626">${t('ranking.footer.details')}</a>`;
    const recs = master.recs;
    status.textContent = t('ranking.status.parsing', { n: recs.length });
    for (const rec of recs) DATA.push(rec);
    if (overseasUids && SPSPRankingTable && SPSPRankingTable.computeDisplayRanks) {
      SPSPRankingTable.computeDisplayRanks(DATA, overseasUids);
    }
    if (charIdx && SPSPRankingTable && SPSPRankingTable.attachZenichi) {
      SPSPRankingTable.attachZenichi(DATA, charIdx, overseasUids);
    }
    status.textContent = t('ranking.status.loaded', { n: DATA.length, ms: (performance.now()-t0).toFixed(0) });
    await INTRO_GATE;          // アニメーションを最後まで (タップで飛ばせる)
    render();
    fadeInOnce(document.querySelector('.table-wrap'));
  } catch (e) {
    status.textContent = t('common.error', { message: /** @type {Error} */ (e).message });
  }
}


// ── Shared ranking-table component (SPSPRankingTable) ──
// columns / sort / filter / infinite scroll / row click は共有コンポーネントに集約.
// 平均スコア / 順位 のフォーマットは builtin column 経由 (= site/ranking-table.js).
/** @typedef {import('../../site/ranking-table.js').RankingTable & { meta?: MainMeta | null }} MainTable */
/** @type {MainTable | null} */
let TABLE = null;
// 新方式 (= BT_LV_shared_cascade) 用の小灰列: 平均順位/平均スコア の代わりに
// 順位評スコア + 直対評スコアを小さく灰色で表示. 順位評は共通 (js/ranking_page.js)、直対評はこのページだけ
// 「レート更新中」の緑を出すので独自.
const TJPR_SCORE_COL = SPSPRankingPage.scoreColumns('class').TJPR_SCORE_COL;
const BT_SCORE_COL = {
  id: 'bt_score_cell', label: t('ranking.col.bt_score'), sortable: true, sortKey: 'bt_score',
  css: 'col-avg-rank',
  value: (/** @type {SpspRankRecord} */ rec) => -((rec.scores && rec.scores.bt_gated_elo) || -Infinity),
  // peak180 スコア == 現在スコア (= レート更新中) なら緑、ピークから下落していれば黒。
  cell: (/** @type {SpspRankRecord} */ rec) => {
    const sc = rec.scores || {};
    const peak = sc.bt_gated_elo;
    if (peak == null) return '–';
    const cur = sc.bt_internal_elo;
    const lastD = sc.bt_internal_d_last;
    // レート更新中 = peak180==現在スコア かつ 直前のレート変動が + (= 直近で上昇)。
    const updating = (cur != null && Math.abs(peak - cur) < 0.005 && lastD != null && lastD > 0);
    return `<span class="score-cell${updating ? ' bt-updating' : ''}">${peak.toFixed(2)}</span>`;
  },
};
/** @param {MainMeta | null} meta */
function _columnsForMeta(meta) {
  const method = meta && meta.ranking_method;
  if (method && (method === 'BT_LV_shared_cascade' || method.startsWith('V4'))) {
    // Lv (tjpr_lv) と 計測中 (bt_weekday) は専用列を出さず、名前の横のタグ
    // (display-lv-mobile / display-gate-mobile) で PC/mobile 共通表示する。
    return ['rank', 'display', BT_SCORE_COL, TJPR_SCORE_COL,
            'tour_count', 'rank_tjpr', 'rank_bt_gated'];
  }
  return undefined;  // builtin default
}
function ensureTable() {
  if (TABLE) return TABLE;
  /** @type {MainTable} */
  const tbl = SPSPRankingPage.createTable({
    rows: DATA,
    method: currentMethod,
    sort: { key: 'rank', dir: 'asc' },
    pageSize: PAGE_INCREMENT,
    totalForRankFrac: 'meta',         // 分母 = META.n_players
    playerHrefPrefix: '',             // ルート直下
    columns: _columnsForMeta(META),
    rowClick: (rec, tr, ev) => mainRowClickHandler(rec, tr, ev),
  });
  tbl.meta = META;
  TABLE = tbl;
  return TABLE;
}

// 初回の描画だけ短くフェードインさせる (並べ替えや絞り込みでは動かさない)。
/** @param {Element | null} el */
function fadeInOnce(el) {
  if (!el) return;
  el.classList.add('spsp-fadein');
  setTimeout(function () { el.classList.remove('spsp-fadein'); }, 400);
}

function render() {
  const tbl = ensureTable();
  tbl.meta = META;
  SPSPRankingPage.applyState(tbl, { rows: DATA, method: currentMethod, filterText });
}



function getDetailCfg() {
  return {
    getMeta: () => META || {},
    getDataArray: () => DATA,
    pathPrefix: SPSP.langRoot, dataPrefix: SPSP.data,  // メインランキングはルート直下 ('' / 言語別ページでは '' と '../')
  };
}

// ── Events ──
// sortable thead click / infinite scroll / main-row click は共有コンポーネント (= TABLE)
// が tbody / table-level で処理. 検索 / Method タブ / 詳細パネル内部のクリックの配線は
// js/ranking_page.js (ランキング表ページ共通)。ここでは Jump button とページトップだけ.

SPSPRankingPage.bindSearch(text => {
  filterText = text;
  if (TABLE) TABLE.setFilterText(filterText);
});

SPSPRankingPage.bindMethodTabs(method => {
  currentMethod = method;
  if (TABLE) {
    TABLE.setSort('rank', 'asc');   // トップだけタブ切替で並びを順位に戻す
    TABLE.setMethod(currentMethod);
  }
});

// Top N ジャンプボタン
document.querySelectorAll('.jump').forEach(btn0 => {
  const btn = /** @type {HTMLElement} */ (btn0);
  btn.addEventListener('click', () => {
    const target = parseInt(/** @type {string} */ (btn.dataset.jump));
    if (!TABLE) return;
    // 表示順位 (= jp-counter) で target に到達する行 index を先に走査して見つける.
    // 旧コード (= currentCap = target + 32) は raw rank == display rank を仮定して
    // いたが、海外勢込みの jp-counter では raw rank > display rank になるため
    // target ぴったりまで表示しても display rank が target に達していなかった.
    const getDR = SPSPRankingTable && SPSPRankingTable.getDisplayRank;
    const rowsData = TABLE._lastFiltered || [];
    let foundIdx = -1;
    for (let i = 0; i < rowsData.length; i++) {
      const dr = getDR ? getDR(rowsData[i], TABLE.method)
                       : ((rowsData[i].ranks && rowsData[i].ranks[TABLE.method]) || Infinity);
      if (dr >= target) { foundIdx = i; break; }
    }
    if (foundIdx < 0) return;
    if (TABLE.currentCap < foundIdx + 32 && rowsData.length > TABLE.currentCap) {
      TABLE.currentCap = Math.min(foundIdx + 32, rowsData.length);
      TABLE.refresh();
    }
    const tbody = document.getElementById('tbody');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr.main-row');
    if (rows[foundIdx]) {
      const row = /** @type {HTMLElement} */ (rows[foundIdx]);
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.style.background = '#fef3c7';
      setTimeout(() => row.style.background = '', 1500);
    }
  });
});

// 画面右下「ページトップへ戻る」浮動ボタン
(function () {
  const btn = document.getElementById('scroll-top');
  if (!btn) return;
  const scrollBtn = btn;   // 型: 以降の閉包では null でない
  function update() {
    if (window.scrollY > 300) scrollBtn.removeAttribute('hidden');
    else scrollBtn.setAttribute('hidden', '');
  }
  window.addEventListener('scroll', update, { passive: true });
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  update();
})();

// 展開行の中のクリック (tab 切替 / H2H expand / tour-sort-toggle / expand-rows) と
// main-row クリック → 展開行の出し入れは js/ranking_page.js。
SPSPRankingPage.bindDetailClicks(document.getElementById('tbody'), getDetailCfg);
/** @param {SpspRankRecord} rec @param {HTMLTableRowElement} tr @param {Event} _ev */
function mainRowClickHandler(rec, tr, _ev) {
  SPSPRankingPage.rowClickHandler(rec, tr, { cfg: getDetailCfg(), colspan: 7 });
}

loadData();

SPSPShare.setup(document.getElementById('share-icon-btn'), () => ({
  title: t('ranking.share.title'),
  text:  t('ranking.share.text'),
  url:   location.href,
}));

// News tickers: load news.json and populate 速報 / 通知 separately (= 過去 24 時間以内)
(function loadNewsTickers() {
  const TICKER_SPEED_PX_PER_SEC = 60;  // 統一スピード (= 内容長に依らず一定)
  const WINDOW_MS = 24 * 60 * 60 * 1000;  // 表示対象: 過去 24 時間以内に投稿された entry
  const nowMs = Date.now();
  /** news.json の 1 件 (時刻は JST) */
  /** @typedef {{ date?: string, datetime?: string, title?: string }} NewsItem */
  fetch(SPSP.data + 'news.json').then(r => r.json()).then(data => {
    /** @param {unknown} s */
    const escH = s => String(s ?? '').replace(/[&<>"']/g, c => (/** @type {Record<string, string>} */ ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}))[c]);
    /** @param {NewsItem[]} items @param {string} filter */
    const buildContent = (items, filter) => {
      const href = `news/?filter=${filter}`;
      return items.slice(0, 10).map(n =>
        `<a href="${href}"><span class="date">${escH(n.date)}</span>${escH(n.title)}</a>`
      ).join('<span class="sep">●</span>');
    };
    // ニュース entry の timestamp 取得 (ms).
    // - datetime (ISO 8601 with time, e.g. "2026-05-19T15:30:00") があればそれを使う
    // - date のみ → ローカル 00:00:00 と解釈
    /** @param {NewsItem} n @returns {number} */
    const entryTs = (n) => {
      // news.json の時刻は地域の暦日。ゾーン無しの文字列は地域の時差 (region/config.js utcOffset) で解釈する (閲覧者の場所に依らない)
      if (n.datetime) {
        const dts = /(Z|[+-]\d{2}:?\d{2})$/.test(n.datetime) ? n.datetime : (n.datetime + SITE_UTC_OFFSET);
        const t = new Date(dts).getTime();
        return isNaN(t) ? 0 : t;
      }
      if (n.date) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(n.date);
        if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00${SITE_UTC_OFFSET}`);
      }
      return 0;
    };
    /** @param {string} rowId @param {string} contentId @param {NewsItem[]} items @param {string} filter */
    function setupTicker(rowId, contentId, items, filter) {
      if (!items.length) return;
      const row = document.getElementById(rowId);
      const content = document.getElementById(contentId);
      if (!row || !content) return;
      // Dismissed-state: localStorage に保存された dismiss 時刻 (ms) と news 最新時刻を比較.
      // dismiss 時刻 >= 最新 news 時刻なら hide. news が新しければ表示.
      const maxNewsTs = Math.max(0, ...items.map(entryTs));
      const dismissedRaw = localStorage.getItem(`spsp_ticker_dismissed_${rowId}`);
      const dismissedTs = dismissedRaw ? Number(dismissedRaw) : 0;
      if (dismissedTs && dismissedTs >= maxNewsTs) return;  // 既に dismiss 済 (= news 以降)
      content.innerHTML = buildContent(items, filter);
      row.style.display = '';
      // measure after layout settles; offsetWidth includes padding-left:100%
      requestAnimationFrame(() => {
        const distance = content.offsetWidth;
        const dur = Math.max(8, distance / TICKER_SPEED_PX_PER_SEC);
        content.style.animationDuration = `${dur.toFixed(1)}s`;
      });
      // Row-wide click → navigate (except for × button)
      row.addEventListener('click', (ev) => {
        const target = ev.target instanceof Element ? ev.target : null;
        if (target && target.closest('.ticker-close')) return;
        if (target && target.closest('a')) return;  // 内部リンクはデフォルト動作
        location.href = `news/?filter=${filter}`;
      });
      // × ボタン: hide + 現在時刻 (ms) を localStorage に保存. 後で新しい news が来たら自動再表示.
      const closeBtn = row.querySelector('.ticker-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          row.style.display = 'none';
          localStorage.setItem(`spsp_ticker_dismissed_${rowId}`, String(Date.now()));
        });
      }
    }
    const within24h = (/** @type {NewsItem} */ n) => (nowMs - entryTs(n)) <= WINDOW_MS && entryTs(n) > 0;
    const auto = (data.auto_news || []).filter(within24h);
    const ann  = (data.announcements || []).filter(within24h);
    setupTicker('news-ticker-auto', 'ticker-auto-content', auto, 'auto');
    setupTicker('news-ticker-ann',  'ticker-ann-content',  ann,  'announcement');
  }).catch(() => {});
})();


window.addEventListener('load', () => {
  // Defer load until first chart needed
});
