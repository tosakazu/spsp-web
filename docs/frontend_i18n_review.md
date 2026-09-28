# フロントエンド全体レビューと多言語・多地域対応の設計案

2026-09-12。北米版リリースに向けて `site/` 配下を全ファイル読んでレビューした結果と、共通化・多言語化の方針案。
事実 (file:line) は 2026-09-12 の `main` (1d7d26d) 時点。

## 0. 要約

- **現状**: HTML 30 ページ + JS/CSS 30 本、約 27,600 行。共通モジュールは `nav.js` / `ranking-table.js` / `player-detail.js` / `logo.js` / `share.js` / `js/{html,data,fighter_number}.js` と seeding 系のみで、**約 6,000 行が各ページの inline `<script>`/`<style>`**。同じ関数・CSS が 3〜5 ページにコピーされ、すでに 2 件の機能不全 (§2) を生んでいる。
- **多言語**: i18n 層は無い。UI 文言は日本語直書きで概算 **3,000 箇所以上** (解説・ブログの本文は別)。加えて **ビルド出力 (JSON) 自体に日本語表示文字列が焼き込まれている** 箇所が 10 種類あり、フロントだけでは直せない (§4.7)。
- **多地域**: 「日本 = 国内、それ以外 = 海外」「都道府県 = 唯一の地理単位」「JST」「日本の祝日で休日/平日」がフロント・ビルド双方に前提として埋まっている。北米版は "言語を英語にした日本版" では成立せず、**地域 (region) と言語 (lang) を分離した設計**が要る。
- **方針案**: コードは 1 本。地域ごとに「設定 + データルート」を差し替える (smash_database の `scripts/<Region>/` と同じ考え方)。UI 文言は実行時辞書 (`ja`/`en`)、長文ページは言語別ファイル、ビルド出力は ID + 名前表に改める。
- **段階**: ⓪ 準備 (テストを文言非依存に・不具合修正) → ① 共通化 (見た目不変) → ② 文言抽出 → ③ ビルド契約 (来季境界に合わせる) → ④ 北米デプロイ。①〜② は日本版の見た目を変えずに進められる。

---

## 1. 現状の棚卸し

### 1.1 ページと inline 量

| ページ | 行数 | inline JS | inline CSS | 日本語を含む行 | 備考 |
|---|---:|---:|---:|---:|---|
| `index.html` (全国) | 1,325 | 799 | 419 | 179 | チャート約 320 行が到達不能 (dead) |
| `p/index.html` (選手) | 2,718 | 1,995 | 527 | 408 | `t/` とヘルパ・CSS がほぼ同一 |
| `t/index.html` (大会) | 1,028 | 582 | 326 | 123 | |
| `sim/index.html` + `calc.js` | 989 + 446 | 781 | 149 | 126 + 63 | `calc.js` は UMD で唯一再利用可能な形 |
| `local/ranking.html` | 856 | 477 | 304 | 110 | `ranking-table.js` の関数の dead copy あり (402-426) |
| `priority/index.html` | 653 | 459 | 103 | 95 | 47 都道府県を直書き |
| `c/ranking.html` | 612 | 311 | 242 | 51 | コピー漂流バグ 2 件 (§2) |
| `events/index.html` | 517 | 262 | 165 | 55 | 状態管理は最も整理されている |
| `c/index.html` | 387 | 245 | 78 | 45 | |
| `pref/ranking.html` | 361 | 224 | 92 | 31 | `overseas.json` を読まない・`.tag-*` CSS 欠落 |
| `local/index.html` | 318 | 146 | 109 | 37 | |
| `pref/index.html` | 263 | 147 | 71 | 27 | 47 都道府県を直書き (2 箇所目) |
| `news/index.html` | 169 | 70 | 68 | 14 | |
| `vote.html` / `post.html` / `callback.html` | 227 / 84 / 41 | 0 | 132 / 41 / 12 | 40 / 9 / 6 | 3 ページで同じ inline CSS |
| `seed/` `seed-upload/` `bracket/index.html` | 40 / 40 / 114 | 0 | 0 | 4 / 4 / 35 | seed の 2 ページは 1 行違い |
| 解説 `overview/details/math/eval` | 427 / 772 / 438 / 498 | 0 | 157 / 94 / 92 / 92 | 132 / 340 / 145 / 215 | 本文が日本語。`.nav` の dead CSS ×4 |
| ブログ 6 記事 + 目次 | 約 1,000 | 0 | 0 (`blog.css`) | 約 600 | spsp.games 限定 (`nav.js:118`, `deploy_v4.sh:93`) |

共有 JS: `seeding/seed_app.js` **4,339** / `seed_optimizer.js` 1,558 / `bracket_app.js` 1,093 / `ranking-table.js` 727 / `js/vote.js` 701 / `seed_share.js` 510 / `nav.js` 503 / `bracket_core.js` 386 / `player-detail.js` 381 / `seed_data.js` 380 / `logo.js` 268 / `js/oauth_state.js` 263 / `js/callback.js` 254 / `seed_uploader.js` 254 ほか。

### 1.2 いまある共通化の型

