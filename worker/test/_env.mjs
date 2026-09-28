// テスト環境 (tests/post/_gas_env.cjs の Worker 版)。
//   opts.token     : token 交換の応答 { status, body } / null で例外 (network)
//   opts.user      : currentUser の応答 { status, body }
//   opts.player    : players/<uid>.json の応答 (既定 200 + characters 空)
//   opts.charEmoji : char_emoji.json の応答 (既定 200 + 2 キャラ)
//   opts.cfg       : Config の上書き (clientSecret: null で未設定にする等)
//   opts.voteRows / opts.postRows : 初期行
import { dispatch, handleApiRequest } from '../src/api/router.ts';
import { SESSION_TTL_MS_DEFAULT, STATE_TTL_MS_DEFAULT } from '../src/config.ts';
import { MemStore } from './_mem_store.mjs';

export const SECRET = 'SECRET-DO-NOT-LEAK';

export const OK_TOKEN = { status: 200, body: { access_token: 'AT-secret', token_type: 'Bearer' } };
export const OK_USER = {
  status: 200,
  body: { data: { currentUser: { id: 4242, slug: 'user/abcd1234', player: { gamerTag: 'Toko' } } } },
};
const CHAR_EMOJI_DEFAULT = {
  status: 200,
  body: { 1305: { name: 'ロックマン', emoji: '🤖' }, 1271: { name: 'ベヨネッタ', emoji: '🦋' } },
};
const PLAYER_DEFAULT = { status: 200, body: { user_id: 4242, characters: [] } };

/** JST の ISO 8601 / yyyy-MM-dd。 */
export function jst(ms, dateOnly) {
  const iso = new Date(ms + 9 * 3600 * 1000).toISOString();
  return dateOnly ? iso.slice(0, 10) : iso.slice(0, 19) + '+09:00';
}

/** votes の 1 行 [timestamp, user_id, user_slug, gamer_tag, char_id, char_name, status] → 行オブジェクト。 */
export function voteRow(arr) {
  const [ts, uid, slug, tag, cid, cname, status] = arr;
  return { ts: String(ts), ts_ms: Date.parse(String(ts)), user_id: String(uid), user_slug: String(slug || ''),
    gamer_tag: String(tag || ''), char_id: String(cid === undefined || cid === null ? '' : cid), char_name: String(cname || ''), status: String(status || '') };
}
export function postRow(arr) {
  const [ts, uid, slug, tag, body, status] = arr;
  return { ts: String(ts), ts_ms: Date.parse(String(ts)), user_id: String(uid), user_slug: String(slug || ''),
    gamer_tag: String(tag || ''), body: String(body || ''), status: String(status || '') };
}

function resp(spec) {
  const body = typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body);
  return new Response(body, { status: spec.status, headers: { 'Content-Type': 'application/json' } });
}

export function makeEnv(opts) {
  const o = opts || {};
  const store = new MemStore();
  if (o.voteRows) store.votes = o.voteRows.map(voteRow);
  if (o.postRows) store.posts = o.postRows.map(postRow);
  const fetches = [];
  const cfg = {
    clientId: 'test-client-id',
    redirectUri: 'https://tosakazu.github.io/spsp/callback.html',
    clientSecret: SECRET,
    sessionSecret: 'session-secret-' + Math.random().toString(36).slice(2),
    exportKey: undefined,
    sessionTtlMs: SESSION_TTL_MS_DEFAULT,
    stateTtlMs: STATE_TTL_MS_DEFAULT,
    tsOffsetMin: 540,
    ...(o.cfg || {}),
  };
  for (const k of Object.keys(cfg)) if (cfg[k] === null) cfg[k] = undefined;
  const env = {
    cfg, store, fetches,
    nowMs: null,   // 固定したいときに入れる
  };
  env.ctx = {
    cfg, store,
    fetch: async (url, init) => {
      fetches.push({ url, init });
      let spec;
      if (url.indexOf('/oauth/') !== -1) spec = o.token;
      else if (url.indexOf('/gql/') !== -1) spec = o.user;
      if (spec === undefined || spec === null) throw new Error('network');
      return resp(spec);
    },
    dataFetch: async (path) => {
      fetches.push({ url: 'data:' + path });
      let spec;
      if (path.indexOf('/players/') !== -1) spec = (o.player === undefined ? PLAYER_DEFAULT : o.player);
      else if (path.indexOf('char_emoji.json') !== -1) spec = (o.charEmoji === undefined ? CHAR_EMOJI_DEFAULT : o.charEmoji);
      if (spec === undefined || spec === null) throw new Error('network');
      return resp(spec);
    },
    now: () => (env.nowMs === null ? Date.now() : env.nowMs),
  };
  return env;
}

/** dispatch を生のまま呼ぶ (state を自動で足さない)。 */
export function rawPost(env, body) {
  return dispatch(env.ctx, body);
}

/** 署名済み state を 1 つ発行する。 */
export async function beginState(env, nonce, returnPath) {
  const res = await rawPost(env, {
    action: 'begin_login', nonce: nonce || 'N', returnPath: returnPath || '/spsp/vote.html',
  });
  if (!res.ok) throw new Error('begin_login failed: ' + JSON.stringify(res));
  return res.state;
}

/** login / post は署名 state が必須なので、明示指定が無ければ有効なものを補う。 */
export async function post(env, body) {
  let b = body;
  if ((b.action === 'login' || b.action === 'post') && !('state' in b)) {
    b = Object.assign({}, b, { state: await beginState(env) });
  }
  return rawPost(env, b);
}

/** login して有効なセッショントークンを得る。 */
export async function loginToken(env) {
  const res = await post(env, { action: 'login', code: 'CODE-login' });
  if (!res.ok) throw new Error('login failed in helper: ' + JSON.stringify(res));
  return res.token;
}

/** HTTP 経由 (handleApiRequest)。 */
export async function http(env, method, path, body, headers) {
  const init = { method, headers: headers || {} };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['Content-Type'] = 'text/plain;charset=utf-8';
  }
  const res = await handleApiRequest(env.ctx, new Request('https://spsp.games' + path, init));
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not json */ }
  return { status: res.status, headers: res.headers, text, json };
}

export function b64urlJson(s) {
  return JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));
}
