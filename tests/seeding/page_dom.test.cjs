'use strict';
// jsdom 実行時テスト: seed ページの実関数ソースを HTML から抽出し、
// 実DOM上で「被り回避を適用 → orderedRecs / downloadCsv が最適化後シード順を反映」する
// 中核契約を検証する（関数ソースは実物を使うので乖離しない）。
// jsdom は /tmp/jsdom_inst に隔離インストール。NODE_PATH で解決。
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

// `function name(...) { ... }` を波括弧バランスで抽出。
function extractFn(src, name) {
  const sig = src.indexOf('function ' + name + '(');
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

test('jsdom: 適用後 orderedRecs / downloadCsv が最適化後順を反映', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;

  // 取得したいキャプチャ用スタブ
  let lastBlobText = null;
  win.URL.createObjectURL = (blob) => {
    // jsdom Blob は text() が Promise。同期で読むため _buffer を使えないので、
    // ここでは downloadCsv が組み立てた配列を別途検証するため blob.size のみ確認。
    lastBlobText = blob;       // Blob オブジェクト
    return 'blob:stub';
  };
  win.URL.revokeObjectURL = () => {};

  // 実関数ソースを注入。
  const orderedRecsSrc = extractFn(HTML, 'orderedRecs');
  const applySrc = extractFn(HTML, 'applySeedOptimize');
  const downloadSrc = extractFn(HTML, 'downloadCsv');

  // 必要なグローバルと最小スタブを定義してから関数を定義。
  const cancelSrc = extractFn(HTML, 'cancelSeedOptimize');
  const setup = `
    var S = window;   // 共有状態 S (seeding/app/00_state.js) はこのテストではグローバル変数そのもの
    var DATA = [];
    var currentMethod = 'ensemble';
    var APPLIED_ORDER = null;
    var PRE_OPT = null;
    var SEEDOPT_RESULT = null;
    var EVENT_CONTEXT = { eventName: 'Test', phaseId: 1 };
    var MANUAL = null;                   // 手動調整なし
    var SEED_SPEC = null;
    var cancelBtnShown = null;
    function _projectSeedLocks(a) { return a; }
    function manualOrder() { return MANUAL ? MANUAL.base.slice() : []; }
    function renderManualUI() {}
    function render() {}                 // テーブル再描画はスタブ
    function saveManual() {}
    function showOptCancelBtn(on) { cancelBtnShown = on; }
    function resetSeedOptResultPanel(msg) {
      SEEDOPT_RESULT = null;
      var r = document.getElementById('so-report'); if (r) r.innerHTML = '';
    }
    ${orderedRecsSrc}
    ${applySrc}
    ${cancelSrc}
    ${downloadSrc}
    // テスト用ヘルパ: CSV 文字列を直接組むため downloadCsv 内と同じ順序を取り出す。
    function _seedOrderUids() { return orderedRecs().map(function(r){return r.user_id;}); }
  `;
  win.eval(setup);

  // DATA を投入（user_id, display, ranks.ensemble, scores, seedId）。
  const recs = [];
  for (let i = 1; i <= 8; i++) {
    recs.push({
      user_id: 100 + i, display: 'P' + i, seedId: 9000 + i, original_seed: i,
      ranks: { ensemble: i, tjpr: i, bt_gated: i },
      scores: { tjpr_elo: 0, bt_gated_elo: 0, ensemble_avg_rank: null, ensemble_avg_score: 0 },
    });
  }
  win.DATA.push(...recs);

  // jsdom realm の配列を node realm に正規化して比較。
  const norm = (a) => Array.from(a);
  // 適用前: ensemble 順（=投入順）
  assert.deepStrictEqual(norm(win._seedOrderUids()), [101, 102, 103, 104, 105, 106, 107, 108]);

  // 最適化結果を模擬して適用。
  win.SEEDOPT_RESULT = { seedOrder: [108, 101, 106, 103, 104, 105, 102, 107] };
  // so-report 要素が無いと applySeedOptimize の querySelector で落ちるため用意。
  const rep = win.document.createElement('div'); rep.id = 'so-report'; win.document.body.appendChild(rep);
  win.eval('applySeedOptimize();');

  // 反映後: orderedRecs が最適化後順
  assert.deepStrictEqual(norm(win._seedOrderUids()), [108, 101, 106, 103, 104, 105, 102, 107]);
  assert.deepStrictEqual(norm(win.eval('APPLIED_ORDER')), [108, 101, 106, 103, 104, 105, 102, 107]);
  // 反映バナーが出て、取り消しボタンが出る
  assert.ok(/被り回避を反映/.test(rep.textContent));
  assert.strictEqual(win.eval('cancelBtnShown'), true);
  // トーナメントプレビュー / CSV / start.gg 適用がこれを見る、と明記している
  assert.ok(/トーナメントプレビュー/.test(rep.textContent));

  // 取り消すと実行前の並び・レポート・ボタン状態に戻る
  win.eval('cancelSeedOptimize();');
  assert.deepStrictEqual(norm(win._seedOrderUids()), [101, 102, 103, 104, 105, 106, 107, 108]);
  assert.strictEqual(win.eval('APPLIED_ORDER'), null);
  assert.strictEqual(win.eval('PRE_OPT'), null);
  assert.strictEqual(win.eval('SEEDOPT_RESULT'), null, 'レポートの元データが残っている');
  assert.strictEqual(rep.innerHTML, '', 'レポートが実行前に戻っていない');
  assert.strictEqual(win.eval('cancelBtnShown'), false);
});

