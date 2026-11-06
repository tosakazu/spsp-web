'use strict';
// 管理している大会を新しい順に読む (site/js/my_tournaments.js、2026-11-06): 開始が sinceSec より前の大会が出たページで止める・
// ページごとに途中の一覧を渡す・onPage が true なら止める。isAdminTournament はその大会より前まで来たら止める
const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console, Date, Math, JSON, Promise, String, Number };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/my_tournaments.js').replace(/\}\)\(\);\n$/, 'window.__m = { readAdminTournaments, isAdminTournament };\n})();\n'), ctx);
  return ctx.__m;
}
const NOW = 1800000000;
// 新しい順: 1 ページ目 = これから、2 ページ目 = 開催中と最近、3 ページ目以降 = 古い
function fake(per) {
  const calls = [];
  const gql = async (q, v) => {
    calls.push(v.page);
    assert.match(q, /tournamentView: "admin"/);
    const nodes = Array.from({ length: v.per }, (_, i) => {
      const k = (v.page - 1) * v.per + i;
      return { id: k + 1, startAt: NOW + 10 * 86400 - k * 86400 / 2, name: 'T' + k };
    });
    return { currentUser: { tournaments: { pageInfo: { totalPages: 99 }, nodes } } };
  };
  return { gql, calls, per };
}

test('開始が sinceSec より前の大会が出たページで止める。ページごとに途中の一覧を渡す', async () => {
  const M = load();
  const f = fake(10);
  const seen = [];
  const all = await M.readAdminTournaments(f.gql, { sinceSec: NOW - 3 * 86400, perPage: 10, onPage: (a, done) => { seen.push([a.length, done]); } });
  // 1 ページ = 5 日分。NOW-3 日より前の大会は 3 ページ目に出る
  assert.deepStrictEqual(f.calls, [1, 2, 3]);
  assert.deepStrictEqual(seen, [[10, false], [20, false], [30, true]]);
  assert.strictEqual(all.length, 30);
});

test('onPage が true を返したら止める・件数が足りないページ・最大ページで止める', async () => {
  const M = load();
  let f = fake(10);
  await M.readAdminTournaments(f.gql, { sinceSec: 0, perPage: 10, onPage: () => true });
  assert.deepStrictEqual(f.calls, [1]);
  f = fake(10);
  await M.readAdminTournaments(f.gql, { sinceSec: 0, perPage: 10, maxPages: 2 });
  assert.deepStrictEqual(f.calls, [1, 2]);
  const short = async () => ({ currentUser: { tournaments: { nodes: [{ id: 1, startAt: NOW }] } } });
  assert.strictEqual((await M.readAdminTournaments(short, { sinceSec: 0, perPage: 10 })).length, 1);
});

test('isAdminTournament: 見つかったら止める・その大会より開始が前まで来たら止める', async () => {
  const M = load();
  let f = fake(50);
  assert.strictEqual(await M.isAdminTournament(f.gql, 60, NOW + 10 * 86400 - 59 * 86400 / 2), true);
  assert.deepStrictEqual(f.calls, [1, 2]);
  f = fake(50);
  assert.strictEqual(await M.isAdminTournament(f.gql, 999999, NOW), false);
  assert.deepStrictEqual(f.calls, [1], 'その大会 (NOW) より前の大会が 1 ページ目に出たので止める');
});
