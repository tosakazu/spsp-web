// @ts-check
// src/pages/upcoming_entrants.js — site/upcoming/entrants.html のスクリプト。今後の大会 1 つの参加予定者 (?e=<event id>)。
// 見た目は大会ページ (t/) と同じ (HTML の形・CSS とも t/index.html のもの): hero → 上位 3 人 → 見出しつきの欄。
//   上位 3 人     総合評価の順位が高い 3 人 (大会ページの表彰台と同じ箱)
//   実力分布      Lv の表記と同じ区切りの帯ごとの人数
//   使い手・地域  人数の多い順に 5 件ずつ (ページ送りは js/pager.js)。行を押すとその組の人が開く
//   参加予定者    順位の高い順の全員 (大会ページの全順位表と同じ行)。名前の検索、キャラ・地域の絞り込み
// データと小さい部品は js/upcoming_common.js、集計は js/upcoming_stats.js。シード (entrants の seed) は公開前のことがあるので出さない。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPFormat from '../../site/js/format.js';
import SPSPTags from '../../site/js/tags.js';
import SPSPPager from '../../site/js/pager.js';
import Stats from '../../site/js/upcoming_stats.js';
import Up from '../../site/js/upcoming_common.js';
import '../../site/nav.js';

const i18n = SPSPI18n.t;
SPSPI18n.apply(document);
const S = /** @type {any} */ (window).SPSP;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @typedef {import('../../site/js/upcoming_stats.js').UpRow} UpRow */
/** @type {{ rows: UpRow[], q: string, char: string, pref: string }} */
const ST = { rows: [], q: '', char: '', pref: '' };

/** 絞り込みの値: '' = すべて、'none' = 不明、それ以外は id の数字 */
const matches = (/** @type {number | null} */ v, /** @type {string} */ f) => !f || (f === 'none' ? v === null : v === Number(f));
/** 検索の正規化 (全角半角・大文字小文字・ひらがなカタカナを区別しない) */
const norm = (/** @type {string} */ s) => s.normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)).replace(/\s+/g, '');
const dash = '<span class="val dim">—</span>';
const chip = (/** @type {string} */ lbl, /** @type {string} */ valHtml) => `<div class="chip"><span class="lbl">${escapeHtml(lbl)}</span>${valHtml}</div>`;

/** 1 人の行 (大会ページの全順位表と同じ: 左 = 順位、名前、下に 3 つの値) @param {UpRow} r */
function playerRow(r) {
  const lv = SPSPFormat.lvLabel(r.lv, r.rank);
  const place = r.rank === null ? '<span class="place" style="color:#9ca3af">—</span>' : `<span class="place"><span class="num">${r.rank}</span></span>`;
  return `<div class="tour-group"><div class="tour-item" style="cursor:default">${place}
    <div class="meta">${Up.playerLink(r)}</div>
    <div class="v-stats">${chip('Lv', lv ? `<span class="lv-pill lv-${r.lv}">${escapeHtml(lv)}</span>` : dash)}${
      chip(i18n('upcoming.chip.char'), r.char === null ? dash : `<span class="val">${escapeHtml(Up.charLabel(r.char))}</span>`)}${
      chip(i18n('upcoming.chip.pref'), r.pref === null ? dash : `<span class="val">${escapeHtml(Up.prefLabel(r.pref))}</span>`)}</div>
  </div></div>`;
}

