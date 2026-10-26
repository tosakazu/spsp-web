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
  for (const m of ['js/match.js', 'js/format.js', 'js/links.js', 'js/live.js']) vm.runInContext(built(m), ctx);
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
  assert.match(e.innerHTML, /href="https:\/\/www\.start\.gg\/x\/brackets\/1\/10"/);
  assert.match(e.innerHTML, /T&lt;1&gt;/);
  assert.ok(e.innerHTML.indexOf('live.playing') < e.innerHTML.indexOf('2-1'));
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

test('出ていない部門は描かない', () => {
  assert.strictEqual(load().render(el(), 99, [{ summary: {}, doc: doc() }]), 0);
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
