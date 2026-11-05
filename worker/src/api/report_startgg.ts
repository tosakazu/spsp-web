/**
 * 試合結果の報告 (report.ts) の start.gg 側。運営のトークン (scope tournament.reporter) で set を読み、報告・修正・取り消しをする。
 *   reportBracketSet / updateBracketSet / resetSet (developer.start.gg/docs/examples/mutations/report-set)。
 * トークンは Authorization ヘッダにだけ入れる (startggGql)。失敗の note は符号と start.gg の文言の頭だけ。
 */
import type { FetchFn } from './oauth.ts';
import { startggGql } from './class_bracket.ts';
import type { NSet, NSlot, Result, Side } from './report_logic.ts';
import { findStartggSet } from './report_outage.ts';
import type { FoundSkip } from './report_outage.ts';

/** 下位クラスのフェーズ・イベントの名前 (site/js/live_fetch.js の LOWER_CLASS_NAME_PAT と同じ) */
export const LOWER_CLASS_NAME_PAT = /[BCDEＢＣＤＥ]\s*クラス|(?<![A-Za-z])[BCDE][\s_\-]*class(?![A-Za-z])/i;

export type ProviderResult = { ok: true } | { ok: false; note: string };
/** 何先の設定に使うフェーズとラウンド (n = 勝者側 1, 2, …・敗者側 -1, -2, …、label = start.gg の名前。無ければ null) */
/** started = ブロックのどれかが開始済み (start.gg の phaseGroup.state が CREATED 以外。読めなければ undefined) */
export interface PhaseInfo { key: string; name: string; rounds: { n: number; label: string | null; bestOf?: number | null }[]; started?: boolean }
export interface Provider {
  /** entrants = 参加人数 (分からなければ null。トップ N の候補を絞るのに使う) */
  /** light = フェーズと開始済みかだけ (ラウンドの名前を読まない。1 回で済む。運営の画面の「未開始」の読み直し用) */
  phases(light?: boolean): Promise<{ ok: true; phases: PhaseInfo[]; entrants?: number | null } | { ok: false; note: string }>;
  readSet(setId: string): Promise<{ ok: true; set: NSet } | { ok: false; code: 'not_found' | 'provider_error'; note: string }>;
  apply(set: NSet, r: Result, mode: 'report' | 'update'): Promise<ProviderResult>;
  reset(set: NSet): Promise<ProviderResult>;
  /** 運営が指定した 2 人の、まだ結果の無い試合を探す (start.gg だけ。report_outage.ts) */
  /** その参加者の試合 (DQ の対象を探す。start.gg だけ) */
  setsOf?(entrantId: string): Promise<{ ok: true; sets: { id: string; state: number; round: number | null; entrants: (string | null)[] }[] } | { ok: false; note: string }>;
  /** DQ: winnerSide の側の勝ち (reportBracketSet isDQ)。start.gg だけ */
  dq?(set: NSet, winnerSide: Side): Promise<ProviderResult>;
  /** 対戦開始: start.gg の試合を試合中にする (markSetInProgress)。start.gg だけ */
  start?(setId: string): Promise<ProviderResult>;
  findSet?(ids: [string, string], side: 'w' | 'l' | 'r' | 'g', exclude?: Set<string>, skip?: FoundSkip): Promise<{ ok: true; found: { id: string; flip: boolean } | null } | { ok: false; note: string }>;
}

const SET_QUERY = `query SpspReportSet($id: ID!) {
  set(id: $id) {
    id state round winnerId totalGames lPlacement
    event { id name }
    phaseGroup { phase { id name } }
    slots { entrant { id name initialSeedNum participants { user { id } } } }
    games { orderNum winnerId }
  }
}`;

const NEXT_QUERY = `query SpspReportNext($eventId: ID!, $entrantIds: [ID], $page: Int!) {
  event(id: $eventId) { sets(perPage: 60, page: $page, filters: { entrantIds: $entrantIds, hideEmpty: true }) {
    pageInfo { totalPages }
    nodes { id state slots { prereqType prereqId } }
  } }
}`;
const NEXT_PAGES_MAX = 3;   // 2 人の試合を 180 まで (総当たりのプールが続いても足りる)

