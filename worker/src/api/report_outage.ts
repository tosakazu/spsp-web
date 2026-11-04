/**
 * 試合結果の報告: start.gg (Challonge) に繋がらないとき (docs/self_report_design.md §11、2026-11-04)。
 *
 *   - 障害の判定 (Health): 接続できない・5xx・429・タイムアウトが続けて OUTAGE_FAILS 回で「障害中」。障害中は start.gg を呼ばず
 *     (1 回 10 秒待たないように)、PROBE_GAP_MS ごとに 1 つの要求だけが試す。1 回でも通れば戻す。
 *   - 報告は D1 に残し (状態 queued)、復旧したら取り込む (report.ts の flushQueued)。
 *   - ブラケットの写し (Snapshot): start.gg が読めるあいだに、受付ごとの試合・枠・出場者を少しずつ写す
 *     (updatedAfter で変わった試合 + 全体を 1 ページずつ回る)。障害中は選手の画面と運営の「次の試合を指定」の候補をここから出す。
 *   - 運営が指定した試合 (report_manual_sets): 勝者側 / 敗者側と 2 人。報告は set_id 'm<id>'。復旧後に同じ 2 人の start.gg の試合を探して移す。
 * ここは start.gg / D1 の読み書きの部品と、判定 (副作用なし) だけ。流れは report.ts。
 */
import type { FetchFn } from './oauth.ts';
import { startggGql } from './class_bracket.ts';
import type { ReportHealthRow, ReportManualRow, ReportSetRow, ReportSubmissionRow, Store } from '../store.ts';
import type { NSet, NSlot, Result, Side } from './report_logic.ts';
import { sameOutcome } from './report_logic.ts';
import type { Provider } from './report_startgg.ts';
import { LOWER_CLASS_NAME_PAT } from './report_startgg.ts';

// ── 障害の判定 ─────────────────────────────────────────────────────────

/** 続けてこれだけ失敗したら障害中 (1 回だけのタイムアウトでは画面に出さない) */
export const OUTAGE_FAILS = 2;
/** 障害中に試す間隔 */
export const PROBE_GAP_MS = 30 * 1000;
/** 繋がっているときに last_ok_ms を書き直す間隔 (D1 に毎回書かない) */
const OK_REFRESH_MS = 60 * 1000;

/** 相手に繋がらない失敗か (start.gg の符号: timeout / network / bad_json / http_5xx / http_429、oauth の network / startgg_down、
 *  start.gg の GraphQL が 200 で返す「unknown error」等)。set が無い・権限が無い等は違う */
export function isOutageNote(note: string): boolean {
  if (/(?:^|:)(?:timeout|network|bad_json|http_5\d\d|http_429|http_408|outage_skip|startgg_down)(?:$|:)/.test(note)) return true;
  return /(?:^|:)gql:.*(?:unknown error|timed? ?out|unavailable|internal server|too many requests)/i.test(note);
}

export interface OutageView { since_ms: number; last_ok_ms: number; note: string }

export class Health {
  row: ReportHealthRow;
  private claimed = false;
  private store: Store;
  constructor(store: Store, row: ReportHealthRow) { this.store = store; this.row = row; }
  static async load(store: Store, kind: string): Promise<Health> {
    const r = await store.getReportHealth(kind).catch(() => null);
    return new Health(store, r || { kind, down_since_ms: 0, last_fail_ms: 0, last_ok_ms: 0, fails: 0, probe_ms: 0, note: '' });
  }
  down(): boolean { return this.row.fails >= OUTAGE_FAILS; }
  view(): OutageView | null { return this.down() ? { since_ms: this.row.down_since_ms, last_ok_ms: this.row.last_ok_ms, note: this.row.note } : null; }
  /** 今 start.gg を呼んでよいか (障害中は PROBE_GAP_MS ごとに 1 つの要求だけ) */
  async allowed(now: number): Promise<boolean> {
    if (!this.down() || this.claimed) return true;
    if (now - this.row.last_fail_ms < PROBE_GAP_MS) return false;
    this.claimed = await this.store.claimReportProbe(this.row.kind, now, PROBE_GAP_MS).catch(() => false);
    return this.claimed;
  }
  async fail(note: string, now: number): Promise<void> {
    const r = this.row;
    r.fails += 1; r.last_fail_ms = now; r.probe_ms = now; if (!r.down_since_ms) r.down_since_ms = now;
    r.note = note.replace(/[^\x20-\x7e]/g, '').slice(0, 60);
    this.claimed = false;
    await this.store.putReportHealth(r).catch(() => undefined);
  }
  async ok(now: number): Promise<void> {
    const r = this.row;
    if (r.fails === 0 && now - r.last_ok_ms < OK_REFRESH_MS) return;
    r.fails = 0; r.down_since_ms = 0; r.last_ok_ms = now; r.note = '';
    await this.store.putReportHealth(r).catch(() => undefined);
  }
}

