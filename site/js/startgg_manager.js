// @ts-check
// startgg_manager.js — 大会運営用の start.gg ログイン。シード作成・下位クラス作成で API キーの代わりに使う (どちらでも選べる)。
//   普段のログイン (login.js、scope user.identity) と違い、scope に tournament.manager (自分が管理する大会のシード・トーナメント設定) を
//   足して認可してもらい、Worker (action manager_login) が交換した start.gg のアクセストークンをこのブラウザに置く。サーバには保存しない。
//   load()            保存しているログイン ({ token, exp, user }) か null (期限切れは消して null)
//   token()           使うアクセストークン (無ければ '')
//   start(returnPath) start.gg の許可画面へ (戻ると callback.js が save して元のページに戻る)。始められなかったら false
//   save(o) / clear() 保存・解除 (解除は start.gg 側の許可までは消さない)
//   mount(opts)       API キー欄の上に「start.gg でログインして使う」を出す。ログイン中は API キー欄を隠す
import SpspOAuthState from './oauth_state.js';
import SpspLogin from './login.js';
import SPSPI18n from './i18n.js';

export const KEY = 'spsp_startgg_manager';
/** 期限の少し前で切れたことにする (ページを使っている途中で切れにくくする) */
const MARGIN_MS = 10 * 60 * 1000;
/** start.gg が expires_in を返さなかったときの見込み (説明では 7 日) */
const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;

/** @typedef {{ token: string, exp: number, user: { id: string, slug: string, gamerTag: string } | null }} ManagerLogin */

/** @returns {ManagerLogin | null} */
export function load() {
  /** @type {any} */
  let o = null;
  try { o = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  if (!o || typeof o.token !== 'string' || !o.token || typeof o.exp !== 'number') return null;
  if (o.exp - MARGIN_MS <= Date.now()) { clear(); return null; }
  return o;
}

export function token() { const o = load(); return o ? o.token : ''; }

/** @param {{ access_token: string, expires_in?: number | null, user?: any }} r manager_login の応答 */
export function save(r) {
  const ttl = Number(r.expires_in) > 0 ? Number(r.expires_in) * 1000 : DEFAULT_TTL_MS;
  const o = { token: r.access_token, exp: Date.now() + ttl, user: r.user || null };
  try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
}

export function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* 何もしない */ } }

/** @param {string} [returnPath] */
export async function start(returnPath) {
  if (!SpspLogin.apiAvailable()) return false;
  let nonce;
  try { nonce = crypto.randomUUID(); } catch (e) { return false; }
  SpspOAuthState.saveNonce(nonce);
  try { sessionStorage.setItem(SpspOAuthState.INTENT_KEY, 'manager'); } catch (e) { /* 署名 state 側で判断できる */ }
  const r = await SpspLogin.api({ action: 'manager_begin', nonce, returnPath: returnPath || (location.pathname + location.search) });
  if (!r || !r.ok || !r.url) return false;
  location.assign(r.url);
  return true;
}

/**
 * API キー欄の上にログインの欄を出す。ログイン中は keyBlock を隠す (解除すると戻る)。
 * API が無い配信 (ConoHa のプレビューなど) では何も出さない (API キーだけで使う)。
 * @param {{ before: HTMLElement, keyBlock: HTMLElement, onChange?: () => void, beforeLogin?: () => void }} opts
 *   beforeLogin = start.gg に移る直前 (入力中の内容を保存するなど)
 */
export function mount(opts) {
  if (!SpspLogin.apiAvailable()) return;
  /** @param {string} k @param {Record<string, string>} [p] */
  const i18n = (k, p) => SPSPI18n.t(k, p);
  const box = document.createElement('div');
  box.className = 'sgg-mgr';
  opts.before.parentNode?.insertBefore(box, opts.before);

  const render = () => {
    const o = load();
    box.textContent = '';
    opts.keyBlock.hidden = !!o;
    if (o) {
      const s = document.createElement('span');
      s.className = 'sgg-mgr-state';
      const d = new Date(o.exp);
      s.textContent = i18n('sggmgr.logged_in', { name: (o.user && o.user.gamerTag) || '?', date: (d.getMonth() + 1) + '/' + d.getDate() });
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sgg-mgr-btn sgg-mgr-off';
      b.textContent = i18n('sggmgr.use_key');
      b.addEventListener('click', () => { clear(); render(); if (opts.onChange) opts.onChange(); });
      box.append(s, b);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sgg-mgr-btn';
      b.textContent = i18n('sggmgr.login');
      b.addEventListener('click', async () => {
        b.disabled = true;
        if (opts.beforeLogin) opts.beforeLogin();
        if (!(await start())) { b.disabled = false; s.textContent = i18n('sggmgr.start_failed'); }
      });
      const s = document.createElement('span');
      s.className = 'sgg-mgr-note';
      s.textContent = i18n('sggmgr.or_key');
      box.append(b, s);
    }
  };
  render();
  window.addEventListener('storage', e => { if (e.key === KEY) { render(); if (opts.onChange) opts.onChange(); } });
}

const API = { KEY, load, token, save, clear, start, mount };
if (typeof window !== 'undefined') (/** @type {any} */ (window).SPSP = /** @type {any} */ (window).SPSP || {}).StartggManager = API;
export default API;
