// @ts-check
// 公開済みシードとの被り回避 (published_seeds.js、docs/seed_collision_avoidance.md §6.2.2) の、ページ側の共通部分。
//   シード作成・シードアップロード (seeding/app/75_series_rematch.js) と下位クラス作成 (src/pages/class.js) で使う。
//   参加予定の大会 (data/upcoming_entrants.json) の読み込み・対象の大会を選ぶ・チェックの下の欄の HTML。
import SPSPI18n from '../js/i18n.js';
import { escapeHtml } from '../js/html.js';
import SPSPViews from '../js/views.js';
import SPSPPublishedSeeds from './published_seeds.js';
'use strict';

const i18n = SPSPI18n.t;

/** @type {Promise<any> | null} */
let UPCOMING_P = null;
/** 参加予定の大会の一覧 (読み込みは 1 回。失敗したら次の操作でやり直す) @param {string | undefined} dataRoot SPSP.data */
function loadUpcomingEntrants(dataRoot) {
  if (!UPCOMING_P) {
    UPCOMING_P = fetch((dataRoot || '') + 'data/upcoming_entrants.json', { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('upcoming_entrants.json HTTP ' + r.status); return r.json(); })
      .catch((e) => { UPCOMING_P = null; throw e; });
  }
  return UPCOMING_P;
}

/** 総合評価の全国順位 (仮のシードの判定用)。index = 読み込み済みの players_index (無ければ読む)
 * @param {string | undefined} dataRoot @param {any} [index] @returns {Promise<(uid: number) => number | null>} */
async function rankOf(dataRoot, index) {
  let I = index || null;
  if (!I && typeof SPSPViews !== 'undefined' && SPSPViews) I = await SPSPViews.at(dataRoot || '').index().catch(() => null);
  return (uid) => { const r = I ? I.get(uid) : null; return r && r.ens ? Number(r.ens) : null; };
}

/** @typedef {{ used: any[], skipped: any[], generatedAt: number | null } | { error: string }} PublishedSel */
/**
 * 対象の大会を選ぶ。本大会の開催日は startAt (無ければ参加予定のファイルの同じ event、それも無ければ fallbackStartAt)。
 * 取得の失敗は { error } で返す (投げない)
 * @param {{ dataRoot: string | undefined, eventId?: number | string | null, startAt?: number | null, fallbackStartAt?: number | null,
 *   attendees: number[], excludeWeekday: boolean, index?: any }} o
 * @returns {Promise<PublishedSel>}
 */
async function select(o) {
  try {
    const up = await loadUpcomingEntrants(o.dataRoot);
    const evs = up && up.events;
    const self = evs && !Array.isArray(evs) && o.eventId != null ? evs[String(o.eventId)] : null;
    const startAt = o.startAt || (self && self.start_at) || o.fallbackStartAt || null;
    if (!startAt) return { error: 'nodate' };
    const sel = SPSPPublishedSeeds.selectPublishedEvents(up, {
      targetEventId: o.eventId != null ? o.eventId : null, targetStartAt: startAt, attendees: o.attendees,
      excludeWeekday: o.excludeWeekday, rankOf: await rankOf(o.dataRoot, o.index),
    });
    return { used: sel.used, skipped: sel.skipped, generatedAt: up.generated_at || null };
  } catch (e) {
    return { error: String((/** @type {any} */ (e) && /** @type {any} */ (e).message) || e) };
  }
}

/** 取得できなかったときの一言 (進み具合の注記用) @param {{ error: string }} res */
function errorText(res) { return res.error === 'nodate' ? i18n('seed.published.nodate') : i18n('seed.published.error') + res.error; }

/** @param {number} sec */
function fmtAsOf(sec) {
  const d = new Date(sec * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** @param {string} iso 'YYYY-MM-DD' */
const mdOf = (iso) => { const p = String(iso || '').split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}` : String(iso || '?'); };
/** 対象外の理由 (published_seeds.js selectPublishedEvents の reason) @type {Record<string, () => string>} */
const REASON = {
  range: () => i18n('seed.published.r_range'), weekday: () => i18n('seed.published.r_weekday'),
  provisional: () => i18n('seed.published.r_provisional'), nopair: () => i18n('seed.published.r_nopair'),
};
/** チェックの下の欄: 対象の大会と、対象外の大会 (理由つき) @param {PublishedSel} res */
function boxHtml(res) {
  if ('error' in res) return res.error === 'nodate' ? escapeHtml(errorText(res)) : `<span style="color:#b91c1c">${escapeHtml(errorText(res))}</span>`;
  const asof = res.generatedAt ? `<span style="color:#9ca3af">（${escapeHtml(i18n('seed.published.asof', { t: fmtAsOf(res.generatedAt) }))}）</span>` : '';
  const evLine = (/** @type {any} */ e) => escapeHtml(i18n('seed.published.ev', { date: mdOf(e.date), name: e.name, nent: e.nent, common: e.common }));
  let h = res.used.length
    ? `<div>${escapeHtml(i18n('seed.published.used'))} ${asof}</div>` + res.used.map((e) => `<div style="padding-left:12px;color:#374151">${evLine(e)}</div>`).join('')
    : `<div>${escapeHtml(i18n('seed.published.none'))} ${asof}</div>`;
  if (res.skipped.length) {
    h += `<details style="margin-top:2px"><summary style="cursor:pointer">${escapeHtml(i18n('seed.published.skipped', { n: res.skipped.length }))}</summary>` +
      res.skipped.map((e) => `<div style="padding-left:12px">${evLine(e)} — ${escapeHtml(REASON[e.reason] ? REASON[e.reason]() : e.reason)}</div>`).join('') + `</details>`;
  }
  return h;
}

const API = { loadUpcomingEntrants, rankOf, select, errorText, boxHtml };
const global = typeof window !== 'undefined' ? window : globalThis;   // テストは app/*.js の import を外して連結するので名前でも引けるように
/** @type {any} */ (global).SPSPPublishedSeedsUI = API;
export default API;
