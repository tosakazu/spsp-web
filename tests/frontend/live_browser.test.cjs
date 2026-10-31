// tests/frontend/live_browser.test.cjs — 参加中の大会をブラウザが start.gg から読み直す部分:
//   js/live_fetch.js (差分更新)、js/live_browser.js (サーバの速報とキャッシュの新しい方)、js/startgg_identity.js (トークンの保存・延長)
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

/** モジュールを読んで export を返す (IIFE の最後で window に出す) */
function load(ctx, rel, names) {
  vm.runInContext(built(rel).replace(/\}\)\(\);\n$/, `window.__m = { ${names.join(', ')} };\n})();\n`), ctx);
  return ctx.__m;
}
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, _m: m };
}
function makeCtx(extra = {}) {
  const ctx = { console, Date, Math, JSON, Promise, Map, Set, setTimeout, localStorage: memStorage(), ...extra };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

const baseDoc = () => ({
  v: 2, event_id: 9, start_at: 1000, updated_at: 2000, _sets_after: 2000, _phases_at: 1990,
  phases: [{ id: 1, name: 'Bracket', order: 1, type: 'DOUBLE_ELIMINATION', seeds: 4, cls: false, groups: [{ id: 11, ident: '1' }] }],
  entrants: { 101: { tag: 'A', uid: 1, seed: 1 }, 102: { tag: 'B', uid: 2, seed: 2 }, 103: { tag: 'C', uid: 3, seed: 3 }, 104: { tag: 'D', uid: 4, seed: 4 } },
  sets: [],
});
const setNode = (id, round, a, b, winner) => ({ id, state: 3, round, fullRoundText: 'R', identifier: 'A', winnerId: winner, startedAt: null, completedAt: 2100,
  updatedAt: 2100, totalGames: 3, phaseGroup: { id: 11 }, slots: [{ entrant: { id: a }, standing: { stats: { score: { value: 2 } } } }, { entrant: { id: b }, standing: { stats: { score: { value: 0 } } } }], games: [] });

function fakeGql(replies) {
  const calls = [];
  const g = async (query, vars) => {
    const name = /query (\w+)/.exec(query)[1];
    calls.push({ name, vars });
    const r = replies[name];
    if (!r) throw new Error('unexpected ' + name);
    return typeof r === 'function' ? r(vars) : r;
  };
  g.calls = calls;
  return g;
}

test('live_fetch: 何も起きていなければセット 1 回だけ、updated_at と続きの位置は今に', async () => {
  const LF = load(makeCtx(), 'js/live_fetch.js', ['refreshDoc']);
  const g = fakeGql({ LiveSets: { data: { event: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } } } });
  const doc = baseDoc();
  const d = await LF.refreshDoc(g, doc, 2050);
  assert.deepStrictEqual(g.calls.map((c) => c.name), ['LiveSets']);
  assert.strictEqual(g.calls[0].vars.after, 2000 - 120);
  assert.strictEqual(d.updated_at, 2050);
  assert.strictEqual(d._sets_after, 2050);
  assert.strictEqual(doc.updated_at, 2000);   // 元の doc は変えない
});

test('live_fetch: 新しいセットがあれば順位を取り直して残り人数・ラベルを付け直す。知らない参加者がいれば参加者も', async () => {
  const LF = load(makeCtx(), 'js/live_fetch.js', ['refreshDoc']);
  const g = fakeGql({
    LiveSets: { data: { event: { sets: { pageInfo: { totalPages: 1 }, nodes: [setNode(5, 1, 101, 105, 101)] } } } },
    LiveEntrants: { data: { event: { entrants: { pageInfo: { totalPages: 1 }, nodes: [
      { id: 101, name: 'A', initialSeedNum: 1, participants: [{ gamerTag: 'A', user: { id: 1 } }] },
      { id: 105, name: 'E', initialSeedNum: 5, participants: [{ gamerTag: 'E', user: { id: 5 } }] }] } } } },
    LiveStandings: { data: { event: { standings: { pageInfo: { totalPages: 1 }, nodes: [
      { placement: 1, isFinal: false, entrant: { id: 101 } }, { placement: 5, isFinal: true, entrant: { id: 105 } }] } } } },
  });
  const d = await LF.refreshDoc(g, baseDoc(), 2200);
  assert.deepStrictEqual(g.calls.map((c) => c.name), ['LiveSets', 'LiveEntrants', 'LiveStandings']);
  assert.strictEqual(d.sets.length, 1);
  assert.strictEqual(d.entrants['105'].tag, 'E');
  assert.strictEqual(d.entrants['102'].tag, 'B');   // 前からいる人は残る
  assert.strictEqual(d.entrants['105'].final, true);
  assert.strictEqual(d.entrants['101'].place_min, 4);   // 残り 4 人 (101..104) → 4 位以上
  assert.ok(d.sets[0].label && /Winners/.test(d.sets[0].label));
});


