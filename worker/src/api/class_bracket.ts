/**
 * 下位クラス (Bクラス等) を Challonge で開いたものの登録と、取得側への受け渡し (docs/class_bracket_design.md)。
 *
 *   action: "class_create"    TO がページから作る。start.gg の API キーで本戦の大会の owner / admins か確かめ直し、
 *                             TO の Challonge トークン (OAuth、challonge.ts) でトーナメントを作って参加者を入れ、D1 に登録する
 *   action: "class_waitlist"  取得待ち (counted かつ waiting) の一覧。公開してよい欄だけ (GET /api/class_waitlist)
 *   action: "class_done"      取得側 (smash_database) が取り終えたら呼ぶ。鍵 = Worker の secret CLASS_DONE_KEY
 *
 * start.gg の API キー (startgg_token) と Challonge のトークン (challonge_token) は問い合わせにだけ使い、
 * 保存しない・ログに出さない・応答に返さない。
 * 失敗の記録 (errors の note) にも理由の符号 (http_401 など) だけを入れる。
 */
import type { Config } from '../config.ts';
import {
  CLASS_DELETE_MAX_PER_DAY, CLASS_DELETE_MIN_INTERVAL_MS, CLASS_MINE_DAYS, CLASS_MINE_MAX_PER_DAY, CLASS_MINE_MIN_INTERVAL_MS,
  CLASS_PARTICIPANTS_MAX, CLASS_PARTICIPANTS_MIN, CLASS_RATE_MAX_PER_DAY, CLASS_RATE_MIN_INTERVAL_MS, GQL_URL, STARTGG_TIMEOUT_MS,
  requireSecret,
} from '../config.ts';
import { challongeApi } from './challonge.ts';
import type { Store } from '../store.ts';
import { keyMatches } from './export.ts';
import type { FetchFn } from './oauth.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { dayKey, formatIso } from './time.ts';

const CLASS_LETTERS = ['B', 'C', 'D', 'E'];
const FORMATS = ['single', 'double'];
const SEEDINGS = ['random', 'main_result', 'main_spsp', 'spsp'];   // main_spsp = 本戦の順位、同順位は SPSP の順位 (既定)
const NAME_MAX = 200;
const TOKEN_MAX = 200;

/** 正の整数 (数字の文字列も可、maxDigits 桁まで)。違えば null。 */
function posInt(v: unknown, maxDigits: number): number | null {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : '') : typeof v === 'string' ? v : '';
  return new RegExp('^[1-9]\\d{0,' + (maxDigits - 1) + '}$').test(s) ? Number(s) : null;
}

export interface ClassParticipant { name: string; seed: number; misc: string }

export interface ClassCreateInput {
  startggToken: string;
  challongeToken: string;
  parentEventId: number;
  classLetter: string;
  name: string;
  format: string;
  counted: boolean;
  placeMin: number;
  placeMax: number | null;
  seeding: string;
  participants: ClassParticipant[];
}

const PARTICIPANT_NAME_MAX = 120;
const CHALLONGE_TOKEN_MAX = 4096;

