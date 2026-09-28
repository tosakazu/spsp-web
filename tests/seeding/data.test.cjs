'use strict';
// seed_data.js のユニットテスト（fetch 注入で決定的に検証）。
const test = require('node:test');
const assert = require('node:assert');
const D = ((m) => m.default || m)(require('../../site/seeding/seed_data.js'));
// 地域まとめの定義は geo.json (本番の site/data/geo.json の写し)。
D.setGeoCatalog(require('./fixtures/geo_jp.json'));

// todayDays を固定（2026-06-23 相当）。
const TODAY = D.dateToDays('2026-06-23');

function makePlayer(uid, matches, tournaments) {
  return { user_id: uid, recent_matches: matches || [], tournaments: tournaments || [] };
}

test('dateToDays: 1日差は1', () => {
  assert.strictEqual(D.dateToDays('2026-06-23') - D.dateToDays('2026-06-22'), 1);
});

test('recentPair: 同一マッチを二重計上しない & 半減期で減衰', async () => {
  // a=1, b=2 が 1試合(本日, nent=4)。log2(4)=2, decay=1 → penalty=2。
  const players = {
    1: makePlayer(1, [{ opp_uid: 2, date: '2026-06-23', event_id: 100 }], [{ event_id: 100, nent: 4 }]),
    2: makePlayer(2, [{ opp_uid: 1, date: '2026-06-23', event_id: 100 }], [{ event_id: 100, nent: 4 }]),
  };
  const data = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, sizeWeight: 'log2' },
  });
  assert.ok(Math.abs(data.recentPair['1:2'] - 2) < 1e-9, JSON.stringify(data.recentPair));
  assert.strictEqual(data.recentMeta['1:2'].count, 1);   // 二重計上なし
  assert.strictEqual(data.recentMeta['1:2'].lastDate, '2026-06-23');
});

test('recentMeta: 最終対戦の大会名・規模を記録（新しい試合が上書き）', async () => {
  // 古い試合(大会A, nent=64) → 新しい試合(大会B, nent=16)。lastTournament/lastNent は新しい方。
  const players = {
    1: makePlayer(1, [
      { opp_uid: 2, date: '2026-05-01', event_id: 100, tournament_name: '大会A' },
      { opp_uid: 2, date: '2026-06-20', event_id: 200, tournament_name: '大会B' },
    ], [{ event_id: 100, nent: 64 }, { event_id: 200, nent: 16 }]),
    2: makePlayer(2, [], []),
  };
  const data = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, sizeWeight: 'log2' },
  });
  const meta = data.recentMeta['1:2'];
  assert.strictEqual(meta.lastDate, '2026-06-20');
  assert.strictEqual(meta.lastTournament, '大会B');
  assert.strictEqual(meta.lastNent, 16);
  // tournament_name / nent が無いデータでも落ちない（null のまま）。
  const players2 = {
    1: makePlayer(1, [{ opp_uid: 2, date: '2026-06-23', event_id: 300 }], []),
    2: makePlayer(2, [], []),
  };
  const d2 = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players2[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY },
  });
  assert.strictEqual(d2.recentMeta['1:2'].lastTournament, null);
  assert.strictEqual(d2.recentMeta['1:2'].lastNent, null);
});

