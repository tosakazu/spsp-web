// @ts-check
// src/pages/c_index.js — site/c/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/c_index.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPCharEmoji from '../../site/js/char_emoji.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPData from '../../site/js/data.js';
import SPSPListPage from '../../site/js/list_page.js';
import '../../site/nav.js';
import '../../site/share.js';
import FIGHTER_NUMBER from '../../site/js/fighter_number.js';
import SPSPShare from '../../site/share.js';
import { charName } from '../../site/js/chars.js';

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

// FIGHTER_NUMBER (公式 SSBU ファイター番号) は ../js/fighter_number.js で定義
// (キャラ投票と共有。2026-08-14 に切り出し)。

/** 一覧の 1 行 (character_index の characters に表示名・全一・順位番号を足したもの) */
/** @typedef {SpspCharacterIndexChar & { top_rank?: number | null, _top_uid?: number | null, rank_top?: number, rank_n?: number, rank_name?: number }} CharRow */

/** @type {{ characters: CharRow[], uid_to_display: Map<number, string>, uid_to_ens_rank: Map<number, number | null>, filtered: CharRow[],
 *            sortKey: string, sortDir: string, searchText: string, index: SpspCharacterIndex | null, charEmoji?: Record<string, string> }} */
const STATE = {
  characters: [],
  uid_to_display: new Map(),     // uid -> display name (from jsonl rank=1..few)
  uid_to_ens_rank: new Map(),    // uid -> ens rank (for top player display)
  filtered: [],
  sortKey: 'top_rank',
  sortDir: 'asc',
  searchText: '',
  index: null,                   // raw character_index data
  // charEmoji: キャラ id → 絵文字 (init で読む)
};

// escapeHtml は ../js/html.js (サイト共通)

// 各 sort key の canonical direction での 1..N 順位を各キャラに割り当てる.
// 表示用の番号: sort key を切替えるとそのキー基準で再計算. asc/desc 切替時は
// 行が逆順表示になるので、結果として番号も上から N..1 / 1..N と入れ替わる.
// canonical direction:
//   top_rank → asc (= 全一 #1 が上で番号 1)
//   n_main   → desc (= 使い手数多い順が番号 1)
//   name     → asc by FIGHTER_NUMBER (= マリオ=#1)
function assignFixedRanks() {
  const chars = STATE.characters;
  const byTop = chars.slice().sort((a, b) => {
    const av = a.top_rank == null ? Infinity : a.top_rank;
    const bv = b.top_rank == null ? Infinity : b.top_rank;
    return av - bv;
  });
  byTop.forEach((c, i) => { c.rank_top = i + 1; });
  const byN = chars.slice().sort((a, b) => (b.n_main || 0) - (a.n_main || 0));
  byN.forEach((c, i) => { c.rank_n = i + 1; });
  const byName = chars.slice().sort((a, b) => {
    const af = FIGHTER_NUMBER[a.id] ?? Infinity;
    const bf = FIGHTER_NUMBER[b.id] ?? Infinity;
    if (af !== bf) return af - bf;
    return a.name.localeCompare(b.name, 'ja');  // 未登録 (Infinity 同点) は名前 fallback
  });
  byName.forEach((c, i) => { c.rank_name = i + 1; });
}

/** @param {CharRow} c */
function currentRankOf(c) {
  if (STATE.sortKey === 'name') return c.rank_name;
  if (STATE.sortKey === 'n_main') return c.rank_n;
  return c.rank_top;
}

