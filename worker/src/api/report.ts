/**
 * 選手による試合結果の報告 (docs/self_report_design.md)。
 *
 * 運営:
 *   action: "report_begin"        { nonce, returnPath }  → { url }  (scope REPORTER_SCOPE の認可画面。state は f='reporter')
 *   action: "report_enable"       { code, state, event }  → { report, token, user, exp }
 *                                 event = start.gg のイベントの slug (tournament/x/event/y) か ID。運営か確かめて受付を始め、
 *                                 運営のトークン (access + refresh) を暗号化して D1 に置く。普段のログインのセッションも返す
 *   action: "report_enable_class" { startgg_token, challonge_token, challonge_exp, class_id } → { report }
 *                                 下位クラス (Challonge) の受付。作った本人か本戦の運営だけ
 *   action: "report_admin"        { token, code }  → { report, sets }  運営 (受付を始めた人) だけ
 *   action: "report_phases"       { token, code }  → { phases }  何先の設定に使うフェーズとラウンド (運営だけ)
 *   action: "report_admin_fix"    { token, code, set_id, result | reset: true }  次の試合に結果が出るまで
 *   action: "report_stop"         { token, code }  受付を止めてトークンを消す
 * 選手:
 *   action: "report_info"         { code }  → { report }  だれでも
 *   action: "report_view"         { token, code }  → { me, admin, sets, challonge? }  自分の試合の状態 (Challonge は試合も)
 *   action: "report_submit"       { token, code, set_id, result }  → { state, op }
 *   action: "report_notices"      { token? }  → { events, mine }  受付中の大会と、自分の試合の食い違い (トップのお知らせ)
 *
 * トークンは暗号化したまま D1 に置き (report_crypto.ts)、応答・ログ・errors の note には出さない。
 * 受付の期限 (大会の終わりの翌日の終わり) を過ぎるか、運営が止めると消す。
 */
import type { Config } from '../config.ts';
import {
  REPORTER_SCOPE, REPORT_ADMIN_MAX_PER_DAY, REPORT_CHALLONGE_CACHE_S, REPORT_MAX_OPEN_MS, REPORT_MAX_PER_DAY, REPORT_MIN_INTERVAL_MS,
  REPORT_MIN_OPEN_MS,
} from '../config.ts';
import type { ReportEventRow, ReportSetRow, Store } from '../store.ts';
import { checkStartggAdmin, startggCurrentUser, startggGql } from './class_bracket.ts';
import { challongeApi } from './challonge.ts';
import { handleManagerBegin, logLogin } from './login.ts';
import type { FetchFn } from './oauth.ts';
import { exchangeCodeForToken, fetchCurrentUser, oauthErrorMessage, refreshAccessToken } from './oauth.ts';
import { openJson, sealJson } from './report_crypto.ts';
import type { CData, CMatch } from './report_challonge.ts';
import { cSetOf, challongeProvider, parseMatch, parseParticipant, readChallonge } from './report_challonge.ts';
import type { Decision, Latest, NSet, ReportState, Result, Side } from './report_logic.ts';
import { adminDecision, ftOf, parseResult, parseSettings, playerGate, reconcile } from './report_logic.ts';
import type { Provider } from './report_startgg.ts';
import { EVENT_QUERY, startggProvider } from './report_startgg.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { checkStateToken, issueSessionToken, verifySessionToken } from './session.ts';

const DAY = 24 * 3600 * 1000;
const MSG_STATE = '認証の照合に失敗しました。認証を始めてから時間が経ちすぎたか、同じリンクを二度開いた可能性があります。結果報告のページからやり直してください。';
const MSG_LOGIN = 'ログインが切れています。もう一度ログインしてください。';
const MSG_CLOSED = 'この大会の結果報告の受付は終わっています。結果は運営に伝えてください。';

/** 暗号化して置くトークン */
interface Sealed { at: string; rt: string | null; exp: number }

/** 報告ページの URL に入る 10 文字 (紛らわしい字を除く) */
export function newReportCode(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (const x of crypto.getRandomValues(new Uint8Array(10))) s += abc[x % abc.length];
  return s;
}
const CODE_RE = /^[a-z0-9]{10}$/;
const SET_ID_RE = /^[1-9]\d{0,14}$/;

