# プレイヤーカードの二つ名 — 設計

2026-10-01。Figma「submit」ver.1.5 の二つ名 (カード左上の「// 前半 後半」) を、編集ページで選べるようにする。
ブランチ = spsp-web `feat/card-titles` (フロント)、Worker の検証は `feat/card-titles-backend` (spsp backend セッション)。

## 二つ名の一覧 (ID 管理)

- `site/js/titles.js` の `TITLES[lang]`。1 件 = `{ id, part: 'pre' | 'post' | 'both', text, unlock: 'initial' | 'random', added, retired? }`。
- **使える位置 (part)**: 前半だけ / 後半だけ / どちらでも (`usableIn(t, slot)`)。「どちらでも」は前半・後半の両方のリールに出る。
- **id**: `<言語>-<4 桁>` (`ja-0001`)。位置は id に含めない (あとで位置を変えても id はそのまま)。カードの設定にも id だけを保存する。
  一度使った id は別の文言に使い回さない。
- **言語ごとに別の一覧**: 日本の地域は `ja`、北米は `en` (`region/config.js` の `titleLang`)。英語は日本語の訳ではなく別に作る。
  表示の言語 (UI) を切り替えても二つ名の表記は変えない。
- **消さない**: やめるときは `retired` (廃止日)。持っている人は持ったまま、廃止日より後の抽選には出ない。

## 持っている二つ名 (保存しない・毎回同じに計算)

`ownedTitles(lang, uid, tournaments)` (ページ・Worker で同じ関数)。選手のデータ (出た大会と日付) だけで決まるので、
「誰が何を持っているか」をデータベースに持たない。

- `initial` = 最初から全員が持っている。
- `random` = 本戦に `RANDOM_EVERY` (10) 回出るごとに 1 つ (下位クラスの仮想大会は数えない)。
  - k 回目の抽選の日 = 10k 回目の大会の日付 (公開日 `TITLE_LAUNCH` より前なら公開日)。
  - 候補 = その日までに追加されていて、まだ廃止されていない `random` の二つ名のうち、まだ持っていないもの。
  - 選ぶもの = `hash32("<uid>|<k>|<id>")` (FNV-1a) が最小のもの。
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
