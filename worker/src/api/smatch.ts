/**
 * スマッチ (オンラインのレート対戦サイト) との連携 (2026-11-15)。docs/smatch_partner.md
 *
 *   SPSP → スマッチ  GET /api/partner/smatch/players  (Authorization: Bearer <SMATCH_EXPORT_TOKENS のどれか>)
 *       ビルドが書いた一覧 (DATA_ORIGIN の /data/partner_smatch.json、公開済みの情報だけ) をそのまま返す。Worker では組み立てない。
 *   スマッチ → SPSP  定期実行が 1 日 1 回 SMATCH_IMPORT_URL を読んで D1 (smatch_players) に入れる (runSmatchImport)。
 *       読めない・形が違う・人数が急に減った → 何も書かず前の値のまま。失敗は partner_sync に残す。
 *   状態            GET /api/partner/smatch/status   (だれでも。経過時間と件数だけ。外形監視 tools/monitor/check.mjs が見る)
 *   手動の取り込み   POST /api/partner/smatch/import { key }  (EXPORT_KEY。preview には定期実行が無い)
 *   表示            card_get の応答に smatch を足す (smatchViewOf。プレイヤーページが追加の通信なしで出せるように)
 *   プロフィールの設定 action profile_get { token } / profile_put { token, settings }  ({ smatch: false } = スマッチのレートを出さない)
 *
 * 「最高レートを見せない」(max_hidden) 人の最高レートは D1 の data にだけ置き、応答 (smatchViewOf) には出さない。
 * 連携を解除した人 (一覧から消えた人) は linked = 0 にして出さない。行は消さない。
 */
import type { Config } from '../config.ts';
import type { Store } from '../store.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { exportKeyOk } from './export.ts';
import { timingSafeEq, verifySessionToken } from './session.ts';
import { formatIso } from './time.ts';

export const SMATCH_IMPORT = 'smatch_import';
export const SMATCH_EXPORT = 'smatch_export';
/** 取り込みの間隔 (前に成功してからこれだけ経ったら読む) と、失敗したあと次に試すまで */
export const SMATCH_IMPORT_EVERY_MS = 20 * 3600e3;
export const SMATCH_RETRY_MS = 30 * 60e3;
/** この時間 (JST) は読みに行かない (スマッチの混む時間。20 時〜翌 5 時) */
export const SMATCH_QUIET = { from: 20, to: 5 };
/** これより古い取り込みは表示に使わない */
export const SMATCH_STALE_MS = 7 * 86400e3;
/** 一覧の大きさの上限 (これを超えたら読まない) */
export const SMATCH_MAX_BYTES = 8 * 1024 * 1024;
export const SMATCH_MAX_PLAYERS = 100000;
/** 人数が前回のこの割合を下回ったら、壊れた一覧とみなして捨てる (前回が少ないうちは見ない) */
export const SMATCH_SHRINK_RATIO = 0.5;
export const SMATCH_SHRINK_MIN_PREV = 20;

export const SMATCH_MODES = ['1on1', 'tokuoma'] as const;
export type SmatchMode = typeof SMATCH_MODES[number];
/** 1 つのルールの成績。rate・rank・season_max・games (対戦数) は今シーズン (対戦していなければ null、games は 0)、max は全シーズンの最高。
 *  games が来ていない (古い形) ときは null */
export interface SmatchModeStat { rate: number | null; rank: number | null; season_max: number | null; max: number | null; games: number | null }
export interface SmatchPlayer {
  discriminator: string; smatch_id: number; name: string; max_hidden: boolean;
  modes: Partial<Record<SmatchMode, SmatchModeStat>>;
}
export interface SmatchSeason { id: string; name: string }
export interface SmatchPayload { generated_at: number; season: SmatchSeason | null; url_template: string; players: SmatchPlayer[] }
/** partner_sync.meta (取り込みのたびに書く) */
export interface SmatchMeta { generated_at: number; season: SmatchSeason | null; url_template: string }

const DISC = /^[0-9a-f]{8}$/;
const numOrNull = (v: unknown, lo: number, hi: number): number | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined;

