// tests/frontend/live.test.cjs — 参加中の大会 (js/live.js): 確定順位・「N 位以上」・シード・いまのプールのリンク・下位クラス。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load(search = '', hostname = 'spsp.games', extra = {}) {
  const ctx = {
    console,
    location: { hostname, search },
    SPSP: { site: { live: 'https://data.spsp.games/live/jp/', timeZone: 'Asia/Tokyo' } },
    SPSPI18n: { t: (k, p) => k + JSON.stringify(p || {}), lang: 'ja' },
    escapeHtml: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    charName: (id) => 'c' + id,
    ...extra,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const m of ['js/match.js', 'js/format.js', 'js/links.js', 'js/live_root.js', 'js/live.js']) vm.runInContext(built(m), ctx);
  return ctx.SpspLive;
}

const doc = () => ({
  tournament_name: 'T<1>', tournament_url: 'https://www.start.gg/tournament/t', event_name: 'SP', url: 'https://www.start.gg/tournament/t/event/sp',
  num_entrants: 4, updated_at: 1800000000,
  phases: [{ name: 'Main', groups: [{ id: 10, ident: '1', url: 'https://www.start.gg/x/brackets/1/10' }] },
           { name: 'Bクラス', cls: true, groups: [{ id: 30, ident: '1', url: 'https://www.start.gg/x/brackets/3/30' }] }],
  entrants: {
    1: { tag: 'A', uid: 11, seed: 1, placement: null, final: false, place_min: 2, pg: 10 },
    2: { tag: 'B', uid: 22, seed: 2, placement: 3, final: true, place_min: null, pg: 30, in_class: true },
    3: { tag: 'C', uid: 33, seed: 3, placement: 1, final: true, place_min: null, pg: 10 },
  },
  sets: [{ id: 1, pg: 10, label: 'Winners TOP 4', round_text: 'WR1', e: [1, 2], score: [2, 1], winner: 1, completed_at: 100, games: [{ c: { 1: 1302 } }] },
         { id: 2, pg: 10, round_text: 'WF', e: [1, 3], score: [null, null], winner: null, state: 2, started_at: 200 },
         { id: 3, pg: 30, round_text: 'R1', e: [2, null], score: [null, null], winner: null }],
});
const el = () => ({ innerHTML: '' });

test('残っている人は「N 位以上」、対戦中のセットが上、いまのプールにリンク', () => {
  const L = load();
  const e = el();
  assert.strictEqual(L.render(e, 11, [{ summary: { image: 'https://images.start.gg/i.png' }, doc: doc() }]), 1);
  assert.match(e.innerHTML, /<span class="ph-place">2<span class="ph-i">live\.or_better_unit\{"n":2\}<\/span><\/span><span class="ph-n">\/4<\/span>/);
  assert.match(e.innerHTML, /live\.seed_label\{\}<\/span><span class="ph-rank">1</);
  assert.match(e.innerHTML, /live\.unreflected/);
  assert.match(e.innerHTML, /<img class="tour-icon lr-icon" src="https:\/\/images\.start\.gg\/i\.png"/);
  assert.match(e.innerHTML, /href="https:\/\/www\.start\.gg\/x\/brackets\/1\/10" target="_blank" rel="noopener">live\.view_bracket\{\} ↗/);
  assert.doesNotMatch(e.innerHTML, /start\.gg ↗|tournament\/t\/event\/sp/);   // 部門のページは大会名と被るので出さない
  assert.match(e.innerHTML, /T&lt;1&gt;/);
  assert.ok(e.innerHTML.indexOf('live.playing') < e.innerHTML.indexOf('2-1'));
});

