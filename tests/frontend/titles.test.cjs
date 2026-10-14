// tests/frontend/titles.test.cjs — 二つ名の一覧と抽選 (js/titles.js)・ビット列 (js/title_bits.js)。docs/card_titles_design.md
// 抽選は記録 (ビット列 + 引いた回数) に足していくだけ: 過去に引いたものは、一覧や大会のデータが変わっても変わらない
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
/** モジュールは 1 回だけ読む。テストが TITLES[lang] に試しの一覧を置くので、本物の一覧 (ja) はテストの最初に控える */
let mods = null;
async function load() {
  if (!mods) {
    const T = await import(pathToFileURL(path.join(ROOT, 'site/js/titles.js')).href);
    const B = await import(pathToFileURL(path.join(ROOT, 'site/js/title_bits.js')).href);
    mods = { T, B, ja: T.TITLES.ja };
  }
  return mods;
}

const TODAY = '2026-12-31';
/** n 回の本戦 (日付は start から 1 日ずつ、各 2 試合) @param {number} n @param {string} start */
function tours(n, start = '2026-10-02', id0 = 1000) {
  const d0 = Date.parse(start + 'T00:00:00Z');
  return Array.from({ length: n }, (_, i) => ({ event_id: id0 + i, date: new Date(d0 + i * 864e5).toISOString().slice(0, 10), wins: 1, losses: 1 }));
}
/** 試しの一覧を TITLES[lang] に置く。ns[side][genre] = 件数 */
function mkGenres(T, lang, ns, added = '2026-10-01') {
  const list = [];
  for (const side of ['pre', 'post']) for (const [g, n] of Object.entries(ns[side] || {})) for (let i = 0; i < n; i++) {
    list.push({ id: `${lang}-${String(list.length + 1).padStart(4, '0')}`, part: side, text: 'x', unlock: 'random', added,
      ...(g === 'move' ? { kind: 'move' } : { genre: g }) });
  }
  T.TITLES[lang] = list;
  return list;
}
const BIG = { pre: { generic: 300, smash: 200, source: 100 }, post: { generic: 600, smash: 300, move: 300, source: 200 } };
/** 記録の二つ名を位置:ジャンルごとに数える */
function byGenre(T, B, lang, bits) {
  const c = {};
  for (const t of T.bitsTitles(lang, bits)) { const k = `${t.part}:${T.genreOf(t)}`; c[k] = (c[k] || 0) + 1; }
  return c;
}
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);

