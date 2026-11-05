/**
 * トーナメントプレビューの短い URL (2026-11-05)。
 *   action "bracket_share_create" — { frag, days } frag = 共有 URL の # の後ろ (v=1&…&d=…)。days = 1 / 3 / 7 (既定 3)。→ { id, expires_ms }
 *   action "bracket_share_get"    — { id } → { frag, expires_ms }。期限を過ぎていれば not_found
 * ログインは要らない。中身は共有 URL と同じもの (シード順・名前) で、URL に載っていたものを置くだけ。
 */
import type { Store } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';

const DAY = 24 * 60 * 60 * 1000;
export const SHARE_DAYS = [1, 3, 7];
const FRAG_MAX = 120_000;
const ID_LEN = 8;
const ALPHA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 紛らわしい文字 (0 O 1 l I i) を除く

function newId(): string {
  const b = new Uint8Array(ID_LEN);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ALPHA[x % ALPHA.length];
  return s;
}

export async function handleBracketShareCreate(store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const frag = typeof req.frag === 'string' ? req.frag.replace(/^#/, '') : '';
  if (!frag || frag.length > FRAG_MAX || !/^v=1&/.test(frag) || !/(^|&)d=[A-Za-z0-9_-]+/.test(frag) || /[^\w\-=&.~%]/.test(frag)) {
    return err('bad_request', '共有するトーナメントの形式が正しくありません。', 'bad:frag');
  }
  const days = SHARE_DAYS.includes(Number(req.days)) ? Number(req.days) : 3;
  await store.purgeBracketShares(now).catch(() => undefined);
  for (let i = 0; i < 4; i++) {
    const id = newId();
    try {
      await store.putBracketShare(id, frag, now, now + days * DAY);
      return ok({ id, expires_ms: now + days * DAY, days });
    } catch (_) { /* 同じ ID (まれ): 作り直す */ }
  }
  return err('internal', '短い URL を作れませんでした。もう一度押してください。', 'share_id');
}

export async function handleBracketShareGet(store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const id = typeof req.id === 'string' && new RegExp('^[' + ALPHA + ']{' + ID_LEN + '}$').test(req.id) ? req.id : null;
  if (!id) return err('not_found', 'この短い URL は見つかりません。', 'bad:id');
  const r = await store.getBracketShare(id, now);
  if (!r) return err('not_found', 'この短い URL は期限が切れたか、見つかりません。', 'expired');
  return ok({ frag: r.frag, expires_ms: r.expires_ms });
}
