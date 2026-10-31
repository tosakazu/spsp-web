// 選手による試合結果の報告 (src/api/report*.ts)。start.gg / Challonge は偽物 (本物には書き込まない)。
import test from 'node:test';
import assert from 'node:assert';
import { dispatch } from '../src/api/router.ts';
import { SESSION_TTL_MS_DEFAULT, STATE_TTL_MS_DEFAULT } from '../src/config.ts';
import { issueSessionToken } from '../src/api/session.ts';
import { openJson, sealJson } from '../src/api/report_crypto.ts';
import { adminDecision, ftOf, mergeResults, parseFt, parseResult, parseSettings, playerGate, reconcile, sameOutcome } from '../src/api/report_logic.ts';
import { reportExpiry } from '../src/api/report.ts';
import { downstreamDoneOf, gameDataOf, parsePhaseList, parseStartggSet, phaseInfoOf } from '../src/api/report_startgg.ts';
import { cLPlacement, cRoundLabel, cSetOf, losersPlace, parseMatch, parseParticipant } from '../src/api/report_challonge.ts';
import { MemStore } from './_mem_store.mjs';

const G = (w, c0 = null, c1 = null, s = null) => ({ w, c: [c0, c1], s });
const R = (w, ...g) => ({ w, g });
const set0 = (o = {}) => ({ id: '100', complete: false, slots: [{ id: 'e1', name: 'A', users: ['11'], seed: 1 }, { id: 'e2', name: 'B', users: ['22'], seed: 2 }],
  remote: null, totalGames: 3, downstreamDone: false, lPlacement: 9, isClass: false, ...o });

// ── 判定 ──
test('parseResult: 勝者・スコア・ゲーム数・キャラ/ステージの ID を確かめる。DQ (ゲーム無し) は受け付けない', () => {
  assert.ok('result' in parseResult(R(0, G(0, 1293, 1302, 3), G(1), G(0))));
  assert.strictEqual(parseResult(R(0)).bad, 'games');                       // ゲーム無し = DQ・不戦勝は運営
  assert.strictEqual(parseResult(R(1, G(0), G(0))).bad, 'score');           // 勝者がゲームを取っていない
  assert.ok('result' in parseResult(R(0, G(0), G(0), G(0))));                 // 何先の設定なし = 勝ち越していればよい (3-0)
  assert.ok('result' in parseResult(R(0, G(0), G(1), G(0), G(0))));          // 3-1
  assert.strictEqual(parseResult(R(0, G(0, 'x'))).bad, 'chars');
  assert.strictEqual(parseResult(R(0, G(0, null, null, -1))).bad, 'stage');
  assert.strictEqual(parseResult({ w: 2, g: [G(0)] }).bad, 'winner');
  assert.deepStrictEqual(parseResult({ w: 0, g: [{ w: 0, c: ['1293', null], s: '7' }] }).result, R(0, G(0, 1293, null, 7)));
});

test('sameOutcome は勝者とスコアだけを比べる (キャラ・ステージ・ゲームの順は見ない)', () => {
  assert.ok(sameOutcome(R(0, G(0, 1), G(1), G(0)), R(0, G(1, 9), G(0), G(0, 5, 5, 3))));
  assert.ok(!sameOutcome(R(0, G(0), G(0)), R(0, G(0), G(1), G(0))));
  assert.ok(!sameOutcome(R(0, G(0)), R(1, G(1))));
  assert.ok(sameOutcome(R(0, G(0), G(0)), R(0)));   // start.gg 側のスコアが不明なら勝者だけ
});

test('mergeResults: キャラは各側の本人の入力を正、無ければ相手の入力。勝敗とステージは先に送った側', () => {
  const a = R(0, G(0, 1293, 1302, 3), G(0, 1293, null, 5));   // 側 0 (先)
  const b = R(0, G(0, 1271, 1310, 9), G(0, null, 1311, null)); // 側 1
  assert.deepStrictEqual(mergeResults([a, b], 0), R(0, G(0, 1293, 1310, 3), G(0, 1293, 1311, 5)));
  assert.deepStrictEqual(mergeResults([a, null], 0), a);
});

test('reconcile: 1 人目はすぐ反映、2 人目が同じなら一致、違えば取り消して待つ、そろったら反映', () => {
  const a = { result: R(0, G(0, 1293), G(0)), ts: 1 };
  const b = { result: R(0, G(0, null, 1302), G(0)), ts: 2 };
  const bad = { result: R(1, G(1), G(1)), ts: 3 };
  // 1 人目
  assert.deepStrictEqual(reconcile(null, [a, null], set0()), { op: 'report', state: 'reported', result: a.result, note: '' });
  // 2 人目が同じ (キャラを足す update)
  const done = set0({ complete: true, remote: R(0, G(0), G(0)) });
  const d2 = reconcile({ state: 'reported', applied: a.result }, [a, b], done);
  assert.strictEqual(d2.op, 'update'); assert.strictEqual(d2.state, 'agreed');
  assert.deepStrictEqual(d2.result, R(0, G(0, 1293, 1302), G(0)));
  // 2 人目が違う → 取り消し
  assert.deepStrictEqual(reconcile({ state: 'reported', applied: a.result }, [a, bad], done), { op: 'reset', state: 'conflict', result: null, note: '' });
  // 取り消した後、片方が出し直しても違うまま → 待つ
  assert.strictEqual(reconcile({ state: 'conflict', applied: null }, [a, bad], set0()).state, 'conflict');
  // そろった → 反映
  const b2 = { result: R(0, G(0), G(0)), ts: 4 };
  assert.strictEqual(reconcile({ state: 'conflict', applied: null }, [a, b2], set0()).op, 'report');
});

test('reconcile: 次の試合に結果が出たら自動で取り消さない (review)。運営が start.gg で入れた結果は動かさない', () => {
  const a = { result: R(0, G(0), G(0)), ts: 1 };
  const bad = { result: R(1, G(1), G(1)), ts: 2 };
  const locked = set0({ complete: true, remote: R(0, G(0), G(0)), downstreamDone: true });
  assert.deepStrictEqual(reconcile({ state: 'reported', applied: a.result }, [a, bad], locked), { op: 'none', state: 'review', result: null, note: 'locked_conflict' });
  const ext = set0({ complete: true, remote: R(1, G(1), G(1)) });   // 運営が反対の結果を入れた
  assert.strictEqual(reconcile(null, [a, null], ext).note, 'external_mismatch');
  assert.strictEqual(reconcile(null, [a, null], ext).op, 'none');
  assert.strictEqual(reconcile({ state: 'fixed', applied: a.result }, [a, bad], set0()).op, 'none');   // 運営が直した試合
  // 本人が自分の報告を出し直した (勝者が変わる) → 取り消して入れ直す
  const done = set0({ complete: true, remote: R(0, G(0), G(0)) });
  assert.strictEqual(reconcile({ state: 'reported', applied: a.result }, [bad, null], done).op, 'rereport');
});

test('adminDecision: 次の試合に結果が出るまでは直せる・取り消せる', () => {
  const r = R(1, G(1), G(1));
  assert.deepStrictEqual(adminDecision('fix', r, set0({ downstreamDone: true, complete: true })), { locked: true });
  assert.strictEqual(adminDecision('fix', r, set0()).op, 'report');
  assert.strictEqual(adminDecision('fix', r, set0({ complete: true, remote: R(0, G(0), G(0)) })).op, 'rereport');
  assert.strictEqual(adminDecision('fix', R(1, G(1, 5), G(1)), set0({ complete: true, remote: R(1, G(1), G(1)) })).op, 'update');
  assert.strictEqual(adminDecision('reset', null, set0({ complete: true })).op, 'reset');
});

