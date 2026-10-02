-- 持っている二つ名の記録 (docs/card_titles_design.md「持っている二つ名の記録」)。0 → 1 にしかしない (消さない)。
-- bits = 二つ名の通し番号を位置にしたビット列 (base64url、site/js/titles.js の bitsFromIds / bitsHas / bitsOr)
-- 書くのは title_sync (鍵 TITLE_SYNC_KEY、毎日のビルドの後)。読むのは GET /api/titles と card_put の確認
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp は本番投入のとき。Actions では当たらない)

CREATE TABLE IF NOT EXISTS title_owned (
  uid     INTEGER NOT NULL,   -- start.gg のユーザー ID = SPSP の選手 ID
  lang    TEXT    NOT NULL,   -- 二つ名の一覧の言語 (ja / en)
  bits    TEXT    NOT NULL,   -- base64url のビット列 ("" = 何も持っていない)
  updated TEXT    NOT NULL,   -- 最後にビットが増えた日 (YYYY-MM-DD)
  PRIMARY KEY (uid, lang)
);
