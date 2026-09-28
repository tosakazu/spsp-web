// @ts-check
// list_page.js — 一覧ページ (c/ pref/ local/ events/) の並べ替え見出しと検索の配線 (サイト共通)。
// 以前は同じ 3 つの処理が 4 ページにコピーされていた。
//   SPSPListPage.updateSortIndicators(sortKey, sortDir)
//       th.sortable に sorted-asc / sorted-desc を付け直す (CSS が ↑↓ を出す)
//   SPSPListPage.bindSortHeaders(state, ascKeys, onChange)
//       th.sortable のクリックで state.sortKey / state.sortDir を更新して onChange()。
//       同じ列なら向きを反転、別の列なら ascKeys に含まれる列は asc、それ以外は desc から始める
//   SPSPListPage.bindSearch(onChange)   #search の input。onChange(text)
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く

  function updateSortIndicators(sortKey, sortDir) {
    document.querySelectorAll('th.sortable').forEach(function (th0) {
      var th = /** @type {HTMLElement} */ (th0);
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (th.dataset.sort === sortKey) th.classList.add(sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
    });
  }

  function bindSortHeaders(state, ascKeys, onChange) {
    document.querySelectorAll('th.sortable').forEach(function (th0) {
      var th = /** @type {HTMLElement} */ (th0);
      th.addEventListener('click', function () {
        var k = th.dataset.sort;
        if (state.sortKey === k) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = k;
          state.sortDir = ascKeys.indexOf(k) >= 0 ? 'asc' : 'desc';
        }
        onChange();
      });
    });
  }

  function bindSearch(onChange) {
    var search = document.getElementById('search');
    if (search) search.addEventListener('input', function (e) { onChange(/** @type {HTMLInputElement} */ (e.target).value); });
  }

  var api = { updateSortIndicators: updateSortIndicators, bindSortHeaders: bindSortHeaders, bindSearch: bindSearch };
  global.SPSPListPage = api;
  (global.SPSP = global.SPSP || {}).ListPage = api;   // window.SPSP.ListPage (名前空間。旧名 SPSPListPage も残す)

export default api;
export { updateSortIndicators, bindSortHeaders, bindSearch };
