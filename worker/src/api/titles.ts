/**
 * 二つ名 (カードの title) — フロントの site/js/titles.js と site/js/title_bits.js をそのまま使う (同じ一覧・同じビット列。docs/card_titles_design.md)。
 * どちらも DOM に依存しない ESM。Worker の型チェックは .ts だけなので、ここで型を付けて受け渡す。
 * 束ねるのは wrangler (esbuild) で、相対パスの import をそのまま取り込む。
 * Worker が使うのは一覧 (card_put の確認・card_get の文字) とビット列だけ。抽選 (advanceTitles) は同期の道具が行う。
 */
// @ts-ignore -- JS (型は下で付ける)
import * as T from '../../../site/js/titles.js';
// @ts-ignore -- JS (型は下で付ける)
import * as B from '../../../site/js/title_bits.js';

/** 一覧の 1 件 (site/js/titles.js の Title) */
export interface Title {
  id: string;
  part: 'pre' | 'post' | 'both';
  text: string;
  unlock: 'initial' | 'random' | 'char' | 'pref';
  added: string;
  retired?: string;
  genre?: 'generic' | 'smash' | 'source';
  kind?: 'move';
  chars?: number[];
  pref?: string;
}

/** ビット列 (D1 title_owned.bits) の読み書き。title_bits.js と同じもの */
export const bitsHas: (bits: string, id: string) => boolean = B.bitsHas;
export const bitsOr: (a: string, b: string) => string = B.bitsOr;
export const bitsFromIds: (ids: Iterable<string>) => string = B.bitsFromIds;
/** 形 (base64url・詰め物なし) と長さ (maxBytes 以下) */
export const bitsValid: (bits: unknown, maxBytes?: number) => boolean = B.bitsValid;
export const TITLES: Record<string, Title[]> = T.TITLES;
/** 一覧から 1 つ (無ければ null)。 */
export const titleById: (lang: string, id: string | null | undefined) => Title | null = T.titleById;
/** その二つ名を前半 (pre) / 後半 (post) に使えるか (part 'both' はどちらでも) */
export const usableIn: (t: Title, slot: 'pre' | 'post') => boolean = T.usableIn;

/** 二つ名の言語。地域の一覧は日本 = ja、北米 = en (SITE_PREFIX で決める) */
export function titleLang(sitePrefix: string | undefined): string {
  return String(sitePrefix || '/jp').replace(/\/+$/, '') === '/na' ? 'en' : 'ja';
}
