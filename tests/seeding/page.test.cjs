'use strict';
// seed ページの JS↔HTML 整合チェック（ブラウザを使わず静的に検証）。
//   - 新規パネルの getElementById('so-*' / 'seedopt-panel') が HTML に存在するか。
//   - 逆に HTML 上の so-* / seedopt-panel が JS から参照されているか。
//   - orderedRecs / 被り回避関数が定義され、CSV/upload から使われているか。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// シードツールは seed/index.html (spsp) + seed-upload/index.html (csv) + 共有 seed_app.js に
// 分割されている。整合チェックは連結ソースに対して行う。
const HTML = fs.readFileSync(path.resolve(__dirname, '../../site/seed/index.html'), 'utf8')
  + fs.readFileSync(path.resolve(__dirname, '../../site/seed-upload/index.html'), 'utf8')
  + require('./helpers/seed_app_src.cjs').SRC;   // seeding/app/*.js を並び順に連結 (旧 seed_app.js)

function definedIds() {
  const ids = new Set();
  const re = /\bid="([^"]+)"/g; let m;
  while ((m = re.exec(HTML))) ids.add(m[1]);
  return ids;
}
function referencedIds() {
  const ids = new Set();
  const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g; let m;
  while ((m = re.exec(HTML))) ids.add(m[1]);
  // so-* / seedopt-panel はヘルパ(csvNums 等)に文字列で渡される場合もあるため、
  // クォートされた so-… / seedopt-panel リテラルも参照とみなす。
  const re2 = /['"](so-[\w-]+|seedopt-panel)['"]/g;
  while ((m = re2.exec(HTML))) ids.add(m[1]);
  return ids;
}

test('新パネルの参照 id がすべて HTML に存在する', () => {
  const defined = definedIds();
  const refd = referencedIds();
  const newRefs = [...refd].filter((x) => x.startsWith('so-') || x === 'seedopt-panel');
  assert.ok(newRefs.length >= 8, '新 id 参照が想定より少ない: ' + newRefs.length);
  for (const id of newRefs) {
    assert.ok(defined.has(id), `JS が参照する id "${id}" が HTML に無い`);
  }
});

test('HTML の so-* / seedopt-panel id がすべて JS から参照される（孤立要素なし）', () => {
  const defined = definedIds();
  const refd = referencedIds();
  const newDefs = [...defined].filter((x) => x.startsWith('so-') || x === 'seedopt-panel');
  assert.ok(newDefs.length >= 8);
  for (const id of newDefs) {
    assert.ok(refd.has(id), `HTML の id "${id}" が JS から参照されていない`);
  }
});

test('orderedRecs が定義され downloadCsv / uploadToStartgg から使われる', () => {
  assert.ok(/function orderedRecs\(\)/.test(HTML), 'orderedRecs 未定義');
  // 旧来の DATA.slice().sort(...) 直書きが CSV/upload に残っていない
  const csvBlock = HTML.slice(HTML.indexOf('function downloadCsv'), HTML.indexOf('function uploadToStartgg'));
  const upBlock = HTML.slice(HTML.indexOf('function uploadToStartgg'), HTML.indexOf('UPSERT_PHASE_MUTATION'));
  assert.ok(/const recs = orderedRecs\(\)/.test(csvBlock), 'downloadCsv が orderedRecs を使っていない');
  assert.ok(/const recs = orderedRecs\(\)/.test(upBlock), 'uploadToStartgg が orderedRecs を使っていない');
});

test('被り回避の主要関数が定義されている', () => {
  for (const fn of ['runSeedOptimize', 'stopSeedOptimize', 'applySeedOptimize',
    'finishSeedOptimize', 'initSeedOptPanel', 'clearSeedOptApplied']) {
    assert.ok(new RegExp('function ' + fn + '\\b').test(HTML), `${fn} 未定義`);
  }
});

test('モジュール script が読み込まれ Worker パスが正しい', () => {
  assert.ok(require('../helpers/pages.cjs').pageImports('seed').includes('seeding/seed_data.js'), 'seed_data.js 未読込 (src/pages/seed.js の import)');
  assert.ok(/new Worker\(SPSP\.root \+ 'assets\/seed_worker\.js'\)/.test(HTML), 'Worker パスが不正 (SPSP.root + assets/seed_worker.js の形)');
});

test('被り回避の反映は新規取得・method変更でリセットされる', () => {
  // performSeedFetch / performEntrantsFetch / method-tabs などで dropAppliedOrder() を呼ぶ。
  // (APPLIED_ORDER への直接代入は宣言・dropAppliedOrder・cancelSeedOptimize の 3 箇所だけ)
  const drops = (HTML.match(/dropAppliedOrder\(/g) || []).length;
  assert.ok(drops >= 7, `dropAppliedOrder の呼び出しが不足: ${drops}`);
  const assigns = (HTML.match(/APPLIED_ORDER = (null|\[)/g) || []).length;
  assert.ok(assigns <= 3, `APPLIED_ORDER への直接代入が増えている (${assigns})。解除は dropAppliedOrder に寄せること`);
});

test('user_merges: canonicalUserId が定義され entrant/seed parse の両方で適用される', () => {
  assert.ok(/function canonicalUserId\(/.test(HTML), 'canonicalUserId 未定義');
  assert.ok(/fetch\(SPSP\.data \+ 'data\/user_merges\.json'/.test(HTML),
    'loadMasterData が user_merges.json を取得していない');
  assert.ok(/user_merges\.json 取得失敗/.test(HTML),
    'user_merges.json 取得失敗時に throw していない');
  // entrantNodeToInfo / seedNodeToInfo の両方で userId が正規化されること
  const uses = (HTML.match(/userId: canonicalUserId\(uid\)/g) || []).length;
  assert.strictEqual(uses, 2,
    `canonicalUserId 適用箇所が ${uses} 箇所 (entrantNodeToInfo / seedNodeToInfo の 2 箇所必要)`);
});

test('user_merges: site/data/user_merges.json が存在し old→new 形式', (t) => {
  // ビルドの生成物 (nightly が site/data に書く)。ビルド出力が無い環境 (CI、素の checkout) では skip
  const p = path.resolve(__dirname, '../../site/data/user_merges.json');
  if (!fs.existsSync(p)) return t.skip('site/data/user_merges.json が無い (ビルド出力)');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const [k, v] of Object.entries(m)) {
    assert.ok(/^\d+$/.test(k), `key が uid 文字列でない: ${k}`);
    assert.ok(Number.isInteger(v), `value が uid 整数でない: ${v}`);
    assert.ok(!(String(v) in m), `連鎖が未解決: ${k} → ${v} → ${m[String(v)]}`);
  }
});

test('順位比較レポート: DE 想定順位列が描画される', () => {
  assert.ok(/DE想定順位/.test(HTML), 'DE想定順位 列がない');
  assert.ok(/SeedOptimizer\.dePlaceOfSeed\(/.test(HTML), 'dePlaceOfSeed を参照していない');
  assert.ok(/DE 想定順位が変わるのは/.test(HTML), 'サマリ行に DE 想定順位の変化人数がない');
});

test('新オプション: トーナメント順位固定 / 平日大会を含む のチェックボックスと配線が存在する', () => {
  assert.ok(/id="so-keep-deplace" checked/.test(HTML), 'so-keep-deplace が無い/既定ONでない');
  // 「平日大会を含む」は既定OFF (= 既定で平日を除外)。反転で excludeWeekday に配線。
  assert.ok(/id="so-include-weekday"(?! checked)/.test(HTML), 'so-include-weekday が無い/既定OFFでない');
  assert.ok(/excludeWeekday = !document\.getElementById\('so-include-weekday'\)\.checked/.test(HTML),
    '平日大会を含む の反転配線が無い');
  // DE想定順位列: 不変時は「N位」のみ表示（「のまま」は書かない）。
  assert.ok(!/位のまま/.test(HTML), '「位のまま」表記が残っている');
  // worker params へ keepDePlace、buildSeedData の dataParams へ excludeWeekday が渡る。
  assert.ok(/avoidRegion, avoidRecent, enableIntra, keepDePlace,/.test(HTML), 'params.keepDePlace の配線が無い');
  assert.ok(/sizeWeight, recentAgg, excludeWeekday/.test(HTML), 'dataParams.excludeWeekday の配線が無い');
  // 除外した試合数を UI に明示する（黙って間引かない方針）。
  assert.ok(/weekdayExcludedMatches/.test(HTML), '平日除外件数の表示が無い');
});

test('順位比較テーブル: プール内順位の変動列がある（移動者のみ矢印・定常表示なし）', () => {
  assert.ok(/>プール内順位<\/th>/.test(HTML), 'プール内順位列が無い');
  assert.ok(/SeedOptimizer\.rowOfSeed/.test(HTML), 'rowOfSeed（プール内順位の導出）参照が無い');
  assert.ok(/プール内順位が変わるのは \$\{prMoved\}名/.test(HTML), 'サマリ行にプール内順位の変動数が無い');
  // 表記は数値のみ: 不変はグレー数値、変動は「◯ → ◯」矢印（「位」「番手」は書かない）。
  assert.ok(/9ca3af">\$\{r\.newPr\}</.test(HTML), '不変者のプール内順位（グレー数値）が無い');
  assert.ok(/\$\{r\.origPr\} → \$\{r\.newPr\}</.test(HTML), '変動時の ◯ → ◯ 矢印が無い');
  assert.ok(!/番手</.test(HTML), '「番手」表記が残っている');
  assert.ok(!/\$\{r\.newDe\}位|\$\{r\.origDe\}位/.test(HTML), 'DE想定順位に「位」表記が残っている');
});

test('直近対戦レポート: ペアをタップで対戦履歴（日付・大会名・規模）を展開', () => {
  // 履歴 1 行の描画は histLine に切り出してある（recentCell / postRecentCell で共有）。
  const block = HTML.slice(HTML.indexOf('const histLine'), HTML.indexOf('function regionBalanceCell'));
  assert.ok(/<details/.test(block), 'recentCell に details（展開UI）が無い');
  assert.ok(/c\.matches/.test(block), 'matches（対戦履歴）を参照していない');
  assert.ok(/m\.date/.test(block) && /m\.tournament/.test(block) && /m\.nent/.test(block),
    '履歴の日付/大会名/規模の表示が無い');
});

test('同シリーズ再マッチ: レポートに件数・ペア・履歴の印が出る', () => {
  const block = HTML.slice(HTML.indexOf('const seriesName = rep.targetSeries'),
                           HTML.indexOf('function regionBalanceCell'));
  assert.ok(/rep\.targetSeries/.test(block), '対象シリーズ名を参照していない');
  assert.ok(/sameSeriesPairs/.test(block), '同シリーズ件数を表示していない');
  assert.ok(/sameSeriesTop/.test(block), '同シリーズのペア一覧を表示していない');
  assert.ok(/m\.sameSeries/.test(block), '履歴行に同シリーズの印が無い');
  // 同プール / 予選抜け後 の両セルで件数行を出している (postRecentCell は block の外)。
  assert.ok((HTML.match(/h \+= seriesLine\(/g) || []).length >= 2,
    '同シリーズ件数行が同プール/予選抜け後の両方に出ていない');
  assert.ok(/seriesTag\(c\)/.test(HTML), 'ペア行に同シリーズの印が付いていない');
});

// ───────── 手動調整モード ─────────
test('手動調整: 必要な関数と統合点が存在する', () => {
  for (const fn of ['manualOrder', 'manualPushOp', 'manualUnlock', 'manualCommit', 'manualDiscard',
                    'restoreManualForEvent', 'renderManualUI', 'manualClickHandler']) {
    assert.ok(new RegExp(`function ${fn}\\(`).test(HTML), `${fn} が定義されていない`);
  }
  // orderedRecs (CSV/適用) と被り回避の基準ランキングが手動調整を参照している。
  assert.ok(/if \(S\.MANUAL\) \{/.test(HTML), 'orderedRecs が手動調整を見ていない');
  assert.ok(/const baseRecs = S\.MANUAL/.test(HTML), '最適化の基準ランキングが手動調整を見ていない');
  // 破棄と基準タブ変更は確認ダイアログを出す。
  assert.ok(/confirm\('手動調整を破棄して/.test(HTML), '破棄の確認ダイアログが無い');
  assert.ok(/confirm\('基準ランキングを変更すると手動調整/.test(HTML), 'タブ変更時の確認ダイアログが無い');
  // プロフィールは新しいタブで開く。
  assert.ok(/target="_blank" rel="noopener"/.test(HTML), 'プレイヤーリンクが新規タブでない');
});

test('手動調整: op 適用・undo/redo・履歴上限の純ロジック (ページから抽出して実行)', () => {
  const vm = require('node:vm');
  const m = HTML.match(/const MANUAL_LS_KEY[\s\S]*?(?=function manualUnlock)/);
  assert.ok(m, '手動調整ロジックの抽出に失敗');
  const ctx = {
    localStorage: { _v: null, getItem() { return this._v; }, setItem(k, v) { this._v = v; }, removeItem() { this._v = null; } },
    EVENT_CONTEXT: null, DATA: [], Date, JSON, Math, Number, Array, console,
  };
  ctx.S = ctx;   // 共有状態 S (seeding/app/00_state.js) はこのテストでは sandbox そのもの
  vm.createContext(ctx);
  vm.runInContext('function renderManualUI(){}\n' + m[0] +
    '\nglobalThis.api = { get M(){return MANUAL;}, set M(v){MANUAL=v;}, manualApplyOp, manualOrder, manualPushOp, manualMovedSet };', ctx);
  const api = ctx.api;
  api.M = { base: [1, 2, 3, 4, 5, 6, 7, 8], ops: [], hpos: 0, committed: false, editing: true, sel: null };
  // 5 を先頭へ移動。
  api.manualPushOp(5, 0);
  assert.deepStrictEqual(api.manualOrder(), [5, 1, 2, 3, 4, 6, 7, 8]);
  assert.deepStrictEqual([...api.manualMovedSet()], [5]);
  // 8 を 5 の直後 (index 1) へ。
  api.manualPushOp(8, 1);
  assert.deepStrictEqual(api.manualOrder(), [5, 8, 1, 2, 3, 4, 6, 7]);
  // undo ×2 → 基準に戻る。redo ×1 → 1手目のみ。
  api.M.hpos = 1;
  assert.deepStrictEqual(api.manualOrder(), [5, 1, 2, 3, 4, 6, 7, 8]);
  api.M.hpos = 0;
  assert.deepStrictEqual(api.manualOrder(), [1, 2, 3, 4, 5, 6, 7, 8]);
  // undo 後に新しい op → 先の履歴は切り捨て (redo 不能)。
  api.M.hpos = 1;
  api.manualPushOp(2, 7);
  assert.strictEqual(api.M.ops.length, 2);
  assert.deepStrictEqual(api.manualOrder(), [5, 1, 3, 4, 6, 7, 8, 2]);
  // 履歴上限: 100 件を超えたら最古 op が base に畳み込まれ、結果順序は不変。
  api.M = { base: [1, 2, 3, 4, 5, 6, 7, 8], ops: [], hpos: 0, committed: false, editing: true, sel: null };
  for (let k = 0; k < 105; k++) api.manualPushOp((k % 8) + 1, (k * 3) % 8);
  assert.ok(api.M.ops.length <= 100, `ops=${api.M.ops.length}`);
  const orderA = api.manualOrder();
  assert.deepStrictEqual(orderA.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], 'permutation が壊れた');
});

test('buildPhasesConfig: start.gg のフェーズ連鎖からプレビュー用構成を作る (抽出実行)', () => {
  const vm = require('node:vm');
  const m = HTML.match(/function buildPhasesConfig\([\s\S]*?\n\}/);
  assert.ok(m, 'buildPhasesConfig の抽出に失敗');
  const ctx = { Math, JSON, Number, Array, String, console };
  ctx.S = ctx;   // 共有状態 S (seeding/app/00_state.js) はこのテストでは sandbox そのもの
  vm.createContext(ctx);
  vm.runInContext(m[0] + '\nglobalThis.f = buildPhasesConfig;', ctx);
  // vm 内で作られたオブジェクトはプロトタイプが別 realm なので JSON 経由で比較する
  const f = (...a) => { const r = ctx.f(...a); return r == null ? r : JSON.parse(JSON.stringify(r)); };
  // マエスマ'TOP#2 の実データ形: TOP572(32p) → TOP192(2p, 192人) → TOP48(1p, 48人) → TOP8(1p, 8人)
  const ev = { phases: [
    { id: 1, name: 'TOP572', groupCount: 32, progressingInData: [] },
    { id: 2, name: 'TOP192', groupCount: 2, progressingInData: [{ origin: 1, numProgressing: 192 }] },
    { id: 3, name: 'TOP48', groupCount: 1, progressingInData: [{ origin: 2, numProgressing: 48 }] },
    { id: 4, name: 'TOP8', groupCount: 1, progressingInData: [{ origin: 3, numProgressing: 8 }] },
  ] };
  assert.deepStrictEqual(f(ev, 1), [
    { name: 'TOP572', pools: 32, adv: 6 },
    { name: 'TOP192', pools: 2, adv: 24 },
    { name: 'TOP48', pools: 1, adv: 8 },
    { name: 'TOP8', pools: 1 },
  ]);
  // 途中フェーズを選んだ場合はそこを起点にする
  assert.deepStrictEqual(f(ev, 2), [
    { name: 'TOP192', pools: 2, adv: 24 },
    { name: 'TOP48', pools: 1, adv: 8 },
    { name: 'TOP8', pools: 1 },
  ]);
  // 最終フェーズ起点 / 単一フェーズ → null (既定にフォールバック)
  assert.strictEqual(f(ev, 4), null);
  assert.strictEqual(f({ phases: [{ id: 9, name: 'B', groupCount: 8, progressingInData: [] }] }, 9), null);
  // 起点フェーズの通過人数がプール数で割り切れない → 構成が作れないので null
  const ev2 = { phases: [
    { id: 1, name: 'P1', groupCount: 3, progressingInData: [] },
    { id: 2, name: 'P2', groupCount: 1, progressingInData: [{ origin: 1, numProgressing: 8 }] },
    { id: 3, name: 'P3', groupCount: 1, progressingInData: [{ origin: 2, numProgressing: 4 }] },
  ] };
  assert.strictEqual(f(ev2, 1), null);
  // 2フェーズ目以降で割り切れない場合は、そこまでの連鎖を使う
  const ev3 = { phases: [
    { id: 1, name: 'P1', groupCount: 4, progressingInData: [] },
    { id: 2, name: 'P2', groupCount: 3, progressingInData: [{ origin: 1, numProgressing: 16 }] },
    { id: 3, name: 'P3', groupCount: 1, progressingInData: [{ origin: 2, numProgressing: 8 }] },
  ] };
  assert.deepStrictEqual(f(ev3, 1), [{ name: 'P1', pools: 4, adv: 4 }, { name: 'P2', pools: 3 }]);
});

test('issueBracketPreview: start.gg のフェーズ構成が発行ペイロードに使われる (静的配線)', () => {
  const block = HTML.slice(HTML.indexOf('async function issueBracketPreview'), HTML.indexOf('function clearSeedSpec'));
  assert.ok(/EVENT_CONTEXT\.phasesConfig/.test(block), '発行側が phasesConfig を見ていない');
  assert.ok(/validatePhases/.test(block), '発行前の検証が無い');
  assert.ok(/withFinalPhase/.test(block), '最終フェーズの自動補完が無い');
  // EVENT_QUERY が進出情報を取得している
  assert.ok(/progressingInData\s*\{\s*origin\s+numProgressing\s*\}/.test(HTML), 'EVENT_QUERY に progressingInData が無い');
});

test('シードズレ上限: 全順位の上限 (so-maxshift) が同じ行にあり、上級者向けには無い', () => {
  // 「最大変更幅」は順位帯ごとの指定とほぼ同じ機能なので、同じ行に並べる (2026-08 に移動)。
  const row = HTML.slice(HTML.indexOf('id="so-shiftlimit-label"'), HTML.indexOf('so-orderpow-label'));
  assert.ok(/id="so-maxshift"/.test(row), 'so-maxshift がシードズレ上限の行に無い');
  assert.ok(/全順位で最大/.test(row), '全順位の上限であることが読み取れない');
  const adv = HTML.slice(HTML.indexOf('上級者向けパラメータ'), HTML.indexOf('id="so-progress"'));
  assert.ok(!/id="so-maxshift"/.test(adv), 'so-maxshift が上級者向けに残っている');
  // 段階指定にも ? アイコンが付く (従来は div の title だけでスマホから読めなかった)。
  assert.ok(/'so-shiftlimit-label'/.test(HTML), 'so-shiftlimit-label が HELP_TARGETS に無い');
});

test('同シリーズ再マッチ: UI 要素と ? アイコンが揃っている', () => {
  for (const id of ['so-avoid-series', 'so-series-select', 'so-series-note', 'so-series-box',
                    'so-seriesmode', 'so-seriesmult', 'so-wseries']) {
    assert.ok(new RegExp(`id="${id}"`).test(HTML), `${id} が無い`);
  }
  // 既定 ON (2026-09-14 から。シリーズは自動判定、判定できなければ罰則なしで実行)。
  const cb = HTML.match(/<input type="checkbox" id="so-avoid-series"[^>]*>/);
  assert.ok(cb && /checked/.test(cb[0]), '同シリーズ罰則が既定 ON でない');
  const blk = HTML.slice(HTML.indexOf('const avoidSeriesCb'), HTML.indexOf('const regionGroupOpts'));
  assert.ok(/await updateSeriesToggleState\(\)/.test(blk), '大会一覧未ロード時に判定を待っていない');
  assert.ok(/const avoidSeriesRematch = avoidSeriesCb && !!targetSeries/.test(blk), '判定できないときに罰則なしで進む配線が無い');
  assert.ok(/シリーズ判定なし（同シリーズ罰則は掛けていません）/.test(HTML), '判定なしの注記が無い');
  for (const id of ['so-avoid-series', 'so-series-select', 'so-seriesmult']) {
    assert.ok(new RegExp(`'${id}'`).test(HTML.slice(HTML.indexOf('const HELP_TARGETS'), HTML.indexOf('function injectHelpIcons'))),
      `${id} が HELP_TARGETS に無い`);
  }
  // シリーズ判定は tournaments.json の正解表ベース (剥がし規則の再実装をしていない)。
  assert.ok(/SeedData\.detectSeries\(/.test(HTML), 'detectSeries を使っていない');
  assert.ok(/ensureSeriesIndex/.test(HTML), '大会一覧の遅延ロードが無い');
});

test('プレビュー発行: start.gg フェーズ構成が使えないときは理由を表示する (黙って劣化しない)', () => {
  const block = HTML.slice(HTML.indexOf('async function issueBracketPreview'), HTML.indexOf('function clearSeedSpec'));
  assert.ok(/phasesGgNote/.test(block), 'フォールバック理由の変数が無い');
  assert.ok(/食い違うため、既定の構成で発行しました/.test(block), 'プール数不一致の理由文が無い');
  assert.ok(/検証を通らないため既定の構成で発行しました/.test(block), '検証NGの理由文が無い');
});

test('CSV の pools/waves 設定反映 (_applyCsvSettingColumns) が spec CSV と順位 CSV の両方で使われる', () => {
  // 2026-09-13 まで順位 CSV 側 (applyCsvOrderIfReady) は未定義の settingNotes を参照して ReferenceError になっていた
  assert.ok(/function _applyCsvSettingColumns\(rows\)/.test(HTML), '_applyCsvSettingColumns 未定義');
  const spec = HTML.slice(HTML.indexOf('function applySpecRows'), HTML.indexOf('function ', HTML.indexOf('function applySpecRows') + 10));
  const order = HTML.slice(HTML.indexOf('function applyCsvOrderIfReady'), HTML.indexOf('function ', HTML.indexOf('function applyCsvOrderIfReady') + 10));
  assert.ok(/const settingNotes = _applyCsvSettingColumns\(rows\)/.test(spec), 'applySpecRows が共通ヘルパを使っていない');
  assert.ok(/const settingNotes = _applyCsvSettingColumns\(S\.CSV_SOURCE\.rows\)/.test(order), 'applyCsvOrderIfReady が settingNotes を定義していない');
  assert.ok(/settingNotes\.length/.test(order), 'applyCsvOrderIfReady の settingNotes 参照が消えている');
});


test('適用時の被り回避 自動実行 (2026-09-14): チェックボックス・配線・パネル自動展開', () => {
  const cb = HTML.match(/<input type="checkbox" id="so-auto-apply"[^>]*>/);
  assert.ok(cb && /checked/.test(cb[0]), 'so-auto-apply が無い/既定ONでない');
  assert.ok(/id="seedopt-details"/.test(HTML), '被り回避パネルの <details> に id が無い');
  const upBlock = HTML.slice(HTML.indexOf('async function uploadToStartgg'), HTML.indexOf('UPSERT_PHASE_MUTATION'));
  const at = upBlock.indexOf('await ensureAutoOptimizeForUpload()');
  assert.ok(at >= 0, 'uploadToStartgg が自動実行を呼んでいない');
  assert.ok(at < upBlock.indexOf('phaseId == null'), '自動実行が phase 作成の分岐より後にある');
  // phase 作成 path も通常 path と同じ並び (orderedRecs) で送る (以前は currentMethod 順で、手動調整・被り回避を無視していた)。
  const cp = HTML.slice(HTML.indexOf('async function createPhaseThenUpload'), HTML.indexOf('function getToken'));
  assert.ok(/const recs = orderedRecs\(\)/.test(cp), 'createPhaseThenUpload が orderedRecs を使っていない');
  assert.ok(!/ranks\[currentMethod\]/.test(cp), 'createPhaseThenUpload に currentMethod 順の並び替えが残っている');
  // 完了 (反映後) で true、それ以外の終了で false に決着する。
  assert.ok(/cleanupSeedOptWorker\(\{ keepWaiter: true \}\)/.test(HTML), '完了 path の cleanup が waiter を残していない');
  assert.ok(/settleSeedOptWaiter\(!!S\.APPLIED_ORDER\)/.test(HTML), '反映後に waiter を決着させていない');
  assert.ok(/'so-auto-apply'/.test(HTML.slice(HTML.indexOf('const HELP_TARGETS'), HTML.indexOf('function injectHelpIcons'))),
    'so-auto-apply が HELP_TARGETS に無い');
});

test('既定値 (2026-09-14): 京阪神まとめ ON / 平日大会 OFF / ズレ上限 4,8,16,32,64,128 / ズレ抑制 2.5', () => {
  // 地域まとめ (南関東 / 京阪神) の既定は geo.json の seed_groups.default が持つ。両方 ON
  const groups = require('./fixtures/geo_jp.json').seed_groups;
  assert.deepStrictEqual(groups.map((g) => [g.id, g.default]), [['minamiKanto', true], ['keihanshin', true]]);
  assert.ok(/id="so-group-box"/.test(HTML) && /renderRegionGroupToggles\(geo\)/.test(HTML), '地域まとめのトグルが geo.json から描かれていない');
  for (const id of ['so-enable-intra', 'so-avoid-region', 'so-avoid-recent', 'so-keep-deplace', 'so-scope-winners', 'so-avoid-series']) {
    assert.ok(new RegExp(`id="${id}" checked`).test(HTML), `${id} が既定ONでない`);
  }
  assert.ok(/id="so-include-weekday"(?! checked)/.test(HTML), '平日大会を含む が既定OFFでない');
  assert.ok(/id="so-shift5"/.test(HTML), '±5 の欄が無い');
  assert.ok(/const SHIFT_LIMIT_PRESET = \[4, 8, 16, 32, 64, 128\]/.test(HTML), 'ズレ上限の既定が 4,8,16,32,64,128 でない');
  assert.ok(/'so-shift0', 'so-shift1', 'so-shift2', 'so-shift3', 'so-shift4', 'so-shift5'/.test(HTML), 'params 側が ±5 を読んでいない');
  assert.ok(/id="so-orderpow" min="0" max="5" step="0\.5" value="2\.5"/.test(HTML), 'ズレ抑制スライダーの既定が 2.5 でない');
  assert.ok(/numDef\('so-orderpow', 2\.5\)/.test(HTML), 'orderPow のフォールバック既定が 2.5 でない');
  assert.ok(/min-width:34px;text-align:center">2\.5<\/span>/.test(HTML), 'スライダー表示値の初期値が 2.5 でない');
});


test('被り回避パネルの設定保存 (2026-09-14): localStorage に差分保存・起動時と大会読み込み時に復元・既定に戻す', () => {
  assert.ok(/id="so-reset-defaults"/.test(HTML), '既定に戻すボタンが無い');
  assert.ok(/'so-reset-defaults'/.test(HTML.slice(HTML.indexOf('const HELP_TARGETS'), HTML.indexOf('function injectHelpIcons'))),
    'so-reset-defaults が HELP_TARGETS に無い');
  assert.ok(/const SEEDOPT_SETTINGS_SKIP = new Set\(\['so-pools', 'so-waves', 'so-series-select'\]\)/.test(HTML),
    '大会ごとの値 (プール数・ウェーブ数・対象シリーズ) を保存対象から外していない');
  // 起動時の復元は全 const 初期化後 (ファイル末尾の IIFE)。大会読み込み時は applyModeDefaults の後に復元。
  const init = HTML.slice(HTML.indexOf('function initSeedOptPanel'), HTML.indexOf('function initSeedOptPanel') + 800);
  assert.ok(init.indexOf('applyModeDefaults();') >= 0 && init.indexOf('applyModeDefaults();') < init.indexOf('restoreSeedOptSettings();'),
    'initSeedOptPanel で applyModeDefaults の後に復元していない');
  const wire = HTML.slice(HTML.indexOf('function wireSeedOptSettings'));
  assert.ok(/restoreSeedOptSettings\(\)/.test(wire), '起動時に復元していない');
  assert.ok(/panel\.addEventListener\('change', onEdit\)/.test(wire) && /panel\.addEventListener\('input', onEdit\)/.test(wire), '変更時の保存が配線されていない');
  assert.ok(/'so-auto-apply'\)[\s\S]*saveSeedOptSettings\(\)/.test(wire), '自動実行チェックの保存が配線されていない');
  assert.ok(/'so-reset-defaults'\)[\s\S]*resetSeedOptSettings/.test(wire), '既定に戻すボタンが配線されていない');
});

test('geo.json (2026-09-16): 都道府県の一覧・地域まとめをフロントに直書きしない', () => {
  const fs = require('fs'), path = require('path');
  for (const f of ['src/pages/pref_index.js', 'src/pages/priority.js', 'site/seeding/seed_data.js', 'site/regions/JP/config.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../../', f), 'utf8');
    assert.ok(!/北海道|沖縄県|'埼玉県'/.test(src), `${f} に県名の一覧が残っている`);
  }
  assert.ok(!/北海道|沖縄県|'埼玉県'/.test(HTML), 'シードツールに県名の一覧が残っている');
  assert.ok(/data\/geo\.json/.test(fs.readFileSync(path.resolve(__dirname, '../../src/pages/pref_index.js'), 'utf8')), 'pref が geo.json を読まない');
  assert.ok(/data\/geo\.json/.test(fs.readFileSync(path.resolve(__dirname, '../../src/pages/priority.js'), 'utf8')), 'priority が geo.json を読まない');
  // シードツール: 実行前に geo.json を確実に読み、トグルは geo.json から描く。
  assert.ok(/await SeedData\.ensureGeoCatalog\(cachedFetchers\(SPSP\.data\)\)/.test(HTML), 'runSeedOptimize が geo.json を読んでいない');
  assert.ok(/ensureGeoForSeed\(\)\.catch/.test(HTML), '起動時の geo.json 読込とトグル描画が無い');
});
