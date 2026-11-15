// @ts-check
// js/upcoming_common.js — 今後の大会の 2 ページ (upcoming/index.html = 一覧、upcoming/entrants.html = 大会ごとの参加予定者) で共通の、
// データの読み込みと小さい表示の部品。集計は js/upcoming_stats.js。
// データ: data/upcoming_entrants.json (大会と参加予定者。smash_database の取得が書く)、data/upcoming.json (start.gg の URL・開催地)、
//         選手の一覧 (js/views.js の index = 名前・総合評価の順位・Lv・メインキャラ・地域)、data/geo.json (地域の名前)。
import { escapeHtml } from './html.js';
import SPSPI18n from './i18n.js';
import SPSPLinks from './links.js';
import SPSPFormat from './format.js';
import SPSPViews from './views.js';
import SPSPGeo from './geo.js';
import SPSPCharEmoji from './char_emoji.js';
import { charName } from './chars.js';
import Stats from './upcoming_stats.js';

const i18n = SPSPI18n.t;
const S = () => /** @type {any} */ (globalThis).SPSP;
/** @typedef {import('./upcoming_stats.js').UpRow} UpRow */
/** @type {{ events: Record<string, any>, tours: Map<number, any>, index: any, prefName: Map<number, string> }} */
export const DATA = { events: {}, tours: new Map(), index: null, prefName: new Map() };

/** 読み込む。大会の一覧が読めなければ false (順位などが読めなくても大会は出す) @returns {Promise<boolean>} */
export async function load() {
  const json = (/** @type {string} */ u) => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [up, tours, index, geo] = await Promise.all([json(S().data + 'data/upcoming_entrants.json'), json(S().data + 'data/upcoming.json'),
    SPSPViews.index().catch(() => null), SPSPGeo.loadGeo(S().data).catch(() => null), SPSPCharEmoji.load()]);
  if (!up || !up.events || typeof up.events !== 'object') return false;
  DATA.events = up.events;
  DATA.index = index;
  for (const t of (tours && tours.tournaments) || []) DATA.tours.set(Number(t.tournament_id), t);
  for (const u of (geo && geo.units) || []) DATA.prefName.set(Number(u.order), SPSPGeo.unitName(u.id));
  return true;
}

/** 開催日時 (秒) → 地域の暦の { ymd: '2026-11-21', wd: '土', hm: '10:30' } */
export function when(/** @type {number} */ ts) {
  const m = /^([+-])(\d\d):(\d\d)$/.exec(String((S().site && S().site.utcOffset) || '+00:00'));
  const off = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  const d = new Date((ts + off * 60) * 1000);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const wd = d.getUTCDay();
  return { ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, wd: i18n('upcoming.wd.' + wd), hm: `${d.getUTCHours()}:${pad(d.getUTCMinutes())}` };
}
export const nentOf = (/** @type {any} */ ev) => Math.max((ev.entrants && ev.entrants.length) || 0, Number(ev.num_entrants) || 0);
export const tourOf = (/** @type {any} */ ev) => DATA.tours.get(Number(ev.tournament_id)) || null;
export const cityOf = (/** @type {any} */ ev) => { const t = tourOf(ev); return (t && t.city) || ''; };
export const rowsOf = (/** @type {any} */ ev) => Stats.joinEntrants(ev, DATA.index);
export const shortName = (/** @type {UpRow} */ r) => SPSPFormat.shortName(r.name) || r.name;
export const playerLink = (/** @type {UpRow} */ r) => SPSPLinks.playerLink(S().langRoot || S().root, r.uid, escapeHtml(shortName(r)));
export const charLabel = (/** @type {number | null} */ id) => (id === null ? i18n('upcoming.unknown') : `${SPSPCharEmoji.emojiOf(id)} ${charName(id, String(id))}`.trim());
export const prefLabel = (/** @type {number | null} */ order) => (order === null ? i18n('upcoming.unknown') : DATA.prefName.get(order) || String(order));

const api = { DATA, load, when, nentOf, tourOf, cityOf, rowsOf, shortName, playerLink, charLabel, prefLabel };
/** @type {any} */ (globalThis).SpspUpcoming = api;
export default api;