test('ペア内集計: 既定max=最重1試合 / sum=合算（複数対戦）', async () => {
  // 1×2 が 2試合: 本日(nent=4 → log2(4)=2) と 当日(nent=16 → log2(16)=4)。
  // max → 4（重い方）, sum → 6（合算）。
  const mk = () => ({
    1: makePlayer(1, [
      { opp_uid: 2, date: '2026-06-23', event_id: 100 },
      { opp_uid: 2, date: '2026-06-23', event_id: 200 },
    ], [{ event_id: 100, nent: 4 }, { event_id: 200, nent: 16 }]),
    2: makePlayer(2, [], []),
  });
  const base = (players, agg) => ({
    fetchPlayer: async (u) => players[u], fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, sizeWeight: 'log2', recentAgg: agg },
  });
  const dMax = await D.buildSeedData([1, 2], base(mk()));            // 既定（recentAgg省略でもmax）
  assert.ok(Math.abs(dMax.recentPair['1:2'] - 4) < 1e-9, 'max=最重1試合: ' + JSON.stringify(dMax.recentPair));
  assert.ok(Math.abs(dMax.recentMeta['1:2'].penalty - 4) < 1e-9);
  assert.strictEqual(dMax.recentMeta['1:2'].count, 2);              // count は両試合分
  const dSum = await D.buildSeedData([1, 2], base(mk(), 'sum'));
  assert.ok(Math.abs(dSum.recentPair['1:2'] - 6) < 1e-9, 'sum=合算: ' + JSON.stringify(dSum.recentPair));
  assert.ok(Math.abs(dSum.recentMeta['1:2'].penalty - 6) < 1e-9);
  // 既定が max であること（明示しないとき）。
  assert.strictEqual(D.DEFAULT_DATA_PARAMS.recentAgg, 'max');
});

test('減衰: 制御点の折れ線（1ヶ月までフル / 3ヶ月0.5 / 半年0.25 / 1年0）', () => {
  const f = D.recentDecayFn([[0, 1], [30, 1], [91, 0.5], [182.5, 0.25], [365, 0]]);
  assert.strictEqual(f(0), 1);                 // 当日
  assert.strictEqual(f(30), 1);                // 1ヶ月までフル
  assert.ok(Math.abs(f(91) - 0.5) < 1e-9);     // 3ヶ月
  assert.ok(Math.abs(f(182.5) - 0.25) < 1e-9); // 半年
  assert.strictEqual(f(365), 0);               // 1年で0
  assert.strictEqual(f(400), 0);               // 以降も0
  // 1ヶ月以内はフル
  assert.strictEqual(f(15), 1);
  // 単調非増加
  assert.ok(f(30) >= f(60) && f(100) > f(200) && f(200) > f(300));
});

test('recentPair: 1ヶ月以内=フル・半年=1/4・1年で0（既定）', async () => {
  const mk = (date) => ({
    1: makePlayer(1, [{ opp_uid: 2, date, event_id: 100 }], [{ event_id: 100, nent: 4 }]),
    2: makePlayer(2, [], []),
  });
  const opt = (players) => ({ fetchPlayer: async (u) => players[u], fetchPrefs: async () => ({}), params: { todayDays: TODAY, sizeWeight: 'log2' } });
  // 当日 → 重み1: log2(4)=2
  const d0 = await D.buildSeedData([1, 2], opt(mk('2026-06-23')));
  assert.ok(Math.abs(d0.recentPair['1:2'] - 2) < 1e-9, JSON.stringify(d0.recentPair));
  // 半年(182〜183日)前 → 重み≈0.25: 2×0.25=0.5
  const d1 = await D.buildSeedData([1, 2], opt(mk('2025-12-22')));
  assert.ok(Math.abs(d1.recentPair['1:2'] - 0.5) < 0.03, JSON.stringify(d1.recentPair));
  // 365日前 → 0（エントリなし）
  const d2 = await D.buildSeedData([1, 2], opt(mk('2025-06-23')));
  assert.deepStrictEqual(d2.recentPair, {});
});

test('非出場者との対戦は無視', async () => {
  const players = {
    1: makePlayer(1, [{ opp_uid: 999, date: '2026-06-23', event_id: 100 }], [{ event_id: 100, nent: 8 }]),
  };
  const data = await D.buildSeedData([1], {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY },
  });
  assert.deepStrictEqual(data.recentPair, {});
});