test('一覧: id は重複なし・言語の接頭辞と連番・使える位置 (part)・解放のしかた・日付の形', async () => {
  const { T, ja } = await load();
  for (const [lang, list] of Object.entries({ ...T.TITLES, ja })) {
    if (lang.length !== 2) continue;
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
      if (t.unlock === 'random' && lang === 'ja') assert.ok(['generic', 'smash', 'source', 'move'].includes(T.genreOf(t)) && (t.kind === 'move' || t.genre), `ジャンルが無い ${t.id}`);
      assert.match(t.added, /^\d{4}-\d{2}-\d{2}$/);
      if (t.retired) assert.match(t.retired, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test('公開済みの二つ名は消さない・位置を変えない (titles_frozen.json。足したら tools/titles/freeze_titles.mjs)', async () => {
  const { ja } = await load();
  const frozen = JSON.parse(fs.readFileSync(path.join(__dirname, 'titles_frozen.json'), 'utf8'));
  const part = new Map(ja.map(t => [Number(t.id.slice(3)), t.part]));
  const bad = [];
  for (const [p, nums] of Object.entries(frozen.ja)) for (const n of nums) if (part.get(n) !== p) bad.push(`ja-${n}: ${p} → ${part.get(n) || '消えた'}`);
  assert.deepStrictEqual(bad, []);
  const known = new Set(Object.values(frozen.ja).flat());
  assert.deepStrictEqual(ja.filter(t => !known.has(Number(t.id.slice(3)))).map(t => t.id), [], 'まだ固めていない二つ名 (freeze_titles.mjs を実行)');
});

test('二つ名の文字はすべてフォントに入っている (足りなければ tools/fonts/build_title_font.mjs)', async () => {
  const { T, ja } = await load();
  const have = new Set(fs.readFileSync(path.join(ROOT, 'site/fonts/corporate-logo-title.chars.txt'), 'utf8').replace(/\n$/, ''));
  const missing = [];
  for (const list of [ja, T.TITLES.en]) for (const t of list) for (const ch of t.text) if (!have.has(ch)) missing.push(`${t.id}:${ch}`);
  assert.deepStrictEqual(missing, []);
});

test('使える位置: both は前半・後半どちらでも、pre / post はその位置だけ', async () => {
  const { T } = await load();
  const t = (part) => ({ id: 'ja-9999', part, text: 'x', unlock: 'random', added: '2026-10-01' });
  assert.strictEqual(T.usableIn(t('both'), 'pre') && T.usableIn(t('both'), 'post'), true);
  assert.strictEqual(T.usableIn(t('pre'), 'pre'), true);
  assert.strictEqual(T.usableIn(t('pre'), 'post'), false);
  assert.strictEqual(T.usableIn(t('post'), 'pre'), false);
});

test('ビット列: 作る・ある・OR・引き算・数・形', async () => {
  const { B } = await load();
  const b = B.bitsFromIds(['ja-0001', 'ja-0005', 'ja-0123']);
  assert.deepStrictEqual(B.bitsNumbers(b), [1, 5, 123]);
  assert.strictEqual(B.bitsFromIds(['ja-0001']), 'Ag', '1 番 = 1 バイト目の下から 2 ビット目 (0x02)');
  assert.strictEqual(B.bitsHas(b, 'ja-0005'), true);
  assert.strictEqual(B.bitsHas(b, 'ja-0999'), false);
  assert.deepStrictEqual(B.bitsNumbers(B.bitsOr(b, B.bitsFromIds(['ja-0002']))), [1, 2, 5, 123]);
  assert.deepStrictEqual(B.bitsNumbers(B.bitsMinus(b, B.bitsFromIds(['ja-0005', 'ja-0123', 'ja-0200']))), [1]);
  assert.strictEqual(B.bitsMinus(b, b), '');
  assert.strictEqual(B.bitsCount(b), 3);
  assert.strictEqual(B.bitsFromNumbers([123, 5, 1]), b);
  assert.strictEqual(B.titleIdOf('ja', 7), 'ja-0007');
  assert.ok(B.bitsValid(b) && B.bitsValid(''));
  assert.ok(!B.bitsValid('a+b') && !B.bitsValid('A') && !B.bitsValid(1) && !B.bitsValid('AAAA', 2));
});

test('配る回数 (drawTargets): 本戦 1 大会につき前半 3、試合 2 つごとに後半 3 (端数は持ち越し)。下位クラスは後半の試合数だけ・公開前の大会は数えない', async () => {
  const { T } = await load();
  assert.deepStrictEqual(T.drawTargets([]), { pre: 0, post: 0 });
  assert.deepStrictEqual(T.drawTargets(tours(3)), { pre: 9, post: 9 });
  const odd = [{ event_id: 1, date: '2026-10-02', wins: 1, losses: 0 }, { event_id: 2, date: '2026-10-03', wins: 0, losses: 1 }];
  assert.deepStrictEqual(T.drawTargets(odd), { pre: 6, post: 3 }, '1 試合 + 1 試合 = 2 試合で後半 3');
  const withClass = [...tours(1), { event_id: 9, parent_event_id: 1000, date: '2026-10-02', wins: 2, losses: 0 }];
  assert.deepStrictEqual(T.drawTargets(withClass), { pre: 3, post: 6 });
  assert.deepStrictEqual(T.drawTargets([{ event_id: 5, date: '2026-10-02', wins: 0, losses: 0 }]), { pre: 0, post: 0 }, '0 試合は数えない');
  assert.deepStrictEqual(T.drawTargets([...tours(5, '2026-09-20'), ...tours(1, '2026-10-01', 2000)]), { pre: 3, post: 3 }, '公開日の大会から');
});

test('最初の配布: 記録を作るときに INITIAL_COUNTS の数ずつ (前半 50・後半 100、ジャンルごとにちょうど)', async () => {
  const { T, B, ja } = await load();
  assert.strictEqual(sum(T.INITIAL_COUNTS.pre), 50);
  assert.strictEqual(sum(T.INITIAL_COUNTS.post), 100);
  T.TITLES.ja = ja;
  for (const uid of [1, 2, 3, 123456]) {
    const st = T.advanceTitles('ja', uid, null, { pre: 0, post: 0 }, null, TODAY);
    assert.deepStrictEqual([st.n_pre, st.n_post], [0, 0]);
    const c = byGenre(T, B, 'ja', st.bits);
    for (const side of ['pre', 'post']) for (const [g, n] of Object.entries(T.INITIAL_COUNTS[side])) assert.strictEqual(c[`${side}:${g}`] || 0, n, `${uid} ${side}:${g}`);
    // 記録があれば最初の配布はしない
    assert.strictEqual(T.advanceTitles('ja', uid, { bits: '', n_pre: 0, n_post: 0 }, { pre: 0, post: 0 }, null, TODAY).bits, '');
  }
});

test('記録に足していく: 差の回数だけ引く。分けて引いてもまとめて引いても同じ (一覧が同じなら)・同じ入力なら同じ結果', async () => {
  const { T, B, ja } = await load();
  T.TITLES.ja = ja;
  for (const uid of [7, 8, 9]) {
    const tg = T.drawTargets(tours(40));
    const once = T.advanceTitles('ja', uid, null, tg, null, TODAY);
    assert.deepStrictEqual([once.n_pre, once.n_post], [tg.pre, tg.post]);
    assert.strictEqual(B.bitsCount(once.bits), 150 + tg.pre + tg.post);
    let st = T.advanceTitles('ja', uid, null, { pre: 0, post: 0 }, null, TODAY);
    for (const k of [5, 17, 40]) st = T.advanceTitles('ja', uid, st, T.drawTargets(tours(k)), null, TODAY);
    assert.deepStrictEqual(st, once);
    assert.deepStrictEqual(T.advanceTitles('ja', uid, null, tg, null, TODAY), once);
  }
});

test('過去に引いたものは変わらない: 一覧に足しても・ジャンルを変えても・廃止しても、記録の二つ名はそのまま (引くのは増えた回だけ)', async () => {
  const { T, B } = await load();
  const list = mkGenres(T, 'zz', BIG);
  const st = T.advanceTitles('zz', 5, null, T.drawTargets(tours(10)), null, TODAY);
  // 一覧を大きく変える: 足す・ジャンルを変える・廃止
  const changed = list.map((t, i) => (i % 3 === 0 ? { ...t, genre: 'smash' } : i % 7 === 0 ? { ...t, retired: '2026-11-01' } : t));
  for (let i = 0; i < 500; i++) changed.push({ id: `zz-${String(3000 + i).padStart(4, '0')}`, part: i % 2 ? 'pre' : 'post', text: 'y', unlock: 'random', added: '2026-11-01', genre: 'generic' });
  T.TITLES.zz = changed;
  // 回数が同じなら何も変わらない
  assert.deepStrictEqual(T.advanceTitles('zz', 5, st, T.drawTargets(tours(10)), null, TODAY), st);
  // 1 大会増えたら前半 3・後半 3 だけ増え、前のものは全部残る
  const next = T.advanceTitles('zz', 5, st, T.drawTargets(tours(11)), null, TODAY);
  assert.strictEqual(B.bitsMinus(st.bits, next.bits), '', '前のものは残る');
  assert.strictEqual(B.bitsCount(B.bitsMinus(next.bits, st.bits)), 6);
});

test('遅れて取れた大会・取り消した大会: 引いた回数の差だけ引く (取り消しで減っても消さず、回数が戻るまで引かない)', async () => {
  const { T, B } = await load();
  mkGenres(T, 'zz', BIG);
  const st = T.advanceTitles('zz', 6, null, T.drawTargets(tours(10, '2026-10-10')), null, TODAY);
  // 過去の日付の大会が遅れて入った: 増えた 1 大会分だけ足す
  const late = [...tours(10, '2026-10-10'), ...tours(1, '2026-10-03', 5000)];
  const a = T.advanceTitles('zz', 6, st, T.drawTargets(late), null, TODAY);
  assert.strictEqual(B.bitsMinus(st.bits, a.bits), '');
  assert.strictEqual(B.bitsCount(B.bitsMinus(a.bits, st.bits)), 6);
  // 2 大会が取り消された: 何も引かず、回数も記録のまま
  const b = T.advanceTitles('zz', 6, a, T.drawTargets(tours(9, '2026-10-10')), null, TODAY);
  assert.deepStrictEqual(b, a);
  // その後 3 大会出た: 11 大会を超えた分 (1 大会分) だけ引く
  const c = T.advanceTitles('zz', 6, b, T.drawTargets([...tours(9, '2026-10-10'), ...tours(3, '2026-11-01', 6000)]), null, TODAY);
  assert.strictEqual(B.bitsCount(B.bitsMinus(c.bits, b.bits)), 3 + 3);
});

test('大会での抽選: ジャンルは DRAW_WEIGHTS の比 (件数の比には引きずられない)', async () => {
  const { T, B } = await load();
  mkGenres(T, 'zz', { pre: { generic: 1000, smash: 1000, source: 1000 }, post: { generic: 1000, smash: 1000, move: 1000, source: 1000 } });   // 番号は 4 桁まで
  const c = {};
  for (let uid = 1; uid <= 60; uid++) {
    const st0 = T.advanceTitles('zz', uid, { bits: '', n_pre: 0, n_post: 0 }, { pre: 0, post: 0 }, null, TODAY);
    const st = T.advanceTitles('zz', uid, st0, { pre: 60, post: 60 }, null, TODAY);
    for (const [k, n] of Object.entries(byGenre(T, B, 'zz', st.bits))) c[k] = (c[k] || 0) + n;
  }
  for (const side of ['pre', 'post']) {
    const w = T.DRAW_WEIGHTS[side], tot = sum(w);
    for (const [g, n] of Object.entries(w)) {
      const got = (c[`${side}:${g}`] || 0) / 3600;
      assert.ok(Math.abs(got - n / tot) < 0.03, `${side}:${g} ${got.toFixed(3)} (目標 ${(n / tot).toFixed(3)})`);
    }
  }
});

test('ジャンルを引き切ったら同じ位置のほかのジャンルから。前半・後半をまたいでは引かない。全部引き切ったらそれ以上は増えない', async () => {
  const { T, B } = await load();
  mkGenres(T, 'zz', { pre: { generic: 60, smash: 2, source: 1 }, post: { generic: 120, move: 3 } });
  const st = T.advanceTitles('zz', 3, null, { pre: 2, post: 5 }, null, TODAY);
  const c = byGenre(T, B, 'zz', st.bits);
  assert.strictEqual(B.bitsCount(st.bits), 50 + 100 + 2 + 5);
  assert.strictEqual(c['pre:smash'], 2);
  assert.strictEqual(c['pre:source'], 1);
  assert.strictEqual(c['post:move'], 3);
  assert.strictEqual(c['pre:generic'], 50 + 2 - 3);
  assert.strictEqual(c['post:generic'], 100 + 5 - 3);
  const all = T.advanceTitles('zz', 3, st, { pre: 500, post: 500 }, null, TODAY);
  assert.strictEqual(B.bitsCount(all.bits), 63 + 123, '一覧の全部で止まる');
});

test('足した日 (added) より前は引かない・廃止日 (retired) からは引かない。持っている人は持ったまま', async () => {
  const { T, B } = await load();
  const list = mkGenres(T, 'zz', { pre: { generic: 200 }, post: { generic: 200 } });
  list.push({ id: 'zz-0901', part: 'pre', text: 'future', unlock: 'random', added: '2027-01-01', genre: 'generic' });
  for (let uid = 1; uid <= 30; uid++) {
    const st = T.advanceTitles('zz', uid, null, { pre: 150, post: 0 }, null, '2026-12-31');
    assert.ok(!B.bitsHas(st.bits, 'zz-0901'), '足した日より前');
  }
  // 廃止: 持っている人は持ったまま、その後は引かない
  const st = T.advanceTitles('zz', 1, null, { pre: 0, post: 0 }, null, TODAY);
  const ownedPre = T.bitsTitles('zz', st.bits).filter(t => t.part === 'pre').map(t => t.id);
  T.TITLES.zz = list.map(t => (t.part === 'pre' && !ownedPre.includes(t.id) ? { ...t, retired: '2026-11-01' } : t));
  const after = T.advanceTitles('zz', 1, st, { pre: 30, post: 0 }, null, TODAY);
  assert.strictEqual(after.bits, st.bits, '廃止したものは引かない (残りは持っているものだけ)');
  assert.strictEqual(after.n_pre, 30);
});

test('キャラ (メインキャラの ID) と都道府県で持つもの: 記録の有無にかかわらず足す。抽選には出ない', async () => {
  const { T, B } = await load();
  const list = mkGenres(T, 'zz', { pre: { generic: 100 }, post: { generic: 100 } });
  list.push({ id: 'zz-0801', part: 'post', text: 'ピーチ使い', unlock: 'char', chars: [1317], added: '2026-10-01' });
  list.push({ id: 'zz-0802', part: 'post', text: 'デイジー使い', unlock: 'char', chars: [1277, 1317], added: '2026-10-01' });
  list.push({ id: 'zz-0803', part: 'pre', text: 'デイジー使いの', unlock: 'char', chars: [1277, 1317], added: '2026-10-01' });
  list.push({ id: 'zz-0901', part: 'pre', text: '神奈川の', unlock: 'pref', pref: '神奈川県', added: '2026-10-01' });
  list.push({ id: 'zz-0902', part: 'pre', text: '東京の', unlock: 'pref', pref: '東京都', added: '2026-10-01' });
  const special = ['zz-0801', 'zz-0802', 'zz-0803', 'zz-0901', 'zz-0902'];
  const has = (profile, state = null) => special.filter(id => B.bitsHas(T.advanceTitles('zz', 11, state, { pre: 0, post: 0 }, profile, TODAY).bits, id));
  assert.deepStrictEqual(has(undefined), []);
  assert.deepStrictEqual(has({ chars: [1277], pref: '神奈川県' }), ['zz-0802', 'zz-0803', 'zz-0901']);
  assert.deepStrictEqual(has({ chars: ['1317'], pref: null }), ['zz-0801', 'zz-0802', 'zz-0803']);
  // 記録がある人にも足す (ビットは増えるだけ: キャラを変えても前のものは残る)
  const st = T.advanceTitles('zz', 11, null, { pre: 0, post: 0 }, { chars: [1317] }, TODAY);
  const later = T.advanceTitles('zz', 11, st, { pre: 0, post: 0 }, { chars: [1277], pref: '東京都' }, TODAY);
  assert.strictEqual(B.bitsMinus(st.bits, later.bits), '');
  assert.ok(B.bitsHas(later.bits, 'zz-0902'));
  // 抽選には出ない
  for (let uid = 1; uid <= 30; uid++) {
    const x = T.advanceTitles('zz', uid, null, { pre: 40, post: 90 }, null, TODAY);
    for (const id of special) assert.ok(!B.bitsHas(x.bits, id), `${uid} ${id}`);
  }
});

test('持てる数 (obtainableCount): 持っているもの + まだ引けるもの。ほかのキャラ・都道府県・廃止・まだ足していないものは入れない', async () => {
  const { T } = await load();
  const list = mkGenres(T, 'zz', { pre: { generic: 10 }, post: { generic: 10 } });
  list.push({ id: 'zz-0801', part: 'post', text: 'a', unlock: 'char', chars: [1], added: '2026-10-01' });
  list.push({ id: 'zz-0802', part: 'post', text: 'b', unlock: 'char', chars: [2], added: '2026-10-01' });
  list.push({ id: 'zz-0803', part: 'pre', text: 'c', unlock: 'random', added: '2027-01-01', genre: 'generic' });
  list.push({ id: 'zz-0804', part: 'pre', text: 'd', unlock: 'random', added: '2026-10-01', retired: '2026-11-01', genre: 'generic' });
  assert.strictEqual(T.obtainableCount('zz', new Set(['zz-0801']), TODAY), 21);
  assert.strictEqual(T.obtainableCount('zz', new Set(['zz-0801', 'zz-0804']), TODAY), 22);
});

test('本物の一覧: 3 年毎日出ると全部引き切る・1 人の計算は軽い', async () => {
  const { T, B, ja } = await load();
  T.TITLES.ja = ja;
  const random = ja.filter(t => t.unlock === 'random');
  const t0 = Date.now();
  const st = T.advanceTitles('ja', 99, null, T.drawTargets(tours(1100)), null, '2029-12-31');
  assert.strictEqual(B.bitsCount(st.bits), random.length);
  let st2 = null;
  for (let uid = 1; uid <= 50; uid++) st2 = T.advanceTitles('ja', uid, null, T.drawTargets(tours(20)), null, TODAY);
  assert.ok(st2 && Date.now() - t0 < 5000);
});
