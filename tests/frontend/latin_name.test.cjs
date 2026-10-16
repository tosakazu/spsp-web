// tests/frontend/latin_name.test.cjs — カード裏面の英字の名前 (js/latin_name.js): 英数字はそのまま、かなはローマ字、漢字は残す、「日本語/英字」は英字の側。
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/latin_name.js'), ctx);
  return ctx.SpspLatinName;
}
const L = load();

test('英数字だけはそのまま (全角は半角に)', () => {
  assert.strictEqual(L.autoLatin('Hurt'), 'Hurt');
  assert.strictEqual(L.autoLatin('Sparg0'), 'Sparg0');
  assert.strictEqual(L.autoLatin('ＡＢＣ１２'), 'ABC12');
  assert.strictEqual(L.autoLatin('ºϖº'), 'ºϖº');   // 日本語でない記号は触らない
});

test('かな・カナはローマ字 (ヘボン式・小文字、促音は重ねる、「ー」は書かない)', () => {
  assert.strictEqual(L.autoLatin('カヲル'), 'kaworu');
  assert.strictEqual(L.autoLatin('らる'), 'raru');
  assert.strictEqual(L.autoLatin('まっちゃ'), 'matcha');
  assert.strictEqual(L.autoLatin('ラックス'), 'rakkusu');
  assert.strictEqual(L.autoLatin('ふぁいやー'), 'faiya');
  assert.strictEqual(L.autoLatin('ヴィクトリー'), 'vikutori');
  assert.strictEqual(L.autoLatin('ポケモン・トレーナー'), 'pokemon torena');
  assert.strictEqual(L.autoLatin('ﾗﾘｯｸｽ'), 'rarikkusu');   // 半角カナ
  assert.strictEqual(L.autoLatin('ラリックス　　'), 'rarikkusu');
});

test('英字とかなが混ざるときはかなだけローマ字。漢字は残す', () => {
  assert.strictEqual(L.autoLatin('あcola'), 'acola');
  assert.strictEqual(L.autoLatin('TG(トリグリ)'), 'TG(toriguri)');
  assert.strictEqual(L.autoLatin('ふららら麺'), 'furarara麺');
  assert.strictEqual(L.autoLatin('黒船'), '黒船');
});

test('「日本語/英字」は英字の側だけ (順番はどちらでも)。両側とも日本語なら全体をローマ字に', () => {
  assert.strictEqual(L.autoLatin('マイルドなH.O/Mild na H.O'), 'Mild na H.O');
  assert.strictEqual(L.autoLatin('たいけい/Taikei'), 'Taikei');
  assert.strictEqual(L.autoLatin('雨飴/uame'), 'uame');
  assert.strictEqual(L.autoLatin('Marcos/まるこす'), 'Marcos');
  assert.strictEqual(L.autoLatin('夏 / Natsu'), 'Natsu');
  assert.strictEqual(L.autoLatin('あ/い'), 'a/i');
});

test('登録した英字名があればそれ。英字名の形 (サーバと同じ)', () => {
  assert.strictEqual(L.cardLatinName('カヲル', 'Kaworu'), 'Kaworu');
  assert.strictEqual(L.cardLatinName('カヲル', null), 'kaworu');
  assert.strictEqual(L.cardLatinName('カヲル', ''), 'kaworu');
  for (const ok of ['kaworu', 'Mild na H.O', 'x'.repeat(30)]) assert.ok(L.latinNameValid(ok), ok);
  for (const bad of ['', ' a', 'a ', 'a  b', 'x'.repeat(31), 'カヲル', 'ａｂ']) assert.ok(!L.latinNameValid(bad), bad);
});