function parseMode(v: unknown): SmatchModeStat | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const rate = numOrNull(o.rate, 0, 99999), rank = numOrNull(o.rank, 1, 9999999);
  const seasonMax = numOrNull(o.season_max, 0, 99999), max = numOrNull(o.max, 0, 99999);
  const games = numOrNull(o.games, 0, 9999999);
  if (rate === undefined || rank === undefined || seasonMax === undefined || max === undefined || games === undefined) return undefined;
  if (rate === null && rank === null && seasonMax === null && max === null) return null;
  return { rate, rank, season_max: seasonMax, max, games };
}

/** スマッチの URL だけ通す (https://smatch-jp.com/ 配下、{smatch_id} を 1 つ含む) */
export function validUrlTemplate(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 200) return null;
  if (!/^https:\/\/smatch-jp\.com\/[A-Za-z0-9\-._~\/{}]*$/.test(v)) return null;
  return v.split('{smatch_id}').length === 2 && !/[{}]/.test(v.replace('{smatch_id}', '')) ? v : null;
}

/**
 * 受け取った一覧を確かめる。形が違えば理由 (文字列) を返す。1 人でも形が違えば全体を捨てる (半端に取り込まない)。
 * 知らない欄は無視する。1on1 だけの古い形 (rate / rank / max_rate を 1 人の直下に置く) も読む。
 */
export function parseSmatchPayload(v: unknown): SmatchPayload | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'not_object';
  const o = v as Record<string, unknown>;
  if (o.version !== undefined && o.version !== 1) return 'version';
  if (typeof o.generated_at !== 'number' || !Number.isFinite(o.generated_at) || o.generated_at < 1.6e9 || o.generated_at > 4e9) return 'generated_at';
  let season: SmatchSeason | null = null;
  if (o.season !== undefined && o.season !== null) {
    const s = o.season as Record<string, unknown>;
    if (typeof s !== 'object' || Array.isArray(s)) return 'season';
    const id = typeof s.id === 'number' || typeof s.id === 'string' ? String(s.id) : '';
    const name = typeof s.name === 'string' ? s.name : '';
    if (!id || id.length > 40 || name.length > 60) return 'season';
    season = { id, name };
  }
  const tpl = o.url_template === undefined ? 'https://smatch-jp.com/user/{smatch_id}/' : validUrlTemplate(o.url_template);
  if (!tpl) return 'url_template';
  if (!Array.isArray(o.players) || o.players.length > SMATCH_MAX_PLAYERS) return 'players';
  const seen = new Set<string>();
  const players: SmatchPlayer[] = [];
  for (let i = 0; i < o.players.length; i++) {
    const p = o.players[i] as Record<string, unknown>;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return `players[${i}]`;
    const d = typeof p.discriminator === 'string' ? p.discriminator.toLowerCase() : '';
    if (!DISC.test(d) || seen.has(d)) return `players[${i}].discriminator`;
    if (typeof p.smatch_id !== 'number' || !Number.isInteger(p.smatch_id) || p.smatch_id < 1 || p.smatch_id > 1e12) return `players[${i}].smatch_id`;
    if (typeof p.name !== 'string' || p.name.length > 100) return `players[${i}].name`;
    if (p.max_hidden !== undefined && typeof p.max_hidden !== 'boolean') return `players[${i}].max_hidden`;
    const modes: Partial<Record<SmatchMode, SmatchModeStat>> = {};
    const src = p.modes !== undefined && p.modes !== null ? p.modes as Record<string, unknown>
      : { '1on1': { rate: p.rate, rank: p.rank, max: p.max_rate } };
    if (typeof src !== 'object' || Array.isArray(src)) return `players[${i}].modes`;
    for (const m of SMATCH_MODES) {
      const st = parseMode(src[m]);
      if (st === undefined) return `players[${i}].modes.${m}`;
      if (st) modes[m] = st;
    }
    seen.add(d);
    players.push({ discriminator: d, smatch_id: p.smatch_id, name: p.name, max_hidden: p.max_hidden === true, modes });
  }
  return { generated_at: Math.round(o.generated_at), season, url_template: tpl, players };
}

/** D1 に置く 1 人分 (並びを固定して、前回と同じなら書かない) */
export function playerData(p: SmatchPlayer): string {
  const modes: Record<string, SmatchModeStat> = {};
  for (const m of SMATCH_MODES) { const s = p.modes[m]; if (s) modes[m] = { rate: s.rate, rank: s.rank, season_max: s.season_max, max: s.max, games: s.games ?? null }; }
  return JSON.stringify({ smatch_id: p.smatch_id, name: p.name, max_hidden: p.max_hidden, modes });
}

