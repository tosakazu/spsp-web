# spsp 投稿機能 設計書

> ユーザーから受領した設計 (2026-08-13)。実装はこれに従う。
> 実装時に確定した事項・設計との差分は末尾の「実装メモ」に追記する。
> デプロイ手順は [DEPLOY.md](DEPLOY.md)、テストは [tests/post/README.md](../tests/post/README.md)。
>
> **追加機能 (2026-08-14)**: 同じ GAS 受け口の上に
> §11 ログイン (選手認証) と §12 キャラ投票を実装済み。
> トーナメント結果予想は未着手 — 設計 TODO は
> [prediction_feature_todo.md](prediction_feature_todo.md)。

## 0. 概要

GitHub Pages 上の静的サイト https://tosakazu.github.io/spsp/ に、
start.gg OAuth 認証付きの簡易投稿機能を追加する。

- 認証: start.gg OAuth2 (authorization code flow)
- 投稿受付: Google Apps Script (GAS) Web アプリ
- 保存: 非公開 Google スプレッドシート
- 表示: ビルドサーバーが定期的にシートを読み静的 HTML を生成 (本設計書のスコープ外、
  ただしインターフェイスは §7 に定義)
- リアルタイム性は不要。投稿の反映は次回ビルド時でよい

## 1. 全体データフロー

1. ユーザーが投稿ページで本文を入力し「start.gg で認証して投稿」を押す
2. JS が本文と nonce を sessionStorage に退避し、start.gg 認可 URL へリダイレクト
3. ユーザーが start.gg で許可 → `callback.html` に `?code=...&state=...` 付きで戻る
4. `callback.html` が state 検証 → URL から code を即時除去 → code + 本文を GAS に POST
5. GAS が code + client secret でトークン交換 → access token 取得
6. GAS が `currentUser` を照会し、ユーザー名/slug/user id を取得
7. GAS が検証済みユーザー情報 + 本文 + メタデータをシートに append。token/code は破棄
8. GAS が成功レスポンス → `callback.html` が完了表示 → 元ページへ復帰

## 2. セキュリティ不変条件 (実装上の絶対条件)

- **INV-1**: シートに書き込まれるユーザー名・user id は、必ず GAS 内で
  `currentUser` API レスポンスから取得した値のみを使う。
  クライアントから送信されたユーザー名等の自己申告値をシートに書いてはならない。
- **INV-2**: `currentUser` 照会が失敗 (エラー、null) した場合、一切書き込まない。
- **INV-3**: client secret は GAS スクリプトプロパティのみに置く。
  リポジトリ、クライアント JS、ログ出力のいずれにも含めない。
- **INV-4**: access token / 認可 code はシートにもログにも保存しない。処理後破棄。
- **INV-5**: シートは非公開のまま。共有設定を変更するコードを書かない。
- **INV-6**: `callback.html` は code 取り出し後ただちに
  `history.replaceState` で URL からクエリを除去する。
- **INV-7**: state 内の戻り先パスは `/spsp/` 配下の相対パスのみ許可。
  絶対 URL・スキーム付き・`..` を含むものは拒否し `index.html` に戻す。
- **INV-8**: `callback.html` には外部リソース (アナリティクス、CDN、画像等) を
  一切置かず、`<meta name="referrer" content="no-referrer">` を設定する。

## 3. 設定値

| 名前 | 置き場所 | 値 |
|---|---|---|
| STARTGG_CLIENT_ID | クライアント JS 内定数 (公開可) + `gas/config.gs` | `{{CLIENT_ID}}` |
| STARTGG_CLIENT_SECRET | GAS スクリプトプロパティ (人間が GUI で投入) | 秘匿 |
| SHEET_ID | GAS スクリプトプロパティ | 人間が投入 |
| REDIRECT_URI | 双方の定数 | `https://tosakazu.github.io/spsp/callback.html` |
| GAS_ENDPOINT | クライアント JS 内定数 | デプロイ後に確定 |
| AUTHORIZE_URL | クライアント JS 内定数 | `https://start.gg/oauth/authorize` |
| TOKEN_URL | GAS 内定数 | `https://api.start.gg/oauth/access_token` |
| SCOPE | | `user.identity` |

GAS 側は `PropertiesService.getScriptProperties()` から
`STARTGG_CLIENT_SECRET` / `SHEET_ID` を読む。未設定なら明示的にエラーを返す。

## 4. リポジトリ構成

