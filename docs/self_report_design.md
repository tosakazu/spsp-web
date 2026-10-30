# 選手による試合結果の報告 (設計)

2026-10-29。運営の「結果報告」権限と選手の普段のログインを組み合わせ、選手が自分の試合の結果を SPSP から start.gg / Challonge に報告する。

## 1. 決まっていること (2026-10-29)

- 案 B: 運営が大会ごとに `user.identity tournament.reporter` で 1 回ログインし、そのトークンを Worker が暗号化して預かる。選手は普段のログイン (`user.identity`) のまま。
- 相手の承認は待たない。1 人目の報告ですぐ反映する。2 人とも送ってよい。
- 「同じ結果」は勝った側とゲーム数のスコアだけで比べる。キャラはその側の本人の入力を正とする。
- 食い違ったら反映を一度取り消し (start.gg `resetSet` / Challonge reopen)、両者の報告がそろうのを待つ。両者に知らせる。
- 次の試合に結果が出るまでは、運営が SPSP から直せる・取り消せる。出た後は自動で取り消さず「運営の確認待ち」にする。
- 不戦勝・DQ は選手は報告できない (ゲームが 1 つ以上必要)。運営が start.gg で入れる。
- 入力はタブで「まとめて」(既定) と「1 戦ごと」を切り替える (2026-10-30)。まとめて = 両者の名前の隣でスコアを選ぶ (0〜3、それ以外は数を入れる) + 両者のキャラ。ステージは無し。gameData は負けた側の勝ちを先に並べる (順は分からないため)。1 戦ごと = ゲームごとの勝者・キャラ・ステージ。キャラ・ステージは start.gg だけ (Challonge には欄が無いのでスコアだけ送る)。
- 何先 (2026-10-30): 運営がフェーズごとに「設定しない / 全部 1・2・3 先 / 勝者側・敗者側で別々 (a 先、あるラウンドから b 先)」を選ぶ (settings.ft、キーは phase id・Challonge は c)。設定があれば試合の見出しとマッチングの演出に出し、送られたスコアは勝った側がちょうど N でないと受け付けない。ラウンドの一覧は action report_phases (運営のトークンで phases と最初のブロックの rounds / sets を読む)。
- 何先の候補 (2026-10-30): ラウンドの一覧はブラケットの構造から (フェーズごとにラウンドがいちばん多いブロックの rounds { number bestOf } と、その試合の fullRoundText を最大 4 ページ)。Challonge は構造から名前を付ける (Winners Final / Grand Final / Losers Final 等)。運営が設定していなければ何先は出さず、スコアの候補は 0〜3 と「それ以外」。start.gg の値は当てにしない (2026-10-30 に直近の日本の大会 14 件を読んだところ、PhaseGroup.rounds は空、試合の totalGames は 2 先のラウンドも含め全部 5)。
- 保存した設定 (2026-10-30): 運営はアカウント (start.gg ユーザー ID) ごとに設定を名前をつけて保存・呼び出し・削除できる (D1 report_presets、20 個まで、migration 0013)。phase id は大会ごとに違うので、何先はフェーズ名 → 無ければ順番、切り替えのラウンドはラウンド名 (Winners Final など) → 無ければ番号で当てはめる。受付を始める画面で選ぶと、範囲は受付時に、何先は受付後にフェーズが分かってから当てはめて保存する。運営の画面で呼び出すと入力に入れてそのまま大会の設定として保存する。
- 選手の画面 (2026-10-30): キャラは空欄から。選ぶ一覧のいちばん上にその人の使用キャラ (選手データの characters、無ければメイン) を出す。VS は自分のカード・VS の丸・相手のカードの縦並び (文字の VS は無し、二つ名・名前はカードに出る。読み込み中・カードの無い人は名前の札)。画面はアニメーションを待たずに先に作り、両方のカードはアニメーションの間に読む。スコアのまとめては 0-0 が既定。スコア変動予想は今の試合の欄のいちばん下 (終わった試合の上)。自動の読み直しは start.gg / 報告の状態が変わったときだけ描き直す (入力の途中を消さない)。
- 実データでの表示確認 (2026-10-30、終わった大会 マエスマHIT#204 を読むだけ・mutation は止めた): worker の構造取得 (2 フェーズのラウンド名)・試合の読み取り、選手の画面 (終わった試合 / 最後の試合を試合中に戻した / 相手の枠を空にした試合待ち) が描けることを確認。直したこと: ステージは start.gg の一覧 (107・英語名) のままだと選べないので、よく使う 12 ステージを表示言語の名前で先に・残りは「その他」/ ブロックが 1 つだけのフェーズはブロック番号 (「1」) を出さない (phase.groupCount) / キャラの名前はまとめた名前 (サムス / ダークサムス) を前半だけに。
- start.gg へのリンク (2026-10-30): その試合のあるブラケット (brackets/<phase>/<group>、実物で 200 を確認) の 1 本だけ。試合が無ければ最後の試合のブラケット、運営の画面はイベントのブラケット。試合ページ・イベント・大会のリンクはやめた。
- カード (2026-10-30): プレイヤーページと同じものを js/player_card_embed.js (mountPlayerCard) で描く。データ・設定 (2 秒待ち)・二つ名・Web フォント (IBM Plex Sans JP / Zalando Sans) とも同じ。原寸 514px まで。
- キャラはキャラ投票と同じ選び方 (名前で絞り込み + 絵文字の一覧、ファイター番号順)。
- リンク: ページの上にイベント・大会 (Challonge はトーナメント)、試合ごとに試合ページ (start.gg /set/<id>) とブラケット (/brackets/<phase>/<group>)、運営の一覧にも試合ページ、受付を始める画面に start.gg。
- 同期: 選手の画面は 15 秒ごと + 画面に戻ったときに start.gg (本人のトークン) / Worker を読み直す。運営が start.gg で結果を変えたら、入力中でも出し直す。運営の画面は試合の一覧だけ 15 秒ごとに読み直す (設定の入力は消さない)。
- 報告は専用の URL (`/jp/report/?c=<受付>`) から。ログイン中は自分のプレイヤーページとトップのお知らせから行ける。
- 報告ページ: マッチングの通知とアニメーション → 台・配信台 → 相手のプレイヤーカードとシード。「勝ったら」(負けたときは出さない) と「この大会のここまで」は畳んでおき、開くと出る。
- 試合待ちのあいだは次の相手の候補 (前の試合の選手、2 段まで) を出す。
- 運営の設定: トップ N からは運営が入力 (選手は報告できない)、下位クラスの試合だけ選手が報告。
- 下位クラス作成 (Challonge) のトーナメントでも同じことができる。

## 2. 流れ

```
運営  /jp/report/ (受付を始める) ─ 先に「start.gg で運営としてログイン」(scope tournament.reporter) ─ callback.html (f=reporter)
        → action report_login: トークンを暗号化して D1 report_grants (受付を始めるまで、12 時間) + 普段のセッション → /jp/report/ に戻る
        → action report_tournaments: 管理している大会 (開催中 → これから → 終わって 2 日まで) とイベントの一覧 (受付中のものは code つき)
        → イベントを選ぶ (一覧に無ければ URL) + 設定 → action report_enable: 運営か確かめる (checkStartggAdmin) → report_grants のトークンを
          report_events に写す → /jp/report/?c=…&admin=1   (2026-10-30 からログインが先。シード作成・下位クラス作成と同じ)
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
| 運営 (start.gg) | `user.identity tournament.reporter` (flow `reporter`) | ログインから受付を始めるまで D1 `report_grants.token_enc` (12 時間で消す)、受付中は D1 `report_events.token_enc` (AES-GCM、鍵 = HKDF(SESSION_SECRET))。access + refresh。期限 10 分前に延長 |
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
- 試合開始 (2026-10-30): 選手 (か運営) が押すと report_start で start.gg markSetInProgress / Challonge change_state mark_as_underway。押さずに報告してもよい。試合中かは start.gg state 2 / Challonge underway_at。**実物では未確認** (reporter の権限で markSetInProgress が通るか・Challonge v2.1 の状態名)。
- 受付の開始 (2026-10-30): `settings.opens_ms`。受付を始める画面の既定値は start.gg のイベント (無ければ大会) の startAt。これより前は report_submit を断り (`not_open`)、トップのお知らせにも出さない。何先も受付を始める画面で設定できる (report_phases に `{ token, event }` を渡すと、受付の前でも運営のログインのトークンでフェーズを読む)。
- 運営の設定: `top_cut` は start.gg の `lPlacement` (負けた人の順位) ≤ N で運営に回す。Challonge は残り人数 (負け数がシングル 1・ダブル 2 未満) で近似。`classes_only` はフェーズ名・イベント名が下位クラス (`LOWER_CLASS_NAME_PAT`)。

## 5. API (worker/src/api/report.ts)

`report_begin` / `report_login` / `report_tournaments` / `report_enable` / `report_enable_class` / `report_info` / `report_view` / `report_submit` / `report_notices` / `report_admin` / `report_admin_fix` / `report_settings` / `report_stop`。D1 は migrations/0012_reports.sql (`report_events` / `report_sets` / `report_submissions`)・0013 (`report_presets`)・0014 (`report_grants`)。

## 6. 画面

- `src/pages/report.js` + `site/report/index.html` + `site/css/report.css`。
- 入口: `site/js/report_notice.js` (トップの速報の上・自分のプレイヤーページ)。速報の index.json で本人の開催中の大会を見て、受付中のものと食い違いを出す。速報に載っていない受付中の大会は、本人の start.gg のトークンで出場しているイベント (currentUser.events の新しい 50 件) を見る。見本 = `?demo=report_notice` (トップ・どのプレイヤーページでも)。
- 報告ページ: ログインしていなければログインを促す。ログインしても出場者に居なければエラー (試合が無いときに currentUser.events と出場者の名前検索で確かめる。試合が出てきたら普通の画面)。
- 運営の直し: 選手と同じ入力欄 (まとめて / 1 戦ごと、キャラ・ステージ)。「自分 / 相手」の代わりに両者の名前。何先は分からないので 0〜3 と それ以外。
- 見本の場面: match / conflict / waiting / done / gate / challonge / login (ログイン前) / not_entrant (出場していない人) / admin / setup_login (運営のログイン) / setup。
- 「勝ったら」「ここまでの変化」は `site/js/live_predict.js` (ifWin / perSet) を流用。速報に載っている start.gg の大会だけ。

## 7. テスト

- worker/test/report.test.mjs (判定・暗号化・偽の start.gg / Challonge で受付〜報告〜食い違い〜運営の修正〜停止・期限)、db_sqlite.test.mjs (D1 の SQL)。
- ページは jsdom で偽の start.gg / Worker に対して確認 (選手・試合待ち・Challonge・運営・受付)。

## 8. 実物で確かめること (テスト用の大会とアカウント 2 つが用意できたら)

本番の大会には書き込まない。

1. `tournament.reporter` だけで `reportBracketSet` / `updateBracketSet` / `resetSet` が通るか (足りなければ scope に `tournament.manager` を足す)。
2. 次の試合に結果が出た後の `resetSet` の挙動。`lPlacement` の値の入り方。
3. `station { number }` / `stream { streamName }` と `prereqPlacement` (1 = 勝者、2 = 敗者) の値。
4. refresh token で 1 日持つか。
5. `PhaseGroup.rounds { number }` が読めるか (読めなければ試合の round だけで一覧を作る)。
6. Challonge v2.1: 試合の更新 (`PUT matches/{id}.json`、`score_set` / `advancing`)・reopen (`change_state` の `reopen`)・`player1_prereq_match_id` の有無。
