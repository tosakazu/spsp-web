#!/usr/bin/env node
// tools/build/build_site.mjs — site/ から配信ディレクトリ (dist/) を作る。
//
//   node tools/build/build_site.mjs [--region JP] [--out dist] [--site site] [--data-root https://data.spsp.games/jp/] [--quiet]
//   --data-root: JSON の置き場 (別ホスト = R2 など)。out/region/config.js の dataRoot に書く (無ければ config のまま = 同じルート)
//
// やること (docs/frontend_stack_review.md の B、docs/frontend_i18n_review.md §4.5):
//   1. site/ の静的ファイル (js / css / 画像 / 辞書 / regions) を out/ に写す。region symlink は配信する地域の実体に置き換える。
//      out/ にビルド (spsp_scripts) が書く生成物 (players/ data/ meta.json …) は触らない (消さない)。
//   2. HTML ページを既定言語で 1 系統だけ生成する (2026-09-28 から。以前は他言語を out/<lang>/ に別の木で出していた)。
//      - <html lang="<既定言語>" data-root data-lang-root> (js/html.js が SPSP.root / SPSP.langRoot に読む。今は両方同じ)
//      - data-i18n / data-i18n-attr を既定言語の辞書 (地域の上書き → 言語) で埋める。属性は残す
//      - 他の言語は同じ URL + ?lang=<言語>: 既定言語の辞書の直後に js/lang_boot.js を置き、?lang (か覚えた言語) なら辞書を足して
//        <html lang> を変え、js/i18n.js が data-i18n を差し替える。canonical は ?lang 無しの URL で、hreflang は出さない
//      - 日本語だけのページ (解説・ブログ・投稿系、JA_ONLY) は <html data-default-lang-only> (?lang を無視、言語切替を出さない)
//   3. sitemap.xml (canonical.origin があるとき)。
//   4. ページの script: src/pages/<id>.js (import が依存、残りがページ固有のコード) を esbuild で 1 本の古典 script (IIFE) に
//      束ねて out/assets/<id>.js に書く (TypeScript もそのまま)。共通モジュールは window.SPSPXxx にも置く (移行中の互換)。
//      シードツール (seed / seed-upload) だけは seeding/app/* がトップレベルの const を共有するので、import の順に結合する
//      (CONCAT_PAGES。state モジュールに集約したら外す)。
//
// 決めごと: 出力は入力から決定的 (同じ入力なら同じ出力)。tests/meta/build.test.cjs が検査する。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import esbuild from 'esbuild';
// ConoHa WING はプロセス (スレッド) 数の上限が低く、esbuild (Go) がスレッドを作れずに落ちることがある → 既定で 1 スレッド (tsc も同様: package.json)
if (!process.env.GOMAXPROCS) process.env.GOMAXPROCS = '1';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const REGION = opt('--region', 'JP');
const SITE = path.resolve(ROOT, opt('--site', 'site'));
const OUT = path.resolve(ROOT, opt('--out', 'dist'));
const DATA_ROOT = opt('--data-root', '');   // JSON の置き場 (別ホスト)。'' なら config のまま
const CANONICAL = opt('--canonical', '');    // 配信 URL (canonical / hreflang / sitemap の起点)。例 https://spsp.games/jp/。'' なら config のまま
if (CANONICAL && !/^https?:\/\/[^/]+\/.*\/$/.test(CANONICAL) && !/^https?:\/\/[^/]+\/$/.test(CANONICAL)) throw new Error('--canonical は https://host/path/ (末尾 /) で: ' + CANONICAL);
if (DATA_ROOT && !/^https?:\/\/.+\/$/.test(DATA_ROOT)) throw new Error('--data-root は https://…/ (末尾 /) で: ' + DATA_ROOT);
const QUIET = args.includes('--quiet');
// 拡張子なしの URL (Cloudflare Workers assets の html_handling が /x.html → /x に 307 するので、リンク・canonical・sitemap を最初から /x に揃える)。
// 既定言語にしか無いページ (JA_ONLY) の他言語版は出さず、旧 URL (/jp/en/vote.html 等) は _redirects で既定言語へ 301 (2026-09-28)
const CLEAN = args.includes('--clean-urls');
const log = (...a) => { if (!QUIET) console.log(...a); };