/** 受付の期限: 大会の終わり (秒) の翌日の終わり (JST などの固定オフセット)。短すぎ・長すぎは丸める */
export function reportExpiry(endAtSec: number | null, now: number, offsetMin: number): number {
  const off = offsetMin * 60 * 1000;
  let exp = now + 2 * DAY;
  if (endAtSec && Number.isFinite(endAtSec)) {
    const end = endAtSec * 1000;
    exp = Math.floor((end + off) / DAY) * DAY + 2 * DAY - off - 1;
  }
  return Math.min(Math.max(exp, now + REPORT_MIN_OPEN_MS), now + REPORT_MAX_OPEN_MS);
}

/** 画面に出してよい受付の欄 */
function publicOf(ev: ReportEventRow, now: number) {
  return {
    code: ev.code, kind: ev.kind, name: ev.name, slug: ev.slug, event_id: ev.event_id, tournament_id: ev.tournament_id, class_id: ev.class_id,
    expires_ms: ev.expires_ms, active: ev.status === 'active' && ev.expires_ms >= now && !!ev.token_enc, settings: parseSettings(ev.settings),
  };
}

const admins = (ev: ReportEventRow): string[] => ev.admins.split(',').filter(Boolean);
const addAdmin = (list: string, uid: string): string => Array.from(new Set([...list.split(',').filter(Boolean), uid])).slice(-20).join(',');

// ── 運営: 受付を始める ────────────────────────────────────────────────

/** action: "report_begin" */
export function handleReportBegin(cfg: Config, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  return handleManagerBegin(cfg, req, now, 'reporter');
}

/** start.gg のイベント指定 (slug か ID) */
function eventVars(v: unknown): Record<string, unknown> | null {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return { id: String(v) };
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^[1-9]\d{0,11}$/.test(s)) return { id: s };
  const m = /(?:^|start\.gg\/)(tournament\/[a-z0-9-]+\/event\/[a-z0-9-]+)/i.exec(s);
  return m ? { slug: m[1].toLowerCase() } : null;
}

/** action: "report_enable" — 認可コードを運営のトークンに換え、運営か確かめて受付を始める */
export async function handleReportEnable(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || !req.code || req.code.length > 1024) return err('bad_request', '認証コードがありません。');
  const vars = eventVars(req.event);
  if (!vars) return err('bad_request', 'start.gg のイベントの URL を確かめてください。', 'bad:event');
  const st = await checkStateToken(cfg, store, req.state, true, now);
  if ('reason' in st) return err('state_invalid', MSG_STATE, st.reason);
  if (st.payload.f !== 'reporter') return err('state_invalid', MSG_STATE, 'wrong_flow');
  const ex = await exchangeCodeForToken(cfg, req.code, fetchFn, REPORTER_SCOPE);
  if (!ex.token) return err('auth_failed', oauthErrorMessage(ex.reason), ex.reason || '');
  const user = await fetchCurrentUser(ex.token, fetchFn);
  if (!user) return err('auth_failed', oauthErrorMessage('no_user'), 'no_user');

  const q = await startggGql(fetchFn, ex.token, EVENT_QUERY, vars);
  const evRaw = q.ok && q.json.data ? q.json.data.event as { id?: unknown; name?: unknown; slug?: unknown; tournament?: { id?: unknown; name?: unknown; endAt?: unknown } | null } | null : null;
  if (!q.ok) return err('startgg_error', 'start.gg に確認できませんでした。時間をおいてやり直してください。', 'event:' + q.note);
  if (!evRaw || evRaw.id === undefined || !evRaw.tournament) return err('bad_request', 'start.gg でイベントが見つかりません。', 'event_not_found');
  const eventId = Number(evRaw.id);
  const adm = await checkStartggAdmin(fetchFn, ex.token, eventId);
  if (!adm.ok) {
    if (adm.code === 'not_admin') return err('not_admin', 'このアカウントは、この大会の管理者ではありません。', adm.note);
    return err('startgg_error', 'start.gg に確認できませんでした。時間をおいてやり直してください。', adm.note);
  }
  const t = evRaw.tournament;
  const name = [typeof t.name === 'string' ? t.name : '', typeof evRaw.name === 'string' ? evRaw.name : ''].filter(Boolean).join(' / ').slice(0, 200);
  const sealed: Sealed = { at: ex.token, rt: ex.refreshToken ?? null, exp: now + (ex.expiresIn ? ex.expiresIn * 1000 : DAY) };
  const old = await store.getReportEventByTarget('startgg', String(eventId));
  const row: ReportEventRow = {
    code: old ? old.code : newReportCode(), kind: 'startgg', target_id: String(eventId), event_id: eventId, tournament_id: adm.tournamentId, class_id: null,
    name, slug: typeof evRaw.slug === 'string' ? evRaw.slug : '', admins: addAdmin(old ? old.admins : '', user.id),
    token_enc: await sealJson(cfg, sealed), token_exp_ms: sealed.exp, status: 'active', created_ms: old ? old.created_ms : now,
    expires_ms: reportExpiry(Number(t.endAt) || null, now, cfg.tsOffsetMin),
    settings: JSON.stringify(req.settings !== undefined ? parseSettings(req.settings) : parseSettings(old ? old.settings : '{}')),
  };
  await store.upsertReportEvent(row);
  const saved = (await store.getReportEventByTarget('startgg', String(eventId))) || row;
  const token = await issueSessionToken(cfg, user, now);
  const sess = await verifySessionToken(cfg, token, now);
  await logLogin(store, user.id, 'reporter', now);
  return ok({ report: publicOf(saved, now), token, user: { id: user.id, slug: user.slug, gamerTag: user.gamerTag }, exp: sess ? sess.exp : null });
}