type Res = { ok: boolean; note?: string };
/** Provider の呼び出しを Health に通す (障害中は呼ばずに outage_skip で返す・結果を記録する) */
export function guardProvider(p: Provider, h: Health, now: number): Provider {
  async function wrap<T extends Res>(f: () => Promise<T>, skip: T): Promise<T> {
    if (!(await h.allowed(now))) return skip;
    const r = await f();
    if (r.ok) await h.ok(now);
    else if (isOutageNote(r.note || '')) await h.fail(r.note || '', now);
    return r;
  }
  const skip = { ok: false as const, note: 'outage_skip' };
  return {
    phases: () => wrap(() => p.phases(), skip),
    readSet: (id) => wrap(() => p.readSet(id), { ok: false as const, code: 'provider_error' as const, note: 'outage_skip' }),
    apply: (s, r, m) => wrap(() => p.apply(s, r, m), skip),
    reset: (s) => wrap(() => p.reset(s), skip),
    ...(p.dq ? { dq: (s: NSet, w: Side) => wrap(() => p.dq!(s, w), skip) } : {}),
    ...(p.start ? { start: (id: string) => wrap(() => p.start!(id), skip) } : {}),
    ...(p.setsOf ? { setsOf: (e: string) => wrap(() => p.setsOf!(e), { ok: false as const, note: 'outage_skip' }) } : {}),
    ...(p.findSet ? { findSet: (ids: [string, string], side: 'w' | 'l' | 'r' | 'g', exclude?: Set<string>, skip?: FoundSkip) => wrap(() => p.findSet!(ids, side, exclude, skip), { ok: false as const, note: 'outage_skip' }) } : {}),
  };
}

// ── 障害中の報告の判定 ─────────────────────────────────────────────────

/** 取り込み待ち (復旧後に start.gg へ) の行。note: outage = 選手の報告 / manual = 運営が指定した試合 / manual_wait = 復旧したが
 *  start.gg にまだその 2 人の試合が無い / outage_admin = 運営の直し / outage_reset = 運営の取り消し */
export function isQueuedRow(row: Pick<ReportSetRow, 'state' | 'note'>): boolean {
  return row.state === 'queued' || (row.state === 'conflict' && (row.note === 'outage' || row.note === 'manual' || row.note === 'manual_wait'));
}
export const isManualId = (id: string): boolean => /^m[1-9]\d{0,9}$/.test(id);

/**
 * start.gg に送れないときの行の状態。運営が確定した試合 (fixed)・止めた試合 (hold) は選手の報告では動かさない (記録だけ)。
 * 運営の直し・取り消しが待っていればそのまま。両者の報告が食い違えば conflict (取り込まず運営か両者の出し直しを待つ)。
 */
export function offlineDecision(prev: { state: string; note: string } | null, latest: [Result | null, Result | null], manual: boolean): { state: string; note: string } {
  if (prev && prev.state === 'fixed') return { state: 'fixed', note: prev.note };
  if (prev && prev.state === 'review' && prev.note === 'hold') return { state: 'review', note: 'hold' };
  if (prev && (prev.note === 'outage_admin' || prev.note === 'outage_reset')) return { state: 'queued', note: prev.note };
  const base = manual ? (prev && prev.note === 'manual_wait' ? 'manual_wait' : 'manual') : 'outage';
  const [a, b] = latest;
  if (a && b && !sameOutcome(a, b)) return { state: 'conflict', note: base };
  return { state: 'queued', note: base };
}

function parseRes(s: string): Result | null {
  if (!s) return null;
  try { return JSON.parse(s) as Result; } catch (_) { return null; }
}

