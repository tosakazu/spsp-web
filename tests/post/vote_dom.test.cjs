'use strict';
// jsdom 実行時テスト: キャラ投票ページの実ソースを実 DOM 上で走らせる。
// フロー: 選手選択 → 可否の事前確認 → 認証 → 一致確認 → 投票。
// location の差し替え手法は callback_dom.test.cjs と同じ。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }

const SITE = path.resolve(__dirname, '../../site');
const read = (p) => require('../helpers/built.cjs').built(p);   // 共通モジュールは古典 script の形で (tests/helpers/built.cjs)

const HTML = read('vote.html');
const SRC_HTML = read('js/html.js');     // サイト共通 (escapeHtml)
const SRC_I18N = ['region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js'].map(read).join('\n');   // 文言辞書
const SRC_DATA = read('js/data.js');     // サイト共通 (parseJsonl)
const SRC_PLAYER_DATA = read('js/player_data.js');   // 分割された選手 JSON の組み立て (players/ + players_current.json)
const SRC_CONFIG = read('js/post_config.js');
const SRC_STATE = read('js/oauth_state.js');
const SRC_AUTH = read('js/auth.js');
const SRC_FN = read('js/fighter_number.js');
const SRC_VOTE = read('js/vote.js');

const S = require(path.resolve(SITE, 'js/oauth_state.js'));

const CONFIG = {
  CLIENT_ID: 'cid-123',
  GAS_ENDPOINT: 'https://script.google.com/macros/s/AAA/exec',
};

const SESSION = {
  token: 'tok.sig',
  user: { id: '4242', slug: 'user/x', gamerTag: 'Toko' },
  exp: Date.now() + 3600 * 1000,
};

const CHAR_EMOJI = { 1305: { name: 'ロックマン', emoji: '🤖' }, 1271: { name: 'ベヨネッタ', emoji: '🦋' } };

// 検索インデックス (latest_tjpr_full.jsonl のスタブ)
const JSONL = [
  { user_id: 4242, display: 'TK | Toko', ranks: { ensemble: 10 } },
  { user_id: 1787719, display: 'ZETA | あcola', ranks: { ensemble: 1 } },
  { user_id: 5555, display: 'Tokoroten', ranks: { ensemble: null } },
].map((r) => JSON.stringify(r)).join('\n');

/**
 * ページを組み立てて走らせる。
 *   o.session   : localStorage に置くセッション
 *   o.sel       : sessionStorage に置く認証前の選択 (spsp_vote_sel)
 *   o.playerByUid : uid → {status, json} (既定: 200 + characters 空)
 *   o.gas       : GAS の応答 (JSON)
 */
