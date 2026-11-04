/**
 * D1 での Store 実装 (スプレッドシートの代わり)。テーブルは migrations/0001_init.sql。
 *
 * GAS はロック (LockService) で連投判定と append を直列化していた。D1 では
 * 条件付き INSERT (INSERT ... SELECT ... WHERE 条件) で同じことを 1 文で行い、
 * 書き込まれた行数で通ったかを判定する。
 */
import type { LoginRow, ReportEventPublic, ReportEventRow, ReportGrantRow, ReportHealthRow, ReportManualRow, ReportSnapshotRow, ReportPresetRow, ReportPushSubRow, ReportSetRow, ReportSubmissionRow,
  CardRow, CspRow, TitleOwnedRow, TitleOwnedWrite, ClassBracketRow, ClassInsertResult, ClassMineItem, ClassRecord, ClassWaitItem, ErrorRow, PostRow, RateGuard, RecentActivity, Store, ToolLogRow, VoteRow,
} from './store.ts';

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

  async insertLogin(row: LoginRow): Promise<void> {
    await this.db.prepare('INSERT INTO login_log (user_id, ts_ms, flow) VALUES (?, ?, ?)').bind(row.user_id, row.ts_ms, row.flow).run();
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

  async classExists(challongeId: number): Promise<boolean> {
    const r = await this.db.prepare('SELECT 1 AS x FROM class_brackets WHERE challonge_id = ?').bind(challongeId).first();
    return !!r;
  }

  async classRateOk(g: RateGuard): Promise<boolean> {
    const r = await this.db.prepare(
      `SELECT (NOT EXISTS (SELECT 1 FROM class_brackets WHERE registered_by = ?1 AND ts_ms > ?2 - ?3)
         AND (SELECT COUNT(*) FROM class_brackets WHERE registered_by = ?1 AND day = ?4) < ?5) AS ok`)
      .bind(g.userId, g.nowMs, g.minIntervalMs, g.dayKey, g.maxPerDay).first<{ ok: number }>();
    return !!(r && Number(r.ok));
  }

  async insertClassBracket(row: ClassBracketRow, g: RateGuard): Promise<ClassInsertResult> {
    // ?1..?5 = 連投条件 (votes / posts と同じ形、registered_by ごと)。challonge_id の重複は UNIQUE 制約で弾く
    let res: D1Result;
    try {
      res = await this.db.prepare(
        `INSERT INTO class_brackets (created_at, ts_ms, day, parent_event_id, parent_tournament_id, class_letter, name,
           challonge_id, challonge_url, format, counted, place_min, place_max, seeding, entrant_count, registered_by)
         SELECT ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21
         WHERE NOT EXISTS (SELECT 1 FROM class_brackets WHERE registered_by = ?1 AND ts_ms > ?2 - ?3)
           AND (SELECT COUNT(*) FROM class_brackets WHERE registered_by = ?1 AND day = ?4) < ?5`)
        .bind(g.userId, g.nowMs, g.minIntervalMs, g.dayKey, g.maxPerDay,
          row.created_at, row.ts_ms, row.day, row.parent_event_id, row.parent_tournament_id, row.class_letter, row.name,
          row.challonge_id, row.challonge_url, row.format, row.counted, row.place_min, row.place_max, row.seeding,
          row.entrant_count, row.registered_by)
        .run();
    } catch (ex) {
      if (/UNIQUE/i.test(ex instanceof Error ? ex.message : String(ex))) return { status: 'duplicate' };
      throw ex;
    }
    if ((res.meta?.changes ?? 0) === 0) return { status: 'rate_limited' };
    return { status: 'ok', id: Number(res.meta?.last_row_id) };
  }

  async listClassWaitlist(): Promise<ClassWaitItem[]> {
    const r = await this.db.prepare(
      `SELECT id, parent_event_id, parent_tournament_id, class_letter, name, challonge_id, challonge_url, created_at
       FROM class_brackets WHERE counted = 1 AND status = 'waiting' ORDER BY id ASC`).all<ClassWaitItem>();
    return (r.results || []).map((x) => ({ ...x, id: Number(x.id), parent_event_id: Number(x.parent_event_id),
      parent_tournament_id: Number(x.parent_tournament_id), challonge_id: Number(x.challonge_id) }));
  }

  async markClassDone(id: number): Promise<'done' | 'deleted' | 'missing'> {
    const hit = await this.db.prepare('SELECT status FROM class_brackets WHERE id = ?').bind(id).first<{ status: string }>();
    if (!hit) return 'missing';
    if (hit.status === 'deleted') return 'deleted';
    await this.db.prepare("UPDATE class_brackets SET status = 'done' WHERE id = ? AND status <> 'deleted'").bind(id).run();
    return 'done';
  }

  async getClassBracket(id: number): Promise<ClassRecord | null> {
    const r = await this.db.prepare(
      'SELECT id, parent_event_id, challonge_id, registered_by, status FROM class_brackets WHERE id = ?').bind(id).first<ClassRecord>();
    return r ? { id: Number(r.id), parent_event_id: Number(r.parent_event_id), challonge_id: Number(r.challonge_id),
      registered_by: String(r.registered_by), status: String(r.status) } : null;
  }

  async listClassMine(userId: string, sinceMs: number): Promise<ClassMineItem[]> {
    const r = await this.db.prepare(
      `SELECT id, parent_event_id, parent_tournament_id, class_letter, name, challonge_id, challonge_url, counted, status,
              created_at, entrant_count
       FROM class_brackets WHERE registered_by = ? AND ts_ms >= ? AND status <> 'deleted' ORDER BY id DESC`)
      .bind(userId, sinceMs).all<Record<string, unknown>>();
    return (r.results || []).map((x) => ({
      id: Number(x.id), parent_event_id: Number(x.parent_event_id), parent_tournament_id: Number(x.parent_tournament_id),
      class_letter: String(x.class_letter), name: String(x.name), challonge_id: Number(x.challonge_id),
      challonge_url: String(x.challonge_url), counted: Number(x.counted) === 1, status: String(x.status),
      created_at: String(x.created_at), entrant_count: Number(x.entrant_count),
    }));
  }

  async markClassDeleted(id: number, deletedAt: string): Promise<'deleted' | 'done' | 'missing'> {
    const res = await this.db.prepare(
      "UPDATE class_brackets SET status = 'deleted', deleted_at = ? WHERE id = ? AND status = 'waiting'").bind(deletedAt, id).run();
    if ((res.meta?.changes ?? 0) > 0) return 'deleted';
    const r = await this.db.prepare('SELECT status FROM class_brackets WHERE id = ?').bind(id).first<{ status: string }>();
    return r && r.status === 'done' ? 'done' : 'missing';
  }

  async getTitleOwned(uid: string, lang: string): Promise<TitleOwnedRow | null> {
    const r = await this.db.prepare('SELECT bits, updated, n_pre, n_post FROM title_owned WHERE uid = ? AND lang = ?')
      .bind(Number(uid), lang).first<TitleOwnedRow>();
    return r ? { bits: String(r.bits), updated: String(r.updated), n_pre: Number(r.n_pre), n_post: Number(r.n_post) } : null;
  }

  async casTitleOwnedMany(lang: string, rows: TitleOwnedWrite[], date: string): Promise<string[]> {
    const conflicts: string[] = [];
    for (let i = 0; i < rows.length; i += 100) {
      const part = rows.slice(i, i + 100);
      const res = await this.db.batch(part.map((r) => (r.prev === null
        ? this.db.prepare(
          `INSERT INTO title_owned (uid, lang, bits, updated, n_pre, n_post) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
           ON CONFLICT (uid, lang) DO NOTHING`)
          .bind(Number(r.uid), lang, r.bits, date, r.n_pre, r.n_post)
        // SET の右辺は書く前の行を見る: updated はビットが変わったときだけ今日にする
        : this.db.prepare(
          `UPDATE title_owned SET updated = CASE WHEN bits = ?3 THEN updated ELSE ?4 END, bits = ?3, n_pre = ?5, n_post = ?6
           WHERE uid = ?1 AND lang = ?2 AND bits = ?7 AND n_pre = ?8 AND n_post = ?9`)
          .bind(Number(r.uid), lang, r.bits, date, r.n_pre, r.n_post, r.prev.bits, r.prev.n_pre, r.prev.n_post))));
      res.forEach((x, j) => { if ((x.meta?.changes ?? 0) === 0) conflicts.push(part[j].uid); });
    }
    return conflicts;
  }

  async listTitleOwned(lang: string, afterUid: number, limit: number): Promise<({ uid: number } & TitleOwnedRow)[]> {
    const r = await this.db.prepare('SELECT uid, bits, updated, n_pre, n_post FROM title_owned WHERE lang = ? AND uid > ? ORDER BY uid ASC LIMIT ?')
      .bind(lang, afterUid, limit).all<{ uid: number } & TitleOwnedRow>();
    return (r.results || []).map((x) => ({ uid: Number(x.uid), bits: String(x.bits), updated: String(x.updated), n_pre: Number(x.n_pre), n_post: Number(x.n_post) }));
  }

  async recordClassAction(action: string, g: RateGuard): Promise<boolean> {
    const res = await this.db.prepare(
      `INSERT INTO class_actions (user_id, action, ts_ms, day)
       SELECT ?1, ?6, ?2, ?4
       WHERE NOT EXISTS (SELECT 1 FROM class_actions WHERE user_id = ?1 AND action = ?6 AND ts_ms > ?2 - ?3)
         AND (SELECT COUNT(*) FROM class_actions WHERE user_id = ?1 AND action = ?6 AND day = ?4) < ?5`)
      .bind(g.userId, g.nowMs, g.minIntervalMs, g.dayKey, g.maxPerDay, action).run();
    if ((res.meta?.changes ?? 0) === 0) return false;
    await this.db.prepare('DELETE FROM class_actions WHERE ts_ms < ?').bind(g.nowMs - 2 * 24 * 3600 * 1000).run();
    return true;
  }

  async insertToolLog(r: ToolLogRow, maxPerDay: number): Promise<boolean> {
    const res = await this.db.prepare(
      `INSERT INTO tool_logs (ts, ts_ms, day, tool, action, user_id, gamer_tag, verified, auth, tournament_id, tournament_slug, tournament_name,
         event_id, event_name, phase_id, count, detail)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17
       WHERE (SELECT COUNT(*) FROM tool_logs WHERE user_id = ?6 AND day = ?3) < ?18`)
      .bind(r.ts, r.ts_ms, r.day, r.tool, r.action, r.user_id, r.gamer_tag, r.verified, r.auth, r.tournament_id, r.tournament_slug, r.tournament_name,
        r.event_id, r.event_name, r.phase_id, r.count, r.detail, maxPerDay).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async recordCsp(key: string, e: { directive: string; blocked: string; path: string; sample: string; source: string }, ts: string, maxKeys: number): Promise<void> {
    const up = await this.db.prepare('UPDATE csp_reports SET hits = hits + 1, last_seen = ? WHERE key = ?').bind(ts, key).run();
    if ((up.meta?.changes ?? 0) > 0) return;
    await this.db.prepare(
      `INSERT OR IGNORE INTO csp_reports (key, directive, blocked, path, sample, source, hits, first_seen, last_seen)
       SELECT ?1, ?2, ?3, ?4, ?7, ?8, 1, ?5, ?5 WHERE (SELECT COUNT(*) FROM csp_reports) < ?6`)
      .bind(key, e.directive, e.blocked, e.path, ts, maxKeys, e.sample, e.source).run();
  }

  async listCsp(): Promise<CspRow[]> {
    const r = await this.db.prepare(
      'SELECT directive, blocked, path, sample, source, hits, first_seen, last_seen FROM csp_reports ORDER BY hits DESC, key ASC').all<CspRow>();
    return (r.results || []).map((x) => ({ ...x, hits: Number(x.hits) }));
  }

  async getReportEvent(code: string): Promise<ReportEventRow | null> {
    return await this.db.prepare('SELECT * FROM report_events WHERE code = ?').bind(code).first<ReportEventRow>() ?? null;
  }

  async getReportEventByTarget(kind: string, targetId: string): Promise<ReportEventRow | null> {
    return await this.db.prepare('SELECT * FROM report_events WHERE kind = ? AND target_id = ?').bind(kind, targetId).first<ReportEventRow>() ?? null;
  }

  async upsertReportEvent(r: ReportEventRow): Promise<void> {
    await this.db.prepare(
      `INSERT INTO report_events (code, kind, target_id, event_id, tournament_id, class_id, name, slug, admins, token_enc, token_exp_ms, status, created_ms, expires_ms, settings)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
       ON CONFLICT (kind, target_id) DO UPDATE SET event_id = ?4, tournament_id = ?5, class_id = ?6, name = ?7, slug = ?8, admins = ?9,
         token_enc = ?10, token_exp_ms = ?11, status = ?12, expires_ms = ?14, settings = ?15`)
      .bind(r.code, r.kind, r.target_id, r.event_id, r.tournament_id, r.class_id, r.name, r.slug, r.admins, r.token_enc, r.token_exp_ms, r.status, r.created_ms, r.expires_ms, r.settings)
      .run();
  }

  async updateReportEventToken(code: string, tokenEnc: string, tokenExpMs: number): Promise<void> {
    await this.db.prepare('UPDATE report_events SET token_enc = ?, token_exp_ms = ? WHERE code = ?').bind(tokenEnc, tokenExpMs, code).run();
  }

  async updateReportEventAdmins(code: string, admins: string): Promise<void> {
    await this.db.prepare('UPDATE report_events SET admins = ? WHERE code = ?').bind(admins, code).run();
  }

  async updateReportEventManagers(code: string, managers: string): Promise<void> {
    await this.db.prepare('UPDATE report_events SET managers = ? WHERE code = ?').bind(managers, code).run();
  }

  async updateReportEventSettings(code: string, settings: string): Promise<void> {
    await this.db.prepare('UPDATE report_events SET settings = ? WHERE code = ?').bind(settings, code).run();
  }

  async listReportPresets(userId: string): Promise<ReportPresetRow[]> {
    const r = await this.db.prepare('SELECT name, settings, updated_ms FROM report_presets WHERE user_id = ? ORDER BY updated_ms DESC').bind(userId).all<ReportPresetRow>();
    return r.results ?? [];
  }

  async saveReportPreset(userId: string, row: ReportPresetRow, max: number): Promise<boolean> {
    // 新しい名前は max 件未満のときだけ足す (1 文で数えて足す)
    const r = await this.db.prepare(
      `INSERT INTO report_presets (user_id, name, settings, updated_ms)
       SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM report_presets WHERE user_id = ?1 AND name = ?2)
         OR (SELECT COUNT(*) FROM report_presets WHERE user_id = ?1) < ?5
       ON CONFLICT (user_id, name) DO UPDATE SET settings = ?3, updated_ms = ?4`)
      .bind(userId, row.name, row.settings, row.updated_ms, max).run();
    return (r.meta?.changes ?? 0) > 0;
  }

  async deleteReportPreset(userId: string, name: string): Promise<void> {
    await this.db.prepare('DELETE FROM report_presets WHERE user_id = ? AND name = ?').bind(userId, name).run();
  }

  async getReportGrant(userId: string, nowMs: number): Promise<ReportGrantRow | null> {
    return await this.db.prepare('SELECT * FROM report_grants WHERE user_id = ? AND expires_ms >= ?').bind(userId, nowMs).first<ReportGrantRow>() ?? null;
  }

  async putReportGrant(row: ReportGrantRow): Promise<void> {
    await this.db.prepare(
      `INSERT INTO report_grants (user_id, token_enc, token_exp_ms, expires_ms) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id) DO UPDATE SET token_enc = ?2, token_exp_ms = ?3, expires_ms = ?4`)
      .bind(row.user_id, row.token_enc, row.token_exp_ms, row.expires_ms).run();
  }

  async putReportPushSub(row: ReportPushSubRow, max: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('INSERT INTO report_push_subs (endpoint, user_id, p256dh, auth, created_ms) VALUES (?, ?, ?, ?, ?) '
        + 'ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_ms = excluded.created_ms')
        .bind(row.endpoint, row.user_id, row.p256dh, row.auth, row.created_ms),
      this.db.prepare('DELETE FROM report_push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM report_push_subs WHERE user_id = ? ORDER BY created_ms DESC LIMIT ?)')
        .bind(row.user_id, row.user_id, max),
    ]);
  }

  async deleteReportPushSub(endpoint: string, userId: string | null): Promise<void> {
    if (userId === null) await this.db.prepare('DELETE FROM report_push_subs WHERE endpoint = ?').bind(endpoint).run();
    else await this.db.prepare('DELETE FROM report_push_subs WHERE endpoint = ? AND user_id = ?').bind(endpoint, userId).run();
  }

  async listReportPushSubs(userIds: string[]): Promise<ReportPushSubRow[]> {
    if (!userIds.length) return [];
    const q = 'SELECT endpoint, user_id, p256dh, auth, created_ms FROM report_push_subs WHERE user_id IN (' + userIds.map(() => '?').join(',') + ')';
    const r = await this.db.prepare(q).bind(...userIds).all<ReportPushSubRow>();
    return r.results || [];
  }

  async deleteReportGrant(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM report_grants WHERE user_id = ?').bind(userId).run();
  }

  async stopReportEvent(code: string): Promise<void> {
    await this.db.prepare("UPDATE report_events SET status = 'stopped', token_enc = '' WHERE code = ?").bind(code).run();
  }

  async purgeReportTokens(nowMs: number): Promise<void> {
    await this.db.prepare("UPDATE report_events SET status = 'stopped', token_enc = '' WHERE expires_ms < ? AND (token_enc <> '' OR status = 'active')").bind(nowMs).run();
    await this.db.prepare('DELETE FROM report_grants WHERE expires_ms < ?').bind(nowMs).run();
  }

  async listActiveReportEvents(nowMs: number): Promise<ReportEventPublic[]> {
    const r = await this.db.prepare(
      "SELECT code, kind, event_id, tournament_id, class_id, name, slug, expires_ms, settings FROM report_events WHERE status = 'active' AND expires_ms >= ? ORDER BY created_ms")
      .bind(nowMs).all<ReportEventPublic>();
    return r.results || [];
  }

  async getReportSet(code: string, setId: string): Promise<ReportSetRow | null> {
    return await this.db.prepare('SELECT * FROM report_sets WHERE code = ? AND set_id = ?').bind(code, setId).first<ReportSetRow>() ?? null;
  }

  async casReportSet(r: ReportSetRow, prevVersion: number | null): Promise<boolean> {
    const res = prevVersion === null
      ? await this.db.prepare(
        `INSERT OR IGNORE INTO report_sets (code, set_id, state, users, slots, applied, note, floor_id, version, updated_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(r.code, r.set_id, r.state, r.users, r.slots, r.applied, r.note, r.floor_id, r.version, r.updated_ms).run()
      : await this.db.prepare(
        `UPDATE report_sets SET state = ?, users = ?, slots = ?, applied = ?, note = ?, floor_id = ?, version = ?, updated_ms = ?
         WHERE code = ? AND set_id = ? AND version = ?`)
        .bind(r.state, r.users, r.slots, r.applied, r.note, r.floor_id, r.version, r.updated_ms, r.code, r.set_id, prevVersion).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async listReportSets(code: string): Promise<ReportSetRow[]> {
    const r = await this.db.prepare('SELECT * FROM report_sets WHERE code = ? ORDER BY updated_ms DESC').bind(code).all<ReportSetRow>();
    return r.results || [];
  }

  async listReportSetsForUser(userId: string, codes: string[]): Promise<ReportSetRow[]> {
    if (!codes.length) return [];
    const marks = codes.map(() => '?').join(', ');
    const r = await this.db.prepare(`SELECT * FROM report_sets WHERE users LIKE ? AND code IN (${marks}) ORDER BY updated_ms DESC LIMIT 50`)
      .bind('%|' + userId + '|%', ...codes).all<ReportSetRow>();
    return r.results || [];
  }

  async insertReportSubmission(r: ReportSubmissionRow): Promise<number> {
    const res = await this.db.prepare('INSERT INTO report_submissions (code, set_id, user_id, side, ts_ms, result, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(r.code, r.set_id, r.user_id, r.side, r.ts_ms, r.result, r.outcome).run();
    return Number(res.meta?.last_row_id ?? 0);
  }

  async setReportSubmissionOutcome(id: number, outcome: string): Promise<void> {
    await this.db.prepare('UPDATE report_submissions SET outcome = ? WHERE id = ?').bind(outcome, id).run();
  }

  async listReportSubmissions(code: string, setId: string): Promise<ReportSubmissionRow[]> {
    const r = await this.db.prepare('SELECT * FROM report_submissions WHERE code = ? AND set_id = ? ORDER BY id').bind(code, setId).all<ReportSubmissionRow>();
    return (r.results || []).map((x) => ({ ...x, id: Number(x.id), side: Number(x.side), ts_ms: Number(x.ts_ms) }));
  }

  async updateReportSubmission(id: number, setId: string, side: number, result: string): Promise<void> {
    await this.db.prepare('UPDATE report_submissions SET set_id = ?, side = ?, result = ? WHERE id = ?').bind(setId, side, result, id).run();
  }

  async deleteReportSet(code: string, setId: string): Promise<void> {
    await this.db.prepare('DELETE FROM report_sets WHERE code = ? AND set_id = ?').bind(code, setId).run();
  }

  async getReportHealth(kind: string): Promise<ReportHealthRow | null> {
    return await this.db.prepare('SELECT * FROM report_health WHERE kind = ?').bind(kind).first<ReportHealthRow>() ?? null;
  }

  async putReportHealth(r: ReportHealthRow): Promise<void> {
    await this.db.prepare(
      `INSERT INTO report_health (kind, down_since_ms, last_fail_ms, last_ok_ms, fails, probe_ms, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (kind) DO UPDATE SET down_since_ms = ?2, last_fail_ms = ?3, last_ok_ms = ?4, fails = ?5, probe_ms = ?6, note = ?7`)
      .bind(r.kind, r.down_since_ms, r.last_fail_ms, r.last_ok_ms, r.fails, r.probe_ms, r.note).run();
  }

  async claimReportProbe(kind: string, nowMs: number, gapMs: number): Promise<boolean> {
    const res = await this.db.prepare('UPDATE report_health SET probe_ms = ? WHERE kind = ? AND probe_ms < ?').bind(nowMs, kind, nowMs - gapMs).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async getReportSnapshot(code: string): Promise<ReportSnapshotRow | null> {
    return await this.db.prepare('SELECT * FROM report_snapshots WHERE code = ?').bind(code).first<ReportSnapshotRow>() ?? null;
  }

  async getReportSnapshotMeta(code: string): Promise<{ synced_ms: number; full: boolean; sets: number } | null> {
    const r = await this.db.prepare(
      `SELECT synced_ms, json_extract(data, '$.full') AS full, (SELECT COUNT(*) FROM json_each(report_snapshots.data, '$.sets')) AS n
       FROM report_snapshots WHERE code = ?`).bind(code).first<{ synced_ms: number; full: number | null; n: number }>();
    return r ? { synced_ms: Number(r.synced_ms), full: Number(r.full) === 1, sets: Number(r.n) || 0 } : null;
  }

  async putReportSnapshot(code: string, data: string, syncedMs: number): Promise<void> {
    await this.db.prepare(
      `INSERT INTO report_snapshots (code, data, synced_ms, lock_ms) VALUES (?1, ?2, ?3, 0)
       ON CONFLICT (code) DO UPDATE SET data = ?2, synced_ms = ?3, lock_ms = 0`).bind(code, data, syncedMs).run();
  }

  async claimReportSnapshot(code: string, nowMs: number, holdMs: number): Promise<boolean> {
    await this.db.prepare("INSERT OR IGNORE INTO report_snapshots (code, data, synced_ms, lock_ms) VALUES (?, '{}', 0, 0)").bind(code).run();
    const res = await this.db.prepare('UPDATE report_snapshots SET lock_ms = ? WHERE code = ? AND lock_ms < ?').bind(nowMs, code, nowMs - holdMs).run();
    return (res.meta?.changes ?? 0) > 0;
  }

  async releaseReportSnapshot(code: string): Promise<void> {
    await this.db.prepare('UPDATE report_snapshots SET lock_ms = 0 WHERE code = ?').bind(code).run();
  }

  async insertReportManual(r: ReportManualRow): Promise<number> {
    const res = await this.db.prepare(
      `INSERT INTO report_manual_sets (code, side, group_id, slots, users, station, set_id, status, created_by, created_ms, updated_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(r.code, r.side, r.group_id, r.slots, r.users, r.station, r.set_id, r.status, r.created_by, r.created_ms, r.updated_ms).run();
    return Number(res.meta?.last_row_id ?? 0);
  }

  async getReportManual(code: string, id: number): Promise<ReportManualRow | null> {
    const r = await this.db.prepare('SELECT * FROM report_manual_sets WHERE code = ? AND id = ?').bind(code, id).first<ReportManualRow>();
    return r ? { ...r, id: Number(r.id) } : null;
  }

  async listReportManual(code: string): Promise<ReportManualRow[]> {
    const r = await this.db.prepare('SELECT * FROM report_manual_sets WHERE code = ? ORDER BY id DESC LIMIT 200').bind(code).all<ReportManualRow>();
    return (r.results || []).map((x) => ({ ...x, id: Number(x.id) }));
  }

  async updateReportManual(code: string, id: number, status: string, setId: string, nowMs: number): Promise<void> {
    await this.db.prepare('UPDATE report_manual_sets SET status = ?, set_id = ?, updated_ms = ? WHERE code = ? AND id = ?').bind(status, setId, nowMs, code, id).run();
  }

  async listReportManualForUser(userId: string, code: string): Promise<ReportManualRow[]> {
    const r = await this.db.prepare("SELECT * FROM report_manual_sets WHERE code = ? AND status = 'open' AND users LIKE ? ORDER BY id DESC LIMIT 20")
      .bind(code, '%|' + userId + '|%').all<ReportManualRow>();
    return (r.results || []).map((x) => ({ ...x, id: Number(x.id) }));
  }

  async putReportPick(code: string, userId: string, setId: string, nowMs: number): Promise<void> {
    if (!setId) { await this.db.prepare('DELETE FROM report_picks WHERE code = ? AND user_id = ?').bind(code, userId).run(); return; }
    await this.db.prepare('INSERT INTO report_picks (code, user_id, set_id, ts_ms) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (code, user_id) DO UPDATE SET set_id = ?3, ts_ms = ?4')
      .bind(code, userId, setId, nowMs).run();
  }

  async deleteReportPicksForSet(code: string, setId: string): Promise<void> {
    await this.db.prepare('DELETE FROM report_picks WHERE code = ? AND set_id = ?').bind(code, setId).run();
  }

  async listReportPicks(code: string, sinceMs: number): Promise<{ user_id: string; set_id: string; ts_ms: number }[]> {
    const r = await this.db.prepare('SELECT user_id, set_id, ts_ms FROM report_picks WHERE code = ? AND ts_ms >= ? LIMIT 2000').bind(code, sinceMs).all<{ user_id: string; set_id: string; ts_ms: number }>();
    return r.results || [];
  }

  async reportSubmissionActivity(userId: string, sinceMs: number): Promise<{ count: number; latestMs: number | null }> {
    const r = await this.db.prepare('SELECT COUNT(*) AS n, MAX(ts_ms) AS t FROM report_submissions WHERE user_id = ? AND ts_ms >= ?')
      .bind(userId, sinceMs).first<{ n: number; t: number | null }>();
    return { count: r ? Number(r.n) : 0, latestMs: r && r.t !== null ? Number(r.t) : null };
  }
}