```
site/                     … GitHub Pages では /spsp/ 配下として配信される
  post.html               … 投稿フォームページ
  callback.html           … OAuth コールバック専用ページ
  js/post_config.js       … 設定値 (人間が実値を入れる唯一のファイル)
  js/oauth_state.js       … state の encode/decode・戻り先検証・本文検証 (共有・純粋)
  js/post.js              … フォーム処理・認可リダイレクト
  js/callback.js          … state 検証・GAS 送信・復帰
gas/
  .clasp.json             … clasp create-script が生成 (private リポジトリなのでコミット可)
  appsscript.json
  config.gs               … 定数とスクリプトプロパティ読み出し
  main.gs                 … doPost + ルーティング
  oauth.gs                … トークン交換・currentUser 照会
  sheet.gs                … シート append・連投/日次チェック
  setup.gs                … 初期化補助 (エディタから手動実行)
docs/
  DEPLOY.md               … デプロイ手順と人手作業の一覧
tests/post/               … node --test (一部 jsdom)
```

## 5. クライアント側仕様

### 5.1 post.html / post.js

- テキストエリア (本文、最大 1000 文字、クライアント側でもバリデート) と投稿ボタン
- 投稿ボタン押下時:
  1. `nonce = crypto.randomUUID()`
  2. sessionStorage に保存: `spsp_oauth_nonce` = nonce / `spsp_draft` = 本文
  3. `state = base64url(JSON.stringify({ n: nonce, r: 現在のパス+クエリ }))`
  4. AUTHORIZE_URL に `response_type=code`, `client_id`, `scope`,
     `redirect_uri` (encodeURIComponent 必須), `state` を付与してリダイレクト
- 復帰時 (クエリに `?posted=1` があれば) 完了メッセージを表示し、
  sessionStorage の下書きを消す

### 5.2 callback.html / callback.js

処理順を厳守:

1. `URLSearchParams` から code / state を取得
2. `history.replaceState(null, "", location.pathname)` — INV-6
3. state をデコードし、`n` が sessionStorage の nonce と一致するか検証。
   不一致・欠落なら「認証エラー」を表示して終了 (GAS に送らない)
4. sessionStorage から本文を取得。空なら「下書きが見つからない」を表示して終了
5. GAS へ POST (`Content-Type: text/plain;charset=utf-8` で CORS preflight 回避、
   `redirect: "follow"`、body = `{action, code, body}`)
6. レスポンス JSON の `ok` を確認
   - 成功: sessionStorage の nonce/draft を削除し、戻り先 `r` を INV-7 に従い
     検証して `location.replace(r + "?posted=1")`
   - 失敗: `error.message` を表示し、下書きは保持したまま元ページへのリンクを出す

画面には「投稿処理中…」のみ表示。外部リソース禁止 (INV-8)。

## 6. GAS 側仕様

### 6.1 appsscript.json

```json
{
  "timeZone": "Asia/Tokyo",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
```

### 6.2 doPost (main.gs)

- `e.postData.contents` を `JSON.parse` し、`action` でルーティング。現時点は `"post"` のみ
- 全レスポンスは `ContentService.createTextOutput(JSON.stringify(...))` +
  `.setMimeType(ContentService.MimeType.JSON)`
- 成功: `{ "ok": true, "user": "<slug>" }`
- 失敗: `{ "ok": false, "error": { "code": "<下記>", "message": "<日本語の短文>" } }`
- `error.code`: `bad_request` / `auth_failed` / `rate_limited` / `body_invalid` / `internal`
- 例外は握りつぶさず catch して `internal` で返す。スタックトレースや secret を
  レスポンスに含めない

### 6.3 handlePost の処理

1. 入力検証: code が非空文字列、body が 1〜1000 文字。
   HTML タグは除去しない (表示時にビルド側でエスケープする前提) が、制御文字は除去する。
   違反は `bad_request` / `body_invalid`
2. トークン交換: TOKEN_URL へ `UrlFetchApp.fetch` で POST。
   失敗 (非 200、access_token 欠落) は `auth_failed`
3. `currentUser` 照会: `https://api.start.gg/gql/alpha` へ `Authorization: Bearer` で
   `query { currentUser { id slug player { gamerTag } } }`。null やエラーは `auth_failed` (INV-2)
4. スパム制御: 同一 user id の直近投稿から 60 秒未満 / 当日 10 件以上は `rate_limited`。
   シート末尾から遡って判定する素朴実装
5. シート append (INV-1)
6. 成功レスポンス。token/code をスコープ外に残さない (INV-4)

### 6.4 ロック

書き込みとスパム判定は `LockService.getScriptLock()` で直列化する
(判定 → append の間の競合防止)。`waitLock(10000)`、取得失敗は `internal`。

