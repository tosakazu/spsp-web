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
    stdin: { contents: "import C from './site/js/player_card.js'; import { cardAchievements, hideCardRanks, noDataCardModel } from './site/js/player_card_model.js'; import { achievementLabelHidden } from './site/js/achievements.js'; window.__t = { C, hideCardRanks, noDataCardModel, cardAchievements, achievementLabelHidden };", resolveDir: ROOT, loader: 'js' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'esnext', charset: 'utf8', logLevel: 'silent', absWorkingDir: ROOT,
  }).outputFiles[0].text;
  const dom = new JSDOM('<div id="c" class="pcard"></div>', { url: 'https://example.test/jp/report/', runScripts: 'outside-only', pretendToBeVisual: true });
  for (const f of ['region/config.js', 'i18n/ja.js', 'region/i18n.js']) dom.window.eval(built(f));
  dom.window.eval(code);
  return dom.window;
}

test('hideCardRanks: 順位は ?? / ?、Lv は Lv?、大会で取った順位は ?、実績の順位も ? (大会名は残す)', { skip }, () => {
  const w = load();
  const { C, hideCardRanks, noDataCardModel } = w.__t;
  const m = { ...noDataCardModel('Player'), rank: 123, loc: { text: '東京都', rank: 3 }, pills: [{ text: '全一 マリオ' }, { text: 'Lv5👑', lv: true }],
    achievements: [{ label: '🏆 ウメブラ 優勝', hidden: '🎮 ウメブラ ?位' }, { label: '⚔ 試合数 100+' }],
    chars: [{ name: 'マリオ', main: true, rank: 5 }, { name: 'ルイージ', main: false, rank: null }],
    latest: { name: '大会', date: '2026-11-01', place: 1, placeUnit: '位', nent: 64, dq: false, perfRank: 8, perfLv: 'Lv5🥇', rankBefore: 130, rankAfter: 123 },
    totalTournaments: 10, totalMatches: 40 };
  const h = hideCardRanks(m);
  assert.deepStrictEqual([h.rank, h.loc.rank, h.chars[0].rank, h.chars[1].rank], ['??', '??', '??', null]);
  assert.deepStrictEqual([h.latest.perfRank, h.latest.rankBefore, h.latest.rankAfter, h.latest.perfLv, h.latest.place], ['??', '??', '??', 'Lv?', '?']);
  assert.deepStrictEqual(h.pills.map((p) => p.text), ['全一 マリオ', 'Lv?']);
  assert.deepStrictEqual(h.achievements.map((a) => a.label), ['🎮 ウメブラ ?位', '⚔ 試合数 100+']);
  assert.deepStrictEqual([h.latest.name, h.latest.nent], ['大会', 64], 'どの大会か (名前・人数) はそのまま');
  assert.strictEqual(m.rank, 123, '元のモデルは変えない');
  const el = w.document.getElementById('c');
  C.render(el, h);
  const txt = el.textContent;
  assert.match(el.querySelector('.pc-big-n').textContent, /^\?\?$/);
  assert.strictEqual(el.querySelector('.pc-loc-rank').textContent, '#??');
  assert.strictEqual(el.querySelector('.pc-char-rank').textContent, '#??');
  assert.deepStrictEqual([...el.querySelectorAll('.pc-upd-num')].map((x) => x.textContent), ['??', '??']);
  assert.strictEqual(el.querySelector('.pc-perf-num').textContent, '??');
  assert.ok(!/123|130|👑|🥇|優勝|Lv5/.test(txt), txt);
  assert.match(el.querySelector('.pc-place-row').textContent, /^\?位$/);
  assert.match(txt, /ウメブラ/);
  // 隠さなければ数字が出る
  C.render(el, m);
  assert.strictEqual(el.querySelector('.pc-big-n').textContent, '123');
  w.close();
});

test('実績の文字 (順位を隠す): 大会の成績は大会名を残して ?位 (印も隠す)、最高順位・最高 Lv・上昇は ?、ほかはそのまま', { skip }, () => {
  const w = load();
  const { achievementLabelHidden: H, cardAchievements } = w.__t;
  assert.strictEqual(H({ kind: 'tour', params: { name: 'ウメブラ', bucket: 'win', count: 2 } }), '🎮 ウメブラ ?位 ×2');
  assert.strictEqual(H({ kind: 'tour', params: { name: 'カゲウラ', bucket: 'top8', cls: 'B' } }), '🎮 カゲウラ Bクラス ?位');
  assert.strictEqual(H({ kind: 'tour_series', params: { series: '篝火', bucket: '3rd' } }), '🎮 篝火 ?位');
  assert.strictEqual(H({ kind: 'peak_rank', params: { top: 10 } }), '🎯 最高 全国 ?位');
  assert.strictEqual(H({ kind: 'peak_tier', params: { lv: 5, tier: 'crown' } }), '🎖 最高 Lv? 到達');
  assert.strictEqual(H({ kind: 'climb', params: { n: 300 } }), '🚀 1ヶ月で +? ランク上昇');
  assert.strictEqual(H({ kind: 'matches', params: { n: 100 } }), '⚔ 試合数 100+');
  // カードの実績の一覧にも隠した文字 (「達成」は省く)
  const list = cardAchievements({ meta: { eval_date: '2026-11-01' }, player: { tournaments: [], achievements: [{ kind: 'tour', params: { name: 'ウメブラ', bucket: 'top16' } }, 'lv5_reached'] } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(list.map((a) => [a.label, a.hidden]))), [['🏅 ウメブラ Top 16 以上', '🎮 ウメブラ ?位'], ['🥇 Lv5 到達', 'Lv? 到達']]);
  w.close();
});
