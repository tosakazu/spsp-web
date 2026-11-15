// @ts-check
// src/pages/upcoming.js — site/upcoming/index.html のスクリプト。今後の大会 (参加予定者のまとめ)。
//   一覧 (?e 無し)   これから開かれる大会の表。見た目・操作は大会一覧 (events/) と同じ (チップ・検索・見出しで並べ替え・スマホは 1 件ずつ)。
//                     大会名の下に、順位の高い参加予定者 3 人
//   大会ごと (?e=<event id>)   見た目は大会ページ (t/) と同じ (hero・見出しつきの欄・tour-item の行)。
//                     数字 → 実力分布 → 使い手ごと → 地域ごと → 実力順 (名前の検索、キャラ・地域の絞り込み)
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
/** 使い手・地域で最初から出す組の数、実力順で最初から出す人数 */
const GROUPS_HEAD = 8, RANK_HEAD = 50;

/** @typedef {import('../../site/js/upcoming_stats.js').UpRow} UpRow */
/** @type {{ events: Record<string, any>, tours: Map<number, any>, index: any, prefName: Map<number, string> }} */
const DATA = { events: {}, tours: new Map(), index: null, prefName: new Map() };

/** 開催日時 (秒) → 地域の暦の { ymd: '2026-11-21', wd: '土', hm: '10:30' } */
function when(/** @type {number} */ ts) {
  const d = new Date((ts + OFFSET_MIN * 60) * 1000);
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const wd = d.getUTCDay();
  return { ymd: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, wd: i18n('upcoming.wd.' + wd), hm: `${d.getUTCHours()}:${pad(d.getUTCMinutes())}` };
}
const nentOf = (/** @type {any} */ ev) => Math.max((ev.entrants && ev.entrants.length) || 0, Number(ev.num_entrants) || 0);
const cityOf = (/** @type {any} */ ev) => { const t = DATA.tours.get(Number(ev.tournament_id)); return (t && t.city) || ''; };
const rowsOf = (/** @type {any} */ ev) => Stats.joinEntrants(ev, DATA.index);
const linkRoot = () => S.langRoot || S.root;
const shortName = (/** @type {UpRow} */ r) => SPSPFormat.shortName(r.name) || r.name;
const playerLink = (/** @type {UpRow} */ r) => SPSPLinks.playerLink(linkRoot(), r.uid, escapeHtml(shortName(r)));
const charLabel = (/** @type {number | null} */ id) => (id === null ? i18n('upcoming.unknown') : `${SPSPCharEmoji.emojiOf(id)} ${charName(id, String(id))}`.trim());
const prefLabel = (/** @type {number | null} */ order) => (order === null ? i18n('upcoming.unknown') : DATA.prefName.get(order) || String(order));

