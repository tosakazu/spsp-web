-- トーナメントプレビューの短い URL: 作った人と、start.gg から読んだ構造 (2026-11-05)。
--   user_id / user_name = 作った人 (start.gg のログイン)。1 人 30 個まで (超えたら古いものから消す)・10 分に 10 個まで。
--   sgg = 作った人のブラウザが start.gg から読んだフェーズの構造 (worker/src/api/bracket_struct.ts の SimData、JSON)。開く人はログインなしで start.gg の組み合わせになる。
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0025_bracket_shares_owner.sql` (deploy より先に)
ALTER TABLE bracket_shares ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
ALTER TABLE bracket_shares ADD COLUMN user_name TEXT NOT NULL DEFAULT '';
ALTER TABLE bracket_shares ADD COLUMN sgg TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS bracket_shares_user ON bracket_shares (user_id, created_ms);
