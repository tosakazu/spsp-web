'use strict';
// site/js/auth.js — セッション保存/読み出しの純粋ロジック。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const AUTH = ((m) => m.default || m)(require(path.resolve(__dirname, '../../site/js/auth.js')));   // ES module: require は namespace を返す

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

const SESS = {
  token: 'abc.def',
  user: { id: 4242, slug: 'user/x', gamerTag: 'Toko' },
  exp: Date.now() + 3600 * 1000,
};

test('save → load で往復し、uid は文字列化される', () => {
  const st = memStorage();
  AUTH.save(SESS, st);
  const got = AUTH.load(st);
  assert.strictEqual(got.token, 'abc.def');
  assert.deepStrictEqual(got.user, { id: '4242', slug: 'user/x', gamerTag: 'Toko' });
  assert.strictEqual(got.exp, SESS.exp);
});

test('期限切れは null になり、消える', () => {
  const st = memStorage();
  AUTH.save({ ...SESS, exp: Date.now() - 1000 }, st);
  assert.strictEqual(AUTH.load(st), null);
  assert.strictEqual(st.getItem(AUTH.KEY), null);
});

test('壊れた JSON・欠けたフィールドは null になり、消える', () => {
  for (const bad of ['{{{', '{}', '{"token":""}', '{"token":"t"}', '{"token":"t","user":{}}']) {
    const st = memStorage();
    st.setItem(AUTH.KEY, bad);
    assert.strictEqual(AUTH.load(st), null, 'for ' + bad);
    assert.strictEqual(st.getItem(AUTH.KEY), null);
  }
});

test('exp が無い (null) セッションは期限チェックなしで通る', () => {
  const st = memStorage();
  AUTH.save({ token: 't', user: { id: '1' } }, st);
  assert.ok(AUTH.load(st));
});

test('storage が例外を投げても落ちない', () => {
  const throwing = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.strictEqual(AUTH.load(throwing), null);
  assert.doesNotThrow(() => AUTH.clear(throwing));
});

test('displayName: gamerTag > slug > uid', () => {
  assert.strictEqual(AUTH.displayName({ user: { id: '1', slug: 's', gamerTag: 'T' } }), 'T');
  assert.strictEqual(AUTH.displayName({ user: { id: '1', slug: 's', gamerTag: '' } }), 's');
  assert.strictEqual(AUTH.displayName({ user: { id: '1', slug: '', gamerTag: '' } }), '1');
  assert.strictEqual(AUTH.displayName(null), '');
});
