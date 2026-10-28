// テスト用のメモリ Store (src/store.ts の実装)。db.ts (D1) と同じ意味になるように書く。
export class MemStore {
  constructor() {
    this.votes = [];
    this.posts = [];
    this.errors = [];
    this.used = new Map();   // key → expires_ms
    this.csp = new Map();    // key → { directive, blocked, path, hits, first_seen, last_seen }
    this.cards = new Map();  // uid → { settings, updated_at }
    this.cardWrites = [];    // { uid, ts_ms, day }
    this.classes = [];       // class_brackets の行 (id, status 付き)
    this.classActions = [];  // { user_id, action, ts_ms, day }
    this.titleOwned = new Map();   // 'uid|lang' → { bits, updated, n_pre, n_post }
  }

  async recentActivity(table, userId, dayKey) {
    const rows = this[table].filter((r) => r.user_id === String(userId));
    const latest = rows.length ? rows[rows.length - 1].ts_ms : null;
    const todayCount = rows.filter((r) => r.ts.slice(0, 10) === dayKey).length;
    return { latestMs: latest, todayCount };
  }

  _guardOk(table, g) {
    const rows = this[table].filter((r) => r.user_id === g.userId);
    if (rows.some((r) => r.ts_ms > g.nowMs - g.minIntervalMs)) return false;
    if (rows.filter((r) => r.ts.slice(0, 10) === g.dayKey).length >= g.maxPerDay) return false;
    return true;
  }

  async insertVote(row, guard) {
    if (!this._guardOk('votes', guard)) return false;
    this.votes.push({ ...row });
    return true;
  }

  async insertPost(row, guard) {
    if (!this._guardOk('posts', guard)) return false;
    this.posts.push({ ...row });
    return true;
  }

  async insertError(row, maxRows, trimTo) {
    this.errors.push({ ...row });
    if (this.errors.length > maxRows) this.errors = this.errors.slice(this.errors.length - trimTo);
  }

  async listVotes() {
    return { rows: this.votes.map((r) => ({ ...r })), total: this.votes.length };
  }

  async listErrors(limit) {
    const total = this.errors.length;
    return { rows: this.errors.slice(Math.max(0, total - limit)).map((r) => ({ ...r })), total };
  }

  async checkState(key, consume, expiresMs, nowMs) {
    for (const [k, exp] of this.used) if (exp <= nowMs) this.used.delete(k);
    if (this.used.has(key)) return false;
    if (consume) this.used.set(key, expiresMs);
    return true;
  }

  async getCardSettings(uid) {
    const r = this.cards.get(String(uid));
    return r ? { ...r } : null;
  }

  async putCardSettings(uid, settings, updatedAt, g) {
    const rows = this.cardWrites.filter((r) => r.uid === g.userId);
    if (rows.some((r) => r.ts_ms > g.nowMs - g.minIntervalMs)) return false;
    if (rows.filter((r) => r.day === g.dayKey).length >= g.maxPerDay) return false;
    this.cardWrites.push({ uid: g.userId, ts_ms: g.nowMs, day: g.dayKey });
    if (settings === null) this.cards.delete(String(uid));
    else this.cards.set(String(uid), { settings, updated_at: updatedAt });
    this.cardWrites = this.cardWrites.filter((r) => r.ts_ms >= g.nowMs - 2 * 24 * 3600 * 1000);
    return true;
  }

  async classExists(challongeId) {
    return this.classes.some((r) => r.challonge_id === challongeId);
  }

  async classRateOk(g) {
    const mine = this.classes.filter((r) => r.registered_by === g.userId);
    if (mine.some((r) => r.ts_ms > g.nowMs - g.minIntervalMs)) return false;
    return mine.filter((r) => r.day === g.dayKey).length < g.maxPerDay;
  }

  async insertClassBracket(row, g) {
    if (this.classes.some((r) => r.challonge_id === row.challonge_id)) return { status: 'duplicate' };
    const mine = this.classes.filter((r) => r.registered_by === g.userId);
    if (mine.some((r) => r.ts_ms > g.nowMs - g.minIntervalMs)) return { status: 'rate_limited' };
    if (mine.filter((r) => r.day === g.dayKey).length >= g.maxPerDay) return { status: 'rate_limited' };
    const id = this.classes.length + 1;
    this.classes.push({ ...row, id, status: 'waiting' });
    return { status: 'ok', id };
  }

