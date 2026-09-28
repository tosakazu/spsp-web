// @ts-check
// seeding/app/75_series_rematch.js — SPSP シードツール本体の一部: 同シリーズ再マッチ (対象シリーズの判定)、被り回避最適化の実行・反映・取り消し。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { i18n, regionGroupToggleId } from './10_skeleton.js';
import { DATA, _projectSeedLocks, manualOrder, manualParseUid, renderManualUI, saveManual } from './30_core.js';
import { render, settleSeedOptWaiter } from './40_startgg.js';
import { PLAYER_CACHE, cachedFetchers } from './70_players_cache.js';
import { currentWaveMap, poolLabel } from './85_waves.js';
import { applyModeDefaults, prefillShiftLimits, restoreSeedOptSettings, soFormat } from './99_bootstrap.js';
import { escapeHtml } from '../../js/html.js';
import SeedData from '../seed_data.js';
import SeedOptimizer from '../seed_optimizer.js';
import SPSPGeo from '../../js/geo.js';
'use strict';

// ── 同シリーズ再マッチ: 対象シリーズの判定 ────────────────────────────
// 大会一覧 (tournaments.json, 約3MB) は「同シリーズの再戦を強めに避ける」が ON のとき
// (2026-09-14 から既定 ON) に、大会の読み込み時と実行時に取りに行く。
// 判定結果は必ず画面に出し、選び直せるようにする — 黙って別シリーズの罰則を掛けない。
// 判定できなかった大会 (初開催など) はシリーズ罰則なしで実行し、その旨を進捗に出す
// (2026-09-14 ユーザー確認済み)。
/** @typedef {{ seriesOf: Record<string, string>, seriesNames: string[] }} SeriesIndex */
/** @type {SeriesIndex | null} */
let SERIES_INDEX = null;          // { seriesOf, seriesNames } | null
/** @type {Promise<SeriesIndex | null> | null} */
let SERIES_INDEX_LOADING = null;  // 多重ロード防止の Promise

async function ensureSeriesIndex() {
  if (SERIES_INDEX) return SERIES_INDEX;
  if (!SERIES_INDEX_LOADING) {
    SERIES_INDEX_LOADING = (async () => {
      const json = await SeedData.defaultFetchers(SPSP.data).fetchTournaments();
      SERIES_INDEX = SeedData.buildSeriesIndex(json);
      return SERIES_INDEX;
    })().catch((e) => { SERIES_INDEX_LOADING = null; throw e; });
  }
  return SERIES_INDEX_LOADING;
}

export function seriesNoteEl() { return document.getElementById('so-series-note'); }

// select を全シリーズ名で埋め、判定結果を選ぶ。
/** @param {{ series?: string | null, source?: string | null } | null | undefined} detected */
function populateSeriesSelect(detected) {
  const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('so-series-select'));
  if (!sel || !SERIES_INDEX) return;
  const keep = sel.value;
  const names = SERIES_INDEX.seriesNames.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  sel.innerHTML = `<option value="">${i18n('seed.rematch.series_placeholder')}</option>` +
    names.map((n) => `<option value="${escHtml(n)}">${escHtml(n)}</option>`).join('');
  const pick = (S.SERIES_USER_PICKED && keep) ? keep : (detected && detected.series) || '';
  sel.value = pick;
  const note = seriesNoteEl();
  if (!note) return;
  if (!sel.value) {
    note.innerHTML = `<span style="color:#b91c1c">${i18n('seed.rematch.series_undetected')}</span>`;
  } else if (S.SERIES_USER_PICKED && keep) {
    note.textContent = '';
  } else if (detected && detected.source === 'event_id') {
    note.textContent = i18n('seed.rematch.s1');
  } else {
    note.innerHTML = `<span style="color:#92400e">${i18n('seed.rematch.series_guessed')}</span>`;
  }
}

// チェックボックスの状態に応じて選択欄を出し入れし、必要なら大会一覧をロードする。
export async function updateSeriesToggleState() {
  const cb = /** @type {HTMLInputElement | null} */ (document.getElementById('so-avoid-series'));
  const box = document.getElementById('so-series-box');
  if (!cb || !box) return;
  box.style.display = cb.checked ? '' : 'none';
  if (!cb.checked) return;
  const note = seriesNoteEl();
  if (!SERIES_INDEX) {
    if (note) note.textContent = i18n('seed.rematch.s2');
    try {
      await ensureSeriesIndex();
    } catch (e0) {
      const e = /** @type {any} */ (e0);
      if (note) note.innerHTML = `<span style="color:#b91c1c">${i18n('seed.rematch.t1')} ${escHtml(String((e && e.message) || e))}</span>`;
      return;
    }
  }
  /** @type {Partial<SpspSeedEventContext>} */
  const ctx = S.EVENT_CONTEXT || {};
  populateSeriesSelect(SeedData.detectSeries(SERIES_INDEX, ctx.eventId, ctx.tournamentName || ''));
}

// 「プール内変動」トグルは 2プール以上のときだけ指定可能。
// 1プール×DE では intra が唯一の被り回避なので常に実行＝チェックは固定・無効表示。
export function updateIntraToggleState() {
  const cb = /** @type {HTMLInputElement | null} */ (document.getElementById('so-enable-intra'));
  if (!cb) return;
  const pools = Math.max(1, parseInt(/** @type {{ value?: any }} */ (document.getElementById('so-pools') || {}).value, 10) || 1);
  const lbl = cb.closest('label');
  cb.disabled = pools < 2;
  if (lbl) lbl.style.opacity = pools < 2 ? '0.4' : '';
}
export function initSeedOptPanel() {
  const poolsEl = /** @type {HTMLInputElement | null} */ (document.getElementById('so-pools'));
  if (!poolsEl) return;
  // 別イベント/フェーズの取得で呼ばれる。走行中の worker が残っていると
  // 古い結果が新しいデータの上に done で届いて適用できてしまうため、必ず止める。
  cleanupSeedOptWorker();
  applyModeDefaults();
  restoreSeedOptSettings();   // 保存済みの設定 (多点数・冷却・反復は applyModeDefaults が上書きするので、その後に戻す)
  // プール数の既定: start.gg から取得できたプール数 → なければ phase 作成 UI のプール数 → 1。
  const fetched = S.EVENT_CONTEXT && S.EVENT_CONTEXT.poolCount;
  if (Number.isFinite(fetched) && /** @type {number} */ (fetched) >= 1) {
    poolsEl.value = String(fetched);
  } else {
    const pc = parseInt(/** @type {{ value?: any }} */ (document.getElementById('pc-group-count') || {}).value, 10);
    if (Number.isFinite(pc) && pc >= 1) poolsEl.value = String(pc);
  }
  // 形式は自動取得 → ラベル表示のみ。
  const fmtJa = { DOUBLE_ELIMINATION: i18n('seed.rematch.s3'), SINGLE_ELIMINATION: i18n('seed.rematch.s4'), ROUND_ROBIN: i18n('seed.rematch.s5') }[soFormat()];
  const bt = S.EVENT_CONTEXT && S.EVENT_CONTEXT.bracketType;
  const formatLabel = document.getElementById('so-format-label');
  if (formatLabel) formatLabel.textContent = `${i18n('seed.rematch.t2')} ${fmtJa}${bt ? i18n('seed.rematch.s28') : i18n('seed.rematch.s29')}`;
  // ウェーブ数: start.gg のプール名 (A1,B2,…) から自動取得できたらそれを既定に。
  // 取得できない/失敗はラベルで明示し、手動設定に任せる (黙ってウェーブなし扱いにしない)。
  const wavesEl = /** @type {HTMLInputElement | null} */ (document.getElementById('so-waves'));
  const wavesLbl = document.getElementById('so-waves-label');
  const wv = S.EVENT_CONTEXT && S.EVENT_CONTEXT.waves;
  if (wavesEl && wavesLbl) {
    if (wv && Array.isArray(wv.poolToWave)) {
      const got = /** @type {Required<SpspSeedWaves>} */ (wv);   // poolToWave があれば他の項目も揃っている (85_waves.js wavesFromGroupNodes)
      wavesEl.value = String(got.waveCount);
      wavesLbl.textContent = got.waveCount >= 2
        ? `${i18n('seed.rematch.t3')} ${got.identifiers[0]}〜${got.identifiers[got.identifiers.length - 1]} / ${got.poolCount}${i18n('seed.rematch.t4')}`
        : i18n('seed.rematch.s6');
    } else {
      wavesEl.value = '1';
      wavesLbl.textContent = (wv && wv.error)
        ? i18n('seed.rematch.s7')
        : i18n('seed.rematch.s8');
    }
  }
  // シードズレ上限の規模別既定 (全欄が空のときだけ)。
  prefillShiftLimits(DATA.length);
  const reportEl = document.getElementById('so-report');
  if (reportEl) reportEl.innerHTML = '';
  const progress = document.getElementById('so-progress');
  if (progress) progress.textContent = '';
  showOptCancelBtn(false);
  S.SEEDOPT_ROUND_STATS = [];
  updateIntraToggleState();
  S.SERIES_USER_PICKED = false;   // 別大会を読み込んだら自動判定をやり直す
  // 非同期 (大会一覧のロードを伴うことがある)。失敗は欄の注記に出るので、
  // ここでは unhandled rejection にしないためだけに握る。
  Promise.resolve(updateSeriesToggleState()).catch(() => {});
  S.SEEDOPT_RESULT = null;
}

