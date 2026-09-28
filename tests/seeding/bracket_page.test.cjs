'use strict';
// site/bracket/ (トーナメントプレビュー) の JS↔HTML 静的整合チェック。
//   - bracket_app.js が参照する id がすべて index.html に存在するか
//   - HTML 上の bp-* id が JS から参照されているか (孤立要素なし)
//   - 依存スクリプトの読み込み順 (optimizer/data/share/core → app)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.resolve(__dirname, '../../site/bracket');
const HTML = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const JS = fs.readFileSync(path.join(DIR, 'bracket_app.js'), 'utf8');

function htmlIds() {
  const ids = new Set();
  const re = /\bid="([^"]+)"/g; let m;
  while ((m = re.exec(HTML))) ids.add(m[1]);
  return ids;
}
function jsReferencedIds() {
  const ids = new Set();
  // $('bp-xxx') / getElementById('bp-xxx')
  const re = /\$\(\s*'([^']+)'\s*\)|getElementById\(\s*'([^']+)'\s*\)/g; let m;
  while ((m = re.exec(JS))) ids.add(m[1] || m[2]);
  return ids;
}

test('bracket_app.js が参照する id はすべて index.html に存在する', () => {
  const defined = htmlIds();
  const refd = [...jsReferencedIds()].filter((x) => x.startsWith('bp-'));
  assert.ok(refd.length >= 15, 'bp-* の参照が想定より少ない: ' + refd.length);
  for (const id of refd) assert.ok(defined.has(id), `JS が参照する id "${id}" が HTML に無い`);
});

test('HTML の bp-* id はすべて JS から参照される (孤立要素なし)', () => {
  const refd = jsReferencedIds();
  // コンテナ用 (スタイルのみで JS から触らない) の許容リスト
  const allow = new Set(['bp-root', 'bp-phase-editor']);
  const defined = [...htmlIds()].filter((x) => x.startsWith('bp-') && !allow.has(x));
  assert.ok(defined.length >= 15);
  for (const id of defined) assert.ok(refd.has(id), `HTML の id "${id}" が JS から参照されていない`);
});

