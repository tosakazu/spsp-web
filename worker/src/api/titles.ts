/**
 * 二つ名 (カードの title) — フロントの site/js/titles.js をそのまま使う (同じ一覧・同じ計算。docs/card_titles_design.md)。
 * titles.js は DOM に依存しない ESM。Worker の型チェックは .ts だけなので、ここで型を付けて受け渡す。
 * 束ねるのは wrangler (esbuild) で、相対パスの import をそのまま取り込む。
 */
// @ts-ignore -- JS (型は下で付ける)
import * as T from '../../../site/js/titles.js';

export interface Title { id: string; part: 'pre' | 'post' | 'both'; text: string; unlock: string; added: string; retired?: string }
export interface OwnedTitle { at: string; how: string }
export interface TitleTour { date?: string; event_id?: number | string; parent_event_id?: number | string | null }

/** 一覧から 1 つ (無ければ null)。 */
export const titleById: (lang: string, id: string | null | undefined) => Title | null = T.titleById;
/** その二つ名を前半 (pre) / 後半 (post) に使えるか (part 'both' はどちらでも) */
export const usableIn: (t: Title, slot: 'pre' | 'post') => boolean = T.usableIn;
/** その選手が持っている二つ名 (id → 解放日)。uid = start.gg のユーザー ID、tournaments = 公開データの players/<uid>.json の tournaments */
export const ownedTitles: (lang: string, uid: number | string, tournaments: TitleTour[]) => Map<string, OwnedTitle> = T.ownedTitles;

/** 二つ名の言語。地域の一覧は日本 = ja、北米 = en (SITE_PREFIX で決める) */
export function titleLang(sitePrefix: string | undefined): string {
  return String(sitePrefix || '/jp').replace(/\/+$/, '') === '/na' ? 'en' : 'ja';
}