// ── 設定と辞書 ──
function evalScript(file, w) {
  const sb = { window: w, globalThis: w, location: { hostname: 'spsp.games' }, console };
  w.location = sb.location;
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sb);
  return w;
}
const cfgWin = evalScript(path.join(SITE, 'regions', REGION, 'config.js'), {});
const SITECFG = cfgWin.SPSP.site;
if (SITECFG.region !== REGION) throw new Error(`regions/${REGION}/config.js の region が ${SITECFG.region}`);
// ページに直書きされた配信 URL (JSON-LD・「正規のページを開く」リンク) の元の値。--canonical のときはこれを配信先に置き換える
// 共有の HTML は日本版の canonical (gh-pages) で書かれているので、地域に関係なく JP の config から取る
const SRC_CANON = (REGION === 'JP' ? SITECFG : evalScript(path.join(SITE, 'regions', 'JP', 'config.js'), {}).SPSP.site).canonical;
const SRC_ROOT = SRC_CANON && SRC_CANON.origin && SRC_CANON.origin !== 'TODO' ? SRC_CANON.origin + (SRC_CANON.base || '/') : null;
if (CANONICAL) { const u = new URL(CANONICAL); SITECFG.canonical = { origin: u.origin, base: u.pathname }; }   // --canonical は head (canonical / hreflang / og:url / sitemap) にも効かせる
if (DATA_ROOT) SITECFG.dataRoot = DATA_ROOT;
if (CLEAN) SITECFG.cleanUrls = true;
/** サイトのルート相対のページのパス → URL 上の形 ('index.html' → ''、'blog/index.html' → 'blog/'、CLEAN なら 'c/ranking.html' → 'c/ranking') */
const urlRelOf = (rel) => { const r = rel.replace(/(^|\/)index\.html$/, '$1'); return CLEAN ? r.replace(/\.html$/, '') : r; };
const LANGS = SITECFG.langs;
const DEFAULT = SITECFG.defaultLang;
const dictWin = { SPSP_I18N: {}, SPSP_I18N_REGION: {} };
for (const l of LANGS) evalScript(path.join(SITE, 'i18n', l + '.js'), dictWin);
evalScript(path.join(SITE, 'regions', REGION, 'i18n.js'), dictWin);
const DICT = dictWin.SPSP_I18N;
const OVER = (dictWin.SPSP_I18N_REGION[REGION]) || {};
function lookup(lang, key) {
  const o = OVER[lang]; if (o && o[key] != null) return o[key];
  const d = DICT[lang]; if (d && d[key] != null) return d[key];
  const dd = DICT[DEFAULT]; if (dd && dd[key] != null) return dd[key];
  return null;
}

// 日本語だけのページ (他言語の木では noindex、lang は既定言語)。長文の解説と、静的 HTML が辞書化されていない投稿系
const JA_ONLY = new Set(['overview.html', 'details.html', 'math.html', 'eval.html', 'vote.html', 'post.html', 'callback.html']);
const isJaOnly = (rel) => JA_ONLY.has(rel) || rel.startsWith('blog/');