test('都道府県: prefByUid と prefCounts（グルーピングなしの県）', async () => {
  const data = await D.buildSeedData([1, 2, 3], {
    fetchPlayer: async () => ({ __missing: true }),
    fetchPrefs: async () => ({ '1': '兵庫県', '2': '兵庫県', '3': '大阪府' }),
    regionGroups: D.buildRegionGroups({ keihanshin: false }),   // 既定 (地域の設定) は京阪神もまとめる
    params: { todayDays: TODAY },
  });
  assert.deepStrictEqual(data.prefByUid, { 1: '兵庫県', 2: '兵庫県', 3: '大阪府' });
  assert.deepStrictEqual(data.prefCounts, { 兵庫県: 2, 大阪府: 1 });
});

test('地域グルーピング: 南関東(埼玉/千葉/神奈川/東京)を同一扱い', async () => {
  const data = await D.buildSeedData([1, 2, 3, 4, 5], {
    fetchPlayer: async () => ({ __missing: true }),
    fetchPrefs: async () => ({ '1': '東京都', '2': '神奈川県', '3': '埼玉県', '4': '千葉県', '5': '大阪府' }),
    regionGroups: D.buildRegionGroups({ keihanshin: false }),
    params: { todayDays: TODAY },
  });
  // 4県は '南関東' に統合され、prefCounts は1グループ4名。
  assert.deepStrictEqual(data.prefByUid, { 1: '南関東', 2: '南関東', 3: '南関東', 4: '南関東', 5: '大阪府' });
  assert.deepStrictEqual(data.prefCounts, { 南関東: 4, 大阪府: 1 });
});

test('buildRegionGroups: 既定は geo.json の seed_groups.default (南関東・京阪神とも ON)', () => {
  const g = D.buildRegionGroups();
  assert.strictEqual(g['東京都'], '南関東');
  assert.strictEqual(g['神奈川県'], '南関東');
  assert.strictEqual(g['兵庫県'], '京阪神');
  assert.strictEqual(g['大阪府'], '京阪神');
  assert.strictEqual(g['北海道'], undefined);
  assert.deepStrictEqual(D.regionGroupDefs().map((x) => x.id), ['minamiKanto', 'keihanshin']);
  // 明示指定と一致。
  assert.deepStrictEqual(D.buildRegionGroups(), D.buildRegionGroups({ minamiKanto: true, keihanshin: true }));
});

