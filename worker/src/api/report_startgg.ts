/**
 * 試合結果の報告 (report.ts) の start.gg 側。運営のトークン (scope tournament.reporter) で set を読み、報告・修正・取り消しをする。
 *   reportBracketSet / updateBracketSet / resetSet (developer.start.gg/docs/examples/mutations/report-set)。
 * トークンは Authorization ヘッダにだけ入れる (startggGql)。失敗の note は符号と start.gg の文言の頭だけ。
 */
import type { FetchFn } from './oauth.ts';
import { startggGql } from './class_bracket.ts';
import type { NSet, NSlot, Result, Side } from './report_logic.ts';

/** 下位クラスのフェーズ・イベントの名前 (site/js/live_fetch.js の LOWER_CLASS_NAME_PAT と同じ) */
export const LOWER_CLASS_NAME_PAT = /[BCDEＢＣＤＥ]\s*クラス|(?<![A-Za-z])[BCDE][\s_\-]*class(?![A-Za-z])/i;

export type ProviderResult = { ok: true } | { ok: false; note: string };
/** 何先の設定に使うフェーズとラウンド (n = 勝者側 1, 2, …・敗者側 -1, -2, …、label = start.gg の名前。無ければ null) */
export interface PhaseInfo { key: string; name: string; rounds: { n: number; label: string | null; bestOf?: number | null }[] }
export interface Provider {
  phases(): Promise<{ ok: true; phases: PhaseInfo[] } | { ok: false; note: string }>;
  readSet(setId: string): Promise<{ ok: true; set: NSet } | { ok: false; code: 'not_found' | 'provider_error'; note: string }>;
  apply(set: NSet, r: Result, mode: 'report' | 'update'): Promise<ProviderResult>;
  reset(set: NSet): Promise<ProviderResult>;
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

const NEXT_QUERY = `query SpspReportNext($eventId: ID!, $entrantIds: [ID]) {
  event(id: $eventId) { sets(perPage: 40, page: 1, filters: { entrantIds: $entrantIds, hideEmpty: true }) {
    nodes { id state slots { prereqType prereqId } }
  } }
}`;

const REPORT_MUTATION = `mutation SpspReportBracketSet($setId: ID!, $winnerId: ID!, $gameData: [BracketSetGameDataInput]) {
  reportBracketSet(setId: $setId, winnerId: $winnerId, gameData: $gameData) { id state }
}`;
const UPDATE_MUTATION = `mutation SpspUpdateSet($setId: ID!, $winnerId: ID!, $gameData: [BracketSetGameDataInput]) {
  updateBracketSet(setId: $setId, winnerId: $winnerId, gameData: $gameData) { id state }
}`;
const RESET_MUTATION = `mutation SpspResetSet($setId: ID!) { resetSet(setId: $setId) { id state } }`;

/**
 * ブラケットの構造: フェーズごとに、ラウンドがいちばん多いブロックのラウンド (number・bestOf) と、
 * そのブロックの試合の fullRoundText (ラウンドの名前、Winners Semi-Final 等)。rounds が読めなければ試合の round だけで作る。
 */
const PHASES_QUERY = (withRounds: boolean) => `query SpspReportPhases($id: ID!) {
  event(id: $id) { phases { id name phaseGroups(query: { page: 1, perPage: 64 }) { nodes { id ${withRounds ? 'rounds { number bestOf }' : ''} } } } }
}`;
const GROUP_SETS_QUERY = `query SpspReportGroupSets($id: ID!, $page: Int!) {
  phaseGroup(id: $id) { sets(page: $page, perPage: 80, sortType: STANDARD) { pageInfo { totalPages } nodes { round fullRoundText } } }
}`;
const PHASES_MAX = 12;
const GROUP_PAGES_MAX = 4;
const PHASE_CALLS_MAX = 30;

type RawGroup = { id?: unknown; rounds?: unknown };
/** フェーズの一覧と、名前を読むブロック (ラウンドがいちばん多いもの) */
export function parsePhaseList(data: unknown): { key: string; name: string; group: string | null; rounds: Map<number, number | null> }[] {
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
    out.push({ key: String(ph.id), name: typeof ph.name === 'string' ? ph.name.slice(0, 80) : '', group: best ? String(best.id) : null, rounds });
  }
  return out;
}

