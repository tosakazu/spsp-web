-- 結果報告の運営の設定を名前をつけて保存する (2026-10-30、docs/self_report_design.md)。アカウント (start.gg ユーザー ID) ごと。
--   settings = 大会に依らない形 (JSON): top_cut / classes_only と、何先をフェーズ名・順番・ラウンド名で持つ phases
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote / 本番 spsp は本番に出すとき (wrangler d1 migrations apply spsp --remote)

CREATE TABLE IF NOT EXISTS report_presets (
  user_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  settings    TEXT    NOT NULL,
  updated_ms  INTEGER NOT NULL,
  PRIMARY KEY (user_id, name)
);
