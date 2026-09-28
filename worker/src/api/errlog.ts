/**
 * 失敗の記録 (errors テーブル。gas/errlog.gs の移植)。
 *
 * 書くのは原因の切り分けに要る最小限だけ:
 *   timestamp / source (server|client) / action / code / user_id / note
 * 絶対に書かないもの:
 *   OAuth code, access token, セッショントークン, client secret,
 *   gamer_tag / slug, 投稿本文, 選んだキャラ。
 */
import type { Config } from '../config.ts';
import { CLIENT_ERROR_KINDS, ERRLOG_NOTE_MAX, ERRORS_MAX_ROWS, ERRORS_TRIM_TO } from '../config.ts';
import type { Store } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { ok } from './respond.ts';
import { verifySessionToken } from './session.ts';
import { formatIso } from './time.ts';

/**
 * 1 行追記。記録に失敗しても本来の応答は返す (ログのために処理を落とさない)。
 * uid は数値化できないときは空欄。note は長さを切る。
 */
export async function logError(cfg: Config, store: Store, source: string, action: string, code: string, uid: unknown, note: unknown, now: number = Date.now()): Promise<void> {
  try {
    const n = Number(uid);
    await store.insertError({
      ts: formatIso(now, cfg.tsOffsetMin),
      source: String(source || '').slice(0, 16),
      action: String(action || '').slice(0, 32),
      code: String(code || '').slice(0, 48),
      user_id: (Number.isFinite(n) && n > 0) ? String(n) : '',
      note: String(note === undefined || note === null ? '' : note).slice(0, ERRLOG_NOTE_MAX),
    }, ERRORS_MAX_ROWS, ERRORS_TRIM_TO);
  } catch (ex) {
    console.error('logError failed: ' + (ex instanceof Error ? ex.message : String(ex)));
  }
}

/**
 * action: "client_error" — ブラウザ側でしか観測できない失敗を記録する。
 * 誰でも叩ける経路なので、種別は白リストで縛り、note は長さを切り、
 * テーブルにも行数上限を設けている。token があれば uid を添える。
 */
export async function handleClientError(cfg: Config, store: Store, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  const kind = String(req.kind === undefined || req.kind === null ? '' : req.kind);
  if (!CLIENT_ERROR_KINDS[kind]) {
    // 未知の種別は黙って捨てる (エラーにはしない。報告のために画面を壊さない)
    return ok({ logged: false });
  }
  let uid = '';
  if (typeof req.token === 'string' && req.token) {
    const sess = await verifySessionToken(cfg, req.token, now);
    if (sess) uid = sess.id;
  }
  await logError(cfg, store, 'client', String(req.flow || 'vote').slice(0, 16), kind, uid, req.note, now);
  return ok({ logged: true });
}
