/**
 * プレイヤーカードの設定と、ログイン状態の確認 (docs/login_design.md「バックエンド (Worker) に足すもの」)。
 *
 *   action: "me"        { token }            → { user:{id, slug, gamerTag}, exp } / invalid_session
 *   action: "card_get"  { uid }              → { settings | null, updated_at | null, title_text }  (GET /api/card?uid= と同じ)
 *                                            title_text = 二つ名の文字 { pre, post } (null = 既定、"" = なし。設定が無ければ全体が null = 両方既定)。プレイヤーページが一覧 (titles.js) を読まずに出せるように
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
import { bitsHas, titleById, usableIn } from './titles.ts';
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
  title: CardTitle | null;   // 二つ名 (前半・後半)。null = 設定なし (両方とも既定)
  latin: string | null;   // カードの裏面に出す英字の名前。null = 自動 (名前のかなをローマ字に。フロントの js/latin_name.js)
}

/** 英字名: 半角の英数字・記号・空白だけ、1〜30 文字、前後の空白・続けての空白なし (フロントの latinNameValid と同じ) */
export const LATIN_NAME = /^[\x20-\x7e]{1,30}$/;

/** 二つ名の id (site/js/titles.js の一覧。言語-連番。前半・後半どちらに使えるかは一覧の part)。同じ id を前後両方に置くのは今は許す */
// 各側: id / null =「なし」(空欄) / 'default' = 地域の既定 (スマブラSP / プレイヤー、フロントの region/config.js titleDefault)
export interface CardTitle { pre: string | null; post: string | null }
export const TITLE_DEFAULT = 'default';
const TITLE_ID = /^[a-z]{2}-\d{4}$/;

/**
 * settings を確かめて正規化したものを返す。形が違えば null。
 *   template: CARD_TEMPLATES のどれか / color: CARD_COLORS のどれか
 *   ach: null (省略も null) か、文字列の配列 (0〜CARD_ACH_MAX 個、各 1〜CARD_ACH_KEY_MAX 文字、重複なし)
 *   tour: null (省略も null) か、大会の event_id (正の整数 1〜12 桁。数字の文字列も受けて整数にする)
 *   latin: null (省略も null) か、英字名 (LATIN_NAME)
 * 知らない欄があれば弾く (黙って捨てると、フロントが増やした欄が保存されないことに気づけないため)。
 */
export function validateCardSettings(v: unknown): CardSettings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'template' && k !== 'color' && k !== 'ach' && k !== 'tour' && k !== 'title' && k !== 'latin') return null;
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
  let title: CardTitle | null = null;
  if (o.title !== undefined && o.title !== null) {
    if (typeof o.title !== 'object' || Array.isArray(o.title)) return null;
    const tt = o.title as Record<string, unknown>;
    for (const k of Object.keys(tt)) if (k !== 'pre' && k !== 'post') return null;
    const one = (x: unknown): string | null | undefined => (x === undefined || x === null ? null
      : typeof x === 'string' && (TITLE_ID.test(x) || x === TITLE_DEFAULT) ? x : undefined);
    const pre = one(tt.pre);
    const post = one(tt.post);
    if (pre === undefined || post === undefined) return null;
    // 両方とも既定なら設定なし (null)。「なし / なし」(両方 null) は空欄として残す
    title = pre === TITLE_DEFAULT && post === TITLE_DEFAULT ? null : { pre, post };
  }
  let latin: string | null = null;
  if (o.latin !== undefined && o.latin !== null) {
    if (typeof o.latin !== 'string' || !LATIN_NAME.test(o.latin) || o.latin.trim() !== o.latin || /\s{2,}/.test(o.latin)) return null;
    latin = o.latin;
  }
  return { template: o.template, color: o.color, ach, tour, title, latin };
}

/** 二つ名の id が一覧にあり、その位置 (前半 / 後半) に使えるか (titles.js の usableIn)。 */
export function titleIdsValid(lang: string, t: CardTitle): boolean {
  if (t.pre !== null && t.pre !== TITLE_DEFAULT) { const x = titleById(lang, t.pre); if (!x || !usableIn(x, 'pre')) return false; }
  if (t.post !== null && t.post !== TITLE_DEFAULT) { const x = titleById(lang, t.post); if (!x || !usableIn(x, 'post')) return false; }
  return true;
}

/**
 * その選手がその二つ名を持っているか。記録 (D1 title_owned、毎日の title_sync が 0 → 1 にだけ書く) にあれば持っている。
 * 記録がまだ無い選手 (初回の記録の前・新しい選手) は、最初から持っている二つ名 (unlock 'initial') だけ持っているとみなす。
 */
export function titleOwned(lang: string, row: { bits: string } | null, id: string): boolean {
  if (row && bitsHas(row.bits, id)) return true;
  const t = titleById(lang, id);
  return !!t && t.unlock === 'initial';
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

/** 付けている二つ名の文字。null = 既定 (フロントが地域の既定を入れる)、"" =「なし」・一覧に無い・その位置に使えないもの
 * (持っているかは card_put で確かめてある。持ち物は減らない)。設定が無ければ null (両方既定) */
export function titleTextOf(lang: string, t: CardTitle | null): { pre: string | null; post: string | null } | null {
  if (!t) return null;
  const text = (id: string | null, slot: 'pre' | 'post'): string | null => {
    if (id === TITLE_DEFAULT) return null;
    const x = id === null ? null : titleById(lang, id);
    return x && usableIn(x, slot) ? x.text : '';
  };
  return { pre: text(t.pre, 'pre'), post: text(t.post, 'post') };
}

/** action: "card_get" — だれでも読める。 */
export async function handleCardGet(cfg: Config, store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  const uid = validUid(req.uid);
  if (!uid) return err('bad_request', '選手の指定が不正です。');
  const body = rowToBody(await store.getCardSettings(uid));
  const s = body.settings as CardSettings | null;
  return ok({ ...body, title_text: titleTextOf(cfg.titleLang || 'ja', s ? s.title : null) });
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

  // 二つ名: 一覧にある id か (その位置に使えるか) → その選手が持っているか (記録 title_owned。記録が無ければ最初からの二つ名だけ)
  if (settings && settings.title) {
    const lang = cfg.titleLang || 'ja';
    if (!titleIdsValid(lang, settings.title)) return err('bad_settings', 'カードの設定の形式が不正です。', 'title_unknown');
    const ids = [settings.title.pre, settings.title.post].filter((id): id is string => id !== null && id !== TITLE_DEFAULT);
    if (ids.length) {   //「なし」と既定だけなら記録は読まない
      const row = await store.getTitleOwned(uid, lang);
      for (const id of ids) if (!titleOwned(lang, row, id)) return err('title_not_owned', 'まだ持っていない二つ名です。', 'title_not_owned');
    }
  }

  const updatedAt = formatIso(now, cfg.tsOffsetMin);
  const day = dayKey(now, cfg.tsOffsetMin);
  const done = await store.putCardSettings(uid, settings === null ? null : JSON.stringify(settings), updatedAt, {
    userId: uid, nowMs: now, minIntervalMs: CARD_RATE_MIN_INTERVAL_MS, dayKey: day, maxPerDay: CARD_RATE_MAX_PER_DAY,
  });
  if (!done) return err('rate_limited', MSG_RATE);
  return settings === null ? ok({ settings: null, updated_at: null }) : ok({ settings, updated_at: updatedAt });
}
