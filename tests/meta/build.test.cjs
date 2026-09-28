'use strict';
// tools/build/build_site.mjs: site/ → dist/ (言語別の静的 HTML)。一時ディレクトリに作って検査する。
//   - 既定言語の 1 系統だけ出す (他言語は ?lang=。2026-09-28 から。以前は <lang>/ の木)
//   - 各ページの <html lang / data-root / data-lang-root>、辞書の直後の lang_boot.js、hreflang を出さない
//   - 参照 (script / link / img / a の相対パス) が全部 dist の中の実在ファイルかディレクトリを指す
//   - data-i18n は既定言語の文言で埋まり、属性は残る (?lang で差し替えるため)
//   - 決定的: 2 回目のビルドは何も書かない
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
let JSDOM = null;
try { JSDOM = require('jsdom').JSDOM; } catch (e) { /* jsdom 無し */ }

const ROOT = path.resolve(__dirname, '../..');
const BUILD = path.join(ROOT, 'tools/build/build_site.mjs');
let OUT = null;
function build() {
  if (OUT) return OUT;
  OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'spsp-site-build-'));
  execFileSync(process.execPath, [BUILD, '--out', OUT, '--quiet'], { cwd: ROOT, stdio: 'pipe' });
  return OUT;
}
function walkHtml(dir, rel = '', out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + ent.name : ent.name;
    if (ent.isDirectory()) walkHtml(path.join(dir, ent.name), r, out);
    else if (ent.name.endsWith('.html')) out.push(r);
  }
  return out;
}

test('ビルド: 既定言語の 1 系統だけ出す (en/ の木は無い)', (t) => {
  if (!JSDOM) return t.skip('jsdom 無し');
  const out = build();
  const all = walkHtml(out);
  assert.ok(all.includes('index.html') && all.includes('p/index.html') && all.includes('overview.html'));
  assert.deepStrictEqual(all.filter((r) => r.startsWith('en/')), [], 'en/ の木が出ている');
  assert.ok(fs.existsSync(path.join(out, 'region/config.js')), 'region/ が実体で無い');
  assert.ok(fs.existsSync(path.join(out, 'i18n/en.js')), '他言語の辞書 (?lang で読む) が無い');
  assert.ok(fs.existsSync(path.join(out, 'js/lang_boot.js')));
});

test('ビルド: html の lang / data-root / data-lang-root、lang_boot、hreflang 無し、data-i18n は残す', (t) => {
  if (!JSDOM) return t.skip('jsdom 無し');
  const out = build();
  const read = (r) => new JSDOM(fs.readFileSync(path.join(out, r), 'utf8')).window.document;
  const p = read('p/index.html');
  const h = p.documentElement;
  assert.strictEqual(h.getAttribute('lang'), 'ja');
  assert.strictEqual(h.getAttribute('data-root'), '../');
  assert.strictEqual(h.getAttribute('data-lang-root'), '../');
  // 辞書の直後に lang_boot.js (本文の script より前)
  const scripts = [...p.querySelectorAll('script[src]')].map((e) => e.getAttribute('src'));
  const di = scripts.indexOf('../i18n/ja.js');
  assert.ok(di >= 0 && scripts[di + 1] === '../js/lang_boot.js', scripts.join(' '));
  const idx = read('index.html');
  assert.strictEqual(idx.querySelectorAll('link[rel="alternate"][hreflang]').length, 0, 'hreflang が出ている');
  assert.strictEqual(idx.title, 'SPSP — スマブラSP プレイヤーランキング');
  const marked = idx.querySelectorAll('[data-i18n]');
  assert.ok(marked.length > 5, 'data-i18n が残っていない');
  // 日本語だけのページは印が付き、lang_boot を置かない (?lang を無視)
  const ov = read('overview.html');
  assert.ok(ov.documentElement.hasAttribute('data-default-lang-only'));
  assert.ok(!ov.querySelector('script[src$="lang_boot.js"]'));
  assert.ok(!h.hasAttribute('data-default-lang-only'));
});

