/**
 * 投稿本編 (gas/main.gs handlePost_ の移植。投稿機能は未公開だが経路は残す)。
 *
 *   入力検証 → state 検証 → token 交換 → currentUser 照会 → スパム判定 → append
 *
 * INV-1: 保存する名前/ID は currentUser のレスポンス由来のものだけ。
 * INV-2: currentUser が取れなければ何も書かない。
 * INV-4: access token / code はローカル変数のみ。ログにも保存にも出さない。
 */
import type { Config } from '../config.ts';
import { BODY_MAX, BODY_MIN } from '../config.ts';
import type { Store } from '../store.ts';
import type { FetchFn } from './oauth.ts';
import { authenticateCode, oauthErrorMessage } from './oauth.ts';
import { checkRateLimit, guardFor } from './ratelimit.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { verifyState } from './session.ts';
import { dayKey, formatIso } from './time.ts';

/**
 * 制御文字を除去する。HTML タグは残す (表示時にビルド側でエスケープする前提)。
 * 改行とタブは残し、CRLF/CR は LF に正規化する。前後の空白は落とす。
 * 落とすのは C0 (TAB/LF を除く) / DEL / C1。
 */
export function sanitizeBody(s: unknown): string {
  const t = String(s).replace(/\r\n?/g, '\n');
  let out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 9 || c === 10) { out += t.charAt(i); continue; }
    if (c < 32) continue;
    if (c >= 127 && c <= 159) continue;
    out += t.charAt(i);
  }
  return out.trim();
}

export async function handlePost(cfg: Config, store: Store, fetchFn: FetchFn, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  // ── 1. 入力検証 ──
  if (typeof req.code !== 'string' || req.code.length === 0) {
    return err('bad_request', '認証コードがありません。');
  }
  if (typeof req.body !== 'string') {
    return err('body_invalid', '本文がありません。');
  }
  const body = sanitizeBody(req.body);
  if (body.length < BODY_MIN) {
    return err('body_invalid', '本文が空です。');
  }
  if (body.length > BODY_MAX) {
    return err('body_invalid', '本文が長すぎます (' + BODY_MAX + '文字まで)。');
  }

  if (!(await verifyState(cfg, store, req.state, true, now))) {
    return err('state_invalid',
      '認証の照合に失敗しました。時間が経ちすぎたか、同じリンクを二度開いた可能性があります。'
      + '投稿ページからやり直してください。');
  }

  // ── 2-3. start.gg で本人確認 ──
  const auth = await authenticateCode(cfg, req.code, fetchFn);
  if (!auth.user) {
    return err('auth_failed', oauthErrorMessage(auth.reason), auth.reason || '');
  }
  const user = auth.user;

  // ── 4-5. スパム判定と append (条件付き INSERT で直列化) ──
  const day = dayKey(now, cfg.tsOffsetMin);
  const limited = await checkRateLimit(store, 'posts', user.id, now, day);
  if (limited) {
    return err('rate_limited', limited);
  }
  const inserted = await store.insertPost({
    ts: formatIso(now, cfg.tsOffsetMin), ts_ms: now,
    user_id: user.id, user_slug: user.slug, gamer_tag: user.gamerTag,
    body, status: 'pending',
  }, guardFor(user.id, now, day));
  if (!inserted) {
    // 同時に別の投稿が先に入った (ロックで直列化していたのと同じ結果にする)
    const again = await checkRateLimit(store, 'posts', user.id, now, day);
    return err('rate_limited', again || '投稿の間隔が短すぎます。1分ほど待ってからやり直してください。');
  }

  return ok({ user: user.slug });
}
