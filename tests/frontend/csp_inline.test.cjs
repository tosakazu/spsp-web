// サイトの CSP (worker/src/index.ts SITE_CSP) は script-src に 'unsafe-inline' を入れない。
// なので HTML のインライン <script> (JSON-LD などのデータは除く) と、onclick= 等のイベント属性を書かない。
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
function files(dir, exts, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules') files(p, exts, out); }
    else if (exts.some((e) => f.name.endsWith(e))) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(ROOT, p);

test('site/ の HTML にインラインの <script> が無い (src 付きと JSON のデータだけ)', () => {
  const bad = [];
  for (const f of files(path.join(ROOT, 'site'), ['.html'])) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      const attrs = m[1] || '';
      if (/\bsrc=/.test(attrs) || /type="application\/(ld\+)?json"/.test(attrs)) continue;
      if (m[2].trim()) bad.push(rel(f) + ': ' + m[2].trim().slice(0, 40));
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('site/ と src/ にイベント属性 (onclick= 等) を書かない', () => {
  const bad = [];
  for (const f of [...files(path.join(ROOT, 'site'), ['.html', '.js']), ...files(path.join(ROOT, 'src'), ['.js', '.ts', '.html'])]) {
    const s = fs.readFileSync(f, 'utf8');
    s.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;   // コメント
      if (/<[a-z][^>]*\son[a-z]+\s*=\s*\\?["'`]/i.test(line) || /\son(click|load|error|change|input|submit|keydown|mouseover)=\\?["']/.test(line)) bad.push(rel(f) + ':' + (i + 1));
    });
  }
  assert.deepStrictEqual(bad, []);
});
