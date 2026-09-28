'use strict';
// spsp.games は拡張子なしの URL (c/ranking)。URL のパスでページを判定する正規表現が .html 必須だと、ナビの強調と GA のページビュー (動的ページの二重計上) が外れる (2026-09-28)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') jsFiles(f, out); }
    else if (/\.(js|mjs|ts)$/.test(e.name)) out.push(f);
  }
  return out;
}

test('パスを判定する正規表現は .html を必須にしない (\\.html$ ではなく (\\.html)?$)', () => {
  const bad = [];
  for (const f of [...jsFiles(path.join(ROOT, 'site')), ...jsFiles(path.join(ROOT, 'src'))]) {
    const src = fs.readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      if (/\\\.html\$\//.test(line) && /\.test\((?:p|_p|location\.pathname|path)\)/.test(line)) bad.push(path.relative(ROOT, f) + ':' + (i + 1) + ': ' + line.trim());
    });
  }
  assert.deepStrictEqual(bad, []);
});

test('nav.js の判定: 拡張子なしでも同じページになる', () => {
  const src = fs.readFileSync(path.join(ROOT, 'site/nav.js'), 'utf8');
  const body = src.slice(src.indexOf('function currentPage() {'), src.indexOf("return 'ranking';", src.indexOf('function currentPage() {')) + "return 'ranking';".length);
  const currentPage = new Function('p', body.replace(/^function currentPage\(\) \{[^\n]*\n/, '') );
  for (const [a, b, want] of [
    ['/jp/c/ranking.html', '/jp/c/ranking', 'char-ranking'], ['/jp/local/ranking.html', '/jp/local/ranking', 'local-ranking'],
    ['/jp/pref/ranking.html', '/jp/pref/ranking', 'pref-ranking'], ['/jp/overview.html', '/jp/overview', 'overview'],
    ['/jp/vote.html', '/jp/vote', 'vote'], ['/jp/math.html', '/jp/math', 'math'],
  ]) {
    assert.strictEqual(currentPage(a), want, a);
    assert.strictEqual(currentPage(b), want, b);
  }
});
