/**
 * D1 での Store 実装 (スプレッドシートの代わり)。テーブルは migrations/0001_init.sql。
 *
 * GAS はロック (LockService) で連投判定と append を直列化していた。D1 では
 * 条件付き INSERT (INSERT ... SELECT ... WHERE 条件) で同じことを 1 文で行い、
 * 書き込まれた行数で通ったかを判定する。
 */
import type { CardRow, ErrorRow, PostRow, RateGuard, RecentActivity, Store, VoteRow } from './store.ts';

const VOTE_COLS = 'ts, ts_ms, user_id, user_slug, gamer_tag, char_id, char_name, status';
const POST_COLS = 'ts, ts_ms, user_id, user_slug, gamer_tag, body, status';

/** 連投条件 (テーブル名は votes / posts の固定文字列のみ)。 */
function guardSql(table: 'votes' | 'posts'): string {
  return `NOT EXISTS (SELECT 1 FROM ${table} WHERE user_id = ?1 AND ts_ms > ?2 - ?3)
      AND (SELECT COUNT(*) FROM ${table} WHERE user_id = ?1 AND day = ?4) < ?5`;
}

function guardBinds(g: RateGuard): unknown[] {
  return [g.userId, g.nowMs, g.minIntervalMs, g.dayKey, g.maxPerDay];
}

export class D1Store implements Store {
  private readonly db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async recentActivity(table: 'votes' | 'posts', userId: string, dayKey: string): Promise<RecentActivity> {
    const latest = await this.db
      .prepare(`SELECT ts_ms FROM ${table} WHERE user_id = ? ORDER BY id DESC LIMIT 1`)
      .bind(userId).first<{ ts_ms: number }>();
    const today = await this.db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND day = ?`)
      .bind(userId, dayKey).first<{ n: number }>();
    return {
      latestMs: latest ? Number(latest.ts_ms) : null,
      todayCount: today ? Number(today.n) : 0,
    };
  }

  async insertVote(row: VoteRow, g: RateGuard): Promise<boolean> {
    // ?1..?5 = guard、?6.. = 行の値
    const res = await this.db.prepare(
      `INSERT INTO votes (${VOTE_COLS}, day)
       SELECT ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14
       WHERE ${guardSql('votes')}`)
      .bind(...guardBinds(g), row.ts, row.ts_ms, row.user_id, row.user_slug, row.gamer_tag,
        row.char_id, row.char_name, row.status, row.ts.slice(0, 10))
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async insertPost(row: PostRow, g: RateGuard): Promise<boolean> {
    const res = await this.db.prepare(
      `INSERT INTO posts (${POST_COLS}, day)
       SELECT ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
       WHERE ${guardSql('posts')}`)
      .bind(...guardBinds(g), row.ts, row.ts_ms, row.user_id, row.user_slug, row.gamer_tag,
        row.body, row.status, row.ts.slice(0, 10))
      .run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async insertError(row: ErrorRow, maxRows: number, trimTo: number): Promise<void> {
    await this.db.prepare(
      'INSERT INTO errors (ts, source, action, code, user_id, note) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(row.ts, row.source, row.action, row.code, row.user_id, row.note).run();
    const c = await this.db.prepare('SELECT COUNT(*) AS n FROM errors').first<{ n: number }>();
    if (c && Number(c.n) > maxRows) {
      // 古い行から削って trimTo 行だけ残す (gas/errlog.gs trimErrorsSheet_)
      await this.db.prepare(
        'DELETE FROM errors WHERE id NOT IN (SELECT id FROM errors ORDER BY id DESC LIMIT ?)')
        .bind(trimTo).run();
    }
  }

  async listVotes(): Promise<{ rows: VoteRow[]; total: number }> {
    const r = await this.db.prepare(`SELECT ${VOTE_COLS} FROM votes ORDER BY id ASC`).all<VoteRow>();
    const rows = r.results || [];
    return { rows, total: rows.length };
  }

  async listErrors(limit: number): Promise<{ rows: ErrorRow[]; total: number }> {
    const c = await this.db.prepare('SELECT COUNT(*) AS n FROM errors').first<{ n: number }>();
    const total = c ? Number(c.n) : 0;
    if (total === 0) return { rows: [], total: 0 };
    const r = await this.db.prepare(
      'SELECT ts, source, action, code, user_id, note FROM errors ORDER BY id DESC LIMIT ?')
      .bind(limit).all<ErrorRow>();
    return { rows: (r.results || []).reverse(), total };   // シートと同じ古い順
  }

  async checkState(key: string, consume: boolean, expiresMs: number, nowMs: number): Promise<boolean> {
    if (!consume) {
      const hit = await this.db.prepare('SELECT 1 AS x FROM used_states WHERE key = ? AND expires_ms > ?')
        .bind(key, nowMs).first();
      return !hit;
    }
    // 期限切れの掃除を同時に行う。INSERT OR IGNORE の書き込み行数が 0 なら使用済み。
    const [, ins] = await this.db.batch([
      this.db.prepare('DELETE FROM used_states WHERE expires_ms <= ?').bind(nowMs),
      this.db.prepare('INSERT OR IGNORE INTO used_states (key, expires_ms) VALUES (?, ?)').bind(key, expiresMs),
    ]);
    return (ins.meta?.changes ?? 0) > 0;
  }

  async getCardSettings(uid: string): Promise<CardRow | null> {
    const r = await this.db.prepare('SELECT settings, updated_at FROM card_settings WHERE uid = ?')
      .bind(Number(uid)).first<CardRow>();
    return r ? { settings: String(r.settings), updated_at: String(r.updated_at) } : null;
  }

  async putCardSettings(uid: string, settings: string | null, updatedAt: string, g: RateGuard): Promise<boolean> {
    // 1. 連投条件つきで書き込みを記録 (votes / posts と同じ条件付き INSERT)。記録できなければ連投
    const w = await this.db.prepare(
      `INSERT INTO card_writes (uid, ts_ms, day)
       SELECT ?1, ?2, ?4
       WHERE NOT EXISTS (SELECT 1 FROM card_writes WHERE uid = ?1 AND ts_ms > ?2 - ?3)
         AND (SELECT COUNT(*) FROM card_writes WHERE uid = ?1 AND day = ?4) < ?5`)
      .bind(g.userId, g.nowMs, g.minIntervalMs, g.dayKey, g.maxPerDay)
      .run();
    if ((w.meta?.changes ?? 0) === 0) return false;
    // 2. 設定を置き換える (null なら消す)。古い書き込み記録 (2 日より前) の掃除も同時に
    const put = settings === null
      ? this.db.prepare('DELETE FROM card_settings WHERE uid = ?').bind(Number(uid))
      : this.db.prepare(
        `INSERT INTO card_settings (uid, settings, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (uid) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`)
        .bind(Number(uid), settings, updatedAt);
    await this.db.batch([
      put,
      this.db.prepare('DELETE FROM card_writes WHERE ts_ms < ?').bind(g.nowMs - 2 * 24 * 3600 * 1000),
    ]);
    return true;
  }
}