- `js/html.js` / `js/data.js` (2026-09-07, c636dc7) が確立した型: **IIFE + `window.SPSPXxx` + `module.exports`**。bundler なし、`<script>` の並び順が契約。これは本レビューでも維持する (spsp.games が `site/` を直配信する運用と両立する唯一の形)。
- ただし `js/data.js` の `fetchJson*` は**どのページも使っていない** (各ページが `fetch().then(r => r.ok ? …)` を手書き、失敗時の挙動が 5 通り)。共通化は「モジュールを作る」だけでなく「ページ側を寄せる」までやって初めて効く。
- `ranking-table.js` / `player-detail.js` は評価時に `SPSPHtml` を参照する (`ranking-table.js:33`, `player-detail.js:34`) ため読み込み順依存がある。

### 1.3 テストの読み込み方 (i18n に直接効く)

| 方式 | 対象 | 影響 |
|---|---|---|
| `require()` | `seed_optimizer/seed_data/seed_share/bracket_core/auth/oauth_state` | 安全 |
| ソースを正規表現で切り出して `eval` | `seed_app.js` の個別関数 (`tests/seeding/page_dom.test.cjs:22-33`, `page_wiring.test.cjs:20-32`), `index.html` の `displayName` (`tests/meta/ranking_name.test.cjs:14-16`) | 関数名変更・IIFE 化で機械的に壊れる |
| jsdom でページ丸ごと | `bracket_dom`, `callback_dom`, `vote_dom`, `nav_dom`, `logo` | 安全 (jsdom 無ければ skip) |
| 静的文字列一致 | `page.test.cjs`, `bracket_caveat`, `priority_page` など | **描画済み日本語文言への assert が 34 ファイル・約 640 行** (例 `bracket_dom.test.cjs:150` `'東京都'`, `:215` `'敗者側決勝'`) |

→ 文言辞書を入れる前に、これらの assert を **key / id / data 属性ベース**に書き換える工程 (⓪) が必要。

### 1.4 配信・ビルドとの関係

- `site/` は spsp.games が直配信、gh-pages は `BUILD_DIR` から `rsync -aL --delete` (`deploy/deploy_v4.sh:92`)。`_overlay_frontend` (`spsp/cli/build_full.py:526`) が `site/` を BUILD_DIR に重ね、**`build/site_v4/{overview,details,eval,math}.html` で上書き**する (`:563-571`)。
- `players/` 1.2 GB (22,194 件)・`tournaments/` 370 MB (4,246 件) は start.gg の ID がキー。北米版と日本版で同じ選手 (両地域で出場) が別内容になるので、**地域ごとに別ルート**が要る。
- gh-pages は 1.6 GB で既に週次 reshallow が必要 (`deploy/reshallow_ghpages.sh`)。北米版を同じブランチに載せると倍になる → 北米版のホスティングは別に決める必要がある (§6)。

---

## 2. レビュー中に確認した不具合・要整理 (i18n と独立)

出力 (ランキング) は変えない範囲で、①より前に片付けるのがよいもの。

1. **`seeding/seed_app.js:3558` `settingNotes` が未定義** (`ReferenceError`)。宣言は別関数 `applySpecRows` 内の `:3970` のみ。seed-upload (CSV モード) で CSV 順の適用が成功したパスで必ず例外になる。`restoreManualForEvent` → `:737` 経由には catch が無い。
2. **`c/ranking.html:572` と `pref/ranking.html:331`**: 詳細パネルのタブ切替が `.tab-content` / `dataset.tab` を探すが、`player-detail.js:345-349` が出すのは `.detail-tab-content` + `tab-tour`/`tab-h2h`。大会別 / 直接対決の切替が効かない。`index.html:1118` と `local/ranking.html:768` は正しい。
3. **`c/ranking.html:584` と `pref/ranking.html:343`**: `cfg.tourSortKey` を切り替えるが `player-detail.js` はモジュール内 `tourSortMode` (`:37-59`) しか見ない → 並び替えトグルが無効。
4. **`pref/ranking.html` は `overseas.json` を読まない** (他 3 つのランキングページは読む)。海外バッジ・灰色行・国内カウンタが無い。`.tag-*` の CSS も無く、展開行のタグが素で出る。
5. **解説 4 ページの二重管理**: `build/site_v4/*.html` (gh-pages 向け) と `site/*.html` (spsp.games 向け) の内容が乖離 (`overview` で 336 行差、`details` で 786 行差。`site/` 側は 2026-07-15 更新、`build/site_v4` 側は "v4 の" 表記が残る旧版)。README にも「統合は未決」とある。**2 配信で別の解説が出ている**。
6. **エンジン定数の三重管理と不一致**: `sim/calc.js:200-206 LV_FILTERS` / `p/index.html:976-983 MIN_NENT_GT` / `meta.json params.LV*_FILTER` が手動同期のコメント付きで存在し、現在 LV3/LV4 の閾値が食い違う。`TJPR_ELO_SCALE` も `calc.js:23` = 17.5、ページ側 fallback = 100。
7. **日付境界の扱いが混在**: `priority/index.html:305-308` は UTC の今日 vs JST の最終参加日 (深夜に 1 日ずれ)、`local/ranking.html:433` は `T00:00:00Z` 解釈、`index.html:1264-1274` の速報 24h 窓は閲覧者ローカル時刻、`events/index.html:286` と `sim/index.html:422,439` は `+09:00` 直書き。`p/` は luxon を読み込むがゾーン未設定。日本版でも海外閲覧者で挙動がずれる。
8. **dead code**: `index.html:706-730, 868-1024` (チャート、入口なし)、`local/ranking.html:402-426`、`seed_app.js:531-547 ensureChartJs` (呼び出しなし)、`seed_uploader.js` の `buildSeedMapping/extractPhaseIdFromUrl/isEventUrl/resolveEventPhase`、解説 4 ページの `.nav` CSS、`ranking-table.js:440-443 setColumnVisibility` (throw するだけ)。
9. **`seed_optimizer.js:1475` に生の NUL バイト** (`'\0'` をエスケープせず埋め込み)。`file` は data、GNU grep はバイナリ扱いで**検索から漏れる**。
10. **`logo.js:164`** ローディング判定が `/読み込み中|ロード中/` の文字列一致。英語化した瞬間にロゴのローディング演出が消える。
11. `nav.js:118` の `spsp.games` ホスト名判定と `deploy_v4.sh:93` の `--exclude 'blog'` が、コード上唯一のホスト依存分岐。

