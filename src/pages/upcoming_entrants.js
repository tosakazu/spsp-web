// @ts-check
// src/pages/upcoming_entrants.js — site/upcoming/entrants.html のスクリプト。今後の大会 1 つの参加予定者 (?e=<event id>)。
// 上 (hero・実力分布・地域・使い手) は大会ページ (t/) と同じ形 (HTML・CSS とも t/index.html のもの)、下の参加予定者はランキングのページと同じ表。
//   実力分布      Lv の表記と同じ区切りの帯ごとの人数。予選通過の人数 (bracket.advance) が分かっていて全員ではない大会は、
//                 順位の高い順に数えたときのラインが掛かる帯に印
//   使い手・地域  人数の多い順に 5 件ずつ (メインキャラ。ページ送りは js/pager.js)。行を押すとその組の人が開く
//   キャラ選択    表の上の「キャラ選択」で開く、キャラ投票 (vote.html) と同じ選択。選ぶと表をそのキャラの使い手に絞る。「サブ使用も含める」で
//                 サブで使う人 (data/character_index.json の sub_by_char) も数える・絞り込みに入れる
//   参加予定者    ランキングの表 (js/ranking_page.js。行は js/views.js の rowsByUids)。順位は全国の順位のまま (大会の中で付け直さない)。
//                 ランキングに居ない人は名前だけの行で後ろに並ぶ
// データと小さい部品は js/upcoming_common.js、集計は js/upcoming_stats.js。シード (entrants の seed) は公開前のことがあるので出さない。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPFormat from '../../site/js/format.js';
import SPSPTags from '../../site/js/tags.js';
import SPSPPager from '../../site/js/pager.js';
import Stats from '../../site/js/upcoming_stats.js';
import Up from '../../site/js/upcoming_common.js';
import SPSPViews from '../../site/js/views.js';
import SPSPCharEmoji from '../../site/js/char_emoji.js';
import { charName } from '../../site/js/chars.js';
import '../../site/js/links.js';
import '../../site/js/data.js';
import '../../site/js/player_data.js';
import '../../site/ranking-table.js';
import '../../site/player-detail.js';
import SPSPRankingPage from '../../site/js/ranking_page.js';
import '../../site/nav.js';

const i18n = SPSPI18n.t;
SPSPI18n.apply(document);
const S = /** @type {any} */ (window).SPSP;
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @typedef {import('../../site/js/upcoming_stats.js').UpRow} UpRow */
/** char: '' = すべて、'none' = 不明、それ以外はキャラ id。sub = サブ使用も含める。subs = uid → サブで使うキャラ id (読めるまで空)
 * @type {{ rows: UpRow[], byUid: Map<number, UpRow>, char: string, pref: string, sub: boolean, subs: Map<number, Set<number>>, table: any, advance: number | null }} */
const ST = { rows: [], byUid: new Map(), char: '', pref: '', sub: false, subs: new Map(), table: null, advance: null };

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

/** @type {Record<'char' | 'pref', { key: number | null, rows: UpRow[] }[]>} */
const GROUPS = { char: [], pref: [] };
const BOUND = { char: false, pref: false };
/** サブ使用も含めた使い手の組 (1 人がメインとサブの各キャラの組に入る)。並びは Stats.groupBy と同じ */
function charGroupsWithSub() {
  /** @type {Map<number | null, UpRow[]>} */
  const m = new Map();
  for (const r of ST.rows) {
    const ids = new Set(/** @type {(number | null)[]} */ ([r.char]));
    for (const c of ST.subs.get(r.uid) || []) ids.add(c);
    for (const c of ids) { const a = m.get(c); if (a) a.push(r); else m.set(c, [r]); }
  }
  const best = (/** @type {UpRow[]} */ a) => (a[0].rank === null ? Infinity : a[0].rank);
  return [...m.entries()].map(([key, rows]) => ({ key, rows }))
    .sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || b.rows.length - a.rows.length || best(a.rows) - best(b.rows));
}

