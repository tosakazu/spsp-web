# シードツール 引き継ぎ資料 (2026-08-13 時点・最終更新 f99c8f1〜da80998)

対象: `site/seed/` (シード生成) と `site/seed-upload/` (シードアップロード)、
共有本体 `site/seeding/app/*.js` (旧 `seed_app.js`) / `seed_optimizer.js` / `seed_data.js` / `seed_worker.js` /
`seed_share.js`、`site/bracket/` (トーナメントプレビュー)、および `site/priority/` (優先枠作成)。

配信とデプロイの前提は [deploy_and_environments.md](deploy_and_environments.md) を読むこと
(**`site/` 編集 = spsp.games に即本番反映**、gh-pages は 3 時間ごとの cron で追随)。

## 構成

- ページは薄いラッパ。`window.SEED_APP_CONFIG = { mode: 'spsp' | 'csv' }` を定義して
  `seeding/app/10_skeleton.js` を読むと、スケルトン HTML が `#seed-app-root` に注入される。
  - `mode: 'spsp'` = シード生成 (start.gg から参加者取得 → SPSP 順に並べる)
  - `mode: 'csv'` = シードアップロード (CSV/Sheets の順を基準にする。SPSP 列は出さない)
- `seed_optimizer.js` は純粋計算コア (fetch/DOM 非依存)。Web Worker と Node テストの両方で動く。
- `seed_data.js` は取得・集計層 (居住地・直近対戦)。

## 出力順の決まり方 (`orderedRecs()`)

優先度: **`APPLIED_ORDER` (被り回避) > `MANUAL` (手動調整/CSV) > `currentMethod` 順**。
どの段でも最後に **固定の射影** (`_projectSeedLocks`) が掛かる。
**CSV / start.gg 適用 / トーナメントプレビューはすべて `orderedRecs()` を通る**ので、
ここに乗せれば 3 つとも同じ並びになる。

- **最適化は完了した時点で自動的に反映される** (2026-08-14)。以前は緑の
  「この結果を適用」を押すまで反映されず、押し忘れるとプレビューや CSV だけ
  元の並びのままになっていた。押し忘れの余地を無くすため自動反映にし、ボタンは
  **「最適化を取り消す」(`so-cancel` → `cancelSeedOptimize`)** に置き換えた。
  取り消すと実行直前の並び・手動調整の状態・レポート表示に戻る (`PRE_OPT` に控える)。
- start.gg へ実際に書き込むのは **赤い「start.gg にシード適用」(`upload-btn`) だけ**。
  緑の適用ボタンはこれと読み違えられていたので廃止した。
- **被り回避は「最後に別枠でかける処理」**。手動編集を再開すると反映は解除され、
  手動調整の基準 (`MANUAL.base`) には畳み込まない (2026-08-13 にユーザー指示で確定)。
- CSV を読み込むと反映は解除される (CSV は基準順そのものを差し替える作業のため)。
- 解除はすべて **`dropAppliedOrder()`** に寄せてある (`APPLIED_ORDER` と `PRE_OPT` を
  同時に捨て、取り消しボタンも隠す)。`APPLIED_ORDER` への直接代入を増やさないこと
  (`tests/seeding/page.test.cjs` が本数を見張っている)。

## 手動調整 (`MANUAL`)

`{ base:[uid], ops:[{uid,to}], hpos, committed, editing, sel, lockSel, lockKind, src }`

- `base` + `ops[0..hpos]` を適用したものが手動順。op は最大 100 件 (超過は base に畳み込み)。
- `localStorage['spsp_seed_manual_v1']` に **1 件だけ** 保存。キーは
  `eventKey = "<eventId>:<phaseId>"`。復元は eventKey 一致 **かつ** 参加者集合一致のときのみ。
  `SEED_SPEC` (指定・固定) も同じレコードに `spec` として保存される。
- **手動調整は既定でオン** (参加者が揃った時点で編集状態。復元時も編集状態で開く)。
  被り回避を反映したときだけ閉じる (表が最適化後順になるため。編集を再開すると反映は解除)。
  「最適化を取り消す」で編集状態ごと元に戻る。
