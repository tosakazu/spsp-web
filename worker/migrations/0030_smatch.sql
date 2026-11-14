-- スマッチ (オンラインのレート対戦サイト smatch-jp.com) との連携 (2026-11-15)。docs/smatch_partner.md
--   smatch_players: スマッチから 1 日 1 回受け取る一覧 (start.gg を連携している人)。discriminator でつなぐ。
--     data = 受け取った 1 人分 (JSON)。「最高レートを見せない」設定の人の最高レートもここにだけ置く (公開の場所には出さない)。
--     linked = 最新の一覧に居るか。連携を解除した人は 0 にして表示をやめるが、行は消さない。
--     uid = SPSP の選手 (start.gg の user id。統合済みなら統合先)。SPSP に居なければ NULL。
--   partner_sync: 受け渡しの状態 (name = smatch_import / smatch_export)。失敗が続いていないかを管理側で見る (GET /api/partner/smatch/status)。
--   profile_settings: プロフィールの設定 (カードの設定とは別。{ smatch: false } = スマッチのレートを出さない)。
-- 適用: 本番 spsp・preview とも `wrangler d1 execute <db> --remote --file migrations/0030_smatch.sql` (deploy より先に)
CREATE TABLE IF NOT EXISTS smatch_players (
  discriminator TEXT PRIMARY KEY,
  uid           INTEGER,
  smatch_id     INTEGER NOT NULL,
  linked        INTEGER NOT NULL DEFAULT 1,
  data          TEXT NOT NULL,
  first_seen    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS smatch_players_uid ON smatch_players (uid);
CREATE TABLE IF NOT EXISTS partner_sync (
  name   TEXT PRIMARY KEY,
  ok_ms  INTEGER NOT NULL DEFAULT 0,
  try_ms INTEGER NOT NULL DEFAULT 0,
  fails  INTEGER NOT NULL DEFAULT 0,
  n      INTEGER NOT NULL DEFAULT 0,
  error  TEXT NOT NULL DEFAULT '',
  meta   TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS profile_settings (
  uid        INTEGER PRIMARY KEY,
  settings   TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
