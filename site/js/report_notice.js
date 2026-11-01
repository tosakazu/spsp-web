// @ts-check
// 試合結果の報告 (report/、docs/self_report_design.md) への入口のお知らせ。ログイン中だけ。
//   show(el)  本人が出ている開催中の大会 (速報 live/<地域>/index.json。速報に無い大会は本人の start.gg のトークンで出場している大会の一覧を見る)
//             のうち、結果報告を受付中のもの (下位クラスの Challonge は本戦の大会で見る)
//             と、自分の試合で報告が食い違っている・運営の確認待ちのものを帯で出す。トップ (速報の上) と自分のプレイヤーページで使う
//   isDemo()  URL に ?demo=report_notice があれば見本 (ログインしていなくても・他人のプレイヤーページでも、見本の大会を出す。リンク先は報告ページの見本)
import { escapeHtml } from './html.js';
import SPSPI18n from './i18n.js';
import SpspLogin from './login.js';
import SpspLive from './live.js';
import SpspStartggIdentity from './startgg_identity.js';
import { makeGql } from './live_fetch.js';
'use strict';

/** @param {string} k @param {any} [p] */
const t = (k, p) => SPSPI18n.t(k, p);
const W = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);

/** @param {string} code @param {string} [demo] 見本のときは報告ページの見本の場面 */
function reportHref(code, demo) {
  const S = W.SPSP || {};
  const base = (S.langRoot || '') + (typeof S.pageHref === 'function' ? S.pageHref('report/index.html') : 'report/');
  return base + (demo ? '?demo=' + encodeURIComponent(demo) : '?c=' + encodeURIComponent(code));
}

export function isDemo() {
  try { return new URLSearchParams(location.search).get('demo') === 'report_notice'; } catch (e) { return false; }
}

/** 本人の開催中の大会のイベント ID (速報の一覧) @param {string} uid */
async function liveEventIds(uid) {
  const root = SpspLive.liveRoot();
  if (!root) return new Set();
  try {
    const r = await fetch(root + 'index.json', { cache: 'no-cache' });
    const j = r.ok ? await r.json() : null;
    return new Set((((j && j.players) || {})[uid] || []).map(String));
  } catch (e) { return new Set(); }
}

/** 本人が出場しているイベント (start.gg の新しい順 50 件)。普段のログインのトークンが無ければ空 */
async function myStartggEvents() {
  try {
    const tk = await SpspStartggIdentity.token();
    if (!tk) return new Set();
    const j = await makeGql(tk, 1)('query SpspNoticeMyEvents { currentUser { events(query: { perPage: 50, page: 1 }) { nodes { id } } } }', {});
    const ns = (j && j.data && j.data.currentUser && j.data.currentUser.events && j.data.currentUser.events.nodes) || [];
    return new Set(ns.filter(Boolean).map((/** @type {any} */ e) => String(e.id)));
  } catch (e) { return new Set(); }
}

/** @returns {Promise<{ events: any[], conflicts: any[] }>} */
export async function items() {
  if (isDemo()) {
    // 見本: 受付中の大会 2 つ (片方は自分の試合で報告が食い違っている)
    return { events: [{ code: 'demo1', name: t('report.demo.tour1'), demo: 'match' }, { code: 'demo2', name: t('report.demo.tour2'), demo: 'conflict' }],
      conflicts: [{ code: 'demo2' }] };
  }
  const s = SpspLogin.session();
  if (!s || !SpspLogin.apiAvailable()) return { events: [], conflicts: [] };
  const [r, mine] = await Promise.all([SpspLogin.api({ action: 'report_notices', token: s.token }), liveEventIds(String(s.user.id))]);
  if (!r || !r.ok) return { events: [], conflicts: [] };
  const conflicts = /** @type {any[]} */ (r.mine || []);
  const withConflict = new Set(conflicts.map((x) => x.code));
  const all = /** @type {any[]} */ (r.events || []);
  const hit = (/** @type {Set<string>} */ ids) => all.filter((e) => (e.event_id != null && ids.has(String(e.event_id))) || withConflict.has(e.code));
  let events = hit(mine);
  // 速報に載っていない大会 (速報の対象外など): 受付中の start.gg の大会が残っていれば、本人の出場一覧で確かめる
  if (all.some((e) => e.kind === 'startgg' && e.event_id != null && !events.includes(e))) {
    const more = await myStartggEvents();
    if (more.size) events = hit(new Set([...mine, ...more]));
  }
  return { events, conflicts };
}

/** @param {HTMLElement | null} el */
export async function show(el) {
  if (!el) return;
  const { events, conflicts } = await items();
  if (!events.length && !conflicts.length) { el.style.display = 'none'; return; }
  const n = new Map();
  for (const c of conflicts) n.set(c.code, (n.get(c.code) || 0) + 1);
  const links = events.map((e) => `<a class="my-notice-item" href="${escapeHtml(reportHref(e.code, e.demo))}">${escapeHtml(e.name || '')}`
    + (n.get(e.code) ? ` <span class="d">⚠ ${escapeHtml(t('report.notice_conflict', { n: n.get(e.code) }))}</span>` : '') + `</a>`);
  el.innerHTML = `<span class="label">${escapeHtml(t('report.notice_label'))}</span><span class="my-notice-items">${links.join('')}</span>`;
  el.style.display = '';
}

const SpspReportNotice = { items, show, isDemo };
W.SpspReportNotice = SpspReportNotice;
export default SpspReportNotice;
