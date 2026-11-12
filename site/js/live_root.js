// @ts-check
// live_root.js — 速報 (live/<地域>/) の置き場と、本人が出ている開催中の大会の一覧 (index.json だけ)。
//   live.js (速報の画面) から切り出した小さい部分。人型のメニュー (nav.js) と結果報告のお知らせ (report_notice.js) が使う
//   (live.js ごと読むと全ページの nav が重くなるため、2026-11-04)
import SPSPLinks from './links.js';
'use strict';

const W = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);

/** 速報の置き場 (末尾 /)。プレビュー (spsp.games 以外) では ?live=sample で見本 (live/sample/) を読む */
export function liveRoot() {
  const root = (W.SPSP && W.SPSP.site && W.SPSP.site.live) || '';
  if (!root) return '';
  const host = (W.location && W.location.hostname) || '';
  const sample = /[?&]live=sample(&|$)/.test((W.location && W.location.search) || '');
  if (sample && host !== 'spsp.games') return root.replace(/live\/[^/]+\/$/, 'live/sample/');
  return root;
}

/** 本人の開催中の大会 (速報の一覧だけ。部門ごとのファイルは読まない): メニュー用 [{ event_id, name, href }]
 * @param {number | string} uid @returns {Promise<{ event_id: string, name: string, href: string }[]>} */
export async function myEvents(uid) {
  const root = liveRoot();
  if (!root || !uid) return [];
  try {
    const r = await fetch(root + 'index.json', { cache: 'no-cache' });
    const index = r.ok ? await r.json() : null;
    const ids = ((index && index.players) || {})[String(uid)] || [];
    const byId = new Map(((index && index.events) || []).map((/** @type {any} */ s) => [String(s.event_id), s]));
    const href = SPSPLinks.playerHref((W.SPSP && W.SPSP.langRoot) || '', uid) + '#live-section';
    return ids.map((/** @type {any} */ id) => byId.get(String(id))).filter(Boolean)
      .map((/** @type {any} */ s) => ({ event_id: String(s.event_id), name: String(s.tournament_name || ''), href }));
  } catch (e) { return []; }
}


const SpspLiveRoot = { liveRoot, myEvents };
W.SpspLiveRoot = SpspLiveRoot;
export default SpspLiveRoot;
