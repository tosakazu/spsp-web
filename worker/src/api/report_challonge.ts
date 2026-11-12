/**
 * 試合結果の報告 (report.ts) の Challonge 側 (下位クラス作成で作ったトーナメント)。運営の Challonge トークンで読み書きする。
 *   読む:   GET /tournaments/{id}/participants.json・matches.json (100 件ずつ、取得側 smash_database と同じ)
 *   報告:   PUT /tournaments/{id}/matches/{mid}.json  { data: { type: 'Match', attributes: { match: [{participant_id, score_set, advancing}], tie } } }
 *   取り消し: PUT /tournaments/{id}/matches/{mid}/change_state.json  { data: { type: 'MatchState', attributes: { state: 'reopen' } } }
 * 選手は participant の misc (startgg:<ユーザー ID>[:nocount]、class_bracket.ts) で見分ける。
 * Challonge にはキャラ・ステージの欄が無いので、勝敗とスコアだけを送る (キャラは D1 の記録にだけ残る)。
 * v2.1 の試合の項目名 (player1_id / relationships・prereq) は両方の形を読む (実物での確認は docs §8 の確認事項)。
 */
import type { FetchFn } from './oauth.ts';
import { challongeApi } from './challonge.ts';
import type { NSet, NSlot, Result, Side } from './report_logic.ts';
import { score } from './report_logic.ts';
import type { Provider, ProviderResult } from './report_startgg.ts';
import type { Store } from '../store.ts';
import {
  REPORT_CH_BASE_MS, REPORT_CH_DIRTY_MS, REPORT_CH_DONE_STOP_MS, REPORT_CH_STALE_STOP_MS, REPORT_CH_EXT_MS, REPORT_CH_EXT_WINDOW_MS, REPORT_CH_FAIL_MS, REPORT_CH_FORCE_MIN_MS,
  REPORT_CH_FRESH_MS, REPORT_CH_IDLE_AFTER_MS, REPORT_CH_IDLE_MS, REPORT_CH_LIMIT_MS, REPORT_CH_PRESTART_MS,
} from '../config.ts';

export interface CParticipant { id: string; name: string; uid: string | null; seed: number | null }
export interface CMatch {
  id: string; state: string; round: number | null; identifier: string;
  p: [string | null, string | null];
  prereq: [string | null, string | null];
  prereqLoser: [boolean, boolean];
  winner: string | null;
  points: Record<string, number>;
  completedAt: string;
  /** 始まった (underway_at がある) */
  underway?: boolean;
}
export interface CData { participants: Map<string, CParticipant>; matches: CMatch[] }

const MISC_RE = /^startgg:([1-9]\d{0,11})(:nocount)?$/;
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

export function parseParticipant(p: unknown): CParticipant | null {
  const x = p as { id?: unknown; attributes?: Record<string, unknown> } | null;
  if (!x || x.id === undefined) return null;
  const a = x.attributes || {};
  const m = typeof a.misc === 'string' ? MISC_RE.exec(a.misc) : null;
  const seed = Number(a.seed);
  return { id: String(x.id), name: typeof a.name === 'string' ? a.name : '', uid: m ? m[1] : null, seed: Number.isFinite(seed) && seed > 0 ? seed : null };
}

export function parseMatch(m: unknown): CMatch | null {
  const x = m as { id?: unknown; attributes?: Record<string, unknown>; relationships?: Record<string, { data?: { id?: unknown } | null }> } | null;
  if (!x || x.id === undefined) return null;
  const a = x.attributes || {};
  const rel = x.relationships || {};
  const pid = (k: 'player1' | 'player2'): string | null => str(a[k + '_id']) || str(rel[k] && rel[k].data ? rel[k].data!.id : null);
  const points: Record<string, number> = {};
  const pbp = Array.isArray(a.points_by_participant) ? a.points_by_participant : [];
  for (const e of pbp) {
    const o = e as { participant_id?: unknown; scores?: unknown };
    if (o && o.participant_id !== undefined) points[String(o.participant_id)] = Array.isArray(o.scores) ? o.scores.reduce((s: number, v) => s + (Number(v) || 0), 0) : 0;
  }
  let p: [string | null, string | null] = [pid('player1'), pid('player2')];
  if (!p[0] && !p[1] && pbp.length === 2) p = [Object.keys(points)[0] || null, Object.keys(points)[1] || null];
  const ts = (a.timestamps && typeof a.timestamps === 'object' ? a.timestamps : a) as Record<string, unknown>;
  const round = Number(a.round);
  return {
    id: String(x.id), state: String(a.state || ''), round: Number.isFinite(round) ? round : null, identifier: String(a.identifier || ''),
    p, prereq: [str(a.player1_prereq_match_id), str(a.player2_prereq_match_id)],
    prereqLoser: [a.player1_is_prereq_match_loser === true, a.player2_is_prereq_match_loser === true],
    winner: str(a.winner_id), points, completedAt: typeof ts.completed_at === 'string' ? ts.completed_at : '',
    underway: !!(ts.underway_at || a.underway_at),
  };
}