const REPORT_MUTATION = `mutation SpspReportBracketSet($setId: ID!, $winnerId: ID!, $gameData: [BracketSetGameDataInput]) {
  reportBracketSet(setId: $setId, winnerId: $winnerId, gameData: $gameData) { id state }
}`;
const UPDATE_MUTATION = `mutation SpspUpdateSet($setId: ID!, $winnerId: ID!, $gameData: [BracketSetGameDataInput]) {
  updateBracketSet(setId: $setId, winnerId: $winnerId, gameData: $gameData) { id state }
}`;
const DQ_MUTATION = `mutation SpspReportDq($setId: ID!, $winnerId: ID!) { reportBracketSet(setId: $setId, winnerId: $winnerId, isDQ: true) { id state } }`;
const START_MUTATION = `mutation SpspStartSet($setId: ID!) { markSetInProgress(setId: $setId) { id state } }`;
const SETS_OF_QUERY = `query SpspReportSetsOf($eventId: ID!, $entrantIds: [ID], $page: Int!) {
  event(id: $eventId) { sets(perPage: 60, page: $page, filters: { entrantIds: $entrantIds, hideEmpty: true }) {
    pageInfo { totalPages }
    nodes { id state round slots { entrant { id } } }
  } }
}`;
const RESET_MUTATION = `mutation SpspResetSet($setId: ID!) { resetSet(setId: $setId) { id state } }`;

/**
 * ブラケットの構造: フェーズごとに、ラウンドがいちばん多いブロックのラウンド (number・bestOf) と、
 * そのブロックの試合の fullRoundText (ラウンドの名前、Winners Semi-Final 等)。rounds が読めなければ試合の round だけで作る。
 */
const PHASES_QUERY = (withRounds: boolean) => `query SpspReportPhases($id: ID!) {
  event(id: $id) { numEntrants phases { id name phaseGroups(query: { page: 1, perPage: 64 }) { nodes { id state ${withRounds ? 'rounds { number bestOf }' : ''} } } } }
}`;
const GROUP_SETS_QUERY = `query SpspReportGroupSets($id: ID!, $page: Int!) {
  phaseGroup(id: $id) { sets(page: $page, perPage: 80, sortType: STANDARD) { pageInfo { totalPages } nodes { round fullRoundText } } }
}`;
const PHASES_MAX = 12;
const GROUP_PAGES_MAX = 4;
const PHASE_CALLS_MAX = 30;

type RawGroup = { id?: unknown; rounds?: unknown; state?: unknown };
/** フェーズの一覧と、名前を読むブロック (ラウンドがいちばん多いもの) */
export function parsePhaseList(data: unknown): { key: string; name: string; group: string | null; rounds: Map<number, number | null>; started?: boolean }[] {
  const ev = data ? (data as { event?: { phases?: unknown } | null }).event : null;
  const phases = ev && Array.isArray(ev.phases) ? ev.phases.slice(0, PHASES_MAX) : [];
  const out = [];
  for (const p of phases) {
    const ph = p as { id?: unknown; name?: unknown; phaseGroups?: { nodes?: unknown[] } | null } | null;
    if (!ph || ph.id === undefined || ph.id === null) continue;
    const groups = (ph.phaseGroups && Array.isArray(ph.phaseGroups.nodes) ? ph.phaseGroups.nodes : []) as RawGroup[];
    let best: RawGroup | null = null; let bestN = -1;
    for (const g of groups) {
      const n = g && Array.isArray(g.rounds) ? g.rounds.length : 0;
      if (g && g.id !== undefined && g.id !== null && n > bestN) { best = g; bestN = n; }
    }
    const rounds = new Map<number, number | null>();
    if (best && Array.isArray(best.rounds)) {
      for (const r of best.rounds) {
        const x = r as { number?: unknown; bestOf?: unknown };
        const n = Number(x.number); const bo = Number(x.bestOf);
        if (Number.isInteger(n) && n !== 0) rounds.set(n, Number.isInteger(bo) && bo > 0 ? bo : null);
      }
    }
    // 開始済みか: start.gg の phaseGroup.state は 1 = CREATED (未開始) / 2 = ACTIVE / 3 = COMPLETED (数か名前)。読めなければ undefined
    const states = groups.map((g) => (g ? g.state : undefined)).filter((x) => x !== undefined && x !== null);
    const started = states.length ? states.some((x) => !(Number(x) === 1 || x === 'CREATED')) : undefined;
    out.push({ key: String(ph.id), name: typeof ph.name === 'string' ? ph.name.slice(0, 80) : '', group: best ? String(best.id) : null, rounds, started });
  }
  return out;
}

