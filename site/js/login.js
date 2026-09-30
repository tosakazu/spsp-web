// @ts-check
// login.js — ログイン (start.gg 認証) の共通処理。ヘッダーのアカウントメニュー・キャラ投票・カードの編集で使う (docs/login_design.md)。
//   SPSP 側にアカウントは持たない: 名前などは start.gg のまま。セッションは Worker が署名したトークン (js/auth.js が localStorage に置く)。
//   session()        今のセッション ({ token, user: { id, slug, gamerTag }, exp }) か null
//   startLogin()     start.gg へ (戻り先 = 今のページ。戻ると ?login=1 が付く)
//   logout()         セッションを消す (サーバは状態を持たないので、ブラウザから消すだけ)
//   verify()         サーバでトークンを確かめ、無効 (期限切れ・鍵の入れ替え) なら消す。1 ページ 1 回
//   isSelf(uid)      ログインしている人がこの選手か (選手 ID = start.gg のユーザー ID)
//   onChange(fn)     ログイン状態が変わったら (別のタブの変化も)
//   apiAvailable()   このサイトで API (/api) が使えるか。spsp.games と preview の Worker だけ (ConoHa のプレビューには無い)
//   api(body)        POST /api (JSON)。失敗は { ok: false, error: { code } }
import SpspAuth from './auth.js';
import SpspOAuthState from './oauth_state.js';
import SPSP_POST_CONFIG from './post_config.js';

const CFG = SPSP_POST_CONFIG;
const S = SpspOAuthState;

export function session() { return SpspAuth.load(); }
export function apiAvailable() { return !!(CFG.GAS_ENDPOINT && S.isCanonicalOrigin(CFG, location.origin)); }

/** @param {Record<string, unknown>} body @returns {Promise<any>} */
export async function api(body) {
  try {
    const res = await fetch(CFG.GAS_ENDPOINT, {
      method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: { code: 'network' } };
  }
}

/** @type {Set<() => void>} */
const listeners = new Set();
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { /* 他の購読者は続ける */ } });
/** @param {() => void} fn */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === SpspAuth.KEY) notify(); });   // 別のタブでのログイン・ログアウト
}

export function logout() { SpspAuth.clear(); notify(); }

/** @param {number | string | null | undefined} uid */
export function isSelf(uid) {
  const s = session();
  return !!(s && uid != null && String(s.user.id) === String(uid));
}

/** 投票ページと同じ流れ: state はサーバに署名してもらい (ブラウザが変わっても検証できる)、start.gg の許可画面へ。
 * 始められなかったら false (ボタンを戻すため) */
export async function startLogin() {
  if (!apiAvailable()) return false;
  let nonce;
  try { nonce = crypto.randomUUID(); } catch (e) { return false; }
  S.saveNonce(nonce);
  try { sessionStorage.setItem(S.INTENT_KEY, 'login'); } catch (e) { /* 署名 state 側で判断できる */ }
  const json = await api({ action: 'begin_login', flow: 'login', nonce, returnPath: location.pathname + location.search });
  if (!json || !json.ok || !json.state) return false;
  location.assign(S.buildAuthorizeUrl(CFG, json.state));
  return true;
}

/** @type {Promise<void> | null} */
let verifying = null;
export function verify() {
  if (verifying) return verifying;
  verifying = (async () => {
    const s = session();
    if (!s || !apiAvailable()) return;
    const r = await api({ action: 'me', token: s.token });
    // 通信の失敗・まだ me が無いサーバ (unknown_action) では消さない。無効と言われたときだけ消す
    if (r && r.ok === false && r.error && r.error.code === 'invalid_session') logout();
  })();
  return verifying;
}

// ログインから戻ってきた印 (?login=1) はアドレスバーから消す (ページが先に読んで使う場合は、それより後で消える)
if (typeof location !== 'undefined' && typeof history !== 'undefined') {
  try {
    const u = new URL(location.href);
    if (u.searchParams.get('login') === '1' && !/\/vote(\.html)?$/.test(u.pathname)) {   // 投票ページは自分で消して表示を出す
      u.searchParams.delete('login');
      history.replaceState(history.state, '', u.pathname + (u.search || '') + u.hash);
    }
  } catch (e) { /* 何もしない */ }
}

const API = { session, startLogin, logout, verify, isSelf, onChange, apiAvailable, api };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むときは import がグローバル参照になるため)
if (typeof window !== 'undefined') {
  /** @type {any} */ (window).SpspLogin = API;
  (/** @type {any} */ (window).SPSP = /** @type {any} */ (window).SPSP || {}).Login = API;
}
export default API;