// ── ファイル一覧 ──
function walk(dir, rel = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isSymbolicLink()) { out.push({ rel: r, symlink: true }); continue; }
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), r));
    else out.push({ rel: r });
  }
  return out;
}
const SKIP_TOP = new Set(['players', 'tournaments', 'history', 'players_current.json', 'meta.json', 'latest_tjpr_full.jsonl', 'sitemap.xml', 'node_modules', '.netlify', 'demo']);
const entries = walk(SITE).filter((e) => !SKIP_TOP.has(e.rel.split('/')[0]) && !e.rel.startsWith('data/'));
const pages = entries.filter((e) => !e.symlink && e.rel.endsWith('.html') && !e.rel.startsWith('regions/'));
const statics = entries.filter((e) => !e.symlink && !e.rel.endsWith('.html') && e.rel !== 'region');

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }
// サイトのバージョン表示 (__SITE_VERSION__ → "v <commit 7 桁> · <commit 時刻 UTC>")。配信用のビルド (--canonical) だけで入れる。
// 以前は spsp_scripts の deploy_v4.sh が gh-pages へ出すときに置き換えていた。Cloudflare のビルドには無く、プレースホルダが見えていた (2026-09-28)。
// commit から作るので同じ commit なら同じ出力 (決定的)。環境変数 SPSP_SITE_VERSION で上書きできる。git が無ければ置き換えない (nav は未 stamp として版を出さない)
const SITE_VERSION = (() => {
  if (process.env.SPSP_SITE_VERSION) return process.env.SPSP_SITE_VERSION;
  if (!CANONICAL) return null;
  try {
    const git = (a) => execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, TZ: 'UTC' } }).toString().trim();
    const sha = git(['rev-parse', '--short=7', 'HEAD']);
    const when = git(['log', '-1', '--date=format-local:%Y-%m-%d %H:%M UTC', '--format=%cd']);
    return sha && when ? `v ${sha} · ${when}` : null;
  } catch (e) { return null; }
})();
/** HTML / JS の __SITE_VERSION__ を置き換える (それ以外の内容はそのまま) */
function stampVersion(file, content) {
  if (!SITE_VERSION || !/\.(html|js)$/.test(file)) return content;
  const s = Buffer.isBuffer(content) ? content.toString('utf8') : String(content);
  if (!s.includes('__SITE_VERSION__')) return content;
  const v = /\.html$/.test(file) ? SITE_VERSION.replace(/&/g, '&amp;').replace(/</g, '&lt;') : SITE_VERSION.replace(/'/g, "\\'");
  return s.split('__SITE_VERSION__').join(v);
}
function writeIfChanged(file, content) {
  ensureDir(file);
  content = stampVersion(file, content);
  if (fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(content))) return false;
  fs.writeFileSync(file, content);
  return true;
}

// ── 1. 静的ファイル ──
let nStatic = 0;
for (const e of statics) {
  if (writeIfChanged(path.join(OUT, e.rel), fs.readFileSync(path.join(SITE, e.rel)))) nStatic++;
}
// region: 配信する地域の実体 (symlink は使わない)
for (const f of fs.readdirSync(path.join(SITE, 'regions', REGION))) {
  let body = fs.readFileSync(path.join(SITE, 'regions', REGION, f));
  if (f === 'config.js' && (DATA_ROOT || CANONICAL || CLEAN)) {   // 配信先ごとの値を差し替える (dataRoot / canonical / cleanUrls)
    let src = body.toString('utf8');
    if (CLEAN) {
      if (!/cleanUrls:\s*false/.test(src)) throw new Error(`regions/${REGION}/config.js に cleanUrls: false が無い`);
      src = src.replace(/cleanUrls:\s*false/, 'cleanUrls: true');
    }
    if (DATA_ROOT) {
      if (!/dataRoot:\s*'[^']*'/.test(src)) throw new Error(`regions/${REGION}/config.js に dataRoot が無い`);
      src = src.replace(/dataRoot:\s*'[^']*'/, `dataRoot: '${DATA_ROOT}'`);
    }
    if (CANONICAL) {
      const u = new URL(CANONICAL);
      if (!/canonical:\s*\{\s*origin:\s*'[^']*',\s*base:\s*'[^']*'\s*\}/.test(src)) throw new Error(`regions/${REGION}/config.js に canonical: { origin, base } が無い`);
      src = src.replace(/canonical:\s*\{\s*origin:\s*'[^']*',\s*base:\s*'[^']*'\s*\}/, `canonical: { origin: '${u.origin}', base: '${u.pathname}' }`);
    }
    body = Buffer.from(src, 'utf8');
  }
  if (writeIfChanged(path.join(OUT, 'region', f), body)) nStatic++;
}
// data/ の手で管理する入力 (git 追跡分) だけ写す。生成物は触らない
for (const f of ['char_emoji.json', 'overseas_manual.json']) {
  const src = path.join(SITE, 'data', f);
  if (fs.existsSync(src) && writeIfChanged(path.join(OUT, 'data', f), fs.readFileSync(src))) nStatic++;
}

