# site/js — サイト共通の JS モジュール

bundler は使わない。各モジュールは `(function (global) { … })(window)` の即時関数で、`window.SPSPXxx` に API を置き、
`module.exports` もあるので node のテストからは `require()` できる。ページは `<script src>` を並べて読むだけなので、
**並び順が依存関係の契約**になる。下の表の「先に読むもの」がページ内でそのモジュールより前にあることを
`tests/meta/script_order.test.cjs` が確かめる。

| モジュール | グローバル | 中身 | 先に読むもの |
|---|---|---|---|
| `js/html.js` | `SPSPHtml` | `escapeHtml` | — |
| `js/data.js` | `SPSPData` | JSONL のパース、`fetchJson*` | — |
| `js/player_data.js` | `SPSPPlayerData` | 分割された選手 JSON (players/ + players_current.json + history/) の組み立て | — |
| `js/format.js` | `SPSPFormat` | Lv 接尾辞 (👑/メダル/+)、`lvLabel`、`fmtRank` | — |
| `js/tags.js` | `SPSPTags` | 大会タグ (休日 / 実質平日 / プレ大会 / 制限 / 再開待ち …) の判定と文言。クラス名はページが渡す | — |
| `js/pager.js` | `SPSPPager` | 5 件ずつのページ送り (`setupPaginated`) | — |
| `js/match.js` | `SPSPMatch` | ブラケット表記の短縮、試合の表示順、DE の W2W 換算 | — |
| `js/suggest.js` | `SPSPSuggest` | 検索欄の候補リストのキー操作・外側クリックで閉じる | — |
| `js/list_page.js` | `SPSPListPage` | 一覧ページの並べ替え見出し・検索の配線 | — |
| `js/fighter_number.js` | `FIGHTER_NUMBER` | 公式ファイター番号 (並び順) | — |
| `js/links.js` (選手ページは `p/?d=<discriminator>` が既定、表を読む前や表に無い選手は `p/?uid=`。表 `data/discriminators.json` は初回の playerHref で非同期に読み、document 内の `?uid=` を書き換える) | `SPSPLinks` | サイト内リンクの URL と `<a>` の組み立て (p/?uid= / t/?id= / 各ランキング) | — |
| `../region/config.js` (= `regions/<REGION>/config.js`) | `SPSP.site` (`SPSPSite`) | サイト設定 (地域・言語・配信先・GA・機能の有無)。地域ごとに `site/regions/<REGION>/` (契約は `site/regions/README.md`) | — |
| `../i18n/ja.js` | `SPSP_I18N.ja` | UI 文言の辞書 (キー → 日本語)。言語ごとに 1 ファイル、キー集合は全言語で同じ | — |
| `../region/i18n.js` (= `regions/<REGION>/i18n.js`) | `SPSP_I18N_REGION.<REGION>` | 地域で言い方が変わるキーの上書き (言語ごと、言語辞書にあるキーだけ) | `i18n/<lang>.js` |
| `js/i18n.js` | `SPSPI18n` (`SPSP.i18n`) | 辞書引き `t(key, params)`、`data-i18n` の適用、言語の決定 (?lang > localStorage > navigator) | `region/config.js`, `i18n/ja.js`, `region/i18n.js` |
| `../ranking-table.js` | `SPSPRankingTable` | ランキング表コンポーネント (列・並べ替え・絞り込み・無限スクロール) | `html.js`, `format.js`, `links.js` |
| `../player-detail.js` | `SPSPDetail` | 展開行 (大会別 / 直接対決) の描画と選手 JSON の取得 | `html.js`, `format.js`, `tags.js`, `player_data.js` |
| `js/ranking_page.js` | `SPSPRankingPage` | ランキング表ページ 4 本の骨格 (表の生成・配線・行の展開・master 読み込み・ローカル順位) | `data.js`, `ranking-table.js`, `player-detail.js` |
| `../share.js` | `SPSPShare` | 共有ボタン、画像で保存 (html2canvas) | — |
| `../logo.js` | `SPSPLogo` | ロゴとローディング演出 | — |
| `../nav.js` | (`SPSPTrackPage`) | ナビゲーションの挿入、GA、お知らせ。`logo.js` があれば使う。文言は辞書、GA ID とブログの有無は `region/config.js` | `region/config.js`, `i18n/ja.js`, `region/i18n.js`, `i18n.js` |
| `js/post_config.js` `js/oauth_state.js` `js/auth.js` `js/post.js` `js/vote.js` `js/callback.js` | `SpspAuth` `SpspOAuthState` … | 投稿・キャラ投票・OAuth | `vote.js` は `player_data.js`, `fighter_number.js` |