test('buildRegionGroups: geo.json 未読込なら黙って空にせず throw する / 県名を直書きしない', () => {
  const fs = require('fs'), path = require('path'), vm = require('vm');
  const src = fs.readFileSync(path.resolve(__dirname, '../../site/seeding/seed_data.js'), 'utf8');
  assert.ok(!/北海道|東京都|大阪府/.test(src), 'seed_data.js に県名が直書きされている');
  // 別インスタンス (GEO 未設定)
  const ctx = { console, SPSPI18n: { pick: (o) => o && o.ja } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(require('../helpers/built.cjs').built('seeding/seed_data.js'), ctx);
  assert.throws(() => ctx.SeedData.buildRegionGroups(), /geo\.json 未読込/);
  assert.deepStrictEqual([...ctx.SeedData.regionGroupDefs()], []);
});

test('buildRegionGroups: トグルで南関東 OFF / 京阪神 ON を切替', () => {
  const g = D.buildRegionGroups({ minamiKanto: false, keihanshin: true });
  assert.strictEqual(g['東京都'], undefined);    // 南関東 OFF → グルーピングなし
  assert.strictEqual(g['兵庫県'], '京阪神');
  assert.strictEqual(g['大阪府'], '京阪神');
  assert.strictEqual(g['京都府'], '京阪神');
  // 両方 ON。
  const both = D.buildRegionGroups({ keihanshin: true });
  assert.strictEqual(both['東京都'], '南関東');
  assert.strictEqual(both['大阪府'], '京阪神');
});

test('buildSeedData: 京阪神グルーピングを regionGroups で適用', async () => {
  const data = await D.buildSeedData([1, 2, 3], {
    fetchPlayer: async () => ({ __missing: true }),
    fetchPrefs: async () => ({ '1': '兵庫県', '2': '大阪府', '3': '京都府' }),
    regionGroups: D.buildRegionGroups({ keihanshin: true }),
    params: { todayDays: TODAY },
  });
  assert.deepStrictEqual(data.prefByUid, { 1: '京阪神', 2: '京阪神', 3: '京阪神' });
  assert.deepStrictEqual(data.prefCounts, { 京阪神: 3 });
});

test('動作: 地域グルーピングのトグルが分離対象を切り替える（buildSeedData→optimize）', async () => {
  const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));
  const ranking = [1, 2, 3, 4, 5, 6, 7, 8];
  // 南関東ペア=uid1(seed1,固定)&uid5(seed5,可動)、京阪神ペア=uid2(seed2,固定)&uid7(seed7,可動)。
  // 2ペアは独立した可動行(row2/row3)に置き、片方の分離が他方に波及しないようにする。
  const prefs = { '1': '東京都', '5': '神奈川県', '2': '大阪府', '7': '兵庫県' };
  const sp = (order, a, b) => O.poolsFromSeedOrder(order, 2).some((p) => p.includes(a) && p.includes(b));
  const pipeline = async (regionGroups) => {
    const b = await D.buildSeedData(ranking, {
      fetchPlayer: async () => ({ __missing: true }), fetchPrefs: async () => prefs,
      regionGroups, params: { todayDays: TODAY },
    });
    return O.optimize({
      poolCount: 2, format: 'DOUBLE_ELIMINATION', ranking,
      prefByUid: b.prefByUid, prefCounts: b.prefCounts, recentPair: b.recentPair, recentMeta: b.recentMeta,
      params: { rngSeed: 1 },
    }, {}).seedOrder;
  };
  // グルーピングなし → 両ペアとも別都道府県扱い＝罰則0＝基準のまま同プール。
  const none = await pipeline({});
  assert.ok(sp(none, 1, 5) && sp(none, 2, 7), '前提: グルーピングなしは両ペア同プール');
  // 南関東のみ ON → 1&5(→南関東)分離・2&7(大阪/兵庫のまま)残存。
  const mk = await pipeline(D.buildRegionGroups({ minamiKanto: true, keihanshin: false }));
  assert.strictEqual(sp(mk, 1, 5), false, '南関東ペアは分離');
  assert.strictEqual(sp(mk, 2, 7), true, '京阪神ペアは未グルーピングで残存');
  // 京阪神のみ ON（南関東 OFF）→ 2&7(→京阪神)分離・1&5(東京/神奈川のまま)残存。
  const kh = await pipeline(D.buildRegionGroups({ minamiKanto: false, keihanshin: true }));
  assert.strictEqual(sp(kh, 2, 7), false, '京阪神ペアは分離');
  assert.strictEqual(sp(kh, 1, 5), true, '南関東ペアは未グルーピングで残存');
});

test('地域グルーピングは差し替え可能（regionGroups 指定）', async () => {
  const data = await D.buildSeedData([1, 2], {
    fetchPlayer: async () => ({ __missing: true }),
    fetchPrefs: async () => ({ '1': '東京都', '2': '神奈川県' }),
    regionGroups: {},   // グルーピングなし
    params: { todayDays: TODAY },
  });
  assert.deepStrictEqual(data.prefByUid, { 1: '東京都', 2: '神奈川県' });
});

test('フォールバック禁止: 404 は missing、通信エラーは errors（黙ってスキップしない）', async () => {
  const players = {
    1: makePlayer(1, [], []),
    2: { __missing: true },              // DB 未登録
  };
  const data = await D.buildSeedData([1, 2, 3], {
    fetchPlayer: async (u) => {
      if (u === 3) throw new Error('HTTP 500');   // 通信エラー
      return players[u];
    },
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY },
  });
  assert.deepStrictEqual(data.meta.missing, [2]);
  assert.strictEqual(data.meta.errors.length, 1);
  assert.strictEqual(data.meta.errors[0].uid, 3);
  assert.strictEqual(data.meta.withPlayerJson, 1);   // uid1 のみ
});

