/**
 * トーナメントシミュレーション: start.gg のフェーズの構造を読んで、シード順から「シード通り (小さいシードが勝つ)」で勝ち上がらせた表を作る (2026-11-05)。
 * 構造 (試合のつながり・不戦勝・敗者側への落ち方・グランドファイナルのやり直し) は start.gg の phaseGroup.sets (showByes) をそのまま使い、
 * 計算は結果報告と同じ bracket_engine.ts。Worker (bracket_structure) と画面 (src/pages/bracket_sgg.js) の両方から使う。
 *
 * 読むもの (start.gg への問い合わせを少なく):
 *   - フェーズ: ブロックの一覧と形式
 *   - シード: フェーズごと (どのシード番号がどのブロックの何番目か・前のフェーズのどこから来るか)
 *   - 試合: 同じフェーズで人数が同じブロックは構造が同じ (2026-11-05 に実データ 318 組で確かめた) なので、人数ごとに 1 ブロックだけ
 * 開始前のブロックは試合 ID が仮 (preview_…) でも、つながりは仮の ID 同士で書かれているのでそのまま使える。
 * 前のフェーズからの通過は、開始前は通過先のリンクが無いので順位と並べ方のきまり (bracket_engine の控え) で決める。
 */
import { addGroup, BYE, emptyBracket, resolve, VOID } from './bracket_engine.ts';
import type { Bracket } from './bracket_engine.ts';

export type Gql = (query: string, variables: Record<string, unknown>) => Promise<{ data?: unknown; errors?: unknown[] } | null>;

const PHASE_QUERY = `query SpspSimPhase($id: ID!) { phase(id: $id) { id name phaseOrder bracketType numSeeds
  phaseGroups(query: { page: 1, perPage: 256 }) { nodes { id displayIdentifier bracketType } } } }`;
const SEEDS_QUERY = `query SpspSimSeeds($id: ID!, $page: Int!, $perPage: Int!) { phase(id: $id) { seeds(query: { page: $page, perPage: $perPage }) {
  pageInfo { totalPages } nodes { id seedNum groupSeedNum phaseGroup { id } progressionSource { originPlacement originOrder originPhaseGroup { id } } } } } }`;
const SETS_QUERY = `query SpspSimSets($id: ID!, $page: Int!, $perPage: Int!) { phaseGroup(id: $id) {
  sets(page: $page, perPage: $perPage, sortType: STANDARD, filters: { hideEmpty: false, showByes: true }) {
    pageInfo { totalPages } nodes { id round identifier fullRoundText wPlacement lPlacement slots { prereqType prereqId prereqPlacement } } } } }`;

export const MAX_PHASES = 8;
const MAX_PAGES = 60;

export interface SimSeed { id: string; n: number | null; gs: number | null; g: string; src: { g: string; pl: number; ord: number } | null }
export interface SimSet { id: string; r: number; x: string; t: string; wp: number | null; lp: number | null; sl: [string | null, string | null, number | null][] }
export interface SimPhase { id: string; name: string; order: number | null; type: string | null; numSeeds: number | null;
  /** tpl = 試合の型のキー (形式:人数)。templates[キー] = 型の試合と、その試合を読んだブロック (シード ID はそのブロックのもの) */
  groups: { id: string; d: string; type: string | null; tpl: string }[]; seeds: SimSeed[]; templates: Record<string, { owner: string; sets: SimSet[] }> }
export interface SimData { v: 1; phases: SimPhase[]; fetched_at: number }

async function pages(gql: Gql, query: string, vars: Record<string, unknown>, path: string[], per: number): Promise<unknown[]> {
  const out: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await gql(query, { ...vars, page, perPage: per });
    let c: unknown = j && j.data;
    for (const k of path) c = c && typeof c === 'object' ? (c as Record<string, unknown>)[k] : null;
    const conn = c as { nodes?: unknown[]; pageInfo?: { totalPages?: unknown } } | null;
    if (!conn || !Array.isArray(conn.nodes)) {
      const e = j && Array.isArray(j.errors) && j.errors[0] as { message?: unknown } | undefined;
      throw new Error('start.gg: ' + (e && typeof e.message === 'string' ? e.message.slice(0, 120) : path.join('.')));
    }
    out.push(...conn.nodes);
    if (page >= (Number(conn.pageInfo && conn.pageInfo.totalPages) || 1)) break;
  }
  return out;
}
const sid = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => { const n = Number(v); return v !== null && v !== undefined && Number.isFinite(n) ? n : null; };

