#!/usr/bin/env node
// tools/frontend/css_extract.cjs — 複数ページの inline <style> から「全ページで同一のルール」を共通 CSS ファイルへ移す。
//
//   NODE_PATH=<jsdom の node_modules> node tools/frontend/css_extract.cjs --out site/css/xxx.css --href-from-site css/xxx.css \
//       [--exclude-css site/css/site.css ...] [--dry-run] page1.html page2.html ...
//
// - ルール = (@media, セレクタ, 宣言ブロック)。全ページに同じ (media, セレクタ) があり宣言も同一なら共通。
//   同じ (media, セレクタ) が 1 ページに 2 回以上あるものは対象外 (順序で意味が変わるため)。
// - 共通 CSS は最初のページの出現順。@media の中のものは同じ @media にまとめる。
// - 各ページでは該当ルールをテキストから切り取り (コメント・整形はそのまま)、空になった @media は丸ごと消す。
//   <style> の直前に <link rel="stylesheet" href="…"> を入れる (ページの階層に応じて ../ を付ける)。
// - --exclude-css: 既に別の共通ファイルに入っているルールは対象外にする (二重に移さない)。
// 移した後は tests/frontend/compare_with_ref.sh <ref> --computed で cascade が同じことを確かめる。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const csstree = require('css-tree');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const OUT = opt('--out');
const HREF = opt('--href-from-site');
const DRY = args.includes('--dry-run');
const EXCLUDES = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--exclude-css') EXCLUDES.push(args[i + 1]);
const pages = args.filter((a, i) => !a.startsWith('--') && !['--out', '--href-from-site', '--exclude-css'].includes(args[i - 1]));
if (!OUT || !HREF || !pages.length) { console.error('usage: --out <css> --href-from-site <href> pages...'); process.exit(2); }

const norm = (s) => s.replace(/\s+/g, ' ').replace(/\s*:\s*/g, ':').trim();

// ページの <style> ブロック (最初の 1 つ) を解析してルール一覧 (位置付き) を返す
function analyze(file) {
  const html = fs.readFileSync(file, 'utf8');
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  if (!m) throw new Error(file + ': <style> が無い');
  const cssStart = m.index + '<style>'.length;
  const css = m[1];
  const ast = csstree.parse(css, { positions: true, parseValue: false, parseRulePrelude: false, parseAtrulePrelude: false });
  const rules = [];
  const medias = new Map();   // atrule node -> {start,end,media}
  csstree.walk(ast, { visit: 'Rule', enter(node) {
    let media = '';
    if (this.atrule) {
      if (this.atrule.name !== 'media') return;
      media = norm(csstree.generate(this.atrule.prelude));
      if (!medias.has(this.atrule)) medias.set(this.atrule, { start: this.atrule.loc.start.offset, end: this.atrule.loc.end.offset, media, rules: [] });
    }
    const r = {
      media, sel: norm(csstree.generate(node.prelude)), decl: csstree.generate(node.block).replace(/\s+/g, ' ').trim(),
      start: node.loc.start.offset, end: node.loc.end.offset, atrule: this.atrule || null,
      text: css.slice(node.loc.start.offset, node.loc.end.offset),
    };
    r.key = r.media + ' || ' + r.sel;
    rules.push(r);
    if (this.atrule) medias.get(this.atrule).rules.push(r);
  } });
  return { file, html, css, cssStart, rules, medias };
}

function excludedKeys() {
  const keys = new Set();
  for (const f of EXCLUDES) {
    const css = fs.readFileSync(f, 'utf8');
    const ast = csstree.parse(css, { positions: false, parseValue: false, parseRulePrelude: false, parseAtrulePrelude: false });
    csstree.walk(ast, { visit: 'Rule', enter(node) {
      const media = this.atrule && this.atrule.name === 'media' ? norm(csstree.generate(this.atrule.prelude)) : '';
      keys.add(media + ' || ' + norm(csstree.generate(node.prelude)));
    } });
  }
  return keys;
}