test('シードどおりの順位を満たした人には「シード達成」「シード +N 達成」をトーナメントのリンクの隣に', () => {
  const L = load();
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 17, 25, 33, 49, 65, 97, 1537].map(L.placeTier),
    [0, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 11, 12, 13, 21]);
  const one = (seed, over) => {
    const d = doc(); Object.assign(d.entrants[1], { seed }, over || {});
    const e = el(); L.render(e, 11, [{ summary: {}, doc: d }]);
    return e.innerHTML;
  };
  assert.doesNotMatch(one(1), /live-spr/);                                            // シード 1 で 2 位以上 → まだ
  assert.match(one(2), /<span class="live-spr">live\.seed_met\{\}<\/span><a class="live-link"/);
  assert.match(one(4), /<span class="live-spr">live\.seed_over\{"n":2\}<\/span>/);
  assert.match(one(3, { placement: 3, final: true, place_min: null }), /live\.seed_met/);   // 確定した順位でも
  const noWin = doc(); noWin.entrants[1].seed = 4; noWin.sets[0].score = [0, -1];       // 勝ちが DQ だけ
  const e2 = el(); L.render(e2, 11, [{ summary: {}, doc: noWin }]);
  assert.doesNotMatch(e2.innerHTML, /live-spr/);
  const e3 = el(); L.render(e3, 22, [{ summary: {}, doc: doc() }]);                     // 下位クラスには出さない
  assert.doesNotMatch(e3.innerHTML, /live-spr/);
});