// ── 2. HTML ──
function setText(el, text) {
  // js/i18n.js の setText と同じ: 子要素があれば最初の空白でないテキストノードだけ、前後の空白は保持
  let node = null;
  for (const c of el.childNodes) { if (c.nodeType === 3 && c.nodeValue.trim() !== '') { node = c; break; } }
  if (!node) { if (el.childNodes.length === 0 || [...el.childNodes].every((c) => c.nodeType === 3)) el.textContent = text; return; }
  const m = /^(\s*)[\s\S]*?(\s*)$/.exec(node.nodeValue);
  node.nodeValue = (m ? m[1] : '') + text + (m ? m[2] : '');
}
const isRelative = (v) => v && !/^(?:[a-z]+:|\/\/|\/|#|\?)/i.test(v);
function relUp(n) { return n ? '../'.repeat(n) : ''; }

let nPages = 0, nWritten = 0;
const sitemap = [];
// 言語 (2026-09-28): 配信は既定言語の 1 系統だけ (/jp/ = 日本語、/na/ = 英語)。もう一方の言語は同じ URL + ?lang=<言語>。
// ページは既定言語の文言で出し、data-i18n / data-i18n-attr は残す (js/lang_boot.js が ?lang の辞書を読み、js/i18n.js が差し替える)。
// canonical は ?lang 無しの URL、hreflang は出さない (検索エンジンに載るのは既定言語だけ)。旧 URL (/jp/en/…) は Worker が ?lang=en へ 301
for (const p of pages) {
  const src = fs.readFileSync(path.join(SITE, p.rel), 'utf8');
  const pageDir = path.dirname(p.rel) === '.' ? '' : path.dirname(p.rel);
  const depth = pageDir ? pageDir.split('/').length : 0;
  const pageUrlRel = urlRelOf(p.rel);   // URL 上の形 (index.html は省く、CLEAN なら .html も)
  const lang = DEFAULT;
  const jaOnly = isJaOnly(p.rel);
  const dom = new JSDOM(src);
  const doc = dom.window.document;
  const html = doc.documentElement;
  html.setAttribute('lang', lang);
  html.setAttribute('data-root', relUp(depth));
  html.setAttribute('data-lang-root', relUp(depth));
  if (jaOnly) html.setAttribute('data-default-lang-only', '');   // 他言語の辞書が無いページ (解説・投票・ブログ)。?lang を無視し、言語切替を出さない
  // ページ間リンク (a[href] の相対 .html): CLEAN なら拡張子を落とす
  if (CLEAN) {
    for (const el of doc.querySelectorAll('a[href]')) {
      const v = el.getAttribute('href');
      if (!isRelative(v)) continue;
      const cleanV = v.split(/[?#]/)[0];
      if (!/\.html$/.test(cleanV)) continue;
      const target = path.posix.normalize(path.posix.join(pageDir || '.', cleanV));   // サイトのルート相対
      if (target.startsWith('..')) continue;
      const to = urlRelOf(target);
      let rel = path.posix.relative(pageDir || '.', to || '.');
      if (to === '' || to.endsWith('/')) rel = (rel ? rel + '/' : './');
      el.setAttribute('href', rel + v.slice(cleanV.length));
    }
  }
  // 辞書の script は既定言語のもの。その直後に lang_boot.js (?lang= なら別の辞書を同期で足す)
  for (const el of doc.querySelectorAll('script[src]')) {
    const v = el.getAttribute('src');
    if (/(^|\/)i18n\/[a-z]{2}\.js$/.test(v)) {
      el.setAttribute('src', v.replace(/[a-z]{2}\.js$/, lang + '.js'));
      if (!jaOnly && LANGS.length > 1) {
        const boot = doc.createElement('script');
        boot.setAttribute('src', relUp(depth) + 'js/lang_boot.js');
        el.after(boot);
      }
    }
  }
  // data-i18n を既定言語で埋める (属性は残す: ?lang で差し替えるため)
  for (const el of doc.querySelectorAll('[data-i18n]')) {
    const v = lookup(lang, el.getAttribute('data-i18n'));
    if (v != null) setText(el, v);
  }
  for (const el of doc.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.getAttribute('data-i18n-attr').split(',')) {
      const [a, k] = pair.split(':').map((x) => x.trim());
      const v = a && k ? lookup(lang, k) : null;
      if (v != null) el.setAttribute(a, v);
    }
  }
  // head: canonical / og:url / JSON-LD
  const head = doc.head;
  const origin = SITECFG.canonical && SITECFG.canonical.origin && SITECFG.canonical.origin !== 'TODO' ? SITECFG.canonical.origin : null;
  const base = (SITECFG.canonical && SITECFG.canonical.base) || '/';
  if (origin) {
    const url = origin + base + pageUrlRel;
    for (const el of head.querySelectorAll('link[rel="canonical"], link[rel="alternate"][hreflang]')) el.remove();
    const canon = doc.createElement('link'); canon.setAttribute('rel', 'canonical'); canon.setAttribute('href', url);
    head.appendChild(canon);
    const og = head.querySelector('meta[property="og:url"]');
    if (og) og.setAttribute('content', url);
    // 構造化データ (JSON-LD) のサイト URL と、別ホストで開いたときの「正規のページを開く」リンク (#vt-canonical / #post-canonical)。
    // ソースには config の canonical (gh-pages) が直書きしてあるので、配信先のルートに置き換える (2026-09-28)
    if (SRC_ROOT && SRC_ROOT !== origin + base) {
      for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
        s.textContent = s.textContent.split(SRC_ROOT).join(origin + base).replace(/"inLanguage":\s*"[^"]*"/, '"inLanguage": "' + lang + '"');
      }
    }
    for (const a of doc.querySelectorAll('[id$="-canonical"] a[href]')) a.setAttribute('href', url);
    sitemap.push({ url, lang, page: pageUrlRel, jaOnly });
  }
  const out = path.join(OUT, p.rel);
  const html5 = '<!DOCTYPE html>\n' + html.outerHTML + '\n';
  if (writeIfChanged(out, html5)) nWritten++;
  nPages++;
}

// ── 4. ページの script (src/pages/<id>.js → out/assets/<id>.js) ──
const PAGES_DIR = path.join(ROOT, 'src', 'pages');
const CONCAT_PAGES = new Set([]);   // 結合方式で出すページ (無し。seeding/app/* も ES module になった 2026-09-15。仕組みは残す)
let nBundles = 0, nBundleWritten = 0;
if (fs.existsSync(PAGES_DIR)) {
  for (const f of fs.readdirSync(PAGES_DIR).filter((x) => /\.(js|ts)$/.test(x)).sort()) {
    const id = f.replace(/\.(js|ts)$/, '');
    const entry = path.join(PAGES_DIR, f);
    const src = fs.readFileSync(entry, 'utf8');
    const parts = [];
    const files = [];
    let body = src;
    const IMPORT_RE = /^import\s+(?:[\w$]+(?:,\s*\{[^}]*\})?\s+from\s+|\{[^}]*\}\s+from\s+)?'([^']+)';[ \t]*\n/gm;
    for (const m of src.matchAll(IMPORT_RE)) files.push(m[1]);
    body = src.replace(IMPORT_RE, '');
    let out;
    if (CONCAT_PAGES.has(id)) {
      // シードツール: seeding/app/* がトップレベルの const を同じ字句環境で共有するので、モジュールの scope に分けられない。
      // import の順に 1 ファイルずつ変換して結合する (state モジュールに集約するまでの経過措置)
      const transform = (code, file) => esbuild.transformSync(code, { loader: file.endsWith('.ts') ? 'ts' : 'js', target: 'esnext', charset: 'utf8', legalComments: 'inline' }).code;
      // ES module のファイル: import があれば esbuild で (依存ごと) IIFE に束ね、export だけなら export を外して IIFE で包む
      // (トップレベルの const が結合先で衝突しないように)。グローバル (window.SPSPXxx) は本体が置くので結合先から使える
      const classic = (code, file) => {
        if (/^import\s/m.test(code)) {
          return esbuild.buildSync({ entryPoints: [file], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'esnext',
            charset: 'utf8', minify: false, sourcemap: false, legalComments: 'inline', logLevel: 'silent', absWorkingDir: ROOT }).outputFiles[0].text;
        }
        if (/^export\s/m.test(code)) {
          const stripped = code.replace(/^export default [^\n]*\n/gm, '').replace(/^export \{[^\n]*\n/gm, '').replace(/^export const (\w+) = /gm, 'const $1 = ');
          return '(function () {\n' + transform(stripped, file) + '\n})();\n';
        }
        return transform(code, file);
      };
      for (const rel of files) {
        const file = path.resolve(PAGES_DIR, rel);
        if (!fs.existsSync(file)) throw new Error(`src/pages/${f}: import が見つからない: ${rel}`);
        parts.push(`// ---- ${path.relative(ROOT, file)} ----\n` + classic(fs.readFileSync(file, 'utf8'), file));
      }
      if (body.trim()) parts.push(`// ---- src/pages/${f} ----\n` + transform(body, entry));
      out = parts.join('\n;\n');
    } else {
      // 本物の束ね: esbuild が import の依存グラフどおりに 1 本の古典 script (IIFE) にする。各ファイルはモジュール scope。
      // 共通モジュールは window.SPSPXxx にも置く (移行中の互換) ので、ページのコードは今までどおりグローバルでも import でも使える
      const res = esbuild.buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'esnext',
        charset: 'utf8', minify: false, sourcemap: false, legalComments: 'inline', logLevel: 'silent', absWorkingDir: ROOT });
      out = res.outputFiles[0].text;
    }
    if (writeIfChanged(path.join(OUT, 'assets', id + '.js'), out)) nBundleWritten++;
    nBundles++;
  }
}

