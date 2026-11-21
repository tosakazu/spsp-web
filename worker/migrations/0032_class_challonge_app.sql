-- 下位クラスを作った Challonge アプリの番号 (docs/class_bracket_design.md「Challonge アプリを複数使う」)。
-- Challonge の API は 1 アプリあたりの回数の上限が小さいので、アプリを複数持ち、大会ごとに使い分ける。
-- 0 = 最初からあるアプリ (CHALLONGE_CLIENT_ID)、n = CHALLONGE_CLIENT_ID_<n>。これまでの行は全部 0。
-- 取得側 (smash_database) は、この番号のアプリの client credentials で読む (作ったアプリでしか読めない)。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp への適用は本番投入のとき。Actions では当たらない)
-- **コードを出す前に当てる** (一覧・取得待ちの SELECT がこの列を読む)。

ALTER TABLE class_brackets ADD COLUMN challonge_app INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS class_brackets_by_tournament ON class_brackets (parent_tournament_id, id);
