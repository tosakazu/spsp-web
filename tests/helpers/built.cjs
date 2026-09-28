'use strict';
// 共通モジュール (ES module) を「古典 script の形」で取り出す (テストが vm / jsdom に文字列で流すため)。
// ソースが ES module (export) になったので、vm / jsdom に文字列で流すテストはこれを使う。
// 正規表現でソースを見るテストは今までどおり生のソース (src) を読む (esbuild は引用符などを整形するため)。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const SITE = path.join(ROOT, 'site');
const cache = new Map();

/** 生のソース (site/ 相対) */
function src(rel) { return fs.readFileSync(path.join(SITE, rel), 'utf8'); }
/** ES module なら esbuild で束ねた古典 script (IIFE)、そうでなければ生のソース */
function built(rel) {
  if (cache.has(rel)) return cache.get(rel);
  const file = path.join(SITE, rel);
  const raw = fs.readFileSync(file, 'utf8');
  let out = raw;
  if (/^(import|export)\s/m.test(raw)) {
    // ES module → 古典 script の形:
    //   import X from './y.js'        → const X = <global>.X   (先に eval したモジュールが置いたグローバル。テストが差し替えたものも見える)
    //   import { a, b } from './y.js' → const a = <global>.a, b = <global>.b
    //   export …                      → 外す
    // 全体を IIFE で包む (トップレベルの const がテストの context で衝突しないように)。文字面はそのまま (正規表現のテストは src() を使うこと)
    const G = "(typeof window !== 'undefined' ? window : globalThis)";   // モジュール側 (const global = window || globalThis) と同じ解決
    let body = raw
      .replace(/^import\s+([\w$]+)(?:,\s*\{([^}]*)\})?\s+from\s+'[^']+';[ \t]*(?:\/\/[^\n]*)?\n/gm, (m, d, named) =>
        `const ${d} = ${G}.${d};` + (named ? ' const ' + named.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `${x} = ${G}.${x}`).join(', ') + ';' : '') + '\n')
      .replace(/^import\s+\{([^}]*)\}\s+from\s+'[^']+';[ \t]*(?:\/\/[^\n]*)?\n/gm, (m, named) =>
        'const ' + named.split(',').map((x) => x.trim()).filter(Boolean).map((x) => `${x} = ${G}.${x}`).join(', ') + ';\n')
      .replace(/^import\s+'[^']+';[ \t]*(?:\/\/[^\n]*)?\n/gm, '')
      .replace(/^export default [^\n]*\n/gm, '')
      .replace(/^export \{[^\n]*\n/gm, '')
      .replace(/^export const (\w+) = /gm, 'const $1 = ')
      .replace(/^export (async function|function|const|let|var|class) /gm, '$1 ');
    out = '(function () {\n' + body + '\n})();\n';
  }
  cache.set(rel, out);
  return out;
}
module.exports = { src, built, SITE, ROOT };