test('運営の設定: トップ N からは運営・下位クラスだけ', () => {
  assert.deepStrictEqual(parseSettings('{"top_cut":8,"classes_only":true}'), { top_cut: 8, classes_only: true });
  assert.deepStrictEqual(parseSettings({ top_cut: 7 }), { top_cut: null, classes_only: false });   // 選べる値だけ
  assert.strictEqual(playerGate(set0({ lPlacement: 9 }), { top_cut: 8, classes_only: false }), null);   // 負けた人が 9 位 = まだ選手
  assert.strictEqual(playerGate(set0({ lPlacement: 7 }), { top_cut: 8, classes_only: false }), 'top_cut');
  assert.strictEqual(playerGate(set0({ isClass: false }), { top_cut: null, classes_only: true }), 'classes_only');
  assert.strictEqual(playerGate(set0({ isClass: true }), { top_cut: null, classes_only: true }), null);
});

test('何先: 全部 N 先・勝者側/敗者側でラウンドから切り替え・フェーズごと。スコアはちょうど N 先', () => {
  const all = (n) => ({ w: { a: n, from: null, b: n }, l: { a: n, from: null, b: n } });
  const st = parseSettings({ ft: { 10: all(1), 20: { w: { a: 2, from: 4, b: 3 }, l: { a: 2, from: 5, b: 3 } }, 'bad key!': all(2), 30: { w: { a: 9 } } } });
  assert.deepStrictEqual(Object.keys(st.ft), ['10', '20']);                       // 変なキー・範囲外は捨てる
  assert.deepStrictEqual(parseFt({ x: { w: { a: 2, from: 3 }, l: { a: 2 } } }).x.w, { a: 2, from: null, b: 2 });   // 切り替え先が無ければ切り替えない
  assert.strictEqual(ftOf(set0({ phaseKey: '10', round: 3 }), st), 1);             // 予選: 全部 1 先
  assert.strictEqual(ftOf(set0({ phaseKey: '20', round: 3 }), st), 2);
  assert.strictEqual(ftOf(set0({ phaseKey: '20', round: 4 }), st), 3);             // 勝者側 4 回戦から 3 先
  assert.strictEqual(ftOf(set0({ phaseKey: '20', round: -4 }), st), 2);
  assert.strictEqual(ftOf(set0({ phaseKey: '20', round: -5 }), st), 3);            // 敗者側 5 回戦から 3 先
  assert.strictEqual(ftOf(set0({ phaseKey: '99', round: 1 }), st), null);          // 設定なし
  assert.strictEqual(ftOf(set0({ phaseKey: '20', round: null }), st), null);
  assert.ok('result' in parseResult(R(0, G(0)), 1));                            // 1 先 = 1-0
  assert.strictEqual(parseResult(R(0, G(1), G(0), G(0)), 1).bad, 'score_ft');
  assert.strictEqual(parseResult(R(0, G(0), G(0)), 3).bad, 'score_ft');         // 3 先で 2-0 は足りない
  assert.ok('result' in parseResult(R(1, G(0), G(1), G(0), G(1), G(1)), 3));    // 3 先で 3-2
});

test('ブラケットの構造: ラウンドがいちばん多いブロックの rounds と bestOf、試合の名前。Challonge は構造から名前を付ける', () => {
  const list = parsePhaseList({ event: { phases: [{ id: 7, name: 'Top 8', phaseGroups: { nodes: [{ id: 70, rounds: [{ number: 1, bestOf: 3 }] },
    { id: 71, rounds: [{ number: 1, bestOf: 3 }, { number: 2, bestOf: 5 }, { number: -1, bestOf: 3 }, { number: 3 }, { number: -2, bestOf: 5 }] }] } }] } });
  assert.deepStrictEqual(list.map((x) => [x.key, x.group, x.rounds.size]), [['7', '71', 5]]);
  const ph = phaseInfoOf(list[0], [{ round: 3, fullRoundText: 'Grand Final' }, { round: -2, fullRoundText: 'Losers Final' }, { round: 4, fullRoundText: 'Grand Final Reset' }]);
  assert.deepStrictEqual(ph.rounds, [{ n: 1, label: null, bestOf: 3 }, { n: 2, label: null, bestOf: 5 }, { n: 3, label: 'Grand Final', bestOf: null },
    { n: 4, label: 'Grand Final Reset', bestOf: null }, { n: -1, label: null, bestOf: 3 }, { n: -2, label: 'Losers Final', bestOf: 5 }]);
  // Challonge 8 人: シングルは最後から Final / Semi / Quarter、ダブルは勝者側 3 回戦 = Winners Final、4 = Grand Final、敗者側の最後 = Losers Final
  const parts = new Map(Array.from({ length: 8 }, (_, i) => [String(i), { name: 'p' + i, uid: null, seed: i + 1 }]));
  const se = { participants: parts, matches: [1, 2, 3].map((r) => ({ round: r })) };
  assert.deepStrictEqual([1, 2, 3].map((n) => cRoundLabel(se, n, false)), ['Quarter-Final', 'Semi-Final', 'Final']);
  const de = { participants: parts, matches: [1, 2, 3, 4, 5, -1, -2, -3, -4].map((r) => ({ round: r })) };
  assert.deepStrictEqual([1, 3, 4, 5, -1, -4].map((n) => cRoundLabel(de, n, true)), ['Winners Quarter-Final', 'Winners Final', 'Grand Final', 'Grand Final Reset', null, 'Losers Final']);
});

test('reportExpiry: 大会の終わりの翌日の終わり (JST)、短すぎ・長すぎは丸める', () => {
  const now = Date.parse('2026-11-01T01:00:00Z');           // 11/1 10:00 JST
  const end = Date.parse('2026-11-01T12:00:00Z') / 1000;     // 11/1 21:00 JST
  assert.strictEqual(new Date(reportExpiry(end, now, 540) + 9 * 3600e3).toISOString(), '2026-11-02T23:59:59.999Z');
  assert.strictEqual(reportExpiry(null, now, 540), now + 2 * 86400e3);
  assert.strictEqual(reportExpiry(end + 30 * 86400, now, 540), now + 8 * 86400e3);
});

test('トークンの暗号化: 鍵が違うと読めない・平文が入っていない', async () => {
  const cfg = { sessionSecret: 'k1' };
  const s = await sealJson(cfg, { at: 'AT-SECRET', rt: 'RT', exp: 1 });
  assert.ok(!s.includes('AT-SECRET'));
  assert.deepStrictEqual(await openJson(cfg, s), { at: 'AT-SECRET', rt: 'RT', exp: 1 });
  assert.strictEqual(await openJson({ sessionSecret: 'k2' }, s), null);
  assert.strictEqual(await openJson(cfg, 'v1.xx.yy'), null);
});

test('start.gg の set の読み取り: 枠・結果・下位クラス・次の試合', () => {
  const raw = { id: 100, state: 3, winnerId: 2, totalGames: 3, lPlacement: 7, event: { id: 9, name: 'Singles' }, phaseGroup: { phase: { name: 'Bクラス' } },
    slots: [{ entrant: { id: 1, name: 'A', initialSeedNum: 4, participants: [{ user: { id: 11 } }] } }, { entrant: { id: 2, name: 'B', participants: [{ user: { id: 22 } }] } }],
    games: [{ orderNum: 2, winnerId: 2 }, { orderNum: 1, winnerId: 2 }] };
  const s = parseStartggSet(raw, '9');
  assert.deepStrictEqual(s.remote, R(1, G(1), G(1)));
  assert.deepStrictEqual(s.slots[0], { id: '1', name: 'A', users: ['11'], seed: 4 });
  assert.strictEqual(s.isClass, true); assert.strictEqual(s.lPlacement, 7);
  assert.strictEqual(parseStartggSet(raw, '8'), null);   // 別のイベントの set
  assert.ok(downstreamDoneOf([{ id: 101, state: 3, slots: [{ prereqType: 'set', prereqId: 100 }] }], '100'));
  assert.ok(!downstreamDoneOf([{ id: 101, state: 2, slots: [{ prereqType: 'set', prereqId: 100 }] }], '100'));
  assert.deepStrictEqual(gameDataOf(s, R(0, G(0, 1293, null, 3))), [{ gameNum: 1, winnerId: '1', stageId: '3', selections: [{ entrantId: '1', characterId: '1293' }] }]);
});

