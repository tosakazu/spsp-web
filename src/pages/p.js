// @ts-check
// src/pages/p.js — site/p/index.html のスクリプト。以前はインライン <script> と <script src> の並びだった (2026-09-14 に移動)。
// import が依存 (default import = そのモジュールの api、副作用 import = グローバルに置くだけのもの)。tools/build/build_site.mjs が esbuild で束ねて dist/assets/p.js にする。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPCharEmoji from '../../site/js/char_emoji.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPData from '../../site/js/data.js';
import SPSPPlayerData from '../../site/js/player_data.js';
import SPSPFormat from '../../site/js/format.js';
import SPSPPager from '../../site/js/pager.js';
import SPSPMatch from '../../site/js/match.js';
import '../../site/nav.js';
import '../../site/share.js';
import { SPSPTrackPage } from '../../site/nav.js';
import SPSPShare from '../../site/share.js';
import { charName } from '../../site/js/chars.js';
import { achievementLabel } from '../../site/js/achievements.js';
import SPSPGeo from '../../site/js/geo.js';
import SPSPPlayerCard from '../../site/js/player_card.js';
import SpspLogin from '../../site/js/login.js';
import { buildCardModel, perfInfoOf, achievementBadge, fetchApplied } from '../../site/js/player_card_model.js';

if (window.luxon && window.luxon.Settings) { window.luxon.Settings.defaultZone = 'Asia/Tokyo'; }  // チャートの日付は閲覧者の場所に依らず JST


'use strict';
const i18n = SPSPI18n.t;   // 文言は i18n/ja.js (js/i18n.js)
SPSPI18n.apply(document);   // 静的 HTML の data-i18n を辞書の言語に

/** 出場大会 (players/<uid>.json の tournaments[] / top_tjpr_contribs[] / top_spr[] の 1 件。ビルド v4/output.py が出す) */
/** @typedef {{ event_id?: number | null, parent_event_id?: number | null, name?: string, event?: string, tournament_name?: string, date?: string, ts?: number,
 *              place?: number | null, nent?: number | null, seed?: number | null, spr?: number | null, perf_rank?: number | null,
 *              is_dq?: boolean, is_weekend?: boolean, is_restricted?: boolean, is_lower_class?: boolean, is_awaiting_resume?: boolean, is_gf_missing?: boolean,
 *              pretour_ranks?: Record<string, number | null | undefined>, rank_delta_ensemble?: number | null,
 *              bt_used?: boolean, bt_d?: number, bt_internal_d?: number, tjpr_w?: number, tjpr_raw?: number, tjpr_lv?: number, tjpr_age?: number,
 *              [k: string]: any }} PTour */
/** 試合 (recent_matches[] / top_bt_gains[] / top_ufs[] / max_uf の 1 件。自分から見た相手・スコア) */
/** @typedef {{ event_id?: number | null, tournament_name?: string, date?: string, opp_uid?: number | null, opp_display?: string, opp_seed?: number | null,
 *              won?: boolean, p_score?: number | null, o_score?: number | null, uf?: number, winner_seed?: number | null,
 *              bt_d?: number, bt_internal_d?: number, bt_tracked?: boolean, is_class?: boolean, is_weekend?: boolean,
 *              round_text?: string, global_bracket_label?: string, [k: string]: any }} PMatch */
/** 順位・スコアの履歴 1 行 (history/<uid>.json を ../js/player_data.js が d = 何日前 付きにしたもの) */
/** @typedef {{ d: number, ens?: number | null, tjpr_r?: number | null, bt_g_r?: number | null, tjpr_e?: number | null,
 *              tjpr_lv?: number | null, shared_lv?: number | null, [k: string]: any }} HistRow */
/** @typedef {{ rank?: number | null, when?: string }} PeakRank */
/** @typedef {{ ensemble?: PeakRank, tjpr?: PeakRank, bt_gated?: PeakRank }} PeakRanks */
/** レーダーの生値 (0-1)。無い軸は null */
/** @typedef {{ spr_upper_raw?: number | null, uf_upper_raw?: number | null, uf_lost_raw?: number | null, spr_neg_raw?: number | null, [k: string]: any }} Radar */
/** 主レコードの metadata (players/<uid>.json / latest_tjpr_full.jsonl 共通) */
/** @typedef {{ tour_count_3y: number, matches_count_3y: number, provisional?: boolean,
 *              tour_count_by_period?: Record<string, number>, match_count_by_period?: Record<string, number>,
 *              debut?: { date?: string, event_id?: number | null, tournament_name?: string } | null, [k: string]: unknown }} MainMeta */
/** ヒーロー・ハイライトの主レコード = players/<uid>.json 自身 (display / ranks 入り)。古い JSON では latest_tjpr_full.jsonl の 1 行 */
/** @typedef {{ user_id: number, display: string, ranks: NonNullable<SpspRankRecord['ranks']>, scores: NonNullable<SpspRankRecord['scores']>,
 *              metadata: MainMeta, [k: string]: any }} MainRec */
/** players/<uid>.json (../js/player_data.js が組み立てた後) のうちこのページが読む部分 (contracts/player.schema.json) */
/** @typedef {{ user_id: number, display: string, startgg_discriminator?: string | null, country?: string | null, country_ja?: string | null,
 *              ranks?: SpspRankRecord['ranks'], scores?: SpspRankRecord['scores'], metadata?: MainMeta,
 *              achievements?: (SpspAchievement | string)[], dynamic_badges?: SpspDynamicBadge[], characters?: SpspCharacterUse[], radar?: Radar,
 *              tournaments?: PTour[], recent_matches?: PMatch[], history?: HistRow[],
 *              top_tjpr_contribs?: PTour[], top_spr?: PTour[], top_bt_gains?: PMatch[], top_ufs?: PMatch[],
 *              peak_ranks?: PeakRanks, peak_ranks_1y?: PeakRanks, max_uf?: PMatch | null, max_spr?: PTour | null,
 *              max_losers_run?: { run: number, place?: number | null, nent?: number | null, date?: string, event_id?: number | null, tournament_name?: string } | null,
 *              bt_timeline_g2?: { date: string, rating: number, [k: string]: any }[], bt_timeline?: { date: string, ord: number, [k: string]: any }[],
 *              [k: string]: any }} PlayerJson */
/** meta.json のうちこのページが読む部分 (params = ビルドの定数、score_ranges = レーダーの順位正規化用) */
/** @typedef {SpspRankMeta & { eval_date: string, n_players: number,
 *              params?: { ELO_PER_UNIT?: number, TJPR_ELO_SCALE?: number, BT_ELO_OFFSET?: number, LV_FILTERS_EFFECTIVE?: Record<string, { min_nent_gt?: number }>, [k: string]: any },
 *              score_ranges?: { tjpr_n_ranked?: number, bt_n_ranked?: number, tjpr_radar_alpha?: number, [k: string]: any } }} PMeta */
/** data/player_subranks.json の 1 人分 (キャラ内 / 都道府県内の順位 = 全国順位順) */
/** @typedef {{ id?: number, name?: string, rank: number }} SubrankEntry */
/** @typedef {{ char?: SubrankEntry & { id: number }, pref?: SubrankEntry & { name: string } }} Subranks */
/** data/char_emoji.json の 1 件 (char_id キー) */
/** @typedef {{ name: string, emoji: string }} CharEmoji */

// 出場大会の行に付くタグ (制限大会 / 下位クラス / 再開待ち・未完了)。以前は 3 か所に同じものがあった
/** @param {PTour} t @param {'res' | 'lc' | 'status'} kind @returns {string} */
function playerTourTag(t, kind) {
  if (kind === 'res') return t.is_restricted ? `<span style="color:#be123c;font-size:9px;padding:1px 5px;background:rgba(225,29,72,0.10);border-radius:8px;margin-left:4px">${i18n('player.tag.res')}</span>` : '';
  if (kind === 'lc') return t.is_lower_class ? `<span style="color:#0369a1;font-size:9px;padding:1px 5px;background:rgba(2,132,199,0.10);border-radius:8px;margin-left:4px">${i18n('tags.lc')}</span>` : '';
  if (t.is_awaiting_resume) return `<span style="color:#1d4ed8;font-size:9px;padding:1px 5px;background:#dbeafe;border-radius:8px;margin-left:4px" title="${i18n('player.tag.resume_title')}">${i18n('tags.resume')}</span>`;
  if (t.is_gf_missing) return `<span style="color:#9a3412;font-size:9px;padding:1px 5px;background:#ffedd5;border-radius:8px;margin-left:4px" title="${i18n('player.tag.gf_title')}">${i18n('tags.gf')}</span>`;
  return '';
}

const params = new URLSearchParams(location.search);
// 選手の指定: ?d=<start.gg discriminator> が既定 (2026-09-14)。?uid=<uid> と #<uid> も引き続き通る。
// ?d= は data/discriminators.json (js/links.js が読む) で uid に解決してから読み込む。
const DISC_PARAM = (params.get('d') || '').trim().toLowerCase();
let UID = parseInt(params.get('uid') || location.hash.replace(/^#/, '') || '0');

// 最新の大会結果 + パフォーマンス。
function buildLatestResultSection() {
  if (!PLAYER || !META) return;
  const tours = (PLAYER && PLAYER.tournaments) || [];
  if (!tours.length) return;
  const t = tours.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];

  // ---- パフォーマンス (build がエクスポートする perf_rank をそのまま使う) ----
  const perf = perfInfoOf(t);

  // ---- カード描画 ----
  const link = t.event_id ? SPSPLinks.tournamentLink(SPSP.langRoot, t.event_id, escapeHtml(t.name || '')) : escapeHtml(t.name || '');
  const resTag = playerTourTag(t, 'res');
  const lcTag = playerTourTag(t, 'lc');
  const stTag = playerTourTag(t, 'status');
  // 当時全国 → 大会後。改善時のみ (+N) を付ける (悪化時は注記なし)
  let zenHtml = '';
  if (t.pretour_ranks && t.pretour_ranks.ensemble != null) {
    const pre = t.pretour_ranks.ensemble;
    const d = t.rank_delta_ensemble;
    zenHtml = `<div class="lr-zen">${i18n('common.national')} <b>#${pre}</b>${d != null ? ` → <b>#${pre - d}</b>` : ''}${
      /** @type {number} */ (d) > 0 ? ` <span class="lr-zen-up">(+${d})</span>` : ''}</div>`;
  }
  // 集計対象バッジ (この選手にとって評価に使われた大会か)
  const counted = !!(t.bt_used || (t.tjpr_lv || 0) > 0 || (t.tjpr_raw || 0) > 0);
  const cntTag = counted
    ? `<span class="lr-badge ok">${i18n('player.counted')}</span>`
    : `<span class="lr-badge ng">${i18n('player.not_counted')}</span>`;
  // 順位の色: 1-3位 = 金銀銅, 4-8位 (トップ8) = ピンク
  const placeCls = t.place === 1 ? 'gold' : t.place === 2 ? 'silver' : t.place === 3 ? 'bronze'
    : (t.place != null && t.place <= 8) ? 'top8' : '';
  let hero = `<span class="ph-place ${placeCls}">${t.is_dq ? 'DQ' : (t.place != null ? t.place + `<span class="ph-i">${i18n('player.place_unit', { n: t.place })}</span>` : '—')}</span>` +
    (t.nent != null ? `<span class="ph-n">/${t.nent}</span>` : '');
  // SPR は順位の横に大きく (ラベル+値+seed のスタック)
  if (!t.is_dq && t.spr != null) {
    const cls = t.spr > 0 ? 'pos' : (t.spr < 0 ? 'neg' : 'dim');
    const txt = t.spr > 0 ? `+${t.spr}` : (t.spr < 0 ? `${t.spr}` : '±0');
    hero += `<span class="ph-sep"></span>` +
      `<span class="ph-perf"><span class="ph-perf-lbl">SPR</span>` +
      `<span class="ph-spr ${cls}">${txt}</span>` +
      (t.seed != null ? `<span class="ph-perf-sub">seed ${t.seed}</span>` : '') +
      `</span>`;
  }
  // パフォーマンスも同じ行 (ラベルを数値の上にスタック)
  let capHtml = '';
  if (perf) {
    hero += `<span class="ph-sep"></span>` +
      `<span class="ph-perf">` +
      `<span class="ph-perf-lbl">${i18n('player.performance')}` +
      `<button type="button" class="ph-help" id="ph-help-btn" aria-label="${i18n('player.performance_help_aria')}">?</button></span>` +
      `<span class="ph-perf-val"><span class="ph-rank"><span class="ph-lbl">${i18n('common.national')}</span>#${perf.eq}<span class="ph-lbl">${i18n('player.equivalent')}</span></span>` +
      `<span class="lv-pill lv-${perf.eqLv}">Lv${perf.eqLv}${perf.lvSfx}</span></span>` +
      `</span>`;
    capHtml = `<div class="lr-cap" id="lr-cap" style="display:none">` +
      i18n('player.performance_help') +
      `</div>`;
  }
  // 順位評価 / 直対評価 chips (= 出場大会一覧の行と同じ表記、▶ 展開の中)
  const ELO_PER_UNIT2 = (META.params && META.params.ELO_PER_UNIT) || 29.48;
  const TJPR_SCALE2 = (META.params && META.params.TJPR_ELO_SCALE) || 17.5;
  const w = (t.tjpr_w || 0) * TJPR_SCALE2;
  const base = (t.tjpr_raw || 0) * TJPR_SCALE2;
  const tjprChip = `<div class="chip"><span class="lbl">${i18n('ranking.tab.tjpr')}</span>${
    w > 0.05 ? `<span class="val pos">+${w.toFixed(1)}</span>` : `<span class="val dim">±0</span>`}${
    base > 0.05 ? `<span class="sub">(${base.toFixed(1)})</span>` : `<span class="sub">&nbsp;</span>`}</div>`;
  const btElo = (t.bt_d || 0) * ELO_PER_UNIT2;
  const btIntElo = (t.bt_internal_d || 0) * ELO_PER_UNIT2;
  const btChip = `<div class="chip"><span class="lbl">${i18n('ranking.tab.bt')}</span>${
    Math.abs(btElo) > 0.05
      ? `<span class="val ${btElo > 0 ? 'pos' : 'neg'}">${btElo > 0 ? '+' : ''}${btElo.toFixed(1)}</span>`
      : `<span class="val dim">±0</span>`}${
    Math.abs(btIntElo) > 0.05
      ? `<span class="sub">(${btIntElo > 0 ? '+' : ''}${btIntElo.toFixed(1)})</span>`
      : `<span class="sub">&nbsp;</span>`}</div>`;

  const dataPid = (t.parent_event_id != null) ? t.parent_event_id : (t.event_id != null ? t.event_id : '');
  const isClass = t.parent_event_id != null ? '1' : '0';
  const lrBody = document.getElementById('latestres-body');
  if (lrBody) lrBody.innerHTML =
    `<div class="tour-group" data-pid="${dataPid}" data-cls="${isClass}" data-seed="${t.seed != null ? t.seed : ''}">
      <div class="tour-item tour-item-nohover tour-clickable latestres-card" style="border-bottom:none">
        <div class="lr-top">${link}${cntTag}${resTag}${lcTag}${stTag}</div>
        <div class="perf-hero">${hero}<span class="chevron lr-chev">▶</span></div>
        ${capHtml}
        ${zenHtml}
      </div>
      <div class="lr-detail">
        <div class="v-stats lr-stats">${tjprChip}${btChip}</div>
        <div class="tour-matches"></div>
      </div>
    </div>`;
  const lrDate = document.getElementById('latestres-date');
  if (lrDate) lrDate.textContent = t.date || '';
  const lrSection = document.getElementById('latestres-section');
  if (lrSection) lrSection.style.display = '';
  const helpBtn = document.getElementById('ph-help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', e => {
      e.stopPropagation();  // カード展開 (対戦表示) を発火させない
      const cap = document.getElementById('lr-cap');
      if (cap) cap.style.display = cap.style.display === 'none' ? '' : 'none';
    });
  }
}