const tokenOk = (v: unknown, max: number): v is string => typeof v === 'string' && !!v && v.length <= max && !/\s/.test(v);

/** action: "report_enable_class" — 下位クラス (Challonge) の受付 */
export async function handleReportEnableClass(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (!tokenOk(req.startgg_token, 4096)) return err('bad_request', '入力の形式が不正です。', 'bad:startgg_token');
  if (!tokenOk(req.challonge_token, 4096)) return err('bad_request', '入力の形式が不正です。', 'bad:challonge_token');
  const classId = typeof req.class_id === 'number' && Number.isInteger(req.class_id) && req.class_id > 0 ? req.class_id : null;
  if (classId === null) return err('bad_request', '入力の形式が不正です。', 'bad:class_id');
  const me = await startggCurrentUser(fetchFn, req.startgg_token);
  if (!me.ok) return err('startgg_error', 'start.gg に確認できませんでした。ログインかキーを確かめてください。', me.note);
  const cls = await store.getClassBracket(classId);
  if (!cls || cls.status === 'deleted') return err('not_found', 'その下位クラスはありません (削除済みかもしれません)。', 'not_found');
  if (cls.registered_by !== me.userId) {
    const adm = await checkStartggAdmin(fetchFn, req.startgg_token, cls.parent_event_id);
    if (!adm.ok) return err('not_admin', 'この下位クラスを作った人か、本戦の大会の管理者だけが受付を始められます。', adm.note);
  }
  const t = await challongeApi(fetchFn, req.challonge_token, '/tournaments/' + cls.challonge_id + '.json', null, 'GET');
  if (!t.ok) return err(t.code, t.message, 'tournament:' + t.note);
  const attrs = ((t.json.data || {}) as { attributes?: Record<string, unknown> }).attributes || {};
  const exp0 = Number(req.challonge_exp);
  const sealed: Sealed = { at: req.challonge_token, rt: null, exp: Number.isFinite(exp0) && exp0 > now ? Math.min(exp0, now + 30 * DAY) : now + 6 * DAY };
  const old = await store.getReportEventByTarget('challonge', String(cls.challonge_id));
  const row: ReportEventRow = {
    code: old ? old.code : newReportCode(), kind: 'challonge', target_id: String(cls.challonge_id), event_id: cls.parent_event_id, tournament_id: null,
    class_id: classId, name: (typeof attrs.name === 'string' ? attrs.name : '').slice(0, 200),
    slug: typeof attrs.full_challonge_url === 'string' ? attrs.full_challonge_url : '', admins: addAdmin(old ? old.admins : '', me.userId),
    token_enc: await sealJson(cfg, sealed), token_exp_ms: sealed.exp, status: 'active', created_ms: old ? old.created_ms : now,
    expires_ms: Math.min(now + 2 * DAY, sealed.exp),
    // Challonge は下位クラスなので classes_only は意味を持たない。ダブルイリミかどうかは残り人数の数え方に使う
    settings: JSON.stringify({ ...parseSettings(req.settings !== undefined ? req.settings : old ? old.settings : '{}'), classes_only: false,
      double: /double/i.test(String(attrs.tournament_type || '')) }),
  };
  await store.upsertReportEvent(row);
  return ok({ report: publicOf((await store.getReportEventByTarget('challonge', String(cls.challonge_id))) || row, now) });
}

