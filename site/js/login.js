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
//   openEdit()       preview の Worker だけ true: カードの編集をログインなしで誰の分でもできる (サーバも CARD_OPEN_EDIT=1 の preview だけ受ける)
import SpspAuth from './auth.js';
import SpspOAuthState from './oauth_state.js';
import SPSP_POST_CONFIG from './post_config.js';

const CFG = SPSP_POST_CONFIG;
const S = SpspOAuthState;

export function session() { return SpspAuth.load(); }
export function apiAvailable() { return !!(CFG.GAS_ENDPOINT && S.isCanonicalOrigin(CFG, location.origin)); }
/** preview の Worker (spsp-web-preview.*.workers.dev) か。見た目の確認用に、カードを誰でも編集できる */
export function openEdit() { return apiAvailable() && /^spsp-web-preview\./.test(location.hostname); }

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

// ログアウトでは start.gg のトークン (js/startgg_identity.js の KEY。import すると循環するので名前で消す) も消す
export function logout() {
  SpspAuth.clear();
  try { localStorage.removeItem('spsp_startgg_identity'); } catch (e) { /* 何もしない */ }
  notify();
}

/** @param {number | string | null | undefined} uid */
export function isSelf(uid) {
  const s = session();
  return !!(s && uid != null && String(s.user.id) === String(uid));
}

/** 投票ページと同じ流れ: state はサーバに署名してもらい (ブラウザが変わっても検証できる)、start.gg の許可画面へ。
 * 始められなかったら false (ボタンを戻すため) */
/** @param {string} [returnPath] 戻り先 (既定 = 今のページ)。callback の「もう一度ログイン」は元のページを渡す */
export async function startLogin(returnPath) {
  if (!apiAvailable()) return false;
  let nonce;
  try { nonce = crypto.randomUUID(); } catch (e) { return false; }
  S.saveNonce(nonce);
  try { sessionStorage.setItem(S.INTENT_KEY, 'login'); } catch (e) { /* 署名 state 側で判断できる */ }
  const handoff_h = await newHandoff().catch(() => null);   // 別のブラウザで戻ってきたときの引き継ぎ (下)
  const json = await api({ action: 'begin_login', flow: 'login', nonce, returnPath: returnPath || (location.pathname + location.search), ...(handoff_h ? { handoff_h } : {}) });
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

// ── ログインの引き継ぎ (2026-11-05) ──
// iPhone のアプリ内ブラウザ (Discord などの SFSafariViewController) でログインを始めると、start.gg アプリを経て Safari 本体で
// 戻ってくることがある。保存領域が別なので、始めた画面は未ログインのまま (2 回ログインすることになっていた)。
// 始めるときに乱数 s を作ってここ (localStorage) に置き、SHA-256(s) を署名つき state に入れてもらう。別のブラウザで戻ってきたら
// Worker が結果を暗号化して置く (15 分・1 回だけ)。この画面に戻ってきたとき (読み込み・表示・数秒おき) に s で取りに行く。
export const HANDOFF_KEY = 'spsp_login_handoff';
const HANDOFF_MAX_MS = 45 * 60 * 1000;   // state の有効期間 30 分 + Worker が置いておく 15 分
const HANDOFF_POLL_MS = 5000;
const IDENTITY_KEY = 'spsp_startgg_identity';   // js/startgg_identity.js の KEY (import すると循環する)
/** @param {Uint8Array} b */
const b64url = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/** @returns {Promise<string | null>} 引き継ぎのハッシュ (state に入れる) */
async function newHandoff() {
  if (!crypto || !crypto.subtle) return null;
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const s = b64url(raw);
  const h = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
  localStorage.setItem(HANDOFF_KEY, JSON.stringify({ s, t: Date.now() }));
  startHandoffWatch();
  return h;
}
let handoffBusy = false;
/** @type {any} */
let handoffTimer = 0;
function stopHandoffWatch() { clearInterval(handoffTimer); handoffTimer = 0; }
/** 置いてある引き継ぎを取りに行く。取れたらログインして読み直す */
export async function claimHandoff() {
  if (handoffBusy) return false;
  /** @type {{ s?: unknown, t?: unknown } | null} */
  let o = null;
  try { o = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null'); } catch (e) { o = null; }
  if (!o || typeof o.s !== 'string' || typeof o.t !== 'number') { stopHandoffWatch(); return false; }
  if (Date.now() - o.t > HANDOFF_MAX_MS) { try { localStorage.removeItem(HANDOFF_KEY); } catch (e) { /* 何もしない */ } stopHandoffWatch(); return false; }
  if (!apiAvailable()) return false;
  handoffBusy = true;
  try {
    const r = await api({ action: 'login_handoff', s: o.s });
    if (!r || !r.ok || !r.token || !r.user) return false;
    try { localStorage.removeItem(HANDOFF_KEY); } catch (e) { /* 何もしない */ }
    stopHandoffWatch();
    SpspAuth.save({ token: r.token, user: r.user, exp: r.exp });
    // start.gg のトークン (startgg_identity.js の save と同じ形)
    const sg = r.startgg;
    if (sg && sg.access_token) {
      const ttl = Number(sg.expires_in) > 0 ? Number(sg.expires_in) * 1000 : 7 * 24 * 3600 * 1000;
      try { localStorage.setItem(IDENTITY_KEY, JSON.stringify({ token: sg.access_token, exp: Date.now() + ttl, refresh: sg.refresh_token || null, uid: String(r.user.id) })); } catch (e) { /* 何もしない */ }
    }
    notify();
    location.reload();
    return true;
  } finally { handoffBusy = false; }
}
function startHandoffWatch() {
  if (handoffTimer || typeof document === 'undefined') return;
  handoffTimer = setInterval(() => { if (document.visibilityState === 'visible') claimHandoff(); }, HANDOFF_POLL_MS);
}
if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
  let pending = false;
  try { pending = !!localStorage.getItem(HANDOFF_KEY); } catch (e) { pending = false; }
  // callback ページ自身は取りに行かない (そこで完了する / 別のブラウザの結果を置く側)
  if (pending && !/\/callback(\.html)?$/.test(location.pathname)) {
    claimHandoff();
    startHandoffWatch();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') claimHandoff(); });
    window.addEventListener('focus', () => { claimHandoff(); });
  }
}

const API = { session, startLogin, logout, verify, isSelf, onChange, apiAvailable, openEdit, api, claimHandoff, HANDOFF_KEY };
// ほかの共通モジュールと同じく window にも置く (テストが古典 script の形で読むときは import がグローバル参照になるため)
if (typeof window !== 'undefined') {
  /** @type {any} */ (window).SpspLogin = API;
  (/** @type {any} */ (window).SPSP = /** @type {any} */ (window).SPSP || {}).Login = API;
}
export default API;