// ライバルプレイヤー: 4指標ごとに全国順位の近い上下2人 (カテゴリ間で重複なし)。
//   1. よく対戦する      : 直近20大会の対戦回数 × 順位近接度の評価関数
//   2. 同じ大会によく出る : 直近20大会の同時出場回数 × 順位近接度の評価関数
//   3. 同じメインキャラ   : player_subranks のキャラ内順位 (= 全国順位順) の近傍
//   4. 同じ都道府県       : 同上の都道府県内順位の近傍
// 評価関数: score = 回数 × min(順位) / max(順位)  (= 回数 × 2^-|log2 順位倍率|)
//   順位は倍率で比較 (#10 vs #20 と #1000 vs #2000 は同じ距離)。倍率の逆数を
//   そのまま係数にするので 2 倍離れると半減、3 倍で 1/3 — 遠い相手は回数が
//   多くても乗りにくい。
async function buildRivalsSection() {
  const myRank = MAIN_REC && MAIN_REC.ranks && MAIN_REC.ranks.ensemble;
  if (!UID || !myRank || !PLAYER) return;
  // ---- 直近20大会の大会 JSON から 対戦回数 / 同時出場回数を集計 ----
  const tours = (PLAYER.tournaments || [])
    .filter(t => t.event_id != null && !t.is_dq)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 20);
  const docs = (await Promise.allSettled(tours.map(t =>
    fetch(SPSP.data + `tournaments/${t.event_id}.json`).then(r => { if (!r.ok) throw new Error(/** @type {any} */ (r.status)); return r.json(); })
  ))).filter(r => r.status === 'fulfilled').map(r => r.value);
  // 現在の全国順位は大会 JSON には無い (players_current.json から引く。読み込み済みなので即時)
  const CUR = await SPSPPlayerData.loadCurrent(SPSP.data).catch(() => null);
  /** @type {Map<number, { display: string, rank: number | null | undefined }>} */
  const info = new Map();   // uid -> {display, rank} (新しい大会優先)
  /** @type {Map<number, number>} */
  const vsN = new Map(), coN = new Map();
  docs.forEach(doc => {
    (doc.standings || []).forEach(s => {
      if (s.user_id === UID) return;
      if (!info.has(s.user_id)) {
        // 旧形式の大会 JSON (global_ranks 入り) が残っている切替直後の時間差でも順位が出るように fallback
        const _cr = SPSPPlayerData.currentRank(CUR, s.user_id);
        info.set(s.user_id, { display: s.display, rank: _cr != null ? _cr : (s.global_ranks || {}).ensemble });
      }
      coN.set(s.user_id, (coN.get(s.user_id) || 0) + 1);
    });
    (doc.matches || []).forEach(m => {
      const opp = m.w_id === UID ? m.l_id : (m.l_id === UID ? m.w_id : null);
      if (opp == null) return;
      vsN.set(opp, (vsN.get(opp) || 0) + 1);
    });
  });
  /** @param {number} r */
  const proximity = r => Math.min(r, myRank) / Math.max(r, myRank);
  /** @typedef {{ uid: number, n?: number, display?: string, rank?: number | null, score?: number }} RivalCand */
  /** @param {Map<number, number>} counts @param {Set<number>} used @returns {RivalCand[]} */
  function pickByScore(counts, used) {
    const cands = [...counts.entries()]
      .map(([uid, n]) => /** @type {RivalCand & { n: number }} */ (Object.assign({ uid, n }, info.get(uid) || {})))
      .filter(c => c.rank && !used.has(c.uid))
      .map(c => Object.assign(c, { score: c.n * proximity(/** @type {number} */ (c.rank)) }))
      .sort((a, b) => b.score - a.score);
    const my = /** @type {number} */ (myRank);   // 関数宣言 (巻き上げ) の中では上の guard の絞り込みが効かない
    return cands.filter(c => /** @type {number} */ (c.rank) < my).slice(0, 2)
      .concat(cands.filter(c => /** @type {number} */ (c.rank) > my).slice(0, 2));
  }
  // ---- subranks (キャラ内/都道府県内順位 = 全国順位順) の近傍 ----
  const mySub = PLAYER_SUBRANKS && PLAYER_SUBRANKS[String(UID)];
  /** @param {'char' | 'pref'} kind @param {Set<number>} used @returns {RivalCand[]} */
  function pickBySubrank(kind, used) {
    const mine = mySub && mySub[kind];
    if (!mine || !PLAYER_SUBRANKS) return [];
    const key = kind === 'char' ? mine.id : mine.name;
    /** @type {{ uid: number, r: number }[]} */
    const pool = [];
    for (const u in PLAYER_SUBRANKS) {
      const e = PLAYER_SUBRANKS[u][kind];
      if (!e || (kind === 'char' ? e.id : e.name) !== key) continue;
      const uid = parseInt(u, 10);
      if (used.has(uid)) continue;
      pool.push({ uid, r: e.rank });
    }
    return pool.filter(p => p.r < mine.rank).sort((a, b) => b.r - a.r).slice(0, 2)
      .concat(pool.filter(p => p.r > mine.rank).sort((a, b) => a.r - b.r).slice(0, 2));
  }
  const used = new Set([UID]);
  /** @param {RivalCand[]} items */
  const take = items => { items.forEach(c => used.add(c.uid)); return items; };
  const mainChar = mySub && mySub.char && CHAR_EMOJI && CHAR_EMOJI[mySub.char.id];
  // 絵文字はキャラ絵文字 (3番目のカテゴリ) と被らないものを使う (🆚/🏟/📍 はキャラ未使用)
  const cats = [
    { title: i18n('player.rivals.h2h'), items: take(pickByScore(vsN, used)) },
    { title: i18n('player.rivals.tournament'), items: take(pickByScore(coN, used)) },
    { title: i18n('player.rivals.char', { name: mainChar ? mainChar.emoji + ' ' + charName(/** @type {SubrankEntry & { id: number }} */ (mySub.char).id, mainChar.name) : i18n('player.rivals.main_char') }),
      href: mySub && mySub.char ? SPSPLinks.charRankingHref(SPSP.langRoot, mySub.char.id) : null,
      items: take(pickBySubrank('char', used)) },
    { title: i18n('player.rivals.pref', { pref: mySub && mySub.pref ? SPSPGeo.unitName(mySub.pref.name) : i18n('player.rivals.prefecture') }),
      href: mySub && mySub.pref ? SPSPLinks.prefRankingHref(SPSP.langRoot, mySub.pref.name) : null,
      items: take(pickBySubrank('pref', used)) },
  ];
  // subrank 系の 名前 + 全国順位 は players/<uid>.json から取得 (最大8件)
  const needFetch = cats[2].items.concat(cats[3].items).map(c => c.uid);
  const fetched = await Promise.allSettled(needFetch.map(uid => SPSPPlayerData.load(SPSP.data, uid, { history: false })));
  /** @type {Map<number, { display: string, rank: number | null | undefined }>} */
  const fmap = new Map();
  fetched.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value) fmap.set(needFetch[i], { display: r.value.display, rank: (r.value.ranks || {}).ensemble });
  });
  cats[2].items.concat(cats[3].items).forEach(c => {
    const f = fmap.get(c.uid);
    if (f) { c.display = f.display; c.rank = f.rank; }
  });
  // ---- 描画: 各カテゴリ 順位昇順 + 自分の行を挟む ----
  // 横幅が足りないのでチームタグ (例 "ZETA | あcola" の ZETA) は省略し、
  // 代わりにメインキャラ絵文字を名前の前に付ける
  /** @param {string | undefined} s */
  const stripTag = s => {
    const i = (s || '').lastIndexOf('|');
    return i >= 0 ? /** @type {string} */ (s).slice(i + 1).trim() : s;
  };
  /** @param {number} uid */
  const emojiOf = uid => { const e = charEmojiOf(uid); return e ? e + ' ' : ''; };
  const boxes = cats.map(cat => {
    const items = cat.items.filter(c => c.display && c.rank);
    if (!items.length) return '';
    /** @type {{ html: string, rank: number }[]} */
    const rows = items.map(c => ({ html:
      `<div class="rival-row"><span class="rr-name">${emojiOf(c.uid)}${SPSPLinks.playerLink(SPSPLinks.SELF, c.uid, escapeHtml(stripTag(c.display)))}</span>` +
      `<span class="rr-rank">#${c.rank}</span></div>`, rank: /** @type {number} */ (c.rank) }));
    rows.push({ html:
      `<div class="rival-row me"><span class="rr-name">${emojiOf(UID)}${escapeHtml(stripTag(/** @type {MainRec} */ (MAIN_REC).display))}</span>` +
      `<span class="rr-rank">#${myRank}</span></div>`, rank: myRank });
    rows.sort((a, b) => a.rank - b.rank);
    const titleHtml = cat.href
      ? `<a href="${cat.href}" style="color:inherit;text-decoration:underline;text-decoration-color:#d1d5db;text-underline-offset:2px">${cat.title}</a>`
      : cat.title;
    return `<div class="rival-cat"><div class="rc-title">${titleHtml}</div>${rows.map(r => r.html).join('')}</div>`;
  }).filter(Boolean);
  if (!boxes.length) return;
  const rivalsBody = document.getElementById('rivals-body');
  if (rivalsBody) rivalsBody.innerHTML = boxes.join('');
  const rivalsSection = document.getElementById('rivals-section');
  if (rivalsSection) rivalsSection.style.display = '';
}

// スコアシミュレーション: 次に出場予定の集計対象大会
// (エントラント登録済 & 現 Lv の加算対象) を出す。
async function buildYosouSection() {
  if (!UID || !META) return;
  const yosouLink = /** @type {HTMLAnchorElement | null} */ (document.getElementById('yosou-link'));
  if (yosouLink) yosouLink.href = SPSP.langRoot + 'sim/?uid=' + UID;
  const yosouSection = document.getElementById('yosou-section');
  if (yosouSection) yosouSection.style.display = '';
  try {
    const up = await fetch(SPSP.data + 'data/upcoming_entrants.json', { cache: 'no-cache' })
      .then(r => { if (!r.ok) throw new Error(/** @type {any} */ (r.status)); return r.json(); });
    const lv = (PLAYER && PLAYER.scores && PLAYER.scores.shared_cascade_lv) || 1;
    // 集計対象の規模条件は meta.json の実効フィルタ (params.LV_FILTERS_EFFECTIVE) から。無い古い meta では従来の定数
    const _eff = (META.params && META.params.LV_FILTERS_EFFECTIVE) || null;
    const MIN_NENT_GT = [0, 1, 2, 3, 4, 5].map(l => _eff ? ((_eff[String(l)] || {}).min_nent_gt || 0) : [0, 0, 8, 24, 32, 48][l]);
    /** @param {any} ev */
    const passes = ev => {
      const nent = ev.num_entrants || (ev.entrants && ev.entrants.length) || 0;
      if (ev.is_non_serious || nent < 5) return false;  // 全 Lv 共通の除外
      if (lv >= 2 && nent <= MIN_NENT_GT[lv]) return false;
      if (lv >= 3 && (!ev.is_weekend || ev.is_restricted || ev.is_lower_class)) return false;
      return true;
    };
    const eids = (up.by_uid[String(UID)] || []).map(String)
      .filter(eid => up.events[eid] && up.events[eid].start_at * 1000 > Date.now() && passes(up.events[eid]))
      .sort((a, b) => up.events[a].start_at - up.events[b].start_at);
    if (!eids.length) return;
    const ev = up.events[eids[0]];
    const d = new Date(ev.start_at * 1000);
    const wd = new Intl.DateTimeFormat(SPSPI18n.lang, { weekday: 'short' }).format(d);   // 表示言語の曜日 (ja: 日 / en: Sun)
    const yosouHead = document.getElementById('yosou-head');
    if (yosouHead) yosouHead.style.display = '';
    const t = document.getElementById('yosou-tour');
    if (!t) return;
    t.style.display = '';
    t.textContent = `${ev.tournament_name} ・ ${d.getMonth() + 1}/${d.getDate()}(${wd}) ・ ` +
      i18n('player.upcoming.entrants', { n: (ev.entrants && ev.entrants.length) || ev.num_entrants || '?' });
  } catch (e) { /* ドラフトデータ未配置時は ボタンのみ表示 */ }
}

/** @type {PMeta | null} */
let META = null;
/** @type {PlayerJson | null} */
let PLAYER = null;     // detail JSON (players/<uid>.json)
/** @type {MainRec | null} */
let MAIN_REC = null;   // main record from latest_tjpr_full.jsonl (need to find)
/** @type {ChartInstance | null} */
let RANK_CHART = null;
/** @type {Set<number> | null} */
let OVERSEAS_UIDS = null;  // Set<number> from data/overseas.json (loadData で fetch)
/** @type {SpspCharacterIndex | null} */
let CHAR_IDX = null;       // character_index.json (loadData で fetch)
/** カードの設定 (本人が編集ページで適用したもの)。選手データと並行して読み始め、カードはこれを待ってから 1 回だけ描く
 * (既定のカードを先に出すと、設定のあるカードに描き直すときに一瞬ちらつくため) @type {Promise<any> | null} */