/** SPSP で持っている (まだ start.gg に無い) 結果。運営の直しが待っていればそれ、無ければ両者の報告 (一致か片方だけ。食い違いは null) */
export function heldResult(row: ReportSetRow, subs: ReportSubmissionRow[]): Result | null {
  if (row.note === 'outage_reset') return null;
  if (row.note === 'outage_admin') {
    const a = subs.find((s) => s.id === row.floor_id && s.side < 0);
    return a ? parseRes(a.result) : null;
  }
  const latest: [Result | null, Result | null] = [null, null];
  for (const s of subs) if ((s.id || 0) > row.floor_id && (s.side === 0 || s.side === 1)) latest[s.side as Side] = parseRes(s.result);
  const [a, b] = latest;
  if (a && b) return sameOutcome(a, b) ? a : null;
  return a || b;
}

/** 側を入れ替えた結果 (運営が指定した試合の 2 人の並びが start.gg の試合と逆のとき) */
export function flipResult(r: Result): Result {
  return { w: (1 - r.w) as Side, g: r.g.map((x) => ({ w: (1 - x.w) as Side, c: [x.c[1], x.c[0]], s: x.s })) };
}

// ── ブラケットの写し ─────────────────────────────────────────────────

export interface SnapSlot { pt: string | null; pi: string | null; pp: number | null; e: string | null; sc: number | null }
export interface SnapSet { i: string; s: number; r: number | null; t: string; w: string | null; lp: number | null; g: string; st: number | null; z: number; sl: SnapSlot[] }
export interface Snapshot {
  v: 1;
  sets: Record<string, SnapSet>;
  ents: Record<string, { n: string; u: string[]; s: number | null }>;
  groups: Record<string, { d: string; p: string }>;
  phases: Record<string, { n: string; c: number | null }>;
  /** 変わった試合を読む基準 (start.gg の updatedAt、秒) */
  cur: number;
  /** 全体を回る次のページ・何周目か・1 周目が終わったか */
  rot: number; pass: number; full: boolean;
  /** updatedAfter が使える / 台 (station) が読める */
  inc: boolean; extra: boolean;
  /** 1 ページの件数 (start.gg に「複雑すぎる」と言われたら半分にする。速報 live_fetch.js の fetchAllNodes と同じ) */
  per?: number;
}
export const emptySnapshot = (): Snapshot => ({ v: 1, sets: {}, ents: {}, groups: {}, phases: {}, cur: 0, rot: 1, pass: 1, full: false, inc: true, extra: true });

export function parseSnapshot(s: string | null | undefined): Snapshot {
  if (!s) return emptySnapshot();
  try {
    const o = JSON.parse(s) as Snapshot;
    return o && o.v === 1 && o.sets ? { ...emptySnapshot(), ...o } : emptySnapshot();
  } catch (_) { return emptySnapshot(); }
}

const SNAP_PER_PAGE = 40;   // 1 試合あたり 20 弱 (枠・出場者・順位) → 1 回 800 くらい (start.gg の上限は 1000)
/** 1 回に読むページ (1 周目はまとめて、そのあとは変わった試合 + 1 ページ) */
const SNAP_FIRST_CALLS = 5;
/** 写す間隔 (1 周目のあいだは短く) */
export const SNAP_MIN_MS = 45 * 1000;
export const SNAP_FIRST_MIN_MS = 5 * 1000;
/** D1 の 1 行の上限 (2 MB) より手前 */
const SNAP_MAX_BYTES = 1_800_000;

const SNAP_QUERY = (extra: boolean, inc: boolean) => `query SpspReportSnap($id: ID!, $page: Int!, $perPage: Int!${inc ? ', $after: Timestamp' : ''}) { event(id: $id) {
  sets(page: $page, perPage: $perPage, sortType: ${inc ? 'RECENT' : 'STANDARD'}, filters: { hideEmpty: false${inc ? ', updatedAfter: $after' : ''} }) {
    pageInfo { totalPages }
    nodes { id state round fullRoundText winnerId lPlacement updatedAt ${extra ? 'station { number }' : ''}
      phaseGroup { id displayIdentifier phase { id name groupCount } }
      slots { prereqType prereqId prereqPlacement entrant { id name initialSeedNum participants { user { id } } } standing { stats { score { value } } } } } } } }`;

const idOf = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const numOf = (v: unknown): number | null => { const n = Number(v); return v !== null && v !== undefined && Number.isFinite(n) ? n : null; };

