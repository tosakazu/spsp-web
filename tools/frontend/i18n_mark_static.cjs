#!/usr/bin/env node
// tools/frontend/i18n_mark_static.cjs — 静的 HTML に残る日本語のテキストノード / 属性に data-i18n を付けて辞書 (ja.js) に移す (機械的)。
//   node tools/frontend/i18n_mark_static.cjs --ns bracket.page --file site/bracket/index.html [--dry-run]
// テキストノードが親の最初の空白でないテキストなら親に data-i18n、そうでなければ <span data-i18n> で包む。
// title / placeholder / aria-label は data-i18n-attr。<script> / <style> / 既に data-i18n の付いた要素の中は触らない。
// jsdom で読んで文字列置換で書き戻す (serialize はしない: 元の HTML の字面を保つ)。
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const NS = opt('--ns'), FILE = opt('--file'), DRY = args.includes('--dry-run');
const JA = /[ぁ-んァ-ン一-龥]/;
let html = fs.readFileSync(FILE, 'utf8');
const dictPath = 'site/i18n/ja.js';
let dict = fs.readFileSync(dictPath, 'utf8');
const existing = new Map([...dict.matchAll(/^  '([^']+)': '((?:[^'\\]|\\.)*)',$/gm)].map((m) => [m[2].replace(/\\'/g, "'"), m[1]]));
let n = Math.max(0, ...[...dict.matchAll(new RegExp("^  '" + NS.replace('.', '\\.') + "\\.t(\\d+)':", 'gm'))].map((m) => +m[1]));
const added = [];
const keyFor = (v) => { const byVal = [...existing].find(([val, k]) => val === v && k.startsWith(NS + '.')); if (byVal) return byVal[1]; n++; const k = `${NS}.t${n}`; existing.set(v, k); added.push([k, v]); return k; };
const doc = new JSDOM(html).window.document;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let changes = 0;
const walker = doc.createTreeWalker(doc.body, 4);
const nodes = [];
while (walker.nextNode()) nodes.push(walker.currentNode);
for (const t of nodes) {
  const p = t.parentNode;
  if (!p || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(p.tagName)) continue;
  // 親 (か先祖) に data-i18n が付いていても、それが受け持つのは最初のテキストノードだけ。2 つ目以降の日本語は span で包む
  const keyed = p.closest('[data-i18n]');
  if (keyed) {
    const firstOfKeyed = [...keyed.childNodes].find((c) => c.nodeType === 3 && c.nodeValue.trim() !== '');
    if (firstOfKeyed === t || p.tagName === 'SPAN' && p.hasAttribute('data-i18n')) continue;
  }
  const raw = t.nodeValue; const val = raw.trim().replace(/\s*\n\s*/g, ' ');   // 辞書の値は 1 行 (HTML の描画では同じ)
  if (!JA.test(val)) continue;
  const firstText = [...p.childNodes].find((c) => c.nodeType === 3 && c.nodeValue.trim() !== '');
  const k = keyFor(val);
  if (firstText === t && !p.hasAttribute('data-i18n')) {
    // 親の開始タグに data-i18n を足す: 元の HTML の中で「<tag …>」+ このテキスト の並びを探す
    const tag = p.tagName.toLowerCase();
    const re = new RegExp('(<' + tag + '\\b[^>]*)(>)([^<]*' + esc(val) + ')');
    const before = html;
    html = html.replace(re, (m, a, b, c) => (a.includes('data-i18n') ? m : `${a} data-i18n="${k}"${b}${c}`));
    if (html !== before) { changes++; p.setAttribute('data-i18n', k); }
    else {   // 親の開始タグとテキストの間に別の要素 (<label><input> 文言</label> 等) がある: span で包む
      const b2 = html; html = html.replace(val, `<span data-i18n="${k}">${val}</span>`);
      if (html !== b2) changes++; else console.error('  ! could not mark:', tag, val.slice(0, 40));
    }
  } else {
    const before = html;
    html = html.replace(val, `<span data-i18n="${k}">${val}</span>`);
    if (html !== before) changes++; else console.error('  ! could not wrap:', val.slice(0, 40));
  }
}
for (const el of doc.querySelectorAll('[title],[placeholder],[aria-label]')) {
  if (el.closest('script') || el.hasAttribute('data-i18n-attr')) continue;
  const pairs = [];
  for (const a of ['title', 'placeholder', 'aria-label']) {
    const v = el.getAttribute(a); if (!v || !JA.test(v)) continue;
    const k = keyFor(v); pairs.push(`${a}:${k}`);
    const before = html; html = html.replace(`${a}="${v}"`, `${a}="${v}" data-i18n-attr="${a}:${k}"`); if (html !== before) changes++;
  }
}
console.error(`${FILE}: ${changes} 箇所、辞書に ${added.length} 件 (${NS})`);
if (DRY) { for (const [k, v] of added) console.log(`  '${k}': '${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`); process.exit(0); }
if (added.length) {
  const block = `\n  // ── ${NS} (${FILE}) — tools/frontend/i18n_mark_static.cjs で機械的に抽出 (静的 HTML) ──\n` + added.map(([k, v]) => `  '${k}': '${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',\n`).join('');
  const i = dict.trimEnd().lastIndexOf('};');
  fs.writeFileSync(dictPath, dict.trimEnd().slice(0, i).replace(/\n+$/, '') + '\n' + block + '};\n');
}
fs.writeFileSync(FILE, html);
