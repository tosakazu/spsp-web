-- 試合結果の報告: 前のフェーズからの通過順を運営が確かめた記録 (2026-11-05)。
--   同じ順位で抜ける人が 2 人以上いるとき、次のフェーズのどのシードに入るか (並べ方) は start.gg が API で返さないので、
--   障害中に SPSP が計算で次のフェーズを埋めるのは、運営がその並びを確かめたブロックだけ。list = 確かめた並び (JSON)。
--   計算した並びが list と違えば (結果が変わった等) 確かめ直し。
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0021_report_prog_ok.sql`
CREATE TABLE IF NOT EXISTS report_prog_ok (
  code TEXT NOT NULL,
  group_id TEXT NOT NULL,
  list TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ms INTEGER NOT NULL,
  PRIMARY KEY (code, group_id)
);
