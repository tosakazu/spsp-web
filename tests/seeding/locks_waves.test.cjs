'use strict';
// プール/ウェーブ固定 (seedLocks/poolWaves) と シード指定・固定パネルのテスト。
//   - optimizer: 固定のハード制約 (pool/wave/winners スコープ)・検証 (fail-loud)
//   - seed_app 純関数 (ソース抽出): wavesFromGroupNodes / chunkWaveMap / poolLabel /
//     parseWaveValue / parseFixValue / buildSpecOrder
//   - 静的整合: spec-panel の id 配線・runSeedOptimize → params.seedLocks の配線
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SO = ((m) => m.default || m)(require(path.resolve(__dirname, '../../site/seeding/seed_optimizer.js')));
const APP_SRC = require('./helpers/seed_app_src.cjs').SRC;   // seeding/app/*.js を並び順に連結 (旧 seed_app.js)

// ── optimizer: プール固定 ─────────────────────────────
// P=2, N=8。snake: pool0={1,4,5,8}, pool1={2,3,6,7}。uid1×uid8 を同地域にすると
// 既定では下位の 8 が pool1 へ逃げて分離される。8 をプール固定すると分離できず
// pool0 に残る (1 は kInter 既定で不動)。
function pairInput(locks) {
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  const prefByUid = { 1: '東京都', 8: '東京都' };
  const params = {
    mode: 'hillclimb', rngSeed: 7, avoidRecent: false, keepDePlace: false,
    _verifyDelta: true,
  };
  if (locks) params.seedLocks = locks;
  return { poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: {}, params };
}
function poolOfUid(res, uid, P) {
  return SO.poolOfSeed(res.seedOrder.indexOf(uid), P);
}

test('optimizer: 固定なしなら同地域ペアは別プールに分離される', () => {
  const res = SO.optimize(pairInput(null));
  assert.notStrictEqual(poolOfUid(res, 1, 2), poolOfUid(res, 8, 2), '分離されるはず');
});