test('試合の行は最新の大会結果と同じ形 (ラウンドの位置・スコア・相手の絵文字とリンク・シード)', () => {
  const L = load();
  const e = el();
  L.render(e, 11, [{ summary: {}, doc: doc() }], { name: 'A', emojiOf: (u) => (u === 22 ? '🍄' : '') }, (u) => u === 22);
  assert.match(e.innerHTML, /<div class="match-header">A<span class="seed">#1<\/span><\/div>/);
  assert.match(e.innerHTML, /<span class="m-bracket">W\.Top4<\/span>/);
  assert.match(e.innerHTML, /color:#16a34a[^>]*><div>2-1<\/div>/);
  assert.match(e.innerHTML, /🍄 <a [^>]*>B<\/a><\/div><div class="m-seed">#2<\/div>/);
  assert.match(e.innerHTML, /<div>C<\/div><div class="m-seed">#3<\/div>/);   // ページの無い相手はリンクにしない
});

test('確定した順位はそのまま。下位クラスにいる人はクラスのプールと「参加中」', () => {
  const L = load();
  const e = el();
  L.render(e, 33, [{ summary: {}, doc: doc() }]);
  assert.match(e.innerHTML, /<span class="ph-place gold">1<span class="ph-i">player\.place_unit\{"n":1\}/);
  const e2 = el();
  L.render(e2, 22, [{ summary: {}, doc: doc() }]);
  assert.match(e2.innerHTML, /live\.in_class\{"name":"Bクラス"\}/);
  assert.match(e2.innerHTML, /brackets\/3\/30/);
});

test('中身が同じなら描き直さない (描き直しの間に押した開け閉めが消えないように)', () => {
  const L = load();
  let writes = 0, html = '';
  const e = { get innerHTML() { return html; }, set innerHTML(v) { writes++; html = v; } };
  L.render(e, 11, [{ summary: {}, doc: doc() }]);
  L.render(e, 11, [{ summary: {}, doc: doc() }]);
  assert.strictEqual(writes, 1);
  L.render(e, 11, [{ summary: {}, doc: { ...doc(), updated_at: 1800000600 } }]);
  assert.strictEqual(writes, 2);
});

test('出ていない部門は描かない', () => {
  assert.strictEqual(load().render(el(), 99, [{ summary: {}, doc: doc() }]), 0);
});

test('結果がもう選手の記録に入っている部門は描かない (本戦と下位クラスを分けて見る)', () => {
  const L = load();
  const d = { ...doc(), event_id: 7 };
  const seen = [];
  const reflected = (eid, inClass) => { seen.push([eid, inClass]); return eid === '7' && !inClass; };
  assert.strictEqual(L.render(el(), 11, [{ summary: {}, doc: d }], { reflected }), 0);
  assert.strictEqual(L.render(el(), 22, [{ summary: {}, doc: d }], { reflected }), 1);   // 下位クラスにいる人は下位クラスの行で見る
  assert.strictEqual(JSON.stringify(seen), JSON.stringify([['7', false], ['7', true]]));
});

test('見本 (?live=sample) は spsp.games 以外だけ', () => {
  assert.strictEqual(load('?live=sample').liveRoot(), 'https://data.spsp.games/live/jp/');
  assert.strictEqual(load('?live=sample', 'spsp-web-live-preview.tosakazu.workers.dev').liveRoot(), 'https://data.spsp.games/live/sample/');
});

test('トップの帯: ログインしていなければ出さない・本人が出ていれば大会名と順位', async () => {
  const L0 = load();
  const el0 = { innerHTML: '', style: { display: 'none' } };
  await L0.showNotice(el0);
  assert.strictEqual(el0.style.display, 'none');

  const fetch = async (url) => ({ ok: true, json: async () => (/index\.json$/.test(url)
    ? { events: [{ event_id: 5 }], players: { 11: [5] } } : doc()) });
  const SPSPLinks = { playerHref: (prefix, uid) => `p/?uid=${uid}` };
  const L = load('?live=sample&live_as=11', 'spsp-web-live-preview.tosakazu.workers.dev', { fetch, SPSPLinks });
  const el = { innerHTML: '', style: { display: 'none' } };
  await L.showNotice(el);
  assert.strictEqual(el.style.display, '');
  assert.match(el.innerHTML, /T&lt;1&gt; <span class="d">live\.place_or_better\{"n":2\}<\/span>/);
  assert.match(el.innerHTML, /href="p\/\?uid=11#live-section"/);
  // spsp.games では live_as を見ない (ログインしていないので出さない)
  const el2 = { innerHTML: '', style: { display: 'none' } };
  await load('?live=sample&live_as=11', 'spsp.games', { fetch, SPSPLinks }).showNotice(el2);
  assert.strictEqual(el2.style.display, 'none');
});

test('フェーズが 2 つ以上なら境目に横線と「(進んだ先) 進出！」(下位クラスはクラス名だけ)', () => {
  const L = load();
  const d = doc();
  d.phases.splice(1, 0, { name: 'TOP8', groups: [{ id: 20, ident: '1' }] });
  d.sets.push({ id: 4, pg: 20, round_text: 'WR1', e: [1, 3], score: [null, null], winner: null, state: 1 });
  d.sets = d.sets.filter((s) => s.id !== 2);
  const e = el();
  L.render(e, 11, [{ summary: {}, doc: d }]);
  const h = e.innerHTML;
  assert.match(h, /<div class="match-phase advanced"><span>match\.phase_advanced\{"name":"TOP8"\}<\/span><\/div>/);
  assert.strictEqual((h.match(/match-phase/g) || []).length, 1);   // 境目は 1 本、一番下 (最初のフェーズ) の下には無い
  const e2 = el();
  L.render(e2, 22, [{ summary: {}, doc: doc() }]);
  assert.match(e2.innerHTML, /<div class="match-phase"><span>Bクラス<\/span><\/div>/);
  assert.doesNotMatch(e2.innerHTML, /phase_advanced/);
});

test('試合の一覧は最初は畳んである (カードを押すと開く ▶ 付き)', () => {
  const L = load();
  const e = el();
  L.render(e, 11, [{ summary: {}, doc: doc() }]);
  assert.match(e.innerHTML, /<div class="tour-group live-group" data-eid="">/);
  assert.match(e.innerHTML, /live-toggle latestres-card/);
  assert.match(e.innerHTML, /<span class="chevron lr-chev">▶<\/span><\/div>/);
});

test('予想があればパフォーマンスを順位の横に、開いた中に順位評価・直対評価の chip と全国順位、試合の行に変化と「勝てば」。集計対象外は一言だけ', () => {
  const L = load();
  const e = el();
  const pred = { place: 2, final: false, counted: true, perf: 120, perfInfo: { eq: 120, eqLv: 5, lvSfx: '' },
    tjpr: { delta: 0.1, raw: 2, newScore: 1 }, bt: { dPeak: 0, dInt: -3.21, peakAfter: 1500, n: 1, perSet: { 1: 4.26 }, ifWin: { 2: 7.04 } } };
  L.render(e, 11, [{ summary: {}, doc: doc() }], { rankChange: async () => null }, null, [pred]);
  assert.match(e.innerHTML, /player\.performance\{\}.*#120.*lv-pill lv-5/);
  assert.match(e.innerHTML, /ranking\.tab\.tjpr\{\}<\/span><span class="val pos">\+1\.8<\/span><span class="sub">\(35\.0\)<\/span>/);
  assert.match(e.innerHTML, /ranking\.tab\.bt\{\}<\/span><span class="val dim">±0<\/span><span class="sub">\(-3\.2\)<\/span>/);
  assert.match(e.innerHTML, /<div class="live-detail"><div class="live-pred">.*<div class="live-rank" data-eid=/);
  assert.match(e.innerHTML, /live-toggle/);
  assert.ok(e.innerHTML.indexOf('live-sets') < e.innerHTML.indexOf('live-detail'));   // 試合の一覧の下
  assert.doesNotMatch(e.innerHTML, /live-pred-foot/);
  // 試合の行: 予想のある試合 (id 1、勝ち) は緑で +4.3、対戦中の試合は空
  assert.match(e.innerHTML, /<span class="m-delta" style="color:#16a34a">\+4\.3<\/span>/);
  // 対戦中の試合 (id 2) は「勝てば +7.0」、負けたときの値は出さない
  assert.match(e.innerHTML, /<span class="m-delta live-ifwin"><span class="live-ifwin-lbl">live\.pred\.if_win\{\}<\/span>\+7\.0<\/span>/);
  assert.strictEqual((e.innerHTML.match(/<span class="m-delta"><\/span>/g) || []).length, 0);   // 自分の試合 (id 1・2) は両方埋まる
  const e2 = el();
  L.render(e2, 11, [{ summary: {}, doc: doc() }], {}, null, [{ ...pred, counted: false, tjpr: null, bt: null }]);
  assert.match(e2.innerHTML, /live\.pred\.not_counted/);
  assert.doesNotMatch(e2.innerHTML, /live-rank/);
  const e3 = el();
  L.render(e3, 11, [{ summary: {}, doc: doc() }]);
  assert.doesNotMatch(e3.innerHTML, /live-pred|player\.performance/);
});

test('もう試合が無いか: 順位が確定して試合待ちが無い / 下位クラスで負けて終わった (ブラウザの読み直しを止める)', () => {
  const L = load();
  assert.strictEqual(L.isOut(doc(), 11), false);   // 勝ち残り
  assert.strictEqual(L.isOut(doc(), 33), false);   // 順位は確定でも対戦中のセットがある
  const d = doc();
  d.sets[1].winner = 1; d.sets[1].score = [2, 0]; d.sets[1].completed_at = 300;
  assert.strictEqual(L.isOut(d, 33), true);
  assert.strictEqual(L.isOut(d, 22), false);       // 下位クラスで試合待ち
  d.sets[2] = { id: 3, pg: 30, e: [2, 4], score: [0, 2], winner: 4, completed_at: 400 };
  assert.strictEqual(L.isOut(d, 22), true);
  assert.strictEqual(L.isOut(d, 99), false);       // 出ていない
});

test('ブラウザの読み直し: 試合が残っていれば 15 秒ごと、もう試合が無ければ読み直さずサーバの速報だけを 30 秒ごと', async () => {
  const run = async (uid, d) => {
    const timers = [];
    const calls = [];
    const fetch = async (url) => ({ ok: true, json: async () => (/index\.json$/.test(url)
      ? { events: [{ event_id: 5 }], players: { [uid]: [5] } } : d) });
    const document = { visibilityState: 'visible', addEventListener() {}, createElement: () => ({ addEventListener() {} }) };
    const L = load('', 'spsp.games', { fetch, document, SpspLogin: { apiAvailable: () => true },
      setTimeout: (f, ms) => { timers.push(ms); return 1; }, clearTimeout() {} });
    const section = { style: {}, appendChild() {}, querySelector: () => ({ innerHTML: '', addEventListener() {} }) };
    const browser = { status: () => 'on', pick: (x) => x, refresh: async (x) => { calls.push(x.event_id); return x; } };
    L.start(section, uid, { browser });
    for (let i = 0; i < 20 && !timers.length; i++) await new Promise((r) => setImmediate(r));
    return { timers, calls };
  };
  const live = await run(11, { ...doc(), event_id: 5 });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(live)), { timers: [15000], calls: [5] });
  const d = { ...doc(), event_id: 5 };
  d.sets[1].winner = 1; d.sets[1].score = [2, 0]; d.sets[1].completed_at = 300;
  const out = await run(33, d);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(out)), { timers: [30000], calls: [] });
});

test('次の相手が未定: 枠の前の試合をさかのぼって候補をシード順に (自分は出さない、決まった試合はそこで止まる)', () => {
  const L = load();
  const d = doc();
  Object.assign(d.entrants, {
    4: { tag: 'D', uid: 44, seed: 9, pg: 10 }, 5: { tag: 'E', uid: 55, seed: 4, pg: 10 },
    6: { tag: 'F', uid: 66, seed: 12, pg: 10 }, 7: { tag: 'G', uid: 77, seed: 6, pg: 10 },
  });
  d.sets = [
    { id: 1, pg: 10, round_text: 'WR1', e: [1, 2], score: [2, 1], winner: 1, completed_at: 100 },
    // A の次の試合: 相手の枠は試合 20 の勝者
    { id: 10, pg: 10, round_text: 'WQF', e: [1, null], score: [null, null], winner: null, pre: [['1', 1], ['20', 1]] },
    // 試合 20: D と、試合 21 の勝者 (E か F)
    { id: 20, pg: 10, round_text: 'WR2', e: [4, null], score: [null, null], winner: null, pre: [null, ['21', 1]] },
    { id: 21, pg: 10, round_text: 'WR1', e: [5, 6], score: [null, null], winner: null, state: 2 },
    { id: 22, pg: 10, round_text: 'WR1', e: [7, 3], score: [null, null], winner: null },
  ];
  const e = el();
  L.render(e, 11, [{ summary: {}, doc: d }]);
  const m = /<div class="live-cand">([\s\S]*?)<\/div>/.exec(e.innerHTML);
  assert.ok(m, 'candidates shown');
  assert.match(m[1], /live\.cand\{&quot;n&quot;:3\}/);
  const order = [...m[1].matchAll(/live-cand-p">(?:[^<]*<a[^>]*>)?([A-Z])/g)].map((x) => x[1]);
  assert.deepStrictEqual(order, ['E', 'D', 'F']);   // シード 4, 9, 12
  // 相手が決まった試合には候補を出さない
  const e2 = el();
  L.render(e2, 11, [{ summary: {}, doc: doc() }]);
  assert.doesNotMatch(e2.innerHTML, /live-cand/);
});

test('プールの欄 (参加予定の大会と同じ部品) をカードを開いた中に出す。無い部門には出さない', () => {
  const L = load();
  const e = el();
  const d = { ...doc(), event_id: 5 };
  L.render(e, 11, [{ summary: {}, doc: d }], {}, null, [], (eid) => (eid === '5' ? '<div class="pe-body">POOL</div>' : ''));
  assert.match(e.innerHTML, /<div class="live-detail pool-ev live-pool"><div class="pe-body">POOL<\/div><\/div>/);
  const e2 = el();
  L.render(e2, 11, [{ summary: {}, doc: { ...doc(), event_id: 6 } }], {}, null, [], (eid) => (eid === '5' ? 'x' : ''));
  assert.doesNotMatch(e2.innerHTML, /live-pool/);
});

test('出すまでを速く: 一覧で分かったら読み込み中、選手ごとの小さいファイルで描いてから部門のファイルで予想', async () => {
  const urls = [];
  const events = [];
  let releaseFull;
  const fullGate = new Promise((r) => { releaseFull = r; });
  const full = { ...doc(), event_id: 5, updated_at: 1800000000 };
  const slice = { ...full, slice: [2, 1], entrants: { 1: full.entrants[1], 2: full.entrants[2], 3: full.entrants[3] } };
  const fetch = async (url) => {
    urls.push(url.replace('https://data.spsp.games/live/jp/', ''));
    if (/index\.json$/.test(url)) return { ok: true, json: async () => ({ events: [{ event_id: 5, slices: 2 }], players: { 11: [5] } }) };
    if (/slices\/5\/2-1\.json$/.test(url)) return { ok: true, json: async () => slice };
    if (/events\/5\.json$/.test(url)) { await fullGate; return { ok: true, json: async () => full }; }
    return { ok: false, status: 404, json: async () => null };
  };
  const body = { innerHTML: '', textContent: '', addEventListener() {}, querySelectorAll: () => [] };
  Object.defineProperty(body, 'innerHTML', { set(v) { this._h = v; events.push('paint'); }, get() { return this._h || ''; } });
  const section = { style: { display: 'none' }, querySelector: () => body, appendChild() {} };
  const document = { visibilityState: 'hidden', addEventListener() {}, createElement: () => ({ addEventListener() {}, hidden: true, className: '' }) };
  const L = load('', 'spsp.games', { fetch, document, clearTimeout, setTimeout, SpspLogin: { apiAvailable: () => false } });
  const preds = [];
  L.start(section, 11, {
    loading: () => { events.push('loading:' + section.style.display); },
    predict: async (d) => { preds.push(!!d.slice); return null; },
  });
  await new Promise((r) => setTimeout(r, 20));
  // 部門のファイルが届く前に、小さいファイルでカードが出ている
  assert.deepStrictEqual(urls, ['index.json', 'slices/5/2-1.json', 'events/5.json']);
  assert.strictEqual(events[0], 'loading:');
  assert.ok(events.includes('paint'));
  assert.match(body.innerHTML, /live-group/);
  assert.strictEqual(section.style.display, '');
  assert.deepStrictEqual(preds, []);
  releaseFull();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepStrictEqual(preds, [false], '予想は部門のファイルで 1 回');
});

test('分けていない部門は部門のファイルをそのまま読む (小さいファイルを探さない)', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url.replace('https://data.spsp.games/live/jp/', ''));
    return { ok: true, json: async () => (/index\.json$/.test(url) ? { events: [{ event_id: 5 }], players: { 11: [5] } } : { ...doc(), event_id: 5 }) };
  };
  const L = load('', 'spsp.games', { fetch });
  const items = await L.load(11, true);
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual(urls, ['index.json', 'events/5.json']);
});

