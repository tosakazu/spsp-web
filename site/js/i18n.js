// @ts-check
// i18n.js — UI 文言の辞書引き (docs/frontend_i18n_review.md §4.3)。
//   辞書は site/i18n/<lang>.js が window.SPSP_I18N[lang] = { 'nav.ranking': 'ランキング', … } を置く (fetch しない:
//   描画前に同期で引けるように script で読む)。キーはページの名前空間 ('nav.*', 'ranking.*', 'player.*', 'common.*' …)。
//   地域で言い方が変わるキー (全国 / 都道府県 / 海外 …) は site/regions/<REGION>/i18n.js (ページからは region/i18n.js) が
//   window.SPSP_I18N_REGION[REGION][lang] = { key: 文言 } で上書きする (言語辞書にあるキーだけ。数十キーの想定)。
//   引く順: 地域の上書き (その言語) → 言語 → 既定言語。
//   SPSPI18n.t(key, params)   辞書の文言。params は {name} を置き換える。{n, plural, one{…} other{…}} と {n, selectordinal, one{{n}st} …} の最小実装。
//                             無いキーは既定言語に fallback し、それも無ければキーをそのまま返す (console.warn は 1 回)
//   SPSPI18n.lang             決まった言語。ビルドしたページでは <html lang> (js/lang_boot.js が ?lang= / localStorage から決めて書く)。
//                             site/ を直接開いたときは ?lang= > localStorage 'spsp_lang' > navigator.language > site.defaultLang
//                             (site.langs に無い言語は選ばれない)
//   SPSPI18n.pick({ja, en})  言語別の値 (region/config.js の設定など) から表示言語のものを返す
//   SPSPI18n.apply(root)      root 以下の data-i18n="key" の文言 (子要素があれば最初のテキストノードだけ、前後の空白は保持) と、
//                             data-i18n-attr="placeholder:key,title:key" の属性を差し替える
//   SPSPI18n.fmtNumber(n)     Intl.NumberFormat(lang)
//   SPSPI18n.has(key)
// 読み込み順: region/config.js → i18n/<lang>.js → region/i18n.js → これ → 文言を使うスクリプト (nav.js など)。
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く
  /** @type {any} */
  var site = (global.SPSP && global.SPSP.site) || { langs: ['ja'], defaultLang: 'ja' };
  var dicts = global.SPSP_I18N || (global.SPSP_I18N = {});
  var regionDicts = (global.SPSP_I18N_REGION && site.region && global.SPSP_I18N_REGION[site.region]) || {};
  var warned = {};

  function detectLang() {
    // 候補は config.langs のうち辞書が読み込まれている言語だけ (site/ を直接開いたページは既定言語の辞書しか読まない。
    // 言語別に生成したページは <html lang> で決まるのでここには来ない)
    var langs = (site.langs || ['ja']).filter(function (l) { return dicts[l]; });
    if (!langs.length) langs = [site.defaultLang || (site.langs || ['ja'])[0]];
    /** @type {string | null} */
    var pick = null;
    try { pick = new URL(global.location.href).searchParams.get('lang'); } catch (e) { /* location 無し */ }
    if (pick && langs.indexOf(pick) >= 0) {
      try { global.localStorage.setItem('spsp_lang', pick); } catch (e) { /* 保存できなくてもよい */ }
      return pick;
    }
    try { pick = global.localStorage.getItem('spsp_lang'); } catch (e) { pick = null; }
    if (pick && langs.indexOf(pick) >= 0) return pick;
    var nav = (global.navigator && (global.navigator.language || '')) || '';
    var short = nav.split('-')[0];
    if (short && langs.indexOf(short) >= 0) return short;
    return site.defaultLang || langs[0];
  }
  // 言語別に生成した静的ページ (ビルドが <html lang data-lang-root> を書く) では <html lang> が言語。それ以外は detectLang
  var built = global.document && global.document.documentElement && global.document.documentElement.hasAttribute('data-lang-root');
  var lang = (built && (site.langs || ['ja']).indexOf(global.document.documentElement.lang) >= 0) ? global.document.documentElement.lang : detectLang();
  // 決まった言語を <html lang> に反映する。CSS の言語別の調整 (html[lang="en"] .x { … }) と :lang() はこれを見る
  if (global.document && global.document.documentElement) global.document.documentElement.lang = lang;

  function lookup(key) {
    var r = regionDicts[lang];
    if (r && r[key] != null) return r[key];   // 地域の上書き (その言語)
    var d = dicts[lang];
    var v = d ? d[key] : undefined;
    if (v == null && lang !== site.defaultLang) {
      var d0 = dicts[site.defaultLang];
      v = d0 ? d0[key] : undefined;
      if (v != null && !warned[key]) { warned[key] = true; if (global.console) console.warn('[i18n] ' + lang + ' に無い文言 (既定言語で代用): ' + key); }
    }
    return v;
  }

  // {name} → params.name。{n, plural, one{1 件} other{{n} 件}} の最小実装 (Intl.PluralRules)
  function format(str, params) {
    if (!params) return str;
    // 形の中に {n} が入る ({n, plural, one{{n} 件} …}) ので、1 段の入れ子まで許す
    return String(str).replace(/\{(\w+),\s*(plural|selectordinal),\s*((?:\w+\{(?:[^{}]|\{[^{}]*\})*\}\s*)+)\}/g, function (_, name, kind, forms) {
      var n = Number(params[name]);
      var rule = 'other';
      // plural = 個数 (one/other …)、selectordinal = 序数 (英語の 1st/2nd/3rd/4th: one/two/few/other)
      try { rule = new Intl.PluralRules(lang, { type: kind === 'selectordinal' ? 'ordinal' : 'cardinal' }).select(n); } catch (e) { /* 対応外 */ }
      var map = {};
      forms.replace(/(\w+)\{((?:[^{}]|\{[^{}]*\})*)\}/g, function (__, k, txt) { map[k] = txt; return ''; });
      var picked = map[rule] != null ? map[rule] : (map.other != null ? map.other : '');
      return picked.replace(/\{(\w+)\}/g, function (___, k) { return params[k] != null ? params[k] : '{' + k + '}'; });
    }).replace(/\{(\w+)\}/g, function (_, k) { return params[k] != null ? params[k] : '{' + k + '}'; });
  }

  function t(key, params) {
    var v = lookup(key);
    if (v == null) {
      if (!warned[key]) { warned[key] = true; if (global.console) console.warn('[i18n] 文言が無い: ' + key); }
      return key;
    }
    return format(v, params);
  }

  function has(key) { return lookup(key) != null; }

  // 要素の文言を差し替える。子要素があるときは最初の (空白でない) テキストノードだけを置き換え、
  // 前後の空白はそのまま残す (整形された HTML の見た目・DOM を変えない)
  /** @param {Element} el @param {string} text */
  function setText(el, text) {
    /** @type {Node | null} */
    var node = null;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3 && (c.nodeValue || '').trim()) { node = c; break; }
    }
    if (!node) { if (!el.firstElementChild) el.textContent = text; return; }
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(node.nodeValue || '');
    node.nodeValue = (m ? m[1] : '') + text + (m ? m[3] : '');
  }

  function apply(root) {
    var scope = root || global.document;
    if (!scope || !scope.querySelectorAll) return;
    var els = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < els.length; i++) setText(els[i], t(els[i].getAttribute('data-i18n')));
    var attrEls = scope.querySelectorAll('[data-i18n-attr]');
    for (var j = 0; j < attrEls.length; j++) {
      var pairs = attrEls[j].getAttribute('data-i18n-attr').split(',');
      for (var k = 0; k < pairs.length; k++) {
        var pair = pairs[k].split(':');
        if (pair.length === 2) attrEls[j].setAttribute(pair[0].trim(), t(pair[1].trim()));
      }
    }
  }

  /** @type {{ format: (n: number) => string } | null} */
  var numberFormat = null;
  function fmtNumber(n) {
    if (!numberFormat) { try { numberFormat = new Intl.NumberFormat(lang); } catch (e) { numberFormat = { format: String }; } }
    return numberFormat.format(n);
  }

  /** { ja: '…', en: '…' } のような言語別の値 (region/config.js の設定など) から表示言語のものを返す。無ければ既定言語 → 最初の値 */
  function pick(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (obj[lang] != null) return obj[lang];
    var def = site.defaultLang || 'ja';
    if (obj[def] != null) return obj[def];
    for (var k in obj) return obj[k];
    return undefined;
  }

  // ビルドしたページは既定言語の文言で出ている。?lang= で別の言語になったら、本文の data-i18n をここで差し替える
  // (ページの script は本文の最後にあるので、この時点で本文は読み終わっている。ページの描画より前に 1 回だけ)
  if (built && lang !== site.defaultLang && dicts[lang] && global.document) apply(global.document.documentElement);

  var api = { t: t, has: has, apply: apply, pick: pick, setText: setText, fmtNumber: fmtNumber, format: format, lang: lang, dicts: dicts, regionDicts: regionDicts };
  global.SPSPI18n = api;
  (global.SPSP = global.SPSP || {}).i18n = api;

export default api;
export { t, has, apply, setText, fmtNumber, format, lang, dicts, regionDicts };
