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
 *   POST /api/csp-report                 CSP の違反報告 (ブラウザ。body は csp-report / reports+json、応答 204)
 *   GET  /api/card?uid=                  = action card_get (だれでも読める。60 秒キャッシュ可)
 *   GET  /api/titles?uid=&lang=          = action title_get (持っている二つ名の記録。だれでも読める。60 秒キャッシュ可)
 *   GET  /api/class_waitlist             = action class_waitlist (下位クラスの取得待ち。だれでも読める)
 *   GET  それ以外        doGet と同じ bad_request
 * 応答は常に HTTP 200 の JSON (ビルド側の urllib が非 2xx を例外にするため)。
 */
import type { Config } from '../config.ts';
import type { Store } from '../store.ts';
import { handleCardGet, handleCardPut, handleMe } from './card.ts';
import { handleTitleExport, handleTitleGet, handleTitleSync } from './title_owned.ts';
import { handleChallongeBegin, handleChallongeMe, handleChallongeToken } from './challonge.ts';
import { handleClassCreate, handleClassDelete, handleClassDone, handleClassMine, handleClassWaitlist } from './class_bracket.ts';
import { handleCspExport, recordCspReport } from './csp.ts';
import { handleClientError, logError } from './errlog.ts';
import { handleExportErrors, handleExportVotes } from './export.ts';
import { handleLogin, handleManagerBegin, handleManagerLogin, handleStartggRefresh } from './login.ts';
import { handleToolLog } from './tool_log.ts';
import {
  handleReportAdmin, handleReportAdminFix, handleReportBegin, handleReportPhases, handleReportEnable, handleReportLogin, handleReportTournaments, handleReportEnableClass, handleReportInfo, handleReportNotices,
  handleReportPresetDelete, handleReportPresets, handleReportPresetSave, handleReportSettings, handleReportStart, handleReportStop, handleReportSubmit, handleReportView,
} from './report.ts';
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
/** 毎日の二つ名の記録 (POST /api/title_sync、鍵つき) だけの上限。1 人あたり今と前のビット列 (各 1.2 KB 前後) で、同期の道具は 1 回 1.5 MB までに分けて送る。
 * パスが title_sync のときだけ使い、body の action も title_sync でなければ断る (ほかの action に大きな body を通さない) */
