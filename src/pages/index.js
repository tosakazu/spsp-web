// @ts-check
// src/pages/index.js — site/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/index.js にする。
import '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/js/links.js';
import '../../site/js/data.js';
import SPSPViews from '../../site/js/views.js';
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
import SpspMyNotice from '../../site/js/my_notice.js';
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

// ── data/views/ 読み (js/views.js) ──
// ビルドが data/views/ を出していれば、全選手の latest_tjpr_full.jsonl は読まず、表の行は
// ranking/<method>/<k>.json (順位順に 1000 人ずつ) を無限スクロールが届いた分だけ取る。表示順位 (_display_rank) と
// 海外 (_is_overseas) はビルドが全選手で計算済み。検索は players_index.json (全選手の名前) で当て、当たった人の行だけ取る。
// views が無ければ従来どおり全選手を読んで表が並べ替え・絞り込みをする (VIEWS = null)。
/** @type {any} manifest.json (null = 従来どおり) */
let VIEWS = null;
/** @type {any} character_index.json (取ってきた行に全一を付ける) */
let CHAR_IDX = null;
/** @type {Set<number> | null} */
let OVERSEAS_UIDS = null;
/** 表の行の出どころ: 順位評価ごとの全国表 (chunk を順に) か、検索の当たり (uid の並び) */
/** @typedef {{ kind: 'method', method: string, rows: SpspRankRecord[], next: number, total: number, busy: Promise<void> | null }
 *          | { kind: 'search', method: string, q: string, hits: number[], rows: SpspRankRecord[], total: number, busy: Promise<void> | null }} RowSource */
/** @type {Record<string, RowSource>} */
const METHOD_SOURCES = {};
/** @type {RowSource | null} */
let SOURCE = null;

