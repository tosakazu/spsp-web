// @ts-check
// seeding/app/00_state.js — シードツールの共有状態。以前は seeding/app/*.js がトップレベルの let を同じ字句環境で共有していた
// (結合して読む前提)。ES module にするためここに集約した (2026-09-15)。読み書きは S.NAME。ファイル内だけで使う状態は各ファイルの let のまま。
/** 共有状態の型。記録の形 (SpspSeed* / SpspUpcoming*) は types/spsp.d.ts */
/** @typedef {{
 *   APPLIED_ORDER: number[] | null,
 *   CSV_SOURCE: SpspSeedCsvSource | null,
 *   DISCRIMINATORS: Record<string, string> | null,
 *   DISC_LOAD_ERROR: string | null,
 *   EVENT_CONTEXT: SpspSeedEventContext | null,
 *   MANUAL: SpspSeedManual | null,
 *   MASTER_MAP: Map<number, SpspRankRecord> | null,
 *   META: SpspRankMeta | null,
 *   PRE_OPT: SpspSeedPreOpt | null,
 *   SEEDOPT_RESULT: SpspSeedOptResult | null,
 *   SEEDOPT_ROUND_STATS: SpspSeedOptRoundStat[],
 *   SEEDOPT_WORKER: Worker | null,
 *   SEED_SPEC: SpspSeedSpec | null,
 *   SERIES_USER_PICKED: boolean,
 *   TABLE: import('../../ranking-table.js').RankingTable | null,
 *   UPCOMING_DATA: SpspUpcomingData | null,
 *   UPCOMING_PAGE: number,
 *   currentMethod: string,
 *   filterText: string,
 * }} SeedState */
/** @type {SeedState} */
export const S = {
  APPLIED_ORDER: null,   // 30_core.js
  CSV_SOURCE: null,   // { rows: object[], label: string }   // 80_csv_source.js
  DISCRIMINATORS: null,   // {uid(str): disc} | null (未取得/取得失敗)   // 30_core.js
  DISC_LOAD_ERROR: null,   // 30_core.js
  EVENT_CONTEXT: null,   // 30_core.js
  MANUAL: null,   // {base:[uid], ops:[{uid,to}], hpos, committed, editing, sel}   // 30_core.js
  MASTER_MAP: null,   // 30_core.js
  META: null,   // 30_core.js
  PRE_OPT: null,   // { order: [uid], manual: MANUAL の複製 | null }   // 30_core.js
  SEEDOPT_RESULT: null,   // 99_bootstrap.js
  SEEDOPT_ROUND_STATS: [],   // 各最適化ラウンドのステップ統計 [{round, iters, maxIters}]   // 99_bootstrap.js
  SEEDOPT_WORKER: null,   // 99_bootstrap.js
  SEED_SPEC: null,   // {label, pins, waves, locks}   // 30_core.js
  SERIES_USER_PICKED: false,   // ユーザーが手で選んだら自動判定で上書きしない   // 75_series_rematch.js
  TABLE: null,   // 30_core.js
  UPCOMING_DATA: null,   // { tournaments: [...] } or null while loading   // 60_upcoming.js
  UPCOMING_PAGE: 0,   // 0-indexed   // 60_upcoming.js
  currentMethod: 'ensemble',   // 30_core.js
  filterText: '',   // 30_core.js
};