test('jsdom: 取り消しは手動調整の状態も実行前に戻す', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  const setup = `
    var S = window;   // 共有状態 S (seeding/app/00_state.js) はこのテストではグローバル変数そのもの
    var DATA = [];
    var currentMethod = 'ensemble';
    var APPLIED_ORDER = null, PRE_OPT = null, SEEDOPT_RESULT = null, SEED_SPEC = null;
    var MANUAL = { base: [102, 101], ops: [], hpos: 0, committed: true, editing: true, sel: 7 };
    var cancelBtnShown = null;
    function _projectSeedLocks(a) { return a; }
    function manualOrder() { return MANUAL ? MANUAL.base.slice() : []; }
    function renderManualUI() {}
    function render() {}
    function saveManual() {}
    function showOptCancelBtn(on) { cancelBtnShown = on; }
    function resetSeedOptResultPanel() { SEEDOPT_RESULT = null;
      var r = document.getElementById('so-report'); if (r) r.innerHTML = ''; }
    ${extractFn(HTML, 'orderedRecs')}
    ${extractFn(HTML, 'applySeedOptimize')}
    ${extractFn(HTML, 'cancelSeedOptimize')}
  `;
  win.eval(setup);
  const rep = win.document.createElement('div'); rep.id = 'so-report'; win.document.body.appendChild(rep);
  win.DATA.push(
    { user_id: 101, display: 'P1', ranks: { ensemble: 1 } },
    { user_id: 102, display: 'P2', ranks: { ensemble: 2 } });
  win.SEEDOPT_RESULT = { seedOrder: [102, 101] };

  win.eval('applySeedOptimize();');
  // 反映すると編集は閉じる
  assert.strictEqual(win.eval('MANUAL.editing'), false);
  assert.strictEqual(win.eval('MANUAL.sel'), null);

  win.eval('cancelSeedOptimize();');
  // 取り消すと編集中だった状態がそのまま戻る
  assert.strictEqual(win.eval('MANUAL.editing'), true);
  assert.strictEqual(win.eval('MANUAL.sel'), 7);
});

