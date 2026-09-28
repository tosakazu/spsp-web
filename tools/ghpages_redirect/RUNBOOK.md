# 旧サイト (tosakazu.github.io/spsp/) を spsp.games への転送に切り替える手順

2026-09-28 作成。レビュー (サブエージェント 3 本) の指摘を反映。サーバ上のパスは `~` 起点。

## 事前に済ませたこと
- nightly: R2 (spsp.games) を gh-pages より先に同期し、gh-pages の失敗で止まらない。`~/spsp-state/ghpages_retired` があれば gh-pages に出さず、日曜の clone 取り直しもしない (spsp_scripts b045b65)。
- GAS: 公開データの読み先を `https://data.spsp.games/jp` に変えて、同じデプロイ ID で再デプロイ済 (@25)。旧サイトの投票と代行投票は切り替え後も動く。
- 転送ページ: 即時 (0 秒)、`<head>` で判定、canonical はクエリの無いページは静的・クエリで中身が決まるページは JS。`?stay=1` で確認用に止まる。

## 切り替えの前に決めること
1. **日時**: nightly (毎時 0 分、3 時間おき) が終わった直後 (例 15:10)。nightly は通常 4〜6 分。
2. **旧サイトの JSON (players/ meta.json latest_tjpr_full.jsonl など)**: GitHub Pages は JSON を転送できない。
   - (a) 消す (404)。外部で使っている人がいなければこれ。
   - (b) 切り替え時点のものを残す (以後は更新されない)。手順 3 の「(b) の場合」を実行する。
   - (c) data.spsp.games を誰からでも読めるように CORS を開け、新しい場所を案内する。**2026-09-28 に開けた** (R2 バケット spsp-data の CORS: origins "*"、GET/HEAD。以前の設定は ~/spsp-state/handoff/r2_cors_before_20260928.json)。旧サイトの JSON を使っていた人は `https://data.spsp.games/jp/…` (同じパス) に移れる。残りは (a) か (b) を選ぶ。
3. **お知らせ**: 切り替えの 1 回以上前の nightly で、旧サイトに「◯月◯日 ◯時に spsp.games に移転します」を出しておく (spsp_scripts の site/news.json を編集 → 次の nightly で旧サイト・spsp.games 両方に出る)。下書き = ~/spsp-state/handoff/2026-09-28_domain_move_announcement.md

## 切り替え (所要 10 分ほど)
```sh
# 0. nightly が走っていないこと (直前の回が "nightly end" まで出ていること) を確認
tail -3 ~/.local/log/spsp_nightly/$(date +%F).log

# 1. nightly のロックを取ったまま作業する (途中で nightly が始まって旧サイトを上書きしないように)。別の端末ではなく同じシェルで続ける
exec 9>~/spsp-state/nightly.lock && flock -n 9 && echo "lock OK"

# 2. 旧サイトを閉じた印 (以後の nightly は gh-pages に一切書かない)
touch ~/spsp-state/ghpages_retired

# 3. 転送ページを作る
rm -rf ~/spsp-state/ghswitch_out && node ~/spsp-web/tools/ghpages_redirect/build.mjs --from ~/spsp-state/tosakazu.github.io/spsp --out ~/spsp-state/ghswitch_out/spsp
#    (b) JSON を残す場合だけ: 今の旧サイトからデータを写す
#    for x in players history tournaments data meta.json players_current.json latest_tjpr_full.jsonl news.json; do cp -r ~/spsp-state/tosakazu.github.io/spsp/$x ~/spsp-state/ghswitch_out/spsp/ 2>/dev/null; done

# 4. 別の clone から push する (~/spsp-state/tosakazu.github.io は触らない: ConoHa の旧本番とプレビューがそこを symlink で見ている)。/tmp は使わない (掃除で壊れる)
rm -rf ~/spsp-state/ghswitch && git clone --depth 1 -b gh-pages git@github.com:tosakazu/tosakazu.github.io.git ~/spsp-state/ghswitch
cd ~/spsp-state/ghswitch && echo "PREV=$(git rev-parse HEAD)" | tee ~/spsp-state/ghswitch_prev.txt
git rm -rq spsp && cp -r ~/spsp-state/ghswitch_out/spsp ./spsp && git add spsp
git diff --cached --stat -- . ':!spsp'   # ← 何も出ないこと (ブログなど spsp/ 以外に触っていない)
git commit -q -m "spsp/ を spsp.games への転送ページに置き換え" && git push origin gh-pages

# 5. ロックを外す
exec 9>&-
```

## 確認 (GitHub Pages の反映に 1〜2 分、キャッシュは最大 10 分)
```sh
gh api repos/tosakazu/tosakazu.github.io/pages/builds/latest -q '.status'   # built
curl -s https://tosakazu.github.io/spsp/ | grep -o 'spsp.games/jp/'       # 転送ページになっている
curl -s -o /dev/null -w '%{http_code}\n' https://tosakazu.github.io/          # ブログのトップが 200 のまま
```
ブラウザで (スマホも): `https://tosakazu.github.io/spsp/`、`/spsp/p/?uid=1787719`、`/spsp/pref/ranking.html?pref=東京都`、`/spsp/c/ranking.html?char=1304`、`/spsp/callback.html?code=x` (投票ページへ、code は渡らない)。
いずれも spsp.games の同じページに即時に移る。`?stay=1` を付けると転送ページの中身が見える。

その後: お知らせを「移転しました」に直す (site/news.json)、ツイート。

## 切り戻し
- **すぐ戻す**: 転送ページを取り消して、nightly の gh-pages 出力を再開する。
  ```sh
  cd ~/spsp-state/ghswitch && git revert --no-edit HEAD && git push origin gh-pages
  rm ~/spsp-state/ghpages_retired     # 次の nightly から旧サイトを通常どおり出す (deploy_v4.sh が origin に合わせてから rsync する)
  ```
  すぐ最新にしたいときは、ロックを取って `cd ~/spsp-ranking && bash deploy/deploy_v4.sh ~/spsp-state/builds/nightly_$(date +%Y%m%d) "切り戻し"`。
- GAS の変更 (data.spsp.games を読む) は戻さなくてよい (どちらの状態でも動く)。

## 切り替え後 (数週間のうちに)
- Google Search Console: spsp.games をドメインプロパティで登録し、`https://spsp.games/jp/sitemap.xml` を送信。
- GA: 除外する参照に tosakazu.github.io。
- tosakazu.github.io のルートの `kurai-sp/` (SPSP の旧名のページ、/spsp/ へ即時転送) は 2 段の転送になる。気になれば spsp.games へ直接に。
- GAS を止めるときは、nightly の GAS からの投票取得の行だけ外す (merge_char_votes.py の入力 char_votes_gas.json は残す。無いと毎回 rc=2)。
- ConoHa の旧本番 (/jp/) とプレビューは、選手データが切り替え時点で止まる (今の clone を見ているため)。使い続けるなら参照先をビルド出力に。