test('Challonge の試合: 両方の形 (player1_id / relationships) を読み、残り人数を数える', () => {
  const ps = [1, 2, 3, 4].map((i) => parseParticipant({ id: String(i), attributes: { name: 'P' + i, misc: 'startgg:' + (10 + i) + (i === 4 ? ':nocount' : ''), seed: i } }));
  const participants = new Map(ps.map((p) => [p.id, p]));
  const ms = [
    parseMatch({ id: '50', attributes: { state: 'complete', round: 1, winner_id: 1, player1_id: 1, player2_id: 4, points_by_participant: [{ participant_id: 1, scores: [2] }, { participant_id: 4, scores: [0] }] } }),
    parseMatch({ id: '51', attributes: { state: 'open', round: 1 }, relationships: { player1: { data: { id: '2' } }, player2: { data: { id: '3' } } } }),
    parseMatch({ id: '52', attributes: { state: 'pending', round: 2, player1_id: 1, player2_prereq_match_id: 51 } }),
  ];
  const d = { participants, matches: ms };
  assert.strictEqual(ps[3].uid, '14');
  const s = cSetOf(d, ms[0]);
  assert.deepStrictEqual(s.remote, R(0, G(0), G(0)));
  assert.deepStrictEqual(s.slots.map((x) => x.users), [['11'], ['14']]);
  assert.strictEqual(s.downstreamDone, false);
  assert.strictEqual(cSetOf(d, ms[1]).slots[0].id, '2');
  assert.strictEqual(cLPlacement(d, ms[0], false), 3);   // 4 人のシングル: 1 回戦の負け = 3 位
  assert.strictEqual(cLPlacement(d, ms[2], false), 2);   // 決勝
});

test('Challonge の負けた人の順位: シングル・ダブル (8 人) は start.gg と同じ 1,2,3,4,5,5,7,7', () => {
  assert.deepStrictEqual([0, 1, 2, 3, 4, 5, 6, 7].map(losersPlace), [3, 4, 5, 7, 9, 13, 17, 25]);
  const mk = (rounds, n) => ({ participants: new Map(Array.from({ length: n }, (_, i) => [String(i), {}])),
    matches: rounds.map((r, i) => ({ id: String(i), round: r, p: [null, null], prereq: [null, null], state: 'open' })) });
  const se = mk([1, 1, 1, 1, 2, 2, 3, 0], 8);
  assert.deepStrictEqual(se.matches.map((m) => cLPlacement(se, m, false)), [5, 5, 5, 5, 3, 3, 2, 4]);
  const de = mk([1, 2, 3, 4, 5, -1, -2, -3, -4], 8);   // 勝者側 1〜3・GF 4〜5・敗者側 -1〜-4
  assert.deepStrictEqual(de.matches.map((m) => cLPlacement(de, m, true)), [7, 5, 3, 2, 2, 7, 5, 4, 3]);
  const de16 = mk([1, 2, 3, 4, -1, -2, -3, -4, -5, -6], 16);
  assert.deepStrictEqual(de16.matches.map((m) => cLPlacement(de16, m, true)), [13, 9, 5, 3, 13, 9, 7, 5, 4, 3]);
  assert.strictEqual(cLPlacement(se, { ...se.matches[0], round: null }, false), null);
});

// ── 偽の start.gg ──
function fakeStartgg() {
  const st = {
    set: { id: 100, state: 2, round: 1, winnerId: null, totalGames: 3, lPlacement: 9, event: { id: 9, name: 'Singles' }, phaseGroup: { phase: { id: 77, name: 'Pools' } },
      slots: [{ entrant: { id: 1, name: 'A', initialSeedNum: 1, participants: [{ user: { id: 11 } }] } }, { entrant: { id: 2, name: 'B', initialSeedNum: 2, participants: [{ user: { id: 22 } }] } }],
      games: null },
    next: [], admins: [{ id: 4242 }], calls: [], fail: null, tokens: [],
  };
  st.fetch = async (url, init) => {
    const auth = init && init.headers && init.headers.Authorization;
    if (url.includes('/oauth/')) {
      const b = JSON.parse(init.body);
      st.calls.push(b.grant_type === 'refresh_token' ? 'refresh' : 'exchange:' + b.scope);
      return new Response(JSON.stringify({ access_token: b.grant_type === 'refresh_token' ? 'AT-2' : 'AT-1', expires_in: 3600, refresh_token: 'RT-1' }), { status: 200 });
    }
    st.tokens.push(auth);
    const { query, variables } = JSON.parse(init.body);
    const name = (/(?:query|mutation)\s+(\w+)/.exec(query) || [])[1] || (query.includes('currentUser') ? 'me' : '?');
    st.calls.push(name);
    const j = (data) => new Response(JSON.stringify({ data }), { status: 200 });
    if (st.fail === name) return new Response(JSON.stringify({ errors: [{ message: 'nope' }], data: null }), { status: 200 });
    if (name === 'me' || /^query \{ currentUser/.test(query)) return j({ currentUser: { id: 4242, slug: 'user/x', player: { gamerTag: 'TO' } } });
    if (name === 'SpspReportEvent') return j({ event: { id: 9, name: 'Singles', slug: 'tournament/t/event/singles', tournament: { id: 5, name: 'Test Cup', endAt: Math.floor(Date.now() / 1000) + 3600 } } });
    if (name === 'SpspClassAdmin') return j({ currentUser: { id: 4242 }, event: { id: 9, tournament: { id: 5, owner: { id: 1 }, admins: st.admins } } });
    if (name === 'SpspClassAdminTours') return j({ currentUser: { tournaments: { nodes: [] } } });
    if (name === 'SpspReportSet') return j({ set: String(variables.id) === String(st.set.id) ? st.set : null });
    if (name === 'SpspReportPhases') return j({ event: { phases: [{ id: 77, name: 'Pools', phaseGroups: { nodes: [{ id: 700, rounds: [{ number: 1, bestOf: 3 }, { number: -1, bestOf: null }] }] } }] } });
    if (name === 'SpspReportGroupSets') return j({ phaseGroup: { sets: { pageInfo: { totalPages: 1 }, nodes: [{ round: 1, fullRoundText: 'Winners Round 1' }] } } });
    if (name === 'SpspReportNext') return j({ event: { sets: { nodes: st.next } } });
    if (name === 'SpspReportBracketSet' || name === 'SpspUpdateSet') {
      st.set.state = 3; st.set.winnerId = Number(variables.winnerId);
      st.set.games = variables.gameData.map((g) => ({ orderNum: g.gameNum, winnerId: Number(g.winnerId) }));
      st.last = variables;
      return j({ x: { id: 100, state: 3 } });
    }
    if (name === 'SpspResetSet') { st.set.state = 1; st.set.winnerId = null; st.set.games = null; return j({ resetSet: { id: 100, state: 1 } }); }
    return j({});
  };
  return st;
}

async function envWith(fake) {
  const store = new MemStore();
  const cfg = { clientId: 'cid', redirectUri: 'https://x/callback.html', clientSecret: 'CS', sessionSecret: 'sess-' + Math.random(),
    sessionTtlMs: SESSION_TTL_MS_DEFAULT, stateTtlMs: STATE_TTL_MS_DEFAULT, tsOffsetMin: 540 };
  let now = Date.now();
  const ctx = { cfg, store, fetch: fake.fetch, dataFetch: async () => { throw new Error('no'); }, now: () => now };
  const call = (b) => dispatch(ctx, b);
  const tok = (uid) => issueSessionToken(cfg, { id: String(uid), slug: '', gamerTag: '' }, now);
  return { store, cfg, ctx, call, tok, tick: (ms) => { now += ms; } };
}

/** 運営のログイン (先にする): report_begin → report_login。セッションを返す */
async function toLogin(e) {
  const b = await e.call({ action: 'report_begin', nonce: 'N', returnPath: '/jp/report/' });
  assert.ok(new URL(b.url).searchParams.get('scope') === 'user.identity tournament.reporter');
  const l = await e.call({ action: 'report_login', code: 'C', state: new URL(b.url).searchParams.get('state') });
  assert.strictEqual(l.ok, true, JSON.stringify(l));
  return l;
}

async function enabled(fake, settings) {
  const e = await envWith(fake);
  const l = await toLogin(e);
  const r = await e.call({ action: 'report_enable', token: l.token, event: 'https://www.start.gg/tournament/t/event/singles', settings });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  return { ...e, code: r.report.code, enable: r, login: l };
}

test('受付の前: 運営のログインのトークンでイベントのフェーズを読む (受付を始める画面の何先)', async () => {
  const e = await envWith(fakeStartgg());
  const l = await toLogin(e);
  const ph = await e.call({ action: 'report_phases', token: l.token, event: 'https://www.start.gg/tournament/t/event/singles' });
  assert.deepStrictEqual(ph.phases, [{ key: '77', name: 'Pools', rounds: [{ n: 1, label: 'Winners Round 1', bestOf: 3 }, { n: -1, label: null, bestOf: null }] }]);
  assert.strictEqual((await e.call({ action: 'report_phases', token: l.token, event: 'x' })).error.code, 'bad_request');
  assert.strictEqual((await e.call({ action: 'report_phases', token: await e.tok(11), event: 'tournament/t/event/singles' })).error.code, 'no_grant');
});

test('受付: 運営の reporter トークンを暗号化して置き、応答にもログにも出さない', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  assert.match(e.code, /^[a-z0-9]{10}$/);
  assert.ok(fake.calls.includes('exchange:user.identity tournament.reporter'));
  for (const x of [e.enable, e.login]) assert.ok(!JSON.stringify(x).includes('AT-1') && !JSON.stringify(x).includes('RT-1'));
  const row = await e.store.getReportEvent(e.code);
  assert.ok(row.token_enc && !row.token_enc.includes('AT-1'));
  assert.strictEqual(row.admins, '4242');
  assert.ok(e.login.token, 'ログインでセッションを返す');
  const g = e.store.reportGrants[0];
  assert.ok(g && g.user_id === '4242' && !g.token_enc.includes('AT-1'), 'ログインのトークンも暗号化して預かる');
  // f='manager' の state ではログインできない
  const m = await e.call({ action: 'manager_begin', nonce: 'N' });
  const r2 = await e.call({ action: 'report_login', code: 'C', state: new URL(m.url).searchParams.get('state') });
  assert.strictEqual(r2.error.code, 'state_invalid');
  // ログインしていない人 (預かったトークンが無い) は受付できない
  const r3 = await e.call({ action: 'report_enable', token: await e.tok(77), event: '9' });
  assert.strictEqual(r3.error.code, 'no_grant');
  // 預かるのは REPORT_GRANT_MS まで
  e.tick(13 * 3600 * 1000);
  const r4 = await e.call({ action: 'report_tournaments', token: e.login.token });
  assert.ok(r4.error.code === 'no_grant' || r4.error.code === 'auth_failed', JSON.stringify(r4));
  assert.strictEqual(e.store.reportGrants.length, 0);
  // 普段のログインに reporter の state は使えない
  const b = await e.call({ action: 'report_begin', nonce: 'N' });
  assert.strictEqual((await e.call({ action: 'login', code: 'C', state: new URL(b.url).searchParams.get('state') })).error.code, 'state_invalid');
});

