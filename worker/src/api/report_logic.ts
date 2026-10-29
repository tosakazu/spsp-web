/**
 * 試合結果の報告 (report.ts) の判定。start.gg / Challonge に依存しない部分 (docs/self_report_design.md §4)。
 *
 * 結果の形 (Result): { w: 勝った側 (0 / 1), g: ゲームごと [{ w: 勝った側, c: [側 0 のキャラ, 側 1 のキャラ], s: ステージ }] }
 *   側 = 試合の slots の順 (start.gg の entrant / Challonge の player1・player2)。キャラ・ステージは start.gg の ID (無ければ null)。
 * 照合のきまり (2026-10-29 決定):
 *   - 「同じ結果」= 勝った側と、ゲーム数のスコア (例 2-1) が同じ。キャラ・ステージは比べない
 *   - キャラは、その側の本人が入れたものを正とする (相手の入力は本人の入力が無いときだけ使う)
 *   - 1 人目の報告はすぐ反映する。2 人目が違えば反映を取り消して (reset)、両者がそろうのを待つ
 *   - 次の試合に結果が出たあとは、自動では取り消さない (運営の確認 review にする)
 *   - 運営が直した試合 (fixed) は、そのあとの選手の報告では動かさない
 */

export type Side = 0 | 1;
export interface Game { w: Side; c: [number | null, number | null]; s: number | null }
export interface Result { w: Side; g: Game[] }

/** 試合 (start.gg の set / Challonge の match) を、判定に要る形にしたもの */
export interface NSlot { id: string; name: string; users: string[]; seed: number | null }
export interface NSet {
  id: string;
  /** 結果が入っている (start.gg state 3 / Challonge complete) */
  complete: boolean;
  slots: [NSlot | null, NSlot | null];
  /** start.gg / Challonge に入っている結果 (キャラは見ない)。g が空ならスコア不明 */
  remote: Result | null;
  /** 何本勝負か (分かれば) */
  totalGames: number | null;
  /** この試合の勝者・敗者が進んだ次の試合に、もう結果が入っている */
  downstreamDone: boolean;
  /** 負けた人の順位 (start.gg の lPlacement。Challonge は残り人数から) */
  lPlacement: number | null;
  /** 下位クラス (Bクラス等) の試合 */
  isClass: boolean;
  /** ラウンド (勝者側 1, 2, …・敗者側 -1, -2, …。Challonge の 3 位決定戦は 0)。分からなければ null */
  round?: number | null;
  /** 何先の設定を引くフェーズ (start.gg の phase id。Challonge は 'c') */
  phaseKey?: string;
}

/**
 * 何先 (first to N) の設定。側ごとに「a 先、ラウンド from (絶対値) からは b 先」(from = null なら全部 a 先)。
 * 「全部 2 先」= w・l とも { a: 2, from: null, b: 2 }。フェーズごと (キー = phase id、Challonge は 'c') に持つ (2026-10-30)。
 */
export interface FtSide { a: number; from: number | null; b: number }
export interface FtRule { w: FtSide; l: FtSide }
export const FT_MAX = 5;
const FT_PHASES_MAX = 30;

/** 運営の設定 (report_events.settings) */
export interface ReportSettings { top_cut: number | null; classes_only: boolean; double?: boolean; ft?: Record<string, FtRule> }
export const TOP_CUTS = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128];

function ftNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= FT_MAX ? n : null;
}
function parseFtSide(v: unknown): FtSide | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const a = ftNum(o.a);
  if (a === null) return null;
  const from = Number(o.from);
  const b = ftNum(o.b);
  if (o.from === null || o.from === undefined || !Number.isInteger(from) || from < 1 || from > 99 || b === null) return { a, from: null, b: a };
  return { a, from, b };
}
export function parseFt(v: unknown): Record<string, FtRule> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: Record<string, FtRule> = {};
  let n = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[\w-]{1,20}$/.test(k) || !x || typeof x !== 'object') continue;
    const w = parseFtSide((x as Record<string, unknown>).w); const l = parseFtSide((x as Record<string, unknown>).l);
    if (!w || !l) continue;
    out[k] = { w, l };
    if (++n >= FT_PHASES_MAX) break;
  }
  return n ? out : null;
}

/** この試合が何先か (設定が無ければ null)。site/js の report.js の ftOf と同じ */
export function ftOf(set: NSet, s: ReportSettings): number | null {
  const rule = s.ft && set.phaseKey !== undefined ? s.ft[set.phaseKey] : undefined;
  if (!rule) return null;
  const r = set.round;
  const sd = r !== null && r !== undefined && r < 0 ? rule.l : rule.w;
  if (sd.from === null) return sd.a;
  if (r === null || r === undefined) return null;   // ラウンドが分からないと決められない
  if (r === 0) return sd.b;                         // Challonge の 3 位決定戦 = 最後のほう
  return Math.abs(r) >= sd.from ? sd.b : sd.a;
}

