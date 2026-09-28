'use strict';
// トーナメントプレビューの「start.gg と食い違うことがある」注意書き。
// 設計 (docs/seed_preview_design.md §8) で「画面に注記」と決めていたのが
// 長らく実装されていなかったため、テストで固定する。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const HTML = fs.readFileSync(path.resolve(__dirname, '../../site/bracket/index.html'), 'utf8');
const CSS = fs.readFileSync(path.resolve(__dirname, '../../site/bracket/bracket_app.css'), 'utf8');

test('注意書きが存在し、閉じていても要点が読める', () => {
  assert.match(HTML, /class="bp-caveat"/);
  // summary は開かなくても見えるので、ここに結論を書いておく
  const m = HTML.match(/<summary[^>]*>([^<]*)<\/summary>/);
  assert.ok(m, 'summary が無い');
  assert.match(m[1], /start\.gg/);
  assert.match(m[1], /食い違/);
});

test('ズレる条件が具体的に列挙されている', () => {
  const body = HTML.slice(HTML.indexOf('bp-caveat-body'), HTML.indexOf('</details>'));
  // 実測で最も食い違うのは敗者側の初戦 (docs/seed_preview_design.md 実プール検証: 61/74)
  assert.match(body, /敗者側/);
  // ダブルイリミ前提であること
  assert.match(body, /ダブルイリミ/);
  // 主催者の手動シード変更は取り込めない
  assert.match(body, /手動|直接シード|並べ替/);
  // フェーズ構成はこちらの指定で計算していること
  assert.match(body, /フェーズ構成|通過人数/);
  // 最終確認は start.gg で、と促す
  assert.match(body, /start\.gg でご確認|start\.gg で確認/);
});

test('注意書きのスタイルがある (地の文に埋もれない)', () => {
  assert.match(CSS, /\.bp-caveat\s*\{/);
  assert.match(CSS, /\.bp-caveat-body\s*\{/);
});
