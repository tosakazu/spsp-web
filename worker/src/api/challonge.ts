/**
 * Challonge OAuth と API v2.1 (下位クラスを TO の Challonge アカウントで作る。docs/class_bracket_design.md)。
 *
 *   action: "challonge_begin"  { nonce, returnPath, tournament_id? | app? }  → { url, app }
 *                              (Challonge の認可画面。client_id と scope は Worker が持つ)
 *   action: "challonge_token"  { code, state }        → { access_token, expires_in, app, app_tag }  (state は f='challonge' で単回使用)
 *   action: "challonge_app"    { tournament_id }      → { app }  (その大会で使う Challonge アプリの番号)
 *
 * Challonge アプリを複数使う (2026-11): Challonge の API は 1 アプリあたりの回数の上限が小さい (30 日 500 回) ので、アプリを複数持ち、
 * 大会ごとに使い分ける。トークンはログインしたアプリのもので、そのアプリで作ったトーナメントにしか使えない。
 *   - どのアプリを使うか (challongeAppFor): その大会にもう下位クラスがあればそれと同じアプリ。無ければ、直近 30 日に作った
 *     下位クラスの人数の合計がいちばん少ないアプリ (同じなら番号の小さいほう)
 *   - challonge_token は、トークンがどのアプリのものかの印 (app_tag = アプリの番号とトークンの SHA-256 への署名) を返す。
 *     ブラウザはトークンと一緒に持ち、class_create などに添える (Worker はトークンからアプリを知る方法が無い)
 *
 * TO の Challonge トークンは保存しない・ログに出さない (errors の note は http_401 などの符号だけ)。
 * SPSP のアプリ経由で作ったトーナメントは、取得側 (smash_database) が client credentials で読める。
 */
import type { Config } from '../config.ts';
import {
  CHALLONGE_API, CHALLONGE_APP_LOAD_DAYS, CHALLONGE_APPS_MAX, CHALLONGE_AUTHORIZE_URL, CHALLONGE_SCOPE, CHALLONGE_TIMEOUT_MS,
  CHALLONGE_TOKEN_URL, requireSecret,
} from '../config.ts';
import type { Store } from '../store.ts';
import type { FetchFn } from './oauth.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { base64UrlEncode, checkStateToken, signPayload, signState, timingSafeEq, utf8ToBase64Url } from './session.ts';

/** 使える Challonge アプリ (番号順)。0 = 最初からあるもの (CHALLONGE_CLIENT_ID)、1〜 = CHALLONGE_CLIENT_ID_<n> */
export function challongeApps(cfg: Config): { n: number; clientId: string; clientSecret?: string }[] {
  const out: { n: number; clientId: string; clientSecret?: string }[] = [];
  if (cfg.challongeClientId) out.push({ n: 0, clientId: cfg.challongeClientId, clientSecret: cfg.challongeClientSecret });
  for (const a of cfg.challongeMoreApps || []) if (a.n > 0 && !out.some((x) => x.n === a.n)) out.push(a);
  return out.sort((a, b) => a.n - b.n);
}

/** アプリの番号 (0〜CHALLONGE_APPS_MAX-1 の整数。数字の文字列も可)。違えば null */
export function appNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,2}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 0 && n < CHALLONGE_APPS_MAX ? n : null;
}

/**
 * その大会 (start.gg の大会 ID。分からなければ null) で使う Challonge アプリの番号。
 *   1. その大会にもう下位クラスがあれば、それを作ったアプリ (設定から外れていなければ)
 *   2. 無ければ、新しい大会に割り当ててよいアプリ (CHALLONGE_NEW_APPS、無ければ全部) のうち、直近 CHALLONGE_APP_LOAD_DAYS 日に
 *      作った下位クラスの人数の合計がいちばん少ないもの (同じなら番号の小さいほう)。人数 ≒ 試合の数 ≒ 結果報告で Challonge を呼ぶ回数
 * アプリが 1 つなら D1 は読まない。
 */
