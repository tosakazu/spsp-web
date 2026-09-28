# tests/frontend — フロントの描画結果が変わっていないことの確認

ブラウザが使えない環境 (ConoHa WING) 向けに、実ページを jsdom で動かして DOM を書き出し、
リファクタ前後で比べる。「見た目を変えない」変更の検証に使う。

- `snapshot_pages.cjs` … 26 シナリオ (ランキング 4 ページ・一覧 3 ページ・選手 5 人・大会 4 件・sim・events・
  priority・news・seed・bracket・vote・post・overview) を読み込み、タブ切替・行の展開・検索・ページ送りなどの
  操作をしながら、各時点の DOM (`<script>` / `<style>` / stylesheet 参照を除いた `outerHTML`)、
  CSS (その時点の `<style>` と stylesheet の中身を文書順に連結)、Chart.js に渡した設定を書き出す。
  時刻は 2026-09-13 21:30 JST 固定、`Math.random` と `performance.now` も固定。CDN のライブラリはスタブ。
- `compare_with_ref.sh <git ref>` … 基準版 (`git archive`。`src/pages/` があればその版のビルドで `dist` を作る) と作業ツリー (`src/pages/` があれば `npm run build` 済みの `dist/`、無ければ `site/`) を同じデータで走らせて `diff -r`。
  データは既定で gh-pages の checkout を読み、最初に読んだファイルを `frozen/` に写すので、
  途中で nightly がデータを更新しても両側は同じ入力になる。1 回 3 分弱 (両側並列)。

```
tests/frontend/compare_with_ref.sh main            # main と作業ツリーを比べる
tests/frontend/compare_with_ref.sh HEAD~1 --only p_ # 選手ページだけ (正規表現)
# 1 プロセスが ConoHa の CPU 時間制限 (~300s) に当たって無言で止まるときは分けて走らせる:
for g in '^(index|c_|local_|pref_)' '^(p_|t_)' '^(sim|events|news|priority|seed|bracket|vote|post|callback|overview|details|math|eval)'; do tests/frontend/compare_with_ref.sh HEAD --computed --only "$g"; done
node tests/frontend/snapshot_pages.cjs --data ~/spsp-state/tosakazu.github.io/spsp --out /tmp/na --region NA   # 北米の設定 (regions/NA/) で走らせる
```

見ていないもの: レイアウト (幅・折り返し・実際の色)、CSS の適用結果 (テキストとして同じかだけ)、
html2canvas の画像、start.gg への通信が要る seed の本体。CSS を共通ファイルへ移すときは、
連結した CSS テキストが同じ順序で同じ内容になるように移す (そうすればこの比較で守れる)。

決定性の確認: 同じ版を 2 回走らせて `diff -r` が空になることを 2026-09-13 に確認済み。
