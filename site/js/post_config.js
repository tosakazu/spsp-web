// @ts-check
// post_config.js — 投稿機能の設定値。**人間が実値を入れる唯一のファイル**。
//
// ここに秘匿値は置かない。client secret は GAS のスクリプトプロパティ / Worker の secrets のみ (INV-3)。
//
// 反映手順は docs/DEPLOY.md 参照。
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く

  // 従来 (GitHub Pages + GAS) の値。region/config.js に auth が無い配信 (旧 gh-pages) はこれ
  var LEGACY = {
    CLIENT_ID: '582',
    // GAS Web アプリの /exec URL。デプロイ ID を固定して使う (docs/DEPLOY.md)。
    GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycbzipXG5iAMHR7YwV-p9RALpxlAGWJcPizpfMbxX58nSNAm_H5CNkdN-diGN1QaBVwRzNQ/exec',
    // start.gg アプリに登録した redirect URI と **完全一致**していること。
    REDIRECT_URI: 'https://tosakazu.github.io/spsp/callback.html',
    CANONICAL_ORIGIN: 'https://tosakazu.github.io',
    CANONICAL_BASE: '/spsp/',
  };
  // Cloudflare 配信 (spsp.games、プレビュー): region/config.js の auth[配信元].clientId と canonical から組む。
  //   API = <origin>/api (同じ Worker)、redirect = <origin>/callback.html (地域に依らない。Worker が state の戻り先で /jp/ /na/ に振り分ける)、
  //   正規の場所 = canonical (ビルドの --canonical で配信先ごとに入る)
  /** @type {SpspSiteConfig | undefined} */
  var site = global.SPSP && global.SPSP.site;
  var cfg = LEGACY;
  var app = site && site.auth && site.canonical && site.auth[site.canonical.origin];   // 配信元ごとのアプリ (無ければ従来値)
  if (site && app && app.clientId) {
    cfg = {
      CLIENT_ID: String(app.clientId),
      GAS_ENDPOINT: site.canonical.origin + '/api',
      REDIRECT_URI: site.canonical.origin + '/callback.html',
      CANONICAL_ORIGIN: site.canonical.origin,
      CANONICAL_BASE: site.canonical.base || '/',
    };
  }

  global.SPSP_POST_CONFIG = {
    // start.gg アプリの Application ID (公開値)。
    CLIENT_ID: cfg.CLIENT_ID,
    // 認証 API (GAS の /exec、または Worker の /api。名前は互換のため GAS_ENDPOINT のまま)
    GAS_ENDPOINT: cfg.GAS_ENDPOINT,

    // 認可エンドポイント。api. が付かない点に注意 (token 側は api.start.gg)。
    // start.gg のアプリ設定にある URL 生成ツールの出力と食い違う場合はそちらを正とする。
    AUTHORIZE_URL: 'https://start.gg/oauth/authorize',

    REDIRECT_URI: cfg.REDIRECT_URI,

    SCOPE: 'user.identity',

    // 投稿ページを正規に配信している場所。ここ以外 (プレビュー配信など) では認証を開始せず、正規 URL へ案内する。
    CANONICAL_ORIGIN: cfg.CANONICAL_ORIGIN,
    CANONICAL_BASE: cfg.CANONICAL_BASE,

    // GAS 側の BODY_MAX と同じ数え方 (UTF-16 code unit)。
    BODY_MAX: 1000,

    // ダブルメイン圏の判定閾値 (characters[].pct のトップとの差)。
    // gas/config.gs の DOUBLE_MAIN_PCT_GAP と同じ値にすること (テストが検査する)。
    DOUBLE_MAIN_PCT_GAP: 0.20,
  };

export default global.SPSP_POST_CONFIG;
export const SCOPE = global.SPSP_POST_CONFIG.SCOPE;
export const CANONICAL_BASE = global.SPSP_POST_CONFIG.CANONICAL_BASE;
