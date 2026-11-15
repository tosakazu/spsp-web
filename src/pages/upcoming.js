// @ts-check
// src/pages/upcoming.js — site/upcoming/index.html のスクリプト。今後の大会 (参加予定者のまとめ)。
//   一覧 (?e 無し)   これから開かれる大会を開催の早い順に。参加者数・タグ・順位の高い参加予定者 3 人・100 位以内の人数
//   詳細 (?e=<event id>&v=rank|char|pref|dist)   その大会の参加予定者を 実力順 / 使い手ごと / 地域ごと / 実力分布 で見る
// データ: data/upcoming_entrants.json (大会と参加予定者。smash_database の取得が書く)、data/upcoming.json (start.gg の URL・開催地)、
//         選手の一覧 (js/views.js の index = 名前・総合評価の順位・Lv・メインキャラ・地域)、data/geo.json (地域の名前)。
// 集計は js/upcoming_stats.js。シード (entrants の seed) は公開前のことがあるので出さない。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPFormat from '../../site/js/format.js';
import SPSPTags from '../../site/js/tags.js';
import SPSPViews from '../../site/js/views.js';
import SPSPGeo from '../../site/js/geo.js';
import SPSPCharEmoji from '../../site/js/char_emoji.js';
import { charName } from '../../site/js/chars.js';
import Stats from '../../site/js/upcoming_stats.js';
import '../../site/nav.js';

const i18n = SPSPI18n.t;
SPSPI18n.apply(document);
const S = /** @type {any} */ (window).SPSP;
/** 地域の暦日の時差 (分) */
const OFFSET_MIN = (() => {
  const m = /^([+-])(\d\d):(\d\d)$/.exec(String((S.site && S.site.utcOffset) || '+00:00'));
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
})();
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const VIEWS = ['rank', 'char', 'pref', 'dist'];
/** 使い手・地域の 1 組に最初から出す人数 */
const GROUP_HEAD = 5;

/** @typedef {import('../../site/js/upcoming_stats.js').UpRow} UpRow */
/** @type {{ events: Record<string, any>, tours: Map<number, any>, index: any, prefName: Map<number, string> }} */
const DATA = { events: {}, tours: new Map(), index: null, prefName: new Map() };

/** 開催日時 (秒) → 地域の暦の { md: '11/21', wd: '土', hm: '10:30', day: 通し日 } */
function when(/** @type {number} */ ts) {
  const d = new Date((ts + OFFSET_MIN * 60) * 1000);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const wd = d.getUTCDay();
  return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, wd: i18n('upcoming.wd.' + wd), hm: `${d.getUTCHours()}:${pad(d.getUTCMinutes())}`,
           day: Math.floor((ts + OFFSET_MIN * 60) / 86400) };
}
const nentOf = (/** @type {any} */ ev) => Math.max((ev.entrants && ev.entrants.length) || 0, Number(ev.num_entrants) || 0);
const rowsOf = (/** @type {any} */ ev) => Stats.joinEntrants(ev, DATA.index);
const tagsHtml = (/** @type {any} */ ev) => [SPSPTags.dayTag(ev, { wk: 'tag tag-wk', wd: 'tag tag-wd' }),
  ...SPSPTags.flagTags(ev, { pre: 'tag tag-pre', res: 'tag tag-restr', lc: 'tag tag-low', uchi: 'tag tag-uchi', special: 'tag tag-special' })].join('');
const playerLink = (/** @type {UpRow} */ r) => `<a href="${escapeHtml(SPSPLinks.playerHref(S.root, r.uid))}">${escapeHtml(SPSPFormat.shortName(r.name) || r.name)}</a>`;
const rankText = (/** @type {number | null} */ r) => (r === null ? `<span class="up-none">${escapeHtml(i18n('upcoming.no_rank'))}</span>` : escapeHtml(i18n('upcoming.rank_n', { n: r.toLocaleString() })));
const charLabel = (/** @type {number | null} */ id) => (id === null ? i18n('upcoming.unknown') : `${SPSPCharEmoji.emojiOf(id)} ${charName(id, String(id))}`.trim());
const prefLabel = (/** @type {number | null} */ order) => (order === null ? i18n('upcoming.unknown') : DATA.prefName.get(order) || String(order));

