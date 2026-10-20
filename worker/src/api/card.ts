/**
 * プレイヤーカードの設定と、ログイン状態の確認 (docs/login_design.md「バックエンド (Worker) に足すもの」)。
 *
 *   action: "me"        { token }            → { user:{id, slug, gamerTag}, exp } / invalid_session
 *   action: "card_get"  { uid }              → { settings | null, updated_at | null, title_text }  (GET /api/card?uid= と同じ)
 *                                            title_text = 二つ名の文字 { pre, post } (null = 既定、"" = なし。設定が無ければ全体が null = 両方既定)。プレイヤーページが一覧 (titles.js) を読まずに出せるように
 *   action: "card_put"  { token, settings }  → { settings, updated_at }  (settings:null で既定に戻す)
 *                       preview (CARD_OPEN_EDIT=1) だけ { uid, settings } でもよい (ログインなしで誰の分でも。見た目の確認用)
 *
 * card_put で書く uid はトークンの uid だけ (リクエストに uid を持たせない = 他人のカードは書けない)。
 * settings の中身 (実績の key) はサーバでは解釈しない。形と長さだけ確かめる。
 */
import type { Config } from '../config.ts';
import {
  CARD_ACH_KEY_MAX, CARD_ACH_MAX, CARD_COLORS, CARD_RATE_MAX_PER_DAY, CARD_RATE_MIN_INTERVAL_MS, CARD_STICKER_MAX, CARD_TEMPLATES,
} from '../config.ts';
import type { Store } from '../store.ts';
import { bitsHas, titleById, usableIn } from './titles.ts';
import type { HandlerResult } from './respond.ts';
import type { DataFetch } from './vote.ts';
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
  back?: CardBack;        // 裏面のシール (無ければ欄ごと無し = 貼っていない・既定)
}

/** 裏面: 貼ったシールと、名前・二つ名・順位をシールの上に出すか・縁取りを付けるか (フロントの js/card_stickers.js と同じ規則) */
export interface CardBack { stickers: CardSticker[]; text_top: boolean; outline: boolean }
/** シール 1 枚: e = "<大会キー>:<色>"、x・y = 中心 (カードの座標 514×333)、s = 一辺、r = 回転 (度)、k = 形、c = 切り取り */
export interface CardSticker { e: string; x: number; y: number; s: number; r: number; k: string; c: number }
/** シールのキー: event_id (下位クラスは親の event_id + クラスの文字 B〜E) と色 (r 虹・g 金・s 銀・n 素)。持っているかは card_put で選手のデータと突き合わせる */
export const STICKER_KEY = /^[1-9]\d{0,11}[A-E]?:[rgsn]$/;
const STICKER_SHAPES = ['square', 'round', 'circle', 'hex', 'diamond'];

/** 裏面を確かめて正規化 (数値は小数 1 桁 / 切り取りは 2 桁に丸める)。形が違えば undefined、何も無ければ null */
export function validateCardBack(v: unknown): CardBack | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'stickers' && k !== 'text_top' && k !== 'outline') return undefined;
  if (o.text_top !== undefined && typeof o.text_top !== 'boolean') return undefined;
  if (o.outline !== undefined && typeof o.outline !== 'boolean') return undefined;
  const list = o.stickers === undefined ? [] : o.stickers;
  if (!Array.isArray(list) || list.length > CARD_STICKER_MAX) return undefined;
  const num = (x: unknown, lo: number, hi: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
  const r1 = (x: number): number => Math.round(x * 10) / 10;
  const seen = new Set<string>();
  const stickers: CardSticker[] = [];
  for (const it of list) {
    if (!it || typeof it !== 'object' || Array.isArray(it)) return undefined;
    const s = it as Record<string, unknown>;
    for (const k of Object.keys(s)) if (!['e', 'x', 'y', 's', 'r', 'k', 'c'].includes(k)) return undefined;
    if (typeof s.e !== 'string' || !STICKER_KEY.test(s.e) || seen.has(s.e)) return undefined;
    const x = num(s.x, 0, 514), y = num(s.y, 0, 333), size = num(s.s, 22, 520), rot = num(s.r, -180, 180);
    const shape = s.k === undefined ? 'square' : s.k;
    const crop = s.c === undefined ? 1 : num(s.c, 0.35, 1);
    if (x === null || y === null || size === null || rot === null || crop === null) return undefined;
    if (typeof shape !== 'string' || !STICKER_SHAPES.includes(shape)) return undefined;
    seen.add(s.e);
    stickers.push({ e: s.e, x: r1(x), y: r1(y), s: r1(size), r: r1(rot), k: shape, c: Math.round(crop * 100) / 100 });
  }
  const back = { stickers, text_top: o.text_top === true, outline: o.outline === true };
  return stickers.length || back.text_top || back.outline ? back : null;
}