// ── 受付と運営のトークン ─────────────────────────────────────────────

type Opened = { ok: true; ev: ReportEventRow; token: string } | { ok: false; res: HandlerResult };

/** 受付中の受付と、使える運営のトークン (start.gg は期限の 10 分前から延長する) */
async function openEvent(cfg: Config, store: Store, fetchFn: FetchFn, code: unknown, now: number): Promise<Opened> {
  if (typeof code !== 'string' || !CODE_RE.test(code)) return { ok: false, res: err('bad_request', '報告ページの URL が正しくありません。', 'bad:code') };
  await store.purgeReportTokens(now);
  const ev = await store.getReportEvent(code);
  if (!ev) return { ok: false, res: err('not_found', '報告ページの URL が正しくありません。', 'no_event') };
  if (ev.status !== 'active' || !ev.token_enc || ev.expires_ms < now) return { ok: false, res: err('report_closed', MSG_CLOSED, 'closed') };
  const s = await openJson<Sealed>(cfg, ev.token_enc);
  if (!s || !s.at) return { ok: false, res: err('report_closed', MSG_CLOSED, 'token_unreadable') };
  if (ev.kind === 'startgg' && s.exp - now < 10 * 60 * 1000) {
    if (!s.rt) return { ok: false, res: err('report_closed', MSG_CLOSED, 'token_expired') };
    const r = await refreshAccessToken(cfg, s.rt, fetchFn, REPORTER_SCOPE);
    if (!r.token) return { ok: false, res: err('report_closed', MSG_CLOSED, 'refresh:' + (r.reason || '')) };
    const next: Sealed = { at: r.token, rt: r.refreshToken || s.rt, exp: now + (r.expiresIn ? r.expiresIn * 1000 : DAY) };
    await store.updateReportEventToken(ev.code, await sealJson(cfg, next), next.exp);
    return { ok: true, ev, token: next.at };
  }
  if (ev.kind === 'challonge' && s.exp < now) return { ok: false, res: err('report_closed', MSG_CLOSED, 'token_expired') };
  return { ok: true, ev, token: s.at };
}

function providerOf(fetchFn: FetchFn, o: { ev: ReportEventRow; token: string }): Provider {
  return o.ev.kind === 'challonge' ? challongeProvider(fetchFn, o.token, o.ev.target_id, parseSettings(o.ev.settings).double === true)
    : startggProvider(fetchFn, o.token, o.ev.target_id);
}

// ── 試合ごとの判定と反映 ───────────────────────────────────────────────

function parseApplied(s: string): Result | null {
  if (!s) return null;
  try { return JSON.parse(s) as Result; } catch (_) { return null; }
}

const usersKey = (set: NSet): string => '|' + [...(set.slots[0] ? set.slots[0].users : []), ...(set.slots[1] ? set.slots[1].users : [])].join('|') + '|';
const slotsJson = (set: NSet): string => JSON.stringify(set.slots.map((s) => (s ? { id: s.id, name: s.name, users: s.users, seed: s.seed } : null)));

/** start.gg / Challonge に送る */
async function perform(p: Provider, set: NSet, d: Decision): Promise<{ ok: true } | { ok: false; note: string }> {
  if (d.op === 'none') return { ok: true };
  if (d.op === 'reset') return p.reset(set);
  if (d.op === 'rereport') {
    const r = await p.reset(set);
    if (!r.ok) return { ok: false, note: 'reset:' + r.note };
    return p.apply({ ...set, complete: false }, d.result as Result, 'report');
  }
  return p.apply(set, d.result as Result, d.op === 'update' ? 'update' : 'report');
}