test('運営の大会一覧: 管理している大会を開催中 → これから の順に、受付中の code つきで', async () => {
  const fake = fakeStartgg();
  const now = Math.floor(Date.now() / 1000);
  const base = fake.fetch;
  fake.fetch = async (url, init) => {
    if (!url.includes('/oauth/') && JSON.parse(init.body).query.includes('SpspReportTours')) {
      return new Response(JSON.stringify({ data: { currentUser: { tournaments: { nodes: [
        { id: 6, name: 'Next Cup', slug: 'tournament/n', startAt: now + 5 * 86400, endAt: now + 5 * 86400, events: [{ id: 60, name: 'Singles', slug: 'tournament/n/event/s', numEntrants: 10, videogame: { id: 1386 } }] },
        { id: 7, name: 'Old Cup', slug: 'tournament/o', startAt: now - 30 * 86400, endAt: now - 30 * 86400, events: [] },
        { id: 5, name: 'Test Cup', slug: 'tournament/t', startAt: now - 3600, endAt: now + 3600, events: [{ id: 9, name: 'Singles', slug: 'tournament/t/event/singles', numEntrants: 64, videogame: { id: 1386 } }] },
      ] } } } }), { status: 200 });
    }
    return base(url, init);
  };
  const e = await enabled(fake);
  const r = await e.call({ action: 'report_tournaments', token: e.login.token });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.deepStrictEqual(r.tournaments.map((t) => [t.name, t.live]), [['Test Cup', true], ['Next Cup', false]], '終わって 2 日を過ぎた大会は出さない');
  assert.strictEqual(r.tournaments[0].events[0].code, e.code, '受付中のイベントには code');
  assert.strictEqual(r.tournaments[1].events[0].code, null);
  assert.ok(!JSON.stringify(r).includes('AT-1'));
  assert.strictEqual((await e.call({ action: 'report_tournaments', token: 'x' })).error.code, 'auth_failed');
});

test('管理者でなければ受付できない', async () => {
  const fake = fakeStartgg();
  fake.admins = [];
  const e = await envWith(fake);
  const l = await toLogin(e);
  const r = await e.call({ action: 'report_enable', token: l.token, event: '9' });
  assert.strictEqual(r.error.code, 'not_admin');
  assert.strictEqual(e.store.reportEvents ? e.store.reportEvents.length : 0, 0);
});

test('報告の流れ: 1 人目で反映 → 2 人目が違えば取り消し → そろったら反映 (キャラは本人の入力)', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  const A = await e.tok(11); const B = await e.tok(22);
  const win0 = { w: 0, g: [{ w: 0, c: [1293, 1302], s: 3 }, { w: 0, c: [1293, 1302], s: 5 }] };
  let r = await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: win0 });
  assert.deepStrictEqual([r.state, r.op], ['reported', 'report']);
  assert.strictEqual(fake.set.state, 3);
  assert.ok(fake.tokens.every((t) => t === 'Bearer AT-1'));
  e.tick(5000);
  r = await e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1, c: [null, 1310] }, { w: 1, c: [null, null] }] } });
  assert.deepStrictEqual([r.state, r.op], ['conflict', 'reset']);
  assert.strictEqual(fake.set.state, 1, '取り消した');
  // 状態は両者に見える
  const v = await e.call({ action: 'report_view', token: A, code: e.code });
  assert.strictEqual(v.sets[0].state, 'conflict');
  assert.strictEqual(Object.keys(v.sets[0].reports).length, 2);
  const n = await e.call({ action: 'report_notices', token: B });
  assert.strictEqual(n.mine.length, 1);
  assert.strictEqual(n.events[0].code, e.code);
  e.tick(5000);
  r = await e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0, c: [null, 1310] }, { w: 0, c: [null, 1311] }] } });
  assert.deepStrictEqual([r.state, r.op], ['agreed', 'report']);
  assert.deepStrictEqual(fake.last.gameData[0].selections, [{ entrantId: '1', characterId: '1293' }, { entrantId: '2', characterId: '1310' }]);
  assert.strictEqual(fake.last.gameData[0].stageId, '3');
});

test('選手でない人・連投・相手未定は弾く', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  const res = { w: 0, g: [{ w: 0 }, { w: 0 }] };
  assert.strictEqual((await e.call({ action: 'report_submit', token: await e.tok(33), code: e.code, set_id: '100', result: res })).error.code, 'not_player');
  assert.strictEqual((await e.call({ action: 'report_submit', token: 'bad', code: e.code, set_id: '100', result: res })).error.code, 'auth_failed');
  const A = await e.tok(11);
  assert.strictEqual((await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: res })).ok, true);
  assert.strictEqual((await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: res })).error.code, 'rate_limited');
  fake.set.slots[1] = { entrant: null };
  e.tick(5000);
  assert.strictEqual((await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: res })).error.code, 'not_ready');
});

