-- 試合結果の報告: 運営の DQ と、選手の「対戦相手が見つからない」(2026-11-04、docs/self_report_design.md §12)。
--   report_dqs     = 運営が DQ にした参加者。scope: w = 勝者側の次の試合だけ / l = 敗者側の次の試合だけ / a = 残りの試合を全部。
--                    Worker が画面の読みのたびに、その人の試合 (両者がそろって結果の無いもの) を start.gg で DQ にする (reportBracketSet isDQ)。
--                    start.gg に繋がらないあいだは待つ。w / l は 1 試合で done、a は運営が外すか受付が終わるまで
--   report_noshows = 選手が「対戦相手が見つからない」を押した記録 (試合 × 押した人で 1 行)。押し直しは last_ms と count を増やすだけ。
--                    運営・相手への通知は最初の 1 回と、前の通知から 10 分たってから押されたときだけ (notified_ms)
--   report_starts  = 「対戦開始」(どちらかの選手が押した最初の 1 回。試合ごとに 1 行)。押すと「見つからない」は解決にし、start.gg の試合を試合中にする
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0018_report_dq_noshow.sql`

CREATE TABLE IF NOT EXISTS report_dqs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  entrant_id  TEXT    NOT NULL,
  name        TEXT    NOT NULL DEFAULT '',
  scope       TEXT    NOT NULL,                 -- 'w' | 'l' | 'a' | 's' (= set_id の試合だけ。総当たりなど)
  set_id      TEXT    NOT NULL DEFAULT '',      -- scope s の試合
  status      TEXT    NOT NULL,                 -- 'open' | 'done' | 'cancelled'
  done_sets   TEXT    NOT NULL DEFAULT '',      -- DQ にした start.gg の試合 (カンマ区切り)
  note        TEXT    NOT NULL DEFAULT '',      -- 最後の失敗の符号など
  created_by  TEXT    NOT NULL,
  created_ms  INTEGER NOT NULL,
  updated_ms  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS report_dqs_code ON report_dqs (code, status);

CREATE TABLE IF NOT EXISTS report_noshows (
  code         TEXT    NOT NULL,
  set_id       TEXT    NOT NULL,
  user_id      TEXT    NOT NULL,                -- 押した選手の start.gg ユーザー ID
  users        TEXT    NOT NULL DEFAULT '',     -- 両者の start.gg ユーザー ID ("|u1|u2|"、相手の画面に出すための検索用)
  info         TEXT    NOT NULL DEFAULT '{}',   -- 画面に出すもの (JSON: me, opp, opp_entrant, round, side)
  first_ms     INTEGER NOT NULL,
  last_ms      INTEGER NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  notified_ms  INTEGER NOT NULL DEFAULT 0,
  status       TEXT    NOT NULL,                -- 'open' | 'resolved'
  note         TEXT    NOT NULL DEFAULT '',     -- resolved の理由 (admin / reported / dq)
  PRIMARY KEY (code, set_id, user_id)
);

CREATE TABLE IF NOT EXISTS report_starts (
  code     TEXT    NOT NULL,
  set_id   TEXT    NOT NULL,
  users    TEXT    NOT NULL DEFAULT '',   -- 両者 ("|u1|u2|")
  user_id  TEXT    NOT NULL,              -- 押した選手
  ts_ms    INTEGER NOT NULL,
  PRIMARY KEY (code, set_id)
);
