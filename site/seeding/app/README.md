# site/seeding/app — シードツール本体 (seed / seed-upload 共通)

2026-09-13 に 1 本の `seed_app.js` (4,330 行) を見出し単位で分けたもの。**ページの `<script>` の並び順に読まれ、
トップレベルの `const` / `let` / `function` は同じグローバル字句環境で共有される** (bundler なし、名前空間なし)。
名前は分割前と同じなので、`tests/seeding/*` は `tests/seeding/helpers/seed_app_src.cjs` で連結した 1 本の文字列として読む。

| ファイル | 中身 | 読み込み時に走るもの |
|---|---|---|
| `10_skeleton.js` | 本体 HTML (`SEED_APP_SKELETON_HTML`) と `SEED_APP_CONFIG` (`window.SEED_APP_CONFIG` を既定 `{mode:'spsp'}` に重ねる) | `#seed-app-root` にスケルトンを注入 |
| `20_help.js` | ヘルプアイコン (?) の文言と表示 | ヘルプの配線、`injectHelpIcons` |
| `30_core.js` | 状態 (`DATA` / `META` / `MASTER_MAP` / `EVENT_CONTEXT` / `APPLIED_ORDER` …)、出力順 `orderedRecs`、手動調整モード (`MANUAL`)、表の列と `ensureTable` | 手動調整バーの配線 |
| `40_startgg.js` | start.gg API (取得・適用・エラー辞書)、CSV ダウンロード、`handleFetch` | — |
| `50_events.js` | 検索・基準タブの配線、展開行 (大会別 / 直接対決) | 検索・タブ・展開行の配線 |
| `60_upcoming.js` | 今後の大会ピッカー、複数 event の選択 UI | — |
| `70_players_cache.js` | 選手 JSON のキャッシュ (`cachedFetchers`) | — |
| `75_series_rematch.js` | 同シリーズ再マッチの判定、被り回避最適化の実行・完了・反映・取り消し (`runSeedOptimize` …) | — |
| `80_csv_source.js` | csv モード: 基準順位ソース (CSV / Google Sheets) | — |
| `85_waves.js` | ウェーブ (連続するプールの塊 A, B, C …) | — |
| `90_spec.js` | 📌 シード指定・固定 (spec-panel)、作業状況の保存、トーナメントプレビュー発行 | 📌 パネルの配線 |
| `99_bootstrap.js` | ページの起動 (トークン欄、シリーズ切替、最適化ボタン) | **読み込み時に他ファイルの関数を呼ぶので最後** |

## 決まりごと

- 関数宣言の巻き上げは同じファイルの中だけ。読み込み時 (トップレベルや即時関数の中) に呼ぶ関数は、
  それより前のファイルで定義されていること。イベントハンドラの中からなら順序は問わない。
- ファイルを足したら `site/seed/index.html` と `site/seed-upload/index.html` の両方に同じ順で `<script>` を足す
  (`tests/seeding/helpers/seed_app_src.cjs` は `seed/index.html` の並びを読む)。
- 依存モジュール (`js/html.js` … `seeding/seed_share.js`) はすべてこれらより前に読む (`tests/meta/script_order.test.cjs`)。

## ES module (2026-09-15)

各ファイルは ES module になった。他ファイルから使う関数・定数は `export`、使う側は `import { … } from './NN_x.js'`。
他ファイルからも書き換える状態 (`MANUAL`、`EVENT_CONTEXT`、`SEEDOPT_WORKER` …) は `00_state.js` の `S` に集約してあり、`S.NAME` で読み書きする。
ファイル内だけの状態は各ファイルの `let` のまま。共通モジュール (SeedData / SeedOptimizer / SPSPRankingTable …) も import で使う。
Web Worker (`../seed_worker.js`) は `import SeedOptimizer` する ES module で、ビルドが `dist/assets/seed_worker.js` に束ねる。ページ (`src/pages/seed.js`) の import の並びは残っているが、依存は import で解決される。
