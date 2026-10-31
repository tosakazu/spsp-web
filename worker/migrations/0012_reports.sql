-- 選手による試合結果の報告 (2026-10-29、docs/self_report_design.md)。
--   report_events      = 報告の受付 (start.gg のイベント 1 つ、または下位クラスの Challonge 1 つ)。運営が受付を始めると 1 行。
--                        token_enc = 運営のトークン (start.gg の tournament.reporter / Challonge) を Worker の鍵で暗号化したもの。
--                        受付の期限 (expires_ms) を過ぎるか、運営が止めると空にする (平文のトークンはどこにも置かない)
--   report_sets        = 試合ごとの状態 (reported / agreed / conflict / review / fixed) と、start.gg / Challonge に送った内容
--   report_submissions = 選手・運営が送った内容 (誰が・いつ・どの試合に・何を)。トークンは入れない
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote / 本番 spsp は本番に出すとき (wrangler d1 migrations apply spsp --remote)

CREATE TABLE IF NOT EXISTS report_events (
  code          TEXT    PRIMARY KEY,         -- 報告ページの URL に入る 10 文字 (/jp/report/?c=)
  kind          TEXT    NOT NULL,            -- 'startgg' | 'challonge'
  target_id     TEXT    NOT NULL,            -- start.gg のイベント ID / Challonge のトーナメント ID
  event_id      INTEGER,                     -- start.gg のイベント ID (下位クラスは本戦のイベント)
  tournament_id INTEGER,
  class_id      INTEGER,                     -- 下位クラス (class_brackets.id)
  name          TEXT    NOT NULL DEFAULT '', -- 大会名・イベント名 (画面に出す)
  slug          TEXT    NOT NULL DEFAULT '', -- start.gg のイベントの slug / Challonge の URL
  admins        TEXT    NOT NULL DEFAULT '', -- 受付を始めた運営の start.gg ユーザー ID (カンマ区切り)
  token_enc     TEXT    NOT NULL DEFAULT '', -- 暗号化したトークン ('' = 期限切れ・停止で消した)
  token_exp_ms  INTEGER NOT NULL DEFAULT 0,  -- アクセストークンの期限
  settings      TEXT    NOT NULL DEFAULT '{}', -- 運営の設定 (JSON): top_cut = トップ何人からは運営が入力 (null = 最後まで選手が報告)、
                                             --   classes_only = 下位クラス (Bクラス等) の試合だけ選手が報告、double = Challonge のダブルイリミ
  status        TEXT    NOT NULL,            -- 'active' | 'stopped'
  created_ms    INTEGER NOT NULL,
  expires_ms    INTEGER NOT NULL             -- 受付の期限 (大会の終了の翌日の終わり)
);
CREATE UNIQUE INDEX IF NOT EXISTS report_events_target ON report_events (kind, target_id);

CREATE TABLE IF NOT EXISTS report_sets (
  code        TEXT    NOT NULL,
  set_id      TEXT    NOT NULL,
  state       TEXT    NOT NULL,              -- reported / agreed / conflict / review / fixed / reset
  users       TEXT    NOT NULL DEFAULT '',   -- 両側の選手の start.gg ユーザー ID ("|u1|u2|"、通知の検索用)
  slots       TEXT    NOT NULL DEFAULT '[]', -- 両側の entrant / participant の ID と名前 (JSON)
  applied     TEXT    NOT NULL DEFAULT '',   -- start.gg / Challonge に送った結果 (JSON、'' = 送っていない・取り消した)
  note        TEXT    NOT NULL DEFAULT '',   -- review の理由など (符号)
  floor_id    INTEGER NOT NULL DEFAULT 0,    -- この ID までの報告は数えない (運営が直した・取り消した後は、その後の報告だけで決める)
  version     INTEGER NOT NULL DEFAULT 0,    -- 同時の報告で上書きしないための版
  updated_ms  INTEGER NOT NULL,
  PRIMARY KEY (code, set_id)
);

CREATE TABLE IF NOT EXISTS report_submissions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  code      TEXT    NOT NULL,
  set_id    TEXT    NOT NULL,
  user_id   TEXT    NOT NULL,   -- 送った人の start.gg ユーザー ID
  side      INTEGER NOT NULL,   -- 0 / 1 = その試合のどちら側の選手か、-1 = 運営
  ts_ms     INTEGER NOT NULL,
  result    TEXT    NOT NULL,   -- 送った結果 (JSON: {winner, games:[{winner, chars:[a,b], stage}]})
  outcome   TEXT    NOT NULL DEFAULT ''   -- そのときの処理 (report / update / reset / none / locked / error:…)
);
CREATE INDEX IF NOT EXISTS report_submissions_set ON report_submissions (code, set_id, id);
CREATE INDEX IF NOT EXISTS report_submissions_user ON report_submissions (user_id, ts_ms);
