'use strict';
// js/char_emoji.js: キャラ絵文字の表はフロントが持つ (2026-09-28)。ランキング行は main_char_id を表で引く (行の main_char_emoji は 2026-09-29 に廃止)
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

test('main_char_id を表で引く。ID が無い・表に無い ID は空', async () => {
  const E = load(async () => ({ ok: true, json: async () => TABLE }));
  await E.load();
  assert.strictEqual(E.emojiOf(1304), TABLE['1304'].emoji);
  assert.strictEqual(E.rowEmoji({ main_char_id: 1304 }), TABLE['1304'].emoji);
  assert.strictEqual(E.rowEmoji({ main_char_id: '1304' }), TABLE['1304'].emoji, '文字列の ID');
  assert.strictEqual(E.rowEmoji({ main_char_id: 99999999 }), '', '表に無い ID');
  assert.strictEqual(E.rowEmoji({ main_char_id: null }), '');
  assert.strictEqual(E.rowEmoji({}), '');
});

test('表が読めなければ空 (落ちない)', async () => {
  const E = load(async () => { throw new Error('offline'); });
  await E.load();
  assert.strictEqual(E.rowEmoji({ main_char_id: 1304 }), '');
});