let CARD_SETTINGS = null;
/** @type {Record<string, CharEmoji> | null} */
let CHAR_EMOJI = null;     // data/char_emoji.json { char_id: {name, emoji} } (loadData で fetch)
/** @type {Record<string, string> | null} */
let PLAYER_PREF = null;    // data/player_prefectures.json { uid: 都道府県漢字 } (loadData で fetch)
/** @type {Record<string, Subranks> | null} */
let PLAYER_SUBRANKS = null; // data/player_subranks.json { uid: {char:{id,rank}, pref:{name,rank}} }
/** @type {Record<string, string> | null} */
let _CHAR_EMOJI_BY_UID = null;  // uid -> メインキャラ絵文字 (CHAR_IDX.main_by_char × CHAR_EMOJI から遅延構築)
// uid -> メイン使用キャラの絵文字. character_index の main_by_char (char→uids) を逆引きし
// char_emoji.json の emoji を引く. 1 度だけ構築してメモ化.
/** @param {number | null | undefined} uid @returns {string} */
function charEmojiOf(uid) {
  if (_CHAR_EMOJI_BY_UID == null) {
    _CHAR_EMOJI_BY_UID = {};
    const mbc = CHAR_IDX && CHAR_IDX.main_by_char;
    if (mbc && CHAR_EMOJI) {
      for (const cid in mbc) {
        const em = CHAR_EMOJI[cid] && CHAR_EMOJI[cid].emoji;
        if (!em) continue;
        for (const u of (mbc[cid] || [])) _CHAR_EMOJI_BY_UID[u] = em;
      }
    }
  }
  return (uid != null && _CHAR_EMOJI_BY_UID[uid]) || '';
}
/** @type {{ period: string, kind: string }} */
let FILTER = { period: '6m', kind: 'all' };  // 共通フィルタ state (render() で再初期化される). チャート期間は半年がデフォルト
// 期間 → 日数. 'all' は無制限 (Infinity), 他は最大日数.
const PERIOD_DAYS = { 'all': Infinity, '3y': 1095, '1y': 365, '6m': 183, '3m': 91 };

const ACH_INITIAL_VISIBLE = 6;

const fmtRank = SPSPFormat.fmtRank;   // ../js/format.js

async function loadData() {
  if ((!UID || UID < 1) && DISC_PARAM) {
    await SPSPLinks.loadDiscriminators(SPSP.data);
    UID = SPSPLinks.uidOfDisc(DISC_PARAM) || 0;
    if (!UID) { showNotFound(i18n('player.disc_not_found', { d: DISC_PARAM })); return; }
  }
  if (!UID || UID < 1) { showNotFound(i18n('player.no_uid')); return; }
  CARD_SETTINGS = fetchApplied(UID).catch(() => null);
  try {
    // 選手 JSON は安定部分 (players/) + 揮発部分 (players_current.json) + 履歴 (history/) に分かれている。
    // SPSPPlayerData.load が以前の 1 ファイルと同じ形に組み立てる (../js/player_data.js)
    const [metaRes, playerRec, overseasRes, charIdxRes, charEmojiRes, prefRes, , subrankRes] = await Promise.all([
      fetch(SPSP.data + 'meta.json'),
      SPSPPlayerData.load(SPSP.data, UID),
      fetch(SPSP.data + 'data/overseas.json').catch(() => null),
      fetch(SPSP.data + 'data/character_index.json').catch(() => null),
      fetch(SPSPCharEmoji.url()).catch(() => null),
      fetch(SPSP.data + 'data/player_prefectures.json').catch(() => null),
      SPSPGeo.loadGeo(/** @type {string} */ (SPSP.data)).catch(() => null),   // 都道府県の表示名 (英語ページでは Tokyo)。無くても id で出す
      fetch(SPSP.data + 'data/player_subranks.json').catch(() => null),
    ]);
    if (subrankRes && subrankRes.ok) {
      try { PLAYER_SUBRANKS = await subrankRes.json(); } catch (e) {}
    }
    if (charEmojiRes && charEmojiRes.ok) {
      try { CHAR_EMOJI = await charEmojiRes.json(); } catch (e) {}
    }
    if (prefRes && prefRes.ok) {
      try { PLAYER_PREF = await prefRes.json(); } catch (e) {}
    }
    if (overseasRes && overseasRes.ok) {
      try {
        const j = await overseasRes.json();
        OVERSEAS_UIDS = new Set(j.uids || []);
      } catch (e) {}
    }
    if (charIdxRes && charIdxRes.ok) {
      try { CHAR_IDX = await charIdxRes.json(); } catch (e) {}
    }
    if (!playerRec) {
      showNotFound(i18n('player.not_in_db', { uid: UID }));
      return;
    }
    META = await metaRes.json();
    PLAYER = /** @type {PlayerJson} */ (/** @type {unknown} */ (playerRec));   // ../js/player_data.js の組み立て結果 (推論型は一部のキーだけ) をこのページの型に
    // 新しい player JSON は main_rec を埋め込み済み。
    // 古い player JSON (display/ranks なし) の場合は JSONL から fallback で探す。
    if (PLAYER.display && PLAYER.ranks) {
      MAIN_REC = /** @type {MainRec} */ (PLAYER);
    } else {
      // 後方互換: JSONL から探す
      const jsonlRes = await fetch(SPSP.data + 'latest_tjpr_full.jsonl');
      for (const r of SPSPData.parseJsonl(await jsonlRes.text())) {   // ../js/data.js
        if (r.user_id === UID) { MAIN_REC = r; break; }
      }
      if (!MAIN_REC) {
        showNotFound(i18n('player.not_in_db', { uid: UID }));
        return;
      }
    }
    render();
  } catch (e) {
    console.error(e);
    showNotFound(i18n('common.load_error', { message: /** @type {any} */ (e).message }));
  }
}

/** @param {string} [msg] */
function showNotFound(msg) {
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
  const el = document.getElementById('not-found');
  if (!el) return;
  if (msg) el.textContent = msg;
  el.style.display = '';
}

/** @param {number | null | undefined} place @returns {string} */
function fmtPlace(place) {
  if (place == null) return '—';
  const cls = place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : '';
  return `<span class="place ${cls}">${place}</span>`;
}

/** @param {PTour} t @param {string} valueHtml @returns {string} */
function tournamentItem(t, valueHtml) {
  const eid = t.event_id;
  const link = eid ? SPSPLinks.tournamentLink(SPSP.langRoot, eid, escapeHtml(t.name || '')) : escapeHtml(t.name || '');
  // place は「順位/参加人数」表記 (CSS で縦並びに改行)
  let placeHtml = '—';
  if (t.place != null) {
    placeHtml = t.nent != null
      ? `<span class="num">${t.place}</span><span class="frac">/${t.nent}</span>`
      : `<span class="num">${t.place}</span>`;
  }
  const resTag = playerTourTag(t, 'res');
  const lcTag = playerTourTag(t, 'lc');
  const stTag = playerTourTag(t, 'status');
  return `
    <div class="tour-item">
      <span class="date-top">${t.date}</span>
      <span class="place">${placeHtml}</span>
      <div class="meta">
        ${link}${resTag}${lcTag}${stTag}
        ${t.event ? `<span style="color:#9ca3af">/ ${escapeHtml(t.event)}</span>` : ''}
        <br><span class="date date-inline">${t.date}</span>${
          (t.pretour_ranks && t.pretour_ranks.ensemble != null)
            ? ` <span style="color:#9ca3af;font-size:10px">${i18n('player.national_then')} #${t.pretour_ranks.ensemble}${
                t.rank_delta_ensemble != null ? ' → #' + (t.pretour_ranks.ensemble - t.rank_delta_ensemble) : ''}</span>`
            : ''}
      </div>
      <div class="v">${valueHtml}</div>
    </div>
  `;
}

// escapeHtml は ../js/html.js (サイト共通)

// 最上部の選手カード (../js/player_card.js) に渡すデータ (中身の組み立ては ../js/player_card_model.js。編集ページと共有)
/** @returns {import('../../site/js/player_card_model.js').CardData} */
function cardData() {
  return { uid: UID, player: PLAYER, rec: MAIN_REC, meta: META, subranks: PLAYER_SUBRANKS, prefs: PLAYER_PREF,
           overseas: OVERSEAS_UIDS, charIdx: CHAR_IDX, charEmoji: CHAR_EMOJI };
}