/** start.gg からフェーズの構造を読む (phaseIds = 予選から順に) */
export async function fetchSimData(gql: Gql, phaseIds: string[], now = Date.now()): Promise<SimData> {
  const phases: SimPhase[] = [];
  for (const pid of phaseIds.slice(0, MAX_PHASES)) {
    const pj = await gql(PHASE_QUERY, { id: pid });
    const ph = pj && pj.data ? (pj.data as { phase?: Record<string, unknown> | null }).phase : null;
    if (!ph) throw new Error('start.gg: phase ' + pid);
    const groups = (((ph.phaseGroups as { nodes?: unknown[] } | null) || {}).nodes || []).map((x) => {
      const g = x as { id?: unknown; displayIdentifier?: unknown; bracketType?: unknown };
      return { id: String(g.id), d: String(g.displayIdentifier ?? ''), type: typeof g.bracketType === 'string' ? g.bracketType : (typeof ph.bracketType === 'string' ? ph.bracketType : null), tpl: '' };
    });
    const seeds = (await pages(gql, SEEDS_QUERY, { id: pid }, ['phase', 'seeds'], 100)).map((x): SimSeed => {
      const s = x as { id?: unknown; seedNum?: unknown; groupSeedNum?: unknown; phaseGroup?: { id?: unknown } | null; progressionSource?: { originPlacement?: unknown; originOrder?: unknown; originPhaseGroup?: { id?: unknown } | null } | null };
      const ps = s.progressionSource;
      const og = ps && ps.originPhaseGroup ? sid(ps.originPhaseGroup.id) : null;
      return { id: String(s.id), n: num(s.seedNum), gs: num(s.groupSeedNum), g: s.phaseGroup ? String(s.phaseGroup.id) : '',
        src: og && ps && num(ps.originPlacement) !== null ? { g: og, pl: Number(ps.originPlacement), ord: num(ps.originOrder) || 1 } : null };
    });
    // 人数 (と形式) ごとに 1 ブロックだけ試合を読む
    const count = new Map<string, number>();
    for (const s of seeds) count.set(s.g, (count.get(s.g) || 0) + 1);
    const templates: Record<string, { owner: string; sets: SimSet[] }> = {};
    for (const g of groups) {
      g.tpl = (g.type || '') + ':' + (count.get(g.id) || 0);
      if (templates[g.tpl]) continue;
      const raw = await pages(gql, SETS_QUERY, { id: g.id }, ['phaseGroup', 'sets'], 60);
      templates[g.tpl] = { owner: g.id, sets: raw.map((x) => {
        const s = x as { id?: unknown; round?: unknown; identifier?: unknown; fullRoundText?: unknown; wPlacement?: unknown; lPlacement?: unknown; slots?: unknown[] };
        return { id: String(s.id), r: Number(s.round) || 0, x: String(s.identifier ?? ''), t: String(s.fullRoundText ?? '').slice(0, 60), wp: num(s.wPlacement), lp: num(s.lPlacement),
          sl: (Array.isArray(s.slots) ? s.slots : []).slice(0, 2).map((y) => { const o = (y || {}) as { prereqType?: unknown; prereqId?: unknown; prereqPlacement?: unknown };
            return [typeof o.prereqType === 'string' ? o.prereqType : null, sid(o.prereqId), num(o.prereqPlacement)] as [string | null, string | null, number | null]; }) };
      }) };
    }
    phases.push({ id: String(ph.id), name: String(ph.name ?? ''), order: num(ph.phaseOrder), type: typeof ph.bracketType === 'string' ? ph.bracketType : null,
      numSeeds: num(ph.numSeeds), groups, seeds, templates });
  }
  return { v: 1, phases, fetched_at: now };
}

/** 表示用 (結果報告のトーナメント表 report_bracket_view.js の renderGroup と同じ形) */
export interface SimGroupView {
  group: { id: string; name: string; b: string | null; bad: false };
  sets: { i: string; r: number; t: string; x: string; s: number; w: string | null; st: null; hw: null; sl: { e: string | null; sc: null; pd: 0; pt: string | null; pi: string | null; pp: number | null }[] }[];
}
export interface SimResult { groups: { id: string; name: string; phase: string; views: SimGroupView }[]; entrants: number; warnings: string[] }

/**
 * シード順 (1 始まり、最初のフェーズのシード番号) から、シード通りに勝ち上がらせた全フェーズの表を作る。
 * 出場者の ID = 'n' + 最初のフェーズのシード番号。名前は画面が付ける
 */
