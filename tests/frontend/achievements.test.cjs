// tests/frontend/achievements.test.cjs — 実績 / 動的バッチの文言をフロントで組む契約 (js/achievements.js)。
// ビルド側 (spsp_scripts feat/achievement-kinds, tests/meta/test_achievement_kinds.py) が組んだ全件について、
// ja の辞書で組んだ文言がビルドの label と一致すること、en では日本語が残らないこと。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

const FIX = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/achievement_kinds.json'), 'utf8')).items;

function load(lang) {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  // ビルド済みページと同じ: <html lang data-lang-root> で言語が決まる
  ctx.document = { documentElement: { lang, hasAttribute: () => true }, querySelectorAll: () => [] };
  ctx.navigator = { languages: [lang], language: lang };
  ctx.location = { hostname: 'localhost', search: '' };
  ctx.Intl = Intl;
  vm.createContext(ctx);
  for (const f of ['region/config.js', 'i18n/ja.js', 'i18n/en.js', 'region/i18n.js', 'js/i18n.js', 'js/achievements.js']) vm.runInContext(built(f), ctx);
  return ctx;
}

test('ja: kind / params から組んだ文言はビルドの label と一致する (全 kind)', () => {
  const ctx = load('ja');
  assert.ok(FIX.length > 50, 'fixture が少ない');
  const kinds = new Set();
  for (const item of FIX) {
    kinds.add(item.kind);
    assert.strictEqual(ctx.SPSPAchievements.achievementLabel(item), item.label, JSON.stringify(item));
  }
  assert.deepStrictEqual([...kinds].sort(), ['climb', 'losers_run', 'matches', 'peak_rank', 'peak_tier', 'same_opp', 'spr', 'tour', 'tour_series', 'tours', 'trend', 'uf', 'wins']);
});

test('en: 全 kind が英語で組める (日本語が残らない。大会名は除く)', () => {
  const ctx = load('en');
  for (const item of FIX) {
    const s = ctx.SPSPAchievements.achievementLabel(item);
    assert.ok(s && s !== item.label, JSON.stringify(item) + ' → ' + s);
    assert.ok(!/[ぁ-んァ-ン一-龥]/.test(s), 'en に日本語: ' + s);
  }
});

test('kind が無い (古い出力) / 知らない kind は label をそのまま出す', () => {
  const ctx = load('en');
  assert.strictEqual(ctx.SPSPAchievements.achievementLabel({ label: '🏆 何か', cls: 'gold' }), '🏆 何か');
  assert.strictEqual(ctx.SPSPAchievements.achievementLabel({ label: 'X', kind: 'unknown', params: { a: 1 } }), 'X');
  assert.strictEqual(ctx.SPSPAchievements.achievementLabel(null), '');
});

test('旧出力 (kind 無し): 日本語の label から kind / params を復元し、kind 付きと同じ文言になる (全 92 件、ja / en)', () => {
  const ja = load('ja'), en = load('en');
  for (const item of FIX) {
    const legacy = { label: item.label, cls: item.cls };
    const parsed = ja.SPSPAchievements.parseLegacyLabel(item.label);
    assert.ok(parsed, '復元できない: ' + item.label);
    assert.strictEqual(parsed.kind === 'tour' || parsed.kind === 'tour_series' ? (item.kind === 'tour' || item.kind === 'tour_series') : parsed.kind === item.kind, true, item.label + ' → ' + parsed.kind);
    // 大会成績は ×1 のとき tour と tour_series の label が同じ形なので kind は一意に戻らない (文言は同じ)。それ以外は params も一致
    if (parsed.kind === item.kind) assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed.params)), item.params, item.label);   // vm の realm が違うので prototype を無視
    assert.strictEqual(ja.SPSPAchievements.achievementLabel(legacy), item.label);
    assert.strictEqual(en.SPSPAchievements.achievementLabel(legacy), en.SPSPAchievements.achievementLabel(item), item.label);
  }
  // 形が違うものは触らない
  assert.strictEqual(en.SPSPAchievements.achievementLabel({ label: '🏆 何か', cls: 'gold' }), '🏆 何か');
});