async function mount(o) {
  o = o || {};
  const url = o.url || 'https://tosakazu.github.io/spsp/vote.html' + (o.search || '');
  const html = HTML.replace(/<script src="[^"]*"><\/script>/g, '');
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  const w = dom.window;

  await new Promise((r) => setTimeout(r, 0));

  w.eval(SRC_HTML);
  w.eval(SRC_I18N);
  w.eval(SRC_DATA);
  w.eval(SRC_PLAYER_DATA);
  w.eval(SRC_CONFIG);
  w.eval(SRC_STATE);
  w.eval(SRC_AUTH);
  w.eval(SRC_FN);
  if (o.config !== null) Object.assign(w.SPSP_POST_CONFIG, o.config || CONFIG);
  if (o.session) w.localStorage.setItem('spsp_session_v1', JSON.stringify(o.session));
  if (o.sel) w.sessionStorage.setItem('spsp_vote_sel', JSON.stringify(o.sel));

  const calls = { fetch: [], nav: [] };
  w.fetch = function (u, init) {
    calls.fetch.push({ url: u, init });
    if (u.indexOf('latest_tjpr_full.jsonl') !== -1) {
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(o.jsonl || JSONL) });
    }
    if (u.indexOf('players_current.json') === 0) {
      // 揮発部分 (順位等) は投票の判定に要らないので空で返す
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ eval_date: '2026-09-06', eval_ts: 0, columns: [], players: {} }) });
    }
    if (u.indexOf('players/') === 0) {
      const uid = decodeURIComponent(u.slice('players/'.length).replace('.json', ''));
      const p = (o.playerByUid && o.playerByUid[uid]) || { status: 200, json: { characters: [] } };
      return Promise.resolve({
        ok: p.status === 200, status: p.status,
        json: () => Promise.resolve(p.json),
      });
    }
    if (u.indexOf('data/char_emoji.json') === 0) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(CHAR_EMOJI) });
    }
    // GAS
    var req = {};
    try { req = JSON.parse(init.body); } catch (_) { /* noop */ }
    if (req.action === 'begin_login') {
      // 認証開始は署名 state をもらってから飛ぶ (2026-08-17)。署名は作れないので形だけ。
      const payload = Buffer.from(JSON.stringify({ n: req.nonce, r: req.returnPath, t: Date.now() }))
        .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const res = (o.beginLogin === undefined) ? { ok: true, state: payload + '.SIG' } : o.beginLogin;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(res) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o.gas) });
  };

  w.__fakeLocation = {
    get search() { return w.location.search; },
    get pathname() { return w.location.pathname; },
    get origin() { return w.location.origin; },
    assign(u) { calls.nav.push(u); },
    replace(u) { calls.nav.push(u); },
  };
  w.eval('(function (location) {\n' + SRC_VOTE + '\n})(window.__fakeLocation);');

  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));

  const $ = (id) => w.document.getElementById(id);
  const helpers = {
    w, calls, $,
    status: () => $('vt-status').textContent,
    async settle(n) { for (let i = 0; i < (n || 4); i++) await new Promise((r) => setTimeout(r, 0)); },
    async search(q) {
      $('vt-search').value = q;
      $('vt-search').dispatchEvent(new w.Event('input', { bubbles: true }));
      await helpers.settle();
    },
    async clickResult(i) {
      const btns = $('vt-results').querySelectorAll('button');
      btns[i || 0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await helpers.settle();
    },
    async pickChar(cid) {
      const btn = Array.from($('vt-char-grid').querySelectorAll('button'))
        .find((b) => b.dataset.id === String(cid));
      if (!btn) throw new Error('char button not found: ' + cid);
      btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await helpers.settle();
    },
    gridIds() {
      return Array.from($('vt-char-grid').querySelectorAll('button')).map((b) => b.dataset.id);
    },
    async click(id) {
      $(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
      await helpers.settle();
    },
  };
  return helpers;
}

// ── 未ログイン: 選択が先 ──

test('未ログイン: 選手検索の区画から始まり、認証ボタンは出ない', { skip: !JSDOM }, async () => {
  const p = await mount();
  assert.strictEqual(p.$('vt-select').hidden, false);
  assert.strictEqual(p.$('vt-auth').hidden, true);
  assert.strictEqual(p.$('vt-form').hidden, true);
  assert.strictEqual(p.$('vt-who').hidden, true);
  // インデックスを読みに行く
  assert.ok(p.calls.fetch.some((f) => f.url.indexOf('latest_tjpr_full.jsonl') !== -1));
});

test('検索: 部分一致で候補が出て、ens 順に並ぶ', { skip: !JSDOM }, async () => {
  const p = await mount();
  await p.search('toko');
  const rows = Array.from(p.$('vt-results').querySelectorAll('button'));
  assert.deepStrictEqual(rows.map((b) => b.querySelector('.nm').textContent), ['TK | Toko', 'Tokoroten']);
  assert.strictEqual(rows[0].querySelector('.rank').textContent, '10位');
  assert.strictEqual(rows[1].querySelector('.rank'), null); // unranked にはチップ無し
});

test('選択 → 資格あり: 認証ボタンが出る (この時点では認証不要)', { skip: !JSDOM }, async () => {
  const p = await mount();
  await p.search('toko');
  await p.clickResult(0); // TK | Toko (uid 4242)
  assert.strictEqual(p.$('vt-auth').hidden, false);
  assert.match(p.$('vt-auth-msg').textContent, /「TK \| Toko」はキャラ投票の対象です/);
  assert.ok(p.calls.fetch.some((f) => f.url === 'players/4242.json'));
});

test('選択 → キャラ情報あり: 認証に進ませず理由を明示、選び直せる', { skip: !JSDOM }, async () => {
  const p = await mount({
    playerByUid: { 4242: { status: 200, json: { characters: [{ id: 1305, name: 'ロックマン', pct: 1 }] } } },
  });
  await p.search('toko');
  await p.clickResult(0);
  assert.strictEqual(p.$('vt-ineligible').hidden, false);
  assert.strictEqual(p.$('vt-auth').hidden, true);
  assert.match(p.$('vt-inel-title').textContent, /「TK \| Toko」はメインキャラが明確なため投票できません/);
  assert.match(p.$('vt-inel-detail').textContent, /ロックマン/);
  assert.strictEqual(p.$('vt-back-btn').hidden, false);

  await p.click('vt-back-btn');
  assert.strictEqual(p.$('vt-select').hidden, false);
});

test('認証開始: 選択を退避し、nonce と intent=login を置いて認可 URL へ', { skip: !JSDOM }, async () => {
  const p = await mount();
  await p.search('toko');
  await p.clickResult(0);
  await p.click('vt-login-btn');

  assert.strictEqual(p.w.sessionStorage.getItem('spsp_oauth_intent'), 'login');
  assert.deepStrictEqual(JSON.parse(p.w.sessionStorage.getItem('spsp_vote_sel')),
    { uid: '4242', display: 'TK | Toko' });
  const nonce = p.w.sessionStorage.getItem('spsp_oauth_nonce');
  assert.match(nonce, /^[0-9a-f-]{36}$/);
  assert.strictEqual(p.calls.nav.length, 1);
  const u = new URL(p.calls.nav[0]);
  assert.strictEqual(u.origin + u.pathname, 'https://start.gg/oauth/authorize');
  const st = S.decodeState(u.searchParams.get('state'));
  assert.strictEqual(st.n, nonce);
  assert.strictEqual(st.r, '/spsp/vote.html');
});

test('正規の配信元でなければ認可を始めない', { skip: !JSDOM }, async () => {
  const p = await mount({ url: 'https://spsp.games/vote.html' });
  await p.search('toko');
  await p.clickResult(0);
  await p.click('vt-login-btn');
  assert.deepStrictEqual(p.calls.nav, []);
  assert.strictEqual(p.$('vt-canonical').hidden, false);
});

// ── 認証から戻ったあと ──

test('認証後: 選択と一致していれば投票フォームへ', { skip: !JSDOM }, async () => {
  const p = await mount({
    session: SESSION, search: '?login=1',
    sel: { uid: '4242', display: 'TK | Toko' },
  });
  assert.strictEqual(p.$('vt-form').hidden, false);
  assert.strictEqual(p.$('vt-who').hidden, false);
  assert.strictEqual(p.$('vt-who-name').textContent, 'Toko');
  // 退避した選択は消費される
  assert.strictEqual(p.w.sessionStorage.getItem('spsp_vote_sel'), null);
  const names = Array.from(p.$('vt-char-grid').querySelectorAll('.nm')).map((n) => n.textContent);
  assert.ok(names.indexOf('ロックマン') !== -1);
});

test('認証後: 選択と別人で認証したら明示して止める', { skip: !JSDOM }, async () => {
  const p = await mount({
    session: SESSION, search: '?login=1',
    sel: { uid: '1787719', display: 'ZETA | あcola' },
  });
  assert.strictEqual(p.$('vt-ineligible').hidden, false);
  assert.strictEqual(p.$('vt-form').hidden, true);
  assert.match(p.$('vt-inel-title').textContent, /一致しません/);
  assert.match(p.$('vt-inel-detail').textContent, /ZETA \| あcola/);
  assert.match(p.$('vt-inel-detail').textContent, /Toko/);
  // 投票は送らない (別人に投票させない)。記録用の client_error だけは送ってよい。
  const gas = p.calls.fetch.filter((f) => f.url === CONFIG.GAS_ENDPOINT)
    .map((f) => JSON.parse(f.init.body));
  assert.ok(!gas.some((b) => b.action === 'vote'), '投票を送ってしまっている');
  const rep = gas.find((b) => b.action === 'client_error');
  assert.ok(rep, '不一致を記録していない (原因が追えなくなる)');
  assert.strictEqual(rep.kind, 'account_mismatch');
  // 記録に個人名やキャラは載せない
  assert.doesNotMatch(JSON.stringify(rep), /あcola|Toko/);
});

// ── ログイン済みで来た場合 (選択スキップ) ──

test('ログイン済 + 資格あり: 選択を飛ばしてフォームへ', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION });
  assert.strictEqual(p.$('vt-form').hidden, false);
  assert.strictEqual(p.$('vt-select').hidden, true);
  // 検索インデックスは読まない (15MB を無駄に落とさない)
  assert.ok(!p.calls.fetch.some((f) => f.url.indexOf('latest_tjpr_full.jsonl') !== -1));
});