---

## 3. 共通化の設計

### 3.1 方針

- **bundler は入れない**。`site/` 直配信・`node --test` 直 require・`/b/` プレビューという現行運用を壊さない。`js/html.js` の型 (IIFE + `window.SPSP*` + `module.exports`) で統一する。
- 共通モジュールは **`site/js/` に集約**し、`nav.js` / `share.js` / `logo.js` / `ranking-table.js` / `player-detail.js` も `site/js/` へ移す (URL は `<script src>` を直すだけ)。
- グローバルは `window.SPSP = {…}` 名前空間 1 つに寄せる (`SPSPHtml`, `SPSPData`, `SPSPRankingTable`, `SPSPDetail`, `SPSPShare`, `SPSPLogo`, `SPSPCalc`, `SeedData`, `SeedShare`, `SeedOptimizer`, `SmashSeed`, `BracketCore`, `SpspAuth`, `SpspOAuthState` の 14 個が現状)。旧名は alias で残し、テストを移してから消す。
- 読み込み順の契約は各ページに書かず、**`site/js/README.md` に 1 表**で持つ (`html → data → config → i18n → format → …`)。`tests/meta` に「各ページの `<script>` 並びが表と矛盾しない」静的テストを 1 本足す。

### 3.2 新設する共通モジュール (何をどこから吸い上げるか)

| モジュール | 中身 | 吸い上げ元 (現状のコピー) |
|---|---|---|
| `js/config.js` | サイト設定 (§4.2)。地域・言語・データルート・URL・GA・OAuth | `js/post_config.js:11-28`, `nav.js:21 GA_ID`, 各ページ canonical, `seed_app.js:1382-1383` |
| `js/i18n.js` | `t(key, params)`, 複数形, `Intl` 数値/日付, `<html lang>`, `data-i18n` 適用 (§4.3) | 新規 |
| `js/format.js` | Lv ラベルと接尾辞のはしご (👑≤8 … `{4:384,3:768,2:1536,1:3072}`), 順位クラス (gold/silver/bronze/top8), `fmtRank`, 符号付き差分, 相対日数, `ELO_PER_UNIT`/`TJPR_ELO_SCALE` の解決 | `ranking-table.js:186-201`, `player-detail.js:156-157`, `p/index.html:731-746, 1195-1206`, `t/index.html:534-540` (未使用), `sim/index.html:343-353`, `bracket_core.js:367-374 fmtRelDays` |
| `js/chars.js` | キャラ ID → 名前 (言語別) / 絵文字, `main_by_char` 逆引き, エコー統合の正準 ID | `p/index.html:1011-1024, 1257-1262`, `t/index.html:459-492`, `c/index.html`, `ranking-table.js:683-711`, `bracket_app.js:87-101`, `js/vote.js:457-472` |
| `js/geo.js` | 行政区分コード → 名前 / 並び順 / グループ (§4.6) | `pref/index.html:119-126` と `priority/index.html:201-207` の 47 都道府県, `seed_data.js:101-106 REGION_GROUP_DEFS`, `seed_app.js:144-145` |
| `js/tags.js` | 大会タグ (休日/実質平日/平日/プレ/制限/下位クラス/身内/特殊ルール/再開待ち/未完了) の 1 描画関数 + 1 CSS | `t/index.html:562-577`, `events/index.html:325-337`, `sim/index.html:561-570`, `player-detail.js:161-171`, `index.html:1007-1013` (クラス名が `tag-*`/`chip`/`badge` の 3 系統) |
| `js/match.js` | `compactBracketLabel`, `_matchSortKey`, `placementToW2W`, 試合行の描画 | `p/index.html:1574-1844` ≡ `t/index.html:812-947` (約 150 行同一) |
| `js/pager.js` | `setupPaginated` | `p/index.html:1600-1645` ≡ `t/index.html:638-682` (45 行同一) |
| `js/suggest.js` | 候補リストのキー操作・クリック外閉じ・CSS | `sim/index.html:241-265, 76-85` ≡ `priority/index.html:229-251, 44-53` |
| `js/links.js` | `playerLink(uid, name)`, `tournamentLink`, `prefLink` | `t/index.html:510-515` が唯一の実装。`p/`, `events/`, `priority/`, `sim/`, `bracket_app.js:786` は直書き |
| `js/share.js` (拡張) | 既存 + html2canvas 読み込み・PNG 保存・ファイル名規約 | `p/index.html:2644-2707` ≡ `t/index.html:974-1017` |
| `js/players.js` | `players/<uid>.json` の並列取得 (同時 6)・キャッシュ・404 と失敗の区別 | `seed_data.js:166-190`, `seed_app.js:2555`, `bracket_app.js:61-135`, `p/index.html:858-963`, `index.html:749-752 HIST_PATH_PREFIX`, `player-detail.js:62-69` |
| `js/startgg.js` | start.gg GraphQL クライアント 1 本 (トークン・エラー封筒) | `seed_app.js:1214`, `seed_uploader.js:8` |
| `js/csv.js` | パース (PapaParse)・引用・ダウンロード・列名 alias 表 | `seed_uploader.js:127`, `seed_share.js:328, 471, 354-365`, `seed_app.js:1424, 1554, 3409-3411, 3813-3814, 4156`, `bracket_app.js:886`, `priority/index.html:422` |
| `js/urlstate.js` | クエリ ↔ 状態同期 (`popstate` 対応) | `c/index.html:281-311`, `local/ranking.html:602-648`, `news/index.html:154-166`, `events/index.html:384-424` (4 通り) |
| `js/ranking_page.js` | ランキング 4 ページの骨格: `ensureTable/render/setupEvents/getDetailCfg/rowClickHandler/tbody 委譲/refreshOpenTournamentTables`, 得点列定義 | `index.html:633-743, 1031-1233`, `c/ranking.html:372-598`, `local/ranking.html:501-851`, `pref/ranking.html:170-356` (約 350 行 ×4、§2 の 2, 3, 4 の原因) |
| `js/list_page.js` | 一覧 3 ページの骨格 (`assignFixedRanks/currentRankOf/applyFilters/render/setupEvents`、ソート表示) | `c/index.html:167-276`, `pref/index.html:140-215`, `local/index.html:192-292`, `ranking-table.js:573-581` |