/** 使い手・地域 (5 件ずつ。行を押すと中の人が開く) @param {'char' | 'pref'} key */
function setupGroups(key) {
  const groups = Stats.groupBy(ST.rows, key);
  const label = key === 'char' ? Up.charLabel : Up.prefLabel;
  const elId = key === 'char' ? 'up-chars' : 'up-prefs';
  $(key === 'char' ? 'up-char-n' : 'up-pref-n').textContent = String(groups.filter(g => g.key !== null).length);
  SPSPPager.setupPaginated(groups, elId, elId + '-pager', (/** @type {{ key: number | null, rows: UpRow[] }[]} */ arr) => arr.map(g => {
    const best = g.rows[0].rank;
    return `<div class="tour-group" data-key="${g.key === null ? 'none' : g.key}">
      <div class="tour-item up-g" style="grid-template-columns:46px 1fr auto;grid-template-rows:auto">
        <span class="place" style="grid-row:1"><span class="num">${g.rows.length}</span><span class="frac">${escapeHtml(i18n('common.unit_people'))}</span></span>
        <div class="meta" style="grid-row:1"><span class="nm">${escapeHtml(label(g.key))}</span><div class="sub">${escapeHtml(g.rows.slice(0, 3).map(Up.shortName).join(' / '))}${g.rows.length > 3 ? ' …' : ''}</div></div>
        <div class="v rk" style="grid-column:3;grid-row:1">${best === null ? '—' : '#' + best}<span class="frac">${escapeHtml(i18n('upcoming.best'))}</span> <span class="chevron">▶</span></div>
      </div>
      <div class="tour-matches"></div>
    </div>`;
  }).join(''), i18n('upcoming.no_entrants'));
  // 行を押すと開く (中の人は開いたときに描く。大会ページの順位表と同じ動き)
  $(elId).addEventListener('click', e => {
    const item = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.up-g'));
    const box = item && /** @type {HTMLElement | null} */ (item.closest('.tour-group'));
    if (!item || !box) return;
    const inner = /** @type {HTMLElement} */ (box.querySelector('.tour-matches'));
    const g = groups.find(x => (x.key === null ? 'none' : String(x.key)) === box.dataset.key);
    if (!inner.innerHTML && g) inner.innerHTML = g.rows.map(playerRow).join('');
    box.classList.toggle('expanded');
    $(elId).style.minHeight = '';   // 開いた分で高さが変わる (ページ送りの高さ固定を外す)
  });
}

function distHtml() {
  const total = ST.rows.length;
  if (!total) return `<div class="empty-msg" style="padding:12px">${escapeHtml(i18n('upcoming.no_entrants'))}</div>`;
  // 帯は Lv の表記と同じ区切り。ラベル = Lv のバッジ (プレイヤーページと同じ lv-pill) + 順位の範囲
  const items = Stats.rankBands(ST.rows).map(b => {
    if (b.from === null) return { n: b.n, none: true, label: `<span class="lv-pill lv-0">${escapeHtml(i18n('upcoming.no_rank'))}</span>` };
    const lv = Stats.lvOfRank(b.from);
    const range = b.to === null ? i18n('upcoming.band_from', { from: b.from.toLocaleString() }) : i18n('upcoming.band', { from: b.from.toLocaleString(), to: b.to.toLocaleString() });
    return { n: b.n, none: false, label: `<span class="lv-pill lv-${lv}">${escapeHtml(SPSPFormat.lvLabel(lv, b.from))}</span><small>${escapeHtml(range)}</small>` };
  });
  const max = Math.max(1, ...items.map(x => x.n));
  return `<div class="up-bars">${items.map(x => `<span class="lb">${x.label}</span>
      <span class="bar${x.none ? ' none' : ''}"><i style="width:${(x.n / max * 100).toFixed(1)}%"></i></span>
      <span class="n">${x.n}<small>${(x.n / total * 100).toFixed(0)}%</small></span>`).join('')}</div>`;
}

function renderList() {
  const q = norm(ST.q);
  const rows = ST.rows.filter(r => matches(r.char, ST.char) && matches(r.pref, ST.pref) && (!q || norm(r.name).includes(q)));
  $('up-rank-n').textContent = rows.length === ST.rows.length ? String(rows.length) : `${rows.length} / ${ST.rows.length}`;
  $('std-list').innerHTML = rows.map(playerRow).join('')
    || `<div class="empty-msg" style="padding:12px">${escapeHtml(ST.rows.length ? i18n('upcoming.no_match') : i18n('upcoming.no_entrants'))}</div>`;
}