test('次の試合に結果が出たら、食い違っても取り消さず運営の確認にする。運営も直せない', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  await e.call({ action: 'report_submit', token: await e.tok(11), code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } });
  fake.next = [{ id: 101, state: 3, slots: [{ prereqType: 'set', prereqId: 100 }] }];
  e.tick(5000);
  const r = await e.call({ action: 'report_submit', token: await e.tok(22), code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1 }, { w: 1 }] } });
  assert.deepStrictEqual([r.state, r.op, r.note], ['review', 'none', 'locked_conflict']);
  assert.strictEqual(fake.set.state, 3);
  const TO = await e.tok(4242);
  const f = await e.call({ action: 'report_admin_fix', token: TO, code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1 }, { w: 1 }] } });
  assert.strictEqual(f.error.code, 'locked');
});

test('運営: 一覧・直す (その後の選手の報告では動かない)・取り消し・設定・停止。運営以外は使えない', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  const TO = await e.tok(4242);
  await e.call({ action: 'report_submit', token: await e.tok(11), code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } });
  assert.strictEqual((await e.call({ action: 'report_admin', token: await e.tok(11), code: e.code })).error.code, 'not_admin');
  const list = await e.call({ action: 'report_admin', token: TO, code: e.code });
  assert.strictEqual(list.sets.length, 1);
  const f = await e.call({ action: 'report_admin_fix', token: TO, code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1 }, { w: 0 }, { w: 1 }] } });
  assert.deepStrictEqual([f.state, f.op], ['fixed', 'rereport']);
  assert.strictEqual(fake.set.winnerId, 2);
  e.tick(5000);
  const p = await e.call({ action: 'report_submit', token: await e.tok(22), code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } });
  assert.deepStrictEqual([p.state, p.op], ['fixed', 'none']);
  const rs = await e.call({ action: 'report_admin_fix', token: TO, code: e.code, set_id: '100', reset: true });
  assert.deepStrictEqual([rs.state, rs.op], ['reset', 'reset']);
  e.tick(5000);
  // 取り消し後は、その後の報告だけで決める
  const p2 = await e.call({ action: 'report_submit', token: await e.tok(22), code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1 }, { w: 1 }] } });
  assert.deepStrictEqual([p2.state, p2.op], ['reported', 'report']);
  // 何先: フェーズの一覧・設定するとスコアを確かめる
  const ph = await e.call({ action: 'report_phases', token: TO, code: e.code });
  assert.deepStrictEqual(ph.phases, [{ key: '77', name: 'Pools', rounds: [{ n: 1, label: 'Winners Round 1', bestOf: 3 }, { n: -1, label: null, bestOf: null }] }]);
  assert.strictEqual((await e.call({ action: 'report_phases', token: await e.tok(11), code: e.code })).error.code, 'not_admin');
  const ft1 = { 77: { w: { a: 1, from: null, b: 1 }, l: { a: 1, from: null, b: 1 } } };
  assert.deepStrictEqual((await e.call({ action: 'report_settings', token: TO, code: e.code, settings: { top_cut: null, classes_only: false, ft: ft1 } })).settings.ft, ft1);
  assert.deepStrictEqual((await e.call({ action: 'report_info', code: e.code })).report.settings.ft, ft1);   // 選手の画面にも出す
  e.tick(5000);
  const bad = await e.call({ action: 'report_submit', token: await e.tok(22), code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1 }, { w: 1 }] } });
  assert.deepStrictEqual([bad.error.code, bad.error.message], ['bad_request', 'この試合は 1 先です。スコアを確かめてください。']);
  // 設定
  const s = await e.call({ action: 'report_settings', token: TO, code: e.code, settings: { top_cut: 8, classes_only: false } });
  assert.deepStrictEqual(s.settings, { top_cut: 8, classes_only: false });
  fake.set.lPlacement = 7;
  e.tick(5000);
  assert.strictEqual((await e.call({ action: 'report_submit', token: await e.tok(11), code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } })).error.code, 'not_allowed');
  await e.call({ action: 'report_settings', token: TO, code: e.code, settings: { top_cut: null, classes_only: true } });
  e.tick(5000);
  assert.strictEqual((await e.call({ action: 'report_submit', token: await e.tok(11), code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } })).error.code, 'not_allowed');
  // 受付の開始前は報告できない・お知らせにも出さない
  const later = (await e.call({ action: 'report_settings', token: TO, code: e.code, settings: { top_cut: null, classes_only: false, opens_ms: e.ctx.now() + 3600e3 } })).settings;
  assert.ok(later.opens_ms > 0);
  e.tick(5000);
  assert.strictEqual((await e.call({ action: 'report_submit', token: await e.tok(11), code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } })).error.message, 'まだ結果報告の受付が始まっていません。');
  assert.deepStrictEqual((await e.call({ action: 'report_notices' })).events, []);
  await e.call({ action: 'report_settings', token: TO, code: e.code, settings: { top_cut: null, classes_only: true } });
  // 名前をつけて保存した設定 (アカウントごと)
  const pre = { top_cut: 8, classes_only: false, phases: [{ name: 'Pools', i: 0, w: { a: 2, from: 4, fl: 'Winners Final', b: 3 }, l: { a: 2, from: null, b: 2 } }], junk: 1 };
  const sv = await e.call({ action: 'report_preset_save', token: TO, name: ' いつもの ', settings: pre });
  assert.deepStrictEqual(sv.presets.map((p) => p.name), ['いつもの']);
  assert.deepStrictEqual(sv.presets[0].settings, { top_cut: 8, classes_only: false, phases: [{ name: 'Pools', i: 0, w: { a: 2, from: 4, fl: 'Winners Final', b: 3 }, l: { a: 2, from: null, b: 2, fl: null } }] });
  assert.deepStrictEqual((await e.call({ action: 'report_presets', token: await e.tok(11) })).presets, []);   // ほかの人には見えない
  e.tick(10);
  await e.call({ action: 'report_preset_save', token: TO, name: 'いつもの', settings: { top_cut: null, classes_only: true } });   // 同じ名前 = 上書き
  const ls = (await e.call({ action: 'report_presets', token: TO })).presets;
  assert.deepStrictEqual([ls.length, ls[0].settings.classes_only, ls[0].settings.phases], [1, true, []]);
  assert.strictEqual((await e.call({ action: 'report_preset_save', token: TO, name: '', settings: pre })).error.code, 'bad_request');
  for (let i = 1; i < 20; i++) await e.call({ action: 'report_preset_save', token: TO, name: 'p' + i, settings: pre });
  assert.strictEqual((await e.call({ action: 'report_preset_save', token: TO, name: 'p20', settings: pre })).error.code, 'rate_limited');   // 20 個まで
  assert.strictEqual((await e.call({ action: 'report_preset_save', token: TO, name: 'p1', settings: pre })).ok, true);              // 上書きはできる
  assert.strictEqual((await e.call({ action: 'report_preset_delete', token: TO, name: 'p1' })).presets.length, 19);
  assert.strictEqual((await e.call({ action: 'report_presets' })).error.code, 'auth_failed');
  // 停止
  assert.strictEqual((await e.call({ action: 'report_stop', token: await e.tok(11), code: e.code })).error.code, 'not_admin');
  assert.strictEqual((await e.call({ action: 'report_stop', token: TO, code: e.code })).ok, true);
  assert.strictEqual((await e.store.getReportEvent(e.code)).token_enc, '');
  assert.strictEqual((await e.call({ action: 'report_view', token: TO, code: e.code })).error.code, 'report_closed');
  assert.strictEqual((await e.call({ action: 'report_info', code: e.code })).report.active, false);
});

test('受付の期限を過ぎるとトークンを消す。期限が近い start.gg のトークンは延長する', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  e.tick(3600e3 - 5 * 60e3);   // 有効 3600 秒の残り 5 分
  await e.call({ action: 'report_view', token: await e.tok(11), code: e.code });
  assert.ok(fake.calls.includes('refresh'));
  const row = await e.store.getReportEvent(e.code);
  assert.strictEqual((await openJson(e.cfg, row.token_enc)).at, 'AT-2');
  e.tick(10 * 86400e3);
  assert.strictEqual((await e.call({ action: 'report_info', code: e.code })).report.active, false);
  assert.strictEqual((await e.store.getReportEvent(e.code)).token_enc, '');
});

