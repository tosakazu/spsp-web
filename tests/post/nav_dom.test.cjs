'use strict';
// site/nav.js のアイコンメニュー (お知らせ / 選手向け) の位置合わせ。
// 選手向けメニューはキャラ投票の入口なのでここに置いている。
//
// 狭い画面では CSS で position:fixed にしているが、CSS だけだと上端を
// 「nav 全体の下」にしか揃えられない。モバイルは meta 行が折り返して nav が
// 2 行になるため、アイコンから離れた低い位置に出てしまう。開くときに
// アイコンの実測位置へ寄せているのが placePanel。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (_) { /* jsdom 無しなら skip */ }

const NAV_SRC = require('../helpers/built.cjs').built('nav.js');   // nav.js は logo.js を import するので esbuild で束ねた形
// nav.js は region/config.js (features) と js/i18n.js + i18n/ja.js (文言) を先に読む前提
const PRE_SRC = ['region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js'].map((f) => require('../helpers/built.cjs').built(f)).join('\n');

/** アイコン行が y=4..28、nav 全体は meta 行を含めて y=0..56 という想定のモバイル。 */
const ICON_ROW = { top: 4, bottom: 28, height: 24 };

/**
 * nav.js を jsdom で動かす。レイアウトは jsdom が持たないので、
 * 位置合わせに使う矩形だけスタブする。
 *   opts.innerWidth : 画面幅
 *   opts.panelWidth : パネルの実測幅 (左にはみ出すかの判定に使う)
 */
async function mount(opts) {
  const o = opts || {};
  const dom = new JSDOM('<body><div id="nav-root"></div><script src="nav.js"></script></body>',
    { runScripts: 'outside-only', url: 'https://tosakazu.github.io/spsp/index.html' });
  const w = dom.window;
  w.fetch = () => Promise.reject(new Error('no network in test'));
  Object.defineProperty(w, 'innerWidth', { value: o.innerWidth || 375, writable: true });

  await new Promise((res) => {
    const run = () => { w.eval(PRE_SRC); w.eval(NAV_SRC); setTimeout(res, 0); };
    if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', run);
    else run();
  });

  // アイコン (= .nav-news / .nav-user の trigger) は画面右寄りの 1 行目にある想定。
  const rects = new Map();
  const nav = w.document.querySelector('.nav');
  rects.set(nav, { top: 0, bottom: 56, height: 56, left: 0, right: w.innerWidth, width: w.innerWidth });
  const place = (sel, right) => {
    const t = w.document.querySelector(sel + ' .nav-trigger');
    rects.set(t, Object.assign({ left: right - 30, right: right, width: 30 }, ICON_ROW));
  };
  place('.nav-news', w.innerWidth - 42);
  place('.nav-user', w.innerWidth - 8);

  const panelWidth = o.panelWidth || 160;
  for (const p of w.document.querySelectorAll('.nav-menu, .nav-news-panel')) {
    rects.set(p, { width: panelWidth });
  }
  w.Element.prototype.getBoundingClientRect = function () {
    const r = rects.get(this) || { top: 0, bottom: 0, height: 0, left: 0, right: 0, width: 0 };
    // 右寄せ (right: Npx) から左端を計算する。パネルだけがこの計算を要る。
    if (r.width !== undefined && this.classList &&
        (this.classList.contains('nav-menu') || this.classList.contains('nav-news-panel'))) {
      const right = parseFloat(this.style.right);
      const left = isNaN(right) ? 0 : w.innerWidth - right - r.width;
      return Object.assign({}, r, { left: left, right: w.innerWidth - (isNaN(right) ? 0 : right) });
    }
    return r;
  };

  return {
    w,
    $: (sel) => w.document.querySelector(sel),
    panel: (sel) => w.document.querySelector(sel + ' .nav-menu, ' + sel + ' .nav-news-panel'),
    click: (sel) => {
      w.document.querySelector(sel + ' .nav-trigger')
        .dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    },
    clickAway: () => {
      w.document.body.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    },
  };
}