function clearSeedOptApplied() {
  const r = document.getElementById('so-report');
  if (r) {
    const banner = r.querySelector('.seedopt-applied-banner');
    if (banner) banner.remove();
  }
  render();
}

/** 「最適化を取り消す」ボタンの表示。 */
/** @param {boolean} on */
function showOptCancelBtn(on) {
  const b = /** @type {HTMLButtonElement | null} */ (document.getElementById('so-cancel'));
  if (!b) return;
  b.style.display = on ? '' : 'none';
  b.disabled = !on;
}

/**
 * 反映中の最適化順を解除する (= 基準ランキングが変わったとき)。
 * 取り消しボタンで戻る先も一緒に捨てる (基準が変わっているので戻せない)。
 * opts.render === false なら描画しない (DATA 入れ替え中など)。
 */
/** @param {{ render?: boolean }} [opts] */
export function dropAppliedOrder(opts) {
  const had = !!S.APPLIED_ORDER;
  S.APPLIED_ORDER = null;
  S.PRE_OPT = null;
  showOptCancelBtn(false);
  if (had && (!opts || opts.render !== false)) clearSeedOptApplied();
}

/** @param {unknown} s @returns {string} */
export function escHtml(s) { return escapeHtml(s); }   // ../js/html.js

export async function runSeedOptimize() {
  if (!DATA.length || !S.EVENT_CONTEXT) { return; }
  // 被り回避パネルの要素は骨格 (10_skeleton.js) に必ずある
  const progress = /** @type {HTMLElement} */ (document.getElementById('so-progress'));
  const reportEl = /** @type {HTMLElement} */ (document.getElementById('so-report'));
  reportEl.innerHTML = '';
  showOptCancelBtn(false);

  /** @param {string} id */
  const inputEl = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));   // 型だけ (input / select / checkbox の value / checked を読む)
  const poolCount = Math.max(1, parseInt(inputEl('so-pools').value, 10) || 1);
  const format = soFormat();   // start.gg bracketType から自動

  // 入力ランキング = 現在の基準順。手動調整があればそれを基準にする
  // (「手動調整 → 被り回避」の流れ)。無ければ currentMethod 順 (適用済み最適化は解除して基準に戻す)。
  const baseRecs = S.MANUAL
    ? (() => {
        const pos = new Map(manualOrder().map((u, i) => [u, i]));
        return DATA.slice().sort((a, b) =>
          (pos.has(a.user_id) ? /** @type {number} */ (pos.get(a.user_id)) : 1e9) - (pos.has(b.user_id) ? /** @type {number} */ (pos.get(b.user_id)) : 1e9));
      })()
    : DATA.slice().sort((a, b) => (a.ranks[S.currentMethod] || 1e9) - (b.ranks[S.currentMethod] || 1e9));
  // 固定射影を基準にも適用 (manualOrder 経由は適用済みだが冪等なので常にかける)。
  // これで optimizer の origRank プール == 固定対象プールになり、ハード制約と整合する。
  const ranking = _projectSeedLocks(baseRecs.map(r => r.user_id).filter(u => u != null));
  /** @type {Record<string, string>} */
  const displayOf = {};
  for (const r of DATA) displayOf[r.user_id] = r.display;

  // 非対応形式を事前判定（worker でも返るが、取得前に弾く）。
  const scopeWinners = inputEl('so-scope-winners').checked;
  if (scopeWinners && format !== 'DOUBLE_ELIMINATION') {
    progress.textContent = i18n('seed.rematch.s9');
    return;
  }
  if (poolCount === 1 && format !== 'DOUBLE_ELIMINATION') {
    progress.textContent = i18n('seed.rematch.s10');
    return;
  }

  // CSV → 数値配列（空欄なら undefined＝既定を使う）。
  /** @param {string} id @returns {number[] | undefined} */
  const csvNums = (id) => {
    const v = (inputEl(id).value || '').trim();
    if (!v) return undefined;
    const arr = v.split(',').map(s => parseFloat(s.trim())).filter(x => Number.isFinite(x));
    return arr.length ? arr : undefined;
  };
  // 主要トグル（地域被り/直近対戦を避けるか・プール内変動するか）。
  const avoidRegion = inputEl('so-avoid-region').checked;
  const avoidRecent = inputEl('so-avoid-recent').checked;
  const enableIntra = inputEl('so-enable-intra').checked;
  // 追加制約トグル: DE 想定順位不変 / 平日大会（実質平日・プレ含む）の対戦を考慮しない。
  const keepDePlace = inputEl('so-keep-deplace').checked;
  // 「平日大会を含む」(既定OFF) の反転が excludeWeekday (= 既定で平日を除外)。
  // @ts-expect-error -- 骨格に必ずある checkbox。tests/seeding/page.test.cjs がこの行の字面を検査するので形を変えない
  const excludeWeekday = !document.getElementById('so-include-weekday').checked;
  // 同シリーズ再マッチ (既定ON)。対象シリーズは大会名から自動判定した選択欄の値。
  // 大会一覧がまだ無ければここで読み込んで判定を待つ (読み込み中に実行されても止めない)。
  // 判定できなかった (初開催など・ユーザーが「選択なし」にした・一覧の取得失敗) ときは
  // シリーズ罰則なしで実行し、進捗の注記に明示する (2026-09-14 ユーザー確認済み)。
  const avoidSeriesCb = inputEl('so-avoid-series').checked;
  const seriesSelValue = () => (/** @type {{ value?: any }} */ (document.getElementById('so-series-select') || {}).value || '');
  let targetSeries = avoidSeriesCb ? seriesSelValue() : '';
  if (avoidSeriesCb && !targetSeries && !SERIES_INDEX) {
    progress.textContent = i18n('seed.rematch.s25');
    try { await updateSeriesToggleState(); } catch (e) { /* 失敗は note に出ている */ }
    targetSeries = seriesSelValue();
  }
  const seriesUndetected = avoidSeriesCb && !targetSeries;
  const avoidSeriesRematch = avoidSeriesCb && !!targetSeries;
  // 地域グルーピングのトグル (geo.json の seed_groups ごと。無い id は geo.json の default)。
  /** @type {Record<string, boolean>} */
  const regionGroupOpts = {};
  for (const g of SeedData.regionGroupDefs()) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(regionGroupToggleId(g)));
    if (el) regionGroupOpts[g.id] = el.checked;
  }
  // 数値入力: 「0」を有効値として受ける（`|| 既定` だと 0 が黙って既定に化ける）。
  // 空欄/非数のときだけ既定へ。
  /** @param {string} id @param {number} def */
  const numDef = (id, def) => { const v = parseFloat(inputEl(id).value); return Number.isFinite(v) ? v : def; };
  /** @template {number | null} T @param {string} id @param {T} def @returns {number | T} */
  const intDef = (id, def) => { const v = parseInt(inputEl(id).value, 10); return Number.isFinite(v) ? v : def; };
  const params = {
    mode: inputEl('so-mode').value,
    restarts: Math.max(1, intDef('so-restarts', 15)),
    saCooling: Math.min(0.9999, Math.max(0.5, numDef('so-cooling', 0.999))),
    maxItersScale: Math.max(10, intDef('so-itersscale', 1000)),
    rngSeed: intDef('so-rngseed', 12345),
    avoidRegion, avoidRecent, enableIntra, keepDePlace, avoidSeriesRematch,
    seriesMode: inputEl('so-seriesmode').value,
    seriesMult: Math.max(1, numDef('so-seriesmult', 3)),
    W_series: Math.max(0, numDef('so-wseries', 0.3)),
    bracketScope: scopeWinners ? 'winners' : undefined,   // undefined→既定 'pools'
    // シードズレ上限の段階指定 ([±0,±1,±2,±3,±4,±5] それぞれ「何位まで」)。全空欄なら未指定。
    shiftLimitRanks: (() => {
      const arr = ['so-shift0', 'so-shift1', 'so-shift2', 'so-shift3', 'so-shift4', 'so-shift5']
        .map(id => { const v = parseInt(inputEl(id).value, 10); return Number.isFinite(v) ? Math.max(1, v) : null; });
      return arr.some(v => v != null) ? arr : undefined;
    })(),
    W_region: numDef('so-wregion', 1.0),
    W_recent: numDef('so-wrecent', 0.3),
    W_order: Math.max(0, numDef('so-worder', 0)),
    orderPow: Math.max(0, numDef('so-orderpow', 2.5)),   // ズレ数調整スライダー (0〜5, 0.5刻み。0=ズレを罰しない。既定 2.5)
    prefWeight: inputEl('so-prefweight').value,
    roundWeights: csvNums('so-roundweights'),   // undefined→既定
    kInter: csvNums('so-kinter'),
    kIntra: csvNums('so-kintra'),
    // 空欄＝制限なし(null)。0 は「一切動かさない」として有効。
    maxSeedShift: (() => { const v = intDef('so-maxshift', null); return v != null ? Math.max(0, v) : undefined; })(),
  };
  // プール/ウェーブ固定 (シード指定・固定パネル / 手動調整の📌)。ranking に居る uid のみ渡す。
  const waveMap = currentWaveMap(poolCount);
  const rankingSet = new Set(ranking);
  /** @type {Record<string, string>} */
  const seedLocks = {};
  if (S.SEED_SPEC && S.SEED_SPEC.locks) {
    for (const k in S.SEED_SPEC.locks) {
      const u = manualParseUid(k);
      if (!rankingSet.has(u)) continue;
      const v = S.SEED_SPEC.locks[k];
      // optimizer へは種別のみ渡す ('pool'|'wave')。対象は射影済みの基準位置に反映済み。
      seedLocks[u] = (v && v.kind) || v;
    }
  }
  const lockUids = Object.keys(seedLocks);
  if (lockUids.length) {
    params.seedLocks = seedLocks;
    params.poolWaves = waveMap;
  }
  // undefined のキーは optimizer 既定に任せる（明示的に消す）。
  Object.keys(params).forEach(k => { if (params[k] === undefined) delete params[k]; });
  // シードズレ上限の昇順チェック (optimizer でも throw するが、取得前にわかりやすく弾く)。
  if (params.shiftLimitRanks) {
    let prev = 0;
    for (const v of params.shiftLimitRanks) {
      if (v == null) continue;
      if (v <= prev) { progress.textContent = i18n('seed.rematch.s13'); return; }
      prev = v;
    }
  }
  // 減衰の制御点 "日:重み,..." をパース（空欄なら既定）。
  const dpRaw = (inputEl('so-decaypoints').value || '').trim();
  let recentDecayPoints;
  if (dpRaw) {
    const pts = dpRaw.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [d, w] = s.split(':').map(x => parseFloat(x));
      return [d, w];
    }).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length >= 2) recentDecayPoints = pts;
  }
  const sizeWeight = inputEl('so-sizeweight').value;
  const recentAgg = inputEl('so-recentagg').value;

  inputEl('so-run').disabled = true;
  // 取得済みの分はキャッシュから返るので、実際に取りに行く人数だけ出す。
  const toFetch = ranking.filter((u) => !PLAYER_CACHE.has(u)).length;
  progress.textContent = toFetch
    ? `${i18n('seed.rematch.t5')}${toFetch} ${i18n('seed.rematch.t6')}`
    : `${i18n('seed.rematch.t7')}${ranking.length} ${i18n('seed.rematch.t8')}`;

  // 1) 取得・集計（メインスレッド。fetch はここだけ）。
  let bundle;
  try {
    const dataParams = { sizeWeight, recentAgg, excludeWeekday };
    if (targetSeries) dataParams.targetSeries = targetSeries;   // 同シリーズ分の集計対象
    if (recentDecayPoints) dataParams.recentDecayPoints = recentDecayPoints;  // 空欄なら既定を使う
    // 地域グルーピング表をトグルから構築（避けない地域があっても prefByUid 計算は行い、罰則側で無効化）。
    // まとめの定義 (どの県か) は geo.json。未読込ならここで読む (失敗は下の catch でデータ取得失敗として表示)。
    await SeedData.ensureGeoCatalog(cachedFetchers(SPSP.data));
    const regionGroups = SeedData.buildRegionGroups(regionGroupOpts);
    bundle = await SeedData.buildSeedData(ranking, Object.assign({
      prefix: SPSP.data,   // JSON の置き場 (config.dataRoot があれば別ホスト)
      regionGroups,
      // 地域被り回避 OFF のときは居住地データはレポート表示にしか使わないので、
      // 取得失敗で全体を止めない（meta.prefsError で明示される）。
      prefsOptional: !avoidRegion,
      seriesIndex: SERIES_INDEX,   // ロード済みなら再取得しない
      params: dataParams,
      onProgress: (p) => {
        if (p.phase === 'fetch' && toFetch) progress.textContent = `${i18n('seed.rematch.t9')} ${p.done}/${p.total}…`;
      },
    }, cachedFetchers(SPSP.data)));   // 2回目以降は取得済みの選手データを使い回す
  } catch (e) {
    progress.textContent = i18n('seed.rematch.s14') + /** @type {any} */ (e).message;
    inputEl('so-run').disabled = false;
    return;
  }
  // 取得状況（同意なきフォールバック禁止 → missing/errors を明示）。
  const m = bundle.meta;
  let note = `${i18n('seed.rematch.t10')} ${m.prefIdentified}/${m.attendees} ${i18n('seed.rematch.t11')}`;
  if (excludeWeekday) note += ` ${i18n('seed.rematch.t12')} ${m.weekdayExcludedMatches || 0} ${i18n('seed.rematch.t13')}`;
  if (m.missing.length) note += ` ${i18n('seed.rematch.t14')} ${m.missing.length} ${i18n('seed.rematch.t15')}`;
  if (m.errors.length) note += ` ${i18n('seed.rematch.t16')} ${m.errors.length} ${i18n('seed.rematch.t11')}`;
  if (m.prefsError) note += ` ${i18n('seed.rematch.t17')}`;
  if (m.targetSeries) {
    note += ` ${i18n('seed.rematch.t18')}${m.targetSeries}${i18n('seed.rematch.t19')} ${m.seriesPairs} ${i18n('seed.rematch.t20')}`;
    if (m.seriesIndexError) note += ` ${i18n('seed.rematch.t21')}`;
  } else if (seriesUndetected) {
    note += SERIES_INDEX
      ? i18n('seed.rematch.s26')
      : i18n('seed.rematch.s27');
  }
  if (lockUids.length) {
    const nPool = lockUids.filter(u => seedLocks[u] === 'pool').length;
    const nWave = lockUids.length - nPool;
    note += ` ${i18n('seed.rematch.t22')} ${[nPool ? `${i18n('seed.rematch.t23')}${nPool}${i18n('seed.rematch.t11')}` : '', nWave ? `${i18n('seed.rematch.t24')}${nWave}${i18n('seed.rematch.t11')}` : ''].filter(Boolean).join('/')}`;
    if (nWave && waveMap.every(w => w === 0)) note += `${i18n('seed.rematch.t25')}`;
  }

  // 2) Worker で最適化。生成/起動の失敗（404, CSP, clone不能など）は onmessage に
  //    乗らないため、onerror と try/catch の両方で必ず cleanup してボタンを戻す。
  try {
    if (S.SEEDOPT_WORKER) { S.SEEDOPT_WORKER.terminate(); S.SEEDOPT_WORKER = null; }
    S.SEEDOPT_WORKER = new Worker(SPSP.root + 'assets/seed_worker.js');
    inputEl('so-stop').style.display = '';
    inputEl('so-stop').disabled = false;

    S.SEEDOPT_WORKER.onerror = (err) => {
      progress.textContent = i18n('seed.rematch.s15') + (err && err.message ? err.message : i18n('seed.rematch.s16'));
      cleanupSeedOptWorker();
    };
    S.SEEDOPT_WORKER.onmessage = (ev) => {
      const msg = ev.data || {};
      if (msg.type === 'progress') {
        // このラウンドの何%処理中か (iter/maxIters)。phase 単位で 0→100% が進む。
        const pct = (msg.iter != null && msg.maxIters > 0)
          ? ` ${Math.min(100, msg.iter / msg.maxIters * 100).toFixed(0)}%` : '';
        progress.textContent = msg.stage === 'stop-requested'
          ? `${note} ${i18n('seed.rematch.t26')}`
          : `${note} ${i18n('seed.rematch.t27')} ${msg.round + 1}/${msg.restarts} (${msg.phase || ''}${pct})`;
      } else if (msg.type === 'checkpoint') {
        const imp = msg.beforeScore > 0 ? ((1 - msg.bestScore / msg.beforeScore) * 100).toFixed(1) : '0.0';
        // このラウンドのステップ数% を蓄積 (phase 合算)。
        let stepTxt = '';
        if (Array.isArray(msg.roundStats)) {
          const it = msg.roundStats.reduce((s, x) => s + (x.iters || 0), 0);
          const mx = msg.roundStats.reduce((s, x) => s + (x.maxIters || 0), 0);
          S.SEEDOPT_ROUND_STATS.push({ round: msg.round + 1, iters: it, maxIters: mx });
          if (mx > 0) stepTxt = ` ${i18n('seed.rematch.t28')} ${(it / mx * 100).toFixed(0)}%`;
        }
        progress.textContent = `${note} ${i18n('seed.rematch.t29')}${msg.round + 1}/${msg.restarts}${i18n('seed.rematch.t30')} ${imp}%${stepTxt}`;
        // 各ラウンド終了時の中間レポート (ここまでのベスト解)。
        if (msg.intermediate) {
          finishSeedOptimize(msg.intermediate, displayOf, note, ranking,
            { round: msg.round + 1, restarts: msg.restarts });
        }
      } else if (msg.type === 'done') {
        finishSeedOptimize(msg.result, displayOf, note, ranking);
      } else if (msg.type === 'error') {
        progress.textContent = i18n('seed.rematch.s17') + msg.message;
        cleanupSeedOptWorker();
      }
    };
    S.SEEDOPT_WORKER.postMessage({ type: 'start', input: {
      poolCount, format, ranking,
      prefByUid: bundle.prefByUid, prefCounts: bundle.prefCounts,
      recentPair: bundle.recentPair, recentMeta: bundle.recentMeta,
      seriesPair: bundle.seriesPair, targetSeries: targetSeries || null,
      params,
    } });
  } catch (e) {
    progress.textContent = i18n('seed.rematch.s18') + /** @type {any} */ (e).message;
    cleanupSeedOptWorker();
  }
}

