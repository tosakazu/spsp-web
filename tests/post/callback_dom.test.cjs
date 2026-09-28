'use strict';
// jsdom 実行時テスト: callback ページの実ソースを実 DOM 上で走らせ、
// 設計書 §5.2 の処理順と INV-6 / INV-7 を検証する。
// jsdom は /tmp/jsdom_inst に隔離インストール。NODE_PATH で解決。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }

const SITE = path.resolve(__dirname, '../../site');
const read = (p) => require('../helpers/built.cjs').built(p);   // 共通モジュールは古典 script の形で (tests/helpers/built.cjs)

const HTML = read('callback.html');
const SRC_I18N = ['region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js'].map(read).join('\n');   // 文言辞書
const SRC_CONFIG = read('js/post_config.js');
const SRC_STATE = read('js/oauth_state.js');
const SRC_AUTH = read('js/auth.js');
const SRC_CALLBACK = read('js/callback.js');

/**
 * callback ページを組み立てて走らせる。
 *
 * location は jsdom では replace() を差し替えられないので、実ソースを
 * `location` を引数に取る関数で包んで注入する (ソースは実物のまま)。
 * history.replaceState は本物を使うので INV-6 は実 URL で検証できる。
 */
async function run(opts) {
  const o = opts || {};
  const search = o.search === undefined ? '' : o.search;
  const url = 'https://tosakazu.github.io/spsp/callback.html' + search;

  // <script src> は自前で順に eval するので取り除く
  const html = HTML.replace(/<script src="[^"]*"><\/script>/g, '');
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;

  w.eval(SRC_I18N);
  w.eval(SRC_CONFIG);
  w.eval(SRC_STATE);
  w.eval(SRC_AUTH);
  if (o.config) Object.assign(w.SPSP_POST_CONFIG, o.config);

  if (o.session) {
    for (const k of Object.keys(o.session)) w.sessionStorage.setItem(k, o.session[k]);
  }

  const calls = { fetch: [], nav: [] };
  w.fetch = function (url2, init) {
    calls.fetch.push({ url: url2, init });
    if (o.fetchImpl) return o.fetchImpl(url2, init);
    return Promise.resolve({ json: () => Promise.resolve(o.response) });
  };

  const fakeLocation = {
    get search() { return w.location.search; },
    get pathname() { return w.location.pathname; },
    get origin() { return w.location.origin; },
    replace(u) { calls.nav.push(u); },
    assign(u) { calls.nav.push(u); },
  };
  w.__fakeLocation = fakeLocation;
  w.eval('(function (location) {\n' + SRC_CALLBACK + '\n})(window.__fakeLocation);');

  // fetch の then チェーンを 1 巡させる
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  return { w, calls, text: () => w.document.getElementById('cb-root').textContent };
}

const CONFIG = {
  CLIENT_ID: 'cid',
  GAS_ENDPOINT: 'https://script.google.com/macros/s/AAA/exec',
};
const NONCE = '3f7b2c1e-0000-4000-8000-abcdefabcdef';

/** 実物の encodeState で state を作る (発行側と検証側の食い違いを持ち込まない)。 */
const S = require(path.resolve(SITE, 'js/oauth_state.js'));
const stateFor = (r, n) => S.encodeState({ n: n || NONCE, r: r });

const SESSION = { spsp_oauth_nonce: NONCE, spsp_draft: '本文です' };

test('INV-6: 読み込み直後に URL から code が消える', { skip: !JSDOM }, async () => {
  const st = stateFor('/spsp/post.html');
  const r = await run({
    search: '?code=SECRET-CODE&state=' + encodeURIComponent(st),
    session: SESSION, config: CONFIG, response: { ok: true, user: 'user/x' },
  });
  assert.strictEqual(r.w.location.search, '');
  assert.ok(r.w.location.href.indexOf('SECRET-CODE') === -1, 'code が URL に残っている');
});

test('INV-6: 認証エラーで終わる場合も code は消えている', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=SECRET-CODE&state=' + encodeURIComponent(stateFor('/spsp/post.html', 'other')),
    session: SESSION, config: CONFIG,
  });
  assert.strictEqual(r.w.location.search, '');
  assert.ok(r.w.location.href.indexOf('SECRET-CODE') === -1);
});

/**
 * 「GAS に本題を送っていない」検査。
 * 失敗の記録 (action: client_error) は送ってよいが、code を伴う post / login は
 * 絶対に送ってはいけない (INV: state 検証を通らないうちは code を渡さない)。
 */
