// tests/frontend/class_bracket.test.cjs — 下位クラス作成の計算部分 (js/class_bracket.js、docs/class_bracket_design.md)。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/class_bracket.js'), ctx);
  return ctx.SpspClassBracket;
}

/** 0 を返し続ける rand (シャッフルの結果が決まる) */
const zero = () => 0;
const P = (userId, placement, extra = {}) => ({ userId, discriminator: 'd' + userId, gamerTag: 'p' + userId, placement, dq: false, ...extra });

test('parseStartggUrl: イベントの URL・大会の URL・slug', () => {
  const C = load();
  const j = (x) => JSON.parse(JSON.stringify(x));
  assert.deepStrictEqual(j(C.parseStartggUrl('https://www.start.gg/tournament/kagaribi-15/event/singles/overview')), { tournamentSlug: 'kagaribi-15', eventSlug: 'singles' });
  assert.deepStrictEqual(j(C.parseStartggUrl('start.gg/tournament/a/event/b?x=1')), { tournamentSlug: 'a', eventSlug: 'b' });
  assert.deepStrictEqual(j(C.parseStartggUrl('https://www.start.gg/tournament/a/details')), { tournamentSlug: 'a', eventSlug: null });
  assert.deepStrictEqual(j(C.parseStartggUrl('https://www.start.gg/tournament/a')), { tournamentSlug: 'a', eventSlug: null });
  assert.strictEqual(C.parseStartggUrl('https://example.com/'), null);
  assert.strictEqual(C.parseStartggUrl(''), null);
});

test('pickEvents: スマブラSP の 1on1 だけ。無ければ全部', () => {
  const C = load();
  const sp = { id: 1, videogame: { id: 1386 }, type: 1 };
  const sp2 = { id: 2, videogame: { id: 1386 }, type: 5 };
  const other = { id: 3, videogame: { id: 1 }, type: 1 };
  assert.deepStrictEqual(C.pickEvents([sp, sp2, other]).map(e => e.id), [1]);
  assert.deepStrictEqual(C.pickEvents([sp2, other]).map(e => e.id), [2, 3]);
});

test('selectTargets: 範囲内だけ、DQ と順位なしは除く、max=null は最後まで', () => {
  const C = load();
  const st = [P(1, 1), P(2, 9), P(3, 13), P(4, 13, { dq: true }), P(5, null), P(6, 25)];
  assert.deepStrictEqual(C.selectTargets(st, 9, null).map(p => p.userId), [2, 3, 6]);
  assert.deepStrictEqual(C.selectTargets(st, 9, 13).map(p => p.userId), [2, 3]);
  assert.deepStrictEqual(C.selectTargets(st, 9, 13, false).map(p => p.userId), [2, 3, 4]);
});

test('seedOrder: main_result は本戦の順位順、同率の中はシャッフル順', () => {
  const C = load();
  const t = [P(1, 17), P(2, 9), P(3, 13), P(4, 13)];
  const got = C.seedOrder(t, 'main_result', () => null, zero).map(p => p.userId);
  assert.deepStrictEqual(got.slice(0, 1), [2]);
  assert.deepStrictEqual(got.slice(1, 3).sort(), [3, 4]);
  assert.strictEqual(got[3], 1);
});

test('seedOrder: spsp は SPSP 順位順、順位の無い人は後ろ', () => {
  const C = load();
  const t = [P(1, 9), P(2, 9), P(3, 9)];
  const ranks = { 1: 300, 2: null, 3: 50 };
  const got = C.seedOrder(t, 'spsp', uid => ranks[uid], zero).map(p => p.userId);
  assert.deepStrictEqual(got, [3, 1, 2]);
});

test('seedOrder: main_spsp は本戦の順位、同率は SPSP 順位 (無い人はその中で後ろ)', () => {
  const C = load();
  const t = [P(1, 13), P(2, 9), P(3, 13), P(4, 13), P(5, 9)];
  const ranks = { 1: 400, 2: 900, 3: null, 4: 20, 5: 100 };
  const got = C.seedOrder(t, 'main_spsp', uid => ranks[uid], zero).map(p => p.userId);
  assert.deepStrictEqual(got, [5, 2, 4, 1, 3]);
});

test('seedOrder: random は全員を 1 回ずつ含む', () => {
  const C = load();
  const t = [P(1, 9), P(2, 13), P(3, 17)];
  const got = C.seedOrder(t, 'random', () => null, Math.random).map(p => p.userId).sort();
  assert.deepStrictEqual(got, [1, 2, 3]);
});

test('participantName: 「名前 (discriminator)」', () => {
  const C = load();
  assert.strictEqual(C.participantName(P(7, 9)), 'p7 (d7)');
  assert.strictEqual(C.participantName(P(7, 9, { discriminator: '' })), 'p7');
});

test('challongeToken: sessionStorage のトークン。期限の 1 分前からと壊れた値は null', () => {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  const store = new Map();
  ctx.sessionStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  vm.createContext(ctx);
  vm.runInContext(built('js/class_bracket.js'), ctx);
  const C = ctx.SpspClassBracket;
  const now = 1e12;
  assert.strictEqual(C.challongeToken(now), null);
  store.set(C.CHALLONGE_TOKEN_KEY, JSON.stringify({ token: 'tk', exp: now + 10 * 60 * 1000 }));
  assert.strictEqual(C.challongeToken(now), 'tk');
  store.set(C.CHALLONGE_TOKEN_KEY, JSON.stringify({ token: 'tk', exp: now + 30 * 1000 }));
  assert.strictEqual(C.challongeToken(now), null);
  store.set(C.CHALLONGE_TOKEN_KEY, '{broken');
  assert.strictEqual(C.challongeToken(now), null);
});
