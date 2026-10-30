// tests/frontend/dupe_check.test.cjs — 重複エントリーチェックの計算部分 (js/dupe_check.js、docs/dupe_check_design.md)。データは架空
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { built } = require('../helpers/built.cjs');

function load() {
  const ctx = { console, BigInt };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(built('js/dupe_check.js'), ctx);
  return ctx.SpspDupeCheck;
}
const D = load();
const j = (x) => JSON.parse(JSON.stringify(x));

/** 参加者 1 人 (links = [[type, name, id]]) */
const E = (userId, tag, links = [], extra = {}) => ({ key: 'e' + userId, userId, disc: userId == null ? null : 'd' + userId, tag, prefix: '', location: '', links: links.map(([type, name, id]) => ({ type, name, id: id || null })), ...extra });
/** SPSP の選手レコード (tournaments = [[event_id, date, wins, losses, is_dq]]) */
const P = (rows) => ({ tournaments: rows.map(([event_id, date, wins, losses, is_dq]) => ({ event_id, date, name: 'T' + event_id, event: 'Singles', wins, losses, is_dq: !!is_dq })), recent_matches: [], characters: [] });
const side = (e, rows, pref = null, tourPref = {}) => ({ e, hist: rows ? D.summarize(P(rows), tourPref) : null, pref, sgg: null });
const NOW = Date.UTC(2026, 9, 30);

test('normName: 全角半角・大文字小文字・カタカナ・記号をそろえる', () => {
  assert.strictEqual(D.normName('h_ide'), 'hide');
  assert.strictEqual(D.normName('ヤドン'), D.normName('やどん'));
  assert.strictEqual(D.normName('K.K.'), 'kk');
  assert.strictEqual(D.normName('ＡＢＣ　１'), 'abc1');
  assert.strictEqual(D.normName('ちょこー'), 'ちょこー');
});

test('romaji: 拗音・促音・長音。漢字や英字は空', () => {
  assert.strictEqual(D.romaji('にゃは'), 'nyaha');
  assert.strictEqual(D.romaji('りゅーき'), 'ryuuki');
  assert.strictEqual(D.romaji('きょう'), 'kyou');
  assert.strictEqual(D.romaji('がっこう'), 'gakkou');
  assert.strictEqual(D.romaji('まっちゃ'), 'matcha');
  assert.strictEqual(D.romaji('夏'), '');
  assert.strictEqual(D.romaji('abc'), '');
});

test('entrantFromNode: start.gg のノード → 参加者 (user が無くても名前は取る)', () => {
  const e = D.entrantFromNode({ id: 5, participants: [{ gamerTag: 'A', prefix: 'X', user: { id: 9, discriminator: 'ab12', location: { city: '柏市', state: null },
    authorizations: [{ type: 'DISCORD', externalUsername: 'a1', externalId: '123456789012345678' }, { type: 'TWITTER', externalUsername: null }] } }] });
  assert.deepStrictEqual(j(e), { key: '5', userId: 9, disc: 'ab12', tag: 'A', prefix: 'X', location: '柏市', links: [{ type: 'DISCORD', name: 'a1', id: '123456789012345678' }] });
  const n = D.entrantFromNode({ id: 6, name: 'B', participants: [{ gamerTag: 'B', user: null }] });
  assert.strictEqual(n.userId, null);
  assert.deepStrictEqual(j(n.links), []);
});

test('findCandidates: 同じ名前・ローマ字・1 文字違い・同じ Discord・連携の名前', () => {
  const es = [
    E(1, 'Shun'), E(2, 'SHUN'),                    // 0-1 同じ名前
    E(3, 'なつ'), E(4, 'Natsu'),                    // 2-3 ローマ字で同じ
    E(5, 'たくと'), E(6, 'たくみ'),                   // 4-5 1 文字違い
    E(7, 'ab'), E(8, 'ac'),                        // 短い名前は 1 文字違いを拾わない
    E(9, 'P', [['DISCORD', 'x', '111']]), E(10, 'Q', [['DISCORD', 'y', '111']]),   // 8-9 同じ Discord (ID)
    E(11, 'R', [['TWITTER', 'samehandle']]), E(12, 'S', [['DISCORD', 'samehandle', '222']]),   // 10-11 X と Discord の名前が同じ
    E(13, 'T', [['DISCORD', 'abc', '333']]), E(14, 'U', [['DISCORD', 'abc', '444']]),   // 短い連携名は拾わない (3 文字)
  ];
  const c = j(D.findCandidates(es));
  const k = (a, b) => (c.find((x) => x.a === a && x.b === b) || { kinds: null }).kinds;
  assert.deepStrictEqual(k(0, 1), ['same_name']);
  assert.deepStrictEqual(k(2, 3), ['same_name']);
  assert.deepStrictEqual(k(4, 5), ['similar_name']);
  assert.strictEqual(k(6, 7), null);
  assert.deepStrictEqual(k(8, 9), ['link_id']);
  assert.deepStrictEqual(k(10, 11), ['link_name']);
  assert.strictEqual(k(12, 13), null);
  assert.strictEqual(c.length, 5);
});