export function parseSettings(v: unknown): ReportSettings {
  let o: Record<string, unknown> = {};
  if (typeof v === 'string') { try { o = JSON.parse(v) || {}; } catch (_) { o = {}; } } else if (v && typeof v === 'object') o = v as Record<string, unknown>;
  const tc = Number(o.top_cut);
  const s: ReportSettings = { top_cut: TOP_CUTS.includes(tc) ? tc : null, classes_only: o.classes_only === true };
  if (o.double === true) s.double = true;
  const ft = parseFt(o.ft);
  if (ft) s.ft = ft;
  return s;
}

/** 選手が報告してよい試合か (運営の設定)。だめなら理由の符号 */
export function playerGate(set: NSet, s: ReportSettings): 'top_cut' | 'classes_only' | null {
  if (s.classes_only && !set.isClass) return 'classes_only';
  if (s.top_cut !== null && set.lPlacement !== null && set.lPlacement <= s.top_cut) return 'top_cut';
  return null;
}

export type ReportState = 'reported' | 'agreed' | 'conflict' | 'review' | 'fixed' | 'reset';
export type Op = 'none' | 'report' | 'update' | 'reset' | 'rereport';
export interface Decision { op: Op; state: ReportState; result: Result | null; note: string }

export const MAX_GAMES = 9;
const ID_MAX = 1e9;

function nullableId(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && n < ID_MAX ? n : undefined;
}
function side(v: unknown): Side | null {
  return v === 0 || v === 1 ? v : null;
}

/**
 * 送られた結果を確かめる (形だけ。勝敗の数の整合もここで見る)。違えば理由の符号。
 * DQ・不戦勝は受け付けない (ゲームが 1 つ以上必要。運営が start.gg で入れる、2026-10-29 決定)。
 */
export function parseResult(v: unknown, ft: number | null = null): { result: Result } | { bad: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { bad: 'result' };
  const o = v as Record<string, unknown>;
  const w = side(o.w);
  if (w === null) return { bad: 'winner' };
  if (!Array.isArray(o.g) || o.g.length < 1 || o.g.length > MAX_GAMES) return { bad: 'games' };
  const g: Game[] = [];
  for (const x of o.g) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return { bad: 'game' };
    const gx = x as Record<string, unknown>;
    const gw = side(gx.w);
    if (gw === null) return { bad: 'game_winner' };
    const c = Array.isArray(gx.c) ? gx.c : [null, null];
    if (c.length !== 2) return { bad: 'chars' };
    const c0 = nullableId(c[0]); const c1 = nullableId(c[1]); const s = nullableId(gx.s);
    if (c0 === undefined || c1 === undefined) return { bad: 'chars' };
    if (s === undefined) return { bad: 'stage' };
    g.push({ w: gw, c: [c0, c1], s });
  }
  const [a, b] = score({ w, g });
  if ((w === 0 ? a <= b : b <= a)) return { bad: 'score' };   // 勝った側がゲームを多く取っている
  if (ft) {
    // 何先が決まっている: 勝った側はちょうど ft、負けた側は ft 未満 (1 先なら 1-0 だけ)
    if ((w === 0 ? a : b) !== ft || (w === 0 ? b : a) >= ft) return { bad: 'score_ft' };
  }
  // 何先が決まっていなければ勝ち越していればよい (start.gg の totalGames は実際の大会では常に 5 で当てにならない)
  return { result: { w, g } };
}

/** ゲーム数のスコア [側 0, 側 1] */
export function score(r: Result): [number, number] {
  let a = 0; let b = 0;
  for (const x of r.g) { if (x.w === 0) a++; else b++; }
  return [a, b];
}

/** 同じ結果か (勝った側とスコア。どちらかのスコアが不明なら勝った側だけ) */
export function sameOutcome(x: Result | null, y: Result | null): boolean {
  if (!x || !y) return false;
  if (x.w !== y.w) return false;
  if (!x.g.length || !y.g.length) return true;
  const [a, b] = score(x); const [c, d] = score(y);
  return a === c && b === d;
}

/** キャラ・ステージまで同じか */
export function sameFull(x: Result | null, y: Result | null): boolean {
  return !!x && !!y && JSON.stringify(x) === JSON.stringify(y);
}

