// @ts-check
// lang_boot.js — 表示言語を ?lang= で切り替える (2026-09-28)。各地域の配信は既定言語の 1 系統 (/jp/ = 日本語、/na/ = 英語) だけで、
// もう一方の言語は同じ URL に ?lang=en / ?lang=ja を付けて見る。検索エンジンに載るのは既定言語だけ (canonical は ?lang 無しの URL)。
//
// ビルドが既定言語の辞書 (i18n/<既定>.js) の直後に置く古典 script。ページの script (本文の最後) より前に同期で動く:
//   1. 言語を決める: ?lang= (config.langs にあるもの。localStorage 'spsp_lang' に覚える) > localStorage > 既定言語。
//      navigator.language は見ない (検索エンジンのクローラーが英語環境なので、既定言語以外を見せないため)
//   2. 既定言語以外なら <html lang> をその言語にし、辞書 i18n/<lang>.js を document.write で同期に読む
//      (js/i18n.js は <html lang> で言語を決め、本文の data-i18n を差し替える)
//   3. 既定言語以外の表示は noindex (?lang 付きの URL が検索結果に出ないように)
// 既定言語にしか無いページ (<html data-default-lang-only>: 解説・投票・ブログ) では何もしない。
(function () {
  var doc = document;
  var h = doc.documentElement;
  var site = /** @type {any} */ (window).SPSP && /** @type {any} */ (window).SPSP.site;
  if (!site || !h || h.hasAttribute('data-default-lang-only')) return;
  var langs = site.langs || [];
  var def = site.defaultLang || langs[0];
  /** @type {string | null} */
  var pick = null;
  try { pick = new URL(location.href).searchParams.get('lang'); } catch (e) { pick = null; }
  if (pick && langs.indexOf(pick) >= 0) {
    try { localStorage.setItem('spsp_lang', pick); } catch (e) { /* 保存できなくても、この表示は ?lang で決まる */ }
  } else {
    pick = null;
    try {
      var saved = localStorage.getItem('spsp_lang');
      if (saved && langs.indexOf(saved) >= 0) pick = saved;
    } catch (e) { pick = null; }
  }
  if (!pick || pick === def) return;
  h.lang = pick;
  var root = h.getAttribute('data-root') || '';
  doc.write('<meta name="robots" content="noindex,follow">');
  doc.write('<script src="' + root + 'i18n/' + pick + '.js"><\/script>');
})();
