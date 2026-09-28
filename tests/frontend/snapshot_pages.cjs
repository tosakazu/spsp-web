#!/usr/bin/env node
// tests/frontend/snapshot_pages.cjs — フロントの「見た目不変」を機械的に確かめるための DOM スナップショット。
//
// 実ページを jsdom で動かし (script は文書順に実行、nav.js / logo.js 込み)、ビルド出力 (deployed 相当) を
// fetch の代わりに読ませ、読み込み完了と操作 (タブ切替・行展開・検索・ページ送り) のたびに DOM を書き出す。
// リファクタ前後で同じデータ・同じ固定時刻で走らせ、出力ディレクトリを diff -r して差が無ければ描画結果は同じ。
//
//   TZ=Asia/Tokyo NODE_PATH=<jsdom の node_modules> node tests/frontend/snapshot_pages.cjs \
//       --data <deployed dir> --out <snapshot dir> [--freeze <dir>] [--only <scenario 名の正規表現>] [--site <site dir>] [--region <REGION>]
//
//   --freeze <dir>: 読んだデータファイルをそこへ写し、以後はそちらを優先して読む (nightly でデータが変わっても同じ入力で比べられる)。
//
// 書き出すもの (scenario ごとのディレクトリ):
//   NN_<step>.html  … document.documentElement.outerHTML から <script> / <style> / <link rel=stylesheet> を除いたもの
//   NN_<step>.css   … その時点の <style> と stylesheet の中身を文書順に連結したもの (カスケード順ごと同じかを見る)
//   NN_<step>.charts.json … Chart.js に渡した data/options (スタブが記録)
//   NN_<step>.computed.txt … --computed 時: 全要素の「勝つ宣言」(自前 cascade) のハッシュ (メディアクエリの変種ごと)。
//   NN_<step>.stylesheets.txt … --computed 時: スタイルシートの並び (参考)
//                       CSS を別ファイルへ移すなど「CSS テキストの順序が変わる」変更は .css の一致では見られないので、
//                       こちらで「どの要素にどのスタイルが当たるか」が同じことを見る。--dump-computed で全行も書く
//   errors.txt      … 未捕捉例外 / console.error / 未解決 fetch
//
// 時刻は 2026-09-13 21:30 JST に固定、Math.random は決定的な列に置き換える。CDN (Chart.js / luxon / PapaParse / html2canvas /
// GA) は最小スタブ。ブラウザが使えない環境用なので、レイアウト (幅・折返し) は見ない。
'use strict';
const fs = require('node:fs');
const path = require('node:path');
let jsdom = null;
try { jsdom = require('jsdom'); } catch (e) { console.error('jsdom が無い (NODE_PATH を確認)'); process.exit(2); }
const { JSDOM, VirtualConsole, requestInterceptor } = jsdom;

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DATA = path.resolve(opt('--data'));
const OUT = path.resolve(opt('--out'));
const FREEZE = opt('--freeze') ? path.resolve(opt('--freeze')) : null;
const ONLY = opt('--only', '');   // scenario 名の正規表現 (部分一致)。ConoHa の CPU 時間制限 (~300s/プロセス) に当たるときは分割して走らせる
const COMPUTED = args.includes('--computed');        // 各要素の computed style (メディアクエリの変種ごと) も記録する (遅い)
const DUMP_COMPUTED = args.includes('--dump-computed'); // ハッシュだけでなく全行を書く (差分の調査用)
const crypto = require('node:crypto');
const SITE = path.resolve(opt('--site', path.join(__dirname, '../../site')));   // 比べる側の site/ (git archive した旧版などを指せる)
const REGION = opt('--region', null);
const BASE = opt('--base', '/');
const IGNORE_SEL = opt('--ignore', null);
const LANG_DIR = opt('--lang', null);   // 表示言語: scenario の URL に ?lang=<lang> を足して開く (2026-09-28 から言語は ?lang。以前は dist/<lang>/ の木)   // この selector に当たる要素 (と子孫) を DOM と cascade の記録から外す (例 --ignore .nav-lang: 新設 UI を無視して他が不変か見る)   // サイトをこのパス接頭辞の下に置いて走らせる (例 /jp/)。接頭辞の外への要求 (絶対パスの直書き) は errors に出す   // 地域を差し替えて走らせる: region/* を regions/<REGION>/* から配る (既定は site/region の symlink 先 = 配信中の地域)
const ORIGIN = 'https://spsp.games';
const FIXED_NOW = Date.parse('2026-09-13T21:30:00+09:00');
const SETTLE_MS = 500;      // fetch 無し・DOM 変化無しがこれだけ続いたら「落ち着いた」
const MAX_WAIT_MS = 30000;

const DATA_RE = /^(players|history|tournaments|data)\/|^(players_current\.json|meta\.json|latest_tjpr_full\.jsonl|news\.json)$/;

function readData(rel) {
  // FREEZE → DATA の順。FREEZE 指定時は DATA から読んだものを FREEZE に写す
  if (FREEZE) {
    const f = path.join(FREEZE, rel);
    if (fs.existsSync(f)) return fs.readFileSync(f);
  }
  const p = path.join(DATA, rel);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) return null;
  const buf = fs.readFileSync(p);
  if (FREEZE) {
    // base / after の 2 プロセスが同時に埋めるので、書きかけを相手に読ませない (一時ファイル → rename)
    const f = path.join(FREEZE, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = f + '.tmp' + process.pid;
    fs.writeFileSync(tmp, buf);
    try { fs.renameSync(tmp, f); } catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* 相手が先に置いた */ } }
  }
  return buf;
}