/** ラウンドの並び: 勝者側 1, 2, … のあとに敗者側 -1, -2, … */
export function sortRounds<T extends { n: number }>(xs: T[]): T[] {
  return xs.sort((a, b) => (a.n > 0) === (b.n > 0) ? Math.abs(a.n) - Math.abs(b.n) : b.n - a.n);
}

/** 1 つのフェーズ: 試合の round と名前を足して PhaseInfo に */
export function phaseInfoOf(ph: { key: string; name: string; rounds: Map<number, number | null>; started?: boolean }, sets: unknown[]): PhaseInfo {
  const labels = new Map<number, string | null>();
  for (const n of ph.rounds.keys()) labels.set(n, null);
  for (const s of sets) {
    const x = s as { round?: unknown; fullRoundText?: unknown } | null;
    const n = Number(x && x.round);
    if (!x || !Number.isInteger(n) || n === 0) continue;
    if (!labels.get(n)) labels.set(n, typeof x.fullRoundText === 'string' && x.fullRoundText ? x.fullRoundText.slice(0, 60) : null);
  }
  const rounds = sortRounds([...labels.entries()].map(([n, label]) => ({ n, label, bestOf: ph.rounds.get(n) ?? null })));
  return ph.started === undefined ? { key: ph.key, name: ph.name, rounds } : { key: ph.key, name: ph.name, rounds, started: ph.started };
}

export const EVENT_QUERY = `query SpspReportEvent($slug: String, $id: ID) {
  event(slug: $slug, id: $id) { id name slug state startAt tournament { id name slug startAt endAt } }
}`;

type Gql = { data?: Record<string, unknown> | null; errors?: unknown[] };

function gqlNote(json: Gql): string {
  const e = Array.isArray(json.errors) && json.errors[0] as { message?: unknown } | undefined;
  const m = e && typeof e.message === 'string' ? e.message : '';
  return 'gql' + (m ? ':' + m.replace(/[^\x20-\x7e]/g, '').slice(0, 80) : '');
}

/** set の 1 つの枠 (entrant) */
function slotOf(s: unknown): NSlot | null {
  const ent = (s ? (s as { entrant?: unknown }).entrant : null) as { id?: unknown; name?: unknown; initialSeedNum?: unknown; participants?: unknown } | null;
  if (!ent || ent.id === undefined || ent.id === null) return null;
  const users: string[] = [];
  if (Array.isArray(ent.participants)) {
    for (const p of ent.participants) {
      const u = p && (p as { user?: { id?: unknown } | null }).user;
      if (u && u.id !== undefined && u.id !== null) users.push(String(u.id));
    }
  }
  const seed = Number(ent.initialSeedNum);
  return { id: String(ent.id), name: typeof ent.name === 'string' ? ent.name : '', users, seed: Number.isFinite(seed) && seed > 0 ? seed : null };
}

