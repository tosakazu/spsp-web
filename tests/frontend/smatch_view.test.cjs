// tests/frontend/smatch_view.test.cjs — プレイヤーページのスマッチのレート (js/smatch_view.js): 2 つのルール、無い値は出さない、リンク先はスマッチだけ。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('i18n/ja.js'), ctx);
  const D = ctx.SPSP_I18N.ja;
  ctx.SPSPI18n = { t: (k, p) => String(D[k]).replace(/\{(\w+)\}/g, (_, n) => String((p || {})[n])) };
  ctx.escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  vm.runInContext(built('js/smatch_view.js'), ctx);
  return ctx.SpspSmatchView;
}
const V = load();
const view = (o) => ({ url: 'https://smatch-jp.com/user/1/', name: 'x', season: 'シーズン12', as_of: 1794700000,
  modes: { '1on1': { rate: 1650, rank: 120, season_max: 1700, max: 1720 }, tokuoma: { rate: 1500, rank: 40, season_max: 1510, max: 1600 } }, ...(o || {}) });

test('2 つのルールのレート・最高と、シーズン・日付が出る', () => {
  const h = V.smatchHtml(view());
  for (const s of ['スマッチ', '1on1', '特おま', '1650', '今季最高 1700', '通算最高 1720', '1500', 'シーズン12', '時点']) assert.ok(h.includes(s), s);
  assert.ok(!h.includes('120') && !h.includes('位'), 'スマッチ内の順位は出さない');
});

test('最高レートを見せない人 (season_max・max が null) は最高を出さない。今季の対戦数が 0 のルールは出さない', () => {
  const h = V.smatchHtml(view({ modes: { '1on1': { rate: 1650, rank: 120, season_max: null, max: null } } }));
  assert.ok(h.includes('1650') && !h.includes('最高') && !h.includes('特おま'));
  // 今季の対戦数が 0 のルールは行ごと出さない (games が無い古い形では rate が null のルール)
  assert.strictEqual(V.smatchHtml(view({ modes: { '1on1': { rate: null, rank: null, season_max: null, max: 1720 } } })), '');
  const z = V.smatchHtml(view({ modes: { '1on1': { rate: 1500, rank: null, season_max: null, max: 1720, games: 0 }, tokuoma: { rate: 1500, rank: 40, season_max: 1510, max: 1600, games: 3 } } }));
  assert.ok(!z.includes('1on1') && z.includes('特おま'));
});

test('出すものが無い・リンク先がスマッチでないときは何も出さない。名前などは HTML として解釈しない', () => {
  assert.strictEqual(V.smatchHtml(null), '');
  assert.strictEqual(V.smatchHtml(view({ modes: {} })), '');
  assert.strictEqual(V.smatchHtml(view({ modes: { '1on1': { rate: null, rank: null, season_max: null, max: null } } })), '');
  for (const u of ['javascript:alert(1)', 'https://evil.example/', 'http://smatch-jp.com/user/1/', 'https://smatch-jp.com.evil.example/']) assert.strictEqual(V.smatchHtml(view({ url: u })), '', u);
  assert.ok(!V.smatchHtml(view({ season: '<img src=x onerror=1>' })).includes('<img'));
});
