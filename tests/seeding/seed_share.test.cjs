'use strict';
// seed_share.js (トーナメントプレビューの共有コーデック) のテスト。
//   - encode/decode 往復 (CompressionStream: Node 18+ で同一コードパス)
//   - zlib deflateRaw と相互運用できる形式であること
//   - validatePayload / validatePhases の fail-loud
//   - フラグメント parse/build 往復
//   - 作業状況 CSV → ペイロード変換
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
require('../helpers/dicts.cjs').loadDicts();   // エラー文言は辞書 (seed.share.*) から
const S = ((m) => m.default || m)(require('../../site/seeding/seed_share.js'));

function samplePayload(n) {
  n = n || 8;
  const uids = [], names = {};
  for (let i = 0; i < n; i++) {
    if (i % 5 === 4) { uids.push(null); names[String(i)] = 'NoDB' + i; }
    else uids.push(1000000 + i * 37);
  }
  return {
    v: 1, ev: 'テスト大会 / singles', src: 'spsp',
    phases: [{ name: '予選', pools: 2, adv: 2 }, { name: '決勝', pools: 1, adv: 0 }],
    wv: [0, 1],
    uids, names,
  };
}

test('encode → decode 往復でペイロードが一致する', async () => {
  const p = samplePayload(50);
  const blob = await S.encodePayload(p);
  assert.match(blob, /^[A-Za-z0-9_-]+$/, 'base64url のみで構成される');
  const back = await S.decodePayload(blob);
  assert.deepStrictEqual(back, p);
});

test('blob は zlib inflateRaw で解ける (形式互換の保証)', async () => {
  const p = samplePayload(10);
  const blob = await S.encodePayload(p);
  const bytes = S.base64urlToBytes(blob);
  const json = zlib.inflateRawSync(Buffer.from(bytes)).toString('utf8');
  assert.deepStrictEqual(JSON.parse(json), p);
});

test('zlib deflateRaw で作った blob も decodePayload で読める', async () => {
  const p = samplePayload(10);
  const gz = zlib.deflateRawSync(Buffer.from(JSON.stringify(p)));
  const blob = gz.toString('base64url');
  const back = await S.decodePayload(blob);
  assert.deepStrictEqual(back, p);
});

test('validatePayload: 正常系は空配列', () => {
  assert.deepStrictEqual(S.validatePayload(samplePayload(20)), []);
});

test('validatePayload: fail-loud (バージョン/uid重複/名前欠落/wv長さ)', () => {
  assert.ok(S.validatePayload({ v: 2 }).length, '未知バージョン');
  const dup = samplePayload(10); dup.uids[1] = dup.uids[0];
  assert.ok(S.validatePayload(dup).some((e) => e.includes('重複')));
  const noName = samplePayload(10); delete noName.names['4'];
  assert.ok(S.validatePayload(noName).some((e) => e.includes('名前')));
  const badWv = samplePayload(10); badWv.wv = [0];
  assert.ok(S.validatePayload(badWv).some((e) => e.includes('wv')));
});

test('validatePhases: カットにならない進出数・過大プール数を検出', () => {
  assert.deepStrictEqual(S.validatePhases([{ name: '予選', pools: 4, adv: 2 }, { name: 'Top8', pools: 1, adv: 0 }], 32), []);
  assert.ok(S.validatePhases([{ name: '予選', pools: 4, adv: 8 }, { name: 'x', pools: 1, adv: 0 }], 32)
    .some((e) => e.includes('カットになりません')));
  assert.ok(S.validatePhases([{ name: '予選', pools: 64, adv: 2 }], 32)
    .some((e) => e.includes('参加人数')));
  // 単一フェーズは adv を見ない
  assert.deepStrictEqual(S.validatePhases([{ name: 'ブラケット', pools: 1, adv: 0 }], 32), []);
});

test('phaseEntrantCounts: 予選→カットの人数列', () => {
  const phases = [{ name: '予選', pools: 128, adv: 2 }, { name: 'Top256', pools: 8, adv: 4 }, { name: 'Top32', pools: 1, adv: 0 }];
  assert.deepStrictEqual(S.phaseEntrantCounts(phases, 3000), [3000, 256, 32]);
});

