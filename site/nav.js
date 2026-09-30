// @ts-check
// SPSP 共通ナビゲーション (template + dropdown). 各ページは
//   <div id="nav-root"></div>
//   <script src="<prefix>nav.js"></script>
// だけ書けばよい。CSS とイベントは self-injection。
import SPSPI18n from './js/i18n.js';
import SPSPLogo from './logo.js';
import './js/html.js';   // SPSP.root / SPSP.langRoot (ページが読んでいなくても nav が要る: 解説ページは html.js を読まない)
import './logo.js';   // ロゴ (SPSPLogo)。ES module になったので動的な <script> では読めない: 束ねる
import SpspLogin from './js/login.js';   // 人型アイコンのアカウントメニュー (start.gg でログイン。docs/login_design.md)

// ── Google Analytics 4 (gtag.js) ──
// 全ページに含まれる nav.js から inject することで <head> 編集を省略.
// 二重ロードガード: 既に gtag が読まれていれば skip.
//
// 動的ページ (= URL の query param でコンテンツが切り替わるページ) は
//   - /p/index.html?uid=<num>        プレイヤー
//   - /t/index.html?id=<num>         大会
//   - /c/ranking.html?char=<num>     使い手 (キャラ別)
//   - /local/ranking.html?series=<>  ローカルランキング
// で、コンテンツ名が async ロード後に決まるので nav.js 自動 pageview は skip し、
// ページ側で window.SPSPTrackPage(title, virtualPath) を呼ぶ形にする.
(function () {
  if (window.__SPSP_GA_LOADED) return;
  window.__SPSP_GA_LOADED = true;
  const SITE = window.SPSP && window.SPSP.site;   // region/config.js (先に読む)
  const GA_ID = (SITE && SITE.analytics && SITE.analytics.gaId) || 'G-TDKBJVDB4S';
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  (document.head || document.documentElement).appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());

  const _p = location.pathname;
  // .html の有無どちらも (spsp.games は拡張子なしの URL: c/ranking。旧サイトは c/ranking.html)
  const _isDynamic = (
    /\/p\/(index\.html)?$/.test(_p) ||
    /\/t\/(index\.html)?$/.test(_p) ||
    /\/c\/ranking(\.html)?$/.test(_p) ||
    /\/local\/ranking(\.html)?$/.test(_p)
  );
  // 表示言語 (閲覧者が切り替える) と表示地域 (デプロイ単位) は別の軸。どちらも全イベントに付ける。
  // GA4 側で カスタム ディメンション (イベント スコープ) として ui_lang と site_region を登録すること。
  const UI_LANG = (SPSPI18n && SPSPI18n.lang) || (SITE && SITE.defaultLang) || 'ja';
  const SITE_REGION = (SITE && SITE.region) || 'JP';
  window.gtag('config', GA_ID, { send_page_view: !_isDynamic, ui_lang: UI_LANG, site_region: SITE_REGION });

  // ページ側からコンテンツロード後に呼ぶ helper.
  //   title:       GA4 「ページ タイトル」に出る (= ユーザー表示用名)
  //   virtualPath: GA4 「ページ パス」に出る (= 例: /p/uid12345). 省略時は実 URL.
  window.SPSPTrackPage = function (title, virtualPath) {
    const path = virtualPath || (location.pathname + location.search);
    window.gtag('event', 'page_view', {
      page_title: title || document.title,
      page_location: location.origin + path,
      page_path: path,
    });
  };
})();

