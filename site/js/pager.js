// @ts-check
// pager.js — 5 件ずつのページ送り (サイト共通)。以前は p/ と t/ に同じものがあった。
//   SPSPPager.setupPaginated(items, elId, pagerId, renderFn, emptyMsg) → items が空なら false
//     - ボタンは prev/next + ページ表示 ("2 / 4")。swipe なし。
//     - ページ送りで pager の位置が動かないように、全ページを 1 度仮描画して最大高さを測り
//       コンテナの min-height に固定する (el が visible = レンダリング可能なことが前提)。
//     - emptyMsg を渡すと items 空時にメッセージ表示、無ければ el を空にする (= section を隠す側のフラグ用)。
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く
import SPSPI18n from './i18n.js';
  var PAGE = 5;

  function setupPaginated(items, elId, pagerId, renderFn, emptyMsg) {
    var el = document.getElementById(elId);
    if (!el) return false;
    var box = el;   // 型: 以降の閉包では null でない
    var pager = document.getElementById(pagerId);
    if (pager) pager.style.display = 'none';
    el.style.minHeight = '';
    if (!items || !items.length) {
      if (emptyMsg) el.innerHTML = '<div class="empty-msg" style="padding:12px">' + emptyMsg + '</div>';
      else el.innerHTML = '';
      return false;
    }
    var pageCount = Math.ceil(items.length / PAGE);
    var maxHeight = 0;
    if (pageCount > 1) {
      for (var p = 0; p < pageCount; p++) {
        el.innerHTML = renderFn(items.slice(p * PAGE, (p + 1) * PAGE));
        if (el.offsetHeight > maxHeight) maxHeight = el.offsetHeight;
      }
      if (maxHeight > 0) el.style.minHeight = maxHeight + 'px';
    }
    var pageIdx = 0;
    function draw() {
      var start = pageIdx * PAGE;
      box.innerHTML = renderFn(items.slice(start, start + PAGE));
      if (!pager) return;
      if (pageCount > 1) {
        pager.style.display = '';
        pager.innerHTML =
          '<button type="button" class="page-btn" data-act="prev" aria-label="' + SPSPI18n.t('pager.prev') + '">◀</button>' +
          '<span class="page-info">' + (pageIdx + 1) + ' / ' + pageCount + '</span>' +
          '<button type="button" class="page-btn" data-act="next" aria-label="' + SPSPI18n.t('pager.next') + '">▶</button>';
        var prev = /** @type {HTMLButtonElement} */ (pager.querySelector('[data-act="prev"]'));
        var next = /** @type {HTMLButtonElement} */ (pager.querySelector('[data-act="next"]'));
        prev.disabled = (pageIdx === 0);
        next.disabled = (pageIdx === pageCount - 1);
        prev.addEventListener('click', function (e) { e.preventDefault(); if (pageIdx > 0) { pageIdx--; draw(); } });
        next.addEventListener('click', function (e) { e.preventDefault(); if (pageIdx < pageCount - 1) { pageIdx++; draw(); } });
      } else {
        pager.style.display = 'none';
      }
    }
    draw();
    return true;
  }

  var api = { setupPaginated: setupPaginated, PAGE: PAGE };
  global.SPSPPager = api;
  (global.SPSP = global.SPSP || {}).Pager = api;   // window.SPSP.Pager (名前空間。旧名 SPSPPager も残す)

export default api;
export { setupPaginated, PAGE };
