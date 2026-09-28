'use strict';
// nonce をタブ間で引き継げるか。
//
// sessionStorage はタブ (browsing context) ごとに分かれるので、start.gg から
// 別タブ / 別 webview で戻されると認証を始めたタブの値が読めず必ず失敗する。
// X や Discord のアプリ内ブラウザで実際に起きていた
// (2026-08-16 の失敗ログ: 実失敗 17 件中 11 件が state_missing)。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const S = ((m) => m.default || m)(require(path.resolve(__dirname, '../../site/js/oauth_state.js')));   // ES module: require は namespace を返す

/** タブ 1 つぶんの storage。localStorage は共有、sessionStorage はタブごと。 */
function makeTabs() {
  const shared = new Map();          // localStorage (タブ間で共有)
  const mk = (m) => ({
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  });
  const tabs = [];
  return {
    shared,
    open() {
      const own = new Map();
      const t = { session: mk(own), local: mk(shared) };
      tabs.push(t);
      return t;
    },
    use(t) {
      global.sessionStorage = t.session;
      global.localStorage = t.local;
    },
  };
}

test('同じタブなら sessionStorage から取れる', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-1', 1000);
  assert.strictEqual(S.takeNonce(2000), 'N-1');
});

test('別タブで戻ってきても localStorage から拾える (これが直したかった本体)', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-2', 1000);

  const b = env.open();                    // start.gg から別タブで戻ってきた想定
  env.use(b);
  assert.strictEqual(b.session.getItem(S.NONCE_KEY), null, '前提: 別タブでは session は空');
  assert.strictEqual(S.takeNonce(2000), 'N-2');
});

test('単回使用: 2 回目は取れない (両方の storage から消える)', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-3', 1000);
  assert.strictEqual(S.takeNonce(1500), 'N-3');
  assert.strictEqual(S.takeNonce(1600), null);
  assert.strictEqual(env.shared.get(S.NONCE_LS_KEY), undefined);
});

test('期限切れは無効', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-4', 1000);
  const b = env.open();
  env.use(b);
  assert.strictEqual(S.takeNonce(1000 + S.NONCE_TTL_MS + 1), null);
});

test('期限ちょうどは有効', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-5', 1000);
  const b = env.open();
  env.use(b);
  assert.strictEqual(S.takeNonce(1000 + S.NONCE_TTL_MS), 'N-5');
});

test('時刻が巻き戻っていたら無効 (端末時計のずれで無期限に生かさない)', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-6', 5000);
  const b = env.open();
  env.use(b);
  assert.strictEqual(S.takeNonce(4000), null);
});

test('localStorage が壊れていても落ちない', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  env.shared.set(S.NONCE_LS_KEY, '{壊れ');
  assert.strictEqual(S.takeNonce(1000), null);
});

test('storage が使えない環境でも例外を投げない (プライベートブラウズ等)', () => {
  const boom = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  global.sessionStorage = boom;
  global.localStorage = boom;
  assert.doesNotThrow(() => S.saveNonce('N-7', 1000));
  assert.strictEqual(S.takeNonce(1000), null);
  assert.doesNotThrow(() => S.clearNonce());
});

test('保存側は sessionStorage / localStorage の両方に書く', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-8', 1000);
  assert.strictEqual(a.session.getItem(S.NONCE_KEY), 'N-8');
  const ls = JSON.parse(env.shared.get(S.NONCE_LS_KEY));
  assert.strictEqual(ls.n, 'N-8');
  assert.strictEqual(ls.t, 1000);
});

test('nonce 以外は localStorage に置かない (残す値を増やさない)', () => {
  const env = makeTabs();
  const a = env.open();
  env.use(a);
  S.saveNonce('N-9', 1000);
  assert.deepStrictEqual([...env.shared.keys()], [S.NONCE_LS_KEY]);
});