export async function challongeAppFor(cfg: Config, store: Store, tournamentId: number | null, now: number): Promise<number> {
  const apps = challongeApps(cfg);
  if (apps.length <= 1) return apps.length ? apps[0].n : 0;
  if (tournamentId !== null) {
    const sticky = await store.classAppOfTournament(tournamentId);
    if (sticky !== null && apps.some((a) => a.n === sticky)) return sticky;
  }
  const allow = cfg.challongeNewApps;
  const pool = allow ? apps.filter((a) => allow.includes(a.n)) : apps;
  const cand = pool.length ? pool : apps;
  if (cand.length === 1) return cand[0].n;
  const loads = new Map((await store.classAppLoads(now - CHALLONGE_APP_LOAD_DAYS * 24 * 3600 * 1000)).map((x) => [x.app, x.load]));
  let best = cand[0];
  for (const a of cand) if ((loads.get(a.n) || 0) < (loads.get(best.n) || 0)) best = a;
  return best.n;
}

/** トークンがどのアプリのものかの印: アプリの番号とトークンの SHA-256 への署名 (トークンそのものは入らない) */
export async function challongeAppTag(cfg: Config, app: number, token: string): Promise<string> {
  const h = base64UrlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
  return signPayload(cfg, utf8ToBase64Url('chapp.' + app + '.' + h));
}

/**
 * 要求に添えられた、トークンのアプリの番号 (challonge_app と challonge_app_tag)。
 * どちらも無ければ 0 (アプリが 1 つだった頃にログインしたトークン・古い画面)。印が合わなければ null。
 */
export async function tokenApp(cfg: Config, req: Record<string, unknown>, token: string): Promise<number | null> {
  if ((req.challonge_app === undefined || req.challonge_app === null) && !req.challonge_app_tag) return 0;
  const app = appNumber(req.challonge_app);
  if (app === null || typeof req.challonge_app_tag !== 'string' || req.challonge_app_tag.length > 200) return null;
  return timingSafeEq(req.challonge_app_tag, await challongeAppTag(cfg, app, token)) ? app : null;
}

/** ログインしているアプリと、その下位クラスを作ったアプリが違うとき */
export const MSG_WRONG_APP = 'この下位クラスは、今ログインしているものとは別の Challonge 連携で作られています。もう一度 Challonge でログインしてください。';

function tournamentIdOf(v: unknown): number | null {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : '') : typeof v === 'string' ? v : '';
  return /^[1-9]\d{0,11}$/.test(s) ? Number(s) : null;
}

/**
 * action: "challonge_begin" — 署名 state (f='challonge'、a = アプリの番号) つきの認可 URL を返す。
 * app (番号) があればそのアプリ (もうある下位クラスの削除・結果報告の受付のため)、無ければ tournament_id の大会で使うアプリ。
 */
export async function handleChallongeBegin(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const nonce = String(req && req.nonce ? req.nonce : '');
  const ret = String(req && req.returnPath ? req.returnPath : '');
  if (nonce.length > 128 || ret.length > 512) return err('bad_request', 'パラメータが長すぎます。');
  requireSecret(cfg.challongeClientId, 'CHALLONGE_CLIENT_ID');
  if (!cfg.challongeRedirectUri) requireSecret(undefined, 'CHALLONGE_REDIRECT_URI');
  const apps = challongeApps(cfg);
  let n: number;
  if (req.app !== undefined && req.app !== null) {
    const want = appNumber(req.app);
    if (want === null || !apps.some((a) => a.n === want)) return err('bad_request', 'その Challonge 連携は使えません。', 'bad:app');
    n = want;
  } else {
    n = await challongeAppFor(cfg, store, tournamentIdOf(req.tournament_id), now);
  }
  const app = apps.find((a) => a.n === n) || apps[0];
  const state = await signState(cfg, nonce, ret, 'challonge', now, null, app.n);
  const q = new URLSearchParams({
    client_id: app.clientId, redirect_uri: cfg.challongeRedirectUri || '', response_type: 'code', scope: CHALLONGE_SCOPE, state,
  });
  return ok({ url: CHALLONGE_AUTHORIZE_URL + '?' + q.toString(), ttlMs: cfg.stateTtlMs, app: app.n });
}

/** action: "challonge_app" — { tournament_id } → { app }。その大会で使う Challonge アプリの番号 (読むだけ・だれでも) */
export async function handleChallongeApp(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const tid = tournamentIdOf(req.tournament_id);
  if (tid === null) return err('bad_request', '入力の形式が不正です。', 'bad:tournament_id');
  return ok({ app: await challongeAppFor(cfg, store, tid, now) });
}

const MSG_STATE = '認証の照合に失敗しました。認証を始めてから時間が経ちすぎたか、同じリンクを二度開いた可能性があります。'
  + '下位クラスのページからやり直してください。';