## 名前空間

各モジュールは `window.SPSP.<Name>` にも載る (`SPSP.Html` / `SPSP.Data` / `SPSP.PlayerData` / `SPSP.Format` / `SPSP.Tags` / `SPSP.Pager` /
`SPSP.Match` / `SPSP.Suggest` / `SPSP.ListPage` / `SPSP.RankingPage` / `SPSP.Links` / `SPSP.RankingTable` / `SPSP.Detail` / `SPSP.Share` /
`SPSP.Logo` / `SPSP.Calc` / `SPSP.SeedData` / `SPSP.SeedShare` / `SPSP.SeedOptimizer` / `SPSP.SmashSeed` / `SPSP.BracketCore` /
`SPSP.Auth` / `SPSP.OAuthState` / `SPSP.site` / `SPSP.i18n`)。旧来のグローバル名 (`SPSPHtml` など) は alias として残している。
新しいコードは `SPSP.<Name>` を使い、旧名は移行が終わったら消す。

## 決まりごと

- 新しい共通処理は `site/js/` に置き、同じ型 (即時関数 + `window.SPSPXxx` + `module.exports`) で書く。
- 依存を増やしたら上の表と `tests/meta/script_order.test.cjs` の表を直す。
- 見た目を変えないリファクタは `tests/frontend/compare_with_ref.sh <ref>` で前後の DOM を比べる。CSS の構成を変えるときは `--computed` も (`tests/frontend/README.md`)。
- ページ固有のコードは `src/pages/<id>.js` (先頭の `import '…'` が読み込み順 = `tests/meta/script_order.test.cjs` が表と照合。`npm run build` が順に結合して `dist/assets/<id>.js` にする)。HTML に残る `<script src>` は `region/config.js` → `i18n/<lang>.js` → `region/i18n.js` → `assets/<id>.js` だけ。
- 共通モジュールは ES module (`export default api` + 名前付き export)。他モジュールは **import で使う** (グローバルを参照しない)。`window.SPSPXxx` / `window.SPSP.Xxx` は公開面 (console・外部) として置いているだけ。テストでソースを vm に流すときは `tests/helpers/built.cjs` の `built()` (import をグローバルからの受け取りに変えた古典 script の形)。
- 型: `npm run typecheck` (tsc)。`// @ts-check` を付けたファイルが検査される (グローバルの型は `types/spsp.d.ts`)。新しく書くものは `.ts` で (ビルドが esbuild で変換する)。
- UI 文言は `site/i18n/ja.js` に置き `i18n('key', {param})` (= `SPSPI18n.t`) か `data-i18n` で引く。整合は `tests/meta/i18n.test.cjs`。
- 言語が決まると `<html lang>` に入る。言語で変わる CSS は共通 CSS に `html[lang="en"] .x { … }`、地域で変わる CSS は `region/site.css` (`site/regions/README.md`)。
- 引く順は 地域の上書き (`region/i18n.js`、その言語) → 言語辞書 → 既定言語。地域の上書きは言語辞書にあるキーだけ (テストで確認)。機能の有無は辞書でなく `config.js` の `features` で切る。
  文法上つながる文は文全体を 1 キーに。CSV の列名など機械可読なものは辞書に出さない。進み具合は docs/refactor/05_frontend_common.md ②。
- ページごとの CSS のクラス名 (例: 大会タグの `chip wk` / `tag tag-wk` / `badge wk` / `tag-wk`) はまだ統一していない。
  共通モジュールはクラス名を引数で受ける。全ページで同一だった CSS ルールは `site/css/{site,detail,player,docs}.css` に移してある
  (`tools/frontend/css_extract.cjs`)。ページ固有の上書きは各ページの `<style>` に残る。
