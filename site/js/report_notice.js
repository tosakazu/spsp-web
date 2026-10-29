// @ts-check
// 試合結果の報告 (report/、docs/self_report_design.md) への入口のお知らせ。ログイン中だけ。
//   show(el)  本人が出ている開催中の大会 (速報 live/<地域>/index.json) のうち、結果報告を受付中のもの (下位クラスの Challonge は本戦の大会で見る)
//             と、自分の試合で報告が食い違っている・運営の確認待ちのものを帯で出す。トップ (速報の上) と自分のプレイヤーページで使う
import { escapeHtml } from './html.js';
import SPSPI18n from './i18n.js';
import SpspLogin from './login.js';
import SpspLive from './live.js';
'use strict';

/** @param {string} k @param {any} [p] */
const t = (k, p) => SPSPI18n.t(k, p);
const W = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);

/** @param {string} code */
function reportHref(code) {
  const S = W.SPSP || {};
  const base = (S.langRoot || '') + (typeof S.pageHref === 'function' ? S.pageHref('report/index.html') : 'report/');
  return base + '?c=' + encodeURIComponent(code);
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

/** @returns {Promise<{ events: any[], conflicts: any[] }>} */
export async function items() {
  const s = SpspLogin.session();
  if (!s || !SpspLogin.apiAvailable()) return { events: [], conflicts: [] };
  const [r, mine] = await Promise.all([SpspLogin.api({ action: 'report_notices', token: s.token }), liveEventIds(String(s.user.id))]);
  if (!r || !r.ok) return { events: [], conflicts: [] };
  const conflicts = /** @type {any[]} */ (r.mine || []);
  const withConflict = new Set(conflicts.map((x) => x.code));
  const events = /** @type {any[]} */ (r.events || []).filter((e) => (e.event_id != null && mine.has(String(e.event_id))) || withConflict.has(e.code));
  return { events, conflicts };
}

/** @param {HTMLElement | null} el */
export async function show(el) {
  if (!el) return;
  const { events, conflicts } = await items();
  if (!events.length && !conflicts.length) { el.style.display = 'none'; return; }
  const n = new Map();
  for (const c of conflicts) n.set(c.code, (n.get(c.code) || 0) + 1);
  const links = events.map((e) => `<a class="my-notice-item" href="${escapeHtml(reportHref(e.code))}">${escapeHtml(e.name || '')}`
    + (n.get(e.code) ? ` <span class="d">⚠ ${escapeHtml(t('report.notice_conflict', { n: n.get(e.code) }))}</span>` : '') + `</a>`);
  el.innerHTML = `<span class="label">${escapeHtml(t('report.notice_label'))}</span><span class="my-notice-items">${links.join('')}</span>`;
  el.style.display = '';
}

const SpspReportNotice = { items, show };
W.SpspReportNotice = SpspReportNotice;
export default SpspReportNotice;
