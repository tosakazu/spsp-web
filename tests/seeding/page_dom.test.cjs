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
    var DISCRIMINATORS = { '101': 'j101' };   // 参加者データに disc が無い人は discriminators.json から
    function _projectSeedLocks(a) { return a; }
    function manualOrder() { return MANUAL ? MANUAL.base.slice() : []; }
    ${extractFn(HTML, 'orderedRecs')}
    ${extractFn(HTML, 'downloadCsv')}
  `;
  win.eval(setup);
  const recs = [];
  for (let i = 1; i <= 8; i++) recs.push({
    user_id: 100 + i, display: 'P' + i, seedId: 9000 + i, original_seed: i, discriminator: i === 1 ? null : 'd' + (100 + i),
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
  // 列は phaseseed,seedId,player,discriminator だけ (スコア・original_seed・user_id は出さない)
  assert.strictEqual(lines[0], 'phaseseed,seedId,player,discriminator');
  // phaseseed 1 は最適化後先頭 = 108
  assert.deepStrictEqual(lines[1].split(','), ['1', '9008', '"P8"', 'd108']);
  // phaseseed 2 → 101 (disc は discriminators.json から)
  assert.deepStrictEqual(lines[2].split(','), ['2', '9001', '"P1"', 'j101']);
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
  win.orderedRecs = () => [];
  win.initialOrder = () => [];
  win._projectSeedLocks = (a) => a;
  win.manualSrc = () => null;
  win.eval('var S = window;');   // 共有状態 S はテストではグローバルそのもの
  win.eval(extractFn(HTML, 'manualBarHtml'));

  // 手動調整が無い状態でもプール数/ウェーブ数が出る
  win.MANUAL = null;
  const off = win.manualBarHtml();
  assert.ok(off.includes('data-mn-pools'), off);
  assert.ok(off.includes('data-mn-waves'), off);
  assert.ok(off.includes('value="8"') && off.includes('value="2"'), off);
  // ウェーブが 2 つ以上なら「ウェーブの並び」も出る (2026-11-12)。1 つなら出ない
  assert.ok(off.includes('data-mn-wave-order') && /<option value=""[^>]* selected/.test(off), off);
  win.document.getElementById('so-waves').value = '1';
  assert.ok(!win.manualBarHtml().includes('data-mn-wave-order'));
  win.document.getElementById('so-waves').value = '2';
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

test('csv モード: 保存済みの手動調整が無ければ、既定の手動調整を開く前に CSV 順を基準にする (CSV → 適用でランキング順になっていた)', () => {
  const restore = extractFn(HTML, 'restoreManualForEvent');
  const csvFirst = restore.indexOf('if (!restored && typeof applyCsvOrderIfReady');
  const dflt = restore.indexOf('if (!S.MANUAL && DATA.length)');
  assert.ok(csvFirst > 0 && dflt > 0 && csvFirst < dflt, restore.slice(-900));
  // 復元した手動調整は CSV で上書きしない (案内だけ)
  assert.ok(/if \(restored && typeof applyCsvOrderIfReady === 'function'\) applyCsvOrderIfReady\(true\)/.test(restore), restore.slice(-500));
});

test('jsdom: 被り回避を反映した並びから手動調整を続けられる・元に戻すで最適化前に戻る (2026-11-11)', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="so-report"></div><div id="so-progress"></div></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(`
    var S = window;
    var DATA = [];
    var APPLIED_ORDER = null, PRE_OPT = null, SEEDOPT_RESULT = null, SEED_SPEC = null;
    var MANUAL = null;
    var MANUAL_MAX_OPS = 100;
    var dropped = 0;
    function i18n(k) { return k; }
    function _projectSeedLocks(a) { return a; }
    function renderManualUI() {}
    function render() {}
    function saveManual() {}
    function showOptCancelBtn() {}
    function resetSeedOptResultPanel() { SEEDOPT_RESULT = null; }
    function dropAppliedOrder() { dropped++; APPLIED_ORDER = null; PRE_OPT = null; }
    function escHtml(x) { return String(x); }
    var currentMethod = 'ensemble';
    ${extractFn(HTML, 'manualApplyOp')}
    ${extractFn(HTML, 'manualOrder')}
    ${extractFn(HTML, 'manualMovedSet')}
    ${extractFn(HTML, 'orderedRecs')}
    ${extractFn(HTML, 'applySeedOptimize')}
    ${extractFn(HTML, 'manualUnlock')}
    ${extractFn(HTML, 'manualPushOrder')}
    ${extractFn(HTML, 'manualSrc')}
    ${extractFn(HTML, 'manualPushOp')}
    function uids() { return orderedRecs().map(function (r) { return r.user_id; }); }
  `);
  for (let i = 1; i <= 6; i++) win.DATA.push({ user_id: 100 + i, display: 'P' + i });
  const norm = (a) => Array.from(a);
  // 手動調整: 106 を先頭へ (編集中) → 最適化を反映
  win.eval('MANUAL = { base: [101,102,103,104,105,106], ops: [], hpos: 0, committed: false, editing: true, sel: null }; manualPushOp(106, 0);');
  assert.deepStrictEqual(norm(win.eval('uids()')), [106, 101, 102, 103, 104, 105]);
  win.eval('SEEDOPT_RESULT = { seedOrder: [106, 102, 101, 104, 103, 105] }; applySeedOptimize();');
  assert.deepStrictEqual(norm(win.eval('uids()')), [106, 102, 101, 104, 103, 105]);
  // 編集を再開: 最適化後の並びのまま手動調整に入る (反映は手動調整が持つ)
  win.eval('manualUnlock();');
  assert.strictEqual(win.eval('APPLIED_ORDER'), null);
  assert.strictEqual(win.eval('MANUAL.editing'), true);
  assert.deepStrictEqual(norm(win.eval('uids()')), [106, 102, 101, 104, 103, 105], '最適化後の並びが崩れた');
  assert.ok(win.eval('SEEDOPT_RESULT') !== null, '最適化の結果 (プレビューの「被り回避最適化後」) を消している');
  assert.ok(/seed.core.s28|元に戻す/.test(win.document.getElementById('so-progress').textContent), '案内が出ていない');
  assert.deepStrictEqual(norm(win.eval('Array.from(manualMovedSet()).sort()')), [101, 102, 103, 104, 106]);
  // そこから続けて動かせる
  win.eval('manualPushOp(105, 0);');
  assert.deepStrictEqual(norm(win.eval('uids()')), [105, 106, 102, 101, 104, 103]);
  // 元に戻す 1 回 = 続けた移動、2 回 = 最適化前の手動順
  win.eval('MANUAL.hpos--;');
  assert.deepStrictEqual(norm(win.eval('uids()')), [106, 102, 101, 104, 103, 105]);
  win.eval('MANUAL.hpos--;');
  assert.deepStrictEqual(norm(win.eval('uids()')), [106, 101, 102, 103, 104, 105]);
  // 手動調整が無い状態で反映していたときは、最適化後の並びを基準にする
  win.eval('MANUAL = null; SEEDOPT_RESULT = { seedOrder: [103, 101, 102, 104, 105, 106] }; applySeedOptimize(); manualUnlock();');
  assert.deepStrictEqual(norm(win.eval('MANUAL.base')), [103, 101, 102, 104, 105, 106]);
  assert.deepStrictEqual(norm(win.eval('uids()')), [103, 101, 102, 104, 105, 106]);
});

test('シード適用前の自動被り回避: 反映した並びから手動調整を続けているときは回し直さない (2026-11-11)', () => {
  const ens = extractFn(HTML, 'ensureAutoOptimizeForUpload');
  assert.ok(/if \(S\.APPLIED_ORDER \|\| manualFromOptimized\(\)\) return true;/.test(ens), '手動調整を最適化で崩す');
  const f = extractFn(HTML, 'manualFromOptimized') + extractFn(HTML, 'manualSrc');
  const S = { MANUAL: { ops: [{ uid: 1, to: 0 }, { order: [2, 1], kind: 'opt' }, { uid: 2, to: 0 }], hpos: 3 } };
  const fn = new Function('S', f + '; return manualFromOptimized();');
  assert.strictEqual(fn(S), true);
  assert.strictEqual(fn({ MANUAL: { ops: S.MANUAL.ops, hpos: 1 } }), false, '元に戻したあとは回す');
  assert.strictEqual(fn({ MANUAL: { ops: S.MANUAL.ops.concat([{ order: [1, 2], kind: 'csv' }]), hpos: 4 } }), false, 'あとから CSV を読んだら回す');
  assert.strictEqual(fn({ MANUAL: null }), false);
});

test('jsdom: CSV の読み込み・初期状態に戻すは手動調整の 1 手 (元に戻すで戻る、2026-11-11)', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const dom = new JSDOM('<!DOCTYPE html><body><div id="so-report"></div><div id="so-progress"></div></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  win.eval(`
    var S = window;
    var DATA = [];
    var APPLIED_ORDER = null, PRE_OPT = null, SEEDOPT_RESULT = null, SEED_SPEC = null, MANUAL = null;
    var MANUAL_MAX_OPS = 100, currentMethod = 'ensemble';
    function i18n(k) { return k; }
    function escHtml(x) { return String(x); }
    function _projectSeedLocks(a) { return a; }
    function renderManualUI() {}
    function render() {}
    function saveManual() {}
    function showOptCancelBtn() {}
    function resetSeedOptResultPanel() { SEEDOPT_RESULT = null; }
    function dropAppliedOrder() { APPLIED_ORDER = null; PRE_OPT = null; }
    ${extractFn(HTML, 'manualApplyOp')}
    ${extractFn(HTML, 'manualOrder')}
    ${extractFn(HTML, 'orderedRecs')}
    ${extractFn(HTML, 'applySeedOptimize')}
    ${extractFn(HTML, 'manualPushOp')}
    ${extractFn(HTML, 'manualPushOrder')}
    ${extractFn(HTML, 'manualSrc')}
    ${extractFn(HTML, 'manualFromOptimized')}
    ${extractFn(HTML, 'initialOrder')}
    ${extractFn(HTML, 'manualResetToInitial')}
    ${extractFn(HTML, 'manualMovedSet')}
    function uids() { return orderedRecs().map(function (r) { return r.user_id; }); }
  `);
  for (let i = 1; i <= 5; i++) win.DATA.push({ user_id: 100 + i, display: 'P' + i, ranks: { ensemble: i } });
  const norm = (a) => Array.from(a);
  win.eval('MANUAL = { base: [101,102,103,104,105], ops: [], hpos: 0, committed: false, editing: true, sel: null }; manualPushOp(105, 0);');
  // 被り回避を反映中に CSV を読む: 反映中の並び → CSV の順の 2 手が積まれる
  win.eval('SEEDOPT_RESULT = { seedOrder: [105, 102, 101, 104, 103] }; applySeedOptimize(); manualPushOrder([103, 104, 105, 101, 102], "csv");');
  assert.strictEqual(win.eval('APPLIED_ORDER'), null);
  assert.deepStrictEqual(norm(win.eval('uids()')), [103, 104, 105, 101, 102]);
  assert.strictEqual(win.eval('manualSrc()'), 'csv');
  assert.strictEqual(win.eval('manualFromOptimized()'), false, 'CSV を読んだら適用前に被り回避を回す');
  win.eval('MANUAL.hpos--;');
  assert.deepStrictEqual(norm(win.eval('uids()')), [105, 102, 101, 104, 103], '元に戻すで被り回避の並びに戻らない');
  assert.strictEqual(win.eval('manualFromOptimized()'), true);
  win.eval('MANUAL.hpos++;');
  // 初期状態に戻す = 基準の順位順。これも元に戻せる
  win.eval('manualResetToInitial();');
  assert.deepStrictEqual(norm(win.eval('uids()')), [101, 102, 103, 104, 105]);
  assert.strictEqual(win.eval('manualSrc()'), 'reset');
  assert.strictEqual(win.eval('manualMovedSet().size'), 0, '初期状態に戻したのに移動の印が残っている');
  win.eval('manualPushOp(104, 0);');
  assert.deepStrictEqual(norm(win.eval('Array.from(manualMovedSet())')), [104], '戻したあとの移動だけ印を付ける');
  win.eval('MANUAL.hpos -= 2;');
  assert.deepStrictEqual(norm(win.eval('uids()')), [103, 104, 105, 101, 102]);
  assert.ok(win.eval('manualMovedSet().size') > 0, '元に戻したら印も戻る');
  // 手動調整が無いときの CSV は、これまでどおり CSV の順を基準にする (シードアップロード)
  win.eval('MANUAL = null; manualPushOrder([102, 101, 103, 104, 105], "csv");');
  assert.deepStrictEqual(norm(win.eval('MANUAL.base')), [102, 101, 103, 104, 105]);
  assert.strictEqual(win.eval('MANUAL.src'), 'csv');
  assert.strictEqual(win.eval('MANUAL.ops.length'), 0);
  assert.deepStrictEqual(norm(win.eval('initialOrder()')), [102, 101, 103, 104, 105], 'シードアップロードの初期状態は CSV の順');
});

test('CSV テンプレート: 表示言語の説明行 (##) と記入例、列の書き方の表 (2026-11-11)', () => {
  const vm = require('node:vm');
  const ja = {};
  const ctx = { window: {}, globalThis: {} };
  ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../site/i18n/ja.js'), 'utf8'), ctx);
  const dict = (ctx.SPSP_I18N && ctx.SPSP_I18N.ja) || ja;
  const src = `
    var CSV_COMMENT = '##';
    function i18n(k) { return DICT[k] || k; }
    function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    var _tplComment = (s) => CSV_COMMENT + ' ' + String(s).replace(/,/g, '、').replace(/"/g, '\\u201d');
    ${extractFn(HTML, 'csvTemplateLines')}
    ${extractFn(HTML, 'csvGuideHtml')}
  `;
  const c2 = { DICT: dict }; vm.createContext(c2); vm.runInContext(src, c2);
  for (const kind of ['spec', 'source']) {
    const lines = c2.csvTemplateLines(kind);
    const notes = lines.filter((l) => l.startsWith('## '));
    const rest = lines.filter((l) => !l.startsWith('## '));
    assert.ok(notes.length >= 8, '説明行が少ない');
    assert.ok(notes.every((l) => !l.includes(',') && !l.includes('"')), 'セルが割れる文字が説明行にある');
    assert.ok(notes.some((l) => l.includes('discriminator')) && notes.some((l) => l.includes('Shift_JIS')), notes.join('\n'));
    assert.strictEqual(rest[0], kind === 'spec' ? 'name,discriminator,seed,wave,lock' : 'name,discriminator,seed', '列名は英語のまま');
    assert.ok(rest[1].startsWith('山田太郎,="00000000"'), '日本語では日本語の記入例');
    assert.strictEqual(rest.length, kind === 'spec' ? 5 : 4);
    if (kind === 'spec') assert.ok(rest[4].includes('ノーシード') && rest[4].includes('山田太郎の逆'), rest[4]);
    const html = c2.csvGuideHtml(kind);
    for (const col of ['discriminator', 'uid', 'seedId', 'name', 'seed']) assert.ok(html.includes('>' + col + '<'), col);
    assert.strictEqual(html.includes('>lock<'), kind === 'spec');
    assert.ok(html.includes('start.gg/user/1a2b3c4d'));
  }
});

test('jsdom: 📌 指定 CSV の「ノーシード」と「◯◯の逆」(2026-11-11)', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const dom = new JSDOM('<!DOCTYPE html><body><input id="so-pools" value="4"><input id="so-waves" value="2"><div id="spec-status"></div><div id="status"></div></body>', { runScripts: 'outside-only' });
  const win = dom.window;
  const SO = require('../../site/seeding/seed_optimizer.js');
  win.SeedOptimizer = SO.default || SO;
  const constLine = (name) => HTML.match(new RegExp('(?:export )?const ' + name + ' = [^\\n]*'))[0].replace(/^(export )?const /, 'var ');
  win.eval(`
    var S = window;
    var DATA = [];
    var APPLIED_ORDER = null, PRE_OPT = null, SEEDOPT_RESULT = null, SEED_SPEC = null, MANUAL = null, EVENT_CONTEXT = null, DISCRIMINATORS = null;
    var pushed = null;
    function i18n(k, p) { return k + (p ? JSON.stringify(p) : ''); }
    function escHtml(x) { return String(x); }
    function _applyCsvSettingColumns() { return []; }
    function chunkWaveMap(P, W) { var m = []; for (var i = 0; i < P; i++) m.push(Math.floor(i * W / P)); return m; }
    function canonicalUserId(u) { return u; }
    function orderedRecs() { return pushed ? pushed.map(function (u) { return DATA.find(function (r) { return r.user_id === u; }); }) : DATA.slice(); }
    function manualPushOrder(order) { pushed = order.slice(); }
    function manualOrder() { return pushed.slice(); }
    function manualParseUid(k) { return Number(k); }
    function saveManual() {} function render() {} function resetSeedOptResultPanel() {} function dropAppliedOrder() {}
    function _specStatus(m) { document.getElementById('spec-status').innerHTML = m; }
    ${['CSV_NAME_COLS', 'CSV_SEAT_COLS', 'CSV_DISC_COLS', 'CSV_TPL_OUT_NAMES', 'CSV_TPL_NAMES', 'SPEC_WAVE_COLS', 'SPEC_FIX_COLS', 'WAVE_NONE_RE', 'WAVE_OPPOSITE_RE', 'NOSEED_RE', 'DQ_RE', 'CSV_NAME_COLS_SPEC'].map(constLine).join('\n')}
    ${['currentWaveMap', 'waveOrderReversed', 'interleaveWaveMap', 'waveLetter', '_csvNormName', '_csvNormDisc', '_csvPick', '_csvRecLookups', '_csvMatchRow', '_csvRowLabel', 'isCsvTemplateSample',
       'parseWaveValue', 'parseFixValue', 'parseWaveOpposite', 'oppositeWave', '_specRefKey', 'buildSpecOrder', 'applySpecRows'].map((n) => extractFn(HTML, n)).join('\n')}
  `);
  // 16 人・4 プール・2 ウェーブ (既定は交互: プール 1 = A, 2 = B, 3 = B, 4 = A)。discriminator は d01〜d16
  for (let i = 1; i <= 16; i++) win.DATA.push({ user_id: i, display: 'P' + i, discriminator: ('0000000' + i.toString(16)).slice(-8).replace(/^0/, 'a'), ranks: { ensemble: i } });
  const disc = (i) => win.DATA[i - 1].discriminator;
  const waveOfSeat = (s) => win.eval('interleaveWaveMap(4, 2)')[win.SeedOptimizer.poolOfSeed(s, 4)];
  // ウェーブの並び (so-wave-order、2026-11-12): 逆から = シード 1 のプールから B, A, A, B
  assert.deepStrictEqual(Array.from(win.eval('currentWaveMap(4)')), [0, 1, 1, 0]);
  const orderSel = win.document.createElement('select');
  orderSel.id = 'so-wave-order';
  orderSel.innerHTML = '<option value=""></option><option value="rev"></option>';
  win.document.body.appendChild(orderSel);
  orderSel.value = 'rev';
  assert.deepStrictEqual(Array.from(win.eval('currentWaveMap(4)')), [1, 0, 0, 1]);
  orderSel.remove();
  win.applySpecRows([
    { name: 'P3', discriminator: disc(3), seed: 'ノーシード', wave: '', lock: '' },
    { name: 'P5', discriminator: disc(5), seed: 'noseed', wave: '', lock: '' },
    { name: 'Saboten', discriminator: disc(2), seed: '', wave: '指定不可', lock: '' },   // 指定不可: 警告なしで指定しない
    { name: 'P7', discriminator: disc(7), seed: '', wave: 'Saboten の逆', lock: '' },  // CSV の name で参照
    { name: 'P9', discriminator: disc(9), seed: '', wave: 'B', lock: 'wave' },
    { name: 'P10', discriminator: disc(10), seed: '', wave: 'P9の逆', lock: '' },     // 参照先がウェーブ指定あり → その逆
    { name: 'P11', discriminator: disc(11), seed: '', wave: 'どっちでも', lock: '' },
  ], 'test.csv');
  const order = Array.from(win.eval('pushed'));
  const st = win.document.getElementById('spec-status').innerHTML;
  assert.deepStrictEqual(order.slice(-2), [3, 5], 'ノーシードは最後尾: ' + order.join(','));
  assert.ok(!/⚠/.test(st), '指定不可・どっちでもに警告を出している: ' + st);
  // Saboten (uid 2) は既定の位置 (seed 2) に固定、P7 はその逆のウェーブ
  assert.strictEqual(order.indexOf(2), 1, 'Saboten は既定のシード 2 に固定');
  assert.notStrictEqual(waveOfSeat(order.indexOf(7)), waveOfSeat(1), 'P7 が Saboten と同じウェーブ');
  // P10 は P9 (B) の逆 = A
  assert.strictEqual(waveOfSeat(order.indexOf(9)), 1);
  assert.strictEqual(waveOfSeat(order.indexOf(10)), 0);
  const spec = win.eval('SEED_SPEC');
  assert.strictEqual(spec.locks[2].kind, 'wave', 'Saboten をウェーブで固定していない');
  assert.strictEqual(spec.locks[7].kind, 'wave');
  assert.strictEqual(spec.locks[10].kind, 'wave');
  assert.ok(/ノーシード 2 人/.test(st), st);
  assert.deepStrictEqual(order.slice().sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i + 1));
  // ノーシード + ウェーブ指定 / ノーシード + 「◯◯の逆」(2026-11-12): ウェーブを優先して、そのウェーブでいちばん低いシード
  win.eval('pushed = null; SEED_SPEC = null;');
  win.applySpecRows([
    { name: 'P4', discriminator: disc(4), seed: 'ノーシード', wave: 'A', lock: 'wave' },
    { name: 'P6', discriminator: disc(6), seed: 'ノーシード', wave: 'P4の逆', lock: '' },
    { name: 'P8', discriminator: disc(8), seed: 'ノーシード', wave: '', lock: '' },
  ], 'test.csv');
  const orderN = Array.from(win.eval('pushed'));
  const lowestOf = (w) => Math.max(...orderN.map((_, k) => k).filter((k) => waveOfSeat(k) === w));
  assert.strictEqual(orderN.indexOf(4), lowestOf(0), 'P4 (ノーシード・A) が A のいちばん下でない: ' + orderN.join(','));
  assert.strictEqual(orderN.indexOf(6), lowestOf(1), 'P6 (ノーシード・P4 の逆 = B) が B のいちばん下でない: ' + orderN.join(','));
  assert.ok(orderN.indexOf(8) >= 13, 'ウェーブ指定の無いノーシードは残りの最後尾: ' + orderN.join(','));
  assert.strictEqual(win.eval('SEED_SPEC').locks[4].kind, 'wave');
  assert.strictEqual(win.eval('SEED_SPEC').locks[6].kind, 'wave');
  assert.ok(!/⚠/.test(win.document.getElementById('spec-status').innerHTML), win.document.getElementById('spec-status').innerHTML);
  // seed 列の「DQ」(2026-11-12): ノーシードより下 = いちばん下に置き、固定の種類 dq を付ける。ウェーブ・lock 列は見ない
  win.eval('pushed = null; SEED_SPEC = null;');
  win.applySpecRows([
    { name: 'P4', discriminator: disc(4), seed: 'ノーシード', wave: '', lock: '' },
    { name: 'P6', discriminator: disc(6), seed: 'DQ', wave: 'A', lock: 'wave' },
    { name: 'P2', discriminator: disc(2), seed: 'dq', wave: '', lock: '' },
  ], 'test.csv');
  const orderD = Array.from(win.eval('pushed'));
  assert.deepStrictEqual(orderD.slice(-3), [4, 2, 6], 'DQ はノーシードより下: ' + orderD.join(','));
  assert.deepStrictEqual([win.eval('SEED_SPEC').locks[6], win.eval('SEED_SPEC').locks[2]].map((l) => [l.kind, l.target]), [['dq', null], ['dq', null]]);
  assert.strictEqual(win.eval('SEED_SPEC').locks[4], undefined);
  const stD = win.document.getElementById('spec-status').innerHTML;
  assert.ok(/DQ 2 人/.test(stD) && !/⚠/.test(stD), stD);
  // ウェーブ数を入れ忘れた (1 のまま): ノーシードは効き、ウェーブはまとめて案内する。注意は省略しない
  win.document.getElementById('so-waves').value = '1';
  win.eval('pushed = null;');
  win.applySpecRows([
    { name: 'P3', discriminator: disc(3), seed: 'ノーシード', wave: '', lock: '' },
    ...[9, 10, 11, 12, 13, 14, 15, 16, 4, 6].map((k) => ({ name: 'P' + k, discriminator: disc(k), seed: '', wave: 'B', lock: 'wave' })),
  ], 'test2.csv');
  const st2 = win.document.getElementById('spec-status').innerHTML;
  assert.ok(/ウェーブ数が 1 なので、ウェーブの指定 10 件/.test(st2), st2);
  assert.ok(!/順位が不正/.test(st2), 'ノーシードが順位の不正になっている');
  assert.ok(!/…/.test(st2) && (st2.match(/⚠/g) || []).length >= 11, '注意を省略している: ' + st2);
  assert.strictEqual(Array.from(win.eval('pushed')).slice(-1)[0], 3);
});
