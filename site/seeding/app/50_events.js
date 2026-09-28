// @ts-check
// seeding/app/50_events.js — SPSP シードツール本体の一部: 検索・基準タブの配線、展開行 (大会別 / 直接対決)。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { i18n } from './10_skeleton.js';
import { DATA, renderManualUI, saveManual } from './30_core.js';
import { dropAppliedOrder, resetSeedOptResultPanel } from './75_series_rematch.js';
import SPSPDetail from '../../player-detail.js';
'use strict';

// ── Events ──
const searchEl = document.getElementById('search');
if (searchEl) searchEl.addEventListener('input', e => {
  S.filterText = /** @type {HTMLInputElement} */ (e.target).value;
  const tbl = S.TABLE; if (tbl) tbl.setFilterText(S.filterText);
});

const methodTabs = document.getElementById('method-tabs');
if (methodTabs) methodTabs.addEventListener('click', e => {
  const tab = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.method-tab'));
  if (!tab || tab.dataset.method === S.currentMethod) return;
  // 手動調整がある場合は破棄確認を先に (キャンセルならタブ切替自体を中止)。
  if (S.MANUAL && !confirm(i18n('seed.events.s1'))) return;
  document.querySelectorAll('.method-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  S.currentMethod = /** @type {string} */ (tab.dataset.method);
  dropAppliedOrder();  // 基準が変わるので適用解除
  // 被り回避の結果も基準ランキング前提なので破棄（残すと再適用できない死に状態になる）。
  if (S.SEEDOPT_RESULT) resetSeedOptResultPanel(i18n('seed.events.s2'));
  // 手動調整も旧基準前提なので破棄 (保存も消す)。
  if (S.MANUAL) {
    S.MANUAL = null; saveManual(); renderManualUI();
    const st = document.getElementById('status');
    if (st) st.textContent = i18n('seed.events.s3');
  }
  const tbl = S.TABLE; if (tbl) tbl.setMethod(S.currentMethod);
});

// 注: sortable / 無限スクロール / クリック handler は SPSPRankingTable コンポーネントが
// 内部で扱う. main-row クリック時は rowClick callback (= seedRowClickHandler) が呼ばれる.

// ── Detail パネル (大会別 / 直接対決) ──
// 詳細パネル本体は SPSPDetail.buildDetailContent (= ../player-detail.js) に集約.
// canonical = site/index.html の inline 実装. 大会内ランクや Lv 内訳 / charts は
// 表示しない (= main canonical との一致を優先).
function getDetailCfg() {
  return {
    getMeta: () => S.META || {},
    getDataArray: () => DATA,
    getMasterMap: () => S.MASTER_MAP,
    pathPrefix: SPSP.langRoot, dataPrefix: SPSP.data,
  };
}

// Open 中の tour-table 再描画 (= tour-sort-toggle 押下時).
function refreshOpenTournamentTables() {
  document.querySelectorAll('.tour-sort-toggle').forEach(el0 => {
    const el = /** @type {HTMLElement} */ (el0);
    const uid = el.dataset.uid;
    const rec = DATA.find(r => String(r.user_id) === String(uid));
    if (!rec) return;
    const tabContent = el.closest('.tab-tour');
    if (!tabContent) return;
    tabContent.innerHTML = SPSPDetail.buildTournamentTable(rec, getDetailCfg());
  });
}

// ── Detail-row 内部のクリック処理 (tab 切替 / H2H expand / 並べ替え / 行展開) ──
const tbodyEl = document.getElementById('tbody');
if (tbodyEl) tbodyEl.addEventListener('click', e => {
  const target = /** @type {Element} */ (e.target);
  // Detail tab switch (大会別 / 直接対決)
  const tabBtn = /** @type {HTMLElement | null} */ (target.closest('.detail-tab'));
  if (tabBtn) {
    e.stopPropagation();
    const section = tabBtn.closest('.detail-section');
    if (!section) return;
    const key = tabBtn.dataset.tab;
    section.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', /** @type {HTMLElement} */ (t).dataset.tab === key));
    section.querySelectorAll('.detail-tab-content').forEach(c0 => {
      const c = /** @type {HTMLElement} */ (c0);
      c.style.display = c.classList.contains('tab-' + key) ? '' : 'none';
    });
    return;
  }
  // H2H 共通「もっと見る」 → 勝/負 両方の hidden を表示
  const h2hBtn = target.closest('.h2h-expand-btn');
  if (h2hBtn) {
    e.stopPropagation();
    const wrap = h2hBtn.closest('.tab-h2h');
    if (!wrap) return;
    wrap.querySelectorAll('.h2h-extra').forEach(x => /** @type {HTMLElement} */ (x).style.display = '');
    const expandDiv = h2hBtn.closest('.h2h-expand');
    if (expandDiv) expandDiv.remove();
    return;
  }
  // Tournament sort toggle (page-level, applies to all open detail rows)
  const toggle = target.closest('.tour-sort-toggle');
  if (toggle) {
    e.stopPropagation();
    SPSPDetail.toggleSortMode();
    refreshOpenTournamentTables();
    return;
  }
  // Expand hidden rows in tour-table
  const expand = target.closest('.expand-rows');
  if (expand) {
    e.stopPropagation();
    const section = expand.parentElement;
    if (section) section.querySelectorAll('tr.extra-row').forEach(r => r.classList.remove('hidden-row'));
    expand.remove();
    return;
  }
});

// main-row クリック → detail-row 展開 (大会別 / 直接対決 タブ含む).
// RankingTable の rowClick callback として呼ばれる.
/** @param {SpspSeedRecord} rec @param {HTMLTableRowElement} tr @param {Event} [_ev] */
export function seedRowClickHandler(rec, tr, _ev) {
  if (!rec) return;
  const next = tr.nextElementSibling;
  if (next && next.classList && next.classList.contains('detail-row')) {
    next.remove();
    tr.classList.remove('expanded');
    return;
  }
  // 既に他の行が展開中ならそれを閉じる
  const table = tr.closest('table');
  if (!table) return;
  const open = table.querySelector('tr.detail-row');
  if (open) {
    const prev = open.previousElementSibling;
    if (prev) prev.classList.remove('expanded');
    open.remove();
  }
  const detail = document.createElement('tr');
  detail.className = 'detail-row';
  if (rec.unranked) {
    detail.innerHTML = `<td colspan="9"><div class="detail-inner" style="padding:14px;font-size:12px;color:#6b7280">
      ${i18n('seed.events.t1')}<br>
      ${i18n('seed.events.t2')}
    </div></td>`;
    tr.classList.add('expanded');
    tr.after(detail);
    return;
  }
  detail.innerHTML = `<td colspan="9"><div class="detail-inner">
    <div class="loading-msg" style="padding:14px;color:#6b7280;font-size:12px">${i18n('seed.events.t3')}</div>
  </div></td>`;
  tr.classList.add('expanded');
  tr.after(detail);
  const cfg = getDetailCfg();
  SPSPDetail.fetchPlayerDetail(rec.user_id, cfg).then(detailData => {
    if (!detailData) return;
    rec.tournaments = detailData.tournaments || [];
    rec.history = detailData.history || [];
    rec.recent_matches = detailData.recent_matches || [];
    if (rec.scores) rec.scores.tjpr_lv_breakdown = detailData.tjpr_lv_breakdown || {};
    const inner = detail.querySelector('.detail-inner');
    if (inner) inner.innerHTML = SPSPDetail.buildDetailContent(rec, cfg);
  }).catch(err => {
    const inner = detail.querySelector('.loading-msg');
    if (inner) inner.textContent = i18n('seed.events.s4') + err.message;
  });
}