test('フラグメント: build → parse 往復', () => {
  const frag = S.buildFragment({ ph: 2, pool: 'A3', wd: 0, lb: 1, hi: null }, 'AbC-_9');
  const r = S.parseFragment(frag);
  assert.strictEqual(r.v, 1);
  assert.deepStrictEqual(r.view, { ph: 2, pool: 'A3', wd: 0, lb: 1, hi: null });
  assert.strictEqual(r.d, 'AbC-_9');
  // 省略時のデフォルト
  const r2 = S.parseFragment('#d=xyz');
  assert.deepStrictEqual(r2.view, { ph: 0, pool: null, wd: 1, lb: 0, hi: null });
  // hi (注目する参加者) も往復する
  assert.strictEqual(S.parseFragment(S.buildFragment({ ph: 1, hi: 7 }, 'x')).view.hi, 7);
});

test('poolLabel / chunkWaveMap は seed_app と同一仕様', () => {
  // ウェーブなし → P3 形式
  assert.strictEqual(S.poolLabel(2, [0, 0, 0, 0]), 'P3');
  // 2 ウェーブ 4 プール → A1 A2 B1 B2
  const wm = S.chunkWaveMap(4, 2);
  assert.deepStrictEqual(wm, [0, 0, 1, 1]);
  assert.deepStrictEqual([0, 1, 2, 3].map((i) => S.poolLabel(i, wm)), ['A1', 'A2', 'B1', 'B2']);
  // 端数は先頭ウェーブに寄る
  assert.deepStrictEqual(S.chunkWaveMap(5, 2), [0, 0, 0, 1, 1]);
});

test('作業状況 CSV → ペイロード (uid/名前/プール数/ウェーブ数/BOM/クォート)', () => {
  const csv = '﻿seed,name,discriminator,uid,lock,pool,pools,waves\r\n'
    + '1,"Shu, ton",="00000123",1000070,,A1,4,2\r\n'
    + '2,NoDB プレイヤー,,,pool,A2,,\r\n'
    + '3,Hurt,,1000214,,B1,,\r\n'
    + '4,Miya,,1000865,,B2,,\r\n';
  const { payload, warnings } = S.workCsvToPayload(csv, { ev: 'test' });
  assert.deepStrictEqual(warnings, []);
  assert.deepStrictEqual(payload.uids, [1000070, null, 1000214, 1000865]);
  assert.strictEqual(payload.names['0'], 'Shu, ton');
  assert.strictEqual(payload.names['1'], 'NoDB プレイヤー');
  assert.strictEqual(payload.phases[0].pools, 4);
  assert.deepStrictEqual(payload.wv, [0, 0, 1, 1]);
  assert.strictEqual(payload.src, 'csv');
});

test('作業状況 CSV: seed 順に並べ替えられる', () => {
  const csv = 'seed,name,uid,pools,waves\n3,C,103,2,1\n1,A,101,,\n2,B,102,,\n';
  const { payload } = S.workCsvToPayload(csv);
  assert.deepStrictEqual(payload.uids, [101, 102, 103]);
});

test('作業状況 CSV: fail-loud (シード重複/uid重複/ヘッダなし)', () => {
  assert.throws(() => S.workCsvToPayload('seed,name,uid\n1,A,101\n1,B,102\n'), /重複/);
  assert.throws(() => S.workCsvToPayload('seed,name,uid\n1,A,101\n2,B,101\n'), /uid が重複/);
  assert.throws(() => S.workCsvToPayload('foo,bar\n1,2\n'), /ヘッダ/);
});

test('buildWorkCsv → workCsvToPayload 往復 (phases/wv/event/view が復元される)', () => {
  const p = samplePayload(12);
  p.phases = [{ name: '予選', pools: 4, adv: 2 }, { name: 'Top 8', pools: 1, adv: 0 }];
  p.wv = [0, 0, 1, 1];
  const csv = S.buildWorkCsv(p, {
    nameOf: (i) => 'なまえ' + i,
    poolLabelOf: (i) => 'A' + (i % 4 + 1),
    view: { ph: 1, pool: 'P1', wd: 0, lb: 1, hi: null },
  });
  const { payload, view } = S.workCsvToPayload(csv);
  assert.deepStrictEqual(payload.uids, p.uids);
  assert.deepStrictEqual(payload.phases, p.phases);
  assert.deepStrictEqual(payload.wv, p.wv);
  assert.strictEqual(payload.ev, p.ev);
  assert.strictEqual(payload.names['0'], 'なまえ0');
  assert.deepStrictEqual(view, { ph: 1, pool: 'P1', wd: 0, lb: 1, hi: null });
});

test('buildWorkCsv: 名前が空でも uid があれば復元できる', () => {
  const p = samplePayload(8);
  const csv = S.buildWorkCsv(p, { nameOf: (i) => (p.names[String(i)] || '') });
  const { payload } = S.workCsvToPayload(csv);
  assert.deepStrictEqual(payload.uids, p.uids);
  // uid なし参加者 (index 4) の名前は必ず残る
  assert.strictEqual(payload.names['4'], p.names['4']);
});

