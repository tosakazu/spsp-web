'use strict';
// jsdom 結線テスト: seed ページの実 runSeedOptimize ソースを HTML から抽出し、
// 「5トグル・数値入力が SeedData.buildSeedData / worker への params に実際に届く」
// ことを検証する。ここが唯一のグルーで、壊れてもユニットテストは緑のままになるため。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }

// シードツールは seed/index.html (spsp) + seed-upload/index.html (csv) + 共有 seed_app.js に
// 分割されている。整合チェックは連結ソースに対して行う。
const HTML = fs.readFileSync(path.resolve(__dirname, '../../site/seed/index.html'), 'utf8')
  + fs.readFileSync(path.resolve(__dirname, '../../site/seed-upload/index.html'), 'utf8')
  + require('./helpers/seed_app_src.cjs').SRC;   // seeding/app/*.js を並び順に連結 (旧 seed_app.js)

// `function name(...) { ... }` / `async function name(...)` を波括弧バランスで抽出。
function extractFn(src, name) {
  let sig = src.indexOf('async function ' + name + '(');
  if (sig < 0) sig = src.indexOf('function ' + name + '(');
  assert.ok(sig >= 0, 'not found: ' + name);
  const braceStart = src.indexOf('{', sig);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(sig, i);
}

// パネルの全入力 DOM を組み立てる（id は実ページと同じ）。
function buildPanelDom(doc) {
  const mk = (id, tag, attrs) => {
    const el = doc.createElement(tag || 'input');
    el.id = id;
    Object.assign(el, attrs || {});
    doc.body.appendChild(el);
    return el;
  };
  mk('so-progress', 'div'); mk('so-report', 'div');
  mk('so-apply', 'button'); mk('so-run', 'button'); mk('so-stop', 'button');
  mk('so-pools', 'input', { value: '4' });
  mk('so-waves', 'input', { value: '1' });
  mk('so-mode', 'input', { value: 'multistart-sa' });
  mk('so-restarts', 'input', { value: '3' });
  mk('so-cooling', 'input', { value: '0.997' });
  mk('so-itersscale', 'input', { value: '100' });
  mk('so-rngseed', 'input', { value: '42' });
  for (const id of ['so-avoid-region', 'so-avoid-recent', 'so-enable-intra',
                    'so-group-minamikanto', 'so-group-keihanshin',
                    'so-keep-deplace', 'so-include-weekday', 'so-scope-winners',
                    'so-avoid-series']) {
    mk(id, 'input', { type: 'checkbox' });
  }
  // 同シリーズ再マッチ
  mk('so-series-select', 'input', { value: '' });
  mk('so-seriesmode', 'input', { value: 'mult' });
  mk('so-seriesmult', 'input', { value: '3' });
  mk('so-wseries', 'input', { value: '0.3' });
  // シードズレ上限 (空欄 = 未指定)。
  for (const id of ['so-shift0', 'so-shift1', 'so-shift2', 'so-shift3', 'so-shift4', 'so-shift5']) {
    mk(id, 'input', { value: '' });
  }
  mk('so-wregion', 'input', { value: '1.0' });
  mk('so-wrecent', 'input', { value: '0' });          // 「0」が既定に化けないこと(M6)も検証
  mk('so-worder', 'input', { value: '0.001' });
  mk('so-orderpow', 'input', { value: '2.5' });   // 既定値 (2026-09-14 から 2.5)
  mk('so-prefweight', 'input', { value: 'inv_sqrt' });
  mk('so-roundweights', 'input', { value: '' });
  mk('so-kinter', 'input', { value: '' });
  mk('so-kintra', 'input', { value: '' });
  mk('so-maxshift', 'input', { value: '2' });   // 数値入力が params.maxSeedShift に届くことを検証
  mk('so-decaypoints', 'input', { value: '' });
  mk('so-sizeweight', 'input', { value: 'log2' });
  mk('so-recentagg', 'input', { value: 'max' });
}