/** action: "challonge_token" — code を access token に換えて返す (保存しない)。 */
export async function handleChallongeToken(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || !req.code || req.code.length > 1024) return err('bad_request', '認証コードがありません。');
  const st = await checkStateToken(cfg, store, req.state, true, now);
  if ('reason' in st) return err('state_invalid', MSG_STATE, st.reason);
  if (st.payload.f !== 'challonge') return err('state_invalid', MSG_STATE, 'wrong_flow');

  // どのアプリで始めたログインか (state の a。無ければ 0)。code はそのアプリでしか交換できない
  const appN = appNumber(st.payload.a === undefined ? 0 : st.payload.a);
  const app = appN === null ? undefined : challongeApps(cfg).find((a) => a.n === appN);
  if (appN !== 0 && !app) return err('challonge_error', 'この Challonge 連携は今は使えません。もう一度 Challonge でログインしてください。', 'app_gone');
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code: req.code,
    client_id: requireSecret(app ? app.clientId : cfg.challongeClientId, 'CHALLONGE_CLIENT_ID'),
    client_secret: requireSecret(app ? app.clientSecret : cfg.challongeClientSecret, 'CHALLONGE_CLIENT_SECRET'),
    redirect_uri: cfg.challongeRedirectUri || '',
  });
  let res: Response;
  try {
    res = await fetchFn(CHALLONGE_TOKEN_URL, {
      method: 'POST',
      // Accept が無いと Challonge が 520 を返したことがある (取得側の確認、2026-10-01)
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
      signal: AbortSignal.timeout(CHALLONGE_TIMEOUT_MS),
    });
  } catch (ex) {
    return err('challonge_error', 'Challonge に接続できませんでした。時間をおいてやり直してください。', netNote(ex));
  }
  if (res.status === 400 || res.status === 401) {
    // 期限切れ・使用済みの code (invalid_grant) など。応答の本文は code を反射しうるので読まない
    return err('challonge_auth', 'Challonge の認証が期限切れか使用済みでした。もう一度ログインしてください。', 'http_' + res.status);
  }
  if (res.status !== 200) return err('challonge_error', 'Challonge の認証に失敗しました。時間をおいてやり直してください。', 'http_' + res.status);
  let json: { access_token?: unknown; expires_in?: unknown };
  try {
    json = await res.json();
  } catch (_) {
    return err('challonge_error', 'Challonge の認証に失敗しました。時間をおいてやり直してください。', 'bad_json');
  }
  if (!json || typeof json.access_token !== 'string' || !json.access_token) {
    return err('challonge_error', 'Challonge の認証に失敗しました。時間をおいてやり直してください。', 'no_token');
  }
  const exp = Number(json.expires_in);
  // 画面の「<名前> でログイン中」用。取れなくてもログインは成功のまま (username: null)。保存・記録しない
  const me = await challongeMe(fetchFn, json.access_token);
  // 取れなかった理由は wrangler tail で見えるように符号だけ出す (トークン・名前は出さない)
  if ('note' in me) console.log('challonge_token: username unavailable: ' + me.note);
  return ok({ access_token: json.access_token, expires_in: Number.isFinite(exp) ? exp : null, username: 'username' in me ? me.username : null,
    app: appN || 0, app_tag: await challongeAppTag(cfg, appN || 0, json.access_token) });
}

/**
 * GET /v2.1/me.json のアカウント名 (username → name → email)。取れなければ理由の符号 (http_403 / no_username:keys=… 等)。
 * 応答は JSON:API の {data:{attributes:{…}}} のはずだが、data が配列・attributes 無しの形も一応見る。
 * no_username の note には attributes の **キー名だけ** を入れる (値は入れない)。
 */
export async function challongeMe(fetchFn: FetchFn, token: string): Promise<{ username: string } | { note: string; code: 'challonge_auth' | 'challonge_error' }> {
  const r = await challongeApi(fetchFn, token, '/me.json', null, 'GET');
  if (!r.ok) return { note: r.note, code: r.code };
  let d: unknown = r.json.data;
  if (Array.isArray(d)) d = d[0];
  const obj = (d && typeof d === 'object' ? d : r.json) as Record<string, unknown>;
  const a = (obj.attributes && typeof obj.attributes === 'object' ? obj.attributes : obj) as Record<string, unknown>;
  for (const k of ['username', 'name', 'email']) {
    const v = a[k];
    if (typeof v === 'string' && v.trim()) return { username: v.trim().slice(0, 100) };
  }
  const keys = Object.keys(a).filter((k) => /^[a-z_]{1,30}$/i.test(k)).slice(0, 12).join(',');
  return { note: 'no_username:keys=' + keys, code: 'challonge_error' };
}