test('optimizer: プール固定した選手は元プールから動かない (分離不能でも)', () => {
  const res = SO.optimize(pairInput({ 8: 'pool' }));
  assert.strictEqual(poolOfUid(res, 8, 2), 0, '8 は pool0 固定');
  assert.strictEqual(poolOfUid(res, 1, 2), 0, '1 は kInter 既定で不動');
  // permutation は保たれる
  assert.deepStrictEqual(res.seedOrder.slice().sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

// ── optimizer: ウェーブ固定 ─────────────────────────────
// P=4 (wave0 = pool0,1 / wave1 = pool2,3), N=32。pool0 の下位選手 X をウェーブ固定
// すると、X は pool0/1 にしか居られない。多数試行で不変条件を検証する。
test('optimizer: ウェーブ固定は同ウェーブ内のプールのみ許可', () => {
  const N = 32, P = 4;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const poolWaves = [0, 0, 1, 1];
  // pool0 に固まる同地域ペアを複数作って inter 移動を誘発する。
  // snake: idx で pool0 に入るのは 0,7,8,15,16,23,24,31 → uid 1,8,9,16,17,24,25,32
  const prefByUid = { 1: '愛知県', 8: '愛知県', 9: '愛知県', 16: '愛知県', 25: '福岡県', 32: '福岡県' };
  for (const seed of [1, 2, 3]) {
    const res = SO.optimize({
      poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: {},
      params: {
        mode: 'sa', rngSeed: seed, avoidRecent: false, keepDePlace: false,
        seedLocks: { 16: 'wave', 32: 'wave' }, poolWaves, _verifyDelta: true,
      },
    });
    for (const uid of [16, 32]) {
      const pl = poolOfUid(res, uid, P);
      assert.ok(poolWaves[pl] === 0, `uid${uid} は wave0 (pool0/1) に居るべき: pool${pl} (seed=${seed})`);
    }
    assert.deepStrictEqual(res.seedOrder.slice().sort((a, b) => a - b), ranking);
  }
});

test('optimizer: winners スコープでも固定は守られる', () => {
  const N = 16, P = 2;
  const ranking = Array.from({ length: N }, (_, i) => i + 1);
  const prefByUid = { 5: '大阪府', 12: '大阪府', 6: '京都府', 11: '京都府' };
  const res = SO.optimize({
    poolCount: P, format: 'DOUBLE_ELIMINATION', ranking, prefByUid, recentPair: {},
    params: {
      mode: 'sa', rngSeed: 11, avoidRecent: false, bracketScope: 'winners',
      seedLocks: { 12: 'pool', 11: 'pool' }, _verifyDelta: true,
    },
  });
  for (const uid of [12, 11]) {
    const origPool = SO.poolOfSeed(uid - 1, P);
    assert.strictEqual(poolOfUid(res, uid, P), origPool, `uid${uid} のプールが変わった`);
  }
});

test('optimizer: 固定は intra (プール内変動) を妨げない', () => {
  // P=1×DE は intra のみ。プール固定は常に満たされるので通常どおり最適化される。
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  const res = SO.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking,
    prefByUid: { 5: '東京都', 6: '東京都' }, recentPair: {},
    params: { mode: 'hillclimb', rngSeed: 3, avoidRecent: false, keepDePlace: false, seedLocks: { 5: 'pool', 6: 'pool' } },
  });
  assert.ok(!res.unsupported);
  assert.deepStrictEqual(res.seedOrder.slice().sort((a, b) => a - b), ranking);
});

// ── optimizer: 検証 (fail-loud) ─────────────────────────────
test('optimizer: seedLocks/poolWaves の不正指定は throw する', () => {
  assert.throws(() => SO.resolveParams({ seedLocks: { 1: 'fix' } }), /seedLocks\[1\]/);
  assert.throws(() => SO.resolveParams({ seedLocks: [1, 2] }), /seedLocks は/);
  assert.throws(() => SO.resolveParams({ seedLocks: { 1: 'wave' } }), /poolWaves.*が必要/);
  assert.throws(() => SO.resolveParams({ poolWaves: [0, -1] }), /poolWaves は/);
  assert.throws(() => SO.resolveParams({ poolWaves: [] }), /poolWaves は/);
  // 長さ不一致は optimize 側で throw
  assert.throws(() => SO.optimize({
    poolCount: 4, format: 'DOUBLE_ELIMINATION', ranking: [1, 2, 3, 4, 5, 6, 7, 8],
    prefByUid: {}, recentPair: {},
    params: { seedLocks: { 1: 'pool' }, poolWaves: [0, 1] },
  }), /poolWaves の長さ/);
  // 正常形は throw しない
  assert.doesNotThrow(() => SO.resolveParams({ seedLocks: { 1: 'wave' }, poolWaves: [0, 0, 1, 1] }));
  assert.doesNotThrow(() => SO.resolveParams({ seedLocks: null, poolWaves: null }));
});

test('optimizer: buildLockCheck 単体 (pool/wave/ランキング外)', () => {
  const params = {
    seedLocks: { 10: 'pool', 20: 'wave' },
    poolWaves: [0, 0, 1, 1],
    _origRank: { 10: 1, 20: 2 },   // uid10 → seed1 → pool0 / uid20 → seed2 → pool1
  };
  const chk = SO.buildLockCheck(params, 4);
  assert.strictEqual(chk(10, 0), true);    // pool 固定: 元プールのみ
  assert.strictEqual(chk(10, 1), false);
  assert.strictEqual(chk(20, 0), true);    // wave 固定: wave0 (pool0/1) のみ
  assert.strictEqual(chk(20, 1), true);
  assert.strictEqual(chk(20, 2), false);
  assert.strictEqual(chk(999, 3), true);   // 固定なし uid は自由
  assert.strictEqual(SO.buildLockCheck({ seedLocks: {} }, 4), null);
  assert.strictEqual(SO.buildLockCheck({}, 4), null);
});

// ── seed_app 純関数 (ソース抽出) ─────────────────────────────
const arr = (x) => Array.from(x);   // vm realm の配列 → 現 realm (deepStrictEqual 用)

function extractFns(names) {
  const ctx = { console, Math, Number, String, Array, Object, Map, Set, JSON };
  ctx.S = ctx;   // 共有状態 S (seeding/app/00_state.js) はこのテストでは sandbox そのもの
  vm.createContext(ctx);
  for (const name of names) {
    const re = new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`, 'm');
    const m = APP_SRC.match(re);
    assert.ok(m, `${name} の抽出に失敗`);
    vm.runInContext(m[0] + `\nglobalThis.${name} = ${name};`, ctx);
  }
  return ctx;
}

test('app: wavesFromGroupNodes がプール名からウェーブを導出する', () => {
  const ctx = extractFns(['wavesFromGroupNodes']);
  // 未ソート A1..B2 + 自然順 (A10 は A2 の後)
  const wv = ctx.wavesFromGroupNodes([
    { displayIdentifier: 'B2' }, { displayIdentifier: 'A1' },
    { displayIdentifier: 'A10' }, { displayIdentifier: 'B1' },
    { displayIdentifier: 'A2' },
  ]);
  assert.strictEqual(wv.poolCount, 5);
  assert.strictEqual(wv.waveCount, 2);
  assert.deepStrictEqual(arr(wv.letters), ['A', 'B']);
  assert.deepStrictEqual(arr(wv.identifiers), ['A1', 'A2', 'A10', 'B1', 'B2']);
  assert.deepStrictEqual(arr(wv.poolToWave), [0, 0, 0, 1, 1]);
  // wave.identifier があれば displayIdentifier より優先
  const wv2 = ctx.wavesFromGroupNodes([
    { displayIdentifier: '1', wave: { identifier: 'A' } },
    { displayIdentifier: '2', wave: { identifier: 'B' } },
  ]);
  assert.strictEqual(wv2.waveCount, 2);
  assert.deepStrictEqual(arr(wv2.poolToWave), [0, 1]);
  // 数字のみ (ウェーブなし) は waveCount=1
  const wv3 = ctx.wavesFromGroupNodes([{ displayIdentifier: '1' }, { displayIdentifier: '2' }]);
  assert.strictEqual(wv3.waveCount, 1);
  assert.deepStrictEqual(arr(wv3.poolToWave), [0, 0]);
  assert.strictEqual(ctx.wavesFromGroupNodes([]), null);
});

test('app: chunkWaveMap は連続チャンク割り (端数は先頭側)', () => {
  const ctx = extractFns(['chunkWaveMap']);
  assert.deepStrictEqual(arr(ctx.chunkWaveMap(12, 3)), [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
  assert.deepStrictEqual(arr(ctx.chunkWaveMap(10, 3)), [0, 0, 0, 0, 1, 1, 1, 2, 2, 2]);
  assert.deepStrictEqual(arr(ctx.chunkWaveMap(4, 1)), [0, 0, 0, 0]);
  assert.deepStrictEqual(arr(ctx.chunkWaveMap(2, 5)), [0, 1]);   // W>P は P に切り詰め
});

test('app: poolLabel / waveLetter', () => {
  const ctx = extractFns(['waveLetter', 'poolLabel']);
  assert.strictEqual(ctx.waveLetter(0), 'A');
  assert.strictEqual(ctx.waveLetter(2), 'C');
  assert.strictEqual(ctx.poolLabel(2, [0, 0, 1, 1]), 'B1');
  assert.strictEqual(ctx.poolLabel(1, [0, 0, 1, 1]), 'A2');
  assert.strictEqual(ctx.poolLabel(2, [0, 0, 0, 0]), 'P3');   // ウェーブなし
  assert.strictEqual(ctx.poolLabel(2, null), 'P3');
});

test('app: parseWaveValue / parseFixValue', () => {
  const ctx = extractFns(['parseWaveValue', 'parseFixValue']);
  assert.strictEqual(ctx.parseWaveValue('A'), 0);
  assert.strictEqual(ctx.parseWaveValue('b'), 1);
  assert.strictEqual(ctx.parseWaveValue('3'), 2);
  assert.strictEqual(ctx.parseWaveValue(''), null);
  assert.strictEqual(ctx.parseWaveValue('AB'), null);
  assert.strictEqual(ctx.parseWaveValue('0'), null);
  assert.strictEqual(ctx.parseFixValue('プール', false), 'pool');
  assert.strictEqual(ctx.parseFixValue('wave', false), 'wave');
  assert.strictEqual(ctx.parseFixValue('1', false), 'pool');   // 汎用 truthy
  assert.strictEqual(ctx.parseFixValue('1', true), 'wave');    // ウェーブ指定行なら wave
  assert.strictEqual(ctx.parseFixValue('0', true), null);
  assert.strictEqual(ctx.parseFixValue('', true), null);
  assert.strictEqual(ctx.parseFixValue(null, true), null);
});

test('app: buildSpecOrder — 順位ピン・ウェーブ割当・警告', () => {
  const ctx = extractFns(['buildSpecOrder']);
  const poolOf = (s, P) => SO.poolOfSeed(s, P);
  const cur = [1, 2, 3, 4, 5, 6, 7, 8];
  // 順位ピンのみ: 8 を seed1 へ。他は現在順で空き位置に詰める。
  let r = ctx.buildSpecOrder(cur, [[8, 1]], [], 2, [0, 1], poolOf);
  assert.deepStrictEqual(arr(r.order), [8, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepStrictEqual(arr(r.notes), []);
  // ウェーブ割当: P=2 (wave0=pool0, wave1=pool1)。uid2 を wave0 へ。
  // snake: s0→p0, s1→p1, s2→p1, s3→p0, s4→p0, …。uid2 は s1(p1) を飛ばし s3? いや
  // s1 には次の候補 uid3 が入り、uid2 は次の pool0 位置 s3 に入る。
  r = ctx.buildSpecOrder(cur, [], [[2, 0]], 2, [0, 1], poolOf);
  assert.strictEqual(r.order[0], 1);
  assert.strictEqual(r.order[3], 2, 'uid2 は wave0 の次の空き (s3=pool0) に入る');
  assert.ok([0, 3, 4, 7].includes(r.order.indexOf(2)));
  assert.deepStrictEqual(arr(r.order).sort((a, b) => a - b), cur);
  // 順位重複・範囲外は notes に載る (黙って握りつぶさない)
  r = ctx.buildSpecOrder(cur, [[3, 2], [4, 2], [5, 99]], [], 2, [0, 1], poolOf);
  assert.strictEqual(r.order[1], 3, '先の指定が勝つ');
  assert.strictEqual(r.notes.length, 2);
  assert.deepStrictEqual(arr(r.order).sort((a, b) => a - b), cur);
  // ウェーブ枠不足: 全員 wave1 指定 (枠は 4) → 諦めた人数を note で説明 + permutation 維持
  r = ctx.buildSpecOrder(cur, [], cur.map(u => [u, 1]), 2, [0, 1], poolOf);
  assert.ok(arr(r.notes).some(n => /ウェーブの枠が足りず 4人/.test(n)), arr(r.notes).join(' / '));
  assert.deepStrictEqual(arr(r.order).sort((a, b) => a - b), cur);
});

function csvMatchCtx() {
  const ctx = extractFns(['_csvNormName', '_csvNormDisc', '_csvPick', '_csvRecLookups', '_csvMatchRow']);
  ctx.CSV_NAME_COLS = ['player', 'name', 'display', 'tag', 'プレイヤー', '名前'];
  ctx.CSV_DISC_COLS = ['discriminator', 'disc'];
  ctx.canonicalUserId = (u) => u;
  ctx.DISCRIMINATORS = null;
  // タグ省略後の正規化名 "あcola" が 2 人に重なる。
  ctx.DATA = [
    { user_id: 1, display: 'Zeta | あcola', seedId: 'x1' },
    { user_id: 2, display: 'あcola' },
    { user_id: 3, display: 'Uto' },
  ];
  return ctx;
}

test('app: 名前照合の被り (同名参加者が複数) はエラーになる', () => {
  const ctx = csvMatchCtx();
  const lk = ctx._csvRecLookups();
  // 名前だけの行 → 被り = ambiguousName (rec は付けない)
  let r = ctx._csvMatchRow({ name: 'あcola' }, lk);
  assert.strictEqual(r.rec, null);
  assert.strictEqual(r.ambiguousName, 'あcola');
  // uid 列があれば名前の被りは無関係 (uid 優先)
  r = ctx._csvMatchRow({ uid: '2', name: 'あcola' }, lk);
  assert.strictEqual(r.rec.user_id, 2);
  assert.strictEqual(r.ambiguousName, null);
  // seedId 列でも同様
  r = ctx._csvMatchRow({ seedid: 'x1', name: 'あcola' }, lk);
  assert.strictEqual(r.rec.user_id, 1);
  // 被りのない名前は従来どおり照合できる
  r = ctx._csvMatchRow({ name: 'uto' }, lk);
  assert.strictEqual(r.rec.user_id, 3);
  // 照合不可の行は rec も ambiguousName も null
  r = ctx._csvMatchRow({ name: '知らない人' }, lk);
  assert.strictEqual(r.rec, null);
  assert.strictEqual(r.ambiguousName, null);
});

test('app: discriminator 照合 (優先度 uid → disc → seedId → 名前)', () => {
  const ctx = csvMatchCtx();
  ctx.DISCRIMINATORS = { 1: 'AAA111', 2: 'bbb222', 3: 'ccc333' };
  const lk = ctx._csvRecLookups();
  // disc 単独で照合 ("#" 前置・大文字小文字は正規化)
  let r = ctx._csvMatchRow({ discriminator: '#BBB222' }, lk);
  assert.strictEqual(r.rec.user_id, 2);
  // 優先枠作成ページの出力形式 ="bbb222" (パース後 =bbb222) もそのまま読める
  r = ctx._csvMatchRow({ discriminator: '="bbb222"' }, lk);
  assert.strictEqual(r.rec.user_id, 2);
  r = ctx._csvMatchRow({ discriminator: '=bbb222' }, lk);
  assert.strictEqual(r.rec.user_id, 2);
  // disc は名前被りを解決できる (name より優先)
  r = ctx._csvMatchRow({ name: 'あcola', disc: 'aaa111' }, lk);
  assert.strictEqual(r.rec.user_id, 1);
  assert.ok(!r.ambiguousName);
  // uid があれば uid 優先
  r = ctx._csvMatchRow({ uid: '3', disc: 'aaa111' }, lk);
  assert.strictEqual(r.rec.user_id, 3);
  // 不明 disc は名前照合へフォールバック (被りのない名前なら照合できる)
  r = ctx._csvMatchRow({ discriminator: 'zzz999', name: 'Uto' }, lk);
  assert.strictEqual(r.rec.user_id, 3);
});

test('app: 参加者データの discriminator だけで照合できる (DB 不要)', () => {
  const ctx = csvMatchCtx();   // DISCRIMINATORS = null のまま
  ctx.DATA = [
    { user_id: 1, display: 'Zeta | あcola', discriminator: 'AAA111' },
    { user_id: 2, display: 'あcola', discriminator: 'bbb222' },
    { user_id: 4, display: '新規勢', discriminator: 'ddd444' },   // DB 未登録の参加者でも照合可
  ];
  const lk = ctx._csvRecLookups();
  assert.ok(lk.byDisc, '参加者に disc があれば discriminators.json 無しでも byDisc が使える');
  let r = ctx._csvMatchRow({ discriminator: 'DDD444' }, lk);
  assert.strictEqual(r.rec.user_id, 4);
  assert.ok(!r.discUnavailable);
  r = ctx._csvMatchRow({ name: 'あcola', disc: '#bbb222' }, lk);
  assert.strictEqual(r.rec.user_id, 2);
  // 参加者に disc が無い rec は discriminators.json で補完される
  ctx.DISCRIMINATORS = { 5: 'eee555' };
  ctx.DATA = ctx.DATA.concat([{ user_id: 5, display: 'Uto' }]);
  const lk2 = ctx._csvRecLookups();
  r = ctx._csvMatchRow({ discriminator: 'eee555' }, lk2);
  assert.strictEqual(r.rec.user_id, 5);
});

test('app: discriminators.json 未取得で disc 列があると discUnavailable', () => {
  const ctx = csvMatchCtx();   // DISCRIMINATORS = null
  const lk = ctx._csvRecLookups();
  assert.strictEqual(lk.byDisc, null);
  let r = ctx._csvMatchRow({ discriminator: 'aaa111' }, lk);
  assert.strictEqual(r.rec, null);
  assert.strictEqual(r.discUnavailable, true);
  // disc 列の無い行は影響なし
  r = ctx._csvMatchRow({ name: 'Uto' }, lk);
  assert.strictEqual(r.rec.user_id, 3);
  assert.ok(!r.discUnavailable);
});

test('app: テンプレートの記入例行を判定する', () => {
  const ctx = extractFns(['_csvNormName', '_csvNormDisc', '_csvPick', 'isCsvTemplateSample']);
  ctx.CSV_NAME_COLS = ['player', 'name', 'display', 'tag', 'プレイヤー', '名前'];
  ctx.CSV_DISC_COLS = ['discriminator', 'disc'];
  ctx.CSV_TPL_NAMES = ['Taro Yamada', 'Hanako Suzuki', '山田太郎', '鈴木花子'];
  // 名前・disc どちらが残っていても例行と判定 (テンプレの 2 行とも)
  assert.strictEqual(ctx.isCsvTemplateSample({ name: 'Taro Yamada', discriminator: 'abc12345' }), true);
  assert.strictEqual(ctx.isCsvTemplateSample({ name: 'Hanako Suzuki' }), true);
  // 旧テンプレ (日本語名) も引き続き例行として弾く
  assert.strictEqual(ctx.isCsvTemplateSample({ name: '山田太郎', discriminator: 'abc12345' }), true);
  assert.strictEqual(ctx.isCsvTemplateSample({ name: '鈴木花子' }), true);
  assert.strictEqual(ctx.isCsvTemplateSample({ name: 'あcola', discriminator: '="00000000"' }), true);
  assert.strictEqual(ctx.isCsvTemplateSample({ name: 'あcola', discriminator: '="00000001"' }), true);
  assert.strictEqual(ctx.isCsvTemplateSample({ name: ' 山田太郎 ' }), true);
  // 実データは例行にならない
  assert.strictEqual(ctx.isCsvTemplateSample({ name: 'あcola', discriminator: 'abc12345' }), false);
  assert.strictEqual(ctx.isCsvTemplateSample({ name: 'あcola', discriminator: '10000000' }), false);
  assert.strictEqual(ctx.isCsvTemplateSample({ uid: '123' }), false);
});

test('静的: 両ページに CSV テンプレート DL と記入例の無視・警告がある', () => {
  // シードページ: 2 経路 (基準CSV / 指定CSV) のテンプレート DL ボタン + 配線。
  for (const id of ['csv-tpl', 'spec-tpl']) {
    assert.ok(APP_SRC.includes(`id="${id}"`), `テンプレートボタン ${id} が無い`);
    assert.ok(APP_SRC.includes(`getElementById('${id}')`), `${id} の配線が無い`);
  }
  assert.ok(/function downloadCsvTemplate\(/.test(APP_SRC), 'downloadCsvTemplate が無い');
  // 記入例は 3 経路 (基準CSV / 指定CSV / CSVリスト構築) すべてで無視し、警告を出す。
  assert.strictEqual((APP_SRC.match(/if \(isCsvTemplateSample\(row\)\)/g) || []).length, 3,
    '記入例のスキップが 3 経路に無い');
  assert.strictEqual((APP_SRC.match(/テンプレートの記入例 \$\{sampleRows\}行は無視/g) || []).length, 3,
    '記入例の警告が 3 経路に無い');
  // 優先枠ページ: テンプレート DL + 記入例の無視・警告。
  const PRI = require('../helpers/pages.cjs').pageWithScript('priority/index.html');   // HTML + src/pages/priority.js
  assert.ok(/id="csv-tpl-btn"/.test(PRI) && /id="csv-rem-tpl-btn"/.test(PRI),
    '優先枠ページのテンプレートボタンが無い');
  assert.ok(/function downloadTemplate\(/.test(PRI), '優先枠ページの downloadTemplate が無い');
  assert.ok(/isTemplateSampleRow\(rows\[i\], v\)/.test(PRI), '優先枠ページの記入例スキップが無い');
  // 文言は辞書 (i18n/ja.js の priority.csv.sample_ignored) から引く
  assert.ok(/i18n\('priority\.csv\.sample_ignored', \{ n: sample \}\)/.test(PRI), '優先枠ページの警告が無い');
  // 例の値は両ページで一致していること (テンプレを取り違えても弾ける)。
  // テンプレ出力は ASCII 名 (Shift_JIS 前提で開くアプリでも化けない)。判定は日本語名も含む。
  assert.ok(/CSV_TPL_OUT_NAMES = \['Taro Yamada', 'Hanako Suzuki'\]/.test(APP_SRC), 'seed 側の出力例名が想定と違う');
  assert.ok(/TPL_OUT_NAMES = \['Taro Yamada', 'Hanako Suzuki'\]/.test(PRI), '優先枠側の出力例名が想定と違う');
  assert.ok(/concat\(\['山田太郎', '鈴木花子'\]\)/.test(APP_SRC) && /concat\(\['山田太郎', '鈴木花子'\]\)/.test(PRI),
    '旧テンプレ (日本語名) の判定が残っていない');
  // テンプレ本文に非 ASCII を混ぜない (文字化けの余地をなくす)。
  for (const m of APP_SRC.match(/downloadCsvTemplate\(\[[\s\S]*?\], '[^']+'\)/g) || []) {
    assert.ok(!/[^\x00-\x7F]/.test(m.replace(/CSV_TPL_OUT_NAMES/g, '')), 'テンプレ出力に非 ASCII: ' + m);
  }
  // 例の disc 判定は「先頭7桁が 0」で両ページ共通。
  assert.ok(/\^0\{7\}\[0-9a-f\]\$/.test(APP_SRC) && /\^0\{7\}\[0-9a-f\]\$/.test(PRI),
    '例 disc の判定 (先頭7桁が0) が両ページに無い');
  // カラム名は英語 (テンプレ出力)。
  assert.ok(/'name,discriminator,seed,wave,lock'/.test(APP_SRC), '指定CSVテンプレが英語カラムでない');
  assert.ok(/'name,discriminator,seed'/.test(APP_SRC), '基準CSVテンプレが英語カラムでない');
  // 空欄可の列はサンプル 2 行目を空にして示す。
  assert.ok(/,="00000001",,,wave/.test(APP_SRC), '指定CSVテンプレに空欄可の例が無い');
  assert.ok(/,="00000001",`/.test(APP_SRC), '基準CSVテンプレに空欄可の例が無い');
  assert.ok(/',="00000001"/.test(PRI) || /,="00000001"/.test(PRI), '優先枠テンプレに空欄可の例が無い');
  // 文字化け対策: Blob の charset を明示。
  assert.ok(/text\/csv;charset=utf-8/.test(APP_SRC) && /text\/csv;charset=utf-8/.test(PRI),
    'CSV Blob の charset 指定が無い');
});

test('静的: discUnavailable エラーが3経路 (基準CSV/指定CSV/CSVリスト構築) にある', () => {
  const hits = (APP_SRC.match(/discriminator 列がありますが照合データ/g) || []).length;
  assert.strictEqual(hits, 3, `discUnavailable エラー処理が ${hits} 箇所`);
  assert.ok(/loadDiscriminators/.test(APP_SRC), 'loadDiscriminators が無い');
  assert.ok(/data\/discriminators\.json/.test(APP_SRC), 'discriminators.json を取得していない');
});

test('静的: 名前被りエラーが基準CSV (csvモード) と指定CSVの両方で適用を止める', () => {
  const hits = (APP_SRC.match(/名前が複数の参加者に該当するため適用しません/g) || []).length;
  assert.strictEqual(hits, 2, `エラー処理が ${hits} 箇所 (csvRowsToOrder 側 / applySpecRows 側の 2 箇所必要)`);
  assert.ok(/ambiguousName/.test(APP_SRC), 'ambiguousName の伝搬が無い');
  assert.ok(/dupNames/.test(APP_SRC), 'dupNames (被り検出) が無い');
});

// ── 静的整合 (page.test.cjs と同方式) ─────────────────────────────
test('静的: spec-panel の id が JS から配線されている', () => {
  for (const id of ['spec-panel', 'spec-src-url', 'spec-src-file', 'spec-src-load', 'spec-clear', 'spec-status']) {
    assert.ok(APP_SRC.includes(`id="${id}"`), `HTML に id "${id}" が無い`);
    assert.ok(APP_SRC.includes(`getElementById('${id}')`), `JS が id "${id}" を参照していない`);
  }
});

test('静的: 手動調整バーからプール数/ウェーブ数を指定でき、固定バーは行の直下に出る', () => {
  // 手動調整バーの プール数 / ウェーブ数 入力 → so-pools / so-waves に同期。
  assert.ok(/data-mn-pools/.test(APP_SRC) && /data-mn-waves/.test(APP_SRC),
    '手動調整バーのプール数/ウェーブ数入力が無い');
  assert.ok(/getElementById\(p \? 'so-pools' : 'so-waves'\)/.test(APP_SRC),
    'プール数/ウェーブ数の同期配線が無い');
  // 固定バーは対象行の直下 (mn-lock-row) に挿入する。
  assert.ok(/mn-lock-row/.test(APP_SRC), '固定バーの行 (mn-lock-row) が無い');
  assert.ok(/tbody\.insertBefore\(lr,/.test(APP_SRC), '固定バーを行の直下に挿入していない');
  // 行のボタン/バッジは 📌 ではなくテキスト表記 (MANUAL_COL の cell 内)。
  const colBlock = APP_SRC.slice(APP_SRC.indexOf('const MANUAL_COL'), APP_SRC.indexOf('const SEED_BASE_COLUMNS'));
  assert.ok(/プール指定/.test(colBlock), 'ボタンが「プール指定」表記でない');
  assert.ok(!/📌/.test(colBlock), '手動列に📌マークが残っている');
  assert.ok(/'固定'/.test(colBlock) || /固定'/.test(colBlock), 'バッジが「〜固定」表記でない');
});

test('静的: ウェーブ数 UI と optimizer への固定の配線がある', () => {
  assert.ok(/id="so-waves"/.test(APP_SRC), 'so-waves が無い');
  assert.ok(/id="so-waves-label"/.test(APP_SRC), 'so-waves-label が無い');
  assert.ok(/params\.seedLocks = seedLocks/.test(APP_SRC), 'params.seedLocks の配線が無い');
  assert.ok(/params\.poolWaves = waveMap/.test(APP_SRC), 'params.poolWaves の配線が無い');
  assert.ok(/fetchPhaseWaves\(token, phaseId\)/.test(APP_SRC), 'performSeedFetch がウェーブを自動取得していない');
  // 保存/復元: saveManual に spec が含まれる
  assert.ok(/spec: S\.SEED_SPEC/.test(APP_SRC), 'saveManual が SEED_SPEC を保存していない');
  // 手動調整の📌 = 固定設定バー (プール/ウェーブを指定して固定)。
  assert.ok(/act === 'lockopen'/.test(APP_SRC), '手動調整の📌 (lockopen) が無い');
  assert.ok(/act === 'lock-apply'/.test(APP_SRC), '固定バーの適用 (lock-apply) が無い');
  assert.ok(/function manualLockBarHtml\(/.test(APP_SRC), 'manualLockBarHtml が無い');
  assert.ok(/function applySeedLockChoice\(/.test(APP_SRC), 'applySeedLockChoice が無い');
  assert.ok(/data-mn-lock-kind/.test(APP_SRC) && /data-mn-lock-target/.test(APP_SRC),
    '固定バーの種別/対象セレクトが無い');
  // 固定は対象付き {kind, target} で保存し、読み取り時射影で常に並びへ反映する。
  assert.ok(/SEED_SPEC\.locks\[uid\] = \{ kind, target/.test(APP_SRC), '固定が対象付きで保存されていない');
  assert.ok(/function _projectSeedLocks\(/.test(APP_SRC), '_projectSeedLocks (読み取り時射影) が無い');
  assert.ok(/return _projectSeedLocks\(a\);/.test(APP_SRC), 'manualOrder が射影を通していない');
  // 枠不足の警告は「どの枠が何人分足りないか」を出す。
  assert.ok(/人分の枠に \$\{o\.want\}人を固定/.test(APP_SRC), '枠不足の警告が具体的でない');
  assert.ok(!/空きが不足/.test(APP_SRC), '意味の分からない「空きが不足」表記が残っている');
  // 対象が消えた固定 (設定変更後) は専用メッセージ + その場で解除できるボタン。
  assert.ok(/に無いため、\$\{who\} の固定を無視/.test(APP_SRC), '対象消失時の説明が無い');
  assert.ok(/data-mn="clear-locks"/.test(APP_SRC), '固定解除ボタンが無い');
  assert.ok(/act === 'clear-locks'/.test(APP_SRC), '固定解除の配線が無い');
  // 大会を切り替えたら前の警告を持ち越さない (別大会の固定が出たように見えるのを防ぐ)。
  assert.ok(/_lockProjNotes = \[\];   \/\/ 前の大会の固定警告を持ち越さない/.test(APP_SRC),
    'restoreManualForEvent が警告をクリアしていない');
  // 手動調整が無いときも現在の並びで警告を計算し直す。
  const rmu = APP_SRC.slice(APP_SRC.indexOf('function renderManualUI('), APP_SRC.indexOf('// V4 用'));
  assert.ok(/orderedRecs\(\);/.test(rmu), 'renderManualUI が警告状態を更新していない');
  // イベント不明 (key=null) では復元しない。
  assert.ok(/if \(raw && key != null\)/.test(APP_SRC), 'eventKey=null の復元ガードが無い');
  // 警告には影響を受けたプレイヤー名を出す。
  assert.ok(/function namesOfUids\(/.test(APP_SRC), 'namesOfUids が無い');
  assert.ok(/const who = namesOfUids\(o\.dropped\)/.test(APP_SRC), '警告にプレイヤー名が入っていない');
  const proj = (APP_SRC.match(/_projectSeedLocks\(/g) || []).length;
  assert.ok(proj >= 4, `_projectSeedLocks の適用箇所が少ない: ${proj} (定義+manualOrder+orderedRecs+最適化基準)`);
});

test('app: enforceSeedLocks — 対象付き固定を挿入ソート的に並びへ反映する', () => {
  const ctx = extractFns(['enforceSeedLocks']);
  const poolOf = (s, P) => SO.poolOfSeed(s, P);
  const cur = [1, 2, 3, 4, 5, 6, 7, 8];
  // プール固定: uid2 を pool0 (P=2 の slot 0,3,4,7) へ。先頭は 1 が取るので次の pool0 = slot3。
  let r = ctx.enforceSeedLocks(cur, { 2: { kind: 'pool', target: 0 } }, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r.order), [1, 3, 4, 2, 5, 6, 7, 8]);
  assert.deepStrictEqual(arr(r.overflow), []);
  // 冪等: 既に満たしている並びは不変。
  const r2 = ctx.enforceSeedLocks(arr(r.order), { 2: { kind: 'pool', target: 0 } }, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r2.order), arr(r.order));
  // ウェーブ固定: P=4 (wave0=pool0,1 / wave1=pool2,3)。uid1 を wave1 へ → 最初の wave1 slot = 2。
  r = ctx.enforceSeedLocks(cur, { 1: { kind: 'wave', target: 1 } }, 4, [0, 0, 1, 1], poolOf);
  assert.deepStrictEqual(arr(r.order), [2, 3, 1, 4, 5, 6, 7, 8]);
  // 旧形式 (文字列・対象なし) は移動しない (恒等)。
  r = ctx.enforceSeedLocks(cur, { 2: 'pool' }, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r.order), cur);
  // 枠不足: 全員 pool0 固定 (P=2 → pool0 の枠は 4) → overflow に不足量、permutation 維持。
  const allLocked = {};
  for (const u of cur) allLocked[u] = { kind: 'pool', target: 0 };
  r = ctx.enforceSeedLocks(cur, allLocked, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r.overflow).map(o => ({ kind: o.kind, target: o.target, cap: o.cap, want: o.want })),
    [{ kind: 'pool', target: 0, cap: 4, want: 8 }]);
  assert.deepStrictEqual(arr(r.order).sort((a, b) => a - b), cur);
  // 誰が反映されなかったか (dropped) が分かる。枠 4 に 8 人なので 4 人。
  assert.strictEqual(arr(r.overflow[0].dropped).length, 4);
  assert.ok(arr(r.overflow[0].dropped).every(u => cur.includes(u)), 'dropped は参加者 uid');
  assert.strictEqual(arr(r.overflow[0].uids).length, 8, 'uids は対象に固定した全員');
  // 枠に収まる固定は枠不足があっても活かす (以前は全部諦めていた)。
  const mixed = { 1: { kind: 'pool', target: 1 }, 2: { kind: 'pool', target: 1 },
                  3: { kind: 'pool', target: 1 }, 4: { kind: 'pool', target: 1 },
                  5: { kind: 'pool', target: 1 }, 8: { kind: 'pool', target: 0 } };
  r = ctx.enforceSeedLocks(cur, mixed, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r.overflow).map(o => ({ kind: o.kind, target: o.target, cap: o.cap, want: o.want })),
    [{ kind: 'pool', target: 1, cap: 4, want: 5 }]);
  const ord = arr(r.order);
  assert.strictEqual(poolOf(ord.indexOf(8), 2), 0, 'pool0 固定 (枠に余裕あり) は守られる');
  const inP1 = [1, 2, 3, 4, 5].filter(u => poolOf(ord.indexOf(u), 2) === 1).length;
  assert.strictEqual(inP1, 4, 'pool1 の枠 4 は埋まる (溢れた 1 人だけ諦める)');
  assert.strictEqual(arr(r.overflow[0].dropped).length, 1, '諦めたのは 1 人だけ');
  // 固定なし → 恒等・警告なし (何も指定していないのに警告が出ないこと)。
  r = ctx.enforceSeedLocks(cur, {}, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r.order), cur);
  assert.deepStrictEqual(arr(r.overflow), []);
  // 対象がもう存在しない固定 (プール数/ウェーブ数を減らした後) は cap 0 で報告。
  r = ctx.enforceSeedLocks(cur, { 3: { kind: 'pool', target: 5 } }, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r.overflow).map(o => ({ kind: o.kind, target: o.target, cap: o.cap, want: o.want })),
    [{ kind: 'pool', target: 5, cap: 0, want: 1 }]);
  assert.deepStrictEqual(arr(r.overflow[0].dropped), [3], '対象が無いときは全員 dropped');
  assert.deepStrictEqual(arr(r.order).sort((a, b) => a - b), cur, 'permutation は維持');
  r = ctx.enforceSeedLocks(cur, { 3: { kind: 'wave', target: 1 } }, 2, [0, 0], poolOf);
  assert.deepStrictEqual(arr(r.overflow).map(o => ({ cap: o.cap, want: o.want })), [{ cap: 0, want: 1 }]);
});

test('app: 作業状況CSV は往復できる (エクスポート → インポートで順序と固定を再現)', () => {
  // エクスポート行の生成とインポート側の解釈を、実ソースの純関数で突き合わせる。
  const ctx = extractFns(['_csvNormName', '_csvNormDisc', '_csvPick', '_csvRecLookups',
                          '_csvMatchRow', 'isCsvTemplateSample', 'parseWaveValue', 'parseFixValue',
                          'buildSpecOrder', 'enforceSeedLocks', 'waveLetter', 'poolLabel']);
  ctx.CSV_NAME_COLS = ['player', 'name', 'display', 'tag', 'プレイヤー', '名前'];
  ctx.CSV_DISC_COLS = ['discriminator', 'disc'];
  ctx.CSV_SEAT_COLS = ['seednum', 'seed_num', 'seed', 'phaseseed', 'phase_seed', '順位', 'シード'];
  ctx.CSV_TPL_NAMES = ['Taro Yamada', 'Hanako Suzuki'];
  ctx.canonicalUserId = (u) => u;
  ctx.DISCRIMINATORS = null;
  const P = 4, waveMap = [0, 0, 1, 1];
  const poolOf = (s, PP) => SO.poolOfSeed(s, PP);
  // 参加者 8 人。作業後の並び (= エクスポートされる順) と固定 2 人。
  const worked = [3, 1, 4, 8, 2, 6, 5, 7];
  ctx.DATA = worked.map((u) => ({ user_id: u, display: 'P' + u, discriminator: 'aaaa000' + u }));
  const locks = { 4: { kind: 'pool', target: 2 }, 6: { kind: 'wave', target: 1 } };
  // エクスポート相当の行 (exportSeedWorkCsv と同じ列)。
  const rows = worked.map((u, i) => ({
    seed: String(i + 1), name: 'P' + u, discriminator: 'aaaa000' + u, uid: String(u),
    lock: locks[u] ? (locks[u].kind) : '',
    pool: ctx.poolLabel(poolOf(i, P), waveMap),
    pools: i === 0 ? String(P) : '', waves: i === 0 ? '2' : '',
  }));
  // インポート側の解釈 (applySpecRows と同じ手順の要点)。
  const lk = ctx._csvRecLookups();
  const pins = new Map(), lockObjs = {};
  for (const row of rows) {
    assert.strictEqual(ctx.isCsvTemplateSample(row), false, '実データが記入例と誤判定されない');
    const m = ctx._csvMatchRow(row, lk);
    assert.ok(m.rec, '照合できる: ' + row.name);
    const seat = parseInt(ctx._csvPick(row, ctx.CSV_SEAT_COLS), 10);
    pins.set(m.rec.user_id, seat);
    const fx = ctx.parseFixValue(ctx._csvPick(row, ['固定', 'fix', 'lock', 'pin']), false);
    if (fx) lockObjs[m.rec.user_id] = fx;
  }
  // 順序が完全に再現される (CSV の seed 順)。
  const r = ctx.buildSpecOrder(worked.slice().sort((a, b) => a - b), [...pins], [], P, waveMap, poolOf);
  assert.deepStrictEqual(arr(r.order), worked, 'seed 列から元の並びが復元される');
  // 固定の種別も復元される。
  assert.deepStrictEqual({ ...lockObjs }, { 4: 'pool', 6: 'wave' });
  // 固定の対象は復元後の位置から決まり、元の対象と一致する。
  const posOf = (u) => arr(r.order).indexOf(u);
  assert.strictEqual(poolOf(posOf(4), P), 2, 'uid4 は元と同じプール');
  assert.strictEqual(waveMap[poolOf(posOf(6), P)], 1, 'uid6 は元と同じウェーブ');
  // pools / waves 列は 1 行目にだけ入る (インポート側は最初の非空を読む)。
  assert.strictEqual(rows.filter(x => x.pools !== '').length, 1);
});

test('静的: 作業状況の CSV エクスポートと適用順の配線', () => {
  assert.ok(/id="spec-export"/.test(APP_SRC) && /getElementById\('spec-export'\)/.test(APP_SRC),
    'エクスポートボタンが無い');
  // 保存ボタンは手動調整バーの上 (work-bar) に常時見える位置。
  const skel = APP_SRC.slice(0, APP_SRC.indexOf('const SEED_APP_CONFIG'));
  assert.ok(skel.indexOf('id="work-bar"') > 0 &&
    skel.indexOf('id="work-bar"') < skel.indexOf('id="manual-bar"'),
    '保存ボタンが手動調整バーより上にない');
  assert.ok(/id="work-bar"/.test(APP_SRC) && /getElementById\('work-bar'\)/.test(APP_SRC),
    'work-bar の表示切替が無い');
  assert.ok(/function exportSeedWorkCsv\(/.test(APP_SRC), 'exportSeedWorkCsv が無い');
  // インポート側の列と一致するヘッダを出す。
  assert.ok(/'seed,name,discriminator,uid,lock,pool,pools,waves'/.test(APP_SRC), 'エクスポート列が想定と違う');
  // 被り回避は「最後に別枠でかける処理」: 手動編集の再開で base に畳み込まない。
  const unlock = APP_SRC.slice(APP_SRC.indexOf('function manualUnlock('), APP_SRC.indexOf('function manualCommit('));
  assert.ok(!/} else if \(APPLIED_ORDER\) \{/.test(unlock),
    '被り回避の結果が手動調整の基準に畳み込まれている');
  assert.ok(/dropAppliedOrder\(/.test(unlock), '再編集で被り回避の反映が解除されない');
  const csvApply = APP_SRC.slice(APP_SRC.indexOf('function applyCsvOrderIfReady('),
                                 APP_SRC.indexOf('async function buildParticipantsFromCsv('));
  assert.ok(/dropAppliedOrder\(/.test(csvApply), 'CSV 読み込みで被り回避の反映が解除されない');
  // 共有した CSV でプール数/ウェーブ数も揃う。
  assert.ok(/\['pools', 'so-pools', 'プール数'\]/.test(APP_SRC), 'pools/waves 列の反映が無い');
});
