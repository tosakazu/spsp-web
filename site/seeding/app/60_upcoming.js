// @ts-check
// seeding/app/60_upcoming.js — SPSP シードツール本体の一部: 今後の大会ピッカー、複数 event の選択 UI。
// 元は 1 本の seed_app.js (2026-09-13 に分割)。ファイルはページの <script> の並び順に読まれ、
// トップレベルの const / let / function を同じグローバル字句環境で共有する。site/seeding/app/README.md を見ること。
import { S } from './00_state.js';
import { i18n } from './10_skeleton.js';
import { handleFetch } from './40_startgg.js';
import { escapeHtml } from '../../js/html.js';
'use strict';

// ── 今後の大会ピッカー ─────────────────────────
// data/upcoming.json を lazy fetch して 5件/ページで表示.
// 単独 SSBU event の大会 → クリックで URL 入力 + handleFetch 自動起動.
// 複数 SSBU event の大会 → inline で event 選択肢を展開.
export const UPCOMING_PAGE_SIZE = 5;
/** @type {Promise<SpspUpcomingData | null> | null} */
let UPCOMING_LOAD_PROMISE = null;

/** @param {number | null | undefined} unixTs @returns {string} */
function formatUpcomingDate(unixTs) {
  if (!unixTs) return '?';
  const d = new Date(unixTs * 1000);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const wk = [i18n('seed.upcoming.s1'),i18n('seed.upcoming.s2'),i18n('seed.upcoming.s3'),i18n('seed.upcoming.s4'),i18n('seed.upcoming.s5'),i18n('seed.upcoming.s6'),i18n('seed.upcoming.s7')][d.getDay()];
  return `${m}/${day}(${wk})`;
}

async function loadUpcomingData() {
  if (S.UPCOMING_DATA) return S.UPCOMING_DATA;
  if (UPCOMING_LOAD_PROMISE) return UPCOMING_LOAD_PROMISE;
  UPCOMING_LOAD_PROMISE = (async () => {
    const res = await fetch(SPSP.data + 'data/upcoming.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('upcoming.json HTTP ' + res.status);
    S.UPCOMING_DATA = await res.json();
    return S.UPCOMING_DATA;
  })();
  return UPCOMING_LOAD_PROMISE;
}

/** @param {string} tournamentSlug @param {string | null | undefined} eventSlug @returns {string} */
function buildEventUrl(tournamentSlug, eventSlug) {
  const tail = String(eventSlug || '').split('/').pop();
  // tournament_slug は "tournament/xxx" or "xxx"。後者なら prefix を付ける.
  const tslug = tournamentSlug.startsWith('tournament/')
    ? tournamentSlug : ('tournament/' + tournamentSlug);
  return 'https://www.start.gg/' + tslug + '/event/' + tail;
}

export function renderUpcomingPage() {
  const list = document.getElementById('upcoming-list');
  const pager = document.getElementById('upcoming-pager');
  if (!list || !pager) return;
  if (!S.UPCOMING_DATA || !S.UPCOMING_DATA.tournaments) return;
  // 現在 epoch 秒より startAt が前の大会は表示しない (= 既に過去になった大会).
  // upcoming.json は download 時点で過去除外済だが、build と閲覧の時間差で過ぎたものも除外.
  const nowSec = Math.floor(Date.now() / 1000);
  const tours = (S.UPCOMING_DATA.tournaments || []).filter(t => {
    const st = Number(t.start_at);
    return Number.isFinite(st) && st >= nowSec;
  });
  const total = tours.length;
  const totalPages = Math.max(1, Math.ceil(total / UPCOMING_PAGE_SIZE));
  if (S.UPCOMING_PAGE >= totalPages) S.UPCOMING_PAGE = totalPages - 1;
  if (S.UPCOMING_PAGE < 0) S.UPCOMING_PAGE = 0;
  const start = S.UPCOMING_PAGE * UPCOMING_PAGE_SIZE;
  const slice = tours.slice(start, start + UPCOMING_PAGE_SIZE);
  list.innerHTML = '';
  for (const t of slice) {
    const row = document.createElement('div');
    row.className = 'upcoming-item';
    row.dataset.tslug = t.tournament_slug;
    const tslugBare = String(t.tournament_slug || '').replace(/^tournament\//, '');
    const ttoUrl = `https://www.start.gg/${t.tournament_slug || ('tournament/' + tslugBare)}`;
    const cityHtml = t.city ? `<span class="city">${escapeHtml(t.city)}</span>` : '';
    const onlineHtml = t.is_online ? `<span class="city">${i18n('seed.upcoming.online')}</span>` : '';
    row.innerHTML = `
      <div class="row-1">
        <span class="ev-date">${formatUpcomingDate(t.start_at)}</span>
        <span class="ev-name">${escapeHtml(t.tournament_name)}</span>
        <a class="ev-link" href="${escapeHtml(ttoUrl)}" target="_blank" rel="noopener" title="${i18n('seed.upcoming.t1')}" aria-label="${i18n('seed.upcoming.t1')}">↗</a>
      </div>
      <div class="row-2">
        ${cityHtml}${onlineHtml}
        <span>${(t.events || []).length} event</span>
      </div>
      <div class="upcoming-events"></div>
    `;
    row.addEventListener('click', (ev) => {
      // start.gg リンクアイコンは通常リンク動作 (= 新規タブで開く)
      if (/** @type {Element} */ (ev.target).closest('.ev-link')) return;
      // event 行クリックは個別 handler が処理 (stopPropagation)
      handleUpcomingItemClick(t, row);
    });
    list.appendChild(row);
  }
  list.style.display = '';
  pager.style.display = totalPages > 1 ? '' : 'none';
  const pageInfo = document.getElementById('upcoming-pageinfo');
  if (pageInfo) pageInfo.textContent = `${S.UPCOMING_PAGE + 1} / ${totalPages}`;
  const prevBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('upcoming-prev'));
  if (prevBtn) prevBtn.disabled = S.UPCOMING_PAGE === 0;
  const nextBtn = /** @type {HTMLButtonElement | null} */ (document.getElementById('upcoming-next'));
  if (nextBtn) nextBtn.disabled = S.UPCOMING_PAGE >= totalPages - 1;
}

/** @param {SpspUpcomingTournament} tournament @param {HTMLElement} rowEl */
function handleUpcomingItemClick(tournament, rowEl) {
  const events = tournament.events || [];
  if (events.length === 0) return;
  if (events.length === 1) {
    // 単独 event → URL 入力 + 自動取得
    const url = buildEventUrl(tournament.tournament_slug, events[0].event_slug);
    fillEventUrlAndFetch(url);
    return;
  }
  // 複数 event → inline 展開 (= toggle)
  const wrap = rowEl.querySelector('.upcoming-events');
  if (!wrap) return;
  if (rowEl.classList.contains('expanded')) {
    rowEl.classList.remove('expanded');
    return;
  }
  // ほかの展開を閉じる
  document.querySelectorAll('.upcoming-item.expanded').forEach(it => {
    if (it !== rowEl) it.classList.remove('expanded');
  });
  wrap.innerHTML = renderEventChoicesHtml(events);
  // bind clicks
  wrap.querySelectorAll('.upcoming-event-row').forEach((er, idx) => {
    er.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const e = events[idx];
      const url = buildEventUrl(tournament.tournament_slug, e.event_slug);
      fillEventUrlAndFetch(url);
    });
  });
  rowEl.classList.add('expanded');
}