test('buildSeedData の出力は optimizer にそのまま渡せる', async () => {
  const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));
  const players = {};
  for (let i = 1; i <= 8; i++) players[i] = makePlayer(i, [], []);
  // 1,2 が直近対戦
  players[1] = makePlayer(1, [{ opp_uid: 2, date: '2026-06-23', event_id: 9 }], [{ event_id: 9, nent: 16 }]);
  const data = await D.buildSeedData([1, 2, 3, 4, 5, 6, 7, 8], {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({ '3': '東京都', '6': '東京都' }),
    params: { todayDays: TODAY },
  });
  const r = O.optimize({
    poolCount: 2, format: 'DOUBLE_ELIMINATION',
    ranking: [1, 2, 3, 4, 5, 6, 7, 8],
    prefByUid: data.prefByUid, prefCounts: data.prefCounts,
    recentPair: data.recentPair, recentMeta: data.recentMeta,
    params: { rngSeed: 1 },
  }, {});
  assert.ok(r.seedOrder.length === 8);
  assert.ok(r.report.after.total <= r.report.before.total + 1e-9);
});

// ───────── レビュー修正の回帰テスト（両方向スキャン / prefsOptional） ─────────

test('直対: 低uid側が404(DB未登録)でも高uid側の記録から罰則を拾う', async () => {
  // uid1 は DB 未登録。uid2 のファイルにだけ対戦記録がある。
  // 旧実装(a<opp の片側スキャン)ではこのケースで罰則が消えていた。
  const players = {
    2: makePlayer(2, [{ opp_uid: 1, date: '2026-06-23', event_id: 100 }], [{ event_id: 100, nent: 4 }]),
  };
  const data = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => (players[u] || { __missing: true }),
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, sizeWeight: 'log2' },
  });
  assert.deepStrictEqual(data.meta.missing, [1]);
  assert.ok(Math.abs(data.recentPair['1:2'] - 2) < 1e-9,
    '高uid側の記録が拾えていない: ' + JSON.stringify(data.recentPair));
});

test('直対: 両側記録の同一試合は sum 集計でも二重計上しない（試合キーdedupe）', async () => {
  // 同一試合が両者のファイルに載る通常ケース + 別ラウンドの再戦1試合。
  const mkMatch = (opp, round, text) => ({ opp_uid: opp, date: '2026-06-23', event_id: 100, round, round_text: text });
  const players = {
    1: makePlayer(1, [mkMatch(2, 2, 'Winners Round 2'), mkMatch(2, -3, 'Losers Final')], [{ event_id: 100, nent: 4 }]),
    2: makePlayer(2, [mkMatch(1, 2, 'Winners Round 2'), mkMatch(1, -3, 'Losers Final')], [{ event_id: 100, nent: 4 }]),
  };
  const data = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, sizeWeight: 'log2', recentAgg: 'sum' },
  });
  // 実試合は2試合 → sum で 2+2=4（両側記録で 8 になったら二重計上）。
  assert.ok(Math.abs(data.recentPair['1:2'] - 4) < 1e-9, JSON.stringify(data.recentPair));
  assert.strictEqual(data.recentMeta['1:2'].count, 2);
});

test('prefsOptional: fetchPrefs 失敗を非致命化し meta.prefsError に載せる（既定は throw）', async () => {
  const boom = async () => { throw new Error('player_prefectures.json HTTP 404'); };
  const fetchPlayer = async () => ({ __missing: true });
  // 既定: 従来どおり throw（fail-loud）。
  await assert.rejects(
    D.buildSeedData([1], { fetchPlayer, fetchPrefs: boom, params: { todayDays: TODAY } }),
    /404/);
  // prefsOptional: 続行して meta.prefsError で明示。
  const data = await D.buildSeedData([1], {
    fetchPlayer, fetchPrefs: boom, prefsOptional: true, params: { todayDays: TODAY } });
  assert.match(data.meta.prefsError, /404/);
  assert.strictEqual(data.meta.prefIdentified, 0);
});

