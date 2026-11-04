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

  // ── 試合結果の報告 (report_events / report_sets / report_submissions) ──
  _rep() {
    if (!this.reportEvents) { this.reportEvents = []; this.reportSets = []; this.reportSubs = []; this.reportPresets = []; this.reportGrants = []; this.reportPush = []; this.reportHealth = []; this.reportSnaps = []; this.reportManual = []; this.reportPicks = []; this.reportDqs = []; this.reportNoshows = []; this.reportStarts = []; }
  }

  async getReportEvent(code) { this._rep(); const r = this.reportEvents.find((x) => x.code === code); return r ? { ...r } : null; }

  async getReportEventByTarget(kind, targetId) {
    this._rep(); const r = this.reportEvents.find((x) => x.kind === kind && x.target_id === targetId); return r ? { ...r } : null;
  }

  async upsertReportEvent(row) {
    this._rep();
    const i = this.reportEvents.findIndex((x) => x.kind === row.kind && x.target_id === row.target_id);
    if (i < 0) { this.reportEvents.push({ managers: '[]', ...row }); return; }
    const old = this.reportEvents[i];
    this.reportEvents[i] = { ...row, code: old.code, created_ms: old.created_ms, managers: old.managers || '[]' };
  }

  async updateReportEventToken(code, tokenEnc, tokenExpMs) {
    this._rep(); for (const x of this.reportEvents) if (x.code === code) { x.token_enc = tokenEnc; x.token_exp_ms = tokenExpMs; }
  }

  async updateReportEventAdmins(code, admins) { this._rep(); for (const x of this.reportEvents) if (x.code === code) x.admins = admins; }
  async updateReportEventManagers(code, managers) { this._rep(); for (const x of this.reportEvents) if (x.code === code) x.managers = managers; }
  async updateReportEventSettings(code, settings) { this._rep(); for (const x of this.reportEvents) if (x.code === code) x.settings = settings; }

  async listReportPresets(userId) {
    this._rep(); return this.reportPresets.filter((x) => x.user_id === userId).sort((a, b) => b.updated_ms - a.updated_ms).map(({ name, settings, updated_ms }) => ({ name, settings, updated_ms }));
  }

  async saveReportPreset(userId, row, max) {
    this._rep();
    const old = this.reportPresets.find((x) => x.user_id === userId && x.name === row.name);
    if (old) { old.settings = row.settings; old.updated_ms = row.updated_ms; return true; }
    if (this.reportPresets.filter((x) => x.user_id === userId).length >= max) return false;
    this.reportPresets.push({ user_id: userId, ...row }); return true;
  }

  async deleteReportPreset(userId, name) { this._rep(); this.reportPresets = this.reportPresets.filter((x) => !(x.user_id === userId && x.name === name)); }

  async getReportGrant(userId, nowMs) { this._rep(); const r = this.reportGrants.find((x) => x.user_id === userId && x.expires_ms >= nowMs); return r ? { ...r } : null; }
  async putReportGrant(row) { this._rep(); this.reportGrants = this.reportGrants.filter((x) => x.user_id !== row.user_id).concat([{ ...row }]); }
  async putReportPushSub(row, max) {
    this._rep(); this.reportPush = this.reportPush.filter((x) => x.endpoint !== row.endpoint).concat([{ ...row }]);
    const mine = this.reportPush.filter((x) => x.user_id === row.user_id).sort((a, b) => b.created_ms - a.created_ms);
    const drop = new Set(mine.slice(max).map((x) => x.endpoint));
    this.reportPush = this.reportPush.filter((x) => !drop.has(x.endpoint));
  }
  async deleteReportPushSub(endpoint, userId) { this._rep(); this.reportPush = this.reportPush.filter((x) => !(x.endpoint === endpoint && (userId === null || x.user_id === userId))); }
  async listReportPushSubs(userIds) { this._rep(); return this.reportPush.filter((x) => userIds.includes(x.user_id)).map((x) => ({ ...x })); }
  async deleteReportGrant(userId) { this._rep(); this.reportGrants = this.reportGrants.filter((x) => x.user_id !== userId); }

  async stopReportEvent(code) { this._rep(); for (const x of this.reportEvents) if (x.code === code) { x.status = 'stopped'; x.token_enc = ''; } }

  async purgeReportTokens(nowMs) {
    this._rep(); for (const x of this.reportEvents) if (x.expires_ms < nowMs) { x.status = 'stopped'; x.token_enc = ''; }
    this.reportGrants = this.reportGrants.filter((x) => x.expires_ms >= nowMs);
  }

  async listActiveReportEvents(nowMs) {
    this._rep();
    return this.reportEvents.filter((x) => x.status === 'active' && x.expires_ms >= nowMs).sort((a, b) => a.created_ms - b.created_ms)
      .map(({ code, kind, event_id, tournament_id, class_id, name, slug, expires_ms, settings }) => ({ code, kind, event_id, tournament_id, class_id, name, slug, expires_ms, settings }));
  }

  async getReportSet(code, setId) { this._rep(); const r = this.reportSets.find((x) => x.code === code && x.set_id === setId); return r ? { ...r } : null; }

  async casReportSet(row, prevVersion) {
    this._rep();
    const i = this.reportSets.findIndex((x) => x.code === row.code && x.set_id === row.set_id);
    if (prevVersion === null) { if (i >= 0) return false; this.reportSets.push({ ...row }); return true; }
    if (i < 0 || this.reportSets[i].version !== prevVersion) return false;
    this.reportSets[i] = { ...row };
    return true;
  }

  async listReportSets(code) {
    this._rep(); return this.reportSets.filter((x) => x.code === code).sort((a, b) => b.updated_ms - a.updated_ms).map((x) => ({ ...x }));
  }

  async listReportSetsForUser(userId, codes) {
    this._rep();
    return this.reportSets.filter((x) => codes.includes(x.code) && x.users.includes('|' + userId + '|')).sort((a, b) => b.updated_ms - a.updated_ms).map((x) => ({ ...x }));
  }

  async insertReportSubmission(row) {
    this._rep(); const id = this.reportSubs.length + 1; this.reportSubs.push({ ...row, id }); return id;
  }

  async setReportSubmissionOutcome(id, outcome) { this._rep(); const r = this.reportSubs.find((x) => x.id === id); if (r) r.outcome = outcome; }

  async listReportSubmissions(code, setId) {
    this._rep(); return this.reportSubs.filter((x) => x.code === code && x.set_id === setId).map((x) => ({ ...x }));
  }

  async updateReportSubmission(id, setId, side, result) { this._rep(); const r = this.reportSubs.find((x) => x.id === id); if (r) Object.assign(r, { set_id: setId, side, result }); }
  async deleteReportSet(code, setId) { this._rep(); this.reportSets = this.reportSets.filter((x) => !(x.code === code && x.set_id === setId)); }
  async getReportHealth(kind) { this._rep(); const r = this.reportHealth.find((x) => x.kind === kind); return r ? { ...r } : null; }
  async putReportHealth(row) { this._rep(); this.reportHealth = this.reportHealth.filter((x) => x.kind !== row.kind).concat([{ ...row }]); }
  async claimReportProbe(kind, nowMs, gapMs) {
    this._rep(); const r = this.reportHealth.find((x) => x.kind === kind);
    if (!r || !(r.probe_ms < nowMs - gapMs)) return false; r.probe_ms = nowMs; return true;
  }
  async getReportSnapshot(code) { this._rep(); const r = this.reportSnaps.find((x) => x.code === code); return r ? { ...r } : null; }
  async getReportSnapshotMeta(code) {
    this._rep(); const r = this.reportSnaps.find((x) => x.code === code);
    if (!r) return null;
    let d = {}; try { d = JSON.parse(r.data); } catch (_) { d = {}; }
    return { synced_ms: r.synced_ms, full: d.full === true, sets: d.sets ? Object.keys(d.sets).length : 0 };
  }
  async putReportSnapshot(code, data, syncedMs) {
    this._rep(); this.reportSnaps = this.reportSnaps.filter((x) => x.code !== code).concat([{ code, data, synced_ms: syncedMs, lock_ms: 0 }]);
  }
  async claimReportSnapshot(code, nowMs, holdMs) {
    this._rep(); let r = this.reportSnaps.find((x) => x.code === code);
    if (!r) { r = { code, data: '{}', synced_ms: 0, lock_ms: 0 }; this.reportSnaps.push(r); }
    if (!(r.lock_ms < nowMs - holdMs)) return false; r.lock_ms = nowMs; return true;
  }
  async releaseReportSnapshot(code) { this._rep(); for (const x of this.reportSnaps) if (x.code === code) x.lock_ms = 0; }
  async insertReportManual(row) { this._rep(); const id = this.reportManual.length + 1; this.reportManual.push({ ...row, id }); return id; }
  async getReportManual(code, id) { this._rep(); const r = this.reportManual.find((x) => x.code === code && x.id === id); return r ? { ...r } : null; }
  async listReportManual(code) { this._rep(); return this.reportManual.filter((x) => x.code === code).sort((a, b) => b.id - a.id).map((x) => ({ ...x })); }
  async updateReportManual(code, id, status, setId, nowMs) {
    this._rep(); for (const x of this.reportManual) if (x.code === code && x.id === id) Object.assign(x, { status, set_id: setId, updated_ms: nowMs });
  }
  async listReportManualForUser(userId, code) {
    this._rep(); return this.reportManual.filter((x) => x.code === code && x.status === 'open' && x.users.includes('|' + userId + '|')).sort((a, b) => b.id - a.id).map((x) => ({ ...x }));
  }

  async putReportPick(code, userId, setId, nowMs) {
    this._rep(); this.reportPicks = this.reportPicks.filter((x) => !(x.code === code && x.user_id === userId));
    if (setId) this.reportPicks.push({ code, user_id: userId, set_id: setId, ts_ms: nowMs });
  }
  async deleteReportPicksForSet(code, setId) { this._rep(); this.reportPicks = this.reportPicks.filter((x) => !(x.code === code && x.set_id === setId)); }
  async listReportPicks(code, sinceMs) { this._rep(); return this.reportPicks.filter((x) => x.code === code && x.ts_ms >= sinceMs).map(({ user_id, set_id, ts_ms }) => ({ user_id, set_id, ts_ms })); }

  async insertReportDq(row) { this._rep(); const id = this.reportDqs.length + 1; this.reportDqs.push({ ...row, id }); return id; }
  async listReportDqs(code) { this._rep(); return this.reportDqs.filter((x) => x.code === code).sort((a, b) => b.id - a.id).map((x) => ({ ...x })); }
  async updateReportDq(code, id, status, doneSets, note, nowMs) {
    this._rep(); for (const x of this.reportDqs) if (x.code === code && x.id === id) Object.assign(x, { status, done_sets: doneSets, note, updated_ms: nowMs });
  }
  async getReportNoshow(code, setId, userId) { this._rep(); const r = this.reportNoshows.find((x) => x.code === code && x.set_id === setId && x.user_id === userId); return r ? { ...r } : null; }
  async upsertReportNoshow(row, notifiedMs) {
    this._rep(); const r = this.reportNoshows.find((x) => x.code === row.code && x.set_id === row.set_id && x.user_id === row.user_id);
    if (!r) { this.reportNoshows.push({ ...row, count: 1, notified_ms: notifiedMs ?? 0, status: 'open', note: '' }); return; }
    if (r.status !== 'open') r.first_ms = row.last_ms;
    Object.assign(r, { info: row.info, users: row.users, last_ms: row.last_ms, count: r.count + 1, status: 'open', note: '' });
    if (notifiedMs !== null) r.notified_ms = notifiedMs;
  }
  async listReportNoshows(code, sinceMs) { this._rep(); return this.reportNoshows.filter((x) => x.code === code && x.last_ms >= sinceMs).sort((a, b) => b.last_ms - a.last_ms).map((x) => ({ ...x })); }
  async resolveReportNoshows(code, setId, note, userId) {
    this._rep(); for (const x of this.reportNoshows) if (x.code === code && x.set_id === setId && x.status === 'open' && (userId === null || x.user_id === userId)) Object.assign(x, { status: 'resolved', note });
  }

  async insertReportStart(code, setId, users, userId, nowMs, info = '{}') {
    this._rep(); if (this.reportStarts.some((x) => x.code === code && x.set_id === setId)) return false;
    this.reportStarts.push({ code, set_id: setId, users, user_id: userId, ts_ms: nowMs, sgg: 0, tried_ms: 0, note: '', info }); return true;
  }
  _start(x) { return { set_id: x.set_id, user_id: x.user_id, ts_ms: x.ts_ms, sgg: x.sgg, tried_ms: x.tried_ms, note: x.note, info: x.info }; }
  async getReportStart(code, setId) { this._rep(); const r = this.reportStarts.find((x) => x.code === code && x.set_id === setId); return r ? this._start(r) : null; }
  async listReportStarts(code, sinceMs) { this._rep(); return this.reportStarts.filter((x) => x.code === code && x.ts_ms >= sinceMs).map((x) => this._start(x)); }
  async setReportStartSync(code, setId, sgg, note, triedMs) { this._rep(); for (const x of this.reportStarts) if (x.code === code && x.set_id === setId) Object.assign(x, { sgg, note, tried_ms: triedMs }); }
  async moveReportStart(code, from, to) {
    this._rep(); if (this.reportStarts.some((x) => x.code === code && x.set_id === to)) return;
    for (const x of this.reportStarts) if (x.code === code && x.set_id === from) x.set_id = to;
  }
  async listReportStartsForUser(code, userId, sinceMs) {
    this._rep(); return this.reportStarts.filter((x) => x.code === code && x.users.includes('|' + userId + '|') && x.ts_ms >= sinceMs).map((x) => this._start(x));
  }
  async listReportNoshowsForUser(code, userId, sinceMs) {
    this._rep(); return this.reportNoshows.filter((x) => x.code === code && (x.users || '').includes('|' + userId + '|') && x.last_ms >= sinceMs).map((x) => ({ ...x }));
  }

  async reportSubmissionActivity(userId, sinceMs) {
    this._rep();
    const rows = this.reportSubs.filter((x) => x.user_id === userId && x.ts_ms >= sinceMs);
    return { count: rows.length, latestMs: rows.length ? Math.max(...rows.map((x) => x.ts_ms)) : null };
  }
}
