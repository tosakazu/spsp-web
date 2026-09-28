// @ts-check
// seeding/app/40_startgg.js — SPSP シードツール本体の一部: start.gg API (取得・適用・エラー辞書・CSV ダウンロード)。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { SEED_APP_CONFIG, i18n } from './10_skeleton.js';
import { DATA, canonicalUserId, ensureTable, loadMasterData, manualClickHandler, orderedRecs, renderManualUI, restoreManualForEvent } from './30_core.js';
import { showEventPickerInline } from './60_upcoming.js';
import { cleanupSeedOptWorker, dropAppliedOrder, initSeedOptPanel, runSeedOptimize, updateIntraToggleState } from './75_series_rematch.js';
import { fetchPhaseWaves } from './85_waves.js';
import { escapeHtml } from '../../js/html.js';
import SPSPRankingTable from '../../ranking-table.js';
import SmashSeed from '../../seed-upload/seed_uploader.js';
'use strict';

/** start.gg API のエラー。rawError = 生の応答 (showError の details に出す) */
/** @typedef {Error & { rawError?: string }} StartggError */
/** start.gg の event (EVENT_QUERY の応答。phases は phase 未作成なら空) */
/** @typedef {{ id: number | string, name: string, slug?: string | null, numEntrants?: number,
 *              tournament?: { id?: number | string, name: string, slug?: string } | null, phases?: any[] | null, [k: string]: any }} StartggEvent */
/** 参加者 1 人分 (seeds / entrants のノードから。phase 未作成なら seedId / originalSeed は null) */
/** @typedef {{ seedId: number | string | null, originalSeed: number | null, userId: number | null | undefined, display: string,
 *              discriminator: string | null, entrantId: number | null }} SeedInfo */

// ── start.gg API helpers ──
/** @param {string} token @param {string} query @param {Record<string, unknown>} [variables] @returns {Promise<any>} */
export async function startggQuery(token, query, variables) {
  const res = await fetch('https://api.start.gg/gql/alpha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch (e) {}
    const err = /** @type {StartggError} */ (new Error(`start.gg HTTP ${res.status}`));
    err.rawError = `HTTP ${res.status}: ${body.substring(0, 1000)}`;
    throw err;
  }
  const body = await res.json();
  if (body.errors && body.errors.length) {
    const errMsgs = body.errors.map(e => e.message).join(' | ');
    const err = /** @type {StartggError} */ (new Error(i18n('seed.startgg.s1') + errMsgs));
    err.rawError = JSON.stringify(body.errors, null, 2);
    throw err;
  }
  return body.data;
}

// ── start.gg エラーメッセージのトラブルシューティング辞書 ──
const TROUBLESHOOTING = [
  { match: /401|unauthorized|invalid (api )?token|bad token/i,
    hint: '🔑 API トークンが無効/期限切れ。<a href="https://start.gg/admin/profile/developer" target="_blank" rel="noopener">start.gg で再発行</a> してください。' },
  { match: /403|forbidden|not (allowed|authorized)/i,
    hint: i18n('seed.startgg.s2') },
  { match: /404|not found|event.*(not exist|does not exist)/i,
    hint: i18n('seed.startgg.s3') },
  { match: /429|too many|rate.?limit/i,
    hint: i18n('seed.startgg.s4') },
  { match: /5\d\d|gateway|timeout|server error/i,
    hint: i18n('seed.startgg.s5') },
  { match: /invalid phase|phase.*(not found|invalid)|seeding.*not.*allowed/i,
    hint: i18n('seed.startgg.s6') },
  { match: /network|fetch|failed to fetch/i,
    hint: i18n('seed.startgg.s7') },
];
/** @param {string | null | undefined} msg @returns {string[]} */
function findTroubleshooting(msg) {
  const s = String(msg || '');
  const hits = TROUBLESHOOTING.filter(t => t.match.test(s));
  return hits.map(t => t.hint);
}
// showError(msg, rawError):
//   msg     = ユーザ向けの分かりやすい説明 (status に表示)
//   rawError = (optional) 生の API/system エラーメッセージ (debug 用 details に表示)
//             msg と異なる場合のみ <details> を出す. 省略時 OR 同じ場合は出さない.
/** @param {string} msg @param {string} [rawError] */
export function showError(msg, rawError) {
  const status = document.getElementById('status');
  if (status) status.textContent = '❌ ' + msg;
  const help = document.getElementById('error-help');
  if (!help) return;
  // hints は raw を優先 (= 英語 API error と matching する). 無ければ msg.
  const hints = findTroubleshooting(rawError || msg);
  const hasRawDetail = rawError && rawError !== msg;
  const detailsHtml = hasRawDetail
    ? `<details style="margin-top:8px"><summary style="cursor:pointer;color:#9ca3af;font-size:11px">${i18n('seed.startgg.t1')}</summary><pre style="white-space:pre-wrap;margin:6px 0 0;font-family:inherit;font-size:11px;color:#6b7280">${escapeHtml(rawError)}</pre></details>`
    : '';
  if (hints.length === 0) {
    if (hasRawDetail) {
      help.innerHTML = `<div style="font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 12px">${detailsHtml}</div>`;
    } else {
      help.innerHTML = '';
    }
  } else {
    help.innerHTML = `<div style="font-size:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px 12px">
      <div style="color:#dc2626;font-weight:600;margin-bottom:4px">${i18n('seed.startgg.t2')}</div>
      <ul style="margin:0;padding-left:1.4em;color:#374151">${hints.map(h => `<li>${h}</li>`).join('')}</ul>
      ${detailsHtml}
    </div>`;
  }
  help.style.display = (help.innerHTML ? '' : 'none');
}
function clearError() {
  const help = document.getElementById('error-help');
  if (help) { help.style.display = 'none'; help.innerHTML = ''; }
}
// escapeHtml は ../js/html.js (サイト共通、グローバル)

