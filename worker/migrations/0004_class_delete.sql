-- 下位クラスの削除 (class_delete) と、自分が作った一覧 (class_mine)。docs/class_bracket_design.md
-- 削除は行を消さずに status = 'deleted' にする (class_waitlist は status = 'waiting' だけなので取得側から消える)。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp は本番投入のとき。Actions では当たらない)

ALTER TABLE class_brackets ADD COLUMN deleted_at TEXT;   -- ISO 8601 (+09:00)。削除していなければ NULL

-- class_mine / class_delete の連投判定 (start.gg への問い合わせを伴うので、同じ人の連打を抑える)。
-- 2 日より古い行は書き込みのたびに消す。
CREATE TABLE IF NOT EXISTS class_actions (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT    NOT NULL,   -- start.gg のユーザー ID (start.gg に問い合わせた値)
  action  TEXT    NOT NULL,   -- mine / delete
  ts_ms   INTEGER NOT NULL,
  day     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS class_actions_user_ts ON class_actions (user_id, action, ts_ms);
CREATE INDEX IF NOT EXISTS class_actions_user_day ON class_actions (user_id, action, day);
CREATE INDEX IF NOT EXISTS class_actions_ts ON class_actions (ts_ms);