export function stopSeedOptimize() {
  if (!S.SEEDOPT_WORKER) return;
  S.SEEDOPT_WORKER.postMessage({ type: 'stop' });
  // 停止はリスタート境界でしか効かない（worker 内の optimize は同期実行）。
  // 二重押し防止とフィードバックのためボタンを無効化して状況を表示する。
  const stopBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('so-stop'));
  if (stopBtn) stopBtn.disabled = true;
  const progress = document.getElementById('so-progress');
  if (progress) progress.textContent = i18n('seed.rematch.s19');
}

// 結果パネルを破棄して初期状態へ（基準ランキング変更時など）。
/** @param {string} [msg] */
export function resetSeedOptResultPanel(msg) {
  S.SEEDOPT_RESULT = null;
  const r = document.getElementById('so-report'); if (r) r.innerHTML = '';
  showOptCancelBtn(false);
  const p = document.getElementById('so-progress'); if (p) p.textContent = msg || '';
}
/** @param {{ keepWaiter?: boolean }} [opts] */
export function cleanupSeedOptWorker(opts) {
  // 完了以外の終了 (エラー・非対応・別の取得・途中 throw) は、適用前の自動実行を失敗で決着させる。
  if (!(opts && opts.keepWaiter)) settleSeedOptWaiter(false);
  const runBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('so-run'));
  if (runBtn) runBtn.disabled = false;
  const stopBtn = document.getElementById('so-stop');
  if (stopBtn) stopBtn.style.display = 'none';
  // 実行開始時に隠した取り消しボタンを戻す。前回の反映が残ったまま失敗・中断した
  // ときに「反映中なのに取り消せない」状態にしないため。
  showOptCancelBtn(!!S.APPLIED_ORDER);
  if (S.SEEDOPT_WORKER) {
    // terminate 前にハンドラを外す: キュー済みの done/error が terminate 後に
    // 届いて古い結果を描画するのを防ぐ。
    S.SEEDOPT_WORKER.onmessage = null;
    S.SEEDOPT_WORKER.onerror = null;
    S.SEEDOPT_WORKER.terminate();
    S.SEEDOPT_WORKER = null;
  }
}

