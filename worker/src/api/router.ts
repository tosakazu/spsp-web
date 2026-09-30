/**
 * API の入口 (gas/main.gs doPost / doGet の移植)。
 *
 * クライアントは CORS preflight を避けるため Content-Type: text/plain で
 * JSON 文字列を POST してくる。GAS と同じく body を JSON.parse して action で分岐する。
 *
 * 経路:
 *   POST /api            body = { action, ... }              (GAS の /exec と同じ)
 *   POST /api/<action>   body に action が無ければパスから補う
 *   GET  /api/export/votes?key=&since=   = action export_votes
 *   GET  /api/export/errors?key=&limit=  = action export_errors
 *   GET  /api/card?uid=                  = action card_get (だれでも読める。60 秒キャッシュ可)
 *   GET  /api/class_waitlist             = action class_waitlist (下位クラスの取得待ち。だれでも読める)
 *   GET  それ以外        doGet と同じ bad_request
 * 応答は常に HTTP 200 の JSON (ビルド側の urllib が非 2xx を例外にするため)。
 */
import type { Config } from '../config.ts';
import type { Store } from '../store.ts';
import { handleCardGet, handleCardPut, handleMe } from './card.ts';
import { handleClassDone, handleClassRegister, handleClassWaitlist } from './class_bracket.ts';
import { handleClientError, logError } from './errlog.ts';
import { handleExportErrors, handleExportVotes } from './export.ts';
import { handleLogin } from './login.ts';
import type { FetchFn } from './oauth.ts';
import { handlePost } from './post.ts';
import type { ApiBody, HandlerResult } from './respond.ts';
import { err, isErr } from './respond.ts';
import { handleBeginLogin, verifySessionToken } from './session.ts';
import type { DataFetch } from './vote.ts';
import { handleVote } from './vote.ts';

/** ハンドラが要るもの一式。テストでは fetch / dataFetch / now を差し替える。 */
export interface ApiContext {
  cfg: Config;
  store: Store;
  fetch: FetchFn;
  dataFetch: DataFetch;
  now: () => number;
}

/** POST body の上限 (投稿本文 1000 文字 + token 等で十分)。 */
export const MAX_BODY_BYTES = 64 * 1024;

const MSG_BAD_FORMAT = 'リクエストの形式が不正です。';

/**
 * 1 リクエスト分の処理 (doPost)。req は JSON.parse 済みの body (壊れていれば null)。
 * 例外は握りつぶさない。ただし内容はクライアントに返さない。
 */