// ───────── excludeWeekday（平日大会の対戦を考慮しない） ─────────
test('excludeWeekday: 平日扱いの大会を除外・休日は残す・is_weekend 不明は残す', async () => {
  // 1×2: 休日大会(nent=4) + 平日扱い大会(nent=64, より重い)。1×3: is_weekend 不明の大会。
  // 両側の JSON に同一試合が載る（dedup 後のユニーク試合単位で除外カウント）。
  const m100 = { opp_uid: 2, date: '2026-06-23', event_id: 100 };
  const m200 = { opp_uid: 2, date: '2026-06-23', event_id: 200 };
  const m300 = { opp_uid: 3, date: '2026-06-23', event_id: 300 };
  const players = {
    1: makePlayer(1, [m100, m200, m300], [
      { event_id: 100, nent: 4, is_weekend: true },
      { event_id: 200, nent: 64, is_weekend: false },
    ]),
    2: makePlayer(2, [
      { opp_uid: 1, date: '2026-06-23', event_id: 100 },
      { opp_uid: 1, date: '2026-06-23', event_id: 200 },
    ], [
      { event_id: 100, nent: 4, is_weekend: true },
      { event_id: 200, nent: 64, is_weekend: false },
    ]),
    3: makePlayer(3, [], []),
  };
  const opt = (excludeWeekday) => ({
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, sizeWeight: 'log2', excludeWeekday },
  });
  // OFF（既定）: 平日大会 nent=64 が最重 → max 集計で log2(64)=6。除外カウント 0。
  const off = await D.buildSeedData([1, 2, 3], opt(false));
  assert.ok(Math.abs(off.recentPair['1:2'] - 6) < 1e-9, JSON.stringify(off.recentPair));
  assert.strictEqual(off.meta.weekdayExcludedMatches, 0);
  // ON: 平日分は除外 → 休日 nent=4 の log2(4)=2 のみ。不明(event 300)は残る。
  const on = await D.buildSeedData([1, 2, 3], opt(true));
  assert.ok(Math.abs(on.recentPair['1:2'] - 2) < 1e-9, JSON.stringify(on.recentPair));
  assert.ok(on.recentPair['1:3'] > 0, 'is_weekend 不明の大会が消えている');
  assert.strictEqual(on.meta.weekdayExcludedMatches, 1);   // ユニーク試合単位
});

test('excludeWeekday: 大会情報が相手側 JSON にしか無くても対称に除外される', async () => {
  // uid=1 の tournaments[] には event 200 が無いが、uid=2 側に is_weekend=false がある。
  const players = {
    1: makePlayer(1, [{ opp_uid: 2, date: '2026-06-23', event_id: 200 }], []),
    2: makePlayer(2, [], [{ event_id: 200, nent: 8, is_weekend: false }]),
  };
  const data = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, excludeWeekday: true },
  });
  assert.strictEqual(data.recentPair['1:2'], undefined);
  assert.strictEqual(data.meta.weekdayExcludedMatches, 1);
});

test('excludeWeekday: 既定 OFF では weekdayExcludedMatches=0 で従来と同一の集計', async () => {
  const players = {
    1: makePlayer(1, [{ opp_uid: 2, date: '2026-06-23', event_id: 100 }],
      [{ event_id: 100, nent: 4, is_weekend: false }]),
    2: makePlayer(2, [], []),
  };
  const data = await D.buildSeedData([1, 2], {
    fetchPlayer: async (u) => players[u],
    fetchPrefs: async () => ({}),
    params: { todayDays: TODAY },
  });
  assert.ok(Math.abs(data.recentPair['1:2'] - 2) < 1e-9);   // log2(4)=2（平日でも既定は考慮）
  assert.strictEqual(data.meta.weekdayExcludedMatches, 0);
});

