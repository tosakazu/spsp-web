// @ts-check
// seeding/app/70_players_cache.js — SPSP シードツール本体の一部: 選手 JSON のキャッシュ。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import SeedData from '../seed_data.js';
'use strict';

// ── 選手データのキャッシュ ────────────────────────────────────────────
// 同じ大会で「最適化を実行」を押し直すたびに players/*.json を取り直していた
// (256名なら毎回 250 リクエスト・十数 MB)。ファイルの中身はセッション中に変わらない
// ので uid 単位でキャッシュする。集計自体はやり直す — 減衰点・平日除外・ペア内集計・
// 対象シリーズを変えたら結果も変わるべきで、そこは軽いため。
//
// 通信エラーはキャッシュしない (次回リトライさせる)。404 (DB 未登録) は確定した
// 答えなのでキャッシュする。上限を超えたら古い順に捨てる (大規模大会を複数
// 読み込んだときに際限なく抱えないための保険)。
export const PLAYER_CACHE = new Map();   // uid -> player json | { __missing: true }
const PLAYER_CACHE_MAX = 6000;    // 実運用の最大規模 (3000人弱) の 2 大会分
let PREFS_CACHE = null;

export function cachedFetchers(prefix) {
  const base = SeedData.defaultFetchers(prefix);
  return {
    fetchPlayer: async (uid) => {
      if (PLAYER_CACHE.has(uid)) return PLAYER_CACHE.get(uid);
      const j = await base.fetchPlayer(uid);   // 失敗は throw されるのでキャッシュされない
      if (PLAYER_CACHE.size >= PLAYER_CACHE_MAX) {
        PLAYER_CACHE.delete(PLAYER_CACHE.keys().next().value);   // 挿入順に破棄
      }
      PLAYER_CACHE.set(uid, j);
      return j;
    },
    fetchGeo: () => base.fetchGeo(),   // キャッシュは SeedData 側 (ensureGeoCatalog)
    fetchPrefs: async () => {
      if (PREFS_CACHE) return PREFS_CACHE;
      PREFS_CACHE = await base.fetchPrefs();
      return PREFS_CACHE;
    },
  };
}
