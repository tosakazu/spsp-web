'use strict';
// tests/frontend/card_hide_ranks.test.cjs — カードの SPSP 順位を隠す (結果報告の「SPSP 順位を表示」、2026-11-11)。
// js/player_card_model.js の hideCardRanks で総合評価・都道府県・キャラの順位、パフォーマンス、Rank Update が ?? に、Lv の印が外れる。
// js/player_card_embed.js の setCardRanksHidden / redrawCards は report_page.test.cjs (画面) で見る
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }
let esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* skip */ }
const skip = !JSDOM || !esbuild ? 'jsdom / esbuild が無い' : false;
const ROOT = path.resolve(__dirname, '../..');
const { built } = require('../helpers/built.cjs');

function load() {
  const code = esbuild.buildSync({
    stdin: { contents: "import C from './site/js/player_card.js'; import { hideCardRanks, noDataCardModel } from './site/js/player_card_model.js'; window.__t = { C, hideCardRanks, noDataCardModel };", resolveDir: ROOT, loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'esnext', charset: 'utf8', logLevel: 'silent', absWorkingDir: ROOT,
  }).outputFiles[0].text;
  const dom = new JSDOM('<div id="c" class="pcard"></div>', { url: 'https://example.test/jp/report/', runScripts: 'outside-only', pretendToBeVisual: true });
  for (const f of ['region/config.js', 'i18n/ja.js', 'region/i18n.js']) dom.window.eval(built(f));
  dom.window.eval(code);
  return dom.window;
}

test('hideCardRanks: 順位はすべて ?? (無いものは無いまま)、Lv の印は外す、ほかはそのまま', { skip }, () => {
  const w = load();
  const { C, hideCardRanks, noDataCardModel } = w.__t;
  const m = { ...noDataCardModel('Player'), rank: 123, loc: { text: '東京都', rank: 3 }, pills: [{ text: '全一 マリオ' }, { text: 'Lv5👑' }],
    chars: [{ name: 'マリオ', main: true, rank: 5 }, { name: 'ルイージ', main: false, rank: null }],
    latest: { name: '大会', date: '2026-11-01', place: 1, placeUnit: '位', nent: 64, dq: false, perfRank: 8, perfLv: 'Lv5🥇', rankBefore: 130, rankAfter: 123 },
    totalTournaments: 10, totalMatches: 40 };
  const h = hideCardRanks(m);
  assert.deepStrictEqual([h.rank, h.loc.rank, h.chars[0].rank, h.chars[1].rank], ['??', '??', '??', null]);
  assert.deepStrictEqual([h.latest.perfRank, h.latest.rankBefore, h.latest.rankAfter, h.latest.perfLv], ['??', '??', '??', 'Lv5']);
  assert.deepStrictEqual(h.pills.map((p) => p.text), ['全一 マリオ', 'Lv5']);
  assert.strictEqual(h.latest.place, 1, '大会の順位 (何位だったか) はそのまま');
  assert.strictEqual(m.rank, 123, '元のモデルは変えない');
  const el = w.document.getElementById('c');
  C.render(el, h);
  const txt = el.textContent;
  assert.match(el.querySelector('.pc-big-n').textContent, /^\?\?$/);
  assert.strictEqual(el.querySelector('.pc-loc-rank').textContent, '#??');
  assert.strictEqual(el.querySelector('.pc-char-rank').textContent, '#??');
  assert.deepStrictEqual([...el.querySelectorAll('.pc-upd-num')].map((x) => x.textContent), ['??', '??']);
  assert.strictEqual(el.querySelector('.pc-perf-num').textContent, '??');
  assert.ok(!/123|130|👑|🥇/.test(txt), txt);
  // 隠さなければ数字が出る
  C.render(el, m);
  assert.strictEqual(el.querySelector('.pc-big-n').textContent, '123');
  w.close();
});