/**
 * D1 の行を版つきで書いてから start.gg / Challonge に送る (同時に 2 人が送っても 2 回送らない)。
 * decide は最新の行と報告から判定を作る。送るのに失敗したら行を review にして理由を残す。
 */
async function settle(store: Store, p: Provider, code: string, set: NSet, now: number, floorTo: number | null,
  decide: (row: ReportSetRow | null, latest: [Latest | null, Latest | null]) => Decision | { locked: true }): Promise<
  { ok: true; d: Decision } | { ok: false; why: 'busy' | 'locked' | 'provider'; note: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await store.getReportSet(code, set.id);
    const floor = floorTo !== null ? floorTo : row ? row.floor_id : 0;
    const subs = (await store.listReportSubmissions(code, set.id)).filter((s) => (s.id || 0) > floor && s.side >= 0);
    const latest: [Latest | null, Latest | null] = [null, null];
    for (const s of subs) {
      const r = parseApplied(s.result);
      if (r) latest[s.side as Side] = { result: r, ts: s.ts_ms };
    }
    const d = decide(row, latest);
    if ('locked' in d) return { ok: false, why: 'locked', note: 'locked' };
    const applied = d.op === 'reset' ? '' : d.op === 'none' ? (row ? row.applied : '') : JSON.stringify(d.result);
    const next: ReportSetRow = {
      code, set_id: set.id, state: d.state, users: usersKey(set), slots: slotsJson(set), applied, note: d.note,
      floor_id: floor, version: (row ? row.version : 0) + 1, updated_ms: now,
    };
    if (!(await store.casReportSet(next, row ? row.version : null))) continue;
    const r = await perform(p, set, d);
    if (!r.ok) {
      const back: ReportSetRow = { ...next, state: 'review', note: 'error:' + r.note.slice(0, 100), applied: row ? row.applied : '', version: next.version + 1 };
      await store.casReportSet(back, next.version);
      return { ok: false, why: 'provider', note: r.note };
    }
    return { ok: true, d };
  }
  return { ok: false, why: 'busy', note: 'busy' };
}

function providerMessage(kind: string, note: string): string {
  const where = kind === 'challonge' ? 'Challonge' : 'start.gg';
  if (/http_429/.test(note)) return where + ' が混み合っています。少し待ってから送り直してください。';
  return where + ' に結果を送れませんでした。運営に伝えてください (' + note.slice(0, 80) + ')';
}

async function sessionOf(cfg: Config, req: Record<string, unknown>, now: number) {
  return verifySessionToken(cfg, req.token, now);
}