test('compare: 同じ部門で両方とも試合 → 別人。DQ だけの部門は根拠にしない', () => {
  const a = side(E(1, 'A'), [[100, '2026-05-03', 2, 2], [101, '2026-06-01', 0, 0, true]]);
  const b = side(E(2, 'A'), [[100, '2026-05-03', 1, 2], [101, '2026-06-01', 3, 2]]);
  const r = D.compare(a, b, ['same_name'], NOW);
  assert.strictEqual(r.verdict, 'diff');
  assert.deepStrictEqual(j(r.reasons.map((x) => x.code)), ['both_played', 'shared_dq_only']);
  // DQ だけの部門しか重ならなければ別人にはしない
  const c = side(E(3, 'A'), [[101, '2026-06-01', 0, 0, true]]);
  assert.notStrictEqual(D.compare(c, b, ['same_name'], NOW).verdict, 'diff');
});

test('compare: 下位クラス (event_id が無い) どうしを同じ部門と数えない', () => {
  const a = side(E(1, 'A'), [[null, '2026-08-28', 1, 2]]);
  a.hist = D.summarize({ tournaments: [{ event_id: null, parent_event_id: 7, class_letter: 'B', date: '2026-08-28', wins: 1, losses: 2 }] }, {});
  const b = side(E(2, 'A'), null);
  b.hist = D.summarize({ tournaments: [{ event_id: null, parent_event_id: 8, class_letter: 'B', date: '2026-09-01', wins: 1, losses: 2 }] }, {});
  assert.strictEqual(D.compare(a, b, ['same_name'], NOW).shared.length, 0);
});

test('compare: 同じ日に離れた地方の大会で両方とも試合 → 別人 (隣の県なら根拠にしない)', () => {
  const tp = { 100: '東京都', 200: '大阪府', 300: '埼玉県' };
  const a = side(E(1, 'A'), [[100, '2026-08-29', 2, 2]], null, tp);
  const far = side(E(2, 'A'), [[200, '2026-08-29', 1, 2]], null, tp);
  const near = side(E(3, 'A'), [[300, '2026-08-29', 1, 2]], null, tp);
  assert.deepStrictEqual(j(D.compare(a, far, ['same_name'], NOW).reasons.map((x) => x.code)), ['same_day_far']);
  assert.notStrictEqual(D.compare(a, near, ['same_name'], NOW).verdict, 'diff');
});

test('compare: 同じ Discord → 同一人物。両方とも試合をしていれば別人のまま (警告つき)', () => {
  const ea = E(1, 'A', [['DISCORD', 'x', '111']]), eb = E(2, 'A', [['DISCORD', 'x', '111']]);
  assert.strictEqual(D.compare(side(ea, null), side(eb, null), ['same_name', 'link_id'], NOW).verdict, 'same');
  const r = D.compare(side(ea, [[100, '2026-05-03', 2, 2]]), side(eb, [[100, '2026-05-03', 0, 2]]), ['same_name', 'link_id'], NOW);
  assert.strictEqual(r.verdict, 'diff');
  assert.ok(r.reasons.some((x) => x.code === 'link_id_conflict'));
  assert.strictEqual(D.compare(side(E(1, 'A'), null), side(E(2, 'A'), null), ['link_name'], NOW).verdict, 'likely');
});

test('compare: 出ていた時期が入れ替わり → 判断できない。重なっていて地域が違えば たぶん別人', () => {
  const a = side(E(1, 'A'), [[100, '2023-06-24', 0, 2], [101, '2025-11-02', 0, 2]], '東京都');
  const b = side(E(2, 'A'), [[200, '2026-09-03', 1, 2]], '東京都');
  const r = D.compare(a, b, ['same_name'], NOW);
  assert.strictEqual(r.verdict, 'unknown');
  assert.deepStrictEqual(j(r.reasons[0]), { code: 'sequential', params: { last: '2025-11-02', first: '2026-09-03' } });
  const c = side(E(3, 'A'), [[300, '2025-01-01', 1, 2], [301, '2026-06-07', 1, 2]], '兵庫県');
  const d = side(E(4, 'A'), [[400, '2026-03-28', 1, 2], [401, '2026-10-05', 1, 2]], '東京都');
  assert.strictEqual(D.compare(c, d, ['same_name'], NOW).verdict, 'prob_diff');
});

test('compare: 記録の無い側の Discord が新しい → 判断できない', () => {
  // 2026-07 に作られた Discord の ID (タイムスタンプ部 = ms - 1420070400000 を 22 ビット左に)
  const id = String((BigInt(Date.UTC(2026, 6, 13)) - 1420070400000n) << 22n);
  assert.strictEqual(new Date(D.discordCreated(id)).toISOString().slice(0, 10), '2026-07-13');
  const a = side(E(1, 'A', [['DISCORD', 'n1', id]]), null, null);
  const b = side(E(2, 'A', [['DISCORD', 'n2', String((BigInt(Date.UTC(2019, 6, 27)) - 1420070400000n) << 22n)]]), [[100, '2026-01-04', 5, 3]], '大阪府');
  assert.deepStrictEqual(j(D.compare(a, b, ['same_name'], NOW).reasons.map((x) => x.code)), ['new_discord']);
  assert.strictEqual(D.discordCreated('abc'), null);
});

test('prefOf: 都道府県名・ローマ字・市の名前', () => {
  assert.strictEqual(D.prefOf('千葉県浦安市'), '千葉県');
  assert.strictEqual(D.prefOf('Tokyo'), '東京都');
  assert.strictEqual(D.prefOf('Kobe'), '兵庫県');
  assert.strictEqual(D.prefOf('京都'), '京都府');
  assert.strictEqual(D.prefOf('東京都'), '東京都');
  assert.strictEqual(D.prefOf(''), null);
  assert.strictEqual(D.prefOf('Grand Rapids'), null);
});
