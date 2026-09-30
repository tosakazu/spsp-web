# spsp-web Worker — 静的配信 + `/api` (gas/*.gs の Cloudflare 移植)

`gas/*.gs` (Google Apps Script + スプレッドシート) を Cloudflare Worker + D1 に **1 対 1 で移植**したもの。
フロントは `post_config.js` のエンドポイント URL を替えるだけで動く (action 名・JSON の形・エラーコードと文言は同じ)。
設計の背景は [docs/refactor/07_cloudflare_plan.md](../docs/refactor/07_cloudflare_plan.md)。

```
worker/
  wrangler.toml            Worker / assets / D1 / vars / 環境 (preview, na)
  src/index.ts             fetch handler: /api → API、/ → 301 /jp/、旧 URL → 301、他 → ASSETS (+ヘッダ、callback.html に CSP)
  src/config.ts            定数 (gas/config.gs) と env → Config
  src/store.ts / db.ts     保存先の抽象と D1 実装 (シートの代わり)
  src/api/router.ts        action の振り分け (gas/main.gs doPost / doGet)
  src/api/session.ts       HMAC 署名のセッショントークン / state (gas/session.gs)
  src/api/login.ts         action login
  src/api/oauth.ts         start.gg の code 交換と currentUser (gas/oauth.gs)
  src/api/vote.ts          キャラ投票の規則・資格判定 (gas/vote.gs)
  src/api/card.ts          ログインの確認 (me) とプレイヤーカードの設定 (card_get / card_put)。GAS には無い
  src/api/post.ts          投稿 (gas/main.gs handlePost_。未公開だが移植)
  src/api/errlog.ts        失敗の記録 (gas/errlog.gs)
  src/api/export.ts        ビルド向けエクスポート (gas/export.gs)
  src/api/ratelimit.ts     連投判定 (gas/sheet.gs)
  src/api/time.ts          固定オフセットの ISO 時刻
  migrations/0001_init.sql D1 のテーブル
  migrations/0002_card_settings.sql プレイヤーカードの設定 (card_settings / card_writes)
  scripts/import_votes.mjs シートの内容 → D1 の INSERT
  scripts/assemble_dist.sh npm run build:cf の後に assets/_headers を dist-cf/ に写す
  assets/_headers          Worker を通らないアセット用のセキュリティヘッダ
  test/*.test.mjs          node:test (Cloudflare のランタイム不要。tests/post/gas*.test.cjs の移植)
```

## 検証 (アカウント不要)

```sh
# リポジトリ直下で。ConoHa ではスレッド上限があるので GOMAXPROCS=1 / concurrency=1 を付ける
GOMAXPROCS=1 npx tsc --noEmit -p worker/tsconfig.json
UV_THREADPOOL_SIZE=1 node --test --test-concurrency=1 worker/test/*.test.mjs
# 設定の検証とバンドル (デプロイはしない)
cd worker && GOMAXPROCS=1 npx wrangler deploy --dry-run --outdir /tmp/cf-out
```

`@cloudflare/workers-types` をリポジトリの devDependency に足してある (`worker/tsconfig.json` の `types`)。
テストは Node 22.18+ / 24 の型ストリップで `.ts` を直接 import する (構文は erasable なものだけ = `erasableSyntaxOnly`)。

## エンドポイント (GAS action → Worker)

すべて **HTTP 200 の JSON** で返す (GAS と同じ。ビルドの urllib が非 2xx を例外にするため)。
成功 `{ ok: true, ... }`、失敗 `{ ok: false, error: { code, message } }`。CORS は `*` (認証は body の token。Cookie は使わない)。