// ── 一覧 (大会一覧と同じ表) ──
/** @type {{ q: string, minNent: number, tags: Set<string>, sortKey: string, sortDir: 'asc' | 'desc' }} */
const LIST = { q: '', minNent: 0, tags: new Set(), sortKey: 'date', sortDir: 'asc' };
function renderList() {
  const now = Date.now() / 1000;
  const q = LIST.q.trim().toLowerCase();
  // 始まって半日たった大会は出さない (データには終わった大会が少し残る)
  const all = Object.entries(DATA.events).map(([eid, ev]) => ({ eid, ev })).filter(x => Number(x.ev.start_at) > now - 12 * 3600);
  const list = all.filter(({ ev }) => {
    if (nentOf(ev) < LIST.minNent) return false;
    if (q && !`${ev.tournament_name} ${ev.event_name || ''} ${cityOf(ev)}`.toLowerCase().includes(q)) return false;
    if (LIST.tags.has('weekend') && !ev.is_weekend) return false;
    if (LIST.tags.has('weekday') && ev.is_weekend) return false;
    return true;
  });
  const dir = LIST.sortDir === 'asc' ? 1 : -1;
  const val = (/** @type {{ ev: any }} */ x) => (LIST.sortKey === 'name' ? String(x.ev.tournament_name || '') : LIST.sortKey === 'nent' ? nentOf(x.ev)
    : LIST.sortKey === 'city' ? cityOf(x.ev) : Number(x.ev.start_at));
  list.sort((a, b) => { const va = val(a), vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * dir || a.ev.start_at - b.ev.start_at || nentOf(b.ev) - nentOf(a.ev); });
  $('status').textContent = i18n('upcoming.n_events', { n: list.length });
  const medal = ['🥇', '🥈', '🥉'];
  $('tbody').innerHTML = list.map(({ eid, ev }) => {
    const w = when(ev.start_at);
    const top = Stats.topOf(rowsOf(ev).filter(r => r.rank !== null), 3);
    const tags = [SPSPTags.dayTag(ev, { wk: 'tag tag-wk', wd: 'tag tag-wd' }),
      ...SPSPTags.flagTags(ev, { pre: 'tag tag-pre', res: 'tag tag-restr', lc: 'tag tag-low', uchi: 'tag tag-uchi', special: 'tag tag-special' })].join('');
    const topHtml = top.length ? `<div class="top-players">${top.map((r, i) =>
      `<span><span class="place">${medal[i]}</span>${playerLink(r)}<span class="rank">#${r.rank}</span></span>`).join('<span class="sep">·</span>')}</div>` : '';
    return `<tr class="event-row">
      <td class="col-date">${escapeHtml(i18n('upcoming.date', { ymd: w.ymd, wd: w.wd }))}</td>
      <td class="col-name"><a href="?e=${encodeURIComponent(eid)}">${escapeHtml(ev.tournament_name || '')}</a>${topHtml}</td>
      <td class="col-nent">${nentOf(ev)}</td>
      <td class="col-city">${escapeHtml(cityOf(ev))}</td>
      <td class="col-tags">${tags}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="empty-msg">${escapeHtml(all.length ? i18n('upcoming.no_match') : i18n('upcoming.none'))}</td></tr>`;
  for (const th of document.querySelectorAll('#eventstable th.sortable')) {
    const on = /** @type {HTMLElement} */ (th).dataset.sort === LIST.sortKey;
    th.classList.toggle('sorted-asc', on && LIST.sortDir === 'asc');
    th.classList.toggle('sorted-desc', on && LIST.sortDir === 'desc');
  }
}
function setupList() {
  $('up-list-view').hidden = false;
  $('search').addEventListener('input', e => { LIST.q = /** @type {HTMLInputElement} */ (e.target).value; renderList(); });
  $('filter-nent').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-nent]'));
    if (!b) return;
    LIST.minNent = Number(b.dataset.nent) || 0;
    for (const c of $('filter-nent').querySelectorAll('.chip')) c.classList.toggle('active', c === b);
    renderList();
  });
  $('filter-tags').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-tag]'));
    if (!b) return;
    const tag = String(b.dataset.tag), on = !LIST.tags.has(tag);
    LIST.tags.clear();   // 休日のみ・平日のみ はどちらか片方
    if (on) LIST.tags.add(tag);
    for (const c of $('filter-tags').querySelectorAll('.chip')) c.classList.toggle('active', LIST.tags.has(String(/** @type {HTMLElement} */ (c).dataset.tag)));
    renderList();
  });
  for (const th of document.querySelectorAll('#eventstable th.sortable')) th.addEventListener('click', () => {
    const k = String(/** @type {HTMLElement} */ (th).dataset.sort);
    if (LIST.sortKey === k) LIST.sortDir = LIST.sortDir === 'asc' ? 'desc' : 'asc';
    else { LIST.sortKey = k; LIST.sortDir = k === 'nent' ? 'desc' : 'asc'; }
    renderList();
  });
  renderList();
}