test('start.gg への送信に失敗したら review にして理由を残す', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  const orig = fake.fetch;
  e.ctx.fetch = async (url, init) => (init && init.body && init.body.includes('reportBracketSet')
    ? new Response(JSON.stringify({ errors: [{ message: 'Not authorized' }] }), { status: 200 }) : orig(url, init));
  const r = await e.call({ action: 'report_submit', token: await e.tok(11), code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } });
  assert.strictEqual(r.error.code, 'provider_error');
  const row = await e.store.getReportSet(e.code, '100');
  assert.strictEqual(row.state, 'review');
  assert.match(row.note, /^error:gql:Not authorized/);
});

// ── Challonge ──
function fakeChallonge() {
  const st = { matches: { 50: { state: 'open', round: 1, player1_id: 1, player2_id: 2, winner_id: null, points_by_participant: [] } }, calls: [] };
  st.fetch = async (url, init) => {
    const u = new URL(url); const m = init.method || 'GET';
    st.calls.push(m + ' ' + u.pathname);
    const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
    if (u.hostname === 'api.start.gg') {
      const { query } = JSON.parse(init.body);
      if (query.includes('SpspCurrentUser')) return j({ data: { currentUser: { id: 4242 } } });
      return j({ data: {} });
    }
    if (/\/tournaments\/77\.json$/.test(u.pathname)) return j({ data: { id: '77', attributes: { name: 'Bクラス', full_challonge_url: 'https://challonge.com/x', tournament_type: 'single elimination' } } });
    if (/participants\.json$/.test(u.pathname)) return j({ data: [1, 2].map((i) => ({ id: String(i), attributes: { name: 'P' + i, misc: 'startgg:' + (i === 1 ? 11 : 22), seed: i } })) });
    if (/matches\.json$/.test(u.pathname) && m === 'GET') return j({ data: Object.entries(st.matches).map(([id, a]) => ({ id, attributes: a })) });
    const mm = /matches\/(\d+)\.json$/.exec(u.pathname);
    if (mm && m === 'PUT') {
      const b = JSON.parse(init.body).data.attributes.match;
      const a = st.matches[mm[1]];
      a.state = 'complete'; a.winner_id = Number(b.find((x) => x.advancing).participant_id);
      a.points_by_participant = b.map((x) => ({ participant_id: Number(x.participant_id), scores: [Number(x.score_set)] }));
      st.last = b;
      return j({ data: {} });
    }
    const cs = /matches\/(\d+)\/change_state\.json$/.exec(u.pathname);
    if (cs) { const a = st.matches[cs[1]]; a.state = 'open'; a.winner_id = null; a.points_by_participant = []; return j({ data: {} }); }
    return j({}, 404);
  };
  return st;
}

test('Challonge の下位クラス: 作った本人が受付 → 選手の報告を Challonge に送り、食い違えば reopen', async () => {
  const fake = fakeChallonge();
  const e = await envWith(fake);
  e.store.classes.push({ id: 3, parent_event_id: 9, challonge_id: 77, registered_by: '4242', status: 'waiting' });
  e.store.getClassBracket = async (id) => e.store.classes.find((c) => c.id === id) || null;
  const en = await e.call({ action: 'report_enable_class', startgg_token: 'K', challonge_token: 'CT', challonge_exp: Date.now() + 86400e3, class_id: 3, settings: { top_cut: 4, classes_only: true } });
  assert.strictEqual(en.ok, true, JSON.stringify(en));
  assert.strictEqual(en.report.kind, 'challonge');
  assert.deepStrictEqual(en.report.settings, { top_cut: 4, classes_only: false });
  const code = en.report.code;
  // 2 人のシングル: 決勝の負け = 2 位 ≤ トップ 4 → 運営が入力
  let r = await e.call({ action: 'report_submit', token: await e.tok(11), code, set_id: '50', result: { w: 0, g: [{ w: 0 }, { w: 1 }, { w: 0 }] } });
  assert.strictEqual(r.error.code, 'not_allowed');
  await e.call({ action: 'report_settings', token: await e.tok(4242), code, settings: { top_cut: null } });
  e.tick(5000);
  r = await e.call({ action: 'report_submit', token: await e.tok(11), code, set_id: '50', result: { w: 0, g: [{ w: 0 }, { w: 1 }, { w: 0 }] } });
  assert.deepStrictEqual([r.state, r.op], ['reported', 'report'], JSON.stringify(r));
  assert.deepStrictEqual(fake.last, [{ participant_id: '1', score_set: '2', advancing: true }, { participant_id: '2', score_set: '1', advancing: false }]);
  const v = await e.call({ action: 'report_view', token: await e.tok(22), code });
  assert.strictEqual(v.challonge.participant.id, '2');
  assert.strictEqual(v.challonge.matches[0].winner, 0);
  e.tick(5000);
  r = await e.call({ action: 'report_submit', token: await e.tok(22), code, set_id: '50', result: { w: 1, g: [{ w: 1 }, { w: 1 }] } });
  assert.deepStrictEqual([r.state, r.op], ['conflict', 'reset']);
  assert.strictEqual(fake.matches[50].state, 'open');
  assert.ok(fake.calls.every((c) => !c.includes('application')), 'TO のトークンで /tournaments を使う');
});

// ── 2 人がほぼ同時に送る (1 人目が start.gg に送っている最中に 2 人目) ──
/** 1 人目の書き込み (reportBracketSet) を gate が開くまで止める偽の start.gg */
function gatedStartgg() {
  const fake = fakeStartgg();
  const inner = fake.fetch;
  let open; fake.gate = new Promise((r) => { open = r; }); fake.open = () => open();
  fake.held = false;
  fake.fetch = async (url, init) => {
    if (!url.includes('/oauth/') && /mutation\s+SpspReportBracketSet/.test(JSON.parse(init.body).query) && !fake.held) {
      fake.held = true;
      await fake.gate;
    }
    return inner(url, init);
  };
  return fake;
}
const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 5)); };

test('同時に送る: 1 人目が送っている間に 2 人目が違う結果 → 1 人目が送り終えてから判定して取り消す (結果が残らない)', async () => {
  const fake = gatedStartgg();
  const e = await enabled(fake);
  const A = await e.tok(11); const B = await e.tok(22);
  const pa = e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0, c: [null, null] }, { w: 0, c: [null, null] }] } });
  await until(() => fake.held);   // A が start.gg に送っている最中
  const pb = e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1, c: [null, null] }, { w: 1, c: [null, null] }] } });
  await new Promise((r) => setTimeout(r, 50));
  // 送っている最中の行は画面に「送信中」の印を見せない
  const v = await e.call({ action: 'report_view', token: A, code: e.code });
  assert.strictEqual(v.sets[0].note, '');
  fake.open();
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.deepStrictEqual([ra.ok, ra.op], [true, 'report']);
  assert.deepStrictEqual([rb.ok, rb.state, rb.op], [true, 'conflict', 'reset'], JSON.stringify(rb));
  assert.strictEqual(fake.set.state, 1, 'start.gg の結果は取り消されている');
  const row = await e.store.getReportSet(e.code, '100');
  assert.deepStrictEqual([row.state, row.note, row.applied], ['conflict', '', '']);
});

test('同時に送る: 2 人目が同じ結果 → 1 人目が送り終えてからキャラを足す (エラーにしない)', async () => {
  const fake = gatedStartgg();
  const e = await enabled(fake);
  const A = await e.tok(11); const B = await e.tok(22);
  const pa = e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0, c: [1293, null] }, { w: 0, c: [1293, null] }] } });
  await until(() => fake.held);
  const pb = e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0, c: [null, 1310] }, { w: 0, c: [null, 1310] }] } });
  await new Promise((r) => setTimeout(r, 50));
  fake.open();
  const [ra, rb] = await Promise.all([pa, pb]);
  assert.deepStrictEqual([ra.ok, ra.op], [true, 'report']);
  assert.deepStrictEqual([rb.ok, rb.state, rb.op], [true, 'agreed', 'update'], JSON.stringify(rb));
  assert.deepStrictEqual(fake.last.gameData[0].selections, [{ entrantId: '1', characterId: '1293' }, { entrantId: '2', characterId: '1310' }]);
  const row = await e.store.getReportSet(e.code, '100');
  assert.deepStrictEqual([row.state, row.note], ['agreed', '']);
});

