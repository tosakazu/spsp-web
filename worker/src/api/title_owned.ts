/**
 * 持っている二つ名の記録 (D1 title_owned、docs/card_titles_design.md「持っている二つ名の記録」)。
 *
 *   action: "title_get"   { uid, lang }        → { bits, updated }  (GET /api/titles?uid=&lang=。だれでも読める)
 *   action: "title_sync"  { key, lang, items:[{uid, prev, bits, n_pre, n_post}], date? } → { changed, conflicts:[uid] }
 *                         同期の道具 (tools/titles/sync_owned.mjs) が title_export で今の記録を読み、まだ引いていない回を引いて (site/js/titles.js advanceTitles)
 *                         変わった人だけ送る。prev = 道具が読んだときの行 (無ければ null)。行が prev のままのときだけ書き、
 *                         違えば (ほかの同期が先に書いた) conflicts に入れて書かない (次の同期で読み直して引く)。
 *                         ビット列は増えるだけ (prev にあるものを消す送り方は弾く)。回数も減らさない。
 *                         一覧に無い番号も受ける (Worker の一覧が同期の道具より古いことがあるため。表示と card_put は一覧にあるものだけ使う)。
 *                         updated はビットが増えたときだけ date (省略時は今日、+09:00) にする。鍵 = Worker の secret TITLE_SYNC_KEY
 *   action: "title_export" { key, lang, after_uid?, limit? } → { items:[{uid, bits, updated, n_pre, n_post}], next_after }  (uid の昇順)
 * D1 が持ち物の正本。編集ページ・ヘッダーのお知らせは title_get、カードの表示は card_get の title_text、card_put の確認は D1 を見る。
 * ビット列の形は site/js/title_bits.js と同じ。
 */
import type { Config } from '../config.ts';
import { TITLE_BITS_MAX_BYTES, TITLE_DRAWS_MAX, TITLE_EXPORT_MAX, TITLE_SYNC_MAX_ITEMS, requireSecret } from '../config.ts';
import type { Store, TitleOwnedWrite } from '../store.ts';
import { keyMatches } from './export.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { dayKey } from './time.ts';
import { TITLES, bitsOr, bitsValid } from './titles.ts';

function validUid(v: unknown): string | null {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : '') : typeof v === 'string' ? v : '';
  return /^[1-9]\d{0,11}$/.test(s) ? s : null;
}

function validLang(v: unknown): string | null {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TITLES, v) ? v : null;
}

/** action: "title_get" — 記録が無ければ bits "" / updated null。 */
export async function handleTitleGet(store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  const uid = validUid(req.uid);
  if (!uid) return err('bad_request', '選手の指定が不正です。');
  const lang = validLang(req.lang === undefined || req.lang === '' ? 'ja' : req.lang);
  if (!lang) return err('bad_request', '言語の指定が不正です。');
  const row = await store.getTitleOwned(uid, lang);
  return ok({ bits: row ? row.bits : '', updated: row ? row.updated : null });
}

/** 回数 (0〜TITLE_DRAWS_MAX の整数) */
function validCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= TITLE_DRAWS_MAX ? v : null;
}

/** ビット列 (形と長さ。末尾の 0 を落とした形だけ受ける = 同じ中身なら同じ文字列なので、prev との比較がずれない) */
function validBits(v: unknown): string | null {
  return bitsValid(v, TITLE_BITS_MAX_BYTES) && bitsOr('', v as string) === v ? (v as string) : null;
}

/** action: "title_sync" — 鍵つき。読んだときのままの行だけ書く (ビット列は増えるだけ)。 */
export async function handleTitleSync(cfg: Config, store: Store, req: Record<string, unknown>, now: number): Promise<HandlerResult> {
  const expected = requireSecret(cfg.titleSyncKey, 'TITLE_SYNC_KEY');
  if (!keyMatches(req.key, expected)) return err('auth_failed', '鍵が一致しません。');
  const lang = validLang(req.lang);
  if (!lang) return err('bad_request', '言語の指定が不正です。', 'bad:lang');
  let date = dayKey(now, cfg.tsOffsetMin);
  if (req.date !== undefined && req.date !== null) {
    if (typeof req.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(req.date)) return err('bad_request', '日付の形式が不正です。', 'bad:date');
    date = req.date;
  }
  const items = req.items;
  if (!Array.isArray(items) || items.length > TITLE_SYNC_MAX_ITEMS) {
    return err('bad_request', '選手の並びが不正か、多すぎます (' + TITLE_SYNC_MAX_ITEMS + ' 人まで)。', 'bad:items');
  }
  // 入力を全部確かめてから書く (途中まで書いて失敗、を避ける)
  const rows: TitleOwnedWrite[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Record<string, unknown> | null;
    const bad = (what: string) => err('bad_request', what + ' が不正です (' + i + ' 番目)。', 'bad:' + what);
    const uid = it && typeof it === 'object' ? validUid(it.uid) : null;
    if (!it || !uid || seen.has(uid)) return bad('uid');
    seen.add(uid);
    const bits = validBits(it.bits);
    const nPre = validCount(it.n_pre), nPost = validCount(it.n_post);
    if (bits === null) return bad('bits');
    if (nPre === null || nPost === null) return bad('n');
    let prev: TitleOwnedWrite['prev'] = null;
    if (it.prev !== null) {
      const p = it.prev as Record<string, unknown> | undefined;
      const pb = p && typeof p === 'object' ? validBits(p.bits) : null;
      const pn = p && typeof p === 'object' ? validCount(p.n_pre) : null, pm = p && typeof p === 'object' ? validCount(p.n_post) : null;
      if (pb === null || pn === null || pm === null) return bad('prev');
      prev = { bits: pb, n_pre: pn, n_post: pm };
      // 消す・回数を戻す送り方は弾く (記録は増えるだけ)
      if (bitsOr(pb, bits) !== bits || nPre < pn || nPost < pm) return bad('shrink');
    }
    rows.push({ uid, prev, bits, n_pre: nPre, n_post: nPost });
  }
  const conflicts = rows.length ? await store.casTitleOwnedMany(lang, rows, date) : [];
  return ok({ changed: rows.length - conflicts.length, received: items.length, conflicts: conflicts.map(Number) });
}

/** action: "title_export" — 鍵つき。uid の昇順に limit 件ずつ (next_after を次の after_uid に。最後は null)。 */
export async function handleTitleExport(cfg: Config, store: Store, req: Record<string, unknown>): Promise<HandlerResult> {
  const expected = requireSecret(cfg.titleSyncKey, 'TITLE_SYNC_KEY');
  if (!keyMatches(req.key, expected)) return err('auth_failed', '鍵が一致しません。');
  const lang = validLang(req.lang);
  if (!lang) return err('bad_request', '言語の指定が不正です。', 'bad:lang');
  let after = 0;
  if (req.after_uid !== undefined && req.after_uid !== null && req.after_uid !== '') {
    const a = validUid(req.after_uid);
    if (!a) return err('bad_request', 'after_uid が不正です。', 'bad:after_uid');
    after = Number(a);
  }
  let limit = TITLE_EXPORT_MAX;
  if (req.limit !== undefined && req.limit !== null) {
    const l = Number(req.limit);
    if (!Number.isInteger(l) || l < 1 || l > TITLE_EXPORT_MAX) return err('bad_request', 'limit は 1〜' + TITLE_EXPORT_MAX + ' です。', 'bad:limit');
    limit = l;
  }
  const items = await store.listTitleOwned(lang, after, limit);
  return ok({ items, next_after: items.length === limit ? items[items.length - 1].uid : null });
}
