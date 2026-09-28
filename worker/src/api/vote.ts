/**
 * キャラ投票 — 本人のメインキャラ 1 体を報告する (gas/vote.gs の移植)。
 *
 * 投票できる条件 (すべて満たすこと):
 *   1. start.gg の選手認証 (セッショントークン) が有効
 *   2. SPSP にデータがある選手 (players/<uid>.json が存在する)
 *   3. 使用キャラ情報が無いか、ダブルメイン圏 (= メイン判定が僅差)
 *
 * 判定は投票時に公開データ (DATA_ORIGIN) を読んで行う。GAS は gh-pages を
 * UrlFetchApp で読んでいた。Worker では dataFetch (URL か ASSETS binding) で読む。
 * 資格がある間は再投票可 (上書き)。ビルド側は uid ごとに最新行を採用する。
 */
import type { Config } from '../config.ts';
import { DOUBLE_MAIN_PCT_GAP } from '../config.ts';
import type { Store } from '../store.ts';
import { checkRateLimit, guardFor } from './ratelimit.ts';
import type { ErrorCode, HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { verifySessionToken } from './session.ts';
import { dayKey, formatIso } from './time.ts';

/** 公開データの相対パス ('/data/char_emoji.json' 等) を取りに行く。 */
export type DataFetch = (path: string) => Promise<Response>;

export interface Candidate { id: string; name: string }

/**
 * キャラ一覧 { id: name } を返す。取得失敗は null (internal 扱い)。
 * char_emoji.json が正 (Random 等の集計対象外はそもそも載っていない)。
 */
export async function fetchCharList(dataFetch: DataFetch): Promise<Record<string, string> | null> {
  let res: Response;
  try {
    res = await dataFetch('/data/char_emoji.json');
  } catch (ex) {
    console.error('char list fetch threw: ' + (ex instanceof Error ? ex.message : String(ex)));
    return null;
  }
  if (res.status !== 200) {
    console.error('char list fetch failed: HTTP ' + res.status);
    return null;
  }
  let json: Record<string, { name?: unknown } | null>;
  try {
    json = await res.json();
  } catch (_) {
    return null;
  }
  const out: Record<string, string> = {};
  for (const id in json) {
    const v = json[id];
    if (v && typeof v.name === 'string') out[id] = v.name;
  }
  return out;
}

/**
 * characters から「投票できる候補」を返す。
 *   null           → 使用実績が無い (全キャラから選べる)
 *   []             → 明確なメインがいる (投票不可)
 *   [{id,name}..]  → ダブルメイン圏 (この中からのみ投票可。必ず 2 体以上)
 *
 * - 基準は **最大 pct** (先頭ではない)。ビルドが投票採用で並びを変えるため。
 * - pct を持たないエントリ (= 投票由来) は実績として数えない。実績が 1 つも無ければ null。
 */
export function voteCandidates(chars: unknown): Candidate[] | null {
  if (!Array.isArray(chars) || !chars.length) return null;
  const measured: { id: string; name: string; pct: number }[] = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as { id?: unknown; name?: unknown; pct?: unknown } | null;
    const p = Number(c && c.pct);
    if (Number.isFinite(p) && c && c.id !== undefined && c.id !== null) {
      measured.push({ id: String(c.id), name: String(c.name || ''), pct: p });
    }
  }
  if (!measured.length) return null; // 投票由来のみ = 実績なし扱い
  let top = -Infinity;
  measured.forEach((c) => { if (c.pct > top) top = c.pct; });
  const out = measured.filter((c) => top - c.pct <= DOUBLE_MAIN_PCT_GAP)
    .map((c) => ({ id: c.id, name: c.name }));
  return out.length >= 2 ? out : [];
}

export type Eligibility =
  | { ok: true; candidates: Candidate[] | null }
  | { ok: false; code: ErrorCode; message: string };

const MSG_PLAYER_FETCH = '選手データの取得に失敗しました。時間をおいてやり直してください。';

/**
 * 投票資格を判定する。candidates が配列なら「ダブルメイン圏」= その中からのみ投票できる。
 */