seeding 系は別枠で:

- `seed_app.js` (4,339 行、名前空間なし・トップレベル関数約 60) を `── ── ` の見出し単位で分割: skeleton HTML / help / start.gg / master data / manual reorder / CSV spec+work / optimizer panel / report / upcoming picker / bracket issuer。
- `chunkWaveMap/waveLetter/poolLabel` (`seed_app.js:3789-3808` ≡ `seed_share.js:305-323`) は seed_share 側に一本化。
- 再スタート回数と `MODE_DEFAULTS` の三重定義 (`seed_worker.js:38-56`, `seed_optimizer.js:941-1024`, `seed_app.js:2506`) を optimizer に寄せる。
- `seed/index.html` と `seed-upload/index.html` は 1 shell + `SEED_APP_CONFIG` に。

### 3.3 CSS

- `site/css/site.css` (新設): 全ページ共通の chrome (`body`, `.header`, `.controls`, `.method-tabs`, `.status`, `.footer`, `.empty-msg`, `@media 720px`), 詳細パネル (約 230 行 ×3.5 コピー), `.tour-item/.match-row/.v-stats/.pager` (`p/` ≡ `t/` 約 300 行), バッジ/ピル, フォントスタック。`nav.js` が注入している nav CSS もここへ。
- `site/css/docs.css`: 解説 4 ページ + `blog.css` の typography (現状 5 コピー)。
- 色トークン (`#dc2626`, グレー階調, `#16a34a`, `#2563eb`) を `:root` の CSS 変数に。`player-detail.js` の inline `style=` (132-328 の約 12 箇所) はクラスに戻す。
- **英語化で必ず壊れる幅**: `ranking-table.css:38-69` の固定列幅 (大会数→Tournaments, 計測中→Provisional, 直対評→H2H)、`.overseas-badge/.zenichi-badge` の 2 文字パディング、`bracket_app.js:24-31 COLW` の固定列幅、`seed_app.css:392,417` の `content:"順位評価 "`。共通化と同時に `min-width` + 折り返し可に直す。

### 3.4 削るもの

§2 の 8 と、解説ページの inline `.nav` CSS、`seed_app.js:2733 escHtml` (alias)、`js/html.js` の裸 `escapeHtml` グローバル (名前空間化後)。

---

## 4. 多言語・多地域の設計

### 4.1 「地域」と「言語」を分ける

- **地域 (region)** = どのランキングか。データルート・地理単位・暦・"国内" の定義・OAuth/GAS・GA・canonical URL が変わる。**デプロイ単位**。
- **言語 (lang)** = UI 文言と名前表。閲覧者が切替可能。日本版を英語で読む海外選手、北米版を日本語で読む日本のファン、の両方が成立する。
- したがって静的 HTML を言語別にコピーするのではなく、**UI 文言は実行時に辞書から引く**。長文 (解説・ブログ・お知らせ本文) だけ言語別ファイル。

### 4.2 サイト設定 `site/js/config.js` → `window.SPSP.site`