/** @param {SpspRankRecord[]} rows */
function decorate(rows) {
  if (CHAR_IDX && SPSPRankingTable && SPSPRankingTable.attachZenichi) SPSPRankingTable.attachZenichi(rows, CHAR_IDX, OVERSEAS_UIDS);
  return rows;
}
/** @param {string} method @returns {RowSource} */
function methodSource(method) {
  if (!METHOD_SOURCES[method]) METHOD_SOURCES[method] = { kind: 'method', method, rows: [], next: 0, total: VIEWS.n_players, busy: null };
  return METHOD_SOURCES[method];
}
/** src の行を n 行目まで (全体がそれより少なければ全部) 取ってくる @param {RowSource} src @param {number} n @returns {Promise<void>} */
function ensureRows(src, n) {
  if (src.rows.length >= Math.min(n, src.total)) return Promise.resolve();
  if (!src.busy) {
    src.busy = (async () => {
      if (src.kind === 'method') {
        const recs = await SPSPViews.chunk(src.method, src.next);
        src.next++;
        if (!recs.length) src.total = src.rows.length;   // 想定より少ない (manifest とずれた) ときは打ち切る
        for (const r of decorate(recs)) src.rows.push(r);
      } else {
        const want = src.hits.slice(src.rows.length, Math.max(n, src.rows.length + PAGE_INCREMENT));
        const recs = await SPSPViews.rowsByUids(want);
        if (recs.length < want.length) src.total -= want.length - recs.length;   // index と表がずれた人は数えない
        for (const r of decorate(recs)) src.rows.push(r);
      }
    })().finally(() => { src.busy = null; });
  }
  return src.busy.then(() => ensureRows(src, n));
}
/** 表に出す行の出どころを差し替える (タブ切替・検索) @param {RowSource} src */
async function useSource(src) {
  SOURCE = src;
  await ensureRows(src, PAGE_INCREMENT);
  if (SOURCE !== src || !TABLE) return;
  TABLE.method = src.method;   // タブの順位評価に (行が届いてから切り替える。途中の行を別の順位で並べ直さない)
  TABLE.setRows(src.rows);   // 表示件数は先頭から
}
/** 検索の当たり (players_index.json。並びは表と同じ = いまの順位評価の順位順、順位なしは末尾) @param {string} q @param {string} method */
async function searchSource(q, method) {
  const hits = await SPSPViews.searchIndex(q);
  const key = method === 'tjpr' ? 'tjpr' : method === 'bt_gated' ? 'bt' : 'ens';
  const rk = (/** @type {any} */ h) => (h[key] > 0 ? h[key] : Infinity);
  const order = hits.map((h, i) => ({ h, i })).sort((a, b) => (rk(a.h) - rk(b.h)) || (a.i - b.i)).map((x) => x.h.uid);
  return /** @type {RowSource} */ ({ kind: 'search', method, q, hits: order, rows: [], total: order.length, busy: null });
}
let searchSeq = 0;
/** views 読みのときの検索・タブ切替 */
async function refreshViewsSource() {
  const seq = ++searchSeq;
  const src = filterText ? await searchSource(filterText, currentMethod) : methodSource(currentMethod);
  if (seq !== searchSeq) return;
  await useSource(src);
}

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
    // data/views/ があれば全国表の先頭 1000 人 (ranking/ensemble/0.json) だけ。無ければ全選手 (latest_tjpr_full.jsonl)
    const master = await SPSPRankingPage.loadMaster(SPSP.data, { overseas: true, charIdx: true, views: (V) => V.chunk('ensemble', 0) });
    VIEWS = master.views;
    const meta = /** @type {MainMeta} */ (master.meta);
    META = meta;
    const overseasUids = master.overseasUids;
    const charIdx = master.charIdx;
    // ヘッダ (nav bar) に「最終更新時刻 · バージョン」を表示
    const genTime = (meta.generated_at || meta.eval_date || '').split('.')[0].replace('T', ' ');
    const SITE_VERSION_FULL = '__SITE_VERSION__';
    const versionShort = SITE_VERSION_FULL.split(' · ')[0] || SITE_VERSION_FULL;
    const navMeta = document.getElementById('meta-info');
    // 版が入っていない (ローカルのビルド) ときは nav.js と同じく版を出さない (どちらが後に書いても同じ表示になるように)
    const isStamped = !versionShort.includes('SITE_VERSION');
    if (navMeta) navMeta.textContent = isStamped ? t('nav.meta.updated_version', { time: genTime, version: versionShort }) : t('nav.meta.updated', { time: genTime });
    const footer = document.getElementById('footer-info');
    if (footer) footer.innerHTML =
      t('ranking.footer.summary', { date: meta.eval_date, n: meta.n_players, days: meta.lookback_days }) + ' · ' +
      `<a href="${SPSP.root}${SPSP.pageHref('overview.html')}" style="color:#dc2626">${t('ranking.footer.overview')}</a> · ` +
      `<a href="${SPSP.root}${SPSP.pageHref('details.html')}" style="color:#dc2626">${t('ranking.footer.details')}</a>`;
    const recs = master.recs;
    const nAll = VIEWS ? VIEWS.n_players : recs.length;   // views 読みでは取ってきたのは先頭だけ。件数は全選手で出す
    status.textContent = t('ranking.status.parsing', { n: nAll });
    for (const rec of recs) DATA.push(rec);
    if (VIEWS) {
      // 表示順位・海外はビルドが計算済み (行の _display_rank / _is_overseas)。一部の行で計算し直さない
      CHAR_IDX = charIdx; OVERSEAS_UIDS = overseasUids;
      const src = methodSource('ensemble');
      src.rows = DATA; /** @type {any} */ (src).next = 1;
      SOURCE = src;
    } else if (overseasUids && SPSPRankingTable && SPSPRankingTable.computeDisplayRanks) {
      SPSPRankingTable.computeDisplayRanks(DATA, overseasUids);
    }
    if (charIdx && SPSPRankingTable && SPSPRankingTable.attachZenichi) {
      SPSPRankingTable.attachZenichi(DATA, charIdx, overseasUids);
    }
    status.textContent = t('ranking.status.loaded', { n: VIEWS ? nAll : DATA.length, ms: (performance.now()-t0).toFixed(0) });
    await INTRO_GATE;          // アニメーションを最後まで (タップで飛ばせる)
    render();
    if (VIEWS && filterText) refreshViewsSource().catch(() => {});   // 読み込み中に検索欄へ打たれていた
    fadeInOnce(document.querySelector('.table-wrap'));
    // ログイン中なら速報の上に本人へのお知らせ (全国順位・Lv が上がった、二つ名を入手。js/my_notice.js)
    // views 読みでは表に居ない (まだ取っていない) 人の行は ranking/ensemble/ から 1 つだけ取る
    SpspMyNotice.showForSelf(document.getElementById('my-notice'), uid => DATA.find(r => r.user_id === uid) ||
      (VIEWS ? SPSPViews.rowsByUids([uid]).then(r => r[0] || null) : null)).catch(() => {});
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
    sortable: false,                  // 全国ランキングは並べ替えなし (並びは常に いまのタブの順位順)
    // views 読み: 持っている行の先まで届いたら続きを取る (タブ・検索の出どころごと)
    moreRows: VIEWS ? {
      total: () => (SOURCE ? SOURCE.total : 0),
      need: (/** @type {number} */ cap) => {
        const src = SOURCE;
        if (!src) return;
        ensureRows(src, cap).then(() => { if (SOURCE === src && TABLE) TABLE.replaceRows(src.rows); }).catch(() => {});
      },
    } : null,
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
  // views 読みでは行は出どころ (SOURCE) が持つ。絞り込みは検索の当たりとして出どころの側で済んでいる
  SPSPRankingPage.applyState(tbl, { rows: VIEWS && SOURCE ? SOURCE.rows : DATA, method: currentMethod, filterText: VIEWS ? '' : filterText });
}