/** 入力を確かめる。違えば理由 (note 用の短い符号)。 */
export function parseClassCreate(r: Record<string, unknown>): { input: ClassCreateInput } | { bad: string } {
  const st = r.startgg_token;
  if (typeof st !== 'string' || !st || st.length > TOKEN_MAX || /\s/.test(st)) return { bad: 'startgg_token' };
  const ct = r.challonge_token;
  if (typeof ct !== 'string' || !ct || ct.length > CHALLONGE_TOKEN_MAX || /\s/.test(ct)) return { bad: 'challonge_token' };
  const parentEventId = posInt(r.parent_event_id, 12);
  if (parentEventId === null) return { bad: 'parent_event_id' };
  if (typeof r.class_letter !== 'string' || !CLASS_LETTERS.includes(r.class_letter)) return { bad: 'class_letter' };
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name || name.length > NAME_MAX) return { bad: 'name' };
  if (typeof r.format !== 'string' || !FORMATS.includes(r.format)) return { bad: 'format' };
  if (typeof r.counted !== 'boolean') return { bad: 'counted' };
  const placeMin = posInt(r.place_min, 6);
  if (placeMin === null) return { bad: 'place_min' };
  let placeMax: number | null = null;
  if (r.place_max !== null && r.place_max !== undefined) {
    placeMax = posInt(r.place_max, 6);
    if (placeMax === null || placeMax < placeMin) return { bad: 'place_max' };
  }
  if (typeof r.seeding !== 'string' || !SEEDINGS.includes(r.seeding)) return { bad: 'seeding' };
  const ps = r.participants;
  if (!Array.isArray(ps) || ps.length < CLASS_PARTICIPANTS_MIN || ps.length > CLASS_PARTICIPANTS_MAX) return { bad: 'participants' };
  const participants: ClassParticipant[] = [];
  const seeds = new Set<number>();
  const miscs = new Set<string>();
  for (const p of ps) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return { bad: 'participant' };
    const o = p as Record<string, unknown>;
    const pn = typeof o.name === 'string' ? o.name.trim() : '';
    if (!pn || pn.length > PARTICIPANT_NAME_MAX) return { bad: 'participant_name' };
    const seed = posInt(o.seed, 3);
    if (seed === null || seed > CLASS_PARTICIPANTS_MAX || seeds.has(seed)) return { bad: 'participant_seed' };
    if (typeof o.misc !== 'string' || !/^startgg:[1-9]\d{0,11}$/.test(o.misc) || miscs.has(o.misc)) return { bad: 'participant_misc' };
    seeds.add(seed);
    miscs.add(o.misc);
    participants.push({ name: pn, seed, misc: o.misc });
  }
  return { input: { startggToken: st, challongeToken: ct, parentEventId, classLetter: r.class_letter, name,
    format: r.format, counted: r.counted, placeMin, placeMax, seeding: r.seeding, participants } };
}

const ADMIN_QUERY = `query SpspClassAdmin($eventId: ID!) {
  currentUser { id }
  event(id: $eventId) { id tournament { id owner { id } admins { id } } }
}`;

const ADMIN_TOURS_PER_PAGE = 50;
const ADMIN_TOURS_MAX_PAGES = 4;
const ADMIN_TOURNAMENTS_QUERY = `query SpspClassAdminTours($page: Int!, $perPage: Int!) {
  currentUser { tournaments(query: { page: $page, perPage: $perPage, filter: { tournamentView: "admin" } }) { nodes { id } } }
}`;

export type AdminCheck =
  | { ok: true; userId: string; tournamentId: number }
  | { ok: false; code: 'not_admin' | 'startgg_error' | 'bad_request'; note: string };

type GqlResult = { ok: true; json: { data?: Record<string, unknown> | null; errors?: unknown[] } } | { ok: false; note: string };

/** start.gg GraphQL を 1 回呼ぶ。キーは Authorization ヘッダにだけ入れる。 */
async function startggGql(fetchFn: FetchFn, token: string, query: string, variables: Record<string, unknown>): Promise<GqlResult> {
  let res: Response;
  try {
    res = await fetchFn(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(STARTGG_TIMEOUT_MS),
    });
  } catch (ex) {
    const timeout = ex instanceof Error && (ex.name === 'TimeoutError' || ex.name === 'AbortError');
    return { ok: false, note: timeout ? 'timeout' : 'network' };
  }
  if (res.status !== 200) {
    let why = '';
    try {
      const b = await res.json() as { message?: unknown; errors?: { message?: unknown }[] };
      const m = typeof b.message === 'string' ? b.message : Array.isArray(b.errors) && b.errors[0] && typeof b.errors[0].message === 'string' ? b.errors[0].message : '';
      why = m.split(token).join('').replace(/[^\x20-\x7e]/g, '').slice(0, 80);
    } catch (_) { /* 本文なし */ }
    return { ok: false, note: 'http_' + res.status + (why ? ':' + why : '') };
  }
  try {
    return { ok: true, json: await res.json() };
  } catch (_) {
    return { ok: false, note: 'bad_json' };
  }
}