test('jsdom: 5トグルと数値入力が buildSeedData / worker params へ届く', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  buildPanelDom(win.document);

  const setup = `
    var S = window;   // 共有状態 S (seeding/app/00_state.js) はこのテストではグローバル変数そのもの
    var SPSP = { root: '../', langRoot: '../' };   // seed/ はルートの 1 段下 (js/html.js が決める値の代わり)
    var DATA = [];
    var currentMethod = 'ensemble';
    var EVENT_CONTEXT = { bracketType: 'DOUBLE_ELIMINATION', poolCount: 4 };
    var SEEDOPT_WORKER = null, SEEDOPT_RESULT = null;
    var SERIES_INDEX = null;
    var PLAYER_CACHE = new Map(), PLAYER_CACHE_MAX = 6000, PREFS_CACHE = null;
    var MANUAL = null, SEED_SPEC = null, APPLIED_ORDER = null, PRE_OPT = null;
    function showOptCancelBtn() {}
    function manualOrder() { return MANUAL ? MANUAL.base.slice() : []; }
    function manualMovedSet() { return new Set(); }
    function manualParseUid(s) { var n = Number(s); return Number.isNaN(n) ? s : n; }
    function currentWaveMap(P) { var a = []; for (var i = 0; i < P; i++) a.push(0); return a; }
    function _projectSeedLocks(a) { return a; }
    var captured = { regionGroups: null, buildOpts: null, post: null, workerUrl: null };
    function soFormat() { return 'DOUBLE_ELIMINATION'; }
    function cleanupSeedOptWorker() {}
    function finishSeedOptimize() {}
    var SeedData = {
      defaultFetchers: function () { return { fetchPlayer: async function () { return {}; }, fetchPrefs: async function () { return {}; } }; },
      regionGroupDefs: function () { return [{ id: 'minamiKanto' }, { id: 'keihanshin' }]; },   // 地域まとめの定義 (実物は geo.json)
      ensureGeoCatalog: async function () { return null; },   // 地域まとめの定義は読込済みとみなす
      buildRegionGroups: function (o) { captured.regionGroups = o; return { stub: true }; },
      buildSeedData: async function (ranking, opts) {
        captured.buildOpts = opts;
        return { prefByUid: {}, prefCounts: {}, recentPair: {}, recentMeta: {},
                 meta: { attendees: ranking.length, prefIdentified: 0, missing: [], errors: [], prefsError: null } };
      },
    };
    function Worker(url) {
      captured.workerUrl = url;
      this.postMessage = function (m) { captured.post = m; };
      this.terminate = function () {};
    }
    ${extractFn(HTML, 'cachedFetchers')}
    ${extractFn(HTML, 'regionGroupToggleId')}
    ${extractFn(HTML, 'runSeedOptimize')}
  `;
  win.eval(setup);

  // DATA 投入（8人）。
  const recs = [];
  for (let i = 1; i <= 8; i++) recs.push({ user_id: 100 + i, display: 'P' + i, ranks: { ensemble: i } });
  win.DATA.push(...recs);

  // 非デフォルトの組合せ: 地域ON / 直近OFF / intra ON / 南関東OFF / 京阪神ON
  // + DE想定順位不変 ON / 平日を含む OFF (= excludeWeekday true の配線を検証)。
  win.document.getElementById('so-avoid-region').checked = true;
  win.document.getElementById('so-avoid-recent').checked = false;
  win.document.getElementById('so-enable-intra').checked = true;
  win.document.getElementById('so-group-minamikanto').checked = false;
  win.document.getElementById('so-group-keihanshin').checked = true;
  win.document.getElementById('so-keep-deplace').checked = true;
  win.document.getElementById('so-include-weekday').checked = false;
  // 固定 (SEED_SPEC.locks) の配線: ranking 内 uid のみが params.seedLocks に届く。
  win.eval("SEED_SPEC = { label: null, pins: {}, waves: {}, locks: { '101': 'pool', '999': 'wave' } };");

  await win.eval('runSeedOptimize()');

  const cap = win.eval('captured');
  // 地域グルーピングのトグルが buildRegionGroups に届く。
  assert.strictEqual(cap.regionGroups.minamiKanto, false);
  assert.strictEqual(cap.regionGroups.keihanshin, true);
  // buildSeedData に regionGroups / prefsOptional(=地域ONなので false) が渡る。
  assert.ok(cap.buildOpts.regionGroups && cap.buildOpts.regionGroups.stub);
  assert.strictEqual(cap.buildOpts.prefsOptional, false);
  // worker start の params に罰則トグルが届く。
  assert.ok(cap.post && cap.post.type === 'start');
  const p = cap.post.input.params;
  assert.strictEqual(p.avoidRegion, true);
  assert.strictEqual(p.avoidRecent, false);
  assert.strictEqual(p.enableIntra, true);
  // 数値: 「0」入力が既定(0.3)に化けない。restarts/rngSeed も入力どおり。
  assert.strictEqual(p.W_recent, 0);
  assert.strictEqual(p.restarts, 3);
  assert.strictEqual(p.rngSeed, 42);
  // シード変位上限が届く（fixture は '2'）。
  assert.strictEqual(p.maxSeedShift, 2);
  // ズレ指数のスライダー値 (既定 2.5) がそのまま届く。
  assert.strictEqual(p.orderPow, 2.5);
  // DE 想定順位不変トグルが worker params に届く。
  assert.strictEqual(p.keepDePlace, true);
  // 平日除外トグルが buildSeedData の dataParams に届く。
  assert.strictEqual(cap.buildOpts.params.excludeWeekday, true);
  // 固定: ranking に居る uid (101) だけが seedLocks に載り、poolWaves (長さ=プール数) が付く。
  assert.strictEqual(p.seedLocks['101'], 'pool');
  assert.ok(!('999' in p.seedLocks), 'ranking 外の uid が seedLocks に残っている');
  assert.strictEqual(p.poolWaves.length, 4);
  // poolCount / ranking も入力どおり。
  assert.strictEqual(cap.post.input.poolCount, 4);
  assert.deepStrictEqual(Array.from(cap.post.input.ranking), [101, 102, 103, 104, 105, 106, 107, 108]);
  assert.match(cap.workerUrl, /seed_worker\.js$/);
  // 取得はキャッシュ経由 (2回目以降 players/*.json を取り直さない)。
  assert.strictEqual(typeof cap.buildOpts.fetchPlayer, 'function', 'fetchPlayer を渡していない');
  assert.strictEqual(typeof cap.buildOpts.fetchPrefs, 'function', 'fetchPrefs を渡していない');
});

