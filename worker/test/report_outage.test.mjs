// 試合結果の報告: start.gg に繋がらないとき (src/api/report_outage.ts と report.ts の障害時の流れ、docs/self_report_design.md §11)。
// start.gg は偽物 (本物には書き込まない)。
import test from 'node:test';
import assert from 'node:assert';
import { dispatch } from '../src/api/router.ts';
import { SESSION_TTL_MS_DEFAULT, STATE_TTL_MS_DEFAULT } from '../src/config.ts';
import { issueSessionToken } from '../src/api/session.ts';
import {
  absorbSet, bracketCandidates, candidateFor, emptySnapshot, flipResult, heldResult, isOutageNote, offlineDecision, pickFound, snapMine, snapNSet,
} from '../src/api/report_outage.ts';
import { MemStore } from './_mem_store.mjs';

const G = (w, c0 = null, c1 = null, s = null) => ({ w, c: [c0, c1], s });
const R = (w, ...g) => ({ w, g });
const W2 = (w) => R(w, G(w), G(w));

// ── 判定 ──
test('isOutageNote: 繋がらない・5xx・429・タイムアウトだけ (set が無い・権限が無い等は違う)', () => {
  for (const n of ['timeout', 'network', 'bad_json', 'http_503', 'http_502:Bad Gateway', 'http_429', 'next:timeout', 'find:network', 'outage_skip', 'gql:An unknown error has occurred']) assert.ok(isOutageNote(n), n);
  for (const n of ['set_not_found', 'gql:nope', 'http_401', 'http_400:bad', 'no_entrant', 'gql:Set not found']) assert.ok(!isOutageNote(n), n);
});

test('offlineDecision: 障害中は queued。食い違いは conflict、運営が確定・止めた試合は動かさない、運営の直しが待っていればそのまま', () => {
  assert.deepStrictEqual(offlineDecision(null, [W2(0), null], false), { state: 'queued', note: 'outage' });
  assert.deepStrictEqual(offlineDecision(null, [W2(0), W2(0)], false), { state: 'queued', note: 'outage' });
  assert.deepStrictEqual(offlineDecision(null, [W2(0), W2(1)], false), { state: 'conflict', note: 'outage' });
  assert.deepStrictEqual(offlineDecision(null, [W2(0), null], true), { state: 'queued', note: 'manual' });
  assert.deepStrictEqual(offlineDecision({ state: 'queued', note: 'manual_wait' }, [W2(0), null], true), { state: 'queued', note: 'manual_wait' });
  assert.strictEqual(offlineDecision({ state: 'fixed', note: 'admin' }, [W2(1), null], false).state, 'fixed');
  assert.deepStrictEqual(offlineDecision({ state: 'review', note: 'hold' }, [W2(1), null], false), { state: 'review', note: 'hold' });
  assert.deepStrictEqual(offlineDecision({ state: 'queued', note: 'outage_admin' }, [W2(1), null], false), { state: 'queued', note: 'outage_admin' });
});

test('heldResult: 運営の直し → その結果、選手の報告 → 一致か片方だけ (食い違いは数えない)、運営の取り消しの後の報告だけ', () => {
  const row = (o) => ({ code: 'c', set_id: '1', state: 'queued', users: '', slots: '[]', applied: '', note: 'outage', floor_id: 0, version: 1, updated_ms: 0, ...o });
  const sub = (id, side, r) => ({ id, code: 'c', set_id: '1', user_id: 'u', side, ts_ms: id, result: r ? JSON.stringify(r) : '', outcome: '' });
  assert.deepStrictEqual(heldResult(row(), [sub(1, 0, W2(0))]), W2(0));
  assert.deepStrictEqual(heldResult(row(), [sub(1, 0, W2(0)), sub(2, 1, W2(0))]), W2(0));
  assert.strictEqual(heldResult(row(), [sub(1, 0, W2(0)), sub(2, 1, W2(1))]), null);
  assert.strictEqual(heldResult(row({ floor_id: 2 }), [sub(1, 0, W2(0)), sub(2, -1, null)]), null, '取り消しの前の報告は数えない');
  assert.deepStrictEqual(heldResult(row({ note: 'outage_admin', floor_id: 3 }), [sub(1, 0, W2(0)), sub(3, -1, W2(1))]), W2(1));
  assert.strictEqual(heldResult(row({ note: 'outage_reset', floor_id: 3 }), [sub(1, 0, W2(0))]), null);
});

