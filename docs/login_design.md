# ログイン機能 (start.gg 認証) — 設計

2026-09-30。キャラ投票とプレイヤーカードの編集を、共通のログインを通して行えるようにする。

## 方針

- ログインは今の仕組み (start.gg の OAuth → Worker が署名したセッショントークン) をそのまま使う。
  SPSP 側にアカウントやパスワードは持たない。
- ユーザー名・アイコンなどは start.gg のものをそのまま表示するだけで、こちらでは管理しない (ユーザー表を作らない)。
- ログインした人 = start.gg のユーザー。SPSP の選手 ID (uid) は start.gg のユーザー ID と同じなので、
  「本人か」は `token の uid == ページの選手の uid` で判定する。
- 本番 (spsp.games、Worker `spsp-web`、D1 `spsp`) には触れない。作業と確認は preview 環境だけで行う
  (下の「確認のしかた」)。

## いまの仕組み (変えない部分)

| 段階 | 誰が | 内容 |
|---|---|---|
| 1 | ページ | `POST /api {action:'begin_login', flow:'login'|'post', nonce, returnPath}` → 署名つき `state` |
| 2 | ページ | start.gg の authorize へ移動 (`oauth_state.buildAuthorizeUrl`) |
| 3 | callback.html | `POST /api {action:'login', code, state}` → `{token, user:{id, slug, gamerTag}, exp}` |
| 4 | callback.html | `localStorage.spsp_session_v1` に保存 (`js/auth.js`)、`returnPath?login=1` へ戻る |

- token は HMAC 署名 (worker/src/api/session.ts)、有効期限 180 日 (`SESSION_TTL_MS`)。サーバ側に状態は持たない。
- 戻り先 (`returnPath`) はサイトのベース (`/jp/` など) 配下だけ許可 (INV-7、`oauth_state.safeReturnPath`)。
- キャラ投票は `action:'vote'` に token を付けて送り、Worker が token を検証して投票者を決める。

## フロントエンド

### 共通のログイン (新規 `site/js/login.js`)

各ページがばらばらに持っている「ログインを始める」処理をまとめる。

```
session()            今のセッション (js/auth.js の load。無ければ null)
startLogin()         start.gg へ (戻り先 = 今のページ)。投票・編集・ヘッダーのどこからでも同じ
logout()             セッションを消す (サーバ側は状態を持たないので、ブラウザから消すだけ)
verify()             起動時に 1 回 /api の me でトークンを確かめる。無効 (鍵の入れ替え・期限切れ) なら消す
isSelf(uid)          ログインしている人がこの選手か
onChange(fn)         ログイン状態が変わったとき (別タブのログアウトも storage イベントで拾う)
```

### ヘッダー (nav.js の人型アイコン)

いまは「キャラ投票」への 1 行だけのメニュー。これをアカウントのメニューにする。

- **ログアウト中**: [start.gg でログイン] / キャラ投票
- **ログイン中**: アイコンの代わりに頭文字の丸 + メニュー
  - 名前 (start.gg の gamerTag、小さく)
  - マイページ (自分のプレイヤーページ。選手でなければ出さない)
  - カードを編集 (同上)
  - キャラ投票
  - ログアウト

### キャラ投票 (vote.html)

- 画面の流れは今のまま。「ログイン」ボタンは共通の `startLogin()` を使う。
- すでにログインしていれば (ヘッダーからログイン済みでも) ログインの段は飛ばす (今も localStorage を見ているので動きは同じ)。

### プレイヤーカードの編集 (p/edit.html)

- ログアウト中: カードのプレビューと [start.gg でログイン]。
- 本人以外でログイン中: 「本人のアカウントでログインしてください」。
- 本人: 編集できる。途中の状態はブラウザに自動保存 (下書き)。**「適用」でサーバに保存** (`card_put`)。
- 開いたとき: サーバの設定 (`card_get`) → 下書きがあれば下書きを上に重ねる。

### プレイヤーページ (p/)

- カードの設定をサーバから読む (`GET /api/card?uid=`)。無ければ既定 (自動) のカード。読めなくても既定で出す (カードの表示を止めない)。