export const TITLE_SYNC_MAX_BODY_BYTES = 2 * 1024 * 1024;

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
      case 'manager_begin':
        return (await handleManagerBegin(ctx.cfg, r, now)).body;   // 署名 state を配るだけ。記録しない
      case 'manager_login':
        res = await handleManagerLogin(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'startgg_refresh':
        res = await handleStartggRefresh(ctx.cfg, ctx.fetch, r); break;
      case 'vote':
        res = await handleVote(ctx.cfg, ctx.store, ctx.dataFetch, r, now); break;
      case 'me':
        // ページを開くたびに呼ばれる確認。期限切れは普通に起きるので記録しない。
        return (await handleMe(ctx.cfg, r, now)).body;
      case 'card_get':
        return (await handleCardGet(ctx.cfg, ctx.store, r)).body;   // 読むだけ (だれでも)。記録しない
      case 'title_get':
        return (await handleTitleGet(ctx.store, r)).body;   // 読むだけ (だれでも)。記録しない
      case 'title_sync':
        res = await handleTitleSync(ctx.cfg, ctx.store, r, now); break;
      case 'title_export':
        res = await handleTitleExport(ctx.cfg, ctx.store, r); break;
      case 'card_put':
        res = await handleCardPut(ctx.cfg, ctx.store, r, now); break;
      case 'tool_log':
        res = await handleToolLog(ctx.cfg, ctx.store, r, now); break;
      case 'class_create':
        res = await handleClassCreate(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'class_mine':
        res = await handleClassMine(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'class_delete':
        res = await handleClassDelete(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'challonge_begin':
        return (await handleChallongeBegin(ctx.cfg, r, now)).body;   // 署名 state を配るだけ。記録しない
      case 'challonge_me':
        res = await handleChallongeMe(ctx.fetch, r); break;
      case 'challonge_token':
        res = await handleChallongeToken(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      // 選手による試合結果の報告 (report.ts)
      case 'report_begin':
        return (await handleReportBegin(ctx.cfg, r, now)).body;   // 署名 state を配るだけ。記録しない
      case 'report_login':
        res = await handleReportLogin(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'report_tournaments':
        res = await handleReportTournaments(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'report_enable':
        res = await handleReportEnable(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'report_enable_class':
        res = await handleReportEnableClass(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'report_info':
        return (await handleReportInfo(ctx.store, r, now)).body;   // 読むだけ (だれでも)。記録しない
      case 'report_view':
        return (await handleReportView(ctx.cfg, ctx.store, ctx.fetch, r, now)).body;   // 15 秒ごとに読む。記録しない
      case 'report_notices':
        return (await handleReportNotices(ctx.cfg, ctx.store, r, now)).body;   // 読むだけ。記録しない
      case 'report_submit':
        res = await handleReportSubmit(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'report_start':
        res = await handleReportStart(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'report_phases':
        return (await handleReportPhases(ctx.cfg, ctx.store, ctx.fetch, r, now)).body;   // 読むだけ。記録しない
      case 'report_admin':
        return (await handleReportAdmin(ctx.cfg, ctx.store, ctx.fetch, r, now)).body;   // 読むだけ。記録しない
      case 'report_admin_fix':
        res = await handleReportAdminFix(ctx.cfg, ctx.store, ctx.fetch, r, now); break;
      case 'report_settings':
        res = await handleReportSettings(ctx.cfg, ctx.store, r, now); break;
      case 'report_presets':
        return (await handleReportPresets(ctx.cfg, ctx.store, r, now)).body;   // 読むだけ。記録しない
      case 'report_preset_save':
        res = await handleReportPresetSave(ctx.cfg, ctx.store, r, now); break;
      case 'report_preset_delete':
        res = await handleReportPresetDelete(ctx.cfg, ctx.store, r, now); break;
      case 'report_stop':
        res = await handleReportStop(ctx.cfg, ctx.store, r, now); break;
      case 'class_waitlist':
        return (await handleClassWaitlist(ctx.store)).body;   // 読むだけ (だれでも)。記録しない
      case 'class_done':
        res = await handleClassDone(ctx.cfg, ctx.store, r); break;
      case 'export_votes':
        // ビルドサーバーの定期取得。失敗しても人手の出番は無いので記録しない。
        return (await handleExportVotes(ctx.cfg, ctx.store, r)).body;
      case 'csp_export':
        return (await handleCspExport(ctx.cfg, ctx.store, r)).body;
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
  // note は理由の符号だけ (start.gg / Challonge のキー・トークンは note にも入らない)
  const NOTE_ACTIONS = ['login', 'manager_login', 'post', 'card_put', 'title_sync', 'title_export', 'class_create', 'class_mine', 'class_delete', 'challonge_token', 'challonge_me', 'tool_log',
    'report_login', 'report_tournaments', 'report_enable', 'report_enable_class', 'report_submit', 'report_start', 'report_admin_fix', 'report_settings', 'report_stop'];
  const note = NOTE_ACTIONS.includes(action) ? String(res.note || '') : '';
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
    if (sub === 'titles') {
      const body = await dispatch(ctx, { action: 'title_get', uid: url.searchParams.get('uid') || '', lang: url.searchParams.get('lang') || '' });
      return jsonResponse(body, body.ok ? 'public, max-age=60' : 'no-store');
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

  // CSP の違反報告 (ブラウザが送る。action は無い)。中身は返さない (204)
  if (sub === 'csp-report') {
    const n = Number(request.headers.get('content-length') || 0);
    if (n <= MAX_BODY_BYTES) {
      let t = '';
      try { t = await request.text(); } catch (_) { t = ''; }
      if (t && t.length <= MAX_BODY_BYTES) {
        await recordCspReport(ctx.cfg, ctx.store, t, request.headers.get('cf-connecting-ip') || '', ctx.now());
      }
    }
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const maxBody = sub === 'title_sync' ? TITLE_SYNC_MAX_BODY_BYTES : MAX_BODY_BYTES;
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBody) {
    return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);
  }
  let text: string;
  try {
    text = await request.text();
  } catch (_) {
    return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);
  }
  if (!text) return jsonResponse(await dispatch(ctx, undefined));
  if (text.length > maxBody) return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);

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
  if (sub === 'title_sync' && text.length > MAX_BODY_BYTES
      && !(req && typeof req === 'object' && (req as Record<string, unknown>).action === 'title_sync')) {
    return jsonResponse(err('bad_request', MSG_BAD_FORMAT).body);
  }
  return jsonResponse(await dispatch(ctx, req));
}
