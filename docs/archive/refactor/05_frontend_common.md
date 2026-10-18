# フロントの共通化 (見た目を変えないリファクタ) — 2026-09-13

`docs/frontend_i18n_review.md` §3 (共通化の設計) の ① を、ブランチ `refactor/frontend` (worktree `~/spsp-frontend`) で進めた記録。
本番 (`site/` = spsp.games 直配信、gh-pages) には反映していない。

## 何をどこへ移したか

| 新モジュール (`site/js/`) | 吸い上げ元 (コピーがあった場所) |
|---|---|
| `format.js` — Lv 接尾辞 (👑/メダル/+) `lvSuffix` / `lvLabel` / `fmtRank` | `ranking-table.js`, `player-detail.js`, `p/` (2 か所), `t/`, `sim/` |
| `pager.js` — 5 件ずつのページ送り `setupPaginated` | `p/` ≡ `t/` |
| `match.js` — `compactBracketLabel` / `matchSortKey` / `sortMatches` / `placementToW2W` | `p/` ≡ `t/` |
| `share.js` (拡張) — html2canvas の読み込み・`capturePng`・保存ボタン `setupSaveButton` | `p/` ≡ `t/` |
| `ranking_page.js` — ランキング表ページの骨格 (列・表の生成・検索とタブの配線・行の展開・展開行内のクリック・master 読み込み・ローカル順位の再付番) | `index.html`, `c/ranking.html`, `local/ranking.html`, `pref/ranking.html` (約 150 行 × 4) |
| `list_page.js` — 並べ替え見出し・検索の配線 | `c/index.html`, `pref/index.html`, `local/index.html`, `events/index.html` |
| `suggest.js` — 候補リストのキー操作・外側クリックで閉じる | `sim/` ≡ `priority/` |
| `tags.js` — 大会タグの判定と文言 (休日 / 実質休日 / 実質平日 / プレ大会 / 制限 / 下位クラス / 身内 / 特殊ルール / 小規模 / 再開待ち / 未完了) | `t/`, `events/`, `sim/`, `player-detail.js` |

差し引き: HTML/JS 約 1,300 行減、共通モジュール約 700 行増 (コミット 3b2c527 → bb9132a)。

挙動が変わった点は 1 つだけ: `c/ranking.html` と `pref/ranking.html` の展開行で「さらに表示」(大会別の表の続き) が
効くようになった (以前はこの 2 ページだけクリック処理が無かった。`index` / `local` と同じ処理に寄せた結果)。

## 変えていないもの (意図)

- **DOM とクラス名**: ページごとに違う CSS のクラス名 (大会タグの `chip wk` / `tag tag-wk` / `badge wk` / `tag-wk`、
  小灰列の `class="score-cell"` / `style="color:#9ca3af"`) は、共通モジュールが引数で受ける形にして DOM を変えていない。
- **CSS**: inline `<style>` はそのまま。4 ランキングページの詳細パネル CSS は 56 セレクタ中 54 が同一だが、
  `@media` の構成と順序が違うので、連結テキストが同じになる形で共通ファイルへ移すのは別作業にした (§3.3 は未着手)。
- `seed_app.js` の分割、`js/config.js` / `i18n.js` (② 文言抽出) は未着手。

## 検証のしかた

`tests/frontend/snapshot_pages.cjs` で実ページを jsdom に描かせ、操作 (タブ切替・行の展開・検索・ページ送り・
フィルタ) のたびに DOM / CSS テキスト / Chart.js 設定を書き出し、`git archive` した基準版と作業ツリーを同じデータ・
同じ固定時刻で比べる (`tests/frontend/compare_with_ref.sh <ref>`)。26 シナリオ・約 190 時点。
各コミットで差分 0 を確認した。同じ版を 2 回走らせた結果も一致 (決定性)。
`node --test` (585 → 608 本、`tests/meta/script_order.test.cjs` を追加: `<script>` の並びが `site/js/README.md` の
依存表と矛盾しないか) も全部通る。

ブラウザでの目視は ConoHa の nproc 上限で headless Chromium が使えないため未実施。代わりにプレビューを
`<ConoHa WING の初期ドメイン>/b/frontend/` に置いた (`~/spsp-verify/preview_frontend.sh`。
worktree の `site/` の写し + データは gh-pages の checkout へ symlink。ビルド不要、`site/` を直した後に再実行)。

## 同日の続き (コミット aea520f 以降)