/**
 * start.gg に「このキーの持ち主は、このイベントの大会の管理者か」を問い合わせる。次のどれかなら管理者:
 *   1. 大会の owner  2. 大会の admins に入っている
 *   3. 本人の「管理している大会」(currentUser.tournaments、tournamentView: admin) にその大会がある
 * スタッフの役割によっては admins が null で返る (2026-10-01、ブラケット・シード編集の権限がある人で確認) ため 3 も見る。
 * 3 は 50 件ずつ最大 4 ページ (pageInfo の総数は当てにならないので、空か 50 件未満のページで止める)。
 * キーは Authorization ヘッダにだけ入れる。本文・エラーの記録には入れない。
 */
export async function checkStartggAdmin(fetchFn: FetchFn, token: string, eventId: number): Promise<AdminCheck> {
  const first = await startggGql(fetchFn, token, ADMIN_QUERY, { eventId: String(eventId) });
  if (!first.ok) return { ok: false, code: 'startgg_error', note: first.note };
  const json = first.json;
  const data = (json && json.data) || null;
  const cu = data && (data.currentUser as { id?: unknown } | null);
  if (!cu || cu.id === undefined || cu.id === null) {
    return { ok: false, code: 'startgg_error', note: Array.isArray(json.errors) && json.errors.length ? 'gql_error' : 'no_user' };
  }
  const userId = String(cu.id);
  const ev = data && (data.event as { tournament?: { id?: unknown; owner?: { id?: unknown } | null; admins?: unknown } | null } | null);
  if (!ev) return { ok: false, code: 'bad_request', note: 'event_not_found' };
  const t = ev.tournament;
  const tournamentId = t ? Number(t.id) : NaN;
  if (!t || !Number.isFinite(tournamentId)) return { ok: false, code: 'bad_request', note: 'event_not_found' };
  const ids: string[] = [];
  if (t.owner && t.owner.id !== undefined && t.owner.id !== null) ids.push(String(t.owner.id));
  if (Array.isArray(t.admins)) {
    for (const a of t.admins) if (a && (a as { id?: unknown }).id !== undefined) ids.push(String((a as { id: unknown }).id));
  }
  if (ids.includes(userId)) return { ok: true, userId, tournamentId };

  // 3. 本人の管理している大会の一覧
  for (let page = 1; page <= ADMIN_TOURS_MAX_PAGES; page++) {
    const r = await startggGql(fetchFn, token, ADMIN_TOURNAMENTS_QUERY, { page, perPage: ADMIN_TOURS_PER_PAGE });
    if (!r.ok) return { ok: false, code: 'startgg_error', note: 'tours:' + r.note };
    const d = (r.json && r.json.data) || null;
    const cu2 = d && (d.currentUser as { tournaments?: { nodes?: unknown } | null } | null);
    const nodes = cu2 && cu2.tournaments && Array.isArray(cu2.tournaments.nodes) ? cu2.tournaments.nodes : null;
    if (!nodes) {
      if (Array.isArray(r.json.errors) && r.json.errors.length) return { ok: false, code: 'startgg_error', note: 'tours:gql_error' };
      break;
    }
    if (nodes.some((n) => n && Number((n as { id?: unknown }).id) === tournamentId)) return { ok: true, userId, tournamentId };
    if (nodes.length < ADMIN_TOURS_PER_PAGE) break;
  }
  return { ok: false, code: 'not_admin', note: 'not_admin' };
}

const MSG_BAD = '入力の形式が不正です。';

function startggMessage(note: string): string {
  if (/^(tours:)?http_40[13]\b/.test(note) || note === 'no_user') {
    return 'start.gg の API キーが無効です。キーを確かめてやり直してください。';
  }
  if (/^(tours:)?http_429\b/.test(note)) return 'start.gg が混み合っています。少し待ってからやり直してください。';
  return 'start.gg に確認できませんでした。時間をおいてやり直してください。';
}