// ── 4b. Web Worker (site/seeding/seed_worker.js → out/assets/seed_worker.js。古典 script として new Worker(url) で読む) ──
const WORKERS = ['seeding/seed_worker.js'];
for (const rel of WORKERS) {
  const entry = path.join(SITE, rel);
  if (!fs.existsSync(entry)) continue;
  const res = esbuild.buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'esnext',
    charset: 'utf8', minify: false, sourcemap: false, legalComments: 'inline', logLevel: 'silent', absWorkingDir: ROOT });
  if (writeIfChanged(path.join(OUT, 'assets', path.basename(rel)), res.outputFiles[0].text)) nBundleWritten++;
  nBundles++;
}

// ── 3. sitemap ──
if (sitemap.length) {
  const byPage = new Map();
  for (const s of sitemap) { if (!byPage.has(s.page)) byPage.set(s.page, []); byPage.get(s.page).push(s); }
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">'];
  for (const [, list] of [...byPage.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const s of list) {
      lines.push('  <url>', `    <loc>${s.url}</loc>`);
      lines.push('  </url>');
    }
  }
  lines.push('</urlset>', '');
  writeIfChanged(path.join(OUT, 'sitemap.xml'), lines.join('\n'));
}

log(`build: region ${REGION}, langs ${LANGS.join('/')}, pages ${nPages} (既定言語 ${DEFAULT}、他は ?lang=) (written ${nWritten}), scripts ${nBundles} (written ${nBundleWritten}), static ${statics.length} (written ${nStatic}) → ${path.relative(ROOT, OUT) || '.'}`);
