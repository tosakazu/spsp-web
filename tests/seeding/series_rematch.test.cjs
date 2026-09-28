'use strict';
// 同シリーズ再マッチ罰則のテスト。
//   - シリーズ判定 (tournaments.json の正解表 → 未取り込みは大会名から推定)
//   - データ層: 同シリーズ分だけを別枠で集計 (seriesPair / seriesCount / matches[].sameSeries)
//   - 罰則: 倍率 (既定) / 加算 の両方式と fail-loud なパラメータ検証
//   - レポート: 同シリーズで対戦済のペア数
const test = require('node:test');
const assert = require('node:assert');
const D = ((m) => m.default || m)(require('../../site/seeding/seed_data.js'));
D.setGeoCatalog(require('./fixtures/geo_jp.json'));   // 地域まとめの定義 (buildSeedData の既定に要る)
const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));

const TODAY = D.dateToDays('2026-06-23');
const mkPlayer = (uid, matches, tours) => ({ user_id: uid, recent_matches: matches || [], tournaments: tours || [] });

// event_id → シリーズの正解表。100/101 = 篝火、200 = ウメブラ、300 = シリーズ未登録。
const TOURNAMENTS = {
  tournaments: [
    { event_id: 100, tournament_name: '篝火 #9 / Kagaribi #9', series: '篝火' },
    { event_id: 101, tournament_name: '篝火 #10 / Kagaribi #10', series: '篝火' },
    { event_id: 200, tournament_name: 'ウメブラSP30', series: 'ウメブラ' },
    { event_id: 300, tournament_name: '第3回よくわからん杯', series: 'よくわからん杯' },
  ],
};

// ───────── シリーズ判定 ─────────
test('buildSeriesIndex: event_id → シリーズ名 と シリーズ名一覧', () => {
  const idx = D.buildSeriesIndex(TOURNAMENTS);
  assert.strictEqual(idx.seriesOf[100], '篝火');
  assert.strictEqual(idx.seriesOf[200], 'ウメブラ');
  assert.deepStrictEqual(new Set(idx.seriesNames), new Set(['ウメブラ', 'よくわからん杯', '篝火']));
  // 長い名前が先（「極冠ダブルス」を「極冠」より先に当てるため）。
  const lens = idx.seriesNames.map((n) => n.length);
  assert.deepStrictEqual(lens, lens.slice().sort((a, b) => b - a));
});

test('detectSeries: 取り込み済みの大会は event_id で正確に引く', () => {
  const idx = D.buildSeriesIndex(TOURNAMENTS);
  assert.deepStrictEqual(D.detectSeries(idx, 101, '全然ちがう名前'), { series: '篝火', source: 'event_id' });
});

test('detectSeries: 未取り込みの大会は大会名から推定する', () => {
  const idx = D.buildSeriesIndex(TOURNAMENTS);
  // これから開催する 篝火 #12 は event_id が正解表に無い。
  assert.deepStrictEqual(D.detectSeries(idx, 999999, '篝火 #12 / Kagaribi #12'),
    { series: '篝火', source: 'name' });
  // 表記ゆれ (全角空白・引用符・大文字小文字) は正規化して当てる。
  assert.strictEqual(D.detectSeries(idx, null, '　ウメブラ　ＳＰ３１　').series, 'ウメブラ');
});

test('detectSeries: 判定できなければ null（黙って別シリーズを当てない）', () => {
  const idx = D.buildSeriesIndex(TOURNAMENTS);
  assert.deepStrictEqual(D.detectSeries(idx, null, '初開催のなにか'), { series: null, source: null });
  assert.deepStrictEqual(D.detectSeries(idx, null, ''), { series: null, source: null });
});

// ───────── データ層 ─────────
function seriesBundleOpts(players, targetSeries) {
  return {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    fetchTournaments: async () => TOURNAMENTS,
    params: { todayDays: TODAY, targetSeries },
  };
}