smash_database の `scripts/<Region>/classify.py` が宣言する契約と対になるフロント側の契約。

```
region:        'JP' | 'NA'
langs:         ['ja', 'en'] / defaultLang
timeZone:      'Asia/Tokyo' | 'America/New_York'   (表示用。データの日付は地域 TZ の暦日)
dataRoot:      './' (同一ルート) — 別ホストに置くなら URL
canonical:     { origin, base }                     (OG/JSON-LD/hreflang 生成)
analytics:     { gaId }
auth:          { clientId, gasEndpoint, redirectUri }   ← post_config.js を吸収
geo:           { unitKey: 'prefecture' | 'state', codes: 'geo/jp.json' | 'geo/na.json' }
calendar:      { weekendRealLabel: true/false }     (実質休日/平日の概念を出すか)
homeLabelKey:  'national' (全国) — NA では 'regional' 等
features:      { blog: true, vote: true, seeding: true, prefRanking: true, sim: true }
bracket:       { lbEntryTable: 'jp' | 'na' }         (§4.6)
```

`nav.js:118` のホスト名判定は `features.blog` に置き換える。`callback.html:16` の CSP に GAS オリジンが直書きされている点は、地域ごとに `callback.html` を生成するか、CSP を meta ではなく WING 側ヘッダに移すかのどちらか (§6)。

### 4.3 i18n 層 `site/js/i18n.js` + `site/i18n/{ja,en}.json`

- **言語決定**: `?lang=` > `localStorage` > `navigator.language` > `site.defaultLang`。決まったら `<html lang>` を書き換え、`document.title` も辞書から。
- **API**: `t('ranking.tabs.ensemble')`, `t('player.tour_count', {n})` (ICU 風の `{n, plural, one{...} other{...}}` を `Intl.PluralRules` で最小実装。日本語は複数形なし、英語は必要)。`fmtNumber(n)`, `fmtDate(iso, style)`, `fmtRelDays(d)` は `Intl.NumberFormat/DateTimeFormat/RelativeTimeFormat` を `lang` + `site.timeZone` で。
- **静的 HTML**: `data-i18n="key"` / `data-i18n-attr="placeholder:key,title:key"` を `i18n.apply(root)` で適用。inline テンプレート内は `t()`。
- **辞書の形**: 1 言語 1 JSON、キーはページ名前空間 (`nav.*`, `ranking.*`, `player.*`, `tournament.*`, `events.*`, `sim.*`, `seed.*`, `bracket.*`, `vote.*`, `common.*`)。`en.json` に無いキーは `ja.json` にフォールバックし、`console.warn` で欠落を検出する。`tests/meta` に「ja と en のキー集合が一致する」テスト。
- **文法結合を先に潰す**: `${charName}使いランキング` (`c/ranking.html:495`), `${pref}民ランキング` (`pref/ranking.html:261`), `'Lv'+lv+' は '+conds.join('・')+' の大会のみ集計'` (`sim/index.html:539-542`), `全${一|二|三}` (`ranking-table.js:234-240`), `${n}名/人/回/位/戦` の接尾辞 (73 + 36 箇所) は、辞書化の前に **文全体を 1 キー + パラメータ**にする。`vote.js:624-635` の配列組み立て文もキー 1 つに。
- **文字列を制御に使っている箇所**を先に外す: `logo.js:164`, `p/index.html:1937` (`'試合データはありません'` を含むかで分岐), `callback.js:41-43` (戻り先パスに `'vote'` を含むかでラベル決定), `p/index.html:1591` / `t/index.html:848` (`総当たり|スイスドロー|レート戦` 正規表現 — これは start.gg 由来なのでデータ側の `is_round_robin` 等に)。

### 4.4 文言の 4 分類と扱い

| 分類 | 例 | 扱い |
|---|---|---|
| A. UI chrome | ラベル・タブ・ボタン・tooltip・aria・空状態・エラー | 辞書 (§4.3)。**約 3,000 箇所** (`seed_app.js` 約 820, ランキング系約 1,500, `p/t/sim/priority` 約 500, post/vote/callback 約 130) |
| B. 長文 | `overview/details/math/eval`, `blog/*`, `news.json` 本文, `bracket/index.html:20-52` の注意書き, `seed_app.js:340-369 HELP_TEXT`, 解説の SVG ラベル | **言語別ファイル** (`overview.html` → `overview.ja.html` / `overview.en.html`、`nav.js` が lang で振り分け)。未翻訳は既定言語へフォールバック。北米向けの解説は「翻訳」ではなく北米の事例で書き直す前提 (eval は篝火/スマバト/JJPR が本文の芯) |
| C. データ由来 | 大会名・イベント名・選手名・会場・市 | start.gg の原文のまま。北米データなら自然に英語。**変換しない** |
| D. 形式 (互換性) | CSV ヘッダ alias (`順位/シード/名前/ウェーブ/固定`), CSV に書き出す評価名 (`seed_app.js:1529,1552`), 共有 URL のペイロード | 英語ヘッダを正、日本語は alias として**残す** (既存の作業 CSV が読めなくなるため)。書き出しは lang 依存にしない (機械可読) |

### 4.5 `<head>` / SEO メタ

