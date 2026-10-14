-- title_owned を WITHOUT ROWID に作り直す (2026-10-14)。
-- 主キーが (uid, lang) の 2 列のふつうの表は、行を書くたびに表と主キーの索引の両方に書く (D1 は索引への書き込みも
-- 書き込み行数に数える)。WITHOUT ROWID なら主キーの B-tree に行そのものを持つので、1 行の書き込みが 1 回で済む。
-- 中身と使い方 (列・主キー・SQL) は 0005 と同じ。0006 は別ブランチ (csp_reports) が使っているので 0007。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp への適用は本番投入のとき)

CREATE TABLE title_owned_new (
  uid     INTEGER NOT NULL,   -- start.gg のユーザー ID = SPSP の選手 ID
  lang    TEXT    NOT NULL,   -- 二つ名の一覧の言語 (ja / en)
  bits    TEXT    NOT NULL,   -- base64url のビット列 ("" = 何も持っていない)
  updated TEXT    NOT NULL,   -- 最後にビットが増えた日 (YYYY-MM-DD)
  PRIMARY KEY (uid, lang)
) WITHOUT ROWID;

INSERT INTO title_owned_new (uid, lang, bits, updated) SELECT uid, lang, bits, updated FROM title_owned;
DROP TABLE title_owned;
ALTER TABLE title_owned_new RENAME TO title_owned;