## 7. シートスキーマ (ビルドサーバーとのインターフェイス)

シート名 `posts`、1 行目はヘッダ。列順:

| 列 | 内容 |
|---|---|
| A: timestamp | ISO 8601 (JST) |
| B: user_id | `currentUser.id` |
| C: user_slug | `currentUser.slug` |
| D: gamer_tag | `currentUser.player.gamerTag` (無ければ空) |
| E: body | 本文 (平文。エスケープはビルド側の責務) |
| F: status | 常に `pending` を書く (ビルド側/人間が `approved`/`rejected` に変更しうる) |

ビルドサーバーは status を見て表示可否を決められる。GAS は F 列を書くだけで読まない。

## 8. デプロイ

[DEPLOY.md](DEPLOY.md) を参照。

## 9. テスト

[tests/post/README.md](../tests/post/README.md) を参照。curl での結合確認手順は
DEPLOY.md に置く。

## 10. 非スコープ

- 投稿 (`posts`) のビルドサーバー側の生成処理 (§7 のスキーマだけ守ればよい)
  — キャラ投票 (`char_votes`) のビルド側だけは §12.1 で実装済み
- 投稿の編集・削除機能
- `clasp run` 環境の構築 (secret 投入は GUI で行う)

---

## 実装メモ (設計との差分・実装時に確定したこと)

実装 2026-08-13。差分はいずれも設計の意図を保ったままの補強。

1. **state は base64 ではなく base64url**。`+ / =` が `state=` クエリで壊れうるため。
   encode/decode が食い違うと認証が通らないので、両者を `js/oauth_state.js` に
   1 か所化した (設計の post.js / callback.js 分割はそのまま)。
2. **設定値は `js/post_config.js` に分離**。人間が実値を入れる場所を 1 ファイルに寄せるため。
   `client_id` は GAS 側でも token 交換に要るので `gas/config.gs` にも定数として持つ
   (公開値。secret ではない)。両者の食い違いは `tests/post/page.test.cjs` が検出する。
3. **正規配信元チェックを追加**。`site/` は spsp.games にも即配信されるが、そちらは
   検証・ビルド用でユーザーに露出させない。redirect_uri が GitHub Pages 固定なので
   spsp.games から認証を始めても必ず壊れる。post.js は
   `location.origin !== CANONICAL_ORIGIN` なら認可を始めず、正規 URL を案内する。
4. **callback.html に CSP を追加** (INV-8 の機械的な担保)。
   `default-src 'none'; script-src 'self'; connect-src script.google.com
   script.googleusercontent.com`。GAS はリダイレクト先が
   `script.googleusercontent.com` になるので両方必要。
5. **`error=access_denied` (start.gg 側で拒否) の分岐を追加**。設計には無いが、
   ユーザーが認可画面でキャンセルすると code 無しで戻ってくる。
6. **`?posted=1` は復帰表示のあと `replaceState` で落とす**。落とさないと
   次の投稿の `state.r` に `posted=1` が積み重なる。
7. **timestamp 列は書式なしテキストに固定**。Sheets が ISO 8601 文字列を日時値に
   変換すると、ビルド側が読む型が変わってしまうため。読み取り側は Date 値でも
   動くようにしてある (保険)。
8. **`setup.gs` にシート作成関数を用意**。人手作業を 1 つ減らすため
   (`setupCreateSheet()` を 1 回実行するとシート作成 + ヘッダ + SHEET_ID 登録)。
9. **token/currentUser の失敗ログはステータスコードのみ**。レスポンス本文には
   code が反射されうるため (INV-4)。

---

## 11. ログイン (選手認証) — 2026-08-14 追加

「start.gg OAuth で本人確認し、その結果をブラウザに保存してログインとする」機能。
なりすましは HMAC 署名で防ぐ (secret が漏れない限り偽造不可)。
将来的にユーザーごとに見せたい情報の出し分けに使う。

### フロー

1. ページ (vote.html 等) が `sessionStorage[spsp_oauth_intent] = 'login'` を置いて
   OAuth へ (nonce / state は post フローと同じ仕組み)
2. callback.html が intent を見て `action: "login"` { code } を GAS へ
3. GAS: token 交換 → currentUser 照会 (INV-1/2/4 は post と同じ) →
   **セッショントークン**を発行して返す。シートには何も書かない
4. クライアントは `localStorage[spsp_session_v1]` に保存。以後の action に添える

### セッショントークン