/** start.gg の set を判定用の形に (eventId と違うイベントの set なら null) */
export function parseStartggSet(raw: unknown, eventId: string): NSet | null {
  const s = raw as { id?: unknown; state?: unknown; winnerId?: unknown; totalGames?: unknown; lPlacement?: unknown; event?: { id?: unknown; name?: unknown } | null;
    round?: unknown; phaseGroup?: { phase?: { id?: unknown; name?: unknown } | null } | null; slots?: unknown[]; games?: unknown[] | null } | null;
  if (!s || s.id === undefined || !s.event || String(s.event.id) !== eventId) return null;
  const slots = Array.isArray(s.slots) ? s.slots : [];
  const sl: [NSlot | null, NSlot | null] = [slotOf(slots[0]), slotOf(slots[1])];
  const complete = Number(s.state) === 3;
  const sideOf = (id: unknown): Side | null => (sl[0] && String(id) === sl[0].id ? 0 : sl[1] && String(id) === sl[1].id ? 1 : null);
  let remote: Result | null = null;
  if (complete && s.winnerId !== null && s.winnerId !== undefined) {
    const w = sideOf(s.winnerId);
    if (w !== null) {
      const games = (Array.isArray(s.games) ? s.games : [])
        .map((g) => g as { orderNum?: unknown; winnerId?: unknown })
        .sort((x, y) => Number(x.orderNum) - Number(y.orderNum))
        .map((g) => sideOf(g.winnerId));
      remote = { w, g: games.every((x) => x !== null) ? games.map((x) => ({ w: x as Side, c: [null, null], s: null })) : [] };
    }
  }
  const tg = Number(s.totalGames);
  const lp = Number(s.lPlacement);
  const phaseName = s.phaseGroup && s.phaseGroup.phase && typeof s.phaseGroup.phase.name === 'string' ? s.phaseGroup.phase.name : '';
  const phaseId = s.phaseGroup && s.phaseGroup.phase && s.phaseGroup.phase.id !== undefined && s.phaseGroup.phase.id !== null ? String(s.phaseGroup.phase.id) : undefined;
  const round = Number(s.round);
  const eventName = typeof s.event.name === 'string' ? s.event.name : '';
  return { id: String(s.id), complete, slots: sl, remote, totalGames: Number.isInteger(tg) && tg > 0 ? tg : null, downstreamDone: false,
    lPlacement: Number.isInteger(lp) && lp > 0 ? lp : null, isClass: LOWER_CLASS_NAME_PAT.test(phaseName) || LOWER_CLASS_NAME_PAT.test(eventName),
    round: s.round !== null && s.round !== undefined && Number.isInteger(round) ? round : null, phaseKey: phaseId };
}

/** この set を前提 (prereq) にする set のうち、始まった (state 2) か結果が入った (state 3) ものがあるか。
 *  あれば start.gg で自動では取り消さず、運営に回す (2026-11-05 から「始まった」も。取り消すと進行中の試合が消える) */
export function downstreamDoneOf(nodes: unknown, setId: string): boolean {
  if (!Array.isArray(nodes)) return false;
  return nodes.some((n) => {
    const x = n as { id?: unknown; state?: unknown; slots?: { prereqType?: unknown; prereqId?: unknown }[] } | null;
    if (!x || String(x.id) === setId || !(Number(x.state) === 2 || Number(x.state) === 3) || !Array.isArray(x.slots)) return false;
    return x.slots.some((sl) => sl && sl.prereqType === 'set' && String(sl.prereqId) === setId);
  });
}

/** 送る gameData (キャラ・ステージは分かっているものだけ) */
export function gameDataOf(set: NSet, r: Result): Record<string, unknown>[] {
  const ids = [set.slots[0] ? set.slots[0].id : '', set.slots[1] ? set.slots[1].id : ''];
  return r.g.map((g, i) => {
    const d: Record<string, unknown> = { gameNum: i + 1, winnerId: ids[g.w] };
    if (g.s !== null) d.stageId = String(g.s);
    const sel = ([0, 1] as Side[]).filter((k) => g.c[k] !== null).map((k) => ({ entrantId: ids[k], characterId: String(g.c[k]) }));
    if (sel.length) d.selections = sel;
    return d;
  });
}

