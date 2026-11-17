// tests/frontend/report_guide.test.cjs — 結果報告の運営向けガイド (src/pages/report_guide.js + spot_guide.js): 画面にある欄の段だけ進む・
// 閉じると見たことになる・「? 使い方」で出し直せる・一度見せた「結果報告とは」「ガイドをもう一度」は自動では飛ばす・文言が ja / en にある
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');

test('ガイド: ログイン前は 結果報告とは → ログイン → もう一度 の 3 段。閉じると見たことになり、次は自動で出ない', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'site/report/index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, { url: 'https://spsp.games/jp/report/', pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'localStorage']) {
    try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch (e) { /* 読み取り専用 */ }
  }
  const d = w.document;
  const setup = d.getElementById('rp-setup');
  setup.hidden = false;
  setup.innerHTML = '<button id="rp-to-login">login</button>';
  const G = await import(pathToFileURL(path.join(ROOT, 'src/pages/report_guide.js')).href);
  assert.strictEqual(G.loginGuide.seen(), false);
  G.wireGuide('login', false, true);   // 見本: ボタンだけ、自動では出さない
  assert.strictEqual(d.getElementById('rp-guide').hidden, false);
  assert.strictEqual(d.querySelector('.spg'), null);
  d.getElementById('rp-guide').click();
  const steps = [];
  let n = 0;
  while (d.querySelector('.spg')) {
    steps.push(d.querySelector('.spg-step').textContent);
    assert.ok(d.querySelector('.spg-title').textContent);
    d.querySelector('.spg-next').click();
    assert.ok(++n < 20, '終わらない');
  }
  assert.deepStrictEqual(steps, ['1 / 3', '2 / 3', '3 / 3']);
  assert.strictEqual(G.loginGuide.seen(), true);
  assert.strictEqual(G.setupGuide.seen(), false, 'ログイン後のガイドは別に数える');
  // ログイン後の形: イベント・設定・何先・受付を始める。「結果報告とは」「ガイドをもう一度」はもう見せたので、自動では飛ばす
  setup.innerHTML = '<div class="rp-tours"></div><div class="rp-settings"></div><div id="rp-ft-set"></div><button id="rp-start"></button>';
  G.wireGuide('setup');
  await new Promise((r) => setTimeout(r, 700));
  assert.strictEqual(d.querySelector('.spg-step').textContent, '1 / 4');
  assert.strictEqual(d.querySelector('.spg-title').textContent, 'report.guide.pick.title');
  d.querySelector('.spg-skip').click();
  assert.strictEqual(d.querySelector('.spg'), null);
  d.getElementById('rp-guide').click();   // ボタンからは全部
  assert.strictEqual(d.querySelector('.spg-step').textContent, '1 / 6');
  assert.strictEqual(d.querySelector('.spg-title').textContent, 'report.guide.intro.title');
  d.querySelector('.spg-skip').click();
  // 運営の画面: まだ見ていないので自動で出る
  const adm = d.getElementById('rp-admin');
  adm.hidden = false;
  adm.innerHTML = '<div class="rp-share"></div><div class="rp-settings"></div><section id="rp-adm-sets"></section><button id="rp-stop"></button>';
  G.wireGuide('admin');
  await new Promise((r) => setTimeout(r, 700));
  assert.strictEqual(d.querySelector('.spg-step').textContent, '1 / 4');
  d.querySelector('.spg-skip').click();
  G.wireGuide('admin');
  await new Promise((r) => setTimeout(r, 700));
  assert.strictEqual(d.querySelector('.spg'), null, '見た後は自動で出ない');
});

test('シードツールの案内は「結果報告とは」と同じキーに書く', () => {
  const g = fs.readFileSync(path.join(ROOT, 'src/pages/report_guide.js'), 'utf8');
  const key = /INTRO_KEY = '([a-z0-9_]+)'/.exec(g)[1];
  assert.ok(fs.readFileSync(path.join(ROOT, 'site/seeding/app/40_startgg.js'), 'utf8').includes("localStorage.setItem('" + key + "', '1')"));
});

test('ガイドの文言: ja / en に全部ある', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/pages/report_guide.js'), 'utf8');
  const keys = [...src.matchAll(/step\('([a-z_]+)'/g)].flatMap((m) => ['report.guide.' + m[1] + '.title', 'report.guide.' + m[1] + '.body']);
  assert.ok(keys.length >= 16);
  for (const lang of ['ja', 'en']) {
    const dict = fs.readFileSync(path.join(ROOT, 'site/i18n', lang + '.js'), 'utf8');
    for (const k of new Set([...keys, 'report.guide.prev', 'report.guide.next', 'report.guide.done', 'report.guide.skip', 'report.guide.open'])) assert.ok(dict.includes("'" + k + "':"), lang + ' に ' + k + ' が無い');
  }
});