test('jsdom: 地域OFF なら prefsOptional=true で buildSeedData に渡る', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  buildPanelDom(win.document);
  const setup = `
    var S = window;   // 共有状態 S (seeding/app/00_state.js) はこのテストではグローバル変数そのもの
    var SPSP = { root: '../', langRoot: '../' };   // seed/ はルートの 1 段下 (js/html.js が決める値の代わり)
    var DATA = [];
    var currentMethod = 'ensemble';
    var EVENT_CONTEXT = { bracketType: 'DOUBLE_ELIMINATION', poolCount: 2 };
    var SEEDOPT_WORKER = null, SEEDOPT_RESULT = null;
    var SERIES_INDEX = null;
    var PLAYER_CACHE = new Map(), PLAYER_CACHE_MAX = 6000, PREFS_CACHE = null;
    var MANUAL = null, SEED_SPEC = null, APPLIED_ORDER = null, PRE_OPT = null;
    function showOptCancelBtn() {}
    function manualOrder() { return []; }
    function manualMovedSet() { return new Set(); }
    function manualParseUid(s) { var n = Number(s); return Number.isNaN(n) ? s : n; }
    function currentWaveMap(P) { var a = []; for (var i = 0; i < P; i++) a.push(0); return a; }
    function _projectSeedLocks(a) { return a; }
    var captured = { buildOpts: null };
    function soFormat() { return 'DOUBLE_ELIMINATION'; }
    function cleanupSeedOptWorker() {}
    function finishSeedOptimize() {}
    var SeedData = {
      defaultFetchers: function () { return { fetchPlayer: async function () { return {}; }, fetchPrefs: async function () { return {}; } }; },
      regionGroupDefs: function () { return [{ id: 'minamiKanto' }, { id: 'keihanshin' }]; },   // 地域まとめの定義 (実物は geo.json)
      ensureGeoCatalog: async function () { return null; },   // 地域まとめの定義は読込済みとみなす
      buildRegionGroups: function () { return {}; },
      buildSeedData: async function (ranking, opts) {
        captured.buildOpts = opts;
        return { prefByUid: {}, prefCounts: {}, recentPair: {}, recentMeta: {},
                 meta: { attendees: ranking.length, prefIdentified: 0, missing: [], errors: [], prefsError: 'HTTP 404' } };
      },
    };
    function Worker() { captured.worker = this; this.postMessage = function () {}; this.terminate = function () {}; }
    ${extractFn(HTML, 'cachedFetchers')}
    ${extractFn(HTML, 'regionGroupToggleId')}
    ${extractFn(HTML, 'runSeedOptimize')}
  `;
  win.eval(setup);
  win.DATA.push({ user_id: 1, display: 'A', ranks: { ensemble: 1 } },
                { user_id: 2, display: 'B', ranks: { ensemble: 2 } });
  win.document.getElementById('so-avoid-region').checked = false;   // 地域 OFF
  win.document.getElementById('so-avoid-recent').checked = true;
  await win.eval('runSeedOptimize()');
  const cap = win.eval('captured');
  assert.strictEqual(cap.buildOpts.prefsOptional, true);
  // note(prefsError の明示) は worker 進捗表示に載る → 進捗メッセージを流して確認。
  cap.worker.onmessage({ data: { type: 'progress', round: 0, restarts: 1, phase: 'inter' } });
  assert.match(win.document.getElementById('so-progress').textContent, /居住地データ取得失敗/);
});