function assertNoCodeSent(r) {
  const bodies = r.calls.fetch.map((f) => {
    try { return JSON.parse(f.init.body); } catch (_) { return {}; }
  });
  for (const b of bodies) {
    assert.ok(b.action === 'client_error', '想定外の action を送っている: ' + b.action);
    assert.ok(!('code' in b), '記録に code を載せている');
  }
}

test('nonce 不一致なら GAS に送らない', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html', 'MISMATCH')),
    session: SESSION, config: CONFIG,
  });
  assertNoCodeSent(r);
  assert.match(r.text(), /認証エラー/);
});

// 2026-08-17 仕様変更: 保存領域に nonce が無くても止めない。
// アプリ内ブラウザ→通常ブラウザで戻る経路では引き継げないため、照合の本体を
// GAS 側の署名検証に移した。ここで止めると、その経路が永久に通らない。
test('nonce が残っていなくても GAS に送る (署名 state で検証するため)', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: { spsp_draft: '本文です' }, config: CONFIG, response: { ok: true, user: 'user/x' },
  });
  const bodies = r.calls.fetch.map((f) => JSON.parse(f.init.body));
  const sent = bodies.find((b) => b.action === 'post');
  assert.ok(sent, 'GAS に送っていない');
  assert.strictEqual(sent.code, 'C');
  assert.ok(sent.state, 'state を渡していない (GAS が検証できない)');
});

test('state が壊れていれば送らない', { skip: !JSDOM }, async () => {
  const r = await run({ search: '?code=C&state=%%%broken', session: SESSION, config: CONFIG });
  assertNoCodeSent(r);
});

test('code が無ければ送らない', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: SESSION, config: CONFIG,
  });
  assertNoCodeSent(r);
});

test('start.gg 側で拒否 (error=access_denied) は送らない', { skip: !JSDOM }, async () => {
  const r = await run({ search: '?error=access_denied', session: SESSION, config: CONFIG });
  assertNoCodeSent(r);
  assert.match(r.text(), /キャンセル/);
});

test('下書きが無ければ送らない', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: { spsp_oauth_nonce: NONCE }, config: CONFIG,
  });
  assertNoCodeSent(r);
  assert.match(r.text(), /下書き/);
});

test('設定がプレースホルダのままなら送らない', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: SESSION, config: { CLIENT_ID: '{{CLIENT_ID}}', GAS_ENDPOINT: '{{GAS_ENDPOINT}}' },
  });
  assertNoCodeSent(r);
  assert.match(r.text(), /設定/);
});

test('成功: GAS への POST 内容と、戻り先 + posted=1 への遷移', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=CODE-1&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: SESSION, config: CONFIG, response: { ok: true, user: 'user/x' },
  });

  assert.strictEqual(r.calls.fetch.length, 1);
  const f = r.calls.fetch[0];
  assert.strictEqual(f.url, CONFIG.GAS_ENDPOINT);
  assert.strictEqual(f.init.method, 'POST');
  assert.strictEqual(f.init.redirect, 'follow');
  // CORS preflight を起こさない Content-Type であること
  assert.match(f.init.headers['Content-Type'], /^text\/plain/);
  // state も一緒に送る (GAS 側が署名を検証する)
  const sentBody = JSON.parse(f.init.body);
  assert.strictEqual(sentBody.action, 'post');
  assert.strictEqual(sentBody.code, 'CODE-1');
  assert.strictEqual(sentBody.body, '本文です');
  assert.ok(sentBody.state, 'state を渡していない');

  assert.deepStrictEqual(r.calls.nav, ['/spsp/post.html?posted=1']);
  // 成功したら下書きと nonce は消える
  assert.strictEqual(r.w.sessionStorage.getItem('spsp_draft'), null);
  assert.strictEqual(r.w.sessionStorage.getItem('spsp_oauth_nonce'), null);
});

test('INV-7: 戻り先が外部 URL なら /spsp/index.html に落とす', { skip: !JSDOM }, async () => {
  for (const bad of ['https://evil.example/x', '//evil.example/x', '/spsp/../../x', '/other/x']) {
    const r = await run({
      search: '?code=C&state=' + encodeURIComponent(stateFor(bad)),
      session: SESSION, config: CONFIG, response: { ok: true, user: 'user/x' },
    });
    assert.deepStrictEqual(r.calls.nav, ['/spsp/index.html?posted=1'], 'for ' + bad);
  }
});

test('GAS がエラーを返したら遷移せず、下書きを残す', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: SESSION, config: CONFIG,
    response: { ok: false, error: { code: 'rate_limited', message: '投稿の間隔が短すぎます。' } },
  });
  assert.deepStrictEqual(r.calls.nav, []);
  assert.match(r.text(), /投稿の間隔が短すぎます/);
  assert.strictEqual(r.w.sessionStorage.getItem('spsp_draft'), '本文です');
});

