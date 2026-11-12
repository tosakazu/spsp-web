-- 試合結果の報告: 受付の参加者 (start.gg の user id)。結果報告のお知らせを本人にすぐ出すため (2026-11-10)。
--   これまでは速報 (5 分ごと・開始予定を過ぎた大会だけ) の一覧で本人の大会を探していて、開始直後に出るまで遅れがあった。
--   uid ごとに引く (お知らせはページを開くたびに読む) ので主キーは (uid, code)。受付が終わったら消す (purgeReportEntrants)。
--   report_events.entrants_ms = 参加者を最後に読んだ時刻 (0 = まだ)。定期実行が開始時刻の前後は 3 分ごとに読み直す
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0029_report_entrants.sql` (deploy より先に)
CREATE TABLE IF NOT EXISTS report_entrants (
  uid  TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (uid, code)
) WITHOUT ROWID;
ALTER TABLE report_events ADD COLUMN entrants_ms INTEGER NOT NULL DEFAULT 0;
