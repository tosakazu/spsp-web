# プレイヤーカードの二つ名 — 設計

2026-10-01。Figma「submit」ver.1.5 の二つ名 (カード左上の「// 前半 後半」) を、編集ページで選べるようにする。
ブランチ = spsp-web `feat/card-titles` (フロント)、Worker の検証は `feat/card-titles-backend` (spsp backend セッション)。

## 二つ名の一覧 (ID 管理)

- `site/js/titles.js` の `TITLES[lang]`。1 件 = `{ id, part: 'pre' | 'post' | 'both', text, unlock: 'initial' | 'random' | 'char' | 'pref', added, retired?, kind?: 'move', chars?: number[], pref?: string }`。
- **使える位置 (part)**: 前半だけ / 後半だけ / どちらでも (`usableIn(t, slot)`)。「どちらでも」は前半・後半の両方のリールに出る。
- **id**: `<言語>-<4 桁>` (`ja-0001`)。位置は id に含めない (あとで位置を変えても id はそのまま)。カードの設定にも id だけを保存する。
  一度使った id は別の文言に使い回さない。
- **言語ごとに別の一覧**: 日本の地域は `ja`、北米は `en` (`region/config.js` の `titleLang`)。英語は日本語の訳ではなく別に作る。
  表示の言語 (UI) を切り替えても二つ名の表記は変えない。
- **消さない**: やめるときは `retired` (廃止日)。持っている人は持ったまま、廃止日より後の抽選には出ない。

## 持っている二つ名 (保存しない・毎回同じに計算)

`ownedTitles(lang, uid, tournaments, profile)` (ページ・Worker で同じ関数)。選手のデータ (出た大会と日付・メインキャラ・都道府県) だけで決まるので、
「誰が何を持っているか」をデータベースに持たない。`profile = { chars: [メインキャラの start.gg キャラ ID], pref: 都道府県 (geo.json の id) }`
(ページは `players/<uid>.json` の `characters[0]` と `data/player_prefectures.json`)。

- `initial` = 最初から全員が持っている。
- `char` = メインキャラが `chars` のどれかなら持っている (「◯◯使い」= 後半、「◯◯使いの」= 前半)。キャラ投票はビルドが `characters` の並びに反映済み。
  「ピーチ / デイジー」のように 1 つの ID が 2 体を指すときは両方の二つ名に入れる (2026-10-14 ユーザー決定)。
- `pref` = 都道府県が `pref` なら持っている (「神奈川の」= 前半)。
- `random` = 抽選 (2026-10-14 ユーザー決定。公開前の大会はさかのぼらない)。
  - 最初の配布: 全員に前半 `INITIAL_DRAWS.pre`・後半 `INITIAL_DRAWS.post` (日付は公開日 `TITLE_LAUNCH`)。
  - 大会: 公開日以降の大会だけ。本戦で 1 試合以上した大会 1 つにつき前半 `PRE_PER_TOURNAMENT`、
    試合 `POST_PER_MATCHES.matches` 試合ごとに後半 `POST_PER_MATCHES.posts` (端数は次の大会に持ち越す。試合 0 の大会・DQ の試合は数えない)。
    試合数は本戦と下位クラス (B〜E クラスの仮想大会の行、`parent_event_id` あり) の合計。下位クラスの行は前半には数えない (本戦と同じ大会なので。2026-10-14 ユーザー決定)。
  - 数: 最初 前半 60・後半 140、大会ごと前半 3、2 試合ごと後半 3 (最速のコンプリートが約 2 年後になるように。2026-10-14 ユーザー決定)。
  - 抽選の名前 (key) = `pre|start|<i>` / `post|start|<i>` (最初の配布)、`pre|<n>` / `post|<n>` (大会、前半・後半それぞれの通し番号)。日付 = 元の大会の日付。
  - 候補 = その日までに追加されていて、まだ廃止されていない `random` の二つ名のうち、その位置に使えて、まだ持っていないもの。
  - 後半は、技名 (`kind: 'move'`) を引くかを `MOVE_SHARE` (1/3) で決める (`hash32("<uid>|<key>|kind")` の上の位)。
    技名は件数が多い (後半の 6 割) ので、件数どおりに引くと二つ名の大半が技名になるため (2026-10-14 ユーザー決定)。
  - 選ぶもの = 選手ごとの引く順番 (ランダム解放の二つ名を `hash32("<uid>|<id>")` (FNV-1a) の小さい順に並べたもの) で、候補のうちいちばん前のもの。
    並べるのは選手ごとに 1 回だけ (抽選ごとに一覧全体を見直すと 1 人 35 ms、全員で 13 分かかったため。今は 1 人 約 1 ms)。技名 / 技名以外の片方を引き切ったらもう片方から。
    前半・後半をまたいでは引かない (引き切ったらその位置はもう増えない)。
  - → 二つ名をあとで足しても、過去の抽選の結果は変わらない (足した日より後の抽選から出る)。
- 将来の予定 (ユーザー): 大会申請で 1 つ、参加確定で 1 つ、1 試合で 1 つ、勝ちで 2 つ。いずれも「日付の付いた出来事 → その日の候補から 1 つ」
  の形なので、出来事の数え方を足すだけで同じ仕組みに乗る (申請・参加確定は今の選手データに無いので、その時にデータを足す)。

## 表示・編集

- カード (`js/player_card.js`): `model.title = { pre, post }` (文字)。片方・両方が空でもよい。空でも名前の位置は変えない (二つ名の欄を空ける)。
  フォントは「コーポレート・ロゴ ver2 Bold」(LOGOTYPE.JP、SIL OFL 1.1、予約フォント名なし)。二つ名の文字だけに絞った woff2
  (`tools/fonts/build_title_font.mjs` → `site/fonts/corporate-logo-title.woff2`、24 KB)。**二つ名を足したら作り直す**
  (`tests/frontend/titles.test.cjs` が足りない文字を見つける)。
- 設定 (`CardSettings.title = { pre: id | null, post: id | null } | null`)。カードに出すのは持っているものだけ。
- 編集ページ: 前半・後半ごとに「なし」+ 持っているものの札。新しく獲得したものに NEW。「獲得 n / 全体」。
- お知らせ (`js/title_notice.js`): 獲得から 14 日以内で、まだ見ていないもの → ヘッダーの人型アイコンに赤い点、メニューに「新しい二つ名 (n)」。
  編集ページを開くと既読 (このブラウザの localStorage)。ヘッダーは本人の `players/<uid>.json` を 6 時間ごとにだけ読む。

## Worker (spsp backend)

`card_put` の `title`: id の形 (`^[a-z]{2}-\d{4}$`)・一覧にあること・その位置に使えること (`usableIn`)・**持っていること** (`ownedTitles` を同じファイルから使い、
`https://data.spsp.games/jp/players/<uid>.json` の `tournaments` で計算)。取れなければ保存しない (`title_unverified`)。

## 持っている二つ名の記録 (2026-10-02 決定: ビット列 + 最終更新日)

計算だけ (上) だと、アカウントの統合・大会の取り直し・日付の変更で出場記録が変わったとき、持っていた二つ名が入れ替わったり消えたりする。
そこで、計算した結果を **記録して、消さない** (0 → 1 にしかしない)。持っているもの = 記録にあるもの。

- D1 `title_owned (uid INTEGER, lang TEXT, bits TEXT, updated TEXT, PRIMARY KEY (uid, lang))`
  - `bits` = 二つ名の通し番号 (id の 4 桁、`ja-0001` → 1) を位置にしたビット列 (base64url、位置 n = n 番目のビット)。
    二つ名を足すと長さが伸びるだけ。最多でも約 2,000 ビット = 数百バイト。
  - `updated` = 最後にビットが増えた日 (YYYY-MM-DD)。
- 記録: 毎日のビルドの後に、全選手について `ownedTitles` を計算し、記録に **OR** する (Worker の `title_sync`、鍵付き。増えた人だけ `updated` を更新)。
  初回は全員分。計算の関数は `site/js/titles.js` (ページ・Worker・記録の処理で同じもの)。
- 読む: `GET /api/titles?uid=&lang=` → `{ ok, bits, updated }` (誰でも読める。キャッシュ短め)。カード・編集ページ・保存時のチェックはこれを見る。
- NEW: ブラウザに前回見た `bits` を保存しておき、今の `bits` で増えた分に NEW。ヘッダーの印は `updated` が前回見た日より新しいとき。