- **CSS** (§3.3): 全ページで同一のルールだけを `site/css/{site,detail,player,docs}.css` に抽出 (`tools/frontend/css_extract.cjs`)。
  site.css = ランキング 4 + 一覧 3 + events の chrome (12 ルール)、detail.css = ランキング 4 の詳細パネル (58)、
  player.css = p ≡ t (57)、docs.css = 解説 4 (31)。ページ固有の上書きは `<style>` に残る。
  検証はスナップショットに足した **自前の cascade 比較** (`--computed`): ルールを文書順に取り出し、各セレクタの要素集合を
  `querySelectorAll` で求め、(important, 詳細度, 出現順) で勝つ宣言を要素 × プロパティごとに決めてハッシュにする。
  @media は変種ごと (base / 各クエリを展開)。:hover 等の動的擬似クラスと擬似要素は外して要素を求め、名前をキーに含める。
  30 シナリオで DOM も cascade も一致。jsdom の `getComputedStyle` は対応プロパティが限られるので使っていない。
- **`js/links.js`**: p/?uid= / t/?id= / 各ランキングへの URL と `<a>` の組み立てを 1 か所に (ranking-table.js、p/ t/ events/ c/ pref/ sim/ priority/)。
  属性の順が変わる箇所があるのでスナップショットは属性を名前順に正規化して比べる。
- **`seed_app.js` の分割**: `site/seeding/app/{10_skeleton … 99_bootstrap}.js` の 12 ファイル (見出し単位)。読み込み時に
  後方の関数を呼ぶ bootstrap を最後にした以外は元の順。`seed/` と `seed-upload/` の shell 統合は見送り (head の
  title / description / canonical が別なので 1 ファイルにはできない。JS 部分は元から共通)。
- **名前空間**: 全モジュールを `window.SPSP.<Name>` にも載せた (旧名は alias)。`site/js/README.md`。
- **② 文言抽出の土台**: `js/config.js` (サイト設定、§4.2)、`js/i18n.js` (`t()` / `data-i18n` / 言語の決定、§4.3)、
  `site/i18n/ja.js` (辞書、fetch ではなく script で読む: 描画前に同期で引くため)。nav.js を辞書化 (28 キー)、
  GA ID とブログの有無は config から。他のページはこれから (§5 の順: index / ranking-table / player-detail → p → t …)。

## ② 文言抽出 (2026-09-14)

辞書は `site/i18n/ja.js` (約 675 キー)。引き方は 2 通り: 静的 HTML は `data-i18n="key"` / `data-i18n-attr="attr:key"` を付けて
ページ先頭で `SPSPI18n.apply(document)` (子要素があれば最初のテキストノードだけ、前後の空白は保持)、
JS は `i18n('key', {param})`。文法上つながる文は文全体を 1 キーにして `{param}` で埋めた (§4.3)。
整合は `tests/meta/i18n.test.cjs` (使うキーが辞書にある / 辞書のキーが使われている / 言語間でキー集合が一致 / t() の動作)。