/** start.gg の試合 1 つを写しに入れる (ブラケット開始前の preview_ の試合は入れない)。updatedAt を返す */
export function absorbSet(snap: Snapshot, raw: unknown, pass: number): number {
  const s = raw as Record<string, unknown> | null;
  if (!s || !/^\d+$/.test(String(s.id))) return 0;
  const pg = s.phaseGroup as { id?: unknown; displayIdentifier?: unknown; phase?: { id?: unknown; name?: unknown; groupCount?: unknown } | null } | null;
  const gid = pg ? idOf(pg.id) : null;
  if (pg && gid) {
    const pid = pg.phase ? idOf(pg.phase.id) : null;
    snap.groups[gid] = { d: String(pg.displayIdentifier ?? ''), p: pid || '' };
    if (pid && pg.phase) snap.phases[pid] = { n: String(pg.phase.name ?? '').slice(0, 80), c: numOf(pg.phase.groupCount) };
  }
  const slots = (Array.isArray(s.slots) ? s.slots : []).slice(0, 2).map((x) => {
    const sl = (x || {}) as { prereqType?: unknown; prereqId?: unknown; prereqPlacement?: unknown; entrant?: Record<string, unknown> | null; standing?: { stats?: { score?: { value?: unknown } } } | null };
    const ent = sl.entrant;
    const eid = ent ? idOf(ent.id) : null;
    if (ent && eid) {
      const users = (Array.isArray(ent.participants) ? ent.participants : [])
        .map((p) => idOf(p && (p as { user?: { id?: unknown } | null }).user ? (p as { user: { id?: unknown } }).user.id : null)).filter((u): u is string => !!u);
      snap.ents[eid] = { n: String(ent.name ?? '').slice(0, 80), u: users, s: numOf(ent.initialSeedNum) };
    }
    const sc = sl.standing && sl.standing.stats && sl.standing.stats.score ? numOf(sl.standing.stats.score.value) : null;
    return { pt: typeof sl.prereqType === 'string' ? sl.prereqType : null, pi: idOf(sl.prereqId), pp: numOf(sl.prereqPlacement), e: eid, sc };
  });
  while (slots.length < 2) slots.push({ pt: null, pi: null, pp: null, e: null, sc: null });
  const st = s.station as { number?: unknown } | null | undefined;
  snap.sets[String(s.id)] = {
    i: String(s.id), s: Number(s.state) || 1, r: numOf(s.round), t: String(s.fullRoundText ?? '').slice(0, 60), w: idOf(s.winnerId), lp: numOf(s.lPlacement),
    g: gid || '', st: st ? numOf(st.number) : null, z: pass, sl: slots,
  };
  return numOf(s.updatedAt) || 0;
}

function isComplexity(json: { errors?: unknown[] }): boolean {
  return Array.isArray(json.errors) && json.errors.some((e) => /complex/i.test(String((e as { message?: unknown }).message || '')));
}
type PageResult = { ok: true; nodes: unknown[]; total: number } | { ok: false; note: string; gql: boolean };
async function snapPage(fetchFn: FetchFn, token: string, eventId: string, snap: Snapshot, page: number, after: number | null): Promise<PageResult> {
  const inc = after !== null;
  const vars: Record<string, unknown> = { id: eventId, page, perPage: snap.per || SNAP_PER_PAGE };
  if (inc) vars.after = after;
  let r = await startggGql(fetchFn, token, SNAP_QUERY(snap.extra, inc), vars);
  // 複雑すぎる: 件数を半分にして 1 ページ目から (ページの区切りが変わるので)
  if (r.ok && isComplexity(r.json) && (snap.per || SNAP_PER_PAGE) > 10) {
    snap.per = Math.max(10, Math.floor((snap.per || SNAP_PER_PAGE) / 2));
    if (!inc) snap.rot = 1;
    return { ok: false, note: 'gql:complexity', gql: false };
  }
  if (r.ok && Array.isArray(r.json.errors) && r.json.errors.length && snap.extra) {   // 台が読めない (権限) → 外して読み直す
    const r2 = await startggGql(fetchFn, token, SNAP_QUERY(false, inc), vars);
    if (r2.ok && !(Array.isArray(r2.json.errors) && r2.json.errors.length)) { snap.extra = false; r = r2; }
  }
  if (!r.ok) return { ok: false, note: r.note, gql: false };
  const ev = r.json.data ? r.json.data.event as { sets?: { nodes?: unknown; pageInfo?: { totalPages?: unknown } } | null } | null : null;
  if (!ev || !ev.sets || !Array.isArray(ev.sets.nodes)) {
    const e = Array.isArray(r.json.errors) && r.json.errors[0] as { message?: unknown } | undefined;
    return { ok: false, note: 'gql:' + (e && typeof e.message === 'string' ? e.message.replace(/[^\x20-\x7e]/g, '').slice(0, 60) : ''), gql: true };
  }
  return { ok: true, nodes: ev.sets.nodes, total: Number(ev.sets.pageInfo && ev.sets.pageInfo.totalPages) || 1 };
}