/** 次の試合 (この試合を前提にする試合) に結果が入っているか。前提の項目が無い形なら、両者の後の試合で見る (分からなければ true) */
export function cDownstreamDone(d: CData, m: CMatch): boolean {
  const hasPrereq = d.matches.some((x) => x.prereq[0] || x.prereq[1]);
  // 次の試合が始まった (underway) か結果が入った
  if (hasPrereq) return d.matches.some((x) => x.id !== m.id && (x.state === 'complete' || !!x.underway) && (x.prereq[0] === m.id || x.prereq[1] === m.id));
  const mine = new Set([m.p[0], m.p[1]].filter(Boolean));
  return d.matches.some((x) => x.id !== m.id && x.state === 'complete' && (mine.has(x.p[0]) || mine.has(x.p[1]))
    && (!x.completedAt || !m.completedAt || x.completedAt > m.completedAt));
}

/** ダブルイリミの敗者側で、決勝 (敗者側の最後の回戦) から j 回戦前の負けの順位: 3, 4, 5, 7, 9, 13, 17, 25, … */
export function losersPlace(j: number): number {
  const h = Math.floor(j / 2);
  return j % 2 === 0 ? 2 ** (h + 1) + 1 : 2 ** (h + 1) + 2 ** h + 1;
}

/**
 * この試合の負けた人の順位 (start.gg の lPlacement と同じ意味)。選手の報告の「トップ N から運営が入力」の判定に使う。
 * Challonge の round は 勝者側 1, 2, …・敗者側 -1, -2, …・3 位決定戦 0。
 *   シングル: 勝者側 r 回戦の負け = 2^(R-r)+1 (R = 最後の回戦)。3 位決定戦の負け = 4
 *   ダブル:   敗者側 -k 回戦の負け = losersPlace(L-k) (L = 敗者側の最後の回戦)。
 *             勝者側 r 回戦の負けは敗者側に落ちる (1 回戦 → -1、r 回戦 → -2(r-1)) ので、落ちた先で負けたときの順位 (この試合で決まる一番下)。
 *             勝者側の最後の回戦 (= ceil(log2 人数)) より後はグランドファイナル = 2
 * 回戦が分からなければ null (判定しない)。
 */
export function cLPlacement(d: CData, m: CMatch, double: boolean): number | null {
  const r = m.round;
  if (r === null) return null;
  const rounds = d.matches.map((x) => x.round || 0);
  if (!double) {
    if (r === 0) return 4;
    const R = Math.max(0, ...rounds);
    return r > 0 && R >= r ? 2 ** (R - r) + 1 : null;
  }
  const L = Math.max(0, ...rounds.map((x) => -x));
  if (r < 0) return L >= -r ? losersPlace(L + r) : null;
  const rw = Math.max(1, Math.ceil(Math.log2(Math.max(2, d.participants.size))));
  if (r > rw) return 2;
  if (!L) return null;
  return losersPlace(Math.max(0, L - (r === 1 ? 1 : 2 * (r - 1))));
}

/**
 * ラウンドの名前 (start.gg の fullRoundText に合わせる)。Challonge には名前が無いので構造から付ける。最後のほう以外は null (画面で「勝者側 n 回戦」)。
 *   シングル: 最後 = Final、その前 = Semi-Final、Quarter-Final
 *   ダブル:   勝者側の最後 (= ceil(log2 人数)) = Winners Final…、それより後 = Grand Final (2 つ目は Reset)・敗者側の最後 = Losers Final…
 */
