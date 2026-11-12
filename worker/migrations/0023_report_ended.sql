-- 試合結果の報告: 大会 (start.gg の部門) が終わった時刻 (2026-11-05)。終わった受付はお知らせ・人型のメニュー・ホームの帯に出さない
--   (運営は大会運営支援 → 結果報告管理から開ける)。写しを進めるときに start.gg の event.state = COMPLETED を見て入れる。
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0023_report_ended.sql` (deploy より先に)
ALTER TABLE report_events ADD COLUMN ended_ms INTEGER NOT NULL DEFAULT 0;