test('ビルド: 相対参照が実在するファイル / ディレクトリを指す', (t) => {
  if (!JSDOM) return t.skip('jsdom 無し');
  const out = build();
  const bad = [];
  for (const r of walkHtml(out)) {
    const doc = new JSDOM(fs.readFileSync(path.join(out, r), 'utf8')).window.document;
    const dir = path.dirname(path.join(out, r));
    for (const [sel, attr] of [['script[src]', 'src'], ['link[href]', 'href'], ['img[src]', 'src'], ['a[href]', 'href']]) {
      for (const el of doc.querySelectorAll(sel)) {
        const v = el.getAttribute(attr);
        if (!v || /^(?:[a-z]+:|\/\/|\/|#|\?)/i.test(v)) continue;
        const clean = v.split('#')[0].split('?')[0];
        if (clean === '') continue;
        const target = path.resolve(dir, clean);
        if (!target.startsWith(out)) { bad.push(`${r}: ${v} (dist の外)`); continue; }
        // 生成物 (players/ data/ meta.json 等) はビルドが書くので無くてよい
        if (/(^|\/)(players|tournaments|history|data|blog)\//.test(path.relative(out, target)) || /^(meta\.json|players_current\.json|latest_tjpr_full\.jsonl)$/.test(path.relative(out, target))) continue;
        if (!fs.existsSync(target)) bad.push(`${r}: ${v}`);
      }
    }
  }
  assert.deepStrictEqual(bad, []);
});

test('ビルド: 決定的 (2 回目は何も書かない)', (t) => {
  if (!JSDOM) return t.skip('jsdom 無し');
  const out = build();
  const res = execFileSync(process.execPath, [BUILD, '--out', out], { cwd: ROOT, stdio: 'pipe' }).toString();
  assert.match(res, /\(written 0\)/);
  assert.match(res, /static \d+ \(written 0\)/);
});

test('ビルド: --clean-urls + --canonical で拡張子なしの canonical・リンク・config・sitemap', (t) => {
  if (!JSDOM) return t.skip('jsdom 無し');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spsp-site-clean-'));
  execFileSync(process.execPath, [BUILD, '--out', out, '--canonical', 'https://x.test/jp/', '--clean-urls', '--quiet'], { cwd: ROOT, stdio: 'pipe' });
  const read = (r) => new JSDOM(fs.readFileSync(path.join(out, r), 'utf8')).window.document;
  // クエリで中身が決まるページは静的な canonical を書かず、実行時に ?char= 付きで作る印を付ける
  const cr = read('c/ranking.html');
  assert.strictEqual(cr.querySelector('link[rel="canonical"]'), null);
  assert.strictEqual(cr.documentElement.getAttribute('data-canonical-base'), 'https://x.test/jp/c/ranking');
  assert.strictEqual(cr.documentElement.getAttribute('data-canonical-params'), 'char');
  assert.strictEqual(read('overview.html').querySelector('link[rel="canonical"]').getAttribute('href'), 'https://x.test/jp/overview');
  assert.strictEqual(read('vote.html').querySelector('link[rel="canonical"]').getAttribute('href'), 'https://x.test/jp/vote');
  assert.match(fs.readFileSync(path.join(out, 'region/config.js'), 'utf8'), /cleanUrls: true/);
  const hrefs = [...read('blog/index.html').querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => !/^(https?:|\/|#)/.test(h));
  assert.ok(hrefs.length && hrefs.every((h) => !/\.html(?:$|[?#])/.test(h)), hrefs.join(' '));
  assert.ok(!fs.existsSync(path.join(out, 'en')));
  const sm = fs.readFileSync(path.join(out, 'sitemap.xml'), 'utf8');
  assert.ok(!/<loc>[^<]*\.html<\/loc>/.test(sm), 'sitemap に .html が残っている');
  assert.ok(!/hreflang/.test(sm), 'sitemap に hreflang が残っている');
  assert.ok(sm.includes('<loc>https://x.test/jp/</loc>'));
});