/** Challonge のトーナメント URL (識別子)。英小文字・数字・_ だけ: spsp_<本戦イベント ID>_<クラス>_<ランダム 6 文字> */
export function challongeSlug(eventId: number, letter: string): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.getRandomValues(new Uint8Array(6));
  let r = '';
  for (const x of b) r += abc[x % abc.length];
  return 'spsp_' + eventId + '_' + letter.toLowerCase() + '_' + r;
}

/** 失敗応答にトーナメントの URL を添える (作れたが参加者の追加や登録で失敗したとき、TO が手で直せるように)。 */
function withTournament(res: HandlerResult, t: { id: number; url: string }): HandlerResult {
  return { ...res, body: { ...res.body, challonge: t } };
}

/** action: "class_create" */
export async function handleClassCreate(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const parsed = parseClassCreate(req);
  if ('bad' in parsed) return err('bad_request', MSG_BAD, 'bad:' + parsed.bad);
  const inp = parsed.input;

  // 1. start.gg で TO か確かめ直す
  const adm = await checkStartggAdmin(fetchFn, inp.startggToken, inp.parentEventId);
  if (!adm.ok) {
    if (adm.code === 'not_admin') {
      return err('not_admin', 'この start.gg の API キーの持ち主は、本戦の大会の管理者ではありません。', adm.note);
    }
    if (adm.code === 'bad_request') return err('bad_request', '本戦のイベントが start.gg で見つかりません。', adm.note);
    return err('startgg_error', startggMessage(adm.note), adm.note);
  }

  // 2. 連投は Challonge に作る前に弾く (作ってから弾くとトーナメントだけ残る)
  const day = dayKey(now, cfg.tsOffsetMin);
  const guard = { userId: adm.userId, nowMs: now, minIntervalMs: CLASS_RATE_MIN_INTERVAL_MS, dayKey: day, maxPerDay: CLASS_RATE_MAX_PER_DAY };
  if (!(await store.classRateOk(guard))) {
    return err('rate_limited', '作成の間隔が短すぎます。少し待ってからやり直してください。', 'rate');
  }

  // 3. Challonge にトーナメントを作る (TO のトークンで)
  const created = await challongeApi(fetchFn, inp.challongeToken, '/tournaments.json', {
    data: { type: 'tournaments', attributes: {
      name: inp.name, url: challongeSlug(inp.parentEventId, inp.classLetter),
      tournament_type: inp.format === 'double' ? 'double elimination' : 'single elimination',
      game_name: 'Super Smash Bros. Ultimate', private: false,
    } },
  });
  if (!created.ok) return err(created.code, created.message, 'create:' + created.note);
  const data = created.json.data as { id?: unknown; attributes?: { full_challonge_url?: unknown; url?: unknown } } | undefined;
  const tid = data ? posInt(data.id, 15) : null;
  const attrs = (data && data.attributes) || {};
  const turl = typeof attrs.full_challonge_url === 'string' ? attrs.full_challonge_url
    : typeof attrs.url === 'string' ? 'https://challonge.com/' + attrs.url : '';
  if (tid === null || !/^https:\/\/([a-z0-9-]+\.)?challonge\.com\//.test(turl)) {
    return err('challonge_error', 'Challonge の応答を読み取れませんでした。Challonge 上にトーナメントができていないか確認してください。', 'create:bad_response');
  }
  const t = { id: tid, url: turl };

  // 4. 参加者をまとめて入れる
  const added = await challongeApi(fetchFn, inp.challongeToken, '/tournaments/' + tid + '/participants/bulk_add.json', {
    data: { type: 'Participants', attributes: { participants: inp.participants.map((p) => ({ name: p.name, seed: p.seed, misc: p.misc })) } },
  });
  if (!added.ok) {
    return withTournament(err(added.code, 'トーナメントは作れましたが、参加者を入れられませんでした: ' + added.message, 'bulk_add:' + added.note), t);
  }

  // 5. D1 に登録 (取得待ちの一覧に載る)
  const ins = await store.insertClassBracket({
    created_at: formatIso(now, cfg.tsOffsetMin), ts_ms: now, day,
    parent_event_id: inp.parentEventId, parent_tournament_id: adm.tournamentId,
    class_letter: inp.classLetter, name: inp.name, challonge_id: tid, challonge_url: turl,
    format: inp.format, counted: inp.counted ? 1 : 0, place_min: inp.placeMin, place_max: inp.placeMax,
    seeding: inp.seeding, entrant_count: inp.participants.length, registered_by: adm.userId,
  }, guard);
  if (ins.status !== 'ok') {
    const code = ins.status === 'duplicate' ? 'duplicate' : 'rate_limited';
    return withTournament(err(code, 'トーナメントは作れましたが、SPSP への登録に失敗しました。', 'insert:' + ins.status), t);
  }
  return ok({ id: ins.id, challonge: t });
}