## バックエンド (Worker) に足すもの

エンドポイントは今と同じ `/api`。既存の `begin_login` / `login` / `vote` は変えない。

### 1. `me` — トークンの確認

```
POST /api  {action:'me', token}
→ 200 {ok:true, user:{id, slug, gamerTag}, exp}
→ 200 {ok:false, error:{code:'invalid_session'}}   (無効・期限切れ)
```
- token の中身を返すだけ (start.gg には問い合わせない)。

### 2. カードの設定

保存するもの (フロントの `CardSettings`、js/player_card_model.js):

```json
{ "template": "standard", "color": "red", "ach": ["tour:{\"name\":\"篝火#15\",...}", "..."] }
```

| 欄 | 検証 |
|---|---|
| template | `standard` のみ (増えたらサーバの表も増やす) |
| color | `red` `blue` `green` `purple` `orange` のどれか |
| ach | null、または文字列の配列 (0〜12 個、各 300 文字以内、重複なし)。中身 (実績の key) はサーバでは解釈しない |

**読む (だれでも)**

```
GET /api/card?uid=<uid>
→ 200 {ok:true, settings:{...} | null, updated_at:"..." | null}
Cache-Control: public, max-age=60
```

**書く (本人だけ)**

```
POST /api  {action:'card_put', token, settings}
→ 200 {ok:true, settings, updated_at}
→ 200 {ok:false, error:{code:'invalid_session' | 'bad_settings' | 'rate_limited'}}
```
- 書き込む uid は **token の uid** (リクエストに uid を持たせない = 他人のカードは書けない)。
- 既定に戻す: `settings: null` を送ると行を消す。
- レート制限は投票と同じ仕組み (`ratelimit.ts`) で、1 uid あたり 1 分に数回程度。

**D1 (マイグレーション `0002_card_settings.sql`)**

```sql
CREATE TABLE card_settings (
  uid        INTEGER PRIMARY KEY,   -- start.gg のユーザー ID = SPSP の選手 ID
  settings   TEXT NOT NULL,         -- JSON (上の形)
  updated_at TEXT NOT NULL          -- ISO 8601 (+09:00)
);
```

### 3. その他

- `/api/card` (GET) は `run_worker_first` の `/api/*` に入るので、wrangler.toml の変更は要らないはず。
- エラー記録 (`errlog.ts`) は `card_put` の失敗も今の仕組みで残す。

## 確認のしかた (本番に触れない)

- **spsp-web の main に push しない** (push すると Actions が本番へデプロイする)。作業はブランチで。
  - フロント: `feat/login` (このブランチ。プレイヤーカードの作業 `feat/player-card` の上)
  - バックエンド: `feat/login-backend` (worktree を分けて、`worker/` と `worker/migrations/` だけを触る)。できたら `feat/login` に merge する
- preview 環境 (本番とは別の Worker・D1・start.gg アプリ):
  - URL: https://spsp-web-preview.tosakazu.workers.dev/jp/
  - D1: `spsp-preview` にだけマイグレーションを当てる
    (`npx wrangler d1 migrations apply spsp-preview --env preview --remote`)。`spsp` (本番) には当てない
  - デプロイ: `npm run build:cf:preview && npx wrangler deploy --env preview` (worker/ で)。
    **`--env preview` を付けない wrangler deploy は本番なので打たない**
  - start.gg の OAuth は preview 用のアプリ (client 620、戻り先は preview の callback) なので、そのままログインできる
- ConoHa のプレビュー (conohawing.com) は API が無いのでログインできない。見た目の確認用として残す。

## 受け入れの確認

1. preview でヘッダーからログイン → 元のページに戻り、ヘッダーに名前が出る
2. 自分のプレイヤーページ → 編集 → 色と実績を変えて「適用」→ プレイヤーページのカードに反映 (別のブラウザで見ても同じ)
3. 他人の編集ページでは編集できない。`card_put` に他人の設定を送っても自分の行しか変わらない
4. キャラ投票: ヘッダーでログイン済みなら、投票ページでログインを求められない
5. ログアウト → ヘッダーがログアウト中の表示に戻る。別タブにも反映
