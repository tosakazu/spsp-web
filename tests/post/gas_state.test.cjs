'use strict';
// 署名付き state (GAS 側で照合する方式)。
//
// なぜこうしたか: 照合値をブラウザに置く方式は、X のアプリ内ブラウザで始めて
// 通常の Safari に戻される経路で必ず失敗する (ブラウザが変わり保存領域が別)。
// 照合を GAS に移すとブラウザが変わっても通る。
//
// 守るべき性質:
//   - 署名が無い / 改ざんされた state は通らない (誰でも作れてはいけない)
//   - 期限切れは通らない
//   - 単回使用 (使い回した state は通らない = ログイン CSRF 対策の本体)
//   - state を差し替えても他人になりすませない (誰になるかは code だけで決まる)
const test = require('node:test');
const assert = require('node:assert');
const { makeEnv, post, rawPost, beginState, OK_TOKEN, OK_USER } = require('./_gas_env.cjs');

const env = (o) => makeEnv(Object.assign({ token: OK_TOKEN, user: OK_USER }, o || {}));

test('begin_login は署名付き state を返す', () => {
  const e = env();
  const r = rawPost(e, { action: 'begin_login', nonce: 'N1', returnPath: '/spsp/vote.html' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.state.split('.').length, 2, 'payload.署名 の形になっていない');
  assert.ok(r.state.split('.')[1].length > 20, '署名が短すぎる');
  assert.strictEqual(typeof r.ttlMs, 'number');
});

test('state が無い login は通らない', () => {
  const e = env();
  const r = rawPost(e, { action: 'login', code: 'CODE-1' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'state_invalid');
});

test('自作の state は通らない (署名を作れない)', () => {
  const e = env();
  const payload = Buffer.from(JSON.stringify({ n: 'x', r: '/', t: Date.now() }))
    .toString('base64url');
  const r = rawPost(e, { action: 'login', code: 'CODE-1', state: payload + '.FAKE' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'state_invalid');
});

test('payload を書き換えた state は通らない', () => {
  const e = env();
  const st = beginState(e);
  const [body, sig] = st.split('.');
  const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  o.t = Date.now() + 60 * 60 * 1000;               // 期限を伸ばそうとする
  const tampered = Buffer.from(JSON.stringify(o)).toString('base64url') + '.' + sig;
  const r = rawPost(e, { action: 'login', code: 'CODE-1', state: tampered });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'state_invalid');
});

test('単回使用: 同じ state は 2 回使えない (ログイン CSRF 対策の本体)', () => {
  const e = env();
  const st = beginState(e);
  const first = rawPost(e, { action: 'login', code: 'CODE-1', state: st });
  assert.strictEqual(first.ok, true);
  const second = rawPost(e, { action: 'login', code: 'CODE-2', state: st });
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.error.code, 'state_invalid');
});

test('期限切れは通らない', () => {
  const e = env();
  const st = beginState(e);
  const [body, sig] = st.split('.');
  const o = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  // 署名し直せないので、有効期限そのものを跨いだ時刻で検証させる
  const ttl = e.sandbox.STATE_TTL_MS;
  const realNow = Date.now;
  try {
    Date.now = () => o.t + ttl + 1;
    assert.strictEqual(e.sandbox.verifyState_(st, false), null);
  } finally {
    Date.now = realNow;
  }
});

test('期限内なら通る', () => {
  const e = env();
  const st = beginState(e);
  assert.ok(e.sandbox.verifyState_(st, false));
});

test('誰になるかは code だけで決まる (state を差し替えてもなりすませない)', () => {
  // 別々に発行した state を使っても、返るセッションは currentUser (= code の持ち主)。
  const e = env();
  const a = rawPost(e, { action: 'login', code: 'CODE-A', state: beginState(e, 'NA') });
  const b = rawPost(e, { action: 'login', code: 'CODE-B', state: beginState(e, 'NB') });
  assert.strictEqual(a.ok, true);
  assert.strictEqual(b.ok, true);
  // どちらも currentUser スタブ (uid 4242) になる = state は誰かを決めていない
  assert.strictEqual(String(a.user.id), '4242');
  assert.strictEqual(String(b.user.id), '4242');
});

test('post フローも同じ検証を通る', () => {
  const e = env();
  const r = rawPost(e, { action: 'post', code: 'C', body: '本文' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'state_invalid');
  const ok = post(e, { action: 'post', code: 'C', body: '本文' });   // helper が state を補う
  assert.strictEqual(ok.ok, true);
});

test('state に秘密は入らない (payload は読める前提で作る)', () => {
  const e = env();
  const st = beginState(e, 'NONCE-1', '/spsp/vote.html');
  const o = JSON.parse(Buffer.from(st.split('.')[0], 'base64url').toString('utf8'));
  assert.deepStrictEqual(Object.keys(o).sort(), ['f', 'n', 'r', 't']);
  assert.strictEqual(o.n, 'NONCE-1');
  assert.strictEqual(o.f, 'login');       // 既定は投票のログイン
  const raw = JSON.stringify(o);
  for (const bad of ['SECRET', 'secret', e.props.SESSION_SECRET || 'xx']) {
    assert.ok(raw.indexOf(bad) === -1, '秘密が入っている: ' + bad);
  }
});

test('長すぎる入力は拒否する', () => {
  const e = env();
  const r = rawPost(e, { action: 'begin_login', nonce: 'a'.repeat(200) });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'bad_request');
});

test('失敗した login は errors シートに残る (原因追跡)', () => {
  const e = env();
  rawPost(e, { action: 'login', code: 'CODE-1' });
  const rows = (e.rowsByName['errors'] || []).slice(1);
  assert.ok(rows.some((r) => r[3] === 'state_invalid'), 'state_invalid が記録されていない');
});

test('flow が指定されなければ投票のログイン扱い', () => {
  const e = env();
  const st = rawPost(e, { action: 'begin_login', nonce: 'N' }).state;
  const o = JSON.parse(Buffer.from(st.split('.')[0], 'base64url').toString('utf8'));
  assert.strictEqual(o.f, 'login');
});

test('flow=post は post として署名される', () => {
  const e = env();
  const st = rawPost(e, { action: 'begin_login', nonce: 'N', flow: 'post' }).state;
  const o = JSON.parse(Buffer.from(st.split('.')[0], 'base64url').toString('utf8'));
  assert.strictEqual(o.f, 'post');
});

test('知らない flow は login に倒す (勝手な分岐を作らせない)', () => {
  const e = env();
  const st = rawPost(e, { action: 'begin_login', nonce: 'N', flow: '../evil' }).state;
  const o = JSON.parse(Buffer.from(st.split('.')[0], 'base64url').toString('utf8'));
  assert.strictEqual(o.f, 'login');
});