| GAS (`gas/*.gs`) | Worker | 入力 | 応答 |
|---|---|---|---|
| `POST /exec` `{action, ...}` | `POST /api` (body は同じ。`Content-Type: text/plain` のまま) | | |
| `begin_login` (session.gs) | `POST /api` `{action:"begin_login"}` または `POST /api/begin_login` | `nonce` (≤128), `returnPath` (≤512), `flow` (`post`/他は `login`) | `{state, ttlMs}` |
| `login` (session.gs) | `POST /api` `{action:"login"}` / `POST /api/login` | `code`, `state` | `{token, user:{id,slug,gamerTag}, exp}` / `bad_request` `state_invalid` `auth_failed` |
| `vote` (vote.gs) | `POST /api` `{action:"vote"}` / `POST /api/vote` | `token`, `charId` | `{user, charId, charName}` / `auth_failed` `bad_request` `internal` `bad_char` `not_player` `char_exists` `not_candidate` `rate_limited` |
| `post` (main.gs) | `POST /api` `{action:"post"}` / `POST /api/post` | `code`, `state`, `body` | `{user}` / `bad_request` `body_invalid` `state_invalid` `auth_failed` `rate_limited` |
| `me` | `POST /api` `{action:"me"}` / `POST /api/me` | `token` | `{user:{id,slug,gamerTag}, exp}` / `invalid_session` (記録しない) |
| `card_get` | `POST /api` `{action:"card_get"}` **または** `GET /api/card?uid=` (成功は `Cache-Control: public, max-age=60`) | `uid` | `{settings:{template,color,ach,tour}|null, updated_at|null}` / `bad_request` |
| `card_put` | `POST /api` `{action:"card_put"}` / `POST /api/card_put` | `token`, `settings` (`null` で削除)。書く uid は token のものだけ | `{settings, updated_at}` / `invalid_session` `bad_settings` `rate_limited` (10 秒に 1 回・1 日 100 回) |
| `client_error` (errlog.gs) | `POST /api` `{action:"client_error"}` / `POST /api/client_error` | `kind` (白リスト), `flow`, `note`, `token?` | `{logged: true|false}` |
| `export_votes` (export.gs) | `POST /api` `{action:"export_votes"}` **または** `GET /api/export/votes?key=&since=` | `key`, `since?` | `{votes:[{ts,userId,charId,charName,status}], total, since}` / `auth_failed` `internal` |
| `export_errors` (export.gs) | `POST /api` `{action:"export_errors"}` **または** `GET /api/export/errors?key=&limit=` | `key`, `limit?` (既定 100 / 上限 1000) | `{errors:[{ts,source,action,code,userId,note}], total}` |
| `doGet` | `GET /api` (上記以外) | | `bad_request` 「このエンドポイントは POST のみ受け付けます。」 |
| — | `OPTIONS /api` | | 204 (preflight) |

`POST /api/<action>` は body に `action` が無いときだけパスから補う。ビルドの `spsp/cli/fetch_char_votes.py` は
`post_config.js` の `GAS_ENDPOINT` に `{action:"export_votes"}` を POST するので、そのままで動く (エンドポイントを `/api` にするだけ)。

### エクスポート鍵

GAS と同じく `base64url(HMAC-SHA256(key=STARTGG_CLIENT_SECRET, msg="spsp:export_votes:v1"))` (末尾 `=` 無し) を受け付ける
(ビルド側 `fetch_char_votes.py` の `derive_key` と一致。固定ベクタは `test/export.test.mjs`)。
加えて secret `EXPORT_KEY` を設定すればその値も受け付ける (client secret を配らずに読み出し権限を渡せる)。両方無ければ `internal`。

## D1 のスキーマ (`migrations/0001_init.sql`)

| テーブル | 列 (シートの列 + 索引用) | 備考 |
|---|---|---|
| `votes` | `id`, `ts`, `ts_ms`, `day`, `user_id`, `user_slug`, `gamer_tag`, `char_id`, `char_name`, `status` | = `char_votes` シート。`ts` は `yyyy-MM-ddTHH:mm:ss+09:00`、`ts_ms`/`day` は連投判定用。索引 `(user_id, ts_ms)`, `(user_id, day)`, `(ts)` |
| `posts` | `id`, `ts`, `ts_ms`, `day`, `user_id`, `user_slug`, `gamer_tag`, `body`, `status` | = `posts` シート |
| `errors` | `id`, `ts`, `source`, `action`, `code`, `user_id`, `note` | = `errors` シート。3,000 行を超えたら古い行から削って 2,000 行にする (errlog.gs と同じ) |
| `used_states` | `key` (署名の先頭 100 文字), `expires_ms` | 署名 state の単回使用。GAS は CacheService (揮発) に置いていた。期限切れは検証時に掃除 |
| `card_settings` (0002) | `uid` (INTEGER PK), `settings` (検証済み JSON), `updated_at` | プレイヤーカードの設定。本人 (token の uid) だけが書く |
| `card_writes` (0002) | `id`, `uid`, `ts_ms`, `day` | card_put の連投判定用。2 日より古い行は書き込みのたびに消す |

**マイグレーションはデプロイ (Actions) では当たらない。** 0002 を足した版を本番に出すときは、先に
`npx wrangler d1 migrations apply spsp --remote` を打つ (当てないと card_get / card_put が internal になる)。

