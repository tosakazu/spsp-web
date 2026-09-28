// regions/JP/config.js — 日本版のサイト設定 (地域・言語・配信先)。docs/frontend_i18n_review.md §4.2 の契約。
// 地域 (どのランキングか) はデプロイ単位、言語 (UI 文言) は閲覧者が切り替えられる、という分け方。
// ページは region/config.js (= 配信する地域の regions/<REGION>/ への symlink) として読む。キーの集合は全地域で同じ (tests/meta/regions.test.cjs)。
//   window.SPSP.site (= window.SPSPSite)
// 読み込み順: js/html.js の後、js/i18n.js と nav.js より前 (nav.js が features / analytics を読む)。
(function (global) {
  'use strict';
  var host = (global.location && global.location.hostname) || '';
  var site = {
    region: 'JP',
    langs: ['ja', 'en'],           // 用意している UI 言語 (site/i18n/<lang>.js)。ビルドは言語ごとに静的 HTML を出す (既定言語はルート、他は <lang>/)
    defaultLang: 'ja',
    timeZone: 'Asia/Tokyo',        // 表示用。データの日付は地域の暦日
    utcOffset: '+09:00',
    cleanUrls: false,              // ページ間リンクの拡張子を落とす ('c/ranking.html' → 'c/ranking')。Cloudflare 配信のビルド (--clean-urls) が true にする (js/html.js pageHref)
    dataRoot: '',                  // ビルド出力の場所 (同じルート)。別ホストに置くなら URL
    canonical: { origin: 'https://tosakazu.github.io', base: '/spsp/' },
    regions: { JP: '', NA: '' },   // 各地域版の URL (nav の切替に出す。'' = 未定 / 出さない。例: 'https://spsp.games/na/')
    analytics: { gaId: 'G-TDKBJVDB4S' },
    // start.gg OAuth アプリ (Cloudflare 配信用 619 "SPSP(spsp.games)"、2026-09-22)。API = <origin>/api、redirect = <origin>/callback.html、正規 URL = canonical (js/post_config.js)
    // 配信元 (canonical.origin) ごとの start.gg アプリ。ここに無い配信元 (gh-pages / ConoHa プレビュー) では post_config.js の従来値 (582 + GAS)
    auth: { 'https://spsp.games': { clientId: '619' }, 'https://spsp-web-preview.tosakazu.workers.dev': { clientId: '620' } },
    vote: { testerUids: ['1941489'] },   // 投票の資格判定を免除するテスト用 uid (とさかず)。Worker の VOTE_TESTER_UIDS と揃える。免除分は集計しない
    support: { contact: 'X (@smash_tskz) の DM' },   // 問い合わせ先 (キャラ投票の本人確認が合わないときの案内など)
    // ブログは spsp.games (site/ 直配信) にだけある (gh-pages には rsync しない: deploy/deploy_v4.sh)
    features: { blog: /spsp\.games$/.test(host), vote: true, seeding: true, prefRanking: true, sim: true },
    geo: { unitKey: 'prefecture' },
    calendar: { weekendRealLabel: true },   // 「実質休日 / 実質平日」の概念を出す
    // シードツールの地域まとめ (南関東 / 京阪神) と都道府県の一覧は data/geo.json (smash_database の地域モジュールが定義。docs/geo_json.md)。ここには置かない
  };
  global.SPSPSite = site;
  (global.SPSP = global.SPSP || {}).site = site;
  if (typeof module !== 'undefined' && module.exports) module.exports = site;
})(typeof window !== 'undefined' ? window : globalThis);
