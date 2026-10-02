/**
 * 持っている二つ名の記録 (D1 title_owned、docs/card_titles_design.md「持っている二つ名の記録」)。
 *
 *   action: "title_get"   { uid, lang }        → { bits, updated }  (GET /api/titles?uid=&lang=。だれでも読める)
 *   action: "title_sync"  { key, lang, items:[{uid, ids:[…]}], date? } → { changed, items:[{uid, bits, updated}] }
 *                         毎日のビルドの後に全選手分を送る (1 回 TITLE_SYNC_MAX_ITEMS 人まで)。記録に OR するだけで消さない。
 *                         ビットが増えた人だけ updated を date (省略時は今日、+09:00) にする。鍵 = Worker の secret TITLE_SYNC_KEY
 *                         items = 送った全員の OR 後の記録 (ビルドがこれを players/<uid>.json の title_bits / title_updated に書く。
 *                         何も持っていない人は bits "" / updated null)
 *   action: "title_export" { key, lang, after_uid?, limit? } → { items:[{uid, bits, updated}], next_after }  (復旧用、uid の昇順)
 * D1 が持ち物の正本。表示は players/<uid>.json (ビルド時に書く) で行い、card_put の確認は D1 を見る。
 * ビット列の形は site/js/titles.js (bitsFromIds / bitsHas / bitsOr) と同じ。
 */
import type { Config } from '../config.ts';
import { TITLE_EXPORT_MAX, TITLE_SYNC_MAX_IDS, TITLE_SYNC_MAX_ITEMS, requireSecret } from '../config.ts';
import type { Store } from '../store.ts';
import { keyMatches } from './export.ts';
import type { HandlerResult } from './respond.ts';
import { err, ok } from './respond.ts';
import { dayKey } from './time.ts';
import { TITLES, bitsFromIds, bitsOr, titleById } from './titles.ts';

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

/** action: "title_sync" — 鍵つき。記録に OR する (消さない)。 */
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
  // 入力を全部確かめてから書く (途中まで書いて失敗、を避ける)。一覧に無い id は送り手の誤りなので全体を弾く
  const add = new Map<string, string>();   // uid → 足すビット列 (同じ uid が 2 回来たら合わせる)
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as { uid?: unknown; ids?: unknown } | null;
    const uid = it && validUid(it.uid);
    if (!uid) return err('bad_request', 'uid が不正です (' + i + ' 番目)。', 'bad:uid');
    const ids = it.ids;
    if (!Array.isArray(ids) || ids.length > TITLE_SYNC_MAX_IDS) return err('bad_request', 'ids が不正です (' + i + ' 番目)。', 'bad:ids');
    for (const id of ids) {
      if (typeof id !== 'string' || !titleById(lang, id)) return err('bad_request', '一覧に無い二つ名です: ' + String(id).slice(0, 20), 'bad:id');
    }
    add.set(uid, bitsOr(add.get(uid) || '', bitsFromIds(ids as string[])));
  }
  const uids = [...add.keys()];
  const cur = await store.getTitleOwnedMany(uids, lang);
  const rows: { uid: string; bits: string; updated: string }[] = [];
  const result: { uid: number; bits: string; updated: string | null }[] = [];
  for (const uid of uids) {
    const before = cur.get(uid);
    const merged = bitsOr(before ? before.bits : '', add.get(uid) || '');
    if (before && merged === before.bits) {                    // 増えていない (日付も変えない)
      result.push({ uid: Number(uid), bits: before.bits, updated: before.updated });
      continue;
    }
    if (!before && merged === '') {                            // 何も持っていない人の行は作らない
      result.push({ uid: Number(uid), bits: '', updated: null });
      continue;
    }
    rows.push({ uid, bits: merged, updated: date });
    result.push({ uid: Number(uid), bits: merged, updated: date });
  }
  if (rows.length) await store.putTitleOwnedMany(lang, rows);
  return ok({ changed: rows.length, received: items.length, items: result });
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