test('ログイン済 + SPSPにデータなし: 理由を明示 (選び直しは出さない)', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION, playerByUid: { 4242: { status: 404, json: null } } });
  assert.strictEqual(p.$('vt-ineligible').hidden, false);
  assert.match(p.$('vt-inel-title').textContent, /SPSP にデータがある選手のみ/);
  assert.strictEqual(p.$('vt-back-btn').hidden, true);
});

test('ログイン済 + キャラあり: 現在の登録キャラも表示', { skip: !JSDOM }, async () => {
  const p = await mount({
    session: SESSION,
    playerByUid: { 4242: { status: 200, json: { characters: [{ id: 1305, name: 'ロックマン', pct: 1 }] } } },
  });
  assert.strictEqual(p.$('vt-ineligible').hidden, false);
  assert.match(p.$('vt-inel-title').textContent, /メインキャラが明確なため投票できません/);
  assert.match(p.$('vt-inel-detail').textContent, /ロックマン/);
});

// ── 投票 ──

test('投票: token と charId を GAS に送り、完了表示になる', { skip: !JSDOM }, async () => {
  const p = await mount({
    session: SESSION,
    gas: { ok: true, user: 'user/x', charId: '1305', charName: 'ロックマン' },
  });
  await p.pickChar('1305');
  await p.click('vt-vote-btn');

  const gasCall = p.calls.fetch.find((f) => f.url === CONFIG.GAS_ENDPOINT);
  assert.ok(gasCall, 'GAS に送っていない');
  assert.match(gasCall.init.headers['Content-Type'], /^text\/plain/);
  assert.deepStrictEqual(JSON.parse(gasCall.init.body),
    { action: 'vote', token: 'tok.sig', charId: '1305' });
  assert.match(p.status(), /ロックマン で投票を受け付けました/);
  // 反映まで待つ旨を必ず出す。無いと「反映されない」と思って投票し直す人が出る。
  assert.match(p.status(), /最大3時間後/);
  assert.match(p.status(), /投票し直す必要はありません/);
});

