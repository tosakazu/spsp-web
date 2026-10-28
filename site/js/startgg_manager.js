// @ts-check
// startgg_manager.js — 大会運営ツール (シード作成・シードアップロード・下位クラス作成) の start.gg の認証。
//   「start.gg でログイン」と「API キー」のどちらでも使える。ログインは普段のログイン (login.js、scope user.identity) と違い、
//   scope に tournament.manager (自分が管理する大会のシード・トーナメント設定) を足して認可してもらい、Worker (action manager_login) が
//   交換した start.gg のアクセストークンをこのブラウザ (localStorage) に置く。サーバには保存しない。
//   ログインも、どちらを使うか (mode) も localStorage なので 3 ページで共通 (どれかでログイン・ログアウトすると全部に効く。開いている別のタブにも)。
//   load()                 保存しているログイン ({ token, exp, user }) か null (期限切れは消して null)
//   mode() / setMode(m)    使う認証 'login' | 'key'
//   pick(keyValue)         start.gg に送るトークン: mode が login ならログインのトークン (無ければ '')、key なら keyValue
//   start(returnPath)      start.gg の許可画面へ (戻ると callback.js が save して元のページに戻る)。始められなかったら false
//   save(o) / logout()     保存・ログアウト (start.gg 側の許可までは消さない)
//   mount(opts)            認証の欄 (切り替え + ログイン状態 / API キー欄) を作る
import SpspOAuthState from './oauth_state.js';
import SpspLogin from './login.js';
import SPSPI18n from './i18n.js';

export const KEY = 'spsp_startgg_manager';
const MODE_KEY = 'spsp_startgg_auth_mode';
const API_KEY_KEY = 'spsp_startgg_token';   // API キーを 💾 で保存した場所 (シード作成・下位クラス作成で共通)
/** 期限の少し前で切れたことにする (ページを使っている途中で切れにくくする) */
const MARGIN_MS = 10 * 60 * 1000;
/** start.gg が expires_in を返さなかったときの見込み (説明では 7 日) */
const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;

/** @typedef {{ token: string, exp: number, user: { id: string, slug: string, gamerTag: string } | null }} ManagerLogin */
/** @typedef {'login' | 'key'} AuthMode */

/** @param {string} k */
function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

/** @returns {ManagerLogin | null} */
export function load() {
  /** @type {any} */
  let o = null;
  try { o = JSON.parse(lsGet(KEY) || 'null'); } catch (e) { return null; }
  if (!o || typeof o.token !== 'string' || !o.token || typeof o.exp !== 'number') return null;
  if (o.exp - MARGIN_MS <= Date.now()) { logout(); return null; }
  return o;
}

/** @param {{ access_token: string, expires_in?: number | null, user?: any }} r manager_login の応答 */
export function save(r) {
  const ttl = Number(r.expires_in) > 0 ? Number(r.expires_in) * 1000 : DEFAULT_TTL_MS;
  const o = { token: r.access_token, exp: Date.now() + ttl, user: r.user || null };
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
    localStorage.setItem(MODE_KEY, 'login');   // ログインしたらログインで使う
    return true;
  } catch (e) { return false; }
}

export function logout() { try { localStorage.removeItem(KEY); } catch (e) { /* 何もしない */ } }

/** 選んでいない人の既定: ログイン中ならログイン、API キーを保存していれば API キー、どちらも無ければログイン @returns {AuthMode} */
export function mode() {
  const m = lsGet(MODE_KEY);
  if (m === 'login' || m === 'key') return m;
  if (load()) return 'login';
  return lsGet(API_KEY_KEY) ? 'key' : 'login';
}

/** @param {AuthMode} m */
export function setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* このページの間だけ */ } }

