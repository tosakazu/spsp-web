// @ts-check
// html.js — HTML エスケープ (サイト共通)。以前は 16 ファイルにほぼ同じ関数がコピーされ、null の扱いと ' の
// エスケープが 3 通りに分かれていた。ここ 1 本に寄せる。ページはこの script を他より先に読む。
// 使い方: escapeHtml(s)  (グローバル。SPSPHtml.escapeHtml も同じ)。null / undefined は '' になる。
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く
  var MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return MAP[c]; });
  }
  var api = { escapeHtml: escapeHtml };
  global.SPSPHtml = api;
  (global.SPSP = global.SPSP || {}).Html = api;   // window.SPSP.Html (名前空間。旧名 SPSPHtml も残す)
  global.escapeHtml = escapeHtml;
  // サイトのルート (JSON・js・css の置き場) と、ページ木のルート (ページ間リンクの起点) への相対パス。
  // 言語別の静的 HTML (dist/en/…) はサイトのルートより 1 段深いので 2 つは別。ビルドが <html data-root data-lang-root> に書く。
  // 無ければ (site/ を直接開いたとき) この script の src ('../js/html.js' 等) から推定する。
  //   fetch(SPSP.data + 'meta.json')、SPSPLinks.playerLink(SPSP.langRoot, uid, …) のように使う (SPSP.data = JSON の置き場、下)
  var root = '', langRoot = '';
  var doc = global.document;
  if (doc && doc.documentElement) {
    var h = doc.documentElement;
    if (h.hasAttribute('data-root')) {
      root = h.getAttribute('data-root') || '';
      langRoot = h.hasAttribute('data-lang-root') ? (h.getAttribute('data-lang-root') || '') : root;
    } else {
      var cs = doc.currentScript;
      var src = (cs && cs.getAttribute && cs.getAttribute('src')) || '';
      root = langRoot = src.replace(/js\/html\.js$/, '');
    }
  }
  global.SPSP.root = root;
  global.SPSP.langRoot = langRoot;
  // JSON (players / tournaments / history / data / meta.json / 一覧) の置き場。region/config.js の dataRoot (別ホスト = R2 など) が
  // あればそこ、無ければサイトのルート。config は html.js より後に読まれるので getter で引く。assets/ (worker など) は SPSP.root のまま
  if (!Object.getOwnPropertyDescriptor(global.SPSP, 'data')) {
    Object.defineProperty(global.SPSP, 'data', {
      get: function () { var site = global.SPSP.site; return (site && site.dataRoot) ? site.dataRoot : global.SPSP.root; },
      enumerable: true, configurable: true,
    });
  }

  // ページ間リンクの形 (2026-09-28)。config.cleanUrls (Cloudflare 配信のビルドが true にする) なら拡張子を落とす:
  //   'c/ranking.html' → 'c/ranking'、'index.html' → '' (ディレクトリ)、'vote.html' → 'vote'。false (素の静的配信) なら rel のまま。
  //   解説・投票・ブログなど既定言語にしかないページへは SPSP.root + pageHref(rel) で (英語の木には置かない)
  function pageHref(rel) {
    var site = global.SPSP && global.SPSP.site;
    if (!site || !site.cleanUrls) return rel;
    return String(rel).replace(/(^|\/)index\.html(?=$|[?#])/, '$1').replace(/\.html(?=$|[?#])/, '');
  }
  global.SPSP.pageHref = pageHref;
  global.pageHref = pageHref;   // テストの built() は named import をグローバルから引く
  api.pageHref = pageHref;

export default api;
export { escapeHtml, pageHref };