/** action: "class_waitlist" — だれでも読める (中身は公開してよい欄だけ)。 */
export async function handleClassWaitlist(store: Store): Promise<HandlerResult> {
  return ok({ items: await store.listClassWaitlist() });
}

/** action: "class_done" — { key, id }。鍵は Worker の secret CLASS_DONE_KEY (未設定なら internal)。 */
export async function handleClassDone(cfg: Config, store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  const expected = requireSecret(cfg.classDoneKey, 'CLASS_DONE_KEY');
  if (!keyMatches(req.key, expected)) return err('auth_failed', '鍵が一致しません。');
  const id = posInt(req.id, 12);
  if (id === null) return err('bad_request', 'id の指定が不正です。');
  const r = await store.markClassDone(id);
  if (r === 'missing') return err('not_found', 'その id の登録はありません。');
  // TO が削除したもの: done にはしない。取得側は取り込んだ結果を捨てる (status:'deleted' で知らせる)
  return ok({ id, status: r });
}

const CURRENT_USER_QUERY = 'query SpspCurrentUser { currentUser { id } }';

/** start.gg のキーの持ち主のユーザー ID。 */
async function startggCurrentUser(fetchFn: FetchFn, token: string): Promise<{ ok: true; userId: string } | { ok: false; note: string }> {
  const r = await startggGql(fetchFn, token, CURRENT_USER_QUERY, {});
  if (!r.ok) return { ok: false, note: r.note };
  const cu = r.json && r.json.data ? (r.json.data.currentUser as { id?: unknown } | null) : null;
  if (!cu || cu.id === undefined || cu.id === null) {
    return { ok: false, note: Array.isArray(r.json.errors) && r.json.errors.length ? 'gql_error' : 'no_user' };
  }
  return { ok: true, userId: String(cu.id) };
}

function tokenOk(v: unknown, max: number): v is string {
  return typeof v === 'string' && !!v && v.length <= max && !/\s/.test(v);
}

/** action: "class_mine" — { startgg_token }。自分 (start.gg の本人) が作った直近 60 日の下位クラス (削除したものは除く、新しい順)。 */
export async function handleClassMine(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (!tokenOk(req.startgg_token, TOKEN_MAX)) return err('bad_request', MSG_BAD, 'bad:startgg_token');
  const me = await startggCurrentUser(fetchFn, req.startgg_token);
  if (!me.ok) return err('startgg_error', startggMessage(me.note), me.note);
  const day = dayKey(now, cfg.tsOffsetMin);
  if (!(await store.recordClassAction('mine', { userId: me.userId, nowMs: now, minIntervalMs: CLASS_MINE_MIN_INTERVAL_MS, dayKey: day, maxPerDay: CLASS_MINE_MAX_PER_DAY }))) {
    return err('rate_limited', '間隔が短すぎます。少し待ってからやり直してください。', 'rate');
  }
  return ok({ items: await store.listClassMine(me.userId, now - CLASS_MINE_DAYS * 24 * 3600 * 1000) });
}

