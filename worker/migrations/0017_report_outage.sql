-- 試合結果の報告: start.gg (Challonge) に繋がらないとき (2026-11-04、docs/self_report_design.md §11)。
--   report_health      = 相手 (start.gg / Challonge) の様子。続けて失敗したら「障害中」とみなし、30 秒に 1 回だけ試す (probe_ms)
--   report_snapshots   = 受付ごとのブラケットの写し (試合・枠・出場者)。start.gg が読めるあいだに Worker が少しずつ写す。
--                        障害中は選手の画面 (自分の試合) と運営の「次の試合を指定」の候補をここから出す
--   report_manual_sets = 障害中に運営が指定した試合 (勝者側 / 敗者側と 2 人)。報告は set_id 'm<id>' で report_sets / report_submissions に入り、
--                        復旧後に start.gg の同じ 2 人の試合を探してそちらに移す
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0017_report_outage.sql` (docs §9 と同じく execute --file)

CREATE TABLE IF NOT EXISTS report_health (
  kind           TEXT    PRIMARY KEY,           -- 'startgg' | 'challonge'
  down_since_ms  INTEGER NOT NULL DEFAULT 0,    -- 0 = 繋がっている
  last_fail_ms   INTEGER NOT NULL DEFAULT 0,
  last_ok_ms     INTEGER NOT NULL DEFAULT 0,
  fails          INTEGER NOT NULL DEFAULT 0,    -- 続けて失敗した回数 (成功で 0)
  probe_ms       INTEGER NOT NULL DEFAULT 0,    -- 障害中に最後に試した時刻 (1 つの要求だけが試す)
  note           TEXT    NOT NULL DEFAULT ''    -- 最後の失敗の符号 (timeout / http_503 等)
);

CREATE TABLE IF NOT EXISTS report_snapshots (
  code       TEXT    PRIMARY KEY,
  data       TEXT    NOT NULL DEFAULT '{}',   -- JSON (report_outage.ts の Snapshot)
  synced_ms  INTEGER NOT NULL DEFAULT 0,      -- 最後に写した時刻
  lock_ms    INTEGER NOT NULL DEFAULT 0       -- 写している・取り込んでいる最中の印 (同時に 2 つ動かさない)
);

CREATE TABLE IF NOT EXISTS report_manual_sets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  side        TEXT    NOT NULL,                 -- 'w' = 勝者側 / 'l' = 敗者側
  group_id    TEXT    NOT NULL DEFAULT '',      -- start.gg のブロック (phaseGroup) の ID
  slots       TEXT    NOT NULL,                 -- 両者 (JSON [{id, name, users, seed}, …]、id = entrant)
  users       TEXT    NOT NULL DEFAULT '',      -- "|u1|u2|" (選手の画面の検索用)
  station     TEXT    NOT NULL DEFAULT '',      -- 台 (運営が入れたとき)
  set_id      TEXT    NOT NULL DEFAULT '',      -- 見つかった start.gg の試合 ('' = まだ)
  status      TEXT    NOT NULL,                 -- 'open' | 'matched' | 'cancelled'
  created_by  TEXT    NOT NULL,
  created_ms  INTEGER NOT NULL,
  updated_ms  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS report_manual_sets_code ON report_manual_sets (code, status);

-- 総当たりで選手が選んだ相手 (2026-11-04)。選手の画面で「この人とやる」を押すと 1 人 1 行 (選び直すと上書き、報告したら消す)。
-- ほかの選手の画面に「相手もこの試合を選んでいます / ほかの人と対戦中」を出す。30 分より古いものは数えない
CREATE TABLE IF NOT EXISTS report_picks (
  code     TEXT    NOT NULL,
  user_id  TEXT    NOT NULL,
  set_id   TEXT    NOT NULL,
  ts_ms    INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
