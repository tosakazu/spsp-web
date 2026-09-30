-- 下位クラス (Bクラス等) を Challonge で開いたものの登録 (docs/class_bracket_design.md)。
-- TO が class_register で登録し、smash_database の取得が class_waitlist で読んで、取り終えたら class_done で done にする。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp への適用は本番投入のとき。Actions では当たらない)

CREATE TABLE IF NOT EXISTS class_brackets (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at           TEXT    NOT NULL,               -- ISO 8601 (+09:00)
  ts_ms                INTEGER NOT NULL,               -- created_at の epoch ms (連投判定)
  day                  TEXT    NOT NULL,               -- created_at の yyyy-MM-dd (当日上限)
  parent_event_id      INTEGER NOT NULL,               -- 本戦の start.gg イベント ID
  parent_tournament_id INTEGER NOT NULL,               -- 本戦の start.gg 大会 ID (start.gg に問い合わせた値)
  class_letter         TEXT    NOT NULL,               -- B / C / D / E
  name                 TEXT    NOT NULL,
  challonge_id         INTEGER NOT NULL UNIQUE,        -- 同じ Challonge トーナメントの二重登録は duplicate
  challonge_url        TEXT    NOT NULL,
  format               TEXT    NOT NULL,               -- single / double
  counted              INTEGER NOT NULL,               -- 1 = SPSP の集計対象 (取得する) / 0 = しない
  place_min            INTEGER NOT NULL,
  place_max            INTEGER,                        -- NULL = 最下位まで
  seeding              TEXT    NOT NULL,               -- random / main_result / spsp
  entrant_count        INTEGER NOT NULL,
  registered_by        TEXT    NOT NULL,               -- 登録した TO の start.gg ユーザー ID (start.gg に問い合わせた値)
  status               TEXT    NOT NULL DEFAULT 'waiting'   -- waiting = 取得待ち / done = 取得済み
);
CREATE INDEX IF NOT EXISTS class_brackets_wait ON class_brackets (counted, status);
CREATE INDEX IF NOT EXISTS class_brackets_by_ts ON class_brackets (registered_by, ts_ms);
CREATE INDEX IF NOT EXISTS class_brackets_by_day ON class_brackets (registered_by, day);
