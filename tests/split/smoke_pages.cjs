#!/usr/bin/env node
// tests/split/smoke_pages.cjs — 実際のページ (p / t / index / sim) を jsdom で動かし、ビルド出力 (deployed 相当の
// ディレクトリ) を fetch の代わりに読ませて、JS エラー無しに描画が終わるかを見る。ブラウザが使えない環境用。
//
//   NODE_PATH=<jsdom の node_modules> node tests/split/smoke_pages.cjs --data <deployed dir> [--uid N] [--tid N] [--label 名前]
//
// 見ること: 未捕捉の例外 / console.error が無い、「読み込み中」が消えて本文が出る、順位などのテキストが入る。
// Chart.js / luxon (CDN) は使えないので最小のスタブを入れる (描画は呼ばれるが中身は見ない)。
const fs = require('node:fs');
const path = require('node:path');
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { console.error('jsdom が無い (NODE_PATH を確認)'); process.exit(2); }

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DATA = path.resolve(opt('--data'));
const UID = opt('--uid', '1787719');
const TID = opt('--tid', '1503940');
const LABEL = opt('--label', path.basename(DATA));
const SITE = path.resolve(__dirname, '../../site');
const ORIGIN = 'https://spsp.games';

function readSite(rel) { return fs.readFileSync(path.join(SITE, rel), 'utf8'); }

// fetch: ページ URL からの相対パスを DATA (ビルド出力) → SITE (ページ資産) の順で探す
function makeFetch(pageUrl, hits) {
  return async function (url) {
    const u = new URL(String(url), pageUrl);
    let rel = decodeURIComponent(u.pathname.replace(/^\//, ''));
    hits.push(rel);
    let p = path.join(DATA, rel);
    if (!fs.existsSync(p)) p = path.join(SITE, rel);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      return { ok: false, status: 404, json: async () => { throw new Error('404'); }, text: async () => '' };
    }
    const buf = fs.readFileSync(p);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8') };
  };
}

function stubs(w) {
  // Chart.js / luxon / html2canvas の最小スタブ
  class Chart { constructor(c, cfg) { this.config = cfg; this.data = cfg && cfg.data; Chart.instances.push(this); } destroy() {} update() {} resize() {} }
  Chart.instances = []; Chart.register = () => {}; Chart.defaults = { font: {}, plugins: {} };
  w.Chart = Chart;
  w.luxon = { Settings: {}, DateTime: { fromISO: (s) => ({ toJSDate: () => new Date(s) }) } };
  w.requestAnimationFrame = (f) => setTimeout(f, 0);
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }));
  w.HTMLCanvasElement.prototype.getContext = () => ({ measureText: () => ({ width: 10 }), fillRect() {}, clearRect() {}, save() {}, restore() {}, beginPath() {}, arc() {}, fill() {}, stroke() {}, moveTo() {}, lineTo() {}, fillText() {}, closePath() {}, translate() {}, rotate() {}, scale() {}, setTransform() {}, createLinearGradient: () => ({ addColorStop() {} }) });
  w.scrollTo = () => {};
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.gtag = () => {};
}

async function runPage(rel, query, checks) {
  const html = readSite(rel);
  const pageUrl = ORIGIN + '/' + rel.replace(/index\.html$/, '') + query;
  const errors = [];
  const hits = [];
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const stripped = html.replace(/<script src="[^"]*"><\/script>/g, '');
  const { VirtualConsole } = require('jsdom');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e && e.message || e)));
  vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ').slice(0, 300)));
  vc.on('warn', () => {});
  vc.on('log', () => {});
  const dom = new JSDOM(stripped, {
    url: pageUrl, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      stubs(w);
      w.fetch = makeFetch(pageUrl, hits);
      w.addEventListener('error', (ev) => errors.push('uncaught: ' + (ev.error && ev.error.stack || ev.message)));
      w.addEventListener('unhandledrejection', (ev) => errors.push('unhandled: ' + (ev.reason && ev.reason.stack || ev.reason)));
      w.SPSPTrackPage = () => {};            // nav.js が定義する GA 用 helper (nav.js 自体は DOM が要るので読まない)
      for (const src of srcs) {
        if (/^https?:/.test(src)) continue;   // CDN はスタブ
        if (/(^|\/)(nav|logo)\.js$/.test(src)) continue;   // ナビ / ロゴは読み込み時に document.head を触る (データの流れとは無関係)
        const p = path.resolve(path.join(SITE, path.dirname(rel)), src);
        try { w.eval(fs.readFileSync(p, 'utf8')); } catch (e) { errors.push(`script ${src}: ${e && e.stack || e}`); }
      }
    },
  });
  const w = dom.window;
  // Promise の未処理 reject は jsdom の window には来ないので node 側でも拾う
  const onRej = (r) => errors.push('node unhandledRejection: ' + (r && r.stack || r));
  process.on('unhandledRejection', onRej);
  const deadline = Date.now() + 20000;
  let ok = false, why = '';
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    try { const res = checks(w); if (res === true) { ok = true; break; } why = res || ''; } catch (e) { why = String(e); }
  }
  process.off('unhandledRejection', onRej);
  const errs = errors.filter((e) => !/Not implemented: HTMLCanvasElement|Could not load|navigation|Not implemented: window\.scrollTo/.test(e));
  const status = ok && !errs.length ? 'ok  ' : 'FAIL';
  console.log(`${status} ${rel}${query}  (${LABEL})${ok ? '' : '  未完: ' + why}`);
  for (const e of errs.slice(0, 5)) console.log('       ' + e.split('\n').slice(0, 3).join(' | '));
  const uniq = [...new Set(hits)];
  console.log(`       fetch ${hits.length} 回 (${uniq.filter((h) => /players_current|history\/|players\//.test(h)).slice(0, 4).join(', ')}${uniq.length > 4 ? ', …' : ''})`);
  w.close();
  return ok && !errs.length;
}

