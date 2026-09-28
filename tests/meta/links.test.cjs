'use strict';
// js/links.js: 選手ページの URL は discriminator (p/?d=) が既定で、表 (data/discriminators.json) を読む前や表に無い選手は uid (p/?uid=)。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* jsdom 無し: DOM を使うテストは skip */ }

const SRC = require('../helpers/built.cjs').built('js/links.js');
const TABLE = { '1787719': '830dec1e', '1002311': 'd8016ec8' };

function makeLinks(opts) {
  const w = opts && opts.window ? opts.window : {};
  w.fetch = (url) => { w.__fetched = url; return Promise.resolve({ ok: true, json: () => Promise.resolve(TABLE) }); };
  if (!w.document) w.document = { querySelectorAll: () => [] };
  vm.runInNewContext(SRC, { window: w, globalThis: w, Promise, Array, Object, String, parseInt, RegExp });
  return w;
}

test('表を読む前は ?uid=、読んだ後は ?d=。表に無い uid は ?uid= のまま', async () => {
  const w = makeLinks();
  const L = w.SPSPLinks;
  assert.strictEqual(L.playerHref('../', 1787719), '../p/?uid=1787719');   // 初回: 表はまだ無い (読み始める)
  assert.strictEqual(w.__fetched, '../data/discriminators.json');
  await L.loadDiscriminators('../');
  assert.strictEqual(L.playerHref('../', 1787719), '../p/?d=830dec1e');
  assert.strictEqual(L.playerHref('', 1787719), 'p/?d=830dec1e');
  assert.strictEqual(L.playerHref(L.SELF, 1787719), '?d=830dec1e');
  assert.strictEqual(L.playerHref('../', 999), '../p/?uid=999');
  assert.strictEqual(L.discOf(1002311), 'd8016ec8');
  assert.strictEqual(L.uidOfDisc('D8016EC8'), 1002311);
  assert.strictEqual(L.uidOfDisc('zzzz'), null);
});

test('config の dataRoot があれば表はそこから読む', () => {
  const w = makeLinks({ window: { SPSP: { site: { dataRoot: 'https://data.example/' } } } });
  w.SPSPLinks.playerHref('../', 1);
  assert.strictEqual(w.__fetched, 'https://data.example/data/discriminators.json');
});

test('表を読んだら document 内の p/?uid= リンクだけ ?d= に書き換える (sim/?uid= は触らない)', async (t) => {
  if (!JSDOM) return t.skip('jsdom 無し');
  const dom = new JSDOM('<a id="a" href="../p/?uid=1787719">x</a><a id="b" href="p/?uid=999">y</a><a id="c" href="../sim/?uid=1787719">z</a><a id="d" href="?uid=1787719">w</a>',
    { url: 'https://spsp.games/t/' });
  const w = makeLinks({ window: { document: dom.window.document, location: dom.window.location } });
  await w.SPSPLinks.loadDiscriminators('../');
  const g = (id) => dom.window.document.getElementById(id).getAttribute('href');
  assert.strictEqual(g('a'), '../p/?d=830dec1e');
  assert.strictEqual(g('b'), 'p/?uid=999', '表に無い uid はそのまま');
  assert.strictEqual(g('c'), '../sim/?uid=1787719', '別ページの uid は触らない');
  assert.strictEqual(g('d'), '?uid=1787719', '選手ページ以外の相対 ?uid= は触らない');
  const dom2 = new JSDOM('<a id="d" href="?uid=1787719#h2h">w</a>', { url: 'https://spsp.games/p/' });
  const w2 = makeLinks({ window: { document: dom2.window.document, location: dom2.window.location } });
  await w2.SPSPLinks.loadDiscriminators(w2.SPSPLinks.SELF);
  assert.strictEqual(dom2.window.document.getElementById('d').getAttribute('href'), '?d=830dec1e#h2h', '選手ページ自身の相対リンクは書き換える');
});
