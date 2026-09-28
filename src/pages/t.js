// @ts-check
// src/pages/t.js — site/t/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/t.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPCharEmoji from '../../site/js/char_emoji.js';
import SPSPLinks from '../../site/js/links.js';
import '../../site/js/data.js';
import SPSPPlayerData from '../../site/js/player_data.js';
import SPSPFormat from '../../site/js/format.js';
import SPSPPager from '../../site/js/pager.js';
import SPSPMatch from '../../site/js/match.js';
import SPSPTags from '../../site/js/tags.js';
import '../../site/nav.js';
import '../../site/share.js';
import { SPSPTrackPage } from '../../site/nav.js';
import SPSPShare from '../../site/share.js';
import SPSPGeo from '../../site/js/geo.js';

'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

const params = new URLSearchParams(location.search);
const TID = parseInt(params.get('id') || location.hash.replace(/^#/, '') || '0');

/** tournaments/<id>.json の standings / highlights の 1 人分 (順位・シード・当時の評価変動) */
/** @typedef {{ user_id: number, display: string, place?: number, seed?: number | null, spr?: number | null, tjpr_raw: number,
 *              bt_d?: number, bt_internal_d?: number, bt_used?: boolean, at_lv?: number,
 *              pretour_ranks?: Record<string, number | null>, global_ranks?: Record<string, number | null>,
 *              rank_delta_ensemble?: number | null, rank_delta_tjpr?: number | null, rank_delta_bt?: number | null,
 *              tjpr_pts_at?: number | null, losers_run?: number, perf_rank?: number, [k: string]: any }} Standing */
/** 試合 (matches の要素。並べ替え・ブラケット表記は ../js/match.js) */
/** @typedef {{ w_id: number, l_id: number, w_score?: number | null, l_score?: number | null, round_text?: string, global_bracket_label?: string,
 *              w_d?: number, l_d?: number, w_tracked?: boolean, l_tracked?: boolean, [k: string]: any }} TMatch */
/** tournaments/<id>.json */
/** @typedef {{ event_id: number, name: string, event_name?: string, startgg_url?: string, date: string, end_date?: string, nent?: number,
 *              standings: Standing[], matches?: TMatch[],
 *              highlights?: { top_match_upsets?: { winner: Standing, loser: Standing, uf: number }[], top_contrib_points?: Standing[],
 *                             top_spr_gains?: Standing[], top_bt_gains?: Standing[], top_losers_runs?: Standing[],
 *                             top_rank_gains_ensemble?: Standing[], top_rank_gains_tjpr?: Standing[], top_rank_gains_bt?: Standing[] },
 *              [k: string]: any }} Tourney */

/** @type {SpspRankMeta & { params?: { ELO_PER_UNIT?: number, TJPR_ELO_SCALE?: number, [k: string]: any } } | null} */
let META = null;
/** @type {Tourney | null} */
let TOURNEY = null;
/** @type {any} */
let CURRENT = null;            // players_current.json (全選手の現在順位。SPSPPlayerData.currentRank で引く)
/** @type {string | null} */
let TOURNEY_PREF = null;       // この大会の開催地 都道府県 (tournament_prefectures.json[TID])
/** @type {Record<string, string> | null} */
let CHAR_EMOJI_BY_UID = null;  // uid -> メイン使用キャラ絵文字 (character_index × char_emoji)

const fmtRank = SPSPFormat.fmtRank;   // ../js/format.js

// uid -> メイン使用キャラ絵文字 (character_index.main_by_char 逆引き × char_emoji)。
/** @param {number | null | undefined} uid @returns {string} */
function charEmojiOf(uid) {
  return (uid != null && CHAR_EMOJI_BY_UID && CHAR_EMOJI_BY_UID[uid]) || '';
}

async function load() {
  if (!TID || TID < 1) { showNotFound(); return; }
  try {
    const [metaRes, tRes, tprefRes, , charIdxRes, charEmojiRes, curFile] = await Promise.all([
      fetch(SPSP.data + 'meta.json'),
      fetch(SPSP.data + `tournaments/${TID}.json`),
      fetch(SPSP.data + 'data/tournament_prefectures.json').catch(() => null),
      SPSPGeo.loadGeo(/** @type {string} */ (SPSP.root)).catch(() => null),   // 開催地の表示名 (英語ページでは Chiba)
      fetch(SPSP.data + 'data/character_index.json').catch(() => null),
      fetch(SPSPCharEmoji.url()).catch(() => null),
      // 参加者の現在の全国順位 (大会 JSON には当時の値だけがある。../js/player_data.js)
      SPSPPlayerData.loadCurrent(SPSP.data).catch(() => null),
    ]);
    if (!tRes.ok) { showNotFound(); return; }
    META = await metaRes.json();
    TOURNEY = await tRes.json();
    CURRENT = curFile;
    if (tprefRes && tprefRes.ok) {
      try { TOURNEY_PREF = (await tprefRes.json())[String(TID)] || null; } catch (e) {}
    }
    // uid -> キャラ絵文字 マップ (character_index.main_by_char × char_emoji)。
    if (charIdxRes && charIdxRes.ok && charEmojiRes && charEmojiRes.ok) {
      try {
        const idx = await charIdxRes.json();
        const ce = await charEmojiRes.json();
        /** @type {Record<string, string>} */
        const byUid = {};
        CHAR_EMOJI_BY_UID = byUid;
        const mbc = idx.main_by_char || {};
        for (const cid in mbc) {
          const em = ce[cid] && ce[cid].emoji;
          if (!em) continue;
          for (const u of mbc[cid]) byUid[u] = em;
        }
      } catch (e) {}
    }
    render();
  } catch (e) {
    // 大会 JSON の 404 は上で showNotFound 済み。ここに来るのは取得・描画の失敗 = バグや通信エラーなので、
    // 「大会が見つかりません」に化けさせず、そのまま見せる。
    console.error(e);
    const el = document.getElementById('loading');
    const err = /** @type {any} */ (e);
    if (el) { el.textContent = i18n('tournament.render_failed', { message: (err && err.message ? err.message : err) }); el.style.display = ''; }
  }
}

function showNotFound() {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
  const notFound = document.getElementById('not-found');
  if (notFound) notFound.style.display = '';
}

// escapeHtml は ../js/html.js (サイト共通)

/** @param {Standing} p @returns {string} */
function playerLink(p) {
  const em = charEmojiOf(p.user_id);
  const pre = em ? em + ' ' : '';
  if (p.user_id == null) return pre + escapeHtml(p.display);
  return pre + SPSPLinks.playerLink(SPSP.langRoot, p.user_id, escapeHtml(p.display));
}

/** @param {number | null | undefined} p @returns {string} */
function placeClass(p) {
  if (p === 1) return 'gold';
  if (p === 2) return 'silver';
  if (p === 3) return 'bronze';
  return '';
}

// 大会ページの「全国 #」は参加前 (= 大会開催時点) の順位を表示する.
// pretour_ranks が無い古いデータは現在の順位 (players_current.json) に fallback.
/** @param {Standing | null | undefined} p @param {string} field @returns {number | null} */
function preRank(p, field) {
  if (p && p.pretour_ranks && p.pretour_ranks[field] != null) return p.pretour_ranks[field];
  return curRank(p, field);
}
// 現在の全国順位。大会 JSON からは外した (毎ビルド全大会が書き換わる原因だった) ので players_current.json から
/** @param {Standing | null | undefined} p @param {string} field @returns {number | null} */
function curRank(p, field) {
  if (p && p.global_ranks && p.global_ranks[field] != null) return p.global_ranks[field];   // 旧データ互換
  return p ? SPSPPlayerData.currentRank(CURRENT, p.user_id, field) : null;
}

// 当時のレベル表記 (lv = 当時の TJPR レベル、rank = 当時の全国順位で +/メダルを判定)。../js/format.js
const lvLabel = SPSPFormat.lvLabel;

function render() {
  if (!TOURNEY || !META) return;
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
  const shareCard = document.getElementById('share-card');
  if (shareCard) shareCard.style.display = '';
  const shareRow = document.getElementById('share-row');
  if (shareRow) shareRow.style.display = '';
  document.title = `${TOURNEY.name} — SPSP`;
  if (SPSPTrackPage) {
    SPSPTrackPage(document.title, `/t/id${TID}`);
  }

  // Hero
  const nameEl = document.getElementById('name');
  if (nameEl) nameEl.textContent = TOURNEY.name;
  const eventEl = document.getElementById('event');
  if (eventEl) eventEl.textContent = TOURNEY.event_name || '';
  if (TOURNEY.startgg_url) {
    const lnk = /** @type {HTMLAnchorElement | null} */ (document.getElementById('startgg-link'));
    if (lnk) {
      lnk.href = TOURNEY.startgg_url;
      lnk.style.display = '';
    }
  }
  /** @type {string[]} */
  const chips = [];
  // 決勝(Grand Finals)未報告 = 優勝者未確定の未完了大会。BT/TJPR 集計対象外 (= ポイント未反映、
  // 暫定順位のみ)。決勝が報告され次第、再取得で正式集計される。
  // タグの文言・判定は ../js/tags.js (events/ / sim/ / player-detail.js と共通)。ここでは chip のクラス名だけ
  const st = SPSPTags.statusTag(TOURNEY, { resume: 'chip resume', gf: 'chip gf' });
  if (st) chips.push(st);
  chips.push(SPSPTags.dayTag(TOURNEY, { wk: 'chip wk', wd: 'chip wd' }));
  chips.push(...SPSPTags.flagTags(TOURNEY, { pre: 'chip pre', res: 'chip res', lc: 'chip lc' }));
  // 開催地の都道府県 (tournament_prefectures.json[TID])。
  const locHtml = TOURNEY_PREF ? `📍${escapeHtml(SPSPGeo.unitName(TOURNEY_PREF))} · ` : '';
  const metaLine = document.getElementById('meta-line');
  if (metaLine) metaLine.innerHTML =
    `${TOURNEY.date}${TOURNEY.end_date && TOURNEY.end_date !== TOURNEY.date ? ' 〜 ' + TOURNEY.end_date : ''} · ` +
    `${locHtml}<b style="color:#111827">${TOURNEY.nent || TOURNEY.standings.length}</b> ${i18n('common.unit_people')} ${chips.join('')}`;

  // Podium
  const top3 = TOURNEY.standings.slice(0, 3);
  const podiumOrder = [top3[1], top3[0], top3[2]]; // silver, gold, bronze visually
  const cls = ['silver', 'gold', 'bronze'];
  const medals = ['🥈', '🥇', '🥉'];
  const podium = document.getElementById('podium');
  if (podium) podium.innerHTML = podiumOrder.map((p, i) => {
    if (!p) return '<div></div>';
    const er = preRank(p, 'ensemble');
    const grank = er != null
      ? `<div class="grank">${i18n('common.national')} #${er}</div>` : '';
    return `<div class="podium-card ${cls[i]}">
      <div class="medal">${medals[i]}</div>
      <div class="place">${i18n('tournament.place_spaced', { place: p.place })}</div>
      <div class="player">${playerLink(p)}</div>
      ${grank}
    </div>`;
  }).join('');

  // Highlights — tour-item (place | meta | value) スタイルで統一
  const hl = TOURNEY.highlights || {};
  /** @param {Standing[] | undefined} arr @param {(p: Standing) => string} valueFn @param {string} emptyMsg @returns {string} */
  function renderHl(arr, valueFn, emptyMsg) {
    if (!arr || !arr.length) return `<div class="empty-msg" style="padding:12px">${emptyMsg}</div>`;
    return arr.map(p => {
      const er = preRank(p, 'ensemble');
      const grank = er != null
        ? `<div class="sub">${i18n('common.national')} #${er}</div>` : '';
      return `<div class="tour-item">
        <span class="place ${placeClass(p.place)}">${p.place}</span>
        <div class="meta">${playerLink(p)}${grank}</div>
        <div class="v">${valueFn(p)}</div>
      </div>`;
    }).join('');
  }
  // アップセット: match-row スタイル (winner(seed) vs loser(seed) — UF)
  /** @param {{ winner: Standing, loser: Standing, uf: number }[] | undefined} arr @returns {string} */
  function renderMatchUpsets(arr) {
    if (!arr || !arr.length) return `<div class="empty-msg" style="padding:12px">${i18n('tournament.empty.upsets')}</div>`;
    return arr.map(u => {
      const w = u.winner, l = u.loser;
      const wSeed = w.seed != null ? `<span class="m-seed">#${w.seed}</span>` : '';
      const lSeed = l.seed != null ? `<span class="m-seed">#${l.seed}</span>` : '';
      return `<div class="match-row">
        <span class="m-content">
          <span class="m-player"><div>${playerLink(w)}</div>${wSeed}</span>
          <span class="m-score" style="color:#16a34a">▶</span>
          <span class="m-opp"><div>${playerLink(l)}</div>${lSeed}</span>
        </span>
        <span class="m-uf"><span class="num">+${u.uf}</span><span class="frac">UF</span></span>
      </div>`;
    }).join('');
  }
  const ELO_PER_UNIT = (META.params && META.params.ELO_PER_UNIT) || 29.48;
  const TJPR_SCALE = (META.params && META.params.TJPR_ELO_SCALE) || 17.5;

  // ページ送り (../js/pager.js、p/ と共通)
  const setupPaginated = SPSPPager.setupPaginated;

  setupPaginated(hl.top_match_upsets, 'top-upsets', 'top-upsets-pager',
    renderMatchUpsets, i18n('tournament.empty.upsets'));
  // 順位評価上昇 = 当時この大会でのスコア上昇分 (tjpr_pts_at)。
  // 旧ビルドの JSON は tjpr_raw 順のままなのでクライアント側でも sort し直す。
  const tjprGains = (hl.top_contrib_points || [])
    .filter(p => (p.tjpr_pts_at || 0) > 0)
    .slice().sort((a, b) => (b.tjpr_pts_at || 0) - (a.tjpr_pts_at || 0));
  setupPaginated(tjprGains, 'top-points', 'top-points-pager',
    arr => renderHl(arr, p => `+${((p.tjpr_pts_at || 0) * TJPR_SCALE).toFixed(1)}<span class="frac">pt</span>`, i18n('tournament.empty.tjpr_gain')),
    i18n('tournament.empty.tjpr_gain'));
  setupPaginated(hl.top_spr_gains, 'top-spr', 'top-spr-pager',
    arr => renderHl(arr, p => `+${p.spr}<span class="frac">SPR</span>`, i18n('tournament.empty.spr')),
    i18n('tournament.empty.spr'));
  setupPaginated(hl.top_bt_gains, 'top-bt', 'top-bt-pager',
    arr => renderHl(arr, p => {
      const peakD = (p.bt_d || 0) * ELO_PER_UNIT;
      const intD = (p.bt_internal_d || 0) * ELO_PER_UNIT;
      const intStr = Math.abs(intD) > 0.01
        ? `<span class="frac">(${intD > 0 ? '+' : ''}${intD.toFixed(1)})</span>`
        : '';
      return `+${peakD.toFixed(1)}${intStr}`;
    }, i18n('tournament.empty.bt_gain')),
    i18n('tournament.empty.bt_gain'));
  setupPaginated(hl.top_losers_runs, 'top-losers-runs', 'top-losers-runs-pager',
    arr => renderHl(arr, p => `${p.losers_run}<span class="frac">${i18n('common.win_streak')}</span>`, i18n('tournament.empty.losers_run')),
    i18n('tournament.empty.losers_run'));

  // 順位上昇: 「前順位 → 後順位 ↑Δ位」形式. pretour_ranks が参加前 (= before), delta が改善幅.
  // after = before - delta (rank が小さくなる = 改善).
  /** @param {Standing} p @param {string} deltaField @param {string} rankField @returns {string} */
  function rankGainValue(p, deltaField, rankField) {
    const d = p[deltaField];
    if (d == null) return '<span class="dim">—</span>';
    const before = preRank(p, rankField);
    if (before == null) {
      return `↑${d}<span class="frac">${i18n('tournament.climb_unit', { n: d })}</span>`;
    }
    const after = before - d;
    return `<span style="font-size:11px;color:#6b7280">#${before.toLocaleString()} → #${after.toLocaleString()}</span><span class="frac" style="color:#16a34a">↑${d.toLocaleString()}${i18n('tournament.climb_unit', { n: d })}</span>`;
  }
  setupPaginated(hl.top_rank_gains_ensemble, 'top-rank-ens', 'top-rank-ens-pager',
    arr => renderHl(arr, p => rankGainValue(p, 'rank_delta_ensemble', 'ensemble'), i18n('tournament.empty.rank_gain')),
    i18n('tournament.empty.rank_gain'));
  setupPaginated(hl.top_rank_gains_tjpr, 'top-rank-tjpr', 'top-rank-tjpr-pager',
    arr => renderHl(arr, p => rankGainValue(p, 'rank_delta_tjpr', 'tjpr'), i18n('tournament.empty.rank_gain')),
    i18n('tournament.empty.rank_gain'));
  setupPaginated(hl.top_rank_gains_bt, 'top-rank-bt', 'top-rank-bt-pager',
    arr => renderHl(arr, p => rankGainValue(p, 'rank_delta_bt', 'bt_gated'), i18n('tournament.empty.rank_gain')),
    i18n('tournament.empty.rank_gain'));

  // Full standings
  renderStandings();
}

let stdFilter = '';
function renderStandings() {
  if (!TOURNEY || !META) return;
  const T = TOURNEY;   // 閉包の中でも null でない型に
  const list = document.getElementById('std-list');
  if (!list) return;
  const ELO_PER_UNIT = (META.params && META.params.ELO_PER_UNIT) || 29.48;
  const TJPR_SCALE = (META.params && META.params.TJPR_ELO_SCALE) || 17.5;
  const ft = stdFilter.toLowerCase();
  const rows = TOURNEY.standings.filter(p => !ft || (p.display || '').toLowerCase().includes(ft));
  list.innerHTML = rows.map(p => {
    const placeStr = p.place != null ? p.place : '—';
    const placeCls = placeClass(p.place);
    const er = preRank(p, 'ensemble');                         // 当時 (参加前) の全国#
    const after = (er != null && p.rank_delta_ensemble != null) // T直後 (大会結果確定直後) の全国#
      ? (er - p.rank_delta_ensemble) : null;
    const cur = curRank(p, 'ensemble');                        // 現在の全国#
    const grank = er != null
      ? `<div class="sub">${i18n('player.national_then')} #${er}${after != null ? ' → #' + after : ''}${cur != null ? ' ' + i18n('tournament.now_rank', { rank: cur }) : ''}</div>` : '';
    // SPR chip. sub 行に seed 番号を表示 (= 他 chip と高さ揃える).
    const seedSub = p.seed != null
      ? `<span class="sub">seed ${p.seed}</span>`
      : `<span class="sub">&nbsp;</span>`;
    let sprChip;
    if (p.spr != null) {
      const cls = p.spr > 0 ? 'pos' : (p.spr < 0 ? 'neg' : 'dim');
      const txt = p.spr > 0 ? `+${p.spr}` : (p.spr < 0 ? `${p.spr}` : '±0');
      sprChip = `<div class="chip"><span class="lbl lbl-en">SPR</span><span class="val ${cls}">${txt}</span>${seedSub}</div>`;
    } else {
      sprChip = `<div class="chip"><span class="lbl lbl-en">SPR</span><span class="val dim">—</span>${seedSub}</div>`;
    }
    // 順位評価 chip: 「当時その大会で獲得した raw pt」(= tjpr_pts_at) を表示.
    //   null = 当時の計上対象外 (制限大会×当時top1024 圏内) → "−"
    const subBlank = `<span class="sub">&nbsp;</span>`;
    const ptsAt = p.tjpr_pts_at;
    let tjprValHtml;
    if (ptsAt == null) {
      tjprValHtml = `<span class="val dim">−</span>`;
    } else {
      const v = ptsAt * TJPR_SCALE;
      tjprValHtml = v > 0.05 ? `<span class="val pos">+${v.toFixed(1)}</span>` : `<span class="val dim">±0</span>`;
    }
    // sub 行の ( ) は減衰前のベース pt (= tjpr_raw)。直対評価 chip の sub 表記と同スタイル。
    const tjprSubHtml = (ptsAt != null && p.tjpr_raw > 0)
      ? `<span class="sub" title="${i18n('detail.base_pt_title')}">(${(p.tjpr_raw * TJPR_SCALE).toFixed(1)})</span>`
      : subBlank;
    const tjprChip = `<div class="chip"><span class="lbl">${i18n('ranking.tab.tjpr')}</span>${tjprValHtml}${tjprSubHtml}</div>`;
    // 直対評価 chip: 当時の BT レート変動 (時系列の bt_d=peak180 主 / bt_internal_d を ( )).
    // bt_used=false (= 当時その大会で BT が更新されなかった) は "−".
    const peakD = (p.bt_d || 0) * ELO_PER_UNIT;
    const intD = (p.bt_internal_d || 0) * ELO_PER_UNIT;
    let btValHtml;
    if (!p.bt_used) {
      btValHtml = `<span class="val dim">−</span>`;
    } else if (Math.abs(peakD) > 0.05) {
      btValHtml = `<span class="val ${peakD > 0 ? 'pos' : 'neg'}">${peakD > 0 ? '+' : ''}${peakD.toFixed(1)}</span>`;
    } else {
      btValHtml = `<span class="val dim">±0</span>`;
    }
    const btSubHtml = p.bt_used
      ? `<span class="sub">(${intD >= 0 ? '+' : ''}${intD.toFixed(1)})</span>` : subBlank;
    const btChip = `<div class="chip"><span class="lbl">${i18n('ranking.tab.bt')}</span>${btValHtml}${btSubHtml}</div>`;
    const vHtml = `<div class="v-stats">${sprChip}${tjprChip}${btChip}<span class="chevron">▶</span></div>`;
    const nentTotal = T.nent || T.standings.length;
    const placeFrac = nentTotal ? `<span class="frac">/${nentTotal}</span>` : '';
    return `<div class="tour-group" data-uid="${p.user_id}">
      <div class="tour-item">
        <span class="place ${placeCls}"><span class="num">${placeStr}</span>${placeFrac}</span>
        <div class="meta">${playerLink(p)}${grank}</div>
        ${vHtml}
      </div>
      <div class="tour-matches"></div>
    </div>`;
  }).join('');
}

// ブラケット表記の短縮・試合の並び・DE の W2W 換算は ../js/match.js (p/ と共通)
const { compactBracketLabel, placementToW2W, sortMatches } = SPSPMatch;

/** @param {number} uid @returns {string} */
function _displayByUid(uid) {
  // standings から取得
  const p = (/** @type {Tourney} */ (TOURNEY).standings || []).find(x => x.user_id === uid);
  return p ? p.display : `uid ${uid}`;
}
/** @param {number} uid @returns {number | null | undefined} */
function _seedByUid(uid) {
  const p = (/** @type {Tourney} */ (TOURNEY).standings || []).find(x => x.user_id === uid);
  return p ? p.seed : null;
}
/** @param {number} uid @returns {string} */
function renderPlayerMatches(uid) {
  const T = /** @type {Tourney} */ (TOURNEY), M = /** @type {NonNullable<typeof META>} */ (META);   // 展開は描画後にしか起きない
  const all = T.matches || [];
  const mine = all.filter(m => m.w_id === uid || m.l_id === uid);
  if (!mine.length) return `<div style="padding:8px 12px;color:#9ca3af;font-size:11px">${i18n('common.no_match_data')}</div>`;
  const sorted = sortMatches(mine);
  const ELO_PER_UNIT = (M.params && M.params.ELO_PER_UNIT) || 29.48;
  // モバイル時は各 match-row で本人名を省略するので、展開冒頭に「name + seed」を一回表示.
  const myName = _displayByUid(uid);
  const mySeed = _seedByUid(uid);
  const header = (myName || mySeed != null)
    ? `<div class="match-header">${escapeHtml(myName || '')}${mySeed != null ? `<span class="seed">#${mySeed}</span>` : ''}</div>`
    : '';
  return header + sorted.map(m => {
    const won = m.w_id === uid;
    const oppUid = won ? m.l_id : m.w_id;
    const pScore = won ? m.w_score : m.l_score;
    const oScore = won ? m.l_score : m.w_score;
    const score = (pScore != null && oScore != null) ? `${pScore}-${oScore}` : '—';
    const scoreColor = won ? '#16a34a' : '#2563eb';
    const bracket = compactBracketLabel(m.global_bracket_label, m.round_text, m.bracket_type);
    const oppName = escapeHtml(_displayByUid(oppUid));
    const oppEmoji = charEmojiOf(oppUid);
    const oppLink = (oppEmoji ? oppEmoji + ' ' : '') + SPSPLinks.playerLink(SPSP.langRoot, oppUid, oppName);
    const oSeed = _seedByUid(oppUid);
    const pSeed = _seedByUid(uid);
    const pSeedHtml = pSeed != null ? `<span class="m-seed">#${pSeed}</span>` : '';
    const oSeedHtml = oSeed != null ? `<span class="m-seed">#${oSeed}</span>` : '';
    // 内部レート delta: 勝者 / 敗者 で対応する側を表示. tracked=true なら 0 でも表示.
    const dOrd = won ? (m.w_d || 0) : (m.l_d || 0);
    const tracked = won ? !!m.w_tracked : !!m.l_tracked;
    const dElo = dOrd * ELO_PER_UNIT;
    let dStr = '', dColor = '#9ca3af';
    if (tracked) {
      dStr = `${dElo >= 0 ? '+' : ''}${dElo.toFixed(1)}`;
      dColor = won ? '#16a34a' : '#2563eb';
    }
    // UF: 自分が勝って高シードを倒した場合のみ score 下に表記.
    let ufHtml = '';
    if (won && pSeed != null && oSeed != null && pSeed > oSeed) {
      const uf = placementToW2W(pSeed) - placementToW2W(oSeed);
      if (uf > 0) {
        ufHtml = `<div style="font-size:10px;line-height:1.1;margin-top:1px"><span style="color:#16a34a;font-weight:600">+${uf}</span> <span style="color:#9ca3af">UF</span></div>`;
      }
    }
    return `<div class="match-row t-match">
      <span class="m-bracket">${bracket}</span>
      <span class="m-content">
        <span class="m-player"><div>${escapeHtml(_displayByUid(uid))}</div>${pSeedHtml}</span>
        <span class="m-score" style="color:${scoreColor};display:inline-block;text-align:center">
          <div>${score}</div>
          ${ufHtml}
        </span>
        <span class="m-opp"><div>${oppLink}</div>${oSeedHtml}</span>
      </span>
      <span class="m-delta" style="color:${dColor}">${dStr}</span>
    </div>`;
  }).join('');
}
// click delegation for tour-group expand
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const ti = target && target.closest('.tour-group .tour-item');
  if (!ti) return;
  if (target && target.closest('a')) return;  // リンクは遷移優先
  const grp = /** @type {HTMLElement | null} */ (ti.closest('.tour-group'));
  if (!grp) return;
  const wasExpanded = grp.classList.contains('expanded');
  grp.classList.toggle('expanded');
  if (!wasExpanded) {
    const matchesEl = /** @type {HTMLElement | null} */ (grp.querySelector('.tour-matches'));
    if (matchesEl && !matchesEl.dataset.rendered) {
      const uid = parseInt(/** @type {string} */ (grp.dataset.uid));
      matchesEl.innerHTML = renderPlayerMatches(uid);
      matchesEl.dataset.rendered = '1';
    }
  }
});

const stdSearch = document.getElementById('std-search');
if (stdSearch) stdSearch.addEventListener('input', e => {
  stdFilter = /** @type {HTMLInputElement} */ (e.target).value;
  renderStandings();
});

// ── Share ──  (html2canvas の読み込み・保存ボタンの流れは ../share.js)
function capturePng() {
  const target = document.getElementById('share-top') || document.getElementById('share-card');
  return SPSPShare.capturePng(/** @type {HTMLElement} */ (target));
}

SPSPShare.setupSaveButton(document.getElementById('save-btn'), capturePng,
  () => `smash_banzuke_${SPSPShare.safeFileName(TOURNEY && TOURNEY.name, 'tournament')}`);

SPSPShare.setup(document.getElementById('share-icon-btn'), () => TOURNEY ? {
  title: TOURNEY.name,
  text:  i18n('tournament.share.text', { name: TOURNEY.name, n: TOURNEY.nent }),
  url:   location.href,
} : { url: location.href });

load();
