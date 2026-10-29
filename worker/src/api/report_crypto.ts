/**
 * 試合結果の報告 (report.ts) で預かる運営のトークンの暗号化。
 *   鍵 = HKDF-SHA256(SESSION_SECRET, info 'spsp:report_token:v1') の AES-GCM 256。
 *   出力 = 'v1.' + base64url(iv 12 バイト) + '.' + base64url(暗号文)。
 * 復号できない (鍵が変わった・壊れた) ときは null。平文はログにもレスポンスにも出さない。
 */
import type { Config } from '../config.ts';
import { requireSecret } from '../config.ts';
import { base64UrlDecode, base64UrlEncode } from './session.ts';

const INFO = 'spsp:report_token:v1';
const enc = new TextEncoder();

async function keyOf(cfg: Config): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey('raw', enc.encode(requireSecret(cfg.sessionSecret, 'SESSION_SECRET')), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(INFO) },
    raw, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function sealJson(cfg: Config, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyOf(cfg), enc.encode(JSON.stringify(value))));
  return 'v1.' + base64UrlEncode(iv) + '.' + base64UrlEncode(ct);
}

export async function openJson<T>(cfg: Config, sealed: string): Promise<T | null> {
  const p = String(sealed || '').split('.');
  if (p.length !== 3 || p[0] !== 'v1') return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlDecode(p[1]) }, await keyOf(cfg), base64UrlDecode(p[2]));
    return JSON.parse(new TextDecoder().decode(pt)) as T;
  } catch (_) {
    return null;
  }
}