```
token   = base64url(payload) + '.' + base64url(HMAC-SHA256(payload部, SESSION_SECRET))
payload = { v:1, uid, slug, tag, iat, exp }     // exp = 発行から 180 日 (半年)
```

- `SESSION_SECRET` はスクリプトプロパティ。**無ければ初回に自動生成** (人手不要)
- 検証 (`verifySessionToken_`) は署名 → 期限の順。失敗は一律 `auth_failed`
- payload に access token や secret は入れない (テストで担保)

### レスポンス

```
成功: { ok:true, token, user:{id,slug,gamerTag}, exp }
失敗: post と同じ error 形式 (auth_failed / bad_request / internal)
```

## 12. キャラ投票 — 2026-08-14 追加

本人のメイン使用キャラ 1 体を報告する機能。`site/vote.html`。

**フロー (2026-08-14 改)**: 認証の前に選手を選ばせ、投票可否を先に見せる。

1. 未ログイン時はまず選手名で検索して自分を選ぶ (latest_tjpr_full.jsonl を検索)
2. その場で players/<uid>.json を見て可否を判定 (認証不要)。対象外ならここで理由を明示し、認証には進ませない
3. 対象なら「start.gg で本人確認して投票に進む」→ OAuth
4. 認証アカウントと選択した選手の一致を確認 (不一致は明示して止める。投票は常に認証した本人が対象)
5. 一致すれば投票フォーム。ログイン済みで来た場合は選択をスキップして自分の判定へ直行

選択は sessionStorage[spsp_vote_sel] で OAuth リダイレクトをまたいで保持する。

### 投票できる条件 (すべて。理由は UI とエラーメッセージの両方で明示)

1. 選手認証 (セッショントークン) が有効 — でなければ `auth_failed`
2. SPSP にデータがある選手 — でなければ `not_player`
3. **キャラ情報が無い**か、**ダブルメイン圏** (下記) — どちらでもなければ `char_exists`
   (キャラ情報は大会での使用データから自動集計されるため、メインが明確な人は対象外)

### ダブルメイン圏 (2026-08-14 追加)

メインキャラ判定スコア (`characters[].pct`) の**トップとの差が
`DOUBLE_MAIN_PCT_GAP` (= 0.20。当初 0.10、2026-08-14 に緩和) 以内のキャラが 2 体以上**いる選手は、
「どちらがメインか僅差」とみなして投票できる。ただし**その候補の中からのみ**
(候補外は `not_candidate`)。閾値は `gas/config.gs` / `site/js/post_config.js` /
`spsp/char_vote.py` の 3 か所に定義し、一致をテストで縛る。

判定の基準は **`pct` が最大のキャラ**であって `characters[0]` ではない
(ビルドが投票の採用で並びを変えるため)。また **`pct` を持たないエントリは
使用実績として数えない** (= ビルドが投票で足したもの。数えてしまうと一度投票した人が
二度と直せなくなる)。この 2 点は GAS (`voteCandidates_`) とクライアント
(`vote.js voteCandidates`) とビルド (`char_vote.double_main_candidates`) で同一。

## 12.1 ビルド側 (2026-08-14 追加)

投票は**メインキャラの並び順**としてだけ効く。反映先が 3 つあるが、どれも
`characters[0]` を主として読むので、`char_usage` の並びを直せば全部追随する:

| 反映先 | 読んでいる場所 |
|---|---|
| プレイヤーページの使用キャラ行 (先頭が赤字) | `site/p/index.html` |
| ランキング行のメインキャラ絵文字 | ビルドの `spsp.overlay._build_main_char` が ID を出し、`js/char_emoji.js` が表で引く |
| 使い手ランキング (`c/index.html`, `c/ranking.html`) | `v4/char_index.build_character_index` |

経路:

```
char_votes シート (非公開)
  └ action="export_votes" (gas/export.gs, 鍵は client secret から導出)
      └ spsp/cli/fetch_char_votes.py     → build/data/char_votes.json
          └ v4/char_vote.apply_char_votes  (build_v4_full.py の learn フェーズ、
             compute_char_usage の直後)
```

**採用規則** (uid ごと。最新行を見る):

| 使用データの状態 | 採用 |
|---|---|
| characters 空 (= 使用実績なし) | 投票を採用 (`pct` 無しのエントリを 1 つ作る) |
| ダブルメイン圏 (候補 ≥ 2) かつ投票が候補内 | 投票したキャラを先頭へ (メインの選定だけ決める) |
| **圏を超えて明確なメインが出た / 投票が候補外** | **使用データを採用 (投票は無視)** |

