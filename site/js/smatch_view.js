// @ts-check
// smatch_view.js — プレイヤーページに出すスマッチ (オンラインのレート対戦サイト) のレート (2026-11-15)。
//   データは card_get の smatch (worker/src/api/smatch.ts の SmatchView): { url, name, season, as_of (秒), modes: { '1on1'?: {...}, tokuoma?: {...} } }
//   1 つのルール = { rate, rank, season_max, max } (どれも null のことがある。「最高レートを見せない」人は season_max・max が null)
//   renderSmatch(el, view) el = <a> (リンク先はスマッチのユーザーページ)。出すものが無ければ隠す
import { escapeHtml } from './html.js';
import SPSPI18n from './i18n.js';

const MODES = ['1on1', 'tokuoma'];
const num = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** スマッチのページだけ (応答が書き換えられても別の所へは飛ばさない) @param {any} u */
export const smatchUrlOk = u => typeof u === 'string' && /^https:\/\/smatch-jp\.com\//.test(u);

/** @param {any} view @returns {string} 中身の HTML (出すものが無ければ '') */
export function smatchHtml(view) {
  const t = SPSPI18n.t;
  if (!view || !smatchUrlOk(view.url) || !view.modes) return '';
  const cells = [];
  for (const m of MODES) {
    const s = view.modes[m];
    if (!s) continue;
    const rate = num(s.rate), rank = num(s.rank), smax = num(s.season_max), max = num(s.max);
    if (rate === null && max === null && smax === null) continue;
    const meta = [];
    if (rate === null) meta.push(t('smatch.no_rate'));
    if (smax !== null) meta.push(t('smatch.season_max', { n: smax }));
    if (max !== null) meta.push(t('smatch.max', { n: max }));
    cells.push(`<span class="sm-mode"><span class="sm-label">${escapeHtml(t('smatch.mode.' + m))}</span>` +
      `<span class="sm-rate">${rate === null ? '—' : rate}${rank !== null ? `<small>${escapeHtml(t('smatch.rank', { n: rank }))}</small>` : ''}</span>` +
      (meta.length ? `<span class="sm-meta">${escapeHtml(meta.join(' ・ '))}</span>` : '') + '</span>');
  }
  if (!cells.length) return '';
  const d = num(view.as_of) ? new Date(view.as_of * 1000 + 9 * 3600e3) : null;   // 日本時間の日付
  const date = d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '';
  const sub = [view.season ? String(view.season) : '', date ? t('smatch.as_of', { date }) : ''].filter(Boolean).join(' ・ ');
  return `<span class="sm-head"><span class="sm-title">${escapeHtml(t('smatch.title'))}</span><span class="sm-sub">${escapeHtml(sub)}</span>` +
    '<svg class="sm-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg></span>' +
    `<span class="sm-modes">${cells.join('')}</span>`;
}

/** @param {HTMLElement | null} el @param {any} view */
export function renderSmatch(el, view) {
  if (!el) return;
  const html = smatchHtml(view);
  if (!html) { el.hidden = true; el.innerHTML = ''; return; }
  el.innerHTML = html;
  /** @type {HTMLAnchorElement} */ (el).href = view.url;
  el.setAttribute('aria-label', SPSPI18n.t('smatch.open'));
  el.hidden = false;
}

const API = { renderSmatch, smatchHtml, smatchUrlOk };
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspSmatchView = API;
export default API;