test('依存スクリプトの読み込み順が正しい', () => {
  // HTML はデータ script 3 本 + assets/bracket.js。モジュールの並びは src/pages/bracket.js の import (ビルドが結合)
  const { pageImports } = require('../helpers/pages.cjs');
  const htmlOrder = [...HTML.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(htmlOrder, ['../region/config.js', '../i18n/ja.js', '../region/i18n.js', '../assets/bracket.js']);
  const order = pageImports('bracket').map((s) => s.startsWith('bracket/') ? s.slice('bracket/'.length) : '../' + s);
  assert.deepStrictEqual(order, [
    '../js/html.js',
    '../js/i18n.js',
    '../js/data.js',
    '../js/player_data.js',
    '../seeding/seed_optimizer.js',
    '../seeding/seed_data.js',
    '../seeding/seed_share.js',
    'bracket_core.js',
    'bracket_app.js',
  ]);
  for (const src of order) {
    const p = path.resolve(DIR, src);
    assert.ok(fs.existsSync(p), `スクリプトが存在しない: ${src}`);
  }
});

test('app は SeedShare/BracketCore/SeedData の API を使う (結合の実在確認)', () => {
  for (const needle of [
    'SeedShare', 'BracketCore', 'SeedData',
    '.decodePayload', '.encodePayload', '.parseFragment', '.buildFragment',
    '.phasePools', '.poolDoubleElim', '.buildSeedData', '.pairKey',
    'history.replaceState', 'workCsvToPayload', 'buildWorkCsv', 'phaseEntrantCounts',
  ]) {
    assert.ok(JS.includes(needle), `bracket_app.js に ${needle} が見当たらない`);
  }
});

test('プレイヤーページへのリンク形式は ../p/?uid=', () => {
  assert.ok(JS.includes('${SPSP.langRoot}p/?uid='), 'プレイヤーページリンクが無い/形式が違う (SPSP.langRoot + p/?uid= の形)');
});

// ── 発行側 (seed_app.js) の配線 ───────────────────────────
const { pageFile, pageImports } = require('../helpers/pages.cjs');
const SEED_HTML = pageFile('seed');            // 読み込む script の並びは src/pages/seed.js の import
const UPLOAD_HTML = pageFile('seed_upload');
const APP_JS = require('./helpers/seed_app_src.cjs').SRC;   // seeding/app/*.js を並び順に連結 (旧 seed_app.js)

test('シード両ページが seed_share.js を読み込む', () => {
  for (const [name, html] of [['seed', SEED_HTML], ['seed-upload', UPLOAD_HTML]]) {
    const imports = pageImports(name === 'seed' ? 'seed' : 'seed_upload');
    assert.ok(imports.includes('seeding/seed_share.js'), `src/pages/${name}: seed_share.js を import していない`);
    // seed_app.js より前に読み込まれること
    assert.ok(imports.indexOf('seeding/seed_share.js') < imports.findIndex((x) => x.startsWith('seeding/app/')),
      `${name}: seed_share.js はシードツール本体 (seeding/app/*.js) より前に読むこと`);
  }
});

test('seed_app.js: プレビューボタンが定義され issueBracketPreview に配線されている', () => {
  assert.ok(APP_JS.includes('id="bracket-preview"'), 'ボタンがスケルトンに無い');
  assert.ok(/function issueBracketPreview\(/.test(APP_JS), 'issueBracketPreview 未定義');
  assert.ok(/getElementById\('bracket-preview'\)/.test(APP_JS), 'ボタンの参照が無い');
  assert.ok(/addEventListener\('click',\s*issueBracketPreview\)/.test(APP_JS), 'クリック配線が無い');
});

test('issueBracketPreview は orderedRecs / currentWaveMap / SeedShare を使い bracket へ誘導する', () => {
  const block = APP_JS.slice(APP_JS.indexOf('function issueBracketPreview'), APP_JS.indexOf('function clearSeedSpec'));
  for (const needle of ['orderedRecs()', 'currentWaveMap(P', 'SeedShare.encodePayload', 'SeedShare.buildFragment', "SPSP.langRoot + 'bracket/'", 'MASTER_MAP']) {
    assert.ok(block.includes(needle), `issueBracketPreview に ${needle} が無い`);
  }
});

// ── 発行側の実挙動 (実ソースを抽出して実行) ────────────────
// 名前の同梱方針だけは静的チェックでは守れない (プレビュー側が players/<uid>.json を
// 取れないと名前が一切出なくなる、という壊れ方をするため) ので実際に走らせて確かめる。
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }
const SHARE = ((m) => m.default || m)(require('../../site/seeding/seed_share.js'));

function extractFn(src, name) {
  let sig = src.indexOf('async function ' + name + '(');
  if (sig < 0) sig = src.indexOf('function ' + name + '(');
  assert.ok(sig >= 0, 'not found: ' + name);
  const braceStart = src.indexOf('{', sig);
  let depth = 0, i = braceStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(sig, i);
}

// recs = [{user_id, display}]。user_id が正で inMaster に居れば「DB 登録者」扱い。
async function runIssuePreview(recs, pools) {
  const dom = new JSDOM('<div id="work-note"></div><input id="so-pools">', {
    runScripts: 'outside-only',
    url: 'https://spsp.example/seed/',
  });
  const win = dom.window;
  for (const k of ['CompressionStream', 'DecompressionStream', 'Blob', 'Response', 'TextEncoder', 'TextDecoder']) {
    win[k] = globalThis[k];
  }
  win.document.getElementById('so-pools').value = String(pools);
  let opened = null;
  win.open = (u) => { opened = u; return null; };
  win.SeedShare = SHARE;
  win.DATA = recs;
  win.MASTER_MAP = new Map(recs.filter((r) => r.inMaster).map((r) => [r.user_id, r]));
  win.orderedRecs = () => recs;
  win.currentWaveMap = (P) => SHARE.chunkWaveMap(P, 1);
  win.EVENT_CONTEXT = { eventName: 'テスト大会' };
  win.CSV_SOURCE = null;
  win.SEED_APP_CONFIG = { mode: 'spsp' };
  // 文言辞書 (i18n('…') を本物の辞書で引く)
  for (const f of ['region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js']) win.eval(require('../helpers/built.cjs').built(f));
  win.eval('var i18n = SPSPI18n.t; var S = window;');   // S = 共有状態 (テストではグローバルそのもの)
  // 実ソースの定数と関数本体をそのまま動かす (const は eval のスコープに閉じるので var で渡す)
  const budget = APP_JS.match(/const BRACKET_URL_BUDGET = (\d+);/);
  assert.ok(budget, 'BRACKET_URL_BUDGET が定義されていない');
  win.eval(`var BRACKET_URL_BUDGET = ${budget[1]};\n` + extractFn(APP_JS, 'issueBracketPreview'));
  await win.issueBracketPreview();
  assert.ok(opened, 'プレビューが開かれていない: ' + win.document.getElementById('work-note').textContent);
  const blob = new win.URL(opened).hash.match(/[#&]d=([^&]+)/)[1];
  return {
    payload: await SHARE.decodePayload(blob),
    url: opened,
    note: win.document.getElementById('work-note').textContent,
  };
}

const skipJsdom = !JSDOM ? 'jsdom 未導入' : false;

test('発行: 小規模なら全員の名前を URL に載せる (選手JSONが取れなくても名前が出る)', { skip: skipJsdom }, async () => {
  const recs = Array.from({ length: 32 }, (_, i) => ({ user_id: 1000 + i, display: '選手' + i, inMaster: true }));
  recs[5].inMaster = false;                       // DB 未登録
  recs[6] = { user_id: null, display: '手入力の人' };   // uid なし
  const { payload, url } = await runIssuePreview(recs, 4);
  assert.strictEqual(Object.keys(payload.names).length, 32, '全員分の名前が入っていない');
  assert.strictEqual(payload.names['0'], '選手0');
  assert.strictEqual(payload.names['6'], '手入力の人');
  assert.strictEqual(payload.uids[6], null);
  assert.ok(url.length < 9500, 'URL: ' + url.length);
});

test('発行: URL が長くなる規模では DB 未登録者の名前だけに落とす', { skip: skipJsdom }, async () => {
  const recs = Array.from({ length: 2048 }, (_, i) => ({
    user_id: 1000 + i, display: 'ながい名前のプレイヤー' + i, inMaster: i % 100 !== 0,
  }));
  const { payload, note } = await runIssuePreview(recs, 128);
  const keys = Object.keys(payload.names);
  assert.strictEqual(keys.length, 21, '未登録者だけになっていない: ' + keys.length);
  assert.ok(keys.every((k) => Number(k) % 100 === 0), keys.slice(0, 5).join(','));
  assert.ok(note.includes('未登録者の名前だけ'), note);
});

test('発行: 表示名が空の登録者は名前を載せない (uid から復元させる)', { skip: skipJsdom }, async () => {
  const recs = Array.from({ length: 8 }, (_, i) => ({ user_id: 1000 + i, display: '選手' + i, inMaster: true }));
  recs[3].display = '';
  const { payload } = await runIssuePreview(recs, 1);
  assert.ok(!('3' in payload.names), '空の表示名を載せている');
  assert.ok(!/uid:/.test(JSON.stringify(payload.names)), '"uid:xxxx" を名前として載せている');
});

test('発行: プールが2つ以上なら次フェーズまで作る', { skip: skipJsdom }, async () => {
  const recs = Array.from({ length: 64 }, (_, i) => ({ user_id: 1000 + i, display: '選手' + i, inMaster: true }));
  const { payload } = await runIssuePreview(recs, 8);
  assert.strictEqual(payload.phases.length, 2, JSON.stringify(payload.phases));
  assert.strictEqual(payload.phases[0].pools, 8);
  assert.strictEqual(payload.phases[1].pools, 1);
  assert.strictEqual(payload.phases[1].adv, 0);
  assert.deepStrictEqual(SHARE.validatePhases(payload.phases, 64), []);
  // 1プールなら単一フェーズのまま
  const one = await runIssuePreview(recs, 1);
  assert.strictEqual(one.payload.phases.length, 1);
});

// ── CSS の詳細度 (カスケードで消えると気付きにくい) ────────────
const CSS = fs.readFileSync(path.join(DIR, 'bracket_app.css'), 'utf8');

// セレクタの詳細度 (id, class/attr/pseudo-class, element)
function specificity(sel) {
  const s = sel.trim();
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  return ids * 100 + cls * 10;
}
function rulesFor(prop, needle) {
  return [...CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => new RegExp('(^|;)\\s*' + prop + '\\s*:').test(m[2]))
    .flatMap((m) => m[1].split(',').map((sel) => sel.trim()))
    .filter((sel) => needle.every((n) => sel.includes(n)));
}

test('ハイライトは敗者側の勝ち上がりの塗りに負けない (詳細度)', () => {
  // 敗者側で勝ち上がった枠を選んだとき、.bp-hi の見た目が .bp-win に打ち消されないこと
  for (const prop of ['background', 'box-shadow']) {
    const winRules = rulesFor(prop, ['.bp-lb', '.bp-win']);
    const hiRules = rulesFor(prop, ['.bp-hi']);
    assert.ok(winRules.length, `${prop}: 敗者側の勝ち上がり指定が見つからない`);
    assert.ok(hiRules.length, `${prop}: ハイライト指定が見つからない`);
    const maxWin = Math.max(...winRules.map(specificity));
    const maxHi = Math.max(...hiRules.map(specificity));
    assert.ok(maxHi >= maxWin,
      `${prop}: ハイライト (${maxHi}) が敗者側の勝ち上がり (${maxWin}) に負けている\n` +
      `  win: ${winRules.join(' , ')}\n  hi : ${hiRules.join(' , ')}`);
  }
  // 色そのものも別 (同じ塗りだと選んでも変化が見えない)
  const bg = (needle) => (CSS.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{[^}]*background:\\s*([^;}]+)')) || [])[1];
  assert.notStrictEqual((bg('.bp-lb .bp-slot.bp-win') || '').trim(), (bg('.bp-match .bp-slot.bp-hi') || '').trim(),
    'ハイライトと敗者側の勝ち上がりが同じ塗り');
});

// ── 被り回避の反映がプレビューに乗ること ────────────────────
// 「最適化したのにプレビューが元の並びのまま」を防ぐ (2026-08-14)。
// ここだけは orderedRecs をスタブせず実ソースを使う (= 反映を見ているのはそこ)。
test('発行: 被り回避を反映した順序でプレビューが出る', { skip: skipJsdom }, async () => {
  const dom = new JSDOM('<div id="work-note"></div><input id="so-pools">', {
    runScripts: 'outside-only', url: 'https://spsp.example/seed/',
  });
  const win = dom.window;
  for (const k of ['CompressionStream', 'DecompressionStream', 'Blob', 'Response', 'TextEncoder', 'TextDecoder']) {
    win[k] = globalThis[k];
  }
  win.document.getElementById('so-pools').value = '2';
  let opened = null;
  win.open = (u) => { opened = u; return null; };
  win.SeedShare = SHARE;
  const recs = Array.from({ length: 8 }, (_, i) => ({
    user_id: 101 + i, display: 'P' + (i + 1), inMaster: true, ranks: { ensemble: i + 1 },
  }));
  win.DATA = recs;
  win.MASTER_MAP = new Map(recs.map((r) => [r.user_id, r]));
  win.currentWaveMap = (P) => SHARE.chunkWaveMap(P, 1);
  win.EVENT_CONTEXT = { eventName: 'テスト大会' };
  win.CSV_SOURCE = null;
  win.SEED_APP_CONFIG = { mode: 'spsp' };
  for (const f of ['region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js']) win.eval(require('../helpers/built.cjs').built(f));
  win.eval('var i18n = SPSPI18n.t; var S = window;');   // S = 共有状態 (テストではグローバルそのもの)
  const budget = APP_JS.match(/const BRACKET_URL_BUDGET = (\d+);/);
  win.eval(`
    var BRACKET_URL_BUDGET = ${budget[1]};
    var currentMethod = 'ensemble';
    var MANUAL = null, SEED_SPEC = null, APPLIED_ORDER = null;
    function _projectSeedLocks(a) { return a; }
    function manualOrder() { return []; }
    ${extractFn(APP_JS, 'orderedRecs')}
    ${extractFn(APP_JS, 'issueBracketPreview')}
  `);

  // 反映前 = ensemble 順
  await win.issueBracketPreview();
  const before = await SHARE.decodePayload(new win.URL(opened).hash.match(/[#&]d=([^&]+)/)[1]);
  assert.deepStrictEqual(Array.from(before.uids), [101, 102, 103, 104, 105, 106, 107, 108]);

  // 被り回避を反映した状態で発行すると、その並びで出る
  win.eval('APPLIED_ORDER = [108, 101, 106, 103, 104, 105, 102, 107];');
  await win.issueBracketPreview();
  const after = await SHARE.decodePayload(new win.URL(opened).hash.match(/[#&]d=([^&]+)/)[1]);
  assert.deepStrictEqual(Array.from(after.uids), [108, 101, 106, 103, 104, 105, 102, 107],
    'プレビューが被り回避の順序になっていない');
  // 名前も並べ替え後の位置に付く (プレビュー側は index で引くため)
  assert.strictEqual(after.names['0'], 'P8');
});

test('seed_app.js: 最適化は完了時に自動で反映され、取り消しボタンが配線されている', () => {
  const finish = APP_JS.slice(APP_JS.indexOf('function finishSeedOptimize('),
                              APP_JS.indexOf('function applySeedOptimize('));
  assert.ok(/applySeedOptimize\(\)/.test(finish),
    '最適化の完了で自動反映していない (押し忘れでプレビューが元の並びになる)');
  assert.ok(/id="so-cancel"/.test(APP_JS), '取り消しボタンが無い');
  assert.ok(/getElementById\('so-cancel'\)\.addEventListener\('click', cancelSeedOptimize\)/.test(APP_JS),
    '取り消しボタンが配線されていない');
  assert.ok(/function cancelSeedOptimize\(/.test(APP_JS), 'cancelSeedOptimize が無い');
  // 紛らわしかった緑の「この結果を適用」は廃止 (start.gg 適用と読み違えるため)
  assert.ok(!/so-apply/.test(APP_JS), '旧「この結果を適用」ボタンの参照が残っている');
  assert.ok(!/この結果を適用/.test(APP_JS), '旧ラベルが残っている');
});

test('seed_app.js: start.gg への適用ボタンは赤で、そうと分かる名前になっている', () => {
  const btn = APP_JS.match(/<button id="upload-btn"[^>]*>([^<]*)<\/button>/);
  assert.ok(btn, 'upload-btn が無い');
  assert.match(btn[1], /start\.gg/, 'start.gg への適用と分かる名前になっていない');
  assert.match(btn[0], /background:#b91c1c/, '赤ボタンになっていない');
});

test('データ版: ヘッダに表示欄があり、描画で埋まる配線がある', () => {
  assert.ok(/id="bp-version"/.test(HTML), 'bp-version の表示欄が無い');
  assert.ok(/function renderVersion\(/.test(JS), 'renderVersion が無い');
  assert.ok(/renderVersion\(\);/.test(JS), 'renderAll から呼ばれていない');
  assert.ok(/S\.payloadVersion\(STATE\.payload\)/.test(JS), '共有コーデックの版を使っていない');
  // 見る側の状態 (view) から作っていないこと = STATE.view を版の計算に混ぜない。
  const fn = JS.slice(JS.indexOf('function renderVersion('), JS.indexOf('function renderAll('));
  assert.ok(!/STATE\.view/.test(fn), '見る側の状態が版に混ざっている');
  const css = fs.readFileSync(path.join(DIR, 'bracket_app.css'), 'utf8');
  assert.ok(/\.bp-version/.test(css), 'CSS が無い');
});