function applyFilters() {
  const ft = STATE.searchText.toLowerCase();
  STATE.filtered = STATE.characters.filter(c => {
    if (ft && !c.name.toLowerCase().includes(ft)) return false;
    return true;
  });
  const sign = STATE.sortDir === 'asc' ? 1 : -1;
  const key = STATE.sortKey;
  STATE.filtered.sort((a, b) => {
    if (key === 'name') {
      const af = FIGHTER_NUMBER[a.id] ?? Infinity;
      const bf = FIGHTER_NUMBER[b.id] ?? Infinity;
      if (af !== bf) return sign * (af - bf);
      return sign * a.name.localeCompare(b.name, 'ja');
    }
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
    tbody.innerHTML = `<tr><td colspan="4" class="empty-msg">${i18n('char_list.none')}</td></tr>`;
  } else {
    const html = rows.map((c, i) => {
      const url = `${SPSP.pageHref('ranking.html')}?char=${c.id}`;
      // top uid (= 1 番上位の使い手). 海外タグ勢を除外した結果は init() で c._top_uid に格納済み.
      let topHtml = '<span style="color:#9ca3af">—</span>';
      const topUid = c._top_uid;
      if (topUid != null) {
        const disp = STATE.uid_to_display.get(topUid) || `uid:${topUid}`;
        const ensRank = STATE.uid_to_ens_rank.get(topUid);
        const rankFrag = ensRank ? `<span class="top-rank">#${ensRank}</span>` : '';
        topHtml = SPSPLinks.playerLink(SPSP.langRoot, topUid, escapeHtml(disp)) + rankFrag;
      }
      return `
        <tr class="char-row" data-id="${c.id}">
          <td class="col-idx">${currentRankOf(c)}</td>
          <td class="col-name"><a href="${url}">${STATE.charEmoji && STATE.charEmoji[c.id] ? STATE.charEmoji[c.id] + ' ' : ''}${escapeHtml(c.name)}</a></td>
          <td class="col-num">${c.n_main}</td>
          <td class="col-top">${topHtml}</td>
        </tr>
      `;
    }).join('');
    tbody.innerHTML = html;
  }

  SPSPListPage.updateSortIndicators(STATE.sortKey, STATE.sortDir);   // ../js/list_page.js

  const status = document.getElementById('status');
  if (status) status.textContent = i18n('char_list.status', { n: rows.length, total: STATE.characters.length });
}

function setupEvents() {
  // 検索と並べ替え見出しの配線は ../js/list_page.js (一覧ページ共通)
  SPSPListPage.bindSearch(text => {
    STATE.searchText = text;
    applyFilters();
    render();
    syncUrl();
  });
  SPSPListPage.bindSortHeaders(STATE, ['name', 'top_rank'], () => {
    applyFilters();
    render();
    syncUrl();
  });
}

// URL ↔ STATE 同期. sort=top_rank|name|n_main, dir=asc|desc, q=<search>.
// デフォルト値 (sort=top_rank, dir=asc, q='') の場合は URL から除外.
const DEFAULT_SORT = { key: 'top_rank', dir: 'asc' };
function syncUrl() {
  const url = new URL(location.href);
  if (STATE.sortKey !== DEFAULT_SORT.key) url.searchParams.set('sort', STATE.sortKey);
  else url.searchParams.delete('sort');
  if (STATE.sortDir !== DEFAULT_SORT.dir) url.searchParams.set('dir', STATE.sortDir);
  else url.searchParams.delete('dir');
  if (STATE.searchText) url.searchParams.set('q', STATE.searchText);
  else url.searchParams.delete('q');
  history.replaceState(null, '', url.toString());
}

function readUrl() {
  const url = new URL(location.href);
  const sort = url.searchParams.get('sort');
  const dir = url.searchParams.get('dir');
  const q = url.searchParams.get('q');
  if (sort && ['top_rank', 'name', 'n_main'].includes(sort)) STATE.sortKey = sort;
  if (dir === 'asc' || dir === 'desc') STATE.sortDir = dir;
  if (q != null) {
    STATE.searchText = q;
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById('search'));
    if (el) el.value = q;
  }
  // thead の sorted-asc/desc クラスを STATE に合わせて付け直す.
  SPSPListPage.updateSortIndicators(STATE.sortKey, STATE.sortDir);   // ../js/list_page.js
}