`<title>`, `description`, OG, JSON-LD, canonical (17 箇所が `tosakazu.github.io/spsp` 直書き) は JS で書き換えても SNS カードには効かない。対応は 2 択:

- **(a) 地域 = デプロイなので、地域の既定言語で静的に持つ**。`site/` の head は日本版 (現状)。北米版は `_overlay_frontend` の延長で、`config.js` の値から head ブロックを差し替える小さな stamp (既に `__SITE_VERSION__` を deploy で置換している型と同じ)。
- **(b) `hreflang` 付きで言語別 URL** (`/en/…`)。ページ数が倍になり、bundler 無しでは管理が重い。

推奨は (a)。`pref/*`, `news/`, `blog/*` に canonical/OG が無い不揃いはこの機会に揃える。

### 4.6 地域モジュール (フロント側)

smash_database の「既定値で代用しない (無ければ止まる)」方針に合わせ、地域ごとに揃えるべき資産を明示する。

| 概念 | 現状 (日本固定) | 北米版で必要なもの |
|---|---|---|
| 地理単位 | 都道府県名 (漢字) が JSON の値・URL キー・グループ定義のすべて (`pref/index.html:119`, `priority/:201`, `seed_data.js:101`, `p/:922,1298`, `t/:579`) | **ISO 3166-2 コード** (`JP-13`, `US-CA`, `CA-ON`) を JSON と URL のキーにし、名前・並び・グループ (南関東/京阪神 ↔ SoCal/Tri-State 等) は `geo/<region>.json` で。日本版 URL `?pref=東京都` は互換リダイレクトが要る |
| "国内" | `overseas.json` = 日本以外。灰色行・国内カウンタ・全一判定・使い手除外・sim の灰色 | 「ホーム地域外 (`foreign`)」に改名し、集合はビルドが地域基準で出す。北米版で「海外」と表示するなら文言だけ |
| 暦 | `is_weekend` / `is_weekend_real` (祝日・お盆・年末年始・実質平日) を UI が 休日/実質平日/平日 として説明。`calc.js:203-205` の `weekendOnly` ゲート | フラグ自体は地域モジュール (smash_database) が出す。フロントは **`calendar.weekendRealLabel`** で「実質」の概念を出すかを切替、文言は辞書 |
| 時刻 | `+09:00` 直書き (`events/:286`, `sim/:422,439`, `seed_data.js:205`), 曜日配列 `['日'…'土']` ×3 | `site.timeZone` + `Intl.DateTimeFormat` |
| キャラ名 | 日本語のみ (`char_emoji.json`, `character_index.json`, `players/*.characters[].name`), `localeCompare('ja')`, ひらがな→カタカナ折り畳み (`vote.js:28-32`) | `chars/{ja,en}.json` (ID → 名前・別名)、並びは `fighter_number.js` (既に言語中立) |
| 直対の敗者側テーブル | `bracket_core.js:158-173 LB_ENTRY_PERM` は篝火/ウメブラ等の実ブラケットから合わせた表。非該当は XOR 推定 (`:182-194`) | 北米主要大会の start.gg 実プールで検証した表を別途用意 (`tests/seeding/fixtures/startgg_pools.json` の北米版) |
| 認証・投稿 | `post_config.js` (client 582, GAS URL, redirect `tosakazu.github.io/spsp/callback.html`), `callback.html:16` CSP, `oauth_state.js:85` `/spsp/` | 北米用 start.gg アプリ + GAS デプロイ + redirect。`config.auth` に集約 |
| サポート導線 | `vote.js:631` の X アカウント DM | `config.support` |
| フォント | `Hiragino Sans / Noto Sans JP / Meiryo` 先頭 | `lang` 別スタック (`:lang(ja)` セレクタで CSS 側切替) |

### 4.7 ビルド出力の契約変更 (フロントでは直せないもの)

出力を変えるので golden 比較の対象。**まず追加 (additive) で入れ、フロント移行後に旧フィールドを来季境界で落とす**。

