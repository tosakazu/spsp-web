# spsp-web — SPSP ランキングサイトのフロントエンド

[spsp.games](https://spsp.games) / [tosakazu.github.io/spsp](https://tosakazu.github.io/spsp) の HTML / JS / CSS と、
投稿機能 (キャラ投票) の Google Apps Script。ランキングの計算・データ取得・デプロイは別リポジトリ **spsp_scripts** (ビルド側) にある。
2026-09-14 に spsp_scripts から切り出し、2026-09-28 に公開リポジトリにした (履歴は 1 コミットにまとめた)。

**For North America contributors:** the site is one shared code base; everything that differs by region lives in
`site/regions/<REGION>/` (config, wording overrides, region-only CSS). See `site/regions/README.md` for the contract and
`docs/frontend_i18n_review.md` for the design. Run `npm ci && npm test` before opening a pull request.

## 置き場

```
src/pages/<id>.js     ページごとのコード (先頭の import が読み込み順。ビルドが dist/assets/<id>.js に束ねる)
types/                グローバルの型 (window.SPSP …)
site/                 HTML / CSS / 共通モジュール (js/) / 辞書 / 地域。npm run build が dist/ を作る (site/ を直接開いても動かない)
  regions/<REGION>/   地域ごとの設定・文言の上書き・CSS。region -> regions/JP は配信する地域 (symlink)
  i18n/<lang>.js      UI 文言の辞書 (言語ごと)
  js/                 共通モジュール (一覧と読み込み順は site/js/README.md)
  css/                共通 CSS
  seeding/, bracket/  シードツール・トーナメントプレビュー
  blog/               ブログ (日本版だけ。spsp.games にだけ配る)
gas/                  投稿機能の Apps Script (デプロイ手順は docs/DEPLOY.md。secrets.gs は git に入れない)
tests/                node --test (meta / post / seeding)、jsdom のスナップショット比較 (frontend/)、sim、split
tools/frontend/       CSS 共通化・文言抽出の補助スクリプト
docs/                 設計・引き継ぎ
```

## ビルド側との契約

ビルド (spsp_scripts) はこのリポジトリの checkout の `site/` を配信ルートとして使い、生成物を **`site/` の中に書く**
(`.gitignore` で無視): `players/` `tournaments/` `history/` (symlink)、`players_current.json` `meta.json` `latest_*.jsonl`、`data/*.json`。
フロントが読む JSON の形はビルドが決める (`docs/frontend_i18n_review.md` §4.7 に変更予定の一覧)。
spsp_scripts 側では `site` がこの checkout への symlink (`docs/deploy_and_environments.md`)。spsp.games はこの `site/` を直配信するので
**main への commit = 即本番**。gh-pages はビルドが 3 時間おきに rsync する。

## ビルド (配信ディレクトリ dist/)

```
npm run build          # site/ → dist/ (日本版)。dist/ が配信ルート。npm run build:na で北米版を dist-na/ に
```

`tools/build/build_site.mjs` が静的ファイルを写し、ページの script (`src/pages/<id>.js` の import の順に esbuild で変換・結合 → `dist/assets/<id>.js`) を作り、HTML を **言語ごとに** 生成する (既定言語 ja はルート = 今までの URL、英語は `dist/en/…` に同じ木)。
`data-i18n` の文言はビルド時に辞書で埋まり (検索エンジンに英語ページとして見える)、`<html lang data-root data-lang-root>` と
canonical / hreflang / og:url を書く。JS が描く文言は今までどおり実行時に辞書から。解説・ブログ・投稿系は日本語だけなので、
英語の木では同じ URL に置いたうえで noindex。`site/` を直接開いても動く (js/html.js が script の src からルートを推定する)。
ビルドの生成物 (players/ data/ meta.json …) は dist/ に書かれ、`npm run build` は消さない。

## テスト

```
npm ci
npm test                 # 静的整合・DOM (jsdom)・シードツール・投稿機能・ビルド (CI と同じ)
npm run test:sim         # sim/calc.js を参照値 (tests/sim/ref.json、ビルド側 tests/sim/gen_ref.py が作る) と照合
npm run test:split       # 分割 JSON の組み立て (js/player_data.js) を fixture と照合
npm run typecheck        # tsc (// @ts-check のファイルと .ts)
SPSP_BUILD_REPO=../spsp-ranking npm test   # ビルド側の定数との突き合わせ (無ければ skip)
tests/frontend/compare_with_ref.sh main --computed   # 見た目不変の確認 (ビルド出力が手元にある環境だけ。tests/frontend/README.md)
tests/frontend/compare_with_ref.sh HEAD --computed --after-site dist   # dist/ (ja) が site/ と同じ DOM か
node tests/frontend/snapshot_pages.cjs --data <deployed> --out /tmp/en --site dist --lang en --only '^index$'   # 英語の木を開く
```

## 規則

- 共通コードに地域名・都道府県名・タイムゾーンを直書きしない (`SPSP.site` から取る)。UI 文言は辞書 (`site/i18n/`) へ。
- 地域ディレクトリは地域の担当者が持つ (`site/regions/README.md`)。共通コードの変更は PR + tests。
- `site/` の見た目を変えないリファクタは `tests/frontend/compare_with_ref.sh` で差分 0 を確認してから。

## 開発に参加する人へ
- main へは PR 経由で入れる (ブランチ保護。所有者の承認が要る)。main に入ると GitHub Actions が spsp.games にデプロイする。
- デプロイ用の鍵 (Cloudflare のトークン) は environment "production" にだけあり、main 以外のブランチや PR のワークフローからは使えない。
- 鍵・トークン・個人情報はコミットしない (secret scanning と push protection を有効にしてある)。ローカルの鍵は `~/.config/…` などリポジトリの外に置く。
