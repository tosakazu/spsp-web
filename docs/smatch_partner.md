# スマッチとの連携

スマッチ (smatch-jp.com、オンラインのレート対戦サイト) と、1 日 1 回お互いの一覧を受け渡す (2026-11-15〜)。
人をつなぐ鍵は start.gg の discriminator (`start.gg/user/<discriminator>`)。どちらのサイトも start.gg の連携は OAuth。

- スマッチ: マッチングしたときやプロフィールに SPSP の全国順位を出す
- SPSP: プレイヤーページにスマッチのレートを出す (本人がプロフィール編集で消せる。最初は出す)

## SPSP → スマッチ

`GET https://spsp.games/api/partner/smatch/players`、ヘッダ `Authorization: Bearer <トークン>`。

```json
{ "version": 1, "generated_at": 1794700000, "counted_at": "2026-11-15", "ranked_total": 22080,
  "url_template": "https://spsp.games/jp/p/?d={discriminator}",
  "players": [ { "discriminators": ["a1b2c3d4"], "rank": 35, "characters": ["マリオ"] } ] }
```

- `players` は discriminator が分かっている選手だけ。`discriminators` は 1 つ目が今のアカウント、2 つ目以降は統合済みの旧アカウント。
- `rank` = 総合評価の全国順位 (付いていなければ `null`)。`characters` = オフラインの使用キャラ (日本語名、多い順、空のこともある)。
- `counted_at` (集計日)・`ranked_total` (順位の付いている人数)・`url_template` (プレイヤーページの URL) は全員共通なので先頭に 1 つ。
- 中身は SPSP で公開済みの情報だけ。ビルド (spsp-build) が `data/partner_smatch.json` を書き、Worker はトークンを確かめてそのまま返す。

## スマッチ → SPSP

SPSP の Worker が 1 日 1 回 (日本時間 5〜20 時の間) `SMATCH_IMPORT_URL` を `Authorization: Bearer <トークン>` で読む。

```json
{ "version": 1, "generated_at": 1794700000, "season": { "id": 12, "name": "シーズン12" },
  "url_template": "https://smatch-jp.com/user/{smatch_id}/",
  "players": [ { "discriminator": "a1b2c3d4", "smatch_id": 123, "name": "名前", "max_hidden": false,
      "modes": { "1on1":    { "rate": 1650, "rank": 120, "season_max": 1700, "max": 1720, "games": 84 },
                 "tokuoma": { "rate": 1500, "rank": 40,  "season_max": 1510, "max": 1600, "games": 12 } } } ] }
```

- `rate`・`rank`・`season_max`・`games` (対戦数) は今のシーズン (対戦していなければ `null`、`games` は 0)、`max` は全シーズンの最高。今シーズンの対戦数が 0 のルールはページに出さない (`games` が無い古い形では `rate` が `null` のルール)。ルールごと (`1on1`・`tokuoma` = 特おま)。対戦したことのないルールは欄ごと無くてよい。
- `max_hidden` = スマッチで「最高レートを見せない」設定。その人の `season_max`・`max` は D1 にだけ置き、ページには出さない。
- 知らない欄は無視する。1on1 だけの古い形 (`rate`・`rank`・`max_rate` を 1 人の直下に置く) も読める。

### 取り込みの決まり (worker/src/api/smatch.ts)

- 読めない (200 以外)・JSON でない・形が違う (1 人でも)・人数が前回の半分未満 → 何も書かず前の値を使い続ける。
- 一覧から消えた人 (連携を解除した人) は表示をやめる。D1 の行は消さない (`linked = 0`)。
- 取り込みが 7 日止まったら、古い値は表示しない。
- discriminator → SPSP の選手は `data/discriminators.json` と `data/user_merges.json` で引く (統合済みは統合先)。

## 止まったときに気づく

- `GET /api/partner/smatch/status` (だれでも読める。経過時間と件数だけ): 取り込みが最後に成功してからの時間・続けて失敗した回数、スマッチが最後に読みに来てからの時間。
- 外形監視 (tools/monitor/check.mjs、1 時間おき) がこれを見て、36 時間を超えたら失敗にする (GitHub がメールで知らせる)。
- 理由は D1 の `partner_sync.error` (`http_500`・`bad_shape:players[3].smatch_id`・`shrunk:130->4` など)。
- 今すぐ取り込み直す: `POST /api/partner/smatch/import` に `{ "key": "<EXPORT_KEY>" }`。

## 設定

| 名前 | 種類 | 中身 |
|---|---|---|
| `SMATCH_IMPORT_URL` | vars | スマッチの一覧の URL |
| `SMATCH_IMPORT_TOKEN` | secret | スマッチの一覧を読むトークン (スマッチが発行) |
| `SMATCH_EXPORT_TOKENS` | secret | スマッチが SPSP の一覧を読むトークン (SPSP が発行)。カンマ区切りで複数置ける (入れ替えの間は新旧 2 本) |

`SMATCH_IMPORT_URL` と `SMATCH_IMPORT_TOKEN` の両方があるときだけ、取り込みと表示が動く。D1 は `migrations/0030_smatch.sql`。

## 画面

- プレイヤーページ: 実績の上に「スマッチ」の欄 (見出し + ルールごとに 1 行) (site/js/smatch_view.js)。データは `GET /api/card` の応答の `smatch` (追加の通信なし)。
- プロフィール編集 (`p/profile`、src/pages/p_profile.js): スマッチのレートを出すかどうか。カードの編集とは別のページで、互いにリンクがある。入口はヘッダーの人型アイコンのメニュー (ログイン中) とカード編集で、プレイヤーページには置かない。
