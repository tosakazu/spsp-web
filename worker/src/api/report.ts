/**
 * 選手による試合結果の報告 (docs/self_report_design.md)。
 *
 * 運営:
 *   action: "report_begin"        { nonce, returnPath }  → { url }  (scope REPORTER_SCOPE の認可画面。state は f='reporter')
 *   action: "report_login"        { code, state }  → { token, user, exp }  運営のログイン (先にする、2026-10-30)。
 *                                 運営のトークン (access + refresh) を暗号化して report_grants に置き (受付を始めるまで、REPORT_GRANT_MS)、普段のログインのセッションを返す
 *   action: "report_tournaments"  { token }  → { tournaments }  ログインした運営が管理している大会とイベント (受付中の受付の code つき)
 *   action: "report_enable"       { token, event, settings? }  → { report }
 *                                 event = start.gg のイベントの slug (tournament/x/event/y) か ID。運営か確かめて受付を始め、
 *                                 report_grants のトークンをそのイベントの受付 (report_events) に写す
 *   action: "report_enable_class" { startgg_token, challonge_token, challonge_exp, class_id } → { report }
 *                                 下位クラス (Challonge) の受付。作った本人か本戦の運営だけ
 *   action: "report_admin"        { token, code }  → { report, sets }  運営 (受付を始めた人) だけ
 *   action: "report_phases"       { token, code } | { token, event }  → { phases }  何先の設定に使うフェーズとラウンド (運営だけ。event は受付の前)
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
  REPORT_GRANT_MS, REPORT_MIN_OPEN_MS,
} from '../config.ts';
import type { ReportEventRow, ReportManualRow, ReportSetRow, Store } from '../store.ts';
import { checkStartggAdmin, startggCurrentUser, startggGql } from './class_bracket.ts';
import { challongeApi } from './challonge.ts';
import { handleManagerBegin, logLogin } from './login.ts';
import type { FetchFn } from './oauth.ts';
import { exchangeCodeForToken, fetchCurrentUser, oauthErrorMessage, refreshAccessToken } from './oauth.ts';
import { openJson, sealJson } from './report_crypto.ts';
import type { CData, CMatch } from './report_challonge.ts';
import { cSetOf, challongeProvider, parseMatch, parseParticipant, readChallonge } from './report_challonge.ts';
import type { Decision, Latest, NSet, ReportState, Result, Side } from './report_logic.ts';
import { managersOf, MANAGERS_MAX } from './report_logic.ts';
import type { ManagerRole, ReportManager } from './report_logic.ts';
import { adminDecision, applyDelayMs, ftOf, mergeResults, parsePreset, parseResult, parseSettings, playerGate, presetName, PRESETS_MAX, reconcile } from './report_logic.ts';
import type { Provider } from './report_startgg.ts';
import { EVENT_QUERY, startggProvider } from './report_startgg.ts';
import { notifyReport, notifyTest, PUSH_SUBS_PER_USER } from './report_notify.ts';
import type { Held, Snapshot } from './report_outage.ts';
import {
  advanceSnapshot, bracketCandidates, candidateFor, emptySnapshot, flipResult, guardProvider, Health, heldResult, isManualId, isOutageNote, isQueuedRow,
  manualNSet, manualSlots, manualView, offlineDecision, parseSnapshot, PROBE_GAP_MS, SNAP_FIRST_MIN_MS, SNAP_MIN_MS, snapMine, snapNSet, snapshotJson,
} from './report_outage.ts';
import { validSub } from './webpush.ts';
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
/** start.gg / Challonge の試合か、障害中に運営が指定した試合 (m<id>) */
const anySetId = (s: string): boolean => SET_ID_RE.test(s) || isManualId(s);

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

/** その人の役割: admin = 運営 (受付を始めた・加わった start.gg の運営と、結果と設定の管理者) / manager = 報告管理者 (結果だけ) / null = どちらでもない */
export function roleOf(ev: ReportEventRow, uid: string): 'admin' | 'manager' | null {
  if (admins(ev).includes(uid)) return 'admin';
  const m = managersOf(ev).find((x) => x.id === uid);
  return m ? (m.role === 'full' ? 'admin' : 'manager') : null;
}
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

const MSG_GRANT = '運営のログインが切れています。もう一度 start.gg でログインしてください。';

/** action: "report_login" — 認可コードを運営のトークンに換えて預かる (受付を始めるまで)。普段のログインのセッションも返す */
export async function handleReportLogin(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || !req.code || req.code.length > 1024) return err('bad_request', '認証コードがありません。');
  const st = await checkStateToken(cfg, store, req.state, true, now);
  if ('reason' in st) return err('state_invalid', MSG_STATE, st.reason);
  if (st.payload.f !== 'reporter') return err('state_invalid', MSG_STATE, 'wrong_flow');
  const ex = await exchangeCodeForToken(cfg, req.code, fetchFn, REPORTER_SCOPE);
  if (!ex.token) return err('auth_failed', oauthErrorMessage(ex.reason), ex.reason || '');
  const user = await fetchCurrentUser(ex.token, fetchFn);
  if (!user) return err('auth_failed', oauthErrorMessage('no_user'), 'no_user');
  const sealed: Sealed = { at: ex.token, rt: ex.refreshToken ?? null, exp: now + (ex.expiresIn ? ex.expiresIn * 1000 : DAY) };
  await store.purgeReportTokens(now);
  await store.putReportGrant({ user_id: user.id, token_enc: await sealJson(cfg, sealed), token_exp_ms: sealed.exp, expires_ms: now + REPORT_GRANT_MS });
  const token = await issueSessionToken(cfg, user, now);
  const sess = await verifySessionToken(cfg, token, now);
  await logLogin(store, user.id, 'reporter', now);
  return ok({ token, user: { id: user.id, slug: user.slug, gamerTag: user.gamerTag }, exp: sess ? sess.exp : null });
}

/** 預かっている運営のトークン (切れそうなら更新して置き直す) */
async function grantOf(cfg: Config, store: Store, fetchFn: FetchFn, uid: string, now: number): Promise<Sealed | null> {
  const g = await store.getReportGrant(uid, now);
  if (!g) return null;
  const s = await openJson<Sealed>(cfg, g.token_enc);
  if (!s || !s.at) return null;
  if (s.exp - now >= 10 * 60 * 1000) return s;
  if (!s.rt) return null;
  const r = await refreshAccessToken(cfg, s.rt, fetchFn, REPORTER_SCOPE);
  if (!r.token) return null;
  const next: Sealed = { at: r.token, rt: r.refreshToken || s.rt, exp: now + (r.expiresIn ? r.expiresIn * 1000 : DAY) };
  await store.putReportGrant({ ...g, token_enc: await sealJson(cfg, next), token_exp_ms: next.exp });
  return next;
}