/** 使い手・地域 (5 件ずつ。行を押すと中の人が開く) @param {'char' | 'pref'} key */
function setupGroups(key) {
  const groups = key === 'char' && ST.sub ? charGroupsWithSub() : Stats.groupBy(ST.rows, key);
  GROUPS[key] = groups;
  const label = key === 'char' ? Up.charLabel : Up.prefLabel;
  const elId = key === 'char' ? 'up-chars' : 'up-prefs';
  $(key === 'char' ? 'up-char-n' : 'up-pref-n').textContent = String(groups.filter(g => g.key !== null).length);
  SPSPPager.setupPaginated(groups, elId, elId + '-pager', (/** @type {{ key: number | null, rows: UpRow[] }[]} */ arr) => arr.map(g => {
    return `<div class="tour-group" data-key="${g.key === null ? 'none' : g.key}">
      <div class="tour-item up-g" style="grid-template-columns:46px 1fr auto;grid-template-rows:auto">
        <span class="place" style="grid-row:1"><span class="num">${g.rows.length}</span><span class="frac">${escapeHtml(i18n('common.unit_people'))}</span></span>
        <div class="meta" style="grid-row:1"><span class="nm">${escapeHtml(label(g.key))}</span><div class="sub">${escapeHtml(g.rows.slice(0, 3).map(Up.shortName).join(' / '))}${g.rows.length > 3 ? ' …' : ''}</div></div>
        <div class="v rk" style="grid-column:3;grid-row:1"><span class="chevron">▶</span></div>
      </div>
      <div class="tour-matches"></div>
    </div>`;
  }).join(''), i18n('upcoming.no_entrants'));
  if (BOUND[key]) return;   // 描き直し (サブ使用も含める の切り替え) では付け直さない
  BOUND[key] = true;
  // 行を押すと開く (中の人は開いたときに描く。大会ページの順位表と同じ動き)
  $(elId).addEventListener('click', e => {
    const item = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.up-g'));
    const box = item && /** @type {HTMLElement | null} */ (item.closest('.tour-group'));
    if (!item || !box) return;
    const inner = /** @type {HTMLElement} */ (box.querySelector('.tour-matches'));
    const g = GROUPS[key].find(x => (x.key === null ? 'none' : String(x.key)) === box.dataset.key);
    if (!inner.innerHTML && g) inner.innerHTML = g.rows.map(playerRow).join('');
    box.classList.toggle('expanded');
    $(elId).style.minHeight = '';   // 開いた分で高さが変わる (ページ送りの高さ固定を外す)
  });
}

function distHtml() {
  const total = ST.rows.length;
  if (!total) return `<div class="empty-msg" style="padding:12px">${escapeHtml(i18n('upcoming.no_entrants'))}</div>`;
  // 帯は Lv の表記と同じ区切り。ラベル = Lv のバッジ (プレイヤーページと同じ lv-pill) + 順位の範囲
  const bands = Stats.rankBands(ST.rows);
  const items = bands.map(b => {
    if (b.from === null) return { n: b.n, none: true, label: `<span class="lv-pill lv-0">${escapeHtml(i18n('upcoming.no_rank'))}</span>` };
    const lv = Stats.lvOfRank(b.from);
    const range = b.to === null ? i18n('upcoming.band_from', { from: b.from.toLocaleString() }) : i18n('upcoming.band', { from: b.from.toLocaleString(), to: b.to.toLocaleString() });
    return { n: b.n, none: false, label: `<span class="lv-pill lv-${lv}">${escapeHtml(SPSPFormat.lvLabel(lv, b.from))}</span><small>${escapeHtml(range)}</small>` };
  });
  const max = Math.max(1, ...items.map(x => x.n));
  // 予選通過のライン (最初のフェーズから次に進む人数が分かっていて、全員ではないとき): 順位の高い順に数えて掛かる帯に印 (行に色と札)。
  // その帯の棒はラインの内側だけ濃く、外側と下の帯は薄く
  const cut = Stats.cutBand(bands, ST.advance);
  const pct = (/** @type {number} */ n) => (n / max * 100).toFixed(1);
  const bar = (/** @type {{ n: number, none?: boolean }} */ x, /** @type {number} */ i) => {
    if (!cut || i < cut.index) return `<i style="width:${pct(x.n)}%"></i>`;
    if (i > cut.index) return `<i class="out" style="width:${pct(x.n)}%"></i>`;
    return `<i style="width:${pct(cut.within)}%"></i><i class="out" style="width:${pct(x.n - cut.within)}%"></i>`;
  };
  const tag = `<span class="up-cut-tag">${escapeHtml(i18n('upcoming.cut_line', { n: /** @type {number} */ (ST.advance) }))}</span>`;
  return `<div class="up-bars">${items.map((x, i) => { const c = cut && i === cut.index ? ' cut' : ''; return `<span class="lb${c}">${x.label}${c ? tag : ''}</span>
      <span class="bar${x.none ? ' none' : ''}${c}">${bar(x, i)}</span>
      <span class="n${c}">${x.n}<small>${(x.n / total * 100).toFixed(0)}%</small></span>`; }).join('')}</div>`;
}