/** 表示用 (だれにでも返す形)。最高レートを見せない人は season_max・max を出さない。
 *  今シーズンの対戦数が 0 のルール (games が 0、または games が無くて rate が null) は欄ごと出さない */
export interface SmatchView {
  url: string; name: string; season: string; as_of: number;
  modes: Partial<Record<SmatchMode, SmatchModeStat>>;
}
export function smatchViewOf(row: { data: string; meta: string; ok_ms: number; profile: string | null } | null, nowMs: number): SmatchView | null {
  if (!row || !row.ok_ms || nowMs - row.ok_ms > SMATCH_STALE_MS) return null;
  if (!profileOf(row.profile).smatch) return null;
  let d: { smatch_id: number; name: string; max_hidden: boolean; modes: Record<string, SmatchModeStat> };
  let meta: SmatchMeta;
  try { d = JSON.parse(row.data); meta = JSON.parse(row.meta); } catch (_) { return null; }
  if (!d || !meta || !validUrlTemplate(meta.url_template)) return null;
  const modes: SmatchView['modes'] = {};
  for (const m of SMATCH_MODES) {
    const s = d.modes && d.modes[m];
    if (!s) continue;
    const games = typeof s.games === 'number' ? s.games : null;
    if (games === 0 || s.rate === null) continue;
    modes[m] = { rate: s.rate, rank: s.rank, season_max: d.max_hidden ? null : s.season_max, max: d.max_hidden ? null : s.max, games };
  }
  if (!Object.keys(modes).length) return null;
  return { url: meta.url_template.replace('{smatch_id}', String(d.smatch_id)), name: String(d.name || ''), season: meta.season ? meta.season.name : '', as_of: meta.generated_at, modes };
}

/** プロフィールの設定。smatch = スマッチのレートを自分のページに出すか (既定は出す) */
export interface ProfileSettings { smatch: boolean }
export const DEFAULT_PROFILE: ProfileSettings = { smatch: true };
export function profileOf(json: string | null | undefined): ProfileSettings {
  if (!json) return { ...DEFAULT_PROFILE };
  try { const v = validateProfile(JSON.parse(json)); return v || { ...DEFAULT_PROFILE }; } catch (_) { return { ...DEFAULT_PROFILE }; }
}
export function validateProfile(v: unknown): ProfileSettings | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== 'smatch') return null;
  if (o.smatch !== undefined && typeof o.smatch !== 'boolean') return null;
  return { smatch: o.smatch !== false };
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
type DataFetch = (path: string) => Promise<Response>;

/** 今読みに行くか (前の成功から 20 時間、失敗のあとは 30 分あける。スマッチの混む時間は避ける) */
export function smatchImportDue(sync: { ok_ms: number; try_ms: number } | null, nowMs: number, tsOffsetMin: number): boolean {
  const hour = new Date(nowMs + tsOffsetMin * 60e3).getUTCHours();
  if (hour >= SMATCH_QUIET.from || hour < SMATCH_QUIET.to) return false;
  if (!sync) return true;
  return nowMs - sync.ok_ms >= SMATCH_IMPORT_EVERY_MS && nowMs - sync.try_ms >= SMATCH_RETRY_MS;
}

/**
 * スマッチの一覧を読んで D1 に入れる。返り値 = { code: 'ok' | 'skip' | 失敗の理由, n }。
 * force = 間隔・時間帯を見ない (手動)。失敗しても例外は投げない (前の値のまま、partner_sync に理由を残す)。
 */