test('jsdom: 同シリーズ再マッチの設定が buildSeedData / worker へ届く', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  buildPanelDom(win.document);
  const setup = `
    var S = window;   // 共有状態 S (seeding/app/00_state.js) はこのテストではグローバル変数そのもの
    var SPSP = { root: '../', langRoot: '../' };   // seed/ はルートの 1 段下 (js/html.js が決める値の代わり)
    var DATA = [];
    var currentMethod = 'ensemble';
    var EVENT_CONTEXT = { bracketType: 'DOUBLE_ELIMINATION', poolCount: 2, tournamentName: '篝火 #12' };
    var SEEDOPT_WORKER = null, SEEDOPT_RESULT = null;
    var SERIES_INDEX = { seriesOf: {}, seriesNames: ['篝火'] };
    var PLAYER_CACHE = new Map(), PLAYER_CACHE_MAX = 6000, PREFS_CACHE = null;
    var MANUAL = null, SEED_SPEC = null, APPLIED_ORDER = null, PRE_OPT = null;
    function showOptCancelBtn() {}
    function manualOrder() { return []; }
    function manualMovedSet() { return new Set(); }
    function manualParseUid(s) { var n = Number(s); return Number.isNaN(n) ? s : n; }
    function currentWaveMap(P) { var a = []; for (var i = 0; i < P; i++) a.push(0); return a; }
    function _projectSeedLocks(a) { return a; }
    var captured = { buildOpts: null, post: null };
    function soFormat() { return 'DOUBLE_ELIMINATION'; }
    function cleanupSeedOptWorker() {}
    function finishSeedOptimize() {}
    var toggleCalls = 0;
    // 大会一覧の遅延ロード + 自動判定のスタブ (SERIES_INDEX が無いときだけ呼ばれる)。
    async function updateSeriesToggleState() {
      toggleCalls++;
      SERIES_INDEX = { seriesOf: {}, seriesNames: ['篝火'] };
      document.getElementById('so-series-select').value = '篝火';
    }
    var SeedData = {
      defaultFetchers: function () { return { fetchPlayer: async function () { return {}; }, fetchPrefs: async function () { return {}; } }; },
      regionGroupDefs: function () { return [{ id: 'minamiKanto' }, { id: 'keihanshin' }]; },   // 地域まとめの定義 (実物は geo.json)
      ensureGeoCatalog: async function () { return null; },   // 地域まとめの定義は読込済みとみなす
      buildRegionGroups: function () { return {}; },
      buildSeedData: async function (ranking, opts) {
        captured.buildOpts = opts;
        if (!opts.params.targetSeries) {
          return { prefByUid: {}, prefCounts: {}, recentPair: {}, recentMeta: {}, seriesPair: {},
                   meta: { attendees: ranking.length, prefIdentified: 0, missing: [], errors: [], prefsError: null } };
        }
        return { prefByUid: {}, prefCounts: {}, recentPair: {}, recentMeta: {}, seriesPair: { '1:2': 3 },
                 meta: { attendees: ranking.length, prefIdentified: 0, missing: [], errors: [], prefsError: null,
                         targetSeries: '篝火', seriesPairs: 1 } };
      },
    };
    function Worker() { captured.worker = this; this.postMessage = function (m) { captured.post = m; }; this.terminate = function () {}; }
    ${extractFn(HTML, 'cachedFetchers')}
    ${extractFn(HTML, 'regionGroupToggleId')}
    ${extractFn(HTML, 'runSeedOptimize')}
  `;
  win.eval(setup);
  win.DATA.push({ user_id: 1, display: 'A', ranks: { ensemble: 1 } },
                { user_id: 2, display: 'B', ranks: { ensemble: 2 } });
  const doc = win.document;
  doc.getElementById('so-avoid-recent').checked = true;

  // ① ON だが判定できなかった (一覧はあるが選択欄が空) → シリーズ罰則なしで実行し、注記に明示する
  //    (2026-09-14 まではここで止めて選ばせていた。既定 ON 化に伴い変更、ユーザー確認済み)。
  doc.getElementById('so-avoid-series').checked = true;
  doc.getElementById('so-series-select').value = '';
  await win.eval('runSeedOptimize()');
  const cap1 = win.eval('captured');
  assert.ok(cap1.buildOpts, '判定できないときに実行していない');
  assert.strictEqual(cap1.buildOpts.params.targetSeries, undefined);
  assert.strictEqual(cap1.post.input.targetSeries, null);
  assert.strictEqual(cap1.post.input.params.avoidSeriesRematch, false, '判定できないのに罰則を掛けている');
  assert.strictEqual(win.eval('toggleCalls'), 0, '一覧ロード済みなのに再ロードした');
  cap1.worker.onmessage({ data: { type: 'progress', round: 0, restarts: 1, phase: 'inter' } });
  assert.match(doc.getElementById('so-progress').textContent, /シリーズ判定なし（同シリーズ罰則は掛けていません）/);

  // ①' ON で一覧が未ロード → 実行時にロードして自動判定した結果を使う。
  win.eval('SERIES_INDEX = null');
  await win.eval('runSeedOptimize()');
  assert.strictEqual(win.eval('toggleCalls'), 1, '一覧未ロード時に判定を呼んでいない');
  assert.strictEqual(win.eval('captured').buildOpts.params.targetSeries, '篝火', '自動判定の結果を使っていない');

  // ② シリーズを選ぶと targetSeries と罰則パラメータが届く。
  doc.getElementById('so-series-select').value = '篝火';
  doc.getElementById('so-seriesmode').value = 'mult';
  doc.getElementById('so-seriesmult').value = '4';
  doc.getElementById('so-wseries').value = '0.7';
  await win.eval('runSeedOptimize()');
  const cap = win.eval('captured');
  assert.strictEqual(cap.buildOpts.params.targetSeries, '篝火');
  assert.strictEqual(win.eval('captured.buildOpts.seriesIndex === SERIES_INDEX'), true,
    'ロード済みの大会一覧を再取得しないよう seriesIndex を渡していない');
  assert.strictEqual(cap.post.input.targetSeries, '篝火');
  assert.strictEqual(win.eval("JSON.stringify(captured.post.input.seriesPair)"), '{"1:2":3}');
  assert.strictEqual(cap.post.input.params.avoidSeriesRematch, true);
  assert.strictEqual(cap.post.input.params.seriesMode, 'mult');
  assert.strictEqual(cap.post.input.params.seriesMult, 4);
  assert.strictEqual(cap.post.input.params.W_series, 0.7);
  // 取得状況の注記に同シリーズの組数が載る。
  cap.worker.onmessage({ data: { type: 'progress', round: 0, restarts: 1, phase: 'inter' } });
  assert.match(doc.getElementById('so-progress').textContent, /同シリーズ「篝火」で対戦済 1 組/);

  // ③ OFF なら targetSeries を渡さない（大会一覧も要求しない）。
  doc.getElementById('so-avoid-series').checked = false;
  await win.eval('runSeedOptimize()');
  const cap3 = win.eval('captured');
  assert.strictEqual(cap3.buildOpts.params.targetSeries, undefined);
  assert.strictEqual(cap3.post.input.targetSeries, null);
  assert.strictEqual(cap3.post.input.params.avoidSeriesRematch, false);
});

