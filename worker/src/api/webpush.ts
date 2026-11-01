/**
 * Web Push の送信 (RFC 8030 / 8291 / 8292)。npm の依存なし、WebCrypto だけ (Workers・Node 20+ で同じに動く)。
 *
 *   sendPush(fetchFn, sub, payload, vapid)  本文を aes128gcm で暗号化し、VAPID の署名を付けて push サービスへ送る
 *   validSub(v)                             ブラウザの PushSubscription.toJSON() の形 ({ endpoint, keys: { p256dh, auth } }
 *                                           または平らな { endpoint, p256dh, auth }) を確かめて PushSub にする
 *
 * 鍵の形 (Worker の secret に入れる。リポジトリには書かない。新しい鍵は worker/scripts/gen_vapid.mjs で作る):
 *   VAPID の公開鍵 = P-256 の非圧縮の点 (65 バイト、先頭 0x04) の base64url。ブラウザの subscribe の applicationServerKey にも同じ値を渡す
 *   VAPID の秘密鍵 = P-256 の秘密のスカラー d (32 バイト) の base64url。JWK の JSON 文字列 ({"kty":"EC","crv":"P-256","d",…}) でもよい
 *   subject       = 連絡先 ("mailto:…" か "https://…")
 */
import type { FetchFn } from './oauth.ts';

export interface PushSub { endpoint: string; p256dh: string; auth: string }
export interface Vapid { publicKey: string; privateKey: string; subject: string }
export interface PushOpts { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string }
export type PushResult = { ok: true } | { ok: false; status: number; gone: boolean; note: string };

/** 本文の上限 (バイト)。1 レコード 4096 から鍵・タグ・区切りを引いた 3993 より小さめに */
export const PUSH_PAYLOAD_MAX = 3000;
const RS = 4096;
const ENDPOINT_MAX = 1000;

const enc = new TextEncoder();

export function b64uEncode(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw new Error('b64u');
  const t = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
/** WebCrypto に渡す形 (ArrayBuffer 付きの Uint8Array の型を合わせる) */
const buf = (b: Uint8Array): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

function b64uOk(s: unknown, len: number): s is string {
  if (typeof s !== 'string' || s.length > 200) return false;
  try { return b64uDecode(s).length === len; } catch (_) { return false; }
}

/** 購読の形を確かめる。だめなら null */
export function validSub(v: unknown): PushSub | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = o.keys && typeof o.keys === 'object' ? o.keys as Record<string, unknown> : o;
  const endpoint = o.endpoint;
  if (typeof endpoint !== 'string' || endpoint.length > ENDPOINT_MAX) return null;
  let u: URL;
  try { u = new URL(endpoint); } catch (_) { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  if (!b64uOk(keys.p256dh, 65) || !b64uOk(keys.auth, 16)) return null;
  if (b64uDecode(keys.p256dh as string)[0] !== 4) return null;
  return { endpoint, p256dh: keys.p256dh as string, auth: keys.auth as string };
}

/** 非圧縮の点 (65 バイト) と d から JWK */
function jwkOf(pub: Uint8Array, d: string | null): JsonWebKey {
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('vapid_public');
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), ext: true };
  if (d !== null) jwk.d = d;
  return jwk;
}

async function vapidKey(v: Vapid): Promise<CryptoKey> {
  const pk = v.privateKey.trim();
  const jwk: JsonWebKey = pk.startsWith('{') ? JSON.parse(pk) as JsonWebKey : jwkOf(b64uDecode(v.publicKey), pk);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** VAPID の JWT (ES256。WebCrypto の署名は r||s の 64 バイトでそのまま JOSE の形) */
export async function vapidJwt(v: Vapid, aud: string, nowSec: number): Promise<string> {
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEncode(enc.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: v.subject })));
  const data = head + '.' + body;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(v), enc.encode(data)));
  return data + '.' + b64uEncode(sig);
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', buf(ikm), 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(info) }, k, bytes * 8));
}

/** テスト用に差し込める値 (RFC 8291 の付録 A を再現する) */
export interface EncryptInject { salt?: Uint8Array; asPrivate?: string; asPublic?: string }

/** RFC 8291 の aes128gcm で暗号化した本文 (ヘッダ salt | rs | idlen | 送り手の公開鍵 + 1 レコード) */
export async function encryptPayload(sub: PushSub, payload: string, inject: EncryptInject = {}): Promise<Uint8Array> {
  const uaPublic = b64uDecode(sub.p256dh);
  const authSecret = b64uDecode(sub.auth);
  const salt = inject.salt || crypto.getRandomValues(new Uint8Array(16));
  let asPriv: CryptoKey;
  let asPublic: Uint8Array;
  if (inject.asPrivate && inject.asPublic) {
    asPublic = b64uDecode(inject.asPublic);
    asPriv = await crypto.subtle.importKey('jwk', jwkOf(asPublic, inject.asPrivate), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
    asPriv = kp.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey) as ArrayBuffer);
  }
  const uaKey = await crypto.subtle.importKey('raw', buf(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, asPriv, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', buf(cek), 'AES-GCM', false, ['encrypt']);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));   // 最後のレコードの区切り 0x02 (詰め物なし)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(nonce) }, key, buf(plain)));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, RS);
  head[20] = asPublic.length;
  return concat(head, asPublic, ct);
}

/**
 * 1 件送る。404 / 410 は購読が無くなった (gone = true、呼ぶ側が消す)。
 * nowSec はテスト用 (既定は今)。
 */
export async function sendPush(fetchFn: FetchFn, sub: PushSub, payload: string, vapid: Vapid, opts: PushOpts = {}, nowSec = Math.floor(Date.now() / 1000)): Promise<PushResult> {
  if (enc.encode(payload).length > PUSH_PAYLOAD_MAX) return { ok: false, status: 0, gone: false, note: 'too_large' };
  let aud: string;
  try { aud = new URL(sub.endpoint).origin; } catch (_) { return { ok: false, status: 0, gone: true, note: 'bad_endpoint' }; }
  let body: Uint8Array;
  let jwt: string;
  try {
    body = await encryptPayload(sub, payload);
    jwt = await vapidJwt(vapid, aud, nowSec);
  } catch (e) {
    return { ok: false, status: 0, gone: false, note: 'crypto:' + String((e as Error).message || e).slice(0, 60) };
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    TTL: String(Math.max(0, Math.floor(opts.ttl ?? 24 * 3600))),
    Urgency: opts.urgency || 'normal',
    Authorization: 'vapid t=' + jwt + ', k=' + vapid.publicKey,
  };
  if (opts.topic && /^[A-Za-z0-9_-]{1,32}$/.test(opts.topic)) headers.Topic = opts.topic;
  let res: Response;
  try {
    res = await fetchFn(sub.endpoint, { method: 'POST', headers, body: buf(body) });
  } catch (e) {
    return { ok: false, status: 0, gone: false, note: 'fetch:' + String((e as Error).message || e).slice(0, 60) };
  }
  if (res.status >= 200 && res.status < 300) return { ok: true };
  return { ok: false, status: res.status, gone: res.status === 404 || res.status === 410, note: 'http_' + res.status };
}