// ── 一覧 ──
const LIST = { q: '', minNent: 0 };
function renderList() {
  const now = Date.now() / 1000;
  const q = LIST.q.trim().toLowerCase();
  // 始まって半日たった大会は出さない (データには終わった大会が少し残る)
  const all = Object.entries(DATA.events).map(([eid, ev]) => ({ eid, ev }))
    .filter(x => Number(x.ev.start_at) > now - 12 * 3600)
    .sort((a, b) => a.ev.start_at - b.ev.start_at || nentOf(b.ev) - nentOf(a.ev));
  const list = all.filter(x => nentOf(x.ev) >= LIST.minNent
    && (!q || `${x.ev.tournament_name} ${x.ev.event_name || ''}`.toLowerCase().includes(q)));
  $('up-list-count').textContent = i18n('upcoming.n_events', { n: list.length });
  const today = when(now).day;
  $('up-list').innerHTML = list.map(({ eid, ev }) => {
    const w = when(ev.start_at);
    const rows = rowsOf(ev);
    const sum = Stats.summary(rows);
    const top = Stats.topOf(rows.filter(r => r.rank !== null), 3);
    const tour = DATA.tours.get(Number(ev.tournament_id));
    const days = w.day - today;
    const rel = days < 0 ? '' : days === 0 ? i18n('upcoming.today') : days === 1 ? i18n('upcoming.tomorrow') : i18n('upcoming.in_days', { n: days });
    const meta = [tagsHtml(ev), tour && tour.city ? escapeHtml(tour.city) : '', sum.top100 ? escapeHtml(i18n('upcoming.top100_n', { n: sum.top100 })) : ''].filter(Boolean).join(' ');
    return `<li class="up-ev">
      <div class="up-ev-date">${escapeHtml(i18n('upcoming.date', { md: w.md, wd: w.wd }))}<small>${escapeHtml(rel)}</small></div>
      <div class="up-ev-main">
        <a class="up-ev-name" href="?e=${encodeURIComponent(eid)}">${escapeHtml(ev.tournament_name || '')}</a>
        <div class="up-ev-meta">${meta}</div>
        ${top.length ? `<div class="up-ev-top">${top.map(r => `<b>${escapeHtml(SPSPFormat.shortName(r.name) || r.name)}</b><span class="rk">#${r.rank}</span>`).join(' / ')}</div>` : ''}
      </div>
      <div class="up-ev-n">${nentOf(ev)}<small>${escapeHtml(i18n('upcoming.people'))}</small></div>
    </li>`;
  }).join('') || `<li class="empty-msg">${escapeHtml(all.length ? i18n('upcoming.no_match') : i18n('upcoming.none'))}</li>`;
}
function setupList() {
  $('up-list-view').hidden = false;
  /** @type {HTMLInputElement} */ ($('up-q')).addEventListener('input', e => { LIST.q = /** @type {HTMLInputElement} */ (e.target).value; renderList(); });
  $('up-nent').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-nent]'));
    if (!b) return;
    LIST.minNent = Number(b.dataset.nent) || 0;
    for (const c of $('up-nent').querySelectorAll('.chip')) c.classList.toggle('active', c === b);
    renderList();
  });
  renderList();
}

// ── 詳細 ──
/** @type {{ eid: string, ev: any, rows: UpRow[], view: string, q: string, char: string, pref: string, open: Set<string> }} */
const DET = { eid: '', ev: null, rows: [], view: 'rank', q: '', char: '', pref: '', open: new Set() };
/** 絞り込みの値: '' = すべて、'none' = 不明、それ以外は id の数字 */
const matches = (/** @type {number | null} */ v, /** @type {string} */ f) => !f || (f === 'none' ? v === null : v === Number(f));
/** 検索の正規化 (全角半角・大文字小文字・ひらがなカタカナを区別しない) */
const norm = (/** @type {string} */ s) => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');

