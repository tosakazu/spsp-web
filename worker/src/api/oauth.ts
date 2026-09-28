/**
 * start.gg OAuth2 — 認可コードの交換と本人照会 (gas/oauth.gs の移植)。
 *
 *   - token エンドポイントは POST https://api.start.gg/oauth/access_token
 *   - Content-Type: application/json で、パラメータは JSON body に入れる
 *   - body のキーは grant_type / client_id / client_secret / code / scope / redirect_uri
 *   - 応答は { access_token, token_type: "Bearer", expires_in, refresh_token }
 * refresh token は使わない (1 回きりの本人確認なので破棄する。INV-4)。
 *
 * GAS はグローバル LAST_OAUTH_ERROR で失敗理由を伝えていたが、Worker は同時に
 * 複数リクエストを処理するので返り値で伝える。
 */
import type { Config } from '../config.ts';
import { GQL_URL, SCOPE, TOKEN_URL, requireClientId, requireSecret } from '../config.ts';
import type { SessionUser } from './session.ts';

/** 失敗理由。秘密は入れない。 */
export type OauthReason = 'code_invalid' | 'auth_rejected' | 'startgg_down' | 'network' | 'exchange_failed' | 'no_user';

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** 失敗理由に応じた利用者向けメッセージ。原因が分からないときは汎用文。 */
export function oauthErrorMessage(reason: string | null | undefined): string {
  switch (reason) {
    case 'code_invalid':
      return 'start.gg の認証情報が期限切れか、既に使用済みでした。'
        + 'ブラウザの「戻る」で認証画面に戻った場合や、認証してから時間が経った場合に起きます。'
        + 'もう一度最初から認証し直してください。';
    case 'auth_rejected':
      return 'start.gg に認証を拒否されました。'
        + '認証情報が期限切れか使用済みだった可能性が高いので、まずは最初からやり直してください。'
        + '何度やっても同じ場合は SPSP 側の設定の問題かもしれないので、X (@smash_tskz) までご連絡ください。';
    case 'startgg_down':
      return 'start.gg 側から正しい応答が返りませんでした。'
        + 'start.gg が混雑・障害中の可能性があります。時間をおいてやり直してください。';
    case 'network':
      return 'start.gg に接続できませんでした。時間をおいてやり直してください。';
    case 'no_user':
      return 'start.gg のアカウント情報を読み取れませんでした。'
        + 'start.gg にログインし直してから、もう一度お試しください。';
    default:
      return 'start.gg の認証に失敗しました。時間をおいてやり直してください。';
  }
}

export type ExchangeResult = { token: string; reason: null } | { token: null; reason: OauthReason };

/**
 * 認可コードを access token に交換する。
 * 失敗したら token: null と理由を返す (呼び出し側が auth_failed にする)。
 * code / secret / token は一切ログに出さない (INV-3 / INV-4)。
 */
export async function exchangeCodeForToken(cfg: Config, code: string, fetchFn: FetchFn): Promise<ExchangeResult> {
  const payload = {
    grant_type: 'authorization_code',
    client_id: requireClientId(cfg),
    client_secret: requireSecret(cfg.clientSecret, 'STARTGG_CLIENT_SECRET'),
    code,
    scope: SCOPE,
    redirect_uri: cfg.redirectUri,
  };

  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (ex) {
    console.error('token exchange threw: ' + (ex instanceof Error ? ex.message : String(ex)));
    return { token: null, reason: 'network' };
  }

  const status = res.status;
  if (status !== 200) {
    // 本文には code が反射される可能性があるのでステータスだけ記録する。
    console.error('token exchange failed: HTTP ' + status);
    // 401/403 は「code が無効」と「アプリ設定/遮断」の両方がありうるので分けておく
    // (start.gg は無効な認証情報に 403 を返すことがある)。
    const reason: OauthReason = (status === 401 || status === 403) ? 'auth_rejected'
      : (status >= 400 && status < 500) ? 'code_invalid'
      : (status >= 500) ? 'startgg_down'
      : 'exchange_failed';
    return { token: null, reason };
  }

  let json: { access_token?: unknown; error?: unknown } | null;
  try {
    json = await res.json();
  } catch (_) {
    console.error('token exchange: response was not JSON');
    return { token: null, reason: 'startgg_down' };
  }
  if (!json || typeof json.access_token !== 'string' || !json.access_token) {
    // start.gg は無効な code でも HTTP 200 を返し、本文側にだけ error を入れることがある。
    const oe = (json && typeof json.error === 'string') ? json.error : '';
    console.error('token exchange: access_token missing' + (oe ? ' (error=' + oe + ')' : ''));
    const reason: OauthReason = (oe === 'invalid_client' || oe === 'unauthorized_client') ? 'auth_rejected'
      : 'code_invalid';   // invalid_grant / 本文に手掛かり無し = code が無効か使用済み
    return { token: null, reason };
  }
  return { token: json.access_token, reason: null };
}

/**
 * access token の持ち主を照会する。
 * 返り値 { id, slug, gamerTag } / 取れなければ null (INV-2)。
 * ここで返ってきた値だけが保存される (INV-1)。
 */
export async function fetchCurrentUser(accessToken: string, fetchFn: FetchFn): Promise<SessionUser | null> {
  const query = 'query { currentUser { id slug player { gamerTag } } }';

  let res: Response;
  try {
    res = await fetchFn(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken },
      body: JSON.stringify({ query }),
    });
  } catch (ex) {
    console.error('currentUser threw: ' + (ex instanceof Error ? ex.message : String(ex)));
    return null;
  }

  if (res.status !== 200) {
    console.error('currentUser failed: HTTP ' + res.status);
    return null;
  }

  let json: { errors?: unknown; data?: { currentUser?: { id?: unknown; slug?: unknown; player?: { gamerTag?: unknown } | null } | null } } | null;
  try {
    json = await res.json();
  } catch (_) {
    console.error('currentUser: response was not JSON');
    return null;
  }
  if (json && json.errors) {
    console.error('currentUser: GraphQL errors');
    return null;
  }

  const u = json && json.data && json.data.currentUser;
  if (!u || u.id === null || u.id === undefined || u.id === '') {
    console.error('currentUser: null');
    return null; // INV-2
  }

  return {
    id: String(u.id),
    slug: typeof u.slug === 'string' ? u.slug : '',
    gamerTag: (u.player && typeof u.player.gamerTag === 'string') ? u.player.gamerTag : '',
  };
}

/**
 * code → access token → currentUser。login / post が共通で使う。
 * 失敗は { user: null, reason }。access token はこの関数の外に出さない (INV-4)。
 */
export async function authenticateCode(cfg: Config, code: string, fetchFn: FetchFn): Promise<{ user: SessionUser | null; reason: OauthReason | null }> {
  const ex = await exchangeCodeForToken(cfg, code, fetchFn);
  if (!ex.token) return { user: null, reason: ex.reason };
  const user = await fetchCurrentUser(ex.token, fetchFn);
  if (!user) return { user: null, reason: 'no_user' };
  return { user, reason: null };
}