export async function dispatch(ctx: ApiContext, req: unknown): Promise<ApiBody> {
  try {
    if (req === undefined) return err('bad_request', 'リクエストが空です。').body;
    if (!req || typeof req !== 'object' || Array.isArray(req)) {
      return err('bad_request', MSG_BAD_FORMAT).body;
    }
    const r = req as Record<string, unknown>;
    const action = String(r.action || '');
    const now = ctx.now();
    let res: HandlerResult;
    switch (action) {
      case 'post':
        res = await handlePost(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'begin_login':
        // 認証開始。署名済み state を配るだけ (秘密は含まない)。失敗は記録しない。
        return (await handleBeginLogin(ctx.cfg, r, now)).body;
      case 'login':
        res = await handleLogin(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'vote':
        res = await handleVote(ctx.cfg, ctx.store, ctx.dataFetch, r, now); break;
      case 'me':
        // ページを開くたびに呼ばれる確認。期限切れは普通に起きるので記録しない。
        return (await handleMe(ctx.cfg, r, now)).body;
      case 'card_get':
        return (await handleCardGet(ctx.store, r)).body;   // 読むだけ (だれでも)。記録しない
      case 'card_put':
        res = await handleCardPut(ctx.cfg, ctx.store, r, now); break;
      case 'class_register':
        res = await handleClassRegister(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'class_waitlist':
        return (await handleClassWaitlist(ctx.store)).body;   // 読むだけ (だれでも)。記録しない
      case 'class_done':
        res = await handleClassDone(ctx.cfg, ctx.store, r); break;
      case 'export_votes':
        // ビルドサーバーの定期取得。失敗しても人手の出番は無いので記録しない。
        return (await handleExportVotes(ctx.cfg, ctx.store, r)).body;
      case 'export_errors':
        return (await handleExportErrors(ctx.cfg, ctx.store, r)).body;
      case 'client_error':
        return (await handleClientError(ctx.cfg, ctx.store, r, now)).body;   // 記録そのものなので二重に記録しない
      default:
        return err('bad_request', '不明な action です。').body;
    }
    await logIfFailed(ctx, action, r, res, now);
    return res.body;
  } catch (ex) {
    console.error('dispatch failed: ' + (ex instanceof Error && ex.stack ? ex.stack : String(ex)));
    await logError(ctx.cfg, ctx.store, 'server', 'doPost', 'exception', '',
      ex instanceof Error ? ex.message : String(ex), ctx.now());
    return err('internal', 'サーバー側でエラーが発生しました。').body;
  }
}

/**
 * ハンドラの応答が失敗なら errors に残す。
 * user_id は token から引ける場合だけ添える (無ければ空欄)。
 * note には利用者に見せたメッセージではなく、内部の手掛かり (OAuth の失敗理由) だけを入れる。
 */
async function logIfFailed(ctx: ApiContext, action: string, req: Record<string, unknown>, res: HandlerResult, now: number): Promise<void> {
  if (!isErr(res.body)) return;
  let uid = '';
  if (typeof req.token === 'string' && req.token) {
    const sess = await verifySessionToken(ctx.cfg, req.token, now);
    if (sess) uid = sess.id;
  }
  // note は理由の符号だけ (class_register の start.gg のキーは note にも入らない)
  const note = (action === 'login' || action === 'post' || action === 'class_register') ? String(res.note || '') : '';
  await logError(ctx.cfg, ctx.store, 'server', action, res.body.error.code, uid, note, now);
}

/** GET は使わない。ブラウザで開かれたときの応答だけ返す (doGet)。 */
export function getOnlyPostBody(): ApiBody {
  return err('bad_request', 'このエンドポイントは POST のみ受け付けます。').body;
}

const CORS_HEADERS: Record<string, string> = {
  // GAS の /exec と同じく、他オリジン (gh-pages で動く旧フロント / ローカル確認) からも呼べる。
  // 認証情報は body の token で運ぶので Cookie は使わない (credentials 無し)。
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** cacheControl は GET /api/card の成功応答だけ public にする (それ以外は no-store)。 */
export function jsonResponse(body: ApiBody, cacheControl: string = 'no-store'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ...CORS_HEADERS,
    },
  });
}

/** /api/ 配下の HTTP リクエストを処理する。 */
export async function handleApiRequest(ctx: ApiContext, request: Request): Promise<Response> {
  const url = new URL(request.url);
  // /api, /api/, /api/<action>
  const sub = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (sub === 'export/votes') {
      return jsonResponse(await dispatch(ctx, {
        action: 'export_votes', key: url.searchParams.get('key') || '',
        since: url.searchParams.get('since') || '',
      }));
    }
    if (sub === 'export/errors') {
      return jsonResponse(await dispatch(ctx, {
        action: 'export_errors', key: url.searchParams.get('key') || '',
        limit: url.searchParams.get('limit') || '',
      }));
    }
    if (sub === 'class_waitlist') {
      return jsonResponse(await dispatch(ctx, { action: 'class_waitlist' }));
    }
    if (sub === 'card') {
      const body = await dispatch(ctx, { action: 'card_get', uid: url.searchParams.get('uid') || '' });
      return jsonResponse(body, body.ok ? 'public, max-age=60' : 'no-store');
    }
    return jsonResponse(getOnlyPostBody());
  }

  if (request.method !== 'POST') {
    return jsonResponse(getOnlyPostBody());
  }

  const len = Number(request.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) {
    return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);
  }
  let text: string;
  try {
    text = await request.text();
  } catch (_) {
    return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);
  }
  if (!text) return jsonResponse(await dispatch(ctx, undefined));
  if (text.length > MAX_BODY_BYTES) return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);

  let req: unknown;
  try {
    req = JSON.parse(text);
  } catch (_) {
    return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);
  }
  // POST /api/<action> は body に action が無ければパスから補う (同じ名前を使う)。
  if (sub && req && typeof req === 'object' && !Array.isArray(req)
      && (req as Record<string, unknown>).action === undefined) {
    (req as Record<string, unknown>).action = sub;
  }
  return jsonResponse(await dispatch(ctx, req));
}