test('jsdom: downloadCsv が最適化後順で phaseseed を採番', { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  let captured = null;
  win.URL.createObjectURL = (blob) => { captured = blob; return 'blob:stub'; };
  win.URL.revokeObjectURL = () => {};

  const setup = `
    var S = window;   // 共有状態 S (seeding/app/00_state.js) はこのテストではグローバル変数そのもの
    var DATA = [];
    var currentMethod = 'ensemble';
    var APPLIED_ORDER = [108,101,106,103,104,105,102,107];
    var EVENT_CONTEXT = { eventName: 'Test', phaseId: 1 };
    var MANUAL = null;                   // 手動調整なし
    var SEED_SPEC = null;
    function _projectSeedLocks(a) { return a; }
    function manualOrder() { return MANUAL ? MANUAL.base.slice() : []; }
    ${extractFn(HTML, 'orderedRecs')}
    ${extractFn(HTML, 'downloadCsv')}
  `;
  win.eval(setup);
  const recs = [];
  for (let i = 1; i <= 8; i++) recs.push({
    user_id: 100 + i, display: 'P' + i, seedId: 9000 + i, original_seed: i,
    ranks: { ensemble: i, tjpr: i, bt_gated: i },
    scores: { tjpr_elo: 0, bt_gated_elo: 0, ensemble_avg_rank: null, ensemble_avg_score: 0 },
  });
  win.DATA.push(...recs);
  win.eval('downloadCsv();');
  assert.ok(captured, 'Blob 未生成');
  const text = await captured.text();
  const lines = text.replace(/^﻿/, '').trim().split(/\r\n/);
  // header + 8 行
  assert.strictEqual(lines.length, 9);
  // phaseseed 1 の user_id は最適化後先頭 = 108
  const row1 = lines[1].split(',');
  // 列: phaseseed,seedId,player,user_id,...
  assert.strictEqual(row1[0], '1');
  assert.strictEqual(row1[3], '108');
  // phaseseed 2 → 101
  assert.strictEqual(lines[2].split(',')[3], '101');
});

// 手動調整は既定でオン。プール数/ウェーブ数の入力はどの状態でも出す。
test('jsdom: 手動調整バーは MANUAL が無くてもプール数/ウェーブ数を出す', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const dom = new JSDOM('<!DOCTYPE html><body>' +
    '<input id="so-pools" value="8"><input id="so-waves" value="2"></body>',
    { runScripts: 'outside-only' });
  const win = dom.window;
  win.escHtml = (s) => String(s);
  win._lockProjNotes = [];
  win.manualMovedSet = () => new Set();
  win.APPLIED_ORDER = null;
  win.eval('var S = window;');   // 共有状態 S はテストではグローバルそのもの
  win.eval(extractFn(HTML, 'manualBarHtml'));

  // 手動調整が無い状態でもプール数/ウェーブ数が出る
  win.MANUAL = null;
  const off = win.manualBarHtml();
  assert.ok(off.includes('data-mn-pools'), off);
  assert.ok(off.includes('data-mn-waves'), off);
  assert.ok(off.includes('value="8"') && off.includes('value="2"'), off);
  // 編集中・確定後も同じく出る
  win.MANUAL = { base: [], ops: [], hpos: 0, committed: false, editing: true, sel: null };
  assert.ok(win.manualBarHtml().includes('data-mn-pools'));
  win.MANUAL = { base: [], ops: [], hpos: 0, committed: true, editing: false, sel: null };
  assert.ok(win.manualBarHtml().includes('data-mn-pools'));
});

test('参加者が揃ったら手動調整は編集状態で開く / 被り回避を適用したら閉じる', () => {
  const restore = extractFn(HTML, 'restoreManualForEvent');
  // 復元が無ければ現在順を基準に editing:true で作る
  assert.ok(/if \(!S\.MANUAL && DATA\.length\)/.test(restore), restore.slice(-400));
  assert.ok(/editing: true/.test(restore), restore.slice(-400));
  // 復元できた場合も編集状態にする
  assert.ok(/MANUAL\.editing = true/.test(restore), restore.slice(-400));
  // 「タップで編集開始」の待機ボタンは廃止
  assert.ok(!HTML.includes('🔒 手動調整 — タップで編集開始'), '旧ボタンが残っている');
  // 被り回避を適用したら編集は閉じる (表は最適化後順になるため)
  const apply = extractFn(HTML, 'applySeedOptimize');
  assert.ok(/MANUAL\.editing = false/.test(apply), apply.slice(0, 500));
});