export function cRoundLabel(d: CData, n: number, double: boolean): string | null {
  const rounds = d.matches.map((x) => x.round || 0);
  const names = ['Final', 'Semi-Final', 'Quarter-Final'];
  if (!double) {
    const R = Math.max(0, ...rounds);
    return n > 0 && R - n < 3 ? names[R - n] : null;
  }
  if (n < 0) {
    const L = Math.max(0, ...rounds.map((x) => -x));
    return L + n < 3 && L + n >= 0 ? 'Losers ' + names[L + n] : null;
  }
  const rw = Math.max(1, Math.ceil(Math.log2(Math.max(2, d.participants.size))));
  if (n > rw) return n === rw + 1 ? 'Grand Final' : 'Grand Final Reset';
  return rw - n < 3 ? 'Winners ' + names[rw - n] : null;
}

export function cSetOf(d: CData, m: CMatch, double = false): NSet {
  const slot = (id: string | null): NSlot | null => {
    if (!id) return null;
    const p = d.participants.get(id);
    return { id, name: p ? p.name : '', users: p && p.uid ? [p.uid] : [], seed: p ? p.seed : null };
  };
  const slots: [NSlot | null, NSlot | null] = [slot(m.p[0]), slot(m.p[1])];
  const complete = m.state === 'complete';
  let remote: Result | null = null;
  if (complete && m.winner) {
    const w: Side | null = m.winner === m.p[0] ? 0 : m.winner === m.p[1] ? 1 : null;
    if (w !== null) {
      const a = m.p[0] ? m.points[m.p[0]] : undefined; const b = m.p[1] ? m.points[m.p[1]] : undefined;
      const g: Result['g'] = [];
      if (Number.isInteger(a) && Number.isInteger(b) && (a as number) >= 0 && (b as number) >= 0 && (a as number) + (b as number) <= 9) {
        for (let i = 0; i < (a as number); i++) g.push({ w: 0, c: [null, null], s: null });
        for (let i = 0; i < (b as number); i++) g.push({ w: 1, c: [null, null], s: null });
      }
      remote = { w, g };
    }
  }
  return { id: m.id, complete, slots, remote, totalGames: null, downstreamDone: complete && cDownstreamDone(d, m), lPlacement: cLPlacement(d, m, double), isClass: true,
    round: m.round, phaseKey: 'c' };
}

async function getAll(fetchFn: FetchFn, token: string, path: string): Promise<{ ok: true; items: unknown[] } | { ok: false; note: string }> {
  const out: unknown[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await challongeApi(fetchFn, token, path + '?page=' + page + '&per_page=100', null, 'GET');
    if (!r.ok) return { ok: false, note: r.note };
    const data = Array.isArray(r.json.data) ? r.json.data : [];
    out.push(...data);
    if (data.length < 100) break;
  }
  return { ok: true, items: out };
}

// ── 写し (D1 の report_snapshots) ────────────────────────────────────────
// Challonge の API は使える回数が少ない (SPSP のアプリ全体で月あたりの上限。2026-11-10 に 429 が返るようになった)。
// 以前は画面が読みに来るたび (15 秒ごと・Cloudflare の拠点ごと) に参加者と試合を読み、報告のたびにもう一度読んでいた。
// 今は参加者・試合を D1 に 1 つ持ち、全員がそれを見る。Challonge を読むのは次のときだけ (mirrorDue):
//   - まだ写しが無い (参加者 1 回 + 試合 1 回)
//   - トーナメントが始まる前 (試合が 0 件): 試合だけを REPORT_CH_PRESTART_MS ごと。始まったら参加者をもう一度だけ読む
//   - SPSP が結果を送った・取り消した後 (dirty): 次の試合の 2 人が決まるので試合だけを 1 回 (前に読んでから REPORT_CH_DIRTY_MS 以上あけて。
//     続けて何件か送られても 1 回で済む)。送った試合そのものは、読み直す前に写しを書き換える
//   - 運営が Challonge の画面で直接直したのに気づくため: REPORT_CH_BASE_MS ごと (気づいた後しばらくは REPORT_CH_EXT_MS ごと、
//     1 時間動きが無ければ REPORT_CH_IDLE_MS ごと、全試合が終わって 2 時間動きが無ければ読まない)
//   - 運営が「Challonge から読み直す」を押した (report_refresh、REPORT_CH_FORCE_MIN_MS に 1 回まで)
// 参加者は始まった後は読まない (写しに無い参加者が試合に出てきたときだけ読む)。読めなかったら前の写しのまま返し、しばらく読みに行かない
// (429 は REPORT_CH_LIMIT_MS)。誰も画面を開いていなければ何も読まない。