| # | 出力 | 現状 | 変更 | 産出元 |
|---|---|---|---|---|
| 1 | `players/*.achievements[].label`, `dynamic_badges[].label` | 日本語文 + 絵文字の完成品 (`'🥈 最高 Lv4 到達'`, `'🎖 九龍 Eクラス 4位'`) | `{kind, tier, params:{lv, rank, n, series_id, class_letter}}` を追加、文言はフロント辞書。クラス接尾辞の再パース (`score.py:454-459` の `Bクラス/カジュアル` 正規表現) は既存の `class_letter` (`output.py:752`) を使う | `spsp/score.py:262-534, 604-626` |
| 2 | `peak_ranks.*.when` | `"540日前"` / `"now"` | `days_ago: int` | `spsp/output.py:1307`, `overlay.py:231,238` |
| 3 | `characters[].name`, `character_index.characters[].name`, `char_emoji.json.name` | 日本語名。エコー統合名 4 件を直書き (`char_index.py:37-46`) | `name` を落とし ID のみ + `chars/<lang>.json`。統合は正準 ID で | `spsp/char_usage.py:119`, `char_names_ja.py`, `char_index.py`, `char_vote.py:64` |
| 4 | `country_ja` | 日本語国名 | 落とす (`country` は既にある)。国名表はフロント | `spsp/output.py:172` |
| 5 | `player_prefectures.json`, `tournament_prefectures.json`, `player_subranks.pref.name` | 漢字の県名が値 | ISO 3166-2 コード。名前表はフロント `geo/` | `spsp/cli/build_player_prefectures.py:31`, `build_tournament_prefectures.py:35`, `build_player_subranks.py:101` |
| 6 | `top_tours[].series`, `tournaments.json.series`, `series.json.name` | 日本語名が表示名かつ **結合キー** (`score.py:500 series_buckets[s]`) | 安定した `series_id` を別に持つ | `spsp/output.py:1245`, `build_tournaments_index.py:189`, `build_series_json.py:241` |
| 7 | `is_smapa`, `is_uchi`, `is_special_rules` | 日本固有の分類が第一級のブール | `tags: [...]` 配列に (地域モジュールが埋める) | `spsp/output.py:222,763`, `meta.py:260`, `build_tournaments_index.py:192-208` |
| 8 | `meta.ranking_method_notes`, `overseas.json._comment` | 日本語の説明文をデータに同梱 | 落とすか構造化 | `spsp/overlay.py:792-794`, `build_overseas_json.py:100-107` |
| 9 | `tournaments/*.matches[].global_bracket_label` | 概ね英語だが `総当たり/スイスドロー/レート戦` が混じる | `bracket_type` enum を追加 | `spsp/output.py` (フロントの正規表現分岐 `p/:1591`, `t/:848` を外す) |
| 10 | `meta.generated_at`, `series.json` の日付 | naive JST / `series.json` だけ UTC | オフセット付き ISO、暦日は地域 TZ で統一 | `spsp/output.py:541`, `build_series_json.py:233-246` |

ビルドの地域パラメータ化 (`spsp/paths.py:24-33` の `Japan` 直書き、`build_full.py:627-629` の +09:00 assert、`region_*("Japan")` の全呼び出し、`common.py:30,53` の import 時 `OVERSEAS_UIDS`、`deploy_v4.sh:18` の `$SITE/spsp` と `rsync --delete` の範囲) は本レビューの範囲外だが、**フロントの北米版はこれが無いと動かない**。`spsp/derived.py` の `region_module` フックと `paths.py:28 region_events_root` (未使用) が既にあるので、`--region` を通すのが起点。

### 4.8 テスト方針

- ⓪で `tests/**` の日本語文言 assert (約 640 行) を `data-testid` / 辞書キー / DOM 構造ベースに書き換える。文言そのものは辞書 JSON のスナップショットで守る。
- ①以降、`tests/meta` に (a) ja/en キー集合一致、(b) 各ページの `<script>` 順が `js/README.md` の表と整合、(c) `grep -P '[\x{3040}-\x{30ff}\x{4e00}-\x{9fff}]'` を辞書・言語別ファイル・コメント以外で検出したら fail、の 3 本。
- `en` での jsdom スモーク (index / p / t / seed / bracket) を 1 本ずつ。
- 見た目不変の確認は `/b/<name>/` プレビューで日本版を並べて目視 + `tests/golden` は触らない (フロントは出力に関係しない)。

---

## 5. 段階計画

| 段階 | 内容 | 日本版への影響 | 目安 |
|---|---|---|---|
| ⓪ 準備 | §2 の不具合修正 (1〜4, 9)、dead code 削除、`site_v4` 二重管理の解消 (どちらを正にするか決める)、テストを文言非依存に | 不具合修正分のみ | 小〜中 |
| ① 共通化 | §3.2 のモジュール抽出と `site.css`/`docs.css`、名前空間統一、ランキング 4 ページ・一覧 3 ページ・seed 2 shell の骨格統合、`seed_app.js` 分割 | 見た目不変 (プレビューで確認) | 大。ページ単位で PR を分ける |
| ② 文言抽出 | `config.js`/`i18n.js` 導入、`ja.json` を現行文言で作り、ページ順に `t()` 化 (nav → index/ranking-table/player-detail → p → t → events → c/local/pref → sim → priority → seeding/bracket → post/vote)。文法結合と文字列制御 (§4.3) を先に潰す。`en.json` は北米スタッフと分担 | 見た目不変。`?lang=en` が段階的に育つ | 大 |
| ③ ビルド契約 | §4.7 を追加フィールドで入れ、フロントを新フィールドに移行。旧フィールドの削除と `--region` は来季境界の「4 トグル同時投入」に相乗り | golden で確認 | 中 |
| ④ 北米デプロイ | `config.js` の NA 版、`geo/na.json`、`chars/en.json`、北米用 OAuth/GAS/GA、head stamp、`bracket` の LB 表検証、解説の北米版 | なし | 中 (人の作業が多い) |

①と②はページ単位で交互に進めてよい (同じページを 2 回触らないよう、①で骨格を寄せたページから②に入る)。

---

## 6. 決めていただきたいこと

