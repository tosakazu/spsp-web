'use strict';
// シードツール本体 (site/seeding/app/*.js、2026-09-13 に seed_app.js から分割) の連結ソース。
// ファイルの並びは src/pages/seed.js の import の順 (= ブラウザでの実行順)。
// テストは以前どおり「1 本のソース文字列」として扱える (関数の切り出し・文字列の存在確認)。
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.resolve(__dirname, '../../../site');
// 並びは src/pages/seed.js の import (= ビルドの結合順。以前は seed/index.html の <script src> の並び)
const FILES = require('../../helpers/pages.cjs').pageImports('seed').filter((f) => f.startsWith('seeding/app/'));
if (!FILES.length) throw new Error('src/pages/seed.js に seeding/app/*.js の import が無い');
// seeding/app/*.js は ES module (共有状態は 00_state.js の S)。テストは以前どおり「1 本の古典 script」として扱えるよう、
// import 行と export 接頭辞を外して連結する (00_state.js の `export const S` は `var S` に: 各 vm の context で 1 回だけ宣言される)
const classic = (f, src) => src
  .replace(/^import [^\n]*\n/gm, '')
  .replace(/^export (default |const |let |var |async function |function |class )/gm, (m, k) => (f.endsWith('00_state.js') && k === 'const ') ? 'var ' : k);
const SRC_RAW = FILES.map((f) => classic(f, fs.readFileSync(path.join(SITE, f), 'utf8'))).join('\n');

// 文言は辞書 (site/i18n/ja.js) に移してあり、ソースは i18n('seed.core.s3') のようになっている。
// テストは「この文言がこの経路にある」「この関数を切り出して動かす」という読み方をするので、
// 引数なしの i18n('key') を辞書の値のリテラルに戻した形 (SRC) を既定で渡す。生のソースは SRC_RAW。
const vm = require('node:vm');
const w = { SPSP_I18N: {} };
vm.runInNewContext(fs.readFileSync(path.join(SITE, 'i18n/ja.js'), 'utf8'), { window: w });
const DICT = w.SPSP_I18N.ja || {};
const lit = (k) => "'" + DICT[k].replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const SRC = SRC_RAW
  // テンプレートの中の ${i18n('key')} は文字列そのもの (以前のソースと同じ字面) に戻す
  .replace(/\$\{i18n\('([a-z0-9_.]+)'\)\}/g, (m, k) => (k in DICT) ? DICT[k] : m)
  .replace(/i18n\('([a-z0-9_.]+)'\)/g, (m, k) => (k in DICT) ? lit(k) : m)
  // 引数つき i18n('key', { a: x, … }) は、辞書の文言に {a} を埋める自己完結の式に (i18n という識別子を残さない:
  // テストは関数を切り出して別の vm で動かすので、辞書の値がその場にある形でないと ReferenceError になる)
  .replace(/i18n\('([a-z0-9_.]+)',\s*(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})\)/g, (m, k, obj) =>
    (k in DICT) ? `((p) => ${lit(k)}.replace(/\\{(\\w+)\\}/g, (mm, n) => (n in p ? p[n] : mm)))(${obj})` : m);

module.exports = { FILES, SRC, SRC_RAW, DICT };