interface Packed { id: string; attributes: Record<string, unknown> }
/** 写し。p・m は parseParticipant / parseMatch が読める形 (使う項目だけ)。時刻は ms、0 = まだ */
export interface Mirror {
  v: 1;
  p: Packed[]; m: Packed[];
  p_ms: number;      // 参加者を読んだ
  m_ms: number;      // 試合を読んだ
  w_ms: number;      // SPSP が最後に Challonge に書いた
  chg_ms: number;    // 最後に変わった (SPSP が書いた・読んだら違っていた)
  ext_ms: number;    // SPSP 以外の変更 (運営が Challonge で直接直した) に気づいた
  dirty: boolean;    // SPSP が書いたので、次の試合を読み直す
  fail_ms: number; fail_note: string;   // 最後に読めなかった時刻と理由 ('' = 読めている)
}
export interface ChCtx { store: Store; fetchFn: FetchFn; token: string; tid: string; code: string; now: number }

const packP = (x: CParticipant): Packed => ({ id: x.id, attributes: { name: x.name, misc: x.uid ? 'startgg:' + x.uid : '', seed: x.seed } });
const packM = (x: CMatch): Packed => ({ id: x.id, attributes: {
  state: x.state, round: x.round, identifier: x.identifier, player1_id: x.p[0], player2_id: x.p[1],
  player1_prereq_match_id: x.prereq[0], player2_prereq_match_id: x.prereq[1],
  player1_is_prereq_match_loser: x.prereqLoser[0], player2_is_prereq_match_loser: x.prereqLoser[1], winner_id: x.winner,
  points_by_participant: Object.entries(x.points).map(([k, v]) => ({ participant_id: k, scores: [v] })), completed_at: x.completedAt,
  underway_at: x.underway ? '1' : null,
} });

export function parseMirror(s: string): Mirror | null {
  let j: Partial<Mirror> | null = null;
  try { j = JSON.parse(s) as Partial<Mirror>; } catch (_) { j = null; }
  if (!j || j.v !== 1 || !Array.isArray(j.p) || !Array.isArray(j.m)) return null;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return { v: 1, p: j.p, m: j.m, p_ms: n(j.p_ms), m_ms: n(j.m_ms), w_ms: n(j.w_ms), chg_ms: n(j.chg_ms), ext_ms: n(j.ext_ms), dirty: j.dirty === true,
    fail_ms: n(j.fail_ms), fail_note: typeof j.fail_note === 'string' ? j.fail_note : '' };
}

export function mirrorData(mi: Mirror): CData {
  const participants = new Map<string, CParticipant>();
  for (const x of mi.p) { const q = parseParticipant(x); if (q) participants.set(q.id, q); }
  return { participants, matches: mi.m.map(parseMatch).filter((x): x is CMatch => !!x) };
}

/** 見比べ用 (試合の状態・2 人・勝者・スコア。時刻は入れない) */
const sig = (m: Packed[]): string => JSON.stringify(m.map((x) => [x.id, x.attributes.state, x.attributes.player1_id, x.attributes.player2_id, x.attributes.winner_id,
  x.attributes.points_by_participant, x.attributes.underway_at]).sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)));

/**
 * 今 Challonge を読むか。'all' = 参加者と試合、'matches' = 試合だけ、null = 読まない (写しのまま)。
 * mode: 'force' = 運営が読み直しを押した / 'fresh' = 報告された試合が写しに無い・相手が空き (写しが古いかもしれない)
 */
