# 旧サイト (tosakazu.github.io/spsp/) の転送ページ

`build.mjs` が旧サイトの HTML ページと同じパスに転送ページを作る (2026-09-28、未デプロイ)。

```sh
node tools/ghpages_redirect/build.mjs --from <旧サイトの spsp/ ディレクトリ> --out <出力> [--to https://spsp.games/jp/] [--delay 3]
```

- 表示: 移転したこと、新しい URL へのリンク (押せばすぐ移動)、`--delay` 秒後に自動で移動。`?stay=1` で自動移動を止める (確認用)。
- 新しい URL: `.html` を落とし (`c/ranking.html` → `c/ranking`)、クエリと `#` はそのまま渡す。旧 URL の日本語キー (`?pref=東京都` など) は spsp.games 側が読んで新しいキーに書き換える。
- `callback.html` (旧サイトのログインの戻り先) だけは認可コードを渡さず、投票ページへ。
- JS が無い環境は `<noscript>` の meta refresh でクエリ無しの新しいページへ。

## 切り替えるときに要ること (デプロイは spsp_scripts 側)
1. nightly の `deploy/deploy_v4.sh` が 3 時間ごとに gh-pages の spsp/ を丸ごと上書きするので、先にこの工程を止める (または転送ページを出す工程に替える)。
2. gh-pages の spsp/ を、このツールの出力に置き換えて push する。players/ などのデータ (JSON) は消える。外から JSON を読んでいる人がいそうなら、しばらく残すかを決める。
3. 旧サイトの投票 (GAS) は gh-pages の players/*.json を読んで資格を判定している (代行投票 admin_vote も)。GAS を止めるか、スクリプトプロパティ DATA_BASE_URL を https://data.spsp.games/jp に変える。
4. tosakazu.github.io のルート (ブログ) は触らない。