/**
 * 両者の報告から送る結果を作る。ゲームの勝敗とステージは先に送った側 (primary)、
 * キャラは「その側の本人の入力 → 無ければ相手の入力」。
 */
export function mergeResults(subs: [Result | null, Result | null], primary: Side): Result {
  const base = subs[primary] || subs[primary === 0 ? 1 : 0];
  if (!base) throw new Error('mergeResults: no result');
  const other = subs[primary === 0 ? 1 : 0];
  const charOf = (s: Side, i: number): number | null => {
    const own = subs[s] && subs[s]!.g[i] ? subs[s]!.g[i].c[s] : null;
    if (own !== null && own !== undefined) return own;
    const o2 = subs[s === 0 ? 1 : 0];
    const v = o2 && o2.g[i] ? o2.g[i].c[s] : null;
    return v === undefined ? null : v;
  };
  return {
    w: base.w,
    g: base.g.map((x, i) => ({
      w: x.w,
      c: [charOf(0, i), charOf(1, i)],
      s: x.s !== null ? x.s : (other && other.g[i] ? other.g[i].s : null),
    })),
  };
}

export interface Latest { result: Result; ts: number }

/**
 * 今の状態と両者の最新の報告から、start.gg / Challonge に何をするか決める。
 *   prev   = D1 の行 (state と、SPSP が送った結果 applied)。無ければ null
 *   latest = 側ごとの最新の報告 (運営の報告より後のものだけ)
 *   set    = start.gg / Challonge の今の状態
 * applied が今の remote と同じ結果なら「SPSP が入れた結果がそのまま残っている」とみなす。
 * それ以外の結果 (運営が start.gg で直接入れた等) は動かさない。
 */
export function reconcile(prev: { state: ReportState; applied: Result | null } | null, latest: [Latest | null, Latest | null], set: NSet): Decision {
  const none = (state: ReportState, note = ''): Decision => ({ op: 'none', state, result: null, note });
  if (prev && prev.state === 'fixed') return none('fixed');
  const ours = prev ? prev.applied : null;
  const byUs = set.complete && !!ours && sameOutcome(ours, set.remote);
  const external = set.complete && !byUs;
  const [a, b] = latest;

  if (a && b) {
    if (sameOutcome(a.result, b.result)) {
      const target = mergeResults([a.result, b.result], a.ts <= b.ts ? 0 : 1);
      if (!set.complete) return { op: 'report', state: 'agreed', result: target, note: '' };
      if (external) return sameOutcome(target, set.remote) ? none('agreed') : none('review', 'external_mismatch');
      if (sameFull(ours, target)) return none('agreed');
      if (sameOutcome(ours, target)) return set.downstreamDone ? none('agreed') : { op: 'update', state: 'agreed', result: target, note: '' };
      return set.downstreamDone ? none('review', 'locked_change') : { op: 'rereport', state: 'agreed', result: target, note: '' };
    }
    // 食い違い
    if (!set.complete) return none('conflict');
    if (external) return none('review', 'external_mismatch');
    if (set.downstreamDone) return none('review', 'locked_conflict');
    return { op: 'reset', state: 'conflict', result: null, note: '' };
  }

  const one = a || b;
  if (!one) return none(prev ? prev.state : 'reset');
  const r = one.result;
  if (!set.complete) return { op: 'report', state: 'reported', result: r, note: '' };
  if (external) return sameOutcome(r, set.remote) ? none('agreed') : none('review', 'external_mismatch');
  if (sameFull(ours, r)) return none(prev ? prev.state : 'reported');
  if (sameOutcome(ours, r)) return set.downstreamDone ? none(prev ? prev.state : 'reported') : { op: 'update', state: 'reported', result: r, note: '' };
  return set.downstreamDone ? none('review', 'locked_change') : { op: 'rereport', state: 'reported', result: r, note: '' };
}

/** 運営が直す・取り消すときの判定。次の試合に結果が出ていたら locked */
export function adminDecision(kind: 'fix' | 'reset', result: Result | null, set: NSet, ours: Result | null = null): Decision | { locked: true } {
  if (set.downstreamDone) return { locked: true };
  if (kind === 'reset') return { op: set.complete ? 'reset' : 'none', state: 'reset', result: null, note: 'admin' };
  if (!result) throw new Error('adminDecision: no result');
  if (!set.complete) return { op: 'report', state: 'fixed', result, note: 'admin' };
  void ours;
  // 勝者もスコアも同じならキャラ・ステージだけ直す。違えば一度取り消して入れ直す
  return { op: sameOutcome(result, set.remote) ? 'update' : 'rereport', state: 'fixed', result, note: 'admin' };
}
