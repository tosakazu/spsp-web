// @ts-check
// src/pages/sim.js — site/sim/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/sim.js にする。
import SPSPHtml from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPData from '../../site/js/data.js';
import SPSPPlayerData from '../../site/js/player_data.js';
import SPSPFormat from '../../site/js/format.js';
import SPSPSuggest from '../../site/js/suggest.js';
import SPSPTags from '../../site/js/tags.js';
import '../../site/nav.js';
import SPSPCalc from '../../site/sim/calc.js';
import calcApi from '../../site/sim/calc.js';   // UMD: bundle の中では module.exports 側になるので、ページが使う SPSPCalc に置く
/** 地域の暦日の時差 (region/config.js utcOffset。無ければ止まらないよう空 = UTC ではなく、設定は必ずある前提) */
const SITE_UTC_OFFSET = /** @type {SpspSiteConfig} */ (window.SPSP.site).utcOffset;
window.SPSPCalc = calcApi;

(function () {
  'use strict';
  var i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
  SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に
  var C = SPSPCalc;
  var DATA_BASE = SPSP.data;   // データ (JSON) の置き場 (config.dataRoot = data.spsp.games など)。ページ間リンクは SPSP.langRoot
  var params = new URLSearchParams(location.search);
  var UID = parseInt(params.get('uid') || location.hash.replace(/^#/, '') || '0', 10);

  /** latest_tjpr_full.jsonl から要る分だけ */
  /** @typedef {{ display: string, tjpr_score: number, bt_gated_elo: number, bt_internal_elo: number, lv: number, gray: boolean,
   *              tjpr_rank: number | null | undefined, bt_rank: number | null | undefined, ens_rank: number | null | undefined }} MasterRec */
  /** data/upcoming_entrants.json の大会 (annotate_upcoming.py が付ける is_* 込み) */
  /** @typedef {{ tournament_name: string, start_at: number, num_entrants?: number, entrants: { uid?: number | null, tag?: string }[],
   *              is_weekend?: boolean, is_weekend_real?: boolean, is_restricted?: boolean, is_lower_class?: boolean,
   *              is_non_serious?: boolean, is_uchi?: boolean, [k: string]: any }} UpEvent */
  /** @typedef {{ generated_at?: number, by_uid: Record<string, (number | string)[]>, events: Record<string, UpEvent> }} Upcoming */
  /** players/<uid>.json (組み立て後。scores は必ずある前提で読む) */
  /** @typedef {Omit<SpspPlayerRecord, 'scores' | 'tournaments'> & { scores: Record<string, number>, ranks?: Record<string, number | null | undefined>,
   *              bt_timeline_g2?: { date: string, rating: number, rd: number }[], tournaments?: { ts?: number, [k: string]: any }[] }} SimPlayer */
  /** 順位を仮に付けるための他選手のスコア (降順) */
  /** @typedef {{ score: number, gray: boolean, uid: number }} ScoreEntry */
  /** 相手の直対シミュ用の状態 */
  /** @typedef {{ rating: number, rd: number, lastTs: number | null }} OppInit */
  /** シミュ中の状態 (大会 1 つ分。順位評価 / 直対の結果を総合評価に渡す) */
  /** @typedef {{ tjpr: number | null, bt: number | null, tjprRank?: number | null, btRank?: number | null }} SimState */

  /** @type {Map<number, MasterRec>} */
  var MASTER = new Map();     // uid -> {display, tjpr_score, bt_gated_elo, bt_internal_elo, lv, gray, tjpr_rank, bt_rank}
  /** @type {Set<number>} */
  var OVERSEAS = new Set();
  /** @type {Upcoming | null} */
  var UPCOMING = null;        // upcoming_entrants.json
  /** @type {SimPlayer | null} */
  var PLAYER = null;          // players/<uid>.json
  /** @type {ScoreEntry[]} */
  var tjprArr = [];           // 自分以外 [{score, gray}] 降順
  /** @type {ScoreEntry[]} */
  var btArr = [];
  /** @type {Map<number, Promise<OppInit>>} */
  var oppCache = new Map();   // uid -> players json (直対シミュ用 rd)
  /** @type {ReturnType<typeof C.createEnsemblePredictor> | null} */
  var ENS = null;             // 総合評価予測器
  var ENS_CUR_RAW = 0;        // 現在値での raw 予測 (アンカー用)

  /** @param {any} s @returns {string} */
  function esc(s) { return SPSPHtml.escapeHtml(s); }   // ../js/html.js
  /** @param {number} x */
  function fmt1(x) { return (Math.round(x * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  /** @param {number} x */
  function fmt0(x) { return Math.round(x).toLocaleString('ja-JP'); }
  /** @param {number} x @param {number} [digits] */
  function signed(x, digits) {
    var v = digits === 0 ? Math.round(x) : Math.round(x * 10) / 10;
    var s = v.toLocaleString('ja-JP', digits === 0 ? {} : { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return (v >= 0 ? '+' : '') + s;
  }
  /** @param {number} ts */
  function dateStr(ts) {
    var d = new Date(ts * 1000);
    var wd = i18n('common.weekdays').split(',')[d.getDay()];
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + wd + ')';
  }

  // サジェストの外側クリックで閉じる処理とキーボード操作 (↑↓ / Enter / Esc) は ../js/suggest.js (priority/ と共通)
  SPSPSuggest.installCloseOnOutsideClick();
  /** @param {HTMLInputElement} input @param {HTMLElement} sug @param {(item: HTMLElement) => void} pick */
  function attachSuggestNav(input, sug, pick) {
    SPSPSuggest.attachSuggestNav(input, sug, pick, function (/** @type {HTMLElement} */ it) {
      return it.dataset.i !== undefined || it.dataset.uid !== undefined || it.dataset.eid !== undefined;
    });
  }

  // ---- データロード ----
  /** @param {string} url */
  function loadJsonl(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('jsonl ' + r.status);
      return r.text();
    }).then(function (text) {
      var recs = /** @type {SpspRankRecord[]} */ (SPSPData.parseJsonl(text));   // ../js/data.js
      for (var i = 0; i < recs.length; i++) {
        var rec = recs[i];
        var sc = rec.scores || {};
        MASTER.set(rec.user_id, {
          display: rec.display,
          tjpr_score: sc.tjpr_score || 0,
          bt_gated_elo: sc.bt_gated_elo || 0,
          bt_internal_elo: sc.bt_internal_elo || 0,
          lv: sc.shared_cascade_lv || 0,
          gray: !!(rec.metadata && rec.metadata.provisional),
          tjpr_rank: rec.ranks ? rec.ranks.tjpr : 0,
          bt_rank: rec.ranks ? rec.ranks.bt_gated : 0,
          ens_rank: rec.ranks ? rec.ranks.ensemble : 0,
        });
      }
    });
  }

  Promise.all([
    // overseas は表示のグレー化にしか使わないので、取得失敗しても degrade して続行
    fetch(DATA_BASE + 'data/overseas.json')
      .then(function (r) { return r.ok ? r.json() : { uids: [] }; })
      .catch(function () { return { uids: [] }; }),
    fetch(SPSP.data + 'data/upcoming_entrants.json').then(function (r) {
      if (!r.ok) throw new Error(i18n('sim.fetch_tour_failed', { status: r.status }));
      return r.json();
    }),
    // 選手 JSON は分割されている (安定部分 + players_current.json + 履歴)。組み立ては ../js/player_data.js
    UID ? SPSPPlayerData.load(DATA_BASE, UID).catch(function () { return null; })
        : Promise.resolve(null),
    loadJsonl(DATA_BASE + 'latest_tjpr_full.jsonl'),
    // 集計対象の実効フィルタ (meta.json params.LV_FILTERS_EFFECTIVE) で calc.js の定数を上書き
    fetch(DATA_BASE + 'meta.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
  ]).then(function (res) {
    if (res[4] && res[4].params && res[4].params.LV_FILTERS_EFFECTIVE && C.setLvFilters) C.setLvFilters(res[4].params.LV_FILTERS_EFFECTIVE);
    (res[0].uids || []).forEach(function (/** @type {number} */ u) { OVERSEAS.add(u); });
    UPCOMING = res[1];
    PLAYER = /** @type {SimPlayer | null} */ (res[2]);
    MASTER.forEach(function (v, uid) { if (OVERSEAS.has(uid)) v.gray = true; });
    if (PLAYER) buildRankArrays();
    render();
  }).catch(function (e) {
    var loading = document.getElementById('loading');
    if (loading) loading.textContent =
      i18n('common.load_failed', { message: e.message });
  });

  function buildRankArrays() {
    if (!PLAYER) return;
    var me = PLAYER;
    tjprArr = []; btArr = [];
    MASTER.forEach(function (v, uid) {
      if (uid === UID) return;
      tjprArr.push({ score: v.tjpr_score, gray: v.gray, uid: uid });
      if (v.bt_gated_elo > 0) btArr.push({ score: v.bt_gated_elo, gray: v.gray, uid: uid });
    });
    tjprArr.sort(function (a, b) { return b.score - a.score; });
    btArr.sort(function (a, b) { return b.score - a.score; });
    /** @type {{ lv: number, tj: number, bt: number, gray: boolean, uid: number }[]} */
    var others = [];
    MASTER.forEach(function (v, uid) {
      if (uid === UID) return;
      others.push({ lv: v.lv, tj: v.tjpr_score, bt: v.bt_gated_elo, gray: v.gray, uid: uid });
    });
    var ens = C.createEnsemblePredictor(others, {
      lv: me.scores.shared_cascade_lv || 1,
      uid: UID,
      tj: me.scores.tjpr_score || 0,
      bt: me.scores.bt_gated_elo || 0,
    });
    ENS = ens;
    ENS_CUR_RAW = ens.predictRaw(me.scores.tjpr_score || 0, me.scores.bt_gated_elo || 0);
  }

  // Lv ラベル (プレイヤーページと同一仕様、../js/format.js): 総合順位に応じた接尾辞付き。対象外は '対象外'
  /** @param {number} lv @param {number} rank */
  function lvLabel(lv, rank) {
    return SPSPFormat.lvLabel(lv, rank) || i18n('player.lv_none');
  }

  // ヒーロー (名前下の大きい順位表示) にシミュ前後の順位を矢印で表示する。
  // nr が null の枠は現在値のみの通常表示に戻す。
  // Lv ピルはラベル (接尾辞込み) が変わる場合のみ並記。
  /** @param {number | null} tjprRank @param {number | null} btRank @param {number | null} ensRank @param {number | null} simLv */
  function updateHero(tjprRank, btRank, ensRank, simLv) {
    if (!PLAYER) return;
    var rk = PLAYER.ranks || {};
    var curLv = PLAYER.scores.shared_cascade_lv || 0;
    var lvSlot = document.getElementById('lv-slot');
    if (lvSlot) {
      var curLabel = lvLabel(curLv, rk.ensemble || 0);
      var simLabel = (simLv != null && ensRank != null) ? lvLabel(simLv, ensRank) : null;
      if (simLabel != null && simLabel !== curLabel) {
        lvSlot.innerHTML =
          '<span class="lv-pill lv-' + curLv + '">' + curLabel + '</span>' +
          '<span class="hero-arw">→</span>' +
          '<span class="lv-pill lv-' + simLv + '">' + simLabel + '</span>';
      } else {
        lvSlot.innerHTML = '<span class="lv-pill lv-' + curLv + '">' + curLabel + '</span>';
      }
    }
    /** @param {Element | null | undefined} el @param {boolean} isBig @param {string} id @param {number | null | undefined} cur @param {number | null} nr */
    function set(el, isBig, id, cur, nr) {
      if (!el) return;
      if (nr == null) {
        el.classList.remove('siming');
        el.innerHTML = (isBig ? '<span class="hash">#</span>' : '#') +
          '<span id="' + id + '">' + (cur || '—') + '</span>';
      } else {
        el.classList.add('siming');
        el.innerHTML = '<span class="hero-pre">' + (cur ? '#' + cur : '—') + '</span>' +
          '<span class="hero-arw">→</span>' +
          (isBig ? '<span class="hash">#</span>' : '#') +
          '<span id="' + id + '">' + nr + '</span>';
      }
    }
    var cards = document.querySelectorAll('.subrank-card .value');
    set(document.querySelector('.rank-hero .big'), true, 'cur-ens', rk.ensemble || 0, ensRank);
    set(cards[0], false, 'cur-tjpr', rk.tjpr || 0, tjprRank);
    set(cards[1], false, 'cur-bt', rk.bt_gated || 0, btRank);
  }

  // 総合評価の暫定順位 (現在順位にアンカーして差分適用) + ヒーロー更新
  /** @param {HTMLElement} panel @param {SimState} state */
  function updateEns(panel, state) {
    if (!PLAYER || !ENS) return;
    /** @type {number | null} */
    var nr = null;
    /** @type {number | null} */
    var simLv = null;
    var cur = (PLAYER.ranks || {}).ensemble || 0;
    if (state.tjpr != null || state.bt != null) {
      var tj = state.tjpr != null ? state.tjpr : (PLAYER.scores.tjpr_score || 0);
      var bt = state.bt != null ? state.bt : (PLAYER.scores.bt_gated_elo || 0);
      nr = Math.max(1, cur + ENS.predictRaw(tj, bt) - ENS_CUR_RAW);
      simLv = ENS.predictLv(tj, bt);
    }
    updateHero(state.tjprRank != null ? state.tjprRank : null,
               state.btRank != null ? state.btRank : null, nr, simLv);
    var wrap = /** @type {HTMLElement | null} */ (panel.querySelector('.ens-wrap'));
    if (!wrap) return;
    if (nr == null) { wrap.style.display = 'none'; return; }
    var d = cur ? cur - nr : 0;
    wrap.style.display = '';
    var ensBox = wrap.querySelector('.ens-box');
    if (ensBox) ensBox.innerHTML =
      '<div>' + i18n('sim.provisional_rank', { label: i18n('ranking.tab.ensemble') }) + ' ' + (cur ? '#' + cur : '–') + ' → <b>#' + nr + '</b>' +
      (d > 0 ? ' <span class="up">(↑' + d + ')</span>' : d < 0 ? ' <span class="down">(↓' + (-d) + ')</span>' : '') +
      '</div>';
  }

  // 最終参加日 (エンジンの last_seen 相当): レートが動かなかった大会への参加も含めるため
  // bt_timeline の最終日と tournaments[] の最終 ts の大きい方を使う
  /** @param {SimPlayer} pj @returns {number | null} */
  function lastSeenOf(pj) {
    var tl = pj.bt_timeline_g2 || [];
    /** @type {number | null} */
    var last = tl.length ? new Date(tl[tl.length - 1].date + 'T00:00:00' + SITE_UTC_OFFSET).getTime() / 1000 : null;   // 暦日は地域の時差
    var ts = (pj.tournaments || []).reduce(function (m, t) {
      return t.ts && t.ts > m ? t.ts : m;
    }, 0);
    if (ts > (last || 0)) last = ts;
    return last;
  }

  // ---- 自分の状態 ----
  function selfState() {
    var me = /** @type {SimPlayer} */ (PLAYER);   // 描画は PLAYER がある時だけ
    var sc = me.scores;
    var lv = sc.shared_cascade_lv || 1;
    var entries = C.extractEntries(me);
    var rating = sc.bt_internal_elo > 0 ? sc.bt_internal_elo : 1500;
    var tl = me.bt_timeline_g2 || [];
    var rd = tl.length ? tl[tl.length - 1].rd : 350;
    var history = tl.map(function (x) {
      return { ts: new Date(x.date + 'T00:00:00' + SITE_UTC_OFFSET).getTime() / 1000, rating: x.rating };
    });
    return { lv: lv, entries: entries, rating: rating, rd: rd,
             lastSeenTs: lastSeenOf(me), history: history };
  }

  // ---- 描画 ----
  /** @param {string} id */
  function elById(id) { return /** @type {HTMLElement} */ (document.getElementById(id)); }   // 静的 HTML にある要素 (型だけ)

  function render() {
    elById('loading').style.display = 'none';
    elById('content').style.display = '';
    if (!PLAYER) {
      // プレイヤー未指定 (または未収録): 検索だけ出す
      elById('sim-card').style.display = 'none';
      elById('tours-section').style.display = 'none';
      var ps = /** @type {HTMLInputElement} */ (document.getElementById('psearch'));
      if (UID) {
        var msg = document.createElement('div');
        msg.className = 'muted';
        msg.style.margin = '4px 0 8px';
        msg.textContent = i18n('sim.uid_not_found', { uid: UID });
        /** @type {Element} */ (ps.parentNode).before(msg);
      }
      ps.placeholder = i18n('sim.search_placeholder_no_player');
      ps.focus();
      setupPlayerSearch();
      return;
    }
    var sc = PLAYER.scores, rk = PLAYER.ranks || {};
    var name = (MASTER.get(UID) || {}).display || ('uid:' + UID);
    document.title = i18n('sim.doc_title', { name: name });
    var nameLink = /** @type {HTMLAnchorElement} */ (document.getElementById('display'));
    nameLink.textContent = name;
    nameLink.href = SPSPLinks.playerHref(/** @type {string} */ (SPSP.langRoot), UID);
    var lv = sc.shared_cascade_lv || 0;
    elById('lv-slot').innerHTML =
      '<span class="lv-pill lv-' + lv + '">' + lvLabel(lv, rk.ensemble || 0) + '</span>';
    elById('cur-ens').textContent = String(rk.ensemble || '—');
    elById('cur-tjpr').textContent = String(rk.tjpr || '—');
    elById('cur-tjpr-s').textContent =
      i18n('player.score') + ' ' + (sc.tjpr_elo != null ? sc.tjpr_elo.toFixed(2) : '—');
    elById('cur-bt').textContent = String(rk.bt_gated || '—');
    elById('cur-bt-s').innerHTML =
      i18n('player.score') + ' ' + (sc.bt_gated_elo != null ? sc.bt_gated_elo.toFixed(2) : '—') +
      ' <span style="color:#9ca3af;font-size:10px">(' +
      (sc.bt_internal_elo != null ? sc.bt_internal_elo.toFixed(2) : '—') + ')</span>';
    renderTours();
    setupPlayerSearch();
    setupTourSearch();
    var fresh = document.getElementById('fresh');
    if (fresh && UPCOMING && UPCOMING.generated_at) {
      var gd = new Date(UPCOMING.generated_at * 1000);
      fresh.textContent = i18n('sim.entrants_asof', { time: (gd.getMonth() + 1) + '/' + gd.getDate() + ' ' +
        gd.getHours() + ':' + String(gd.getMinutes()).padStart(2, '0') });
    }
  }

  function renderTours() {
    // 一番近い「参加登録中かつ集計対象」の大会だけ初期表示 (無ければ空)。
    // events に無い eid や開催後 24h 超の大会は除外
    if (!UPCOMING) return;
    var up = UPCOMING;
    var st = selfState();
    var now = Date.now() / 1000;
    var eids = (up.by_uid[String(UID)] || []).map(String)
      .filter(function (eid) {
        var ev = up.events[eid];
        return ev && ev.start_at && ev.start_at + 86400 > now;
      })
      .sort(function (a, b) { return up.events[a].start_at - up.events[b].start_at; });
    for (var i = 0; i < eids.length; i++) {
      if (gateInfo(up.events[eids[i]], st.lv).pass) { addTourCard(eids[i]); return; }
    }
  }

  // nent は登録者数 (num_entrants) を優先 (annotate 側・エンジンの standings 数に近い方)
  /** @param {UpEvent} ev @returns {number} */
  function nentOf(ev) {
    return ev.num_entrants || (ev.entrants && ev.entrants.length) || 0;
  }

  /** @param {UpEvent} ev @param {number} lv */
  function gateInfo(ev, lv) {
    var nent = nentOf(ev);
    var meta = {
      nent: nent,
      isWeekend: !!ev.is_weekend,
      isCapped: !!(ev.is_restricted || ev.is_lower_class),
    };
    // エンジン全体の除外 (Lv 問わず): 特殊ルール / 身内 / 5 名未満
    if (ev.is_non_serious) {
      // 身内と特殊ルールは理由が違うので出し分ける (is_uchi は annotate_upcoming.py が付与)
      var why = ev.is_uchi ? i18n('sim.reason.uchi')
                           : i18n('sim.reason.special');
      return { pass: false, reason: why, meta: meta };
    }
    if (nent < 5) {
      return { pass: false, reason: i18n('sim.reason.min5'), meta: meta };
    }
    var pass = C.tournamentPassesLv(lv, meta);
    var reason = '';
    if (!pass) {
      // 落ちた条件を全部列挙する (満たしている条件は書かない)
      var f = C.LV_FILTERS[lv] || {};
      /** @type {string[]} */
      var conds = [];
      if (f.minNentGt !== undefined && meta.nent <= f.minNentGt) conds.push(i18n('sim.cond.min_nent', { n: f.minNentGt + 1 }));
      if (f.weekendOnly && !meta.isWeekend) conds.push(i18n('sim.cond.weekend'));
      if (f.excludeCapped && meta.isCapped) conds.push(i18n('sim.cond.not_capped'));
      reason = i18n('sim.reason.lv_only', { lv: lv, conds: conds.join('・') });
    }
    return { pass: pass, reason: reason, meta: meta };
  }

  /** @param {string | number} eid */
  function addTourCard(eid) {
    if (!UPCOMING) return;
    eid = String(eid);
    var ev = UPCOMING.events[eid];
    if (!ev) return;
    elById('tours').innerHTML = '';  // 常に 1 大会だけ表示 (置き換え)
    var st = selfState();
    var g = gateInfo(ev, st.lv);
    var nent = nentOf(ev);
    var entered = (UPCOMING.by_uid[String(UID)] || []).map(String).indexOf(eid) >= 0;
    var card = document.createElement('div');
    card.className = 'tour-card';
    card.innerHTML =
      '<div class="t-name">' + esc(ev.tournament_name) + '</div>' +
      '<div class="t-meta">' + dateStr(ev.start_at) + ' ・ ' + i18n('player.upcoming.entrants', { n: nent }) +
      SPSPTags.dayTag(ev, { wk: 'badge wk', wd: 'badge wd' }) +   // 休日 / 実質休日 / 実質平日 / 平日 (../js/tags.js)
      (entered ? '<span class="badge wk">' + i18n('sim.badge.entered') + '</span>' : '') +
      (g.pass ? '<span class="badge ok">' + i18n('player.counted') + '</span>'
              : '<span class="badge ng">' + i18n('player.not_counted') + '</span> <span class="muted">' + esc(g.reason) + '</span>') +
      '</div>' +
      '<div class="panel"></div>';
    elById('tours').appendChild(card);
    buildPanel(/** @type {HTMLElement} */ (card.querySelector('.panel')), ev, g, { tjpr: null, bt: null });
  }

  // ---- 順位評価予想 ----
  /** 順位帯ごとの順位評価の予想 (select の 1 行分) */
  /** @typedef {{ place: number, topx: string, raw: number, delta: number, newScore: number, newElo: number, newRank: number,
   *              curScore: number, curRank: number, label?: string }} TjprRow */
  /** @param {UpEvent} ev @param {ReturnType<typeof gateInfo>} g @returns {TjprRow[]} */
  function tjprPrediction(ev, g) {
    var me = /** @type {SimPlayer} */ (PLAYER);
    var st = selfState();
    var ratings = ev.entrants.map(function (e) {
      if (e.uid && MASTER.has(e.uid)) {
        var m = /** @type {MasterRec} */ (MASTER.get(e.uid));
        return m.bt_internal_elo > 0 ? m.bt_internal_elo : 1500;
      }
      return 1500;
    });
    var nent = nentOf(ev) || ratings.length;
    var bz = C.buildBanzuke(ratings, nent);
    var maxTier = C.placementToTier(bz.n);
    /** @type {TjprRow[]} */
    var rows = [];
    var curScore = me.scores.tjpr_score || 0;
    var curRank = (me.ranks || {}).tjpr || 0;
    var baseAgg = C.aggregateEntries(st.entries, st.lv);
    for (var tier = 0; tier <= maxTier; tier++) {
      var place = C.tierBestPlace(tier);
      if (place > nent) break;
      var raw = 0, delta = 0, newScore = curScore;
      if (g.pass) {
        raw = C.tjprRawForPlace(bz, st.lv, place);
        var agg2 = C.aggregateEntries(st.entries.concat([raw]), st.lv);
        delta = agg2 - baseAgg;
        newScore = curScore + delta;
      }
      var newRank = C.provisionalRank(tjprArr, newScore, UID);
      rows.push({
        place: place, topx: tier === 0 ? i18n('sim.champion') : (tier === 1 ? i18n('sim.runner_up') : i18n('common.place_n', { n: place })),
        raw: raw, delta: delta, newScore: newScore,
        newElo: newScore * C.TJPR_ELO_SCALE, newRank: newRank,
        curScore: curScore, curRank: curRank,
      });
    }
    return rows;
  }

  /** @param {HTMLElement} panel @param {UpEvent} ev @param {ReturnType<typeof gateInfo>} g @param {SimState} state */
  function buildPanel(panel, ev, g, state) {
    var st = selfState();
    // --- 順位評価 ---
    var h = '<h3>' + i18n('sim.h.tjpr') + '</h3>';
    if (!g.pass) {
      h += '<div class="muted">' + i18n('sim.not_counted_note') + '</div>';
    } else {
      h += '<select class="place-sel"><option value="">' + i18n('sim.choose_place') + '</option></select>' +
           '<div class="detail-box"></div>';
    }
    // --- 直対 ---
    h += '<h3 style="margin-top:14px">' + i18n('sim.h.bt') + '</h3>';
    if (g.pass) {
      h += '<div class="opp-wrap"><input type="search" placeholder="' + i18n('sim.opp_placeholder') + '" autocomplete="off">' +
           '<div class="suggest"></div></div>' +
           '<div class="sim-list"></div><div class="sim-result" style="display:none"></div>' +
           '<div class="ens-wrap" style="display:none"><h3 style="margin-top:14px">' + i18n('sim.h.ens') + '</h3>' +
           '<div class="sim-result ens-box" style="display:block"></div></div>';
    }
    panel.innerHTML = h;

    if (g.pass) {
      buildTjprSelect(panel, ev, g, state);
      buildBtSim(panel, ev, g, st, state);
    }
    // 大会切替時にヒーローのシミュ表示をリセット (state は常に初期値で始まる)
    updateEns(panel, state);
  }

  /** @param {HTMLElement} panel @param {UpEvent} ev @param {ReturnType<typeof gateInfo>} g @param {SimState} state */
  function buildTjprSelect(panel, ev, g, state) {
    var me = /** @type {SimPlayer} */ (PLAYER);
    var rows = tjprPrediction(ev, g);
    var sel = /** @type {HTMLSelectElement} */ (panel.querySelector('.place-sel'));
    var detail = /** @type {HTMLElement} */ (panel.querySelector('.detail-box'));
    var nent = nentOf(ev);
    if (!rows.length) {
      // エントラント情報が無い/極端に少ない場合は select ごと隠して説明を出す
      sel.style.display = 'none';
      var m = document.createElement('div');
      m.className = 'muted';
      m.textContent = i18n('sim.no_entrants_info');
      sel.before(m);
      return;
    }
    // SPSP 予想順位 = 参加者内のレート順シード相当の順位帯 (シード n は n 位帯どまり想定)
    var myRating = me.scores.bt_internal_elo > 0 ? me.scores.bt_internal_elo : 1500;
    var seed = 1;
    ev.entrants.forEach(function (e) {
      if (e.uid === UID) return;
      var m = e.uid ? MASTER.get(e.uid) : null;
      if ((m && m.bt_internal_elo > 0 ? m.bt_internal_elo : 1500) > myRating) seed++;
    });
    var defIdx = 0;
    rows.forEach(function (r, i) { if (r.place <= seed) defIdx = i; });
    rows.forEach(function (r, i) {
      var tier = C.placementToTier(r.place);
      var next = C.tierBestPlace(tier + 1) - 1;
      var hi = Math.min(next, nent);
      var label = tier === 0 ? i18n('sim.champion') : tier === 1 ? i18n('sim.runner_up') :
                  (hi > r.place ? i18n('common.place_range', { lo: r.place, hi: hi }) : i18n('common.place_n', { n: r.place }));
      r.label = label;
      var opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = label + ' (' + signed(r.newElo - r.curScore * C.TJPR_ELO_SCALE) + ')' +
                        (i === defIdx ? ' ' + i18n('sim.spsp_pick') : '');
      sel.appendChild(opt);
    });
    // 予想順位をデフォルト選択して詳細も表示
    sel.value = String(defIdx);
    sel.addEventListener('change', function () {
      if (sel.value === '') {
        detail.classList.remove('show');
        state.tjpr = null;
        state.tjprRank = null;
        updateEns(panel, state);
        return;
      }
      showDetail(rows[parseInt(sel.value, 10)]);
    });
    /** @param {TjprRow} r */
    function showDetail(r) {
      var curElo = r.curScore * C.TJPR_ELO_SCALE;
      var rankDiff = r.curRank ? r.curRank - r.newRank : 0;
      detail.innerHTML =
        '<div><b>' + esc(r.label) + '</b> ' + i18n('sim.raw_pt', { pt: fmt1(r.raw * C.TJPR_ELO_SCALE) }) +
        (r.delta < 0.005 && r.raw > 0 ? ' <span class="dim">' + i18n('sim.outside_top3') + '</span>' : '') + '</div>' +
        '<div>' + i18n('player.score') + ' ' + fmt1(curElo) + ' → <b>' + fmt1(r.newElo) + '</b> ' +
        '<span class="' + (r.newElo - curElo >= 0 ? 'up' : 'down') + '">(' + signed(r.newElo - curElo) + ')</span></div>' +
        '<div>' + i18n('sim.provisional_rank', { label: i18n('ranking.tab.tjpr') }) + ' ' + (r.curRank ? '#' + r.curRank : '–') + ' → <b>#' + r.newRank + '</b>' +
        (rankDiff > 0 ? ' <span class="up">(↑' + rankDiff + ')</span>' : rankDiff < 0 ? ' <span class="down">(↓' + (-rankDiff) + ')</span>' : '') + '</div>';
      detail.classList.add('show');
      state.tjpr = r.newScore;
      state.tjprRank = r.newRank;
      updateEns(panel, state);
    }
    showDetail(rows[defIdx]);
  }

  // ---- 直対シミュ ----
  /** @param {HTMLElement} panel @param {UpEvent} ev @param {ReturnType<typeof gateInfo>} g @param {ReturnType<typeof selfState>} st @param {SimState} state */
  function buildBtSim(panel, ev, g, st, state) {
    var me = /** @type {SimPlayer} */ (PLAYER);
    var input = /** @type {HTMLInputElement} */ (panel.querySelector('.opp-wrap input'));
    var sug = /** @type {HTMLElement} */ (panel.querySelector('.opp-wrap .suggest'));
    var listBox = /** @type {HTMLElement} */ (panel.querySelector('.sim-list'));
    var resBox = /** @type {HTMLElement} */ (panel.querySelector('.sim-result'));
    /** @type {{ uid: number | null | undefined, tag: string | undefined, won: boolean }[]} */
    var results = [];   // {uid, tag, won}
    var seq = 0;        // recompute の世代 (古い fetch 完了が新しい状態を上書きしないように)

    var entrants = ev.entrants.filter(function (e) { return e.uid !== UID; });

    /** @param {UpEvent['entrants'][number]} e @returns {string | undefined} */
    function oppLabel(e) {
      var m = e.uid ? MASTER.get(e.uid) : null;
      return m ? m.display : e.tag;
    }
    /** @param {UpEvent['entrants'][number]} e @returns {string} */
    function oppMeta(e) {
      var m = e.uid ? MASTER.get(e.uid) : null;
      if (!m) return i18n('sim.unlisted');
      return i18n('sim.rating', { r: fmt0(m.bt_internal_elo > 0 ? m.bt_internal_elo : 1500) }) + (m.bt_rank ? ' / ' + i18n('sim.bt_rank', { rank: m.bt_rank }) : '');
    }

    function renderSuggest() {
      var q = input.value.trim().toLowerCase();
      /** @param {UpEvent['entrants'][number]} e */
      function oppRating(e) {
        var m = e.uid ? MASTER.get(e.uid) : null;
        return m && m.bt_internal_elo > 0 ? m.bt_internal_elo : 1500;
      }
      var hits = entrants.filter(function (e) {
        if (!q) return true;
        var m = e.uid ? MASTER.get(e.uid) : null;
        return (e.tag || '').toLowerCase().indexOf(q) >= 0 ||
               (m && m.display.toLowerCase().indexOf(q) >= 0) ||
               String(e.uid).indexOf(q) >= 0;
      }).sort(function (a, b) { return oppRating(b) - oppRating(a); });
      sug.innerHTML = hits.slice(0, 50).map(function (e, i) {
        return '<div class="item" data-i="' + entrants.indexOf(e) + '">' +
          '<span>' + esc(oppLabel(e)) + '</span><span class="meta">' + esc(oppMeta(e)) + '</span></div>';
      }).join('') || '<div class="item"><span class="meta">' + i18n('common.none') + '</span></div>';
      sug.classList.add('open');
    }
    input.addEventListener('focus', renderSuggest);
    input.addEventListener('input', renderSuggest);
    /** @param {HTMLElement} item */
    function pickOpp(item) {
      var opp = entrants[parseInt(/** @type {string} */ (item.dataset.i), 10)];
      if (!opp) return;
      sug.classList.remove('open');
      input.value = '';
      // デフォルト勝ちで即追加。勝敗は行内トグルで切り替える
      results.push({ uid: opp.uid, tag: oppLabel(opp), won: true });
      recompute();
    }
    sug.addEventListener('click', function (e2) {
      var item = /** @type {HTMLElement | null} */ (e2.target instanceof Element ? e2.target.closest('.item') : null);
      if (!item || item.dataset.i === undefined) return;
      pickOpp(item);
    });
    attachSuggestNav(input, sug, pickOpp);

    /** @param {number} uid @returns {Promise<OppInit>} */
    function oppInit(uid) {
      // 相手の rating/rd を用意 (players json を lazy fetch)。
      // Promise を cache して同一 uid の並行二重 fetch を防ぐ
      var m = uid ? MASTER.get(uid) : null;
      var rating = m && m.bt_internal_elo > 0 ? m.bt_internal_elo : 1500;
      /** @type {OppInit} */
      var base = { rating: rating, rd: 350, lastTs: null };
      if (!uid || !m) return Promise.resolve(base);
      var cached = oppCache.get(uid);
      if (cached) return cached;
      // 相手は bt_timeline_g2 と tournaments[].ts だけ要る (安定部分に入っている) → 履歴は取らない
      var p = SPSPPlayerData.load(DATA_BASE, uid, { history: false }).then(function (/** @type {any} */ pj) {
        if (!pj) throw new Error();
        var tl = pj.bt_timeline_g2 || [];
        return {
          rating: rating,
          rd: tl.length ? tl[tl.length - 1].rd : 350,
          lastTs: lastSeenOf(pj),
        };
      }).catch(function () { return base; });
      oppCache.set(uid, p);
      return p;
    }

    // 行の描画。deltas=null は計算中 (…) 表示。
    // 変更操作のたびに同期で再描画することで、fetch 中の古い data-i による誤操作を防ぐ
    /** @param {{ uid: number | null | undefined, tag: string | undefined, won: boolean }} r @returns {string} */
    function whoHtml(r) {
      var nm = r.uid
        ? SPSPLinks.playerLink(SPSP.langRoot, r.uid, esc(r.tag), ' class="nm"')
        : '<span class="nm">' + esc(r.tag) + '</span>';   // uid 不明 (未収録) の相手
      var m = r.uid ? MASTER.get(r.uid) : null;
      // gray (計測中/海外) は全国順位カウント外なので出さない
      if (m && !m.gray && m.ens_rank) nm += '<span class="orank">' + i18n('sim.national_rank', { rank: m.ens_rank }) + '</span>';
      return nm;
    }

    /** @param {number[] | null} deltas */
    function renderRows(deltas) {
      listBox.innerHTML = results.map(function (r, i) {
        return '<div class="sim-row">' +
          '<span class="rno">' + i18n('sim.round_n', { n: i + 1 }) + '</span>' +
          '<span class="wlseg">' +
          '<button class="win' + (r.won ? ' on' : '') + '" data-i="' + i + '" data-won="1">' + i18n('sim.win') + '</button>' +
          '<button class="loss' + (r.won ? '' : ' on') + '" data-i="' + i + '" data-won="0">' + i18n('sim.loss') + '</button>' +
          '</span>' +
          '<span class="who">' + whoHtml(r) + '</span>' +
          '<span class="delta">' + (deltas ? signed(deltas[i]) : '…') + '</span>' +
          '<button class="rm" data-i="' + i + '">✕</button></div>';
      }).join('');
      listBox.querySelectorAll('.wlseg button').forEach(function (b0) {
        var b = /** @type {HTMLElement} */ (b0);
        b.addEventListener('click', function () {
          var r = results[parseInt(/** @type {string} */ (b.dataset.i), 10)];
          if (!r) return;
          var won = b.dataset.won === '1';
          if (r.won !== won) { r.won = won; recompute(); }
        });
      });
      listBox.querySelectorAll('.rm').forEach(function (b0) {
        var b = /** @type {HTMLElement} */ (b0);
        b.addEventListener('click', function () {
          results.splice(parseInt(/** @type {string} */ (b.dataset.i), 10), 1);
          recompute();
        });
      });
    }

    function recompute() {
      var my = ++seq;
      renderRows(null);  // 同期再描画 (stale index 防止)
      /** @type {number[]} */
      var uids = [];
      results.forEach(function (r) { if (r.uid && uids.indexOf(r.uid) < 0) uids.push(r.uid); });
      Promise.all(uids.map(oppInit)).then(function (inits) {
        if (my !== seq) return;  // より新しい recompute が居るので破棄
        /** @type {Map<number, OppInit>} */
        var oppState = new Map();
        uids.forEach(function (u, i) { oppState.set(u, inits[i]); });
        simulate(oppState);
      });
    }

    /** @param {Map<number, OppInit>} oppState */
    function simulate(oppState) {
      var ts = ev.start_at;
      var me2 = new C.G2Player(st.rating, st.rd, 0.06);
      if (st.lastSeenTs) C.applyInactivity(me2, (ts - st.lastSeenTs) / 86400);
      /** @type {Map<number | string, any>} */
      var opps = new Map();   // 値は C.G2Player (関数コンストラクタなので型は any)
      oppState.forEach(function (o, uid) {
        var p = new C.G2Player(o.rating, o.rd, 0.06);
        if (o.lastTs) C.applyInactivity(p, (ts - o.lastTs) / 86400);
        opps.set(uid, p);
      });
      var beforeRating = me2.rating();
      var oppMeta2 = { nent: nentOf(ev), isWeekend: !!ev.is_weekend, isCapped: !!(ev.is_restricted || ev.is_lower_class) };
      /** @type {number[]} */
      var deltas = [];
      results.forEach(function (r) {
        // uid 不明の相手も tag 単位で状態を保持 (同一相手 2 回目は 1 回目の結果を引き継ぐ)
        var key = r.uid || ('tag:' + r.tag);
        var opp = opps.get(key);
        if (!opp) { opp = new C.G2Player(1500, 350, 0.06); opps.set(key, opp); }
        var oppM = r.uid ? MASTER.get(r.uid) : null;
        var oppLv = oppM ? oppM.lv : 1;
        var meUpd = g.pass; // 自分の gating (大会単位)
        var oppUpd = C.tournamentPassesLv(oppLv, oppMeta2);
        var mr = me2.rating(), mrd = me2.rd(), or_ = opp.rating(), ord_ = opp.rd();
        var before = me2.rating();
        if (meUpd) me2.update([or_], [ord_], [r.won ? 1 : 0]);
        if (oppUpd) opp.update([mr], [mrd], [r.won ? 0 : 1]);
        deltas.push(me2.rating() - before);
      });
      var afterRating = me2.rating();
      // 直対評価スコア (180d peak): 大会時点の窓 + 大会後レート
      var curBtElo = me.scores.bt_gated_elo || 0;
      // 試合前の大会日時点ピーク (窓スライドで現在値より下がることがある)
      var basePeak = C.peakAt(st.history, ts, beforeRating);
      var windowDrop = curBtElo - basePeak;
      // 大会時点の 180 日窓ピーク + シミュ後レートの max
      var peakAfter = Math.max(C.peakAt(st.history, ts, afterRating), afterRating);
      var newBtRank = C.provisionalRank(btArr, peakAfter, UID);
      var curBtRank = (me.ranks || {}).bt_gated || 0;

      renderRows(deltas);

      state.bt = results.length ? peakAfter : null;
      state.btRank = results.length ? newBtRank : null;
      updateEns(panel, state);
      if (!results.length) { resBox.style.display = 'none'; return; }
      var dInt = afterRating - beforeRating;
      var dPeak = peakAfter - curBtElo;
      var dMatch = peakAfter - basePeak;
      var rankDiff = curBtRank ? curBtRank - newBtRank : 0;
      resBox.style.display = '';
      resBox.innerHTML =
        '<div>' + i18n('player.chart.internal_rating') + ' ' + fmt1(beforeRating) + ' → <b>' + fmt1(afterRating) + '</b> ' +
        '<span class="' + (dInt >= 0 ? 'up' : 'down') + '">(' + signed(dInt) + ')</span></div>' +
        '<div>' + i18n('player.chart.bt_score_label') + ' ' + fmt1(curBtElo) + ' → <b>' + fmt1(peakAfter) + '</b> ' +
        '<span class="' + (dPeak >= 0 ? 'up' : 'down') + '">(' + signed(dPeak) + ')</span>' +
        (windowDrop > 0.05 ? ' <span class="muted">' + i18n('sim.window_drop', { drop: signed(-windowDrop), match: signed(dMatch) }) + '</span>' : '') + '</div>' +
        '<div>' + i18n('sim.provisional_rank', { label: i18n('ranking.tab.bt') }) + ' ' + (curBtRank ? '#' + curBtRank : '–') + ' → <b>#' + newBtRank + '</b>' +
        (rankDiff > 0 ? ' <span class="up">(↑' + rankDiff + ')</span>' : rankDiff < 0 ? ' <span class="down">(↓' + (-rankDiff) + ')</span>' : '') + '</div>';
    }
  }

  // ---- プレイヤー検索 ----
  function setupPlayerSearch() {
    var input = /** @type {HTMLInputElement} */ (document.getElementById('psearch'));
    var sug = /** @type {HTMLElement} */ (document.getElementById('psearch-suggest'));
    /** @typedef {{ uid: number, display: string, rank: number | null | undefined }} SearchRow */
    /** @type {SearchRow[] | null} */
    var all = null;
    function ensureAll() {
      if (all) return all;
      /** @type {SearchRow[]} */
      var list = [];
      MASTER.forEach(function (v, uid) { list.push({ uid: uid, display: v.display, rank: v.tjpr_rank }); });
      all = list;
      return all;
    }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      if (!q) { sug.classList.remove('open'); return; }
      var hits = ensureAll().filter(function (p) {
        return p.display.toLowerCase().indexOf(q) >= 0 || String(p.uid).indexOf(q) >= 0;
      }).slice(0, 20);
      sug.innerHTML = hits.map(function (p) {
        return '<div class="item" data-uid="' + esc(p.uid) + '"><span>' + esc(p.display) + '</span>' +
          '<span class="meta">uid ' + esc(p.uid) + '</span></div>';
      }).join('') || '<div class="item"><span class="meta">' + i18n('common.none') + '</span></div>';
      sug.classList.add('open');
    });
    /** @param {HTMLElement} item */
    function pickPlayer(item) {
      location.search = '?uid=' + encodeURIComponent(/** @type {string} */ (item.dataset.uid));
    }
    sug.addEventListener('click', function (e) {
      var item = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('.item') : null);
      if (!item || !item.dataset.uid) return;
      pickPlayer(item);
    });
    attachSuggestNav(input, sug, pickPlayer);
  }

  // ---- 大会検索 (任意の大会を追加) ----
  function setupTourSearch() {
    var input = /** @type {HTMLInputElement} */ (document.getElementById('tsearch'));
    var sug = /** @type {HTMLElement} */ (document.getElementById('tsearch-suggest'));
    function renderSug() {
      var up = /** @type {Upcoming} */ (UPCOMING);   // 描画後にしか呼ばれない
      var q = input.value.trim().toLowerCase();
      var st = selfState();
      var myEids = (up.by_uid[String(UID)] || []).map(String);
      var now = Date.now() / 1000;
      var evs = Object.keys(up.events).filter(function (eid) {
        var ev = up.events[eid];
        return ev && ev.start_at && ev.start_at + 86400 > now;  // 開催後24h超は出さない
      }).map(function (eid) {
        var ev = up.events[eid];
        var entered = myEids.indexOf(eid) >= 0;
        var pass = gateInfo(ev, st.lv).pass;
        // 表示順: 参加予定∧集計対象 → 集計対象 → 参加予定 → その他 (各グループ内は開催日順)
        var group = entered && pass ? 0 : pass ? 1 : entered ? 2 : 3;
        return { eid: eid, ev: ev, entered: entered, pass: pass, group: group };
      }).filter(function (x) {
        return !q || (x.ev.tournament_name || '').toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) {
        return a.group - b.group || a.ev.start_at - b.ev.start_at;
      });
      sug.innerHTML = evs.slice(0, 40).map(function (x) {
        var tags = (x.entered ? '<span class="badge wk">' + i18n('sim.badge.entered') + '</span>' : '') +
                   (x.pass ? '<span class="badge ok">' + i18n('player.counted') + '</span>' : '<span class="badge ng">' + i18n('player.not_counted') + '</span>');
        return '<div class="item" data-eid="' + esc(x.eid) + '"><span>' + esc(x.ev.tournament_name) + tags + '</span>' +
          '<span class="meta">' + dateStr(x.ev.start_at) + ' ' + i18n('player.upcoming.entrants', { n: nentOf(x.ev) }) + '</span></div>';
      }).join('') || '<div class="item"><span class="meta">' + i18n('common.none') + '</span></div>';
      sug.classList.add('open');
    }
    input.addEventListener('focus', renderSug);
    input.addEventListener('input', renderSug);
    /** @param {HTMLElement} item */
    function pickTour(item) {
      sug.classList.remove('open');
      input.value = '';
      addTourCard(/** @type {string} */ (item.dataset.eid));
    }
    sug.addEventListener('click', function (e) {
      var item = /** @type {HTMLElement | null} */ (e.target instanceof Element ? e.target.closest('.item') : null);
      if (!item || !item.dataset.eid) return;
      pickTour(item);
    });
    attachSuggestNav(input, sug, pickTour);
  }
})();