// 同じ大会で「最適化を実行」を押し直すたびに players/*.json を取り直していた問題の回帰テスト。
// 256名なら毎回 250 リクエスト・十数MB になっていた。
test('jsdom: 2回目以降は取得済みの選手データを使い回す', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  const setup = `
    var S = window;   // 共有状態 S (seeding/app/00_state.js) はこのテストではグローバル変数そのもの
    var PLAYER_CACHE = new Map(), PLAYER_CACHE_MAX = 4, PREFS_CACHE = null;
    var calls = { player: [], prefs: 0 };
    var fail = null;
    var SeedData = {
      defaultFetchers: function (prefix) {
        calls.prefix = prefix;
        return {
          fetchPlayer: async function (uid) {
            calls.player.push(uid);
            if (fail === uid) throw new Error('HTTP 500');
            return uid === 99 ? { __missing: true } : { user_id: uid };
          },
          fetchPrefs: async function () { calls.prefs++; return { 1: '東京都' }; },
        };
      },
    };
    ${extractFn(HTML, 'cachedFetchers')}
    var F = cachedFetchers('../');
  `;
  win.eval(setup);
  const get = (uid) => win.eval(`F.fetchPlayer(${uid})`);

  // 1回目は取りに行く。2回目は取りに行かない。
  await get(1); await get(2); await get(1); await get(2);
  const fetched = () => win.eval('JSON.stringify(calls.player)');
  assert.strictEqual(fetched(), '[1,2]', '同じ uid を取り直している');
  assert.strictEqual(win.eval('calls.prefix'), '../');

  // 404 (DB 未登録) は確定した答えなのでキャッシュする。
  await get(99); await get(99);
  assert.strictEqual(fetched(), '[1,2,99]');

  // 都道府県データも 1 回だけ。
  await win.eval('F.fetchPrefs()'); await win.eval('F.fetchPrefs()');
  assert.strictEqual(win.eval('calls.prefs'), 1);

  // 通信エラーはキャッシュしない（次回リトライさせる）。
  win.eval('fail = 7;');
  await assert.rejects(() => get(7), /500/);
  win.eval('fail = null;');
  await get(7);
  await get(7);
  assert.strictEqual(fetched(), '[1,2,99,7,7]', '失敗をキャッシュしている / リトライしていない');

  // 上限を超えたら古い順に捨てる（際限なく抱えない）。PLAYER_CACHE_MAX=4。
  await get(10); await get(11);
  assert.ok(win.eval('PLAYER_CACHE.size') <= 4, 'キャッシュが上限を超えている');
  assert.strictEqual(win.eval('PLAYER_CACHE.has(1)'), false, '古いものが捨てられていない');
});