/** その人がキャラ f の使い手か (サブ込みのときはサブも) @param {UpRow} r @param {string} f */
function usesChar(r, f) {
  if (!f) return true;
  if (f === 'none') return r.char === null;
  const id = Number(f);
  if (r.char === id) return true;
  const s = ST.sub ? ST.subs.get(r.uid) : null;
  return !!(s && s.has(id));
}

/** 使い手の選択 (キャラ投票と同じボタンの並び)。人数の多い順、最後に不明 */
function renderChars() {
  /** @type {Map<number, number>} */
  const n = new Map();
  let none = 0;
  for (const r of ST.rows) {
    const ids = new Set(r.char === null ? [] : [r.char]);
    if (ST.sub) for (const c of ST.subs.get(r.uid) || []) ids.add(c);
    if (r.char === null) none++;
    for (const c of ids) n.set(c, (n.get(c) || 0) + 1);
  }
  const list = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const btn = (/** @type {string} */ id, /** @type {string} */ em, /** @type {string} */ name, /** @type {number} */ cnt) =>
    `<button type="button" class="vt-char${ST.char === id ? ' sel' : ''}" data-id="${id}" data-name="${escapeHtml(name)}">
      <span class="em">${escapeHtml(em)}</span><span class="nm">${escapeHtml(name)}</span><span class="ct">${cnt}</span></button>`;
  $('up-char-grid').innerHTML = btn('', '👥', i18n('common.all'), ST.rows.length)
    + list.map(([id, cnt]) => btn(String(id), SPSPCharEmoji.emojiOf(id) || '🎮', charName(id, String(id)), cnt)).join('')
    + (none ? btn('none', '❔', i18n('upcoming.unknown'), none) : '');
  applyCharSearch();
}
function applyCharSearch() {
  const q = norm(/** @type {HTMLInputElement} */ ($('up-char-search')).value);
  for (const b of $('up-char-grid').children) /** @type {HTMLElement} */ (b).hidden = !!q && !norm(/** @type {HTMLElement} */ (b).dataset.name || '').includes(q);
}

/** キャラ・地域の絞り込みを表に反映 */
function applyFilter() {
  const chip = $('up-char-chip');
  chip.classList.toggle('on', !!ST.char);
  chip.textContent = ST.char ? i18n('upcoming.char_chip', { char: ST.char === 'none' ? i18n('upcoming.unknown') : Up.charLabel(Number(ST.char)) }) : '';
  if (!ST.table) return;
  ST.table.setRowFilter(!ST.char && !ST.pref ? null : (/** @type {any} */ rec) => {
    const r = ST.byUid.get(rec.user_id);
    return !!r && usesChar(r, ST.char) && matches(r.pref, ST.pref);
  });
}

