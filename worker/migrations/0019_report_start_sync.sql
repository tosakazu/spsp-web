-- 試合結果の報告: 「対戦開始」が start.gg に入ったか (2026-11-04、docs/self_report_design.md §13)。
--   sgg: 0 = まだ (start.gg に繋がらない・運営が指定した試合で start.gg の試合がまだ無い。Worker が読み直しのたびにやり直す)
--        1 = start.gg の試合を試合中にした / 2 = 要らなくなった (start.gg で結果が入った・試合が無くなった) / -1 = start.gg が断った (note)
--   info = 運営の画面に出すもの (JSON: 両者の名前・ラウンド)
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0019_report_start_sync.sql`
ALTER TABLE report_starts ADD COLUMN sgg INTEGER NOT NULL DEFAULT 0;
ALTER TABLE report_starts ADD COLUMN tried_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE report_starts ADD COLUMN note TEXT NOT NULL DEFAULT '';
ALTER TABLE report_starts ADD COLUMN info TEXT NOT NULL DEFAULT '{}';
