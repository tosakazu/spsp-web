// tests/frontend/card_back_guide.test.cjs — シール編集の使い方ガイド (src/pages/card_back_guide.js): 全部の段を進められる・
// メニューの中の段ではメニューを開く・閉じると見たことになる・文言が ja / en にある
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');

test('ガイド: 段を進める・メニューを開く・閉じると見たことになる', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'site/p/edit.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://spsp.games/jp/p/edit', pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'localStorage']) {
    try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch (e) { /* 読み取り専用 */ }
  }
  const G = await import(pathToFileURL(path.join(ROOT, 'src/pages/card_back_guide.js')).href);
  assert.strictEqual(G.guideSeen(), false);
  G.startGuide();
  const d = w.document;
  const menu = d.getElementById('bz-menu');
  const opened = [];
  let n = 0;
  while (d.querySelector('.bzg')) {
    opened.push(menu.open);
    /** @type {any} */ (d.querySelector('.bzg-next')).click();
    assert.ok(++n < 30, '終わらない');
  }
  assert.deepStrictEqual(opened, [false, false, false, false, false, true, true, true, false]);
  assert.strictEqual(menu.open, false);
  assert.strictEqual(G.guideSeen(), true);
  // 出し直し → 閉じる
  G.startGuide();
  /** @type {any} */ (d.querySelector('.bzg-skip')).click();
  assert.strictEqual(d.querySelector('.bzg'), null);
});

test('ガイドの文言: ja / en に全部ある', () => {
  const keys = [...fs.readFileSync(path.join(ROOT, 'src/pages/card_back_guide.js'), 'utf8').matchAll(/key: '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(keys.length >= 9);
  const need = ['guide', 'guide.prev', 'guide.next', 'guide.done', 'guide.skip', ...keys.flatMap(k => [`guide.${k}.title`, `guide.${k}.body`])];
  for (const f of ['ja', 'en']) {
    const s = fs.readFileSync(path.join(ROOT, `site/i18n/${f}.js`), 'utf8');
    for (const k of need) assert.ok(s.includes(`'card_back.${k}':`), `${f}: ${k}`);
  }
});