function render() {
  if (!PLAYER || !MAIN_REC || !META) return;
  // 試合の並び・ブラケット表記・W2W とページ送りはサイト共通 (../js/match.js, ../js/pager.js)
  const { compactBracketLabel, placementToW2W, sortMatches } = SPSPMatch;
  const setupPaginated = SPSPPager.setupPaginated;
  const loading = document.getElementById('loading');
  if (loading) loading.style.display = 'none';
  const shareCard = document.getElementById('share-card');
  if (shareCard) shareCard.style.display = '';
  const shareRow = document.getElementById('share-row');
  if (shareRow) shareRow.style.display = '';
  document.title = `${MAIN_REC.display} — SPSP`;
  if (SPSPTrackPage) {
    SPSPTrackPage(document.title, `/p/uid${UID}`);
  }

  // 見出しの選手名 (登録名のまま。カードの中はチームタグ無し)
  const displayEl = document.getElementById('display');
  if (displayEl) displayEl.textContent = MAIN_REC.display;
  // start.gg link (if discriminator known)
  const discr = PLAYER.startgg_discriminator;
  if (discr) {
    const lnk = /** @type {HTMLAnchorElement | null} */ (document.getElementById('startgg-link'));
    if (lnk) {
      lnk.href = `https://www.start.gg/user/${discr}`;
      lnk.style.display = '';
    }
    // アドレスバーと共有 URL は discriminator 形式に (uid や #uid で来ても)。GA の仮想パスは /p/uid… のまま (集計の連続性)
    try {
      const u = new URL(location.href);
      if (u.searchParams.get('d') !== discr || u.searchParams.has('uid') || u.hash) {
        u.searchParams.delete('uid'); u.searchParams.set('d', discr); u.hash = '';
        history.replaceState(history.state, '', u.pathname + u.search);
      }
    } catch (e) { /* URL を触れない環境では何もしない */ }
  }
  const rankTjpr = document.getElementById('rank-tjpr');
  if (rankTjpr) rankTjpr.textContent = fmtRank(MAIN_REC.ranks.tjpr);
  const rankBt = document.getElementById('rank-bt');
  if (rankBt) rankBt.textContent = fmtRank(MAIN_REC.ranks.bt_gated);
  const scoreTjpr = document.getElementById('score-tjpr');
  if (scoreTjpr) scoreTjpr.textContent =
    MAIN_REC.scores.tjpr_elo != null ? MAIN_REC.scores.tjpr_elo.toFixed(2) : '—';
  const scoreBt = document.getElementById('score-bt');
  if (scoreBt) scoreBt.textContent =
    MAIN_REC.scores.bt_gated_elo != null ? MAIN_REC.scores.bt_gated_elo.toFixed(2) : '—';
  const scoreBtInternal = document.getElementById('score-bt-internal');
  if (scoreBtInternal) scoreBtInternal.textContent =
    MAIN_REC.scores.bt_internal_elo != null ? MAIN_REC.scores.bt_internal_elo.toFixed(2) : '—';

  // ── 選手カード (最上部。../js/player_card.js) ──
  const card = document.getElementById('pcard');
  // 設定 (テンプレート・色・実績の選択) は本人が編集ページで「適用」したもの (サーバ。docs/login_design.md)。
  // まず既定で出し、設定が読めたら描き直す (読めなくてもカードは出す)
  // 設定の読み込みは loadData で選手データと一緒に始めてある。待つのは 2 秒まで (遅ければ既定のカードを出し、届いたら描き直す)。
  // 待つ間もカードの箱は aspect-ratio で場所を取っているので、下の欄は動かない
  if (card) {
    const settingsP = CARD_SETTINGS || Promise.resolve(null);
    let drawn = false;
    const draw = (/** @type {any} */ st) => { drawn = true; SPSPPlayerCard.render(card, buildCardModel(cardData(), st)); };
    const timer = setTimeout(() => { if (!drawn) draw(null); }, 2000);
    settingsP.then(st => { clearTimeout(timer); if (!drawn || st) draw(st); });
  }
  // 編集ページへ (?d= は start.gg の discriminator、無ければ uid)
  const editBtn = /** @type {HTMLAnchorElement | null} */ (document.getElementById('pc-edit-btn'));
  if (editBtn) {
    editBtn.href = SPSP.pageHref('edit.html') + (discr ? '?d=' + encodeURIComponent(discr) : '?uid=' + UID);
    // 編集は本人のページだけ (API の無い ConoHa のプレビューでは確認用に出す)。ログイン状態が変わったら出し直す
    const showEdit = () => { editBtn.style.display = (SpspLogin.isSelf(UID) || !SpspLogin.apiAvailable()) ? '' : 'none'; };
    showEdit();
    SpspLogin.onChange(showEdit);
    SpspLogin.verify().then(showEdit).catch(() => {});
  }

  // Achievements: priority 順、上位 N 件のみデフォルト表示、それ以降は折りたたみ
  const ach = PLAYER.achievements || [];
  const badgesEl = document.getElementById('badges');
  if (!badgesEl) return;
  if (ach.length === 0) {
    badgesEl.innerHTML = `<span style="color:#9ca3af;font-size:11px">${i18n('player.ach.none')}</span>`;
  } else {
    // badges を flex 親に flat に並べ、hidden は display:none.
    // ボタンは flex 外 (badges の直後) に置いて、flex 内に紛れ込まないようにする.
    const hiddenCount = Math.max(0, ach.length - ACH_INITIAL_VISIBLE);
    const badgesHtml = ach.map((item, i) => {
      const b = achievementBadge(item);
      const hideAttr = i >= ACH_INITIAL_VISIBLE ? ' data-ach-hidden="1" style="display:none"' : '';
      return `<span class="badge ${b.cls || ''}"${hideAttr}>${escapeHtml(b.label)}</span>`;
    }).join('');
    badgesEl.innerHTML = badgesHtml;
    // ボタンを #badges の次の sibling として挿入 (既存なら差し替え).
    let toggleBtn = document.getElementById('ach-toggle');
    if (toggleBtn) toggleBtn.remove();
    if (hiddenCount > 0) {
      const btn = document.createElement('button');
      btn.id = 'ach-toggle';
      btn.style.cssText = 'margin-top:8px;background:#ffffff;color:#6b7280;border:1px solid #e5e7eb;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit';
      btn.textContent = i18n('player.ach.show_all', { n: hiddenCount });
      badgesEl.insertAdjacentElement('afterend', btn);
      let expanded = false;
      btn.addEventListener('click', () => {
        expanded = !expanded;
        badgesEl.querySelectorAll('[data-ach-hidden="1"]').forEach(el0 => {
          const el = /** @type {HTMLElement} */ (el0);
          el.style.display = expanded ? '' : 'none';
        });
        btn.textContent = expanded ? i18n('player.ach.collapse') : i18n('player.ach.show_all', { n: hiddenCount });
      });
    }
  }

  // Highlights
  /** @type {PeakRanks} */
  const pk = PLAYER.peak_ranks || {};
  /** @type {PeakRanks} */
  const pk1y = PLAYER.peak_ranks_1y || {};
  const tc = MAIN_REC.metadata.tour_count_3y;
  const matches = MAIN_REC.metadata.matches_count_3y;
  const lv = (MAIN_REC.scores && (MAIN_REC.scores.shared_cascade_lv || MAIN_REC.scores.tjpr_level)) || 0;
  /** ハイライトの行: [見出し, 値 html, 展開する大会 (event_id と当時のシード)?] */
  /** @type {[string, string, ({ eid: number, seed?: number | null } | null)?][]} */
  const hl = [];
  // 過去最高 (3 components compact): 1 行で 3 つの peak を並べる
  /** @param {string} label @param {PeakRank | undefined} p @param {PeakRank | undefined} p1y @returns {string} */
  function peakChip(label, p, p1y) {
    if (!p || p.rank == null) return '';
    // "#X" と "Nヶ月前" は別行に分け、wrap で崩れないようにする (細粒度 snapshot 対応).
    const whenAll = p.when === 'now'
      ? ''
      : `<div style="color:#9ca3af;font-size:10px;line-height:1.3;margin-top:3px;white-space:nowrap">${p.when}</div>`;
    const inner1Y = (p1y && p1y.rank != null && p1y.rank !== p.rank)
      ? `<div style="color:#9ca3af;font-size:10px;margin-top:3px;white-space:nowrap">${i18n('player.peak.within_1y', { rank: p1y.rank })}</div>`
      : '';
    return `<div style="text-align:center;flex:1;min-width:0">
      <div style="font-size:10px;color:#9ca3af;letter-spacing:0.04em;margin-bottom:2px;white-space:nowrap">${label}</div>
      <div style="font-size:16px;color:#111827;font-weight:700;white-space:nowrap;line-height:1.2">#${p.rank}</div>
      ${whenAll}
      ${inner1Y}
    </div>`;
  }
  const peakHtml = `<div style="display:flex;gap:14px;padding:6px 0">
    ${peakChip(i18n('player.peak.ensemble'), pk.ensemble, pk1y.ensemble)}
    ${peakChip(i18n('ranking.tab.tjpr'), pk.tjpr, pk1y.tjpr)}
    ${peakChip(i18n('ranking.tab.bt'), pk.bt_gated, pk1y.bt_gated)}
  </div>`;
  if (pk.ensemble && pk.ensemble.rank != null) {
    hl.push([i18n('player.hl.peak'), peakHtml]);
  }
  // 動的バッチ (登り調子など) は実績と別だが UI 上はハイライト内に表示
  const dynBadges = PLAYER.dynamic_badges || [];
  if (dynBadges.length) {
    const badgesHtml = dynBadges.map(b =>
      `<span class="badge ${b.cls || ''}" style="font-size:10px">${escapeHtml(achievementLabel(b))}</span>`
    ).join(' ');
    hl.push([i18n('player.hl.trend'), badgesHtml]);
  }
  // Max UF
  if (PLAYER.max_uf) {
    const m = PLAYER.max_uf;
    const oppLink = m.opp_uid
      ? SPSPLinks.playerLink(SPSPLinks.SELF, m.opp_uid, escapeHtml(m.opp_display || ''), ' style="color:#dc2626;text-decoration:none"')
      : escapeHtml(m.opp_display || '');
    const tName = m.event_id
      ? SPSPLinks.tournamentLink(SPSP.langRoot, m.event_id, escapeHtml(m.tournament_name || ''), ' style="color:#dc2626;text-decoration:none"')
      : escapeHtml(m.tournament_name || '');
    const scoreStr = (m.p_score != null && m.o_score != null) ? `${m.p_score}-${m.o_score}` : '';
    hl.push([i18n('player.hl.upset'),
      `<div style="text-align:right">` +
        `<span class="hl-place"><span class="num" style="color:#16a34a">+${m.uf}</span><span class="frac">UF</span></span>` +
        `<div style="font-size:11px;color:#6b7280;margin-top:2px;line-height:1.5">` +
          `vs ${oppLink}<br>` +
          `<span style="color:#9ca3af">seed ${m.winner_seed} → seed ${m.opp_seed}${scoreStr ? ' · ' + scoreStr : ''}</span><br>` +
          `<span style="color:#9ca3af">${m.date}</span> ${tName}` +
        `</div>` +
      `</div>`,
      m.event_id ? { eid: m.event_id, seed: m.winner_seed } : null]);
  }
  // Max +SPR (上振れ)
  const maxSpr = PLAYER.max_spr;
  if (maxSpr) {
    const s = maxSpr;
    const tName = s.event_id
      ? SPSPLinks.tournamentLink(SPSP.langRoot, s.event_id, escapeHtml(s.tournament_name || ''), ' style="color:#dc2626;text-decoration:none"')
      : escapeHtml(s.tournament_name || '');
    hl.push([i18n('player.hl.spr'),
      `<div style="text-align:right">` +
        `<span class="hl-place"><span class="num" style="color:#16a34a">+${s.spr}</span><span class="frac">SPR</span></span>` +
        `<div style="font-size:11px;color:#6b7280;margin-top:2px;line-height:1.5">` +
          `<span style="color:#9ca3af">${i18n('player.seed_to_place', { seed: s.seed, place: s.place })}</span><br>` +
          `<span style="color:#9ca3af">${s.date}</span> ${tName}` +
        `</div>` +
      `</div>`,
      s.event_id ? { eid: s.event_id, seed: s.seed } : null]);
  }
  // 最長ルーザーズラン (= WB 敗北後の LB 連勝数)
  const maxLR = PLAYER.max_losers_run;
  if (maxLR && maxLR.run >= 5) {
    const tName = maxLR.event_id
      ? SPSPLinks.tournamentLink(SPSP.langRoot, maxLR.event_id, escapeHtml(maxLR.tournament_name || ''), ' style="color:#dc2626;text-decoration:none"')
      : escapeHtml(maxLR.tournament_name || '');
    const placeStr = maxLR.place ? i18n('player.final_place', { place: maxLR.place }) : '';
    const nentStr = maxLR.nent ? i18n('player.nent_scale', { n: maxLR.nent }) : '';
    const subParts = [placeStr, nentStr].filter(Boolean).join(' · ');
    hl.push([i18n('player.hl.losers_run'),
      `<div style="text-align:right">` +
        `<span class="hl-place"><span class="num" style="color:#16a34a">${maxLR.run}</span><span class="frac">${i18n('common.win_streak')}</span></span>` +
        `<div style="font-size:11px;color:#6b7280;margin-top:2px;line-height:1.5">` +
          (subParts ? `<span style="color:#9ca3af">${escapeHtml(subParts)}</span><br>` : '') +
          `<span style="color:#9ca3af">${maxLR.date || ''}</span> ${tName}` +
        `</div>` +
      `</div>`,
      maxLR.event_id ? { eid: maxLR.event_id, seed: null } : null]);
  }
  // 大会出場 / 試合数: 全期間 (= lifetime) のみ大きく表示.
  /** @type {Partial<MainMeta>} */
  const meta_pd = MAIN_REC.metadata || {};
  const tourAll = (meta_pd.tour_count_by_period && meta_pd.tour_count_by_period['all']) || tc;
  const matchAll = (meta_pd.match_count_by_period && meta_pd.match_count_by_period['all']) || matches;
  hl.push([i18n('player.hl.tournaments'), `<span class="v">${tourAll.toLocaleString()}</span>${i18n('player.hl.tournaments_unit', { n: tourAll })}`]);
  hl.push([i18n('player.hl.matches'), `<span class="v">${matchAll.toLocaleString()}</span>${i18n('player.hl.matches_unit', { n: matchAll })}`]);
  // デビュー戦
  const debut = meta_pd.debut;
  if (debut && debut.date) {
    const dName = debut.event_id
      ? SPSPLinks.tournamentLink(SPSP.langRoot, debut.event_id, escapeHtml(debut.tournament_name || ''), ' style="color:#dc2626;text-decoration:none"')
      : escapeHtml(debut.tournament_name || '');
    hl.push([i18n('player.hl.debut'),
      `<div style="text-align:right">` +
        `<span style="font-size:12px;font-weight:500">${dName}</span>` +
        `<br><span style="color:#9ca3af;font-size:11px">${debut.date}</span>` +
      `</div>`]);
  }
  const highlightsEl = document.getElementById('highlights');
  if (highlightsEl) highlightsEl.innerHTML = hl.map(e => {
    const [k, v, extra] = e;
    if (extra && extra.eid != null) {
      // タップでその大会の対戦履歴を展開 (chevron + .tour-group の展開機構を流用)
      return `<div class="tour-group hl-group" data-eid="${extra.eid}" data-seed="${extra.seed != null ? extra.seed : ''}">` +
        `<div class="stat-row hl-headline"><span>${k}</span><span>${v}</span></div>` +
        `<div class="tour-matches"></div>` +
      `</div>`;
    }
    if (extra) {
      return `<div class="stat-row hl-headline"><span>${k}</span><span>${v}</span></div><div class="hl-detail">${extra}</div>`;
    }
    return `<div class="stat-row"><span>${k}</span><span>${v}</span></div>`;
  }).join('');

  const ELO_PER_UNIT = (META.params && META.params.ELO_PER_UNIT) || 29.48;
  const TJPR_SCALE = (META.params && META.params.TJPR_ELO_SCALE) || 17.5;

  // ── フィルタ state + 補助 ──
  FILTER = { period: '6m', kind: 'all' };
  // tourMetaByEid: 複数 source から fallback できるよう、tournaments + top_tjpr_contribs + top_spr を統合
  // (古い event は tournaments 60件には乗らないことがあるので、補助のため)
  /** @type {Record<string, PTour | PMatch>} */
  const tourMetaByEid = {};
  /** @param {PTour | PMatch} t */
  function _registerMeta(t) {
    if (!t || !t.event_id) return;
    if (!tourMetaByEid[t.event_id]) tourMetaByEid[t.event_id] = t;
  }
  for (const t of (PLAYER.tournaments || [])) _registerMeta(t);
  for (const t of (PLAYER.top_tjpr_contribs || [])) _registerMeta(t);
  for (const t of (PLAYER.top_spr || [])) _registerMeta(t);
  for (const t of (PLAYER.top_bt_gains || [])) _registerMeta(t);
  for (const t of (PLAYER.top_ufs || [])) _registerMeta(t);
  // 期間フィルタの基準は META.eval_date (= データ生成時刻). チャートも同じ起点を使うので一致.
  const ANCHOR_MS = Date.parse((META.eval_date || '') + 'T00:00:00') || Date.now();
  // 集計対象 = 順位評価または直対評価に使われた大会 (最新の大会結果バッジと同じ定義)。
  // 判定用フィールドを一切持たない meta (= match record 由来など) は通す (lenient)。
  /** @param {PTour | PMatch} t */
  function _isCounted(t) {
    if (!('bt_used' in t) && !('tjpr_raw' in t) && !('tjpr_w' in t) && !('tjpr_lv' in t)) return true;
    return !!(t.bt_used || (t.tjpr_lv || 0) > 0 || (t.tjpr_raw || 0) > 0 || (t.tjpr_w || 0) > 0);
  }
  /** @param {PTour | PMatch | undefined} t */
  function passesFilter(t) {
    if (!t) return true;
    // 期間フィルタはチャート専用 (= 大会データには影響させない)
    // kind フィルタ: is_weekend は data に直接含まれる前提
    if (FILTER.kind === 'weekend' && !t.is_weekend) return false;
    if (FILTER.kind === 'weekday' && t.is_weekend) return false;
    if (FILTER.kind === 'counted' && !_isCounted(t)) return false;
    return true;
  }
  /** @param {number | null | undefined} eid */
  function passesFilterByEid(eid) {
    if (eid == null) return true;
    return passesFilter(tourMetaByEid[eid]);
  }
  // entry が is_weekend を直接持つなら entry で、無ければ eid lookup で判定。
  // ただし counted 判定に必要なフィールド (bt_used / tjpr_*) は match entry に無いので、
  // counted フィルタ時は常に eid で大会メタを引く (entry 直接判定だと全滅するバグがあった)
  /** @param {PMatch} m */
  function passesFilterEntry(m) {
    if (!m) return true;
    if (FILTER.kind === 'counted') return passesFilterByEid(m.event_id);
    if ('is_weekend' in m) return passesFilter(m);
    return passesFilterByEid(m.event_id);
  }

  /** @param {PTour[]} items */
  function renderContribs(items) {
    return items.map(t => {
      const w = (t.tjpr_w || 0) * TJPR_SCALE;
      const base = (t.tjpr_raw || 0) * TJPR_SCALE;
      return tournamentItem(t,
        `<span style="color:#16a34a">+${w.toFixed(1)}</span>` +
        `<br><span style="color:#9ca3af;font-size:11px">(${base.toFixed(1)})</span>`);
    }).join('');
  }
  function renderTopContribs() {
    if (!PLAYER) return;
    const tcAll = (PLAYER.top_tjpr_contribs || []).filter(t => passesFilter(t));
    setupPaginated(tcAll, 'top-contribs', 'top-contribs-pager',
      arr => renderContribs(arr),
      i18n('player.empty.top_tjpr'));
  }

  // Top BT gains — per-match format: vs opponent at tournament
  /** @param {PMatch} m */
  function matchItem(m) {
    const oppLink = m.opp_uid
      ? SPSPLinks.playerLink(SPSPLinks.SELF, m.opp_uid, escapeHtml(m.opp_display || ''), ' style="color:#dc2626;text-decoration:none;font-weight:500"')
      : escapeHtml(m.opp_display || '');
    const tName = m.event_id
      ? SPSPLinks.tournamentLink(SPSP.langRoot, m.event_id, escapeHtml(m.tournament_name || ''), ' style="color:#dc2626;text-decoration:none"')
      : escapeHtml(m.tournament_name || '');
    // per-match の rate 変化は内部レート (current) のみ
    const btD = (m.bt_internal_d != null ? m.bt_internal_d : (m.bt_d || 0));
    const str = `${btD >= 0 ? '+' : ''}${(btD * ELO_PER_UNIT).toFixed(1)}`;
    const color = btD > 0 ? '#16a34a' : (btD < 0 ? '#2563eb' : '#9ca3af');
    // 左 place 列: 上に score (3-2 等、自分が左)、下に bracket (W.Top64 等).
    const scoreStr = (m.p_score != null && m.o_score != null) ? `${m.p_score}-${m.o_score}` : '';
    const bracketStr = compactBracketLabel(m.global_bracket_label, m.round_text, m.bracket_type);
    const placeHtml = `
      <span class="place" style="font-size:13px">
        ${scoreStr ? `<span class="num" style="font-size:14px">${scoreStr}</span>` : ''}
        ${bracketStr ? `<span class="frac">${bracketStr}</span>` : ''}
      </span>`;
    return `
      <div class="tour-item">
        <span class="date-top">${m.date}</span>
        ${placeHtml}
        <div class="meta">
          vs ${oppLink}
          <br><span class="date date-inline">${m.date}</span> · ${tName}
        </div>
        <div class="v" style="text-align:right;color:${color}">${str}</div>
      </div>`;
  }
  function renderTopBT() {
    if (!PLAYER) return;
    const items = (PLAYER.top_bt_gains || []).filter(passesFilterEntry);
    setupPaginated(items, 'top-bt', 'top-bt-pager',
      arr => arr.map(matchItem).join(''),
      i18n('player.empty.top_bt'));
  }
  // SPR item: UF と同じ「左 place 列に +N SPR」スタイル.
  /** @param {PTour} t */
  const renderSprItem = t => {
    const eid = t.event_id;
    const link = eid ? SPSPLinks.tournamentLink(SPSP.langRoot, eid, escapeHtml(t.name || '')) : escapeHtml(t.name || '');
    const resTag = playerTourTag(t, 'res');
    const lcTag = playerTourTag(t, 'lc');
  const stTag = playerTourTag(t, 'status');
    return `<div class="tour-item" style="grid-template-columns:46px 1fr auto">
      <span class="place"><span class="num" style="color:#16a34a">+${t.spr}</span><span class="frac">SPR</span></span>
      <div class="meta">
        ${link}${resTag}${lcTag}${stTag}
        ${t.event ? `<span style="color:#9ca3af">/ ${escapeHtml(t.event)}</span>` : ''}
        <br><span style="font-size:10px;color:#9ca3af">${i18n('player.seed_to_place', { seed: t.seed, place: t.place })}</span>
        <br><span class="date">${t.date}</span> · ${i18n('common.n_players', { n: t.nent })}
      </div>
      <div class="v"></div>
    </div>`;
  };
  function renderTopSPR() {
    if (!PLAYER) return;
    const items = (PLAYER.top_spr || []).filter(t => passesFilter(t));
    const sec = document.getElementById('top-spr-section');
    const sourceEmpty = !(PLAYER.top_spr || []).length;
    const ok = setupPaginated(items, 'top-spr', 'top-spr-pager',
      arr => arr.map(renderSprItem).join(''),
      sourceEmpty ? null : i18n('player.empty.top_spr'));
    if (sec) sec.style.display = (ok || !sourceEmpty) ? '' : 'none';
  }
  /** @param {PMatch} m */
  const renderUfItem = m => {
    const oppLink = m.opp_uid
      ? SPSPLinks.playerLink(SPSPLinks.SELF, m.opp_uid, escapeHtml(m.opp_display || ''), ' style="color:#dc2626;text-decoration:none;font-weight:500"')
      : escapeHtml(m.opp_display || '');
    const tName = m.event_id
      ? SPSPLinks.tournamentLink(SPSP.langRoot, m.event_id, escapeHtml(m.tournament_name || ''), ' style="color:#dc2626;text-decoration:none"')
      : escapeHtml(m.tournament_name || '');
    return `<div class="tour-item" style="grid-template-columns:46px 1fr auto">
      <span class="place"><span class="num" style="color:#16a34a">+${m.uf}</span><span class="frac">UF</span></span>
      <div class="meta">
        vs ${oppLink}
        <br><span style="font-size:10px;color:#9ca3af">seed ${m.winner_seed} → seed ${m.opp_seed}</span>
        <br><span class="date">${m.date}</span> · ${tName}
      </div>
      <div class="v"></div>
    </div>`;
  };
  function renderTopUFs() {
    if (!PLAYER) return;
    const items = (PLAYER.top_ufs || []).filter(passesFilterEntry);
    const sec = document.getElementById('top-ufs-section');
    const sourceEmpty = !(PLAYER.top_ufs || []).length;
    const ok = setupPaginated(items, 'top-ufs', 'top-ufs-pager',
      arr => arr.map(renderUfItem).join(''),
      sourceEmpty ? null : i18n('player.empty.top_uf'));
    if (sec) sec.style.display = (ok || !sourceEmpty) ? '' : 'none';
  }

  // Recent: 全期間 (PLAYER.tournaments 利用) を最新順. 5 件ずつ pagination.
  const allToursAll = (PLAYER.tournaments || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // event_id → list of recent_matches (大会ごとの対戦相手集計用)
  /** @type {Record<string, PMatch[]>} */
  const matchesByEvent = {};
  for (const m of (PLAYER.recent_matches || [])) {
    if (!m.event_id) continue;
    (matchesByEvent[m.event_id] = matchesByEvent[m.event_id] || []).push(m);
  }
  /** @param {PTour | number} t @returns {string} */
  function renderTournamentMatches(t) {
    // t は tournament entry (= PLAYER.tournaments の 1 件) もしくは event_id (後方互換用).
    let lookupEid;
    /** @type {'class' | 'main' | null} */
    let classFilter = null;
    if (typeof t === 'object' && t !== null) {
      if (t.parent_event_id) {
        lookupEid = t.parent_event_id;
        classFilter = 'class';
      } else {
        lookupEid = t.event_id;
        classFilter = 'main';
      }
    } else {
      lookupEid = t;
    }
    let ms = matchesByEvent[lookupEid] || [];
    if (classFilter === 'class') ms = ms.filter(m => m.is_class === true);
    else if (classFilter === 'main') ms = ms.filter(m => m.is_class !== true);
    if (!ms.length) return `<div style="padding:8px 12px;color:#9ca3af;font-size:11px">${i18n('common.no_match_data')}</div>`;
    const sorted = sortMatches(ms);
    const pName = (typeof t === 'object' && t !== null) ? (/** @type {MainRec} */ (MAIN_REC).display || '') : '';
    const pSeed = (typeof t === 'object' && t !== null) ? t.seed : null;
    // モバイル時は各 match-row で本人名を省略するので、展開冒頭に「name + seed」を一回表示.
    const header = (pName || pSeed != null)
      ? `<div class="match-header">${escapeHtml(pName)}${pSeed != null ? `<span class="seed">#${pSeed}</span>` : ''}</div>`
      : '';
    return header + sorted.map(m => _renderMatchRow(m, pName, pSeed)).join('');
  }
  /** @param {PMatch} m @param {string} pName @param {number | null | undefined} pSeed @returns {string} */
  function _renderMatchRow(m, pName, pSeed) {
    const scoreColor = m.won ? '#16a34a' : '#2563eb';
    const score = (m.p_score != null && m.o_score != null) ? `${m.p_score}-${m.o_score}` : '—';
    const dInt = m.bt_internal_d != null ? m.bt_internal_d : (m.bt_d || 0);
    const dElo = dInt * ELO_PER_UNIT;
    let dStr = '', dColor = '#9ca3af';
    // BT 学習対象 (= レート換算対象) の試合は delta が 0 でも "+0.0" 表記.
    // 非対象 (= gated out) の試合は空白.
    if (m.bt_tracked) {
      dStr = `${dElo >= 0 ? '+' : ''}${dElo.toFixed(1)}`;
      // 勝ち = 緑、負け = 青. 0.0 でも勝ちなら緑 (= 増加と等価).
      dColor = m.won ? '#16a34a' : '#2563eb';
    } else if (Math.abs(dElo) > 0.05) {
      // backward compat (= 旧ビルドの古い JSON 用)
      dStr = `${dElo > 0 ? '+' : ''}${dElo.toFixed(1)}`;
      dColor = dElo > 0 ? '#16a34a' : '#2563eb';
    }
    const bracket = compactBracketLabel(m.global_bracket_label, m.round_text, m.bracket_type) || '';
    const pSeedHtml = pSeed != null ? `<div class="m-seed">#${pSeed}</div>` : '';
    const oSeedHtml = m.opp_seed != null ? `<div class="m-seed">#${m.opp_seed}</div>` : '';
    const oppEmoji = charEmojiOf(m.opp_uid);  // 対戦相手のメイン使用キャラ絵文字 (名前の前に付与)
    const oppLink = m.opp_uid
      ? SPSPLinks.playerLink(SPSPLinks.SELF, m.opp_uid, escapeHtml(m.opp_display || ''))
      : escapeHtml(m.opp_display || '');
    // UF: ページ表示中のプレイヤーが自分より高シードを倒した場合のみ表記.
    let ufHtml = '';
    if (m.won && pSeed != null && m.opp_seed != null && pSeed > m.opp_seed) {
      const uf = placementToW2W(pSeed) - placementToW2W(m.opp_seed);
      if (uf > 0) {
        ufHtml = `<div style="font-size:10px;line-height:1.1;margin-top:1px"><span style="color:#16a34a;font-weight:600">+${uf}</span> <span style="color:#9ca3af">UF</span></div>`;
      }
    }
    return `<div class="match-row">
      <span class="m-bracket">${bracket}</span>
      <span class="m-content">
        <span class="m-player"><div>${escapeHtml(pName)}</div>${pSeedHtml}</span>
        <span class="m-score" style="color:${scoreColor};display:inline-block;text-align:center">
          <div>${score}</div>
          ${ufHtml}
        </span>
        <span class="m-opp"><div>${oppEmoji ? oppEmoji + ' ' : ''}${oppLink}</div>${oSeedHtml}</span>
      </span>
      <span class="m-delta" style="color:${dColor}">${dStr}</span>
    </div>`;
  }
  /** @param {PTour[]} items */
  function renderRecent(items) {
    return items.map((t, idx) => {
      // SPR chip. sub 行に seed 番号を表示 (= 他 chip と高さ揃える).
      let sprChip;
      const sprSub = (t.seed != null)
        ? `<span class="sub">seed ${t.seed}</span>`
        : `<span class="sub">&nbsp;</span>`;
      if (t.is_dq) {
        sprChip = `<div class="chip"><span class="lbl">&nbsp;</span><span class="val dim">DQ</span>${sprSub}</div>`;
      } else if (t.spr != null) {
        const cls = t.spr > 0 ? 'pos' : (t.spr < 0 ? 'neg' : 'dim');
        const txt = t.spr > 0 ? `+${t.spr}` : (t.spr < 0 ? `${t.spr}` : '±0');
        sprChip = `<div class="chip"><span class="lbl lbl-en">SPR</span><span class="val ${cls}">${txt}</span>${sprSub}</div>`;
      } else {
        sprChip = `<div class="chip"><span class="lbl lbl-en">SPR</span><span class="val dim">—</span>${sprSub}</div>`;
      }
      // 順位評価 chip (= tjpr_w × scale). 下に括弧で base pt を併記.
      const w = (t.tjpr_w || 0) * TJPR_SCALE;
      const base = (t.tjpr_raw || 0) * TJPR_SCALE;
      const tjprValHtml = w > 0.05
        ? `<span class="val pos">+${w.toFixed(1)}</span>`
        : `<span class="val dim">±0</span>`;
      const tjprSubHtml = base > 0.05
        ? `<span class="sub">(${base.toFixed(1)})</span>`
        : `<span class="sub">&nbsp;</span>`;
      const tjprChip = `<div class="chip"><span class="lbl">${i18n('ranking.tab.tjpr')}</span>${tjprValHtml}${tjprSubHtml}</div>`;
      // 直対評価 chip (= peak180 delta in Elo). 下に括弧で内部レート (current) delta.
      const btD = t.bt_d || 0;
      const btIntD = t.bt_internal_d || 0;
      const btElo = btD * ELO_PER_UNIT;
      const btIntElo = btIntD * ELO_PER_UNIT;
      let btValHtml;
      if (Math.abs(btElo) > 0.05) {
        const cls = btElo > 0 ? 'pos' : 'neg';
        const sign = btElo > 0 ? '+' : '';
        btValHtml = `<span class="val ${cls}">${sign}${btElo.toFixed(1)}</span>`;
      } else {
        btValHtml = `<span class="val dim">±0</span>`;
      }
      const btSubHtml = Math.abs(btIntElo) > 0.05
        ? `<span class="sub">(${btIntElo > 0 ? '+' : ''}${btIntElo.toFixed(1)})</span>`
        : `<span class="sub">&nbsp;</span>`;
      const btChip = `<div class="chip"><span class="lbl">${i18n('ranking.tab.bt')}</span>${btValHtml}${btSubHtml}</div>`;
      const vHtml = `<div class="v-stats">${sprChip}${tjprChip}${btChip}<span class="chevron">▶</span></div>`;
      const itemHtml = tournamentItem(t, vHtml)
        .replace('class="tour-item"', 'class="tour-item tour-item-nohover tour-clickable" style="border-bottom:none"');
      // 展開部の先頭にパフォーマンス (perf_rank があれば)
      const pf = perfInfoOf(t);
      const perfHtml = pf
        ? `<div class="tour-perf"><span class="tp-lbl">${i18n('player.performance')}</span>` +
          ` ${i18n('common.national')} <b>#${pf.eq}</b> ${i18n('player.equivalent')}` +
          ` <span class="lv-pill lv-${pf.eqLv}">Lv${pf.eqLv}${pf.lvSfx}</span></div>`
        : '';
      const matchesHtml = `<div class="tour-matches"></div>`;
      // data-eid + data-pid + data-class が onClick 時に matches を遅延 render する.
      const dataPid = (t.parent_event_id != null) ? t.parent_event_id : (t.event_id != null ? t.event_id : '');
      const isClass = t.parent_event_id != null ? '1' : '0';
      const seedAttr = t.seed != null ? t.seed : '';
      return `<div class="tour-group" data-pid="${dataPid}" data-cls="${isClass}" data-seed="${seedAttr}">${itemHtml}${perfHtml}${matchesHtml}</div>`;
    }).join('');
  }
  // Click delegation: tour-clickable → toggle parent .tour-group.expanded + render matches lazily
  document.addEventListener('click', (e) => {
    const ti = /** @type {Element} */ (e.target).closest('.tour-clickable');
    if (!ti) return;
    // リンク (a) クリック時は遷移を優先 (展開しない)
    if (/** @type {Element} */ (e.target).closest('a')) return;
    const group = /** @type {HTMLElement | null} */ (ti.closest('.tour-group'));
    if (!group) return;
    const wasExpanded = group.classList.contains('expanded');
    group.classList.toggle('expanded');
    if (!wasExpanded) {
      const matchesEl = /** @type {HTMLElement | null} */ (group.querySelector('.tour-matches'));
      if (matchesEl && !matchesEl.dataset.rendered) {
        const pid = /** @type {string} */ (group.dataset.pid);
        const isCls = group.dataset.cls === '1';
        const seed = group.dataset.seed !== '' ? parseInt(/** @type {string} */ (group.dataset.seed)) : null;
        const tProxy = { event_id: isCls ? null : parseInt(pid), parent_event_id: isCls ? parseInt(pid) : null, seed };
        matchesEl.innerHTML = renderTournamentMatches(tProxy);
        matchesEl.dataset.rendered = '1';
      }
    }
  });
  // ハイライト (最大アップセット等) のタップ展開: event_id から対戦履歴を引く.
  // tourMetaByEid に大会 entry があればそれと同じ main/class 判定を使い、無ければ main → class の順で試す.
  /** @param {number} eid @param {number | null} seedOverride @returns {string} */
  function _hlMatchesHtml(eid, seedOverride) {
    const meta = tourMetaByEid[eid];
    const seed = seedOverride != null ? seedOverride : (meta && meta.seed != null ? meta.seed : null);
    const tProxy = (meta && meta.parent_event_id != null)
      ? { event_id: null, parent_event_id: meta.parent_event_id, seed }
      : { event_id: eid, parent_event_id: null, seed };
    let html = renderTournamentMatches(tProxy);
    if (html.includes(i18n('common.no_match_data')) && (matchesByEvent[eid] || []).some(m => m.is_class === true)) {
      html = renderTournamentMatches({ event_id: null, parent_event_id: eid, seed });
    }
    return html;
  }
  if (highlightsEl) highlightsEl.addEventListener('click', (e) => {
    if (/** @type {Element} */ (e.target).closest('a')) return;
    const g = /** @type {HTMLElement | null} */ (/** @type {Element} */ (e.target).closest('.hl-group'));
    if (!g) return;
    const wasExpanded = g.classList.contains('expanded');
    g.classList.toggle('expanded');
    if (!wasExpanded) {
      const matchesEl = /** @type {HTMLElement | null} */ (g.querySelector('.tour-matches'));
      if (matchesEl && !matchesEl.dataset.rendered) {
        const seed = g.dataset.seed !== '' ? parseInt(/** @type {string} */ (g.dataset.seed)) : null;
        matchesEl.innerHTML = _hlMatchesHtml(parseInt(/** @type {string} */ (g.dataset.eid)), seed);
        matchesEl.dataset.rendered = '1';
      }
    }
  });
  function renderRecentSection() {
    const allTours = allToursAll.filter(t => passesFilter(t));
    setupPaginated(allTours, 'recent', 'recent-pager',
      arr => renderRecent(arr),
      i18n('player.empty.filtered'));
  }

  // 初回 + フィルタ変更時の再描画ハンドル
  function applyFilter() {
    renderTopContribs();
    renderTopBT();
    renderTopSPR();
    renderTopUFs();
    renderRecentSection();
  }
  applyFilter();
  // フィルタボタン (期間 + 大会). 期間変更時はチャートも再描画して時間軸を更新する.
  /** @param {string} attr @param {'period' | 'kind'} stateKey */
  function bindFilterGroup(attr, stateKey) {
    document.querySelectorAll(`[data-filter-${attr}]`).forEach(btn => {
      btn.addEventListener('click', () => {
        FILTER[stateKey] = /** @type {string} */ (btn.getAttribute(`data-filter-${attr}`));
        document.querySelectorAll(`[data-filter-${attr}]`).forEach(b => b.classList.toggle('active', b === btn));
        applyFilter();
        if (stateKey === 'period' && typeof _rerenderActiveChart === 'function') {
          _rerenderActiveChart();
        }
      });
    });
  }
  bindFilterGroup('period', 'period');
  bindFilterGroup('kind', 'kind');


  // Initial chart: defer to after layout (double rAF + small timeout) so canvas has measured size
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => { renderRadarChart(); renderRankChart(); }, 30);
    });
  });

  buildYosouSection();
  buildLatestResultSection();
  buildRivalsSection();
}

