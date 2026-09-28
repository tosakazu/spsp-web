-- spsp-web Worker: スプレッドシートの代わりの D1 テーブル (gas/config.gs のヘッダと同じ列 + 索引用の列)。
-- 適用: wrangler d1 migrations apply spsp [--remote] [--env preview|na]

-- char_votes シート: timestamp, user_id, user_slug, gamer_tag, char_id, char_name, status
CREATE TABLE IF NOT EXISTS votes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,   -- 挿入順 (= シートの行順)
  ts        TEXT    NOT NULL,                    -- ISO 8601 固定オフセット (例 2026-08-14T10:00:00+09:00)
  ts_ms     INTEGER NOT NULL,                    -- ts の epoch ms (連投判定)
  day       TEXT    NOT NULL,                    -- ts の yyyy-MM-dd (当日上限)
  user_id   TEXT    NOT NULL,                    -- currentUser 由来のみ (INV-1)
  user_slug TEXT    NOT NULL DEFAULT '',
  gamer_tag TEXT    NOT NULL DEFAULT '',
  char_id   TEXT    NOT NULL,
  char_name TEXT    NOT NULL DEFAULT '',
  status    TEXT    NOT NULL DEFAULT 'pending'   -- pending / approved / rejected (/ debug = 旧デバッグ行)
);
CREATE INDEX IF NOT EXISTS votes_user_ts ON votes (user_id, ts_ms);
CREATE INDEX IF NOT EXISTS votes_user_day ON votes (user_id, day);
CREATE INDEX IF NOT EXISTS votes_ts ON votes (ts);

-- posts シート (投稿機能。未公開だが GAS にあるので移植): timestamp, user_id, user_slug, gamer_tag, body, status
CREATE TABLE IF NOT EXISTS posts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL,
  ts_ms     INTEGER NOT NULL,
  day       TEXT    NOT NULL,
  user_id   TEXT    NOT NULL,
  user_slug TEXT    NOT NULL DEFAULT '',
  gamer_tag TEXT    NOT NULL DEFAULT '',
  body      TEXT    NOT NULL,
  status    TEXT    NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS posts_user_ts ON posts (user_id, ts_ms);
CREATE INDEX IF NOT EXISTS posts_user_day ON posts (user_id, day);

-- errors シート: timestamp, source, action, code, user_id, note
-- 個人を特定できる情報 (gamer_tag / slug / 本文 / キャラ) は書かない。
-- 行数上限 (ERRORS_MAX_ROWS=3000 → ERRORS_TRIM_TO=2000) は db.ts insertError が保つ。
CREATE TABLE IF NOT EXISTS errors (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT '',     -- server | client
  action  TEXT NOT NULL DEFAULT '',
  code    TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL DEFAULT '',     -- 数値化できないときは ''
  note    TEXT NOT NULL DEFAULT ''
);

-- 署名 state の単回使用 (GAS は CacheService に置いていた。期限は STATE_TTL_MS)。
-- key = 署名部分の先頭 100 文字。期限切れは checkState が消す。
CREATE TABLE IF NOT EXISTS used_states (
  key        TEXT PRIMARY KEY,
  expires_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS used_states_exp ON used_states (expires_ms);
