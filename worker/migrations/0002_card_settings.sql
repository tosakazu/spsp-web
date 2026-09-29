-- プレイヤーカードの設定 (docs/login_design.md「カードの設定」)。本人だけが書き、だれでも読める。
-- 適用: wrangler d1 migrations apply spsp-preview --env preview --remote (本番 spsp への適用は本番投入のとき)

CREATE TABLE IF NOT EXISTS card_settings (
  uid        INTEGER PRIMARY KEY,   -- start.gg のユーザー ID = SPSP の選手 ID (セッショントークン由来のみ)
  settings   TEXT NOT NULL,         -- JSON {template, color, ach} (api/card.ts で検証・正規化したもの)
  updated_at TEXT NOT NULL          -- ISO 8601 (+09:00)
);

-- 書き込みの記録 (連投制限用。votes / posts と同じ「直近の間隔 + 当日件数」の判定)。
-- 2 日より古い行は書き込みのたびに消す (db.ts putCardSettings)。
CREATE TABLE IF NOT EXISTS card_writes (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  uid   TEXT    NOT NULL,
  ts_ms INTEGER NOT NULL,
  day   TEXT    NOT NULL           -- yyyy-MM-dd (+09:00)
);
CREATE INDEX IF NOT EXISTS card_writes_uid_ts ON card_writes (uid, ts_ms);
CREATE INDEX IF NOT EXISTS card_writes_uid_day ON card_writes (uid, day);
CREATE INDEX IF NOT EXISTS card_writes_ts ON card_writes (ts_ms);