function rankHtml() {
  const q = norm(DET.q);
  const rows = DET.rows.filter(r => matches(r.char, DET.char) && matches(r.pref, DET.pref) && (!q || norm(r.name).includes(q)));
  $('up-rank-count').textContent = rows.length === DET.rows.length ? '' : i18n('upcoming.n_of', { n: rows.length, total: DET.rows.length });
  if (!rows.length) return `<div class="empty-msg">${escapeHtml(DET.rows.length ? i18n('upcoming.no_match') : i18n('upcoming.no_entrants'))}</div>`;
  const pos = new Map(DET.rows.map((r, i) => [r.uid, i + 1]));   // 絞り込んでも、大会の中での並び順は変えない
  return `<div class="up-table-wrap"><table class="up-table"><thead><tr>
    <th class="c-no">${escapeHtml(i18n('upcoming.col.no'))}</th><th class="c-rank">${escapeHtml(i18n('upcoming.col.rank'))}</th>
    <th class="c-name">${escapeHtml(i18n('upcoming.col.name'))}</th><th class="c-lv">Lv</th>
    <th class="c-char">${escapeHtml(i18n('upcoming.view.char'))}</th><th class="c-pref">${escapeHtml(i18n('upcoming.view.pref'))}</th></tr></thead><tbody>${
    rows.map(r => `<tr><td class="c-no">${pos.get(r.uid)}</td>
      <td class="c-rank">${r.rank === null ? '<span class="up-none">—</span>' : r.rank.toLocaleString()}</td>
      <td class="c-name">${playerLink(r)}</td>
      <td class="c-lv">${escapeHtml(SPSPFormat.lvLabel(r.lv, r.rank) || '—')}</td>
      <td class="c-char">${r.char === null ? '' : escapeHtml(charLabel(r.char))}</td>
      <td class="c-pref">${r.pref === null ? '' : escapeHtml(prefLabel(r.pref))}</td></tr>`).join('')}</tbody></table></div>`;
}
/** @param {'char' | 'pref'} key */
function groupsHtml(key) {
  const groups = Stats.groupBy(DET.rows, key);
  if (!groups.length) return `<div class="empty-msg">${escapeHtml(i18n('upcoming.no_entrants'))}</div>`;
  const label = key === 'char' ? charLabel : prefLabel;
  return `<div class="up-groups">${groups.map(g => {
    const id = `${key}:${g.key === null ? 'none' : g.key}`;
    const open = DET.open.has(id);
    const shown = open ? g.rows : g.rows.slice(0, GROUP_HEAD);
    return `<section class="up-group">
      <h3><span>${escapeHtml(label(g.key))}</span><span class="n">${g.rows.length}<small>${escapeHtml(i18n('upcoming.people'))}</small></span></h3>
      <ol>${shown.map(r => `<li>${playerLink(r)}<span class="rk">${rankText(r.rank)}</span></li>`).join('')}</ol>
      ${g.rows.length > GROUP_HEAD ? `<button type="button" class="up-more" data-group="${escapeHtml(id)}">${escapeHtml(open ? i18n('upcoming.less') : i18n('upcoming.more', { n: g.rows.length - GROUP_HEAD }))}</button>` : ''}
    </section>`;
  }).join('')}</div>`;
}
function distHtml() {
  const total = DET.rows.length;
  if (!total) return `<div class="empty-msg">${escapeHtml(i18n('upcoming.no_entrants'))}</div>`;
  /** @param {{ label: string, n: number, none?: boolean }[]} items */
  const bars = items => {
    const max = Math.max(1, ...items.map(x => x.n));
    return `<div class="up-bars">${items.map(x => `<span class="lb">${escapeHtml(x.label)}</span>
      <span class="bar${x.none ? ' none' : ''}"><i style="width:${(x.n / max * 100).toFixed(1)}%"></i></span>
      <span class="v">${x.n}<small>${(x.n / total * 100).toFixed(0)}%</small></span>`).join('')}</div>`;
  };
  const bands = Stats.rankBands(DET.rows).map(b => ({ n: b.n, none: b.from === null,
    label: b.from === null ? i18n('upcoming.no_rank') : b.to === null ? i18n('upcoming.band_from', { from: b.from.toLocaleString() })
      : i18n('upcoming.band', { from: b.from.toLocaleString(), to: b.to.toLocaleString() }) }));
  const lvs = Stats.lvCounts(DET.rows).map(x => ({ n: x.n, none: x.lv === null, label: x.lv === null ? i18n('upcoming.no_lv') : 'Lv' + x.lv }));
  return `<div class="up-dist">
    <section><h3>${escapeHtml(i18n('upcoming.dist.rank'))}</h3>${bars(bands)}</section>
    <section><h3>${escapeHtml(i18n('upcoming.dist.lv'))}</h3>${bars(lvs)}</section></div>`;
}
function renderDetail() {
  for (const b of $('up-tabs').querySelectorAll('.up-tab')) b.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (b).dataset.view === DET.view));
  $('up-rank-controls').hidden = DET.view !== 'rank';
  $('up-body').innerHTML = DET.view === 'char' ? groupsHtml('char') : DET.view === 'pref' ? groupsHtml('pref') : DET.view === 'dist' ? distHtml() : rankHtml();
}
function setView(/** @type {string} */ v) {
  DET.view = VIEWS.includes(v) ? v : 'rank';
  const u = new URL(location.href);
  if (DET.view === 'rank') u.searchParams.delete('v'); else u.searchParams.set('v', DET.view);
  history.replaceState(null, '', u);
  renderDetail();
}
function setupDetail(/** @type {string} */ eid, /** @type {any} */ ev) {
  DET.eid = eid; DET.ev = ev; DET.rows = rowsOf(ev);
  $('up-detail-view').hidden = false;
  /** @type {HTMLAnchorElement} */ ($('up-back')).href = './';
  const w = when(ev.start_at);
  const tour = DATA.tours.get(Number(ev.tournament_id));
  const title = String(ev.tournament_name || '');
  $('up-title').textContent = title;
  document.title = i18n('upcoming.page_title', { name: title });
  const slug = tour && typeof tour.tournament_slug === 'string' && /^tournament\/[\w-]+$/.test(tour.tournament_slug) ? tour.tournament_slug : '';
  $('up-meta').innerHTML = [escapeHtml(i18n('upcoming.date_time', { md: w.md, wd: w.wd, hm: w.hm })), tour && tour.city ? escapeHtml(tour.city) : '',
    ev.event_name ? escapeHtml(ev.event_name) : '', tagsHtml(ev),
    slug ? `<a href="https://www.start.gg/${slug}" target="_blank" rel="noopener">start.gg ↗</a>` : ''].filter(Boolean).join(' ・ ');
  const s = Stats.summary(DET.rows);
  const people = escapeHtml(i18n('upcoming.people'));
  const tile = (/** @type {string} */ label, /** @type {string} */ v, unit = people) => `<div><dt>${escapeHtml(label)}</dt><dd>${v}<small>${unit}</small></dd></div>`;
  $('up-stats').innerHTML = [tile(i18n('upcoming.stat.entrants'), String(Math.max(s.n, nentOf(ev)))), tile(i18n('upcoming.stat.ranked'), String(s.ranked)),
    tile(i18n('upcoming.stat.top100'), String(s.top100)), tile(i18n('upcoming.stat.top1000'), String(s.top1000)),
    s.median === null ? '' : tile(i18n('upcoming.stat.median'), s.median.toLocaleString(), escapeHtml(i18n('upcoming.rank_unit')))].join('');
  // 絞り込みの選択肢: この大会に居るキャラ・地域だけ (人数の多い順)
  const opts = (/** @type {'char' | 'pref'} */ key, /** @type {(k: number | null) => string} */ label, /** @type {string} */ all) =>
    `<option value="">${escapeHtml(all)}</option>` + Stats.groupBy(DET.rows, key).map(g =>
      `<option value="${g.key === null ? 'none' : g.key}">${escapeHtml(label(g.key))} (${g.rows.length})</option>`).join('');
  const fchar = /** @type {HTMLSelectElement} */ ($('up-fchar')), fpref = /** @type {HTMLSelectElement} */ ($('up-fpref'));
  fchar.innerHTML = opts('char', charLabel, i18n('upcoming.all_chars'));
  fpref.innerHTML = opts('pref', prefLabel, i18n('upcoming.all_prefs'));
  fchar.addEventListener('change', () => { DET.char = fchar.value; renderDetail(); });
  fpref.addEventListener('change', () => { DET.pref = fpref.value; renderDetail(); });
  /** @type {HTMLInputElement} */ ($('up-pq')).addEventListener('input', e => { DET.q = /** @type {HTMLInputElement} */ (e.target).value; renderDetail(); });
  $('up-tabs').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-view]'));
    if (b) setView(String(b.dataset.view));
  });
  $('up-body').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-group]'));
    if (!b) return;
    const id = String(b.dataset.group);
    if (DET.open.has(id)) DET.open.delete(id); else DET.open.add(id);
    renderDetail();
  });
  DET.view = VIEWS.includes(String(new URL(location.href).searchParams.get('v'))) ? String(new URL(location.href).searchParams.get('v')) : 'rank';
  renderDetail();
}