(async () => {
  const results = [];
  // プレイヤーページ: 読み込みが終わり、順位が入り、履歴グラフが作られる
  results.push(await runPage('p/index.html', `?uid=${UID}`, (w) => {
    const d = w.document;
    if (d.getElementById('not-found').style.display !== 'none') return 'not-found が出た';
    if (d.getElementById('loading').style.display !== 'none') return 'loading のまま';
    const txt = d.body.textContent;
    if (!/全国\s*#?\s*\d|#\d/.test(txt)) return '順位のテキストが無い';
    if (!w.Chart.instances.length) return 'チャートが作られていない';
    if (!d.querySelectorAll('.tour-item').length) return '大会一覧が空';
    // 順位評価 chip (tjpr_w を表示側で復元) が数字で出ている
    if (!/順位評価/.test(txt)) return '順位評価 chip が無い';
    return true;
  }));
  // 大会ページ: 順位表が出て「現在 #」が入る
  results.push(await runPage('t/index.html', `?id=${TID}`, (w) => {
    const d = w.document;
    if (d.getElementById('not-found').style.display !== 'none') return 'not-found が出た';
    if (d.getElementById('loading').style.display !== 'none') return 'loading のまま';
    const txt = d.body.textContent;
    if (!/現在 #\d/.test(txt)) return '「現在 #」が無い (players_current.json から引けていない)';
    return true;
  }));
  // index: ランキング表が出る
  results.push(await runPage('index.html', '', (w) => {
    const d = w.document;
    const rows = d.querySelectorAll('tbody tr');
    if (rows.length < 10) return `行が ${rows.length}`;
    // 行を展開 → player-detail.js が分割 JSON を読んで詳細を出す
    if (!w.__clicked) { w.__clicked = true; rows[0].click(); return '展開待ち'; }
    const inner = d.querySelector('.detail-inner');
    if (!inner) return '展開行が無い';
    if (inner.querySelector('.loading-msg')) return '詳細を取得中のまま: ' + inner.textContent.slice(0, 60);
    if (!/大会|試合/.test(inner.textContent)) return '詳細の中身が無い';
    return true;
  }));
  // sim: プレイヤーを指定して読み込みが終わる
  results.push(await runPage('sim/index.html', `?uid=${UID}`, (w) => {
    const d = w.document;
    const ld = d.getElementById('loading');
    if (ld && ld.style.display !== 'none' && ld.offsetParent !== null && !ld.hidden) return 'loading のまま';
    if (!/\d/.test(d.body.textContent)) return '本文が無い';
    return true;
  }));
  // 使い手 / 都道府県ランキング: 行を展開 → 詳細タブ (大会別 ↔ 直接対決) の切替と並び替えトグルが効く
  // (2026-09-13 まで .tab-content / cfg.tourSortKey を探していて効かなかった)
  for (const [rel, query] of [['index.html', ''], ['c/ranking.html', '?char=1766'], ['pref/ranking.html', '?pref=' + encodeURIComponent('東京都')]]) {
    results.push(await runPage(rel, query, (w) => {
      const d = w.document;
      const rows = d.querySelectorAll('tbody tr');
      if (rows.length < 3) return `行が ${rows.length}`;
      if (!w.__step) { w.__step = 1; rows[0].click(); return '展開待ち'; }
      const inner = d.querySelector('.detail-inner');
      if (!inner || inner.querySelector('.loading-msg')) return '詳細を取得中';
      const tabH2h = inner.querySelector('.detail-tab[data-tab="h2h"]');
      const contH2h = inner.querySelector('.detail-tab-content.tab-h2h');
      const contTour = inner.querySelector('.detail-tab-content.tab-tour');
      if (!tabH2h || !contH2h || !contTour) return '詳細タブの markup が無い';
      if (w.__step === 1) { w.__step = 2; tabH2h.click(); return 'タブ切替待ち'; }
      if (w.__step === 2) {
        // 直接対決タブに切り替わっているか (h2h が表示、大会別が非表示)
        if (contH2h.style.display === 'none' || contTour.style.display !== 'none') return 'タブ切替が効いていない';
        w.__step = 3;
        inner.querySelector('.detail-tab[data-tab="tour"]').click();
        const tg = inner.querySelector('.tour-sort-toggle'); if (!tg) return '並び替えトグルが無い';
        w.__lbl = tg.textContent; tg.click(); return '並び替え待ち';
      }
      if (contTour.style.display === 'none') return '大会別タブに戻れていない';
      // トグルのラベル (影響順 ↔ 時系列順) が切り替わって表が描き直されていること
      const tg2 = inner.querySelector('.tour-sort-toggle');
      if (!tg2 || tg2.textContent === w.__lbl) return '並び替えトグルが効いていない';
      return true;
    }));
  }
  const bad = results.filter((r) => !r).length;
  console.log(bad ? `NG (${bad} ページ)` : 'OK: 全ページ描画できた');
  process.exit(bad ? 1 : 0);
})();