/** 参加予定者の表 (ランキングのページと同じ)。行は views の rowsByUids、ランキングに居ない人は名前だけの行 */
async function setupTable() {
  const RP = SPSPRankingPage;
  const tbody = $('tbody');
  if (!ST.rows.length) { tbody.innerHTML = `<tr><td colspan="11" class="empty-msg">${escapeHtml(i18n('upcoming.no_entrants'))}</td></tr>`; return; }
  const manifest = await SPSPViews.manifest().catch(() => null);
  /** @type {any[]} */
  let recs = [];
  if (manifest) recs = await SPSPViews.rowsByUids(ST.rows.filter(r => r.rank !== null).map(r => r.uid), { plain: true }).catch(() => []);
  const have = new Set(recs.map(r => r.user_id));
  // ランキングに居ない人 (と、行が読めなかった人) は名前だけ
  const rest = ST.rows.filter(r => !have.has(r.uid)).map(r => ({ user_id: r.uid, display: r.name, unranked: true, ranks: {}, scores: {}, counts: {} }));
  const data = [...recs, ...rest];
  const { TJPR_SCORE_COL, BT_SCORE_COL } = RP.scoreColumns('inline');
  ST.table = RP.createTable({
    rows: data, method: 'ensemble', sort: { key: 'rank', dir: 'asc' }, pageSize: 100,
    totalForRankFrac: () => (manifest && manifest.n_players) || data.length,
    playerHrefPrefix: S.langRoot,
    columns: ['rank', 'display', BT_SCORE_COL, TJPR_SCORE_COL, 'tour_count', 'rank_tjpr', 'rank_bt_gated'],
    rankCaretExpand: false,
  });
  RP.applyState(ST.table, { rows: data, method: 'ensemble', filterText: /** @type {HTMLInputElement} */ ($('search')).value, sort: { key: 'rank', dir: 'asc' } });
  RP.bindSearch((/** @type {string} */ text) => ST.table.setFilterText(text, RP.searchById()));
  RP.bindMethodTabs((/** @type {string} */ m) => ST.table.setMethod(m));
  applyFilter();
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
  const adv = ev.bracket && Number(ev.bracket.advance);
  ST.advance = adv && adv > 0 ? adv : null;
  $('up-dist').innerHTML = distHtml();
  setupGroups('char');
  setupGroups('pref');
  for (const r of ST.rows) ST.byUid.set(r.uid, r);
  $('up-rank').style.display = '';
  $('up-rank-n').textContent = String(ST.rows.length);
  // キャラ選択: 表の上の「キャラ選択」で開く (キャラ投票と同じ選択)。選ぶと閉じる。もう一度押すと外れる
  const panel = $('up-char-panel'), pick = $('up-char-btn');
  const openPanel = (/** @type {boolean} */ on) => { panel.hidden = !on; pick.setAttribute('aria-expanded', String(on)); };
  pick.addEventListener('click', () => openPanel(!!panel.hidden));
  renderChars();
  $('up-char-grid').addEventListener('click', e => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.vt-char'));
    if (!b) return;
    ST.char = ST.char === String(b.dataset.id) ? '' : String(b.dataset.id);
    for (const c of $('up-char-grid').children) c.classList.toggle('sel', /** @type {HTMLElement} */ (c).dataset.id === ST.char);
    applyFilter();
    openPanel(false);
  });
  $('up-char-search').addEventListener('input', applyCharSearch);
  $('up-char-chip').addEventListener('click', () => { ST.char = ''; renderChars(); applyFilter(); });
  // サブ使用も含める: 初めてチェックしたときにサブの表を読む
  // チェックは 2 か所 (使い手の欄・キャラ選択の中)。どちらを変えても両方に効く
  const subCbs = /** @type {HTMLInputElement[]} */ ([$('up-sub'), $('up-sub2')]);
  let subLoaded = false;
  for (const cb of subCbs) {
    cb.checked = false;
    cb.addEventListener('change', async () => {
      const on = cb.checked;
      for (const o of subCbs) o.checked = on;
      if (on && !subLoaded) {
        subLoaded = true;
        const j = await fetch(S.data + 'data/character_index.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
        for (const [cid, uids] of Object.entries((j && j.sub_by_char) || {})) {
          for (const u of /** @type {number[]} */ (uids)) {
            if (!ST.byUid.has(u)) continue;
            const s = ST.subs.get(u) || new Set();
            s.add(Number(cid));
            ST.subs.set(u, s);
          }
        }
      }
      ST.sub = subCbs[0].checked;
      setupGroups('char');
      renderChars();
      applyFilter();
    });
  }
  // 地域の絞り込み: この大会に居る地域だけ (人数の多い順)
  const fpref = /** @type {HTMLSelectElement} */ ($('up-fpref'));
  fpref.innerHTML = `<option value="">${escapeHtml(i18n('upcoming.all_prefs'))}</option>` + Stats.groupBy(ST.rows, 'pref').map(g =>
    `<option value="${g.key === null ? 'none' : g.key}">${escapeHtml(Up.prefLabel(g.key))} (${g.rows.length})</option>`).join('');
  fpref.addEventListener('change', () => { ST.pref = fpref.value; applyFilter(); });
  setupTable().catch(e => { console.error(e); $('tbody').innerHTML = `<tr><td colspan="11" class="empty-msg">${escapeHtml(i18n('upcoming.load_failed'))}</td></tr>`; });
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
