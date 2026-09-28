'use strict';
// 認証が失敗したときに「何が起きたか・次に何をすればいいか」が出るか。
// いちばん多いのはアカウント不一致 (選んだ選手と認証したアカウントが別)。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const R = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');
const CALLBACK = R('site/js/callback.js');
const VOTE_JS = R('site/js/vote.js');
const VOTE_HTML = R('site/vote.html');
const OAUTH_GS = R('gas/oauth.gs');
const SESSION_GS = R('gas/session.gs');
const MAIN_GS = R('gas/main.gs');

test('OAuth の失敗理由が種類ごとに分かれている', () => {
  for (const reason of ['code_invalid', 'startgg_down', 'network', 'no_user']) {
    assert.ok(OAUTH_GS.includes("'" + reason + "'"), '理由が無い: ' + reason);
  }
  // 期限切れ / 使い回しは「やり直せば直る」と分かる文言であること
  assert.match(OAUTH_GS, /期限切れ/);
  assert.match(OAUTH_GS, /start\.gg が混雑・障害中/);
});

test('login / post とも汎用文でなく理由付きのメッセージを返す', () => {
  for (const [name, src] of [['session.gs', SESSION_GS], ['main.gs', MAIN_GS]]) {
    assert.match(src, /oauthErrorMessage_\(LAST_OAUTH_ERROR\)/, name + ': 理由を渡していない');
    assert.match(src, /oauthErrorMessage_\('no_user'\)/, name + ': ユーザー取得失敗の分岐が無い');
    assert.doesNotMatch(src, /'start\.gg の認証に失敗しました。やり直してください。'/,
      name + ': 汎用文が残っている');
  }
});

test('秘密情報を利用者向けメッセージに載せない', () => {
  const fn = OAUTH_GS.slice(OAUTH_GS.indexOf('function oauthErrorMessage_'),
    OAUTH_GS.indexOf('function exchangeCodeForToken_'));
  for (const bad of ['client_secret', 'CLIENT_SECRET', 'access_token', 'code']) {
    assert.doesNotMatch(fn, new RegExp(bad + '\\s*[:=]'), '秘密が混ざっている: ' + bad);
  }
});

test('callback: start.gg 側エラーをキャンセルとそれ以外で分ける', () => {
  assert.match(CALLBACK, /access_denied/);
  assert.match(CALLBACK, /function describeOAuthError/);
  // 標準コードごとに次の行動が変わる
  for (const code of ['invalid_scope', 'server_error', 'invalid_request']) {
    assert.ok(CALLBACK.includes("'" + code + "'"), 'コード未対応: ' + code);
  }
  // start.gg が説明文を付けてきたら併記する
  assert.match(CALLBACK, /error_description/);
});

// 2026-08-17: 照合の本体を GAS の署名 state に移したので、
// 「保存領域に nonce が無い」だけでは止めない (アプリ内ブラウザ経路を通すため)。
test('callback: nonce が残っていないだけでは止めない', () => {
  const blk = CALLBACK.slice(CALLBACK.indexOf('S.takeNonce()'), CALLBACK.indexOf('safeReturnPath'));
  // 止めるのは「state が壊れている」か「nonce があって食い違う」ときだけ
  assert.match(blk, /if \(!st \|\| \(stored && st\.n !== stored\)\)/);
});

test('callback: 照合できないときは GAS が state を検証する (素通しにしない)', () => {
  assert.match(CALLBACK, /action: 'login', code: code, state: state/);
  assert.match(CALLBACK, /action: 'post', code: code, state: state/);
});

test('callback: 戻るリンクのラベルが戻り先と一致する', () => {
  // 投票フローで「投稿ページに戻る」と出ていた。文言は辞書 (site/i18n/ja.js) に移したので辞書側で見る
  const JA = fs.readFileSync(path.resolve(__dirname, '../../site/i18n/ja.js'), 'utf8');
  assert.match(JA, /キャラ投票ページに戻る/);
  assert.match(CALLBACK, /backPath\.indexOf\('vote'\)/);
});

test('アカウント不一致で、原因と対処が複数示される', () => {
  const i = VOTE_JS.indexOf('sel.uid !== session.user.id');
  assert.ok(i > 0);
  // 文言は辞書 (i18n('vote.sN')) に移したので、その分岐で引いているキーの値を辞書から集めて見る
  const JA = fs.readFileSync(path.resolve(__dirname, '../../site/i18n/ja.js'), 'utf8');
  const dict = Object.fromEntries([...JA.matchAll(/^  '([^']+)': '((?:[^'\\]|\\.)*)',$/gm)].map((m) => [m[1], m[2]]));
  const keys = [...VOTE_JS.slice(i, i + 1600).matchAll(/i18n\('([^']+)'/g)].map((m) => m[1]);
  // テンプレートリテラルのままの文言は元のソースに残っているので、両方を合わせて見る
  const blk = VOTE_JS.slice(i, i + 1600) + '\n' + keys.map((k) => dict[k] || '').join('\n');
  assert.match(blk, /別の人を選んでいる/, '人違いの可能性に触れていない');
  assert.match(blk, /複数の start\.gg アカウント/, '複数アカウントに触れていない');
  // start.gg 側にログインが残る罠 (ここを書かないと再認証で同じ画面に戻り続ける)
  assert.match(blk, /start\.gg でログアウト/, 'start.gg 側のログアウトに触れていない');
  assert.match(blk, /同じ結果になります|同じアカウントのまま/, '再認証が無意味な理由が無い');
});

test('不一致メッセージの改行が表示に反映される', () => {
  assert.match(VOTE_HTML, /\.inel-detail\s*\{[^}]*white-space:\s*pre-line/s);
});