/** @type {ChartInstance | null} */
let RADAR_CHART = null;
function renderRadarChart() {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('radar-canvas'));
  if (!canvas || !MAIN_REC) return;
  if (RADAR_CHART) { RADAR_CHART.destroy(); RADAR_CHART = null; }
  /** @type {Radar} */
  const r = (PLAYER && PLAYER.radar) || {};
  // 全軸を「生集計値の対数圧縮」に統一: log(1+score) / log(1+max) * 100
  // 「安定」軸は値が大きいほど不安定なので反転 (100 - 対数化値) で表示.
  /** @type {NonNullable<PMeta['score_ranges']>} */
  const sr = (META && META.score_ranges) || {};
  const tjprElo = (MAIN_REC.scores && MAIN_REC.scores.tjpr_elo) || 0;
  const btElo   = (MAIN_REC.scores && MAIN_REC.scores.bt_gated_elo) || 0;
  // offset: log(offset + v) を使うことで分布の低い裾を持ち上げる (=旧チャートの形に合わせる).
  function logScale(v, mx, offset) {
    if (v == null) return 50;
    if (!mx || mx <= 0) return 0;
    const o = Math.max(1, offset || 1);
    return Math.max(0, Math.min(100, Math.log(o + Math.max(0, v)) / Math.log(o + mx) * 100));
  }
  // floor: [floor, mx] -> [0, 100] にマップ (Glicko2 等の基準点を下限にする).
  function linScale(v, mx, floor) {
    const f = floor || 0;
    if (!mx || mx <= f) return 0;
    return Math.max(0, Math.min(100, ((v - f) / (mx - f)) * 100));
  }
  // [v2.0] 順位ベースの power curve: floor + (100-floor) * pct^alpha
  // pct = 1 - (rank-1)/N. alpha が大きいほど top が flat (= top tier 間の差を圧縮).
  function rankRadar(rank, total, alpha, floor) {
    const f = floor != null ? floor : 30;
    if (!rank || rank <= 0 || !total || total <= 0) return f;
    const a = alpha || 8;
    const pct = Math.max(0, Math.min(1, 1 - (rank - 1) / total));
    return Math.max(f, Math.min(100, f + (100 - f) * Math.pow(pct, a)));
  }
  // raw 0-1 → 30-100。floor は 30。
  //   低めに分布する軸 (上振れ, 格上喰い): sqrt で低い値を引き伸ばし
  //   高めに分布する軸 (安定感, 防衛力): x^2 で高い値を引き伸ばし
  // どちらも単調増加、ただし「典型値の付近」が中央〜上に来るような曲線。
  function scaleLow(raw) {
    if (raw == null) return 30;
    const v = Math.max(0, Math.min(1, raw));
    return Math.max(30, 30 + 70 * Math.sqrt(v));
  }
  function scaleHigh(raw) {
    if (raw == null) return 30;
    const v = Math.max(0, Math.min(1, raw));
    return Math.max(30, 30 + 70 * v * v);
  }
  // 軸並び (時計回り、北から)。上半分=順位系, 下半分=直対系, 右=上振れ, 左=下振れ。
  // [v2.0] 順位評価pt と 直対評価pt は順位ベースの power curve (= top tier 間の差を圧縮).
  const tjprRank = (MAIN_REC.ranks && MAIN_REC.ranks.tjpr) || 0;
  const btRank   = (MAIN_REC.ranks && MAIN_REC.ranks.bt_gated) || 0;
  const data = [
    rankRadar(tjprRank, sr.tjpr_n_ranked, sr.tjpr_radar_alpha || 8, 30),   // 北: 順位評価pt
    scaleLow(r.spr_upper_raw),                  // 北東: 上振れ
    scaleLow(r.uf_upper_raw),                   // 南東: 格上喰い
    rankRadar(btRank, sr.bt_n_ranked, sr.tjpr_radar_alpha || 8, 30),       // 南: 直対評価pt
    scaleHigh(r.uf_lost_raw),                   // 南西: 防衛力
    scaleHigh(r.spr_neg_raw),                   // 北西: 安定感
  ];
  const labels = [
    i18n('ranking.tab.tjpr'),
    i18n('player.radar.upside'),
    i18n('player.radar.giant_killing'),
    i18n('ranking.tab.bt'),
    i18n('player.radar.defense'),
    i18n('player.radar.stability'),
  ];
  RADAR_CHART = new Chart(canvas, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [{
        label: MAIN_REC.display,
        data: data,
        backgroundColor: 'rgba(220, 38, 38, 0.18)',
        borderColor: '#dc2626',
        borderWidth: 2,
        pointBackgroundColor: '#dc2626',
        pointBorderColor: '#fff',
        pointRadius: 3.5,
        pointHoverRadius: 5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      scales: {
        r: {
          beginAtZero: true,
          min: 0, max: 100,
          ticks: { stepSize: 25, color: '#9ca3af', font: { size: 9 }, backdropColor: 'transparent' },
          grid: { color: '#e5e7eb' },
          angleLines: { color: '#e5e7eb' },
          pointLabels: { color: '#374151', font: { size: 12, weight: '500' } },
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const i = item.dataIndex;
              if (i === 0) return tjprRank
                ? `${item.label}: ${i18n('player.radar.rank_of', { rank: tjprRank, n: sr.tjpr_n_ranked || '—', score: tjprElo.toFixed(1) })}`
                : `${item.label}: ${i18n('player.radar.unranked')}`;
              if (i === 3) return btRank
                ? `${item.label}: ${i18n('player.radar.rank_of', { rank: btRank, n: sr.bt_n_ranked || '—', score: btElo.toFixed(1) })}`
                : `${item.label}: ${i18n('player.radar.unranked')}`;
              if (i === 1) return r.spr_upper_raw != null
                ? `${item.label}: ${i18n('player.radar.spr_upper', { pct: (r.spr_upper_raw * 100).toFixed(0) })}`
                : `${item.label}: ${i18n('player.radar.no_data')}`;
              if (i === 2) return r.uf_upper_raw != null
                ? `${item.label}: ${i18n('player.radar.uf_upper', { pct: (r.uf_upper_raw * 100).toFixed(0) })}`
                : `${item.label}: ${i18n('player.radar.no_data')}`;
              if (i === 4) return r.uf_lost_raw != null
                ? `${item.label}: ${i18n('player.radar.uf_lost', { pct: (r.uf_lost_raw * 100).toFixed(0) })}`
                : `${item.label}: ${i18n('player.radar.no_data')}`;
              if (i === 5) return r.spr_neg_raw != null
                ? `${item.label}: ${i18n('player.radar.spr_neg', { pct: (r.spr_neg_raw * 100).toFixed(0) })}`
                : `${item.label}: ${i18n('player.radar.no_data')}`;
              return item.label;
            },
          }
        }
      }
    }
  });
}