// ── 大会ごと (大会ページと同じ形) ──
/** @type {{ rows: UpRow[], q: string, char: string, pref: string, open: Set<string>, allGroups: Set<string>, rankAll: boolean }} */
const DET = { rows: [], q: '', char: '', pref: '', open: new Set(), allGroups: new Set(), rankAll: false };
/** 絞り込みの値: '' = すべて、'none' = 不明、それ以外は id の数字 */
const matches = (/** @type {number | null} */ v, /** @type {string} */ f) => !f || (f === 'none' ? v === null : v === Number(f));
/** 検索の正規化 (全角半角・大文字小文字・ひらがなカタカナを区別しない) */
const norm = (/** @type {string} */ s) => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');
const placeHtml = (/** @type {number | null} */ rank) => (rank === null ? `<span class="place dim">—</span>` : `<span class="place">${rank}</span>`);
/** 1 人の行 (左 = SPSP の順位、中 = 名前と キャラ・地域、右 = Lv) @param {UpRow} r @param {'char' | 'pref' | ''} [omit] 補足から省くもの (その組の中では同じなので) */
function playerRow(r, omit = '') {
  const sub = [omit !== 'char' && r.char !== null ? charLabel(r.char) : '', omit !== 'pref' && r.pref !== null ? prefLabel(r.pref) : ''].filter(Boolean).join(' / ');
  const lv = SPSPFormat.lvLabel(r.lv, r.rank);
  return `<div class="tour-item">${placeHtml(r.rank)}
    <div class="meta">${playerLink(r)}${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''}</div>
    <div class="v${lv ? '' : ' dim'}">${escapeHtml(lv || '—')}</div></div>`;
}
/** 使い手・地域の組 (押すと中の人が開く) @param {'char' | 'pref'} key */
function groupsHtml(key) {
  const groups = Stats.groupBy(DET.rows, key);
  const label = key === 'char' ? charLabel : prefLabel;
  $(key === 'char' ? 'up-char-n' : 'up-pref-n').textContent = String(groups.filter(g => g.key !== null).length);
  if (!groups.length) return `<div class="empty-msg" style="padding:12px">${escapeHtml(i18n('upcoming.no_entrants'))}</div>`;
  const all = DET.allGroups.has(key);
  const shown = all ? groups : groups.slice(0, GROUPS_HEAD);
  return shown.map(g => {
    const id = `${key}:${g.key === null ? 'none' : g.key}`;
    const open = DET.open.has(id);
    const names = g.rows.slice(0, 3).map(shortName).join(' / ');
    return `<div class="tour-group${open ? ' expanded' : ''}">
      <button type="button" class="tour-item" data-group="${escapeHtml(id)}" aria-expanded="${open}">
        <span class="place"><span class="num">${g.rows.length}</span><span class="frac">${escapeHtml(i18n('upcoming.people'))}</span></span>
        <div class="meta"><span class="nm">${escapeHtml(label(g.key))}</span><div class="sub">${escapeHtml(names)}${g.rows.length > 3 ? ' …' : ''}</div></div>
        <div class="v dim"><span class="chevron">▶</span></div>
      </button>
      <div class="tour-matches">${open ? g.rows.map(r => playerRow(r, key)).join('') : ''}</div>
    </div>`;
  }).join('') + (groups.length > GROUPS_HEAD ? `<button type="button" class="up-more" data-all="${key}">${escapeHtml(all ? i18n('upcoming.less') : i18n('upcoming.more_groups', { n: groups.length - GROUPS_HEAD }))}</button>` : '');
}
function distHtml() {
  const total = DET.rows.length;
  if (!total) return `<div class="empty-msg" style="padding:12px">${escapeHtml(i18n('upcoming.no_entrants'))}</div>`;
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
  return `<h3>${escapeHtml(i18n('upcoming.dist.rank'))}</h3>${bars(bands)}<h3>${escapeHtml(i18n('upcoming.dist.lv'))}</h3>${bars(lvs)}`;
}
function rankHtml() {
  const q = norm(DET.q);
  const rows = DET.rows.filter(r => matches(r.char, DET.char) && matches(r.pref, DET.pref) && (!q || norm(r.name).includes(q)));
  $('up-rank-n').textContent = rows.length === DET.rows.length ? i18n('player.upcoming.entrants', { n: rows.length }) : i18n('upcoming.n_of', { n: rows.length, total: DET.rows.length });
  if (!rows.length) return `<div class="empty-msg" style="padding:12px">${escapeHtml(DET.rows.length ? i18n('upcoming.no_match') : i18n('upcoming.no_entrants'))}</div>`;
  const shown = DET.rankAll ? rows : rows.slice(0, RANK_HEAD);
  return shown.map(r => playerRow(r)).join('')
    + (rows.length > RANK_HEAD ? `<button type="button" class="up-more" data-rank-all="1">${escapeHtml(DET.rankAll ? i18n('upcoming.less') : i18n('upcoming.more', { n: rows.length - RANK_HEAD }))}</button>` : '');
}
const renderGroups = () => { $('up-chars').innerHTML = groupsHtml('char'); $('up-prefs').innerHTML = groupsHtml('pref'); };
const renderRank = () => { $('up-rank').innerHTML = rankHtml(); };