test('excludeWeekday: レポート(residualConcerns)からも平日大会の対戦が消える（buildSeedData→optimize）', async () => {
  const O = ((m) => m.default || m)(require('../../site/seeding/seed_optimizer.js'));
  // uid1×uid2 は「平日扱いの大会での対戦」しか無い。P=1 の同プールに全員入る。
  const players = {
    1: makePlayer(1, [{ opp_uid: 2, date: '2026-06-22', event_id: 200 }],
      [{ event_id: 200, nent: 64, is_weekend: false }]),
    2: makePlayer(2, [], [{ event_id: 200, nent: 64, is_weekend: false }]),
    3: makePlayer(3, [], []), 4: makePlayer(4, [], []),
  };
  const pipeline = async (excludeWeekday) => {
    const b = await D.buildSeedData([1, 2, 3, 4], {
      fetchPlayer: async (u) => players[u], fetchPrefs: async () => ({}),
      params: { todayDays: TODAY, excludeWeekday },
    });
    const r = O.optimize({
      poolCount: 1, format: 'DOUBLE_ELIMINATION', ranking: [1, 2, 3, 4],
      prefByUid: b.prefByUid, prefCounts: b.prefCounts,
      recentPair: b.recentPair, recentMeta: b.recentMeta,
      params: { rngSeed: 1, restarts: 2, maxIters: 200 },
    }, {});
    const top = r.report.residualConcerns.intra.recent.top;
    return { keys: top.map((c) => (c.a < c.b ? c.a + ':' + c.b : c.b + ':' + c.a)), report: r.report };
  };
  // OFF: 平日対戦もレポートに載る（前提確認）。
  const off = await pipeline(false);
  assert.ok(off.keys.includes('1:2'), '前提: OFF ならレポートに 1:2 が載るはず');
  // ON: スコアからもレポートからも消える。
  const on = await pipeline(true);
  assert.ok(!on.keys.includes('1:2'), 'excludeWeekday=true なのにレポートに平日対戦 1:2 が残っている');
  assert.strictEqual(on.report.residualConcerns.intra.recent.pairs, 0);
});

test('recentMeta.matches: ペアの対戦履歴を新しい順で記録（両側dedup / excludeWeekday 反映）', async () => {
  const players = {
    1: makePlayer(1, [
      { opp_uid: 2, date: '2026-05-01', event_id: 100, tournament_name: '大会A' },
      { opp_uid: 2, date: '2026-06-20', event_id: 200, tournament_name: '大会B' },
      { opp_uid: 2, date: '2026-06-01', event_id: 300, tournament_name: '平日大会C' },
    ], [
      { event_id: 100, nent: 64, is_weekend: true },
      { event_id: 200, nent: 16, is_weekend: true },
      { event_id: 300, nent: 8, is_weekend: false },
    ]),
    // 両側記録の同一試合（event 200）は 1 件に dedup される。
    2: makePlayer(2, [{ opp_uid: 1, date: '2026-06-20', event_id: 200, tournament_name: '大会B' }],
      [{ event_id: 200, nent: 16, is_weekend: true }]),
  };
  const opt = (excludeWeekday) => ({
    fetchPlayer: async (u) => players[u], fetchPrefs: async () => ({}),
    params: { todayDays: TODAY, excludeWeekday },
  });
  const off = await D.buildSeedData([1, 2], opt(false));
  // series / sameSeries は targetSeries 未指定なので null / false（同シリーズ罰則は後述の専用テスト）。
  assert.deepStrictEqual(off.recentMeta['1:2'].matches, [
    { date: '2026-06-20', tournament: '大会B', nent: 16, series: null, sameSeries: false },
    { date: '2026-06-01', tournament: '平日大会C', nent: 8, series: null, sameSeries: false },
    { date: '2026-05-01', tournament: '大会A', nent: 64, series: null, sameSeries: false },
  ]);
  // excludeWeekday=true なら平日大会C は履歴からも消える。
  const on = await D.buildSeedData([1, 2], opt(true));
  assert.deepStrictEqual(on.recentMeta['1:2'].matches.map((m) => m.tournament), ['大会B', '大会A']);
});
