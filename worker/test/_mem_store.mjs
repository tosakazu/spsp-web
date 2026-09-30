// テスト用のメモリ Store (src/store.ts の実装)。db.ts (D1) と同じ意味になるように書く。
export class MemStore {
  constructor() {
    this.votes = [];
    this.posts = [];
    this.errors = [];
    this.used = new Map();   // key → expires_ms
    this.cards = new Map();  // uid → { settings, updated_at }
    this.cardWrites = [];    // { uid, ts_ms, day }
    this.classes = [];       // class_brackets の行 (id, status 付き)
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
    if (!r) return false;
    r.status = 'done';
    return true;
  }
}
