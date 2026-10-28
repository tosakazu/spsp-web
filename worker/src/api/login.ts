/** action: "login" — code を検証してセッショントークンを返す (gas/session.gs handleLogin_)。 */
import type { Config } from '../config.ts';
import { AUTHORIZE_URL, MANAGER_SCOPE, requireClientId } from '../config.ts';
import type { Store } from '../store.ts';
import type { FetchFn } from './oauth.ts';
import { authenticateCode, exchangeCodeForToken, fetchCurrentUser, oauthErrorMessage } from './oauth.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { checkStateToken, issueSessionToken, signState, verifySessionToken } from './session.ts';

export async function handleLogin(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || req.code.length === 0) {
    return err('bad_request', '認証コードがありません。');
  }
  // 署名 state の検証 (ここで単回使用にする)。
  const st0 = await checkStateToken(cfg, store, req.state, true, now);
  // Challonge 用 (f='challonge')・大会運営用 (f='manager'、scope が違う) の state はここでは使わせない
  const st = 'payload' in st0 && (st0.payload.f === 'challonge' || st0.payload.f === 'manager') ? { reason: 'wrong_flow' as const } : st0;
  if ('reason' in st) {
    return err('state_invalid',
      '認証の照合に失敗しました。認証を始めてから時間が経ちすぎたか、'
      + '同じリンクを二度開いた可能性があります。投票ページからやり直してください。', st.reason);
  }
  const auth = await authenticateCode(cfg, req.code, fetchFn);
  if (!auth.user) {
    // 何が起きたのかを可能な範囲で伝える (期限切れ / start.gg 障害 / 通信断)。
    return err('auth_failed', oauthErrorMessage(auth.reason), auth.reason || '');
  }
  const token = await issueSessionToken(cfg, auth.user, now);
  const sess = await verifySessionToken(cfg, token, now); // exp を取り出すついでに自己検証
  return ok({
    token,
    user: { id: auth.user.id, slug: auth.user.slug, gamerTag: auth.user.gamerTag },
    exp: sess ? sess.exp : null,
  });
}

/*
 * 大会運営用の start.gg ログイン (シード作成・下位クラス作成で API キーの代わりに使う)。
 *   action: "manager_begin" { nonce, returnPath } → { url }  (scope = MANAGER_SCOPE の認可画面。state は f='manager')
 *   action: "manager_login" { code, state }       → { token, user, exp, access_token, expires_in }
 * 普段のログインと違い、start.gg のアクセストークンをブラウザに返す (ページが start.gg の API を直接呼ぶため)。
 * Worker はトークンを保存しない・ログに出さない。普段のログインのセッションも同時に発行する。
 */
const MSG_MANAGER_STATE = '認証の照合に失敗しました。認証を始めてから時間が経ちすぎたか、'
  + '同じリンクを二度開いた可能性があります。元のページからやり直してください。';

export async function handleManagerBegin(cfg: Config, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  const nonce = String(req && req.nonce ? req.nonce : '');
  const ret = String(req && req.returnPath ? req.returnPath : '');
  if (nonce.length > 128 || ret.length > 512) return err('bad_request', 'パラメータが長すぎます。');
  const state = await signState(cfg, nonce, ret, 'manager', now);
  const q = new URLSearchParams({
    response_type: 'code', client_id: requireClientId(cfg), scope: MANAGER_SCOPE, redirect_uri: cfg.redirectUri, state,
  });
  return ok({ url: AUTHORIZE_URL + '?' + q.toString(), ttlMs: cfg.stateTtlMs });
}

export async function handleManagerLogin(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || !req.code || req.code.length > 1024) return err('bad_request', '認証コードがありません。');
  const code = req.code;
  const st = await checkStateToken(cfg, store, req.state, true, now);
  if ('reason' in st) return err('state_invalid', MSG_MANAGER_STATE, st.reason);
  if (st.payload.f !== 'manager') return err('state_invalid', MSG_MANAGER_STATE, 'wrong_flow');
  const ex = await exchangeCodeForToken(cfg, code, fetchFn, MANAGER_SCOPE);
  if (!ex.token) return err('auth_failed', oauthErrorMessage(ex.reason), ex.reason || '');
  const user = await fetchCurrentUser(ex.token, fetchFn);
  if (!user) return err('auth_failed', oauthErrorMessage('no_user'), 'no_user');
  const token = await issueSessionToken(cfg, user, now);
  const sess = await verifySessionToken(cfg, token, now);
  return ok({
    token,
    user: { id: user.id, slug: user.slug, gamerTag: user.gamerTag },
    exp: sess ? sess.exp : null,
    access_token: ex.token,
    expires_in: ex.expiresIn,
  });
}