1. **北米版のホスティングと配信ルート**: 別ドメイン / `spsp.games/na/` / 北米スタッフのインフラ。gh-pages は容量的に相乗り不可 (§1.4)。`dataRoot` と `canonical` の値がこれで決まる。
2. **日本版でも英語 UI を出すか** (言語切替を nav に置くか)。出すなら②の `en.json` は日本版の QA にも使える。
3. **`site/` 直配信の維持**: 北米版は head stamp 等の生成が要るので、日本版も「生成した配信ルート」に揃える (対称・安全) か、日本版だけ直配信を続ける (現状維持・非対称) か。推奨は前者だが「編集 = 即本番」を手放すことになる。
4. **URL キーの変更**: `?pref=東京都` → `?pref=JP-13`, `?series=上野スマコミ` → `series_id`。旧 URL の互換 (JS でリダイレクト) を持つ期間。
5. **解説・ブログの北米版**は翻訳ではなく書き直しか (eval/blog は日本の大会が題材)。誰が書くか。
6. **`build/site_v4` と `site/` のどちらを解説ページの正とするか** (§2-5)。
7. **CSV の互換方針** (§4.4 D): 日本語ヘッダを alias として残す案でよいか。
8. **`callback.html` の CSP** を地域生成にするか WING のヘッダに移すか。

---

## 付録 A. 重複コードの対応表 (抜粋、file:line)

- ランキング骨格: `index.html:633-743, 1031-1233` / `c/ranking.html:372-598` / `local/ranking.html:501-851` / `pref/ranking.html:170-356`
- 詳細パネル CSS: `index.html:185-453` / `c/ranking.html:65-254` / `local/ranking.html:77-316` / `pref/ranking.html:46-103`
- 一覧骨格: `c/index.html:167-276` / `pref/index.html:140-215` / `local/index.html:192-292`
- 共有ボタン markup: `index.html:475-484` / `c/index.html:104-113` / `c/ranking.html:266-275` / `local/ranking.html:328-337` (`pref/*` には無い)
- `p/` ≡ `t/`: `setupPaginated` 1600-1645 ≡ 638-682, `compactBracketLabel` 1574-1595 ≡ 836-850, `_matchSortKey` 1743-1765 ≡ 851-874, `placementToW2W` 1717-1737 ≡ 812-832, html2canvas 2644-2707 ≡ 974-1017, 試合行 1800-1844 ≡ 903-947, CSS 19-336 ≡ 19-335
- Lv はしご: `ranking-table.js:186-201`, `player-detail.js:156-157`, `p/:731-746, 1195-1206`, `t/:534-540`, `sim/:343-353`
- 大会タグ: `t/:562-577`, `events/:325-337`, `sim/:561-570`, `player-detail.js:161-171`, `index.html:1007-1013`
- 候補リスト: `sim/:241-265, 76-85` ≡ `priority/:229-251, 44-53`
- 評価名ラベル `{ensemble:'総合評価', tjpr:'順位評価', bt_gated:'直対評価'}`: `index.html:502-510`, `c/ranking.html:279-281`, `local/ranking.html:356-358`, `pref/ranking.html:115-117`, `seed_app.js:1529, 1586, 2627`
- seeding: wave/pool `seed_app.js:3789-3808` ≡ `seed_share.js:305-323`; CSV 引用 `seed_app.js:4156` ≡ `seed_share.js:471`; 並べ替え idiom `seed_app.js:583, 588, 594, 2749, 3339, 3364`; players 取得 `seed_data.js:166`, `seed_app.js:2555`, `bracket_app.js:61,117`; start.gg client `seed_app.js:1214`, `seed_uploader.js:8`; base64url `seed_share.js:28` ≡ `oauth_state.js:31`
- post 系: `post.html`/`vote.html`/`callback.html` の inline CSS、`post.js:12-17,100-117` ≡ `vote.js:62-68,75-91,641-648`、`reportError` `vote.js` ≡ `callback.js:51-63`
- 解説 typography: `overview.html:15-171`, `details.html:15-98`, `math.html:22-113`, `eval.html:15-106`, `blog/blog.css`

## 付録 B. 日本固有の直書き (抜粋)

- 47 都道府県: `pref/index.html:119-126`, `priority/index.html:201-207`
- 地域グループ: `seed_data.js:101-106` (南関東/京阪神), `seed_app.js:144-145`
- `+09:00`: `events/index.html:286`, `sim/index.html:422, 439`, `seed_data.js:205-207`
- 曜日配列: `p/index.html:990`, `sim/index.html:233-237`, `seed_app.js:2186-2193`
- `toLocaleString('ja-JP')`: `sim/index.html:226-230`; `localeCompare(…,'ja')`: `events/:308-310`, `c/index.html:181,205`, `local/index.html:210`, `vote.js:472`
- `lang="ja"` / `og:locale ja_JP` / canonical `tosakazu.github.io/spsp`: 全ページ (17 箇所)。`spsp.games`: `nav.js:118` のみ
- 全一/全二/全三: `ranking-table.js:234-241`, `p/index.html:1226-1249`
- `country !== 'Japan'` 分岐: `p/index.html:1300`; `'海外'` センチネル: `bracket_app.js:82-84, 172-177`
- ひらがな→カタカナ: `vote.js:28-32`; かな漢字のファイル名ホワイトリスト: `bracket_app.js:885`
- Shift_JIS 向け BOM とテンプレ名 `山田太郎/鈴木花子`: `priority/index.html:375-385`, `seed_app.js:3416`
- サポート導線 (X の DM): `vote.js:631`; LINE 前提の URL 長警告: `bracket_app.js:57`