test('seriesPair: 対象シリーズの対戦だけを別枠で集計する', async () => {
  // 1×2 は 篝火(100) と ウメブラ(200) で対戦、1×3 は ウメブラ(200) だけ。
  const players = {
    1: mkPlayer(1, [
      { opp_uid: 2, date: '2026-06-20', event_id: 100, tournament_name: '篝火 #9' },
      { opp_uid: 2, date: '2026-06-21', event_id: 200, tournament_name: 'ウメブラSP30' },
      { opp_uid: 3, date: '2026-06-21', event_id: 200, tournament_name: 'ウメブラSP30' },
    ], [{ event_id: 100, nent: 4 }, { event_id: 200, nent: 4 }]),
    2: mkPlayer(2), 3: mkPlayer(3),
  };
  const b = await D.buildSeedData([1, 2, 3], seriesBundleOpts(players, '篝火'));
  assert.ok(b.recentPair['1:2'] > 0 && b.recentPair['1:3'] > 0, '通常の再対戦は両方に付く');
  assert.ok(b.seriesPair['1:2'] > 0, '同シリーズ対戦のあるペアに seriesPair が付く');
  assert.strictEqual(b.seriesPair['1:3'], undefined, '別シリーズだけのペアには付かない');
  assert.strictEqual(b.recentMeta['1:2'].seriesCount, 1);
  assert.strictEqual(b.recentMeta['1:2'].seriesLastDate, '2026-06-20');
  assert.strictEqual(b.recentMeta['1:3'].seriesCount, 0);
  assert.strictEqual(b.meta.targetSeries, '篝火');
  assert.strictEqual(b.meta.seriesPairs, 1);
  assert.strictEqual(b.meta.seriesMatches, 1);
});

test('matches[]: 各対戦にシリーズ名と同シリーズ判定が載る', async () => {
  const players = {
    1: mkPlayer(1, [
      { opp_uid: 2, date: '2026-06-20', event_id: 100, tournament_name: '篝火 #9' },
      { opp_uid: 2, date: '2026-06-21', event_id: 200, tournament_name: 'ウメブラSP30' },
    ], [{ event_id: 100, nent: 4 }, { event_id: 200, nent: 4 }]),
    2: mkPlayer(2),
  };
  const b = await D.buildSeedData([1, 2], seriesBundleOpts(players, '篝火'));
  const ms = b.recentMeta['1:2'].matches;   // 新しい順
  assert.deepStrictEqual(ms.map((m) => [m.series, m.sameSeries]),
    [['ウメブラ', false], ['篝火', true]]);
});

test('targetSeries 未指定なら大会一覧を取りに行かない（既定OFFの機能で3MB取らない）', async () => {
  let fetched = 0;
  const players = { 1: mkPlayer(1, [{ opp_uid: 2, date: '2026-06-20', event_id: 100 }], [{ event_id: 100, nent: 4 }]), 2: mkPlayer(2) };
  const b = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players[u], fetchPrefs: async () => ({}),
    fetchTournaments: async () => { fetched++; return TOURNAMENTS; },
    params: { todayDays: TODAY },
  });
  assert.strictEqual(fetched, 0, 'targetSeries なしで tournaments.json を取得している');
  assert.deepStrictEqual(b.seriesPair, {});
  assert.strictEqual(b.meta.targetSeries, null);
});

test('大会一覧の取得に失敗したら fail-loud（黙って「同シリーズ対戦なし」にしない）', async () => {
  const players = { 1: mkPlayer(1, [{ opp_uid: 2, date: '2026-06-20', event_id: 100 }], [{ event_id: 100, nent: 4 }]), 2: mkPlayer(2) };
  const b = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players[u], fetchPrefs: async () => ({}),
    fetchTournaments: async () => { throw new Error('HTTP 503'); },
    params: { todayDays: TODAY, targetSeries: '篝火' },
  });
  assert.match(b.meta.seriesIndexError, /503/);
  assert.deepStrictEqual(b.seriesPair, {});
});

// ───────── 罰則 ─────────
const PARAMS = (extra) => O.resolveParams(Object.assign({ W_region: 1, W_recent: 0.3 }, extra));

test('倍率方式: 同シリーズで当たっているペアだけ再対戦罰則が倍になる', () => {
  const recentPair = { '1:2': 10, '1:3': 10 };
  const seriesPair = { '1:2': 4 };
  const p = PARAMS({ avoidSeriesRematch: true, seriesMode: 'mult', seriesMult: 3 });
  const pp = O.buildPairPenalty(p, {}, {}, recentPair, seriesPair);
  assert.ok(Math.abs(pp(1, 2) - 0.3 * 10 * 3) < 1e-9, '同シリーズペアが3倍になっていない');
  assert.ok(Math.abs(pp(1, 3) - 0.3 * 10) < 1e-9, '同シリーズでないペアが変わっている');
});