test('狭い画面: 選手メニューはアイコンの真下に出る (nav の下ではない)', { skip: !JSDOM }, async () => {
  const p = await mount({ innerWidth: 375 });
  p.click('.nav-user');
  const panel = p.panel('.nav-user');
  // アイコン行の下 (28+4) であって、nav 全体の下 (56) ではない
  assert.strictEqual(panel.style.top, '32px');
  assert.notStrictEqual(panel.style.top, '56px');
});

test('狭い画面: お知らせパネルもアイコンの真下に出る', { skip: !JSDOM }, async () => {
  const p = await mount({ innerWidth: 375, panelWidth: 340 });
  p.click('.nav-news');
  assert.strictEqual(p.panel('.nav-news').style.top, '32px');
});

test('狭い画面: アイコンの右端に揃える (画面右からは 8px 以上あける)', { skip: !JSDOM }, async () => {
  const p = await mount({ innerWidth: 375 });
  p.click('.nav-user');
  // .nav-user のアイコン右端は innerWidth-8 → right は 8px
  assert.strictEqual(p.panel('.nav-user').style.right, '8px');

  const p2 = await mount({ innerWidth: 375 });
  p2.click('.nav-news');
  // .nav-news のアイコン右端は innerWidth-42 → right は 42px
  assert.strictEqual(p2.panel('.nav-news').style.right, '42px');
});

test('狭い画面: 幅が広くて左にはみ出すなら左端に寄せ直す', { skip: !JSDOM }, async () => {
  // パネル幅 340 を right:42px で置くと左端は 375-42-340 = -7 → はみ出す
  const p = await mount({ innerWidth: 375, panelWidth: 340 });
  p.click('.nav-news');
  const panel = p.panel('.nav-news');
  assert.strictEqual(panel.style.right, 'auto');
  assert.strictEqual(panel.style.left, '8px');
});

test('広い画面では CSS のまま (インラインで位置を書かない)', { skip: !JSDOM }, async () => {
  const p = await mount({ innerWidth: 1200 });
  p.click('.nav-user');
  const panel = p.panel('.nav-user');
  assert.strictEqual(panel.style.top, '');
  assert.strictEqual(panel.style.right, '');
  assert.strictEqual(panel.style.left, '');
});

test('閉じるとインラインの位置指定を消す (次に開くとき測り直す)', { skip: !JSDOM }, async () => {
  const p = await mount({ innerWidth: 375 });
  p.click('.nav-user');
  assert.notStrictEqual(p.panel('.nav-user').style.top, '');
  p.clickAway();
  const panel = p.panel('.nav-user');
  assert.strictEqual(panel.style.top, '');
  assert.strictEqual(panel.style.right, '');
  assert.strictEqual(panel.style.left, '');
});

test('ふつうのメニュー (ランキング等) には触らない', { skip: !JSDOM }, async () => {
  const p = await mount({ innerWidth: 375 });
  p.click('.nav-dropdown');   // 最初の = ランキング
  const panel = p.$('.nav-dropdown .nav-menu');
  assert.strictEqual(panel.style.top, '', 'absolute のままでよいものに手を入れている');
  assert.strictEqual(panel.style.right, '');
});

test('画面幅が変わったら開いているものを測り直す', { skip: !JSDOM }, async () => {
  const p = await mount({ innerWidth: 375 });
  p.click('.nav-user');
  p.panel('.nav-user').style.top = '999px';        // ずれた状態を作る
  p.w.innerWidth = 375;
  p.w.dispatchEvent(new p.w.Event('resize'));
  assert.strictEqual(p.panel('.nav-user').style.top, '32px');
});

test('JS のブレークポイントが CSS のメディアクエリと同じ', { skip: !JSDOM }, () => {
  const js = Number(NAV_SRC.match(/NARROW_PX\s*=\s*(\d+)/)[1]);
  const css = Number(NAV_SRC.match(/@media \(max-width:(\d+)px\)/)[1]);
  assert.strictEqual(js, css);
});
