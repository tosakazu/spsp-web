/**
 * 下位クラス (Bクラス等) を Challonge で開いたものの登録と、取得側への受け渡し (docs/class_bracket_design.md)。
 *
 *   action: "class_register"  TO がページから登録する。start.gg の API キーで、本戦の大会の owner / admins か確かめ直す
 *   action: "class_waitlist"  取得待ち (counted かつ waiting) の一覧。公開してよい欄だけ (GET /api/class_waitlist)
 *   action: "class_done"      取得側 (smash_database) が取り終えたら呼ぶ。鍵 = Worker の secret CLASS_DONE_KEY
 *
 * start.gg の API キー (startgg_token) は確かめる問い合わせにだけ使い、保存しない・ログに出さない・応答に返さない。
 * 失敗の記録 (errors の note) にも理由の符号 (http_401 など) だけを入れる。
 */
import type { Config } from '../config.ts';
import { CLASS_RATE_MAX_PER_DAY, CLASS_RATE_MIN_INTERVAL_MS, GQL_URL, STARTGG_TIMEOUT_MS, requireSecret } from '../config.ts';
import type { Store } from '../store.ts';
import { keyMatches } from './export.ts';
import type { FetchFn } from './oauth.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { dayKey, formatIso } from './time.ts';

const CLASS_LETTERS = ['B', 'C', 'D', 'E'];
const FORMATS = ['single', 'double'];
const SEEDINGS = ['random', 'main_result', 'spsp'];
const NAME_MAX = 200;
const URL_MAX = 300;
const TOKEN_MAX = 200;

/** 正の整数 (数字の文字列も可、maxDigits 桁まで)。違えば null。 */
function posInt(v: unknown, maxDigits: number): number | null {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : '') : typeof v === 'string' ? v : '';
  return new RegExp('^[1-9]\\d{0,' + (maxDigits - 1) + '}$').test(s) ? Number(s) : null;
}

export interface ClassRegisterInput {
  token: string;
  parentEventId: number;
  classLetter: string;
  name: string;
  challongeId: number;
  challongeUrl: string;
  format: string;
  counted: boolean;
  placeMin: number;
  placeMax: number | null;
  seeding: string;
  entrantCount: number;
}

/** 入力を確かめる。違えば理由 (note 用の短い符号)。 */
export function parseClassRegister(r: Record<string, unknown>): { input: ClassRegisterInput } | { bad: string } {
  const token = r.startgg_token;
  if (typeof token !== 'string' || !token || token.length > TOKEN_MAX || /\s/.test(token)) return { bad: 'token' };
  const parentEventId = posInt(r.parent_event_id, 12);
  if (parentEventId === null) return { bad: 'parent_event_id' };
  if (typeof r.class_letter !== 'string' || !CLASS_LETTERS.includes(r.class_letter)) return { bad: 'class_letter' };
  const name = typeof r.name === 'string' ? r.name.trim() : '';
  if (!name || name.length > NAME_MAX) return { bad: 'name' };
  const ch = r.challonge as Record<string, unknown> | null | undefined;
  if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return { bad: 'challonge' };
  const challongeId = posInt(ch.id, 15);
  if (challongeId === null) return { bad: 'challonge_id' };
  const url = ch.url;
  if (typeof url !== 'string' || !url.startsWith('https://challonge.com/') || url.length > URL_MAX || /\s/.test(url)
      || url === 'https://challonge.com/') return { bad: 'challonge_url' };
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
  const entrantCount = posInt(r.entrant_count, 5);
  if (entrantCount === null) return { bad: 'entrant_count' };
  return { input: { token, parentEventId, classLetter: r.class_letter, name, challongeId, challongeUrl: url,
    format: r.format, counted: r.counted, placeMin, placeMax, seeding: r.seeding, entrantCount } };
}

const ADMIN_QUERY = `query SpspClassAdmin($eventId: ID!) {
  currentUser { id }
  event(id: $eventId) { id tournament { id owner { id } admins { id } } }
}`;

export type AdminCheck =
  | { ok: true; userId: string; tournamentId: number }
  | { ok: false; code: 'not_admin' | 'startgg_error' | 'bad_request'; note: string };

/**
 * start.gg に「このキーの持ち主は、このイベントの大会の owner か admins か」を問い合わせる。
 * キーは Authorization ヘッダにだけ入れる。本文・エラーの記録には入れない。
 */