test('通信失敗でも遷移せず、下書きを残す', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: SESSION, config: CONFIG,
    fetchImpl: () => Promise.reject(new Error('network')),
  });
  assert.deepStrictEqual(r.calls.nav, []);
  assert.match(r.text(), /通信に失敗/);
  assert.strictEqual(r.w.sessionStorage.getItem('spsp_draft'), '本文です');
});

test('エラー文言は textContent で入る (HTML として解釈されない)', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: SESSION, config: CONFIG,
    response: { ok: false, error: { code: 'internal', message: '<img src=x onerror=alert(1)>' } },
  });
  const root = r.w.document.getElementById('cb-root');
  assert.strictEqual(root.querySelectorAll('img').length, 0);
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
});

// ── login フロー (intent = 'login') ──

const LOGIN_SESSION = { spsp_oauth_nonce: NONCE, spsp_oauth_intent: 'login' };

test('login: action:login を送り、トークンを保存して ?login=1 で戻る', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=CODE-L&state=' + encodeURIComponent(stateFor('/spsp/vote.html')),
    session: LOGIN_SESSION, config: CONFIG,
    response: { ok: true, token: 'tok.sig', user: { id: 4242, slug: 'user/x', gamerTag: 'Toko' }, exp: Date.now() + 1000000 },
  });

  assert.strictEqual(r.calls.fetch.length, 1);
  const loginBody = JSON.parse(r.calls.fetch[0].init.body);
  assert.strictEqual(loginBody.action, 'login');
  assert.strictEqual(loginBody.code, 'CODE-L');
  assert.ok(loginBody.state, 'state を渡していない');
  assert.deepStrictEqual(r.calls.nav, ['/spsp/vote.html?login=1']);

  const saved = JSON.parse(r.w.localStorage.getItem('spsp_session_v1'));
  assert.strictEqual(saved.token, 'tok.sig');
  assert.strictEqual(saved.user.id, '4242');
  // intent と nonce は消える
  assert.strictEqual(r.w.sessionStorage.getItem('spsp_oauth_intent'), null);
  assert.strictEqual(r.w.sessionStorage.getItem('spsp_oauth_nonce'), null);
});

test('login: 下書きが無くても動く (post フローの要件を引きずらない)', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/vote.html')),
    session: LOGIN_SESSION, config: CONFIG,
    response: { ok: true, token: 't.s', user: { id: 1, slug: '', gamerTag: '' }, exp: Date.now() + 1000 },
  });
  assert.strictEqual(r.calls.fetch.length, 1);
  assert.deepStrictEqual(r.calls.nav, ['/spsp/vote.html?login=1']);
});

test('login: nonce 不一致なら GAS に送らない (post と同じ検証を通る)', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/vote.html', 'MISMATCH')),
    session: LOGIN_SESSION, config: CONFIG,
  });
  assertNoCodeSent(r);
});

test('login: INV-7 — 戻り先が外部なら index.html に落とす', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('https://evil.example/x')),
    session: LOGIN_SESSION, config: CONFIG,
    response: { ok: true, token: 't.s', user: { id: 1, slug: '', gamerTag: '' }, exp: Date.now() + 1000 },
  });
  assert.deepStrictEqual(r.calls.nav, ['/spsp/index.html?login=1']);
});

test('login: GAS がエラーを返したらトークンを保存しない', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/vote.html')),
    session: LOGIN_SESSION, config: CONFIG,
    response: { ok: false, error: { code: 'auth_failed', message: '認証に失敗しました。' } },
  });
  assert.deepStrictEqual(r.calls.nav, []);
  assert.strictEqual(r.w.localStorage.getItem('spsp_session_v1'), null);
  assert.match(r.text(), /認証に失敗しました/);
});

test('post フロー: intent=post が明示されていても従来どおり動く', { skip: !JSDOM }, async () => {
  const r = await run({
    search: '?code=C&state=' + encodeURIComponent(stateFor('/spsp/post.html')),
    session: { ...SESSION, spsp_oauth_intent: 'post' }, config: CONFIG,
    response: { ok: true, user: 'user/x' },
  });
  const b2 = JSON.parse(r.calls.fetch[0].init.body);
  assert.strictEqual(b2.action, 'post');
  assert.strictEqual(b2.code, 'C');
  assert.strictEqual(b2.body, '本文です');
  assert.ok(b2.state);
  assert.deepStrictEqual(r.calls.nav, ['/spsp/post.html?posted=1']);
});
