/**
 * セッション (ログイン) と署名付き state (gas/session.gs の移植)。
 *
 * トークン = base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload部, SESSION_SECRET))
 *   payload = { v:1, uid, slug, tag, iat, exp }
 *
 * base64url は GAS の Utilities.base64EncodeWebSafe と同じく **'=' の詰め物つき** で
 * 出す (SESSION_SECRET を GAS から写せば既存のトークンがそのまま通る)。
 * 検証側は詰め物の有無を問わない。
 */
import type { Config } from '../config.ts';
import { requireSecret } from '../config.ts';
import type { Store } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** bytes → base64url (詰め物つき。GAS と同じ)。 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_');
}

/** base64url (詰め物あり/なし) → bytes。壊れていれば例外。 */
export function base64UrlDecode(s: string): Uint8Array {
  let b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8ToBase64Url(s: string): string {
  return base64UrlEncode(enc.encode(s));
}

export function base64UrlToUtf8(s: string): string {
  return dec.decode(base64UrlDecode(s));
}

/** HMAC-SHA256(msg, key) の生バイト。key / msg は UTF-8 文字列 (GAS の computeHmacSha256Signature と同じ)。 */
export async function hmacSha256(key: string, msg: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(msg));
  return new Uint8Array(sig);
}

/** 定数時間ふうの比較 (早期 return で長さ・位置のヒントを出さない)。 */
export function timingSafeEq(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sessionSecret(cfg: Config): string {
  return requireSecret(cfg.sessionSecret, 'SESSION_SECRET');
}

/** payload 部 (base64url 文字列) に署名する。 */
export async function signPayload(cfg: Config, bodyB64: string): Promise<string> {
  return base64UrlEncode(await hmacSha256(sessionSecret(cfg), bodyB64));
}

export interface SessionUser {
  id: string;
  slug: string;
  gamerTag: string;
}

export interface Session extends SessionUser {
  exp: number;
}

/** currentUser 由来のユーザーからトークンを発行する。 */
export async function issueSessionToken(cfg: Config, user: SessionUser, now: number = Date.now()): Promise<string> {
  const payload = {
    v: 1,
    uid: String(user.id),
    slug: user.slug,
    tag: user.gamerTag,
    iat: now,
    exp: now + cfg.sessionTtlMs,
  };
  const body = utf8ToBase64Url(JSON.stringify(payload));
  return body + '.' + (await signPayload(cfg, body));
}

/**
 * トークンを検証して { id, slug, gamerTag, exp } を返す。
 * 改ざん・期限切れ・形式不正は null (呼び出し側が auth_failed にする)。
 */
export async function verifySessionToken(cfg: Config, token: unknown, now: number = Date.now()): Promise<Session | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  if (!timingSafeEq(parts[1], await signPayload(cfg, parts[0]))) return null;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(base64UrlToUtf8(parts[0]));
  } catch (_) {
    return null;
  }
  if (!payload || payload.v !== 1) return null;
  if (typeof payload.exp !== 'number' || now > payload.exp) return null;
  if (!payload.uid) return null;

  return {
    id: String(payload.uid),
    slug: typeof payload.slug === 'string' ? payload.slug : '',
    gamerTag: typeof payload.tag === 'string' ? payload.tag : '',
    exp: payload.exp,
  };
}

// ── 署名付き state ────────────────────────────────────────────────────
//
// 照合値 (nonce) をブラウザに置く方式は、アプリ内ブラウザで始めて通常の Safari に
// 戻される経路で必ず失敗するので、照合をサーバー側に置く。認証開始時に署名した
// state を発行し、戻ってきたときに署名と期限と単回使用を検証する。
// セッションが誰になるかは code だけで決まり、state はゲートに過ぎない。

const STATE_USED_PREFIX = 'st:';

export interface StatePayload {
  n: string;
  r: string;
  f: 'post' | 'login';
  t: number;
}

/** state を発行する。payload = { n, r, f, t }。f (flow) を署名に含める。 */
export async function signState(cfg: Config, nonce: unknown, returnPath: unknown, flow: unknown, now: number = Date.now()): Promise<string> {
  const payload: StatePayload = {
    n: String(nonce || ''),
    r: String(returnPath || ''),
    f: flow === 'post' ? 'post' : 'login',
    t: now,
  };
  const body = utf8ToBase64Url(JSON.stringify(payload));
  return body + '.' + (await signPayload(cfg, body));
}

/**
 * state が通らなかった理由 (errors の note に残す。利用者への応答は state_invalid のまま)。
 *   malformed = 無い・形が違う・中身が読めない / bad_sig = 署名が合わない (改ざん・鍵の入れ替え)
 *   expired = 有効期間切れ / future = 発行時刻が未来 (時計のずれ) / reused = 使用済み (同じリンクを二度開いた等)
 */
export type StateFailReason = 'malformed' | 'bad_sig' | 'expired' | 'future' | 'reused';

/**
 * state を検証する。通れば { payload }、通らなければ { reason }。
 * consume=true のときだけ「使用済み」に記録する (単回使用)。
 */
export async function checkStateToken(cfg: Config, store: Store, state: unknown, consume: boolean, now: number = Date.now()): Promise<{ payload: StatePayload } | { reason: StateFailReason }> {
  if (typeof state !== 'string' || !state || state.length > 4096) return { reason: 'malformed' };
  const parts = state.split('.');
  if (parts.length !== 2) return { reason: 'malformed' };
  if (!timingSafeEq(parts[1], await signPayload(cfg, parts[0]))) return { reason: 'bad_sig' };

  let payload: StatePayload;
  try {
    payload = JSON.parse(base64UrlToUtf8(parts[0]));
  } catch (_) {
    return { reason: 'malformed' };
  }
  if (!payload || typeof payload.t !== 'number') return { reason: 'malformed' };
  const age = now - payload.t;
  if (age < 0) return { reason: 'future' };
  if (age > cfg.stateTtlMs) return { reason: 'expired' };

  // 署名部分をキーにする (state 全体だとキー長の上限に当たりうる)。
  const key = STATE_USED_PREFIX + parts[1].slice(0, 100);
  const fresh = await store.checkState(key, consume, payload.t + cfg.stateTtlMs, now);
  if (!fresh) return { reason: 'reused' };
  return { payload };
}

/** state を検証して payload を返す。改ざん・期限切れ・使用済みは null (理由が要るときは checkStateToken)。 */
export async function verifyState(cfg: Config, store: Store, state: unknown, consume: boolean, now: number = Date.now()): Promise<StatePayload | null> {
  const r = await checkStateToken(cfg, store, state, consume, now);
  return 'payload' in r ? r.payload : null;
}

/**
 * action: "begin_login" — 署名付き state を発行する。
 * 認証前なので誰でも叩ける。返すのは署名済み state だけで、秘密は含まない。
 */
export async function handleBeginLogin(cfg: Config, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  const nonce = String(req && req.nonce ? req.nonce : '');
  const ret = String(req && req.returnPath ? req.returnPath : '');
  if (nonce.length > 128 || ret.length > 512) {
    return err('bad_request', 'パラメータが長すぎます。');
  }
  return ok({ state: await signState(cfg, nonce, ret, req && req.flow, now), ttlMs: cfg.stateTtlMs });
}
