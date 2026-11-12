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
- 本人: 編集できる。途中の状態はブラウザに自動保存 (下書き。表も裏も。間違えて閉じても続きから)。**「適用」でサーバに保存** (`card_put`、表と裏をまとめて)。
- 開いたとき: サーバの設定 (`card_get`) → 下書きがあれば下書きを上に重ねる。
- 表と裏はタブで切り替える (`?tab=back` で裏から。プレイヤーページの編集ボタンはカードが裏を向いていれば裏から)。
  裏 = 英字名 (`latin`) と大会シール (`back`、src/pages/card_back_edit.js)。裏は日本版だけ (region config `features.cardBack`、北米は false: タブも裏返しも出さない)。
- preview の Worker (`spsp-web-preview.*.workers.dev`) だけは、ログインなしで誰のカードでも編集・適用できる (見た目の確認用)。
  フロントは js/login.js `openEdit()` (ホスト名で判定)、サーバは `[env.preview.vars] CARD_OPEN_EDIT = "1"` のときだけ `card_put` に `uid` を受ける。
  **本番の vars (トップレベル・`[env.na.vars]`) には置かない** (worker/test/card.test.mjs が「cardOpenEdit が無ければ uid 指定は invalid_session」を確かめる)。

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
{ "template": "standard", "color": "red", "ach": ["tour:{\"name\":\"篝火#15\",...}", "..."], "tour": null,
  "title": {"pre": "default", "post": "ja-0001"}, "latin": null,
  "back": { "stickers": [{"e": "1724470B:g", "x": 100, "y": 50, "s": 120, "r": -10, "k": "circle", "c": 0.6}], "text_top": false, "outline": true } }
