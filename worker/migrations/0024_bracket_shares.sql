-- トーナメントプレビューの短い URL (2026-11-05)。/jp/bracket/?s=<id> を開くと frag (共有 URL の # の後ろ) を返す。
--   保存期間は作るときに 1 / 3 / 7 日から選ぶ (既定 3 日)。期限を過ぎたものは作るときに消す。
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0024_bracket_shares.sql` (deploy より先に)
CREATE TABLE IF NOT EXISTS bracket_shares (
  id TEXT PRIMARY KEY,
  frag TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bracket_shares_expires ON bracket_shares (expires_ms);