test('flipResult / pickFound: 指定した 2 人の並びが start.gg と逆なら側を入れ替える。結果の入った試合は選ばない', () => {
  assert.deepStrictEqual(flipResult(R(0, G(0, 1, 2, 3), G(1, 4, 5, null))), R(1, G(1, 2, 1, 3), G(0, 5, 4, null)));
  const n = (id, state, round, a, b) => ({ id, state, round, slots: [{ entrant: a ? { id: a } : null }, { entrant: b ? { id: b } : null }] });
  assert.deepStrictEqual(pickFound([n(5, 3, -1, 'e1', 'e2'), n(6, 1, 2, 'e2', 'e1')], ['e1', 'e2'], 'l'), { id: '6', flip: true }, '終わった試合 (以前の対戦) は選ばない');
  assert.deepStrictEqual(pickFound([n(6, 1, 2, 'e1', 'e2'), n(7, 1, -2, 'e1', 'e2')], ['e1', 'e2'], 'l'), { id: '7', flip: false }, '敗者側を先に');
  assert.strictEqual(pickFound([n(8, 1, -2, 'e1', null), n(9, 1, -2, 'e1', 'e3')], ['e1', 'e2'], 'l'), null);
});

// 8 人のダブルイリミ 1 ブロックの写し: 勝者側 1 回戦 4 試合 (s1〜s4)・2 回戦 (s5, s6)・敗者側 1 回戦 (s7, s8)
function snap8() {
  const snap = emptySnapshot();
  const ent = (i) => ({ id: 'e' + i, name: 'P' + i, initialSeedNum: i, participants: [{ user: { id: String(100 + i) } }] });
  const slot = (e, pre, place) => ({ entrant: e ? ent(e) : null, prereqType: pre ? 'set' : null, prereqId: pre ? String(pre) : null, prereqPlacement: place || null });
  const pg = { id: 700, displayIdentifier: 'A1', phase: { id: 77, name: 'Pools', groupCount: 4 } };
  const set = (id, state, round, a, b, winner, pre) => ({ id, state, round, fullRoundText: 'R' + round, winnerId: winner ? 'e' + winner : null, lPlacement: 5, updatedAt: id, phaseGroup: pg,
    slots: [slot(a, pre && pre[0], pre && pre[2]), slot(b, pre && pre[1], pre && pre[2])] });
  for (const s of [
    set(1, 3, 1, 1, 8, 1), set(2, 3, 1, 4, 5, 4), set(3, 2, 1, 2, 7, null), set(4, 1, 1, 3, 6, null),
    set(5, 1, 2, 1, 4, null), set(6, 1, 2, null, null, null, [3, 4, 1]),
    set(7, 1, -1, 8, 5, null), set(8, 1, -1, null, null, null, [3, 4, 2]),
  ]) absorbSet(snap, s, 1);
  return snap;
}

test('写し: start.gg の形に戻して選手の画面に出す (自分の試合・試合待ちの前の試合)。判定用の形も作れる', () => {
  const snap = snap8();
  const mine = snapMine(snap, '102');   // P2 = s3 (試合中)。s6・s8 は前の試合の枠なのでまだ居ない
  assert.deepStrictEqual(mine.sets.map((s) => s.id), ['3']);
  assert.deepStrictEqual(mine.pre, {});
  assert.strictEqual(mine.entrant, true);
  assert.strictEqual(snapMine(snap, '999').entrant, false);
  const raw = mine.sets.find((s) => s.id === '3');
  assert.strictEqual(raw.slots[0].entrant.participants[0].user.id, '102');
  assert.strictEqual(raw.phaseGroup.phase.name, 'Pools');
  const ns = snapNSet(snap, '1');
  assert.deepStrictEqual([ns.complete, ns.remote.w, ns.slots[1].users[0], ns.phaseKey, ns.round], [true, 0, '108', '77', 1]);
  assert.strictEqual(snapNSet(snap, '99'), null);
  // 試合待ち: 相手の枠の前の試合を 3 段まで (P1 が勝者側 2 回戦で、相手の枠が s3 の勝者だったとき)
  snap.sets['5'].sl[1] = { pt: 'set', pi: '2', pp: 1, e: null, sc: null };
  snap.sets['2'].s = 1; snap.sets['2'].sl[1] = { pt: 'set', pi: '3', pp: 1, e: null, sc: null };
  const p1 = snapMine(snap, '101');
  assert.deepStrictEqual(Object.keys(p1.pre).sort(), ['2', '3']);
});