セッショントークンは署名のみ (stateless) なのでテーブルは無い。

## 初期設定 (アカウントのある端末で)

```sh
cd worker
npx wrangler login

# 1. D1 を作り、出力の database_id を wrangler.toml に貼る (本番 / preview / na)
npx wrangler d1 create spsp
npx wrangler d1 create spsp-preview
npx wrangler d1 create spsp-na
# 2. テーブル
npx wrangler d1 migrations apply spsp --remote
npx wrangler d1 migrations apply spsp-preview --remote --env preview
# 3. secrets (値はコードにも [vars] にも書かない)
npx wrangler secret put STARTGG_CLIENT_SECRET     # ~/spsp-secrets/startgg_oauth_client_secret の値
npx wrangler secret put SESSION_SECRET            # GAS のスクリプトプロパティ SESSION_SECRET を写すと既存ログインが引き継げる。無ければ openssl rand -hex 32
npx wrangler secret put EXPORT_KEY                # 任意
#    preview / na は --env preview / --env na を付けて同じことをする
```

`[vars]` の `REDIRECT_URI` / `DATA_ORIGIN` / `SITE_PREFIX` / `TS_OFFSET` / `SESSION_TTL_MS` / `STATE_TTL_MS` は `wrangler.toml` 内のコメントを参照。
`DATA_ORIGIN` は投票の資格判定で読む公開データの場所 (`/players/<uid>.json`, `/data/char_emoji.json`)。
本番・preview とも `https://data.spsp.games/jp` (R2、2026-09-22〜)。同じ Worker の assets から読むなら `assets:/jp` (na 環境はこれ)。

### 投票データの移行 (シート → D1、1 回だけ)

```sh
# A. ビルドが持っている写し (GAS の export_votes の JSON = build/data/char_votes.json。user_slug / gamer_tag は入っていない)
#    GAS の /exec は GET を受け付けないので、生の応答が要るときは POST {action:"export_votes", key} で取る (fetch_char_votes.py --full が同じことをする)
node worker/scripts/import_votes.mjs ~/spsp-ranking/build/data/char_votes.json > /tmp/votes.sql
# B. シートを CSV でダウンロードしたもの (全列が入る。こちらを推奨)
node worker/scripts/import_votes.mjs ~/Downloads/char_votes.csv > /tmp/votes.sql

cd worker && npx wrangler d1 execute spsp --remote --file /tmp/votes.sql
npx wrangler d1 execute spsp --remote --command 'SELECT COUNT(*) FROM votes'
```

`status=debug` の行と uid / char_id の無い行は入れない (エクスポートと同じ基準)。同じ入力を 2 回流しても `(ts, user_id, char_id)` が既にある行は増えない。
GAS を止める直前にもう一度 A を流せば差分が入る。

### アセットとデプロイ

```sh
npm run build:cf                           # dist-cf/jp (JP) + dist-cf/na (NA)。--canonical https://spsp.games/jp/ と --data-root 付き (package.json)
sh worker/scripts/assemble_dist.sh --no-build   # assets/_headers を dist-cf/ に写す (Worker を通らないアセットのヘッダ)
cd worker
npx wrangler deploy --env preview          # spsp-web-preview.<account>.workers.dev
npx wrangler deploy --env ""               # 本番 (spsp-web)
```

`.github/workflows/deploy.yml` (main への push) は `npm run build:cf` → `cd worker && npx wrangler deploy` を行う。
`_headers` を CI でも効かせるには deploy.yml に `cp worker/assets/_headers dist-cf/` を 1 行足す (worker/ の外なので未変更)。
`dist-cf/` は `.gitignore` で無視される。assets は 1 デプロイ 20,000 ファイルまでなので、`players/` 等の JSON は入れない (R2 で配信する、plan §経路)。
`spsp.games/*` の routes は DNS を Cloudflare に移してから `wrangler.toml` のコメントを外す。手順の全体は [docs/refactor/08_cloudflare_steps.md](../docs/refactor/08_cloudflare_steps.md)。

## フロントの切替 (`site/` 側。別コミット)

