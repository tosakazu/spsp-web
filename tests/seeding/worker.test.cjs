'use strict';
// seed_worker.js のグルーを Node 上でシム実行して検証（Worker/importScripts を擬似）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const vm = require('node:vm');
function loadWorker() {
  // seed_worker.js は ES module (import SeedOptimizer)。ブラウザと同じく esbuild で束ねた古典 script を、self を擬似した context で走らせる
  const messages = [];
  const fakeSelf = { onmessage: null, postMessage: (m) => messages.push(m) };
  const { built } = require('../helpers/built.cjs');
  const ctx = { self: fakeSelf, setTimeout, clearTimeout, console, Date, Math, JSON, Map, Set, Array, Object, Number, String, Promise, Error, performance };
  vm.runInNewContext(built('seeding/seed_optimizer.js'), ctx);   // worker が import する SeedOptimizer を self に置く
  vm.runInNewContext(built('seeding/seed_worker.js'), ctx);
  return { messages, self: fakeSelf };
}

function waitForDone(messages, ms) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      const done = messages.find((m) => m.type === 'done' || m.type === 'error');
      if (done) return resolve(done);
      if (Date.now() - t0 > (ms || 3000)) return reject(new Error('timeout'));
      setTimeout(poll, 5);
    })();
  });
}

test('worker: start → 多点スタート → done で最良結果を返す', async () => {
  const { messages, self } = loadWorker();
  const N = 16;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const recentPair = {};
  for (let a = 1; a <= N; a++) for (let b = a + 1; b <= N; b++) recentPair[a + ':' + b] = 1;
  self.onmessage({ data: { type: 'start', input: {
    poolCount: 4, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair,
    params: { mode: 'multistart-sa', restarts: 4, rngSeed: 1 },
  } } });
  const done = await waitForDone(messages);
  assert.strictEqual(done.type, 'done');
  assert.ok(done.result.seedOrder.length === N);
  // checkpoint が複数回（多点スタート分）来ている。
  const ckpts = messages.filter((m) => m.type === 'checkpoint');
  assert.ok(ckpts.length >= 1);
  // 最終 bestScore は単調非増加で最良。
  assert.ok(done.result.report.after.total <= done.result.report.before.total + 1e-9);
});

test('worker: 非対応形式は done(unsupported)', async () => {
  const { messages, self } = loadWorker();
  self.onmessage({ data: { type: 'start', input: {
    poolCount: 1, format: 'SINGLE_ELIMINATION', ranking: [1, 2, 3, 4], prefByUid: {}, recentPair: {},
    params: {},
  } } });
  const done = await waitForDone(messages);
  assert.strictEqual(done.type, 'done');
  assert.strictEqual(done.result.unsupported, true);
});

test('worker: stop で早期終了', async () => {
  const { messages, self } = loadWorker();
  const N = 24;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  self.onmessage({ data: { type: 'start', input: {
    poolCount: 4, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: {},
    params: { mode: 'multistart-sa', restarts: 100, rngSeed: 1 },
  } } });
  // 直後に stop。
  self.onmessage({ data: { type: 'stop' } });
  const done = await waitForDone(messages);
  assert.strictEqual(done.type, 'done');
  // restarts=100 全部は走らない（stop で打ち切り）。
  const ckpts = messages.filter((m) => m.type === 'checkpoint');
  assert.ok(ckpts.length < 100, 'stop が効いていない: ' + ckpts.length);
});

// ───────── レビュー修正の回帰テスト ─────────

test('worker: optimize が throw したら error を post し、次の start を受理できる', async () => {
  const { messages, self } = loadWorker();
  // roundWeights が空 → resolveParams が throw（fail-loud 系の代表例）。
  self.onmessage({ data: { type: 'start', input: {
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking: [1, 2, 3, 4], prefByUid: {}, recentPair: {},
    params: { roundWeights: [] },
  } } });
  const err = await waitForDone(messages);
  assert.strictEqual(err.type, 'error');
  assert.match(err.message, /roundWeights/);
  // running が復帰し、再 start が受理される。
  messages.length = 0;
  self.onmessage({ data: { type: 'start', input: {
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking: [1, 2, 3, 4], prefByUid: {}, recentPair: {},
    params: { restarts: 1, rngSeed: 1 },
  } } });
  const done = await waitForDone(messages);
  assert.strictEqual(done.type, 'done');
});

test('worker: restarts 未指定の multistart は MODE_DEFAULTS(=15) 回走る', async () => {
  const { messages, self } = loadWorker();
  const N = 8;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  self.onmessage({ data: { type: 'start', input: {
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: { '1:4': 1 },
    params: { mode: 'multistart-sa', rngSeed: 1, maxIters: 200 },   // restarts 指定なし
  } } });
  const done = await waitForDone(messages, 10000);
  assert.strictEqual(done.type, 'done');
  const ckpts = messages.filter((m) => m.type === 'checkpoint');
  const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));
  assert.strictEqual(ckpts.length, O.MODE_DEFAULTS['multistart-sa'].restarts);
});

test('worker: ベスト選択は total 優先・同点なら order(元順位ズレ) が小さい方', async () => {
  const { messages, self } = loadWorker();
  // 罰則ゼロ → 全リスタート total=0 の同点。恒等解(order=0)が選ばれるべき。
  const N = 12;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  self.onmessage({ data: { type: 'start', input: {
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid: {}, recentPair: {},
    params: { mode: 'multistart-sa', restarts: 4, rngSeed: 1, maxIters: 500 },
  } } });
  const done = await waitForDone(messages, 10000);
  assert.strictEqual(done.type, 'done');
  assert.strictEqual(done.result.report.after.total, 0);
  assert.deepStrictEqual(done.result.seedOrder, ranking, '同点で order 最小(恒等)以外が選ばれた');
});