test('次の試合の候補: 勝者側 = 負けていない人、敗者側 = 敗者側で負けていない人 (勝者側の負けが未反映の人も出す・未反映でも敗者側で負けた人は出さない)', () => {
  const snap = snap8();
  // SPSP に未反映: s3 は P2 の勝ち (P7 が勝者側で負け)、s7 は P5 の勝ち (P8 が敗者側で負け = 敗退)
  const held = [{ group: '700', side: 'w', loser: 'e7' }, { group: '700', side: 'l', loser: 'e8' }];
  const [g] = bracketCandidates(snap, held, new Set(['e6']));   // P6 は結果の出ていない指定済みの試合がある
  assert.strictEqual(g.id, '700');
  assert.strictEqual(g.name, 'Pools A1');
  const pick = (side) => g.entrants.filter((e) => candidateFor(e, side)).map((e) => e.name);
  assert.deepStrictEqual(pick('w'), ['P1', 'P2', 'P3', 'P4'], '勝者側: start.gg・未反映とも負けていない人 (指定済みの P6 は出さない)');
  assert.deepStrictEqual(pick('l'), ['P1', 'P2', 'P3', 'P4', 'P5', 'P7'],
    '敗者側: P5 (start.gg で勝者側の負け)・P7 (未反映の勝者側の負け) と、負けていない人。P8 (未反映でも敗者側で負け) は出さない');
  const p7 = g.entrants.find((e) => e.name === 'P7');
  assert.deepStrictEqual([p7.wl, p7.hw, p7.playing], [false, true, true]);
});