function contentType(rel) {
  if (/\.js$/.test(rel)) return 'application/javascript; charset=utf-8';
  if (/\.css$/.test(rel)) return 'text/css; charset=utf-8';
  if (/\.json$/.test(rel)) return 'application/json; charset=utf-8';
  if (/\.html?$/.test(rel)) return 'text/html; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

// CDN スタブ (script は空にして beforeParse でグローバルを用意する)
function cdnStub(url) {
  if (/googletagmanager|google-analytics/.test(url)) return '';
  if (/script\.google\.com/.test(url)) return '';   // 投稿・投票の GAS (callback.html が読み込み時に叩く)。中身は見ない
  if (/chart\.js|chartjs|luxon|papaparse|html2canvas|mathjax/i.test(url)) return '';
  return null;
}

// サイト内の相対パス → 中身 (データは FREEZE/DATA、それ以外は site/)。無ければ null
function resolveLocal(rel) {
  let buf = null;
  if (DATA_RE.test(rel)) buf = readData(rel);
  if (buf === null) {
    const p = path.join(SITE, REGION && rel.startsWith('region/') ? 'regions/' + REGION + rel.slice('region'.length) : rel);
    if (fs.existsSync(p) && !fs.statSync(p).isDirectory()) buf = fs.readFileSync(p);
  }
  return buf;
}

function serve(url, state) {
  let rel = null;
  if (url.startsWith(ORIGIN + '/')) {
    rel = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
    if (BASE !== '/') {
      if (rel.startsWith(BASE.slice(1))) rel = rel.slice(BASE.length - 1);
      else state.errors.push('request outside base ' + BASE + ': /' + rel);
    }
  }
  if (rel === null) {
    const stub = cdnStub(url);
    state.hits.push(url);
    if (stub !== null) return new Response(stub, { status: 200, headers: { 'Content-Type': 'application/javascript' } });
    state.errors.push('external request: ' + url);
    return new Response('', { status: 404 });
  }
  state.hits.push(rel);
  const buf = resolveLocal(rel);
  if (buf === null) return new Response('', { status: 404 });
  return new Response(buf, { status: 200, headers: { 'Content-Type': contentType(rel) } });
}

// <script src> / <link> 用 (jsdom の資源読み込み)
function makeInterceptor(state) {
  return requestInterceptor(async (request) => {
    state.pending++;
    try { return serve(request.url, state); } finally { state.pending--; state.lastActivity = Date.now(); }
  });
}

// window.fetch (jsdom には無い)。ページ URL からの相対で解決する
function makeFetch(w, state) {
  return async function (url, init) {
    const abs = new URL(String(url), w.location.href).href;
    state.pending++;
    try {
      await sleep(1);   // 実ブラウザ同様に非同期で返す
      return serve(abs, state);
    } finally { state.pending--; state.lastActivity = Date.now(); }
  };
}

function installStubs(w, state) {
  // 固定時刻・決定的乱数
  // 「今」は固定時刻から実時間ぶんだけ進む (経過時間で待つ処理 = logo.js の introGate 等が止まらないように)。
  // 走行は数分なので、表示に出る日付・日数は固定時刻のものになる
  const RealDate = w.Date;
  const t0 = RealDate.now();
  const now = () => FIXED_NOW + (RealDate.now() - t0);
  class FixedDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now()); else super(...a); }
    static now() { return now(); }
  }
  w.Date = FixedDate;
  w.performance.now = () => 0;   // 「(179ms)」のような計測表示を固定
  let seed = 12345;
  w.Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  // Chart.js: 渡された設定を記録するだけ
  class Chart {
    constructor(c, cfg) { this.config = cfg; this.data = cfg && cfg.data; this.options = cfg && cfg.options; state.charts.push(this); }
    destroy() { const i = state.charts.indexOf(this); if (i >= 0) state.charts.splice(i, 1); }
    update() {} resize() {} toBase64Image() { return ''; }
  }
  Chart.register = () => {}; Chart.defaults = { font: {}, plugins: {} };
  w.Chart = Chart;
  w.luxon = {
    Settings: { defaultZone: 'system' },
    DateTime: { fromISO: (s) => ({ toJSDate: () => new RealDate(s), toMillis: () => RealDate.parse(s) }), fromMillis: (ms) => ({ toJSDate: () => new RealDate(ms) }) },
  };
  w.Papa = { parse: () => ({ data: [], errors: [] }), unparse: () => '' };
  w.html2canvas = () => Promise.reject(new Error('html2canvas stub'));
  w.requestAnimationFrame = (f) => w.setTimeout(f, 0);
  w.cancelAnimationFrame = (id) => w.clearTimeout(id);
  // reduced-motion 扱い: logo.js の intro gate (1.3 秒の演出待ち) を飛ばす。演出の有無は DOM の中身に関係しない
  w.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  w.HTMLCanvasElement.prototype.getContext = () => ({ measureText: () => ({ width: 10 }), fillRect() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, closePath() {}, translate() {}, rotate() {}, scale() {}, setTransform() {}, createLinearGradient: () => ({ addColorStop() {} }) });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:,';
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.scrollTo = () => {};
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.gtag = () => {};
  w.dataLayer = [];
  w.__SPSP_GA_LOADED = true;   // nav.js の GA 読み込みを止める (外部 script を挿さない)
  w.fetch = makeFetch(w, state);
  w.Response = Response; w.Headers = Headers; w.Request = Request;
  // localStorage は jsdom にあるが、ページ間で共有しない (毎回まっさら)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function settle(w, state) {
  const start = Date.now();
  let quietSince = Date.now();
  let lastMut = state.mutations;
  while (Date.now() - start < MAX_WAIT_MS) {
    await sleep(50);
    if (state.pending > 0 || state.mutations !== lastMut || Date.now() - state.lastActivity < 100) {
      lastMut = state.mutations; quietSince = Date.now(); continue;
    }
    if (Date.now() - quietSince >= SETTLE_MS) return true;
  }
  state.errors.push('settle timeout (pending=' + state.pending + ')');
  return false;
}

