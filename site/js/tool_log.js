// @ts-check
// tool_log.js — 大会運営ツールの使用記録を Worker (action tool_log、D1 tool_logs) に送る。
//   どの大会を、どのユーザーが、SPSP のどの機能 (シード作成 / シードアップロード / 下位クラス作成) で操作したか。
//   ユーザー: 「start.gg でログイン」なら SPSP のセッションを送る (Worker が本人と確かめる)。
//   「API キー」なら、そのキーで start.gg に currentUser を問い合わせたユーザー ID を申告する (Worker は確かめない)。
//   API キー・start.gg のトークンは送らない。記録に失敗しても操作には影響させない (例外を出さない)。
//   userFields(token)   送る人の欄 { auth, token?, user_id?, gamer_tag? }
//   logSeeding(token, e) シードを書き込んだあとに 1 件送る
import SpspAuth from './auth.js';
import SpspLogin from './login.js';
import SpspStartggManager from './startgg_manager.js';

/** @type {Map<string, Promise<{ id: string, gamerTag: string } | null>>} */
const ME = new Map();

/** start.gg のトークン (API キー) の持ち主。1 つのトークンにつき 1 回だけ問い合わせる @param {string} token */
export function startggMe(token) {
  let p = ME.get(token);
  if (!p) {
    p = fetch('https://api.start.gg/gql/alpha', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ query: 'query { currentUser { id player { gamerTag } } }' }),
    }).then(r => r.json()).then(j => {
      const u = j && j.data && j.data.currentUser;
      return u && u.id != null ? { id: String(u.id), gamerTag: String((u.player && u.player.gamerTag) || '') } : null;
    }).catch(() => null);
    ME.set(token, p);
  }
  return p;
}

/** @param {string} token start.gg に送っているトークン (API キーかログインのトークン)
 * @returns {Promise<{ auth: 'login' | 'key', token?: string, user_id?: string, gamer_tag?: string }>} */
export async function userFields(token) {
  if (SpspStartggManager.mode() === 'login') {
    const sess = SpspAuth.load();
    const mgr = SpspStartggManager.load();
    const u = (mgr && mgr.user) || (sess && sess.user) || null;
    return { auth: 'login', token: sess ? sess.token : undefined, user_id: u ? String(u.id) : undefined, gamer_tag: u ? u.gamerTag : undefined };
  }
  const me = token ? await startggMe(token) : null;
  return { auth: 'key', user_id: me ? me.id : undefined, gamer_tag: me ? me.gamerTag : undefined };
}

/**
 * @param {string} token
 * @param {{ tool: 'seed' | 'seed_upload', tournament_id?: unknown, tournament_slug?: string, tournament_name?: string,
 *   event_id?: unknown, event_name?: string, phase_id?: unknown, count?: number, detail?: Record<string, unknown> }} e
 */
export async function logSeeding(token, e) {
  try {
    if (!SpspLogin.apiAvailable()) return;
    const who = await userFields(token);
    await SpspLogin.api(Object.assign({ action: 'tool_log', op: 'seeding' }, e, who));
  } catch (ex) { /* 記録できなくてもシードの書き込みは済んでいる */ }
}

const API = { startggMe, userFields, logSeeding };
if (typeof window !== 'undefined') (/** @type {any} */ (window).SPSP = /** @type {any} */ (window).SPSP || {}).ToolLog = API;
export default API;