| 範囲 | やり方 | 状態 |
|---|---|---|
| nav.js、index、ranking-table.js、player-detail.js、ranking_page.js、tags.js | 手で意味のあるキー | 済 |
| 使い手 / ローカル / 都道府県ランキング、一覧 3、events、news | 同上 | 済 |
| p/、t/、sim/、priority/ | 同上 (p/ の出場大会タグ 3 か所は 1 つの helper に) | 済 |
| seeding/app/*.js、bracket_app.js、vote.js、post.js、callback.js の **'…' リテラル** | `tools/frontend/i18n_extract_literals.py` で機械的に (キーは `seed.core.s3` 型、値は元の文字列そのまま) | 済 (161 か所) |
| 同ファイルの **テンプレートリテラル** (HTML と式が混ざる) と `bracket/index.html` `vote.html` `post.html` `callback.html` の静的文 | 文ごとに `{param}` 化が要る | 未 |
| CSV の列名 alias・テンプレの記入例 (§4.4 D)、`seed_share.js` / `seed_data.js` (CSV 形式)、`seed_optimizer.js` (Worker 内、SPSPI18n 無し)、`bracket_core.js` (node の require 対象) | 機械可読なので辞書に出さない (意図) | 対象外 |

機械抽出した文字列は表示にしか使われないことを `=== i18n(` 等の検索で確認した (列名 alias に当たった 9 件は戻した)。
テストは `tests/seeding/helpers/seed_app_src.cjs` が `i18n('key')` を辞書の値に戻した形のソースを渡すので、
「この文言がこの経路にある」という静的な検査はそのまま通る。

表示は不変 (各バッチでスナップショット 30 シナリオ一致)。ただし seeding / bracket / vote の JS で描く文言は
スナップショットに出ないので、そこは「値を 1 文字も変えずに機械的に移した」ことが根拠。

## 辞書の層 (2026-09-14 決定・実装)

北米版で言い方が変わる文言 (「全国」「都道府県別」「海外」…) をどう持つか。**言語辞書 1 枚 + 地域の小さな上書き** にした。

- 言語辞書 `site/i18n/<lang>.js` (`SPSP_I18N[lang]`): 全文言。キー集合は全言語で同じ (テストで確認)。
- 地域の上書き `site/regions/<REGION>/i18n.js` (`SPSP_I18N_REGION[REGION][lang]`): 地域で変わるキーだけ (数十の想定)。
  言語辞書に無いキーは置けない (テスト)。日本版はいまは空。地域は `regions/<REGION>/config.js` の `region`。
- 引く順: 地域の上書き (その言語) → 言語 → 既定言語 (`js/i18n.js`)。読み込み順: `region/config.js` → `i18n/ja.js` → `region/i18n.js` → `js/i18n.js`。
- 機能の有無 (ブログ、都道府県ページ…) は辞書でなく `config.features` で切る。データ側の違い (都道府県一覧、`overseas.json`、暦) は ③ ビルド契約の範囲。

北米版で丸ごと別ファイルにしない理由: 共通文言の修正が 2 か所になり、差分の把握が難しい。上書きなら「地域で違う文言の一覧」が
そのままファイルになる。逆に地域ごとに文構造が変わるほど違う場合は、そのキーを地域上書きに置く (文全体が 1 キーなので収まる)。

## 地域ディレクトリ (2026-09-14)

地域で違うものを `site/regions/<REGION>/` に集め、`site/region` (symlink) を配信する地域に向ける。ページは `region/config.js` と
`region/i18n.js` を読む。契約 (同じファイル集合・同じ config キー構造・上書きは辞書にあるキーだけ・`regions/` 直読み禁止・symlink の先) は
`site/regions/README.md` と `tests/meta/regions.test.cjs`。`NA/` は同じ形の雛形 (配信先・GA・OAuth は TODO)。
smash_database の `scripts/<Region>/` と同じ「既定値で代用しない」方針。GitHub では地域ディレクトリを地域の担当者が持ち (CODEOWNERS)、
共通コードは PR + テスト。`site/` 直配信は symlink 越しにそのまま。スナップショット harness は `--region NA` で北米の設定で走らせられる。

## main のシードツール改修の取り込み (2026-09-14 夕方)

main に別セッションのシードツール改修 4 コミット (適用時に被り回避を自動実行 (既定 ON)・パネル設定のブラウザ保存・
「設定を既定に戻す」・同シリーズ再戦回避の既定 ON と自動判定) が入り、こちらは `seed_app.js` を分割済みなので modify/delete 衝突になる。
取り込み方: 分割ファイルを `seed/index.html` の順に連結したものを ours、分岐点の `seed_app.js` を base、main の `seed_app.js` を theirs にして
`git merge-file`。分割時に末尾へ移した起動ブロック (`// ── Seed page bootstrap ──` 〜 `prefillShiftLimits`) を base / theirs でも末尾に
並べ替えてから当てる (並べ替えないと diff3 が移動を編集と誤認する)。衝突 6 か所は 文言の辞書化 (ours) と main の追加 (theirs) の重なりで、
手で合成。連結を先頭行 (`// seeding/app/NN_x.js — `) で分割して戻す。新しい日本語リテラルは `tools/frontend/i18n_extract_literals.py` で辞書へ、
main で消えた分岐の文言 (`seed.rematch.s11/s12`) は辞書から落とし、main で変わったヘルプ文 (`seed.help.s16/s17`) は辞書の値を追随。
確認: シードページのスナップショットが main と一致 (`compare_with_ref.sh main --only '^seed'`)、他ページは取り込み前と一致、npm test 473 pass。
main の設定保存の節は `99_bootstrap.js` の末尾 (SHIFT_LIMIT_IDS を使うので起動ブロックより後)。

## 選手 URL の discriminator 化・GA の言語/地域・地域版の URL (2026-09-14 夜)

- **選手ページの URL は `p/?d=<start.gg discriminator>` が既定**。`p/?uid=<uid>` と `p/#<uid>` は引き続き通り、開いた後にアドレスバーを
  `?d=` に書き換える (history.replaceState)。`?d=` → uid の解決と、リンクの uid → discriminator は `data/discriminators.json`
  (ビルドが nightly で生成、約 400 KB、gzip 配信) を `js/links.js` が初回の `playerHref` で非同期に読んで行う。読む前に描いたリンクは
  読めた時点で document 内を書き換え、以後の描画は表を同期で引く。表が無い環境では uid のまま動く。呼び出し側 (21 か所) は無変更。
  GA の仮想パスは `/p/uid…` のまま (集計の連続性)。ランキングの検索欄は discriminator の前方一致 (3 文字以上の 16 進) でも当たる。
  優先枠作成ページは以前から discriminator で検索できる。sim の検索は名前 / uid のまま。
- **GA**: 全イベントに `ui_lang` (表示言語 = SPSPI18n.lang) と `site_region` (表示地域 = config.region) を付ける (`gtag('config', …)` の
  パラメータ)。GA4 でイベント スコープのカスタム ディメンションとして 2 つ登録が要る。言語と地域は別の軸。
- **地域版の URL**: 同じ `site/` を `/jp/` `/na/` のような別パスに置く前提。リンクはすべて相対で、`snapshot_pages.cjs --base /jp/` で
  接頭辞の外への要求が無いことを検査 (8 シナリオで 0 件)。`config.regions` に他地域の URL を入れると nav の右端に切替 (日本版 / 北米版) が出る
  ('' なら出ない。いまは両方 '' で未定)。canonical / OG の絶対 URL は ④ の head stamp で地域ごとに出す。
  ホスティング側 (spsp.games の front controller に `/jp/` `/na/` の経路と `/` → `/jp/` の 301) は切替時の作業で、まだ入れていない。
- 検証: スナップショットの差分は「`?uid=` → `?d=`」「検索欄の placeholder」「nav の CSS が増えた分」だけ (照合スクリプトで確認)、
  `?d=` で開いた選手ページの DOM は `?uid=` で開いたものと一致、不明な discriminator は「見つかりません」。npm test 631 pass。

## B: ビルドと言語別の静的 HTML (2026-09-14 夜〜)

決定 (docs/frontend_stack_review.md): 目標は B (TypeScript + esbuild の MPA、フレームワーク無し)。C (Astro) の利点のうち
「検索エンジンに英語ページとして見せる」だけは要るので、ビルドで言語別の静的 HTML を出す。

- **2 つのルート** (`js/html.js`): データ・資産は `SPSP.root`、ページ間リンクは `SPSP.langRoot`。英語の木 (`dist/en/…`) はサイトのルートより
  1 段深いので分けた。ページ・モジュールの `'../'` 直書き 100 か所超を置換。`player-detail` は `pathPrefix` (リンク) と `dataPrefix` (JSON) に分離。
- **辞書**: `en.js` を全 693 キー書いた (ja と同じキー集合、`{param}` も同じ。テストで保証)。ページの title / description / OG を辞書化 (61 キー)。
  英語の序数 (1st / 2nd) のため `{n, selectordinal, one{{n}st} …}` を `js/i18n.js` に追加し、「{n}位」のような接尾辞の連結を文全体のキーに直した。
- **言語の決め方**: 生成済みページは `<html lang>` (ビルドが書く)。`site/` を直接開いたページは、辞書が読み込まれている言語からだけ選ぶ
  (既定言語の辞書しか読まないので既定言語になる)。nav に言語の切替 (同じページの別言語版へ)。
- **ビルド** `tools/build/build_site.mjs` (`npm run build`): 静的ファイルを `dist/` に写し (生成物は触らない)、HTML を言語ごとに jsdom で生成
  (data-i18n をビルド時に埋める、資産参照の補正、`<html lang data-root data-lang-root>`、canonical / hreflang / og:url、日本語だけのページは
  英語の木で noindex)、sitemap.xml。決定的 (2 回目は何も書かない)。検査は `tests/meta/build.test.cjs` (両方の木の全参照が実在する等)。
- **検証**: `compare_with_ref.sh HEAD --computed --ignore .nav-lang` (言語切替の UI だけ無視して他は不変)、`--after-site dist` で dist の ja が
  site/ と同じ DOM、`--lang en` で英語の木が開く。harness は要素の鍵を通し番号から DOM のパスに変え、要素が 1 つ増えても他の要素の
  cascade が比べられるようにした。
- **ページの script を `src/pages/<id>.js` に** (2026-09-14 深夜): インライン `<script>` 5,200 行と共通モジュールの `<script src>` の並びを
  `tools/build/extract_pages.py` で機械的に移した。先頭の `import '…'` が読み込み順 (以前の `<script>` の並び)、残りがページのコード。
  HTML に残るのは データ script 3 本 (region/config.js → i18n/<lang>.js → region/i18n.js) と `assets/<id>.js` だけ。
  ビルドが import の順に esbuild で変換 (TS → JS) して結合し `dist/assets/<id>.js` を書く。ES module として束ねないのは、共通モジュールが
  グローバルを定義する古典 script で、seeding/app/* はトップレベルの const を同じ字句環境で共有するから。ESM 化はファイル単位で後追い。
  `site/` を直接開いても動かなくなった (dist を配信する)。テストは `tests/helpers/pages.cjs` で src/pages を読む (読み込み順の表の照合も import に対して)。
- **TypeScript**: `tsconfig.json` (allowJs、`// @ts-check` のファイルだけ検査)、`types/spsp.d.ts` (window.SPSP 等のグローバルの型)、
  `npm run typecheck`。まず js/html.js・format.js・links.js に付けた (JSDoc で型)。新しいファイルは .ts で書ける (esbuild が変換)。
- **本物の束ねと ES module 化** (2026-09-15): ページの束ねを結合から esbuild の `bundle: true` (IIFE) に変えた (seed / seed-upload だけ結合のまま:
  seeding/app/* の共有 scope のため。CONCAT_PAGES)。共通モジュール 19 本 (site/js/*、logo、ranking-table、player-detail) を
  `tools/build/to_esm.py` で ES module に: IIFE の殻を外し `export default api` / `export { … }`。グローバル (window.SPSPXxx) は移行中の互換で残す。
  sim/calc.js は UMD (module.exports があると window に置かない) なので `src/pages/sim.js` が default import で受けて window.SPSPCalc に置く。
  テストは `tests/helpers/built.cjs` の `built(rel)` で「古典 script の形」(export を外して IIFE で包む。import があれば esbuild) を vm に流す。
  require(ESM) は namespace を返すので `.default` を取る。表示は不変 (30 シナリオ差分なし)。
- ページのコードは共通モジュールを default import で受ける (`import SPSPLinks from '../../site/js/links.js'`。名前は今までのグローバルと同じなので本文は無変更、依存が import で読める)。副作用 import は nav.js / share.js のようにグローバルに置くだけのものと、他モジュールがグローバル経由で使うもの。
- **シードツールの ES module 化** (2026-09-15): `tools/build/seed_state_module.py` で、他ファイルからも使う可変の状態 19 個を
  `seeding/app/00_state.js` の `S` に集約 (参照は `S.NAME`。文字列・コメント・テンプレートの文字列部分は触らない走査で書き換え)、
  他ファイルから使う関数・定数 70 個に `export`、使う側に `import { … } from './NN_x.js'`。これで seed / seed-upload も esbuild の bundle になり、
  結合方式のページは無くなった (仕組みは CONCAT_PAGES に残してある)。テストは `tests/seeding/helpers/seed_app_src.cjs` が import 行と export 接頭辞を
  外した 1 本の古典 script を渡し、関数を切り出して動かす環境では `S` をグローバル (sandbox / window) そのものに向ける。
- **import で完結** (2026-09-15、`tools/build/imports_everywhere.py`): 他モジュールのグローバル (`window.SPSPLinks`、`global.SPSPI18n`、bare の `SeedData` …) への
  参照をすべて import に置き換えた (ページ 23 本・共通モジュール・シードツール・ブラケット)。残りの古典 script も ES module に
  (seeding/seed_data・seed_share・seed_optimizer、seed-upload/seed_uploader、bracket/bracket_core、sim/calc.js (UMD → export)、nav.js / share.js は API を export)。
  Web Worker は `seeding/seed_worker.js` が `import SeedOptimizer` する ES module になり、ビルドが `dist/assets/seed_worker.js` (古典 script) に束ねる
  (`new Worker(SPSP.root + 'assets/seed_worker.js')`)。
  **`window.SPSPXxx` / `window.SPSP.Xxx` は公開面 (console からの確認・外部からの利用) として残す**が、コードはもう参照しない。
  テストの `tests/helpers/built.cjs` は import を「先に eval したモジュールが置いたグローバルから受ける」形に変えて古典 script にする
  (esbuild で束ねない: テストが差し替えた設定やスタブが見えるように)。node の `require(ESM)` は namespace なので `.default`。
- **② の残りも完了** (2026-09-15): `tools/frontend/i18n_extract_templates.py` がテンプレートリテラルの文字列部分 (HTML のテキスト・title 等の属性) と
  `${ }` の中の '…' を辞書へ (シードツール 12 本と bracket_app で 470 キー)、`tools/frontend/i18n_mark_static.cjs` が静的 HTML の残り
  (bracket/index.html の注意書き、priority、p) に data-i18n を付けた。`${ }` をまたぐ文は断片のキーになっているので、英語で読みにくいものは
  「文全体 1 キー + {param}」に手で直していく (辞書の `.tN` キーがそれ)。en.js は 1,200 キー超。英語のシードツール / プレビューは UI がすべて英語
  (残るのは大会名・選手名・地名のデータ)。
- 残り (B の完了後): 型付けの拡充 (`// @ts-check` の範囲を広げる、ビルド出力 JSON の型を contracts/ から生成)、Vitest への移行は任意 (node:test のままでも困っていない)。

## 英語ページの残りと、表示の ID 化 (2026-09-15)

- シード / ブラケット / 優先枠 / 選手ページのテンプレートリテラルと静的 HTML の日本語を辞書へ (ツール: `tools/frontend/i18n_extract_templates.py`、
  `tools/frontend/i18n_mark_static.cjs`)。en.js の値の `"` は属性の中で壊れるので “ ” に統一。残る日本語はデータ (大会名・市区・県・選手名)。
- **地域まとめ** (南関東 / 京阪神) は日本固有なので、いったん `regions/<REGION>/config.js` に置いたが、main 側 (cdd2ad5、09-16) が
  smash_database 定義の `data/geo.json` (`seed_groups`、`units` に言語別の名前) を読む形にしたので **09-16 にそちらへ揃えた**
  (契約 = spsp_scripts docs/geo_json.md)。`seed_data.js` は `setGeoCatalog / ensureGeoCatalog / fetchGeo`、`buildRegionGroups({id: bool})` は
  `seed_groups.default` を既定にし、未読込なら throw。トグルは骨格の `#so-group-box` に geo.json 読込後 (`99_bootstrap.js
  renderRegionGroupToggles`) に描く (文言は `seed.skeleton.group_toggle` 等の辞書 + `units[].name` の表示言語)。`pref/` と `priority/` の
  47 都道府県の直書きも geo.json (`units`) に置き換え、pref の一覧は表示言語の名前 (英語ページでは Tokyo)。北米 (seed_groups 空) ではトグルが出ない。
- **キャラ名**: 辞書 `char.<id>` (86 キャラ、ja/en) と `js/chars.js charName(id, fallback)`。描画は c_index / c_ranking / p / ranking-table の 4 箇所。
  ビルド出力の `name` (日本語) は fallback。ビルド側の変更は不要。
- **実績 / 動的バッチ**: ビルドが `kind` / `params` を出し (`label` / `cls` / `priority` は不変、追加のみ)、フロントが `js/achievements.js
  achievementLabel(item)` で辞書 `ach.*` から組む。kind が無い (現行の配信データ) / 知らない kind は `label` をそのまま。
  - ビルド側: spsp_scripts ブランチ `feat/achievement-kinds` (worktree `~/spsp-achkind`、b7537e9、**未 merge**)。golden は players/*.json に
    kind/params が増える分だけ変わる (再基準化が要る)。契約は `contracts/player.schema.json` と `js/achievements.js` の冒頭に。
  - 検証: `tests/frontend/achievements.test.cjs` — ビルド側テスト (`tests/meta/test_achievement_kinds.py`) が組んだ 92 件 (`tests/frontend/fixtures/`)
    について ja の組み立て = ビルドの label、en は日本語が残らない。
- **contracts** (段階計画の②の残り): `contracts/player.schema.json` (players/<uid>.json のうちフロントが読む部分) と `types/contracts.d.ts`
  (手書き、1 対 1)。`tests/meta/contracts.test.cjs` が fixture と配信中の players 300 件を ajv で検証し、schema の kind の集合 = コードの kind を見る。
- `npm test` に `tests/frontend/*.test.cjs` を含めた。

## ③ の棚卸しと北米プレビュー (2026-09-16)

英語ページ (30 シナリオ) に残る日本語を機械的に棚卸しした (選手名・大会名・イベント名・市区名は除く):
UI 由来で残っていたのは **都道府県名** (選手ページの居住地・大会ページの開催地・都道府県ランキングの見出し)、**「N日前」**、
index の keywords meta、それに **実績の文言** (ビルドの kind/params 待ち) だけ。日付はビルドが ISO で出しフロントが整形、
タグはフラグ + 辞書、シリーズ名は固有名詞 (篝火 など) なので、**ビルド出力の ID 化は実績以外に要らない**。
市区名 (台東区 …) と news.json の本文は日本語のデータのまま (地域単位のカタログには無い。必要なら geo.json に市区を足す)。
解説ページ (overview / details / math / eval) と vote / post / callback は日本語専用 (英語ツリーでは noindex)。

- `js/geo.js` (`loadGeo(root)` / `setGeoCatalog` / `unitName(id)`): geo.json の `units[].name` で表示言語の県名。選手ページ (居住地・ライバル欄)、
  大会ページ (開催地)、都道府県ランキング (見出し・title)、シードツールのレポート (地域名) で使う。英語ページでは Aichi / Chiba / Tokyo。
- `common.days_ago` (`{n, plural, …}`)、`page.index.keywords` (data-i18n-attr)。
- **北米プレビュー (④ の手前)**: `~/spsp-verify/preview_na.sh` が `npm run build --region NA` (英語がルート、日本語は /ja/) を `~/preview-na` に写し、
  データは北米ビルドの出力 (`~/spsp-state/builds/na_<日付>`、`~/spsp-nabuild` = spsp_scripts main の detached worktree +
  `~/spsp-nadata` = smash_db_tournament data-North_America の worktree で `SPSP_REGION=North_America build_full + build_aux`、
  overseas.json は 2 パス) へ symlink → <ConoHa WING の初期ドメイン>/b/na/ 。harness `--region NA --data <出力> --base /b/na/` で
  index / c / pref / priority / seed / bracket / news がエラーなし。**spsp.games の /na/ (regions.txt の na=) は空のまま (公開はユーザー判断)**。
  北米ビルド側の残り: geo.json が data-North_America に commit されていない (derive.py で生成した)、`data/upcoming.json` は deploy が
  データから写す工程なので手で置いた、`news.json` の本文が日本のもの、州判定と naming は provisional。

## 仕上げ (2026-09-17)

- JS に残っていた日本語文言を辞書へ: 共有 (share.js) / 共有データの検証 (seed_share.js、32 件) / アップロード (seed_uploader.js) /
  ブラケットのラウンド名・経過日数 (bracket_core.js、`{n}` と plural) / CSV ソース欄 / シリーズ選択 / 読み込み失敗など。
  残る日本語リテラルは **CSV の列名・サンプル名 (データ互換)**、**開発者向けの検証メッセージ** (seed_optimizer のパラメータ検査など)、
  **日本語専用ページ** (vote / post / callback / oauth_state) だけ。`require(ESM)` で直接読むテストは `tests/helpers/dicts.cjs` で辞書を入れる。
- logo.js の読み込み枠の判定を言語非依存に (`/読み込み中|ロード中|loading/i`、レビュー §2-10)。
- 曜日は `Intl.DateTimeFormat(lang, {weekday:'short'})`、国名は表示言語 (`country_ja` は日本語のときだけ)、暦日の時差は `region/config.js` の
  `utcOffset` (`+09:00` の直書きを撤去: index の news、events、sim)。
- `// @ts-check`: src/pages の 22/23 ファイル (p.js だけ未着手: 276 エラー。MAIN_REC / PLAYER / META の null ガードを関数ごとに入れる作業)。
  合計 48 ファイル、tsc 0。

## レビューの残りの消化 (2026-09-17〜19)

- §2-7 日付境界: 優先枠ページの「今日」を `config.utcOffset` の暦日に (`+9h` 直書きを撤去)。ローカルランキングの `T00:00:00Z` は last_date も
  cutoff も UTC の暦日どうしの比較なのでズレない (そのまま)。
- §2-8 dead code: docs.css の `.nav` 規則 (class="nav" の要素は無い) を削除。seed_uploader の未使用 4 関数・index のチャート・ranking-table の
  setColumnVisibility・ensureChartJs は既に無い。
- §4.6 サポート導線: `regions/<REGION>/config.js` の `support.contact` (JP = X の DM、NA = TODO 空)。vote.js の案内文は辞書 + `{contact}`。
  `config.auth` (投稿機能の OAuth/GAS) は北米用の start.gg アプリと GAS が無いので未着手 (post_config.js は日本固定のまま)。
  `:lang(ja)` のフォント切替は見送り (今の stack は英語でも崩れない)。ブラケットの敗者側テーブルの北米検証は北米大会の実プールが要る (未)。
- §4.7 ビルド出力の ID 化 (spsp_scripts ブランチ `feat/output-ids`、worktree `~/spsp-outids`、**未 merge**、追加のみ):
  1 実績 kind/params (feat/achievement-kinds、済)、6 `series_id` (slug)、7 `tags` 配列 (is_* の名前)、9 `bracket_type` (start.gg の phase bracket type)、
  10 `meta.generated_at` にオフセット。フロント側は先に対応済 (`js/tags.js flag()`、`js/match.js compactBracketLabel(…, bracketType)`、
  `contracts/player.schema.json`、`tests/meta/tags_match.test.cjs`): 旧出力 (現行データ) でも同じ判定・同じ表示。
- 09-19: `// @ts-check` を p.js と seeding/app 12 本にも (63 ファイル、tsc 0)。`.getTime()` / `String()` の同値な書き換えと null ガードだけ (挙動不変、全 30 シナリオ差分なし)。
  ついでに seed 表の選手リンクの新規タブ判定を `?d=` にも (2026-09-14 の discriminator 化で外れていた、40_startgg.js)。
- 09-20: 実績の英語化を現行データでも効かせる: `js/achievements.js parseLegacyLabel()` がビルドの日本語 label (形は score.py で固定) から kind/params を復元し、
  同じ経路で辞書から組む (fixture 92 件で kind 付きと同じ文言、日本語は不変)。ビルド側 feat/achievement-kinds を待たずに英語ページの実績が英語になる。
  ×1 の大会成績は tour / tour_series の区別が付かないが文言は同じ。全一バッジの英語は「#N キャラ名」(ホバー Best X player in Japan)、日本語は不変。
- 環境: ConoHa のスレッド上限で esbuild / tsc が落ちる → `GOMAXPROCS=1` (typecheck script、build_site.mjs)。tsc は終了コードで判定
  (クラッシュ時は `error TS` が 0 件に見える)。テストは `UV_THREADPOOL_SIZE=1 node --test --test-concurrency=1` を 3 バッチで。

## 残り (2026-09-15 更新)

1. ③ ビルド契約 (§4.7): 残りは実績の kind/params のビルド側 (feat/achievement-kinds、golden 再基準化と一緒に main へ)。県名・日付・タグは済 (上の棚卸し)。
   市区名を英語にするなら geo.json に市区を足す (smash_database 側)。
2. ④ 北米デプロイ: プレビュー /b/na/ まで済。本公開は regions/NA の TODO (ホスティング・GA・OAuth) と regions.txt の na= (ユーザー判断)。
   北米ビルドの nightly 化 (data-North_America の run_region.sh + build) は spsp_scripts 側。
3. 型付け: 09-19 に p.js と seeding/app/*.js も `// @ts-check` (合計 63 ファイル、tsc 0)。Vitest は任意。
4. `seed/` と `seed-upload/` の head の生成 (head stamp、§4.5 (a) と同じ仕組み) ができれば shell を 1 つにできる。

## URL キーの ASCII 化 (2026-09-24、§6-4)
- `?pref=` は地理単位の URL キー: id が ASCII ならそのまま (北米 `CA`)、そうでなければ英語名の slug (日本 `東京都` → `tokyo`)。`js/geo.js` unitUrlKey / unitFromUrlKey。
- `?series=` はシリーズ名のキー: 名前の ASCII slug (`Unit-Verse` → `unit-verse`) か、ASCII にならなければ `_` + FNV-1a の base36 (`銀工杯` → `_ugr4xf`)。`js/url_key.js` nameKey、`SPSPLinks.seriesKey`。
  series_id (ビルド) は日本語を含み、`シカブラ` と `シカブラ⁉` が衝突するので URL には使わない。現データで 421 シリーズ・47 都道府県・67 州とも重複なし。
- 旧 URL (`?pref=東京都`、`?series=銀工杯`) はページが名前でも引き、読めたら `history.replaceState` で新しいキーに書き換える (Worker の 301 は不要)。
- 検証: compare_with_ref.sh で pref / local / events / 選手ページの差分は href のキーだけ (旧 URL で開くランキングページは差分 0)。

## 拡張子なしの URL と、既定言語だけのページ (2026-09-28)
- `--clean-urls` (build:cf / build:cf:preview) で config.cleanUrls = true。ページ間リンクは `js/html.js` の `SPSP.pageHref(rel)` を通す
  ('c/ranking.html' → 'c/ranking'、'index.html' → '')。静的 HTML の a[href] と canonical / hreflang / og:url / sitemap もビルドが拡張子なしにする。
  Workers assets の html_handling が /x.html → /x に 307 するので、表示される URL と canonical が食い違っていた。素のビルド (npm run build) は .html のまま。
- 既定言語にしか無いページ (解説・投票・投稿・callback・ブログ = build_site.mjs の JA_ONLY) は他言語の木に出さない。
  旧 URL (/jp/en/vote.html など) は `_redirects` (ビルドが `_redirects.part`、assemble_dist.sh がまとめる) で既定言語へ 301。静的配信の機能なので Worker は動かない。
  他言語のページからのリンクは既定言語の木を指す (nav は SPSP.root、静的 HTML はビルドが書き換え)。そのページでは言語切替を出さない (`<html data-default-lang-only>`)。

## 言語は ?lang= (2026-09-28、同日の「英語の木から外す」を置き換え)
- 配信は地域ごとに既定言語の 1 系統だけ (/jp/ = 日本語、/na/ = 英語)。もう一方の言語は同じ URL + `?lang=en` / `?lang=ja`。`/jp/en/` の木は無くなった。
- 仕組み: ビルドは既定言語の文言で HTML を出し、data-i18n / data-i18n-attr を残す。既定言語の辞書の直後に `js/lang_boot.js` (古典 script) を置く。
  lang_boot は ?lang (config.langs にあれば localStorage 'spsp_lang' に覚える) > localStorage > 既定言語 で決め、既定言語以外なら
  `<html lang>` を変え、辞書 `i18n/<lang>.js` を document.write で同期に読み、noindex の meta を足す。`js/i18n.js` は <html lang> で言語を決め、
  本文の data-i18n を差し替える (ページの script は本文の最後なので、描画の前に 1 回)。navigator.language は見ない (クローラーが英語環境のため)。
- 検索: canonical は ?lang 無しの URL、hreflang とサイトマップの alternate は出さない。言語切替のリンクは rel=nofollow、押した時点の URL + ?lang。
- 既定言語だけのページ (解説・投票・投稿・ブログ) は `<html data-default-lang-only>`: lang_boot を置かず、言語切替を出さない。
- 旧 URL: `/jp/en/…`・`/na/ja/…` (と `/en/…`) は Worker が同じページ + `?lang=` に 301 (他のクエリは残す)。言語別の木が無くなったので静的な _redirects は使わない。
- 検証: jsdom はパーサ中の document.write の外部 script をページの script より後に読む (ブラウザは同期) ので、snapshot_pages.cjs の `--lang en` は
  辞書の script を lang_boot の直後に静的に足してから開く。日本語の画面比較の差は言語切替のリンクと lang_boot の読み込みだけ。
