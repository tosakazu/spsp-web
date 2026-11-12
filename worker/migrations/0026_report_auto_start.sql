-- 試合結果の報告: 受付の開始時刻 (settings.opens_ms) に SPSP がブラケットを自動で開始する (2026-11-05)。
--   auto_start_ms = 終わった時刻 (0 = まだ)、auto_start_tries = 失敗した回数 (3 回で諦める)、auto_start_note = 結果 (運営の画面に出す)
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0026_report_auto_start.sql` (deploy より先に)
ALTER TABLE report_events ADD COLUMN auto_start_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE report_events ADD COLUMN auto_start_tries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE report_events ADD COLUMN auto_start_note TEXT NOT NULL DEFAULT '';