test('投票: キャラ未選択なら GAS に送らない', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION });
  await p.click('vt-vote-btn');
  assert.ok(!p.calls.fetch.some((f) => f.url === CONFIG.GAS_ENDPOINT));
  assert.match(p.status(), /キャラを選択/);
});

test('投票: auth_failed ならセッションを破棄して選択からやり直し', { skip: !JSDOM }, async () => {
  const p = await mount({
    session: SESSION,
    gas: { ok: false, error: { code: 'auth_failed', message: 'ログインが無効です。' } },
  });
  await p.pickChar('1305');
  await p.click('vt-vote-btn');

  assert.strictEqual(p.w.localStorage.getItem('spsp_session_v1'), null);
  assert.strictEqual(p.$('vt-select').hidden, false);
  assert.match(p.status(), /ログインが無効/);
});

// ── その他 ──

test('期限切れセッションは未ログイン扱い (選択から)', { skip: !JSDOM }, async () => {
  const p = await mount({ session: { ...SESSION, exp: Date.now() - 1000 } });
  assert.strictEqual(p.$('vt-select').hidden, false);
  assert.strictEqual(p.w.localStorage.getItem('spsp_session_v1'), null);
});

test('?login=1 で戻ると完了メッセージが出てクエリが消える', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION, search: '?login=1' });
  assert.match(p.status(), /認証が完了/);
  assert.strictEqual(p.w.location.search, '');
});

test('ログアウトでセッションが消えて選択区画に戻る', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION });
  await p.click('vt-logout-btn');
  assert.strictEqual(p.w.localStorage.getItem('spsp_session_v1'), null);
  assert.strictEqual(p.$('vt-select').hidden, false);
});

// ── ダブルメイン圏 ──

const DOUBLE_PLAYER = {
  status: 200,
  json: { user_id: 4242, characters: [
    { id: 1305, name: 'ロックマン', pct: 0.52 },
    { id: 1271, name: 'ベヨネッタ', pct: 0.45 },
    { id: 1273, name: 'クッパ', pct: 0.03 },
  ] },
};

test('double: 選択時に「僅差」の案内が出て認証に進める', { skip: !JSDOM }, async () => {
  const p = await mount({ playerByUid: { 4242: DOUBLE_PLAYER } });
  await p.search('toko');
  await p.clickResult(0);
  assert.strictEqual(p.$('vt-auth').hidden, false);
  assert.match(p.$('vt-auth-msg').textContent, /「ロックマン」「ベヨネッタ」のメインキャラ判定が僅差/);
});

test('double: ログイン後のフォームは候補だけが選択肢になる', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION, playerByUid: { 4242: DOUBLE_PLAYER } });
  assert.strictEqual(p.$('vt-form').hidden, false);
  assert.match(p.$('vt-form-hint').textContent, /僅差/);
  assert.deepStrictEqual(p.gridIds().sort(), ['1271', '1305']); // クッパ (1273) は出ない
});