SPSPShare.setup(document.getElementById('share-icon-btn'), () => ({
  title: i18n('char_list.share.title'),
  text:  i18n('char_list.share.text'),
  url:   location.href,
}));

async function init() {
  setupEvents();
  readUrl();
  try {
    const [idxRes, jsonlRes, overseasRes, emojiRes] = await Promise.all([
      fetch(SPSP.data + 'data/character_index.json'),
      fetch(SPSP.data + 'latest_tjpr_full.jsonl'),
      fetch(SPSP.data + 'data/overseas.json').catch(() => null),
      fetch(SPSPCharEmoji.url()).catch(() => null),
    ]);
    if (!idxRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'character_index.json' }));
    if (!jsonlRes.ok) throw new Error(i18n('common.fetch_failed', { file: 'latest_tjpr_full.jsonl' }));
    const index = /** @type {SpspCharacterIndex} */ (await idxRes.json());
    STATE.index = index;
    STATE.characters = index.characters.map((c) => Object.assign({}, c, { name: charName(c.id, c.name) }));   // 表示言語の名前
    // キャラ id → 絵文字 (名前の左に表示)。
    /** @type {Record<string, string>} */
    const charEmoji = {};
    STATE.charEmoji = charEmoji;
    if (emojiRes && emojiRes.ok) {
      try { const ce = await emojiRes.json(); for (const k in ce) charEmoji[k] = ce[k].emoji; } catch (e) {}
    }
    // 海外タグ勢 (= site/data/overseas.json) は「全1」表示の対象から除外する.
    /** @type {Set<number> | null} */
    let overseasUids = null;
    if (overseasRes && overseasRes.ok) {
      try {
        const j = await overseasRes.json();
        overseasUids = new Set(j.uids || []);
      } catch (e) {}
    }
    // 各キャラの top uid = main_by_char[id] の先頭から海外勢をスキップした最初の uid.
    /** @type {Map<number, number>} */
    const charTopUid = new Map();
    for (const c of STATE.characters) {
      const uids = index.main_by_char[String(c.id)] || [];
      const top = uids.find(u => !overseasUids || !overseasUids.has(u));
      if (top != null) charTopUid.set(c.id, top);
    }

    // Map uid -> display for top player display.
    // 全 jsonl line 読まず、必要な uid set を組み立てて一気に scan する.
    const neededUids = new Set(charTopUid.values());
    for (const rec of /** @type {SpspRankRecord[]} */ (SPSPData.parseJsonl(await jsonlRes.text()))) {   // ../js/data.js
      if (neededUids.has(rec.user_id)) {
        STATE.uid_to_display.set(rec.user_id, rec.display);
        STATE.uid_to_ens_rank.set(rec.user_id, (rec.ranks && rec.ranks.ensemble) || null);
        if (STATE.uid_to_display.size === neededUids.size) break;
      }
    }

    // top_rank: sort 用に各キャラに top プレイヤーの ens rank を貼る.
    // top uid は海外勢を除外した先頭 (= charTopUid).
    for (const c of STATE.characters) {
      const topUid = charTopUid.get(c.id);
      c.top_rank = topUid != null ? (STATE.uid_to_ens_rank.get(topUid) || null) : null;
      c._top_uid = topUid != null ? topUid : null;
    }
    assignFixedRanks();

    applyFilters();
    render();
    const footer = document.getElementById('footer-info');
    if (footer) footer.innerHTML =
      `<p>${i18n('char_list.footer', { n: STATE.characters.length, m: STATE.characters.reduce((s, c) => s + c.n_main, 0) })}<br>
       <a href="${SPSP.langRoot}">${i18n('common.back_to_national')}</a></p>`;
  } catch (e) {
    const tbody = document.getElementById('tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty-msg">${i18n('common.load_error', { message: /** @type {Error} */ (e).message })}</td></tr>`;
    const status = document.getElementById('status');
    if (status) status.textContent = '';
  }
}
init();