/**
 * 写しを進める。1 周目は SNAP_FIRST_CALLS ページずつ、そのあとは「前回から変わった試合」+ 全体を 1 ページ。
 * 全体を 1 周するたびに、その周で見なかった試合 (ブラケットを作り直して消えた等) を落とす。
 * 戻り値 = start.gg に繋がらなかったときの符号 (null = 進めた)
 */
export async function advanceSnapshot(fetchFn: FetchFn, token: string, eventId: string, snap: Snapshot, allowed: () => Promise<boolean>): Promise<string | null> {
  let calls = 0;
  const rotate = async (): Promise<string | null> => {
    if (!(await allowed())) return 'outage_skip';
    calls++;
    const r = await snapPage(fetchFn, token, eventId, snap, snap.rot, null);
    if (!r.ok) return r.note;
    let hw = 0;
    for (const n of r.nodes) hw = Math.max(hw, absorbSet(snap, n, snap.pass));
    if (!snap.full && hw) snap.cur = Math.max(snap.cur, hw);
    if (snap.rot >= r.total) {
      // 2 周続けて見なかった試合だけ落とす (周の途中で並びがずれて 1 回見落としても消さない)
      for (const [id, s] of Object.entries(snap.sets)) if (s.z < snap.pass - 1) delete snap.sets[id];
      snap.pass += 1; snap.rot = 1; snap.full = true;
    } else snap.rot += 1;
    return null;
  };
  if (!snap.full) {
    while (!snap.full && calls < SNAP_FIRST_CALLS) { const e = await rotate(); if (e) return e; }
    return null;
  }
  if (snap.inc) {
    for (let page = 1; page <= 3; page++) {
      if (!(await allowed())) return 'outage_skip';
      const r = await snapPage(fetchFn, token, eventId, snap, page, Math.max(0, snap.cur - 120));
      if (!r.ok) { if (r.gql) { snap.inc = false; break; } return r.note; }
      let hw = 0;
      for (const n of r.nodes) hw = Math.max(hw, absorbSet(snap, n, snap.pass));
      if (hw) snap.cur = Math.max(snap.cur, hw);
      if (page >= r.total) break;
    }
  }
  return rotate();
}

export function snapshotJson(snap: Snapshot): string | null {
  const s = JSON.stringify(snap);
  return s.length <= SNAP_MAX_BYTES ? s : null;
}

/** 写しの試合を start.gg の GraphQL の形に (選手の画面の fromStartgg にそのまま渡す) */
export function rawOfSnap(snap: Snapshot, s: SnapSet): Record<string, unknown> {
  const g = snap.groups[s.g];
  const ph = g ? snap.phases[g.p] : null;
  return {
    id: s.i, state: s.s, round: s.r, fullRoundText: s.t, identifier: '', totalGames: null, winnerId: s.w, lPlacement: s.lp,
    station: s.st ? { number: s.st } : null, stream: null,
    phaseGroup: g ? { id: s.g, displayIdentifier: g.d, phase: { id: g.p, name: ph ? ph.n : '', groupCount: ph ? ph.c : null } } : null,
    slots: s.sl.map((x) => {
      const e = x.e ? snap.ents[x.e] : null;
      return {
        prereqType: x.pt, prereqId: x.pi, prereqPlacement: x.pp,
        entrant: e ? { id: x.e, name: e.n, initialSeedNum: e.s, participants: e.u.map((u) => ({ user: { id: u }, player: { gamerTag: e.n } })) } : null,
        standing: x.sc !== null ? { stats: { score: { value: x.sc } } } : null,
      };
    }),
    games: [],
  };
}

