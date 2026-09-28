'use strict';
// js/char_emoji.js: キャラ絵文字の表はフロントが持つ (2026-09-28)。ランキング行は main_char_id を表で引き、無ければ埋め込みの main_char_emoji
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

const TABLE = JSON.parse(fs.readFileSync(path.join(__dirname, '../../site/data/char_emoji.json'), 'utf8'));

function load(fetchImpl) {
  const w = { SPSP: { root: '../' }, document: {}, fetch: fetchImpl };
  w.window = w; w.globalThis = w;
  vm.runInNewContext(built('js/char_emoji.js'), w);
  return w.SPSPCharEmoji;
}

test('表の URL はサイトのルート (データの置き場ではない)', () => {
  const E = load(() => new Promise(() => {}));
  assert.strictEqual(E.url(), '../data/char_emoji.json');
});

test('main_char_id があれば表で引き、無ければ埋め込みの絵文字、どちらも無ければ空', async () => {
  const E = load(async () => ({ ok: true, json: async () => TABLE }));
  await E.load();
  assert.strictEqual(E.emojiOf(1304), TABLE['1304'].emoji);
  assert.strictEqual(E.rowEmoji({ main_char_id: 1304, main_char_emoji: 'X' }), TABLE['1304'].emoji, 'ID を優先');
  assert.strictEqual(E.rowEmoji({ main_char_emoji: '⛏️' }), '⛏️', 'ID が無い (今の出力)');
  assert.strictEqual(E.rowEmoji({ main_char_id: 99999999, main_char_emoji: '⛏️' }), '⛏️', '表に無い ID');
  assert.strictEqual(E.rowEmoji({}), '');
});

test('表が読めなくても埋め込みの絵文字で出る', async () => {
  const E = load(async () => { throw new Error('offline'); });
  await E.load();
  assert.strictEqual(E.rowEmoji({ main_char_id: 1304, main_char_emoji: '🗡️' }), '🗡️');
});