function getDetailCfg() {
  return {
    getMeta: () => META || {},
    getDataArray: () => (VIEWS && SOURCE ? SOURCE.rows : DATA),
    pathPrefix: SPSP.langRoot, dataPrefix: SPSP.data,  // メインランキングはルート直下 ('' / 言語別ページでは '' と '../')
  };
}

// ── Events ──
// sortable thead click / infinite scroll / main-row click は共有コンポーネント (= TABLE)
// が tbody / table-level で処理. 検索 / Method タブ / 詳細パネル内部のクリックの配線は
// js/ranking_page.js (ランキング表ページ共通)。ここでは Jump button とページトップだけ.

SPSPRankingPage.bindSearch(text => {
  filterText = text;
  if (VIEWS) { if (TABLE) refreshViewsSource().catch(() => {}); return; }
  if (TABLE) TABLE.setFilterText(filterText);
});

SPSPRankingPage.bindMethodTabs(method => {
  currentMethod = method;
  if (VIEWS) { if (TABLE) refreshViewsSource().catch(() => {}); return; }   // そのタブの順位順の行 (ranking/<method>/) に差し替える
  if (TABLE) {
    TABLE.setSort('rank', 'asc');   // トップだけタブ切替で並びを順位に戻す
    TABLE.setMethod(currentMethod);
  }
});

// Top N ジャンプボタン
document.querySelectorAll('.jump').forEach(btn0 => {
  const btn = /** @type {HTMLElement} */ (btn0);
  btn.addEventListener('click', async () => {
    const target = parseInt(/** @type {string} */ (btn.dataset.jump));
    if (!TABLE) return;
    // views 読み: 表示順位が target に届くところまで行を取ってくる
    if (VIEWS && SOURCE && SOURCE.kind === 'method') {
      const src = SOURCE;
      const drOf = (/** @type {SpspRankRecord} */ r) => SPSPRankingTable.getDisplayRank(r, src.method);
      while (src.rows.length < src.total && !(src.rows.length && drOf(src.rows[src.rows.length - 1]) >= target)) {
        await ensureRows(src, src.rows.length + 1);
      }
      if (SOURCE !== src) return;
      TABLE.replaceRows(src.rows);
    }
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