test('加算方式: 同シリーズ分の罰則だけを重み付きで上乗せする', () => {
  const recentPair = { '1:2': 10, '1:3': 10 };
  const seriesPair = { '1:2': 4 };
  const p = PARAMS({ avoidSeriesRematch: true, seriesMode: 'add', W_series: 0.5 });
  const pp = O.buildPairPenalty(p, {}, {}, recentPair, seriesPair);
  assert.ok(Math.abs(pp(1, 2) - (0.3 * 10 + 0.5 * 4)) < 1e-9);
  assert.ok(Math.abs(pp(1, 3) - 0.3 * 10) < 1e-9);
});

test('OFF なら同シリーズ罰則は掛からない（既定OFF）', () => {
  const pp = O.buildPairPenalty(PARAMS({}), {}, {}, { '1:2': 10 }, { '1:2': 4 });
  assert.ok(Math.abs(pp(1, 2) - 0.3 * 10) < 1e-9);
  assert.strictEqual(O.DEFAULT_PARAMS.avoidSeriesRematch, false);
});

test('直接対戦を考慮しない設定では同シリーズ罰則も効かない（上乗せの土台が無い）', () => {
  const p = PARAMS({ avoidRecent: false, avoidSeriesRematch: true, seriesMode: 'mult', seriesMult: 3 });
  const pp = O.buildPairPenalty(p, {}, {}, { '1:2': 10 }, { '1:2': 4 });
  assert.strictEqual(pp(1, 2), 0);
});

test('既定は倍率×3（実データ検証で加算より効率が良かった方）', () => {
  assert.strictEqual(O.DEFAULT_PARAMS.seriesMode, 'mult');
  assert.strictEqual(O.DEFAULT_PARAMS.seriesMult, 3.0);
});

test('パラメータの不正値は fail-loud', () => {
  assert.throws(() => O.resolveParams({ seriesMode: 'multiply' }), /seriesMode/);
  assert.throws(() => O.resolveParams({ seriesMult: 0.5 }), /seriesMult/);
  assert.throws(() => O.resolveParams({ W_series: -1 }), /W_series/);
});

// ───────── 最適化とレポート ─────────
test('同シリーズのペアは別プールに分離され、レポートに件数が出る', () => {
  // 8人2プール。1×8 は篝火で対戦済 (同シリーズ)、それ以外は履歴なし。
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  const input = (extra) => ({
    poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking,
    prefByUid: {}, prefCounts: {},
    recentPair: { '1:8': 5 }, recentMeta: { '1:8': { count: 1, lastDate: '2026-06-20', seriesCount: 1, seriesLastDate: '2026-06-20', matches: [], lastDeltaDays: 3 } },
    seriesPair: { '1:8': 5 }, targetSeries: '篝火',
    params: Object.assign({ mode: 'hillclimb', rngSeed: 7, avoidRegion: false, keepDePlace: false }, extra),
  });
  const on = O.optimize(input({ avoidSeriesRematch: true }));
  assert.strictEqual(on.report.targetSeries, '篝火');
  assert.strictEqual(on.report.seriesRematchOn, true);
  const poolOf = (res, uid) => O.poolOfSeed(res.seedOrder.indexOf(uid), 2);
  assert.notStrictEqual(poolOf(on, 1), poolOf(on, 8), '同シリーズのペアが同プールに残っている');
  assert.strictEqual(on.report.residualConcerns.inter.recent.sameSeriesPairs, 0);

  // OFF でも「同シリーズで対戦済」の件数自体はレポートに出る（気づけるように）。
  const off = O.optimize(input({}));
  assert.strictEqual(off.report.seriesRematchOn, false);
  assert.ok(off.report.residualConcerns.inter.recent.sameSeriesPairs != null);
});

test('スコアの内訳に同シリーズ成分が出る（total にも含まれる）', () => {
  const ranking = [1, 2, 3, 4];
  const res = O.optimize({
    poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking,
    prefByUid: {}, prefCounts: {},
    recentPair: { '1:2': 5 }, recentMeta: {},
    seriesPair: { '1:2': 5 }, targetSeries: 'テスト杯',
    params: { mode: 'hillclimb', rngSeed: 7, avoidRegion: false, avoidSeriesRematch: true, seriesMode: 'mult', seriesMult: 3 },
  });
  assert.ok(res.report.before.interSeries > 0, '同シリーズ成分が計上されていない');
  // 倍率×3 → 上乗せ分は Wn×罰則×(3−1) = 元の2倍。
  const wn = O.DEFAULT_PARAMS.W_recent;
  assert.ok(Math.abs(res.report.before.interSeries - wn * 5 * 2) < 1e-9);
});