- UI: 行の「選択」→ 挿入位置クリック or シード番号入力で移動。undo/redo あり。
- プール数/ウェーブ数の入力は**手動調整の状態に関係なく常に**バーに出す
  (プール表示と固定の枠を決める設定なので)。
- バーは 2 段 (1 段目 = 状態表示 + プール数/ウェーブ数の入力、2 段目 = 操作ボタン)。

## シード指定・固定 (`SEED_SPEC`)

```js
SEED_SPEC = { label, pins: {uid: seat1}, waves: {uid: waveIdx0},
              locks: {uid: {kind:'pool'|'wave', target: idx0}} }
```

- **固定は「対象付き」**。`enforceSeedLocks()` が並びを挿入ソート的に組み直し、
  **最適化しなくても常に反映される** (読み取り時射影。手動 op には積まないので undo と独立、
  固定を外せば元の位置付近に戻る)。
- 枠が足りない/対象が存在しない場合は `overflow` を返し、UI が
  「A2 は 8人分の枠に 10人を固定。○○、△△ は指定を反映できません」等と表示 + 「固定を解除」ボタン。
- optimizer へは種別のみ (`'pool'|'wave'`) を `params.seedLocks` で渡す。基準ランキングが
  射影済みなので、optimizer 側の「元プール」がそのまま固定対象になる。`poolWaves` も渡す。

### UI からの固定

手動調整モード中、各行の「プール指定」ボタン → **その行の直下**に指定バーが開く
(種別 = 固定しない/プール固定/ウェーブ固定、対象 = A3 等のプール一覧 or ウェーブ文字)。
固定済みの行はボタンが「A3固定」「ウェーブA固定」表記になる。

## ウェーブ

- ウェーブ = 連続するプールの塊 (A, B, C…)。`currentWaveMap(P)` が プール→ウェーブ を返す。
- start.gg の `phaseGroups { displayIdentifier, wave { identifier } }` から自動取得
  (`fetchPhaseWaves` / `wavesFromGroupNodes`)。篝火15 phase1 = 128 プール A/B で実 API 検証済み。
- 自動取得できないときは手動設定 (被り回避パネルの「ウェーブ数」or 手動調整バーの入力) で
  連続チャンク割り。両入力は `so-pools` / `so-waves` に同期している。

## CSV の入出力

### 照合の優先度
**uid → discriminator → seedId → 名前 (タグ省略・小文字化)**

- discriminator は **start.gg の参加者データから直接取得** (`user { discriminator }` を
  seeds/entrants クエリに追加済み)。SPSP DB 未登録の参加者も照合できる。
  参加者データに無い場合のみ `site/data/discriminators.json` で補完し、それも無ければ
  fail-loud (適用中止)。`="xxxxxxxx"` 形式 (優先枠ページの出力) も正規化して受ける。
- **名前が複数の参加者に該当したらエラーで適用中止** (別人に付くのを防ぐ)。

### 列
| 列 | 意味 |
|---|---|
| `uid` / `discriminator` / `seedId` / `name` | 参加者の照合 |
| `seed` (順位/シード) | そのシード番号に配置 |
| `wave` (ウェーブ) | A,B,… or 1,2,… のウェーブへ配置 |
| `lock` (固定) | `pool` / `wave` |
| `pools` / `waves` | プール数・ウェーブ数 (作業状況 CSV の 1 行目のみ。読み込み時に設定へ反映) |
| `pool` | 参考表示 (A3 等)。読み込み時は無視 |

日本語列名 (順位 / ウェーブ / 固定 / 名前) も引き続き受け付ける。

### テンプレート
各 CSV 入力の隣に「テンプレート」ボタン。**本文は ASCII のみ** (記入例 = `Taro Yamada` /
`Hanako Suzuki`、disc = `00000000` / `00000001`)。Shift_JIS 前提で開くアプリでも化けないため。
記入例が残ったまま読み込まれた行は無視して警告する (判定 = 例名 or disc の先頭 7 桁が 0)。