export async function checkStartggAdmin(fetchFn: FetchFn, token: string, eventId: number): Promise<AdminCheck> {
  let res: Response;
  try {
    res = await fetchFn(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ query: ADMIN_QUERY, variables: { eventId: String(eventId) } }),
      signal: AbortSignal.timeout(STARTGG_TIMEOUT_MS),
    });
  } catch (ex) {
    const timeout = ex instanceof Error && (ex.name === 'TimeoutError' || ex.name === 'AbortError');
    return { ok: false, code: 'startgg_error', note: timeout ? 'timeout' : 'network' };
  }
  if (res.status !== 200) return { ok: false, code: 'startgg_error', note: 'http_' + res.status };
  let json: { data?: Record<string, unknown> | null; errors?: unknown[] };
  try {
    json = await res.json();
  } catch (_) {
    return { ok: false, code: 'startgg_error', note: 'bad_json' };
  }
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
  // admins は権限の無い人には null やエラーで返ることがある → owner と admins のどちらにもいなければ not_admin
  const ids: string[] = [];
  if (t.owner && t.owner.id !== undefined && t.owner.id !== null) ids.push(String(t.owner.id));
  if (Array.isArray(t.admins)) {
    for (const a of t.admins) if (a && (a as { id?: unknown }).id !== undefined) ids.push(String((a as { id: unknown }).id));
  }
  if (!ids.includes(userId)) return { ok: false, code: 'not_admin', note: 'not_admin' };
  return { ok: true, userId, tournamentId };
}

const MSG_BAD = '入力の形式が不正です。';

function startggMessage(note: string): string {
  if (note === 'http_401' || note === 'http_403' || note === 'no_user') {
    return 'start.gg の API キーが無効です。キーを確かめてやり直してください。';
  }
  if (note === 'http_429') return 'start.gg が混み合っています。少し待ってからやり直してください。';
  return 'start.gg に確認できませんでした。時間をおいてやり直してください。';
}

/** action: "class_register" */
export async function handleClassRegister(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const parsed = parseClassRegister(req);
  if ('bad' in parsed) return err('bad_request', MSG_BAD, 'bad:' + parsed.bad);
  const inp = parsed.input;

  // 二重登録は start.gg に問い合わせる前に弾く (登録そのものは下の INSERT でも UNIQUE で守る)
  if (await store.classExists(inp.challongeId)) {
    return err('duplicate', 'この Challonge のトーナメントはすでに登録されています。', 'duplicate');
  }

  const adm = await checkStartggAdmin(fetchFn, inp.token, inp.parentEventId);
  if (!adm.ok) {
    if (adm.code === 'not_admin') {
      return err('not_admin', 'この start.gg の API キーの持ち主は、本戦の大会の管理者ではありません。', adm.note);
    }
    if (adm.code === 'bad_request') return err('bad_request', '本戦のイベントが start.gg で見つかりません。', adm.note);
    return err('startgg_error', startggMessage(adm.note), adm.note);
  }

  const day = dayKey(now, cfg.tsOffsetMin);
  const ins = await store.insertClassBracket({
    created_at: formatIso(now, cfg.tsOffsetMin), ts_ms: now, day,
    parent_event_id: inp.parentEventId, parent_tournament_id: adm.tournamentId,
    class_letter: inp.classLetter, name: inp.name, challonge_id: inp.challongeId, challonge_url: inp.challongeUrl,
    format: inp.format, counted: inp.counted ? 1 : 0, place_min: inp.placeMin, place_max: inp.placeMax,
    seeding: inp.seeding, entrant_count: inp.entrantCount, registered_by: adm.userId,
  }, { userId: adm.userId, nowMs: now, minIntervalMs: CLASS_RATE_MIN_INTERVAL_MS, dayKey: day, maxPerDay: CLASS_RATE_MAX_PER_DAY });
  if (ins.status === 'duplicate') return err('duplicate', 'この Challonge のトーナメントはすでに登録されています。', 'duplicate');
  if (ins.status === 'rate_limited') return err('rate_limited', '登録の間隔が短すぎます。少し待ってからやり直してください。', 'rate');
  return ok({ id: ins.id });
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
  if (!(await store.markClassDone(id))) return err('not_found', 'その id の登録はありません。');
  return ok({ id, status: 'done' });
}
