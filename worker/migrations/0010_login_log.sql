-- ログインの記録 (2026-10-28)。普段のログイン (login) と大会運営用 (manager) のたびに 1 行。
-- 入れるのはユーザー ID (start.gg のユーザー ID)・時刻・どのログインかだけ。トークンなどの認証情報は入れない。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote / 本番 spsp は本番に出すとき (wrangler d1 migrations apply spsp --remote)

CREATE TABLE IF NOT EXISTS login_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT    NOT NULL,
  ts_ms   INTEGER NOT NULL,
  flow    TEXT    NOT NULL   -- 'login' | 'manager'
);
CREATE INDEX IF NOT EXISTS login_log_user ON login_log (user_id, ts_ms);