### 作業状況の保存 (エクスポート)
手動調整バーの上の「💾 作業状況を保存 (CSV)」。列は
`seed,name,discriminator,uid,lock,pool,pools,waves`。読み込めばシード順・固定・
プール数/ウェーブ数まで復元され、作業の再開や共有に使える (往復テストあり)。

## トーナメントプレビュー (site/bracket/)

作業状況バーの「🏆 トーナメントプレビュー」で、現在の出力順 (orderedRecs) を URL 化して
別ページで勝者側ブラケットをプレビューできる (シード通り前提の勝ち上がり予測、
同居住地/直近対戦バッジ、プレイヤー概要ポップアップ、フェーズ区切りエディタ、
作業状況 CSV の直接読み込み)。設計と検証記録は [seed_preview_design.md](seed_preview_design.md)。

- 状態は全部 URL フラグメント (`#d=<deflate+base64url>` + `ph/pool/wd/lb`)。共有すれば同じ画面。
- **名前は URL に同梱**する (9,500字を超える規模のみ DB 未登録者だけに縮小)。選手 JSON は
  上位帯で 1 人 1MB 級あるため、取得を待たずに先に描画し、居住地/直近対戦バッジは後付け。
- コーデックは `site/seeding/seed_share.js` (発行側/プレビュー側で共有。Node テスト可)。
- 進出予測「全体シード順で再スネーク」= start.gg 自動進出のデフォルトと等価
  (篝火15 実データで 192/192・1536/1536 一致を確認済み)。
- **敗者側 (`lb=1`) + グランドファイナル表示あり** (教科書的ドロップパターンの近似)。
- **予選プールは通過者が決まったところで打ち切る** (2人抜けにGFは無い)。`poolDoubleElim(M, adv)`。
- **敗者側スタート** (「予選2位は本戦の敗者側から」) はフェーズ構成の「敗者側スタート」欄 (`phases[].lb`)。
- 最終フェーズのプールが2つ以上なら 1 プールの次フェーズを自動で足す (`SeedShare.withFinalPhase`)。
  発行時・CSV読み込み時・共有URLを開いた時・エディタ適用時のすべてで通す。
- bye の試合は描画しない。勝者側の負ける側には「↓ 敗者側○回戦」、敗者側には「↓勝者側○回戦」が出て
  相互にクリックで飛べる。名前クリックでその選手をハイライト (もう一度で解除)。名前の左に**メイン使用キャラの絵文字**を出す
  (data/character_index.json の main_by_char × char_emoji.json。プレイヤーページと同じ定義)。