// Lv 別背景プラグイン: 順位評価ポイント (= TJPR スコア) チャート専用、各時点のレベル帯を背景色で表示.
// history の tjpr_lv を step function として描画 (= snapshot 間は前の Lv が継続).
const LV_BG_COLORS = {
  1: 'rgba(156, 163, 175, 0.30)',  // gray (Lv1)  - 濃いめのグレー
  2: 'rgba(74, 222, 128, 0.25)',   // green (Lv2)
  3: 'rgba(96, 165, 250, 0.22)',   // blue (Lv3)
  4: 'rgba(167, 139, 250, 0.28)',  // purple (Lv4)
  5: 'rgba(251, 191, 36, 0.30)',   // yellow (Lv5)
};
/** @param {string} id @param {string} histLvField @param {string} currentLvScoreField */
function makeLvBgPlugin(id, histLvField, currentLvScoreField) {
  return {
    id: id,
    /** @param {ChartInstance} chart */
    beforeDatasetsDraw(chart) {
      if (!PLAYER || !META) return;
      const hist = (PLAYER.history || []).filter(h => h && h[histLvField] != null);
      if (!hist.length) return;
      const ctx = chart.ctx;
      const xAxis = chart.scales.x;
      const yAxis = chart.scales.y;
      if (!xAxis || !yAxis) return;
      const evalDateMs = new Date(META.eval_date + 'T00:00:00').getTime();
      const dayMs = 86400 * 1000;
      const pts = hist.map(h => ({ ts: evalDateMs - h.d * dayMs, lv: h[histLvField] }))
                      .sort((a, b) => a.ts - b.ts);
      const currentLv = (MAIN_REC && MAIN_REC.scores && MAIN_REC.scores[currentLvScoreField])
                        || pts[pts.length-1].lv;
      pts.push({ ts: evalDateMs, lv: currentLv });
      ctx.save();
      ctx.beginPath();
      ctx.rect(xAxis.left, yAxis.top, xAxis.right - xAxis.left, yAxis.bottom - yAxis.top);
      ctx.clip();
      for (let i = 0; i < pts.length - 1; i++) {
        const lv = pts[i].lv;
        const color = LV_BG_COLORS[lv];
        if (!color) continue;
        const xStart = xAxis.getPixelForValue(pts[i].ts);
        const xEnd = xAxis.getPixelForValue(pts[i + 1].ts);
        if (xEnd <= xAxis.left || xStart >= xAxis.right) continue;
        const x1 = Math.max(xStart, xAxis.left);
        const x2 = Math.min(xEnd, xAxis.right);
        ctx.fillStyle = color;
        ctx.fillRect(x1, yAxis.top, x2 - x1, yAxis.bottom - yAxis.top);
      }
      ctx.restore();
    },
  };
}
const LV_BG_PLUGIN = makeLvBgPlugin('lvBackground', 'tjpr_lv', 'tjpr_level');
const SHARED_LV_BG_PLUGIN = makeLvBgPlugin('sharedLvBackground', 'shared_lv', 'shared_cascade_lv');

