// @ts-check
// ranking_page.js — ランキング表ページ 4 本 (index / c/ranking / local/ranking / pref/ranking) の共通の骨格。
// 以前はページごとに同じコード (表の生成・検索とタブの配線・行の展開・展開行内のクリック処理・
// master データの読み込み・ローカル順位への再付番) が約 150 行ずつコピーされていた。
//
//   SPSPRankingPage.getQueryParam(name)
//   SPSPRankingPage.scoreColumns(style)       → { TJPR_SCORE_COL, BT_SCORE_COL }  (小さい灰色の 順位評 / 直対評 列)
//       style = 'inline' (style 属性で灰色にする) | 'class' (class="score-cell"、index.html の CSS 用)
//   SPSPRankingPage.createTable(opts)         → SPSPRankingTable.RankingTable (既定値込み)。
//       opts.statusEl があれば描画のたびに「N / M 表示中」を書く (opts.statusTotal() = M)
//   SPSPRankingPage.applyState(tbl, {rows, method, filterText, sort})
//   SPSPRankingPage.bindMethodTabs(onChange)   総合 / 順位 / 直対 タブ (#method-tabs)。onChange(method)
//   SPSPRankingPage.bindSearch(onChange)       #search の input。onChange(text)
//   SPSPRankingPage.rowClickHandler(rec, tr, {cfg, colspan})
//       行クリックで展開行 (大会別 / 直接対決) を出し入れする。開くのは 1 行だけ。詳細 JSON は SPSPDetail が取る
//   SPSPRankingPage.bindDetailClicks(tbody, getCfg)
//       展開行の中のクリック (タブ切替 / 直接対決の「もっと見る」/ 並べ替え / 「さらに表示」) を tbody で委譲処理
//   SPSPRankingPage.loadMaster(prefix, {overseas, charIdx})
//       → { meta, recs, overseasUids, charIdx }。meta.json と latest_tjpr_full.jsonl が無ければ throw
//   SPSPRankingPage.cloneWithGlobalRanks(rec)   全国順位を ranks.global_* に写した深いコピー
//   SPSPRankingPage.rerankByGlobalEnsemble(recs) 全国の総合順位の昇順に並べ、ensemble を 1..N に付け直す
//
// 読み込み順: js/html.js → js/data.js → js/player_data.js → js/format.js → ranking-table.js → player-detail.js → これ
import SPSPData from './data.js';
import SPSPI18n from './i18n.js';
import SPSPCharEmoji from './char_emoji.js';
import SPSPDetail from '../player-detail.js';
import SPSPRankingTable from '../ranking-table.js';
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く
  var i18n = function (k, params) { return SPSPI18n.t(k, params); };   // 文言 (i18n/ja.js)

  function getQueryParam(name) {
    return new URL(location.href).searchParams.get(name);
  }

  // ── 列 ──
  function smallGray(v, decimals, style) {
    if (v == null) return '–';
    var s = v.toFixed(decimals);
    return style === 'class'
      ? '<span class="score-cell">' + s + '</span>'
      : '<span style="color:#9ca3af;font-size:11px">' + s + '</span>';
  }

  function scoreColumns(style) {
    return {
      TJPR_SCORE_COL: {
        id: 'tjpr_score_cell', label: i18n('ranking.col.tjpr_score'), sortable: true, sortKey: 'tjpr_score', css: 'col-score',
        value: function (rec) { return -((rec.scores && rec.scores.tjpr_elo) || -Infinity); },
        cell: function (rec) { return smallGray(rec.scores && rec.scores.tjpr_elo, 2, style); },
      },
      BT_SCORE_COL: {
        id: 'bt_score_cell', label: i18n('ranking.col.bt_score'), sortable: true, sortKey: 'bt_score', css: 'col-avg-rank',
        value: function (rec) { return -((rec.scores && rec.scores.bt_gated_elo) || -Infinity); },
        cell: function (rec) { return smallGray(rec.scores && rec.scores.bt_gated_elo, 2, style); },
      },
    };
  }

  // ── 表 ──
  var TABLE_DEFAULTS = {
    infiniteScroll: true,
    rankCaretExpand: true,      // 順位セル(▼)のみ簡易戦績展開、他はプレイヤーページへ
    showTopTours: true,
    showDisplayBadges: true,
    btWeekdayStyle: 'pill',
  };

  function createTable(opts) {
    var o = Object.assign({}, TABLE_DEFAULTS, opts);
    var statusEl = o.statusEl, statusTotal = o.statusTotal;
    delete o.statusEl; delete o.statusTotal;
    if (!o.table) o.table = document.getElementById('ranktable');
    var tbl = new SPSPRankingTable.RankingTable(o);
    if (statusEl) {
      tbl.on('rendered', function (ev) {
        statusEl.textContent = i18n('ranking.status.shown', { n: ev.filtered.length, total: statusTotal() });
      });
    }
    return tbl;
  }

  function applyState(tbl, st) {
    tbl.setRows(st.rows);
    tbl.setMethod(st.method);
    tbl.setFilterText(st.filterText || '');
    if (st.sort) tbl.setSort(st.sort.key, st.sort.dir);
  }

  // ── 配線 ──
  function bindMethodTabs(onChange) {
    var tabs = document.querySelectorAll('.method-tab');
    tabs.forEach(function (tab0) {
      var tab = /** @type {HTMLElement} */ (tab0);
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        onChange(tab.dataset.method);
      });
    });
  }

  function bindSearch(onChange) {
    var search = document.getElementById('search');
    if (search) search.addEventListener('input', function (e) { onChange(/** @type {HTMLInputElement} */ (e.target).value); });
  }

  // ── 行の展開 ──
  function rowClickHandler(rec, tr, o) {
    if (!rec) return;
    var colspan = o.colspan || 11;
    var next = tr.nextElementSibling;
    if (next && next.classList && next.classList.contains('detail-row')) {
      next.remove();
      tr.classList.remove('expanded');
      return;
    }
    // 既に開いてる他の行は閉じる
    var table = tr.closest('table');
    var open = table.querySelector('tr.detail-row');
    if (open) {
      var prev = open.previousElementSibling;
      if (prev) prev.classList.remove('expanded');
      open.remove();
    }
    var detail = document.createElement('tr');
    detail.className = 'detail-row';
    if (rec.unranked) {
      detail.innerHTML = '<td colspan="' + colspan + '"><div class="detail-inner" style="padding:14px;font-size:12px;color:#6b7280">\n' +
        '      ' + i18n('ranking.unranked.line1') + '<br>\n' +
        '      ' + i18n('ranking.unranked.line2') + '\n' +
        '    </div></td>';
      tr.classList.add('expanded');
      tr.after(detail);
      return;
    }
    detail.innerHTML = '<td colspan="' + colspan + '"><div class="detail-inner">\n' +
      '    <div class="loading-msg" style="padding:14px;color:#6b7280;font-size:12px">' + i18n('ranking.detail_loading') + '</div>\n' +
      '  </div></td>';
    tr.classList.add('expanded');
    tr.after(detail);
    // 選手ごとの詳細 JSON は SPSPDetail (内部キャッシュ付き) が取る
    var cfg = o.cfg;
    SPSPDetail.fetchPlayerDetail(rec.user_id, cfg).then(function (detailData) {
      if (!detailData) return;
      rec.tournaments = detailData.tournaments || [];
      rec.history = detailData.history || [];
      rec.recent_matches = detailData.recent_matches || [];
      if (rec.scores) rec.scores.tjpr_lv_breakdown = detailData.tjpr_lv_breakdown || {};
      var inner = detail.querySelector('.detail-inner');
      if (inner) inner.innerHTML = SPSPDetail.buildDetailContent(rec, cfg);
    }).catch(function (err) {
      var inner = detail.querySelector('.loading-msg');
      if (inner) inner.textContent = i18n('ranking.detail_failed', { message: err.message });
    });
  }

  // 開いている大会別の表を、いまの並び順 (SPSPDetail 内部の tourSortMode) で描き直す
  function refreshOpenTournamentTables(cfg) {
    var data = cfg.getDataArray();
    document.querySelectorAll('.tour-sort-toggle').forEach(function (el0) {
      var el = /** @type {HTMLElement} */ (el0);
      var uid = el.dataset.uid;
      var rec = data.find(function (r) { return String(r.user_id) === String(uid); });
      if (!rec) return;
      var tabContent = el.closest('.tab-tour');
      if (!tabContent) return;
      tabContent.innerHTML = SPSPDetail.buildTournamentTable(rec, cfg);
    });
  }

  // 展開行の中のクリック。行そのもののクリックは RankingTable の rowClick (= rowClickHandler) が受ける
  function bindDetailClicks(tbody, getCfg) {
    tbody.addEventListener('click', function (e) {
      // タブ切替 (大会別 / 直接対決): player-detail.js の markup は .detail-tab-content.tab-<key>
      var tabBtn = e.target.closest('.detail-tab');
      if (tabBtn) {
        e.stopPropagation();
        var section = tabBtn.closest('.detail-section');
        if (!section) return;
        var key = tabBtn.dataset.tab;
        section.querySelectorAll('.detail-tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === key); });
        section.querySelectorAll('.detail-tab-content').forEach(function (c) {
          c.style.display = c.classList.contains('tab-' + key) ? '' : 'none';
        });
        return;
      }
      // 直接対決の「もっと見る」→ 勝/負 両方の hidden を表示
      var h2hBtn = e.target.closest('.h2h-expand-btn');
      if (h2hBtn) {
        e.stopPropagation();
        var wrap = h2hBtn.closest('.tab-h2h');
        if (!wrap) return;
        wrap.querySelectorAll('.h2h-extra').forEach(function (x) { x.style.display = ''; });
        var expandDiv = h2hBtn.closest('.h2h-expand');
        if (expandDiv) expandDiv.remove();
        return;
      }
      // 大会別の並べ替え (影響順 / 日付順): ページ全体の設定なので開いている表を全部描き直す
      var toggle = e.target.closest('.tour-sort-toggle');
      if (toggle) {
        e.stopPropagation();
        SPSPDetail.toggleSortMode();
        refreshOpenTournamentTables(getCfg());
        return;
      }
      // 大会別の表の「さらに表示」
      var expand = e.target.closest('.expand-rows');
      if (expand) {
        e.stopPropagation();
        var sec = expand.parentElement;
        sec.querySelectorAll('tr.extra-row').forEach(function (r) { r.classList.remove('hidden-row'); });
        expand.remove();
        return;
      }
    });
  }

  // ── データ ──
  // meta.json と latest_tjpr_full.jsonl (必須) + overseas.json / character_index.json (任意)
  async function loadMaster(prefix, want) {
    want = want || {};
    var res = await Promise.all([
      fetch(prefix + 'meta.json'),
      fetch(prefix + 'latest_tjpr_full.jsonl'),
      want.overseas ? fetch(prefix + 'data/overseas.json').catch(function () { return null; }) : null,
      want.charIdx ? fetch(prefix + 'data/character_index.json').catch(function () { return null; }) : null,
      SPSPCharEmoji ? SPSPCharEmoji.load() : null,   // キャラ絵文字の表 (サイトと一緒に配信。js/char_emoji.js)。行の絵文字を表で引くため描画前に
    ]);
    var metaRes = res[0], jsonlRes = res[1], overseasRes = res[2], charIdxRes = res[3];
    if (!metaRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'meta.json' }));
    if (!jsonlRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'latest_tjpr_full.jsonl' }));
    /** @type {Set<number> | null} */
    var overseasUids = null;
    if (overseasRes && overseasRes.ok) {
      try { overseasUids = new Set((await overseasRes.json()).uids || []); } catch (e) { /* 無いのと同じ */ }
    }
    /** @type {any} */
    var charIdx = null;
    if (charIdxRes && charIdxRes.ok) {
      try { charIdx = await charIdxRes.json(); } catch (e) { /* 無いのと同じ */ }
    }
    var meta = await metaRes.json();
    var recs = SPSPData.parseJsonl(await jsonlRes.text());   // js/data.js
    return { meta: meta, recs: recs, overseasUids: overseasUids, charIdx: charIdx };
  }

  function cloneWithGlobalRanks(src) {
    var rec = JSON.parse(JSON.stringify(src));
    rec.ranks = rec.ranks || {};
    rec.ranks.global_ensemble = rec.ranks.ensemble;
    rec.ranks.global_tjpr = rec.ranks.tjpr;
    rec.ranks.global_bt_gated = rec.ranks.bt_gated;
    return rec;
  }

  // 総合 (ensemble) は全国順位の昇順でローカル順位 1..N に付け直す。順位評価 / 直対評価は全国順位のまま
  function rerankByGlobalEnsemble(ranked) {
    ranked.sort(function (a, b) { return (a.ranks.global_ensemble || 1e9) - (b.ranks.global_ensemble || 1e9); });
    ranked.forEach(function (r, i) { r.ranks.ensemble = i + 1; });
    return ranked;
  }

  var api = {
    getQueryParam: getQueryParam, smallGray: smallGray, scoreColumns: scoreColumns,
    createTable: createTable, applyState: applyState, bindMethodTabs: bindMethodTabs, bindSearch: bindSearch,
    rowClickHandler: rowClickHandler, refreshOpenTournamentTables: refreshOpenTournamentTables, bindDetailClicks: bindDetailClicks,
    loadMaster: loadMaster, cloneWithGlobalRanks: cloneWithGlobalRanks, rerankByGlobalEnsemble: rerankByGlobalEnsemble,
  };
  global.SPSPRankingPage = api;
  (global.SPSP = global.SPSP || {}).RankingPage = api;   // window.SPSP.RankingPage (名前空間。旧名 SPSPRankingPage も残す)

export default api;
export { getQueryParam, smallGray, scoreColumns, createTable, applyState, bindMethodTabs, bindSearch, rowClickHandler, refreshOpenTournamentTables, bindDetailClicks, loadMaster, cloneWithGlobalRanks, rerankByGlobalEnsemble };