  async listClassWaitlist() {
    return this.classes.filter((r) => r.counted === 1 && r.status === 'waiting').map((r) => ({
      id: r.id, parent_event_id: r.parent_event_id, parent_tournament_id: r.parent_tournament_id, class_letter: r.class_letter,
      name: r.name, challonge_id: r.challonge_id, challonge_url: r.challonge_url, created_at: r.created_at,
    }));
  }

  async markClassDone(id) {
    const r = this.classes.find((x) => x.id === id);
    if (!r) return 'missing';
    if (r.status === 'deleted') return 'deleted';
    r.status = 'done';
    return 'done';
  }

  async getClassBracket(id) {
    const r = this.classes.find((x) => x.id === id);
    return r ? { id: r.id, parent_event_id: r.parent_event_id, challonge_id: r.challonge_id, registered_by: r.registered_by, status: r.status } : null;
  }

  async listClassMine(userId, sinceMs) {
    return this.classes.filter((r) => r.registered_by === userId && r.ts_ms >= sinceMs && r.status !== 'deleted')
      .sort((a, b) => b.id - a.id).map((r) => ({
        id: r.id, parent_event_id: r.parent_event_id, parent_tournament_id: r.parent_tournament_id, class_letter: r.class_letter,
        name: r.name, challonge_id: r.challonge_id, challonge_url: r.challonge_url, counted: r.counted === 1, status: r.status,
        created_at: r.created_at, entrant_count: r.entrant_count,
      }));
  }

  async markClassDeleted(id, deletedAt) {
    const r = this.classes.find((x) => x.id === id);
    if (r && r.status === 'waiting') { r.status = 'deleted'; r.deleted_at = deletedAt; return 'deleted'; }
    return r && r.status === 'done' ? 'done' : 'missing';
  }

  async getTitleOwned(uid, lang) {
    const r = this.titleOwned.get(String(Number(uid)) + '|' + lang);
    return r ? { ...r } : null;
  }

  async casTitleOwnedMany(lang, rows, date) {
    const conflicts = [];
    for (const r of rows) {
      const k = String(Number(r.uid)) + '|' + lang;
      const cur = this.titleOwned.get(k);
      const same = r.prev === null ? !cur
        : !!cur && cur.bits === r.prev.bits && cur.n_pre === r.prev.n_pre && cur.n_post === r.prev.n_post;
      if (!same) { conflicts.push(r.uid); continue; }
      this.titleOwned.set(k, { bits: r.bits, updated: cur && cur.bits === r.bits ? cur.updated : date, n_pre: r.n_pre, n_post: r.n_post });
    }
    return conflicts;
  }

  async listTitleOwned(lang, afterUid, limit) {
    return [...this.titleOwned.entries()].filter(([k]) => k.endsWith('|' + lang))
      .map(([k, v]) => ({ uid: Number(k.split('|')[0]), ...v }))
      .filter((x) => x.uid > afterUid).sort((a, b) => a.uid - b.uid).slice(0, limit);
  }

  async recordClassAction(action, g) {
    const mine = this.classActions.filter((r) => r.user_id === g.userId && r.action === action);
    if (mine.some((r) => r.ts_ms > g.nowMs - g.minIntervalMs)) return false;
    if (mine.filter((r) => r.day === g.dayKey).length >= g.maxPerDay) return false;
    this.classActions.push({ user_id: g.userId, action, ts_ms: g.nowMs, day: g.dayKey });
    this.classActions = this.classActions.filter((r) => r.ts_ms >= g.nowMs - 2 * 24 * 3600 * 1000);
    return true;
  }

  async insertLogin(row) {
    (this.logins = this.logins || []).push({ ...row });
  }

  async insertToolLog(row, maxPerDay) {
    this.toolLogs = this.toolLogs || [];
    if (this.toolLogs.filter((r) => r.user_id === row.user_id && r.day === row.day).length >= maxPerDay) return false;
    this.toolLogs.push({ ...row });
    return true;
  }

  async recordCsp(key, e, ts, maxKeys) {
    const cur = this.csp.get(key);
    if (cur) { cur.hits += 1; cur.last_seen = ts; return; }
    if (this.csp.size >= maxKeys) return;
    this.csp.set(key, { directive: e.directive, blocked: e.blocked, path: e.path, sample: e.sample || '', source: e.source || '', hits: 1, first_seen: ts, last_seen: ts });
  }

  async listCsp() {
    return [...this.csp.entries()].sort((a, b) => b[1].hits - a[1].hits || (a[0] < b[0] ? -1 : 1)).map(([, v]) => ({ ...v }));
  }
}