/** 後方互換: 名前だけ (取れなければ null)。 */
export async function challongeUsername(fetchFn: FetchFn, token: string): Promise<string | null> {
  const m = await challongeMe(fetchFn, token);
  return 'username' in m ? m.username : null;
}

/** action: "challonge_me" — { challonge_token } → { username }。ブラウザからは me.json の応答を読めない (CORS) ため Worker 経由。 */
export async function handleChallongeMe(fetchFn: FetchFn, req: Record<string, unknown>): Promise<HandlerResult> {
  const t = req.challonge_token;
  if (typeof t !== 'string' || !t || t.length > 4096 || /\s/.test(t)) return err('bad_request', 'Challonge のトークンがありません。', 'bad:challonge_token');
  const m = await challongeMe(fetchFn, t);
  if ('username' in m) return ok({ username: m.username });
  if (m.code === 'challonge_auth') {
    return err('challonge_auth', 'Challonge のログインが無効か期限切れです。もう一度 Challonge でログインしてください。', 'me:' + m.note);
  }
  return err('challonge_error', 'Challonge のアカウント名を取得できませんでした。', 'me:' + m.note);
}

export function netNote(ex: unknown): string {
  return ex instanceof Error && (ex.name === 'TimeoutError' || ex.name === 'AbortError') ? 'timeout' : 'network';
}

/** Challonge API v2.1 の 1 回の呼び出しの結果。失敗は code (challonge_auth / challonge_error) と、利用者に見せる Challonge の文言。 */
export type ChallongeCall =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; code: 'challonge_auth' | 'challonge_error'; message: string; note: string; status?: number };

/** JSON:API の errors から Challonge の文言を取り出す (長すぎれば切る)。 */
export function challongeErrorText(json: unknown): string {
  const errs = json && typeof json === 'object' ? (json as { errors?: unknown }).errors : undefined;
  const parts: string[] = [];
  if (Array.isArray(errs)) {
    for (const e of errs) {
      if (typeof e === 'string') parts.push(e);
      else if (e && typeof e === 'object') {
        const o = e as { detail?: unknown; title?: unknown };
        const t = typeof o.detail === 'string' ? o.detail : typeof o.title === 'string' ? o.title : '';
        if (t) parts.push(t);
      }
    }
  } else if (errs && typeof errs === 'object') {
    for (const [k, v] of Object.entries(errs as Record<string, unknown>)) parts.push(k + ': ' + (Array.isArray(v) ? v.join(', ') : String(v)));
  }
  return parts.join(' / ').slice(0, 300);
}

/** Challonge API v2.1 を TO のトークンで呼ぶ。トークンは Authorization ヘッダにだけ入れる。DELETE は payload 無し。 */
export async function challongeApi(fetchFn: FetchFn, token: string, path: string, payload: unknown, method: 'POST' | 'PUT' | 'DELETE' | 'GET' = 'POST'): Promise<ChallongeCall> {
  let res: Response;
  try {
    res = await fetchFn(CHALLONGE_API + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token, 'Authorization-Type': 'v2',
        'Content-Type': 'application/vnd.api+json', Accept: 'application/json',
      },
      body: method === 'POST' || method === 'PUT' ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(CHALLONGE_TIMEOUT_MS),
    });
  } catch (ex) {
    return { ok: false, code: 'challonge_error', message: 'Challonge に接続できませんでした。時間をおいてやり直してください。', note: netNote(ex) };
  }
  // DELETE は本文が空 (204) のことがある
  if (method === 'DELETE' && res.status >= 200 && res.status < 300) return { ok: true, json: {} };
  let json: Record<string, unknown> | null = null;
  try {
    json = await res.json();
  } catch (_) {
    json = null;
  }
  if (res.status === 401) {
    return { ok: false, code: 'challonge_auth', message: 'Challonge のログインが無効か期限切れです。もう一度 Challonge でログインしてください。', note: 'http_401', status: 401 };
  }
  if (res.status < 200 || res.status >= 300 || !json) {
    const text = json ? challongeErrorText(json) : '';
    return { ok: false, code: 'challonge_error', message: text || ('Challonge がエラーを返しました (HTTP ' + res.status + ')。'), note: 'http_' + res.status, status: res.status };
  }
  return { ok: true, json };
}
