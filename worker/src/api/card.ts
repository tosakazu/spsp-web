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
  CARD_ACH_KEY_MAX, CARD_ACH_MAX, CARD_COLORS, CARD_TITLE_FETCH_TIMEOUT_MS, CARD_RATE_MAX_PER_DAY, CARD_RATE_MIN_INTERVAL_MS, CARD_TEMPLATES,
} from '../config.ts';
import type { Store } from '../store.ts';
import type { TitleTour } from './titles.ts';
import { ownedTitles, titleById, usableIn } from './titles.ts';
import type { DataFetch } from './vote.ts';
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
  title: CardTitle | null;   // 二つ名 (前半・後半の id)。null = 付けない
}

/** 二つ名の id (site/js/titles.js の一覧。言語-連番。前半・後半どちらに使えるかは一覧の part)。同じ id を前後両方に置くのは今は許す */
export interface CardTitle { pre: string | null; post: string | null }
const TITLE_ID = /^[a-z]{2}-\d{4}$/;

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
  for (const k of Object.keys(o)) if (k !== 'template' && k !== 'color' && k !== 'ach' && k !== 'tour' && k !== 'title') return null;
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
      : typeof x === 'string' && TITLE_ID.test(x) ? x : undefined);
    const pre = one(tt.pre);
    const post = one(tt.post);
    if (pre === undefined || post === undefined) return null;
    title = pre === null && post === null ? null : { pre, post };   // 両方 null なら付けない
  }
  return { template: o.template, color: o.color, ach, tour, title };
}

/** 二つ名の id が一覧にあり、その位置 (前半 / 後半) に使えるか (titles.js の usableIn)。 */
export function titleIdsValid(lang: string, t: CardTitle): boolean {
  if (t.pre !== null) { const x = titleById(lang, t.pre); if (!x || !usableIn(x, 'pre')) return false; }
  if (t.post !== null) { const x = titleById(lang, t.post); if (!x || !usableIn(x, 'post')) return false; }
  return true;
}

/**
 * 公開データの players/<uid>.json の tournaments (二つ名を持っているかの計算用)。
 * 404 (SPSP にデータが無い選手) は大会 0 件 (= 最初から持っている二つ名だけ)。それ以外の失敗・時間切れは null。
 */
export async function fetchPlayerTournaments(dataFetch: DataFetch, uid: string): Promise<TitleTour[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), CARD_TITLE_FETCH_TIMEOUT_MS); });
  const read = (async (): Promise<TitleTour[] | null> => {
    try {
      const res = await dataFetch('/players/' + encodeURIComponent(uid) + '.json');
      if (res.status === 404) return [];
      if (res.status !== 200) return null;
      const rec = await res.json() as { tournaments?: unknown };
      return Array.isArray(rec && rec.tournaments) ? rec.tournaments as TitleTour[] : [];
    } catch (_) {
      return null;
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
export async function handleCardPut(cfg: Config, store: Store, dataFetch: DataFetch, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const sess = await verifySessionToken(cfg, req.token, now);
  if (!sess) return err('invalid_session', MSG_INVALID_SESSION);
  const uid = validUid(sess.id);
  if (!uid) return err('invalid_session', MSG_INVALID_SESSION);

  let settings: CardSettings | null = null;
  if (req.settings !== null) {
    settings = validateCardSettings(req.settings);
    if (!settings) return err('bad_settings', 'カードの設定の形式が不正です。');
  }

  // 二つ名: 一覧にある id か (前後も合っているか) → その選手が持っているか (公開データの大会から計算。読めなければ保存しない)
  if (settings && settings.title) {
    const lang = cfg.titleLang || 'ja';
    if (!titleIdsValid(lang, settings.title)) return err('bad_settings', 'カードの設定の形式が不正です。', 'title_unknown');
    const tours = await fetchPlayerTournaments(dataFetch, uid);
    if (tours === null) {
      return err('title_unverified', '二つ名を持っているか確認できませんでした。時間をおいてやり直してください。', 'title_fetch');
    }
    const owned = ownedTitles(lang, uid, tours);
    for (const id of [settings.title.pre, settings.title.post]) {
      if (id !== null && !owned.has(id)) return err('title_not_owned', 'まだ持っていない二つ名です。', 'title_not_owned');
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