test('送っている最中の印が古すぎる (Worker が途中で落ちた) ときは待たずに読み直して進む', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  const A = await e.tok(11);
  // 60 秒より前に「送信中」のまま残った行 (start.gg には届いていない)
  await e.store.casReportSet({ code: e.code, set_id: '100', state: 'reported', users: '|11|22|', slots: '[]', applied: JSON.stringify({ w: 1, g: [{ w: 1, c: [null, null], s: null }] }),
    note: 'sending', floor_id: 0, version: 1, updated_ms: e.ctx.now() - 61000 }, null);
  const r = await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0, c: [null, null] }, { w: 0, c: [null, null] }] } });
  assert.deepStrictEqual([r.ok, r.op, r.state], [true, 'report', 'reported'], JSON.stringify(r));
  assert.strictEqual(fake.set.state, 3);
});

test('運営の受付用ログイン (reporter) の state は、普段のログイン・投稿・大会運営用ログインでは使えない', async () => {
  for (const action of ['login', 'post', 'manager_login']) {
    const fake = fakeStartgg();
    const e = await envWith(fake);
    const b = await e.call({ action: 'report_begin', nonce: 'N', returnPath: '/jp/report/' });
    const state = new URL(b.url).searchParams.get('state');
    const r = await e.call({ action, code: 'C', state, body: 'こんにちは', nonce: 'N' });
    assert.strictEqual(r.ok, false, action);
    assert.strictEqual(r.error.code, 'state_invalid', action + ': ' + JSON.stringify(r));
    assert.ok(!fake.calls.some((c) => String(c).startsWith('exchange')), action + ': start.gg に code を送らない');
  }
});

test('次の試合が始まっている (state 2) だけなら、食い違いは巻き戻す (結果が出るまでは)', () => {
  const a = { result: R(0, G(0), G(0)), ts: 1 };
  const bad = { result: R(1, G(1), G(1)), ts: 2 };
  const started = set0({ complete: true, remote: R(0, G(0), G(0)) });   // downstreamDoneOf は state 3 だけを数える
  assert.ok(!downstreamDoneOf([{ id: 101, state: 2, slots: [{ prereqType: 'set', prereqId: 100 }] }], '100'));
  assert.strictEqual(reconcile({ state: 'reported', applied: a.result }, [a, bad], started).op, 'reset');
});

test('次の試合の探し方: 2 人の試合が 60 件より多くてもページをまたいで見つける', async () => {
  const fake = fakeStartgg();
  const filler = (n) => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, state: 3, slots: [{ prereqType: 'set', prereqId: 1 }] }));
  const pages = [filler(60), [...filler(10), { id: 101, state: 3, slots: [{ prereqType: 'set', prereqId: 100 }] }]];
  const inner = fake.fetch;
  fake.fetch = async (url, init) => {
    if (!url.includes('/oauth/')) {
      const { query, variables } = JSON.parse(init.body);
      if (/query SpspReportNext/.test(query)) {
        fake.calls.push('SpspReportNext:' + variables.page);
        return new Response(JSON.stringify({ data: { event: { sets: { pageInfo: { totalPages: 2 }, nodes: pages[variables.page - 1] || [] } } } }), { status: 200 });
      }
    }
    return inner(url, init);
  };
  const e = await enabled(fake);
  const A = await e.tok(11); const B = await e.tok(22);
  await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0, c: [null, null] }, { w: 0, c: [null, null] }] } });
  e.tick(5000);
  const r = await e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1, c: [null, null] }, { w: 1, c: [null, null] }] } });
  assert.deepStrictEqual([r.state, r.note], ['review', 'locked_conflict'], JSON.stringify(r));
  assert.ok(fake.calls.includes('SpspReportNext:2'), '2 ページ目も読む');
  assert.strictEqual(fake.set.state, 3, '取り消していない');
});

test('運営: 食い違いは片方の報告を採用して解決できる (キャラは各側の本人の入力)。報告の無い側は採用できない', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake);
  const A = await e.tok(11); const B = await e.tok(22);
  await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0, c: [1293, 1300], s: 3 }, { w: 0, c: [1293, null] }] } });
  e.tick(5000);
  let r = await e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1, c: [null, 1310], s: 5 }, { w: 0, c: [null, 1310] }, { w: 1, c: [null, 1311] }] } });
  assert.strictEqual(r.state, 'conflict');
  assert.strictEqual(fake.set.state, 1);
  e.tick(5000);
  // 運営以外は使えない
  r = await e.call({ action: 'report_admin_fix', token: A, code: e.code, set_id: '100', adopt: 1 });
  assert.strictEqual(r.error.code, 'not_admin');
  // B の報告を採用
  r = await e.call({ action: 'report_admin_fix', token: e.login.token, code: e.code, set_id: '100', adopt: 1 });
  assert.deepStrictEqual([r.ok, r.state, r.op], [true, 'fixed', 'report'], JSON.stringify(r));
  assert.strictEqual(fake.set.state, 3);
  assert.strictEqual(fake.last.winnerId, '2');
  assert.strictEqual(fake.last.gameData.length, 3);
  assert.deepStrictEqual(fake.last.gameData[0].selections, [{ entrantId: '1', characterId: '1293' }, { entrantId: '2', characterId: '1310' }], 'キャラは各側の本人の入力');
  assert.strictEqual(fake.last.gameData[0].stageId, '5', 'ステージは採用した側');
  const row = await e.store.getReportSet(e.code, '100');
  assert.strictEqual(row.state, 'fixed');
  // 運営が直した後は、その前の報告を採用できない (報告が無い)
  e.tick(5000);
  r = await e.call({ action: 'report_admin_fix', token: e.login.token, code: e.code, set_id: '100', adopt: 0 });
  assert.strictEqual(r.error.code, 'bad_request');
});

// ── 取り込み方 (2026-11-01) ──
test('reconcile の取り込み方: delay は 5 分待つ (相手の同じ報告ならすぐ)・both は両者の一致・approve は運営の承認・運営が止めた試合は動かさない', () => {
  const a = { result: R(0, G(0), G(0)), ts: 1000 };
  const b = { result: R(0, G(0), G(0)), ts: 2000 };
  const bad = { result: R(1, G(1), G(1)), ts: 2000 };
  const pend = (note) => ({ op: 'none', state: 'pending', result: null, note });
  assert.strictEqual(reconcile(null, [a, null], set0(), 'auto', 1000).op, 'report');
  assert.deepStrictEqual(reconcile(null, [a, null], set0(), 'delay', 1000 + 299e3), pend('wait_delay'));
  assert.strictEqual(reconcile(null, [a, null], set0(), 'delay', 1000 + 300e3).op, 'report', '5 分たったら反映');
  assert.strictEqual(reconcile(null, [a, b], set0(), 'delay', 2000).state, 'agreed', '相手も同じならすぐ');
  assert.strictEqual(reconcile(null, [a, bad], set0(), 'delay', 1e9).state, 'conflict', '違えば反映しない');
  assert.deepStrictEqual(reconcile(null, [a, null], set0(), 'both', 1e9), pend('wait_both'));
  assert.strictEqual(reconcile(null, [a, b], set0(), 'both', 0).op, 'report');
  assert.deepStrictEqual(reconcile(null, [a, null], set0(), 'approve', 1e9), pend('wait_admin'));
  assert.deepStrictEqual(reconcile(null, [a, b], set0(), 'approve', 1e9), pend('wait_admin'), '一致していても承認待ち');
  assert.deepStrictEqual(reconcile({ state: 'review', applied: null, note: 'hold' }, [a, b], set0(), 'auto', 1e9), { op: 'none', state: 'review', result: null, note: 'hold' });
  assert.deepStrictEqual(parseSettings({ apply: 'delay', notify: 'action' }).apply, 'delay');
  assert.strictEqual(parseSettings({ apply: 'auto', notify: 'off' }).apply, undefined, '既定値は持たない');
  assert.strictEqual(parseSettings({ apply: 'x', notify: 'y' }).notify, undefined);
});