export function mirrorDue(mi: Mirror | null, now: number, mode?: 'force' | 'fresh'): 'all' | 'matches' | null {
  if (!mi) return 'all';
  const age = now - mi.m_ms;
  if (mode === 'force') return !mi.m_ms || age >= REPORT_CH_FORCE_MIN_MS ? 'all' : null;
  if (mi.fail_ms && now - mi.fail_ms < (/http_429/.test(mi.fail_note) ? REPORT_CH_LIMIT_MS : REPORT_CH_FAIL_MS)) return null;
  if (!mi.m_ms) return 'all';
  if (!mi.m.length) return age >= REPORT_CH_PRESTART_MS ? 'matches' : null;   // まだ始まっていない
  if (mi.dirty) return age >= REPORT_CH_DIRTY_MS ? 'matches' : null;
  if (mode === 'fresh') return age >= REPORT_CH_FRESH_MS ? 'matches' : null;
  const done = mi.m.every((x) => x.attributes.state === 'complete');
  const idle = now - mi.chg_ms;
  if (done && idle >= REPORT_CH_DONE_STOP_MS) return null;
  if (idle >= REPORT_CH_STALE_STOP_MS) return null;   // 終わらせていないトナメをいつまでも読みに行かない
  if (mi.ext_ms && now - mi.ext_ms < REPORT_CH_EXT_WINDOW_MS) return age >= REPORT_CH_EXT_MS ? 'matches' : null;
  if (done || idle >= REPORT_CH_IDLE_AFTER_MS) return age >= REPORT_CH_IDLE_MS ? 'matches' : null;
  return age >= REPORT_CH_BASE_MS ? 'matches' : null;
}

interface Loaded { mi: Mirror | null; synced: number }
async function loadMirror(store: Store, code: string): Promise<Loaded> {
  const r = await store.getReportSnapshot(code).catch(() => null);
  return { mi: r ? parseMirror(r.data) : null, synced: r ? Number(r.synced_ms) || 0 : 0 };
}
/** 写しを書く (読んだ後にほかの要求が書いていたら書かずに null)。書けたら新しい synced_ms */
async function saveMirror(store: Store, code: string, mi: Mirror, prev: number, now: number): Promise<number | null> {
  const s = Math.max(now, prev + 1);
  return (await store.casReportSnapshot(code, JSON.stringify(mi), s, prev).catch(() => false)) ? s : null;
}
/** 写しの一部を書き換える (SPSP が Challonge に書いた後)。写しが無ければ何もしない */
async function changeMirror(store: Store, code: string, now: number, f: (mi: Mirror) => void): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const cur = await loadMirror(store, code);
    if (!cur.mi) return;
    f(cur.mi);
    if ((await saveMirror(store, code, cur.mi, cur.synced, now)) !== null) return;
  }
}

const EMPTY = (): Mirror => ({ v: 1, p: [], m: [], p_ms: 0, m_ms: 0, w_ms: 0, chg_ms: 0, ext_ms: 0, dirty: false, fail_ms: 0, fail_note: '' });
const CLAIM_MS = 25 * 1000;