/** 選手の画面 (障害中): 自分の試合と、試合待ちの相手の枠の前の試合 (3 段まで)。entrant = 写しの出場者に本人が居るか */
export function snapMine(snap: Snapshot, uid: string): { sets: Record<string, unknown>[]; pre: Record<string, Record<string, unknown>>; entrant: boolean | null } {
  const mine = new Set(Object.entries(snap.ents).filter(([, e]) => e.u.includes(uid)).map(([id]) => id));
  const sets = Object.values(snap.sets).filter((s) => s.sl.some((x) => x.e && mine.has(x.e)));
  const pre: Record<string, Record<string, unknown>> = {};
  const walk = (id: string | null, depth: number) => {
    if (!id || depth <= 0 || pre[id]) return;
    const s = snap.sets[id];
    if (!s) return;
    pre[id] = rawOfSnap(snap, s);
    for (const x of s.sl) if (!x.e && x.pt === 'set') walk(x.pi, depth - 1);
  };
  for (const s of sets) if (s.s !== 3) for (const x of s.sl) if (!x.e && x.pt === 'set') walk(x.pi, 3);
  // 新しいラウンドが先 (start.gg の RECENT に近い順)
  sets.sort((a, b) => Math.abs(b.r || 0) - Math.abs(a.r || 0));
  return { sets: sets.map((s) => rawOfSnap(snap, s)), pre, entrant: Object.keys(snap.sets).length ? mine.size > 0 : null };
}

function slotOfEnt(snap: Snapshot, eid: string | null): NSlot | null {
  if (!eid) return null;
  const e = snap.ents[eid];
  return e ? { id: eid, name: e.n, users: e.u.slice(), seed: e.s } : { id: eid, name: '', users: [], seed: null };
}

/** 写しの試合を判定用の形に (障害中に報告を確かめる)。次の試合に結果があるかも写しから */
export function snapNSet(snap: Snapshot, setId: string, eventName = ''): NSet | null {
  const s = snap.sets[setId];
  if (!s) return null;
  const slots: [NSlot | null, NSlot | null] = [slotOfEnt(snap, s.sl[0] ? s.sl[0].e : null), slotOfEnt(snap, s.sl[1] ? s.sl[1].e : null)];
  const complete = s.s === 3;
  const w = complete && s.w ? (slots[0] && slots[0].id === s.w ? 0 : slots[1] && slots[1].id === s.w ? 1 : null) : null;
  const g = snap.groups[s.g];
  const phaseName = g && snap.phases[g.p] ? snap.phases[g.p].n : '';
  const downstreamDone = Object.values(snap.sets).some((x) => x.s === 3 && x.sl.some((y) => y.pt === 'set' && y.pi === setId));
  return {
    id: setId, complete, slots, remote: w === null ? null : { w, g: [] }, totalGames: null, downstreamDone, lPlacement: s.lp,
    isClass: LOWER_CLASS_NAME_PAT.test(phaseName) || LOWER_CLASS_NAME_PAT.test(eventName), round: s.r, phaseKey: g ? g.p : undefined,
  };
}

// ── 運営が指定した試合 ─────────────────────────────────────────────────

export function manualSlots(m: Pick<ReportManualRow, 'slots'>): [NSlot | null, NSlot | null] {
  let v: unknown = [];
  try { v = JSON.parse(m.slots); } catch (_) { v = []; }
  const a = Array.isArray(v) ? v : [];
  const one = (x: unknown): NSlot | null => {
    const o = x as { id?: unknown; name?: unknown; users?: unknown; seed?: unknown } | null;
    if (!o || o.id === undefined || o.id === null) return null;
    return { id: String(o.id), name: String(o.name || ''), users: Array.isArray(o.users) ? o.users.map(String) : [], seed: numOf(o.seed) };
  };
  return [one(a[0]), one(a[1])];
}

/** 指定した試合を判定用の形に (まだ start.gg の試合ではない: 結果なし・次の試合なし。ラウンドは勝者側 1 / 敗者側 -1 の扱い) */
export function manualNSet(m: ReportManualRow, snap: Snapshot | null, eventName = ''): NSet {
  const g = snap ? snap.groups[m.group_id] : null;
  const phaseName = g && snap && snap.phases[g.p] ? snap.phases[g.p].n : '';
  return {
    id: 'm' + m.id, complete: false, slots: manualSlots(m), remote: null, totalGames: null, downstreamDone: false, lPlacement: null,
    isClass: LOWER_CLASS_NAME_PAT.test(phaseName) || LOWER_CLASS_NAME_PAT.test(eventName), round: null, phaseKey: g ? g.p : undefined,
  };
}

export function groupName(snap: Snapshot | null, gid: string): string {
  const g = snap ? snap.groups[gid] : null;
  if (!g || !snap) return '';
  const ph = snap.phases[g.p];
  return [ph ? ph.n : '', ph && ph.c === 1 ? '' : g.d].filter(Boolean).join(' ');
}