// ── 適用時の被り回避 自動実行 (2026-09-14) ─────────────────────────────
// 「start.gg にシード適用」を押したとき、チェック ON なら最適化を回して完了を待ち、
// 反映後の並びで uploadSeeding する。完了しなければ適用しない。
function buildUploadDom(doc) {
  const mk = (id, tag, attrs) => {
    const el = doc.createElement(tag || 'input');
    el.id = id;
    Object.assign(el, attrs || {});
    doc.body.appendChild(el);
    return el;
  };
  mk('status', 'span'); mk('error-help', 'div'); mk('so-progress', 'div'); mk('so-report', 'div');
  mk('token', 'input', { value: 'tok' });
  mk('so-auto-apply', 'input', { type: 'checkbox', checked: true });
  const d = mk('seedopt-details', 'details');
  return d;
}
function uploadSetup(HTML) {
  return `
    var S = window;   // 共有状態 S はテストではグローバルそのもの
    var DATA = [];
    var currentMethod = 'ensemble';
    var EVENT_CONTEXT = { eventName: 'Ev', phaseId: 77, bracketType: 'DOUBLE_ELIMINATION', poolCount: 1 };
    var SEED_APP_CONFIG = { mode: 'spsp' };
    var CSV_SOURCE = null;
    var SEEDOPT_WORKER = null, SEEDOPT_RESULT = null, SEEDOPT_WAITER = null;
    var MANUAL = null, APPLIED_ORDER = null, PRE_OPT = null;
    var calls = { optimize: 0, upload: null, errors: [], alerts: [], createPhase: 0 };
    // 最適化のスタブ: 本物と同じく worker を立て、非同期に完了 → 反映 (APPLIED_ORDER) → 決着。
    var OPT_BEHAVIOR = 'ok';   // 'ok' | 'precheck' (事前チェックで止まる) | 'error' (worker エラー)
    async function runSeedOptimize() {
      calls.optimize++;
      if (OPT_BEHAVIOR === 'precheck') {
        document.getElementById('so-progress').textContent = '⚠ 1プール×ダブルイリミネーション以外は被り回避非対応です。';
        return;
      }
      SEEDOPT_WORKER = { terminate: function () {} };
      setTimeout(function () {
        if (OPT_BEHAVIOR === 'error') {
          document.getElementById('so-progress').textContent = '⚠ 最適化エラー: boom';
          cleanupSeedOptWorker();
          return;
        }
        SEEDOPT_WORKER = null;
        APPLIED_ORDER = DATA.map(function (r) { return r.user_id; }).reverse();
        settleSeedOptWaiter(!!APPLIED_ORDER);
      }, 5);
    }
    function cleanupSeedOptWorker(opts) {
      if (!(opts && opts.keepWaiter)) settleSeedOptWaiter(false);
      SEEDOPT_WORKER = null;
    }
    function orderedRecs() {
      if (!APPLIED_ORDER) return DATA.slice();
      var pos = new Map(APPLIED_ORDER.map(function (u, i) { return [u, i]; }));
      return DATA.slice().sort(function (a, b) { return pos.get(a.user_id) - pos.get(b.user_id); });
    }
    function getToken() { return document.getElementById('token').value; }
    function clearError() {}
    function showError(m) { calls.errors.push(m); }
    function alert(m) { calls.alerts.push(m); }
    function confirm() { return true; }
    async function createPhaseThenUpload() { calls.createPhase++; }
    var SmashSeed = { uploadSeeding: async function (phaseId, token, mapping) { calls.upload = { phaseId: phaseId, mapping: mapping }; return { ok: true, count: mapping.length }; } };
    ${extractFn(HTML, 'uploadOrderLabel')}
    ${extractFn(HTML, 'isAutoOptimizeOn')}
    ${extractFn(HTML, 'openSeedOptPanel')}
    ${extractFn(HTML, 'ensureAutoOptimizeForUpload')}
    ${extractFn(HTML, 'settleSeedOptWaiter')}
    ${extractFn(HTML, 'runSeedOptimizeAndWait')}
    ${extractFn(HTML, 'uploadToStartgg')}
  `;
}
function newUploadWin() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  buildUploadDom(win.document);
  win.eval(uploadSetup(HTML));
  win.DATA.push({ user_id: 1, seedId: 11, display: 'A', ranks: { ensemble: 1 } },
                { user_id: 2, seedId: 12, display: 'B', ranks: { ensemble: 2 } },
                { user_id: 3, seedId: 13, display: 'C', ranks: { ensemble: 3 } });
  return win;
}

test('jsdom: 自動実行 ON → 最適化の完了を待ってから、反映後の並びで start.gg に送る', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const win = newUploadWin();
  await win.eval('uploadToStartgg()');
  const c = win.eval('calls');
  assert.strictEqual(c.optimize, 1, '最適化が1回走っていない');
  assert.strictEqual(win.document.getElementById('seedopt-details').open, true, 'パネルが自動で開いていない');
  assert.ok(c.upload, 'uploadSeeding が呼ばれていない');
  assert.strictEqual(c.upload.phaseId, 77);
  // 反映後 (逆順) の並びで seedNum が振られる。
  assert.strictEqual(JSON.stringify(c.upload.mapping), JSON.stringify([{ seedId: 13, seedNum: 1 }, { seedId: 12, seedNum: 2 }, { seedId: 11, seedNum: 3 }]));
  assert.match(win.document.getElementById('status').textContent, /シード適用成功/);
  assert.strictEqual(c.errors.length, 0);
  // 反映済みなので、もう一度押しても回し直さない。
  await win.eval('uploadToStartgg()');
  assert.strictEqual(win.eval('calls').optimize, 1, '反映済みなのに最適化を回し直した');
  // confirm 文面に反映済みであることが出る。
  assert.match(win.eval('uploadOrderLabel()'), /被り回避 反映済み/);
});

test('jsdom: 自動実行 OFF → 最適化せず今の並びで送る', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const win = newUploadWin();
  win.document.getElementById('so-auto-apply').checked = false;
  await win.eval('uploadToStartgg()');
  const c = win.eval('calls');
  assert.strictEqual(c.optimize, 0);
  assert.strictEqual(JSON.stringify(c.upload.mapping), JSON.stringify([{ seedId: 11, seedNum: 1 }, { seedId: 12, seedNum: 2 }, { seedId: 13, seedNum: 3 }]));
  assert.strictEqual(win.document.getElementById('seedopt-details').open, false, 'OFF なのにパネルを開いた');
});

