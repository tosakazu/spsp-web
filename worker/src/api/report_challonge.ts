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

export interface CParticipant { id: string; name: string; uid: string | null; seed: number | null }
export interface CMatch {
  id: string; state: string; round: number | null; identifier: string;
  p: [string | null, string | null];
  prereq: [string | null, string | null];
  prereqLoser: [boolean, boolean];
  winner: string | null;
  points: Record<string, number>;
  completedAt: string;
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
  };
}

/** 次の試合 (この試合を前提にする試合) に結果が入っているか。前提の項目が無い形なら、両者の後の試合で見る (分からなければ true) */
export function cDownstreamDone(d: CData, m: CMatch): boolean {
  const hasPrereq = d.matches.some((x) => x.prereq[0] || x.prereq[1]);
  if (hasPrereq) return d.matches.some((x) => x.id !== m.id && x.state === 'complete' && (x.prereq[0] === m.id || x.prereq[1] === m.id));
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

/** トーナメントの参加者と試合をまとめて読む */
export async function readChallonge(fetchFn: FetchFn, token: string, tid: string): Promise<{ ok: true; data: CData } | { ok: false; note: string }> {
  const ps = await getAll(fetchFn, token, '/tournaments/' + tid + '/participants.json');
  if (!ps.ok) return { ok: false, note: 'participants:' + ps.note };
  const ms = await getAll(fetchFn, token, '/tournaments/' + tid + '/matches.json');
  if (!ms.ok) return { ok: false, note: 'matches:' + ms.note };
  const participants = new Map<string, CParticipant>();
  for (const p of ps.items) { const x = parseParticipant(p); if (x) participants.set(x.id, x); }
  return { ok: true, data: { participants, matches: ms.items.map(parseMatch).filter((x): x is CMatch => !!x) } };
}

export function challongeProvider(fetchFn: FetchFn, token: string, tid: string, double = false): Provider {
  const path = (mid: string) => '/tournaments/' + tid + '/matches/' + mid;
  const call = async (p: string, body: unknown): Promise<ProviderResult> => {
    const r = await challongeApi(fetchFn, token, p, body, 'PUT');
    return r.ok ? { ok: true } : { ok: false, note: r.note + (r.message ? ':' + r.message.replace(/[^\x20-\x7e]/g, '').slice(0, 60) : '') };
  };
  return {
    async phases() {
      const r = await readChallonge(fetchFn, token, tid);
      if (!r.ok) return { ok: false, note: r.note };
      const ns = [...new Set(r.data.matches.map((x) => x.round).filter((n): n is number => n !== null && n !== 0))];
      ns.sort((a, b) => (a > 0) === (b > 0) ? Math.abs(a) - Math.abs(b) : b - a);
      return { ok: true, phases: [{ key: 'c', name: '', rounds: ns.map((n) => ({ n, label: null })) }] };
    },
    async readSet(setId) {
      const r = await readChallonge(fetchFn, token, tid);
      if (!r.ok) return { ok: false, code: 'provider_error', note: r.note };
      const m = r.data.matches.find((x) => x.id === setId);
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
      ], tie: false } } });
    },
    reset(set) {
      return call(path(set.id) + '/change_state.json', { data: { type: 'MatchState', attributes: { state: 'reopen' } } });
    },
  };
}
