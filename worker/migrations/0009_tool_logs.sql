-- 大会運営ツールの使用記録 (2026-10-28)。どの大会を、どのユーザーが、SPSP のどの機能で操作したか。
--   tool = seed (シード作成) / seed_upload (シードアップロード) / class (下位クラス作成)
--   action = seeding (start.gg にシードを書き込んだ) / create / delete (下位クラス)
--   verified = 1: ユーザーをサーバで確かめた (SPSP のセッション、または下位クラスで start.gg に問い合わせた) / 0: ブラウザの申告のまま
--   auth = login (start.gg のログイン) / key (API キー)。detail = 機能ごとの中身 (JSON。基準・被り回避の設定など)
-- トークン・API キーは入れない。
CREATE TABLE IF NOT EXISTS tool_logs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL,   -- ISO 8601 (+09:00)
  ts_ms           INTEGER NOT NULL,
  day             TEXT    NOT NULL,   -- yyyy-MM-dd (当日上限)
  tool            TEXT    NOT NULL,
  action          TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,   -- start.gg のユーザー ID
  gamer_tag       TEXT    NOT NULL DEFAULT '',
  verified        INTEGER NOT NULL,
  auth            TEXT    NOT NULL DEFAULT '',
  tournament_id   INTEGER,
  tournament_slug TEXT    NOT NULL DEFAULT '',
  tournament_name TEXT    NOT NULL DEFAULT '',
  event_id        INTEGER,
  event_name      TEXT    NOT NULL DEFAULT '',
  phase_id        INTEGER,
  count           INTEGER,            -- シードを書き込んだ人数 / 下位クラスの人数
  detail          TEXT    NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS tool_logs_ts ON tool_logs (ts_ms);
CREATE INDEX IF NOT EXISTS tool_logs_user_day ON tool_logs (user_id, day);
CREATE INDEX IF NOT EXISTS tool_logs_tournament ON tool_logs (tournament_id);