つまり投票は「使用データで決めきれない部分」だけを埋める。後から大会での
キャラ使用の結果が積み上がって判定が明確になったら、常に使用データが勝つ。
却下する側でも「使用率最大のキャラを先頭に」を明示的にやり直すので、
前回ビルドの並びを食わせても投票が固定化しない。

- **投票由来のエントリは `pct` キーを持たない** (`null` ではなく**キーごと無い**)。
  `pct: null` にすると JS 側で `Number(null) === 0` が有限値として通り、
  使用率 0% の実績があるものとして扱われてしまう。
- 使用率が無いので、使い手ランキングの「使用率」列は **自己申告** と表示し、
  並びは実績ありの後ろになる。プレイヤーページでは tooltip で示す。
- `status`: `pending` / `approved` は採用、`rejected` と `debug` は採用しない。
  **最新行が `rejected` なら、その uid は投票なし扱い** (前の行には戻さない)。
- **取得は既定で差分**。手元の最新タイムスタンプを `since` として渡し、それ以降の行
  だけ受け取って既存分にマージする。境界は「以降」(>=) なので、同じ秒に複数人が
  投票しても取りこぼさない (重複は `(ts, user_id, char_id)` で畳む)。同じ行が差分に
  含まれていたら新しく取ったほうで上書きするので、`since` 以降の `status` 変更も拾う。
- 全件取り直すのは 3 つの場合だけ: `--full` 指定 / 手元にファイルが無い /
  **シートの行数が前回より減っていた** (= 行が消された。差分では削除を追えない)。
  行数は API が `total` として毎回返す。
- `build/data/char_votes.json` は生成物で **git 管理外** (`.gitignore` の `data/`)。
  正はシート。取得に失敗したときは前回取得分のまま進み、ビルドログに古い
  `fetched_at` が出る。

- 資格判定は **クライアント (表示用) と GAS (確定用) の両方**で行う。
  GAS は `DATA_BASE_URL` (= gh-pages) の `players/<uid>.json` を読む
  (404 = 選手でない / `characters` 非空 = 対象外)。
- キャラの正当性は `data/char_emoji.json` に対して検証 (`bad_char`)。
  Random 等の集計対象外キャラはそもそも一覧に無い。
- 資格がある間は再投票可。**ビルド側は uid ごとに最新行を採用する** (§12.1)。
- 連投制限は posts と同じ規則を char_votes シートに対して適用 (シート独立)。

### シート `char_votes`

| 列 | 内容 |
|---|---|
| A: timestamp | ISO 8601 (JST) |
| B: user_id / C: user_slug / D: gamer_tag | トークン (= currentUser) 由来のみ (INV-1) |
| E: char_id | char_emoji.json のキー |
| F: char_name | 表示名 (投票時点のもの) |
| G: status | 常に "pending" (ビルド側/人間が変更しうる) |

### リクエスト / レスポンス

```
{ "action": "vote", "token": "<セッショントークン>", "charId": "1305" }
成功: { ok:true, user:"<slug>", charId, charName }
失敗コード: auth_failed / bad_request / bad_char / not_player / char_exists /
            not_candidate / rate_limited / internal
```

### デバッグモード (撤去済み)

`vote.html?debug=1` で認証・資格判定を飛ばして投票できるモードがあったが、
ページの公開 (2026-08-14) に合わせて **クライアント・GAS・テストから撤去した**。
公開ページに認証を飛ばせる経路を残さないため。

- 過去に書かれた `status='debug'` の行はシートから削除済み (2026-08-14)。
- ただし除外は残してある: `gas/export.gs` は debug 行を返さず、
  `v4/char_vote.py` の `ADOPTABLE_STATUS` にも debug は入らない。
  `tests/post/gas_vote.test.cjs` が「debug 系フィールドを送っても効かない」ことを縛る。

### ファイル

- `site/vote.html` + `site/js/vote.js` — 投票ページ
  (2026-08-14 公開。ナビ = ヘッダのベルの隣の人型アイコン「選手向けメニュー」)
- `site/js/auth.js` — セッションの保存/読み出し (post/vote/callback で共有)
- `gas/session.gs` — トークン発行/検証 + handleLogin_
- `gas/vote.gs` — 資格判定 + handleVote_
- `gas/export.gs` — ビルド向けエクスポート (`export_votes`, 鍵は client secret から導出)
- `spsp/cli/fetch_char_votes.py` — 取得 → `build/data/char_votes.json`
- `spsp/char_vote.py` — 採用規則 (`build_v4_full.py` から呼ぶ)
- callback.js の login 分岐、oauth_state.js の INTENT_KEY / withFlag