// チャート範囲は FILTER.period (= 共通フィルタ) と同期する.
function _chartRangeDays() {
  const v = PERIOD_DAYS[FILTER.period];
  return (v == null || !isFinite(v)) ? 100000 : v;  // 'all' → 大きい値 (= 実質無制限)
}
function _chartTimeUnit() {
  const r = _chartRangeDays();
  if (r <= 180) return 'week';
  if (r <= 730) return 'month';
  return 'month';
}
/** @param {HistRow[]} hist @returns {HistRow[]} */
function _filterHistForRange(hist) {
  const r = _chartRangeDays();
  return hist.filter(h => h.d <= r);
}
function renderRankChart() {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('chart-canvas'));
  if (RANK_CHART) { RANK_CHART.destroy(); RANK_CHART = null; }
  if (!canvas || !PLAYER || !MAIN_REC || !META) return;
  const evalDate = new Date(META.eval_date + 'T00:00:00');
  /** @param {number} days @returns {string} */
  const dateFromDaysAgo = (days) => {
    const d = new Date(evalDate);
    d.setDate(d.getDate() - days);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const histAll = (PLAYER.history || []).slice().sort((a, b) => b.d - a.d);
  const hist = _filterHistForRange(histAll);
  const series = [
    { k_hist: 'ens',    k_now: MAIN_REC.ranks.ensemble, label: i18n('ranking.tab.ensemble'), color: '#dc2626' },
    { k_hist: 'tjpr_r', k_now: MAIN_REC.ranks.tjpr,     label: i18n('ranking.tab.tjpr'),       color: '#d97706' },
    { k_hist: 'bt_g_r', k_now: MAIN_REC.ranks.bt_gated, label: i18n('ranking.tab.bt'),       color: '#16a34a' },
  ];
  const datasets = series.map(s => ({
    label: s.label,
    data: hist.map(h => ({ x: dateFromDaysAgo(h.d), y: h[s.k_hist] }))
      .concat([{ x: /** @type {PMeta} */ (META).eval_date, y: s.k_now }])
      .filter(p => p.y != null && p.y > 0)
      .sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime()),
    borderColor: s.color, backgroundColor: s.color + '40',
    tension: 0.1, spanGaps: false,
  }));
  RANK_CHART = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { type: 'time', time: { unit: _chartTimeUnit(), tooltipFormat: 'yyyy-MM-dd' },
             ticks: { color: '#6b7280', maxRotation: 0, minRotation: 0, autoSkip: true, autoSkipPadding: 20, maxTicksLimit: 5, source: 'auto', font: { size: 10 } },
             grid: { color: '#f3f4f6' } },
        y: { reverse: true, title: { display: true, text: i18n('player.chart.rank'), color: '#6b7280' },
             ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } },
      },
      plugins: { legend: { labels: { color: '#374151', font: { size: 10 } } } },
    },
    plugins: [SHARED_LV_BG_PLUGIN],
  });
}

// パフォーマンスチャート: 大会ごとの perf_rank (相当全国順位) の折れ線 + 総合評価の推移
function renderPerfChart() {
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('chart-canvas'));
  if (RANK_CHART) { RANK_CHART.destroy(); RANK_CHART = null; }
  if (!canvas || !PLAYER || !MAIN_REC || !META) return;
  const evalDate = new Date(META.eval_date + 'T00:00:00');
  const evalTs = evalDate.getTime();
  const rangeStart = evalTs - _chartRangeDays() * 86400 * 1000;
  const pts = (PLAYER.tournaments || [])
    .filter(t => t.perf_rank != null && t.date && !t.is_dq)
    .map(t => ({ x: /** @type {string} */ (t.date), y: t.perf_rank, _name: t.name, _place: t.place, _nent: t.nent,
                 _pre: (t.pretour_ranks && t.pretour_ranks.ensemble) || null }))
    .filter(p => { const ts = new Date(p.x).getTime(); return ts >= rangeStart && ts <= evalTs; })
    .sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime());
  // 点色: 当時の総合評価以上のパフォーマンス=緑 / 未満=青 / 当時無ランク=灰
  const ptColor = (raw) => {
    if (!raw || raw._pre == null) return '#9ca3af';
    return raw.y <= raw._pre ? '#16a34a' : '#2563eb';
  };
  /** @param {number} days @returns {string} */
  const dateFromDaysAgo = (days) => {
    const d = new Date(evalDate); d.setDate(d.getDate() - days);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const hist = _filterHistForRange((PLAYER.history || []).slice().sort((a, b) => b.d - a.d));
  const ensPts = hist.map(h => ({ x: dateFromDaysAgo(h.d), y: h.ens }))
    .concat([{ x: META.eval_date, y: MAIN_REC.ranks.ensemble }])
    .filter(p => p.y != null && p.y > 0)
    .sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime());
  RANK_CHART = new Chart(canvas, {
    type: 'line',
    data: { datasets: [{
      label: i18n('player.performance'),
      data: pts,
      borderColor: '#7c3aed', backgroundColor: '#7c3aed40',
      tension: 0.1, spanGaps: false,
      pointRadius: 5, pointHoverRadius: 7, pointHitRadius: 10,
      pointBackgroundColor: (ctx) => ptColor(ctx.raw),
      pointBorderColor: (ctx) => ptColor(ctx.raw),
    }, {
      label: i18n('ranking.tab.ensemble'),
      data: ensPts,
      borderColor: '#dc2626', backgroundColor: '#dc262640',
      tension: 0.1, spanGaps: false,
      pointRadius: 0, pointHoverRadius: 4, pointHitRadius: 6,
    }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { type: 'time', time: { unit: _chartTimeUnit(), tooltipFormat: 'yyyy-MM-dd' },
             ticks: { color: '#6b7280', maxRotation: 0, minRotation: 0, autoSkip: true, autoSkipPadding: 20, maxTicksLimit: 5, source: 'auto', font: { size: 10 } },
             grid: { color: '#f3f4f6' } },
        y: { reverse: true, title: { display: true, text: i18n('player.chart.equivalent_rank'), color: '#6b7280' },
             ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } },
      },
      plugins: {
        legend: { labels: { color: '#374151', font: { size: 10 } } },
        tooltip: { callbacks: {
          label: (ctx) => ctx.dataset.label === i18n('ranking.tab.ensemble')
            ? `${i18n('ranking.tab.ensemble')} #${ctx.parsed.y}`
            : `${i18n('common.national')} #${ctx.parsed.y} ${i18n('player.equivalent')}`,
          afterLabel: (ctx) => {
            if (ctx.dataset.label === i18n('ranking.tab.ensemble')) return [];
            const r = ctx.raw || {};
            const lines = [];
            if (r._place != null) lines.push(`${i18n('common.place_n', { n: r._place })}${r._nent != null ? '/' + r._nent : ''}`);
            if (r._name) lines.push(r._name);
            return lines;
          },
        } },
      },
    },
    plugins: [SHARED_LV_BG_PLUGIN],
  });
}