/** @param {string | null | undefined} input @returns {{ slug: string | null, tournamentSlug: string, eventSlug: string | null } | null} */
function parseEventUrl(input) {
  if (!input) return null;
  const s = String(input).trim();
  // Full URL or slug. Accept things like "tournament/X/event/Y" or "https://www.start.gg/tournament/X/event/Y[/...]"
  const m = s.match(/tournament\/([^\/\s?#]+)\/event\/([^\/\s?#]+)/);
  if (m) {
    return { slug: 'tournament/' + m[1] + '/event/' + m[2], tournamentSlug: m[1], eventSlug: m[2] };
  }
  // tournament-only URL (= event slug 無し). 末尾の /details, /events, /, "" などすべて吸収.
  // event slug を含まないように、tournament slug の直後が / + 非 "event" or 終端であることを要求.
  const t = s.match(/tournament\/([^\/\s?#]+)(?:\/(?!event\/)[^\s?#]*)?(?:[?#].*)?$/);
  if (t) {
    return { slug: null, tournamentSlug: t[1], eventSlug: null };
  }
  return null;
}

const EVENT_QUERY = `
  query EventDetail($slug: String!) {
    event(slug: $slug) {
      id name slug numEntrants
      tournament { id name slug startAt }
      phases { id name phaseOrder bracketType state groupCount numSeeds
               progressingInData { origin numProgressing } }
    }
  }
`;

const SEEDS_QUERY = `
  query PhaseSeeds($phaseId: ID!, $page: Int!, $perPage: Int!) {
    phase(id: $phaseId) {
      seeds(query: { page: $page, perPage: $perPage }) {
        pageInfo { totalPages total }
        nodes {
          id seedNum
          entrant {
            id name
            participants {
              user { id discriminator }
              player { id gamerTag prefix }
            }
          }
        }
      }
    }
  }
`;

// phase (ブラケット) 未作成の event 用フォールバック: 参加登録済み entrants を直接取得.
// seeds と違い phase 不要で、参加登録が始まっていれば取れる.
const ENTRANTS_QUERY = `
  query EventEntrants($slug: String!, $page: Int!, $perPage: Int!) {
    event(slug: $slug) {
      entrants(query: { page: $page, perPage: $perPage }) {
        pageInfo { totalPages total }
        nodes {
          id name
          participants {
            user { id discriminator }
            player { id gamerTag prefix }
          }
        }
      }
    }
  }
`;

/** @param {string} token @param {string} slug @returns {Promise<StartggEvent>} */
async function fetchEvent(token, slug) {
  const data = await startggQuery(token, EVENT_QUERY, { slug });
  if (!data.event) throw new Error(i18n('seed.startgg.s8') + slug);
  return data.event;
}

const TOURNAMENT_EVENTS_QUERY = `
  query TournamentEvents($slug: String!) {
    tournament(slug: $slug) {
      id name slug
      events {
        id slug name numEntrants
        videogame { id name }
        type
      }
    }
  }
`;

// SSBU videogame id, 1on1 event type
const SSBU_VIDEOGAME_ID = 1386;
const SINGLES_EVENT_TYPE = 1;

/** @param {string} token @param {string} tournamentSlug @returns {Promise<any>} */
async function fetchTournament(token, tournamentSlug) {
  const data = await startggQuery(token, TOURNAMENT_EVENTS_QUERY, { slug: tournamentSlug });
  if (!data.tournament) throw new Error(i18n('seed.startgg.s9') + tournamentSlug);
  return data.tournament;
}

/** @param {string} token @param {number | string} phaseId @param {(got: number, tot: number) => void} [progressFn] @returns {Promise<any[]>} */
async function fetchAllSeeds(token, phaseId, progressFn) {
  const all = [];
  let page = 1;
  const perPage = 64;
  while (true) {
    const data = await startggQuery(token, SEEDS_QUERY, { phaseId: String(phaseId), page, perPage });
    if (!data.phase) throw new Error(i18n('seed.startgg.s10'));
    const seeds = data.phase.seeds || { nodes: [], pageInfo: { totalPages: 1 } };
    const nodes = seeds.nodes || [];
    all.push(...nodes);
    if (progressFn) progressFn(all.length, seeds.pageInfo.total || all.length);
    const tot = seeds.pageInfo.totalPages || 1;
    if (page >= tot || nodes.length === 0) break;
    page += 1;
    // small delay to avoid 429
    await new Promise(r => setTimeout(r, 500));
  }
  return all;
}

/** @param {string} token @param {string} eventSlug @param {(got: number, tot: number) => void} [progressFn] @returns {Promise<any[]>} */
async function fetchAllEntrants(token, eventSlug, progressFn) {
  const all = [];
  let page = 1;
  const perPage = 64;
  while (true) {
    const data = await startggQuery(token, ENTRANTS_QUERY, { slug: eventSlug, page, perPage });
    if (!data.event) throw new Error(i18n('seed.startgg.s11'));
    const entrants = data.event.entrants || { nodes: [], pageInfo: { totalPages: 1 } };
    const nodes = entrants.nodes || [];
    all.push(...nodes);
    if (progressFn) progressFn(all.length, entrants.pageInfo.total || all.length);
    const tot = entrants.pageInfo.totalPages || 1;
    if (page >= tot || nodes.length === 0) break;
    page += 1;
    // small delay to avoid 429
    await new Promise(r => setTimeout(r, 500));
  }
  return all;
}

// entrant node → seedNodeToInfo と同じ shape. phase が無いので seedId / originalSeed は null
// (= シード適用は不可、閲覧 / CSV のみ).
/** @param {Record<string, any> | null | undefined} node @returns {SeedInfo} */
function entrantNodeToInfo(node) {
  const ent = node || {};
  const parts = ent.participants || [];
  /** @type {number | null} */
  let uid = null;
  let gamerTag = ent.name || '', prefix = '';
  /** @type {string | null} */
  let disc = null;
  if (parts.length) {
    const p0 = parts[0];
    if (p0.user && p0.user.id != null) uid = Number(p0.user.id);
    if (p0.user && p0.user.discriminator) disc = String(p0.user.discriminator);
    if (p0.player) {
      gamerTag = p0.player.gamerTag || gamerTag;
      prefix = p0.player.prefix || '';
    }
  }
  const display = prefix ? (prefix + ' | ' + gamerTag) : gamerTag;
  return { seedId: null, originalSeed: null, userId: canonicalUserId(uid), display, discriminator: disc, entrantId: ent.id != null ? Number(ent.id) : null };
}

/** @param {Record<string, any>} seedNode @returns {SeedInfo} */
function seedNodeToInfo(seedNode) {
  const sid = seedNode.id;
  const sn = seedNode.seedNum;
  const ent = seedNode.entrant || {};
  const parts = ent.participants || [];
  /** @type {number | null} */
  let uid = null;
  let gamerTag = ent.name || '', prefix = '';
  /** @type {string | null} */
  let disc = null;
  if (parts.length) {
    const p0 = parts[0];
    if (p0.user && p0.user.id != null) uid = Number(p0.user.id);
    if (p0.user && p0.user.discriminator) disc = String(p0.user.discriminator);
    if (p0.player) {
      gamerTag = p0.player.gamerTag || gamerTag;
      prefix = p0.player.prefix || '';
    }
  }
  const display = prefix ? (prefix + ' | ' + gamerTag) : gamerTag;
  return { seedId: sid, originalSeed: sn, userId: canonicalUserId(uid), display, discriminator: disc, entrantId: ent.id != null ? Number(ent.id) : null };
}

/** @param {SeedInfo[]} seedInfos @returns {{ records: any[], rankedCount: number, missingCount: number }} */
export function filterAndRerank(seedInfos) {
  // seedInfos = [{seedId, originalSeed, userId, display}]
  const MASTER = /** @type {Map<number, SpspRankRecord>} */ (S.MASTER_MAP);   // loadMasterData 済みで呼ばれる
  const ranked = [];
  const missing = [];
  for (const si of seedInfos) {
    if (si.userId != null && MASTER.has(si.userId)) {
      // Deep clone the master record so we don't pollute the shared map
      const rec = JSON.parse(JSON.stringify(MASTER.get(si.userId)));
      rec.ranks = rec.ranks || {};
      rec.ranks.global_ensemble = rec.ranks.ensemble;
      rec.ranks.global_tjpr = rec.ranks.tjpr;
      rec.ranks.global_bt_gated = rec.ranks.bt_gated;
      rec.seedId = si.seedId;
      rec.original_seed = si.originalSeed;
      rec.entrantId = si.entrantId;
      rec.discriminator = si.discriminator || null;   // start.gg 参加者データ由来 (CSV 照合用)
      ranked.push(rec);
    } else {
      missing.push(si);
    }
  }
  const n = ranked.length;
  // Ensemble は event-local で 1..N に再付番 (= シード順そのもの)
  ranked.sort((a, b) => (a.ranks.global_ensemble || 1e9) - (b.ranks.global_ensemble || 1e9));
  ranked.forEach((r, i) => { r.ranks.ensemble = i + 1; });
  // 順位評価 / 直対評価 は全体ランキングのまま保持 (re-rank しない)
  // 既存の rec.ranks.tjpr / rec.ranks.bt_gated は global 順位なのでそのまま使う
  // ensemble_avg_rank も既に global tjpr+bt の平均なのでそのまま
  // Append DB-missing players at the bottom (in start.gg seed order)
  missing.sort((a, b) => (a.originalSeed || 1e9) - (b.originalSeed || 1e9));
  let next = n + 1;
  for (const si of missing) {
    ranked.push({
      user_id: si.userId,
      display: si.display,
      unranked: true,
      seedId: si.seedId,
      original_seed: si.originalSeed,
      entrantId: si.entrantId,
      discriminator: si.discriminator || null,
      ranks: {
        // ensemble は event-local の連番 (最下位扱い)。tjpr/bt_gated は global 不明なので null
        ensemble: next, tjpr: null, bt_gated: null,
        global_ensemble: null, global_tjpr: null, global_bt_gated: null,
      },
      scores: {
        tjpr_score: 0.0, tjpr_elo: 0.0, tjpr_level: 0,
        bt_gated_ordinal: 0.0, bt_gated_elo: 0.0,
        ensemble_avg_rank: null, ensemble_avg_score: null,
      },
      metadata: { tour_count_3y: 0, bt_weekday_included: true, provisional: true, matches_count_3y: 0 },
    });
    next += 1;
  }
  return { records: ranked, rankedCount: n, missingCount: missing.length };
}

export function downloadCsv() {
  if (!DATA.length) return;
  if (!S.EVENT_CONTEXT) return;
  const methodLabel = {
    ensemble: i18n('seed.startgg.s12'), tjpr: i18n('seed.startgg.s13'), bt_gated: i18n('seed.startgg.s14'),
  }[S.currentMethod] || i18n('seed.startgg.s12');
  // Sort by current method's rank (or 被り回避適用順), then assign phaseseed 1..N
  const recs = orderedRecs();
  const lines = ['phaseseed,seedId,player,user_id,method,banzuke_rank,avg_rank,score,original_seed'];
  recs.forEach((r, i) => {
    const phaseseed = i + 1;
    const sid = r.seedId != null ? r.seedId : '';
    const player = (r.display || '').replace(/"/g, '""');
    const uid = r.user_id != null ? r.user_id : '';
    let bRank = '', avgR = '', score = '';
    if (!r.unranked) {
      bRank = r.ranks[S.currentMethod];
      const ar = r.scores.ensemble_avg_rank;
      avgR = ar != null ? ar.toFixed(2) : '';
      const sc = (S.currentMethod === 'tjpr') ? r.scores.tjpr_elo
                : (S.currentMethod === 'bt_gated') ? r.scores.bt_gated_elo
                : (r.scores.ensemble_avg_score != null ? r.scores.ensemble_avg_score
                  : (r.scores.tjpr_elo + r.scores.bt_gated_elo) / 2);
      score = typeof sc === 'number' ? sc.toFixed(2) : '';
    }
    const origSeed = r.original_seed != null ? r.original_seed : '';
    lines.push([phaseseed, sid, `"${player}"`, uid, methodLabel, bRank, avgR, score, origSeed].join(','));
  });
  const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tName = (S.EVENT_CONTEXT.eventName || 'seed').replace(/[^\w\-]/g, '_');
  a.href = url;
  // ファイル名に出力順の由来を付ける (手動調整 / 被り回避適用)。
  const orderTag = (S.MANUAL ? '_manual' : '') + (S.APPLIED_ORDER ? '_opt' : '');
  a.download = `spsp_seed_${tName}_${S.currentMethod}${orderTag}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 適用の confirm に出す「何の順か」。被り回避・手動調整の反映があれば添える。
function uploadOrderLabel() {
  const base = {
    ensemble: i18n('seed.startgg.s12'), tjpr: i18n('seed.startgg.s13'), bt_gated: i18n('seed.startgg.s14'),
  }[S.currentMethod] || i18n('seed.startgg.s12');
  const extra = [];
  if (S.MANUAL) extra.push(i18n('seed.startgg.s31'));
  if (S.APPLIED_ORDER) extra.push(i18n('seed.startgg.s32'));
  return extra.length ? i18n('seed.startgg.order_applied', { base: base, extra: extra.join(i18n('seed.startgg.order_applied_sep')) }) : base;
}

function isAutoOptimizeOn() {
  const cb = /** @type {HTMLInputElement | null} */ (document.getElementById('so-auto-apply'));
  return !!(cb && cb.checked);
}

// 被り回避パネル (折りたたみ) を開く。自動実行時にレポートが見えるように。
function openSeedOptPanel() {
  const d = /** @type {HTMLDetailsElement | null} */ (document.getElementById('seedopt-details'));
  if (d) d.open = true;
}

/**
 * シード適用前の自動被り回避。true = そのまま適用に進んでよい。
 * - チェック OFF → 何もしない (true)。
 * - 反映済みの最適化 (APPLIED_ORDER) がある → そのまま使う (true)。
 * - 実行中の最適化がある → 止めて false (二重実行しない)。
 * - それ以外 → パネルを開いて最適化を回し、完了 (= 自動反映) を待つ。完了しなければ false。
 */
async function ensureAutoOptimizeForUpload() {
  if (!isAutoOptimizeOn()) return true;
  if (S.SEEDOPT_WORKER) {
    alert(i18n('seed.startgg.s33'));
    return false;
  }
  if (S.APPLIED_ORDER) return true;
  openSeedOptPanel();
  const status = document.getElementById('status');
  clearError();
  if (status) status.textContent = i18n('seed.startgg.s34');
  const ok = await runSeedOptimizeAndWait();
  if (ok) return true;
  const progress = document.getElementById('so-progress');
  const why = ((progress && progress.textContent) || '').replace(/^⚠\s*/, '').trim();
  showError(i18n('seed.startgg.auto_opt_failed', { why: why ? ': ' + why : '' }));
  return false;
}

// runSeedOptimize の完了を待つ Promise 化。resolve(true) = 完了して反映済み、
// resolve(false) = 事前チェックで始まらなかった / エラー / 非対応 / 別の取得で止まった。
// 決着は finishSeedOptimize (完了) と cleanupSeedOptWorker (それ以外の終了) から。
/** @type {((ok: boolean) => void) | null} */
let SEEDOPT_WAITER = null;
/** @param {boolean} ok */
export function settleSeedOptWaiter(ok) {
  const w = SEEDOPT_WAITER;
  SEEDOPT_WAITER = null;
  if (w) w(!!ok);
}
/** @returns {Promise<boolean>} */
function runSeedOptimizeAndWait() {
  return new Promise((resolve) => {
    settleSeedOptWaiter(false);   // 取り残しがあれば片付ける
    SEEDOPT_WAITER = resolve;
    runSeedOptimize().then(() => {
      // worker が生成されていない = 事前チェック (形式・シリーズ未選択・ズレ上限の順序) で
      // 止まった。理由は so-progress に出ている。
      if (!S.SEEDOPT_WORKER) settleSeedOptWaiter(false);
    }).catch((e) => {
      const progress = document.getElementById('so-progress');
      if (progress) progress.textContent = '⚠ ' + e.message;
      cleanupSeedOptWorker();
    });
  });
}

export async function uploadToStartgg() {
  if (!DATA.length) return;
  // csv モード: start.gg 未接続なら大会 URL から自動で phase/seeds を取得する
  // (updatePhaseSeeding は phase の seedId が必須なため。表示用ではなく適用用)。
  if (!S.EVENT_CONTEXT && SEED_APP_CONFIG.mode === 'csv' && S.CSV_SOURCE) {
    const st = document.getElementById('status');
    if (st) st.textContent = i18n('seed.startgg.s15');
    await handleFetch();
    if (!S.EVENT_CONTEXT) return;   // 取得失敗 (エラーは handleFetch 側で表示済み)
  }
  if (!S.EVENT_CONTEXT) return;
  const token = getToken();
  if (!token) { alert(i18n('seed.startgg.s16')); return; }
  // 「適用時に被り回避を自動実行」(既定 ON): パネルの設定どおりに最適化を回し、完了した
  // 並びを適用する。反映済みの最適化があればそれを使う (押すたびに回し直さない)。
  // 最適化が完了しなかった (非対応形式・データ取得失敗・エラー) ときは適用しない。
  if (!(await ensureAutoOptimizeForUpload())) return;
  if (S.EVENT_CONTEXT.phaseId == null) {
    // entrants フォールバックで取得した event (= phase 未作成)。
    // phase を作成してからシード適用する.
    await createPhaseThenUpload(token);
    return;
  }
  const methodLabel = uploadOrderLabel();
  const recs = orderedRecs();
  const mapping = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.seedId == null) continue;
    mapping.push({ seedId: r.seedId, seedNum: i + 1 });
  }
  if (!mapping.length) { alert(i18n('seed.startgg.s17')); return; }
  const msg = `${S.EVENT_CONTEXT.eventName} (phase ${S.EVENT_CONTEXT.phaseId}\n\n${i18n('seed.startgg.t3')}${methodLabel} ${i18n('seed.startgg.t4')} ${mapping.length}\n\n\n\n ${i18n('seed.startgg.t5')}`;
  if (!confirm(msg)) return;
  const status = document.getElementById('status');
  clearError();
  if (status) status.textContent = `${i18n('seed.startgg.t6')} ${mapping.length} ${i18n('seed.startgg.t7')}`;
  const r = await SmashSeed.uploadSeeding(S.EVENT_CONTEXT.phaseId, token, mapping);
  if (r.ok) {
    if (status) status.textContent = `${i18n('seed.startgg.t8')}${r.count} ${i18n('seed.startgg.t9')}`;
  } else {
    showError(r.error || 'unknown error');
  }
}

const UPSERT_PHASE_MUTATION = `
  mutation CreatePhase($eventId: ID!, $payload: PhaseUpsertInput!) {
    upsertPhase(eventId: $eventId, payload: $payload) { id name }
  }
`;

// phase 作成直前の再確認用 (= event id で phase 有無だけ取る)
const PHASES_RECHECK_QUERY = `
  query PhasesRecheck($eventId: ID!) {
    event(id: $eventId) { phases { id } }
  }
`;

// phase 未作成 event へのシード適用: phase (Double Elimination) を作成 → seeds 生成を待って
// entrantId → seedId を対応付け → updatePhaseSeeding。admin 権限が必要 (= 通常の適用と同じ).
/** @param {string} token */
async function createPhaseThenUpload(token) {
  if (!S.EVENT_CONTEXT) return;   // uploadToStartgg が確認してから呼ぶ
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));   // 骨格 (10_skeleton.js) に必ずある
  const methodLabel = uploadOrderLabel();
  // UI からプール数 / phase 名を取得 (= phase-create-row)
  let groupCount = parseInt(/** @type {HTMLInputElement} */ (document.getElementById('pc-group-count')).value, 10);
  if (!Number.isFinite(groupCount) || groupCount < 1) groupCount = 1;
  if (groupCount > 128) groupCount = 128;
  const phaseName = (/** @type {HTMLInputElement} */ (document.getElementById('pc-phase-name')).value || '').trim() || 'Bracket';
  const msg = `${S.EVENT_CONTEXT.eventName}\n\n\n\n ${i18n('seed.startgg.t10')}` +
    `${i18n('seed.startgg.t11')}${phaseName}${i18n('seed.startgg.t12')} ${groupCount}${i18n('seed.startgg.t13')}` +
    `${i18n('seed.startgg.t14')} ${methodLabel} ${i18n('seed.startgg.t15')} ${DATA.length}\n\n ${i18n('seed.startgg.t16')}` +
    `\n\n\n\n${i18n('seed.startgg.t17')}`;
  if (!confirm(msg)) return;
  clearError();
  // 直前ガード: 取得後に start.gg 側で phase が作られていたら新規作成しない
  // (= 既存 phase に重複追加したり設定を上書きしたりしないため)。
  status.textContent = i18n('seed.startgg.s18');
  const recheck = await startggQuery(token, PHASES_RECHECK_QUERY, { eventId: String(S.EVENT_CONTEXT.eventId) });
  const existing = (recheck.event && recheck.event.phases) || [];
  if (existing.length) {
    showError(i18n('seed.startgg.s19'));
    return;
  }
  status.textContent = `phase「${phaseName}」(Double Elimination, ${groupCount} ${i18n('seed.startgg.t18')}`;
  const data = await startggQuery(token, UPSERT_PHASE_MUTATION, {
    eventId: String(S.EVENT_CONTEXT.eventId),
    payload: { name: phaseName, bracketType: 'DOUBLE_ELIMINATION', groupCount: groupCount },
  });
  const phase = data.upsertPhase;
  if (!phase || phase.id == null) throw new Error(i18n('seed.startgg.s20'));
  S.EVENT_CONTEXT.phaseId = phase.id;
  // seeds は phase 作成後に start.gg 側で生成される。生成完了まで少し待ちつつ polling.
  let seedNodes = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    status.textContent = `${i18n('seed.startgg.t19')}${attempt}/5) …`;
    await new Promise(r => setTimeout(r, attempt === 1 ? 1000 : 2000));
    seedNodes = await fetchAllSeeds(token, phase.id);
    if (seedNodes.length) break;
  }
  if (!seedNodes.length) {
    showError(i18n('seed.startgg.s21'));
    return;
  }
  // 作成された seeds を entrantId で参加者行に対応付け
  const seedByEntrant = new Map();
  for (const n of seedNodes) {
    if (n.entrant && n.entrant.id != null) seedByEntrant.set(Number(n.entrant.id), n.id);
  }
  let matched = 0;
  for (const r of DATA) {
    if (r.entrantId != null && seedByEntrant.has(Number(r.entrantId))) {
      r.seedId = seedByEntrant.get(Number(r.entrantId));
      matched += 1;
    }
  }
  if (!matched) {
    showError(i18n('seed.startgg.s22'));
    return;
  }
  // 通常 path と同じ並び (手動調整・被り回避の反映を含む) で mapping 構築 + 送信 (= confirm は冒頭で済んでいる)
  const recs = orderedRecs();
  const mapping = [];
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].seedId == null) continue;
    mapping.push({ seedId: recs[i].seedId, seedNum: i + 1 });
  }
  status.textContent = `${i18n('seed.startgg.t6')} ${mapping.length} ${i18n('seed.startgg.t7')}`;
  const r = await SmashSeed.uploadSeeding(phase.id, token, mapping);
  if (r.ok) {
    status.textContent = `${i18n('seed.startgg.t20')}${r.count} ${i18n('seed.startgg.t9')}`;
    const metaInfo = document.getElementById('meta-info');
    if (metaInfo) metaInfo.textContent = `${S.EVENT_CONTEXT.eventName} (phase ${phase.id})`;
    // phase はもう存在するので自動作成の設定 UI は閉じる
    const pcRow = document.getElementById('phase-create-row');
    if (pcRow) pcRow.style.display = 'none';
  } else {
    showError(r.error || 'unknown error');
  }
}

function getToken() {
  // 保存は 💾 ボタンを押したときだけ (以前は読むたび sessionStorage に書いていて、UI の「💾 を押した場合のみ保存」と矛盾していた)
  return /** @type {HTMLInputElement} */ (document.getElementById('token')).value.trim();   // 骨格 (10_skeleton.js) に必ずある
}

// method-tabs / 検索 / CSV / upload ボタンを参加者取得後だけ表示する.
/** @param {boolean} visible */
export function setParticipantsUiVisible(visible) {
  const disp = visible ? '' : 'none';
  const mt = document.getElementById('method-tabs');
  const sr = document.getElementById('search');
  const cb = document.getElementById('csv-btn');
  const ub = document.getElementById('upload-btn');
  // csv モードでは基準タブ (SPSP評価の切替) は出さない — 基準は読み込んだ CSV。
  if (mt) mt.style.display = (visible && SEED_APP_CONFIG.mode !== 'csv') ? 'flex' : 'none';
  if (sr) sr.style.display = disp;
  if (cb) cb.style.display = disp;
  if (ub) ub.style.display = disp;
  const al = document.getElementById('auto-opt-label');
  if (al) al.style.display = disp;
  const panel = document.getElementById('seedopt-panel');
  if (panel) panel.style.display = disp;
  const spec = document.getElementById('spec-panel');
  if (spec) spec.style.display = disp;
  if (visible) initSeedOptPanel();
}

export async function handleFetch() {
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));   // 骨格 (10_skeleton.js) に必ずある
  clearError();
  // Hide stale event-picker from previous failed run
  const epPrev = document.getElementById('event-picker');
  if (epPrev) epPrev.style.display = 'none';
  // Hide stale phase-select from previous multi-phase fetch
  // (= 別 event に切り替えたとき古い phase 一覧が残らないように)
  const prPrev = document.getElementById('phase-row');
  if (prPrev) prPrev.style.display = 'none';
  const pcPrev = document.getElementById('phase-create-row');
  if (pcPrev) pcPrev.style.display = 'none';
  const token = getToken();
  const urlVal = /** @type {HTMLInputElement} */ (document.getElementById('event-url')).value.trim();
  const parsed = parseEventUrl(urlVal);
  if (!token) { status.textContent = i18n('seed.startgg.s23'); return; }
  if (!parsed) { status.textContent = i18n('seed.startgg.s24'); return; }

  // 取得開始: ボタン無効 + 旧データクリア + 関連 UI 非表示
  // (= 新規 fetch がエラーで終わっても古い参加者ランキングや検索 UI が残らないように)
  const fetchBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('fetch-btn'));
  if (fetchBtn) fetchBtn.disabled = true;
  const csvBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('csv-btn'));
  if (csvBtn) csvBtn.disabled = true;
  const uploadBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('upload-btn'));
  if (uploadBtn) uploadBtn.disabled = true;
  setParticipantsUiVisible(false);
  DATA.length = 0;
  S.EVENT_CONTEXT = null;
  S.MANUAL = null;   // 新規取得中は手動調整をメモリから外す (保存は restoreManualForEvent が判定)
  S.SEED_SPEC = null;   // 指定・固定も同様 (restoreManualForEvent で復元)
  if (S.TABLE) render();
  try {
    await loadMasterData();
    // event 取得を試行. tournament-only URL or event slug が不正で見つからない場合は
    // tournament の events 一覧から SSBU 1on1 単独 event を自動選択する.
    /** @type {StartggEvent | null} */
    let ev = null;
    if (parsed.eventSlug != null) {
      status.textContent = i18n('seed.startgg.s25');
      try {
        ev = await fetchEvent(token, /** @type {string} */ (parsed.slug));   // eventSlug があれば slug もある (parseEventUrl)
      } catch (e) {
        // event slug 不正 → tournament-only fallback に切替
        console.warn('event 取得失敗、tournament events から自動選択にフォールバック:', /** @type {any} */ (e).message);
        parsed.eventSlug = null;
        parsed.slug = null;
      }
    }
    if (ev == null) {
      status.textContent = i18n('seed.startgg.s26');
      const tour = await fetchTournament(token, parsed.tournamentSlug);
      const ssbuEvents = (tour.events || []).filter(e =>
        e.videogame && Number(e.videogame.id) === SSBU_VIDEOGAME_ID && Number(e.type) === SINGLES_EVENT_TYPE
      );
      if (ssbuEvents.length === 0) {
        throw new Error(i18n('seed.startgg.s27'));
      }
      if (ssbuEvents.length > 1) {
        // 複数 SSBU 1on1 → inline picker で選択させて再 dispatch.
        // (error 文字列ではなく UI を出す)
        showEventPickerInline(parsed.tournamentSlug, ssbuEvents);
        status.textContent = i18n('seed.startgg.s28');
        return;
      }
      // 単独イベント自動選択
      const tail = /** @type {string} */ (String(ssbuEvents[0].slug || '').split('/').pop());
      parsed.eventSlug = tail;
      parsed.slug = 'tournament/' + parsed.tournamentSlug + '/event/' + tail;
      status.textContent = `${i18n('seed.startgg.t21')} ${ssbuEvents[0].name} ${i18n('seed.startgg.t22')}`;
      ev = await fetchEvent(token, parsed.slug);
    }
    const phases = (ev.phases || []).slice().sort((a, b) => (a.phaseOrder || 0) - (b.phaseOrder || 0));
    if (!phases.length) {
      // phase (ブラケット) 未作成 → entrants フォールバック (= 閲覧 / CSV のみ可、シード適用は不可).
      // 日本のウィークリーは当日までブラケットを組まない運用が多く、phase 無しは普通に起きる.
      await performEntrantsFetch(token, ev);
      return;
    }
    let phaseId;
    if (phases.length > 1) {
      const sel = /** @type {HTMLSelectElement} */ (document.getElementById('phase-select'));   // 骨格 (10_skeleton.js) に必ずある
      sel.innerHTML = '';
      for (const p of phases) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} (phase ${p.id})`;
        sel.appendChild(opt);
      }
      const phaseRow = document.getElementById('phase-row');
      if (phaseRow) phaseRow.style.display = '';
      phaseId = phases[0].id;
      sel.value = phaseId;
      // re-fetch on phase change（連打の並行実行と unhandled rejection を防ぐ:
      // fetch-btn と同様にボタン相当をロックし、失敗は showError に流す）。
      sel.onchange = async () => {
        phaseId = sel.value;
        sel.disabled = true;
        if (fetchBtn) fetchBtn.disabled = true;
        try {
          await performSeedFetch(token, /** @type {StartggEvent} */ (ev), phaseId);
        } catch (err0) {
          const err = /** @type {StartggError} */ (err0);
          showError(err.message, err.rawError);
        } finally {
          sel.disabled = false;
          if (fetchBtn) fetchBtn.disabled = false;
        }
      };
    } else {
      phaseId = phases[0].id;
    }
    await performSeedFetch(token, ev, phaseId);
  } catch (e0) {
    const e = /** @type {StartggError} */ (e0);
    showError(e.message, e.rawError);
  } finally {
    if (fetchBtn) fetchBtn.disabled = false;
  }
}

// start.gg の phase 連鎖 (progressingInData) から、選択 phase を起点とした
// トーナメントプレビュー用のフェーズ構成 [{name, pools, adv}] を作る。
// adv = 次フェーズへの通過人数 ÷ このフェーズのプール数 (割り切れない場合はそこで打ち切り)。
// 進出設定が無い (単一フェーズ / 未設定) 場合は null を返し、発行側が既定にフォールバックする。
/** @param {StartggEvent} ev @param {number | string} phaseId @returns {SpspSeedPhaseConfig[] | null} */
function buildPhasesConfig(ev, phaseId) {
  const all = (ev && ev.phases) || [];
  const byId = new Map(all.map((p) => [String(p.id), p]));
  if (!byId.has(String(phaseId))) return null;
  // next(p) = progressingInData に p.id を origin として持つ phase
  const nextOf = (p) => all.find((q) =>
    (q.progressingInData || []).some((d) => String(d.origin) === String(p.id))) || null;
  const chain = [byId.get(String(phaseId))];
  while (true) {
    const next = nextOf(chain[chain.length - 1]);
    if (!next || chain.includes(next)) break;
    chain.push(next);
  }
  if (chain.length < 2) return null;
  const out = [];
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    const pools = Math.max(1, p.groupCount | 0);
    const entry = { name: p.name || `${i18n('seed.startgg.t23')}${i + 1}`, pools };
    if (i < chain.length - 1) {
      const numProg = (chain[i + 1].progressingInData || [])
        .filter((d) => String(d.origin) === String(p.id))
        .reduce((a, d) => a + (d.numProgressing || 0), 0);
      if (!numProg || numProg % pools !== 0) {
        // 通過人数が取れない / プール数で割り切れない → ここまでで打ち切り
        // (以降はプレビュー側のフェーズ構成エディタで編集してもらう)
        out.push(entry);
        break;
      }
      entry.adv = numProg / pools;
    }
    out.push(entry);
  }
  return out.length >= 2 ? out : null;
}

/** @param {string} token @param {StartggEvent} ev @param {number | string} phaseId */
async function performSeedFetch(token, ev, phaseId) {
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));   // 骨格 (10_skeleton.js) に必ずある
  status.textContent = `${i18n('seed.startgg.t24')} ${phaseId}) …`;
  const seedNodes = await fetchAllSeeds(token, phaseId, (got, tot) => {
    status.textContent = `${i18n('seed.startgg.t25')} ${got}/${tot} …`;
  });
  const seedInfos = seedNodes.map(seedNodeToInfo);
  status.textContent = `${seedInfos.length} ${i18n('seed.startgg.t26')}`;
  const { records, rankedCount, missingCount } = filterAndRerank(seedInfos);
  const _phase = (ev.phases || []).find(p => String(p.id) === String(phaseId));
  // ウェーブ (プール名 A1,B2,… の先頭文字) の自動取得。失敗は黙殺せず error として保持し
  // パネルのラベルで明示する (手動設定は常に可能)。
  /** @type {SpspSeedWaves | null} */
  let waves = null;
  try {
    waves = await fetchPhaseWaves(token, phaseId);
  } catch (e0) {
    const e = /** @type {any} */ (e0);
    waves = { error: String((e && e.message) || e) };
  }
  S.EVENT_CONTEXT = {
    phaseId, eventName: ev.name,
    eventId: ev.id, tournamentName: ev.tournament ? ev.tournament.name : '',
    bracketType: _phase ? _phase.bracketType : null,
    poolCount: (_phase && _phase.groupCount) ? _phase.groupCount : null,  // 取得できたプール数
    waves,   // {poolCount, waveCount, poolToWave, letters, identifiers} | {error} | null
    // start.gg のフェーズ連鎖 (選択 phase 起点)。トーナメントプレビューの初期構成に使う。
    phasesConfig: buildPhasesConfig(ev, phaseId),   // [{name, pools, adv?}] | null
  };
  dropAppliedOrder({ render: false });   // 新規取得で被り回避の反映をリセット
  // Repopulate DATA in place (preserve reference)
  DATA.length = 0;
  for (const r of records) DATA.push(r);
  const metaInfo = document.getElementById('meta-info');
  if (metaInfo) metaInfo.textContent = `${ev.name} (phase ${phaseId})`;
  status.textContent = `${ev.name}: ${rankedCount} ${i18n('seed.startgg.t27')} ${missingCount} ${i18n('seed.startgg.t28')} ${records.length} ${i18n('seed.startgg.t29')}`;
  const csvBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('csv-btn'));
  if (csvBtn) csvBtn.disabled = false;
  const uploadBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('upload-btn'));
  if (uploadBtn) uploadBtn.disabled = false;
  setParticipantsUiVisible(true);
  const tbl = ensureTable();
  tbl.setSort('rank', 'asc');
  render();  restoreManualForEvent();
}

