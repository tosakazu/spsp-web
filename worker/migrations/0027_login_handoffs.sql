-- ログインの引き継ぎ (2026-11-05): ログインを始めたブラウザと別のブラウザ (iPhone のアプリ内ブラウザ → Safari 本体など) で
--   start.gg から戻ったとき、結果 (セッションと start.gg のトークン、AES-GCM で暗号化) を始めたブラウザが取りに来るまで置く。
--   h = 始めたブラウザだけが持つ乱数 s の SHA-256 (base64url)。15 分・1 回取り出したら消す
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0027_login_handoffs.sql` (deploy より先に)
CREATE TABLE IF NOT EXISTS login_handoffs (
  h TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires_ms INTEGER NOT NULL
);