const P = pages.map(analyze);
const excluded = excludedKeys();
// key -> 各ページの宣言一覧
const counts = P.map((p) => { const m = new Map(); for (const r of p.rules) m.set(r.key, (m.get(r.key) || []).concat([r.decl])); return m; });
const shared = [];
for (const r of P[0].rules) {
  if (excluded.has(r.key)) continue;
  if (counts.some((m) => !m.has(r.key) || m.get(r.key).length !== 1)) continue;
  if (counts.some((m) => m.get(r.key)[0] !== r.decl)) continue;
  if (shared.some((s) => s.key === r.key)) continue;
  shared.push(r);
}
const sharedKeys = new Set(shared.map((s) => s.key));
console.error(`共通ルール ${shared.length} 件 (${pages.length} ページ)`);

// 共通 CSS を書く: base → @media ごと (最初のページの順)
function emitShared() {
  const lines = [`/* ${path.basename(OUT)} — 共通スタイル (tools/frontend/css_extract.cjs で ${pages.map((p) => path.relative('site', p)).join(', ')} から抽出)。`,
    '   ページ固有の上書きは各ページの <style> に残っている。見た目を変えるときは cascade の順 (この file → ページの <style>) に注意 */'];
  const byMedia = new Map();
  for (const s of shared) { if (!byMedia.has(s.media)) byMedia.set(s.media, []); byMedia.get(s.media).push(s); }
  for (const [media, rs] of byMedia) {
    if (media) lines.push(`@media ${media} {`);
    for (const r of rs) lines.push((media ? '  ' : '') + r.text.replace(/\n\s*/g, media ? '\n    ' : '\n  ').replace(/\n\s*\}$/, media ? '\n  }' : '\n}'));
    if (media) lines.push('}');
  }
  return lines.join('\n') + '\n';
}

function rewritePage(p) {
  let css = p.css;
  // 削除範囲を集める (ルール本体 + 直後の改行)。空になる @media は丸ごと
  const cuts = [];
  for (const [, mb] of p.medias) {
    const remaining = mb.rules.filter((r) => !sharedKeys.has(r.key));
    if (!remaining.length) { cuts.push([mb.start, mb.end]); }
  }
  for (const r of p.rules) {
    if (!sharedKeys.has(r.key)) continue;
    if (r.atrule && cuts.some(([a, b]) => r.start >= a && r.end <= b)) continue;   // @media ごと消える
    cuts.push([r.start, r.end]);
  }
  cuts.sort((a, b) => b[0] - a[0]);
  for (const [a, b0] of cuts) {
    let b = b0;
    // 行末までの空白と改行を 1 つ食う (行ごと消す)
    const tail = /^[ \t]*\n/.exec(css.slice(b));
    if (tail) b += tail[0].length;
    // 行頭の空白も
    let a2 = a;
    while (a2 > 0 && (css[a2 - 1] === ' ' || css[a2 - 1] === '\t')) a2--;
    if (a2 === 0 || css[a2 - 1] === '\n') css = css.slice(0, a2) + css.slice(b);
    else css = css.slice(0, a) + css.slice(b);
  }
  // 3 連続以上の空行を 2 つに
  css = css.replace(/\n{3,}/g, '\n\n');
  const depth = path.relative('site', path.dirname(p.file)).split(path.sep).filter(Boolean).length;
  const href = '../'.repeat(depth) + HREF;
  const link = `<link rel="stylesheet" href="${href}">\n`;
  const html = p.html.slice(0, p.cssStart - '<style>'.length) + link + '<style>' + css + p.html.slice(p.cssStart + p.css.length);
  return html;
}

if (DRY) {
  for (const s of shared) console.log(s.key);
  process.exit(0);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, emitShared());
for (const p of P) fs.writeFileSync(p.file, rewritePage(p));
console.error(`書いた: ${OUT} と ${P.length} ページ`);
