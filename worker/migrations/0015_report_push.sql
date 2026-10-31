-- 結果報告の運営への通知 (Web Push、2026-11-01、docs/self_report_design.md)。端末 (ブラウザ) ごとに 1 行。
--   運営が報告ページの運営の画面で「この端末で通知を受け取る」を押すと、ブラウザの購読 (endpoint と鍵) を start.gg ユーザー ID と結んで置く。
--   送るのは、その人が運営の受付 (report_events.admins) で、受付の設定 notify が off でないとき。送り先が 404/410 を返したら消す
-- 適用: preview は wrangler d1 execute spsp-preview --env preview --remote --file / 本番 spsp は本番に出すとき (同じく execute --file)

CREATE TABLE IF NOT EXISTS report_push_subs (
  endpoint    TEXT    PRIMARY KEY,   -- ブラウザのプッシュの送り先 (https)
  user_id     TEXT    NOT NULL,      -- start.gg ユーザー ID
  p256dh      TEXT    NOT NULL,      -- 暗号化の鍵 (base64url)
  auth        TEXT    NOT NULL,
  created_ms  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS report_push_subs_user ON report_push_subs (user_id);
