/** action: "login" — code を検証してセッショントークンを返す (gas/session.gs handleLogin_)。 */
import type { Config } from '../config.ts';
import type { Store } from '../store.ts';
import type { FetchFn } from './oauth.ts';
import { authenticateCode, oauthErrorMessage } from './oauth.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { issueSessionToken, verifySessionToken, verifyState } from './session.ts';

export async function handleLogin(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  if (typeof req.code !== 'string' || req.code.length === 0) {
    return err('bad_request', '認証コードがありません。');
  }
  // 署名 state の検証 (ここで単回使用にする)。
  if (!(await verifyState(cfg, store, req.state, true, now))) {
    return err('state_invalid',
      '認証の照合に失敗しました。認証を始めてから時間が経ちすぎたか、'
      + '同じリンクを二度開いた可能性があります。投票ページからやり直してください。');
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
