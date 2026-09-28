// regions/NA/config.js — 北米版のサイト設定。キーの集合は regions/JP/config.js と同じでなければならない (tests/meta/regions.test.cjs)。
// TODO の値は北米版のホスティング・GA・OAuth が決まってから (docs/frontend_i18n_review.md §6)。
//   window.SPSP.site (= window.SPSPSite)
(function (global) {
  'use strict';
  var site = {
    region: 'NA',
    langs: ['en', 'ja'],           // 用意している UI 言語 (site/i18n/<lang>.js)。en.js はまだ無い
    defaultLang: 'en',
    timeZone: 'America/New_York',  // 表示用の既定。データの暦日は大会の place.timezone で決まる (smash_database scripts/North_America/classify.py)
    utcOffset: '-05:00',           // TODO: 表示用の既定オフセット。夏時間 (-04:00) の扱いは timeZone + Intl に寄せて廃止予定
    cleanUrls: false,              // ページ間リンクの拡張子を落とす ('c/ranking.html' → 'c/ranking')。Cloudflare 配信のビルド (--clean-urls) が true にする (js/html.js pageHref)
    dataRoot: '',                  // ビルド出力の場所 (同じルート)。別ホストに置くなら URL
    canonical: { origin: 'TODO', base: '/' },   // TODO: 北米版の配信先 (§6-1)
    regions: { JP: '', NA: '' },   // 各地域版の URL (nav の切替に出す。'' = 未定 / 出さない。例: 'https://spsp.games/na/')
    analytics: { gaId: '' },       // TODO: 北米版の GA
    auth: { 'https://spsp.games': { clientId: '619' }, 'https://spsp-web-preview.tosakazu.workers.dev': { clientId: '620' } },   // 日本版と同じアプリ (コールバックは <origin>/callback.html で共通)
    vote: { testerUids: ['1941489'] },   // 投票の資格判定を免除するテスト用 uid (とさかず)。Worker の VOTE_TESTER_UIDS と揃える。免除分は集計しない
    support: { contact: '' },      // TODO: 北米版の問い合わせ先 (空なら案内を出さない)
    features: { blog: false, vote: false, seeding: true, prefRanking: true, sim: true },   // vote は北米用 OAuth/GAS ができてから
    geo: { unitKey: 'state' },
    calendar: { weekendRealLabel: false },   // 「実質休日 / 実質平日」に相当する概念は北米では未定義
  };
  global.SPSPSite = site;
  (global.SPSP = global.SPSP || {}).site = site;
  if (typeof module !== 'undefined' && module.exports) module.exports = site;
})(typeof window !== 'undefined' ? window : globalThis);
