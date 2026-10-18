# Cloudflare 構成案 (2026-09-22)

前提の数字 (配信中の gh-pages checkout、09-22): 全体 1.5 GB / 約 49,000 ファイル。players/ 906 MB (22,268 個)、tournaments/ 298 MB (4,288 個)、
history/ 272 MB (22k 個、日次で全件更新)、data/ 12 MB。初回表示で読む latest_tjpr_full.jsonl 13.9 MB、players_current.json 5.0 MB。
フロント (spsp-web の dist) は HTML/JS/CSS で 200 ファイル弱。動的なものは start.gg OAuth と投票・投稿・エラーログ (GAS、gas/*.gs) だけ。
ビルドは WING の cron (3 時間ごと)。

## 結論 (1 枚)

| 役割 | いま | 移行後 | 理由 |
|---|---|---|---|
| HTML / JS / CSS | WING 直配信 + gh-pages | **Cloudflare Workers (Static Assets)** 1 つ。`/jp/…` `/na/…` `/en/…` を同じ assets に置く | Pages は Workers に統合されつつあり、新規は Workers 推奨。静的アセットのリクエストは無料・無制限。API と同じ Worker に置けるので経路が 1 つ |
| JSON (players / tournaments / history / data) | 同上 | **R2** バケット + 独自ホスト名 (例 `data.spsp.games`) で直接配信。Worker を通さない | Pages/Workers の assets は 1 デプロイ 20,000 ファイル上限 (49k は不可)。R2 は転送量無課金、Cache Rules で edge キャッシュ、Brotli 圧縮 (13.9 MB → 2 MB 台) |
| OAuth (start.gg) / 投票 / 投稿 / エラーログ | GAS + スプレッドシート | **Worker の `/api/*` + D1** (SQLite)。client secret と署名鍵は Worker secrets | GAS のコード (code 交換 → currentUser → HMAC セッション → シート追記) は 1 対 1 で移植できる。Worker 無料枠 10 万 req/日で十分 |
| ビルド | WING cron | **WING のまま**。ビルド後に `rclone sync` で R2 へ差分同期 | ビルド機は変えない (CPU・データ・start.gg token がある)。3h 更新で変わるのは十数ファイル、history の日次全件でも 22k PUT/日 ≒ 66 万/月 < R2 無料枠 (Class A 100 万/月) |
| フロントのデプロイ | 手動 | spsp-web の GitHub Actions で `npm run build` → `wrangler deploy` (main への push で本番) | フロントとデータの更新を分離する。Actions は数分で済む |
| プレビュー (/b/…) | wing-proxy の PHP | Worker の **preview 環境** (別名の Worker、または versions の preview URL) + R2 の `b/<name>/` プレフィックス | PHP ルータを卒業。北米プレビューは `na` 環境 |
| 有料 (将来) | 無し | Stripe Checkout + Worker のゲート (cookie 検証 → R2 の非公開プレフィックスから配信) | 静的生成のまま出し分けられる |

費用の見込みは月 0 円 (R2 保存 10 GB、Class A 100 万、Class B 1,000 万、Workers 10 万 req/日、D1 5 GB の無料枠内)。WING はビルド機として契約継続。

## 経路

```
ブラウザ ── https://spsp.games/jp/…  ──▶ Worker (static assets: dist)        ← wrangler deploy (GitHub Actions)
        ── https://spsp.games/api/… ──▶ 同じ Worker (fetch handler) ── D1 / secrets / start.gg
        ── https://data.spsp.games/jp/players/123.json ──▶ R2 (custom domain, Cache Rules)  ← rclone sync (WING cron)
```

- フロントは `region/config.js` の `dataRoot` (既にある) を `https://data.spsp.games/jp/` にする。R2 側で CORS (`GET` from `spsp.games`) を許可。
- R2 のキー構成: `jp/players/…`, `jp/history/…`, `jp/data/…`, `na/…`, `b/<preview>/…`。地域ごとに `rclone sync <build_dir>/ r2:spsp-data/jp/ --exclude 'index.html'` のように、ビルド出力のうち JSON だけを同期する。
- キャッシュ (Cache Rules): `players/*`, `tournaments/*`, `history/*` は edge TTL 1 日 + `stale-while-revalidate`、`players_current.json` / `meta.json` / `data/*` は 5 分。同期後に変わったファイルだけ purge する必要は無い (揮発ファイルは TTL 短、安定ファイルは内容が変わらない)。
- 圧縮: Cloudflare が text/json/jsonl を Brotli/gzip で返す (R2 に置くのは無圧縮のまま)。`.jsonl` の Content-Type は `application/x-ndjson` を rclone の `--header-upload` か R2 のメタデータで付ける。
- 旧 URL: `tosakazu.github.io/spsp/…` は gh-pages を残して 301 (または `<meta refresh>`) で `spsp.games/jp/…` へ。`spsp.games/p/?uid=` など日本語・旧クエリの URL は Worker で 301 (§6-4 の日本語 URL 廃止と同時)。

## Worker (API) の設計

GAS の 1 対 1 移植。エンドポイントと保存先:

| GAS (gas/*.gs) | Worker | 保存 |
|---|---|---|
| `handleBeginLogin_` / `handleLogin_` (session.gs) | `GET /api/auth/begin` (state 署名 → start.gg へ)、`GET /api/auth/callback` (code 交換 = oauth.gs `exchangeCodeForToken_`、`fetchCurrentUser_`、セッション token 発行) | secrets: `STARTGG_CLIENT_SECRET`, `SESSION_SECRET` |
| vote.gs | `POST /api/vote` (token 検証 → 資格判定 → 追記) | D1 `votes (uid, char_id, ts, …)` |
| errlog.gs | `POST /api/errlog` | D1 `errors` (直近 N 件だけ保持) |
| export.gs (`handleExportVotes_` / `handleExportErrors_`) | `GET /api/export/votes?key=` (ビルドが読む。JSON の形は今の char_votes.json と同じにして spsp/char_vote.py は変えない) | `EXPORT_KEY` secret |
| 投稿 (未公開) | `POST /api/post` | D1 `posts` |

- callback.html の CSP (§6-8) は Worker のレスポンスヘッダで付ける (地域ごとの値を config から)。
- フロント側は `js/post_config.js` の GAS URL を `/api/…` に、`regions/<REGION>/config.js` の `auth` (client id、redirect) に集約 (§4.6 の config.auth)。北米版は北米用 start.gg アプリを作ったときに値を入れる。
- 認証済み判定はいまと同じ HMAC の署名付き token (Cookie でなく localStorage のままでもよい。Worker 側で検証)。

## 移行の順序 (各段階で戻せる)

1. **DNS を Cloudflare に** (spsp.games のネームサーバ)。proxy を有効にし、いまの WING 配信の前に CDN を置く。ここで圧縮と edge キャッシュが効き始める (計測: latest_tjpr_full.jsonl の転送量と TTFB)。
2. **R2**: バケット作成、WING の cron の末尾に `rclone sync` (差分同期) を追加、`data.spsp.games` を R2 に向け、CORS と Cache Rules を設定。フロントの `dataRoot` をプレビュー (`/b/frontend/`) で先に切り替えて確認。
3. **Worker (static assets)**: spsp-web に `wrangler.toml` と GitHub Actions を追加、`spsp.games` のルートを Worker に (これが A1 = refactor/frontend の本番投入、§6-3 のビルド配信への統一)。旧 URL の 301 もここで。`/na/` は同じ assets に北米の dist を置く (A4)。
4. **Worker API + D1**: GAS を移植、`post_config.js` を `/api/` に切替、GAS は読み取り専用で残して 1 週間並走 → 停止。ビルドの char_votes.json 取得先を Worker の export に。
5. **Stripe** (必要になったら)。

各段階の所要は 1〜3 に 1 日ずつ、4 に 2〜3 日 (テスト込み)。1〜2 はフロントを変えずにできるので先行してよい。

## 併せて直すもの

- 初回表示の 13.9 MB (latest_tjpr_full.jsonl): 圧縮で 2 MB 台になるが、さらに「上位 N 件だけの小さい一覧 + 残りは遅延読込」に分けると体感が大きく変わる (ビルド側の出力追加、フロントの読み込み順)。移行とは独立に効く。
- history/ の日次全件更新 (22k ファイル): R2 の PUT 数は無料枠内だが、内容が変わらないファイルは rclone が送らないので実際はもっと少ない。
- gh-pages: 移行後は 301 用に残すか、GitHub Pages を止めて Worker で受けるか (spsp.games に来るのは Worker なので、`tosakazu.github.io/spsp/` 側だけ問題)。

## 決めてほしいこと

1. `data.spsp.games` のようにデータを別ホスト名にしてよいか (同一ホストのパス `/jp/players/…` で R2 を出すには Worker 経由になり、無料枠 10 万 req/日を消費する)。
2. spsp.games の DNS を Cloudflare に移せるか (レジストラ側でネームサーバ変更)。
3. 北米版の URL は `spsp.games/na/` でよいか (§6-1)。別ドメインなら Worker のルートを増やすだけ。
4. GAS を止める時期 (投票データの移行: シートの内容を D1 に 1 回インポート)。