export function startggProvider(fetchFn: FetchFn, token: string, eventId: string): Provider {
  const mutate = async (query: string, vars: Record<string, unknown>): Promise<ProviderResult> => {
    const r = await startggGql(fetchFn, token, query, vars);
    if (!r.ok) return { ok: false, note: r.note };
    if (Array.isArray(r.json.errors) && r.json.errors.length) return { ok: false, note: gqlNote(r.json) };
    return { ok: true };
  };
  return {
    async phases(light) {
      let r = await startggGql(fetchFn, token, PHASES_QUERY(true), { id: eventId });
      if (r.ok && Array.isArray(r.json.errors) && r.json.errors.length) r = await startggGql(fetchFn, token, PHASES_QUERY(false), { id: eventId });
      if (!r.ok) return { ok: false, note: r.note };
      if (!r.json.data || !r.json.data.event) return { ok: false, note: gqlNote(r.json) };
      const list = parsePhaseList(r.json.data);
      const out: PhaseInfo[] = [];
      let calls = 0;
      for (const ph of list) {
        const sets: unknown[] = [];
        for (let page = 1; !light && ph.group && page <= GROUP_PAGES_MAX && calls < PHASE_CALLS_MAX; page++) {
          calls++;
          const g = await startggGql(fetchFn, token, GROUP_SETS_QUERY, { id: ph.group, page });
          const pg = g.ok && g.json.data ? g.json.data.phaseGroup as { sets?: { pageInfo?: { totalPages?: unknown }; nodes?: unknown } } | null : null;
          if (!pg || !pg.sets || !Array.isArray(pg.sets.nodes)) break;
          sets.push(...pg.sets.nodes);
          const total = Number(pg.sets.pageInfo && pg.sets.pageInfo.totalPages);
          if (!Number.isFinite(total) || page >= total) break;
        }
        out.push(phaseInfoOf(ph, sets));
      }
      const ne = Number((r.json.data.event as { numEntrants?: unknown }).numEntrants);
      return { ok: true, phases: out, entrants: Number.isInteger(ne) && ne > 0 ? ne : null };
    },
    async readSet(setId) {
      const r = await startggGql(fetchFn, token, SET_QUERY, { id: setId });
      if (!r.ok) return { ok: false, code: 'provider_error', note: r.note };
      const set = parseStartggSet(r.json.data ? r.json.data.set : null, eventId);
      if (!set) return Array.isArray(r.json.errors) && r.json.errors.length ? { ok: false, code: 'provider_error', note: gqlNote(r.json) } : { ok: false, code: 'not_found', note: 'set_not_found' };
      if (set.complete && set.slots[0] && set.slots[1]) {
        // 2 人が出る試合から「この試合の勝者・敗者が進んだ試合」を探す (ページをまたぐ)
        const nodes: unknown[] = [];
        for (let page = 1; page <= NEXT_PAGES_MAX; page++) {
          const n = await startggGql(fetchFn, token, NEXT_QUERY, { eventId, entrantIds: [set.slots[0].id, set.slots[1].id], page });
          if (!n.ok) return { ok: false, code: 'provider_error', note: 'next:' + n.note };
          const ev = n.json.data ? n.json.data.event as { sets?: { nodes?: unknown; pageInfo?: { totalPages?: unknown } } } | null : null;
          if (!ev || !ev.sets) return { ok: false, code: 'provider_error', note: 'next:' + gqlNote(n.json) };
          if (Array.isArray(ev.sets.nodes)) nodes.push(...ev.sets.nodes);
          const total = Number(ev.sets.pageInfo && ev.sets.pageInfo.totalPages);
          if (!Number.isFinite(total) || page >= total) break;
        }
        set.downstreamDone = downstreamDoneOf(nodes, set.id);
      }
      return { ok: true, set };
    },
    apply(set, r, mode) {
      const winner = set.slots[r.w];
      if (!winner) return Promise.resolve({ ok: false, note: 'no_entrant' });
      return mutate(mode === 'update' ? UPDATE_MUTATION : REPORT_MUTATION, { setId: set.id, winnerId: winner.id, gameData: gameDataOf(set, r) });
    },
    reset(set) {
      return mutate(RESET_MUTATION, { setId: set.id });
    },
    dq(set, winnerSide) {
      const w = set.slots[winnerSide];
      if (!w) return Promise.resolve({ ok: false, note: 'no_entrant' });
      return mutate(DQ_MUTATION, { setId: set.id, winnerId: w.id });
    },
    start(setId) {
      return mutate(START_MUTATION, { setId });
    },
    async setsOf(entrantId) {
      const out: { id: string; state: number; round: number | null; entrants: (string | null)[] }[] = [];
      for (let page = 1; page <= 3; page++) {
        const r = await startggGql(fetchFn, token, SETS_OF_QUERY, { eventId, entrantIds: [entrantId], page });
        if (!r.ok) return { ok: false, note: 'sets_of:' + r.note };
        const ev = r.json.data ? r.json.data.event as { sets?: { nodes?: unknown; pageInfo?: { totalPages?: unknown } } } | null : null;
        if (!ev || !ev.sets) return { ok: false, note: 'sets_of:' + gqlNote(r.json) };
        for (const n of Array.isArray(ev.sets.nodes) ? ev.sets.nodes : []) {
          const x = n as { id?: unknown; state?: unknown; round?: unknown; slots?: { entrant?: { id?: unknown } | null }[] } | null;
          if (!x || !/^\d+$/.test(String(x.id))) continue;
          const rd = Number(x.round);
          out.push({ id: String(x.id), state: Number(x.state) || 1, round: Number.isFinite(rd) ? rd : null,
            entrants: (Array.isArray(x.slots) ? x.slots : []).map((s) => (s && s.entrant && s.entrant.id !== undefined && s.entrant.id !== null ? String(s.entrant.id) : null)) });
        }
        const total = Number(ev.sets.pageInfo && ev.sets.pageInfo.totalPages);
        if (!Number.isFinite(total) || page >= total) break;
      }
      return { ok: true, sets: out };
    },
    findSet(ids, side, exclude, skip) {
      return findStartggSet(fetchFn, token, eventId, ids, side, exclude, skip);
    },
  };
}