/** @param {SpspUpcomingEvent[]} events @returns {string} */
function renderEventChoicesHtml(events) {
  return events.map(e => {
    const name = escapeHtml(e.event_name || e.name || '');
    const entrants = e.num_entrants != null ? e.num_entrants : (e.numEntrants || 0);
    return `<div class="upcoming-event-row">
      <span class="ev-event-name">${name}</span>
      <span class="ev-event-entrants">${entrants} ${i18n('seed.upcoming.t2')}</span>
    </div>`;
  }).join('');
}

/** @param {string} url */
function fillEventUrlAndFetch(url) {
  const inp = /** @type {HTMLInputElement | null} */ (document.getElementById('event-url'));
  if (!inp) return;
  inp.value = url;
  // Hide any prior event-picker
  const ep = document.getElementById('event-picker');
  if (ep) ep.style.display = 'none';
  // Trigger fetch
  handleFetch();
  // Scroll user to the table for feedback
  const status = document.getElementById('status');
  if (status) status.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 現在時刻以降の大会だけカウント (= 過去大会を除外).
function countUpcomingFuture() {
  const nowSec = Math.floor(Date.now() / 1000);
  return (/** @type {Partial<SpspUpcomingData>} */ (S.UPCOMING_DATA || {}).tournaments || []).filter(t => {
    const st = Number(t.start_at);
    return Number.isFinite(st) && st >= nowSec;
  }).length;
}

export async function openUpcomingBox() {
  const box = document.getElementById('upcoming-box');
  if (!box) return;
  box.classList.add('open');
  const loading = document.getElementById('upcoming-loading');
  const list = document.getElementById('upcoming-list');
  const countBadge = document.getElementById('upcoming-count');
  if (!loading || !list || !countBadge) return;
  if (S.UPCOMING_DATA) {
    loading.style.display = 'none';
    renderUpcomingPage();
    countBadge.textContent = String(countUpcomingFuture());
    countBadge.style.display = '';
    return;
  }
  loading.style.display = '';
  list.style.display = 'none';
  try {
    await loadUpcomingData();
    loading.style.display = 'none';
    const n = countUpcomingFuture();
    countBadge.textContent = String(n);
    countBadge.style.display = '';
    if (n === 0) {
      loading.textContent = i18n('seed.upcoming.s8');
      loading.style.display = '';
      return;
    }
    renderUpcomingPage();
  } catch (e) {
    loading.innerHTML = `<span style="color:#dc2626">${i18n('seed.upcoming.fetch_failed')}${escapeHtml(/** @type {any} */ (e).message)}</span>`;
  }
}

export function toggleUpcomingBox() {
  const box = document.getElementById('upcoming-box');
  if (!box) return;
  if (box.classList.contains('open')) {
    box.classList.remove('open');
  } else {
    openUpcomingBox();
  }
}

// ── event-picker (= handleFetch 複数 event 警告の inline UI) ─────
// 上記 renderEventChoicesHtml を再利用.
/** @param {string} tournamentSlug @param {{ name?: string, numEntrants?: number, slug: string }[]} events */
export function showEventPickerInline(tournamentSlug, events) {
  const ep = document.getElementById('event-picker');
  const listEl = document.getElementById('event-picker-list');
  if (!ep || !listEl) return;
  listEl.innerHTML = renderEventChoicesHtml(events.map(e => ({
    event_name: e.name, num_entrants: e.numEntrants, event_slug: e.slug,
  })));
  // CSS は #event-picker { display: none } なので '' (= unset) だと CSS が効いて非表示のまま.
  // 'block' で override する.
  ep.style.display = 'block';
  // bind clicks
  Array.from(listEl.querySelectorAll('.upcoming-event-row')).forEach((er, idx) => {
    er.addEventListener('click', () => {
      const e = events[idx];
      const url = buildEventUrl(tournamentSlug, e.slug);
      fillEventUrlAndFetch(url);
    });
  });
  ep.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