test('5 分後に取り込む: 待っている間は送らず、5 分たって画面が読みに来たら送る。運営が止めたら送らず、承認で送る', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake, { top_cut: null, classes_only: false, apply: 'delay' });
  const A = await e.tok(11);
  const win0 = { w: 0, g: [{ w: 0 }, { w: 0 }] };
  let r = await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: win0 });
  assert.deepStrictEqual([r.state, r.op, r.note], ['pending', 'none', 'wait_delay']);
  assert.notStrictEqual(fake.set.state, 3, 'まだ送らない');
  e.tick(4 * 60e3);
  await e.call({ action: 'report_view', token: A, code: e.code });
  assert.notStrictEqual(fake.set.state, 3, '4 分ではまだ');
  e.tick(61e3);
  const v = await e.call({ action: 'report_view', token: A, code: e.code });
  assert.strictEqual(fake.set.state, 3, '5 分たったら送る');
  assert.strictEqual(v.sets[0].state, 'reported');

  // 止める → 5 分たっても送らない → 承認で送る
  const fake2 = fakeStartgg();
  const e2 = await enabled(fake2, { top_cut: null, classes_only: false, apply: 'delay' });
  const A2 = await e2.tok(11);
  await e2.call({ action: 'report_submit', token: A2, code: e2.code, set_id: '100', result: win0 });
  r = await e2.call({ action: 'report_admin_fix', token: e2.login.token, code: e2.code, set_id: '100', hold: true });
  assert.deepStrictEqual([r.ok, r.state], [true, 'review'], JSON.stringify(r));
  e2.tick(10 * 60e3);
  const adm = await e2.call({ action: 'report_admin', token: e2.login.token, code: e2.code });
  assert.notStrictEqual(fake2.set.state, 3, '止めた試合は送らない');
  assert.strictEqual(adm.sets[0].note, 'hold');
  r = await e2.call({ action: 'report_admin_fix', token: e2.login.token, code: e2.code, set_id: '100', hold: true });
  assert.strictEqual(r.error.code, 'bad_request', '取り込み待ちでなければ止められない');
  r = await e2.call({ action: 'report_admin_fix', token: e2.login.token, code: e2.code, set_id: '100', adopt: 0 });
  assert.deepStrictEqual([r.ok, r.state], [true, 'fixed'], JSON.stringify(r));
  assert.strictEqual(fake2.set.state, 3);
});

test('運営の承認が必要: 両者が一致しても承認待ち、運営が承認したら送る。両者の報告が必要: そろうまで送らない', async () => {
  const fake = fakeStartgg();
  const e = await enabled(fake, { top_cut: null, classes_only: false, apply: 'approve' });
  const A = await e.tok(11); const B = await e.tok(22);
  const win0 = { w: 0, g: [{ w: 0 }, { w: 0 }] };
  await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: win0 });
  e.tick(5000);
  let r = await e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: win0 });
  assert.deepStrictEqual([r.state, r.note], ['pending', 'wait_admin']);
  e.tick(3600e3);
  await e.call({ action: 'report_admin', token: e.login.token, code: e.code });
  assert.notStrictEqual(fake.set.state, 3, '時間では送らない');
  r = await e.call({ action: 'report_admin_fix', token: e.login.token, code: e.code, set_id: '100', adopt: 0 });
  assert.deepStrictEqual([r.ok, r.state], [true, 'fixed']);
  assert.strictEqual(fake.set.state, 3);

  const fake2 = fakeStartgg();
  const e2 = await enabled(fake2, { top_cut: null, classes_only: false, apply: 'both' });
  const A2 = await e2.tok(11); const B2 = await e2.tok(22);
  r = await e2.call({ action: 'report_submit', token: A2, code: e2.code, set_id: '100', result: win0 });
  assert.deepStrictEqual([r.state, r.note], ['pending', 'wait_both']);
  assert.notStrictEqual(fake2.set.state, 3);
  e2.tick(5000);
  r = await e2.call({ action: 'report_submit', token: B2, code: e2.code, set_id: '100', result: win0 });
  assert.deepStrictEqual([r.state, r.op], ['agreed', 'report']);
  assert.strictEqual(fake2.set.state, 3);
  // 取り込み方を「すぐ」に戻すと、待っていた試合は次に画面が読みに来たとき送る
  const fake3 = fakeStartgg();
  const e3 = await enabled(fake3, { top_cut: null, classes_only: false, apply: 'both' });
  await e3.call({ action: 'report_submit', token: await e3.tok(11), code: e3.code, set_id: '100', result: win0 });
  await e3.call({ action: 'report_settings', token: e3.login.token, code: e3.code, settings: { top_cut: null, classes_only: false } });
  await e3.call({ action: 'report_admin', token: e3.login.token, code: e3.code });
  assert.strictEqual(fake3.set.state, 3);
});

// ── 運営への通知 (Web Push) ──
async function pushKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const b64u = (buf) => Buffer.from(buf).toString('base64url');
  const vapid = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateKey: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d, subject: 'https://spsp.games/' };
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
  return { vapid, sub };
}

test('運営への通知: 端末を登録 → 設定 (対応が要るときだけ / 報告のたび) に合わせて送る。410 の端末は消す。運営以外はテスト送信できない', async () => {
  const fake = fakeStartgg();
  const pushes = [];
  let gone = false;
  const base = fake.fetch;
  fake.fetch = async (url, init) => {
    if (String(url).startsWith('https://push.example/')) { pushes.push(init.headers); return new Response('', { status: gone ? 410 : 201 }); }
    return base(url, init);
  };
  const e = await enabled(fake, { top_cut: null, classes_only: false, notify: 'action' });
  const { vapid, sub } = await pushKeys();
  // 鍵が無いと登録できない
  assert.strictEqual((await e.call({ action: 'report_push_key' })).key, null);
  assert.strictEqual((await e.call({ action: 'report_push_subscribe', token: e.login.token, sub })).error.code, 'not_allowed');
  e.cfg.vapid = vapid;
  assert.strictEqual((await e.call({ action: 'report_push_key' })).key, vapid.publicKey);
  assert.strictEqual((await e.call({ action: 'report_push_subscribe', token: e.login.token, sub: { endpoint: 'http://x/' } })).error.code, 'bad_request');
  assert.strictEqual((await e.call({ action: 'report_push_subscribe', token: e.login.token, sub })).ok, true);
  const A = await e.tok(11); const B = await e.tok(22);
  // 対応が要るときだけ: ふつうの報告では送らない、食い違いで送る
  await e.call({ action: 'report_submit', token: A, code: e.code, set_id: '100', result: { w: 0, g: [{ w: 0 }, { w: 0 }] } });
  assert.strictEqual(pushes.length, 0);
  e.tick(5000);
  await e.call({ action: 'report_submit', token: B, code: e.code, set_id: '100', result: { w: 1, g: [{ w: 1 }, { w: 1 }] } });
  assert.strictEqual(pushes.length, 1, '食い違いで送る');
  assert.strictEqual(pushes[0]['Content-Encoding'], 'aes128gcm');
  assert.strictEqual(pushes[0].Urgency, 'high');
  // テスト送信: 運営だけ
  assert.strictEqual((await e.call({ action: 'report_push_test', token: A, code: e.code })).error.code, 'not_admin');
  assert.strictEqual((await e.call({ action: 'report_push_test', token: e.login.token, code: e.code })).sent, 1);
  // 410 → 購読を消す
  gone = true;
  assert.strictEqual((await e.call({ action: 'report_push_test', token: e.login.token, code: e.code })).sent, 0);
  assert.deepStrictEqual(await e.store.listReportPushSubs(['4242']), []);
  // 登録・解除
  gone = false;
  await e.call({ action: 'report_push_subscribe', token: e.login.token, sub });
  await e.call({ action: 'report_push_unsubscribe', token: A, endpoint: sub.endpoint });
  assert.strictEqual((await e.store.listReportPushSubs(['4242'])).length, 1, 'ほかの人は解除できない');
  await e.call({ action: 'report_push_unsubscribe', token: e.login.token, endpoint: sub.endpoint });
  assert.strictEqual((await e.store.listReportPushSubs(['4242'])).length, 0);
});