// ── ブラケットの開始 (テスト用、2026-11-04) ────────────────────────────────
// start.gg の API には「ブラケットを開始する」操作が無い。開始前の試合 (preview_…) を試合中にすると start.gg がそのブロックを
// 始めて本物の ID を振るか、を試す: 最初のフェーズの未開始のブロックごとに、2 人そろった仮の試合を 1 つ markSetInProgress →
// 本物の ID が返れば resetSet で試合中を取り消す → ブロックの状態を読み直す。動くかは分からない (結果をそのまま画面に出す)
const PROBE_PHASES_QUERY = `query SpspProbePhases($id: ID!) {
  event(id: $id) { phases { id name phaseOrder isExhibition phaseGroups(query: { page: 1, perPage: 64 }) { nodes { id displayIdentifier state } } } }
}`;
const PROBE_SETS_QUERY = `query SpspProbeSets($id: ID!) {
  phaseGroup(id: $id) { id state sets(page: 1, perPage: 30, sortType: STANDARD) { nodes { id state slots { entrant { id } } } } }
}`;
// 取り消す前に読み直す試合 (勝者・スコアが入っていたら取り消さない)
const PROBE_SET_CHECK_QUERY = `query SpspProbeSetCheck($id: ID!) {
  set(id: $id) { id state winnerId slots { standing { stats { score { value } } } } }
}`;
const PROBE_GROUPS_MAX = 12;
const groupNotStarted = (state: unknown) => Number(state) === 1 || state === 'CREATED';
export interface ProbeStep { phase: string; group: string; ident: string; set?: string; result: 'started' | 'not_started' | 'skipped' | 'error'; note: string; state_after?: unknown }

