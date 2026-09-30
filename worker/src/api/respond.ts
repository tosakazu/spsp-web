/**
 * 応答の形 (gas/main.gs の ok_ / err_)。
 *
 * GAS は成功も失敗も HTTP 200 で JSON を返していた。ビルド側 (urllib) は非 2xx を
 * 例外にするので、Worker でも **JSON を返すときは常に 200** にする。
 */

export type ErrorCode =
  | 'bad_request' | 'auth_failed' | 'rate_limited' | 'body_invalid' | 'internal'
  | 'state_invalid' | 'bad_char' | 'not_player' | 'char_exists' | 'not_candidate'
  | 'invalid_session' | 'bad_settings'
  | 'not_admin' | 'duplicate' | 'startgg_error' | 'not_found';

export interface OkBody { ok: true; [k: string]: unknown }
export interface ErrBody { ok: false; error: { code: ErrorCode; message: string } }
export type ApiBody = OkBody | ErrBody;

/** ハンドラの返り値。note は失敗ログに添える内部の手掛かり (利用者には見せない)。 */
export interface HandlerResult {
  body: ApiBody;
  note?: string;
}

export function ok(payload: Record<string, unknown> = {}): HandlerResult {
  return { body: { ok: true, ...payload } };
}

/** スタックトレースや secret は絶対に載せない。 */
export function err(code: ErrorCode, message: string, note?: string): HandlerResult {
  const r: HandlerResult = { body: { ok: false, error: { code, message } } };
  if (note !== undefined) r.note = note;
  return r;
}

export function isErr(b: ApiBody): b is ErrBody {
  return b.ok === false;
}
