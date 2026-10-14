// tests/frontend/titles.test.cjs — 二つ名の一覧と、持っている二つ名の計算 (js/titles.js、docs/card_titles_design.md)。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/titles.js'), ctx);
  return ctx.SpspTitles;
}

/** n 回の本戦 (日付は start から 1 日ずつ) @param {number} n @param {string} start */
function tours(n, start = '2026-10-02') {
  const d0 = Date.parse(start + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => ({ event_id: 1000 + i, date: new Date(d0 + i * 864e5).toISOString().slice(0, 10), wins: 1, losses: 1 }));
}

/** 試しの一覧を TITLES[lang] に置く (前半・後半・技名の数) @returns {any[]} */
function mk(T, lang, { pre = 0, post = 0, move = 0 }) {
  const list = [];
  const add = (part, kind, n) => { for (let i = 0; i < n; i++) list.push({ id: `${lang}-${String(list.length + 1).padStart(4, '0')}`, part, text: 'x', unlock: 'random', added: '2026-10-01', ...(kind ? { kind } : {}) }); };
  add('pre', null, pre); add('post', null, post); add('post', 'move', move);
  T.TITLES[lang] = list;
  return list;
}
/** 本戦 m 試合 (公開後・合計) で配る後半の数 */
const postsFor = (T, m) => Math.floor(m / T.POST_PER_MATCHES.matches) * T.POST_PER_MATCHES.posts;
const count = (T, lang, owned) => {
  const c = { pre: 0, post: 0, move: 0 };
  for (const id of owned.keys()) { const x = T.TITLES[lang].find(y => y.id === id); c[x.kind === 'move' ? 'move' : x.part]++; }
  return c;
};