test('発行側 / 検証側が同じヘルパを使っている (sessionStorage 直叩きに戻さない)', () => {
  const fs = require('node:fs');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../site/js/', p), 'utf8');
  for (const f of ['vote.js', 'post.js']) {
    assert.match(read(f), /S\.saveNonce\(/, f + ' が saveNonce を使っていない');
    assert.doesNotMatch(read(f), /sessionStorage\.setItem\(S\.NONCE_KEY/, f + ' が直接書いている');
  }
  assert.match(read('callback.js'), /S\.takeNonce\(/, 'callback が takeNonce を使っていない');
  assert.doesNotMatch(read('callback.js'), /sessionStorage\.getItem\(S\.NONCE_KEY/,
    'callback が直接読んでいる');
});

// ── アプリ内ブラウザ (localStorage 共有では直せない経路) ──
// X のアプリ内ブラウザ → 認証で start.gg アプリ → 戻りは通常の Safari、
// という遷移が実機で確認された (2026-08-17)。ブラウザ自体が変わるので
// sessionStorage も localStorage も引き継がれない。事前に警告するしかない。

const UA = {
  x: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Twitter for iPhone',
  discord: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Discord/1.0',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Line/13.0.0',
  safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
};

test('アプリ内ブラウザを判定できる', () => {
  assert.strictEqual(S.inAppBrowser(UA.x), 'X');
  assert.strictEqual(S.inAppBrowser(UA.discord), 'Discord');
  assert.strictEqual(S.inAppBrowser(UA.line), 'LINE');
});

test('通常のブラウザを誤検知しない (無用な警告を出さない)', () => {
  assert.strictEqual(S.inAppBrowser(UA.safari), null);
  assert.strictEqual(S.inAppBrowser(UA.chrome), null);
  assert.strictEqual(S.inAppBrowser(''), null);
  assert.strictEqual(S.inAppBrowser(undefined), null);
});

test('ログ用のブラウザ種別は粗い分類だけ (個人特定に使わない)', () => {
  assert.strictEqual(S.browserTag(UA.x), 'inapp:X');
  assert.strictEqual(S.browserTag(UA.safari), 'ios-safari');
  assert.strictEqual(S.browserTag(UA.chrome), 'other');
  // UA をそのまま載せない
  for (const ua of Object.values(UA)) {
    assert.ok(S.browserTag(ua).length <= 20, '種別が長すぎる (UA を載せていないか)');
  }
});

test('投票ページに警告の置き場と URL コピーがある', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.resolve(__dirname, '../../site/vote.html'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '../../site/js/vote.js'), 'utf8');
  assert.match(html, /id="vt-inapp"/);
  assert.match(html, /id="vt-copy-url"/);
  // 認証画面を出すときに判定する
  assert.match(js, /updateInAppWarning\(\);\s*\n\s*showSection\('auth'\)/);
  assert.match(js, /S\.inAppBrowser\(navigator\.userAgent\)/);
});

test('コールバックはブラウザ種別をログに添える (経路の裏取り用)', () => {
  const fs = require('node:fs');
  const cb = fs.readFileSync(path.resolve(__dirname, '../../site/js/callback.js'), 'utf8');
  const blk = cb.slice(cb.indexOf('S.takeNonce()'), cb.indexOf('safeReturnPath'));
  assert.match(blk, /browserTag/);
});

test('投票ページの警告がこの経路を名指ししている', () => {
  const fs = require('node:fs');
  const html = fs.readFileSync(path.resolve(__dirname, '../../site/vote.html'), 'utf8');
  const blk = html.slice(html.indexOf('id="vt-inapp"'), html.indexOf('id="vt-copy-url"'));
  assert.match(blk, /アプリ内ブラウザ/);
  assert.match(blk, /Safari|Chrome/);
});

// ── フローの判別もブラウザに依存させない ──
// 署名 state を入れて照合は通るようになったが、その先の「投票か投稿か」の判別が
// sessionStorage のままだった。別ブラウザで戻ると投稿扱いになり
// 「下書きがありません」と出ていた (2026-08-19 実例)。
test('decodeState が flow を返す', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.strictEqual(S.decodeState(b64({ n: 'N', r: '/', f: 'login' }) + '.SIG').f, 'login');
  assert.strictEqual(S.decodeState(b64({ n: 'N', r: '/', f: 'post' }) + '.SIG').f, 'post');
  // 知らない値は無効にする (勝手な分岐を作らせない)
  assert.strictEqual(S.decodeState(b64({ n: 'N', r: '/', f: 'x' }) + '.SIG').f, null);
  assert.strictEqual(S.decodeState(b64({ n: 'N', r: '/' }) + '.SIG').f, null);
});

test('callback は state の flow を優先する', () => {
  const fs = require('node:fs');
  const cb = fs.readFileSync(path.resolve(__dirname, '../../site/js/callback.js'), 'utf8');
  assert.match(cb, /var intent = st\.f;/, 'state の flow を見ていない');
  // sessionStorage は補助 (あれば使う) に留める
  const blk = cb.slice(cb.indexOf('var intent = st.f;'), cb.indexOf('missingConfig'));
  assert.match(blk, /if \(!intent\) intent = stored;/);
});

test('認証開始時に flow を送る', () => {
  const fs = require('node:fs');
  const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../site/js/', p), 'utf8');
  assert.match(read('vote.js'), /action: 'begin_login',\s*\n\s*flow: 'login',/);
  assert.match(read('post.js'), /action: 'begin_login',\s*\n\s*flow: 'post',/);
});

test('下書き無しも記録する (これまで無言だった)', () => {
  const fs = require('node:fs');
  const cb = fs.readFileSync(path.resolve(__dirname, '../../site/js/callback.js'), 'utf8');
  assert.match(cb, /reportError\('draft_missing'/);
});