test('live_fetch: 前の doc に残っている仮の id (preview_…) のセットは、同じプール・識別子の本物があれば捨てる (新しいセットが無くても)', async () => {
  const LF = load(makeCtx(), 'js/live_fetch.js', ['refreshDoc']);
  const g = fakeGql({ LiveSets: { data: { event: { sets: { pageInfo: { totalPages: 1 }, nodes: [] } } } } });
  const doc = baseDoc();
  doc.sets = [
    { id: 'preview_11_1_0', pg: 11, round: 1, ident: 'A', state: 1, e: [101, null], winner: null },
    { id: 500, pg: 11, round: 1, ident: 'A', state: 3, e: [101, 104], winner: 101 },
    { id: 'preview_11_2_0', pg: 11, round: 2, ident: 'C', state: 1, e: [101, null], winner: null },
  ];
  const d = await LF.refreshDoc(g, doc, 2050);
  assert.strictEqual(JSON.stringify(d.sets.map((s) => String(s.id))), JSON.stringify(['500', 'preview_11_2_0']));
});
test('live_browser.pick: サーバの速報とキャッシュの新しい方 (形 v が同じときだけキャッシュ)', () => {
  const ctx = makeCtx({ SpspLiveFetch: {}, SpspStartggIdentity: {} });
  const LB = load(ctx, 'js/live_browser.js', ['pick']);
  const server = { v: 2, event_id: 9, updated_at: 2000 };
  assert.strictEqual(LB.pick(server), server);
  ctx.localStorage.setItem('spsp_live_doc_9', JSON.stringify({ v: 2, event_id: 9, updated_at: 2100, mark: 'cache' }));
  assert.strictEqual(LB.pick(server).mark, 'cache');
  assert.strictEqual(LB.pick({ v: 2, event_id: 9, updated_at: 2200 }).mark, undefined);   // サーバの方が新しい
  ctx.localStorage.setItem('spsp_live_doc_9', JSON.stringify({ v: 1, event_id: 9, updated_at: 9999 }));
  assert.strictEqual(LB.pick(server), server);
});

test('startgg_identity: 保存・同じ人だけ使う・期限が近ければ延長・status', async () => {
  let sess = { user: { id: '42' } };
  const apiCalls = [];
  const ctx = makeCtx({ SpspLogin: { session: () => sess, apiAvailable: () => true,
    api: async (b) => { apiCalls.push(b); return { ok: true, access_token: 'AT-new', expires_in: 604800, refresh_token: 'RT-new' }; } } });
  const ID = load(ctx, 'js/startgg_identity.js', ['save', 'load', 'token', 'status', 'clear']);
  assert.strictEqual(ID.status(), 'relogin');
  ID.save({ access_token: 'AT', expires_in: 604800, refresh_token: 'RT' }, 42);
  assert.strictEqual(ID.status(), 'on');
  assert.strictEqual(await ID.token(), 'AT');
  assert.strictEqual(apiCalls.length, 0);
  // 期限まで 1 日を切ったら延長
  const o = ID.load(); o.exp = Date.now() + 3600e3; ctx.localStorage.setItem('spsp_startgg_identity', JSON.stringify(o));
  assert.strictEqual(await ID.token(), 'AT-new');
  assert.strictEqual(JSON.stringify(apiCalls[0]), JSON.stringify({ action: 'startgg_refresh', refresh_token: 'RT' }));
  assert.strictEqual(ID.load().refresh, 'RT-new');
  // 別の人がログインしたら使わない (消す)
  sess = { user: { id: '7' } };
  assert.strictEqual(await ID.token(), null);
  assert.strictEqual(ID.load(), null);
  sess = null;
  assert.strictEqual(ID.status(), 'login');
});