function setupDetail(/** @type {any} */ ev) {
  DET.rows = rowsOf(ev);
  $('up-detail-view').hidden = false;
  const w = when(ev.start_at);
  const tour = DATA.tours.get(Number(ev.tournament_id));
  const title = String(ev.tournament_name || '');
  $('up-name').textContent = title;
  document.title = i18n('upcoming.page_title', { name: title });
  $('up-event').textContent = [ev.event_name || '', i18n('upcoming.date_time', { ymd: w.ymd, wd: w.wd, hm: w.hm }), tour && tour.city ? tour.city : ''].filter(Boolean).join(' ・ ');
  $('up-meta').innerHTML = [SPSPTags.dayTag(ev, { wk: 'chip wk', wd: 'chip wd' }),
    ...SPSPTags.flagTags(ev, { pre: 'chip pre', res: 'chip res', lc: 'chip lc', uchi: 'chip rs', special: 'chip rs' })].join('');
  const slug = tour && typeof tour.tournament_slug === 'string' && /^tournament\/[\w-]+$/.test(tour.tournament_slug) ? tour.tournament_slug : '';
  if (slug) { const a = /** @type {HTMLAnchorElement} */ ($('up-startgg')); a.href = 'https://www.start.gg/' + slug; a.style.display = ''; }
  const s = Stats.summary(DET.rows);
  const people = escapeHtml(i18n('upcoming.people'));
  const tile = (/** @type {string} */ label, /** @type {string} */ v, unit = people) => `<div><dt>${escapeHtml(label)}</dt><dd>${v}<small>${unit}</small></dd></div>`;
  $('up-stats').innerHTML = [tile(i18n('upcoming.stat.entrants'), String(Math.max(s.n, nentOf(ev)))), tile(i18n('upcoming.stat.top100'), String(s.top100)),
    tile(i18n('upcoming.stat.top1000'), String(s.top1000)),
    s.median === null ? '' : tile(i18n('upcoming.stat.median'), s.median.toLocaleString(), escapeHtml(i18n('upcoming.rank_unit')))].join('');
  $('up-dist').innerHTML = distHtml();
  renderGroups();
  // 絞り込みの選択肢: この大会に居るキャラ・地域だけ (人数の多い順)
  const opts = (/** @type {'char' | 'pref'} */ key, /** @type {(k: number | null) => string} */ label, /** @type {string} */ all) =>
    `<option value="">${escapeHtml(all)}</option>` + Stats.groupBy(DET.rows, key).map(g =>
      `<option value="${g.key === null ? 'none' : g.key}">${escapeHtml(label(g.key))} (${g.rows.length})</option>`).join('');
  const fchar = /** @type {HTMLSelectElement} */ ($('up-fchar')), fpref = /** @type {HTMLSelectElement} */ ($('up-fpref'));
  fchar.innerHTML = opts('char', charLabel, i18n('upcoming.all_chars'));
  fpref.innerHTML = opts('pref', prefLabel, i18n('upcoming.all_prefs'));
  fchar.addEventListener('change', () => { DET.char = fchar.value; renderRank(); });
  fpref.addEventListener('change', () => { DET.pref = fpref.value; renderRank(); });
  $('up-pq').addEventListener('input', e => { DET.q = /** @type {HTMLInputElement} */ (e.target).value; renderRank(); });
  renderRank();
  $('up-detail-view').addEventListener('click', e => {
    const t = /** @type {HTMLElement} */ (e.target);
    const g = /** @type {HTMLElement | null} */ (t.closest('[data-group]'));
    if (g) { const id = String(g.dataset.group); if (DET.open.has(id)) DET.open.delete(id); else DET.open.add(id); renderGroups(); return; }
    const a = /** @type {HTMLElement | null} */ (t.closest('[data-all]'));
    if (a) { const k = String(a.dataset.all); if (DET.allGroups.has(k)) DET.allGroups.delete(k); else DET.allGroups.add(k); renderGroups(); return; }
    if (t.closest('[data-rank-all]')) { DET.rankAll = !DET.rankAll; renderRank(); }
  });
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
    if (!ev) { fail(i18n('upcoming.not_found')); $('up-empty').insertAdjacentHTML('beforeend', ` <a href="./">${escapeHtml(i18n('upcoming.back'))}</a>`); return; }
    setupDetail(ev);
  } else setupList();
}
main().catch(e => { console.error(e); $('up-loading').hidden = true; $('up-empty').textContent = i18n('upcoming.load_failed'); $('up-empty').hidden = false; });