test('phases 列の JSON が壊れていたら fail-loud', () => {
  const csv = 'seed,name,uid,pools,waves,phases\n1,A,101,2,1,"{bad json"\n2,B,102,,,\n';
  assert.throws(() => S.workCsvToPayload(csv), /phases 列の JSON/);
});

test('日本語列名 (順位/名前/プール数/ウェーブ数) も受ける', () => {
  const csv = '順位,名前,uid,プール数,ウェーブ数\n1,ぷれいやー1,201,2,1\n2,ぷれいやー2,202,,\n';
  const { payload } = S.workCsvToPayload(csv);
  assert.deepStrictEqual(payload.uids, [201, 202]);
  assert.strictEqual(payload.phases[0].pools, 2);
});

test('validatePhases: 敗者側スタート人数 (lb) の検証', () => {
  const ok = [{ name: '予選', pools: 4, adv: 2 }, { name: '本戦', pools: 1, adv: 0, lb: 4 }];
  assert.deepStrictEqual(S.validatePhases(ok, 32), []);
  // 1プールの人数から 2 人は勝者側に残る必要がある
  const tooMany = [{ name: '予選', pools: 4, adv: 2 }, { name: '本戦', pools: 1, adv: 0, lb: 8 }];
  assert.ok(S.validatePhases(tooMany, 32).some((e) => /敗者側スタート/.test(e)),
    JSON.stringify(S.validatePhases(tooMany, 32)));
  const neg = [{ name: 'ブラケット', pools: 1, adv: 0, lb: -1 }];
  assert.ok(S.validatePhases(neg, 8).some((e) => /敗者側スタート人数が不正/.test(e)));
});

test('壊れた共有データは原因が分かるメッセージで落ちる', async () => {
  const blob = await S.encodePayload(samplePayload(30));
  // 途中で切れた URL (コピー漏れ) → 「切れている可能性」を伝える
  await assert.rejects(() => S.decodePayload(blob.slice(0, Math.floor(blob.length * 0.6))),
    /途中で切れている/);
  // base64url に無い文字 (改行が残った等)
  await assert.rejects(() => S.decodePayload(blob.slice(0, 20) + '\n' + blob.slice(20)),
    /使えない文字/);
});

test('フラグメントに改行・空白が混ざっても読める', async () => {
  const blob = await S.encodePayload(samplePayload(30));
  const frag = S.buildFragment({ ph: 0, wd: 1 }, blob);
  // ターミナルからのコピペで折り返しの改行が入ったケース
  const broken = frag.slice(0, 40) + '\n  ' + frag.slice(40);
  assert.strictEqual(S.parseFragment(broken).d, blob);
  assert.deepStrictEqual(await S.decodePayload(S.parseFragment(broken).d), samplePayload(30));
});

test('withFinalPhase: 最終フェーズが2プール以上なら次フェーズを足す', () => {
  // 予選8プール2抜け (単一フェーズ) → TOP16 を足す
  const a = S.withFinalPhase([{ name: '予選', pools: 8, adv: 2 }], 64);
  assert.strictEqual(a.length, 2);
  assert.deepStrictEqual(a[1], { name: 'TOP16', pools: 1, adv: 0 });
  assert.deepStrictEqual(S.validatePhases(a, 64), []);
  // 1プールなら足さない
  const b = [{ name: 'ブラケット', pools: 1, adv: 0 }];
  assert.deepStrictEqual(S.withFinalPhase(b, 32), b);
  // 進出人数が無い (最終扱い) なら 2 を補う
  const c = S.withFinalPhase([{ name: '予選', pools: 4, adv: 0 }], 32);
  assert.strictEqual(c[0].adv, 2);
  assert.strictEqual(c[1].name, 'TOP8');
  // カットにならない進出人数は詰める (32人4プール16抜け → 2抜け)
  const d = S.withFinalPhase([{ name: '予選', pools: 4, adv: 16 }], 32);
  assert.ok(d[0].adv * 4 < 32, JSON.stringify(d));
  assert.deepStrictEqual(S.validatePhases(d, 32), []);
  // 1人抜けでもカットにならない構成 (人数 <= プール数) は足しようがないのでそのまま
  const e = [{ name: '予選', pools: 4, adv: 2 }];
  assert.deepStrictEqual(S.withFinalPhase(e, 4), e);
  // 途中フェーズはそのまま (最後だけ見る)
  const f = [{ name: '予選', pools: 8, adv: 2 }, { name: '本戦', pools: 1, adv: 0 }];
  assert.deepStrictEqual(S.withFinalPhase(f, 64), f);
});

