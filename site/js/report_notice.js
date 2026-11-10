// @ts-check
// 試合結果の報告 (report/、docs/self_report_design.md) への入口のお知らせ。ログイン中だけ。
//   show(el)  本人が出ている開催中の大会 (速報 live/<地域>/index.json。速報に無い大会は本人の start.gg のトークンで出場している大会の一覧を見る)
//             のうち、結果報告を受付中のもの (下位クラスの Challonge は本戦の大会で見る)
//             と、自分の試合で報告が食い違っている・運営の確認待ちのものを帯で出す。トップ (速報の上) と自分のプレイヤーページで使う
//   isDemo()  URL に ?demo=report_notice があれば見本 (ログインしていなくても・他人のプレイヤーページでも、見本の大会を出す。リンク先は報告ページの見本)
import { escapeHtml } from './html.js';
import SPSPI18n from './i18n.js';
import SpspLogin from './login.js';
import SpspLiveRoot from './live_root.js';
const liveRoot = () => SpspLiveRoot.liveRoot();
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
  const root = liveRoot();
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

// 読み直し (2026-11-10): サーバが返す next_ms (本人が出ている受付のうち、まだ始まっていないもののいちばん早い開始時刻) に
// 読み直し、帯 (show した場所) を描き直して 'spsp:report-notice' を投げる (人型のメニューが描き直す)。
// ページに戻ってきたとき (visibilitychange) も、前に読んでから RELOAD_MS 以上たっていれば読み直す。
const RELOAD_MS = 60 * 1000;
/** @type {Set<HTMLElement>} */
const SHOWN = new Set();
let loadedAt = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;
function reload() {
  MEMO = null;
  const p = items();
  for (const el of SHOWN) show(el, p).catch(() => {});
  p.then(() => { try { W.dispatchEvent(new CustomEvent('spsp:report-notice')); } catch (e) { /* 古いブラウザ */ } }).catch(() => {});
}
/** @param {number | null | undefined} nextMs */
function schedule(nextMs) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!nextMs) return;
  const wait = nextMs - Date.now() + 1500;   // 開始時刻を少し過ぎてから (サーバとの時計のずれ)
  if (wait > 0 && wait < 24 * 3600 * 1000) timer = setTimeout(reload, wait);
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && loadedAt && Date.now() - loadedAt >= RELOAD_MS && SpspLogin.session()) reload();
  });
}

/** 同じページで 1 回だけ読む (トップの帯・人型のメニューで共有)。ログインし直したら読み直す
 * @type {{ key: string, p: Promise<{ events: any[], conflicts: any[], admin: any[] }> } | null} */
let MEMO = null;
/** @returns {Promise<{ events: any[], conflicts: any[], admin: any[] }>} */
export function items() {
  const s = SpspLogin.session();
  const key = (isDemo() ? 'demo:' : '') + (s ? s.token : '');
  if (!MEMO || MEMO.key !== key) MEMO = { key, p: loadItems() };
  return MEMO.p;
}

/** 報告ページへのリンク @param {any} e items().events の 1 つ */
export function hrefOf(e) { return reportHref(e.code, e.demo); }
/** 運営の画面へのリンク @param {any} a items().admin の 1 つ */
export function adminHrefOf(a) { return reportHref(a.code) + '&admin=1'; }

/** admin = この人が運営・報告管理者の受付 (運営の画面へ) @returns {Promise<{ events: any[], conflicts: any[], admin: any[] }>} */
async function loadItems() {
  if (isDemo()) {
    // 見本: 受付中の大会 2 つ (片方は自分の試合で報告が食い違っている)
    return { events: [{ code: 'demo1', name: t('report.demo.tour1'), demo: 'match' }, { code: 'demo2', name: t('report.demo.tour2'), demo: 'conflict' }],
      conflicts: [{ code: 'demo2' }], admin: [] };
  }
  const s = SpspLogin.session();
  if (!s || !SpspLogin.apiAvailable()) return { events: [], conflicts: [], admin: [] };
  const [r, mine] = await Promise.all([SpspLogin.api({ action: 'report_notices', token: s.token }), liveEventIds(String(s.user.id))]);
  loadedAt = Date.now();
  if (!r || !r.ok) return { events: [], conflicts: [], admin: [] };
  schedule(r.next_ms);
  const admin = /** @type {any[]} */ (r.admin || []);
  const conflicts = /** @type {any[]} */ (r.mine || []);
  const withConflict = new Set(conflicts.map((x) => x.code));
  const all = /** @type {any[]} */ (r.events || []);
  // entrant = サーバが参加者の一覧 (report_entrants) で本人のものと分かった受付 (速報を待たない、2026-11-10)
  const entrant = new Set(/** @type {string[]} */ (r.entrant || []));
  const hit = (/** @type {Set<string>} */ ids) => all.filter((e) => (e.event_id != null && ids.has(String(e.event_id))) || withConflict.has(e.code) || entrant.has(e.code));
  let events = hit(mine);
  // 速報に載っていない大会 (速報の対象外など): 受付中の start.gg の大会が残っていれば、本人の出場一覧で確かめる
  if (all.some((e) => e.kind === 'startgg' && e.event_id != null && !events.includes(e))) {
    const more = await myStartggEvents();
    if (more.size) events = hit(new Set([...mine, ...more]));
  }
  return { events, conflicts, admin };
}

/** お知らせの帯の中全体を押せるように (大会が 1 つのとき。2 つ以上なら大会名のリンクだけ)。2026-11-04
 * @param {HTMLElement} el @param {string | null} href */
function tapWhole(el, href) {
  el.style.cursor = href ? 'pointer' : '';
  el.onclick = href ? (e) => {
    if (/** @type {Element} */ (e.target).closest('a, button')) return;   // リンク・ボタンそのものはふつうに
    location.href = href;
  } : null;
}

/** @param {HTMLElement | null} el @param {Promise<{ events: any[], conflicts: any[], admin: any[] }>} [pre] 読んだもの (無ければ読む) */
export async function show(el, pre) {
  if (!el) return;
  SHOWN.add(el);
  const { events, conflicts, admin = [] } = await (pre || items());
  if (!events.length && !conflicts.length && !admin.length) { el.style.display = 'none'; return; }
  const n = new Map();
  for (const c of conflicts) n.set(c.code, (n.get(c.code) || 0) + 1);
  const links = events.map((e) => `<a class="my-notice-item" href="${escapeHtml(reportHref(e.code, e.demo))}">${escapeHtml(e.name || '')}`
    + (n.get(e.code) ? ` <span class="d">⚠ ${escapeHtml(t('report.notice_conflict', { n: n.get(e.code) }))}</span>` : '') + `</a>`)
    // 運営・報告管理者の受付: 運営の画面へ (2026-11-04)
    .concat(admin.map((a) => `<a class="my-notice-item" href="${escapeHtml(adminHrefOf(a))}">${escapeHtml(t('report.notice_admin', { name: a.name || '' }))}</a>`));
  el.innerHTML = `<span class="label">${escapeHtml(t('report.notice_label'))}</span><span class="my-notice-items">${links.join('')}</span>`;
  tapWhole(el, links.length !== 1 ? null : events.length ? reportHref(events[0].code, events[0].demo) : adminHrefOf(admin[0]));
  el.style.display = '';
}

const SpspReportNotice = { items, show, hrefOf, adminHrefOf, isDemo };
W.SpspReportNotice = SpspReportNotice;
export default SpspReportNotice;