export function manualView(m: ReportManualRow, snap: Snapshot | null) {
  // side: w = 勝者側 / l = 敗者側 / g = グランドファイナル / r = 総当たり
  return { set_id: 'm' + m.id, id: m.id, side: m.side, group: m.group_id, group_name: groupName(snap, m.group_id), phase: snap && snap.groups[m.group_id] ? snap.groups[m.group_id].p : null,
    station: m.station || null, slots: manualSlots(m), status: m.status, real_set_id: m.set_id || null, created_ms: m.created_ms, updated_ms: m.updated_ms };
}

/** SPSP で持っている結果 1 つ (候補の「負けた」に数える) */
export interface Held { group: string; side: 'w' | 'l' | null; loser: string; winner?: string }

export interface CandEntrant { id: string; name: string; uid: string | null; seed: number | null;
  /** start.gg で勝者側 / 敗者側の試合に負けた */ wl: boolean; ll: boolean;
  /** SPSP に未反映の結果で勝者側 / 敗者側に負けた */ hw: boolean; hl: boolean;
  /** start.gg で試合中 (state 2) / 運営が指定した試合 (結果なし) に入っている */ playing: boolean; manual: boolean }
/** rr = 総当たりのブロック (前の試合から入る枠が 1 つも無い)。総当たりは勝者側 / 敗者側ではなく、まだ当たっていない 2 人を選ぶ */
export interface CandGroup { id: string; name: string; phase: string; open: number; rr: boolean; entrants: CandEntrant[];
  /** 結果の無い試合 / 結果の入った試合がある 2 人 ("e1|e2"、小さい順)。総当たりで同じ組を指定しないように */
  open_pairs?: string[]; done_pairs?: string[] }

/**
 * 「次の試合を指定」の候補。ブロックごとの出場者と、負けの数え (start.gg の結果 + SPSP に未反映の結果)。
 * 画面は 勝者側 = 負けていない人 / 敗者側 = 敗者側で負けていない人 (勝者側の負けが start.gg に未反映でも敗者側をすることがあるので、
 * 負けていない人も出す。未反映でも敗者側で負けた人は出さない) に絞る。
 */
export function bracketCandidates(snap: Snapshot, held: Held[], manualBusy: Set<string>): CandGroup[] {
  const groups = new Map<string, CandGroup>();
  const flags = new Map<string, CandEntrant>();
  const ent = (gid: string, eid: string): CandEntrant | null => {
    const g = groups.get(gid);
    if (!g) return null;
    const k = gid + '|' + eid;
    let f = flags.get(k);
    if (!f) {
      const e = snap.ents[eid];
      f = { id: eid, name: e ? e.n : '', uid: e && e.u[0] ? e.u[0] : null, seed: e ? e.s : null, wl: false, ll: false, hw: false, hl: false, playing: false, manual: manualBusy.has(eid) };
      flags.set(k, f); g.entrants.push(f);
    }
    return f;
  };
  for (const [gid] of Object.entries(snap.groups)) {
    const p = snap.groups[gid].p;
    groups.set(gid, { id: gid, name: groupName(snap, gid), phase: p, open: 0, rr: true, entrants: [], open_pairs: [], done_pairs: [] });
  }
  for (const s of Object.values(snap.sets)) {
    const g = groups.get(s.g);
    if (!g) continue;
    if (s.sl.some((x) => x.pt === 'set')) g.rr = false;
    if (s.s !== 3 && s.sl[0] && s.sl[0].e && s.sl[1] && s.sl[1].e) { g.open++; g.open_pairs!.push([s.sl[0].e, s.sl[1].e].sort().join('|')); }
    if (s.s === 3 && s.sl[0] && s.sl[0].e && s.sl[1] && s.sl[1].e) g.done_pairs!.push([s.sl[0].e, s.sl[1].e].sort().join('|'));
    for (const x of s.sl) {
      if (!x.e) continue;
      const f = ent(s.g, x.e);
      if (!f) continue;
      if (s.s === 2) f.playing = true;
      if (s.s === 3 && s.w && s.w !== x.e && s.r !== null) { if (s.r > 0) f.wl = true; else if (s.r < 0) f.ll = true; }
    }
  }
  for (const h of held) {
    const g = groups.get(h.group);
    if (g && h.winner) g.done_pairs!.push([h.winner, h.loser].sort().join('|'));
    const f = flags.get(h.group + '|' + h.loser);
    if (!f) continue;
    if (h.side === 'w') f.hw = true; else if (h.side === 'l') f.hl = true;
  }
  const out = Array.from(groups.values()).filter((g) => g.entrants.length);
  for (const g of out) g.entrants.sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9) || a.name.localeCompare(b.name));
  return out.sort((a, b) => (b.open > 0 ? 1 : 0) - (a.open > 0 ? 1 : 0) || a.name.localeCompare(b.name, 'ja', { numeric: true }));
}