export async function checkVoteEligibility(dataFetch: DataFetch, uid: string): Promise<Eligibility> {
  let res: Response;
  try {
    res = await dataFetch('/players/' + encodeURIComponent(uid) + '.json');
  } catch (ex) {
    console.error('player fetch threw: ' + (ex instanceof Error ? ex.message : String(ex)));
    return { ok: false, code: 'internal', message: MSG_PLAYER_FETCH };
  }
  const status = res.status;
  if (status === 404) {
    return { ok: false, code: 'not_player', message: 'キャラ投票は SPSP にデータがある選手のみ行えます。' };
  }
  if (status !== 200) {
    console.error('player fetch failed: HTTP ' + status);
    return { ok: false, code: 'internal', message: MSG_PLAYER_FETCH };
  }
  let rec: { characters?: unknown } | null;
  try {
    rec = await res.json();
  } catch (_) {
    return { ok: false, code: 'internal', message: MSG_PLAYER_FETCH };
  }
  const candidates = voteCandidates(rec && rec.characters);
  if (candidates && candidates.length === 0) {
    return { ok: false, code: 'char_exists',
      message: 'すでに使用キャラのデータがあり、メインキャラが明確なため投票できません (投票できるのは、キャラ情報が無い選手か、メインキャラ判定が僅差の選手のみです)。' };
  }
  return { ok: true, candidates };
}

/**
 * action: "vote" — { token, charId }
 * 認証を飛ばせる経路は無い (デバッグモードは 2026-08-14 に撤去済み)。
 * 例外: cfg.voteTesterUids (運営のテスト用) は資格判定 (メインが明確 / 僅差の候補外) を免除する。
 * 免除で通った投票は status='debug' で保存し、エクスポートで落ちるので集計されない (資格がある場合は通常どおり pending)。
 */
export async function handleVote(cfg: Config, store: Store, dataFetch: DataFetch, req: Record<string, unknown>, now: number = Date.now()): Promise<HandlerResult> {
  // ── 1. 本人確認 (セッション) ──
  const sess = await verifySessionToken(cfg, req.token, now);
  if (!sess) {
    return err('auth_failed', 'ログインが無効か期限切れです。もう一度認証してください。');
  }

  // ── 2. 入力検証 ──
  const charId = String(req.charId === undefined || req.charId === null ? '' : req.charId);
  if (!/^\d{1,8}$/.test(charId)) {
    return err('bad_request', 'キャラの指定が不正です。');
  }
  const chars = await fetchCharList(dataFetch);
  if (!chars) {
    return err('internal', 'キャラ一覧の取得に失敗しました。時間をおいてやり直してください。');
  }
  const charName = chars[charId];
  if (!charName) {
    return err('bad_char', 'そのキャラは選択できません。');
  }

  // ── 3. 資格判定 (INV-1: uid はトークン=currentUser 由来のみ) ──
  const tester = (cfg.voteTesterUids || []).includes(String(sess.id));
  let status = 'pending';
  const elig = await checkVoteEligibility(dataFetch, sess.id);
  if (!elig.ok) {
    if (!(tester && elig.code === 'char_exists')) return err(elig.code, elig.message);
    status = 'debug';   // テスト用 uid: メインが明確でも受け付けるが集計しない
  } else if (elig.candidates) {
    // ダブルメイン圏なら、候補の中からしか選べない
    const isCandidate = elig.candidates.some((c) => c.id === charId);
    if (!isCandidate) {
      if (!tester) {
        const names = elig.candidates.map((c) => c.name).join(' / ');
        return err('not_candidate', 'メインキャラ判定が僅差の ' + names + ' の中から選んでください。');
      }
      status = 'debug';
    }
  }

  // ── 4. 連投制御と append (条件付き INSERT で直列化) ──
  const day = dayKey(now, cfg.tsOffsetMin);
  const limited = await checkRateLimit(store, 'votes', sess.id, now, day);
  if (limited) {
    return err('rate_limited', limited);
  }
  const inserted = await store.insertVote({
    ts: formatIso(now, cfg.tsOffsetMin), ts_ms: now,
    user_id: sess.id, user_slug: sess.slug, gamer_tag: sess.gamerTag,
    char_id: charId, char_name: charName, status,
  }, guardFor(sess.id, now, day));
  if (!inserted) {
    const again = await checkRateLimit(store, 'votes', sess.id, now, day);
    return err('rate_limited', again || '投稿の間隔が短すぎます。1分ほど待ってからやり直してください。');
  }

  return status === 'debug'
    ? ok({ user: sess.slug, charId, charName, test: true })
    : ok({ user: sess.slug, charId, charName });
}
