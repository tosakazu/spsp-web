# 下位クラス (Bクラス・Cクラス…) を Challonge で開く — 設計

2026-09-30。start.gg の下位クラス機能が使いにくいので、本戦 (start.gg) の結果をもとに、下位クラスのトーナメントを
Challonge に作れるようにする。集計対象にしたものは smash_database が取得してランキングに入れる。

担当: フロント = spsp frontend セッション (このリポジトリの site/ と src/) / バックエンド = spsp backend セッション (worker/) /
取得 = spsp database セッション (tosakazu/smash_database)。

> **2026-10-01 変更 (ユーザー判断 (b))**: Challonge は TO の API キーではなく「Challonge でログイン」(SPSP の OAuth アプリ) で作る。
> 取得側はアプリの権限 (client credentials) で読むので、TO が自分のキーで作ったトーナメントは読めない (database セッションが実 API で確認)。
> 作成は Worker の `class_create` がまとめて行う (TO の確認 → Challonge v2.1 で作成・参加者追加 → D1 登録)。`class_register` は廃止。
> 流れ: `challonge_begin` (署名 state f=challonge、authorize URL を返す) → Challonge の許可 → `/callback.html` → `challonge_token`
> (Worker が code をトークンに交換。保存しない) → トークンはそのタブの sessionStorage だけ → ページに戻る。Redirect URI は
> `https://spsp.games/callback.html` と preview の `/callback.html`。スコープ = me tournaments:read/write participants:read/write matches:read/write application:organizer。
> 以下の 3・5・6 の「Challonge の API キー」「ブラウザから Challonge を呼ぶ」「class_register」は、この変更で置き換わった。

## 流れ

1. **TO がページを開く** (シーディングのメニュー →「下位クラス作成」、`/jp/class/`)
2. **入力する**
   - start.gg の API キー (その大会の admin であること)・Challonge の API キー。どちらも今のシード機能と同じく、その場で入力するだけ
     (SPSP には保存しない。start.gg のキーは下の登録のときだけバックエンドに渡し、バックエンドも保存しない)
   - 本戦の start.gg イベントの URL
   - 設定:
     | 項目 | 値 | 既定 |
     |---|---|---|
     | クラス名 | B / C / D / E | B |
     | 形式 | シングルエリミ / ダブルエリミ | シングル |
     | SPSP の集計対象にする | する / しない | する |
     | 対象の順位 | 何位から何位まで (下限は空欄 = 最下位まで) | 例: 9 位〜 (下限なし) |
     | シード | ランダム / 本戦の結果 (同率はランダム) / SPSP の順位 | 本戦の結果 |
3. **フロント (ブラウザ) が start.gg に確認・取得する** (start.gg の API キーで)
   - TO か: `currentUser { id }` と、イベントの大会の `admins { id }` (と `owner { id }`) に自分が入っているか。
     入っていなければ **エラーで終わる**
   - 本戦の結果: そのイベントの standings (順位) と sets (直対)。**開催途中でもよい** (順位が決まっている人だけが対象になる)
4. **フロントが対象とシードを決める**
   - 対象 = 本戦で「対象の順位」に入った人 (順位が未確定の人は入れない)。DQ は除く
   - シード: ランダム / 本戦の順位順 (同じ順位の中はランダム) / SPSP の総合順位順 (順位の無い人は後ろにランダム)
5. **フロントが Challonge にトーナメントを作る** (Challonge の API キーで。Challonge の API はブラウザから呼べる = CORS 可)
   - `POST https://api.challonge.com/v1/tournaments.json`: 名前 = 「<本戦の大会名> <クラス名>」、形式、ゲーム = Super Smash Bros. Ultimate
   - `POST .../participants/bulk_add.json`: 参加者名 = **「start.gg の名前 (discriminator)」**、seed、`misc` = `startgg:<start.gg のユーザー ID>`
     (取得側が start.gg の選手と確実に結びつけるため)
6. **フロントがバックエンドに登録する** (下の `class_register`)。成功したら Challonge の URL を TO に見せる

## バックエンド (Worker) — spsp backend セッション

### `POST /api {action:'class_register', ...}`

```json
{
  "action": "class_register",
  "startgg_token": "<TO の start.gg API キー。確認にだけ使い、保存しない>",
  "parent_event_id": 1234567,
  "class_letter": "B",
  "name": "篝火#15 Bクラス",
  "challonge": { "id": 12345678, "url": "https://challonge.com/xxxx" },
  "format": "single",
  "counted": true,
  "place_min": 9, "place_max": null,
  "seeding": "main_result",
  "entrant_count": 32
}
```

- **本人確認をサーバでもう一度やる** (ページを通さずに直接送られても、TO でなければ登録できないように):
  start.gg GraphQL に `startgg_token` で `currentUser { id }` と `event(id: parent_event_id) { tournament { id owner { id } admins { id } } }` を問い合わせ、
  自分が owner か admins に入っていなければ `not_admin`。**キーは保存もログにも残さない**
- 保存 (D1 `class_brackets`、マイグレーション 0003): id, created_at, parent_event_id, parent_tournament_id, class_letter, name,
  challonge_id, challonge_url, format, counted, place_min, place_max, seeding, entrant_count, registered_by (start.gg のユーザー ID),
  status (`waiting` = 取得待ち / `done` = 取得済み)
- 検証: class_letter は B〜E、format は single / double、seeding は random / main_result / spsp、place_min ≥ 1、place_max は null か ≥ place_min、
  challonge.url は `https://challonge.com/` で始まる、同じ challonge_id の二重登録は `duplicate`
- レート制限は投票・カードと同じ仕組み (1 人 1 分に数回)
- 応答: `{ok:true, id}` / `{ok:false, error:{code: 'not_admin' | 'bad_request' | 'duplicate' | 'rate_limited' | 'startgg_error'}}`

### 取得待ちの一覧 (smash_database が読む)

- `GET /api/class_waitlist` → `{ok:true, items:[{id, parent_event_id, parent_tournament_id, class_letter, name, challonge_id, challonge_url, created_at}]}`
  (`counted = 1` かつ `status = 'waiting'` のもの)。中身は公開してよい情報だけ (キーは無い)
- `POST /api {action:'class_done', key, id}` → status を `done` に (取得側が取り終えたら呼ぶ。`key` は取得側だけが持つ秘密 = Worker の secret と
  smash_database の Environment の secret)

## 取得 (smash_database) — spsp database セッション

- いつもの取得のときに `GET https://spsp.games/api/class_waitlist` を読み、各 Challonge トーナメントを Challonge の API で取得する
  (取得用の Challonge API キーは smash_database の Environment `japan-data` の secret)
- Challonge の participants の `misc` (`startgg:<ID>`) で start.gg の選手に結びつけ、既存の下位クラスと同じ形
  (親 = `parent_event_id`、クラス = `class_letter`、is_lower_class) のイベントとして保存する
- トーナメントが終わったら (Challonge の `state = complete`) 最後に取得して `class_done` を呼ぶ。途中なら次回また取得
- 取得した結果が、ビルドの既存の下位クラスの扱い (本戦から切り出した仮想大会と同じ集計) に乗るようにする

## 確認のしかた

- 本番に触れない: spsp-web はブランチ `feat/class-bracket` (フロント) と `feat/class-bracket-backend` (Worker)。preview 環境
  (spsp-web-preview.tosakazu.workers.dev、D1 `spsp-preview`) で確かめる。D1 のマイグレーションは `spsp-preview` にだけ当てる
- smash_database は本番の取得に入れる前に、テスト用の Challonge トーナメントで取り込みを確かめる
