// tools/ghpages_redirect/build.mjs — 旧サイト (tosakazu.github.io/spsp/) を spsp.games への転送ページに置き換えるためのファイル群を作る (2026-09-28)。
//
//   node tools/ghpages_redirect/build.mjs --from <旧サイトの spsp/ ディレクトリ> --out <出力ディレクトリ> [--to https://spsp.games/jp/] [--delay 3]
//
// 旧サイトにある HTML ページ (players/ tournaments/ history/ などのデータは除く) と同じパスに、転送ページを 1 枚ずつ置く。
// どのページも同じ _moved.js を読み、自分の場所 (_moved.js のあるディレクトリ = 旧サイトのルート) からの相対パスを新しい URL に写す:
//   'index.html' → ''、'p/index.html' → 'p/'、'c/ranking.html' → 'c/ranking' (spsp.games は拡張子なし)。クエリ (?uid= ?pref= …) と # はそのまま渡す。
// 既定は即時に移動する (--delay 0。<head> の中で判定して location.replace)。GitHub Pages は 301 を返せないので、即時の JS 転送 + canonical が
// 検索エンジンにとって恒久的な移転の合図になる (待ち時間があると弱い: 2026-09-28 のレビュー)。?stay=1 で自動移動を止めて中身を確認できる (転送先には渡さない)。
// 本文 (移転の案内と新しい URL へのリンク) は、JS が無い環境と ?stay=1 のため。JS が無い環境は <noscript> の meta refresh でクエリ無しの新しいページへ。
// canonical: クエリで中身が決まるページ (選手・大会・キャラ別・県別・シリーズ別) は JS がクエリ付きで付け、それ以外は静的に書く。
// 旧サイトの置き場を問わない (/spsp/ でも /b/<name>/spsp/ でも動く)。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const FROM = opt('--from', '');
const OUT = opt('--out', '');
const TO = opt('--to', 'https://spsp.games/jp/');
const DELAY = Number(opt('--delay', '0'));
if (!FROM || !OUT) { console.error('usage: --from <旧サイトの spsp/> --out <出力>'); process.exit(2); }
if (!/^https:\/\/[^/]+\/.*\/$/.test(TO)) throw new Error('--to は https://…/ (末尾 /) で: ' + TO);

const SKIP = new Set(['players', 'tournaments', 'history', 'data', 'js', 'node_modules']);
/** @returns {string[]} 旧サイトのルートからの相対パス (HTML だけ) */
function pages(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!rel && SKIP.has(e.name)) continue; out.push(...pages(dir, r)); }
    else if (e.name.endsWith('.html')) out.push(r);
  }
  return out.sort();
}
// クエリで中身が決まるページ (canonical は転送先と同じくクエリ付きで JS が付ける)
const QUERY_PAGES = new Set(['p/index.html', 't/index.html', 'c/ranking.html', 'pref/ranking.html', 'local/ranking.html']);
const urlRel = (rel) => rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const JS = `// 旧サイト (tosakazu.github.io/spsp/) → spsp.games の転送 (tools/ghpages_redirect/build.mjs が生成。<head> で読む)
(function () {
  var TO = ${JSON.stringify(TO)};
  var DELAY = ${DELAY};
  var me = document.currentScript && document.currentScript.src;
  var base = me ? new URL('.', me).pathname : '/spsp/';
  var rel = location.pathname.indexOf(base) === 0 ? location.pathname.slice(base.length) : '';
  rel = rel.replace(/(^|\\/)index\\.html$/, '$1').replace(/\\.html$/, '');
  var params = new URLSearchParams(location.search);
  var stay = params.get('stay') === '1';
  params.delete('stay');
  var q = params.toString();
  var hash = location.hash;
  // 旧サイトのログインの戻り先 (callback.html) は認可コードを載せているので渡さない。投票ページへ (クエリ無し)
  if (rel === 'callback') { rel = 'vote'; q = ''; hash = ''; }
  var target = TO + rel + (q ? '?' + q : '') + hash;
  if (!document.querySelector('link[rel="canonical"]')) {
    var link = document.createElement('link'); link.rel = 'canonical'; link.href = target.split('#')[0]; document.head.appendChild(link);
  }
  if (!stay && DELAY <= 0) { location.replace(target); return; }
  document.addEventListener('DOMContentLoaded', function () {
    var a = document.getElementById('moved-link');
    if (a) { a.href = target; a.textContent = target; }
    var cd = document.getElementById('moved-count');
    if (stay) { if (cd) cd.textContent = '(確認用の表示です。自動では移動しません / Preview: no automatic redirect)'; return; }
    var left = DELAY;
    var tick = function () {
      if (cd) cd.textContent = left + ' 秒後に自動で移動します / Redirecting in ' + left + ' s…';
      if (left <= 0) { location.replace(target); return; }
      left--; setTimeout(tick, 1000);
    };
    tick();
  });
})();
`;

function page(rel) {
  const depth = rel.split('/').length - 1;
  const up = '../'.repeat(depth);
  const fallback = TO + (rel === 'callback.html' ? 'vote' : urlRel(rel));
  const queryPage = QUERY_PAGES.has(rel);
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SPSP は spsp.games に移転しました</title>
${queryPage ? '' : `<link rel="canonical" href="${esc(fallback)}">\n`}<noscript><meta http-equiv="refresh" content="${DELAY}; url=${esc(fallback)}"></noscript>
<script src="${up}_moved.js"></script>
<style>
  :root { color-scheme: light dark; --fg: #111827; --sub: #4b5563; --bg: #ffffff; --accent: #dc2626; --card: #f9fafb; --line: #e5e7eb; }
  @media (prefers-color-scheme: dark) { :root { --fg: #f3f4f6; --sub: #9ca3af; --bg: #111827; --accent: #f87171; --card: #1f2937; --line: #374151; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; line-height: 1.7; }
  main { max-width: 560px; margin: 12vh auto 0; padding: 0 16px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin: 16px 0; }
  .label { font-size: 13px; color: var(--sub); margin: 0 0 4px; }
  a#moved-link { color: var(--accent); font-weight: 600; word-break: break-all; font-size: 17px; }
  .note { color: var(--sub); font-size: 14px; }
  .en { color: var(--sub); font-size: 13px; border-top: 1px solid var(--line); margin-top: 24px; padding-top: 12px; }
</style>
</head>
<body>
<main>
  <h1>SPSP は spsp.games に移転しました</h1>
  <div class="card">
    <p class="label">新しいアドレス</p>
    <a id="moved-link" href="${esc(fallback)}">${esc(fallback)}</a>
  </div>
  <p id="moved-count">${DELAY > 0 ? `${DELAY} 秒後に自動で移動します。` : '自動で移動します。移動しない場合は上のリンクを押してください。'}</p>
  <p class="note">ブックマークやリンクは新しいアドレスに変更してください。</p>
  <p class="en">SPSP has moved to <strong>spsp.games</strong>. You will be redirected automatically. Please update your bookmarks.</p>
</main>
</body>
</html>
`;
}

const list = pages(FROM);
fs.rmSync(OUT, { recursive: true, force: true });
for (const rel of list) {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, page(rel));
}
fs.writeFileSync(path.join(OUT, '_moved.js'), JS);
console.log(`ghpages_redirect: ${list.length} pages + _moved.js → ${OUT} (to ${TO}, delay ${DELAY}s)`);
for (const rel of list) console.log(`  ${rel} → ${TO}${rel === 'callback.html' ? 'vote (クエリは渡さない)' : urlRel(rel)}`);