/** action: "report_submit" — 選手が自分の試合の結果を送る */
export async function handleReportSubmit(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  const setId = typeof req.set_id === 'string' || typeof req.set_id === 'number' ? String(req.set_id) : '';
  if (!SET_ID_RE.test(setId)) return err('bad_request', '試合の指定が正しくありません。', 'bad:set_id');
  const act = await store.reportSubmissionActivity(sess.id, now - DAY);
  if ((act.latestMs !== null && now - act.latestMs < REPORT_MIN_INTERVAL_MS) || act.count >= REPORT_MAX_PER_DAY) {
    return err('rate_limited', '送る間隔が短すぎます。少し待ってから送り直してください。', 'rate');
  }
  const o = await openEvent(cfg, store, fetchFn, req.code, now);
  if (!o.ok) return o.res;
  const p = providerOf(fetchFn, o);
  const rs = await p.readSet(setId);
  if (!rs.ok) return rs.code === 'not_found' ? err('not_found', 'この大会にその試合はありません。', rs.note) : err('provider_error', providerMessage(o.ev.kind, rs.note), rs.note);
  const set = rs.set;
  if (!set.slots[0] || !set.slots[1]) return err('not_ready', 'まだ対戦相手が決まっていません。', 'not_ready');
  const side: Side | null = set.slots[0].users.includes(sess.id) ? 0 : set.slots[1].users.includes(sess.id) ? 1 : null;
  if (side === null) return err('not_player', 'この試合の選手だけが報告できます。', 'not_player');
  const gate = playerGate(set, parseSettings(o.ev.settings));
  if (gate === 'classes_only') return err('not_allowed', 'この大会では、下位クラスの試合だけ選手が報告できます。結果は運営に伝えてください。', gate);
  if (gate === 'top_cut') return err('not_allowed', 'この試合 (トップ ' + parseSettings(o.ev.settings).top_cut + ' から) は運営が結果を入力します。結果は運営に伝えてください。', gate);
  const ft = ftOf(set, parseSettings(o.ev.settings));
  const pr = parseResult(req.result, set.totalGames, ft);
  if ('bad' in pr) {
    if (pr.bad === 'score_ft') return err('bad_request', 'この試合は ' + ft + ' 先です。スコアを確かめてください。', 'bad:score_ft');
    return err('bad_request', '結果の形式が正しくありません (' + pr.bad + ')。', 'bad:' + pr.bad);
  }

  const subId = await store.insertReportSubmission({ code: o.ev.code, set_id: setId, user_id: sess.id, side, ts_ms: now, result: JSON.stringify(pr.result), outcome: 'pending' });
  const r = await settle(store, p, o.ev.code, set, now, null, (row, latest) => reconcile(
    row ? { state: row.state as ReportState, applied: parseApplied(row.applied) } : null, latest, set));
  if (!r.ok) {
    await store.setReportSubmissionOutcome(subId, 'error:' + r.note.slice(0, 100));
    if (r.why === 'busy') return err('busy', 'ほかの報告と重なりました。もう一度送ってください。', 'busy');
    return err('provider_error', providerMessage(o.ev.kind, r.note), r.note);
  }
  await store.setReportSubmissionOutcome(subId, r.d.op + (r.d.note ? ':' + r.d.note : ''));
  return ok({ set_id: setId, state: r.d.state, op: r.d.op, note: r.d.note });
}

// ── 選手の画面 ───────────────────────────────────────────────────────

/** action: "report_info" — だれでも */
export async function handleReportInfo(store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || !CODE_RE.test(req.code)) return err('bad_request', '報告ページの URL が正しくありません。', 'bad:code');
  await store.purgeReportTokens(now);
  const ev = await store.getReportEvent(req.code);
  if (!ev) return err('not_found', '報告ページの URL が正しくありません。', 'no_event');
  return ok({ report: publicOf(ev, now) });
}

/** 試合 1 つ分を画面用に (自分と相手の最新の報告つき) */
async function setView(store: Store, row: ReportSetRow, uid: string | null) {
  const subs = (await store.listReportSubmissions(row.code, row.set_id)).filter((s) => (s.id || 0) > row.floor_id);
  const latest: Record<string, { result: Result | null; ts: number; mine: boolean }> = {};
  for (const s of subs) {
    if (s.side < 0) continue;
    latest[String(s.side)] = { result: parseApplied(s.result), ts: s.ts_ms, mine: uid !== null && s.user_id === uid };
  }
  let slots: unknown = [];
  try { slots = JSON.parse(row.slots); } catch (_) { slots = []; }
  return { code: row.code, set_id: row.set_id, state: row.state, note: row.note, applied: parseApplied(row.applied), slots, reports: latest, updated_ms: row.updated_ms };
}

/** Challonge の参加者・試合 (Worker の cache に 15 秒) */
async function challongeData(fetchFn: FetchFn, token: string, tid: string): Promise<{ ok: true; data: CData } | { ok: false; note: string }> {
  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request('https://spsp-report.internal/challonge/' + tid);
  if (cache) {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit) {
      const j = await hit.json() as { p: unknown[]; m: unknown[] };
      const participants = new Map();
      for (const x of j.p) { const q = parseParticipant(x); if (q) participants.set(q.id, q); }
      return { ok: true, data: { participants, matches: j.m.map(parseMatch).filter((x): x is CMatch => !!x) } };
    }
  }
  const r = await readChallonge(fetchFn, token, tid);
  if (r.ok && cache) {
    const p = Array.from(r.data.participants.values()).map((x) => ({ id: x.id, attributes: { name: x.name, misc: x.uid ? 'startgg:' + x.uid : '', seed: x.seed } }));
    const m = r.data.matches.map((x) => ({ id: x.id, attributes: {
      state: x.state, round: x.round, identifier: x.identifier, player1_id: x.p[0], player2_id: x.p[1],
      player1_prereq_match_id: x.prereq[0], player2_prereq_match_id: x.prereq[1],
      player1_is_prereq_match_loser: x.prereqLoser[0], player2_is_prereq_match_loser: x.prereqLoser[1], winner_id: x.winner,
      points_by_participant: Object.entries(x.points).map(([k, v]) => ({ participant_id: k, scores: [v] })), completed_at: x.completedAt,
    } }));
    await cache.put(key, new Response(JSON.stringify({ p, m }), { headers: { 'Cache-Control': 'max-age=' + REPORT_CHALLONGE_CACHE_S } })).catch(() => undefined);
  }
  return r;
}