test('jsdom: 最適化が完了しなければ適用しない (事前チェック停止 / worker エラー)', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  for (const mode of ['precheck', 'error']) {
    const win = newUploadWin();
    win.eval(`OPT_BEHAVIOR = '${mode}'`);
    await win.eval('uploadToStartgg()');
    const c = win.eval('calls');
    assert.strictEqual(c.optimize, 1, mode);
    assert.strictEqual(c.upload, null, mode + ': 完了していないのに送信した');
    assert.strictEqual(c.errors.length, 1, mode + ': エラー表示が無い');
    assert.match(c.errors[0], /シード適用を中止しました/);
    assert.match(c.errors[0], mode === 'precheck' ? /被り回避非対応/ : /boom/, mode + ': 理由が載っていない');
    assert.strictEqual(win.eval('SEEDOPT_WAITER'), null, mode + ': waiter が残っている');
  }
});

test('jsdom: 最適化の実行中は適用しない / phase 未作成でも自動実行が先に走る', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const win = newUploadWin();
  win.eval('SEEDOPT_WORKER = {}');
  await win.eval('uploadToStartgg()');
  let c = win.eval('calls');
  assert.strictEqual(c.optimize, 0);
  assert.strictEqual(c.upload, null);
  assert.strictEqual(c.alerts.length, 1);
  // phase 未作成 (phaseId null): 最適化 → createPhaseThenUpload の順。
  const win2 = newUploadWin();
  win2.eval('EVENT_CONTEXT.phaseId = null');
  await win2.eval('uploadToStartgg()');
  c = win2.eval('calls');
  assert.strictEqual(c.optimize, 1);
  assert.strictEqual(c.createPhase, 1);
  assert.ok(win2.eval('APPLIED_ORDER') && win2.eval('APPLIED_ORDER.length') === 3, '反映前に phase 作成へ進んだ');
});


// ── 被り回避パネルの設定保存 (2026-09-14) ─────────────────────────────
function buildSettingsDom(doc) {
  const panel = doc.createElement('div'); panel.id = 'seedopt-panel'; doc.body.appendChild(panel);
  const mk = (id, tag, attrs, parent) => {
    const el = doc.createElement(tag || 'input'); el.id = id; Object.assign(el, attrs || {});
    (parent || panel).appendChild(el); return el;
  };
  mk('so-pools', 'input', { value: '4' });
  mk('so-waves', 'input', { value: '1' });
  for (const [id, on] of [['so-enable-intra', true], ['so-avoid-region', true], ['so-avoid-recent', true],
                          ['so-keep-deplace', true], ['so-scope-winners', true], ['so-include-weekday', false],
                          ['so-avoid-series', true], ['so-group-minamikanto', true], ['so-group-keihanshin', true]]) {
    mk(id, 'input', { type: 'checkbox', checked: on });
  }
  mk('so-series-select', 'select');
  const box = mk('so-series-box', 'span'); box.style.display = '';
  for (const id of ['so-shift0', 'so-shift1', 'so-shift2', 'so-shift3', 'so-shift4', 'so-shift5']) mk(id, 'input', { value: '' });
  mk('so-maxshift', 'input', { value: '' });
  mk('so-orderpow', 'input', { type: 'range', value: '2.5' });
  mk('so-orderpow-val', 'span').textContent = '2.5';
  const mode = mk('so-mode', 'select');
  for (const v of ['multistart-sa', 'hillclimb']) { const o = doc.createElement('option'); o.value = v; o.textContent = v; mode.appendChild(o); }
  mode.value = 'multistart-sa';
  mk('so-restarts', 'input', { value: '15' });
  mk('so-cooling', 'input', { value: '0.999' });
  mk('so-itersscale', 'input', { value: '1000' });
  mk('so-wregion', 'input', { value: '1.0' });
  mk('so-progress', 'div');
  mk('so-auto-apply', 'input', { type: 'checkbox', checked: true }, doc.body);   // パネル外
}
function settingsSetup(HTML) {
  return `
    var S = window;   // 共有状態 S はテストではグローバルそのもの
    var DATA = [];
    var SHIFT_LIMIT_PRESET = [4, 8, 16, 32, 64, 128];
    var SHIFT_LIMIT_IDS = ['so-shift0', 'so-shift1', 'so-shift2', 'so-shift3', 'so-shift4', 'so-shift5'];
    var _lastShiftPrefill = null;
    var SEEDOPT_SETTINGS_KEY = 'spsp_seedopt_settings_v1';
    var SEEDOPT_SETTINGS_SKIP = new Set(['so-pools', 'so-waves', 'so-series-select']);
    var SEEDOPT_DEFAULTS = null;
    var modeDefaultsCalls = 0;
    function applyModeDefaults() { modeDefaultsCalls++; document.getElementById('so-restarts').value = '15'; }
    async function updateSeriesToggleState() {}
    ${extractFn(HTML, 'updateIntraToggleState')}
    ${extractFn(HTML, 'seedOptSettingFields')}
    ${extractFn(HTML, 'seedOptFieldValue')}
    ${extractFn(HTML, 'setSeedOptFieldValue')}
    ${extractFn(HTML, 'snapshotSeedOptDefaults')}
    ${extractFn(HTML, 'loadSeedOptSettings')}
    ${extractFn(HTML, 'saveSeedOptSettings')}
    ${extractFn(HTML, 'restoreSeedOptSettings')}
    ${extractFn(HTML, 'resetSeedOptSettings')}
    ${extractFn(HTML, 'refreshSeedOptDerivedUi')}
    async function ensureGeoForSeed() {}   // 起動時の geo.json 読込 (トグル描画) はここでは対象外
    ${extractFn(HTML, 'wireSeedOptSettings')}
  `;
}
function newSettingsWin(storageJson) {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only', url: 'http://localhost/seed/' });
  const win = dom.window;
  if (storageJson != null) win.localStorage.setItem('spsp_seedopt_settings_v1', storageJson);
  buildSettingsDom(win.document);
  win.eval(settingsSetup(HTML));
  win.eval('wireSeedOptSettings()');
  return win;
}