function render(/** @type {any} */ ev) {
  ST.rows = Up.rowsOf(ev);
  $('share-card').style.display = '';
  /** @type {HTMLAnchorElement} */ ($('up-back')).href = S.pageHref('index.html') || './';
  const title = String(ev.tournament_name || '');
  $('name').textContent = title;
  document.title = i18n('upcoming.page_title', { name: title });
  $('event').textContent = ev.event_name || '';
  const tour = Up.tourOf(ev);
  const slug = tour && typeof tour.tournament_slug === 'string' && /^tournament\/[\w-]+$/.test(tour.tournament_slug) ? tour.tournament_slug : '';
  if (slug) { const a = /** @type {HTMLAnchorElement} */ ($('startgg-link')); a.href = 'https://www.start.gg/' + slug; a.style.display = ''; }
  // 大会ページと同じ並び: 日付 · 📍開催地 · 人数 タグ
  const w = Up.when(ev.start_at);
  const chips = [SPSPTags.dayTag(ev, { wk: 'chip wk', wd: 'chip wd' }), ...SPSPTags.flagTags(ev, { pre: 'chip pre', res: 'chip res', lc: 'chip lc', rs: 'chip rs' })];
  $('meta-line').innerHTML = `${escapeHtml(i18n('upcoming.date_time', { ymd: w.ymd, wd: w.wd, hm: w.hm }))} · ${Up.cityOf(ev) ? '📍' + escapeHtml(Up.cityOf(ev)) + ' · ' : ''}`
    + `<b style="color:#111827">${Math.max(ST.rows.length, Up.nentOf(ev))}</b> ${escapeHtml(i18n('common.unit_people'))} ${chips.join('')}`;
  const s = Stats.summary(ST.rows);
  $('up-summary').textContent = s.ranked ? i18n('upcoming.summary', { top100: s.top100, top1000: s.top1000, median: s.median === null ? '—' : s.median.toLocaleString() }) : '';
  $('up-dist').innerHTML = distHtml();
  setupGroups('char');
  setupGroups('pref');
  // 絞り込みの選択肢: この大会に居るキャラ・地域だけ (人数の多い順)
  const opts = (/** @type {'char' | 'pref'} */ key, /** @type {(k: number | null) => string} */ label, /** @type {string} */ all) =>
    `<option value="">${escapeHtml(all)}</option>` + Stats.groupBy(ST.rows, key).map(g =>
      `<option value="${g.key === null ? 'none' : g.key}">${escapeHtml(label(g.key))} (${g.rows.length})</option>`).join('');
  const fchar = /** @type {HTMLSelectElement} */ ($('up-fchar')), fpref = /** @type {HTMLSelectElement} */ ($('up-fpref'));
  fchar.innerHTML = opts('char', Up.charLabel, i18n('upcoming.all_chars'));
  fpref.innerHTML = opts('pref', Up.prefLabel, i18n('upcoming.all_prefs'));
  fchar.addEventListener('change', () => { ST.char = fchar.value; renderList(); });
  fpref.addEventListener('change', () => { ST.pref = fpref.value; renderList(); });
  $('std-search').addEventListener('input', e => { ST.q = /** @type {HTMLInputElement} */ (e.target).value; renderList(); });
  renderList();
}

async function main() {
  const ok = await Up.load();
  $('loading').style.display = 'none';
  const eid = new URL(location.href).searchParams.get('e') || '';
  const ev = ok && Object.prototype.hasOwnProperty.call(Up.DATA.events, eid) ? Up.DATA.events[eid] : null;
  if (!ev) {
    const nf = $('not-found');
    nf.textContent = ok ? i18n('upcoming.not_found') : i18n('upcoming.load_failed');
    nf.insertAdjacentHTML('beforeend', `<div style="margin-top:8px"><a href="${escapeHtml(S.pageHref('index.html') || './')}" style="color:#dc2626">${escapeHtml(i18n('upcoming.back'))}</a></div>`);
    nf.style.display = '';
    return;
  }
  render(ev);
}
main().catch(e => { console.error(e); $('loading').style.display = 'none'; $('not-found').textContent = i18n('upcoming.load_failed'); $('not-found').style.display = ''; });
