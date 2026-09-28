// @ts-check
// suggest.js — 検索欄の候補リスト (.suggest) のキーボード操作と外側クリックで閉じる処理 (サイト共通)。
// 以前は sim/ と priority/ に同じものがあった。
//   SPSPSuggest.installCloseOnOutsideClick()
//       document に 1 個だけ委譲登録し、候補リストの外をクリックしたら .suggest.open を閉じる
//       (大会切替のたびにリスナーが蓄積しないように)
//   SPSPSuggest.attachSuggestNav(input, sug, pick, isItem)
//       ↑↓ で選択、Enter で pick(item)、Esc で閉じる。isItem(el) は候補として数える .item の判定 (省略時は全部)
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く

  var installed = false;
  function installCloseOnOutsideClick() {
    if (installed) return;
    installed = true;
    document.addEventListener('click', function (e) {
      document.querySelectorAll('.suggest.open').forEach(function (s) {
        var wrap = s.parentNode;
        if (!wrap || !wrap.contains(/** @type {Node} */ (e.target))) s.classList.remove('open');
      });
    });
  }

  function attachSuggestNav(input, sug, pick, isItem) {
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { sug.classList.remove('open'); return; }
      if (!sug.classList.contains('open')) return;
      var items = Array.prototype.filter.call(sug.querySelectorAll('.item'), function (it) {
        return isItem ? isItem(it) : true;
      });
      if (!items.length) return;
      var idx = items.findIndex(function (it) { return it.classList.contains('active'); });
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % items.length; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + items.length) % items.length; }
      else if (e.key === 'Enter') { if (idx >= 0) { e.preventDefault(); pick(items[idx]); } return; }
      else return;
      items.forEach(function (it, i) { it.classList.toggle('active', i === idx); });
      items[idx].scrollIntoView({ block: 'nearest' });
    });
  }

  var api = { installCloseOnOutsideClick: installCloseOnOutsideClick, attachSuggestNav: attachSuggestNav };
  global.SPSPSuggest = api;
  (global.SPSP = global.SPSP || {}).Suggest = api;   // window.SPSP.Suggest (名前空間。旧名 SPSPSuggest も残す)

export default api;
export { installCloseOnOutsideClick, attachSuggestNav };
