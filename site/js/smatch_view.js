// @ts-check
// smatch_view.js — プレイヤーページに出すスマッチ (オンラインのレート対戦サイト) のレート (2026-11-15)。
//   データは card_get の smatch (worker/src/api/smatch.ts の SmatchView): { url, name, season, as_of (秒), modes: { '1on1'?: {...}, tokuoma?: {...} } }
//   1 つのルール = { rate, rank, season_max, max } (どれも null のことがある。「最高レートを見せない」人は season_max・max が null)
//   renderSmatch(section, view) section = 実績の上の欄 (#smatch-section)。見出し + ルールごとに 1 行 (行ごとスマッチのユーザーページへのリンク)。出すものが無ければ欄ごと隠す
import { escapeHtml } from './html.js';
import SPSPI18n from './i18n.js';

const MODES = ['1on1', 'tokuoma'];
const num = (/** @type {any} */ v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** スマッチのページだけ (応答が書き換えられても別の所へは飛ばさない) @param {any} u */
export const smatchUrlOk = u => typeof u === 'string' && /^https:\/\/smatch-jp\.com\//.test(u);

/** 実績の上の欄の中身。見出し (シーズン・日付つき) + 1 つのルール = 1 行 (最高レートも同じ行)、行ごとスマッチのユーザーページへのリンク
 *  @param {any} view @returns {string} 欄の中身の HTML (出すものが無ければ '') */
export function smatchHtml(view) {
  const t = SPSPI18n.t;
  if (!view || !smatchUrlOk(view.url) || !view.modes) return '';
  const d = num(view.as_of) ? new Date(view.as_of * 1000 + 9 * 3600e3) : null;   // 日本時間の日付
  const date = d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : '';
  const sub = [view.season ? String(view.season) : '', date ? t('smatch.as_of', { date }) : ''].filter(Boolean).join(' ・ ');
  const rows = [];
  for (const m of MODES) {
    const s = view.modes[m];
    if (!s) continue;
    const rate = num(s.rate), rank = num(s.rank), smax = num(s.season_max), max = num(s.max);
    if (rate === null && max === null && smax === null) continue;
    const meta = [];
    if (rate === null) meta.push(t('smatch.no_rate'));
    if (smax !== null) meta.push(t('smatch.season_max', { n: smax }));
    if (max !== null) meta.push(t('smatch.max', { n: max }));
    rows.push(`<a class="stat-row smatch-line" href="${escapeHtml(view.url)}" target="_blank" rel="noopener" aria-label="${escapeHtml(t('smatch.open'))}">` +
      `<span>${escapeHtml(t('smatch.mode.' + m))}` +
        '<svg class="sm-go" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7"></path><path d="M8 7h9v9"></path></svg></span>' +
      '<span class="sm-val">' +
        `<span class="v">${rate === null ? '—' : rate}</span>${rank !== null ? `<span class="sm-rank">${escapeHtml(t('smatch.rank', { n: rank }))}</span>` : ''}` +
        (meta.length ? `<span class="sm-meta">${escapeHtml(meta.join(' ・ '))}</span>` : '') +
      '</span></a>');
  }
  if (!rows.length) return '';
  return `<h2>${escapeHtml(t('smatch.heading'))}${sub ? ` <span class="lr-date">${escapeHtml(sub)}</span>` : ''}</h2>` + rows.join('');
}

/** @param {HTMLElement | null} section 実績の上の欄 (#smatch-section) @param {any} view */
export function renderSmatch(section, view) {
  if (!section) return;
  const html = smatchHtml(view);
  section.innerHTML = html;
  section.hidden = !html;
}

const API = { renderSmatch, smatchHtml, smatchUrlOk };
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspSmatchView = API;
export default API;
