// tests/frontend/card_back_render.test.cjs — カードの裏面にシールを描く (js/player_card.js renderBack): 置く場所・重なり順 (名前を前に)・
// 縁取り・アイコンの無いシールは出さない・形ごとのホロ・光の層・持っていないシールは出さない (player_card_model.js buildCardModel)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '../..');
const ICONS = { f: ['aaa.png', 'bbb.jpg'], e: { 1700000: 0, 1724470: 1 } };

/** @type {any} */
let mods = null;
async function load() {
  if (mods) return mods;
  const dom = new JSDOM('<!doctype html><html><body><div class="pcard pcard-back" id="b"></div></body></html>', { url: 'https://spsp.games/jp/p/', pretendToBeVisual: true });
  const w = dom.window;
  for (const k of ['window', 'document', 'navigator', 'location', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'requestAnimationFrame', 'Image', 'localStorage', 'history']) {
    try { Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true }); } catch (e) { /* 読み取り専用 */ }
  }
  w.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.matchMedia = w.matchMedia;
  w.SPSP = { root: '/jp/', data: 'https://data.spsp.games/jp/', site: {} };
  globalThis.SPSP = w.SPSP;
  // 大会アイコンの表 (loadIcons) は fetch で読む
  globalThis.fetch = async (/** @type {string} */ u) => ({ ok: /event_icons/.test(String(u)), json: async () => ICONS });
  const S = await import(pathToFileURL(path.join(ROOT, 'site/js/card_stickers.js')).href);
  await S.loadIcons();
  const PC = await import(pathToFileURL(path.join(ROOT, 'site/js/player_card.js')).href);
  mods = { w, S, PC };
  return mods;
}

/** 裏面の最小のモデル @param {any} back */
const model = back => ({ name: 'Peric', nameLatin: 'Peric', title: null, chars: [], rank: 12, pills: [], achievements: [], totalTournaments: 0, totalMatches: 0,
  labels: { evalDate: '', achievements: '', latest: '', overall: '', national: '', equivalent: '', noAch: '' }, back });

test('シールを置く: 場所・大きさ・回転、アイコンの無いシールは出さない、光の層', async () => {
  const { w, PC } = await load();
  const el = w.document.getElementById('b');
  PC.renderBack(el, model({ stickers: [
    { e: '1700000:r', x: 100, y: 50, s: 120, r: -10, k: 'circle', c: 0.6 },
    { e: '1724470B:n', x: 300, y: 200, s: 80, r: 0, k: 'square', c: 1 },
    { e: '1999999:g', x: 1, y: 1, s: 30, r: 0, k: 'square', c: 1 },   // アイコンの表に無い
  ], text_top: false, outline: false }));
  const sks = [...el.querySelectorAll('.pcb-sk')];
  assert.strictEqual(sks.length, 2);
  assert.match(sks[0].getAttribute('style'), /left:100px;top:50px;width:120px;height:120px;transform:translate\(-50%,-50%\) rotate\(-10deg\)/);
  const hb = sks[0].querySelector('.hb');
  assert.ok(hb && /hb-k-circle/.test(hb.className) && /hb-v0/.test(hb.className), hb && hb.className);
  assert.strictEqual(hb.style.getPropertyValue('--hb-zoom'), String(1 / 0.6));
  // 丸・六角形・ひし形は図形用のホロ (Figma 図形_虹)。虹のラメ (2 番) は 968/740 の大きさで中央に。四角は四角のホロ
  assert.ok(hb.querySelector('.hb-l-zukei_nizi_5') && !hb.querySelector('.hb-l-sikaku_nizi_5'));
  const lame = /** @type {HTMLElement} */ (hb.querySelector('.hb-l-zukei_nizi_2'));
  assert.strictEqual(lame.style.inset, `${-(968 / 740 - 1) / 2 * 100}%`);
  assert.strictEqual(lame.style.mixBlendMode, 'color-dodge');
  assert.ok(hb.querySelector('.hb-l-sikaku_kin_1'));   // 図形の 1 番は四角の金の 1 番と同じ画像
  assert.ok(/hb-v3/.test(sks[1].querySelector('.hb').className));   // 素
  assert.strictEqual(sks[1].querySelector('.hb-cls')?.textContent, 'B');
  // 光の層 (傾けたときのキラキラ) は初めて傾けたときに作る。カードのいちばん上に、シールと同じ数
  assert.strictEqual(el.querySelector('.pcb-glow'), null);
  PC.ensureGlow(el);
  PC.ensureGlow(el);   // 2 回呼んでも 1 つ
  assert.strictEqual(el.querySelectorAll('.pcb-glow').length, 1);
  assert.strictEqual(el.lastElementChild.className, 'pcb-glow');
  assert.strictEqual(el.querySelectorAll('.pcb-glow > .hb').length, 2);
});

test('名前を前に (text_top) なら文字の列がシールより後 (上)、縁取りは .pcb-outline', async () => {
  const { w, PC } = await load();
  const el = w.document.getElementById('b');
  const st = [{ e: '1700000:g', x: 100, y: 50, s: 120, r: 0, k: 'square', c: 1 }];
  PC.renderBack(el, model({ stickers: st, text_top: false, outline: false }));
  let kids = [...el.querySelector('.pc-in').children].map(c => c.className).filter(c => /pcb-(st|col)/.test(c));
  assert.deepStrictEqual(kids, ['pcb-col', 'pcb-st']);
  assert.ok(!el.querySelector('.pcb-outline'));
  PC.renderBack(el, model({ stickers: st, text_top: true, outline: true }));
  kids = [...el.querySelector('.pc-in').children].map(c => c.className).filter(c => /pcb-(st|col)/.test(c));
  assert.deepStrictEqual(kids, ['pcb-st', 'pcb-col']);
  assert.ok(el.querySelector('.pc-in.pcb-outline'));
});

test('シールが無ければ層も光も作らない', async () => {
  const { w, PC } = await load();
  const el = w.document.getElementById('b');
  PC.renderBack(el, model(null));
  assert.strictEqual(el.querySelector('.pcb-st'), null);
  assert.strictEqual(el.querySelector('.pcb-glow'), null);
  assert.strictEqual(el.querySelector('.pcb-name-t').textContent, 'Peric');
});