// ── 偽の start.gg (ブラケットが進む) ──
function fakeBracket() {
  const ent = (i) => ({ id: i, name: 'P' + i, initialSeedNum: i, participants: [{ user: { id: 10 + i } }] });
  const pg = { id: 700, displayIdentifier: '1', phase: { id: 77, name: 'Main', groupCount: 1 } };
  const mk = (id, round, a, b, pre) => ({ id, state: 1, round, fullRoundText: 'R' + round, winnerId: null, totalGames: 5, lPlacement: round > 0 ? 5 : 3, updatedAt: 1,
    event: { id: 9, name: 'Singles' }, phaseGroup: pg, games: null, station: null,
    slots: [0, 1].map((k) => ({ entrant: [a, b][k] ? ent([a, b][k]) : null, prereqType: pre ? 'set' : null, prereqId: pre ? pre[k][0] : null, prereqPlacement: pre ? pre[k][1] : null })) });
  // 4 人: 100 = P1 vs P2、101 = P3 vs P4 (勝者側 1 回戦)、102 = 勝者側決勝、103 = 敗者側 1 回戦 (それぞれの負け)
  const st = {
    sets: [mk(100, 1, 1, 2), mk(101, 1, 3, 4), mk(102, 2, null, null, [[100, 1], [101, 1]]), mk(103, -1, null, null, [[100, 2], [101, 2]])],
    down: false, calls: [], mutations: [],
  };
  const byId = (id) => st.sets.find((s) => String(s.id) === String(id));
  const advance = (s) => {
    const w = s.slots.find((x) => x.entrant && x.entrant.id === s.winnerId);
    const l = s.slots.find((x) => x.entrant && x.entrant.id !== s.winnerId);
    for (const n of st.sets) for (const x of n.slots) {
      if (String(x.prereqId) !== String(s.id)) continue;
      x.entrant = x.prereqPlacement === 1 ? (w ? w.entrant : null) : (l ? l.entrant : null);
    }
  };
  st.fetch = async (url, init) => {
    if (st.down) throw new TypeError('fetch failed');
    if (url.includes('/oauth/')) {
      const b = JSON.parse(init.body);
      st.calls.push(b.grant_type === 'refresh_token' ? 'refresh' : 'exchange');
      return new Response(JSON.stringify({ access_token: 'AT-1', expires_in: 3600, refresh_token: 'RT-1' }), { status: 200 });
    }
    const { query, variables } = JSON.parse(init.body);
    const name = (/(?:query|mutation)\s+(\w+)/.exec(query) || [])[1] || (query.includes('currentUser') ? 'me' : '?');
    st.calls.push(name);
    const j = (data) => new Response(JSON.stringify({ data }), { status: 200 });
    if (name === 'me' || /^query \{ currentUser/.test(query)) return j({ currentUser: { id: 4242, slug: 'user/x', player: { gamerTag: 'TO' } } });
    if (name === 'SpspReportEvent') return j({ event: { id: 9, name: 'Singles', slug: 'tournament/t/event/singles', tournament: { id: 5, name: 'Test Cup', endAt: Math.floor(Date.now() / 1000) + 3600 } } });
    if (name === 'SpspClassAdmin') return j({ currentUser: { id: 4242 }, event: { id: 9, tournament: { id: 5, owner: { id: 1 }, admins: [{ id: 4242 }] } } });
    if (name === 'SpspReportSnap') return j({ event: { sets: { pageInfo: { totalPages: 1 }, nodes: st.sets } } });
    if (name === 'SpspReportSet') return j({ set: byId(variables.id) || null });
    if (name === 'SpspReportNext' || name === 'SpspReportFind') {
      const ids = variables.entrantIds.map(String);
      return j({ event: { sets: { pageInfo: { totalPages: 1 }, nodes: st.sets.filter((s) => s.slots.some((x) => x.entrant && ids.includes(String(x.entrant.id)))) } } });
    }
    if (name === 'SpspReportBracketSet' || name === 'SpspUpdateSet') {
      const s = byId(variables.setId);
      s.state = 3; s.winnerId = Number(variables.winnerId);
      s.games = variables.gameData.map((g) => ({ orderNum: g.gameNum, winnerId: Number(g.winnerId) }));
      st.mutations.push([name, String(variables.setId), Number(variables.winnerId)]);
      advance(s);
      return j({ x: { id: s.id, state: 3 } });
    }
    if (name === 'SpspResetSet') { const s = byId(variables.setId); s.state = 1; s.winnerId = null; s.games = null; st.mutations.push(['reset', String(variables.setId)]); return j({ resetSet: { id: s.id } }); }
    return j({});
  };
  return st;
}

async function setup() {
  const fake = fakeBracket();
  const store = new MemStore();
  const cfg = { clientId: 'cid', redirectUri: 'https://x/callback.html', clientSecret: 'CS', sessionSecret: 'sess-' + Math.random(),
    sessionTtlMs: SESSION_TTL_MS_DEFAULT, stateTtlMs: STATE_TTL_MS_DEFAULT, tsOffsetMin: 540 };
  let now = Date.now();
  const ctx = { cfg, store, fetch: fake.fetch, dataFetch: async () => { throw new Error('no'); }, now: () => now };
  const call = (b) => dispatch(ctx, b);
  const tok = (uid) => issueSessionToken(cfg, { id: String(uid), slug: '', gamerTag: '' }, now);
  const b = await call({ action: 'report_begin', nonce: 'N', returnPath: '/jp/report/' });
  const l = await call({ action: 'report_login', code: 'C', state: new URL(b.url).searchParams.get('state') });
  const r = await call({ action: 'report_enable', token: l.token, event: '9' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const e = { fake, store, call, tok, admin: l.token, code: r.report.code, tick: (ms) => { now += ms; } };
  e.view = async (uid, extra = {}) => call({ action: 'report_view', token: await tok(uid), code: e.code, ...extra });
  e.submit = async (uid, setId, result) => call({ action: 'report_submit', token: await tok(uid), code: e.code, set_id: setId, result });
  return e;
}

test('障害中の報告: D1 に残して (queued) 選手・運営に未反映と出す → 復旧したら start.gg に送る', async () => {
  const e = await setup();
  // start.gg が読めるあいだに写しを作る
  let v = await e.view(11);
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.outage, null);
  assert.ok(Object.keys(JSON.parse(e.store.reportSnaps[0].data).sets).length === 4, '写しを作る');
  e.tick(4000);
  e.fake.down = true;
  // 1 人目: start.gg に繋がらない → 写しで確かめて D1 に残す
  let r = await e.submit(11, '100', W2(0));
  assert.deepStrictEqual([r.ok, r.state, r.offline], [true, 'queued', true], JSON.stringify(r));
  e.tick(4000);
  r = await e.submit(12, '100', W2(0));   // 相手も同じ結果
  assert.deepStrictEqual([r.state, r.note], ['queued', 'outage']);
  assert.strictEqual(e.fake.mutations.length, 0);
  // 続けて失敗したので障害中: start.gg を呼ばずに写しを返す
  const before = e.fake.calls.length;
  v = await e.view(11);
  assert.ok(v.outage && v.outage.since_ms > 0, '障害中と出す');
  assert.ok(v.snap && v.snap.entrant === true && v.snap.sets.some((s) => String(s.id) === '100'), '自分の試合は写しから');
  assert.strictEqual(v.sets.find((s) => s.set_id === '100').state, 'queued');
  assert.strictEqual(e.fake.calls.length, before, '障害中は試す番まで start.gg を呼ばない');
  const a = await e.call({ action: 'report_admin', token: e.admin, code: e.code });
  assert.ok(a.outage);
  assert.strictEqual(a.sets.find((s) => s.set_id === '100').state, 'queued');
  // 写しにも D1 にも無い試合は確かめられない
  r = await e.submit(13, '102', W2(0));
  assert.strictEqual(r.error.code, 'not_ready');
  // 復旧: 試す番 (30 秒後) に送る
  e.fake.down = false;
  e.tick(31000);
  v = await e.view(13);
  assert.deepStrictEqual(e.fake.mutations, [['SpspReportBracketSet', '100', 1]]);
  assert.strictEqual(v.outage, null, '1 回通れば障害を解く');
  const row = await e.store.getReportSet(e.code, '100');
  assert.deepStrictEqual([row.state, row.note], ['agreed', '']);
  assert.ok(e.store.reportSubs.filter((s) => s.set_id === '100').every((s) => /^queued:/.test(s.outcome)));
});

test('障害中に運営が次の試合を指定 → 選手が報告 → 復旧後に前の試合から順に送り、同じ 2 人の start.gg の試合に移して送る (並びが逆でも)', async () => {
  const e = await setup();
  await e.view(11);
  e.tick(4000);
  e.fake.down = true;
  // 勝者側 1 回戦: P1 が P2 に勝ち (SPSP に保存)、P3 が P4 に勝ち (だれも報告していない = start.gg にも SPSP にも無い)
  assert.strictEqual((await e.submit(11, '100', W2(0))).state, 'queued');
  e.tick(4000);
  assert.strictEqual((await e.submit(12, '100', W2(0))).state, 'queued');
  // 候補: 敗者側に P4 (勝者側の負けがどこにも無い) も出る。P2 は未反映の勝者側の負けで、勝者側には出ない
  const b = await e.call({ action: 'report_bracket', token: e.admin, code: e.code });
  assert.strictEqual(b.ok, true, JSON.stringify(b));
  const g = b.groups[0];
  const names = (side) => g.entrants.filter((x) => candidateFor(x, side)).map((x) => x.name);
  assert.deepStrictEqual(names('w'), ['P1', 'P3', 'P4']);
  assert.deepStrictEqual(names('l'), ['P1', 'P2', 'P3', 'P4']);
  // 敗者側: P4 vs P2 (start.gg の試合 103 は P2 vs P4 の並び = 逆)
  let m = await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '700', side: 'l', entrants: ['4', '2'], station: '3' });
  assert.strictEqual(m.ok, true, JSON.stringify(m));
  const mid = m.manual.set_id;
  assert.match(mid, /^m\d+$/);
  // 同じ人をもう一度は指定できない・勝者側で負けた人は勝者側に出せない
  assert.strictEqual((await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '700', side: 'l', entrants: ['4', '1'] })).error.code, 'bad_request');
  assert.strictEqual((await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '700', side: 'w', entrants: ['2', '3'] })).error.code, 'bad_request');
  assert.strictEqual((await e.call({ action: 'report_manual_create', token: await e.tok(11), code: e.code, group: '700', side: 'w', entrants: ['1', '3'] })).error.code, 'not_admin');
  // 選手の画面に出る (P2 = uid 12)
  let v = await e.view(12);
  assert.deepStrictEqual(v.manual.map((x) => [x.set_id, x.side, x.station, x.slots.map((s) => s.name).join('-')]), [[mid, 'l', '3', 'P4-P2']]);
  assert.deepStrictEqual((await e.view(11)).manual, []);
  // P2 (側 1) が勝ちを報告 → 指定した試合の報告として D1 に
  e.tick(4000);
  let r = await e.submit(12, mid, R(1, G(1, null, 1293), G(1)));
  assert.deepStrictEqual([r.state, r.note, r.offline], ['queued', 'manual', true], JSON.stringify(r));
  assert.strictEqual((await e.submit(99, mid, W2(1))).error.code, 'not_player');
  // 未反映でも敗者側で負けた P4 は、敗者側の候補に出ない
  const b2 = await e.call({ action: 'report_bracket', token: e.admin, code: e.code });
  assert.deepStrictEqual(b2.groups[0].entrants.filter((x) => candidateFor(x, 'l')).map((x) => x.name), ['P1', 'P2', 'P3']);
  // 復旧: まず 100 を送る。103 は P3 vs P4 の結果がまだ start.gg に無いので P2 だけ → 見つからない (待つ)
  e.fake.down = false;
  e.tick(31000);
  await e.view(11);
  assert.deepStrictEqual(e.fake.mutations, [['SpspReportBracketSet', '100', 1]]);
  assert.strictEqual((await e.store.getReportSet(e.code, mid)).note, 'manual_wait');
  // 運営が start.gg で 101 (P3 の勝ち) を入れた → 103 に P2 vs P4 がそろう → 指定した試合を 103 に移して送る (側を入れ替え)
  const s101 = e.fake.sets.find((s) => s.id === 101);
  s101.state = 3; s101.winnerId = 3;
  for (const n of e.fake.sets) for (const x of n.slots) if (x.prereqId === 101) x.entrant = x.prereqPlacement === 1 ? s101.slots[0].entrant : s101.slots[1].entrant;
  e.tick(61000);
  await e.view(11);
  e.tick(1000);
  await e.view(11);
  assert.deepStrictEqual(e.fake.mutations.slice(1), [['SpspReportBracketSet', '103', 2]], 'P2 (entrant 2) の勝ちとして 103 に送る');
  const man = (await e.store.listReportManual(e.code))[0];
  assert.deepStrictEqual([man.status, man.set_id], ['matched', '103']);
  assert.strictEqual(await e.store.getReportSet(e.code, mid), null);
  const row = await e.store.getReportSet(e.code, '103');
  assert.strictEqual(row.state, 'reported');
  const sub = e.store.reportSubs.find((s) => s.set_id === '103');
  assert.deepStrictEqual([sub.side, JSON.parse(sub.result).w, JSON.parse(sub.result).g[0].c], [0, 0, [1293, null]], '報告の側とキャラも入れ替える');
  v = await e.view(12);
  assert.deepStrictEqual(v.manual, [], '移った後は指定した試合として出さない');
  // 移った試合への報告は start.gg の試合へ
  e.tick(4000);
  r = await e.submit(14, mid, W2(1));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.set_id, '103');
});