function serialize(w) {
  const doc = w.document;
  const clone = doc.documentElement.cloneNode(true);
  const cssParts = [];
  // 文書順に <style> と stylesheet を集める
  for (const el of doc.querySelectorAll('style, link[rel="stylesheet"]')) {
    if (el.tagName === 'STYLE') cssParts.push('/* <style' + (el.id ? ' id=' + el.id : '') + '> */\n' + el.textContent);
    else {
      const href = el.getAttribute('href') || '';
      let txt = '';
      if (/^https?:/.test(href)) txt = '/* external ' + href + ' */';
      else {
        const rel = decodeURIComponent(new URL(href, doc.URL).pathname.replace(/^\//, ''));
        if (!/\.css$/.test(rel)) continue;   // href が空などで自分自身を指す <link> (ブラウザも CSS として読まない)
        const p = path.join(SITE, rel);
        txt = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '/* missing ' + rel + ' */';
      }
      cssParts.push('/* <link ' + href + '> */\n' + txt);
    }
  }
  for (const el of clone.querySelectorAll('script, style, link')) {   // link は stylesheet も canonical / hreflang / icon も描画に出ない
    // タグ直後の改行 (空白だけのテキストノード) も一緒に落とす: script の増減で行が変わらないように
    const nx = el.nextSibling;
    if (nx && nx.nodeType === 3 && !nx.nodeValue.trim()) nx.remove();
    el.remove();
  }
  // <head> の空白だけのテキストノードは script/link の増減で変わる (描画に関係しない) ので落とす
  const head = clone.querySelector('head');
  if (head) {
    const walker = w.document.createTreeWalker(head, 4 /* SHOW_TEXT */);
    const drop = [];
    while (walker.nextNode()) if (!walker.currentNode.nodeValue.trim()) drop.push(walker.currentNode);
    drop.forEach((n) => n.remove());
  }
  // 文言辞書の印 (data-i18n / data-i18n-attr) は描画に関係しないので落とす。属性は名前順に並べ直す
  // (outerHTML は属性の挿入順を保つが、順序は描画に関係しない。リンク組み立ての共通化で順が変わるため)
  for (const el of [clone, ...clone.querySelectorAll('*')]) {   // <html> 自身 (data-root 等) も
    const names = el.getAttributeNames();
    if (!names.length) continue;
    const pairs = names.filter((n) => !/^data-(i18n|root|lang-root)/.test(n)).map((n) => [n, el.getAttribute(n)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const n of names) el.removeAttribute(n);
    for (const [n, v] of pairs) el.setAttribute(n, v);
  }
  // ロゴのアニメーション状態 (is-on / is-loop) は時間依存なので落とす
  for (const el of clone.querySelectorAll('.is-on, .is-loop')) { el.classList.remove('is-on'); el.classList.remove('is-loop'); if (!el.getAttribute('class')) el.removeAttribute('class'); }
  if (IGNORE_SEL) for (const el of [...clone.querySelectorAll(IGNORE_SEL)]) el.remove();
  // body の空白だけのテキストノードは改行 1 つに (script の位置の違いで空行が増減しても描画は変わらない)
  {
    const walker = w.document.createTreeWalker(clone, 4 /* SHOW_TEXT */);
    const ws = [];
    while (walker.nextNode()) { const n = walker.currentNode; if (!n.nodeValue.trim() && n.nodeValue.includes('\n')) ws.push(n); }
    for (const n of ws) { if (n.parentNode && n.parentNode.tagName !== 'PRE' && n.parentNode.tagName !== 'TEXTAREA') n.nodeValue = '\n'; }
    // 文字を含むテキストノードの中の改行+字下げも 1 つの空白に (HTML の描画では同じ。ビルド時に埋めた文言は 1 行になる)
    const tw = w.document.createTreeWalker(clone, 4);
    const txt = [];
    while (tw.nextNode()) { const n = tw.currentNode; if (n.nodeValue.trim() && /\s*\n\s*/.test(n.nodeValue)) txt.push(n); }
    for (const n of txt) { if (n.parentNode && n.parentNode.tagName !== 'PRE' && n.parentNode.tagName !== 'TEXTAREA') n.nodeValue = n.nodeValue.replace(/\s*\n\s*/g, ' '); }
  }
  let html = clone.outerHTML;
  // 属性の順序や空白は jsdom が正規化する。改行を揃えて diff を読みやすく
  html = html.replace(/></g, '>\n<');
  const css = cssParts.join('\n').replace(/\s+/g, ' ').replace(/ ?([{};:,]) ?/g, '$1').trim();
  return { html, css };
}


// ── declared style の cascade (--computed) ──
// CSS を別ファイルへ移す・並べ替えるといった変更で「どの要素にどの宣言が勝つか」が変わっていないかを見る。
// jsdom の getComputedStyle は対応プロパティが限られるので、自前で cascade する:
//   ルールを文書順に取り出し、各セレクタの要素集合を querySelectorAll で求め、
//   (important, 詳細度, 出現順) で勝つ宣言を要素×プロパティごとに決める。継承・初期値は見ない
//   (スタイルシートの構成を変えても、要素ごとの宣言値が同じなら描画は同じ)。
//   :hover / :focus などの動的擬似クラスと ::before などの擬似要素は、その部分を外して要素を求め、
//   擬似の名前をキーに含めて別枠で比べる。@media は変種ごと (base = @media 無し、各 @media = その場で展開)。
//   querySelectorAll が受け付けないセレクタはルールのテキストそのものをハッシュに入れる (変わればわかる)。
let csstree = null;
try { csstree = require('css-tree'); } catch (e) { /* --computed のときだけ必要 */ }

const DYNAMIC_PSEUDO = /:(hover|focus|focus-within|focus-visible|active|visited|link|target)\b/g;
const PSEUDO_ELEMENT = /::?(before|after|placeholder|selection|marker|first-line|first-letter|-webkit-[a-z-]+|-moz-[a-z-]+)\b/g;

function specificity(sel) {
  // 概算: id / (class, 属性, 擬似クラス) / (要素, 擬似要素)。:not() :is() :has() の中身も数える (両側同じ計算なので比較には十分)
  let a = 0, b = 0, c = 0;
  const s = sel.replace(/::?[a-z-]+\([^)]*\)/g, (m) => { const inner = m.slice(m.indexOf('(') + 1, -1); const sp = specificity(inner); a += sp[0]; b += sp[1]; c += sp[2]; return ' '; });
  a += (s.match(/#[\w-]+/g) || []).length;
  b += (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) || []).length;
  c += (s.match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length + (s.match(/::[\w-]+/g) || []).length;
  return [a, b, c];
}

function splitMedia(css) {
  const parts = [];
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at < 0) { parts.push({ q: null, t: css.slice(i) }); break; }
    parts.push({ q: null, t: css.slice(i, at) });
    const br = css.indexOf('{', at);
    const q = css.slice(at + 6, br).replace(/\s+/g, ' ').replace(/\s*:\s*/g, ':').trim();
    let depth = 0, j = br;
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (depth === 0) { j++; break; } } }
    parts.push({ q, t: css.slice(br + 1, j - 1) });
    i = j;
  }
  const queries = [...new Set(parts.filter((p) => p.q).map((p) => p.q))];
  const out = { base: parts.filter((p) => !p.q).map((p) => p.t).join('\n') };
  for (const q of queries) out[q] = parts.filter((p) => !p.q || p.q === q).map((p) => p.t).join('\n');
  return out;
}