/** 候補として出すか (画面と同じきまり。テスト用) */
export function candidateFor(e: CandEntrant, side: 'w' | 'l' | 'r' | 'g'): boolean {
  if (e.manual) return false;
  if (side === 'r') return true;   // 総当たり: 負けても残る
  // グランドファイナル (start.gg では勝者側のラウンド): 敗者側から上がった人は勝者側で 1 回負けているので、敗者側と同じきまり
  if (side === 'g') return !(e.ll || e.hl);
  if (side === 'w') return !(e.wl || e.ll || e.hw || e.hl);
  return !(e.ll || e.hl);
}

// ── start.gg で同じ 2 人の試合を探す ──────────────────────────────────

const FIND_QUERY = `query SpspReportFind($eventId: ID!, $entrantIds: [ID], $page: Int!) {
  event(id: $eventId) { sets(perPage: 60, page: $page, filters: { entrantIds: $entrantIds, hideEmpty: true }) {
    pageInfo { totalPages }
    nodes { id state round slots { entrant { id } } }
  } }
}`;

/**
 * 運営が指定した 2 人の、まだ結果の無い start.gg の試合。勝者側 / 敗者側が合うものを先に。
 * 結果が入った試合は選ばない (以前に同じ 2 人が当たった試合を取り違えないように)。flip = 枠の並びが指定と逆
 */
/** skip = 選ばない試合 (先に出した DQ が当てはまる試合など、report.ts) */
export type FoundSkip = (s: { id: string; round: number | null; entrants: string[] }) => boolean;
export function pickFound(nodes: unknown[], ids: [string, string], side: 'w' | 'l' | 'r' | 'g', exclude: Set<string> = new Set(), skip?: FoundSkip): { id: string; flip: boolean } | null {
  const cands: { id: string; flip: boolean; ok: boolean }[] = [];
  for (const n of nodes) {
    const x = n as { id?: unknown; state?: unknown; round?: unknown; slots?: { entrant?: { id?: unknown } | null }[] } | null;
    if (!x || !/^\d+$/.test(String(x.id)) || Number(x.state) === 3 || !Array.isArray(x.slots) || exclude.has(String(x.id))) continue;
    const e = x.slots.map((s) => (s && s.entrant ? idOf(s.entrant.id) : null));
    if (e.length < 2 || !e[0] || !e[1]) continue;
    const same = e[0] === ids[0] && e[1] === ids[1];
    const rev = e[0] === ids[1] && e[1] === ids[0];
    if (!same && !rev) continue;
    const r = Number(x.round);
    if (skip && skip({ id: String(x.id), round: Number.isFinite(r) ? r : null, entrants: [e[0], e[1]] })) continue;
    cands.push({ id: String(x.id), flip: rev, ok: side === 'r' || !Number.isFinite(r) || x.round === null || (side === 'w' || side === 'g' ? r > 0 : r < 0) });
  }
  // 側 (勝者側 / 敗者側) が合うものだけ (合わない試合は後の再戦などの別の試合)。ラウンドが分からない試合は合うことにする
  const best = cands.find((c) => c.ok);
  return best ? { id: best.id, flip: best.flip } : null;
}

export async function findStartggSet(fetchFn: FetchFn, token: string, eventId: string, ids: [string, string], side: 'w' | 'l' | 'r' | 'g', exclude?: Set<string>, skip?: FoundSkip):
  Promise<{ ok: true; found: { id: string; flip: boolean } | null } | { ok: false; note: string }> {
  const nodes: unknown[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await startggGql(fetchFn, token, FIND_QUERY, { eventId, entrantIds: ids, page });
    if (!r.ok) return { ok: false, note: 'find:' + r.note };
    const ev = r.json.data ? r.json.data.event as { sets?: { nodes?: unknown; pageInfo?: { totalPages?: unknown } } } | null : null;
    if (!ev || !ev.sets) return { ok: false, note: 'find:gql' };
    if (Array.isArray(ev.sets.nodes)) nodes.push(...ev.sets.nodes);
    const total = Number(ev.sets.pageInfo && ev.sets.pageInfo.totalPages);
    if (!Number.isFinite(total) || page >= total) break;
  }
  return { ok: true, found: pickFound(nodes, ids, side, exclude, skip) };
}