// phase 未作成 event 用: entrants から参加者一覧を表示する.
// シード適用 (= upload) は phase が無いと不可能なので disabled のまま、閲覧と CSV だけ有効化.
/** @param {string} token @param {StartggEvent} ev */
async function performEntrantsFetch(token, ev) {
  const status = /** @type {HTMLElement} */ (document.getElementById('status'));   // 骨格 (10_skeleton.js) に必ずある
  status.textContent = i18n('seed.startgg.s29');
  const slug = ev.slug || (/** @type {HTMLInputElement} */ (document.getElementById('event-url')).value.trim().match(/tournament\/[^\/\s?#]+\/event\/[^\/\s?#]+/) || [''])[0];
  const nodes = await fetchAllEntrants(token, slug, (got, tot) => {
    status.textContent = `${i18n('seed.startgg.t30')} ${got}/${tot} …`;
  });
  if (!nodes.length) {
    throw new Error(i18n('seed.startgg.s30'));
  }
  const seedInfos = nodes.map(entrantNodeToInfo);
  status.textContent = `${seedInfos.length} ${i18n('seed.startgg.t26')}`;
  const { records, rankedCount, missingCount } = filterAndRerank(seedInfos);
  S.EVENT_CONTEXT = {
    phaseId: null, eventName: ev.name,
    eventId: ev.id, tournamentName: ev.tournament ? ev.tournament.name : '',
    bracketType: null,   // phase 未作成 → 形式不明 → 既定 DE 想定
    poolCount: null,     // phase 未作成 → プール数不明
    waves: null,         // phase 未作成 → ウェーブ不明 (手動設定可)
  };
  dropAppliedOrder({ render: false });
  DATA.length = 0;
  for (const r of records) DATA.push(r);
  const metaInfo = document.getElementById('meta-info');
  if (metaInfo) metaInfo.textContent = `${ev.name} ${i18n('seed.startgg.t31')}`;
  status.textContent = `${ev.name}: ${rankedCount} ${i18n('seed.startgg.t27')} ${missingCount} ${i18n('seed.startgg.t28')} ${records.length} ${i18n('seed.startgg.t32')}`;
  const csvBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('csv-btn'));
  if (csvBtn) csvBtn.disabled = false;
  const uploadBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('upload-btn'));
  if (uploadBtn) uploadBtn.disabled = false;
  // phase 自動作成の設定 UI (プール数 / phase 名) を表示
  const pcRow = document.getElementById('phase-create-row');
  if (pcRow) pcRow.style.display = '';
  setParticipantsUiVisible(true);
  const tbl = ensureTable();
  tbl.setSort('rank', 'asc');
  render();  restoreManualForEvent();
}

// Backwards-compat aliases (= 内部の detail builder で使われている).
const getRank = SPSPRankingTable.getRank;
const getScore = SPSPRankingTable.getScore;
const formatScore = SPSPRankingTable.formatScore;
function formatAvgRank(rec, _method) {
  return SPSPRankingTable.formatAvgRank(rec);
}

export function render() {
  const tbl = ensureTable();
  tbl.setRows(DATA);
  tbl.setMethod(S.currentMethod);
  tbl.setFilterText(S.filterText);
  renderManualUI();
}
// 手動調整のクリック操作 (動的要素はデリゲーションで拾う)。
const manualBarEl = document.getElementById('manual-bar');
const ranktableEl = document.getElementById('ranktable');
if (manualBarEl) manualBarEl.addEventListener('click', manualClickHandler);
// 固定設定バーの種別セレクト変更 → 対象セレクト (プール一覧/ウェーブ一覧) を組み直す。
// バーは表 (行の直下) と manual-bar の両方に出し得るので両方で拾う。
function _lockKindChangeHandler(e) {
  const el = e.target.closest('[data-mn-lock-kind]');
  if (el && S.MANUAL && S.MANUAL.editing && S.MANUAL.lockSel != null) {
    S.MANUAL.lockKind = el.value;
    renderManualUI();
  }
}
if (manualBarEl) manualBarEl.addEventListener('change', _lockKindChangeHandler);
if (ranktableEl) ranktableEl.addEventListener('change', _lockKindChangeHandler);
// 手動調整バーのプール数 / ウェーブ数 → 被り回避パネルの入力 (so-pools/so-waves) に反映。
// 値は 1 箇所 (パネル) が正なので、こちらは同期して再描画するだけ。
if (manualBarEl) manualBarEl.addEventListener('input', (e) => {
  const target = /** @type {Element} */ (e.target);
  const p = target.closest('[data-mn-pools]'), w = target.closest('[data-mn-waves]');
  if (!p && !w) return;
  const src = /** @type {HTMLInputElement} */ (p || w);
  const dst = /** @type {HTMLInputElement | null} */ (document.getElementById(p ? 'so-pools' : 'so-waves'));
  const v = parseInt(src.value, 10);
  if (!dst || !Number.isFinite(v) || v < 1) return;
  dst.value = String(v);
  if (p) updateIntraToggleState();
  renderManualUI();
  // 再描画で input が作り直されるのでフォーカスとカーソルを戻す。
  const again = /** @type {HTMLInputElement | null} */ (manualBarEl
    .querySelector(p ? '[data-mn-pools]' : '[data-mn-waves]'));
  if (again) { again.focus(); again.select(); }
});
// プレイヤーページへのリンク (表・詳細展開内とも) は常に新しいタブで開く。
if (ranktableEl) ranktableEl.addEventListener('click', (e) => {
  const a = /** @type {Element} */ (e.target).closest('a');
  if (a && /p\/\?(uid|d)=/.test(a.getAttribute('href') || '')) { a.target = '_blank'; a.rel = 'noopener'; }   // 選手リンクは ?d=<discriminator> が既定 (2026-09-14〜)、?uid= も受ける
}, true);
// テーブル内の手動調整コントロール ([data-mn] = 選択ボタン/挿入スロット) は
// capture で先取りして、行クリック (詳細展開) やソートに食われないようにする。
if (ranktableEl) ranktableEl.addEventListener('click', (e) => {
  if (!S.MANUAL) return;
  const mn = /** @type {Element} */ (e.target).closest('[data-mn]');
  if (mn) {
    e.stopPropagation();
    e.preventDefault();
    manualClickHandler(e);
    return;
  }
  // 編集中はヘッダソートを無効化 (手動順の表示が崩れて挿入位置が分からなくなるため)。
  if (S.MANUAL.editing && /** @type {Element} */ (e.target).closest('th.sortable')) {
    e.stopPropagation();
  }
}, true);
