/**
 * トーナメントプレビューの短い URL (2026-11-05)。
 *   action "bracket_share_create" — { token, frag, days, sgg? } frag = 共有 URL の # の後ろ (v=1&…&d=…)。days = 1 / 3 / 7 (既定 3)。
 *       sgg = 作った人のブラウザが start.gg から読んだフェーズの構造 (bracket_struct.ts の SimData)。あれば開く人はログインなしで start.gg の組み合わせになる。
 *       → { id, expires_ms }
 *   action "bracket_share_get"    — { id } → { frag, sgg?, expires_ms }。期限を過ぎていれば not_found
 * 作るのはログイン必須 (作った人の start.gg のユーザー ID と名前を残す)。1 人 SHARE_MAX_PER_USER 個まで (超えたら古いものから消す)・
 * SHARE_BURST_WINDOW_MS に SHARE_BURST_MAX 個まで。開くのはログイン不要。
 */
import type { Config } from '../config.ts';
import type { Store } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { verifySessionToken } from './session.ts';

const DAY = 24 * 60 * 60 * 1000;
export const SHARE_DAYS = [1, 3, 7];
export const SHARE_MAX_PER_USER = 30;
export const SHARE_BURST_MAX = 10;
export const SHARE_BURST_WINDOW_MS = 10 * 60 * 1000;
const FRAG_MAX = 120_000;
const SGG_MAX = 1_500_000;   // D1 の 1 行 (2 MB) より手前
const ID_LEN = 8;
const ALPHA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 紛らわしい文字 (0 O 1 l I i) を除く

function newId(): string {
  const b = new Uint8Array(ID_LEN);
  crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += ALPHA[x % ALPHA.length];
  return s;
}

/** 構造の形だけ確かめる (中身は画面が使うときに確かめる) */
function sggOf(v: unknown): string | null {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as { v?: unknown; phases?: unknown };
  if (o.v !== 1 || !Array.isArray(o.phases) || o.phases.length > 8) return null;
  const s = JSON.stringify(v);
  return s.length <= SGG_MAX ? s : null;
}

export async function handleBracketShareCreate(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await verifySessionToken(cfg, req.token, now);
  if (!sess) return err('auth_failed', '短い URL を作るにはログインしてください。', 'session');
  const frag = typeof req.frag === 'string' ? req.frag.replace(/^#/, '') : '';
  if (!frag || frag.length > FRAG_MAX || !/^v=1&/.test(frag) || !/(^|&)d=[A-Za-z0-9_-]+/.test(frag) || /[^\w\-=&.~%]/.test(frag)) {
    return err('bad_request', '共有するトーナメントの形式が正しくありません。', 'bad:frag');
  }
  const sgg = sggOf(req.sgg);
  if (sgg === null) return err('bad_request', 'start.gg の構造の形式が正しくありません。', 'bad:sgg');
  const days = SHARE_DAYS.includes(Number(req.days)) ? Number(req.days) : 3;
  await store.purgeBracketShares(now).catch(() => undefined);
  const mine = await store.listBracketSharesOf(sess.id);
  if (mine.filter((x) => now - x.created_ms < SHARE_BURST_WINDOW_MS).length >= SHARE_BURST_MAX) {
    return err('rate_limited', '短い URL を作る間隔が短すぎます。少し待ってからもう一度押してください。', 'share_burst');
  }
  // 1 人 SHARE_MAX_PER_USER 個まで: 古いものから消す
  for (const x of mine.slice(SHARE_MAX_PER_USER - 1)) await store.deleteBracketShare(x.id);
  for (let i = 0; i < 4; i++) {
    const id = newId();
    try {
      await store.putBracketShare({ id, frag, sgg, user_id: sess.id, user_name: String(sess.gamerTag || '').slice(0, 80), created_ms: now, expires_ms: now + days * DAY });
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
  let sgg: unknown = null;
  if (r.sgg) { try { sgg = JSON.parse(r.sgg); } catch (_) { sgg = null; } }
  return ok({ frag: r.frag, expires_ms: r.expires_ms, ...(sgg ? { sgg } : {}) });
}