/**
 * action: "class_delete" — { startgg_token, challonge_token, id }。
 * 作った本人 (registered_by) か、本戦の大会の TO (class_create と同じ判定) だけ。取得済み (done) は消さない (already_imported)。
 * Challonge のトーナメントを TO のトークンで消してから (404 = もう無いは続ける)、D1 を deleted にする。
 */
export async function handleClassDelete(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (!tokenOk(req.startgg_token, TOKEN_MAX)) return err('bad_request', MSG_BAD, 'bad:startgg_token');
  if (!tokenOk(req.challonge_token, 4096)) return err('bad_request', MSG_BAD, 'bad:challonge_token');
  const id = posInt(req.id, 12);
  if (id === null) return err('bad_request', MSG_BAD, 'bad:id');

  const me = await startggCurrentUser(fetchFn, req.startgg_token);
  if (!me.ok) return err('startgg_error', startggMessage(me.note), me.note);
  const day = dayKey(now, cfg.tsOffsetMin);
  if (!(await store.recordClassAction('delete', { userId: me.userId, nowMs: now, minIntervalMs: CLASS_DELETE_MIN_INTERVAL_MS, dayKey: day, maxPerDay: CLASS_DELETE_MAX_PER_DAY }))) {
    return err('rate_limited', '間隔が短すぎます。少し待ってからやり直してください。', 'rate');
  }

  const row = await store.getClassBracket(id);
  if (!row || row.status === 'deleted') return err('not_found', 'その下位クラスはありません (削除済みかもしれません)。', 'not_found');
  if (row.registered_by !== me.userId) {
    const adm = await checkStartggAdmin(fetchFn, req.startgg_token, row.parent_event_id);
    if (!adm.ok) {
      if (adm.code === 'not_admin') return err('not_admin', 'この下位クラスを作った人か、本戦の大会の管理者だけが削除できます。', adm.note);
      if (adm.code === 'bad_request') return err('not_admin', 'この下位クラスを作った人か、本戦の大会の管理者だけが削除できます。', adm.note);
      return err('startgg_error', startggMessage(adm.note), adm.note);
    }
  }
  if (row.status === 'done') {
    return err('already_imported', 'この下位クラスはもう SPSP に取り込まれているため削除できません。', 'already_imported');
  }

  const path = '/tournaments/' + row.challonge_id;
  let del = await challongeApi(fetchFn, req.challonge_token, path + '.json', null, 'DELETE');
  if (!del.ok && del.status === 422) {
    // 終了済み (complete) や進行中 (underway) は消せない (422「revert the tournament to pending before deleting」)。
    // 状態をリセット (pending に戻す) してから消し直す (取得側が実物で確認、2026-10-01)
    const reset = await challongeApi(fetchFn, req.challonge_token, path + '/change_state.json',
      { data: { type: 'TournamentState', attributes: { state: 'reset' } } }, 'PUT');
    if (!reset.ok) {
      return err(reset.code, reset.code === 'challonge_auth' ? reset.message : 'Challonge のトーナメントを削除できませんでした: ' + reset.message, 'reset:' + reset.note);
    }
    del = await challongeApi(fetchFn, req.challonge_token, path + '.json', null, 'DELETE');
  }
  if (!del.ok && del.status !== 404) {
    return err(del.code, del.code === 'challonge_auth' ? del.message : 'Challonge のトーナメントを削除できませんでした: ' + del.message, 'delete:' + del.note);
  }
  const m = await store.markClassDeleted(id, formatIso(now, cfg.tsOffsetMin));
  if (m === 'done') {
    // Challonge を消している間に取得側が取り込み終えた (まれ)
    return err('already_imported', 'Challonge のトーナメントは削除しましたが、直前に SPSP に取り込まれていました。', 'already_imported_race');
  }
  if (m === 'missing') return err('not_found', 'その下位クラスはありません (削除済みかもしれません)。', 'not_found_race');
  return ok({ id });
}