1. `site/js/post_config.js` (08_cloudflare_steps.md §4 の「regions config の auth に集約」をするならそちらに。いまのコードは `post_config.js` を読む)
   - `GAS_ENDPOINT: 'https://spsp.games/api'` (相対 `/api` でもよいが、ビルドの `fetch_char_votes.py` がこの値をそのまま叩くので絶対 URL にする)
   - `REDIRECT_URI: 'https://spsp.games/jp/callback.html'`
   - `CANONICAL_ORIGIN: 'https://spsp.games'`, `CANONICAL_BASE: '/jp/'` — `post.js` / `vote.js` は正規配信元でしか認証を始めず、`callback.js` は `safeReturnPath(r, CANONICAL_BASE)` で戻り先を縛るので、ここを替えないと spsp.games では認証が始まらない / 戻り先が `/spsp/index.html` に落ちる
2. `site/callback.html` の `<meta http-equiv="Content-Security-Policy">` の `connect-src` を `'self'` にする
   (meta と Worker のヘッダの両方が効くので、meta が `script.google.com` のままだと `/api` への fetch が CSP で止まる)。
   `tests/post/page.test.cjs` の INV-8 (connect-src が google であること) も合わせて直す。
3. **start.gg アプリ (client_id 582) の Redirect URI に `https://spsp.games/jp/callback.html` を追加**する (認可時と token 交換で完全一致が必要。旧 URI は並走期間中は残す)。
4. `~/spsp-ranking` 側は `post_config.js` の `GAS_ENDPOINT` を読むだけなので変更不要。`fetch_char_votes.py --full` を 1 回流し、`source_rows` が D1 の行数になることを確認する。
5. GAS は読み取り専用で 1 週間ほど残し (旧フロント = gh-pages がまだ叩く)、その後停止。

## 1 対 1 にできなかった点

| GAS | Worker | 影響 |
|---|---|---|
| `SESSION_SECRET` が無ければ自動生成してスクリプトプロパティに保存 | secret は必須。無ければ `internal` (Worker は実行時に secret を書けない) | 初期設定で 1 回 `secret put`。GAS の値を写せば既存ログインが有効なまま |
| state の単回使用は CacheService (揮発。飛べば 1 回だけ再利用できる) | D1 `used_states` (永続) | 厳密になる方向 |
| 連投判定は末尾 500 行 (`RATE_SCAN_ROWS`) を走査、`LockService` で直列化 | ユーザーの行を索引で直接引く。`INSERT ... SELECT ... WHERE 条件` の条件付き挿入で直列化 (`db.ts`) | 500 行より前の自分の行も見えるが、60 秒 / 当日 の条件では実質同じ |
| `LAST_OAUTH_ERROR` (グローバル) | ハンドラの返り値 (`HandlerResult.note`) で失敗ログに渡す | 同時リクエストで混ざらない |
| `Utilities.formatDate(..., 'Asia/Tokyo')` | 固定オフセット `TS_OFFSET` (+09:00) | JST は DST が無いので同じ。北米 env は固定オフセットにするか UTC にするか要決定 |
| シートのセルが日時値になった場合の保険 (`isoOf_` / `parseTimestamp_` の Date 分岐) | 不要 (`ts` は TEXT、`ts_ms` は INTEGER) | — |
| 応答は POST のみ | 加えて `GET /api/export/*`、`POST /api/<action>`、`OPTIONS`、CORS `*`、body 64 KB 上限 | 既存クライアントには影響なし |
| `setup.gs` (シート作成 / 設定確認) | `migrations/` と `wrangler d1` コマンド、`wrangler deploy --dry-run` | 手順は上記 |
| エクスポート鍵は導出鍵のみ | 導出鍵 + 任意の `EXPORT_KEY` | 追加のみ |
| 公開データは gh-pages (`DATA_BASE_URL`) 固定 | `DATA_ORIGIN` var (URL か `assets:<prefix>`) | 既定は gh-pages のままなので判定の鮮度は同じ。R2 に移すと nightly と同時に更新される |

## 挙動の要点 (GAS と同じ)

- INV-1: 保存する uid / slug / gamerTag は start.gg の `currentUser` 由来のみ (`vote` はトークンの中身 = login 時の currentUser)。
- INV-2/4: currentUser が取れなければ何も書かない。access token / code / secret はログにも保存にもレスポンスにも出ない。
- INV-8: `*/callback.html` の応答に `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'` と `Referrer-Policy: no-referrer` を付ける (`run_worker_first` で Worker を通す)。他のアセットは `assets/_headers` のヘッダだけ。
- 失敗は `errors` に `source/action/code/user_id/note` だけ残す (`begin_login` / `export_*` / `client_error` 自身の失敗は残さない)。