test('jsdom: 設定保存: 既定と違う項目だけ localStorage に入り、大会ごとの値は保存しない', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = newSettingsWin(null);
  const doc = win.document;
  const fire = (id, type) => doc.getElementById(id).dispatchEvent(new win.Event(type, { bubbles: true }));
  // 何も変えていなければ保存なし。
  assert.strictEqual(win.localStorage.getItem('spsp_seedopt_settings_v1'), null);
  doc.getElementById('so-avoid-region').checked = false; fire('so-avoid-region', 'change');
  doc.getElementById('so-orderpow').value = '1.5'; fire('so-orderpow', 'input');
  doc.getElementById('so-pools').value = '8'; fire('so-pools', 'input');          // 保存対象外
  doc.getElementById('so-auto-apply').checked = false; fire('so-auto-apply', 'change');
  const saved = JSON.parse(win.localStorage.getItem('spsp_seedopt_settings_v1'));
  assert.deepStrictEqual(Object.keys(saved).sort(), ['so-auto-apply', 'so-avoid-region', 'so-orderpow']);
  assert.strictEqual(saved['so-avoid-region'], false);
  assert.strictEqual(saved['so-orderpow'], '1.5');
  // 既定に戻したら保存から消える。
  doc.getElementById('so-avoid-region').checked = true; fire('so-avoid-region', 'change');
  assert.ok(!('so-avoid-region' in JSON.parse(win.localStorage.getItem('spsp_seedopt_settings_v1'))));
  // ズレ上限: 空欄 (未プリフィル) は保存しない。既定と同じ値も保存しない。違う値は保存する。
  doc.getElementById('so-shift0').value = '4'; fire('so-shift0', 'change');
  assert.ok(!('so-shift0' in JSON.parse(win.localStorage.getItem('spsp_seedopt_settings_v1'))), '既定と同じズレ上限を保存した');
  doc.getElementById('so-shift0').value = '2'; fire('so-shift0', 'change');
  assert.strictEqual(JSON.parse(win.localStorage.getItem('spsp_seedopt_settings_v1'))['so-shift0'], '2');
});

test('jsdom: 設定復元: 起動時に保存済みの値が欄と連動表示に入る / 既定に戻すで消える', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = newSettingsWin(JSON.stringify({ 'so-avoid-series': false, 'so-orderpow': '1', 'so-restarts': '5', 'so-auto-apply': false, 'so-shift1': '6', 'so-pools': '9' }));
  const doc = win.document;
  assert.strictEqual(doc.getElementById('so-avoid-series').checked, false);
  assert.strictEqual(doc.getElementById('so-series-box').style.display, 'none', 'シリーズ欄の出し入れが連動していない');
  assert.strictEqual(doc.getElementById('so-orderpow').value, '1');
  assert.strictEqual(doc.getElementById('so-orderpow-val').textContent, '1', 'スライダーの表示値が連動していない');
  assert.strictEqual(doc.getElementById('so-restarts').value, '5');
  assert.strictEqual(doc.getElementById('so-auto-apply').checked, false);
  assert.strictEqual(doc.getElementById('so-shift1').value, '6');
  assert.strictEqual(doc.getElementById('so-pools').value, '4', '保存対象外のプール数が上書きされた');
  // 大会読み込み時の順序: applyModeDefaults (restarts=15 に戻す) → restore で 5 に戻る。
  win.eval('applyModeDefaults(); restoreSeedOptSettings();');
  assert.strictEqual(doc.getElementById('so-restarts').value, '5');
  // 既定に戻す。
  win.eval('resetSeedOptSettings()');
  assert.strictEqual(doc.getElementById('so-avoid-series').checked, true);
  assert.strictEqual(doc.getElementById('so-series-box').style.display, '');
  assert.strictEqual(doc.getElementById('so-orderpow').value, '2.5');
  assert.strictEqual(doc.getElementById('so-orderpow-val').textContent, '2.5');
  assert.strictEqual(doc.getElementById('so-restarts').value, '15');
  assert.strictEqual(doc.getElementById('so-auto-apply').checked, true);
  assert.strictEqual(doc.getElementById('so-shift1').value, '8', 'ズレ上限が既定 (8) に戻っていない');
  assert.strictEqual(win.localStorage.getItem('spsp_seedopt_settings_v1'), null, '保存が消えていない');
  assert.match(doc.getElementById('so-progress').textContent, /既定に戻しました/);
  assert.strictEqual(JSON.stringify(win.eval('_lastShiftPrefill')), JSON.stringify(['4', '8', '16', '32', '64', '128']));
});
