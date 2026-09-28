'use strict';
// 優先枠作成ページ (site/priority/) の静的整合。
// 「名前を押してもプレイヤーページに飛べない」不具合 (2026-08-17) の再発防止。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.resolve(__dirname, '../../site');
const read = (p) => require('../helpers/built.cjs').built(p);   // 共通モジュールは古典 script の形で (tests/helpers/built.cjs)
const { pageWithScript, PAGES_DIR } = require('../helpers/pages.cjs');   // ページのコードは src/pages/<id>.js
const PRIORITY = pageWithScript('priority/index.html');
const PLAYER = pageWithScript('p/index.html');

test('プレイヤーページが読むクエリ名は uid', () => {
  // ここが変わったらリンク側も直す必要がある
  assert.match(PLAYER, /params\.get\('uid'\)/);
});

test('優先枠ページのリンクは SPSPLinks.playerHref で組む (?id= だと uid 無し扱いになる)', () => {
  // リンクは js/links.js (SPSPLinks.playerHref) が組み立てる。形は p/?d=<discriminator>、表に無ければ p/?uid=<uid>
  assert.match(PRIORITY, /SPSPLinks\.playerHref\(SPSP\.langRoot, r\.uid\)/);
  const LINKS = read('js/links.js');
  assert.match(LINKS, /'\?d=' \+ d : '\?uid=' \+ uid/);
  assert.doesNotMatch(PRIORITY, /p\/\?id=/, '?id= が残っている');
});

test('サイト全体でプレイヤーページへのリンクが ?d= / ?uid= に揃っている', () => {
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'players' || e.name === 'tournaments' || e.name === 'data') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(html|js)$/.test(e.name)) files.push(p);
    }
  })(SITE);
  for (const e of fs.readdirSync(PAGES_DIR)) files.push(path.join(PAGES_DIR, e));   // ページのコード (src/pages/)
  const bad = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // p/?<key>= の key が uid 以外なら拾う。
    // 直前が英数だと "spsp/?q=" のような別物を拾うので境界を要求する。
    for (const m of src.matchAll(/(^|[^A-Za-z0-9])p\/\?([a-zA-Z_]+)=/g)) {
      if (m[2] !== 'uid' && m[2] !== 'd') bad.push(path.relative(SITE, f) + ': ?' + m[2] + '=');
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('海外勢の除外は overseas.json を読んで行う (手書きリストを持たない)', () => {
  assert.match(PRIORITY, /data\/overseas\.json/);
  assert.match(PRIORITY, /exclOverseas && OVERSEAS\.has\(p\.uid\)/);
  // 既定でオン (海外勢を除く)
  assert.match(PRIORITY, /id="excl-overseas" checked/);
});
