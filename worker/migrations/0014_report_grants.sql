-- 結果報告の運営のログインを先にする (2026-10-30、docs/self_report_design.md)。
--   運営が start.gg でログイン (scope tournament.reporter) すると、受付を始めるまでの間トークンを暗号化してここに置く (アカウントごとに 1 行)。
--   管理している大会の一覧を出し、選んだイベントで受付を始めると、そのイベントの行 (report_events.token_enc) に写す。expires_ms を過ぎたら消す
-- 適用: preview は wrangler d1 execute spsp-preview --env preview --remote --file (migrations apply は 0011/0012 の記録が無く通らない) / 本番 spsp は本番に出すとき

CREATE TABLE IF NOT EXISTS report_grants (
  user_id       TEXT    PRIMARY KEY,
  token_enc     TEXT    NOT NULL,
  token_exp_ms  INTEGER NOT NULL,
  expires_ms    INTEGER NOT NULL
);