/** Challonge の自分の試合 (画面用)。start.gg はブラウザが本人のトークンで読む */
function challongeMine(d: CData, uid: string, double: boolean) {
  const me = Array.from(d.participants.values()).find((p) => p.uid === uid) || null;
  if (!me) return { participant: null, matches: [] };
  const view = (m: CMatch) => {
    const set = cSetOf(d, m, double);
    const prereq = m.prereq.map((id, i) => {
      if (!id || set.slots[i]) return null;
      const pm = d.matches.find((x) => x.id === id);
      return pm ? { match_id: id, loser: m.prereqLoser[i], state: pm.state, slots: cSetOf(d, pm).slots } : null;
    });
    return { id: m.id, state: m.state, round: m.round, identifier: m.identifier, slots: set.slots, winner: set.remote ? set.remote.w : null, l_placement: set.lPlacement,
      score: set.remote && set.remote.g.length ? [set.remote.g.filter((g) => g.w === 0).length, set.remote.g.filter((g) => g.w === 1).length] : null, prereq };
  };
  return { participant: me, matches: d.matches.filter((m) => m.p[0] === me.id || m.p[1] === me.id).map(view) };
}

/** action: "report_view" — 自分の試合の報告の状態 (Challonge は試合の一覧も) */
export async function handleReportView(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  const o = await openEvent(cfg, store, fetchFn, req.code, now);
  if (!o.ok) return o.res;
  const rows = await store.listReportSetsForUser(sess.id, [o.ev.code]);
  const sets = [];
  for (const r of rows) sets.push(await setView(store, r, sess.id));
  const out: Record<string, unknown> = { report: publicOf(o.ev, now), me: { id: sess.id }, admin: admins(o.ev).includes(sess.id), sets };
  if (o.ev.kind === 'challonge') {
    const d = await challongeData(fetchFn, o.token, o.ev.target_id);
    out.challonge = d.ok ? challongeMine(d.data, sess.id, parseSettings(o.ev.settings).double === true) : { error: d.note };
  }
  return ok(out);
}

/** action: "report_notices" — 受付中の大会 (だれでも) と、ログイン中なら自分の試合の食い違い・運営確認 */
export async function handleReportNotices(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  await store.purgeReportTokens(now);
  const events = await store.listActiveReportEvents(now);
  const sess = req.token ? await sessionOf(cfg, req, now) : null;
  const mine = [];
  if (sess) {
    for (const r of await store.listReportSetsForUser(sess.id, events.map((e) => e.code))) {
      if (r.state === 'conflict' || r.state === 'review') mine.push(await setView(store, r, sess.id));
    }
  }
  return ok({ events, mine });
}

// ── 運営の画面 ───────────────────────────────────────────────────────

async function adminOpen(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<Opened & { uid?: string }> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return { ok: false, res: err('auth_failed', MSG_LOGIN, 'session') };
  const o = await openEvent(cfg, store, fetchFn, req.code, now);
  if (!o.ok) return o;
  if (!admins(o.ev).includes(sess.id)) return { ok: false, res: err('not_admin', 'この受付を始めた運営だけが使えます。運営の方は受付をし直すと使えるようになります。', 'not_admin') };
  return { ...o, uid: sess.id };
}

/** action: "report_admin" — 試合ごとの状態と両者の報告 */
export async function handleReportAdmin(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  const sets = [];
  for (const r of await store.listReportSets(o.ev.code)) sets.push(await setView(store, r, null));
  return ok({ report: publicOf(o.ev, now), sets });
}

