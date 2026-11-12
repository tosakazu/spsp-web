-- 試合結果の報告: start.gg の大会の管理者一覧 (owner と admins の start.gg ユーザー ID、カンマ区切り) を受付の行に置く (2026-11-05)。
--   受付を始めたとき・運営が加わるときに受付のトークンで読み、受付が使われている間は 10 分に 1 回読み直す (sgg_admins_ms = 最後に読もうとした時刻)。
--   お知らせ (report_notices) はここを見るだけで start.gg は読まない
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0020_report_sgg_admins.sql`
ALTER TABLE report_events ADD COLUMN sgg_admins TEXT NOT NULL DEFAULT '';
ALTER TABLE report_events ADD COLUMN sgg_admins_ms INTEGER NOT NULL DEFAULT 0;