/** 英字名: 半角の英字・数字と一部の記号 (! ? . - _ ' & +) と空白、1〜45 文字、前後の空白・続けての空白なし、英字か数字が 1 文字は要る (フロントの latinNameValid と同じ) */
export const LATIN_NAME = /^[A-Za-z0-9!?.\-_'&+]+(?: [A-Za-z0-9!?.\-_'&+]+)*$/;

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
  for (const k of Object.keys(o)) if (k !== 'template' && k !== 'color' && k !== 'ach' && k !== 'tour' && k !== 'title' && k !== 'latin' && k !== 'back') return null;
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
    if (typeof o.latin !== 'string' || !LATIN_NAME.test(o.latin) || !/[A-Za-z0-9]/.test(o.latin) || o.latin.length > 45) return null;
    latin = o.latin;
  }
  const back = validateCardBack(o.back);
  if (back === undefined) return null;
  // 裏面は貼っているときだけ欄を置く (前からの設定・応答の形を変えない)
  return back ? { template: o.template, color: o.color, ach, tour, title, latin, back } : { template: o.template, color: o.color, ach, tour, title, latin };
}

const TIER_ORDER = ['rainbow', 'gold', 'silver', 'normal'];
const TIER_CODE: Record<string, number> = { r: 0, g: 1, s: 2, n: 3 };

/**
 * 貼ったシールをその選手が持っているか。選手のデータ (players/<uid>.json、ビルドが大会記録に sticker = もらった一番上の色を書く。
 * spsp_scripts spsp/stickers.py) を読み、大会キー (event_id、下位クラスは親の event_id + クラスの文字) ごとに一番上の色を出し、
 * 貼った色がそれ以下 (下の色は全部持っている) か確かめる。返り値: null = 全部持っている / 'not_owned' / 'unavailable' (データが読めない)
 */
export async function checkStickersOwned(dataFetch: DataFetch, uid: string, back: CardBack, preview = false): Promise<null | 'not_owned' | 'unavailable'> {
  if (!back.stickers.length) return null;
  let rec: { tournaments?: unknown } | null;
  try {
    const res = await dataFetch('/players/' + encodeURIComponent(uid) + '.json');
    if (res.status === 404) return 'not_owned';
    if (res.status !== 200) return 'unavailable';
    rec = await res.json();
  } catch (_) {
    return 'unavailable';
  }
  const top = new Map<string, number>();
  const tours = Array.isArray(rec && rec.tournaments) ? (rec as { tournaments: unknown[] }).tournaments : [];
  // preview だけ: 選手のデータにまだ大会シールが無ければ (ビルドに入る前)、プレビュー用の判定 {uid: {大会キー: r|g|s|n}} で確かめる
  if (preview && !tours.some(t => t && typeof t === 'object' && 'sticker' in (t as object))) {
    try {
      const res = await dataFetch(`/data/stickers_preview/${Number(uid) % 64}.json`);
      if (res.status !== 200) return 'unavailable';
      const shard = (await res.json()) as Record<string, Record<string, string>>;
      for (const [k, c] of Object.entries((shard && shard[String(uid)]) || {})) if (c in TIER_CODE) top.set(k, TIER_CODE[c]);
    } catch (_) {
      return 'unavailable';
    }
  }
  for (const t of tours) {
    if (!t || typeof t !== 'object') continue;
    const o = t as Record<string, unknown>;
    const tier = TIER_ORDER.indexOf(String(o.sticker));
    if (tier < 0) continue;
    const key = o.event_id ? String(o.event_id) : o.parent_event_id && o.class_letter ? `${o.parent_event_id}${o.class_letter}` : '';
    if (!key) continue;
    const prev = top.get(key);
    if (prev === undefined || tier < prev) top.set(key, tier);
  }
  for (const s of back.stickers) {
    const i = s.e.lastIndexOf(':');
    const have = top.get(s.e.slice(0, i));
    if (have === undefined || TIER_CODE[s.e.slice(i + 1)] < have) return 'not_owned';
  }
  return null;
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
export async function handleCardPut(cfg: Config, store: Store, req: Record<string, unknown>, now: number, dataFetch?: DataFetch): Promise<HandlerResult> {
  const sess = await verifySessionToken(cfg, req.token, now);
  // preview (CARD_OPEN_EDIT=1) だけ: ログインなしなら、リクエストの uid に書く (誰でも編集できる確認用)
  const openUid = !sess && cfg.cardOpenEdit ? validUid(req.uid) : null;
  if (!sess && !openUid) return err('invalid_session', MSG_INVALID_SESSION);
  const uid = sess ? validUid(sess.id) : openUid;
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

  // 裏面のシール: 持っているものだけ (選手のデータと突き合わせる。読めないときは保存しない)
  if (settings && settings.back && settings.back.stickers.length) {
    const r = dataFetch ? await checkStickersOwned(dataFetch, uid, settings.back, !!cfg.stickersPreview) : 'unavailable';
    if (r === 'not_owned') return err('sticker_not_owned', 'まだ持っていないシールがあります。', 'sticker_not_owned');
    if (r === 'unavailable') return err('internal', '選手のデータを読めませんでした。少し待ってからやり直してください。', 'sticker_check');
  }

  const updatedAt = formatIso(now, cfg.tsOffsetMin);
  const day = dayKey(now, cfg.tsOffsetMin);
  const done = await store.putCardSettings(uid, settings === null ? null : JSON.stringify(settings), updatedAt, {
    userId: uid, nowMs: now, minIntervalMs: CARD_RATE_MIN_INTERVAL_MS, dayKey: day, maxPerDay: CARD_RATE_MAX_PER_DAY,
  });
  if (!done) return err('rate_limited', MSG_RATE);
  return settings === null ? ok({ settings: null, updated_at: null }) : ok({ settings, updated_at: updatedAt });
}