/** action: "report_phases" — 何先の設定に使うフェーズとラウンド */
export async function handleReportPhases(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  const r = await providerOf(fetchFn, o).phases();
  if (!r.ok) return err('provider_error', providerMessage(o.ev.kind, r.note), r.note);
  return ok({ phases: r.phases });
}

/** action: "report_admin_fix" — 運営が直す ({ result }) か取り消す ({ reset: true })。次の試合に結果が出るまで */
export async function handleReportAdminFix(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  const uid = o.uid as string;
  const setId = typeof req.set_id === 'string' || typeof req.set_id === 'number' ? String(req.set_id) : '';
  if (!SET_ID_RE.test(setId)) return err('bad_request', '試合の指定が正しくありません。', 'bad:set_id');
  const act = await store.reportSubmissionActivity(uid, now - DAY);
  if (act.count >= REPORT_ADMIN_MAX_PER_DAY) return err('rate_limited', '今日はこれ以上直せません。', 'rate');
  const p = providerOf(fetchFn, o);
  const rs = await p.readSet(setId);
  if (!rs.ok) return rs.code === 'not_found' ? err('not_found', 'この大会にその試合はありません。', rs.note) : err('provider_error', providerMessage(o.ev.kind, rs.note), rs.note);
  const set = rs.set;
  if (!set.slots[0] || !set.slots[1]) return err('not_ready', 'まだ対戦相手が決まっていません。', 'not_ready');
  const kind = req.reset === true ? 'reset' : 'fix';
  let result: Result | null = null;
  if (kind === 'fix') {
    const pr = parseResult(req.result, set.totalGames);
    if ('bad' in pr) return err('bad_request', '結果の形式が正しくありません (' + pr.bad + ')。', 'bad:' + pr.bad);
    result = pr.result;
  }
  const subId = await store.insertReportSubmission({ code: o.ev.code, set_id: setId, user_id: uid, side: -1, ts_ms: now, result: result ? JSON.stringify(result) : '', outcome: 'pending' });
  const r = await settle(store, p, o.ev.code, set, now, subId, (row) => adminDecision(kind, result, set, row ? parseApplied(row.applied) : null));
  if (!r.ok) {
    await store.setReportSubmissionOutcome(subId, 'error:' + r.note.slice(0, 100));
    if (r.why === 'locked') return err('locked', '次の試合の結果が入っているため、ここでは直せません。start.gg / Challonge で直してください。', 'locked');
    if (r.why === 'busy') return err('busy', 'ほかの報告と重なりました。もう一度やり直してください。', 'busy');
    return err('provider_error', providerMessage(o.ev.kind, r.note), r.note);
  }
  await store.setReportSubmissionOutcome(subId, 'admin_' + kind + ':' + r.d.op);
  return ok({ set_id: setId, state: r.d.state, op: r.d.op });
}

/** action: "report_stop" — 受付を止めてトークンを消す */
export async function handleReportStop(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (typeof req.code !== 'string' || !CODE_RE.test(req.code)) return err('bad_request', '報告ページの URL が正しくありません。', 'bad:code');
  const ev = await store.getReportEvent(req.code);
  if (!ev) return err('not_found', '報告ページの URL が正しくありません。', 'no_event');
  if (!admins(ev).includes(sess.id)) return err('not_admin', 'この受付を始めた運営だけが止められます。', 'not_admin');
  await store.stopReportEvent(ev.code);
  return ok({ code: ev.code });
}

/** action: "report_settings" — 運営の設定を変える { token, code, settings: { top_cut, classes_only } } */
export async function handleReportSettings(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (typeof req.code !== 'string' || !CODE_RE.test(req.code)) return err('bad_request', '報告ページの URL が正しくありません。', 'bad:code');
  const ev = await store.getReportEvent(req.code);
  if (!ev) return err('not_found', '報告ページの URL が正しくありません。', 'no_event');
  if (!admins(ev).includes(sess.id)) return err('not_admin', 'この受付を始めた運営だけが変えられます。', 'not_admin');
  const old = parseSettings(ev.settings);
  const next = { ...parseSettings(req.settings), ...(old.double ? { double: true } : {}) };
  if (ev.kind === 'challonge') next.classes_only = false;
  await store.updateReportEventSettings(ev.code, JSON.stringify(next));
  return ok({ settings: next });
}