/** @param {'tjpr' | 'bt'} which */
function renderScoreChart(which) {
  // which = 'tjpr' | 'bt'
  const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById('chart-canvas'));
  if (RANK_CHART) { RANK_CHART.destroy(); RANK_CHART = null; }
  if (!canvas || !PLAYER || !MAIN_REC || !META) return;
  const evalDate = new Date(META.eval_date + 'T00:00:00');
  /** @param {number} days @returns {string} */
  const dateFromDaysAgo = (days) => {
    const d = new Date(evalDate); d.setDate(d.getDate() - days);
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  const histAll = (PLAYER.history || []).slice().sort((a, b) => b.d - a.d);
  const hist = _filterHistForRange(histAll);
  // tjpr は単線。bt は「直対評価 (= peak180)」と「内部レート (= current)」の 2 系列.
  let datasets;
  let yLabel;
  if (which === 'tjpr') {
    yLabel = i18n('player.chart.tjpr_score_axis');
    // snap 点 (= 真の累積). tjpr_lv を保持して snap jump 点の tooltip で Lv 変化を表示.
    const snapPts = hist.map(h => ({ x: dateFromDaysAgo(h.d), y: h['tjpr_e'], _lv: h['tjpr_lv'] }))
      .concat([{ x: META.eval_date, y: MAIN_REC.scores.tjpr_elo, _lv: MAIN_REC.scores.tjpr_level }])
      .filter(p => p.y != null)
      .sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime());
    const evalTs = new Date(META.eval_date).getTime();
    const rangeStart = evalTs - _chartRangeDays() * 86400 * 1000;
    // 大会 (= tjpr_w > 0) を日付昇順
    const tours = (PLAYER.tournaments || [])
      .filter(t => (t.tjpr_w || 0) > 0 && t.date)
      .map(t => ({ t, ts: new Date(/** @type {string} */ (t.date)).getTime() }))
      .filter(o => o.ts >= rangeStart && o.ts <= evalTs)
      .sort((a, b) => a.ts - b.ts);
    // snap 間 (s_prev, s_next) の中に挟まる大会の貢献 (= tjpr_w) で
    // s_prev.y -> s_next.y を比例配分。これで「大会日に y がジャンプ」する自然な折れ線になる
    const tourPts = [];
    const lineSegs = [];  // {x, y} 列、最終的に line dataset の data になる
    for (let i = 0; i < snapPts.length; i++) {
      lineSegs.push(snapPts[i]);
      if (i + 1 >= snapPts.length) break;
      const sPrev = snapPts[i], sNext = snapPts[i + 1];
      const tPrev = new Date(sPrev.x).getTime();
      const tNext = new Date(sNext.x).getTime();
      // tPrev は inclusive, tNext は exclusive. snap 日と大会日が一致した場合、
      // その大会の貢献は次の snap (= sNext) に初めて反映されるので (sPrev, sNext] 区間に
      // 割り当てる. 旧 `> tPrev && < tNext` 条件だと snap 日と大会日が完全一致した時
      // どの区間にも assign されず点が消える bug があった (e.g. uid=1941489 の 2026-03-17).
      const between = tours.filter(o => o.ts >= tPrev && o.ts < tNext);
      if (between.length === 0) continue;
      const totalW = between.reduce((s, o) => s + (o.t.tjpr_w || 0), 0);
      const dy = /** @type {number} */ (sNext.y) - /** @type {number} */ (sPrev.y);   // snapPts は y != null で絞ってある
      let cum = /** @type {number} */ (sPrev.y);
      for (const o of between) {
        const contribFrac = totalW > 0 ? (/** @type {number} */ (o.t.tjpr_w) / totalW) : (1 / between.length);
        cum += dy * contribFrac;
        tourPts.push({ x: o.t.date, y: cum, _entry: o.t });
        lineSegs.push({ x: o.t.date, y: cum });
      }
    }
    // snap 点で大会なしでも一定 threshold 以上の score 変化があった場所 (= Lv 変化や
    // 時間 decay 累積) を点として表示. 大会日と一致する snap は tour 点と重なるので除外.
    const tourDates = new Set(tourPts.map(p => p.x));
    const snapJumpPts = [];
    for (let i = 1; i < snapPts.length; i++) {
      const sPrev = snapPts[i - 1], sCur = snapPts[i];
      if (tourDates.has(sCur.x)) continue;
      const dy = (sCur.y || 0) - (sPrev.y || 0);
      // 区間に大会がなくて (= Lv 変化や decay 累積による)、視覚的に明確な変化があれば点を打つ.
      const tPrev = new Date(sPrev.x).getTime();
      const tCur = new Date(sCur.x).getTime();
      const hasTour = tourPts.some(o => {
        const ts = new Date(o.x).getTime();
        return ts >= tPrev && ts < tCur;
      });
      // Lv 変化が伴う snap jump のみ点を打つ. 「大会非依存の cascade 再計算による
      // decay 累積」は単なる時間経過なので点なし (= line のみ).
      const lvChanged = (sPrev._lv != null && sCur._lv != null && sPrev._lv !== sCur._lv);
      if (!hasTour && Math.abs(dy) >= 5 && lvChanged) {
        snapJumpPts.push({
          x: sCur.x, y: sCur.y, _snapJump: true, _dy: dy,
          _lvPrev: sPrev._lv, _lvCur: sCur._lv,
          _xPrev: sPrev.x,
        });
      }
    }
    datasets = [
      {
        label: yLabel,
        data: lineSegs.sort((a, b) => new Date(a.x).getTime() - new Date(b.x).getTime()),
        borderColor: '#d97706', backgroundColor: '#d9770640',
        tension: 0, spanGaps: false,
        pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0,  // hover 検出無効
      },
      {
        label: yLabel,  // line と同じ (= legend / tooltip label 統一)
        data: tourPts,
        showLine: false,
        borderColor: '#d97706', backgroundColor: '#d97706',
        pointRadius: 4, pointHoverRadius: 7, pointHitRadius: 50,
        pointBackgroundColor: '#d97706',
        _hideLegend: true,
      },
      {
        label: i18n('player.chart.lv_change'),  // snap 単位の jump (= 大会非依存の Lv 切替)
        data: snapJumpPts,
        showLine: false,
        borderColor: '#d97706', borderWidth: 2,
        backgroundColor: '#fef3c7',  // 薄黄: 大会点と区別
        pointRadius: 6, pointHoverRadius: 9, pointHitRadius: 50,
        pointStyle: 'rectRot',  // 菱形で大会の丸点と区別
        _hideLegend: true,
      }
    ];
  } else {
    yLabel = i18n('player.chart.bt_score_axis');
    // [EXPERIMENTAL] Glicko2 timeline (bt_timeline_g2) が利用可能なら、それを 1 source of truth として使う.
    // 旧 OpenSkill 経路は fallback として残す.
    const useG2 = !!(PLAYER.bt_timeline_g2 && PLAYER.bt_timeline_g2.length);
    const ELO = (META.params && META.params.ELO_PER_UNIT) || 29.48;
    const OFFSET = (META.params && META.params.BT_ELO_OFFSET) || 1000;
    // 統一インターフェース: tl = [{date, ord_value}] where ord_value は描画 y 軸単位 (= Elo-space)
    // Glicko2: rating そのまま (= Elo-space). OpenSkill: ord -> ord*ELO+OFFSET で変換.
    const rawTl = useG2 ? (PLAYER.bt_timeline_g2 || []) : (PLAYER.bt_timeline || []);
    const tl = rawTl.slice()
      .map(p => useG2
        ? { date: p.date, ord: p.rating }       // Glicko2: rating を擬似 "ord" として扱う
        : { date: p.date, ord: p.ord }          // OpenSkill: ord を保持
      )
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const rangeStartDate = new Date(evalDate);
    rangeStartDate.setDate(rangeStartDate.getDate() - _chartRangeDays());
    const rangeStartIso = rangeStartDate.toISOString().slice(0, 10);
    // 大会名・順位・delta lookup: tournament_entries を date で索引
    /** @type {Record<string, PTour>} */
    const tEntryByDate = {};
    for (const t of (PLAYER.tournaments || [])) {
      if (t.bt_used && t.date) tEntryByDate[t.date] = t;
    }
    // 候補日 = tl の各 date + 大会の +180+1 日 後 (= rolloff 候補) のうち eval_date 以下.
    // 内部レート/直対評価スコアの両 dataset を同じ X 配列に揃え、mouseover で同位置を hover できるようにする.
    const WINDOW_MS = 180 * 86400 * 1000;
    const dayMs = 86400 * 1000;
    const evalDateIso = META.eval_date;
    const evalTs = new Date(evalDateIso).getTime();
    const candidates = new Set();
    for (const p of tl) {
      candidates.add(p.date);
      const rolloffTs = new Date(p.date).getTime() + WINDOW_MS + dayMs;
      if (rolloffTs <= evalTs) {
        candidates.add(new Date(rolloffTs).toISOString().slice(0, 10));
      }
    }
    const tlPairs = tl.map(p => ({ ts: new Date(p.date).getTime(), ord: p.ord, date: p.date }));
    // 全候補日を sort. 各候補日について:
    //   - 内部レート: 直前の tl 大会の ord (= 大会間は flat 補間)
    //   - 直対評価スコア: 過去 180 日内の max ord
    const allDates = [...candidates].sort();
    let lastOrd = null, tlIdx = 0;
    const internalAligned = [];
    const peakAligned = [];
    /** @type {number | null} */
    let prevPeakY = null;
    for (const date of allDates) {
      const ts = new Date(date).getTime();
      while (tlIdx < tlPairs.length && tlPairs[tlIdx].ts <= ts) {
        lastOrd = tlPairs[tlIdx].ord;
        tlIdx++;
      }
      if (lastOrd == null) continue;
      const isTour = tEntryByDate[date] != null;
      // peak180 = max ord in [ts - 180d, ts].
      // build の Peak180Tracker は window 外 (ts < cutoff) の entry を prune してから max を取る。
      // よってグラフ側も window 開始前の古いレートを carry-forward してはいけない
      // (carry-forward すると長期不参加→格下げ後も過去ピークが窓内に居座り、
      //  実際の bt_gated スコアと不一致になる = 表示バグの原因だった)。
      const tStart = ts - WINDOW_MS;
      let maxOrd = -Infinity;
      for (const tp of tlPairs) {
        if (tp.ts > ts) break;
        if (tp.ts >= tStart && tp.ord > maxOrd) maxOrd = tp.ord;
      }
      // window 内に更新が無い (= 180日以上不参加) 場合は build と同様 current ord にフォールバック。
      if (maxOrd === -Infinity) maxOrd = lastOrd;
      // Glicko2 は rating 自体が Elo-space なので transform skip; OpenSkill は ord*ELO+OFFSET.
      const peakY = maxOrd === -Infinity ? null : (useG2 ? maxOrd : maxOrd * ELO + OFFSET);
      const intY = useG2 ? lastOrd : lastOrd * ELO + OFFSET;
      // rolloff 日で peak が変化していなければスキップ (noise 削減). 大会日は常に保持.
      if (!isTour && peakY != null && prevPeakY != null && Math.abs(peakY - prevPeakY) < 0.001) continue;
      internalAligned.push({ x: date, y: intY, _entry: tEntryByDate[date], _isTour: isTour });
      peakAligned.push({ x: date, y: peakY, _entry: tEntryByDate[date], _isTour: isTour });
      if (peakY != null) prevPeakY = peakY;
    }
    const inRange = arr => arr.filter(p => p.x >= rangeStartIso);
    datasets = [
      {
        label: i18n('player.chart.bt_score_label'),
        data: inRange(peakAligned),
        borderColor: '#16a34a', backgroundColor: '#16a34a40',
        tension: 0.05, spanGaps: false, pointHoverRadius: 5,
        pointRadius: (ctx) => (ctx.raw && ctx.raw._isTour) ? 2.5 : 1.5,
      },
      {
        label: i18n('player.chart.internal_rating'),
        data: inRange(internalAligned),
        borderColor: '#94a3b8', backgroundColor: '#94a3b830',
        borderDash: [4, 3],
        tension: 0.05, spanGaps: false, pointHoverRadius: 5,
        // rolloff 日には内部レートの点は描画しない (= 大会間は flat なので marker 不要).
        // ただし dataset には残してあるので hover で tooltip にはちゃんと出る.
        pointRadius: (ctx) => (ctx.raw && ctx.raw._isTour) ? 2 : 0,
      },
    ];
  }
  // BT / TJPR chart どちらも tooltip に大会情報を載せる
  const isBT = (which === 'bt');
  const isTJPR = (which === 'tjpr');
  const ELO_LOCAL = (META.params && META.params.ELO_PER_UNIT) || 29.48;
  const TJPR_SCALE_LOCAL = (META.params && META.params.TJPR_ELO_SCALE) || 17.5;
  RANK_CHART = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      events: ['mousemove', 'mouseout', 'click', 'touchstart', 'touchmove', 'touchend'],
      interaction: isBT ? { mode: 'index', intersect: false } : (isTJPR ? { mode: 'nearest', intersect: false, axis: 'x' } : { mode: 'nearest' }),
      scales: {
        x: { type: 'time', time: { unit: _chartTimeUnit() },
             ticks: { color: '#6b7280', maxRotation: 0, minRotation: 0, autoSkip: true, autoSkipPadding: 20, maxTicksLimit: 5, source: 'auto', font: { size: 10 } },
             grid: { color: '#f3f4f6' } },
        y: { title: { display: true, text: yLabel, color: '#6b7280' },
             ticks: { color: '#6b7280' }, grid: { color: '#f3f4f6' } },
      },
      plugins: {
        legend: {
          labels: {
            color: '#374151', font: { size: 10 },
            generateLabels: (chart) => {
              const def = Chart.defaults.plugins.legend.labels.generateLabels;
              return def(chart).filter((_, i) => !chart.data.datasets[i]._hideLegend);
            },
          }
        },
        tooltip: (isBT || isTJPR) ? {
          // TJPR: 大会点 (_entry あり) または snap jump 点 (_snapJump) のみ tooltip 表示.
          filter: isTJPR
            ? (item) => !!(item.raw && (item.raw._entry || item.raw._snapJump))
            : undefined,
          callbacks: {
            title: (items) => {
              if (!items || !items.length) return '';
              const entItem = items.find(it => it.raw && it.raw._entry);
              const ent = entItem && entItem.raw._entry;
              if (ent) return `${ent.date}: ${ent.name}${ent.place != null ? ' (' + i18n('common.place_n', { n: ent.place }) + ')' : ''}`;
              const jumpItem = items.find(it => it.raw && it.raw._snapJump);
              if (jumpItem) {
                const r = jumpItem.raw;
                return `${r._xPrev} → ${r.x}: Lv ${r._lvPrev} → ${r._lvCur}`;
              }
              return items[0].label || '';
            },
            label: (item) => {
              const v = (item.parsed && item.parsed.y != null) ? item.parsed.y.toFixed(2) : '';
              return `${item.dataset.label}: ${v}`;
            },
            afterBody: (items) => {
              if (!items || !items.length) return '';
              const entItem = items.find(it => it.raw && it.raw._entry);
              const ent = entItem && entItem.raw._entry;
              if (ent) {
                const lines = [];
                if (isBT) {
                  const peakD = (ent.bt_d || 0) * ELO_LOCAL;
                  const intD = (ent.bt_internal_d || 0) * ELO_LOCAL;
                  if (Math.abs(peakD) > 0.01 || Math.abs(intD) > 0.01) {
                    lines.push(`${i18n('ranking.tab.bt')} Δ ${peakD > 0 ? '+' : ''}${peakD.toFixed(2)}`);
                    lines.push(`${i18n('player.chart.internal_rating')} Δ ${intD > 0 ? '+' : ''}${intD.toFixed(2)}`);
                  }
                } else if (isTJPR) {
                  const ageDecay = ent.tjpr_age || 1;
                  const wAtTime   = ((ent.tjpr_w   || 0) / ageDecay) * TJPR_SCALE_LOCAL;
                  const rawAtTime = (ent.tjpr_raw || 0) * TJPR_SCALE_LOCAL;
                  if (rawAtTime > 0.001 || wAtTime > 0.001) {
                    const signed = (wAtTime >= 0 ? '+' : '') + wAtTime.toFixed(2);
                    lines.push(`${signed} (${rawAtTime.toFixed(2)})`);
                  }
                }
                return lines;
              }
              const jumpItem = items.find(it => it.raw && it.raw._snapJump);
              if (jumpItem) {
                const r = jumpItem.raw;
                const dy = r._dy || 0;
                const action = r._lvCur > r._lvPrev ? i18n('player.chart.lv_up') : i18n('player.chart.lv_down');
                return [
                  `${i18n('player.chart.score_delta')} ${dy >= 0 ? '+' : ''}${dy.toFixed(2)}`,
                  `${action} (Lv ${r._lvPrev} → ${r._lvCur}) — ${i18n('player.chart.method_change')}`,
                ];
              }
              return '';
            },
          },
        } : undefined,
      },
    },
    // Lv 帯背景: TJPR / BT どちらも shared_lv (= ensemble cascade 共通レベル) で統一
    plugins: (which === 'tjpr' || which === 'bt') ? [SHARED_LV_BG_PLUGIN] : [],
  });
}

function _activeChartTab() {
  const el = /** @type {HTMLElement | null} */ (document.querySelector('.chart-tab.active'));
  return el ? el.dataset.chart : 'rank';
}
function _rerenderActiveChart() {
  const which = _activeChartTab();
  if (which === 'rank') renderRankChart();
  else if (which === 'tjpr_score') renderScoreChart('tjpr');
  else if (which === 'bt_score') renderScoreChart('bt');
  else if (which === 'perf') renderPerfChart();
}
document.querySelectorAll('.chart-tab').forEach(t0 => {
  const t = /** @type {HTMLElement} */ (t0);
  t.addEventListener('click', () => {
    document.querySelectorAll('.chart-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    if (t.dataset.chart === 'rank') renderRankChart();
    else if (t.dataset.chart === 'tjpr_score') renderScoreChart('tjpr');
    else if (t.dataset.chart === 'bt_score') renderScoreChart('bt');
    else if (t.dataset.chart === 'perf') renderPerfChart();
  });
});

// ── Share / Save ──  (html2canvas の読み込み・保存ボタンの流れは ../share.js)
async function capturePng() {
  // Temporarily expand the hidden achievements so all show in the image
  const hidden = document.getElementById('ach-hidden');
  const toggleBtn = document.getElementById('ach-toggle');
  const wasHidden = hidden && hidden.style.display === 'none';
  if (wasHidden) hidden.style.display = '';
  if (toggleBtn) toggleBtn.style.display = 'none';
  // 予定大会 + シミュボタン / 最新の大会結果はシェア画像に含めない
  const yosou = document.getElementById('yosou-section');
  const yosouShown = yosou && yosou.style.display !== 'none';
  if (yosouShown) yosou.style.display = 'none';
  const latestres = document.getElementById('latestres-section');
  const latestresShown = latestres && latestres.style.display !== 'none';
  if (latestresShown) latestres.style.display = 'none';
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    const target = document.getElementById('share-top') || document.getElementById('share-card');
    return await SPSPShare.capturePng(/** @type {HTMLElement} */ (target));
  } finally {
    if (wasHidden) hidden.style.display = 'none';
    if (toggleBtn) toggleBtn.style.display = '';
    if (yosouShown) yosou.style.display = '';
    if (latestresShown) latestres.style.display = '';
  }
}

// ── プレイヤーカードの画像: 保存 / 共有 (../js/player_card.js capture) ──
const cardFileName = () => `spsp_card_${SPSPShare.safeFileName(MAIN_REC && SPSPFormat.stripTeamTag(MAIN_REC.display), 'player')}`;
/** @param {Blob} blob @param {string} name */
function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** 押している間は無効化して「生成中…」。カードの PNG を作って fn に渡す
 * @param {HTMLElement | null} btn @param {(blob: Blob) => (void | Promise<void>)} fn */
function onCardImage(btn, fn) {
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const card = document.getElementById('pcard');
    if (!card || !MAIN_REC) return;
    const label = btn.querySelector('span');
    const orig = label ? label.textContent : '';
    btn.setAttribute('disabled', ''); if (label) label.textContent = i18n('share.s2');
    try {
      const blob = await SPSPPlayerCard.capture(card);
      if (!blob) throw new Error('empty');
      await fn(blob);
    } catch (err) {
      if (/** @type {any} */ (err).name !== 'AbortError') alert(i18n('player.card.capture_failed') + /** @type {Error} */ (err).message);
    } finally {
      btn.removeAttribute('disabled'); if (label) label.textContent = orig;
    }
  });
}
// 保存はカードをタップして出るボタン
for (const id of ['pc-ov-save']) onCardImage(document.getElementById(id), blob => downloadBlob(blob, cardFileName() + '.png'));
// 共有: 画像つきの共有シートが使えれば (スマホなど) カードの画像とページの URL を渡す (X などアプリを選べる)。
// 使えなければ今までの URL 共有 (共有シート → だめならクリップボードにコピー。../share.js)
const shareData = () => MAIN_REC ? {
  // 共有の文面は 名前 (チームタグ無し)・総合順位・SPSP だけ
  title: `${SPSPFormat.stripTeamTag(MAIN_REC.display)} | SPSP`,
  text:  i18n('player.share.text', { name: SPSPFormat.stripTeamTag(MAIN_REC.display), rank: MAIN_REC.ranks.ensemble }),
  url:   location.href,
} : { url: location.href };
/** @returns {boolean} */
function canShareImage() {
  const nav = /** @type {any} */ (navigator);
  try { return !!(typeof File === 'function' && nav.canShare && nav.canShare({ files: [new File([''], 'x.png', { type: 'image/png' })] })); }
  catch (e) { return false; }
}
for (const id of ['pc-share-btn']) {   // 見出しの横
  const shareBtn = document.getElementById(id);
  if (shareBtn && !canShareImage()) {
    SPSPShare.setup(shareBtn, shareData);
  } else {
    onCardImage(shareBtn, async blob => {
      const d = shareData();
      const file = new File([blob], cardFileName() + '.png', { type: 'image/png' });
      await /** @type {any} */ (navigator).share({ files: [file], title: d.title, text: `${d.text}\n${d.url}` });   // URL は次の行に
    });
  }
}

// カードをタップすると、カードの上に編集 (本人のページだけ)・保存が出る (もう一度・カードの外をタップで消える)。カードの中のリンクはそのまま飛ぶ
{
  const wrap = document.getElementById('pcard-wrap');
  document.addEventListener('click', e => {
    if (!wrap) return;
    const el = /** @type {Element} */ (e.target);
    if (el.closest('#pc-overlay')) return;
    if (el.closest('#pcard') && !el.closest('a')) wrap.classList.toggle('show');
    else wrap.classList.remove('show');
  });
}

SPSPShare.setupSaveButton(document.getElementById('save-btn'), capturePng,
  () => `smash_banzuke_${SPSPShare.safeFileName(MAIN_REC && MAIN_REC.display, 'player')}`);


loadData();