/** @param {string} keyValue API キー欄の値 */
export function pick(keyValue) {
  if (mode() === 'key') return String(keyValue || '').trim();
  const o = load();
  return o ? o.token : '';
}

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
 * 認証の欄を root に作る:
 *   [ start.gg でログイン | API キー ]   ← 切り替え (API が無い配信 = ConoHa のプレビューなどでは出さず、API キーだけ)
 *   ログイン: 「● 名前 でログイン中 · 〇/〇 まで  [ログアウト]」/ 未ログインなら「[start.gg でログイン] 説明」
 *   API キー: keyBlock (ページの API キー欄) をそのまま中に入れる
 * @param {{ root: HTMLElement, keyBlock: HTMLElement, onChange?: () => void, beforeLogin?: () => void }} opts
 *   onChange = 使うトークンが変わった (切り替え・ログイン・ログアウト。別のタブでの変化も)。beforeLogin = start.gg に移る直前 (入力の保存など)
 */
export function mount(opts) {
  /** @param {string} k @param {Record<string, string>} [p] */
  const i18n = (k, p) => SPSPI18n.t(k, p);
  const root = opts.root;
  root.classList.add('sgg-auth');
  if (!SpspLogin.apiAvailable()) { root.appendChild(opts.keyBlock); return; }

  root.innerHTML = `<div class="sgg-auth-head">
      <span class="sgg-auth-title"></span>
      <div class="sgg-seg" role="tablist">
        <button type="button" role="tab" data-m="login"></button><button type="button" role="tab" data-m="key"></button>
      </div>
    </div>
    <div class="sgg-auth-login"></div>
    <div class="sgg-auth-key"></div>`;
  const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (root.querySelector(s));
  q('.sgg-auth-title').textContent = i18n('sggmgr.title');
  q('[data-m="login"]').textContent = i18n('sggmgr.tab_login');
  q('[data-m="key"]').textContent = i18n('sggmgr.tab_key');
  const loginPane = q('.sgg-auth-login'), keyPane = q('.sgg-auth-key');
  keyPane.appendChild(opts.keyBlock);
  opts.keyBlock.hidden = false;
  const changed = () => { render(); if (opts.onChange) opts.onChange(); };

  const render = () => {
    const m = mode(), o = load();
    for (const b of /** @type {NodeListOf<HTMLButtonElement>} */ (root.querySelectorAll('.sgg-seg button'))) {
      const on = b.dataset.m === m;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    loginPane.hidden = m !== 'login';
    keyPane.hidden = m !== 'key';
    loginPane.textContent = '';
    if (o) {
      const d = new Date(o.exp);
      const s = document.createElement('span');
      s.className = 'sgg-auth-state';
      const name = document.createElement('b');
      name.textContent = (o.user && o.user.gamerTag) || '?';
      const until = document.createElement('span');
      until.className = 'sgg-auth-muted';
      until.textContent = i18n('sggmgr.until', { date: (d.getMonth() + 1) + '/' + d.getDate() });
      s.append(name, i18n('sggmgr.logged_in_suffix'), until);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sgg-auth-btn sub';
      b.textContent = i18n('sggmgr.logout');
      b.addEventListener('click', () => { logout(); changed(); });
      loginPane.append(s, b);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sgg-auth-btn';
      b.textContent = i18n('sggmgr.login');
      const note = document.createElement('span');
      note.className = 'sgg-auth-muted';
      note.textContent = i18n('sggmgr.login_note');
      b.addEventListener('click', async () => {
        b.disabled = true;
        if (opts.beforeLogin) opts.beforeLogin();
        if (!(await start())) { b.disabled = false; note.textContent = i18n('sggmgr.start_failed'); }
      });
      loginPane.append(b, note);
    }
  };
  root.querySelector('.sgg-seg')?.addEventListener('click', (e) => {
    const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('button[data-m]'));
    if (!b || b.dataset.m === mode()) return;
    setMode(b.dataset.m === 'key' ? 'key' : 'login');
    changed();
  });
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === MODE_KEY || e.key === null) changed(); });
  render();
}

const API = { KEY, load, save, logout, mode, setMode, pick, start, mount };
if (typeof window !== 'undefined') (/** @type {any} */ (window).SPSP = /** @type {any} */ (window).SPSP || {}).StartggManager = API;
export default API;
