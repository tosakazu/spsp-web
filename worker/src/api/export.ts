/**
 * ビルドサーバー向けのエクスポート (gas/export.gs の移植) — votes をビルドに渡す唯一の口。
 *
 * 公開範囲の原則:
 *   - 返すのは **ビルドが判定に使う列だけ** (ts / userId / charId / charName / status)。
 *     user_slug と gamer_tag は返さない。
 *   - status='debug' の行はここで落とす。
 *   - 鍵が一致しない限り何も返さない。
 *
 * 鍵: GAS と同じく STARTGG_CLIENT_SECRET からラベル付き HMAC で導出した値
 * (ビルド側 spsp/cli/fetch_char_votes.py が同じ計算をする)。加えて、secret
 * EXPORT_KEY が設定されていればその値も受け付ける (client secret を配らずに
 * 読み出し権限を渡せる)。
 *
 * 差分取得: `since` (ISO 8601 の文字列) を渡すと **その時刻以降** (>=) の行だけ返す。
 */
import type { Config } from '../config.ts';
import { EXPORT_KEY_LABEL, requireSecret } from '../config.ts';
import type { Store } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { base64UrlEncode, hmacSha256 } from './session.ts';

/**
 * エクスポート鍵を導出する。
 *   base64url( HMAC-SHA256(key = STARTGG_CLIENT_SECRET, msg = EXPORT_KEY_LABEL) )  末尾の '=' は落とす
 */
export async function deriveExportKey(clientSecret: string): Promise<string> {
  return base64UrlEncode(await hmacSha256(clientSecret, EXPORT_KEY_LABEL)).replace(/=+$/, '');
}

/** 長さと内容を最後まで比べる (= 先頭一致で早期 return しない)。 */
export function keyMatches(given: unknown, expected: string): boolean {
  const a = String(given === undefined || given === null ? '' : given);
  const b = String(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 受け付ける鍵のどれかに一致するか。
 * client secret も EXPORT_KEY も無ければ例外 → internal (= 鍵無しで通してしまわない)。
 */
export async function exportKeyOk(cfg: Config, given: unknown): Promise<boolean> {
  const keys: string[] = [];
  if (cfg.clientSecret) keys.push(await deriveExportKey(cfg.clientSecret));
  if (cfg.exportKey) keys.push(cfg.exportKey);
  if (!keys.length) requireSecret(undefined, 'STARTGG_CLIENT_SECRET');
  // 全部と比較して結果を OR する (一致した時点で抜けない)
  let hit = false;
  for (const k of keys) hit = keyMatches(given, k) || hit;
  return hit;
}

export interface ExportedVote { ts: string; userId: string; charId: string; charName: string; status: string }

/**
 * action: "export_votes" — { key, since? }
 * 成功: { ok:true, votes:[{ts,userId,charId,charName,status}...], total:<データ行数>, since:<エコー> }
 *   total は since で絞る前のデータ行数 (debug 行・壊れた行も含む)。
 */
export async function handleExportVotes(cfg: Config, store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  if (!(await exportKeyOk(cfg, req && req.key))) {
    return err('auth_failed', 'エクスポート鍵が違います。');
  }
  const since = (req && typeof req.since === 'string') ? req.since : '';

  const { rows, total } = await store.listVotes();
  const out: ExportedVote[] = [];
  for (const r of rows) {
    const status = String(r.status || '');
    if (status === 'debug') continue;                  // デバッグ投票は渡さない
    const userId = String(r.user_id || '');
    const charId = String(r.char_id || '');
    if (!userId || !charId) continue;                  // 壊れた行は渡さない
    const ts = String(r.ts || '');
    if (since && ts < since) continue;                 // 差分 (境界は以降 = 取りこぼさない)
    out.push({ ts, userId, charId, charName: String(r.char_name || ''), status });
  }
  return ok({ votes: out, total, since });
}

/**
 * action: "export_errors" — errors を読む (運営が原因を調べるため)。
 *   req.limit : 末尾から何行返すか (既定 100 / 上限 1000)
 */
export async function handleExportErrors(cfg: Config, store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  if (!(await exportKeyOk(cfg, req && req.key))) {
    return err('auth_failed', 'エクスポート鍵が違います。');
  }
  let limit = Number(req && req.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = 100;
  limit = Math.min(limit, 1000);

  const { rows, total } = await store.listErrors(limit);
  const out = rows.map((r) => ({
    ts: String(r.ts || ''),
    source: String(r.source || ''),
    action: String(r.action || ''),
    code: String(r.code || ''),
    userId: String(r.user_id === null || r.user_id === undefined ? '' : r.user_id),
    note: String(r.note || ''),
  }));
  return ok({ errors: out, total });
}
