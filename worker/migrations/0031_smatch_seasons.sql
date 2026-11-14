-- スマッチのデータをシーズンごとに別に持つ (2026-11-15)。docs/smatch_partner.md
--   smatch_players は「いま」の 1 行だけ (毎日上書き)。こちらはシーズンが変わっても前のシーズンの最後の値が残る。
--   smatch_seasons: 受け取ったシーズン (id は一覧の season.id。シーズンの無い古い形は '')。
--   smatch_season_stats: シーズン × 人。data = smatch_players.data と同じ形 (そのシーズンで最後に受け取った値)。
--     連携を解除した人の行も消さない。「最高レートを見せない」人の最高レートもここにだけ置く (公開の場所には出さない)。
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0031_smatch_seasons.sql` (deploy より先に)
CREATE TABLE IF NOT EXISTS smatch_seasons (
  season_id  TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS smatch_season_stats (
  season_id     TEXT NOT NULL,
  discriminator TEXT NOT NULL,
  uid           INTEGER,
  data          TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (season_id, discriminator)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS smatch_season_stats_uid ON smatch_season_stats (uid);
