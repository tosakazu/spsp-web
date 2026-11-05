'use strict';
// ログインの引き継ぎ (site/js/login.js、2026-11-05): 始めた画面 (localStorage に乱数 s) が戻ってきたら Worker に s で取りに行き、
// 取れたらセッションと start.gg のトークンを保存して読み直す。始めるときは SHA-256(s) を begin_login に渡す。
const test = require('node:test');
const assert = require('node:assert');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }
const read = (p) => require('../helpers/built.cjs').built(p);

const WINS = [];
test.after(() => { for (const w of WINS) w.close(); });   // 待ちの setInterval を止める
function page(opts) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://spsp.games/jp/report/?c=abc', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  WINS.push(w);
  if (!w.crypto || !w.crypto.subtle) Object.defineProperty(w, 'crypto', { value: require('node:crypto').webcrypto });
  if (!w.TextEncoder) w.TextEncoder = TextEncoder;
  const calls = [];
  w.fetch = (url, init) => {
    const b = JSON.parse(init.body);
    calls.push(b);
    return Promise.resolve({ json: () => Promise.resolve(opts.reply(b)) });
  };
  let reloaded = 0;
  w.eval('window.__reload = 0; window.__assign = function (u) { window.__assigned = u; };');
  if (opts.pending) w.localStorage.setItem('spsp_login_handoff', JSON.stringify(opts.pending));
  w.eval(read('js/post_config.js'));
  w.SPSP_POST_CONFIG.GAS_ENDPOINT = 'https://spsp.games/api';
  w.SPSP_POST_CONFIG.CANONICAL_ORIGIN = 'https://spsp.games';
  w.SPSP_POST_CONFIG.CLIENT_ID = 'cid';
  w.eval(read('js/oauth_state.js'));
  w.eval(read('js/auth.js'));
  // location.reload / assign は jsdom で使えないので差し替えて数える
  const src = read('js/login.js').replace(/location\.reload\(\)/g, '(window.__reload++)').replace(/location\.assign\(/g, 'window.__assign(');
  w.eval(src);
  return { w, calls, reloads: () => w.__reload };
}
const tick = () => new Promise((r) => setTimeout(r, 30));

test('始めた画面に戻ってきたら s で取りに行き、取れたらログインして読み直す (start.gg のトークンも)', { skip: !JSDOM }, async () => {
  const r = page({
    pending: { s: 'S'.repeat(43), t: Date.now() - 60000 },
    reply: (b) => (b.action === 'login_handoff' ? { ok: true, token: 'tok', user: { id: 42, slug: 'u', gamerTag: 'P' }, exp: Date.now() + 1e6, startgg: { access_token: 'AT', expires_in: 3600, refresh_token: 'RT' } } : { ok: false }),
  });
  await tick();
  assert.deepStrictEqual(r.calls.map((c) => [c.action, c.s]), [['login_handoff', 'S'.repeat(43)]]);
  assert.strictEqual(JSON.parse(r.w.localStorage.getItem('spsp_session_v1')).token, 'tok');
  const id = JSON.parse(r.w.localStorage.getItem('spsp_startgg_identity'));
  assert.deepStrictEqual([id.token, id.refresh, id.uid], ['AT', 'RT', '42']);
  assert.strictEqual(r.w.localStorage.getItem('spsp_login_handoff'), null, '取ったら消す');
  assert.strictEqual(r.reloads(), 1);
});

test('まだ無いときは何もしない・期限 (45 分) を過ぎた分は取りに行かずに消す・何も無ければ呼ばない', { skip: !JSDOM }, async () => {
  const a = page({ pending: { s: 'S'.repeat(43), t: Date.now() }, reply: () => ({ ok: true, pending: true }) });
  await tick();
  assert.strictEqual(a.calls.length, 1);
  assert.strictEqual(a.w.localStorage.getItem('spsp_session_v1'), null);
  assert.ok(a.w.localStorage.getItem('spsp_login_handoff'), '残して待つ');
  assert.strictEqual(a.reloads(), 0);
  const b = page({ pending: { s: 'S'.repeat(43), t: Date.now() - 46 * 60000 }, reply: () => ({ ok: true }) });
  await tick();
  assert.strictEqual(b.calls.length, 0);
  assert.strictEqual(b.w.localStorage.getItem('spsp_login_handoff'), null);
  const c = page({ reply: () => ({ ok: true }) });
  await tick();
  assert.strictEqual(c.calls.length, 0);
});

test('ログインを始めるとき: s を置き、SHA-256(s) (base64url 43 文字) を begin_login に渡す', { skip: !JSDOM }, async () => {
  const r = page({ reply: (b) => (b.action === 'begin_login' ? { ok: true, state: 'st.sig' } : { ok: true, pending: true }) });
  await r.w.SpspLogin.startLogin('/jp/report/?c=abc');
  const begin = r.calls.find((c) => c.action === 'begin_login');
  assert.match(begin.handoff_h, /^[A-Za-z0-9_-]{43}$/);
  const s = JSON.parse(r.w.localStorage.getItem('spsp_login_handoff')).s;
  const h = require('node:crypto').createHash('sha256').update(s).digest('base64url');
  assert.strictEqual(begin.handoff_h, h, 'ハッシュは Worker (login.ts handoffHash) と同じ形');
  assert.ok(!JSON.stringify(begin).includes(s), 's そのものは送らない');
});