- **通過者には次フェーズの入り口** (「→ P1 #7 敗者側」)、フェーズ1以降には**前フェーズの出どころ**
  (「← A1 #2」) が出る。クリックでそのプールへ飛び、本人がハイライトされる (`hi=<index>` で共有可)。
- **敗者側スタートの既定値は「前フェーズを無敗で通過した人だけ勝者側」**。1敗して通過した人が
  次フェーズの勝者側に入らないようにするため。エディタで触らなければ保存されず前フェーズに追従、
  明示的に変えた場合は食い違いを警告する。
- 打ち切り・敗者側スタートとも **start.gg 実プール197件 (篝火#10〜#17・ウメブラSP4〜SP12 の112件を含む)
  でラウンド構成が全件一致**。
  フィクスチャ = `tests/seeding/fixtures/startgg_pools.json` (`tools/fetch_startgg_pools.cjs` で再生成、
  環境変数 TOKEN に start.gg の API トークンが必要)。再現できない部分の整理は seed_preview_design.md §3。
- プレビューの「💾 CSV保存」はフェーズ構成・表示状態ごと保存/復元でき、シードページの
  作業状況 CSV とも相互互換 (拡張列 phases/wv/event/view は 1 行目のみ)。

### 描画のきまり (触るときの注意)

- **勝ち上がる側を上のスロットに描く**。敗者側は内部構造が a=生き残り / b=ドロップ の順なので、
  表示順だけ入れ替えている (a/b の役割は変えない = ドロップ判定や初登場判定はそのまま)。
- **接続線はスロット単位**で結ぶ (水平→垂直→水平の折れ線。曲線は使わない)。
  左に対応する枠が無い側 (勝者側→敗者側のドロップ / 敗者側→GF) には**線を引かない**。
- **枠の中と外**: フェーズをまたぐ導線 (進出先=右外 / 出どころ=左外) は枠の外に絶対配置。
  それ以外のタグ (居住地・落ちる先・落ちてきた元) は名前の下・同じ枠の中 (`.bp-line` + `.bp-tags`)。
- **配色**: 勝者側の勝ち上がり=青 / 敗者側の勝ち上がり=橙 / 選手ハイライト=黄。
  `.bp-lb .bp-slot.bp-win:first-child` のほうが詳細度が高いので、ハイライトは
  `.bp-lb .bp-match .bp-slot.bp-hi:first-child` まで並べて上書きしている。
  **色を足すときは詳細度に注意** (bracket_page.test.cjs が CSS をパースして検査する)。
- 選手データの再取得ボタンは取得失敗があるときだけ出す (失敗は次の描画で自動リトライされる)。

## テスト

```sh
cd ~/spsp-ranking
# jsdom 込み (推奨。無ければ jsdom テストは自動 skip)
npm install jsdom --no-save --prefix /tmp/jsdom_inst
NODE_PATH=/tmp/jsdom_inst/node_modules node --test tests/seeding/*.cjs
```

現在 **237 件 pass**。ファイル構成は `tests/seeding/README.md` を参照。
`seed_share` / `bracket_core` / `bracket_page` / `bracket_dom` / `bracket_realdata` が
トーナメントプレビュー分 (コーデック往復/ブラケット構造/静的配線/jsdom 描画/実データ検証)。

`page.test.cjs` / `page_wiring.test.cjs` / `page_dom.test.cjs` は **実ソースから関数を抽出して
実行する**ため、`seeding/app/*.js` にグローバル依存を足したら fixture 側のスタブも足す必要がある
(過去に fixture 未更新で jsdom テストが壊れていたことがある)。

## 既知の制約・注意

- 優先枠ページの **本番 CSV (実プレイヤー名入り)** は UTF-8 BOM 付き。Shift_JIS 前提の
  アプリ (Excel for Mac 等) では化けるので、Sheets か「テキストまたは CSV から」で開く。
  必要なら Shift_JIS 出力オプションを足す余地あり (未実装)。
- 本体は 2026-09-13 に `site/seeding/app/*.js` (12 ファイル、見出し単位) に分割した。並び順とファイルごとの中身は
  `site/seeding/app/README.md`。テストは `tests/seeding/helpers/seed_app_src.cjs` で連結した 1 本の文字列として読む。
- feat ブランチ `feat/exp-tjpr-info-log2sq` で作業中。**origin へは push していない**
  (ユーザー確認が必要)。gh-pages への push は deploy スクリプト経由のみ許可。

## このセッション (2026-08-13) でやったこと

`db5ab36..da80998` の 22 コミット。すべて spsp.games に反映済み (gh-pages は 3h cron で追随)。

1. **名前を URL に同梱** (`f99c8f1`) — 選手 JSON (上位帯は 1人 1MB 級) が取れないと名前が
   一切出ない壊れ方をしていた。描画も取得を待たない形に。スマホのフェーズ構成 UI も修正。
2. **通過人数による打ち切り** (`e2f6549`) — 2人抜けのプールに GF を出さない。
3. **敗者側スタート** (`9172c2c`) + bye の非表示。
4. **start.gg 実プールとの一括照合** (`956af89`, `1fe0c08`) — 197プール (篝火/ウメブラ 112 を含む)。
   `tools/fetch_startgg_pools.cjs` で再生成できる。
5. **1敗通過者が次フェーズの勝者側に入るバグ** (`30e7047`, `ab238ef`) — `undefeated` を基準に
   敗者側スタートの既定値を決め、食い違いは警告する。
6. **UI** — キャラ絵文字 (`f9fcd9f`)、プール内の行き来 (`ef38278`)、枠の内外整理 (`8e4c0af`)、
   次フェーズ自動生成 (`63dcd37`)、ポップアップの位置 (`d2c8d0f`)、勝ち上がりを上段に (`6added8`)、
   接続線 (`9e892ea`〜`b9d55a0`)、ハイライトの詳細度 (`da80998`)。
7. **手動調整を既定でオン** (`3acc88a`)。

## このセッション (2026-08-20) でやったこと

1. **敗者側直入りペアのバグ修正** — 192人本戦 ('64:32' = 勝64+敗128) が LB_ENTRY_PERM に無く、
   フォールバック式が実ブラケットと大きく食い違っていた (= 「敗者側で予選通過した人の進出先が
   おかしい」)。グランドスラム19 ベスト192 の実測 (perm = i XOR 21) を追加。
   観測済み並びがすべて XOR マスクで表せることが判明し、フォールバックも XOR 系列に一般化。
   '4:2' (風雲#2) / '4:4' (ウメブラSP10) も追加。詳細は seed_preview_design.md §3 の追記。
2. **start.gg からフェーズ構成を自動取得** — EVENT_QUERY に
   `progressingInData { origin numProgressing }` を追加し、`buildPhasesConfig()` が
   選択 phase 起点の連鎖 [{name, pools, adv}] を作って `EVENT_CONTEXT.phasesConfig` に保持。
   トーナメントプレビュー発行時、プール数がシード画面の値と一致し検証も通る場合は
   これを初期フェーズ構成に使う (通らなければ従来の adv=2 + 自動最終フェーズ)。
3. **実データ検証の拡充** — マエスマ'TOP#2 / スマバト71 / 西武撃19.5 / グランドスラム19 /
   IMPACT MAJOR#4 / アブスマ#1 のフェーズ遷移 (シート順 = placement 昇順 / グループ割 =
   スネーク / LBスタート人数 = 前フェーズ無敗数 / WB R1・LB初戦ペア) を突き合わせ、
   グランドスラム以外は全一致を確認。シート順とプール割・敗者側スタート人数の既存モデルは
   実 start.gg と等価 (progressingInData でも通過人数が取れることを確認)。

## 2026-09-14: 適用時の被り回避 自動実行と既定値の変更

- 「start.gg にシード適用」ボタンの隣に **「適用時に被り回避を自動実行」チェック (`so-auto-apply`, 既定 ON)** を追加。
  - ON なら `uploadToStartgg()` の冒頭 (`ensureAutoOptimizeForUpload()`) でパネルの設定どおりに
    `runSeedOptimize()` を回し、完了 (= `applySeedOptimize()` で `APPLIED_ORDER` 反映) を待ってから
    通常どおり `orderedRecs()` を送る。パネル (`<details id="seedopt-details">`) は自動で開き、レポートは従来の欄に出る。
  - 反映済みの最適化 (`APPLIED_ORDER`) があればそのまま使う (押すたびに回し直さない)。基準の切替や
    「最適化を取り消す」で反映が消えれば、次の適用で回し直す。
  - 最適化が完了しなかったとき (非対応形式・シリーズ未選択・データ取得失敗・worker エラー) は
    **適用しない**。status に理由付きで「シード適用を中止しました」と出し、チェックを外せば今の並びで適用できる旨を添える。
  - 実行中の最適化があれば alert して適用しない。
  - 完了待ちは `runSeedOptimizeAndWait()` (Promise) と `SEEDOPT_WAITER`。決着は
    `finishSeedOptimize` の完了 path (反映後に true) と `cleanupSeedOptWorker()` (それ以外の終了で false。
    完了 path だけ `{ keepWaiter: true }` で呼ぶ)。
  - phase 未作成 event の path (`createPhaseThenUpload`) も自動実行の後に通る。あわせて送る並びを
    `orderedRecs()` に統一した (以前は `currentMethod` 順で、手動調整・被り回避の反映を無視していた)。
  - confirm の文面は `uploadOrderLabel()` (例: 「総合評価 (手動調整・被り回避 反映済み) の順」)。
- 既定値の変更:
  - 「兵庫・大阪・京都をまとめる」「同シリーズの再戦を強めに避ける」を既定 ON に (これで「平日大会を含む」以外は ON)。
  - 同シリーズ: 対象は大会名からの自動判定をそのまま使う。大会一覧が未ロードなら実行時に `updateSeriesToggleState()` で
    読み込んで判定を待つ。判定できない (初開催・ユーザーが「選択なし」に戻した・一覧の取得失敗) ときは
    **シリーズ罰則なしで実行** し、進捗の注記に「シリーズ判定なし（同シリーズ罰則は掛けていません）」と出す
    (以前は止めて選ばせていた。既定 ON 化に伴いユーザー確認のうえ変更)。
  - シードズレ上限の既定は規模によらず `[4, 8, 16, 32, 64, 128]` (固定 4 位まで / ±1 は 8 位まで / … / ±5 は 128 位まで)。
    ±5 の欄 (`so-shift5`) を追加。`SHIFT_LIMIT_PRESET` / `SHIFT_LIMIT_IDS`。
  - ズレ抑制 (`so-orderpow`) の既定を 2 → 2.5 (optimizer 側の `DEFAULT_PARAMS.orderPow` は 2 のまま。UI は常に値を渡す)。
- テスト: `tests/seeding/page.test.cjs` (既定値・配線)、`tests/seeding/page_wiring.test.cjs`
  (適用フロー 4 本: ON で完了待ち→反映順で送信 / OFF / 未完了なら送らない / 実行中・phase 未作成)。
- **パネル設定の保存** (同日、後半): チェック・ズレ上限・ズレ抑制・上級者向け・「適用時に被り回避を自動実行」を
  localStorage (`spsp_seedopt_settings_v1`) に保存。**既定と違う項目だけ**保存する (既定を後で変えても、触っていない
  項目には新しい既定が効く)。プール数・ウェーブ数・対象シリーズは大会ごとに自動で入るので保存しない。復元は起動時
  (ファイル末尾の `wireSeedOptSettings`、const 初期化後) と `initSeedOptPanel()` の `applyModeDefaults()` の後
  (多点数などをモード既定で上書きされるため)。「設定を既定に戻す」ボタン (`so-reset-defaults`、パネル末尾の進捗欄の上に右寄せ。1 行目に置くとスマホ幅で崩れた) で既定に戻し保存も消す。実行ボタンは ? アイコンごと inline-flex の span で包んで、折り返し時にアイコンだけ落ちないようにしている (隠れる中断/取り消しは包まない。空の span が flex の gap を取るため)。

## 関連: 投稿・認証機能 (シードツールとは別系統)

2026-08-13〜14 に同ブランチで実装。GAS 受け口 + start.gg OAuth。

- 設計と現状: [post_feature_design.md](post_feature_design.md) (投稿 / ログイン / キャラ投票)
- デプロイと人手作業: [DEPLOY.md](DEPLOY.md)
- **トーナメント結果予想 (未着手) の設計 TODO: [prediction_feature_todo.md](prediction_feature_todo.md)**
- テスト: `NODE_PATH=/tmp/jsdom_inst/node_modules node --test tests/post/*.cjs` (124 件)

## 次のセッションへ

- ブランチ `feat/exp-tjpr-info-log2sq` は **origin へ push していない** (確認が必要)。
- 未解決として残しているもの:
  - 敗者側直入りの並びは大会ごとに違い、規則として閉じていない (篝火/ウメブラ の実測を採用。
    一致しない12件は groupId で例外固定。'4:4' は3大会3通り)。詳細は seed_preview_design.md §3。
  - 合流後のドロップ並び替え規則は標準構成のものを流用 (実データ未検証)。
  - スマホ実機での見た目は未確認 (CSS は書いたが jsdom では検証できない)。
- 作業ツリーに `site/players` / `site/tournaments` (ビルド生成物の symlink 等) が
  未追跡で残っているが、この作業とは無関係なので触らないこと。
