# site/regions/ — 地域ごとに持つもの

地域 (どのランキングか) はデプロイ単位。地域で違うものは全部ここに置き、それ以外 (`site/` の他の全部) は共通コード。
smash_database の `scripts/<Region>/` (地域モジュール) と同じ考え方で、**既定値で代用しない**: 地域ディレクトリは
どれも同じファイル集合を持ち、足りなければテストが落ちる (`tests/meta/regions.test.cjs`)。

```
site/
  region -> regions/JP        配信する地域 (symlink)。ページは region/config.js, region/i18n.js として読む
  regions/
    JP/                       日本版 (spsp.games / tosakazu.github.io/spsp)
      config.js               サイト設定 (window.SPSP.site): 地域・言語・TZ・配信先・GA・機能の有無・地理単位・暦
                              (都道府県の一覧・地域まとめは設定ではなく data/geo.json = smash_database の地域モジュールが定義。docs/geo_json.md)
      i18n.js                 地域で言い方が変わる文言の上書き (言語ごと。言語辞書 i18n/<lang>.js にあるキーだけ)
      site.css                地域だけに効く CSS (各ページの最後の stylesheet。callback.html は CSP のため読まない。いまは空)
    NA/                       北米版 (同じファイル集合。値が未定のものは TODO)
      config.js
      i18n.js
      site.css
```

## 規則

- **地域ディレクトリ間でファイル集合と `config.js` のキー構造は同じ** (JP が基準)。値だけ違う。
- `config.region` はディレクトリ名。`i18n.js` は `window.SPSP_I18N_REGION.<REGION>` だけを置き、言語の集合は `config.langs` と同じ。
- 地域の上書きは言語辞書にあるキーだけ。共通の文言は `site/i18n/<lang>.js` へ。**機能の有無は文言でなく `config.features` で切る**。
- ページやテストは `region/…` を読む。`regions/<REGION>/` を直接読まない (テストで確認)。
- 共通コードに地域名 (`'JP'`、都道府県名、`+09:00` …) を直書きしない。必要な値は `SPSP.site` から取る。
- `config.langs` の言語ごとに `npm run build` が静的 HTML を出す (既定言語はルート、他は `<lang>/`)。辞書 `site/i18n/<lang>.js` はキー集合が全言語で同じ。
- 地域版の URL は `config.regions` (`{ JP: 'https://spsp.games/jp/', NA: 'https://spsp.games/na/' }`)。nav が他地域へのリンクを出す ('' なら出さない)。
  同じ `site/` を地域ごとに別のパス (`/jp/`, `/na/`) に置く前提で、リンクはすべて相対 (絶対パス `/…` を書かない。`tests/frontend/snapshot_pages.cjs --base /jp/` で検査)。
- GA には全イベントに `ui_lang` (表示言語) と `site_region` (表示地域) が付く (`nav.js`)。GA4 でカスタム ディメンションとして登録する。
- **見た目の調整の置き場**: 言語で変わるもの (英語は文言が長い、フォントスタック) は共通 CSS に `html[lang="en"] .x { … }` で
  (`js/i18n.js` が決まった言語を `<html lang>` に入れる。`:lang(en)` でもよい)。地域で変わるもの (地域ページの列や幅) は `region/site.css`。
  ページごとの `<style>` に言語・地域の分岐を書かない。

## 今後ここに移るもの (docs/frontend_i18n_review.md §4.6)

地理単位の名前表とグループ (`geo.json`: 都道府県 / 州)、キャラ名表 (`chars/<lang>.json`)、直対の敗者側テーブル (bracket の LB 表)、
解説ページの地域版 (`overview` / `details` / `math` / `eval` は翻訳でなく地域の事例で書く)、`news.json`、認証の設定 (`config.auth`)。
ブログは日本版だけ (`features.blog`)。

## 配信

- 日本版: `site/` を直配信 (spsp.games) / gh-pages へ rsync。`region` symlink は rsync -L と `_overlay_frontend` の copytree で実体化される。
- 北米版: 同じ `site/` を配り、`region/` を `regions/NA/` の中身に置き換える (ビルドの `--frontend-region NA`。③ ビルド契約と一緒に入れる)。
- 手元で地域を切り替えて確認するとき: `tests/frontend/snapshot_pages.cjs --region NA`、または `ln -sfn regions/NA site/region` (commit しない)。
- Windows で checkout すると symlink が「`regions/JP`」と書かれたファイルになる (`core.symlinks=false`)。
  地域ディレクトリだけ編集するなら支障ない。ページを開くなら `git config core.symlinks true` で checkout し直す。

## GitHub での分担

- 地域ディレクトリは地域の担当者が持つ (CODEOWNERS で `site/regions/NA/ @<北米担当>`)。共通コードの変更は PR + テスト。
- 共通コードを変えると全地域に効く。地域固有の挙動が要るときは `config` に項目を足し (全地域に同じキーを足す)、コードは `SPSP.site` で分岐する。