```

| 欄 | 検証 |
|---|---|
| template | `standard` のみ (増えたらサーバの表も増やす) |
| color | `red` `blue` `green` `purple` `orange` `teal` `yellow` `gray` のどれか (2026-10-01 に 3 色追加) |
| ach | null、または文字列の配列 (0〜12 個、各 300 文字以内、重複なし)。中身 (実績の key) はサーバでは解釈しない |
| tour | null (自動)、または大会の event_id |
| title | null (既定)、または `{pre, post}` (二つ名の id / null =「なし」/ `default`)。一覧にあり、その位置に使え、持っているものだけ |
| latin | null (自動)、または裏面の英字名 (半角英数と ! ? . - _ ' & + と空白、45 文字まで) |
| back | 無し (貼っていない)、または裏面の大会シール: `stickers` (50 枚まで)・`text_top` (名前・二つ名・順位をシールの上に)・`outline` (その文字に影。前は縁取りで、キーの名前はそのまま)。シール 1 枚 = `e` キー (`<event_id>[クラスの文字]:<r\|g\|s\|n>`、虹・金・銀・素)、`x` `y` 中心 (カードの座標 514×333 の中)、`s` 一辺 (22〜520)、`r` 回転 (-180〜180)、`k` 形 (square / round / circle / hex / diamond)、`c` 切り取り (0.35〜1)。数は小数 1 桁 (c は 2 桁) に丸める。**持っているシールだけ**: 選手のデータ (`players/<uid>.json` の大会記録の `sticker` = もらった一番上の色、spsp_scripts spsp/stickers.py) と突き合わせ、一番上の色以下なら持っている。読めないときは保存しない。シールも文字の設定も無ければ欄ごと無し |

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
→ 200 {ok:false, error:{code:'invalid_session' | 'bad_settings' | 'rate_limited' | 'title_not_owned' | 'sticker_not_owned' | 'internal'}}
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

## 大会運営ツールの start.gg ログイン (2026-10-28)

シード作成・シードアップロード・下位クラス作成は、API キーの代わりに start.gg のログインでも使える (どちらでも選べる)。

| 段階 | 誰が | 内容 |
|---|---|---|
| 1 | ページ | `POST /api {action:'manager_begin', nonce, returnPath}` → scope `user.identity tournament.manager` の認可 URL (state は `f:'manager'`) |
| 2 | callback.html | `POST /api {action:'manager_login', code, state}` → `{token, user, exp, access_token, expires_in}` |
| 3 | callback.html | 普段のセッションと、start.gg のアクセストークン (`localStorage.spsp_startgg_manager`、期限つき) を保存 |

- 普段のログイン (`login`) と投稿 (`post`) は `f:'manager'` の state を受けない (scope が違う)。`manager_login` も他の flow の state を受けない。
- アクセストークンは Worker が交換して返すだけで、保存しない・ログに出さない。期限は start.gg の `expires_in` (7 日)。
- 画面は `site/js/startgg_manager.js` の `mount` (「start.gg でログイン | API キー」の切り替え・ログアウト)。
  ログインと選んだ方は localStorage なので 3 ページで共通 (別のタブにも効く)。API キーを保存している人には 1 回だけ案内を出す (既定は API キーのまま)。
- callback は、運営用ログインと Challonge のログインを **ログインを始めたブラウザ (nonce を持っている) でだけ** 処理する。
  開いたリンクを先に確かめるセキュリティ製品の自動ブラウザが、本人より先に callback を開いて code を使ってしまう例があったため
  (2026-10-28、preview)。普段のログインは nonce が無くても続ける (アプリ内ブラウザから別のブラウザに戻される経路のため、今までどおり)。

### 使用記録 (D1 `tool_logs`、migrations/0009、2026-10-28)

どの大会を、どのユーザーが、SPSP のどの機能で操作したかを残す。トークン・API キーは入れない。

| 機能 (`tool`) | 操作 (`action`) | 書くのは | ユーザー |
|---|---|---|---|
| `seed` (シード作成) / `seed_upload` (シードアップロード) | `seeding` | start.gg への書き込みが成功したあと、ブラウザが `POST /api {action:'tool_log', op:'seeding', …}` (`site/js/tool_log.js`) | ログイン: SPSP のセッションで確かめる (`verified 1`) / API キー: そのキーで start.gg の currentUser を取って申告 (`verified 0`) |
| `class` (下位クラス作成) | `create` / `delete` | `class_create` / `class_delete` が成功したときに Worker が書く (大会名などはブラウザが `log` に入れる) | start.gg で確かめた TO (`verified 1`) |

- `detail` (JSON): シードは基準・被り回避 (反映したか・`so-*` の設定すべて)・手動の並べ替え (回数)・シード指定と固定 (件数)・フェーズを作ったか・CSV。下位クラスはクラス・形式・順位の範囲・Challonge。
- 1 人 1 日 300 件まで (`TOOL_LOG_MAX_PER_DAY`)。記録に失敗しても操作は成功のまま。
- 読むときは `wrangler d1 execute spsp --remote --command "SELECT … FROM tool_logs ORDER BY id DESC LIMIT 50"`。

## ログインの引き継ぎ (2026-11-05)

iPhone のアプリ内ブラウザ (Discord などの SFSafariViewController) でログインを始めると、start.gg のユニバーサルリンクでアプリを経て
`redirect_uri` が Safari 本体で開くことがある (callback に nonce が無い = errors の `state_missing ios-safari`、週 66 回中約 30 回)。
保存領域が別なので始めた画面は未ログインのまま、もう一度ログインすることになっていた。

- 始めた画面 (js/login.js `startLogin`) が 256 bit の乱数 s を localStorage `spsp_login_handoff` に置き、`h = SHA-256(s)` (base64url 43 文字) を
  `begin_login` の `handoff_h` で渡す。Worker は h を署名つき state (`payload.h`、普段のログインだけ) に入れる。
- callback に nonce が無い (別のブラウザ) ときだけ、「ログインを続ける」を押したあと `login` に `handoff: true` を付ける。Worker はログインを済ませ、
  結果 (セッション・start.gg のトークン) を AES-GCM で暗号化して D1 `login_handoffs` に h をキーに置く (15 分・取り出したら消す、migration 0027)。
- 始めた画面は戻ってきたとき (読み込み・表示・focus・表示中は 5 秒おき、最長 45 分) に `login_handoff { s }` で取りに行く。Worker は SHA-256(s) で
  引き当てて返し、その場で消す。まだ無ければ `{ pending: true }`。
- URL・state に載るのは h だけ。callback の URL が漏れても s が無いので取り出せない。始めた画面で戻ってきた通常のログインはサーバに何も置かない。
