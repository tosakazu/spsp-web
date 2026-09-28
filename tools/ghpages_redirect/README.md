# 旧サイト (tosakazu.github.io/spsp/) の転送ページ

`build.mjs` が旧サイトの HTML ページと同じパスに転送ページを作る (2026-09-28、未デプロイ)。

```sh
node tools/ghpages_redirect/build.mjs --from <旧サイトの spsp/ ディレクトリ> --out <出力> [--to https://spsp.games/jp/] [--delay 3]
```

- 既定は即時に移動 (`--delay 0`、`<head>` で判定)。本文は移転の案内と新しい URL へのリンク (JS が無い環境と確認用)。`?stay=1` で自動移動を止めて中身を確認できる。
- 新しい URL: `.html` を落とし (`c/ranking.html` → `c/ranking`)、クエリと `#` はそのまま渡す。旧 URL の日本語キー (`?pref=東京都` など) は spsp.games 側が読んで新しいキーに書き換える。
- `callback.html` (旧サイトのログインの戻り先) だけは認可コードを渡さず、投票ページへ。
- JS が無い環境は `<noscript>` の meta refresh でクエリ無しの新しいページへ。

## 切り替え手順
[RUNBOOK.md](RUNBOOK.md) (切り戻し付き)。