async function main() {
  const json = (/** @type {string} */ u) => fetch(u).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [up, tours, index, geo] = await Promise.all([json(S.data + 'data/upcoming_entrants.json'), json(S.data + 'data/upcoming.json'),
    SPSPViews.index().catch(() => null), SPSPGeo.loadGeo(S.data).catch(() => null), SPSPCharEmoji.load()]);
  $('up-loading').hidden = true;
  const fail = (/** @type {string} */ msg) => { $('up-empty').textContent = msg; $('up-empty').hidden = false; };
  if (!up || !up.events || typeof up.events !== 'object') { fail(i18n('upcoming.load_failed')); return; }
  DATA.events = up.events;
  DATA.index = index;
  for (const t of (tours && tours.tournaments) || []) DATA.tours.set(Number(t.tournament_id), t);
  for (const u of (geo && geo.units) || []) DATA.prefName.set(Number(u.order), SPSPGeo.unitName(u.id));
  const eid = new URL(location.href).searchParams.get('e');
  if (eid) {
    const ev = Object.prototype.hasOwnProperty.call(up.events, eid) ? up.events[eid] : null;
    if (!ev) { fail(i18n('upcoming.not_found')); $('up-empty').insertAdjacentHTML('beforeend', ` <a href="${escapeHtml('./')}">${escapeHtml(i18n('upcoming.back'))}</a>`); return; }
    setupDetail(eid, ev);
  } else setupList();
}
main().catch(e => { console.error(e); $('up-loading').hidden = true; $('up-empty').textContent = i18n('upcoming.load_failed'); $('up-empty').hidden = false; });
