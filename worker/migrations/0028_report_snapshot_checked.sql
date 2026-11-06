-- 写しを start.gg と見比べて「変わっていなかった」時刻 (2026-11-06)。中身を書き直さずに確かめた時刻だけ進める。
--   synced_ms = 中身を書いた時刻 (Worker のメモリに置いた写しの見分けに使う)、checked_ms = 最後に確かめた時刻 (次に写す番・画面の「何時の時点」)
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0028_report_snapshot_checked.sql` (deploy より先に)
ALTER TABLE report_snapshots ADD COLUMN checked_ms INTEGER NOT NULL DEFAULT 0;
