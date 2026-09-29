// テスト用のメモリ Store (src/store.ts の実装)。db.ts (D1) と同じ意味になるように書く。
export class MemStore {
  constructor() {
    this.votes = [];
    this.posts = [];
    this.errors = [];
    this.used = new Map();   // key → expires_ms
    this.cards = new Map();  // uid → { settings, updated_at }
    this.cardWrites = [];    // { uid, ts_ms, day }
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
}
