// @ts-check
// src/pages/upcoming.js — site/upcoming/index.html のスクリプト。今後の大会の一覧。
// 見た目・操作は大会一覧 (events/) と同じ (チップ・検索・見出しで並べ替え・スマホは 1 件ずつ)。大会名の下に、順位の高い参加予定者 3 人 (結果に見えないようメダルは付けない)。
// 大会名を押すと、その大会の参加予定者のページ (entrants.html?e=<event id>、src/pages/upcoming_entrants.js)。
// データと小さい部品は js/upcoming_common.js、集計は js/upcoming_stats.js。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPTags from '../../site/js/tags.js';
import Stats from '../../site/js/upcoming_stats.js';
import { shown as upcomingShown } from '../../site/js/upcoming_until.js';
import Up from '../../site/js/upcoming_common.js';
import '../../site/nav.js';

const i18n = SPSPI18n.t;
SPSPI18n.apply(document);
const S = /** @type {any} */ (window).SPSP;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {{ q: string, minNent: number, tags: Set<string>, sortKey: string, sortDir: 'asc' | 'desc' }} */
const LIST = { q: '', minNent: 0, tags: new Set(), sortKey: 'date', sortDir: 'asc' };
function render() {
  const now = Date.now() / 1000;
  const q = LIST.q.trim().toLowerCase();
  // 始まって半日たった大会は出さない (データには終わった大会が少し残る)
  const all = Object.entries(Up.DATA.events).map(([eid, ev]) => ({ eid, ev })).filter(x => upcomingShown(x.ev, now));   // 大会が終わるまで出す (js/upcoming_until.js)
  const list = all.filter(({ ev }) => {
    if (Up.nentOf(ev) < LIST.minNent) return false;
    if (q && !`${ev.tournament_name} ${ev.event_name || ''} ${Up.cityOf(ev)}`.toLowerCase().includes(q)) return false;
    if (LIST.tags.has('weekend') && !ev.is_weekend) return false;
    if (LIST.tags.has('weekday') && ev.is_weekend) return false;
    return true;
  });
  const dir = LIST.sortDir === 'asc' ? 1 : -1;
  const val = (/** @type {{ ev: any }} */ x) => (LIST.sortKey === 'name' ? String(x.ev.tournament_name || '') : LIST.sortKey === 'nent' ? Up.nentOf(x.ev)
    : LIST.sortKey === 'city' ? Up.cityOf(x.ev) : Number(x.ev.start_at));
  list.sort((a, b) => { const va = val(a), vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir || a.ev.start_at - b.ev.start_at || Up.nentOf(b.ev) - Up.nentOf(a.ev); });
  $('status').textContent = i18n('upcoming.n_events', { n: list.length });
  const page = S.pageHref('entrants.html');
  $('tbody').innerHTML = list.map(({ eid, ev }) => {
    const top = Stats.topOf(Up.rowsOf(ev).filter(r => r.rank !== null), 3);
    const tags = [SPSPTags.dayTag(ev, { wk: 'tag tag-wk', wd: 'tag tag-wd' }),
      ...SPSPTags.flagTags(ev, { pre: 'tag tag-pre', res: 'tag tag-restr', lc: 'tag tag-low', uchi: 'tag tag-uchi', special: 'tag tag-special' })].join('');
    const topHtml = top.length ? `<div class="top-players">${top.map(r =>
      `<span>${Up.playerLink(r)}<span class="rank">#${r.rank}</span></span>`).join('<span class="sep">·</span>')}</div>` : '';
    return `<tr class="event-row">
      <td class="col-date">${Up.when(ev.start_at).ymd}</td>
      <td class="col-name"><a href="${escapeHtml(page)}?e=${encodeURIComponent(eid)}">${escapeHtml(ev.tournament_name || '')}</a>${topHtml}</td>
      <td class="col-nent">${Up.nentOf(ev)}</td>
      <td class="col-city">${escapeHtml(Up.cityOf(ev))}</td>
      <td class="col-tags">${tags}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="empty-msg">${escapeHtml(all.length ? i18n('upcoming.no_match') : i18n('upcoming.none'))}</td></tr>`;
  for (const th of document.querySelectorAll('#eventstable th.sortable')) {
    const on = /** @type {HTMLElement} */ (th).dataset.sort === LIST.sortKey;
    th.classList.toggle('sorted-asc', on && LIST.sortDir === 'asc');
    th.classList.toggle('sorted-desc', on && LIST.sortDir === 'desc');
  }
}

async function main() {
  if (!(await Up.load())) { $('tbody').innerHTML = `<tr><td colspan="5" class="empty-msg">${escapeHtml(i18n('upcoming.load_failed'))}</td></tr>`; $('status').textContent = ''; return; }
  $('search').addEventListener('input', e => { LIST.q = /** @type {HTMLInputElement} */ (e.target).value; render(); });
  $('filter-nent').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-nent]'));
    if (!b) return;
    LIST.minNent = Number(b.dataset.nent) || 0;
    for (const c of $('filter-nent').querySelectorAll('.chip')) c.classList.toggle('active', c === b);
    render();
  });
  $('filter-tags').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-tag]'));
    if (!b) return;
    const tag = String(b.dataset.tag), on = !LIST.tags.has(tag);
    LIST.tags.clear();   // 休日のみ・平日のみ はどちらか片方
    if (on) LIST.tags.add(tag);
    for (const c of $('filter-tags').querySelectorAll('.chip')) c.classList.toggle('active', LIST.tags.has(String(/** @type {HTMLElement} */ (c).dataset.tag)));
    render();
  });
  for (const th of document.querySelectorAll('#eventstable th.sortable')) th.addEventListener('click', () => {
    const k = String(/** @type {HTMLElement} */ (th).dataset.sort);
    if (LIST.sortKey === k) LIST.sortDir = LIST.sortDir === 'asc' ? 'desc' : 'asc';
    else { LIST.sortKey = k; LIST.sortDir = k === 'nent' ? 'desc' : 'asc'; }
    render();
  });
  render();
}
main().catch(e => { console.error(e); $('tbody').innerHTML = `<tr><td colspan="5" class="empty-msg">${escapeHtml(i18n('upcoming.load_failed'))}</td></tr>`; });