function styleSources(w) {
  const doc = w.document;
  const out = [];
  out.labels = [];
  for (const el of doc.querySelectorAll('style, link[rel="stylesheet"]')) {
    const where = el.closest('head') ? 'head' : 'body';
    if (el.tagName === 'STYLE') { out.push(el.textContent); out.labels.push(`${where} style${el.id ? '#' + el.id : ''} (${el.textContent.length})`); continue; }
    const href = el.getAttribute('href') || '';
    if (/^https?:/.test(href)) continue;
    const rel = decodeURIComponent(new URL(href, doc.URL).pathname.replace(/^\//, ''));
    if (!/\.css$/.test(rel)) continue;   // href が空などで自分自身を指す <link> はブラウザも CSS として読まない
    const buf = resolveLocal(rel);
    out.push(buf ? buf.toString('utf8') : '/* missing ' + rel + ' */');
    out.labels.push(`${where} link ${rel} (${buf ? buf.length : 0})`);
  }
  return out;
}

function parseRules(css) {
  const rules = [];
  const ast = csstree.parse(css, { positions: false, parseValue: false, parseRulePrelude: true, parseAtrulePrelude: false, parseCustomProperty: false });
  csstree.walk(ast, { visit: 'Rule', enter(node) {
    if (this.atrule && this.atrule.name !== 'media') return;   // @keyframes / @font-face の中は対象外 (テキストで見る)
    const selectors = node.prelude.type === 'SelectorList'
      ? node.prelude.children.toArray().map((sel) => csstree.generate(sel).replace(/\s+/g, ' ').trim())
      : [csstree.generate(node.prelude).replace(/\s+/g, ' ').trim()];
    const decls = [];
    node.block.children.forEach((d) => {
      if (d.type !== 'Declaration') return;
      decls.push({ prop: d.property.trim(), value: csstree.generate(d.value).replace(/\s+/g, ' ').trim(), important: !!d.important });
    });
    rules.push({ selectors, decls });
  } });
  // @keyframes / @font-face 等はテキストで
  const atText = [];
  csstree.walk(ast, { visit: 'Atrule', enter(node) { if (node.name !== 'media') atText.push(csstree.generate(node).replace(/\s+/g, ' ')); } });
  return { rules, atText };
}

function cascadeDump(w, css) {
  const doc = w.document;
  const { rules, atText } = parseRules(css);
  // <head> の中と、body の script / style / link / meta は描画されないので数えない:
  // 共通 CSS の <link> や辞書の <script> が増えても番号がずれないように (DOM のスナップショットも script/style/link を落としている)
  const NOT_RENDERED = new Set(['SCRIPT', 'STYLE', 'LINK', 'META']);
  const all = [...doc.querySelectorAll('*')].filter((el) => !el.closest('head') && !NOT_RENDERED.has(el.tagName) && !(IGNORE_SEL && el.closest(IGNORE_SEL)));
  // 要素の鍵は通し番号でなく DOM のパス (描画される兄弟の中での位置)。要素が 1 つ増えても、その後ろの要素の鍵が変わらないように
  const rendered = (e) => e.nodeType === 1 && !NOT_RENDERED.has(e.tagName) && !(IGNORE_SEL && e.closest(IGNORE_SEL));
  function pathOf(el) {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e.tagName !== 'HTML'; e = e.parentElement) {
      let k = 1;
      for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (rendered(s)) k++;
      parts.push(e.tagName.toLowerCase() + ':' + k);
    }
    return parts.reverse().join('>');
  }
  const index = new Map();
  all.forEach((el, i) => index.set(el, i));
  const winners = new Map();   // elIdx -> Map(key -> {value, imp, spec, order})
  const unsupported = [];
  let order = 0;
  for (const rule of rules) {
    for (const selRaw of rule.selectors) {
      order++;
      const pseudos = [];
      let sel = selRaw.replace(PSEUDO_ELEMENT, (m) => { pseudos.push(m); return ''; }).replace(DYNAMIC_PSEUDO, (m) => { pseudos.push(m); return ''; });
      sel = sel.trim().replace(/\s+([>+~])\s+/g, ' $1 ');
      if (!sel || /[>+~]\s*$/.test(sel)) sel = sel.replace(/[>+~]\s*$/, '').trim() || '*';
      let matched;
      try { matched = doc.querySelectorAll(sel); } catch (e) { unsupported.push(selRaw + ' ' + JSON.stringify(rule.decls)); continue; }
      if (!matched.length) continue;
      const spec = specificity(selRaw);
      const specN = spec[0] * 1e6 + spec[1] * 1e3 + spec[2];
      const tag = pseudos.length ? pseudos.sort().join('') + '|' : '';
      for (const el of matched) {
        const i = index.get(el);
        let m = winners.get(i);
        if (!m) { m = new Map(); winners.set(i, m); }
        for (const d of rule.decls) {
          const key = tag + d.prop;
          const cur = m.get(key);
          const rank = (d.important ? 1e12 : 0) + specN * 1e4 + order;
          if (!cur || rank >= cur.rank) m.set(key, { value: d.value, rank });
        }
      }
    }
  }
  const h = crypto.createHash('sha1');
  const lines = [];
  all.forEach((el, i) => {
    const m = winners.get(i);
    if (!m) return;
    const vals = [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v.value).join('; ');
    const line = pathOf(el) + ' ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().replace(/\s+/g, '.') : '') + ' | ' + vals;
    h.update(line); h.update('\n');
    if (DUMP_COMPUTED) lines.push(line);
  });
  for (const t of atText) { h.update('AT ' + t + '\n'); if (DUMP_COMPUTED) lines.push('AT ' + t); }
  for (const t of unsupported) { h.update('UNSUPPORTED ' + t + '\n'); if (DUMP_COMPUTED) lines.push('UNSUPPORTED ' + t); }
  return { hash: h.digest('hex'), n: winners.size, lines, unsupported: unsupported.length };
}

function computedDump(w) {
  if (!csstree) throw new Error('css-tree が無い (--computed には jsdom 同梱の css-tree が要る)');
  // 時間依存のクラス (ロゴの is-on / is-loop、初回描画の spsp-fadein) は外して計り、終わったら戻す
  const TIMING = ['is-on', 'is-loop', 'spsp-fadein'];
  const touched = [];
  for (const el of w.document.querySelectorAll('.' + TIMING.join(', .'))) {
    const had = TIMING.filter((c) => el.classList.contains(c));
    if (had.length) { touched.push([el, had]); had.forEach((c) => el.classList.remove(c)); }
  }
  const sources = styleSources(w);
  const variants = splitMedia(sources.join('\n'));
  const result = {};
  for (const [name, css] of Object.entries(variants)) result[name] = cascadeDump(w, css);
  result._sources = { hash: '', n: sources.length, lines: [], unsupported: 0, order: sources.labels.join(' → ') };
  for (const [el, had] of touched) had.forEach((c) => el.classList.add(c));
  return result;
}

function chartsJson(state) {
  const seen = new WeakSet();
  return JSON.stringify(state.charts.map((c) => ({ type: c.config && c.config.type, data: c.data, options: c.options })), (k, v) => {
    if (typeof v === 'function') return '[fn]';
    if (v && typeof v === 'object') { if (seen.has(v)) return '[circular]'; seen.add(v); }
    if (v instanceof w_ref.HTMLElement) return '[element]';
    return v;
  }, 1);
}
let w_ref = null;

async function runScenario(sc) {
  const rel = sc.page;
  let html = fs.readFileSync(path.join(SITE, rel), 'utf8');
  // ?lang: ブラウザは lang_boot.js が document.write した辞書を同期で読む (パーサをブロックする) が、jsdom はページの script の後に読む。
  // ブラウザと同じ順になるよう、辞書の script を lang_boot.js の直後に静的に置いてから開く (lang_boot も同じ辞書を書くが 2 回読むだけ)
  if (LANG_DIR) html = html.replace(/(<script src="([^"]*)js\/lang_boot\.js"><\/script>)/, (m, tag, root) => tag + '<script src="' + root + 'i18n/' + LANG_DIR + '.js"></script>');
  let query = sc.query || '';
  if (LANG_DIR) query += (query ? '&' : '?') + 'lang=' + LANG_DIR;
  const pageUrl = ORIGIN + BASE + rel.replace(/index\.html$/, '') + query;
  const state = { pending: 0, lastActivity: 0, mutations: 0, hits: [], errors: [], charts: [] };
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => state.errors.push('jsdomError: ' + (e && e.message || e)));
  vc.on('error', (...a) => state.errors.push('console.error: ' + a.map(String).join(' ').slice(0, 300)));
  const dom = new JSDOM(html, {
    url: pageUrl, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    resources: { interceptors: [makeInterceptor(state)] },
    beforeParse(w) {
      w_ref = w;
      installStubs(w, state);
      w.addEventListener('error', (ev) => state.errors.push('uncaught: ' + (ev.error && ev.error.stack || ev.message)));
      w.addEventListener('unhandledrejection', (ev) => state.errors.push('unhandled: ' + (ev.reason && ev.reason.stack || ev.reason)));
    },
  });
  const w = dom.window;
  const mo = new w.MutationObserver(() => { state.mutations++; state.lastActivity = Date.now(); });
  mo.observe(w.document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  const onRej = (r) => state.errors.push('node unhandledRejection: ' + (r && r.stack || r));
  process.on('unhandledRejection', onRej);

  const dir = path.join(OUT, sc.name);
  fs.mkdirSync(dir, { recursive: true });
  const steps = [{ name: 'load', run: null }, ...(sc.steps || [])];
  let n = 0;
  const stepLog = [];
  for (const st of steps) {
    if (st.run) {
      try { await st.run(w); } catch (e) { state.errors.push('step ' + st.name + ': ' + (e && e.stack || e)); }
    }
    await settle(w, state);
    const { html: h, css } = serialize(w);
    const base = path.join(dir, String(n).padStart(2, '0') + '_' + st.name);
    fs.writeFileSync(base + '.html', h);
    fs.writeFileSync(base + '.css', css);
    fs.writeFileSync(base + '.charts.json', chartsJson(state));
    if (COMPUTED && (n === 0 || n === steps.length - 1)) {
      const t0 = Date.now();
      const cd = computedDump(w);
      const srcOrder = cd._sources; delete cd._sources;
      fs.writeFileSync(base + '.computed.txt', Object.entries(cd).map(([k, v]) => `${k}\t${v.n} elements\t${v.hash}${v.unsupported ? '\tunsupported=' + v.unsupported : ''}`).join('\n') + '\n');
      fs.writeFileSync(base + '.stylesheets.txt', srcOrder.order + '\n');   // スタイルシートの並び (参考。CSS の構成を変えると変わる)
      if (DUMP_COMPUTED) for (const [k, v] of Object.entries(cd)) fs.writeFileSync(base + '.computed.' + k.replace(/[^a-z0-9]+/gi, '_') + '.txt', v.lines.join('\n') + '\n');
      stepLog.push(`computed(${Object.keys(cd).length} variants, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
    stepLog.push(st.name + ' html=' + h.length + ' charts=' + state.charts.length);
    n++;
  }
  process.off('unhandledRejection', onRej);
  const errs = state.errors.filter((e) => !/Not implemented: HTMLCanvasElement|Not implemented: window\.scrollTo|Could not parse CSS stylesheet/.test(e));
  fs.writeFileSync(path.join(dir, 'errors.txt'), errs.join('\n') + (errs.length ? '\n' : ''));
  fs.writeFileSync(path.join(dir, 'fetch.txt'), [...new Set(state.hits)].sort().join('\n') + '\n');
  console.log(`${errs.length ? 'ERR ' : 'ok  '} ${sc.name}  (${stepLog.join(', ')})`);
  for (const e of errs.slice(0, 4)) console.log('       ' + e.split('\n').slice(0, 2).join(' | '));
  w.close();
  return errs.length === 0;
}

// ── 操作のヘルパ ──
const click = (sel, i = 0) => async (w) => { const els = w.document.querySelectorAll(sel); if (!els[i]) throw new Error('無い: ' + sel + '[' + i + ']'); els[i].click(); };
const clickIf = (sel, i = 0) => async (w) => { const els = w.document.querySelectorAll(sel); if (els[i]) els[i].click(); };
const type = (sel, text) => async (w) => { const el = w.document.querySelector(sel); if (!el) throw new Error('無い: ' + sel); el.value = text; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); el.dispatchEvent(new w.KeyboardEvent('keyup', { bubbles: true })); };
const select = (sel, value) => async (w) => { const el = w.document.querySelector(sel); if (!el) throw new Error('無い: ' + sel); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
const seq = (...fns) => async (w) => { for (const f of fns) await f(w); };

// ランキング表 4 ページ共通の操作
function rankingSteps() {
  return [
    { name: 'tab_tjpr', run: click('.method-tab[data-method="tjpr"]') },
    { name: 'tab_bt', run: click('.method-tab[data-method="bt_gated"]') },
    { name: 'tab_ens', run: click('.method-tab[data-method="ensemble"]') },
    { name: 'search', run: type('#search', 'あ') },
    { name: 'search_clear', run: type('#search', '') },
    { name: 'expand_row1', run: click('#tbody tr.main-row', 0) },
    { name: 'detail_tab_h2h', run: clickIf('.detail-tab[data-tab="h2h"], .detail-tab:nth-child(2)') },
    { name: 'h2h_expand', run: clickIf('.h2h-expand-btn') },
    { name: 'detail_tab_tour', run: clickIf('.detail-tab[data-tab="tour"], .detail-tab:nth-child(1)') },
    { name: 'tour_sort', run: clickIf('.tour-sort-toggle, [data-tour-sort], .sort-toggle') },
    { name: 'expand_row2', run: click('#tbody tr.main-row', 1) },
    { name: 'collapse_row1', run: click('#tbody tr.main-row', 0) },
    { name: 'sort_th', run: clickIf('th.sortable', 1) },
  ];
}
function listSteps(thSel) {
  return [
    { name: 'search', run: type('#search', 'ス') },
    { name: 'search_clear', run: type('#search', '') },
    { name: 'sort_th1', run: clickIf(thSel, 1) },
    { name: 'sort_th1_again', run: clickIf(thSel, 1) },
    { name: 'sort_th2', run: clickIf(thSel, 2) },
  ];
}
function playerSteps() {
  return [
    { name: 'period_1y', run: clickIf('[data-filter-period="1y"]') },
    { name: 'period_all', run: clickIf('[data-filter-period="all"]') },
    { name: 'tour_filter2', run: clickIf('[data-filter-tour]', 1) },
    { name: 'tour_filter1', run: clickIf('[data-filter-tour]', 0) },
    { name: 'expand_tour1', run: clickIf('.tour-clickable', 0) },
    { name: 'expand_tour2', run: clickIf('.tour-clickable', 1) },
    { name: 'pager_next', run: clickIf('.pager .next, .pager a[data-dir="next"], .pager-next') },
    { name: 'hl_expand', run: clickIf('.hl-group', 0) },
    { name: 'ach_toggle', run: clickIf('#ach-toggle') },
    { name: 'help', run: clickIf('#ph-help-btn') },
    { name: 'chart_tab2', run: clickIf('.chart-tab, [data-chart]', 1) },
    { name: 'chart_tab1', run: clickIf('.chart-tab, [data-chart]', 0) },
  ];
}
function tournamentSteps() {
  return [
    { name: 'pager_next_all', run: async (w) => { for (const a of w.document.querySelectorAll('.pager .next, .pager a[data-dir="next"], .pager-next')) a.click(); } },
    { name: 'std_search', run: type('#std-search', 'あ') },
    { name: 'std_clear', run: type('#std-search', '') },
    { name: 'std_row', run: clickIf('#std-list .std-row, #std-list li, #std-list tr', 0) },
  ];
}

const SCENARIOS = [
  { name: 'index', page: 'index.html', steps: rankingSteps() },
  { name: 'c_index', page: 'c/index.html', steps: listSteps('th.sortable') },
  { name: 'c_ranking_1323', page: 'c/ranking.html', query: '?char=1323', steps: rankingSteps() },
  { name: 'local_index', page: 'local/index.html', steps: [...listSteps('th.sortable'), { name: 'chip_big', run: click('#filter-chips .chip[data-filter="big"]') }, { name: 'chip_uchi', run: click('#filter-chips .chip[data-filter="uchi"]') }, { name: 'chip_all', run: click('#filter-chips .chip[data-filter="all"]') }] },
  { name: 'local_ranking_higoburaSP', page: 'local/ranking.html', query: '?series=' + encodeURIComponent('肥後ブラSP'), steps: [...rankingSteps(), { name: 'period', run: select('#period-sel', '1y') }, { name: 'min_n', run: type('#min-n', '3') }] },
  { name: 'pref_index', page: 'pref/index.html', steps: listSteps('th.sortable') },
  { name: 'pref_ranking_tokyo', page: 'pref/ranking.html', query: '?pref=' + encodeURIComponent('東京都'), steps: rankingSteps() },
  { name: 'p_1787719', page: 'p/index.html', query: '?uid=1787719', steps: playerSteps() },
  { name: 'p_1983750', page: 'p/index.html', query: '?uid=1983750', steps: playerSteps() },
  { name: 'p_LOW', page: 'p/index.html', query: '?uid=__LOW__', steps: playerSteps() },
  { name: 'p_OVERSEAS', page: 'p/index.html', query: '?uid=__OV__', steps: playerSteps() },
  { name: 'p_missing', page: 'p/index.html', query: '?uid=1', steps: [] },
  { name: 'p_disc', page: 'p/index.html', query: '?d=830dec1e', steps: [] },   // = uid 1787719 を discriminator で開く
  { name: 'p_disc_missing', page: 'p/index.html', query: '?d=zzzzzzzz', steps: [] },
  { name: 't_1503940', page: 't/index.html', query: '?id=1503940', steps: tournamentSteps() },
  { name: 't_1688370', page: 't/index.html', query: '?id=1688370', steps: tournamentSteps() },
  { name: 't_BIG', page: 't/index.html', query: '?id=__BIG__', steps: tournamentSteps() },
  { name: 't_missing', page: 't/index.html', query: '?id=1', steps: [] },
  { name: 'sim_1787719', page: 'sim/index.html', query: '?uid=1787719', steps: [
    { name: 'psearch', run: type('#psearch', 'ザク') },
    { name: 'tsearch', run: type('#tsearch', 'ス') },
    { name: 'tsearch_pick', run: clickIf('#tsearch-suggest .item, #tsearch-suggest div, #tsearch-suggest li', 0) },
    { name: 'place_sel', run: async (w) => { const s = w.document.querySelector('.place-sel'); if (s && s.options.length > 2) { s.value = s.options[2].value; s.dispatchEvent(new w.Event('change', { bubbles: true })); } } },
  ] },
  { name: 'events', page: 'events/index.html', steps: [
    { name: 'search', run: type('#search', 'スマ') }, { name: 'search_clear', run: type('#search', '') },
    { name: 'nent32', run: click('.chip[data-nent="32"]') }, { name: 'nent0', run: click('.chip[data-nent="0"]') },
    { name: 'period2', run: clickIf('#filter-period .chip', 1) }, { name: 'tags2', run: clickIf('#filter-tags .chip', 1) },
    { name: 'sort_th2', run: clickIf('th.sortable', 2) }, { name: 'sort_th2_again', run: clickIf('th.sortable', 2) },
  ] },
  { name: 'priority', page: 'priority/index.html', steps: [
    { name: 'excl_overseas', run: click('#excl-overseas') }, { name: 'excl_prov', run: click('#excl-prov') },
    { name: 'recent_only', run: click('#recent-only') }, { name: 'count', run: type('#count', '64') },
    { name: 'pref_input', run: type('#pref-input', '東京') }, { name: 'pref_pick', run: clickIf('#pref-suggest div, #pref-suggest li, #pref-suggest .item', 0) },
  ] },
  { name: 'news', page: 'news/index.html', steps: [{ name: 'auto', run: click('.filter-tab[data-filter="auto"]') }, { name: 'ann', run: click('.filter-tab[data-filter="announcement"]') }, { name: 'all', run: click('.filter-tab[data-filter="all"]') }] },
  { name: 'seed', page: 'seed/index.html', steps: [] },
  { name: 'seed_upload', page: 'seed-upload/index.html', steps: [] },
  { name: 'bracket', page: 'bracket/index.html', steps: [] },
  { name: 'vote', page: 'vote.html', steps: [] },
  { name: 'post', page: 'post.html', steps: [] },
  { name: 'overview', page: 'overview.html', steps: [] },
  { name: 'details', page: 'details.html', steps: [] },
  { name: 'math', page: 'math.html', steps: [] },
  { name: 'eval', page: 'eval.html', steps: [] },
  { name: 'callback', page: 'callback.html', steps: [] },
];

(async () => {
  // データから決める id (rank 15000 の選手 / 海外選手 / 最大規模の大会)
  const ids = pickIds();
  let bad = 0, n = 0;
  for (const sc of SCENARIOS) {
    if (ONLY && !new RegExp(ONLY).test(sc.name)) continue;
    sc.query = (sc.query || '').replace('__LOW__', ids.low).replace('__OV__', ids.ov).replace('__BIG__', ids.big);
    sc.name = sc.name.replace('LOW', String(ids.low)).replace('OVERSEAS', String(ids.ov)).replace('BIG', String(ids.big));
    n++;
    if (!(await runScenario(sc))) bad++;
  }
  console.log(bad ? `NG (${bad}/${n} scenario にエラー)` : `OK: ${n} scenario (${OUT})`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('harness error:', e && e.stack || e); process.exit(3); });

function pickIds() {
  const jsonl = readData('latest_tjpr_full.jsonl').toString('utf8');
  const ovRaw = JSON.parse(readData('data/overseas.json').toString('utf8'));
  const ov = new Set((Array.isArray(ovRaw) ? ovRaw : (ovRaw.uids || ovRaw.overseas || Object.keys(ovRaw.players || {}))).map(String));
  let low = 1983750, ovUid = 1787719;
  for (const ln of jsonl.split('\n')) {
    if (!ln.trim()) continue;
    const r = JSON.parse(ln);
    const e = r.ranks && r.ranks.ensemble;
    if (e >= 15000 && low === 1983750) low = r.user_id;
    if (ov.has(String(r.user_id)) && e && e < 300 && ovUid === 1787719) ovUid = r.user_id;
  }
  const tRaw = JSON.parse(readData('data/tournaments.json').toString('utf8'));
  const t = Array.isArray(tRaw) ? tRaw : tRaw.tournaments;
  const big = t.filter((x) => x.nent).sort((a, b) => b.nent - a.nent)[0];
  return { low, ov: ovUid, big: big ? big.event_id : 1503940 };
}