test('障害中の運営の直し・取り消し: D1 に残して復旧後に送る。指定の取り消しで報告は数えない', async () => {
  const e = await setup();
  await e.view(11);
  e.tick(4000);
  e.fake.down = true;
  await e.submit(11, '100', W2(0));
  e.tick(4000);
  await e.submit(12, '100', W2(1));   // 食い違い
  assert.strictEqual((await e.store.getReportSet(e.code, '100')).state, 'conflict');
  let x = await e.call({ action: 'report_admin_fix', token: e.admin, code: e.code, set_id: '100', adopt: 1 });
  assert.deepStrictEqual([x.ok, x.state, x.note], [true, 'queued', 'outage_admin'], JSON.stringify(x));
  // 指定して取り消す
  const m = await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '700', side: 'w', entrants: ['3', '4'] });
  await e.submit(13, m.manual.set_id, W2(0));
  x = await e.call({ action: 'report_manual_cancel', token: e.admin, code: e.code, id: m.manual.id });
  assert.strictEqual(x.ok, true);
  assert.strictEqual((await e.store.getReportSet(e.code, m.manual.set_id)).state, 'reset');
  assert.strictEqual((await e.submit(14, m.manual.set_id, W2(0))).error.code, 'not_found');
  // 復旧: 運営が採用した P2 の勝ちを送る
  e.fake.down = false;
  e.tick(31000);
  await e.view(11);
  assert.deepStrictEqual(e.fake.mutations, [['SpspReportBracketSet', '100', 2]]);
  assert.strictEqual((await e.store.getReportSet(e.code, '100')).state, 'fixed');
});

test('障害中もトークンの延長に失敗しただけでは受付を閉じない', async () => {
  const e = await setup();
  await e.view(11);
  e.tick(3600 * 1000 - 5 * 60 * 1000);   // 期限の 5 分前 = 延長する番
  e.fake.down = true;
  const v = await e.view(11);
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  const r = await e.submit(11, '100', W2(0));
  assert.strictEqual(r.state, 'queued');
});
