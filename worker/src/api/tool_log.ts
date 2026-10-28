/**
 * 大会運営ツールの使用記録 (D1 tool_logs、migrations/0009)。どの大会を、どのユーザーが、SPSP のどの機能で操作したか。
 *
 *   action: "tool_log" { tool: 'seed' | 'seed_upload', op: 'seeding', auth, token?, user_id?, gamer_tag?,
 *                        tournament_id?, tournament_slug?, tournament_name?, event_id?, event_name?, phase_id?, count?, detail? }
 *     シード作成・シードアップロードが start.gg にシードを書き込んだあと、ブラウザが送る (書き込みはブラウザ → start.gg で、Worker を通らない)。
 *     SPSP のセッション (token) が有効ならそのユーザー (verified = 1)。無ければブラウザが start.gg から取って申告した user_id (verified = 0)。
 *     start.gg のトークン・API キーは受け取らない。
 *   下位クラスは class_create / class_delete が成功したときに Worker が書く (recordClassLog、start.gg で確かめたユーザー = verified 1)。
 */
import type { Config } from '../config.ts';
import { TOOL_LOG_DETAIL_MAX, TOOL_LOG_MAX_PER_DAY } from '../config.ts';
import type { Store, ToolLogRow } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { verifySessionToken } from './session.ts';
import { dayKey, formatIso } from './time.ts';

const CLIENT_TOOLS = ['seed', 'seed_upload'];

/** @returns 正の整数 (12 桁まで) か null */
function posIntOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,12}$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 && n < 1e12 ? n : null;
}

function text(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
}

/** detail は JSON のオブジェクト。長すぎるものは捨てる (記録はする) */
function detailJson(v: unknown): string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '{}';
  let s = '';
  try { s = JSON.stringify(v); } catch { return '{}'; }
  return s.length <= TOOL_LOG_DETAIL_MAX ? s : '{"truncated":true}';
}

/** 共通の欄 (大会・イベント) を読み取る */
function targetFields(req: Record<string, unknown>) {
  return {
    tournament_id: posIntOrNull(req.tournament_id),
    tournament_slug: text(req.tournament_slug, 200),
    tournament_name: text(req.tournament_name, 200),
    event_id: posIntOrNull(req.event_id),
    event_name: text(req.event_name, 200),
  };
}

export async function handleToolLog(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const tool = String(req.tool || '');
  if (!CLIENT_TOOLS.includes(tool)) return err('bad_request', '機能の指定が不正です。', 'bad:tool');
  if (req.op !== 'seeding') return err('bad_request', '操作の指定が不正です。', 'bad:op');
  const sess = typeof req.token === 'string' && req.token ? await verifySessionToken(cfg, req.token, now) : null;
  const userId = sess ? String(sess.id) : (posIntOrNull(req.user_id) !== null ? String(posIntOrNull(req.user_id)) : '');
  if (!userId) return err('bad_request', 'ユーザーが分かりません。', 'bad:user');
  const day = dayKey(now, cfg.tsOffsetMin);
  const row: ToolLogRow = {
    ts: formatIso(now, cfg.tsOffsetMin), ts_ms: now, day, tool, action: 'seeding',
    user_id: userId, gamer_tag: sess ? text(sess.gamerTag, 100) : text(req.gamer_tag, 100), verified: sess ? 1 : 0,
    auth: req.auth === 'login' || req.auth === 'key' ? req.auth : '',
    ...targetFields(req),
    phase_id: posIntOrNull(req.phase_id), count: posIntOrNull(req.count), detail: detailJson(req.detail),
  };
  if (!(await store.insertToolLog(row, TOOL_LOG_MAX_PER_DAY))) return err('rate_limited', '記録が多すぎます。', 'rate');
  return ok({ logged: true });
}

/** 下位クラスの作成・削除の記録 (class_bracket.ts から。失敗しても本来の応答は返す) */
export async function recordClassLog(cfg: Config, store: Store, req: Record<string, unknown>, now: number,
  e: { action: 'create' | 'delete'; userId: string; tournamentId: number | null; eventId: number | null; count: number | null; detail: Record<string, unknown> }): Promise<void> {
  const info = (req.log && typeof req.log === 'object' && !Array.isArray(req.log) ? req.log : {}) as Record<string, unknown>;
  const t = targetFields(info);
  try {
    await store.insertToolLog({
      ts: formatIso(now, cfg.tsOffsetMin), ts_ms: now, day: dayKey(now, cfg.tsOffsetMin), tool: 'class', action: e.action,
      user_id: e.userId, gamer_tag: text(info.gamer_tag, 100), verified: 1,
      auth: info.auth === 'login' || info.auth === 'key' ? info.auth : '',
      ...t, tournament_id: e.tournamentId ?? t.tournament_id, event_id: e.eventId ?? t.event_id,
      phase_id: null, count: e.count, detail: detailJson(e.detail),
    }, TOOL_LOG_MAX_PER_DAY);
  } catch (ex) {
    console.error('tool_log (class) failed: ' + (ex instanceof Error ? ex.message : String(ex)));
  }
}