(function () {
  const scriptEl = document.currentScript || (function () {
    const s = document.getElementsByTagName('script');
    return s[s.length - 1];
  })();
  const relSrc = scriptEl ? scriptEl.getAttribute('src') || '' : '';
  // 文言は js/i18n.js + i18n/<lang>.js (先に読む)。無ければキーをそのまま出す
  const t = (SPSPI18n && SPSPI18n.t) || ((k) => k);
  const SITE = window.SPSP && window.SPSP.site;
  // "nav.js" → "./", "../nav.js" → "../", "../../nav.js" → "../../"
  // ページ間リンクの起点はページ木のルート (SPSP.langRoot: 言語別ページは dist/en/… に居る)、資産 (logo.css) はサイトのルート (SPSP.root)。
  // 無ければ (古い読み方) この script の src から
  const inferred = relSrc.replace(/nav\.js$/, '') || './';
  const S = window.SPSP || {};
  const prefix = (S.langRoot != null) ? (S.langRoot || './') : inferred;        // ルート直下では './' (以前と同じ href)
  const assetPrefix = (S.root != null) ? (S.root || './') : inferred;
  /** ページ間リンクの形 (js/html.js SPSP.pageHref。読めない環境では .html のまま) @param {string} rel */
  const pageHref = (rel) => (typeof S.pageHref === 'function' ? S.pageHref(rel) : rel);
  const p = location.pathname;

  function currentPage() {   // .html の有無どちらも (拡張子なしの URL)
    if (/\/overview(\.html)?$/.test(p)) return 'overview';
    if (/\/details(\.html)?$/.test(p))  return 'details';
    if (/\/eval(\.html)?$/.test(p))     return 'eval';
    if (/\/math(\.html)?$/.test(p))     return 'math';
    if (/\/seed-upload\//.test(p))   return 'seed-upload';
    if (/\/class\//.test(p))         return 'class';
    if (/\/seed\//.test(p))          return 'seed';
    if (/\/priority\//.test(p))      return 'priority';
    if (/\/local\/ranking(\.html)?$/.test(p)) return 'local-ranking';
    if (/\/local\//.test(p))         return 'local-series';
    if (/\/c\/ranking(\.html)?$/.test(p)) return 'char-ranking';
    if (/\/c\//.test(p))             return 'char-list';
    if (/\/pref\/ranking(\.html)?$/.test(p)) return 'pref-ranking';
    if (/\/pref\//.test(p))          return 'pref-list';
    if (/\/events\//.test(p))        return 'events';
    if (/\/sim\//.test(p))           return 'sim';
    if (/\/blog\//.test(p))          return 'blog';
    if (/\/news\//.test(p))          return 'news';
    if (/\/vote(\.html)?$/.test(p))     return 'vote';
    if (/\/p\//.test(p))             return 'player';
    if (/\/t\//.test(p))             return 'tournament';
    return 'ranking';
  }
  const cur = currentPage();
  const isRanking = cur === 'ranking' || cur === 'local-series' || cur === 'local-ranking' || cur === 'char-list' || cur === 'char-ranking' || cur === 'pref-list' || cur === 'pref-ranking' || cur === 'events' || cur === 'sim';
  const isSeeding = cur === 'seed' || cur === 'seed-upload' || cur === 'priority' || cur === 'class';
  const isMethod  = ['overview', 'details', 'eval', 'math', 'blog'].includes(cur);

  // 言語の切替 (日本語 ⇄ English)。同じ URL に ?lang=<言語> を付けたもの (js/lang_boot.js が読んで覚える。既定言語へ戻すときも明示する)。
  // config.langs が 1 つなら出さない。rel=nofollow: ?lang 付きの URL は検索エンジンに辿らせない (canonical は ?lang 無し)
  function langSwitchHtml() {
    const langs = (SITE && SITE.langs) || ['ja'];
    if (langs.length < 2 || !SPSPI18n) return '';
    if (document.documentElement.hasAttribute('data-default-lang-only')) return '';   // 既定言語にしか無いページ (解説・投票・ブログ)。他言語版は無い
    const cur = SPSPI18n.lang;
    /** @param {string} l */
    const hrefFor = (l) => {
      const u = new URL(location.href);
      u.searchParams.set('lang', l);
      return u.pathname + u.search + u.hash;
    };
    // いま表示している言語を強調して並べ、他の言語はリンク (狭い画面では 2 文字: JA / EN)
    const label = (l) => `<span class="lang-full">${t('lang.' + l)}</span><span class="lang-short">${t('lang.short.' + l)}</span>`;
    return `<div class="nav-lang" aria-label="${t('nav.lang_aria')}">` +
      langs.map((l) => l === cur
        ? `<span class="cur" aria-current="true" title="${t('lang.' + l)}">${label(l)}</span>`
        : `<a href="${hrefFor(l)}" hreflang="${l}" rel="nofollow" title="${t('lang.' + l)}">${label(l)}</a>`).join('') +
      '</div>';
  }
  // 地域版の切替 (日本版 ⇄ 北米版)。config の regions に URL が入っている他地域だけ出す (無ければ何も出さない)
  function regionSwitchHtml() {
    const regions = (SITE && SITE.regions) || {};
    const others = Object.keys(regions).filter((code) => code !== (SITE && SITE.region) && regions[code]);
    if (!others.length) return '';
    return `<div class="nav-region" aria-label="${t('nav.region_aria')}">` +
      others.map((code) => `<a href="${regions[code]}" rel="alternate" hreflang="x-default" data-region="${code}">${t('region.' + code)}</a>`).join('') +
      '</div>';
  }
  const html =
    `<nav class="nav">
      <span class="brand"><a href="${prefix}${pageHref('index.html')}" aria-label="${t('nav.home_aria')}"><span class="spsp-brand-mark"></span></a></span>
      <div class="nav-dropdown${isRanking ? ' has-current' : ''}">
        <button type="button" class="nav-trigger" aria-haspopup="true" aria-expanded="false">${t('nav.ranking')}<span class="caret">▾</span></button>
        <div class="nav-menu" role="menu">
          <a href="${prefix}${pageHref('index.html')}"${cur === 'ranking' ? ' class="current"' : ''} role="menuitem">${t('nav.ranking.national')}</a>
          <a href="${prefix}local/"${cur === 'local-series' || cur === 'local-ranking' ? ' class="current"' : ''} role="menuitem">${t('nav.ranking.local')}</a>
          <a href="${prefix}c/"${cur === 'char-list' || cur === 'char-ranking' ? ' class="current"' : ''} role="menuitem">${t('nav.ranking.char')}</a>
          <a href="${prefix}pref/"${cur === 'pref-list' || cur === 'pref-ranking' ? ' class="current"' : ''} role="menuitem">${t('nav.ranking.pref')}</a>
          <a href="${prefix}events/"${cur === 'events' ? ' class="current"' : ''} role="menuitem">${t('nav.ranking.events')}</a>
          <a href="${prefix}sim/"${cur === 'sim' ? ' class="current"' : ''} role="menuitem">${t('nav.ranking.sim')}</a>
        </div>
      </div>
      <div class="nav-dropdown${isSeeding ? ' has-current' : ''}">
        <button type="button" class="nav-trigger" aria-haspopup="true" aria-expanded="false">${t('nav.seeding')}<span class="caret">▾</span></button>
        <div class="nav-menu" role="menu">
          <a href="${prefix}seed/"${cur === 'seed' ? ' class="current"' : ''} role="menuitem">${t('nav.seeding.seed')}</a>
          <a href="${prefix}seed-upload/"${cur === 'seed-upload' ? ' class="current"' : ''} role="menuitem">${t('nav.seeding.upload')}</a>
          <a href="${prefix}priority/"${cur === 'priority' ? ' class="current"' : ''} role="menuitem">${t('nav.seeding.priority')}</a>
          <a href="${prefix}class/"${cur === 'class' ? ' class="current"' : ''} role="menuitem">${t('nav.seeding.class')}</a>
        </div>
      </div>
      <div class="nav-dropdown${isMethod ? ' has-current' : ''}">
        <button type="button" class="nav-trigger" aria-haspopup="true" aria-expanded="false">${t('nav.method')}<span class="caret">▾</span></button>
        <div class="nav-menu" role="menu">
          <a href="${assetPrefix}${pageHref('overview.html')}"${cur === 'overview' ? ' class="current"' : ''} role="menuitem">${t('nav.method.overview')}</a>
          <a href="${assetPrefix}${pageHref('details.html')}"${cur === 'details' ? ' class="current"' : ''} role="menuitem">${t('nav.method.details')}</a>
          <a href="${assetPrefix}${pageHref('eval.html')}"${cur === 'eval' ? ' class="current"' : ''} role="menuitem">${t('nav.method.eval')}</a>
          <a href="${assetPrefix}${pageHref('math.html')}"${cur === 'math' ? ' class="current"' : ''} role="menuitem">${t('nav.method.math')}</a>
          ${(SITE ? SITE.features.blog : /spsp\.games$/.test(location.hostname)) ? `<a href="${assetPrefix}blog/"${cur === 'blog' ? ' class="current"' : ''} role="menuitem">${t('nav.method.blog')}</a>` : ''}
        </div>
      </div>
      <div class="nav-dropdown nav-news${cur === 'news' ? ' has-current' : ''}">
        <button type="button" class="nav-trigger nav-news-trigger${cur === 'news' ? ' current' : ''}" aria-haspopup="true" aria-expanded="false" aria-label="${t('nav.news_aria')}">
          <span class="nav-news-bell">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
          </span>
        </button>
        <div class="nav-news-panel" role="menu">
          <a class="news-section" id="__nav_news_today_section" href="${prefix}news/?filter=auto">
            <div class="news-section-title">${t('nav.news.auto')}</div>
            <div class="news-section-body" id="__nav_news_today">${t('nav.news.loading')}</div>
          </a>
          <a class="news-section" id="__nav_news_announce_section" href="${prefix}news/?filter=announcement">
            <div class="news-section-title">${t('nav.news.announcement')}</div>
            <div class="news-section-body" id="__nav_news_announce">${t('nav.news.loading')}</div>
          </a>
          <a class="news-section-foot" href="${prefix}news/">${t('nav.news.all')}</a>
        </div>
      </div>
      <div class="nav-dropdown nav-user${cur === 'vote' ? ' has-current' : ''}">
        <button type="button" class="nav-trigger nav-user-trigger${cur === 'vote' ? ' current' : ''}" aria-haspopup="true" aria-expanded="false" aria-label="${t('nav.user_aria')}">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </button>
        <div class="nav-menu" role="menu" id="__nav_user_menu">
          <a href="${assetPrefix}${pageHref('vote.html')}"${cur === 'vote' ? ' class="current"' : ''} role="menuitem">${t('nav.user.vote')}</a>
        </div>
      </div>
      <span class="nav-tail"><span class="meta" id="meta-info"></span>${langSwitchHtml()}${regionSwitchHtml()}</span></nav>`;

  // Inject styles (idempotent)
  if (!document.getElementById('__spsp_nav_css')) {
    // ロゴのスタイル (ヘッダー + 読み込み中オーバーレイ共通)
    if (!document.getElementById('__spsp_logo_css')) {
      const lcss = document.createElement('link');
      lcss.id = '__spsp_logo_css';
      lcss.rel = 'stylesheet';
      lcss.href = assetPrefix + 'logo.css';
      document.head.appendChild(lcss);
    }

    const style = document.createElement('style');
    style.id = '__spsp_nav_css';
    style.textContent = `
      :root { --nav-height: 42px; }
      html { scroll-padding-top: var(--nav-height); }
      .nav { background:#fff; border-bottom:1px solid #e5e7eb;
             padding:6px 24px; display:flex; gap:24px; align-items:center;
             position:sticky; top:0; z-index:30;
             font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans",sans-serif;
             line-height:1.2; }
      .nav a { color:#6b7280; text-decoration:none; font-size:14px;
               padding:4px 8px; border-radius:4px; }
      .nav a:hover { color:#111827; background:#f3f4f6; }
      .nav a.current { color:#dc2626; background:#f3f4f6; }
      .nav .brand { font-size:16px; color:#111827; font-weight:600; margin-right:10px; }
      .nav .brand a { color:#111827; font-size:16px; padding:0; font-weight:600; }
      .nav .brand a:hover { background:transparent; }
      .nav .meta { margin-left:auto; color:#9ca3af; font-size:12px; }
      .nav-tail { display:contents; }   /* PC では中身 (meta / 言語 / 地域) をそのまま nav に並べる。狭い画面では 2 行目の入れ物 */
      .nav-dropdown { position:relative; }
      .nav-trigger { cursor:pointer; user-select:none;
                     color:#6b7280; background:transparent; border:none;
                     font-size:14px; padding:4px 8px; border-radius:4px;
                     font-family:inherit;
                     display:inline-flex; align-items:center; gap:2px; }
      .nav-trigger:hover { color:#111827; background:#f3f4f6; }
      .nav-dropdown.has-current > .nav-trigger { color:#dc2626; background:#f3f4f6; }
      .caret { font-size:10px; opacity:.7; }
      .nav-menu { display:none; position:absolute; top:100%; left:0;
                  background:#fff; border:1px solid #e5e7eb;
                  border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,.08);
                  min-width:200px; padding:4px 0; z-index:31; }
      .nav-menu a { display:block; padding:7px 14px; border-radius:0; font-size:13px; }
      .nav-menu a:hover { background:#f3f4f6; }
      .nav-menu a.current { color:#dc2626; background:#fef3c7; }
      /* クリックで開閉. hover による自動展開は無効 (= 閉じる挙動とぶつかるため). */
      .nav-dropdown.open .nav-menu { display:block; }
      /* News dropdown */
      .nav-news .nav-news-trigger { color:#6b7280; display:inline-flex; align-items:center;
                                     padding:4px 8px; }
      .nav-news.has-current .nav-news-trigger { color:#dc2626; background:#f3f4f6; }
      .nav-news-bell { position:relative; display:inline-flex; line-height:0; }
      .nav-news-bell.has-unread::before { content:''; position:absolute; top:-2px; left:-2px;
                                            width:7px; height:7px; background:#fca5a5;
                                            border-radius:50%; }
      /* User dropdown (= 選手本人が使う操作をまとめる). ベルと同じ見た目に揃える. */
      .nav-user .nav-user-trigger { color:#6b7280; display:inline-flex; align-items:center;
                                    line-height:0; padding:4px 8px; }
      .nav-user.has-current .nav-user-trigger { color:#dc2626; background:#f3f4f6; }
      .nav-lang, .nav-region { display:inline-flex; gap:6px; }
      .nav-lang { gap:0; border:1px solid #d1d5db; border-radius:999px; overflow:hidden; }
      /* 2 区画 (表示中 = span、他 = a) は同じ箱の作りにする */
      /* 2 区画は同じフォント・同じ箱 (lang 属性を付けるとフォントが変わって字の位置がずれる) */
      .nav .nav-lang > a, .nav .nav-lang > span { display:flex; align-items:center; font-family:inherit; font-size:11px; line-height:1.2; padding:2px 8px; color:#6b7280; text-decoration:none; border-radius:0; }
      .nav .nav-lang > .cur { color:#fff; background:#374151; font-weight:600; }
      .nav-lang { margin-left:auto; }
      .nav-lang + .nav-region { margin-left:6px; }
      .nav-region:first-of-type { margin-left:auto; }
      .nav-lang a:hover { color:#111827; background:#f3f4f6; }
      .nav-lang .lang-short { display:none; }   /* 狭い画面では 2 文字 (EN / JA) にしてヘッダを 1 行に収める */
      .nav-region a { font-size:11px; color:#6b7280; border:1px solid #d1d5db; border-radius:999px; padding:2px 8px; text-decoration:none; }
      .nav-region a:hover { color:#111827; background:#f3f4f6; }
      /* このアイコンは nav の一番右にあるので、メニューは左揃えだと画面外へ
         はみ出して切れる。アイコンの右端に揃えて左へ開く。 */
      .nav-user .nav-menu { min-width:160px; left:auto; right:0;
                            max-width:calc(100vw - 24px); }
      /* アカウントメニュー: 項目はほかのメニューのリンクと同じ見た目 (色も同じ灰色)。
         名前は押せないので見出しとして: 濃い字・太字、下に細い線 */
      .nav-user-name { padding:7px 14px 6px; margin-bottom:4px; font-size:13px; font-weight:600; color:#111827;
                       border-bottom:1px solid #f3f4f6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .nav-user .nav-menu button { display:block; width:100%; text-align:left; background:none; border:0; border-radius:0;
                                   font:inherit; font-size:13px; padding:7px 14px; color:#6b7280; cursor:pointer; }
      .nav-user .nav-menu button:hover { color:#111827; }
      /* ログイン・ログアウトは誤タップしないよう、一番下で上に線を引いて少し離す */
      .nav-user .nav-menu .nav-logout, .nav-user .nav-menu .nav-login { margin-top:6px; border-top:1px solid #f3f4f6; padding-top:9px; }
      .nav-user .nav-menu button:hover { background:#f3f4f6; }
      .nav-news-panel { display:none; position:absolute; top:100%; right:0;
                        background:#fff; border:1px solid #e5e7eb;
                        border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,.08);
                        width:340px; max-width:90vw; padding:10px 0; z-index:31; }
      .nav-news.open .nav-news-panel { display:block; }
      a.news-section { display:block; padding:8px 14px; text-decoration:none;
                       color:inherit; transition:background-color .12s; border-radius:0; }
      a.news-section:hover { background:#fef2f2; }
      a.news-section + a.news-section { border-top:1px solid #f3f4f6; }
      .news-section-title { font-size:11px; color:#6b7280; font-weight:600;
                             margin-bottom:6px; letter-spacing:0.05em; }
      a.news-section:hover .news-section-title { color:#dc2626; }
      .news-section-body { font-size:12px; color:#111827; line-height:1.55; }
      .news-section-body .news-item { padding:3px 0; }
      .news-section-body .news-item .date { color:#9ca3af; font-size:10px;
                                              font-family:ui-monospace,monospace; margin-right:6px; }
      .news-section-body .empty { color:#9ca3af; font-size:11px; }
      a.news-section-foot { display:block; padding:8px 14px; border-top:1px solid #f3f4f6;
                            text-align:right; text-decoration:none; color:#dc2626;
                            font-size:11px; transition:background-color .12s; }
      a.news-section-foot:hover { background:#fef2f2; text-decoration:underline; }
      @media (max-width:720px) {
        .nav { padding:4px 12px; gap:8px; flex-wrap:wrap; }
        .nav .brand { font-size:14px; margin-right:8px; }
        .nav .brand a { font-size:14px; }
        .nav a, .nav-trigger, .nav-user .nav-menu button { padding:3px 6px; font-size:12px; }   /* メニューのボタン (ログイン・ログアウト) もリンクと同じ */
        .nav-user-name { padding:4px 6px; font-size:12px; }
        /* 2 行目 = バージョン行 (meta) と言語 / 地域ピル。1 行目はブランドとメニューだけ */
        .nav-tail { display:flex; flex-basis:100%; align-items:center; gap:6px; }
        .nav .meta { width:auto; flex:1 1 auto; margin-left:0; font-size:10px; }
        .nav-lang, .nav-region { margin-left:0; }
        /* ピルはバージョン行の文字 (10px × 1.2 = 12px) と同じ高さに収める (枠線 1px ×2 込み) → 行の高さは元のまま */
        .nav .nav-lang > a, .nav .nav-lang > span, .nav .nav-region a { padding:0 5px; font-size:10px; line-height:10px; }
        .nav-lang .lang-full { display:none; }
        .nav-lang .lang-short { display:inline; }
        .nav-menu { min-width:160px; }
        /* News panel: 画面右上に固定し viewport からはみ出さないように.
           top は開くときに JS がアイコンの実測位置へ寄せる (placePanel)。
           ここの値はその前の 1 フレーム用。 */
        .nav-news-panel { position:fixed; top:calc(var(--nav-height) + 2px);
                          right:8px; left:auto;
                          width:auto; max-width:calc(100vw - 16px); }
        /* 選手メニューも同じ扱い. nav が 2 行に折り返しても被らないよう、
           実測した nav の高さ (--nav-height) の下に出す. */
        .nav-user .nav-menu { position:fixed; top:calc(var(--nav-height) + 2px);
                              right:8px; left:auto; max-width:calc(100vw - 16px); }
      }
      @media (max-width:380px) {
        .nav .brand, .nav .brand a { font-size:13px; }
        .nav a, .nav-trigger, .nav-user .nav-menu button { font-size:11px; }
        .nav-user-name { font-size:11px; }
      }
    `;
    document.head.appendChild(style);
  }

  // Inject HTML as direct child of body (= sticky に必要な full-height 親).
  // #nav-root placeholder があれば nav 要素で REPLACE (= 中に入れず置換).
  // host の中に入れると host = nav の高さしか無くなり sticky の親がスクロール
  // 空間を持たないため、scroll 時に nav 含めて画面外に出てしまう.
  function inject() {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    const navEl = tmp.firstElementChild;
    if (!navEl) return;
    const host = document.getElementById('nav-root');
    if (host && host.parentNode) {
      host.parentNode.replaceChild(navEl, host);
    } else {
      document.body.insertBefore(navEl, document.body.firstChild);
    }
    mountBrandLogo(navEl);
    measureNavHeight(navEl);
    renderAccount();
  }

  // ── アカウントメニュー (人型アイコン) ──
  //   ログアウト中: キャラ投票 / (線) start.gg でログイン
  //   ログイン中:   人型が塗りつぶしになり、名前 (見出し)・マイページ・カードを編集・キャラ投票・ログアウト
  //   ログインできない場所 (API の無い ConoHa のプレビュー) では「ログイン」を出さない
  const USER_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const USER_SVG_IN = USER_SVG.replace('fill="none"', 'fill="currentColor"');   // ログイン中: 同じ人型を塗りつぶし
  function renderAccount() {
    const menu = document.getElementById('__nav_user_menu');
    const trigger = document.querySelector('.nav-user-trigger');
    if (!menu || !trigger) return;
    // ログインの部品が読めない環境 (テストの vm など) ではログアウト中の表示にする
    const sess = SpspLogin ? SpspLogin.session() : null;
    const cls = (/** @type {string} */ k) => (cur === k ? ' class="current"' : '');
    const vote = `<a href="${assetPrefix}${pageHref('vote.html')}"${cls('vote')} role="menuitem">${t('nav.user.vote')}</a>`;
    if (!sess) {
      trigger.innerHTML = USER_SVG;
      menu.innerHTML = vote + (SpspLogin && SpspLogin.apiAvailable() ? `<button type="button" class="nav-login" role="menuitem">${t('nav.user.login')}</button>` : '');   // ログインはログアウトと同じく一番下
      return;
    }
    const name = sess.user.gamerTag || sess.user.slug || String(sess.user.id);
    const uid = encodeURIComponent(String(sess.user.id));
    trigger.innerHTML = USER_SVG_IN;
    menu.innerHTML = `<div class="nav-user-name">${escHTML(name)}</div>` +
      `<a href="${prefix}${pageHref('me.html')}" role="menuitem">${t('nav.user.mypage')}</a>` +   // 自分のプレイヤーページへの共通リンク
      `<a href="${prefix}${pageHref('p/edit.html')}?uid=${uid}" role="menuitem">${t('nav.user.card_edit')}</a>` +
      vote +
      `<button type="button" class="nav-logout" role="menuitem">${t('nav.user.logout')}</button>`;
  }
  if (SpspLogin) {
    SpspLogin.onChange(renderAccount);
    SpspLogin.verify().then(renderAccount).catch(() => {});
  }
  document.addEventListener('click', (e) => {
    const el = /** @type {Element} */ (e.target);
    const login = el.closest && el.closest('.nav-login');
    if (login && SpspLogin) {
      /** @type {HTMLButtonElement} */ (login).disabled = true;
      SpspLogin.startLogin().then(ok => { if (!ok) /** @type {HTMLButtonElement} */ (login).disabled = false; });
      return;
    }
    if (el.closest && el.closest('.nav-logout') && SpspLogin) { SpspLogin.logout(); renderAccount(); }
  });

  // ブランド枠にロゴを組み立てる。logo.js は import で束ねてあるので通常は即 put()。無ければ (古い読み方) 動的に読む。
  // 旧:
  // 読めたら組む / 読めなければ従来どおり文字で出す (ヘッダーが空欄になるより良い)。
  function mountBrandLogo(navEl) {
    const slot = (navEl || document).querySelector('.spsp-brand-mark');
    if (!slot) return;
    const put = () => {
      if (SPSPLogo) {
        SPSPLogo.mountHeader(slot);
        // 「読み込み中…」と書いてある枠をロゴに差し替える (各ページ共通)
        SPSPLogo.autoInline();
      } else {
        slot.textContent = 'SPSP';
      }
    };
    if (SPSPLogo) { put(); return; }
    const sc = document.createElement('script');
    sc.src = assetPrefix + 'logo.js';
    sc.onload = put;
    sc.onerror = () => { slot.textContent = 'SPSP'; };
    document.head.appendChild(sc);
  }
  // nav 高さを CSS 変数 (--nav-height) として設定. sticky thead が nav の下に
  // ぴったり収まるよう、ranking-table.css 等で `top: var(--nav-height)` を参照可能.
  // mobile で wrap して 2 行になったり, news ticker で増減した場合にも追従.
  function measureNavHeight(navEl) {
    if (!navEl) navEl = document.querySelector('.nav');
    if (!navEl) return;
    const apply = () => {
      const h = Math.round(navEl.getBoundingClientRect().height);
      if (h > 0) document.documentElement.style.setProperty('--nav-height', `${h}px`);
    };
    apply();
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(apply);
      ro.observe(navEl);
    } else {
      window.addEventListener('resize', apply);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  // Load news.json into news dropdown
  function escHTML(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  const LS_OPENED = 'spsp_news_last_opened';
  let __latestNewsTs = 0;  // 直近 fetch で観測した最新 entry ts. refresh 時に再評価.
  function readTs() {
    const keys = [LS_OPENED, 'spsp_ticker_dismissed_news-ticker-auto', 'spsp_ticker_dismissed_news-ticker-ann'];
    let m = 0;
    for (const k of keys) {
      try { m = Math.max(m, parseInt(localStorage.getItem(k) || '0', 10) || 0); } catch (e) {}
    }
    return m;
  }
  function refreshUnreadBadge() {
    const bell = document.querySelector('.nav-news-bell');
    if (!bell) return;
    if (__latestNewsTs > readTs()) bell.classList.add('has-unread');
    else bell.classList.remove('has-unread');
  }
  function markNewsOpened() {
    try { localStorage.setItem(LS_OPENED, String(Date.now())); } catch (e) {}
    refreshUnreadBadge();
  }
  // index.html の ticker × からも呼べるよう公開.
  window.SPSPNews = { refreshUnreadBadge };
  function loadNews() {
    const elT = document.getElementById('__nav_news_today');
    const elA = document.getElementById('__nav_news_announce');
    const secT = document.getElementById('__nav_news_today_section');
    const secA = document.getElementById('__nav_news_announce_section');
    if (!elT || !elA) return;
    // 表示期間: 投稿時刻から n.days 日 (省略時 1 日) 経過するまで.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const entryTs = (n) => {
      if (n.datetime) { const t = new Date(n.datetime).getTime(); return isNaN(t) ? 0 : t; }
      if (n.date) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(n.date);
        if (m) return new Date(+m[1], +m[2]-1, +m[3]).getTime();
      }
      return 0;
    };
    const entryWindowMs = (n) => Math.max(1, Number(n.days) || 1) * DAY_MS;
    const withinWindow = (n) => { const t = entryTs(n); return t > 0 && (nowMs - t) <= entryWindowMs(n); };
    fetch(assetPrefix + 'news.json').then(r => r.json()).then(data => {   // お知らせはフロント (spsp-web の site/news.json) が持ち、サイトと一緒に配信する (2026-09-29)
      const today = (data.auto_news || []).filter(withinWindow);
      const ann = (data.announcements || []).filter(withinWindow);
      // 空セクションは非表示 (= ない時は出さない)
      if (today.length) {
        elT.innerHTML = today.map(n => `<div class="news-item"><span class="date">${escHTML(n.date)}</span>${escHTML(n.title)}</div>`).join('');
        if (secT) secT.style.display = '';
      } else {
        if (secT) secT.style.display = 'none';
      }
      if (ann.length) {
        elA.innerHTML = ann.map(n => `<div class="news-item"><span class="date">${escHTML(n.date)}</span>${escHTML(n.title)}</div>`).join('');
        if (secA) secA.style.display = '';
      } else {
        if (secA) secA.style.display = 'none';
      }
      // 未読判定: 24h 以内 entry の最新 ts > 既読 ts なら赤丸表示.
      // 既読 ts = max(news 開いた時刻, ticker × タップ時刻 auto/ann).
      // entryTs は now で clamp (= future 予約 entry も「現在発信」扱いで既読化できるように).
      __latestNewsTs = Math.max(0, ...today.concat(ann).map(n => Math.min(entryTs(n), nowMs)));
      refreshUnreadBadge();
    }).catch(() => {
      if (secT) secT.style.display = 'none';
      if (secA) secA.style.display = 'none';
    });
    // /news/ ページに居る場合は到達時点で既読扱い.
    if (cur === 'news') markNewsOpened();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadNews);
  } else {
    setTimeout(loadNews, 0);
  }

  // 全ページ共通の meta 表示 (= "最終更新 YYYY-MM-DD HH:MM · vXXX") を nav の右側に出す.
  // 個別ページが上書き設定する場合もあるため、すでに textContent があれば触らない.
  function populateMetaInfo() {
    const navMeta = document.getElementById('meta-info');
    if (!navMeta || navMeta.textContent.trim()) return;
    const SITE_VERSION_FULL = '__SITE_VERSION__';
    const versionShort = SITE_VERSION_FULL.split(' · ')[0] || SITE_VERSION_FULL;
    // versionShort が "__SITE_VERSION__" のまま (= ローカル未 stamp) なら version 部分省略.
    const isStamped = !versionShort.includes('SITE_VERSION');
    // meta.json はデータの置き場 (config.dataRoot = data.spsp.games など。無ければサイトのルート)
    fetch((S.data != null ? S.data : assetPrefix) + 'meta.json').then(r => r.ok ? r.json() : null).then(meta => {
      if (!meta) {
        if (isStamped) navMeta.textContent = versionShort;
        return;
      }
      const genTime = String(meta.generated_at || meta.eval_date || '').split('.')[0].replace('T', ' ');
      navMeta.textContent = isStamped ? t('nav.meta.updated_version', { time: genTime, version: versionShort }) : t('nav.meta.updated', { time: genTime });
    }).catch(() => {
      if (isStamped) navMeta.textContent = versionShort;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateMetaInfo);
  } else {
    setTimeout(populateMetaInfo, 0);
  }

  // ── アイコンのメニュー (お知らせ / 選手向け) の位置合わせ ──
  //
  // この 2 つは幅が広くて右端にあるため、狭い画面では CSS で position:fixed に
  // している。ただし CSS だけだと上端を「nav 全体の下」にしか揃えられず、
  // モバイルでは meta 行が折り返して nav が 2 行になるので、アイコンから
  // 離れた低い位置に出てしまう。開くときにアイコンの実測位置へ寄せる。
  //
  // 対象はこの 2 つだけ (= CSS で fixed にしているもの)。ほかのメニューは
  // absolute のままで、もともとボタンの真下に出ている。
  const NARROW_PX = 720;   // nav.js の @media (max-width:720px) と同じ値にすること
  const ICON_DROPDOWNS = '.nav-news, .nav-user';

  function panelOf(drop) {
    return drop.querySelector('.nav-menu, .nav-news-panel');
  }
  function resetPlacement(drop) {
    const panel = drop.matches(ICON_DROPDOWNS) ? panelOf(drop) : null;
    if (!panel) return;
    panel.style.top = '';
    panel.style.left = '';
    panel.style.right = '';
  }
  function placePanel(drop) {
    if (!drop.matches(ICON_DROPDOWNS)) return;
    const panel = panelOf(drop);
    const trigger = drop.querySelector('.nav-trigger');
    if (!panel || !trigger) return;
    resetPlacement(drop);
    if (window.innerWidth > NARROW_PX) return;   // 広い画面は CSS (absolute) のまま
    const t = trigger.getBoundingClientRect();
    if (!t.height) return;                       // 測れないなら CSS に任せる
    panel.style.top = Math.round(t.bottom + 4) + 'px';
    // まずアイコンの右端に揃え、画面右からはみ出さないところまで戻す
    panel.style.right = Math.max(8, Math.round(window.innerWidth - t.right)) + 'px';
    // 幅が広くて左にはみ出すなら、右揃えをやめて左端に寄せる
    if (panel.getBoundingClientRect().left < 8) {
      panel.style.right = 'auto';
      panel.style.left = '8px';
    }
  }
  // 画面幅が変わったら開いているものを測り直す (= 回転・URL バーの伸縮)
  window.addEventListener('resize', () => {
    document.querySelectorAll('.nav-dropdown.open').forEach(placePanel);
  });

  // 言語切替のリンクは、押した時点の URL から作り直す (ページが描画後に URL を書き換えることがある: ?pref=東京都 → ?pref=tokyo など)
  /** @param {Event} e */
  const refreshLangHref = (e) => {
    const a = /** @type {Element | null} */ (e.target instanceof Element ? e.target.closest('.nav-lang a[hreflang]') : null);
    if (!a) return;
    const u = new URL(location.href);
    u.searchParams.set('lang', a.getAttribute('hreflang') || '');
    a.setAttribute('href', u.pathname + u.search + u.hash);
  };
  for (const ev of ['pointerdown', 'focusin', 'click']) document.addEventListener(ev, refreshLangHref, true);

  // Click-to-toggle dropdown (mobile-friendly).
  document.addEventListener('click', (e) => {
    const target = /** @type {Element} */ (e.target);
    const trigger = target.closest('.nav-trigger');
    if (trigger) {
      const drop = /** @type {Element} */ (trigger.closest('.nav-dropdown'));   // .nav-trigger は必ず .nav-dropdown の中

      const wasOpen = drop.classList.contains('open');
      document.querySelectorAll('.nav-dropdown.open').forEach(d => {
        d.classList.remove('open');
        resetPlacement(d);
        const t = d.querySelector('.nav-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
      if (!wasOpen) {
        drop.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        placePanel(drop);
        if (drop.classList.contains('nav-news')) markNewsOpened();
      }
      e.stopPropagation();
      return;
    }
    if (!target.closest('.nav-menu') && !target.closest('.nav-news-panel')) {
      document.querySelectorAll('.nav-dropdown.open').forEach(d => {
        d.classList.remove('open');
        resetPlacement(d);
        const t = d.querySelector('.nav-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    }
  });
})();

export const SPSPTrackPage = window.SPSPTrackPage;   // GA の仮想 pageview (動的ページが読み込み後に呼ぶ)
export const SPSPNews = window.SPSPNews;
export default { SPSPTrackPage, SPSPNews };
