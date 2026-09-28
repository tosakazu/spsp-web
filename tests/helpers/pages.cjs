'use strict';
// src/pages/<id>.js (ページのスクリプト。先頭の import '…' が読み込み順、残りがページ固有のコード) を読むための共通ヘルパー。
// ページ HTML はもう <script src> を並べない (ビルドが dist/assets/<id>.js に束ねる) ので、
// 「このページがどのモジュールを読むか」「ページのコードにこの文字列があるか」はここから見る。
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const SITE = path.join(ROOT, 'site');
const PAGES_DIR = path.join(ROOT, 'src', 'pages');
const IMPORT_RE = /^import\s+(?:[\w$]+(?:,\s*\{[^}]*\})?\s+from\s+|\{[^}]*\}\s+from\s+)?'([^']+)';[ \t]*\n/gm;   // import '…' / import X from '…' / import { a } from '…'

const PAGE_ID = {   // site/ 相対の HTML → src/pages/<id>
  'index.html': 'index', 'c/index.html': 'c_index', 'c/ranking.html': 'c_ranking', 'local/index.html': 'local_index', 'local/ranking.html': 'local_ranking',
  'pref/index.html': 'pref_index', 'pref/ranking.html': 'pref_ranking', 'events/index.html': 'events', 'news/index.html': 'news', 'p/index.html': 'p',
  't/index.html': 't', 'sim/index.html': 'sim', 'priority/index.html': 'priority', 'seed/index.html': 'seed', 'seed-upload/index.html': 'seed_upload',
  'bracket/index.html': 'bracket', 'vote.html': 'vote', 'post.html': 'post', 'callback.html': 'callback', 'overview.html': 'overview',
  'details.html': 'details', 'math.html': 'math', 'eval.html': 'eval',
};
function pageIds() { return fs.readdirSync(PAGES_DIR).filter((f) => /\.(js|ts)$/.test(f)).map((f) => f.replace(/\.(js|ts)$/, '')).sort(); }
function pageFilePath(id) {
  for (const ext of ['.js', '.ts']) { const p = path.join(PAGES_DIR, id + ext); if (fs.existsSync(p)) return p; }
  throw new Error(`src/pages/${id}.js が無い`);
}
function pageFile(id) { return fs.readFileSync(pageFilePath(id), 'utf8'); }
/** import の並び (site/ 相対のパス。例 'js/html.js') */
function pageImports(id) {
  const file = pageFilePath(id);
  return [...pageFile(id).matchAll(IMPORT_RE)].map((m) => path.relative(SITE, path.resolve(path.dirname(file), m[1])).split(path.sep).join('/'));
}
/** import を除いたページ固有のコード */
function pageBody(id) { return pageFile(id).replace(IMPORT_RE, ''); }
/** HTML (site/ 相対) + そのページのコード。「ページにこの文字列があるか」を以前どおり 1 本の文字列で見るため */
function pageWithScript(rel) { return fs.readFileSync(path.join(SITE, rel), 'utf8') + '\n' + (PAGE_ID[rel] ? pageBody(PAGE_ID[rel]) : ''); }

module.exports = { ROOT, SITE, PAGES_DIR, PAGE_ID, pageIds, pageFilePath, pageFile, pageImports, pageBody, pageWithScript };
