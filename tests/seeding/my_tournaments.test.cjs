'use strict';
// シードツールの「あなたが管理している大会」(seeding/app/60_upcoming.js loadMyTournaments):
// start.gg の currentUser.tournaments (tournamentView admin) から、開催中・これからの SSBU の大会だけを
// 開催中 → 近い順に並べる。取れない・0 件なら欄ごと出さない。
const test = require('node:test');
const assert = require('node:assert');
const { built } = require('../helpers/built.cjs');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }

const NOW = 1793000000;
const H = 3600;
const ev = (name, slug, game) => ({ name, slug, numEntrants: 8, videogame: { id: game } });
const NODES = [
  { id: 1, name: '終わった大会', slug: 'tournament/past', startAt: NOW - 3 * 86400, endAt: NOW - 2 * 86400, events: [ev('Singles', 'tournament/past/event/s', 1386)] },
  { id: 2, name: '来週の大会', slug: 'tournament/next', startAt: NOW + 7 * 86400, endAt: NOW + 7 * 86400 + 6 * H, events: [ev('Singles', 'tournament/next/event/s', 1386)] },
  { id: 3, name: '別ゲームだけ', slug: 'tournament/other', startAt: NOW + 86400, endAt: NOW + 86400, events: [ev('Melee', 'tournament/other/event/m', 1)] },
  { id: 4, name: '開催中の大会', slug: 'tournament/live', startAt: NOW - 2 * H, endAt: NOW + 4 * H, city: '渋谷区',
    events: [ev('Singles', 'tournament/live/event/s', 1386), ev('Melee', 'tournament/live/event/m', 1), ev('Bクラス', 'tournament/live/event/b', 1386)] },
  { id: 5, name: '明日の大会', slug: 'tournament/tomorrow', startAt: NOW + 30 * H, endAt: NOW + 36 * H, events: [ev('Singles', 'tournament/tomorrow/event/s', 1386)] },
];

function setup(respond) {
  const dom = new JSDOM(`<div id="mytours-box" class="upcoming-box open" style="display:none"><span id="mytours-count"></span><div id="mytours-list"></div></div>
    <input id="event-url"><div id="status"></div>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const calls = [];
  w.Date.now = () => NOW * 1000;
  w.S = {};
  w.i18n = (k) => k;
  w.escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  w.handleFetch = () => calls.push(['fetch', w.document.getElementById('event-url').value]);
  w.startggQuery = async (token, q, vars) => { calls.push(['query', token, vars.page]); return respond(vars.page); };
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.eval(built('seeding/app/60_upcoming.js').replace(/\}\)\(\);\n$/, 'window.__t = { loadMyTournaments };\n})();\n'));
  return { w, calls };
}

test('開催中 → 近い順。終わった大会・SSBU の event が無い大会は出さない。SSBU の event だけ数える', { skip: !JSDOM }, async () => {
  const { w, calls } = setup(() => ({ currentUser: { tournaments: { nodes: NODES } } }));
  await w.__t.loadMyTournaments(' tok ');
  const box = w.document.getElementById('mytours-box');
  assert.strictEqual(box.style.display, '');
  const rows = [...w.document.querySelectorAll('#mytours-list .upcoming-item')];
  assert.deepStrictEqual(rows.map((r) => r.querySelector('.ev-name').textContent), ['開催中の大会', '明日の大会', '来週の大会']);
  assert.ok(rows[0].querySelector('.ev-live'));
  assert.ok(!rows[1].querySelector('.ev-live'));
  assert.match(rows[0].querySelector('.row-2').textContent, /2 event/);
  assert.strictEqual(w.document.getElementById('mytours-count').textContent, '3');
  assert.deepStrictEqual(calls, [['query', 'tok', 1]]);   // 20 件未満なので 1 ページだけ
  // 1 event の大会を押すとその event の URL を入れて読み込む
  rows[1].click();
  assert.deepStrictEqual(calls[1], ['fetch', 'https://www.start.gg/tournament/tomorrow/event/s']);
  // 複数 event の大会は選択肢を開く (SSBU の 2 つだけ)
  rows[0].click();
  assert.deepStrictEqual([...rows[0].querySelectorAll('.ev-event-name')].map((e) => e.textContent), ['Singles', 'Bクラス']);
});

test('取れない・0 件・トークン無しなら欄を出さない。同じトークンでは取り直さない', { skip: !JSDOM }, async () => {
  let fail = true;
  const { w, calls } = setup(() => { if (fail) throw new Error('Invalid authentication token'); return { currentUser: { tournaments: { nodes: [] } } }; });
  const box = w.document.getElementById('mytours-box');
  await w.__t.loadMyTournaments('bad');
  assert.strictEqual(box.style.display, 'none');
  await w.__t.loadMyTournaments('bad');
  assert.strictEqual(calls.length, 1);
  fail = false;
  await w.__t.loadMyTournaments('good');
  assert.strictEqual(box.style.display, 'none');
  await w.__t.loadMyTournaments('');
  assert.strictEqual(box.style.display, 'none');
  assert.strictEqual(calls.length, 2);
});