export async function probeStartBracket(fetchFn: FetchFn, token: string, eventId: string, maxGroups = PROBE_GROUPS_MAX): Promise<{ ok: true; steps: ProbeStep[]; more: number } | { ok: false; note: string }> {
  const r = await startggGql(fetchFn, token, PROBE_PHASES_QUERY, { id: eventId });
  if (!r.ok) return { ok: false, note: r.note };
  const ev = r.json.data ? r.json.data.event as { phases?: unknown } | null : null;
  if (!ev || !Array.isArray(ev.phases)) return { ok: false, note: gqlNote(r.json) };
  type P = { id?: unknown; name?: unknown; phaseOrder?: unknown; isExhibition?: unknown; phaseGroups?: { nodes?: unknown } | null };
  const phases = (ev.phases as P[]).filter((p) => p && !p.isExhibition)
    .sort((a, b) => (Number(a.phaseOrder) || 0) - (Number(b.phaseOrder) || 0));
  const first = phases[0];
  if (!first) return { ok: false, note: 'no_phase' };
  type G = { id?: unknown; displayIdentifier?: unknown; state?: unknown };
  const groups = ((first.phaseGroups && Array.isArray(first.phaseGroups.nodes) ? first.phaseGroups.nodes : []) as G[])
    .filter((g) => g && g.id != null && groupNotStarted(g.state));
  const steps: ProbeStep[] = [];
  const phaseName = typeof first.name === 'string' ? first.name : '';
  for (const g of groups.slice(0, maxGroups)) {
    const step: ProbeStep = { phase: phaseName, group: String(g.id), ident: String(g.displayIdentifier ?? ''), result: 'skipped', note: '' };
    steps.push(step);
    const q = await startggGql(fetchFn, token, PROBE_SETS_QUERY, { id: String(g.id) });
    const pg = q.ok && q.json.data ? q.json.data.phaseGroup as { state?: unknown; sets?: { nodes?: unknown } | null } | null : null;
    if (!pg) { step.result = 'error'; step.note = 'read: ' + (q.ok ? gqlNote(q.json) : q.note); continue; }
    type S = { id?: unknown; slots?: { entrant?: { id?: unknown } | null }[] | null };
    const sets = (pg.sets && Array.isArray(pg.sets.nodes) ? pg.sets.nodes : []) as S[];
    // 試合を始めて取り消すのは、ブロックがまだ始まっていないときだけ (2026-11-05)。開始時刻より前に選手が試合を始めていることがある。
    // 直前に読み直して、ブロックが始まっていた・本物の ID の試合がある (= 始まっている) なら何もしない
    if (!groupNotStarted(pg.state) || sets.some((x) => x && x.id != null && !String(x.id).startsWith('preview'))) {
      step.result = 'started'; step.note = 'already_started'; step.state_after = pg.state; continue;
    }
    const pick = sets.find((x) => x && String(x.id).startsWith('preview') && Array.isArray(x.slots) && x.slots.length === 2 && x.slots.every((sl) => sl && sl.entrant && sl.entrant.id != null));
    if (!pick) { step.note = 'no_preview_set_with_two_entrants'; continue; }
    step.set = String(pick.id);
    const m = await startggGql(fetchFn, token, START_MUTATION, { setId: String(pick.id) });
    if (!m.ok) { step.result = 'error'; step.note = 'markSetInProgress: ' + m.note; continue; }
    if (Array.isArray(m.json.errors) && m.json.errors.length) { step.result = 'error'; step.note = 'markSetInProgress: ' + gqlNote(m.json); continue; }
    const got = m.json.data ? m.json.data.markSetInProgress as { id?: unknown; state?: unknown } | null : null;
    const realId = got && got.id != null && /^\d+$/.test(String(got.id)) ? String(got.id) : null;
    step.note = 'markSetInProgress -> id=' + String(got && got.id) + ' state=' + String(got && got.state);
    if (realId) {
      // 取り消す前に読み直す: 試合中でない・勝者やスコアが入っている (= 誰かが本当に始めて報告した) なら取り消さない
      const c = await startggGql(fetchFn, token, PROBE_SET_CHECK_QUERY, { id: realId });
      type CS = { state?: unknown; winnerId?: unknown; slots?: { standing?: { stats?: { score?: { value?: unknown } | null } | null } | null }[] | null };
      const cs = c.ok && c.json.data ? c.json.data.set as CS | null : null;
      const scored = !!cs && Array.isArray(cs.slots) && cs.slots.some((sl) => sl && sl.standing && sl.standing.stats && sl.standing.stats.score && sl.standing.stats.score.value != null);
      const why = !cs ? 'unread' : !(Number(cs.state) === 2 || cs.state === 'ACTIVE') ? 'state=' + String(cs.state) : cs.winnerId != null ? 'has_winner' : scored ? 'has_score' : '';
      if (why) step.note += '; resetSet skipped (' + why + ')';
      else {
        const z = await startggGql(fetchFn, token, RESET_MUTATION, { setId: realId });
        const zerr = !z.ok ? z.note : Array.isArray(z.json.errors) && z.json.errors.length ? gqlNote(z.json) : '';
        step.note += zerr ? '; resetSet: ' + zerr : '; resetSet ok';
      }
    }
    const a = await startggGql(fetchFn, token, PROBE_SETS_QUERY, { id: String(g.id) });
    const after = a.ok && a.json.data ? a.json.data.phaseGroup as { state?: unknown } | null : null;
    step.state_after = after ? after.state : null;
    step.result = after && !groupNotStarted(after.state) ? 'started' : 'not_started';
  }
  return { ok: true, steps, more: Math.max(0, groups.length - maxGroups) };
}
