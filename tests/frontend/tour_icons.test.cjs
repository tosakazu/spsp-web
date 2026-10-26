// tests/frontend/tour_icons.test.cjs — 大会アイコンの縮小版 (js/tour_icons.js): 見えたものだけ src を入れ、表 (events.json) は 1 回だけ読む。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load({ tourIcons = 'https://data.spsp.games/images/tournament/', withIO = true } = {}) {
  const fetched = [];
  const observed = [];
  const ctx = {
    console,
    SPSP: { site: { tourIcons } },
    escapeHtml: (s) => String(s).replace(/"/g, '&quot;'),
    fetch: async (url) => { fetched.push(url); return { ok: true, json: async () => ({ v: 1, files: ['t/a.webp'], e: { 5: 0 } }) }; },
  };
  if (withIO) {
    ctx.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { observed.push([this, el]); } unobserve() {} };
  }
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/tour_icons.js'), ctx);
  return { I: ctx.SpspTourIcons, fetched, observed };
}
function img(eid) {
  const el = { dataset: { eid: String(eid) }, src: '', removed: false, remove() { this.removed = true; } };
  return el;
}
const root = (imgs) => ({ querySelectorAll: () => imgs });
const flush = () => new Promise((r) => setTimeout(r, 0));

test('html: 地域に置き場が無い・部門 ID が無いときは空', () => {
  assert.strictEqual(load({ tourIcons: '' }).I.html(5), '');
  assert.strictEqual(load().I.html(null), '');
  assert.match(load().I.html(5, 'lr-icon'), /^<img class="tour-icon lr-icon" data-eid="5"/);
});

test('fill: 見えるまでは読まない。見えたら表を 1 回読んで src、表に無い部門は外す', async () => {
  const { I, fetched, observed } = load();
  const a = img(5), b = img(6);
  I.fill(root([a, b]));
  await flush();
  assert.strictEqual(fetched.length, 0);
  for (const [obs, el] of observed) obs.cb([{ isIntersecting: true, target: el }]);
  await flush(); await flush();
  assert.deepStrictEqual(fetched, ['https://data.spsp.games/images/tournament/events.json']);
  assert.strictEqual(a.src, 'https://data.spsp.games/images/tournament/t/a.webp');
  assert.strictEqual(b.removed, true);
});
