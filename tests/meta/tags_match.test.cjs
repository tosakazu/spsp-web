// tests/meta/tags_match.test.cjs — ビルドの新しい出力 (spsp_scripts feat/output-ids: tags 配列、bracket_type) と旧出力 (is_* フラグ、
// 日本語のカテゴリ名だけ) の両方を、js/tags.js と js/match.js が同じに扱うこと。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load(lang) {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { documentElement: { lang, hasAttribute: () => true }, querySelectorAll: () => [] };
  ctx.navigator = { languages: [lang], language: lang };
  ctx.location = { hostname: 'localhost', search: '' };
  ctx.Intl = Intl;
  vm.createContext(ctx);
  for (const f of ['region/config.js', 'i18n/ja.js', 'i18n/en.js', 'region/i18n.js', 'js/i18n.js', 'js/tags.js', 'js/match.js']) vm.runInContext(built(f), ctx);
  return ctx;
}

test('tags.js: tags 配列と is_* フラグで同じタグが出る', () => {
  const { SPSPTags: T } = load('ja');
  const cls = { wk: 'wk', wd: 'wd', resume: 'r', gf: 'g', pre: 'p', res: 'res', lc: 'lc', uchi: 'u', special: 's' };
  const pairs = [
    [{ is_weekend: true, is_weekend_real: true, is_pre: false, is_uchi: true, is_restricted: true }, { tags: ['weekend', 'weekend_real', 'restricted', 'uchi'] }],
    [{ is_weekend: true, is_weekend_real: false }, { tags: ['weekend'] }],                 // 実質平日
    [{ is_weekend: false, is_weekend_real: true, is_pre: false }, { tags: ['weekend_real'] }],   // 実質休日
    [{ is_weekend: false, is_weekend_real: false, is_pre: true }, { tags: ['pre'] }],
    [{ is_awaiting_resume: true, is_gf_missing: true }, { tags: ['gf_missing', 'awaiting_resume'] }],
  ];
  for (const [flags, tagged] of pairs) {
    assert.strictEqual(T.dayTag(tagged, cls), T.dayTag(flags, cls), JSON.stringify(tagged));
    assert.strictEqual(T.statusTag(tagged, cls), T.statusTag(flags, cls), JSON.stringify(tagged));
    assert.deepStrictEqual(T.flagTags(tagged, cls), T.flagTags(flags, cls), JSON.stringify(tagged));
  }
  assert.strictEqual(T.flag({ tags: ['uchi'] }, 'uchi'), true);
  assert.strictEqual(T.flag({ is_uchi: true }, 'uchi'), true);
  assert.strictEqual(T.flag({ tags: [] }, 'uchi'), false);
});

test('match.js: bracket_type があれば辞書で (英語ページでは Round robin)、無ければビルドの日本語のまま', () => {
  const ja = load('ja').SPSPMatch, en = load('en').SPSPMatch;
  assert.strictEqual(ja.compactBracketLabel('総当たり', '', 'ROUND_ROBIN'), '総当たり');
  assert.strictEqual(en.compactBracketLabel('総当たり', '', 'ROUND_ROBIN'), 'Round robin');
  assert.strictEqual(en.compactBracketLabel('スイスドロー', '', 'SWISS'), 'Swiss');
  assert.strictEqual(en.compactBracketLabel('レート戦', '', 'MATCHMAKING'), 'Matchmaking');   // smash_database redownload_matches_v2.py _BT_LABEL の 3 つ目
  assert.strictEqual(en.compactBracketLabel('総当たり', ''), '総当たり');               // 旧出力 (bracket_type 無し)
  assert.strictEqual(en.compactBracketLabel('B-総当たり', '', 'ROUND_ROBIN'), 'B-Round robin');
  assert.strictEqual(en.compactBracketLabel('Winners TOP 8', 'Winners Round 1', 'DOUBLE_ELIMINATION'), 'W.Top8');
});
