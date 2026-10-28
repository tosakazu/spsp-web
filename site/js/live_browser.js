// @ts-check
// live_browser.js — 参加中の大会の速報を、ログインした人のブラウザが start.gg から直接読み直す (js/live.js の opts.browser)。
//   サーバの速報 (5 分ごと) とブラウザで更新したもの (localStorage にキャッシュ) のうち、updated_at の新しい方を使い、
//   そこから差分で更新する (js/live_fetch.js)。読んだものはサーバには送らない。
//   pick(doc)     サーバの doc とキャッシュの新しい方
//   refresh(doc)  start.gg から更新した doc (キャッシュにも置く)。トークンが無い・失敗したら null
//   status()      js/startgg_identity.js の status ('on' | 'relogin' | 'login')
import SpspLiveFetch from './live_fetch.js';
import SpspStartggIdentity from './startgg_identity.js';

const PREFIX = 'spsp_live_doc_';
const KEEP_SEC = 2 * 86400;   // これより古いキャッシュは消す

/** @param {string | number} eid @returns {any} */
function cached(eid) {
  try { return JSON.parse(localStorage.getItem(PREFIX + eid) || 'null'); } catch (e) { return null; }
}
/** @param {any} doc */
function store(doc) {
  try { localStorage.setItem(PREFIX + doc.event_id, JSON.stringify(doc)); } catch (e) { prune(true); }   // 入らなければ古いものを消す (次の回にまた試す)
}
/** 古いキャッシュを消す (all = 全部) @param {boolean} [all] */
function prune(all) {
  try {
    const now = Date.now() / 1000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || k.indexOf(PREFIX) !== 0) continue;
      const d = cached(k.slice(PREFIX.length));
      if (all || !d || !(d.updated_at > now - KEEP_SEC)) localStorage.removeItem(k);
    }
  } catch (e) { /* 何もしない */ }
}
prune();

/** @param {any} doc サーバの速報 @returns {any} */
export function pick(doc) {
  const c = doc ? cached(doc.event_id) : null;
  return c && c.v === doc.v && (c.updated_at || 0) > (doc.updated_at || 0) ? c : doc;
}

/** @param {any} doc @returns {Promise<any>} */
export async function refresh(doc) {
  if (!doc || doc.ended_at) return null;
  const tk = await SpspStartggIdentity.token();
  if (!tk) return null;
  try {
    const d = await SpspLiveFetch.refreshDoc(SpspLiveFetch.makeGql(tk), pick(doc), Math.floor(Date.now() / 1000));
    store(d);
    return d;
  } catch (e) {
    if (e && /** @type {any} */ (e).auth) SpspStartggIdentity.clear();   // トークンが使えない (取り消された等) → 再ログインの案内に戻す
    return null;
  }
}

export const status = () => SpspStartggIdentity.status();

const api = { pick, refresh, status };
export default api;