export async function runSmatchImport(cfg: Config, store: Store, fetchFn: Fetch, dataFetch: DataFetch, nowMs: number, force = false): Promise<{ code: string; n: number }> {
  if (!cfg.smatchImportUrl || !cfg.smatchImportToken) return { code: 'skip', n: 0 };
  const sync = await store.getPartnerSync(SMATCH_IMPORT);
  if (!force && !smatchImportDue(sync, nowMs, cfg.tsOffsetMin)) return { code: 'skip', n: 0 };
  const fail = async (code: string): Promise<{ code: string; n: number }> => {
    await store.putPartnerSync(SMATCH_IMPORT, { try_ms: nowMs, fails: (sync ? sync.fails : 0) + 1, error: code.slice(0, 200) });
    return { code, n: 0 };
  };
  let payload: SmatchPayload;
  try {
    const res = await fetchFn(cfg.smatchImportUrl, { headers: { Authorization: 'Bearer ' + cfg.smatchImportToken, Accept: 'application/json', 'User-Agent': 'spsp-partner/1.0' } });
    if (res.status !== 200) return await fail('http_' + res.status);
    const text = await res.text();
    if (text.length > SMATCH_MAX_BYTES) return await fail('too_large');
    let json: unknown;
    try { json = JSON.parse(text); } catch (_) { return await fail('bad_json'); }
    const parsed = parseSmatchPayload(json);
    if (typeof parsed === 'string') return await fail('bad_shape:' + parsed);
    payload = parsed;
  } catch (e) {
    return await fail('fetch:' + String(e).slice(0, 120));
  }
  if (sync && sync.ok_ms && sync.n >= SMATCH_SHRINK_MIN_PREV && payload.players.length < sync.n * SMATCH_SHRINK_RATIO) {
    return await fail(`shrunk:${sync.n}->${payload.players.length}`);
  }
  // discriminator → SPSP の uid (統合済みは統合先)。読めなければ取り込まない (uid が付かず表示が消えるのを避ける)
  const uidOf = new Map<string, number>();
  try {
    const [dRes, mRes] = await Promise.all([dataFetch('/data/discriminators.json'), dataFetch('/data/user_merges.json')]);
    if (dRes.status !== 200) return await fail('discriminators_http_' + dRes.status);
    const discs = (await dRes.json()) as Record<string, string>;
    const merges = mRes.status === 200 ? (await mRes.json()) as Record<string, number> : {};
    const want = new Set(payload.players.map(p => p.discriminator));
    for (const [uid, d] of Object.entries(discs)) {
      if (!want.has(String(d).toLowerCase())) continue;
      let u = Number(uid);
      for (let i = 0; i < 5 && merges[String(u)]; i++) u = Number(merges[String(u)]);
      if (Number.isInteger(u) && u > 0) uidOf.set(String(d).toLowerCase(), u);
    }
  } catch (e) {
    return await fail('discriminators:' + String(e).slice(0, 120));
  }
  const prev = new Map((await store.listSmatchPlayers()).map(r => [r.discriminator, r]));
  const upserts: { discriminator: string; uid: number | null; smatch_id: number; data: string }[] = [];
  const seen = new Set<string>();
  for (const p of payload.players) {
    seen.add(p.discriminator);
    const data = playerData(p), uid = uidOf.get(p.discriminator) ?? null;
    const old = prev.get(p.discriminator);
    if (old && old.linked && old.data === data && old.uid === uid) continue;   // 変わっていなければ書かない
    upserts.push({ discriminator: p.discriminator, uid, smatch_id: p.smatch_id, data });
  }
  const unlink = [...prev.values()].filter(r => r.linked && !seen.has(r.discriminator)).map(r => r.discriminator);
  await store.applySmatchImport(upserts, unlink, formatIso(nowMs, cfg.tsOffsetMin));
  const meta: SmatchMeta = { generated_at: payload.generated_at, season: payload.season, url_template: payload.url_template };
  await store.putPartnerSync(SMATCH_IMPORT, { ok_ms: nowMs, try_ms: nowMs, fails: 0, n: payload.players.length, error: '', meta: JSON.stringify(meta) });
  return { code: 'ok', n: payload.players.length };
}

/** Authorization: Bearer <token> が SMATCH_EXPORT_TOKENS のどれかと一致するか (入れ替えの間は新旧 2 本を並べる) */
export function exportTokenOk(cfg: Config, authorization: string | null): boolean {
  const m = /^Bearer\s+(\S+)$/.exec(String(authorization || ''));
  if (!m) return false;
  let hit = false;
  for (const t of cfg.smatchExportTokens || []) if (t && timingSafeEq(m[1], t)) hit = true;
  return hit;
}

