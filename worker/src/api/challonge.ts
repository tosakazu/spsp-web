/**
 * Challonge OAuth と API v2.1 (下位クラスを TO の Challonge アカウントで作る。docs/class_bracket_design.md)。
 *
 *   action: "challonge_begin"  { nonce, returnPath }  → { url }  (Challonge の認可画面。client_id と scope は Worker が持つ)
 *   action: "challonge_token"  { code, state }        → { access_token, expires_in }  (state は f='challonge' で単回使用)
 *
 * TO の Challonge トークンは保存しない・ログに出さない (errors の note は http_401 などの符号だけ)。
 * SPSP のアプリ経由で作ったトーナメントは、取得側 (smash_database) が client credentials で読める。
 */
import type { Config } from '../config.ts';
import {
  CHALLONGE_API, CHALLONGE_AUTHORIZE_URL, CHALLONGE_SCOPE, CHALLONGE_TIMEOUT_MS, CHALLONGE_TOKEN_URL, requireSecret,
} from '../config.ts';
import type { Store } from '../store.ts';
import type { FetchFn } from './oauth.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { checkStateToken, signState } from './session.ts';

/** action: "challonge_begin" — 署名 state (f='challonge') つきの認可 URL を返す。 */
export async function handleChallongeBegin(cfg: Config, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const nonce = String(req && req.nonce ? req.nonce : '');
  const ret = String(req && req.returnPath ? req.returnPath : '');
  if (nonce.length > 128 || ret.length > 512) return err('bad_request', 'パラメータが長すぎます。');
  const clientId = requireSecret(cfg.challongeClientId, 'CHALLONGE_CLIENT_ID');
  if (!cfg.challongeRedirectUri) requireSecret(undefined, 'CHALLONGE_REDIRECT_URI');
  const state = await signState(cfg, nonce, ret, 'challonge', now);
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: cfg.challongeRedirectUri || '', response_type: 'code', scope: CHALLONGE_SCOPE, state,
  });
  return ok({ url: CHALLONGE_AUTHORIZE_URL + '?' + q.toString(), ttlMs: cfg.stateTtlMs });
}

const MSG_STATE = '認証の照合に失敗しました。認証を始めてから時間が経ちすぎたか、同じリンクを二度開いた可能性があります。'
  + '下位クラスのページからやり直してください。';

/** action: "challonge_token" — code を access token に換えて返す (保存しない)。 */
export async function handleChallongeToken(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || !req.code || req.code.length > 1024) return err('bad_request', '認証コードがありません。');
  const st = await checkStateToken(cfg, store, req.state, true, now);
  if ('reason' in st) return err('state_invalid', MSG_STATE, st.reason);
  if (st.payload.f !== 'challonge') return err('state_invalid', MSG_STATE, 'wrong_flow');

  const body = new URLSearchParams({
    grant_type: 'authorization_code', code: req.code,
    client_id: requireSecret(cfg.challongeClientId, 'CHALLONGE_CLIENT_ID'),
    client_secret: requireSecret(cfg.challongeClientSecret, 'CHALLONGE_CLIENT_SECRET'),
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
  return ok({ access_token: json.access_token, expires_in: Number.isFinite(exp) ? exp : null });
}

export function netNote(ex: unknown): string {
  return ex instanceof Error && (ex.name === 'TimeoutError' || ex.name === 'AbortError') ? 'timeout' : 'network';
}

/** Challonge API v2.1 の 1 回の呼び出しの結果。失敗は code (challonge_auth / challonge_error) と、利用者に見せる Challonge の文言。 */
export type ChallongeCall =
  | { ok: true; json: Record<string, unknown> }
  | { ok: false; code: 'challonge_auth' | 'challonge_error'; message: string; note: string };

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

/** Challonge API v2.1 を TO のトークンで呼ぶ。トークンは Authorization ヘッダにだけ入れる。 */
export async function challongeApi(fetchFn: FetchFn, token: string, path: string, payload: unknown): Promise<ChallongeCall> {
  let res: Response;
  try {
    res = await fetchFn(CHALLONGE_API + path, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token, 'Authorization-Type': 'v2',
        'Content-Type': 'application/vnd.api+json', Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(CHALLONGE_TIMEOUT_MS),
    });
  } catch (ex) {
    return { ok: false, code: 'challonge_error', message: 'Challonge に接続できませんでした。時間をおいてやり直してください。', note: netNote(ex) };
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = await res.json();
  } catch (_) {
    json = null;
  }
  if (res.status === 401) {
    return { ok: false, code: 'challonge_auth', message: 'Challonge のログインが無効か期限切れです。もう一度 Challonge でログインしてください。', note: 'http_401' };
  }
  if (res.status < 200 || res.status >= 300 || !json) {
    const text = json ? challongeErrorText(json) : '';
    return { ok: false, code: 'challonge_error', message: text || ('Challonge がエラーを返しました (HTTP ' + res.status + ')。'), note: 'http_' + res.status };
  }
  return { ok: true, json };
}