/** Challonge を読んで写しを書き直す。読む役は 1 つの要求だけ (ほかは今の写しのまま) */
async function refreshMirror(ctx: ChCtx, cur: Loaded, what: 'all' | 'matches'): Promise<Loaded> {
  const { store, code, now } = ctx;
  if (!(await store.claimReportSnapshot(code, now, CLAIM_MS).catch(() => false))) return cur;
  let saved = false;
  try {
    const again = await loadMirror(store, code);
    if (again.synced !== cur.synced) return again;   // 役を取るまでにほかの要求が書いた
    const old = cur.mi;
    const failed = async (note: string): Promise<Loaded> => {
      const next: Mirror = { ...(old || EMPTY()), fail_ms: now, fail_note: note.replace(/[^\x20-\x7e]/g, '').slice(0, 80) };
      const s = await saveMirror(store, code, next, cur.synced, now);
      if (s === null) return loadMirror(store, code);
      saved = true;
      return { mi: next, synced: s };
    };
    const ms = await getAll(ctx.fetchFn, ctx.token, '/tournaments/' + ctx.tid + '/matches.json');
    if (!ms.ok) return await failed('matches:' + ms.note);
    const matches = ms.items.map(parseMatch).filter((x): x is CMatch => !!x);
    const known = new Set((old ? old.p : []).map((x) => String(x.id)));
    const needP = what === 'all' || !old || !old.p_ms || (!old.m.length && matches.length > 0)
      || matches.some((m) => m.p.some((id) => !!id && !known.has(id)));
    let p = old ? old.p : [];
    let pMs = old ? old.p_ms : 0;
    if (needP) {
      const ps = await getAll(ctx.fetchFn, ctx.token, '/tournaments/' + ctx.tid + '/participants.json');
      if (!ps.ok) return await failed('participants:' + ps.note);
      p = ps.items.map(parseParticipant).filter((x): x is CParticipant => !!x).map(packP);
      pMs = now;
    }
    const m = matches.map(packM);
    const had = !!old && old.m_ms > 0;
    const changed = !had || sig(old!.m) !== sig(m);
    const next: Mirror = {
      v: 1, p, m, p_ms: pMs, m_ms: now, w_ms: old ? old.w_ms : 0, chg_ms: changed || !old ? now : old.chg_ms,
      // SPSP が書いていないのに変わった = 運営が Challonge で直した (始まった瞬間は数えない)
      ext_ms: changed && had && old!.m.length > 0 && !old!.dirty ? now : old ? old.ext_ms : 0,
      dirty: false, fail_ms: 0, fail_note: '',
    };
    let s = await saveMirror(store, code, next, cur.synced, now);
    if (s === null) {
      // 読んでいる間に SPSP が書いた: 読んだ中身はそれより前かもしれないので、もう一度読むことにして書く
      const l = await loadMirror(store, code);
      next.dirty = true; next.ext_ms = l.mi ? l.mi.ext_ms : next.ext_ms; next.w_ms = l.mi ? l.mi.w_ms : next.w_ms; next.chg_ms = now;
      s = await saveMirror(store, code, next, l.synced, now);
      if (s === null) return loadMirror(store, code);
    }
    saved = true;
    return { mi: next, synced: s };
  } finally {
    if (!saved) await store.releaseReportSnapshot(code).catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * トーナメントの参加者と試合 (写し。必要なときだけ Challonge を読む)。
 * at = 試合を Challonge から読んだ時刻、stale = 最後に読めなかった理由 ('' = 読めている)
 */
export async function challongeData(ctx: ChCtx, mode?: 'force' | 'fresh'):
  Promise<{ ok: true; data: CData; at: number; stale: string; read: boolean } | { ok: false; note: string }> {
  let cur = await loadMirror(ctx.store, ctx.code);
  const what = mirrorDue(cur.mi, ctx.now, mode);
  const before = cur.mi ? cur.mi.m_ms : 0;
  if (what) {
    cur = await refreshMirror(ctx, cur, what);
    // 最初の 1 回をほかの要求が読んでいる最中: 少し待って写しを見る
    for (let i = 0; i < 4 && !cur.mi; i++) { await sleep(500); cur = await loadMirror(ctx.store, ctx.code); }
  }
  if (cur.mi && cur.mi.m_ms) return { ok: true, data: mirrorData(cur.mi), at: cur.mi.m_ms, stale: cur.mi.fail_note, read: cur.mi.m_ms !== before };
  return { ok: false, note: (cur.mi && cur.mi.fail_note) || 'not_ready' };
}

/** 互換: 写しを通さずに読む (テスト・確認用) */
export async function readChallonge(fetchFn: FetchFn, token: string, tid: string): Promise<{ ok: true; data: CData } | { ok: false; note: string }> {
  const ps = await getAll(fetchFn, token, '/tournaments/' + tid + '/participants.json');
  if (!ps.ok) return { ok: false, note: 'participants:' + ps.note };
  const ms = await getAll(fetchFn, token, '/tournaments/' + tid + '/matches.json');
  if (!ms.ok) return { ok: false, note: 'matches:' + ms.note };
  const participants = new Map<string, CParticipant>();
  for (const p of ps.items) { const x = parseParticipant(p); if (x) participants.set(x.id, x); }
  return { ok: true, data: { participants, matches: ms.items.map(parseMatch).filter((x): x is CMatch => !!x) } };
}

/** 読むのは写しから (phases・readSet は Challonge を呼ばないことが多い)。書いたら写しの試合を書き換えて、次の試合を読み直す印を付ける */
export function challongeProvider(ctx: ChCtx, double = false): Provider {
  const path = (mid: string) => '/tournaments/' + ctx.tid + '/matches/' + mid;
  const call = async (p: string, body: unknown, patch: (a: Record<string, unknown>, mi: Mirror) => void, setId: string): Promise<ProviderResult> => {
    const r = await challongeApi(ctx.fetchFn, ctx.token, p, body, 'PUT');
    await changeMirror(ctx.store, ctx.code, ctx.now, (mi) => {
      mi.dirty = true;
      if (!r.ok) return;   // 送れなかった (入ったかどうか分からないこともある): 中身は変えずに読み直すだけ
      mi.w_ms = ctx.now; mi.chg_ms = ctx.now;
      const m = mi.m.find((x) => String(x.id) === setId);
      if (m) patch(m.attributes, mi);
    }).catch(() => undefined);
    return r.ok ? { ok: true } : { ok: false, note: r.note + (r.message ? ':' + r.message.replace(/[^\x20-\x7e]/g, '').slice(0, 60) : '') };
  };
  const find = (d: CData, setId: string) => d.matches.find((x) => x.id === setId);
  return {
    async phases() {
      const r = await challongeData(ctx);
      if (!r.ok) return { ok: false, note: r.note };
      const ns = [...new Set(r.data.matches.map((x) => x.round).filter((n): n is number => n !== null && n !== 0))];
      ns.sort((a, b) => (a > 0) === (b > 0) ? Math.abs(a) - Math.abs(b) : b - a);
      return { ok: true, phases: [{ key: 'c', name: '', rounds: ns.map((n) => ({ n, label: cRoundLabel(r.data, n, double), bestOf: null })) }], entrants: r.data.participants.size || null };
    },
    async readSet(setId) {
      let r = await challongeData(ctx);
      if (!r.ok) return { ok: false, code: 'provider_error', note: r.note };
      let m = find(r.data, setId);
      if (!m || (m.state !== 'complete' && (!m.p[0] || !m.p[1]))) {
        // 写しに無い・相手が空き: 写しが古いかもしれないので読み直す (REPORT_CH_FRESH_MS に 1 回まで)
        const f = r.read ? r : await challongeData(ctx, 'fresh');
        if (f.ok) { r = f; m = find(f.data, setId); }
      }
      if (!m) return { ok: false, code: 'not_found', note: 'match_not_found' };
      return { ok: true, set: cSetOf(r.data, m, double) };
    },
    apply(set, r) {
      const [a, b] = score(r);
      const s0 = set.slots[0]; const s1 = set.slots[1];
      if (!s0 || !s1) return Promise.resolve({ ok: false, note: 'no_participant' });
      return call(path(set.id) + '.json', { data: { type: 'Match', attributes: { match: [
        { participant_id: s0.id, score_set: String(a), advancing: r.w === 0 },
        { participant_id: s1.id, score_set: String(b), advancing: r.w === 1 },
      ], tie: false } } }, (at, mi) => {
        at.state = 'complete'; at.winner_id = r.w === 0 ? s0.id : s1.id;
        at.player1_id = s0.id; at.player2_id = s1.id;
        at.points_by_participant = [{ participant_id: s0.id, scores: [a] }, { participant_id: s1.id, scores: [b] }];
        // 今終わった試合がいちばん新しい (cDownstreamDone は時刻の文字列を比べる。Challonge の書式に合わせず、写しのどれよりも後にする)
        const last = mi.m.map((x) => String(x.attributes.completed_at || '')).sort().pop() || '';
        at.completed_at = last ? last + '~' : new Date(ctx.now).toISOString();
      }, set.id);
    },
    reset(set) {
      return call(path(set.id) + '/change_state.json', { data: { type: 'MatchState', attributes: { state: 'reopen' } } }, (at) => {
        at.state = 'open'; at.winner_id = null; at.points_by_participant = []; at.completed_at = ''; at.underway_at = null;
      }, set.id);
    },
  };
}
