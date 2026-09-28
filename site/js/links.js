// @ts-check
// links.js — サイト内リンクの URL と <a> の組み立て (サイト共通)。以前は各ページが `../p/?uid=` などを直書きしていた。
// URL の形 (p/?d= / p/?uid= / t/?id= / c/ranking.html?char= / pref/ranking.html?pref= / local/ranking.html?series=) はここ 1 か所。
//
// 選手ページの URL は start.gg の discriminator (p/?d=830dec1e) が既定で、uid (p/?uid=1787719) も引き続き通る (2026-09-14)。
// uid → discriminator の表は data/discriminators.json (ビルドが nightly で生成、約 400 KB)。playerHref が最初に呼ばれた
// ときに非同期で読み、読めたら document 内の p/?uid= リンクを p/?d= に書き換える。以後の描画は表を同期で引く。
// 表が読めない環境 (古いビルド出力・オフライン) では uid のリンクのまま動く。
//   SPSPLinks.playerHref(prefix, uid)          → prefix + 'p/?d=' + disc (表に無ければ '?uid=' + uid)。prefix は '' / '../' / 絶対 URL の base。
//                                                 選手ページ自身からは SPSPLinks.SELF を渡すと '?d=…' / '?uid=…'
//   SPSPLinks.discOf(uid)                      → discriminator か null (表を読む前は null)
//   SPSPLinks.uidOfDisc(disc)                  → uid か null (同上)
//   SPSPLinks.loadDiscriminators(prefix)       → Promise<表>。表を先に確実に読みたいとき (選手ページの ?d= の解決、検索)
//   SPSPLinks.upgradePlayerLinks(root)         → root 内の p/?uid= リンクを p/?d= に (表を読んだ後に自動で 1 回呼ぶ)
//   SPSPLinks.tournamentHref(prefix, eid)      → prefix + 't/?id=' + eid
//   SPSPLinks.charRankingHref(prefix, charId)  → prefix + 'c/ranking.html?char=' + charId
//   SPSPLinks.prefRankingHref(prefix, pref)    → prefix + 'pref/ranking.html?pref=' + 単位の URL キー (geo.js unitUrlKey: '東京都' → 'tokyo'。geo 未読込なら id)
//   SPSPLinks.seriesRankingHref(prefix, name)  → prefix + 'local/ranking.html?series=' + シリーズ名のキー (url_key.js nameKey: ASCII slug か '_' + ハッシュ)
//   SPSPLinks.seriesKey(name)                  → そのキー (一覧ページが自前で URL を作るとき)
//   SPSPLinks.a(href, text, attrs)             → '<a href="…"[ attrs]>text</a>'。text はエスケープしない (呼ぶ側で escapeHtml)。
//                                                 attrs は ' class="x" onclick="…"' のような文字列 (先頭の空白込み) か省略
//   SPSPLinks.playerLink(prefix, uid, text, attrs) / tournamentLink(prefix, eid, text, attrs)
import { unitUrlKey } from './geo.js';
import { nameKey } from './url_key.js';
import './html.js';   // SPSP.pageHref
const global = typeof window !== 'undefined' ? window : globalThis;   // 互換: 移行中は window.SPSPXxx にも置く
  var SELF = { self: true };
  /** ページ間リンクの形 (js/html.js。読めない環境では .html のまま) @param {string} rel */
  function pageHref(rel) { var S = global.SPSP; return (S && typeof S.pageHref === 'function') ? S.pageHref(rel) : rel; }
  /** @type {Record<string, string> | null} uid (文字列) → discriminator */
  var DISC = null;
  /** @type {Record<string, number> | null} discriminator (小文字) → uid (数値) */
  var DISC_UID = null;
  /** @type {Promise<Record<string, string>> | null} */
  var loading = null;

  /** @param {string | object} [prefix] */
  function rootOf(prefix) {
    // 表の場所: config の dataRoot があればそこ、次に SPSP.root (js/html.js が決めるサイトのルート)、
    // 無ければリンクの prefix からサイトのルートを推定 (選手ページ自身 = '../')
    var S = global.SPSP || {};
    if (S.site && S.site.dataRoot) return S.site.dataRoot;
    if (S.root != null) return S.root;
    return prefix === SELF ? '../' : (prefix || '');
  }
  /** @param {string | object} [prefix] @returns {Promise<Record<string, string>>} */
  function loadDiscriminators(prefix) {
    if (loading) return loading;
    if (!global.fetch) { loading = Promise.resolve(/** @type {Record<string, string>} */ ({})); return loading; }
    loading = global.fetch(rootOf(prefix) + 'data/discriminators.json')
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (m) {
        /** @type {Record<string, string>} */ var d = m || {};
        /** @type {Record<string, number>} */ var byDisc = {};
        Object.keys(d).forEach(function (uid) { byDisc[String(d[uid]).toLowerCase()] = parseInt(uid, 10); });
        DISC = d; DISC_UID = byDisc;
        if (global.document) upgradePlayerLinks(global.document);
        return d;
      });
    return loading;
  }
  /** @param {number | string} uid @returns {string | null} */
  function discOf(uid) { return (DISC && DISC[String(uid)]) || null; }
  /** @param {string} disc @returns {number | null} */
  function uidOfDisc(disc) { return (DISC_UID && disc && DISC_UID[String(disc).toLowerCase()]) || null; }
  /** @param {number | string} uid */
  function playerQuery(uid) {
    var d = discOf(uid);
    return d ? '?d=' + d : '?uid=' + uid;
  }
  /** @param {string | object} prefix @param {number | string} uid */
  function playerHref(prefix, uid) {
    if (!DISC && !loading && global.document) loadDiscriminators(prefix);   // 初回だけ非同期で表を読む (待たない)
    return (prefix === SELF ? '' : prefix + 'p/') + playerQuery(uid);
  }
  // p/?uid=N (または選手ページ自身の ?uid=N) の <a> を ?d= に書き換える。sim/?uid= など別ページの uid は触らない
  var RE_PLAYER_UID = /^((?:.*\/)?p\/|)\?uid=(\d+)(#.*)?$/;
  /** @param {ParentNode} root */
  function upgradePlayerLinks(root) {
    if (!DISC || !root || !root.querySelectorAll) return 0;
    var onPlayerPage = /\/p\/(index\.html)?$/.test((global.location && global.location.pathname) || '');
    var n = 0;
    Array.prototype.forEach.call(root.querySelectorAll('a[href*="?uid="]'), /** @param {Element} el */ function (el) {
      var href = el.getAttribute('href') || '';
      var m = RE_PLAYER_UID.exec(href);
      if (!m) return;
      if (m[1] === '' && !onPlayerPage) return;   // 相対 '?uid=' は選手ページ自身のリンクだけ
      var d = discOf(m[2]);
      if (!d) return;
      el.setAttribute('href', m[1] + '?d=' + d + (m[3] || ''));
      n++;
    });
    return n;
  }
  function tournamentHref(prefix, eid) { return prefix + 't/?id=' + eid; }
  function charRankingHref(prefix, charId) { return prefix + pageHref('c/ranking.html') + '?char=' + charId; }
  function prefRankingHref(prefix, pref) { return prefix + pageHref('pref/ranking.html') + '?pref=' + encodeURIComponent(unitUrlKey(pref)); }
  function seriesKey(name) { return nameKey(name); }
  function seriesRankingHref(prefix, name) { return prefix + pageHref('local/ranking.html') + '?series=' + encodeURIComponent(seriesKey(name)); }
  function a(href, text, attrs) { return '<a href="' + href + '"' + (attrs || '') + '>' + text + '</a>'; }
  function playerLink(prefix, uid, text, attrs) { return a(playerHref(prefix, uid), text, attrs); }
  function tournamentLink(prefix, eid, text, attrs) { return a(tournamentHref(prefix, eid), text, attrs); }
  var api = { SELF: SELF, playerHref: playerHref, discOf: discOf, uidOfDisc: uidOfDisc, loadDiscriminators: loadDiscriminators,
    upgradePlayerLinks: upgradePlayerLinks, tournamentHref: tournamentHref, charRankingHref: charRankingHref,
    prefRankingHref: prefRankingHref, seriesRankingHref: seriesRankingHref, seriesKey: seriesKey, a: a, playerLink: playerLink, tournamentLink: tournamentLink };
  global.SPSPLinks = api;
  (global.SPSP = global.SPSP || {}).Links = api;   // window.SPSP.Links (名前空間。旧名 SPSPLinks も残す)

export default api;
export { SELF, playerHref, discOf, uidOfDisc, loadDiscriminators, upgradePlayerLinks, tournamentHref, charRankingHref, prefRankingHref, seriesRankingHref, seriesKey, a, playerLink, tournamentLink };
