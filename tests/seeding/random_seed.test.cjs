'use strict';
// ランダムシード (site/seeding/app/30_core.js、2026-11-05) のテスト。実関数ソースを切り出して動かす。
// 要点: 並びが本当に ranks.random (種で決まる) になり、総合評価の順が紛れ込まないこと。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { SRC } = require('./helpers/seed_app_src.cjs');

function extractFn(src, name) {
  const sig = src.indexOf('function ' + name + '(');
  assert.ok(sig >= 0, 'not found: ' + name);
  let depth = 0, i = src.indexOf('{', sig);
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(sig, i);
}

function ctx() {
  const store = new Map();
  const c = {
    S: { currentMethod: 'ensemble', RANDOM_SEED: null, MANUAL: null, SEED_SPEC: null, APPLIED_ORDER: null },
    DATA: [],
    crypto: webcrypto,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    MANUAL_LS_KEY: 'k', _lockProjNotes: [],
    manualEventKey: () => 'ev1', manualParseUid: (k) => Number(k),
    applyCsvOrderIfReady: undefined, renderManualUI() {}, renderSpecStatus() {},
    _projectSeedLocks: (a) => a,
  };
  vm.createContext(c);
  const fns = ['newRandomSeed', 'randomKey', 'randomIdOf', 'assignRandomRanks', 'parseRandomSeed', 'orderedRecs', 'manualOrder', 'manualApplyOp', 'saveManual', 'restoreManualForEvent'];
  vm.runInContext(fns.map((f) => extractFn(SRC, f)).join('\n') + '\n;this.F = {' + fns.join(',') + '};', c);
  return c;
}

/** 総合評価の順 = uid の順 (1 が 1 位)。ランキング外 (uid あり・tjpr なし) とゲスト (uid なし) も混ぜる */
function data(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ user_id: i, display: 'p' + i, ranks: { ensemble: i, tjpr: i, bt_gated: i } });
  out.push({ user_id: 9001, display: 'unranked', unranked: true, ranks: { ensemble: n + 1, tjpr: null, bt_gated: null } });
  return out;
}
const ids = (recs) => [...recs.map((r) => r.user_id)];

test('ランダムを選ぶと並びは ranks.random の順 (総合評価の順ではない)・同じ種なら同じ・違う種なら違う', () => {
  const c = ctx();
  c.DATA.push(...data(40));
  c.S.currentMethod = 'random';
  c.F.assignRandomRanks(c.DATA, 123456789);
  const a = ids(c.F.orderedRecs());
  assert.notDeepStrictEqual(a, ids(c.DATA.slice().sort((x, y) => x.ranks.ensemble - y.ranks.ensemble)), '総合評価の順ではない');
  assert.deepStrictEqual(a, ids(c.DATA.slice().sort((x, y) => x.ranks.random - y.ranks.random)));
  assert.deepStrictEqual(c.DATA.map((r) => r.ranks.random).sort((x, y) => x - y), Array.from({ length: 41 }, (_, i) => i + 1), '全員 (ランキング外も) に 1..N');
  assert.strictEqual(c.S.RANDOM_SEED, 123456789);
  // 同じ種・並びの違う DATA でも同じ順 (記録の並びに依らない)
  const c2 = ctx();
  c2.DATA.push(...data(40).reverse());
  c2.S.currentMethod = 'random';
  c2.F.assignRandomRanks(c2.DATA, 123456789);
  assert.deepStrictEqual(ids(c2.F.orderedRecs()), a, '同じ種なら同じ順');
  c.F.assignRandomRanks(c.DATA, 123456790);
  assert.notDeepStrictEqual(ids(c.F.orderedRecs()), a, '違う種なら違う順');
});

test('種は毎回違う (暗号用の乱数・32 bit)・入力の検査', () => {
  const c = ctx();
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const s = c.F.newRandomSeed(); assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff); seen.add(s); }
  assert.ok(seen.size >= 199);
  assert.strictEqual(c.F.parseRandomSeed(' 4294967295 '), 4294967295);
  assert.strictEqual(c.F.parseRandomSeed('0'), 0);
  for (const bad of ['', '-1', '1.5', '4294967296', 'abc', '1e3']) assert.strictEqual(c.F.parseRandomSeed(bad), null, bad);
});

test('並びは偏らない: 5 人の 120 通りがほぼ均等', () => {
  const c = ctx();
  const count = new Map();
  for (let s = 0; s < 120000; s++) {
    const recs = [1, 2, 3, 4, 5].map((u) => ({ user_id: u, ranks: {} }));
    c.F.assignRandomRanks(recs, s);
    const k = recs.slice().sort((x, y) => x.ranks.random - y.ranks.random).map((r) => r.user_id).join('');
    count.set(k, (count.get(k) || 0) + 1);
  }
  assert.strictEqual(count.size, 120);
  for (const v of count.values()) assert.ok(v > 850 && v < 1150, String(v));   // 期待 1000、標準偏差 約 32
  // 1 位になる人も均等
  const first = new Map();
  for (const [k, v] of count) first.set(k[0], (first.get(k[0]) || 0) + v);
  for (const v of first.values()) assert.ok(Math.abs(v - 24000) < 800, String(v));
});

test('取り直し: 総合評価の手動調整が保存されていても、ランダムのときは戻さず種の順で開く (逆も)', () => {
  const c = ctx();
  c.DATA.push(...data(20));
  // 総合評価で開いた手動調整を保存
  c.S.currentMethod = 'ensemble';
  c.F.restoreManualForEvent();
  assert.deepStrictEqual([...c.S.MANUAL.base], ids(c.DATA));
  c.F.saveManual();
  // ランダムに切り替えて取り直した
  c.S.currentMethod = 'random';
  c.F.assignRandomRanks(c.DATA, 42);
  c.F.restoreManualForEvent();
  const rand42 = ids(c.DATA.slice().sort((x, y) => x.ranks.random - y.ranks.random));
  assert.deepStrictEqual([...c.S.MANUAL.base], rand42, 'ランダムの順が基準');
  assert.deepStrictEqual([...c.F.manualOrder()], rand42);
  c.F.saveManual();
  // 同じ種なら保存した手動調整を戻す。違う種なら戻さない
  c.F.restoreManualForEvent();
  assert.deepStrictEqual([...c.S.MANUAL.base], rand42);
  c.F.assignRandomRanks(c.DATA, 43);
  c.F.restoreManualForEvent();
  assert.deepStrictEqual([...c.S.MANUAL.base], ids(c.DATA.slice().sort((x, y) => x.ranks.random - y.ranks.random)), '別の種: その種の順');
  c.F.saveManual();
  // 総合評価に戻したら、ランダムの手動調整は戻さない
  c.S.currentMethod = 'ensemble';
  c.F.restoreManualForEvent();
  assert.deepStrictEqual([...c.S.MANUAL.base], ids(c.DATA), '総合評価の順');
});

test('静的: 被り回避・CSV・適用の順はどれも currentMethod の ranks を使う (random を入れたら効く)', () => {
  // ensemble を直書きして並べている箇所が無いこと (総合評価が紛れ込む経路)
  const sorts = SRC.match(/ranks\[[^\]]+\]\s*\|\|\s*1e9/g) || [];
  assert.ok(sorts.length >= 3);
  for (const s of sorts) assert.match(s, /ranks\[S\.currentMethod\]/, s);
  assert.match(SRC, /data-method="random"/);
  assert.match(SRC, /S\.currentMethod === 'random'\) assignRandomRanks\(DATA, newRandomSeed\(\)\)/, 'タブを選ぶたびに種を作る');
});
