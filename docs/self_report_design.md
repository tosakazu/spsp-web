# 選手による試合結果の報告 (設計)

2026-10-29。運営の「結果報告」権限と選手の普段のログインを組み合わせ、選手が自分の試合の結果を SPSP から start.gg / Challonge に報告する。

## 1. 決まっていること (2026-10-29)

- 案 B: 運営が大会ごとに `user.identity tournament.reporter` で 1 回ログインし、そのトークンを Worker が暗号化して預かる。選手は普段のログイン (`user.identity`) のまま。
- 相手の承認は待たない。1 人目の報告ですぐ反映する。2 人とも送ってよい。
- 「同じ結果」は勝った側とゲーム数のスコアだけで比べる。キャラはその側の本人の入力を正とする。
- 食い違ったら反映を一度取り消し (start.gg `resetSet` / Challonge reopen)、両者の報告がそろうのを待つ。両者に知らせる。
- 次の試合に結果が出るまでは、運営が SPSP から直せる・取り消せる。出た後は自動で取り消さず「運営の確認待ち」にする。
- 不戦勝・DQ は選手は報告できない (ゲームが 1 つ以上必要)。運営が start.gg で入れる。
- キャラ・ステージを選べる (start.gg だけ。Challonge には欄が無いのでスコアだけ送る)。
- 報告は専用の URL (`/jp/report/?c=<受付>`) から。ログイン中は自分のプレイヤーページとトップのお知らせから行ける。
- 報告ページ: マッチングの通知とアニメーション → 台・配信台 → 相手のプレイヤーカードとシード。「勝ったら・負けたら」と「この大会のここまで」は畳んでおき、開くと出る。
- 試合待ちのあいだは次の相手の候補 (前の試合の選手、2 段まで) を出す。
- 運営の設定: トップ N からは運営が入力 (選手は報告できない)、下位クラスの試合だけ選手が報告。
- 下位クラス作成 (Challonge) のトーナメントでも同じことができる。

## 2. 流れ

```
運営  /jp/report/ (受付を始める) ─ start.gg (scope tournament.reporter) ─ callback.html (f=reporter)
        → action report_enable: 運営か確かめる (checkStartggAdmin) → トークンを暗号化して D1 report_events → /jp/report/?c=…&admin=1
      下位クラス作成の「結果報告」→ action report_enable_class (Challonge のトークンを暗号化して預かる)
選手  /jp/report/?c=…  15 秒ごと:
        start.gg: ブラウザが本人のトークンで event.sets(filters:{playerIds}) を読む (台 station・配信台 stream・前の試合 prereq も)
        Challonge: Worker が運営のトークンで読む (action report_view、Worker の cache 15 秒)
        D1 の報告の状態: action report_view
      送信 → action report_submit → Worker が set を読み直し、選手か・運営の設定・結果の形を確かめ、判定して start.gg / Challonge に送る
```

## 3. 権限とトークン

| 相手 | scope / 方法 | 置き場所 |
|---|---|---|
| 選手 | 普段のログイン `user.identity` (変更なし) | ブラウザ (js/startgg_identity.js) |
| 運営 (start.gg) | `user.identity tournament.reporter` (flow `reporter`) | D1 `report_events.token_enc` (AES-GCM、鍵 = HKDF(SESSION_SECRET))。access + refresh。期限 10 分前に延長 |
| 運営 (Challonge) | 下位クラス作成のログイン (Challonge OAuth) | 同上。延長はしない (切れたら受付し直し) |

- 受付の期限 = 大会の終わりの翌日の終わり (6 時間〜8 日に丸める)。Challonge は 2 日。期限切れ・停止でトークンを消す (`purgeReportTokens` を毎回の要求で実行)。
- トークンは応答・ログ・errors の note に出さない (テストで確認)。

## 4. 判定 (worker/src/api/report_logic.ts)

| 状況 | 処理 | 状態 |
|---|---|---|
| 1 人目 (結果なし) | report | reported |
| 2 人目が同じ | キャラを足す update | agreed |
| 2 人目が違う | reset | conflict |
| conflict の後、両者の最新がそろった | report | agreed |
| 本人が出し直した (勝者が変わる) | reset → report | reported |
| 次の試合に結果がある・運営が start.gg で別の結果を入れた | 何もしない | review |
| 運営が直した (fixed) | 選手の報告は記録だけ | fixed |
| 運営が取り消した | reset。その前の報告は数えない (floor_id) | reset |

- 同時の報告は `report_sets.version` で直列化する (D1 に書いてから送る。送れなかったら review + 理由)。
- 運営の設定: `top_cut` は start.gg の `lPlacement` (負けた人の順位) ≤ N で運営に回す。Challonge は残り人数 (負け数がシングル 1・ダブル 2 未満) で近似。`classes_only` はフェーズ名・イベント名が下位クラス (`LOWER_CLASS_NAME_PAT`)。

## 5. API (worker/src/api/report.ts)

`report_begin` / `report_enable` / `report_enable_class` / `report_info` / `report_view` / `report_submit` / `report_notices` / `report_admin` / `report_admin_fix` / `report_settings` / `report_stop`。D1 は migrations/0012_reports.sql (`report_events` / `report_sets` / `report_submissions`)。

## 6. 画面

- `src/pages/report.js` + `site/report/index.html` + `site/css/report.css`。
- 入口: `site/js/report_notice.js` (トップの速報の上・自分のプレイヤーページ)。速報の index.json で本人の開催中の大会を見て、受付中のものと食い違いを出す。
- 「勝ったら・負けたら」「ここまでの変化」は `site/js/live_predict.js` (ifWin / 追加した ifLose / perSet) を流用。速報に載っている start.gg の大会だけ。

## 7. テスト

- worker/test/report.test.mjs (判定・暗号化・偽の start.gg / Challonge で受付〜報告〜食い違い〜運営の修正〜停止・期限)、db_sqlite.test.mjs (D1 の SQL)。
- ページは jsdom で偽の start.gg / Worker に対して確認 (選手・試合待ち・Challonge・運営・受付)。

## 8. 実物で確かめること (テスト用の大会とアカウント 2 つが用意できたら)

本番の大会には書き込まない。

1. `tournament.reporter` だけで `reportBracketSet` / `updateBracketSet` / `resetSet` が通るか (足りなければ scope に `tournament.manager` を足す)。
2. 次の試合に結果が出た後の `resetSet` の挙動。`lPlacement` の値の入り方。
3. `station { number }` / `stream { streamName }` と `prereqPlacement` (1 = 勝者、2 = 敗者) の値。
4. refresh token で 1 日持つか。
5. Challonge v2.1: 試合の更新 (`PUT matches/{id}.json`、`score_set` / `advancing`)・reopen (`change_state` の `reopen`)・`player1_prereq_match_id` の有無。