const TOURS_QUERY = `query SpspReportTours($page: Int!) {
  currentUser { tournaments(query: { page: $page, perPage: 50, filter: { tournamentView: "admin" } }) {
    nodes { id name slug startAt endAt events { id name slug startAt numEntrants videogame { id } } } } }
}`;
/** 一覧に出す大会: 開催中 (前後半日) → これから (近い順) → 終わった (新しい順、2 日まで)。最大 30 */
export function sortTournaments<T extends { startAt: number | null; endAt: number | null }>(list: T[], nowSec: number): (T & { live: boolean })[] {
  const H = 12 * 3600;
  const rank = (t: T): [number, number] => {
    const st = t.startAt || 0; const en = t.endAt || st;
    if (st <= nowSec + H && en >= nowSec - H) return [0, -st];
    if (st > nowSec) return [1, st];
    return [2, -en];
  };
  return list.filter((t) => rank(t)[0] < 2 || (t.endAt || t.startAt || 0) >= nowSec - 2 * 86400)
    .map((t) => ({ t, k: rank(t) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]).slice(0, 30).map((x) => ({ ...x.t, live: x.k[0] === 0 }));
}

/** action: "report_tournaments" — 運営が管理している大会とイベント */
export async function handleReportTournaments(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  await store.purgeReportTokens(now);
  const g = await grantOf(cfg, store, fetchFn, sess.id, now);
  if (!g) return err('no_grant', MSG_GRANT, 'no_grant');
  type T = { id: number; name: string; slug: string; startAt: number | null; endAt: number | null; events: { id: number; name: string; slug: string; startAt: number | null; entrants: number | null; game: number | null }[] };
  const all: T[] = [];
  for (let page = 1; page <= 4; page++) {
    const r = await startggGql(fetchFn, g.at, TOURS_QUERY, { page });
    if (!r.ok) return err('startgg_error', 'start.gg に確認できませんでした。時間をおいてやり直してください。', 'tours:' + r.note);
    const cu = r.json.data && (r.json.data.currentUser as { tournaments?: { nodes?: unknown[] } | null } | null);
    const nodes = cu && cu.tournaments && Array.isArray(cu.tournaments.nodes) ? cu.tournaments.nodes as Record<string, unknown>[] : [];
    for (const n of nodes) {
      if (!n || n.id === undefined) continue;
      const evs = Array.isArray(n.events) ? n.events as Record<string, unknown>[] : [];
      all.push({
        id: Number(n.id), name: String(n.name || ''), slug: String(n.slug || ''), startAt: Number(n.startAt) || null, endAt: Number(n.endAt) || null,
        events: evs.filter((e) => e && e.id !== undefined).map((e) => ({
          id: Number(e.id), name: String(e.name || ''), slug: String(e.slug || ''), startAt: Number(e.startAt) || null, entrants: Number.isFinite(Number(e.numEntrants)) ? Number(e.numEntrants) : null,
          game: e.videogame && (e.videogame as { id?: unknown }).id !== undefined ? Number((e.videogame as { id: unknown }).id) : null,
        })),
      });
    }
    if (nodes.length < 50) break;
  }
  const active = await store.listActiveReportEvents(now);
  const codeOf = new Map(active.filter((a) => a.kind === 'startgg' && a.event_id !== null).map((a) => [Number(a.event_id), a.code]));
  const tournaments = sortTournaments(all, Math.floor(now / 1000)).map((t) => ({
    ...t, events: t.events.map((e) => ({ ...e, code: codeOf.get(e.id) || null })),
  }));
  return ok({ tournaments });
}

/** action: "report_enable" — ログインした運営のトークンで、運営か確かめて受付を始める */
export async function handleReportEnable(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  const vars = eventVars(req.event);
  if (!vars) return err('bad_request', 'start.gg のイベントの URL を確かめてください。', 'bad:event');
  await store.purgeReportTokens(now);
  const g = await grantOf(cfg, store, fetchFn, sess.id, now);
  if (!g) return err('no_grant', MSG_GRANT, 'no_grant');
  const ex = { token: g.at };
  const user = { id: sess.id };

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
  if (adm.userId !== sess.id) return err('not_admin', 'ログイン中のアカウントと運営のログインが違います。もう一度 start.gg でログインしてください。', 'user_mismatch');
  const sealed: Sealed = g;
  const old = await store.getReportEventByTarget('startgg', String(eventId));
  const row: ReportEventRow = {
    code: old ? old.code : newReportCode(), kind: 'startgg', target_id: String(eventId), event_id: eventId, tournament_id: adm.tournamentId, class_id: null,
    name, slug: typeof evRaw.slug === 'string' ? evRaw.slug : '', admins: addAdmin(old ? old.admins : '', user.id),
    token_enc: await sealJson(cfg, sealed), token_exp_ms: sealed.exp, status: 'active', created_ms: old ? old.created_ms : now,
    expires_ms: reportExpiry(Number(t.endAt) || null, now, cfg.tsOffsetMin),
    // 受付中 (ほかの運営が始めた等) なら設定は今のまま (同じ受付に運営として加わるだけ。設定・試合の状態は共有)
    settings: old && old.status === 'active' && old.token_enc && old.expires_ms >= now ? old.settings
      : JSON.stringify(req.settings !== undefined ? parseSettings(req.settings) : parseSettings(old ? old.settings : '{}')),
  };
  const joined = !!(old && old.status === 'active' && old.token_enc && old.expires_ms >= now);
  await store.upsertReportEvent(row);
  const saved = (await store.getReportEventByTarget('startgg', String(eventId))) || row;
  return ok({ report: publicOf(saved, now), joined });
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
    // start.gg に繋がらないだけなら受付は閉じない (報告は D1 に残し、復旧後に延長して送る。2026-11-04)
    if (!r.token && (r.reason === 'network' || r.reason === 'startgg_down')) return { ok: true, ev, token: s.at };
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

/** 送っている最中の行の印 (note)。これが付いている間はほかの報告は待つ。古すぎる印 (Worker が途中で落ちた等) は無視する */
const SENDING = 'sending';
const SENDING_STALE_MS = 60 * 1000;
const SENDING_WAIT_MS = 400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * D1 の行を版つきで書いてから start.gg / Challonge に送る (同時に 2 人が送っても 2 回送らない)。
 * decide は最新の行・報告・start.gg の set から判定を作る。送るのに失敗したら行を review にして理由を残す。
 *
 * 順番 (2 人がほぼ同時に送ったとき、古い set で判定しないように):
 *   行を読む → (送っている最中なら待つ) → set を読む → 行が変わっていなければ判定して、行の版を確かめて書く (印つき) → 送る → 印を外す
 * first は呼ぶ側が先に読んだ set、seenVersion はそれを読む前の行の版 (行が無ければ null)。行がその後に変わっていたら set を読み直す。
 */
async function settle(store: Store, p: Provider, code: string, first: NSet, seenVersion: number | null, now: number, floorTo: number | null,
  decide: (row: ReportSetRow | null, latest: [Latest | null, Latest | null], set: NSet) => Decision | { locked: true }, queuedNote = 'outage'): Promise<
  { ok: true; d: Decision } | { ok: false; why: 'busy' | 'locked' | 'provider'; note: string }> {
  let set = first;
  let seen = seenVersion;
  for (let attempt = 0; attempt < 10; attempt++) {
    const row = await store.getReportSet(code, set.id);
    if (row && row.note === SENDING && now - row.updated_ms < SENDING_STALE_MS) { await sleep(SENDING_WAIT_MS); continue; }   // ほかの報告が送っている最中
    const ver = row ? row.version : null;
    if (ver !== seen) {   // set を読んだ後に行が変わった (ほかの報告が送り終えた等) → set を読み直してからもう一度
      const rs = await p.readSet(set.id);
      if (!rs.ok) return { ok: false, why: 'provider', note: rs.note };
      set = rs.set;
      seen = ver;
      continue;
    }
    const floor = floorTo !== null ? floorTo : row ? row.floor_id : 0;
    const subs = (await store.listReportSubmissions(code, set.id)).filter((s) => (s.id || 0) > floor && s.side >= 0);
    const latest: [Latest | null, Latest | null] = [null, null];
    for (const s of subs) {
      const r = parseApplied(s.result);
      if (r) latest[s.side as Side] = { result: r, ts: s.ts_ms };
    }
    const d = decide(row, latest, set);
    if ('locked' in d) return { ok: false, why: 'locked', note: 'locked' };
    const applied = d.op === 'reset' ? '' : d.op === 'none' ? (row ? row.applied : '') : JSON.stringify(d.result);
    const done: ReportSetRow = {
      code, set_id: set.id, state: d.state, users: usersKey(set), slots: slotsJson(set), applied, note: d.note,
      floor_id: floor, version: (row ? row.version : 0) + 1, updated_ms: now,
    };
    if (d.op === 'none') {   // 送らない: そのまま書く
      if (!(await store.casReportSet(done, ver))) { seen = -1; continue; }
      return { ok: true, d };
    }
    const sending: ReportSetRow = { ...done, note: SENDING };
    if (!(await store.casReportSet(sending, ver))) { seen = -1; continue; }   // 先を越された → 読み直し
    const r = await perform(p, set, d);
    if (!r.ok) {
      // 繋がらなかった: 取り込み待ち (queued) にして復旧後に送り直す。それ以外の失敗は運営の確認
      const back: ReportSetRow = isOutageNote(r.note)
        ? { ...done, state: 'queued', note: queuedNote, applied: row ? row.applied : '', version: done.version + 1 }
        : { ...done, state: 'review', note: 'error:' + r.note.slice(0, 100), applied: row ? row.applied : '', version: done.version + 1 };
      await store.casReportSet(back, done.version);
      return { ok: false, why: 'provider', note: r.note };
    }
    await store.casReportSet({ ...done, version: done.version + 1 }, done.version);   // 印を外す
    return { ok: true, d };
  }
  return { ok: false, why: 'busy', note: 'busy' };
}

const prevOf = (row: ReportSetRow | null) => (row ? { state: row.state as ReportState, applied: parseApplied(row.applied), note: row.note } : null);

/**
 * 取り込み待ち (pending) の試合を、今の取り込み方でもう一度判定する (5 分待ちの期限が来た・運営が取り込み方を変えた)。
 * 定時の処理は無いので、選手・運営の画面が読みに来たとき (report_view / report_admin) と報告のときに呼ぶ。1 回に max 件まで
 */
export async function flushPending(store: Store, p: Provider, ev: ReportEventRow, now: number, max = 3): Promise<number> {
  const mode = parseSettings(ev.settings).apply || 'auto';
  if (mode === 'both' || mode === 'approve') return 0;   // 待つ理由が時間ではない (報告・承認で動く)
  const due = (await store.listReportSets(ev.code)).filter((r) => r.state === 'pending'
    && (mode === 'auto' || (r.note === 'wait_delay' && now - r.updated_ms >= applyDelayMs(mode)) || r.note !== 'wait_delay'));
  let n = 0;
  for (const row of due.slice(0, max)) {
    const rs = await p.readSet(row.set_id);
    if (!rs.ok) continue;
    const r = await settle(store, p, ev.code, rs.set, row.version, now, null, (cur, latest, set) => reconcile(prevOf(cur), latest, set, mode, now));
    if (r.ok && r.d.op !== 'none') n++;
  }
  return n;
}

// ── start.gg に繋がらないとき (report_outage.ts、docs §11) ─────────────────

/** 行の状態だけ書き直す (送らない) */
async function markRow(store: Store, row: ReportSetRow, state: string, note: string, now: number): Promise<boolean> {
  return store.casReportSet({ ...row, state, note, version: row.version + 1, updated_ms: now }, row.version);
}

/**
 * start.gg に送れないときに報告を D1 に残す (状態 queued。復旧後に flushQueued が送る)。
 * force = 運営の直し・取り消し・止める (その状態で書く)、floor = 運営の操作の報告 ID (それより前の選手の報告は数えない)
 */
async function queueOffline(store: Store, code: string, set: NSet, now: number, opts: { manual?: boolean; force?: { state: string; note: string }; floor?: number } = {}):
  Promise<{ state: string; note: string } | null> {
  for (let i = 0; i < 6; i++) {
    const row = await store.getReportSet(code, set.id);
    const floor = opts.floor !== undefined ? opts.floor : row ? row.floor_id : 0;
    const latest: [Result | null, Result | null] = [null, null];
    for (const s of await store.listReportSubmissions(code, set.id)) {
      if ((s.id || 0) > floor && (s.side === 0 || s.side === 1)) latest[s.side as Side] = parseApplied(s.result);
    }
    const d = opts.force || offlineDecision(row ? { state: row.state, note: row.note } : null, latest, !!opts.manual);
    const next: ReportSetRow = {
      code, set_id: set.id, state: d.state, users: usersKey(set), slots: slotsJson(set), applied: row ? row.applied : '', note: d.note,
      floor_id: floor, version: (row ? row.version : 0) + 1, updated_ms: now,
    };
    if (await store.casReportSet(next, row ? row.version : null)) return d;
  }
  return null;
}

/** D1 の行から判定用の試合を作る (障害中に写しにも無いとき。両者は分かるが、ラウンド・次の試合は分からない) */
function rowNSet(row: ReportSetRow): NSet | null {
  let v: unknown = [];
  try { v = JSON.parse(row.slots); } catch (_) { v = []; }
  const a = Array.isArray(v) ? v as { id?: unknown; name?: unknown; users?: unknown; seed?: unknown }[] : [];
  const sl = (x: typeof a[number] | undefined) => (x && x.id !== undefined && x.id !== null
    ? { id: String(x.id), name: String(x.name || ''), users: Array.isArray(x.users) ? x.users.map(String) : [], seed: Number(x.seed) || null } : null);
  const slots: [ReturnType<typeof sl>, ReturnType<typeof sl>] = [sl(a[0]), sl(a[1])];
  if (!slots[0] || !slots[1]) return null;
  const applied = parseApplied(row.applied);
  return { id: row.set_id, complete: !!applied, slots, remote: applied ? { w: applied.w, g: [] } : null, totalGames: null, downstreamDone: false,
    lPlacement: null, isClass: false, round: null };
}

async function loadSnap(store: Store, code: string): Promise<{ snap: Snapshot | null; syncedMs: number }> {
  const r = await store.getReportSnapshot(code).catch(() => null);
  return r ? { snap: parseSnapshot(r.data), syncedMs: r.synced_ms } : { snap: null, syncedMs: 0 };
}

/** 指定した試合を見つけた start.gg の試合に移す (報告は側を合わせて付け替え、行は start.gg の試合の行に) */
async function linkManual(store: Store, code: string, m: ReportManualRow, found: { id: string; flip: boolean }, now: number): Promise<void> {
  const mid = 'm' + m.id;
  for (const s of await store.listReportSubmissions(code, mid)) {
    const r = parseApplied(s.result);
    const side = s.side < 0 || !found.flip ? s.side : 1 - s.side;
    await store.updateReportSubmission(s.id as number, found.id, side, found.flip && r ? JSON.stringify(flipResult(r)) : s.result);
  }
  const mrow = await store.getReportSet(code, mid);
  if (mrow) {
    const sl = manualSlots(m);
    const slots = found.flip ? [sl[1], sl[0]] : sl;
    const note = mrow.note === 'outage_admin' || mrow.note === 'outage_reset' || mrow.note === 'hold' ? mrow.note : mrow.state === 'reset' ? mrow.note : 'outage';
    const real = await store.getReportSet(code, found.id);
    const next: ReportSetRow = { ...mrow, set_id: found.id, slots: JSON.stringify(slots), note, version: (real ? real.version : 0) + 1, updated_ms: now,
      floor_id: real ? Math.max(real.floor_id, mrow.floor_id) : mrow.floor_id };
    await store.casReportSet(next, real ? real.version : null);
    await store.deleteReportSet(code, mid);
  }
  await store.updateReportManual(code, m.id as number, 'matched', found.id, now);
}

/** 1 回に送り直す試合の数 (1 つで start.gg を 2〜5 回呼ぶ) */
const FLUSH_OPS = 4;
/** 指定した試合を start.gg で探し直す間隔 (見つからないあいだ) */
const MANUAL_RECHECK_MS = 60 * 1000;

/**
 * 取り込み待ち (queued) の試合を start.gg に送る (復旧後)。古い報告から順に。運営が指定した試合は、同じ 2 人の結果の無い試合が
 * start.gg に出ていれば (前の試合の結果を送ったあと) そちらに移して送る。繋がらなければそこでやめる。
 */
async function flushQueued(store: Store, p: Provider, ev: ReportEventRow, now: number, rows: ReportSetRow[], manualOpen: ReportManualRow[]): Promise<number> {
  const mode = parseSettings(ev.settings).apply || 'auto';
  let ops = 0;
  const real = rows.filter((r) => isQueuedRow(r) && !isManualId(r.set_id)).sort((a, b) => a.updated_ms - b.updated_ms);
  for (const row of real) {
    if (ops >= FLUSH_OPS) return ops;
    const rs = await p.readSet(row.set_id);
    if (!rs.ok) {
      if (isOutageNote(rs.note)) return ops;
      // 繋がるのに読めない (試合が消えた等): 運営の確認にする (毎回読み直さない)
      await markRow(store, row, 'review', rs.code === 'not_found' ? 'error:set_not_found' : 'error:' + rs.note.slice(0, 80), now);
      continue;
    }
    ops++;
    let adminRes: Result | null = null;
    if (row.note === 'outage_admin') {
      const sub = (await store.listReportSubmissions(ev.code, row.set_id)).find((s) => s.id === row.floor_id && s.side < 0);
      adminRes = sub ? parseApplied(sub.result) : null;
    }
    const qn = row.note === 'outage_admin' || row.note === 'outage_reset' ? row.note : 'outage';
    const r = await settle(store, p, ev.code, rs.set, row.version, now, null, (cur, latest, set): Decision => {
      const note = cur ? cur.note : '';
      if (note === 'outage_admin' || note === 'outage_reset') {
        if (note === 'outage_admin' && !adminRes) return { op: 'none', state: 'review', result: null, note: 'error:no_admin_result' };
        const d = adminDecision(note === 'outage_admin' ? 'fix' : 'reset', adminRes, set, cur ? parseApplied(cur.applied) : null);
        return 'locked' in d ? { op: 'none', state: 'review', result: null, note: 'locked_change' } : d;
      }
      // queued は「まだ送っていない報告がある」だけ。判定は 1 人目の報告と同じ
      const pv = prevOf(cur);
      if (pv && pv.state === 'queued') pv.state = 'reported';
      return reconcile(pv, latest, set, mode, now);
    }, qn);
    if (!r.ok && r.why === 'provider' && isOutageNote(r.note)) return ops;
  }
  if (!p.findSet) return ops;
  for (const m of manualOpen.slice().sort((a, b) => (a.id || 0) - (b.id || 0))) {
    if (ops >= FLUSH_OPS) break;
    if (now - m.updated_ms < MANUAL_RECHECK_MS && m.updated_ms !== m.created_ms) continue;
    const sl = manualSlots(m);
    if (!sl[0] || !sl[1]) continue;
    ops++;
    const f = await p.findSet([sl[0].id, sl[1].id], m.side === 'l' ? 'l' : 'w');
    if (!f.ok) { if (isOutageNote(f.note)) return ops; continue; }
    if (!f.found) {
      // 前の試合の結果がまだ start.gg に無い (SPSP の外で報告待ち等)。運営の画面に出す
      const mrow = await store.getReportSet(ev.code, 'm' + m.id);
      if (mrow && mrow.note === 'manual') await markRow(store, mrow, mrow.state, 'manual_wait', now);
      await store.updateReportManual(ev.code, m.id as number, 'open', '', now);
      continue;
    }
    await linkManual(store, ev.code, m, f.found, now);
  }
  return ops;
}

/**
 * 選手・運営の画面が読みに来たときの後始末 (定時の処理は無い): 取り込み待ちを送り直し、ブラケットの写しを進める。
 * 何もすることが無ければ D1 に書かない。障害中は試す番 (PROBE_GAP_MS ごと) まで何もしない。同時に 2 つは動かさない (report_snapshots.lock_ms)
 */
async function maintain(store: Store, fetchFn: FetchFn, o: { ev: ReportEventRow; token: string }, p: Provider, health: Health, now: number):
  Promise<{ snap: Snapshot | null; syncedMs: number }> {
  const ev = o.ev;
  const loaded = ev.kind === 'startgg' ? await loadSnap(store, ev.code) : { snap: null, syncedMs: 0 };
  const rows = await store.listReportSets(ev.code);
  const manualOpen = ev.kind === 'startgg' ? (await store.listReportManual(ev.code)).filter((m) => m.status === 'open') : [];
  const queued = rows.some(isQueuedRow) || manualOpen.some((m) => m.updated_ms === m.created_ms || now - m.updated_ms >= MANUAL_RECHECK_MS);
  const snapDue = ev.kind === 'startgg' && now - loaded.syncedMs >= (loaded.snap && loaded.snap.full ? SNAP_MIN_MS : SNAP_FIRST_MIN_MS);
  if (!queued && !snapDue) return loaded;
  if (health.down() && now - health.row.last_fail_ms < PROBE_GAP_MS) return loaded;
  if (!(await store.claimReportSnapshot(ev.code, now, 25 * 1000).catch(() => false))) return loaded;
  let wrote = false;
  let out = loaded;
  try {
    if (queued) await flushQueued(store, p, ev, now, rows, manualOpen);
    if (snapDue) {
      const snap = loaded.snap || emptySnapshot();
      const e = await advanceSnapshot(fetchFn, o.token, ev.target_id, snap, () => health.allowed(now));
      if (e && e !== 'outage_skip' && isOutageNote(e)) await health.fail(e, now);
      else if (!e) await health.ok(now);
      const js = snapshotJson(snap);
      // 繋がらなかったときは写した時刻を進めない (次に試せる番ですぐ続きを読む)。それ以外の失敗は進める (毎回呼ばない)
      const synced = e && isOutageNote(e) ? loaded.syncedMs : now;
      if (js) { await store.putReportSnapshot(ev.code, js, synced); wrote = true; out = { snap, syncedMs: synced }; }
    }
  } finally {
    if (!wrote) await store.releaseReportSnapshot(ev.code).catch(() => undefined);
  }
  return out;
}

/** SPSP で持っている (start.gg に無い) 結果の負け (候補の絞り込み) */
async function heldList(store: Store, code: string, snap: Snapshot, manual: ReportManualRow[]): Promise<Held[]> {
  const out: Held[] = [];
  const byId = new Map(manual.map((m) => ['m' + m.id, m]));
  for (const r of await store.listReportSets(code)) {
    // 送ったが写しにまだ出ていない結果 (写すのは 45 秒ごと) も数える
    const sentNotSeen = !!r.applied && !!snap.sets[r.set_id] && snap.sets[r.set_id].s !== 3 && ['reported', 'agreed', 'fixed'].includes(r.state);
    if (!(isQueuedRow(r) || r.state === 'pending' || sentNotSeen)) continue;
    const res = sentNotSeen ? parseApplied(r.applied) : heldResult(r, await store.listReportSubmissions(code, r.set_id));
    if (!res) continue;
    let slots: ({ id?: unknown } | null)[] = [];
    try { slots = JSON.parse(r.slots); } catch (_) { slots = []; }
    const loser = slots[1 - res.w];
    if (!loser || loser.id === undefined) continue;
    const m = byId.get(r.set_id);
    const s = snap.sets[r.set_id];
    const side = m ? (m.side === 'l' ? 'l' : 'w') : s && s.r !== null ? (s.r > 0 ? 'w' : s.r < 0 ? 'l' : null) : null;
    out.push({ group: m ? m.group_id : s ? s.g : '', side, loser: String(loser.id) });
  }
  return out;
}

function providerMessage(kind: string, note: string): string {
  const where = kind === 'challonge' ? 'Challonge' : 'start.gg';
  if (/http_429/.test(note)) return where + ' が混み合っています。少し待ってから送り直してください。';
  return where + ' に結果を送れませんでした。運営に伝えてください (' + note.slice(0, 80) + ')';
}

async function sessionOf(cfg: Config, req: Record<string, unknown>, now: number) {
  return verifySessionToken(cfg, req.token, now);
}

const MSG_OUTAGE_NOSET = 'start.gg に接続できず、この試合を確かめられませんでした。結果は運営に伝えてください。';

/**
 * 報告・運営の直しの対象の試合。start.gg から読めなければ (障害中) 写し → D1 の行の順に代わりを使う (offline)。
 * 運営が指定した試合 (m<id>) は、start.gg の試合が見つかっていればそちら、まだなら指定した 2 人 (offline)。
 * before = 試合を読む前の行 (settle が、読んだ後に変わったかを見る)
 */
async function setForReport(store: Store, p: Provider, ev: ReportEventRow, setId0: string):
  Promise<{ set: NSet; offline: boolean; manual: boolean; before: ReportSetRow | null } | { res: HandlerResult }> {
  let setId = setId0;
  if (isManualId(setId)) {
    const m = await store.getReportManual(ev.code, Number(setId.slice(1)));
    if (!m) return { res: err('not_found', 'この大会にその試合はありません。', 'no_manual') };
    if (m.status === 'cancelled') return { res: err('not_found', '運営がこの試合の指定を取り消しました。画面を読み直してください。', 'manual_cancelled') };
    if (m.status === 'matched' && m.set_id) setId = m.set_id;
    else {
      const { snap } = await loadSnap(store, ev.code);
      return { set: manualNSet(m, snap, ev.name), offline: true, manual: true, before: await store.getReportSet(ev.code, setId) };
    }
  }
  const before = await store.getReportSet(ev.code, setId);
  const rs = await p.readSet(setId);
  if (rs.ok) return { set: rs.set, offline: false, manual: false, before };
  if (rs.code === 'not_found') return { res: err('not_found', 'この大会にその試合はありません。', rs.note) };
  if (!isOutageNote(rs.note)) return { res: err('provider_error', providerMessage(ev.kind, rs.note), rs.note) };
  const { snap } = ev.kind === 'startgg' ? await loadSnap(store, ev.code) : { snap: null };
  const alt = (snap && snapNSet(snap, setId, ev.name)) || (before && rowNSet(before));
  if (!alt) return { res: err('provider_error', MSG_OUTAGE_NOSET, 'outage_no_snapshot') };
  return { set: alt, offline: true, manual: false, before };
}

/** action: "report_submit" — 選手が自分の試合の結果を送る */
export async function handleReportSubmit(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  let setId = typeof req.set_id === 'string' || typeof req.set_id === 'number' ? String(req.set_id) : '';
  if (!anySetId(setId)) return err('bad_request', '試合の指定が正しくありません。', 'bad:set_id');
  const act = await store.reportSubmissionActivity(sess.id, now - DAY);
  if ((act.latestMs !== null && now - act.latestMs < REPORT_MIN_INTERVAL_MS) || act.count >= REPORT_MAX_PER_DAY) {
    return err('rate_limited', '送る間隔が短すぎます。少し待ってから送り直してください。', 'rate');
  }
  const o = await openEvent(cfg, store, fetchFn, req.code, now);
  if (!o.ok) return o.res;
  const health = await Health.load(store, o.ev.kind);
  const p = guardProvider(providerOf(fetchFn, o), health, now);
  const got = await setForReport(store, p, o.ev, setId);
  if ('res' in got) return got.res;
  setId = got.set.id;
  const { set, offline, manual } = got;
  const before = got.before;
  if (!set.slots[0] || !set.slots[1]) return err('not_ready', 'まだ対戦相手が決まっていません。', 'not_ready');
  const side: Side | null = set.slots[0].users.includes(sess.id) ? 0 : set.slots[1].users.includes(sess.id) ? 1 : null;
  if (side === null) return err('not_player', 'この試合の選手だけが報告できます。', 'not_player');
  const opens = parseSettings(o.ev.settings).opens_ms;
  if (opens && now < opens) return err('not_allowed', 'まだ結果報告の受付が始まっていません。', 'not_open');
  const gate = playerGate(set, parseSettings(o.ev.settings));
  if (gate === 'classes_only') return err('not_allowed', 'この大会では、下位クラスの試合だけ選手が報告できます。結果は運営に伝えてください。', gate);
  if (gate === 'top_cut') return err('not_allowed', 'この試合 (トップ ' + parseSettings(o.ev.settings).top_cut + ' から) は運営が結果を入力します。結果は運営に伝えてください。', gate);
  const ft = ftOf(set, parseSettings(o.ev.settings));
  const pr = parseResult(req.result, ft);
  if ('bad' in pr) {
    if (pr.bad === 'score_ft') return err('bad_request', 'この試合は ' + ft + ' 先です。スコアを確かめてください。', 'bad:score_ft');
    return err('bad_request', '結果の形式が正しくありません (' + pr.bad + ')。', 'bad:' + pr.bad);
  }

  const subId = await store.insertReportSubmission({ code: o.ev.code, set_id: setId, user_id: sess.id, side, ts_ms: now, result: JSON.stringify(pr.result), outcome: 'pending' });
  // start.gg に繋がらない (か、運営が指定した試合): D1 に残して、復旧後に送る
  const queue = async (): Promise<HandlerResult> => {
    const q = await queueOffline(store, o.ev.code, set, now, { manual });
    if (!q) { await store.setReportSubmissionOutcome(subId, 'error:busy'); return err('busy', 'ほかの報告と重なりました。もう一度送ってください。', 'busy'); }
    await store.setReportSubmissionOutcome(subId, 'queued:' + q.note);
    await notifyReport(cfg, store, fetchFn, o.ev, set, { state: q.state as ReportState, note: q.note }, pr.result).catch(() => 0);
    return ok({ set_id: setId, state: q.state, op: 'none', note: q.note, offline: true });
  };
  if (offline) return queue();
  const mode = parseSettings(o.ev.settings).apply || 'auto';
  const r = await settle(store, p, o.ev.code, set, before ? before.version : null, now, null, (row, latest, cur) => reconcile(prevOf(row), latest, cur, mode, now));
  if (!r.ok) {
    if (r.why === 'provider' && isOutageNote(r.note)) return queue();
    await store.setReportSubmissionOutcome(subId, 'error:' + r.note.slice(0, 100));
    if (r.why === 'busy') return err('busy', 'ほかの報告と重なりました。もう一度送ってください。', 'busy');
    return err('provider_error', providerMessage(o.ev.kind, r.note), r.note);
  }
  await store.setReportSubmissionOutcome(subId, r.d.op + (r.d.note ? ':' + r.d.note : ''));
  await notifyReport(cfg, store, fetchFn, o.ev, set, r.d, pr.result).catch(() => 0);   // 運営への通知 (送れなくても報告は済んでいる)
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
  return { code: row.code, set_id: row.set_id, state: row.state, note: row.note === SENDING ? '' : row.note, applied: parseApplied(row.applied), slots, reports: latest, updated_ms: row.updated_ms };
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
  const health = await Health.load(store, o.ev.kind);
  const p = guardProvider(providerOf(fetchFn, o), health, now);
  await flushPending(store, p, o.ev, now).catch(() => 0);
  const kept = await maintain(store, fetchFn, o, p, health, now).catch(() => ({ snap: null, syncedMs: 0 }));
  const rows = await store.listReportSetsForUser(sess.id, [o.ev.code]);
  const sets = [];
  for (const r of rows) sets.push(await setView(store, r, sess.id));
  const out: Record<string, unknown> = { report: publicOf(o.ev, now), me: { id: sess.id }, admin: !!roleOf(o.ev, sess.id), role: roleOf(o.ev, sess.id), sets,
    outage: health.view() };
  if (o.ev.kind === 'startgg') {
    // 運営が指定した試合 (障害中)・ブラケットの写しの自分の試合 (障害中か、画面が start.gg を読めなかったとき fallback: true)
    out.manual = (await store.listReportManualForUser(sess.id, o.ev.code)).map((m) => manualView(m, kept.snap));
    if (req.fallback === true || health.down()) out.snap = kept.snap ? { ...snapMine(kept.snap, sess.id), synced_ms: kept.syncedMs } : null;
  }
  if (o.ev.kind === 'challonge') {
    const d = await challongeData(fetchFn, o.token, o.ev.target_id);
    out.challonge = d.ok ? challongeMine(d.data, sess.id, parseSettings(o.ev.settings).double === true) : { error: d.note };
  }
  return ok(out);
}

/** action: "report_notices" — 受付中の大会 (だれでも) と、ログイン中なら自分の試合の食い違い・運営確認 */
export async function handleReportNotices(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  await store.purgeReportTokens(now);
  const events = (await store.listActiveReportEvents(now)).filter((e) => !((parseSettings(e.settings).opens_ms || 0) > now));   // 受付の開始前はお知らせに出さない
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

/** 運営の画面の操作。adminOnly = 運営 (受付を始めた人) だけ。でなければ報告管理者も */
async function adminOpen(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number, adminOnly = false): Promise<Opened & { uid?: string; role?: 'admin' | 'manager' }> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return { ok: false, res: err('auth_failed', MSG_LOGIN, 'session') };
  const o = await openEvent(cfg, store, fetchFn, req.code, now);
  if (!o.ok) return o;
  const role = roleOf(o.ev, sess.id);
  if (!role || (adminOnly && role !== 'admin')) {
    return { ok: false, res: err('not_admin', adminOnly ? 'この受付を始めた運営だけが使えます。' : 'この受付の運営・報告管理者だけが使えます。運営の方は受付をし直すと使えるようになります。', 'not_admin') };
  }
  return { ...o, uid: sess.id, role };
}

/** action: "report_admin" — 試合ごとの状態と両者の報告 */
export async function handleReportAdmin(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  const health = await Health.load(store, o.ev.kind);
  const p = guardProvider(providerOf(fetchFn, o), health, now);
  await flushPending(store, p, o.ev, now).catch(() => 0);
  const kept = await maintain(store, fetchFn, o, p, health, now).catch(() => ({ snap: null, syncedMs: 0 }));
  const sets = [];
  for (const r of await store.listReportSets(o.ev.code)) sets.push(await setView(store, r, null));
  // 指定した試合: 受付中のものと、6 時間以内に start.gg の試合が見つかった・取り消したもの
  const manual = o.ev.kind === 'startgg' ? (await store.listReportManual(o.ev.code)).filter((m) => m.status === 'open' || now - m.updated_ms < 6 * 3600 * 1000)
    .map((m) => manualView(m, kept.snap)) : [];
  return ok({ report: publicOf(o.ev, now), sets, role: o.role, managers: managersOf(o.ev), outage: health.view(), manual,
    snapshot: o.ev.kind === 'startgg' ? { synced_ms: kept.syncedMs, sets: kept.snap ? Object.keys(kept.snap.sets).length : 0, full: !!(kept.snap && kept.snap.full) } : null });
}

/** action: "report_phases" — 何先の設定に使うフェーズとラウンド。受付の前 (受付を始める画面) は { token, event } で、運営のログインのトークンで読む */
export async function handleReportPhases(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (req.code === undefined && req.event !== undefined) {
    const sess = await sessionOf(cfg, req, now);
    if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
    const vars = eventVars(req.event);
    if (!vars) return err('bad_request', 'start.gg のイベントの URL を確かめてください。', 'bad:event');
    const g = await grantOf(cfg, store, fetchFn, sess.id, now);
    if (!g) return err('no_grant', MSG_GRANT, 'no_grant');
    const q = await startggGql(fetchFn, g.at, EVENT_QUERY, vars);
    if (!q.ok) return err('startgg_error', 'start.gg に確認できませんでした。時間をおいてやり直してください。', 'event:' + q.note);
    const evRaw = q.json.data ? q.json.data.event as { id?: unknown; startAt?: unknown; tournament?: { startAt?: unknown } | null } | null : null;
    if (!evRaw || evRaw.id === undefined || evRaw.id === null) return err('bad_request', 'start.gg でイベントが見つかりません。', 'event_not_found');
    const r = await startggProvider(fetchFn, g.at, String(evRaw.id)).phases();
    if (!r.ok) return err('provider_error', providerMessage('startgg', r.note), r.note);
    const startAt = Number(evRaw.startAt) || Number(evRaw.tournament && evRaw.tournament.startAt) || null;   // 受付の開始の既定値 (秒)
    return ok({ phases: r.phases, startAt, entrants: r.entrants ?? null });
  }
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  const r = await guardProvider(providerOf(fetchFn, o), await Health.load(store, o.ev.kind), now).phases();
  if (!r.ok) return err('provider_error', providerMessage(o.ev.kind, r.note), r.note);
  return ok({ phases: r.phases, entrants: r.entrants ?? null });
}

/** 運営が採用する側の報告 (adopt) から結果を作る: 勝敗・スコア・ステージはその側、キャラは各側の本人の入力 (選手の報告がそろったときと同じ)。
 *  数えるのは運営が最後に直した・取り消した後の報告だけ (floor_id) */
async function adoptedResult(store: Store, code: string, setId: string, side: Side): Promise<Result | null> {
  const row = await store.getReportSet(code, setId);
  const floor = row ? row.floor_id : 0;
  const latest: [Result | null, Result | null] = [null, null];
  for (const sub of await store.listReportSubmissions(code, setId)) {
    if ((sub.id || 0) <= floor || sub.side < 0) continue;
    const r = parseApplied(sub.result);
    if (r) latest[sub.side as Side] = r;
  }
  return latest[side] ? mergeResults(latest, side) : null;
}

/** action: "report_admin_fix" — 運営が直す ({ result })・片方の報告を採用する ({ adopt: 0 | 1 }、食い違いの解決・取り込み待ちの承認)・取り消す ({ reset: true })・
 *  取り込み待ちを止める ({ hold: true }、選手の報告では動かさない。採用・直すで解ける)。次の試合に結果が出るまで */
export async function handleReportAdminFix(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  const uid = o.uid as string;
  let setId = typeof req.set_id === 'string' || typeof req.set_id === 'number' ? String(req.set_id) : '';
  if (!anySetId(setId)) return err('bad_request', '試合の指定が正しくありません。', 'bad:set_id');
  const act = await store.reportSubmissionActivity(uid, now - DAY);
  if (act.count >= REPORT_ADMIN_MAX_PER_DAY) return err('rate_limited', '今日はこれ以上直せません。', 'rate');
  const health = await Health.load(store, o.ev.kind);
  const p = guardProvider(providerOf(fetchFn, o), health, now);
  const got = await setForReport(store, p, o.ev, setId);
  if ('res' in got) return got.res;
  const { set, offline, before } = got;
  setId = set.id;
  if (!set.slots[0] || !set.slots[1]) return err('not_ready', 'まだ対戦相手が決まっていません。', 'not_ready');
  const kind = req.reset === true ? 'reset' : req.hold === true ? 'hold' : 'fix';
  if (kind === 'hold' && !(before && (before.state === 'pending' || before.state === 'queued'))) return err('bad_request', '取り込み待ちの試合だけ止められます。', 'bad:hold');
  let result: Result | null = null;
  if (kind === 'fix' && (req.adopt === 0 || req.adopt === 1)) {
    result = await adoptedResult(store, o.ev.code, setId, req.adopt);
    if (!result) return err('bad_request', 'その選手の報告がありません。', 'bad:adopt');
  } else if (kind === 'fix') {
    const pr = parseResult(req.result);
    if ('bad' in pr) return err('bad_request', '結果の形式が正しくありません (' + pr.bad + ')。', 'bad:' + pr.bad);
    result = pr.result;
  }
  const label = 'admin_' + (kind === 'fix' && (req.adopt === 0 || req.adopt === 1) ? 'adopt' + req.adopt : kind);
  const subId = await store.insertReportSubmission({ code: o.ev.code, set_id: setId, user_id: uid, side: -1, ts_ms: now, result: result ? JSON.stringify(result) : '', outcome: 'pending' });
  // start.gg に繋がらない (か、運営が指定した試合): 直し・取り消しを D1 に残して、復旧後に送る。
  // まだ start.gg に何も入っていない試合の取り消しは、待っている報告を数えなくするだけ (送るものが無い)
  const queue = async (): Promise<HandlerResult> => {
    const nothingThere = !set.complete && !(before && before.applied);
    const force = kind === 'hold' ? { state: 'review', note: 'hold' }
      : kind === 'reset' ? (nothingThere ? { state: 'reset', note: 'admin' } : { state: 'queued', note: 'outage_reset' })
      : { state: 'queued', note: 'outage_admin' };
    const q = await queueOffline(store, o.ev.code, set, now, { force, floor: kind === 'hold' ? undefined : subId });
    if (!q) { await store.setReportSubmissionOutcome(subId, 'error:busy'); return err('busy', 'ほかの報告と重なりました。もう一度やり直してください。', 'busy'); }
    await store.setReportSubmissionOutcome(subId, label + ':queued');
    return ok({ set_id: setId, state: q.state, op: 'none', note: q.note, offline: true });
  };
  if (offline) return queue();
  const r = await settle(store, p, o.ev.code, set, before ? before.version : null, now, kind === 'hold' ? null : subId,
    (row, _latest, cur) => adminDecision(kind, result, cur, row ? parseApplied(row.applied) : null), kind === 'reset' ? 'outage_reset' : 'outage_admin');
  if (!r.ok) {
    if (r.why === 'provider' && isOutageNote(r.note)) return queue();
    await store.setReportSubmissionOutcome(subId, 'error:' + r.note.slice(0, 100));
    if (r.why === 'locked') return err('locked', '次の試合の結果が入っているため、ここでは直せません。start.gg / Challonge で直してください。', 'locked');
    if (r.why === 'busy') return err('busy', 'ほかの報告と重なりました。もう一度やり直してください。', 'busy');
    return err('provider_error', providerMessage(o.ev.kind, r.note), r.note);
  }
  await store.setReportSubmissionOutcome(subId, label + ':' + r.d.op);
  return ok({ set_id: setId, state: r.d.state, op: r.d.op });
}

// ── 運営: start.gg に繋がらないあいだに次の試合を指定する (docs §11) ─────────────

const MSG_NO_SNAP = 'ブラケットの写しがまだありません (start.gg が読めるあいだに、運営・選手の画面を開いていると作られます)。';

/** 指定した試合のうち、結果がまだ無いもの (その 2 人は次の指定の候補に出さない) */
async function busyEntrants(store: Store, code: string, manualOpen: ReportManualRow[]): Promise<Set<string>> {
  const busy = new Set<string>();
  for (const m of manualOpen) {
    const row = await store.getReportSet(code, 'm' + m.id);
    const res = row ? heldResult(row, await store.listReportSubmissions(code, row.set_id)) : null;
    if (res && row && row.state !== 'reset') continue;
    for (const s of manualSlots(m)) if (s) busy.add(s.id);
  }
  return busy;
}

/** action: "report_bracket" — { token, code } 次の試合を指定する候補 (ブロックごとの出場者と、負けの数え。start.gg の受付だけ) */
export async function handleReportBracket(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  if (o.ev.kind !== 'startgg') return err('bad_request', 'start.gg の大会だけで使えます。', 'bad:kind');
  const { snap, syncedMs } = await loadSnap(store, o.ev.code);
  if (!snap || !Object.keys(snap.sets).length) return err('not_ready', MSG_NO_SNAP, 'no_snapshot');
  const manualOpen = (await store.listReportManual(o.ev.code)).filter((m) => m.status === 'open');
  const held = await heldList(store, o.ev.code, snap, manualOpen);
  return ok({ groups: bracketCandidates(snap, held, await busyEntrants(store, o.ev.code, manualOpen)), synced_ms: syncedMs });
}

/** action: "report_manual_create" — { token, code, group, side: 'w' | 'l', entrants: [entrant, entrant], station? } */
export async function handleReportManualCreate(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  if (o.ev.kind !== 'startgg') return err('bad_request', 'start.gg の大会だけで使えます。', 'bad:kind');
  const side = req.side === 'w' || req.side === 'l' ? req.side : null;
  const gid = typeof req.group === 'string' && /^\d{1,15}$/.test(req.group) ? req.group : null;
  const ids = Array.isArray(req.entrants) ? req.entrants.map((x) => String(x)) : [];
  if (!side || !gid || ids.length !== 2 || !ids.every((x) => /^\d{1,15}$/.test(x)) || ids[0] === ids[1]) return err('bad_request', '入力の形式が正しくありません。', 'bad:manual');
  const station = typeof req.station === 'string' ? req.station.replace(/[^\w\-#ぁ-んァ-ヶ一-龠ー０-９]/g, '').slice(0, 12) : '';
  const { snap } = await loadSnap(store, o.ev.code);
  if (!snap || !snap.groups[gid]) return err('not_ready', MSG_NO_SNAP, 'no_snapshot');
  const all = await store.listReportManual(o.ev.code);
  const manualOpen = all.filter((m) => m.status === 'open');
  if (manualOpen.length >= 200) return err('rate_limited', '指定した試合が多すぎます。終わったものを取り消してください。', 'manual_max');
  const held = await heldList(store, o.ev.code, snap, manualOpen);
  const group = bracketCandidates(snap, held, await busyEntrants(store, o.ev.code, manualOpen)).find((g) => g.id === gid);
  const pick = ids.map((id) => (group ? group.entrants.find((e) => e.id === id) : undefined));
  if (!pick[0] || !pick[1]) return err('bad_request', 'そのブロックに居ない選手がいます。', 'bad:entrant');
  for (const e of pick) {
    if (e && !candidateFor(e, side)) {
      return err('bad_request', e.manual ? e.name + ' は、結果の出ていない指定済みの試合があります。' : e.name + ' は ' + (side === 'w' ? '負けているので勝者側の候補ではありません。' : '敗者側で負けています。'), 'bad:candidate');
    }
  }
  const slots = pick.map((e) => ({ id: e!.id, name: e!.name, users: snap.ents[e!.id] ? snap.ents[e!.id].u : [], seed: e!.seed }));
  const row: ReportManualRow = {
    code: o.ev.code, side, group_id: gid, slots: JSON.stringify(slots), users: '|' + slots.flatMap((s) => s.users).join('|') + '|', station, set_id: '',
    status: 'open', created_by: o.uid as string, created_ms: now, updated_ms: now,
  };
  row.id = await store.insertReportManual(row);
  return ok({ manual: manualView(row, snap) });
}

/** action: "report_manual_cancel" — { token, code, id } 指定を取り消す (その試合の報告は数えない) */
export async function handleReportManualCancel(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now);
  if (!o.ok) return o.res;
  const id = Number(req.id);
  const m = Number.isInteger(id) && id > 0 ? await store.getReportManual(o.ev.code, id) : null;
  if (!m) return err('not_found', 'その試合はありません。', 'no_manual');
  if (m.status !== 'open') return err('bad_request', m.status === 'matched' ? 'もう start.gg の試合に移っています。運営の一覧から直してください。' : 'もう取り消してあります。', 'bad:status');
  await store.updateReportManual(o.ev.code, id, 'cancelled', '', now);
  const row = await store.getReportSet(o.ev.code, 'm' + id);
  if (row) await markRow(store, row, 'reset', 'manual_cancel', now);
  return ok({ id });
}

/** action: "report_stop" — 受付を止めてトークンを消す */
export async function handleReportStop(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (typeof req.code !== 'string' || !CODE_RE.test(req.code)) return err('bad_request', '報告ページの URL が正しくありません。', 'bad:code');
  const ev = await store.getReportEvent(req.code);
  if (!ev) return err('not_found', '報告ページの URL が正しくありません。', 'no_event');
  if (roleOf(ev, sess.id) !== 'admin') return err('not_admin', 'この受付の運営だけが止められます。', 'not_admin');
  await store.stopReportEvent(ev.code);
  return ok({ code: ev.code });
}

// ── 運営: 名前をつけて保存した設定 (アカウントごと) ─────────────────────

const presetView = (r: { name: string; settings: string; updated_ms: number }) => ({ name: r.name, settings: parsePreset(safeJson(r.settings)), updated_ms: r.updated_ms });
function safeJson(s: string): unknown { try { return JSON.parse(s); } catch (_) { return null; } }

/** action: "report_presets" — 自分の保存した設定の一覧 */
export async function handleReportPresets(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  return ok({ presets: (await store.listReportPresets(sess.id)).map(presetView).filter((p) => p.settings) });
}

/** action: "report_preset_save" — { token, name, settings } (同じ名前なら上書き) */
export async function handleReportPresetSave(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  const name = presetName(req.name);
  if (!name) return err('bad_request', '設定の名前を 1〜40 文字で入れてください。', 'bad:name');
  const p = parsePreset(req.settings);
  if (!p) return err('bad_request', '設定の形式が正しくありません。', 'bad:settings');
  if (!await store.saveReportPreset(sess.id, { name, settings: JSON.stringify(p), updated_ms: now }, PRESETS_MAX)) {
    return err('rate_limited', '保存できる設定は ' + PRESETS_MAX + ' 個までです。使わないものを消してください。', 'presets_max');
  }
  return ok({ presets: (await store.listReportPresets(sess.id)).map(presetView).filter((x) => x.settings) });
}

/** action: "report_preset_delete" — { token, name } */
export async function handleReportPresetDelete(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  const name = presetName(req.name);
  if (!name) return err('bad_request', '設定の名前が正しくありません。', 'bad:name');
  await store.deleteReportPreset(sess.id, name);
  return ok({ presets: (await store.listReportPresets(sess.id)).map(presetView).filter((x) => x.settings) });
}

/** action: "report_settings" — 運営の設定を変える { token, code, settings: { top_cut, classes_only } } */
export async function handleReportSettings(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (typeof req.code !== 'string' || !CODE_RE.test(req.code)) return err('bad_request', '報告ページの URL が正しくありません。', 'bad:code');
  const ev = await store.getReportEvent(req.code);
  if (!ev) return err('not_found', '報告ページの URL が正しくありません。', 'no_event');
  if (roleOf(ev, sess.id) !== 'admin') return err('not_admin', 'この受付の運営だけが変えられます。', 'not_admin');
  const old = parseSettings(ev.settings);
  const next = { ...parseSettings(req.settings), ...(old.double ? { double: true } : {}) };
  if (ev.kind === 'challonge') next.classes_only = false;
  await store.updateReportEventSettings(ev.code, JSON.stringify(next));
  return ok({ settings: next });
}

// ── 運営への通知 (Web Push、report_notify.ts) ─────────────────────────

/** action: "report_push_key" — ブラウザの購読に使う公開鍵 (未設定なら null = 通知は使えない) */
export function handleReportPushKey(cfg: Config): HandlerResult {
  return ok({ key: cfg.vapid ? cfg.vapid.publicKey : null });
}

/** action: "report_push_subscribe" — { token, sub: PushSubscription.toJSON() } この端末で通知を受け取る */
export async function handleReportPushSubscribe(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (!cfg.vapid) return err('not_allowed', '通知はまだ使えません。', 'no_vapid');
  const sub = validSub(req.sub);
  if (!sub) return err('bad_request', '通知の登録の形式が正しくありません。', 'bad:sub');
  await store.putReportPushSub({ endpoint: sub.endpoint, user_id: sess.id, p256dh: sub.p256dh, auth: sub.auth, created_ms: now }, PUSH_SUBS_PER_USER);
  return ok({});
}

/** action: "report_push_unsubscribe" — { token, endpoint } この端末の通知をやめる */
export async function handleReportPushUnsubscribe(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (typeof req.endpoint !== 'string' || req.endpoint.length > 1000) return err('bad_request', '通知の登録の形式が正しくありません。', 'bad:endpoint');
  await store.deleteReportPushSub(req.endpoint, sess.id);
  return ok({});
}

/** action: "report_push_test" — { token, code } 自分の端末に試しに送る (運営だけ) */
export async function handleReportPushTest(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (typeof req.code !== 'string' || !CODE_RE.test(req.code)) return err('bad_request', '報告ページの URL が正しくありません。', 'bad:code');
  const ev = await store.getReportEvent(req.code);
  if (!ev || !roleOf(ev, sess.id)) return err('not_admin', 'この受付の運営・報告管理者だけが使えます。', 'not_admin');
  const act = await store.reportSubmissionActivity(sess.id, now - DAY);
  if (act.count >= REPORT_ADMIN_MAX_PER_DAY) return err('rate_limited', '今日はこれ以上送れません。', 'rate');
  const n = await notifyTest(cfg, store, fetchFn, sess.id, ev.code);
  return ok({ sent: n });
}

// ── 報告管理者 (運営だけが足す・外す) ────────────────────────────────

const USER_QUERY = 'query SpspReportUser($id: ID, $slug: String) { user(id: $id, slug: $slug) { id discriminator player { gamerTag } } }';
/** "user/1a2b3c4d"・start.gg のユーザーページの URL・discriminator だけ → discriminator */
export function discOf(v: unknown): string | null {
  const m = /^(?:https?:\/\/(?:www\.)?start\.gg\/)?(?:user\/)?([0-9a-f]{8})\/?$/i.exec(String(v || '').trim());
  return m ? m[1].toLowerCase() : null;
}

/** start.gg のユーザーを読む ({ uid } か { discriminator })。足す前の確認と追加で使う */
async function lookupUser(fetchFn: FetchFn, token: string, req: Record<string, unknown>): Promise<{ ok: true; m: { id: string; name: string; disc: string } } | { ok: false; res: HandlerResult }> {
  const uid = typeof req.uid === 'string' || typeof req.uid === 'number' ? String(req.uid) : '';
  const disc = req.discriminator !== undefined ? discOf(req.discriminator) : null;
  if (!/^\d{1,12}$/.test(uid) && !disc) return { ok: false, res: err('bad_request', 'ユーザーを選ぶか、start.gg の discriminator (8 文字) を入れてください。', 'bad:user') };
  const q = await startggGql(fetchFn, token, USER_QUERY, disc ? { slug: 'user/' + disc } : { id: uid });
  if (!q.ok) return { ok: false, res: err('startgg_error', 'start.gg に確認できませんでした。時間をおいてやり直してください。', 'user:' + q.note) };
  const u = q.json.data ? q.json.data.user as { id?: unknown; discriminator?: unknown; player?: { gamerTag?: unknown } | null } | null : null;
  if (!u || u.id === undefined || u.id === null) return { ok: false, res: err('not_found', 'start.gg にそのユーザーが見つかりません。discriminator を確かめてください。', 'user_not_found') };
  return { ok: true, m: { id: String(u.id), name: String((u.player && u.player.gamerTag) || '').slice(0, 80), disc: String(u.discriminator || disc || '').slice(0, 20) } };
}

/** action: "report_manager_lookup" — 足す前の確認: start.gg の名前と、今の役割 (admin / manager / null) を返す */
export async function handleReportManagerLookup(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now, true);
  if (!o.ok) return o.res;
  if (o.ev.kind !== 'startgg') return err('not_allowed', '管理者の追加は start.gg の受付だけで使えます。', 'not_startgg');
  const l = await lookupUser(fetchFn, o.token, req);
  if (!l.ok) return l.res;
  return ok({ user: l.m, current: admins(o.ev).includes(l.m.id) ? 'startgg_admin' : (managersOf(o.ev).find((x) => x.id === l.m.id) || { role: null }).role });
}

/** action: "report_manager_add" — { token, code, uid | discriminator, role: 'report' (既定) | 'full' }。start.gg で確かめて足す (同じ人なら役割を変える) */
export async function handleReportManagerAdd(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const o = await adminOpen(cfg, store, fetchFn, req, now, true);
  if (!o.ok) return o.res;
  if (o.ev.kind !== 'startgg') return err('not_allowed', '管理者の追加は start.gg の受付だけで使えます。', 'not_startgg');
  const l = await lookupUser(fetchFn, o.token, req);
  if (!l.ok) return l.res;
  const role: ManagerRole = req.role === 'full' ? 'full' : 'report';
  const m: ReportManager = { ...l.m, role };
  if (admins(o.ev).includes(m.id)) return err('bad_request', 'その人は start.gg の大会の運営として、この受付に加わっています (足さなくても全部使えます)。', 'already_admin');
  if (m.id === o.uid) return err('bad_request', '自分は足せません。', 'self');
  const list = managersOf(o.ev).filter((x) => x.id !== m.id);
  if (list.length >= MANAGERS_MAX) return err('rate_limited', '管理者は ' + MANAGERS_MAX + ' 人までです。', 'managers_max');
  list.push(m);
  await store.updateReportEventManagers(o.ev.code, JSON.stringify(list));
  return ok({ managers: list, added: m });
}

/** action: "report_manager_remove" — { token, code, id } */
export async function handleReportManagerRemove(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  if (typeof req.code !== 'string' || !CODE_RE.test(req.code)) return err('bad_request', '報告ページの URL が正しくありません。', 'bad:code');
  const ev = await store.getReportEvent(req.code);
  if (!ev) return err('not_found', '報告ページの URL が正しくありません。', 'no_event');
  if (roleOf(ev, sess.id) !== 'admin') return err('not_admin', 'この受付の運営だけが使えます。', 'not_admin');
  const id = String(req.id || '');
  if (id === sess.id) return err('bad_request', '自分は外せません。', 'self');
  const list = managersOf(ev).filter((x) => x.id !== id);
  await store.updateReportEventManagers(ev.code, JSON.stringify(list));
  return ok({ managers: list });
}

/** action: "report_join" — { token, code } start.gg でこの大会の運営 (管理者) なら、この受付に運営として加わる (設定・試合の状態はそのまま共有)。
 *  運営のログイン (report_login、tournament.reporter) が要る。受付のトークンは替えない */
export async function handleReportJoin(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await sessionOf(cfg, req, now);
  if (!sess) return err('auth_failed', MSG_LOGIN, 'session');
  const o = await openEvent(cfg, store, fetchFn, req.code, now);
  if (!o.ok) return o.res;
  if (o.ev.kind !== 'startgg' || o.ev.event_id === null) return err('not_admin', 'この受付を始めた運営だけが使えます。', 'not_startgg');
  if (roleOf(o.ev, sess.id) === 'admin') return ok({ joined: false, role: 'admin' });
  const g = await grantOf(cfg, store, fetchFn, sess.id, now);
  if (!g) return err('no_grant', MSG_GRANT, 'no_grant');
  const adm = await checkStartggAdmin(fetchFn, g.at, o.ev.event_id);
  if (!adm.ok) {
    if (adm.code === 'not_admin') return err('not_admin', 'このアカウントは、この大会の start.gg の管理者ではありません。運営に「管理者の追加」で足してもらってください。', adm.note);
    return err('startgg_error', 'start.gg に確認できませんでした。時間をおいてやり直してください。', adm.note);
  }
  if (adm.userId !== sess.id) return err('not_admin', 'ログイン中のアカウントと運営のログインが違います。もう一度 start.gg でログインしてください。', 'user_mismatch');
  await store.updateReportEventAdmins(o.ev.code, addAdmin(o.ev.admins, sess.id));
  // 足した管理者 (結果だけ) が start.gg の運営でもあったら、運営のほうに寄せる
  const rest = managersOf(o.ev).filter((x) => x.id !== sess.id);
  if (rest.length !== managersOf(o.ev).length) await store.updateReportEventManagers(o.ev.code, JSON.stringify(rest));
  return ok({ joined: true, role: 'admin' });
}