/** @param {SpspSeedOptResult} result @param {Record<string, string>} displayOf @param {string} note @param {number[]} ranking
 *  @param {{ round: number, restarts: number }} [interInfo] */
function finishSeedOptimize(result, displayOf, note, ranking, interInfo) {
  // interInfo = {round, restarts} のとき「各ラウンド終了時の中間レポート」描画:
  // worker は動かしたまま、apply は最終完了まで無効のままレポートだけ更新する。
  const progress = /** @type {HTMLElement} */ (document.getElementById('so-progress'));   // 骨格 (10_skeleton.js) に必ずある
  if (result && result.unsupported) {
    cleanupSeedOptWorker();
    progress.textContent = '⚠ ' + result.reason;
    return;
  }
  if (!interInfo) {
    cleanupSeedOptWorker({ keepWaiter: true });   // 決着は反映後 (この関数の末尾)
    S.SEEDOPT_RESULT = result;
    progress.textContent = `${note} ${i18n('seed.rematch.t31')}${result.stoppedEarly ? i18n('seed.rematch.s30') : ''}`;
  }
  const rep = result.report;
  const imp = rep.improvementPct.toFixed(1);

  // レポート描画: {プール間, プール内} × {同一地域, 直近対戦} の4セル。
  const dn = (u) => escHtml(displayOf[u] || u);
  const rc = rep.residualConcerns;
  const rcB = rep.residualConcernsBefore || null;   // 最適化前 (前後比較用)
  // 各項目 = 最適化後 (薄緑) + 折りたたみの「最適化前」(グレー・タップで展開)。
  // key は再描画時の開閉状態保持 (data-k) に使う。
  function beforeAfter(key, beforeHtml, afterHtml) {
    if (beforeHtml == null) return afterHtml;
    return `<div style="border:1px solid #dcfce7;border-radius:6px;padding:6px 8px;background:#f0fdf4;margin-top:3px">` +
        `<div style="font-size:10px;font-weight:700;color:#16a34a;margin-bottom:2px">${i18n('seed.rematch.t32')}</div>${afterHtml}</div>` +
      `<details data-k="ba-${key}" style="margin-top:3px"><summary style="cursor:pointer;font-size:10px;font-weight:700;color:#6b7280">${i18n('seed.rematch.t33')}</summary>` +
        `<div style="border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px;background:#f3f4f6;margin-top:2px">${beforeHtml}</div></details>`;
  }
  const sectionHead = (t) => `<div style="margin-top:10px;padding-top:6px;border-top:1px solid #e5e7eb;font-weight:700;font-size:12px;color:#111827">${t}</div>`;
  const ul = (items) => items.length ? `<ul style="margin:3px 0 0;padding-left:18px;font-size:11px;color:#374151">${items.map(x => `<li>${x}</li>`).join('')}</ul>` : '';
  const ok = (t) => `<div style="margin-top:3px;font-size:11px;color:#16a34a">✅ ${t}</div>`;
  const warn = (t) => `<div style="margin-top:5px;font-weight:600;font-size:11px;color:#b91c1c">⚠ ${t}</div>`;

  // 同一地域セルの描画（separable=要改善, majority=不可避）。
  function regionCell(reg, withRound) {
    let h = '';
    const sep = reg.separable || {}, prefs = Object.keys(sep);
    const sepN = reg.separablePairs != null ? reg.separablePairs : (reg.separableEarlyPairs || 0);
    const sepObj = reg.separable || reg.separableEarly || {};
    const sepK = Object.keys(sepObj);
    if (sepK.length) {
      h += warn(`${i18n('seed.rematch.t34')} ${sepN} ${i18n('seed.rematch.t20')}`);
      h += ul(sepK.map(pf => `<strong>${escHtml(SPSPGeo.unitName(pf))}</strong>（${sepObj[pf][0].prefCount}${i18n('seed.rematch.t35')} ` +
        sepObj[pf].map(x => `${dn(x.a)}×${dn(x.b)}(P${x.pool + 1}${withRound ? '/' + x.round + i18n('seed.rematch.s31') : ''})`).join('、')));
    } else {
      h += ok(i18n('seed.rematch.s20'));
    }
    if (reg.majority && Object.keys(reg.majority).length) {
      const mp = Object.keys(reg.majority);
      h += `<div style="margin-top:3px;font-size:11px;color:#9ca3af">${i18n('seed.rematch.t36')} ${mp.map(pf => `${escHtml(SPSPGeo.unitName(pf))} ${reg.majority[pf]}${i18n('seed.rematch.t20')}`).join('、')}${i18n('seed.rematch.t37')}${reg.majorityPairs}${i18n('seed.rematch.t38')}</div>`;
    }
    return h;
  }
  // ③ プール内×同一地域: 早期回戦で当たる同地域ペアを列挙（最多地域は除外）。
  function intraRegionCell(reg, earlyRound) {
    const ex = reg.excludedRegion ? `${i18n('seed.rematch.t39')} ${escHtml(SPSPGeo.unitName(reg.excludedRegion))} ${i18n('seed.rematch.t40')}` : '';
    if (!reg.earlyPairs) {
      return ok(`${i18n('seed.rematch.t41')} ${earlyRound}${i18n('seed.rematch.t42')}${ex}`);
    }
    let h = warn(`${i18n('seed.rematch.t41')} ${earlyRound}${i18n('seed.rematch.t43')} ${reg.earlyPairs} ${i18n('seed.rematch.t20')}${ex}`);
    h += ul(reg.earlyMatchups.map(x =>
      `<strong>${escHtml(SPSPGeo.unitName(x.region))}</strong>: ${dn(x.a)} × ${dn(x.b)}（P${x.pool + 1} / ${x.round}${i18n('seed.rematch.t44')}`));
    if (reg.earlyPairs > reg.earlyMatchups.length) {
      h += `<div style="font-size:11px;color:#9ca3af">${i18n('seed.rematch.t45')} ${reg.earlyPairs - reg.earlyMatchups.length} ${i18n('seed.rematch.t20')}</div>`;
    }
    return h;
  }
  // ── 同シリーズ再マッチの表示 ──
  // 対象シリーズが決まっているときだけ出す (未判定なら seriesCount は常に 0)。
  const seriesName = rep.targetSeries || null;
  // 罰則を掛けたかどうかで文言を変える: OFF でも「気づける」ように件数は出す。
  const seriesTag = (c) => (seriesName && c.seriesCount > 0)
    ? `<span style="color:#b45309;font-weight:600" title="${escHtml(seriesName)} ${i18n('seed.rematch.t46')} ${c.seriesCount} ${i18n('seed.rematch.t47')}">${i18n('seed.rematch.t48')}${c.seriesCount}${i18n('seed.rematch.t49')}</span> ` : '';
  const seriesLine = (recent) => {
    if (!seriesName) return '';
    const n = recent.sameSeriesPairs || 0;
    const head = `${i18n('seed.rematch.t50')}${escHtml(seriesName)}${i18n('seed.rematch.t51')} <strong>${n}</strong> ${i18n('seed.rematch.t20')}`;
    if (!n) return `<div style="margin-top:2px;font-size:11px;color:#16a34a">✅ ${head}</div>`;
    const top = (recent.sameSeriesTop || []).map(c => {
      const w = c.pool != null ? `P${c.pool + 1}` : `seed${c.seedA}×${c.seedB}`;
      return `${dn(c.a)} × ${dn(c.b)}（${w} / ${c.seriesCount}${i18n('seed.rematch.t52')}${c.seriesLastDate || '?'}）`;
    });
    return `<div style="margin-top:2px;font-size:11px;color:#b45309">◆ ${head}</div>` +
      (top.length ? `<div style="margin:2px 0 0;padding-left:12px;font-size:11px;color:#92400e">${top.map(t => `<div>${t}</div>`).join('')}</div>` : '') +
      (n > top.length ? `<div style="font-size:11px;color:#9ca3af;padding-left:12px">${i18n('seed.rematch.t45')} ${n - top.length} ${i18n('seed.rematch.t20')}</div>` : '');
  };
  // 対戦履歴 1 行 (同シリーズの試合には印を付ける)。
  const histLine = (m) => `<div${m.sameSeries ? ' style="color:#b45309;font-weight:600"' : ''}>` +
    `${m.sameSeries ? '◆ ' : ''}${escHtml(m.date || '?')} ` +
    `${m.tournament ? escHtml(m.tournament) : i18n('seed.rematch.s32')}` +
    `${m.nent != null ? `〈${m.nent}${i18n('seed.rematch.t53')}` : ''}</div>`;

  // 直近対戦セルの描画。
  function recentCell(recent, withRound) {
    let h = `<div style="margin-top:5px;font-size:11px;color:#374151">${i18n('seed.rematch.t54')} <strong>${recent.pairs}</strong> ${i18n('seed.rematch.t20')}${recent.top.length ? i18n('seed.rematch.s33') : ''}</div>`;
    h += seriesLine(recent);
    if (!recent.top.length) return h;
    // 各ペアはタップで過去の対戦履歴（日付・大会名・規模）を展開できる <details>。
    h += `<div style="margin:3px 0 0;padding-left:6px;font-size:11px;color:#374151">`;
    h += recent.top.map(c => {
      const t = c.lastTournament
        ? ` ${escHtml(c.lastTournament)}${c.lastNent != null ? `〈${c.lastNent}${i18n('seed.rematch.t53')}` : ''}`
        : '';
      const line = `${seriesTag(c)}${dn(c.a)} × ${dn(c.b)}（P${c.pool + 1}${withRound ? ' / ' + c.round + i18n('seed.rematch.s31') : ''} / ${c.count}${i18n('seed.rematch.t52')}${c.lastDate}${t}）`;
      const ms = Array.isArray(c.matches) ? c.matches : [];
      if (!ms.length) return `<div style="padding:1px 0 1px 12px">${line}</div>`;
      const hist = ms.map(histLine).join('');
      return `<details style="padding:1px 0"><summary style="cursor:pointer">${line}</summary>` +
        `<div style="margin:2px 0 4px 18px;color:#6b7280">${hist}</div></details>`;
    }).join('');
    h += `</div>`;
    return h;
  }

  // 各プールの地域バランス（① 用）。地域ごとのプール間分布と、各プールの内訳。
  function regionBalanceCell(reg) {
    const spread = reg.spread || {};
    const regs = Object.keys(spread).sort((a, b) => spread[b].total - spread[a].total);
    let h = '';
    if (!regs.length) { return ok(i18n('seed.rematch.s21')); }
    // 地域ごとの分布（min–max/プール）。完全均等なら max−min ≤ 1。
    const uneven = regs.filter(r => spread[r].max - spread[r].min >= 2);
    h += uneven.length
      ? warn(`${i18n('seed.rematch.t55')} ${uneven.length} ${i18n('seed.rematch.t56')}`)
      : ok(i18n('seed.rematch.s22'));
    h += ul(regs.map(r => {
      const s = spread[r];
      const bad = (s.max - s.min) >= 2;
      const mark = bad ? '⚠' : '';
      return `<span style="${bad ? 'color:#b91c1c;font-weight:600' : ''}">${escHtml(r)}${i18n('seed.rematch.t37')}${s.total}${i18n('seed.rematch.t57')} ${s.min}–${s.max}${i18n('seed.rematch.t11')} ${mark}</span>`;
    }));
    // 各プールの内訳（detail）。
    const comp = reg.poolComposition || [];
    h += `<details style="margin-top:4px"><summary style="font-size:11px;color:#6b7280;cursor:pointer">${i18n('seed.rematch.t58')}</summary>`;
    h += `<div style="font-size:11px;color:#374151;margin-top:3px">`;
    comp.forEach((pc, i) => {
      const parts = Object.keys(pc.counts).sort((a, b) => pc.counts[b] - pc.counts[a])
        .map(r => `${escHtml(r)}${pc.counts[r]}`);
      if (pc.unknown) parts.push(`${i18n('seed.rematch.t59')}${pc.unknown}`);
      h += `<div>P${i + 1}（${pc.size}${i18n('seed.rematch.t35')} ${parts.join(' / ')}</div>`;
    });
    h += `</div></details>`;
    return h;
  }

  // 各セルの評価値変化 before→after を小さく添える。
  const ev = (k) => `<span style="font-size:10px;color:#6b7280">${i18n('seed.rematch.t60')} ${rep.before[k].toFixed(1)}→${rep.after[k].toFixed(1)}</span>`;
  const ordTxt = (rep.before.order != null)
    ? ` ${i18n('seed.rematch.t61')} ${rep.before.order.toFixed(1)}→${rep.after.order.toFixed(1)}` : '';
  let html = '';
  if (interInfo) {
    html += `<div style="font-size:11px;color:#b45309;font-weight:600">${i18n('seed.rematch.t62')} ${interInfo.round}/${interInfo.restarts} ${i18n('seed.rematch.t63')}</div>`;
  }
  html += `<div style="font-weight:600;color:#111827">${i18n('seed.rematch.t64')} ${rep.before.total.toFixed(2)} → ${rep.after.total.toFixed(2)}（<span style="color:#16a34a">${imp}${i18n('seed.rematch.t65')}</span>）<span style="font-size:10px;color:#9ca3af">${ordTxt}</span></div>`;
  // 各ラウンドのステップ数% (= 実行ステップ / 上限。early stop で収束したラウンドは低くなる)
  if (S.SEEDOPT_ROUND_STATS.length) {
    const parts = S.SEEDOPT_ROUND_STATS.map(s =>
      `<span title="${s.iters.toLocaleString()} / ${s.maxIters.toLocaleString()} ${i18n('seed.rematch.t66')}">R${s.round} ${s.maxIters > 0 ? (s.iters / s.maxIters * 100).toFixed(0) : 0}%</span>`);
    html += `<div style="margin-top:2px;font-size:10px;color:#6b7280">${i18n('seed.rematch.t67')} ${parts.join(' / ')} <span style="color:#9ca3af">${i18n('seed.rematch.t68')}</span></div>`;
  }

  // ── レポート本体（デフォルト折りたたみ） ──
  html += `<details style="margin-top:6px"><summary style="cursor:pointer;font-weight:600;color:#374151">${i18n('seed.rematch.t69')}</summary>`;
  // ⑤ 予選抜け後セル (再対戦 = ②④ と同じタップ展開付き)。
  function postRecentCell(pRec) {
    let h = `<div style="font-size:11px;color:#374151">${i18n('seed.rematch.t70')} <strong>${pRec.pairs}</strong> ${i18n('seed.rematch.t20')}${pRec.top.length ? i18n('seed.rematch.s34') : ''}</div>`;
    h += seriesLine(pRec);
    if (!pRec.top.length) return h;
    h += `<div style="margin:3px 0 0;padding-left:6px;font-size:11px;color:#374151">`;
    h += pRec.top.map(c => {
      const t = c.lastTournament ? ` ${escHtml(c.lastTournament)}${c.lastNent != null ? `〈${c.lastNent}${i18n('seed.rematch.t53')}` : ''}` : '';
      const line = `${seriesTag(c)}${dn(c.a)} × ${dn(c.b)}（seed${c.seedA}×${c.seedB} / ${c.round}${i18n('seed.rematch.s31')}${c.count != null ? ' / ' + c.count + i18n('seed.rematch.t49') : ''}${i18n('seed.rematch.t71')}${c.lastDate || '?'}${t}）`;
      const ms = Array.isArray(c.matches) ? c.matches : [];
      if (!ms.length) return `<div style="padding:1px 0 1px 12px">${line}</div>`;
      const hist = ms.map(histLine).join('');
      return `<details style="padding:1px 0"><summary style="cursor:pointer">${line}</summary>` +
        `<div style="margin:2px 0 4px 18px;color:#6b7280">${hist}</div></details>`;
    }).join('');
    h += `</div>`;
    if (pRec.pairs > pRec.top.length) h += `<div style="font-size:11px;color:#9ca3af">${i18n('seed.rematch.t45')} ${pRec.pairs - pRec.top.length} ${i18n('seed.rematch.t20')}</div>`;
    return h;
  }
  function postRegionCell(pReg) {
    const exR = pReg.excludedRegion ? `${i18n('seed.rematch.t39')} ${escHtml(SPSPGeo.unitName(pReg.excludedRegion))} ${i18n('seed.rematch.t40')}` : '';
    let h = `<div style="margin-top:5px;font-size:11px;color:#374151">${i18n('seed.rematch.t72')} <strong>${pReg.pairs}</strong> ${i18n('seed.rematch.t20')}${exR}</div>`;
    if (pReg.top.length) {
      h += ul(pReg.top.map(x =>
        `<strong>${escHtml(SPSPGeo.unitName(x.region))}</strong>: ${dn(x.a)} × ${dn(x.b)}（seed${x.seedA}×${x.seedB} / ${x.round}${i18n('seed.rematch.t44')}`));
      if (pReg.pairs > pReg.top.length) h += `<div style="font-size:11px;color:#9ca3af">${i18n('seed.rematch.t45')} ${pReg.pairs - pReg.top.length} ${i18n('seed.rematch.t20')}</div>`;
    }
    return h;
  }

  // ① プール間 × 同一地域 ＝ 各プールの地域バランス
  html += sectionHead(`${i18n('seed.rematch.t73')} ${ev('interRegion')}`) + `<div style="font-size:10px;color:#9ca3af">${i18n('seed.rematch.t74')}</div>`;
  html += beforeAfter('1', rcB && regionBalanceCell(rcB.inter.region), regionBalanceCell(rc.inter.region));
  // ② プール間 × 直近対戦
  html += sectionHead(`${i18n('seed.rematch.t75')} ${ev('interRecent')}`) + `<div style="font-size:10px;color:#9ca3af">${i18n('seed.rematch.t76')}</div>`;
  html += beforeAfter('2', rcB && recentCell(rcB.inter.recent, false), recentCell(rc.inter.recent, false));

  if (rc.intra) {
    const er = rc.intra.earlyRound;
    // intra 最適化をオフにした場合もレポートは出す（既定ブラケット順の当たり）が、
    // 評価値は目的関数に含まれない(常に0)ので添えない。
    const ranIntra = result.ranAfter && result.ranAfter.runIntra;
    const evIntra = (k) => ranIntra ? ev(k) : '<span style="font-size:10px;color:#9ca3af">（プール内変動オフ＝既定ブラケット順の当たり）</span>';
    // ③ プール内 × 同一地域 ＝ 同一地域が当たる最早回戦の分布
    html += sectionHead(`${i18n('seed.rematch.t77')} ${evIntra('intraRegion')}`) + `<div style="font-size:10px;color:#9ca3af">${i18n('seed.rematch.t78')}</div>`;
    html += beforeAfter('3', rcB && rcB.intra && intraRegionCell(rcB.intra.region, er), intraRegionCell(rc.intra.region, er));
    // ④ プール内 × 直近対戦
    html += sectionHead(`${i18n('seed.rematch.t79')}${er}${i18n('seed.rematch.t80')} ${evIntra('intraRecent')}`) + `<div style="font-size:10px;color:#9ca3af">${i18n('seed.rematch.t81')}</div>`;
    html += beforeAfter('4', rcB && rcB.intra && recentCell(rcB.intra.recent, true), recentCell(rc.intra.recent, true));
  }
  // ⑤ 予選抜け後 (本戦想定): 全体を1つの勝者側ブラケットとみなし、シード通り
  // 勝ち進んだ場合に閾値より後の回戦で当たる 直近対戦/同一地域 ペア。
  if (rc.postPool) {
    const th = rc.postPool.threshold;
    html += sectionHead(`${i18n('seed.rematch.t82')}${th}${i18n('seed.rematch.t83')}`) +
      `<div style="font-size:10px;color:#9ca3af">${i18n('seed.rematch.t84')}${th}${i18n('seed.rematch.t85')}</div>`;
    const postHtml = (pc) => postRecentCell(pc.recent) + postRegionCell(pc.region);
    html += beforeAfter('5', rcB && rcB.postPool && postHtml(rcB.postPool), postHtml(rc.postPool));
  }
  html += `</details>`;

  // ── 最適化前後の順位比較（デフォルト折りたたみ） ──
  if (ranking && ranking.length) {
    const P = result.pools.length;
    // P 列の表記: ウェーブ設定時は A3 形式 (ウェーブ文字+ウェーブ内プール番号)、無ければ数字。
    const wmapCmp = currentWaveMap(P);
    const poolTag = (pool1) => wmapCmp.some(w => w > 0)
      ? escHtml(poolLabel(pool1 - 1, wmapCmp)) : String(pool1);
    const origRank = {};
    ranking.forEach((u, i) => { origRank[u] = i + 1; });
    // DE 想定順位 (1,2,3,4,5,5,7,7,9,9,9,9,13,…): シード番号を1つの DE ブラケットと
    // 見なしたときの「シードどおりなら何位で終わるか」。シード番号の ± が実質的な
    // 順位変化を伴うかどうかがここで分かる (同じタイ帯内の移動なら想定順位は不変)。
    const dePlace = (s) => (SeedOptimizer ? SeedOptimizer.dePlaceOfSeed(s) : s);
    // プール内順位 = snake の行番号+1（プール p の r 行目 = そのプールの r 番手）。
    const poolRank = (s) => (SeedOptimizer ? SeedOptimizer.rowOfSeed(s - 1, P) : 0) + 1;
    const rows = result.seedOrder.map((u, i) => {
      const seed = i + 1, orig = origRank[u] || null;
      const delta = orig != null ? (seed - orig) : null;   // +は元より下のシードへ
      const pool = (SeedOptimizer ? SeedOptimizer.poolOfSeed(i, P) : 0) + 1;
      const origDe = orig != null ? dePlace(orig) : null;
      const newDe = dePlace(seed);
      const origPool = orig != null ? (SeedOptimizer ? SeedOptimizer.poolOfSeed(orig - 1, P) : 0) + 1 : null;
      const origPr = orig != null ? poolRank(orig) : null;
      const newPr = poolRank(seed);
      return { u, seed, orig, delta, pool, origDe, newDe, origPool, origPr, newPr };
    });
    const moved = rows.filter(r => r.delta != null && r.delta !== 0).length;
    const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.delta || 0)), 0);
    const deMoved = rows.filter(r => r.origDe != null && r.origDe !== r.newDe).length;
    const prMoved = rows.filter(r => r.origPr != null && r.origPr !== r.newPr).length;
    let t = `<details style="margin-top:6px"><summary style="cursor:pointer;font-weight:600;color:#374151">${i18n('seed.rematch.t86')}</summary>`;
    t += `<div style="font-size:10px;color:#9ca3af">${i18n('seed.rematch.t87')}${moved}${i18n('seed.rematch.t88')}${maxAbs}${i18n('seed.rematch.t89')} ${deMoved}${i18n('seed.rematch.t90')} ${prMoved}${i18n('seed.rematch.t91')}</div>`;
    t += `<table style="margin-top:4px;border-collapse:collapse;font-size:11px;width:100%"><thead><tr style="color:#6b7280;text-align:left">`;
    t += `<th style="padding:2px 6px">${i18n('seed.rematch.t92')}</th><th style="padding:2px 6px">P</th><th style="padding:2px 6px">${i18n('seed.rematch.t93')}</th><th style="padding:2px 6px">${i18n('seed.rematch.t94')}</th><th style="padding:2px 6px">${i18n('seed.rematch.t95')}</th><th style="padding:2px 6px" title="${i18n('seed.rematch.t98')}">${i18n('seed.rematch.t96')}</th><th style="padding:2px 6px" title="${i18n('seed.rematch.t99')}">${i18n('seed.rematch.t97')}</th></tr></thead><tbody>`;
    for (const r of rows) {
      const dcol = /** @type {number} */ (r.delta) > 0 ? '#b91c1c' : (/** @type {number} */ (r.delta) < 0 ? '#2563eb' : '#9ca3af');   // null は下の dtxt で '—'。ここでは灰色になる
      const dtxt = r.delta == null ? '—' : (r.delta > 0 ? '↓+' + r.delta : (r.delta < 0 ? '↑' + r.delta : '0'));
      // 表記は数値のみ（「位」「番手」は書かない）。不変はグレー数値、変動は色付き矢印。
      let deTxt;
      if (r.origDe == null || r.origDe === r.newDe) {
        deTxt = `<span style="color:#9ca3af">${r.newDe}</span>`;
      } else {
        const deCol = r.newDe > r.origDe ? '#b91c1c' : '#2563eb';
        deTxt = `<span style="color:${deCol};font-weight:600">${r.origDe} → ${r.newDe}</span>`;
      }
      let prTxt;
      if (r.origPr == null || r.origPr === r.newPr) {
        prTxt = `<span style="color:#9ca3af">${r.newPr}</span>`;
      } else {
        const prCol = r.newPr > r.origPr ? '#b91c1c' : '#2563eb';
        prTxt = `<span style="color:${prCol};font-weight:600">${r.origPr} → ${r.newPr}</span>`;
      }
      t += `<tr><td style="padding:2px 6px">${r.seed}</td><td style="padding:2px 6px;color:#9ca3af">${poolTag(r.pool)}</td><td style="padding:2px 6px">${escHtml((displayOf[r.u] || r.u))}</td><td style="padding:2px 6px">${r.orig == null ? '—' : r.orig}</td><td style="padding:2px 6px;color:${dcol}">${dtxt}</td><td style="padding:2px 6px">${deTxt}</td><td style="padding:2px 6px">${prTxt}</td></tr>`;
    }
    t += `</tbody></table></details>`;
    html += t;
  }
  // 中間レポートの再描画で開いていた <details> が閉じないよう、開閉状態を
  // キー (data-k、無ければ summary テキスト) で保存して復元する。
  const reportEl2 = /** @type {HTMLElement} */ (document.getElementById('so-report'));   // 骨格 (10_skeleton.js) に必ずある
  const detailKey = (d) => {
    if (d.dataset && d.dataset.k) return d.dataset.k;
    const s = d.querySelector('summary');
    return s ? s.textContent : '';
  };
  const openKeys = new Set();
  reportEl2.querySelectorAll('details[open]').forEach(d => openKeys.add(detailKey(d)));
  reportEl2.innerHTML = html;
  if (openKeys.size) {
    reportEl2.querySelectorAll('details').forEach(d => {
      if (openKeys.has(detailKey(d))) d.open = true;
    });
  }
  if (!interInfo) {
    // 完了したら自動で反映する。「最適化したのにプレビューや CSV が元のまま」を
    // 起こさないため (2026-08-14)。戻したいときは「最適化を取り消す」。
    applySeedOptimize();
    settleSeedOptWaiter(!!S.APPLIED_ORDER);   // 適用前の自動実行 (runSeedOptimizeAndWait) を進める
  }
}