test('前に読んだものがあれば、読み直す前にまずそれで描き、届いたら差し替える (読み込み中は出さない)', async () => {
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
    get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null };
  const old = { ...doc(), event_id: 5, tournament_name: 'OLD', updated_at: 1800000000 };
  store.set('spsp_live_quick_11', JSON.stringify({ at: Date.now(), items: [{ summary: { event_id: 5 }, doc: old }] }));
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetch = async (url) => {
    await gate;
    return { ok: true, json: async () => (/index\.json$/.test(url) ? { events: [{ event_id: 5 }], players: { 11: [5] } } : { ...doc(), event_id: 5, tournament_name: 'NEW', updated_at: 1800000300 }) };
  };
  const body = { innerHTML: '', textContent: '', addEventListener() {}, querySelectorAll: () => [] };
  const section = { style: { display: 'none' }, querySelector: () => body, appendChild() {} };
  const document = { visibilityState: 'hidden', addEventListener() {}, createElement: () => ({ addEventListener() {}, hidden: true, className: '' }) };
  const L = load('', 'spsp.games', { fetch, document, clearTimeout, setTimeout, localStorage, SpspLogin: { apiAvailable: () => false } });
  let loading = 0;
  L.start(section, 11, { loading: () => { loading++; } });
  assert.match(body.innerHTML, /OLD/, '読む前に前の内容で描く');
  assert.strictEqual(section.style.display, '');
  release();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(body.innerHTML, /NEW/);
  assert.strictEqual(loading, 0);
  assert.match(store.get('spsp_live_quick_11'), /NEW/, '読んだものを置き直す');
  // 古すぎるものは使わない
  store.set('spsp_live_quick_11', JSON.stringify({ at: Date.now() - 13 * 3600 * 1000, items: [{ summary: { event_id: 5 }, doc: old }] }));
  const body2 = { innerHTML: '', textContent: '', addEventListener() {}, querySelectorAll: () => [] };
  const L2 = load('', 'spsp.games', { fetch: async () => new Promise(() => {}), document, clearTimeout, setTimeout, localStorage, SpspLogin: { apiAvailable: () => false } });
  L2.start({ style: { display: 'none' }, querySelector: () => body2, appendChild() {} }, 11, {});
  assert.strictEqual(body2.innerHTML, '');
});
