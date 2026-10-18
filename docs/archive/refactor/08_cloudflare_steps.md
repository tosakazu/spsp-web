# Cloudflare 移行の手順 (2026-09-22)

構成は 07_cloudflare_plan.md。ここは「誰が何をするか」の順番。★ = ユーザー (アカウント側) の作業、その他はこちらでできる。

## 0. 準備 (アカウント側) ★
1. Cloudflare アカウント (無料プラン) を作る。
2. Websites → Add a site → `spsp.games`。既存の DNS レコード (WING の A レコード、あれば MX / TXT) を Cloudflare が読み取るので、一覧を確認する。
3. 表示されたネームサーバ 2 つを、spsp.games を登録しているところ (ConoHa WING のドメイン管理) で設定する。反映まで数時間〜1 日。**この時点では配信は WING のまま** (Cloudflare は proxy として前に立つだけ)。
4. API トークンを 1 つ作る (My Profile → API Tokens → Create Token → Custom): 権限は
   `Account: Workers Scripts:Edit / Workers R2 Storage:Edit / D1:Edit / Workers KV Storage:Edit`、`Zone (spsp.games): DNS:Edit / Workers Routes:Edit / Cache Purge:Purge`。
   これをこちらに渡す (サーバの `~/.config/cloudflare/env` に `CLOUDFLARE_API_TOKEN=…` と `CLOUDFLARE_ACCOUNT_ID=…` として置く。git には入れない)。
   同じ 2 つを GitHub の spsp-web リポジトリの Secrets にも登録する (Actions がフロントをデプロイするため)。
5. R2 → Manage R2 API Tokens → `Object Read & Write`、バケット `spsp-data` に限定したトークンを作り、Access Key ID / Secret Access Key をこちらに渡す (rclone 用、`~/.config/rclone/rclone.conf`)。
   (バケット自体はこちらが `wrangler r2 bucket create spsp-data` で作れる。先に作ってからトークンをバケット限定にする)

## 進捗 (2026-09-22、本番切替済)
- 0-1〜0-4、②、③、④ (投票の移行) まで済。**spsp.games は本番 Worker `spsp-web` が配信中** (custom domain)。旧本番 (ConoHa WING の初期ドメイン + gh-pages) はユーザー指示でそのまま。
- R2 `spsp-data`: CORS / data.spsp.games / Cache Rules 済。jp (gh-pages の写し) と na (~/spsp-state/builds/na_20260920) を初回同期 (09-22 04:00〜)。以後 jp は nightly [5.5/5] が差分同期 (setsid で切り離し、ログ ~/.local/log/spsp_nightly/r2_sync_<日付>.log)。na は手動。
- D1 `spsp` (17262f4f-…) に GAS の投票 118 件を投入済。nightly の char_votes 取得は Worker の /api export に切替済 (spsp_scripts 3069b9d)。
- spsp-web: refactor/frontend → main を ff merge (18f06c7)。main への push = deploy.yml が本番デプロイ (初回 run 成功)。プレビュー = `npm run build:cf:preview` + `wrangler deploy --env preview` (アプリ 620)。
- **罠**: wrangler の env は top-level `routes` を継承する。env.preview / env.na に `routes = []` を明示しないと custom domain を奪う (09-22 に発生、18f06c7 で修正)。
- 残り: 初回同期の完了確認、ユーザーの投票テスト (619)、spsp_scripts の feat/achievement-kinds + feat/output-ids merge (golden 再基準化)、⑤ 後片付け (GAS 停止はユーザー)。
- 注意: このサーバから Cloudflare 配下ホストへの TLS は証明書発行直後は handshake failure。Python-urllib の既定 UA は 403。

## 1. CDN を前に置く (不要になった。上の進捗を参照)
- Cloudflare 側の DNS で spsp.games の A レコードが proxied (オレンジ雲) になっていることを確認。SSL/TLS は Full。
- これだけで圧縮 (Brotli) と edge キャッシュが効く。計測: `curl -sI -H 'Accept-Encoding: br' https://spsp.games/jp/latest_tjpr_full.jsonl` の content-encoding と cf-cache-status。
- 戻し方: proxy を切る (灰色雲) だけ。

## 2. JSON を R2 に (フロントは変えない)
- `wrangler r2 bucket create spsp-data`、CORS (`GET`, origin `https://spsp.games` と `<ConoHa WING の初期ドメイン>`)、独自ドメイン `data.spsp.games` をバケットに付ける (R2 → Settings → Custom Domains。DNS は自動)。
- Cache Rules (Rules → Cache Rules): `data.spsp.games/*/players/*` `…/tournaments/*` `…/history/*` は Edge TTL 1 日、それ以外 5 分 (オブジェクトの Cache-Control を尊重する設定でも可: sync_r2.sh がプレフィックスごとに付けている)。
- WING: `bash deploy/sync_r2.sh ~/spsp-ranking/site jp` を 1 度手で流し (初回 1.5 GB、数十分)、以後 `deploy/update_and_deploy.sh` の末尾に組み込む。
- 確認: プレビューを `--data-root https://data.spsp.games/jp/` でビルドして `/b/frontend/` で動くか (`~/spsp-verify/preview_frontend.sh` に環境変数 `DATA_ROOT` を足す)。
- 戻し方: `--data-root` を外してビルドし直すだけ (同じルートから読む)。

## 3. フロントを Workers に (= refactor/frontend の本番投入、/na/ 公開、日本語 URL の整理)
- spsp-web: `worker/` (wrangler.toml + src)、`npm run build:cf` (dist-cf/jp, dist-cf/na)、`.github/workflows/deploy.yml`。
- `wrangler d1 create spsp` → wrangler.toml の database_id に。`wrangler secret put STARTGG_CLIENT_SECRET / SESSION_SECRET / EXPORT_KEY`。
- `wrangler deploy --env preview` で `spsp-web-preview.<account>.workers.dev` に出し、動作確認 (英語・北米・実績・投票の画面)。
- 本番: `wrangler deploy` + Workers Routes `spsp.games/*` を Worker に (これで WING の PHP ルータは通らなくなる)。旧 URL (`/p/?uid=`、`?pref=東京都` など) の 301 は Worker 側の表で。
- refactor/frontend → main に merge (spsp-web)。spsp_scripts 側は `chore/split-frontend` (site/ 撤去、`~/spsp-web/dist` を配信ディレクトリに) を main に。
- 戻し方: Routes を外す (WING 配信に戻る)。R2 のデータはそのまま使える。

## 4. GAS を Worker API に
- start.gg のアプリ設定で redirect URI を `https://spsp.games/jp/callback.html` に (旧 `tosakazu.github.io/spsp/callback.html` も当面残す)。
- 投票データ: GAS の export (`/exec?action=export_votes&key=`) の JSON を `worker/scripts/import_votes.mjs` で D1 に投入。
- `site/js/post_config.js` の GAS_ENDPOINT を `/api` に、regions config の `auth` に集約 → デプロイ。ビルドの char_votes.json 取得先を Worker の export に (spsp_scripts deploy/)。
- 1 週間並走 (GAS は読み取りのみ) → GAS を停止 ★。

## 5. 後片付け
- gh-pages: `tosakazu.github.io/spsp/` は 301 用に最小のページだけ残す (players 等の巨大な木は消して容量を戻す)。
- wing-proxy (PHP ルータ、/b/ プレビュー) を撤去。プレビューは Worker の preview 環境 + R2 の `b/` へ。
- WING はビルド機として継続 (cron、STARTGG_TOKEN、smash_db_tournament)。