/** GET /api/partner/smatch/players — ビルドが書いた一覧をそのまま返す。読みに来た時刻を残す (来なくなったら気づけるように) */
export async function handleSmatchExport(cfg: Config, store: Store, dataFetch: DataFetch, authorization: string | null, nowMs: number): Promise<Response> {
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!cfg.smatchExportTokens || !cfg.smatchExportTokens.length) return json(404, { error: 'not_configured' });
  if (!exportTokenOk(cfg, authorization)) return json(401, { error: 'unauthorized' });
  let res: Response;
  try { res = await dataFetch('/data/partner_smatch.json'); } catch (_) { return json(503, { error: 'unavailable' }); }
  if (res.status !== 200) return json(503, { error: 'unavailable' });
  await store.putPartnerSync(SMATCH_EXPORT, { ok_ms: nowMs, try_ms: nowMs }).catch(() => {});
  return new Response(res.body, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** GET /api/partner/smatch/status — 経過時間と件数だけ (理由の文字や URL は出さない) */
export async function handleSmatchStatus(cfg: Config, store: Store, nowMs: number): Promise<HandlerResult> {
  const age = (ms: number): number | null => (ms ? Math.round((nowMs - ms) / 360e3) / 10 : null);
  const imp = cfg.smatchImportUrl && cfg.smatchImportToken ? await store.getPartnerSync(SMATCH_IMPORT) : null;
  const exp = cfg.smatchExportTokens && cfg.smatchExportTokens.length ? await store.getPartnerSync(SMATCH_EXPORT) : null;
  return ok({
    // ready = スマッチの一覧を一度でも取り込めた (それまではプロフィール編集への入口を出さない。site/js/login.js の smatchReady)
    ready: !!(imp && imp.ok_ms),
    import: cfg.smatchImportUrl && cfg.smatchImportToken ? { ok_age_h: imp ? age(imp.ok_ms) : null, try_age_h: imp ? age(imp.try_ms) : null, fails: imp ? imp.fails : 0, n: imp ? imp.n : 0 } : null,
    export: cfg.smatchExportTokens && cfg.smatchExportTokens.length ? { read_age_h: exp ? age(exp.ok_ms) : null } : null,
  });
}

/** POST /api/partner/smatch/import { key } — 今すぐ取り込む (EXPORT_KEY) */
export async function handleSmatchImportNow(cfg: Config, store: Store, fetchFn: Fetch, dataFetch: DataFetch, req: Record<string, unknown>, nowMs: number): Promise<HandlerResult> {
  if (!(await exportKeyOk(cfg, req && req.key))) return err('auth_failed', '鍵が違います。');
  const r = await runSmatchImport(cfg, store, fetchFn, dataFetch, nowMs, true);
  const sync = await store.getPartnerSync(SMATCH_IMPORT);
  return ok({ result: r, sync: sync ? { ok_ms: sync.ok_ms, try_ms: sync.try_ms, fails: sync.fails, n: sync.n, error: sync.error } : null });
}

const MSG_INVALID_SESSION = 'ログインが無効か期限切れです。もう一度ログインしてください。';
const validUid = (v: unknown): string | null => { const s = String(v ?? ''); return /^\d{1,12}$/.test(s) ? String(Number(s)) : null; };

/** だれの設定を読み書きするか: ログイン中の本人。preview (CARD_OPEN_EDIT=1) だけ、ログインなしならリクエストの uid */
async function profileUid(cfg: Config, req: Record<string, unknown>, now: number): Promise<string | null> {
  const sess = await verifySessionToken(cfg, req.token, now);
  if (sess) return validUid(sess.id);
  return cfg.cardOpenEdit ? validUid(req.uid) : null;
}

/** action: "profile_get" { token } → { settings, smatch: { linked } } (smatch = スマッチで start.gg を連携しているか) */
export async function handleProfileGet(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const uid = await profileUid(cfg, req, now);
  if (!uid) return err('invalid_session', MSG_INVALID_SESSION);
  const row = await store.getSmatchForUid(uid);
  return ok({ settings: profileOf(row ? row.profile : await store.getProfileSettings(uid)), smatch: { linked: !!(row && row.data) } });
}

/** action: "profile_put" { token, settings } → { settings } */
export async function handleProfilePut(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const uid = await profileUid(cfg, req, now);
  if (!uid) return err('invalid_session', MSG_INVALID_SESSION);
  const s = validateProfile(req.settings);
  if (!s) return err('bad_settings', '設定の形式が不正です。');
  await store.putProfileSettings(uid, JSON.stringify(s), formatIso(now, cfg.tsOffsetMin));
  return ok({ settings: s });
}
