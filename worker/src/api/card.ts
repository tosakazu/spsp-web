/**
 * プレイヤーカードの設定と、ログイン状態の確認 (docs/login_design.md「バックエンド (Worker) に足すもの」)。
 *
 *   action: "me"        { token }            → { user:{id, slug, gamerTag}, exp } / invalid_session
 *   action: "card_get"  { uid }              → { settings | null, updated_at | null }  (GET /api/card?uid= と同じ)
 *   action: "card_put"  { token, settings }  → { settings, updated_at }  (settings:null で既定に戻す)
 *
 * card_put で書く uid はトークンの uid だけ (リクエストに uid を持たせない = 他人のカードは書けない)。
 * settings の中身 (実績の key) はサーバでは解釈しない。形と長さだけ確かめる。
 */
import type { Config } from '../config.ts';
import {
  CARD_ACH_KEY_MAX, CARD_ACH_MAX, CARD_COLORS, CARD_RATE_MAX_PER_DAY, CARD_RATE_MIN_INTERVAL_MS, CARD_TEMPLATES,
} from '../config.ts';
import type { Store } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { verifySessionToken } from './session.ts';
import { dayKey, formatIso } from './time.ts';

const MSG_INVALID_SESSION = 'ログインが無効か期限切れです。もう一度ログインしてください。';
const MSG_RATE = '保存の間隔が短すぎます。少し待ってからやり直してください。';

/** カードの設定 (フロントの CardSettings、js/player_card_model.js)。 */
export interface CardSettings {
  template: string;
  color: string;
  ach: string[] | null;
  tour: number | null;   // 「最高の大会結果」に出す大会の event_id。null = 自動 (順位評価のポイント最大の大会)
}

/**
 * settings を確かめて正規化したものを返す。形が違えば null。
 *   template: CARD_TEMPLATES のどれか / color: CARD_COLORS のどれか
 *   ach: null (省略も null) か、文字列の配列 (0〜CARD_ACH_MAX 個、各 1〜CARD_ACH_KEY_MAX 文字、重複なし)
 *   tour: null (省略も null) か、大会の event_id (正の整数 1〜12 桁。数字の文字列も受けて整数にする)
 * 知らない欄があれば弾く (黙って捨てると、フロントが増やした欄が保存されないことに気づけないため)。
 */
export function validateCardSettings(v: unknown): CardSettings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'template' && k !== 'color' && k !== 'ach' && k !== 'tour') return null;
  if (typeof o.template !== 'string' || !CARD_TEMPLATES.includes(o.template)) return null;
  if (typeof o.color !== 'string' || !CARD_COLORS.includes(o.color)) return null;
  let ach: string[] | null = null;
  if (o.ach !== undefined && o.ach !== null) {
    if (!Array.isArray(o.ach) || o.ach.length > CARD_ACH_MAX) return null;
    for (const a of o.ach) {
      if (typeof a !== 'string' || a.length === 0 || a.length > CARD_ACH_KEY_MAX) return null;
    }
    if (new Set(o.ach).size !== o.ach.length) return null;
    ach = o.ach.slice();
  }
  let tour: number | null = null;
  if (o.tour !== undefined && o.tour !== null) {
    const t = typeof o.tour === 'number' ? (Number.isInteger(o.tour) ? String(o.tour) : '')
      : typeof o.tour === 'string' ? o.tour : '';
    if (!/^[1-9]\d{0,11}$/.test(t)) return null;
    tour = Number(t);
  }
  return { template: o.template, color: o.color, ach, tour };
}

/** uid の形 (start.gg のユーザー ID = 数字)。 */
function validUid(v: unknown): string | null {
  const s = String(v === undefined || v === null ? '' : v);
  return /^\d{1,12}$/.test(s) ? String(Number(s)) : null;
}

/** 保存済みの行を応答の形に。壊れた行 (手で書き換えた等) は無いものとして扱う。 */
function rowToBody(row: { settings: string; updated_at: string } | null): Record<string, unknown> {
  if (!row) return { settings: null, updated_at: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.settings);
  } catch (_) {
    return { settings: null, updated_at: null };
  }
  const s = validateCardSettings(parsed);
  return s ? { settings: s, updated_at: row.updated_at } : { settings: null, updated_at: null };
}

/** action: "me" — トークンの中身を返すだけ (start.gg には問い合わせない)。 */
export async function handleMe(cfg: Config, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await verifySessionToken(cfg, req.token, now);
  if (!sess) return err('invalid_session', MSG_INVALID_SESSION);
  return ok({ user: { id: sess.id, slug: sess.slug, gamerTag: sess.gamerTag }, exp: sess.exp });
}

/** action: "card_get" — だれでも読める。 */
export async function handleCardGet(store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  const uid = validUid(req.uid);
  if (!uid) return err('bad_request', '選手の指定が不正です。');
  return ok(rowToBody(await store.getCardSettings(uid)));
}

/** action: "card_put" — 本人だけ。書く uid はトークン由来のみ。 */
export async function handleCardPut(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await verifySessionToken(cfg, req.token, now);
  if (!sess) return err('invalid_session', MSG_INVALID_SESSION);
  const uid = validUid(sess.id);
  if (!uid) return err('invalid_session', MSG_INVALID_SESSION);

  let settings: CardSettings | null = null;
  if (req.settings !== null) {
    settings = validateCardSettings(req.settings);
    if (!settings) return err('bad_settings', 'カードの設定の形式が不正です。');
  }

  const updatedAt = formatIso(now, cfg.tsOffsetMin);
  const day = dayKey(now, cfg.tsOffsetMin);
  const done = await store.putCardSettings(uid, settings === null ? null : JSON.stringify(settings), updatedAt, {
    userId: uid, nowMs: now, minIntervalMs: CARD_RATE_MIN_INTERVAL_MS, dayKey: day, maxPerDay: CARD_RATE_MAX_PER_DAY,
  });
  if (!done) return err('rate_limited', MSG_RATE);
  return settings === null ? ok({ settings: null, updated_at: null }) : ok({ settings, updated_at: updatedAt });
}