export function simulate(data: SimData): SimResult {
  const warnings: string[] = [];
  const b: Bracket = emptyBracket();
  const groupName = new Map<string, { name: string; phase: string }>();
  data.phases.forEach((ph, pi) => {
    const seedsOf = new Map<string, SimSeed[]>();
    for (const s of ph.seeds) (seedsOf.get(s.g) || seedsOf.set(s.g, []).get(s.g)!).push(s);
    for (const g of ph.groups) {
      const T = ph.templates[g.tpl];
      const tpl = T ? T.sets : [];
      const mine = seedsOf.get(g.id) || [];
      const byGs = new Map(mine.map((s) => [s.gs, s]));
      // 型を読んだブロックのシード ID → 何番目か (同じ番目のこのブロックのシードに置き換える)
      const tplSeeds = new Map<string, number | null>();
      for (const s of (T ? seedsOf.get(T.owner) : mine) || []) tplSeeds.set(s.id, s.gs);
      const pre = (id: string) => g.id + ':' + id;
      const sets = tpl.map((s) => ({
        id: pre(s.id), round: s.r, identifier: s.x, wPlacement: s.wp, lPlacement: s.lp,
        slots: s.sl.map(([pt, pid, pp]) => {
          if (pt === 'seed') {
            const gs = pid !== null && tplSeeds.has(pid) ? tplSeeds.get(pid)! : (pid !== null && /^\d+$/.test(pid) && Number(pid) <= mine.length ? Number(pid) : null);
            const target = gs !== null ? byGs.get(gs) : undefined;
            return { prereqType: target ? 'seed' : 'bye', prereqId: target ? target.id : null, prereqPlacement: null };
          }
          return { prereqType: pt, prereqId: pt === 'set' || (pt === 'bye' && pid) ? (pid ? pre(pid) : null) : pid, prereqPlacement: pp };
        }),
      }));
      const seeds = mine.map((s) => ({ id: s.id, groupSeedNum: s.gs, seedNum: s.n,
        entrant: pi === 0 && s.n !== null ? { id: 'n' + s.n } : null,
        progressionSource: pi > 0 && s.src ? { originPlacement: s.src.pl, originOrder: s.src.ord, originPhaseGroup: { id: s.src.g } } : null }));
      addGroup(b, g.id, g.type, sets, seeds);
      groupName.set(g.id, { name: ph.groups.length > 1 ? (ph.name + ' ' + g.d).trim() : ph.name, phase: ph.id });
    }
  });
  // シード通り: 両方の出場者が決まった試合は、最初のフェーズのシード番号が小さい方の勝ち。決まらなくなるまで繰り返す
  const rank = (e: string) => Number(e.slice(1)) || 1e9;
  const real = (v: string | null): v is string => !!v && v !== BYE && v !== VOID;
  const winners: Record<string, string> = {};
  let r = resolve(b, winners, { fromSources: true, confirmed: () => true });
  for (let k = 0; k < 400; k++) {
    let changed = false;
    for (const [id, st] of Object.entries(r.sets)) {
      if (winners[id] || st.void || !real(st.occ[0]) || !real(st.occ[1])) continue;
      winners[id] = rank(st.occ[0]) <= rank(st.occ[1]) ? st.occ[0] : st.occ[1];
      changed = true;
    }
    if (!changed) break;
    r = resolve(b, winners, { fromSources: true, confirmed: () => true });
  }
  const real0 = (v: string | null) => (real(v) ? v : null);
  const groups: SimResult['groups'] = [];
  for (const ph of data.phases) for (const g of ph.groups) {
    const sets = Object.values(b.sets).filter((s) => s.g === g.id).map((s) => {
      const st = r.sets[s.id];
      const tplId = s.id.slice(g.id.length + 1);
      const t = (ph.templates[g.tpl] ? ph.templates[g.tpl].sets : []).find((x) => x.id === tplId);
      return { i: s.id, r: s.r, t: t ? t.t : '', x: s.ident || '', s: 1, w: st && !st.void ? real0(st.w) : null, st: null, hw: null,
        sl: s.sl.map((x, k) => ({ e: st && !st.void ? real0(st.occ[k]) : null, sc: null, pd: 0 as const, pt: x.k, pi: x.id, pp: x.p })) };
    }).filter((s) => !(r.sets[s.i] && r.sets[s.i].void));
    const meta = groupName.get(g.id)!;
    groups.push({ id: g.id, name: meta.name, phase: meta.phase, views: { group: { id: g.id, name: meta.name, b: g.type, bad: false }, sets } });
  }
  const entrants = data.phases[0] ? data.phases[0].seeds.length : 0;
  // start.gg に次のフェーズの席 (シード) がまだ無い (通過の設定をする前など)
  if (data.phases.slice(1).some((ph) => !ph.seeds.length)) warnings.push('no_seeds');
  if (data.phases.slice(1).some((ph) => ph.groups.some((g) => g.type === 'ROUND_ROBIN')) || data.phases.slice(0, -1).some((ph) => ph.groups.some((g) => g.type === 'ROUND_ROBIN'))) warnings.push('rr');
  return { groups, entrants, warnings };
}