// ── データ版 (同じデータを見ているかの突き合わせ) ─────────────────────
// 「ブラケットの中身が同じなら同じ値・違えば違う値」で、見る側の状態では変わらない。
test('データ版: ブラケットを決める要素が変わると変わる', () => {
  const base = {
    v: 1, ev: '篝火 #12', src: 'spsp',
    phases: [{ name: '予選', pools: 4, adv: 2 }, { name: 'Top 8', pools: 1, adv: 1 }],
    wv: [0, 0, 1, 1],
    uids: [11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 122, 133, 144, 155, 166, 177],
    names: { 0: 'A', 1: 'B' },
  };
  const v0 = S.payloadVersion(base);
  assert.match(v0, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, '書式: ' + v0);
  const changed = (mut) => {
    const q = JSON.parse(JSON.stringify(base));
    mut(q);
    return S.payloadVersion(q) !== v0;
  };
  assert.ok(changed((q) => { q.uids = [22, 11, ...q.uids.slice(2)]; }), 'シード順で変わらない');
  assert.ok(changed((q) => { q.phases[0].adv = 3; }), '通過人数で変わらない');
  assert.ok(changed((q) => { q.phases[0].pools = 2; }), 'プール数で変わらない');
  assert.ok(changed((q) => { q.phases[0].name = '予選A'; }), 'フェーズ名で変わらない');
  assert.ok(changed((q) => { q.phases[1].lb = 4; }), '敗者側スタートで変わらない');
  assert.ok(changed((q) => { q.phases.push({ name: 'Top 2', pools: 1, adv: 1 }); }), 'フェーズ追加で変わらない');
  assert.ok(changed((q) => { q.wv = [0, 1, 2, 3]; }), 'ウェーブ割りで変わらない');
  assert.ok(changed((q) => { q.ev = '別大会'; }), '大会名で変わらない');
});

test('データ版: 表示だけの違いでは変わらない', () => {
  const base = {
    v: 1, ev: '篝火 #12', src: 'spsp',
    phases: [{ name: '予選', pools: 4, adv: 2 }, { name: 'Top 8', pools: 1, adv: 1 }],
    wv: [0, 0, 1, 1],
    uids: [11, 22, 33, 44, 55, 66, 77, 88, 99, 111, 122, 133, 144, 155, 166, 177],
    names: { 0: 'A', 1: 'B' },
  };
  const v0 = S.payloadVersion(base);
  const same = (mut) => {
    const q = JSON.parse(JSON.stringify(base));
    mut(q);
    return S.payloadVersion(q) === v0;
  };
  // 名前は URL が長い規模で間引かれるので、含めると同じブラケットで版がズレる。
  assert.ok(same((q) => { q.names = { 0: 'ちがう名前', 5: 'X' }; }), '表示名で版が変わってしまう');
  assert.ok(same((q) => { delete q.names; }), '名前なしで版が変わってしまう');
  // 発行元 (シードページ / CSV) は中身と無関係。
  assert.ok(same((q) => { q.src = 'csv'; }), '発行元で版が変わってしまう');
});

test('データ版: 見る側の状態 (フラグメントの view) は版に影響しない', async () => {
  const payload = {
    v: 1, ev: 'テスト', phases: [{ name: '予選', pools: 4, adv: 2 }, { name: '決勝', pools: 1, adv: 1 }],
    wv: [0, 0, 1, 1],
    uids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  };
  const blob = await S.encodePayload(payload);
  const f1 = S.parseFragment(S.buildFragment({ ph: 0, wd: 1 }, blob));
  const f2 = S.parseFragment(S.buildFragment({ ph: 1, pool: 'B2', wd: 0, lb: 1, hi: 3 }, blob));
  assert.strictEqual(S.payloadVersion(await S.decodePayload(f1.d)),
                     S.payloadVersion(await S.decodePayload(f2.d)));
  // encode → decode の往復でも同じ (共有経路を通しても一致する)。
  assert.strictEqual(S.payloadVersion(await S.decodePayload(blob)), S.payloadVersion(payload));
});

test('データ版: withFinalPhase は冪等 (発行側と閲覧側で版がズレない)', () => {
  const phases = [{ name: '予選', pools: 4, adv: 2 }];
  const once = S.withFinalPhase(phases.map((p) => Object.assign({}, p)), 16);
  const twice = S.withFinalPhase(once.map((p) => Object.assign({}, p)), 16);
  assert.deepStrictEqual(once, twice);
});