test('double: 明確なメインなら従来どおり対象外', { skip: !JSDOM }, async () => {
  const p = await mount({
    session: SESSION,
    playerByUid: { 4242: { status: 200, json: { characters: [
      { id: 1305, name: 'ロックマン', pct: 0.9 },
      { id: 1271, name: 'ベヨネッタ', pct: 0.1 },
    ] } } },
  });
  assert.strictEqual(p.$('vt-ineligible').hidden, false);
  assert.match(p.$('vt-inel-title').textContent, /メインキャラが明確/);
});

test('キャラ情報が無い人のフォームはヒント無しで全キャラが出る', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION }); // 既定 = characters 空
  assert.strictEqual(p.$('vt-form').hidden, false);
  assert.strictEqual(p.$('vt-form-hint').hidden, true);
  assert.deepStrictEqual(p.gridIds().sort(), ['1271', '1305']); // スタブの全キャラ
});

test('グリッド: 選択でハイライトが付き、選び直すと移る', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION });
  await p.pickChar('1305');
  await p.pickChar('1271');
  const sel = Array.from(p.$('vt-char-grid').querySelectorAll('.sel'));
  assert.strictEqual(sel.length, 1);
  assert.strictEqual(sel[0].dataset.id, '1271');
});

// ── キャラの並び順と自由入力 ──

test('キャラはファイター番号順 (ロックマン44 → ベヨネッタ58)', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION });
  // 名前順だと ベヨネッタ が先になるが、番号順なので ロックマン が先
  assert.deepStrictEqual(p.gridIds(), ['1305', '1271']);
});

test('自由入力: 部分一致でグリッドが絞れる (ひらがなでも)', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION });
  p.$('vt-char-search').value = 'ろっく';
  p.$('vt-char-search').dispatchEvent(new p.w.Event('input', { bubbles: true }));
  await p.settle();

  const btns = Array.from(p.$('vt-char-grid').querySelectorAll('button'));
  const visible = btns.filter((b) => !b.hidden).map((b) => b.dataset.id);
  assert.deepStrictEqual(visible, ['1305']);
});

test('自由入力: 1 件に絞れたら自動で選択される → そのまま投票できる', { skip: !JSDOM }, async () => {
  const p = await mount({
    session: SESSION,
    gas: { ok: true, user: 'user/x', charId: '1305', charName: 'ロックマン' },
  });
  p.$('vt-char-search').value = 'ロックマン';
  p.$('vt-char-search').dispatchEvent(new p.w.Event('input', { bubbles: true }));
  await p.settle();

  const sel = p.$('vt-char-grid').querySelector('.sel');
  assert.ok(sel, '自動選択されていない');
  assert.strictEqual(sel.dataset.id, '1305');

  await p.click('vt-vote-btn');
  const gasCall = p.calls.fetch.find((f) => f.url === CONFIG.GAS_ENDPOINT);
  assert.strictEqual(JSON.parse(gasCall.init.body).charId, '1305');
});

test('自由入力: 入力を消すと全キャラに戻る (選択は維持)', { skip: !JSDOM }, async () => {
  const p = await mount({ session: SESSION });
  const inp = p.$('vt-char-search');
  inp.value = 'ベヨ';
  inp.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  await p.settle();
  inp.value = '';
  inp.dispatchEvent(new p.w.Event('input', { bubbles: true }));
  await p.settle();

  const btns = Array.from(p.$('vt-char-grid').querySelectorAll('button'));
  assert.strictEqual(btns.filter((b) => !b.hidden).length, 2);
  // 「ベヨ」で 1 件に絞れた時点の自動選択が残っている
  assert.strictEqual(p.$('vt-char-grid').querySelector('.sel').dataset.id, '1271');
});

test('double: 認証前の画面に候補キャラのチップが出る (絵文字付き)', { skip: !JSDOM }, async () => {
  const p = await mount({ playerByUid: { 4242: DOUBLE_PLAYER } });
  await p.search('toko');
  await p.clickResult(0);

  const chips = Array.from(p.$('vt-auth-cands').querySelectorAll('.cand-chip'))
    .map((c) => c.textContent);
  assert.deepStrictEqual(chips, ['🤖 ロックマン', '🦋 ベヨネッタ']);
});

test('double でない選手の認証前画面にはチップが出ない', { skip: !JSDOM }, async () => {
  const p = await mount();
  await p.search('toko');
  await p.clickResult(0); // characters 空 (既定)
  assert.strictEqual(p.$('vt-auth-cands').children.length, 0);
});
