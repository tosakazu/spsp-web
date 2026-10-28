// @ts-check
// startgg_identity.js — 普段のログイン (scope user.identity) で手に入る start.gg のトークン。ブラウザ (localStorage) にだけ置く。
//   ログイン (callback.js) のたびに Worker が交換したトークンと refresh token を save する。期限 (start.gg の expires_in、7 日) が
//   近づいたら Worker (action startgg_refresh、client secret が要る) で延長する。サーバには保存しない。
//   使い道: プレイヤーページの参加中の大会を start.gg から直接読み直す (js/live_fetch.js)。読むのは公開データだけ。
//   2026-10-28 より前にログインした人はトークンを持っていない (当時は捨てていた) → この機能を使う所でだけ再ログインを案内する。
//   save(r, uid) / load() / clear()
//   token()   使えるトークン (期限が近ければ延長する) か null。ログインしている人と違う人のトークンなら消して null
//   status()  'on' (使える) | 'relogin' (ログインしているがトークンが無い) | 'login' (ログインしていない)
import SpspLogin from './login.js';

export const KEY = 'spsp_startgg_identity';
const DEFAULT_TTL_MS = 7 * 24 * 3600 * 1000;   // start.gg が expires_in を返さないときの見込み
const REFRESH_BEFORE_MS = 24 * 3600 * 1000;    // 期限の 1 日前から延長する
/** @typedef {{ token: string, exp: number, refresh: string | null, uid: string }} IdentityToken */

/** @returns {IdentityToken | null} */
export function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    return o && typeof o.token === 'string' && o.token && typeof o.exp === 'number' ? o : null;
  } catch (e) { return null; }
}
/** @param {{ access_token?: string, expires_in?: number | null, refresh_token?: string | null } | null | undefined} r @param {string | number} uid */
export function save(r, uid) {
  if (!r || !r.access_token) return false;
  const ttl = Number(r.expires_in) > 0 ? Number(r.expires_in) * 1000 : DEFAULT_TTL_MS;
  /** @type {IdentityToken} */
  const o = { token: r.access_token, exp: Date.now() + ttl, refresh: r.refresh_token || null, uid: String(uid) };
  try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
}
export function clear() { try { localStorage.removeItem(KEY); } catch (e) { /* 何もしない */ } }

/** @type {Promise<string | null> | null} */
let refreshing = null;
/** @returns {Promise<string | null>} */
export async function token() {
  const sess = SpspLogin.session();
  const o = load();
  if (!sess || !o) return null;
  if (o.uid !== String(sess.user.id)) { clear(); return null; }   // 別の人のログインの名残
  if (o.exp - REFRESH_BEFORE_MS > Date.now()) return o.token;
  if (!o.refresh || !SpspLogin.apiAvailable()) return o.exp > Date.now() ? o.token : null;
  if (!refreshing) {
    refreshing = (async () => {
      const r = await SpspLogin.api({ action: 'startgg_refresh', refresh_token: o.refresh });
      if (r && r.ok && r.access_token) { save(r, o.uid); return r.access_token; }
      if (r && r.ok === false && r.error && r.error.code === 'auth_failed' && o.exp <= Date.now()) clear();   // 延長できず期限切れ → 再ログイン
      return o.exp > Date.now() ? o.token : null;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** @returns {'on' | 'relogin' | 'login'} */
export function status() {
  const sess = SpspLogin.session();
  if (!sess) return 'login';
  const o = load();
  return o && o.uid === String(sess.user.id) && (o.exp > Date.now() || o.refresh) ? 'on' : 'relogin';
}

const api = { KEY, load, save, clear, token, status };
export default api;
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspStartggIdentity = api;