/**
 * 最適化の結果を反映する。**完了時に自動で呼ばれる** (= 実行したら反映される)。
 * 戻したいときは「最適化を取り消す」(cancelSeedOptimize)。
 */
function applySeedOptimize() {
  if (!S.SEEDOPT_RESULT || !S.SEEDOPT_RESULT.seedOrder) return;
  // 取り消し用に、反映する直前の並びと手動調整の状態を控えておく。
  if (!S.PRE_OPT) {
    S.PRE_OPT = {
      order: DATA.map((r) => r.user_id),
      manual: S.MANUAL ? JSON.parse(JSON.stringify(S.MANUAL)) : null,
    };
  }
  S.APPLIED_ORDER = S.SEEDOPT_RESULT.seedOrder.slice();
  // 被り回避を反映したら手動編集は閉じる (表は最適化後の順序になるので、
  // 編集バーだけ出したままだと状態が食い違う)。編集の再開で反映が解除される。
  if (S.MANUAL && S.MANUAL.editing) { S.MANUAL.editing = false; S.MANUAL.committed = true; S.MANUAL.sel = null; }
  // 表示順も最適化後に合わせる。
  const pos = new Map(S.APPLIED_ORDER.map((u, i) => [u, i]));
  DATA.sort((a, b) =>
    (pos.has(a.user_id) ? /** @type {number} */ (pos.get(a.user_id)) : 1e9) - (pos.has(b.user_id) ? /** @type {number} */ (pos.get(b.user_id)) : 1e9));
  render();
  const reportEl = document.getElementById('so-report');
  if (reportEl && !reportEl.querySelector('.seedopt-applied-banner')) {
    const div = document.createElement('div');
    div.className = 'seedopt-applied-banner';
    div.style.cssText = 'margin-top:10px;padding:6px 10px;background:#dcfce7;border:1px solid #16a34a;border-radius:6px;color:#166534;font-size:12px;font-weight:600';
    div.textContent = i18n('seed.rematch.s23');
    reportEl.appendChild(div);
  }
  showOptCancelBtn(true);
  renderManualUI();   // 手動調整リスト表示中なら通常表 (最適化後順序) に切り替える
}

/**
 * 最適化を無かったことにする。実行する直前の並び・手動調整の状態に戻し、
 * レポートも実行前 (= 何も出ていない状態) に戻す。
 * トーナメントプレビューや CSV も、以後は元の順序で出る。
 */
export function cancelSeedOptimize() {
  const had = !!S.APPLIED_ORDER || !!S.SEEDOPT_RESULT;
  S.APPLIED_ORDER = null;
  if (S.PRE_OPT) {
    const pos = new Map(S.PRE_OPT.order.map((u, i) => [u, i]));
    DATA.sort((a, b) =>
      (pos.has(a.user_id) ? /** @type {number} */ (pos.get(a.user_id)) : 1e9) - (pos.has(b.user_id) ? /** @type {number} */ (pos.get(b.user_id)) : 1e9));
    S.MANUAL = S.PRE_OPT.manual ? JSON.parse(JSON.stringify(S.PRE_OPT.manual)) : null;
    S.PRE_OPT = null;
    saveManual();
  }
  showOptCancelBtn(false);
  resetSeedOptResultPanel(had ? i18n('seed.rematch.s24') : '');
  render();
  renderManualUI();
}
