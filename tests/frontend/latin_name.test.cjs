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

test('英字とかなが混ざるときはかなだけローマ字。漢字は飛ばす (漢字だけの名前は元のまま)', () => {
  assert.strictEqual(L.autoLatin('あcola'), 'acola');
  assert.strictEqual(L.autoLatin('TG(トリグリ)'), 'TG(toriguri)');
  assert.strictEqual(L.autoLatin('ふららら麺'), 'furarara');
  assert.strictEqual(L.autoLatin('こーう遅延して'), 'kou shite');
  assert.strictEqual(L.autoLatin('黒船'), '黒船');
  assert.strictEqual(L.autoLatin('リノハ [休日はポゴ]'), 'rinoha [hapogo]');
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
  for (const ok of ['kaworu', 'Mild na H.O', 'Sparg0', 'Fly High!', "K.O-kun's_2+&?", 'x'.repeat(45)]) assert.ok(L.latinNameValid(ok), ok);
  for (const bad of ['', ' a', 'a ', 'a  b', 'x'.repeat(46), 'カヲル', 'ａｂ', 'a/b', 'a(b)', 'a#', '!!']) assert.ok(!L.latinNameValid(bad), bad);
});

test('読みの表 (名前 → 漢字をひらがなにした名前) があればそれをローマ字に。表に無い漢字は飛ばす', () => {
  const R = { 黒船: 'くろふね', 'ドラ右': 'ドラみぎ', 'ふららら麺': 'ふらららめん' };
  assert.strictEqual(L.autoLatin('黒船', R), 'kurofune');
  assert.strictEqual(L.autoLatin('ドラ右', R), 'doramigi');
  assert.strictEqual(L.autoLatin('ふららら麺', R), 'furararamen');
  assert.strictEqual(L.autoLatin('水無灯里', R), '水無灯里');
  assert.strictEqual(L.cardLatinName('黒船', 'Kurofune', R), 'Kurofune');   // 登録した英字名が先
  assert.ok(L.hasKanji('黒船') && L.hasKanji('〆') && !L.hasKanji('カヲル'));
  assert.strictEqual(L.autoLatin('ダークサムス様', { 'ダークサムス様': 'dark samus sama' }), 'dark samus sama');   // 確認ページで直した英字名
  assert.strictEqual(L.autoLatin('ハツカミ/初雷', {}), 'hatsukami');   // 飛ばした漢字の前の区切りは残さない
});
