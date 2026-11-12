// @ts-check
/**
 * トーナメントプレビューの短い URL (2026-11-05)。
 *   - 「🔗 短い URL」(ログイン必須): 今の共有 URL (# の後ろ) と、start.gg から読んだ構造 (読めていれば) を Worker に置き
 *     (bracket_share_create、保存期間 1 / 3 / 7 日、1 人 30 個まで)、/bracket/?s=<id> をコピーする
 *   - /bracket/?s=<id> を開いたら Worker から読み (bracket_share_get)、構造は sessionStorage に置いて (bracket_sgg.js がログインなしで使う)、# の付いた元の共有 URL に移る
 * API が使えないサイト (ConoHa のプレビュー等) では出さない。
 */
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SpspLogin from '../../site/js/login.js';
import { loginFromBracket } from './bracket_login_return.js';
import { SHARED_KEY } from './bracket_sgg.js';

const t = (k, v) => SPSPI18n.t(k, v);
const DAYS = [1, 3, 7];

/** ?s=<id> を開いたら元の共有 URL に移る。移るなら true */
async function openShort() {
  const id = new URLSearchParams(location.search).get('s');
  if (!id || location.hash.length > 1) return false;
  const st = document.getElementById('bp-status');
  if (st) st.textContent = t('bracket.share.opening');
  try {
    const r = await SpspLogin.api({ action: 'bracket_share_get', id });
    if (r && r.ok && typeof r.frag === 'string') {
      try {
        if (r.sgg) sessionStorage.setItem(SHARED_KEY, JSON.stringify({ frag: r.frag, sgg: r.sgg }));
        else sessionStorage.removeItem(SHARED_KEY);
      } catch (_) { /* 入らなければ開く人のログインで読む */ }
      const q = new URLSearchParams(location.search);
      q.delete('s');
      const qs = q.toString();
      location.replace(location.pathname + (qs ? '?' + qs : '') + '#' + r.frag);
      return true;
    }
    if (st) st.textContent = (r && r.error && r.error.message) || t('bracket.share.not_found');
  } catch (_) {
    if (st) st.textContent = t('bracket.share.not_found');
  }
  return false;
}

function mountButton() {
  const copy = document.getElementById('bp-copy-url');
  if (!copy || document.getElementById('bp-short-url')) return;
  const wrap = document.createElement('span');
  wrap.className = 'bp-short';
  wrap.innerHTML = `<button type="button" class="bp-btn" id="bp-short-url">${escapeHtml(t('bracket.share.btn'))}</button>
    <select id="bp-short-days" aria-label="${escapeHtml(t('bracket.share.days_label'))}">${DAYS.map((d) => `<option value="${d}"${d === 3 ? ' selected' : ''}>${escapeHtml(t('bracket.share.days', { n: d }))}</option>`).join('')}</select>
    <span class="bp-inline-status" id="bp-short-status"></span>`;
  copy.after(wrap);
  const btn = /** @type {HTMLButtonElement} */ (wrap.querySelector('#bp-short-url'));
  const sel = /** @type {HTMLSelectElement} */ (wrap.querySelector('#bp-short-days'));
  const out = /** @type {HTMLElement} */ (wrap.querySelector('#bp-short-status'));
  btn.addEventListener('click', async () => {
    const frag = location.hash.replace(/^#/, '');
    if (!frag) return;
    const sess = SpspLogin.session();
    if (!sess || !sess.token) {
      out.innerHTML = escapeHtml(t('bracket.share.need_login')) + ` <button type="button" class="bp-btn">${escapeHtml(t('bracket.sgg.login'))}</button>`;
      const lb = out.querySelector('button');
      if (lb) lb.addEventListener('click', async (e) => {
        const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
        b.disabled = true;
        if (!(await loginFromBracket())) {   // 始められなかった (通信の失敗など): 黙って何もしないのをやめて一言出す
          b.disabled = false;
          if (!b.nextElementSibling || !b.nextElementSibling.classList.contains('bp-login-err')) b.insertAdjacentHTML('afterend', ` <span class="bp-login-err" style="color:#dc2626">${escapeHtml(t('bracket.sgg.login_failed'))}</span>`);
        }
      });
      return;
    }
    btn.disabled = true;
    out.textContent = t('bracket.share.making');
    try {
      const W = /** @type {any} */ (window);
      const sgg = W.SPSP && W.SPSP.BracketSgg && W.SPSP.BracketSggData ? W.SPSP.BracketSggData : undefined;   // start.gg の組み合わせで出しているときだけ
      const r = await SpspLogin.api({ action: 'bracket_share_create', token: sess.token, frag, days: Number(sel.value), sgg });
      if (!r || !r.ok) { out.textContent = (r && r.error && r.error.message) || t('bracket.share.error'); return; }
      const url = location.origin + location.pathname + '?s=' + r.id;
      let copied = false;
      try { await navigator.clipboard.writeText(url); copied = true; } catch (_) { /* コピーできない環境 */ }
      const until = new Date(r.expires_ms).toLocaleString();
      out.innerHTML = `<input type="text" readonly value="${escapeHtml(url)}" size="${url.length}"> ${escapeHtml(copied ? t('bracket.share.copied', { t: until }) : t('bracket.share.made', { t: until }))}`;
      const inp = out.querySelector('input');
      if (inp) inp.addEventListener('focus', () => inp.select());
    } catch (e) {
      out.textContent = t('bracket.share.error');
    } finally { btn.disabled = false; }
  });
}

async function main() {
  if (!(SpspLogin.apiAvailable && SpspLogin.apiAvailable())) return;
  if (await openShort()) return;
  mountButton();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { main(); });
  else main();
}