/** ラウンドの並び: 勝者側 1, 2, … のあとに敗者側 -1, -2, … */
export function sortRounds<T extends { n: number }>(xs: T[]): T[] {
  return xs.sort((a, b) => (a.n > 0) === (b.n > 0) ? Math.abs(a.n) - Math.abs(b.n) : b.n - a.n);
}

/** 1 つのフェーズ: 試合の round と名前を足して PhaseInfo に */
export function phaseInfoOf(ph: { key: string; name: string; rounds: Map<number, number | null> }, sets: unknown[]): PhaseInfo {
  const labels = new Map<number, string | null>();
  for (const n of ph.rounds.keys()) labels.set(n, null);
  for (const s of sets) {
    const x = s as { round?: unknown; fullRoundText?: unknown } | null;
    const n = Number(x && x.round);
    if (!x || !Number.isInteger(n) || n === 0) continue;
    if (!labels.get(n)) labels.set(n, typeof x.fullRoundText === 'string' && x.fullRoundText ? x.fullRoundText.slice(0, 60) : null);
  }
  const rounds = sortRounds([...labels.entries()].map(([n, label]) => ({ n, label, bestOf: ph.rounds.get(n) ?? null })));
  return { key: ph.key, name: ph.name, rounds };
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

/** この set を前提 (prereq) にする set のうち、結果が入ったものがあるか */
export function downstreamDoneOf(nodes: unknown, setId: string): boolean {
  if (!Array.isArray(nodes)) return false;
  return nodes.some((n) => {
    const x = n as { id?: unknown; state?: unknown; slots?: { prereqType?: unknown; prereqId?: unknown }[] } | null;
    if (!x || String(x.id) === setId || Number(x.state) !== 3 || !Array.isArray(x.slots)) return false;
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
    async phases() {
      let r = await startggGql(fetchFn, token, PHASES_QUERY(true), { id: eventId });
      if (r.ok && Array.isArray(r.json.errors) && r.json.errors.length) r = await startggGql(fetchFn, token, PHASES_QUERY(false), { id: eventId });
      if (!r.ok) return { ok: false, note: r.note };
      if (!r.json.data || !r.json.data.event) return { ok: false, note: gqlNote(r.json) };
      const list = parsePhaseList(r.json.data);
      const out: PhaseInfo[] = [];
      let calls = 0;
      for (const ph of list) {
        const sets: unknown[] = [];
        for (let page = 1; ph.group && page <= GROUP_PAGES_MAX && calls < PHASE_CALLS_MAX; page++) {
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
      return { ok: true, phases: out };
    },
    async readSet(setId) {
      const r = await startggGql(fetchFn, token, SET_QUERY, { id: setId });
      if (!r.ok) return { ok: false, code: 'provider_error', note: r.note };
      const set = parseStartggSet(r.json.data ? r.json.data.set : null, eventId);
      if (!set) return Array.isArray(r.json.errors) && r.json.errors.length ? { ok: false, code: 'provider_error', note: gqlNote(r.json) } : { ok: false, code: 'not_found', note: 'set_not_found' };
      if (set.complete && set.slots[0] && set.slots[1]) {
        const n = await startggGql(fetchFn, token, NEXT_QUERY, { eventId, entrantIds: [set.slots[0].id, set.slots[1].id] });
        if (!n.ok) return { ok: false, code: 'provider_error', note: 'next:' + n.note };
        const ev = n.json.data ? n.json.data.event as { sets?: { nodes?: unknown } } | null : null;
        if (!ev || !ev.sets) return { ok: false, code: 'provider_error', note: 'next:' + gqlNote(n.json) };
        set.downstreamDone = downstreamDoneOf(ev.sets.nodes, set.id);
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
  };
}