test('一覧: id は重複なし・言語の接頭辞と連番・使える位置 (part)・解放のしかた・日付の形', () => {
  const T = load();
  for (const [lang, list] of Object.entries(T.TITLES)) {
    const ids = new Set();
    for (const t of list) {
      assert.ok(!ids.has(t.id), `重複 ${t.id}`);
      ids.add(t.id);
      assert.match(t.id, new RegExp(`^${lang}-\\d{4}$`));
      assert.ok(['pre', 'post', 'both'].includes(t.part), t.id);
      assert.ok(t.text && t.text.length <= 30, t.id);
      assert.ok(['initial', 'random', 'char', 'pref'].includes(t.unlock), t.id);
      if (t.unlock === 'char') assert.ok(Array.isArray(t.chars) && t.chars.length > 0, t.id);
      if (t.unlock === 'pref') assert.ok(typeof t.pref === 'string' && t.pref, t.id);
      assert.match(t.added, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test('最初の配布: 大会に出ていなくても initial は全部 + 前半・後半を INITIAL_DRAWS ずつ (日付は公開日)', () => {
  const T = load();
  const owned = T.ownedTitles('ja', 123, []);
  for (const t of T.TITLES.ja.filter(x => x.unlock === 'initial')) assert.ok(owned.has(t.id), t.id);
  mk(T, 'zz', { pre: 300, post: 300, move: 300 });
  const z = T.ownedTitles('zz', 123, []);
  const c = count(T, 'zz', z);
  assert.strictEqual(c.pre, T.INITIAL_DRAWS.pre);
  assert.strictEqual(c.post + c.move, T.INITIAL_DRAWS.post);
  for (const v of z.values()) assert.deepStrictEqual({ ...v }, { at: T.TITLE_LAUNCH, how: 'start' });
});

test('大会: 1 試合以上した本戦 1 つにつき前半 PRE_PER_TOURNAMENT、本戦の試合数に応じて後半 (端数は持ち越し)・同じ入力なら同じ結果', () => {
  const T = load();
  mk(T, 'zz', { pre: 300, post: 300, move: 300 });
  const pp = T.PRE_PER_TOURNAMENT;
  const s0 = count(T, 'zz', T.ownedTitles('zz', 7, []));
  const diff = (tv) => { const c = count(T, 'zz', T.ownedTitles('zz', 7, tv)); return { pre: c.pre - s0.pre, post: c.post + c.move - s0.post - s0.move }; };
  assert.deepStrictEqual(diff(tours(1)), { pre: pp, post: postsFor(T, 2) });   // 1 勝 1 敗 = 2 試合
  const one = (i, w, l) => ({ event_id: 2000 + i, date: `2026-11-0${i + 1}`, wins: w, losses: l });
  assert.deepStrictEqual(diff([one(0, 0, 1)]), { pre: pp, post: postsFor(T, 1) });
  assert.deepStrictEqual(diff([one(0, 0, 1), one(1, 0, 1), one(2, 0, 1)]), { pre: 3 * pp, post: postsFor(T, 3) });   // 試合数は大会をまたいで足す
  assert.deepStrictEqual(diff([one(0, 4, 1)]), { pre: pp, post: postsFor(T, 5) });
  const a = [...T.ownedTitles('zz', 7, tours(3)).entries()];
  assert.deepStrictEqual([...T.ownedTitles('zz', 7, tours(3)).entries()], a);
  // 試合 0 の大会と下位クラスの仮想大会は数えない
  const noMatch = [{ event_id: 'z', date: '2026-11-02', wins: 0, losses: 0 }];
  const classOnly = [{ event_id: 'c', date: '2026-11-01', parent_event_id: 1000, wins: 2, losses: 1 }];
  assert.deepStrictEqual(diff(noMatch.concat(classOnly)), { pre: 0, post: 0 });
});

test('公開日より前の大会では配らない (さかのぼらない)', () => {
  const T = load();
  mk(T, 'zz', { pre: 300, post: 300 });
  const base = T.ownedTitles('zz', 9, []);
  const old = T.ownedTitles('zz', 9, tours(30, '2025-01-01'));
  assert.deepStrictEqual([...old.entries()], [...base.entries()]);
  // 公開日の前後にまたがるときは、公開日以降の分だけ
  const mixed = T.ownedTitles('zz', 9, tours(4, '2026-09-29'));   // 09-29, 09-30, 10-01, 10-02
  assert.strictEqual(mixed.size, base.size + 2 * (T.PRE_PER_TOURNAMENT) + postsFor(T, 4));
});

test('後半の日付 = その試合数に届いた大会の日付', () => {
  const T = load();
  mk(T, 'zz', { pre: 300, post: 300 });
  const tv = [{ event_id: 1, date: '2026-11-01', wins: 0, losses: 1 }, { event_id: 2, date: '2026-11-05', wins: 1, losses: 1 }];
  const owned = T.ownedTitles('zz', 3, tv);
  const posts = [...owned.entries()].filter(([id, v]) => v.how === 'random' && T.TITLES.zz.find(x => x.id === id).part === 'post').map(([, v]) => v.at);
  const want = [];
  for (let k = 1; k <= postsFor(T, 3); k++) want.push(postsFor(T, 1) >= k ? '2026-11-01' : '2026-11-05');
  assert.deepStrictEqual(posts, want);
});

test('あとで二つ名を足しても、それより前に引いたものは変わらない', () => {
  const T = load();
  mk(T, 'zz', { pre: 300, post: 300 });
  const before = T.ownedTitles('zz', 42, tours(2, '2026-10-02'));
  // 11/01 に 3 つ追加 (大会は 10/02・10/03 なので、どの抽選にも入らない)
  for (let i = 0; i < 3; i++) T.TITLES.zz.push({ id: `zz-90${i}0`, part: 'pre', text: 'x' + i, unlock: 'random', added: '2026-11-01' });
  const after = T.ownedTitles('zz', 42, tours(2, '2026-10-02'));
  assert.deepStrictEqual([...after.entries()], [...before.entries()]);
  // 追加日より後の大会の抽選には出うる (11/02 の大会 1 つ・2 試合の分だけ増える)
  const later = T.ownedTitles('zz', 42, tours(2, '2026-10-02').concat([{ event_id: 'n', date: '2026-11-02', wins: 1, losses: 1 }]));
  assert.strictEqual(later.size, before.size + T.PRE_PER_TOURNAMENT + postsFor(T, 6) - postsFor(T, 4));
});

test('廃止したものは廃止日より後の抽選に出ない・持っている人は持ったまま', () => {
  const T = load();
  mk(T, 'zz', { pre: 300, post: 300 });
  const owned = T.ownedTitles('zz', 5, tours(1, '2026-10-02'));
  const drawn = [...owned.entries()].find(([, v]) => v.how === 'random');
  assert.ok(drawn);
  const t = T.TITLES.zz.find(x => x.id === drawn[0]);
  t.retired = '2026-12-01';
  assert.ok(T.ownedTitles('zz', 5, tours(1, '2026-10-02')).has(drawn[0]));   // 引いたのは廃止日より前
  t.retired = '2026-10-02';
  assert.ok(!T.ownedTitles('zz', 5, tours(1, '2026-10-02')).has(drawn[0]));  // 引く日に廃止済みなら出ない
});

test('二つ名の文字はすべてフォント (site/fonts/corporate-logo-title.woff2) に入っている (足りなければ tools/fonts/build_title_font.mjs)', () => {
  const T = load();
  const fs = require('fs');
  const path = require('path');
  const have = new Set(fs.readFileSync(path.resolve(__dirname, '../../site/fonts/corporate-logo-title.chars.txt'), 'utf8').replace(/\n$/, ''));
  const missing = [];
  for (const list of Object.values(T.TITLES)) for (const t of list) for (const ch of t.text) if (!have.has(ch)) missing.push(`${t.id}:${ch}`);
  assert.deepStrictEqual(missing, []);
});

test('使える位置: both は前半・後半どちらでも、pre / post はその位置だけ', () => {
  const T = load();
  const t = (part) => ({ id: 'ja-9999', part, text: 'x', unlock: 'random', added: '2026-10-01' });
  assert.strictEqual(T.usableIn(t('both'), 'pre') && T.usableIn(t('both'), 'post'), true);
  assert.strictEqual(T.usableIn(t('pre'), 'pre'), true);
  assert.strictEqual(T.usableIn(t('pre'), 'post'), false);
  assert.strictEqual(T.usableIn(t('post'), 'pre'), false);
});

test('抽選の割合: 後半のうち技名 (kind move) は 1/3。件数の比には引きずられない', () => {
  const T = load();
  mk(T, 'zz', { pre: 100, post: 100, move: 300 });
  const c = { pre: 0, post: 0, move: 0 };
  for (let uid = 1; uid <= 1500; uid++) {
    const x = count(T, 'zz', T.ownedTitles('zz', uid, tours(2, '2026-10-02')));
    for (const k of Object.keys(c)) c[k] += x[k];
  }
  assert.strictEqual(c.pre, 1500 * (T.INITIAL_DRAWS.pre + 2 * T.PRE_PER_TOURNAMENT));
  assert.strictEqual(c.post + c.move, 1500 * (T.INITIAL_DRAWS.post + postsFor(T, 4)));
  assert.ok(Math.abs(c.move / (c.post + c.move) - 1 / 3) < 0.03, JSON.stringify(c));
});

test('技名 / 技名以外の片方を引き切ったらもう片方から。前半・後半をまたいでは引かない', () => {
  const T = load();
  mk(T, 'zz', { pre: 2, post: 300 });   // 技名なし・前半は少ない
  const c = count(T, 'zz', T.ownedTitles('zz', 1, tours(10, '2026-10-02')));
  assert.deepStrictEqual(c, { pre: 2, post: T.INITIAL_DRAWS.post + postsFor(T, 20), move: 0 });
  mk(T, 'zz', { pre: 300, move: 300 });   // 技名以外の後半なし
  const d = count(T, 'zz', T.ownedTitles('zz', 1, tours(3, '2026-10-02')));
  assert.deepStrictEqual(d, { pre: T.INITIAL_DRAWS.pre + 3 * T.PRE_PER_TOURNAMENT, post: 0, move: T.INITIAL_DRAWS.post + postsFor(T, 6) });
});

test('キャラ (メインキャラの ID) と都道府県で持つもの', () => {
  const T = load();
  const list = mk(T, 'zz', { pre: 100, post: 100 });
  list.push({ id: 'zz-0801', part: 'post', text: 'ピーチ使い', unlock: 'char', chars: [1317], added: '2026-10-01' });
  list.push({ id: 'zz-0802', part: 'post', text: 'デイジー使い', unlock: 'char', chars: [1277, 1317], added: '2026-10-01' });
  list.push({ id: 'zz-0803', part: 'pre', text: 'デイジー使いの', unlock: 'char', chars: [1277, 1317], added: '2026-10-01' });
  list.push({ id: 'zz-0901', part: 'pre', text: '神奈川の', unlock: 'pref', pref: '神奈川県', added: '2026-10-01' });
  list.push({ id: 'zz-0902', part: 'pre', text: '東京の', unlock: 'pref', pref: '東京都', added: '2026-10-01' });
  const has = (profile) => ['zz-0801', 'zz-0802', 'zz-0803', 'zz-0901', 'zz-0902'].filter(id => T.ownedTitles('zz', 11, [], profile).has(id));
  assert.deepStrictEqual(has(undefined), []);
  assert.deepStrictEqual(has({ chars: [1277], pref: '神奈川県' }), ['zz-0802', 'zz-0803', 'zz-0901']);
  assert.deepStrictEqual(has({ chars: ['1317'], pref: null }), ['zz-0801', 'zz-0802', 'zz-0803']);
  // 抽選には出ない
  for (let uid = 1; uid <= 50; uid++) for (const [id, v] of T.ownedTitles('zz', uid, tours(5))) if (/^zz-0[89]/.test(id)) assert.fail(`${id} ${v.how}`);
});
