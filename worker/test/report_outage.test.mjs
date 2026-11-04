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
  assert.deepStrictEqual(pickFound([n(5, 3, -1, 'e1', 'e2'), n(6, 1, -2, 'e2', 'e1')], ['e1', 'e2'], 'l'), { id: '6', flip: true }, '終わった試合 (以前の対戦) は選ばない');
  assert.strictEqual(pickFound([n(6, 1, 2, 'e1', 'e2')], ['e1', 'e2'], 'l'), null, '側 (勝者側 / 敗者側) が合わない試合は選ばない (後の再戦など)');
  assert.deepStrictEqual(pickFound([n(6, 1, 2, 'e1', 'e2')], ['e1', 'e2'], 'g'), { id: '6', flip: false }, 'グランドファイナルは勝者側のラウンド');
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
  st.pushes = [];
  st.fetch = async (url, init) => {
    if (String(url).startsWith('https://push.example/')) { st.pushes.push(String(url)); return new Response('', { status: 201 }); }
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
    if (name === 'SpspReportDq') {
      const s = byId(variables.setId);
      s.state = 3; s.winnerId = Number(variables.winnerId); s.games = null;
      st.mutations.push(['dq', String(variables.setId), Number(variables.winnerId)]);
      advance(s);
      return j({ x: { id: s.id, state: 3 } });
    }
    if (name === 'SpspStartSet') { const s = byId(variables.setId); s.state = 2; st.mutations.push(['start', String(variables.setId)]); return j({ x: { id: s.id, state: 2 } }); }
    if (name === 'SpspReportNext' || name === 'SpspReportFind' || name === 'SpspReportSetsOf') {
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

async function setup(fake0) {
  const fake = fake0 || fakeBracket();
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
  const e = { fake, store, cfg, call, tok, admin: l.token, code: r.report.code, tick: (ms) => { now += ms; } };
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

async function pushKeys(endpoint) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const b64u = (buf) => Buffer.from(buf).toString('base64url');
  const vapid = { publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)), privateKey: (await crypto.subtle.exportKey('jwk', kp.privateKey)).d, subject: 'https://spsp.games/' };
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sub = { endpoint, keys: { p256dh: b64u(await crypto.subtle.exportKey('raw', ua.publicKey)), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) } };
  return { vapid, sub };
}

test('運営が次の試合を指定したら、通知を受け取る設定の選手の端末に知らせる (受付の notify の設定には関係なく)', async () => {
  const e = await setup();
  await e.view(11);
  const { vapid, sub } = await pushKeys('https://push.example/p4');
  e.cfg.vapid = vapid;
  assert.strictEqual((await e.call({ action: 'report_push_subscribe', token: await e.tok(14), sub })).ok, true, '選手も登録できる');
  const m = await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '700', side: 'w', entrants: ['3', '4'], station: '2' });
  assert.strictEqual(m.ok, true, JSON.stringify(m));
  assert.strictEqual(m.notified, 1);
  assert.deepStrictEqual(e.fake.pushes, ['https://push.example/p4']);
});

test('総当たり: 「この人とやる」を記録して両者の画面に返す (30 分まで)・報告したら消す。start.gg で試合中の人も返す', async () => {
  const e = await setup();
  await e.view(11);
  assert.strictEqual((await e.call({ action: 'report_pick', token: await e.tok(11), code: e.code, set_id: '100' })).ok, true);
  assert.strictEqual((await e.call({ action: 'report_pick', token: await e.tok(11), code: e.code, set_id: 'x' })).error.code, 'bad_request');
  let v = await e.view(12);
  assert.deepStrictEqual(v.picks, [{ u: '11', s: '100' }]);
  e.fake.sets[1].state = 2;   // 101 (P3 vs P4) が start.gg で開始
  e.tick(50 * 1000);
  v = await e.view(12);
  assert.deepStrictEqual(v.playing, [], '総当たりで相手を選んでいないときは写しを読まない');
  e.tick(1000);
  v = await e.view(12, { rr: true });
  assert.deepStrictEqual(v.playing.sort(), ['3', '4']);
  e.tick(4000);
  await e.submit(12, '100', W2(0));
  assert.deepStrictEqual((await e.view(12)).picks, [], '報告したら消す');
  await e.call({ action: 'report_pick', token: await e.tok(13), code: e.code, set_id: '101' });
  e.tick(31 * 60 * 1000);
  assert.deepStrictEqual((await e.view(12)).picks, [], '30 分より古いものは返さない');
});

test('総当たりのブロック: 候補は rr、指定は総当たり (負けた人も残る)・もう当たった組は指定できない。復旧後は同じ 2 人の試合へ', async () => {
  const fake = fakeBracket();
  // 総当たり 3 人: 200 = P1 vs P2 (終わり、P1 の勝ち)、201 = P1 vs P3、202 = P2 vs P3
  const ent = (i) => ({ id: i, name: 'P' + i, initialSeedNum: i, participants: [{ user: { id: 10 + i } }] });
  const pg = { id: 800, displayIdentifier: 'A', phase: { id: 88, name: 'RR', groupCount: 2 } };
  const mk = (id, a, b, st, w) => ({ id, state: st, round: 1, fullRoundText: 'Round 1', winnerId: w || null, totalGames: 5, lPlacement: null, updatedAt: 1, event: { id: 9, name: 'Singles' },
    phaseGroup: pg, games: null, station: null, slots: [a, b].map((x) => ({ entrant: ent(x), prereqType: 'seed', prereqId: null, prereqPlacement: null })) });
  fake.sets = [mk(200, 1, 2, 3, 1), mk(201, 1, 3, 1), mk(202, 2, 3, 1)];
  const e = await setup.call(null, fake);
  await e.view(11);
  const b = await e.call({ action: 'report_bracket', token: e.admin, code: e.code });
  const g = b.groups.find((x) => x.id === '800');
  assert.strictEqual(g.rr, true);
  assert.deepStrictEqual(g.done_pairs, ['1|2']);
  assert.deepStrictEqual(g.entrants.filter((x) => candidateFor(x, 'r')).map((x) => x.name), ['P1', 'P2', 'P3'], '負けた P2 も残る');
  assert.strictEqual((await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '800', side: 'r', entrants: ['2', '1'] })).error.code, 'bad_request', 'もう当たった');
  e.fake.down = true;
  const m = await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '800', side: 'r', entrants: ['3', '2'] });
  assert.strictEqual(m.ok, true, JSON.stringify(m));
  e.tick(4000);
  assert.strictEqual((await e.submit(13, m.manual.set_id, W2(0))).state, 'queued');
  e.fake.down = false;
  e.tick(61000);
  await e.view(11);
  e.tick(1000);
  await e.view(11);
  assert.deepStrictEqual(e.fake.mutations, [['SpspReportBracketSet', '202', 3]], 'P3 の勝ちとして 202 に送る (並びは逆)');
});

test('未反映の結果の書き出し: SPSP にあって start.gg に無い結果を古い順に (ブロック・ラウンド・勝者・スコア)。食い違いは結果なし', async () => {
  const e = await setup();
  await e.view(11);
  e.tick(4000);
  e.fake.down = true;
  await e.submit(11, '100', R(0, G(0), G(1), G(0)));
  e.tick(4000);
  await e.submit(13, '101', W2(0));
  e.tick(4000);
  await e.submit(14, '101', W2(1));
  const x = await e.call({ action: 'report_held_export', token: e.admin, code: e.code });
  assert.strictEqual(x.ok, true, JSON.stringify(x));
  assert.deepStrictEqual(x.items.map((i) => [i.set_id, i.group, i.round, i.winner, i.score, i.loser, i.state]),
    [['100', 'Main', 'R1', 'P1', '2-1', 'P2', 'queued'], ['101', 'Main', 'R1', null, null, null, 'conflict']]);
  assert.strictEqual((await e.call({ action: 'report_held_export', token: await e.tok(11), code: e.code })).error.code, 'not_admin');
});

// ── 対戦開始・対戦相手が見つからない・DQ (docs §12) ──
test('対戦相手が見つからない: 運営と相手に知らせる (最初と 10 分ごとだけ、連打は時刻と回数だけ)。相手か本人が対戦開始で解決・start.gg を試合中に', async () => {
  const e = await setup();
  await e.view(11);
  const keyA = await pushKeys('https://push.example/admin');
  const keyB = await pushKeys('https://push.example/p2');
  e.cfg.vapid = keyA.vapid;
  await e.call({ action: 'report_push_subscribe', token: e.admin, sub: keyA.sub });
  await e.call({ action: 'report_push_subscribe', token: await e.tok(12), sub: keyB.sub });
  const ns = async (uid) => e.call({ action: 'report_noshow', token: await e.tok(uid), code: e.code, set_id: '100' });
  let r = await ns(11);
  assert.deepStrictEqual([r.ok, r.notified, r.noshow.count], [true, true, 1], JSON.stringify(r));
  assert.deepStrictEqual(e.fake.pushes.sort(), ['https://push.example/admin', 'https://push.example/p2'], '運営と相手');
  r = await ns(11);   // 連打
  assert.deepStrictEqual([r.notified, r.noshow.count], [false, 1], '3 秒より短い押し直しは書かない');
  e.tick(60 * 1000);
  r = await ns(11);
  assert.deepStrictEqual([r.notified, r.noshow.count], [false, 2], '時刻と回数だけ進める');
  assert.strictEqual(e.fake.pushes.length, 2, '通知はしない');
  assert.strictEqual((await ns(13)).error.code, 'not_player');
  // 運営の画面・両者の画面
  let a = await e.call({ action: 'report_admin', token: e.admin, code: e.code });
  assert.deepStrictEqual(a.noshows.map((x) => [x.set_id, x.me, x.opp, x.count, x.status]), [['100', 'P1', 'P2', 2, 'open']]);
  assert.deepStrictEqual((await e.view(12)).noshows.map((x) => [x.set_id, x.by_me]), [['100', false]], '相手の画面に出る');
  e.tick(10 * 60 * 1000);
  r = await ns(11);
  assert.strictEqual(r.notified, true, '10 分たったらもう一度知らせる');
  // 運営への通知は設定で止められる (相手には送る)
  await e.call({ action: 'report_settings', token: e.admin, code: e.code, settings: { top_cut: null, classes_only: false, notify_noshow: false } });
  e.fake.pushes.length = 0;
  e.tick(11 * 60 * 1000);
  await ns(11);
  assert.deepStrictEqual(e.fake.pushes, ['https://push.example/p2']);
  // 相手が対戦開始 → 解決・start.gg を試合中に。2 回目は記録を変えない
  const st = await e.call({ action: 'report_start', token: await e.tok(12), code: e.code, set_id: '100' });
  assert.deepStrictEqual([st.ok, st.first, st.startgg, st.start.user_id], [true, true, true, '12'], JSON.stringify(st));
  assert.deepStrictEqual(e.fake.mutations, [['start', '100']]);
  const st2 = await e.call({ action: 'report_start', token: await e.tok(11), code: e.code, set_id: '100' });
  assert.deepStrictEqual([st2.first, st2.start.user_id], [false, '12']);
  a = await e.call({ action: 'report_admin', token: e.admin, code: e.code });
  assert.deepStrictEqual(a.noshows.map((x) => [x.status, x.note]), [['resolved', 'started']]);
  const v = await e.view(11);
  assert.deepStrictEqual(v.noshows, []);
  assert.deepStrictEqual(v.starts.map((x) => [x.set_id, x.by_me]), [['100', false]]);
  // 運営も対戦開始できる・選手でも運営でもない人はできない
  assert.strictEqual((await e.call({ action: 'report_start', token: e.admin, code: e.code, set_id: '101' })).ok, true);
  assert.strictEqual((await e.call({ action: 'report_start', token: await e.tok(99), code: e.code, set_id: '101' })).error.code, 'not_player');
  // 結果が来たら見つからないは解決
  e.tick(4000);
  await e.call({ action: 'report_noshow', token: await e.tok(13), code: e.code, set_id: '101' });
  e.tick(4000);
  await e.submit(13, '101', W2(0));
  a = await e.call({ action: 'report_admin', token: e.admin, code: e.code });
  assert.ok(a.noshows.filter((x) => x.set_id === '101').every((x) => x.status === 'resolved' && x.note === 'reported'));
});

test('DQ: 勝者側だけ = いまの勝者側の試合を相手の勝ちに / 敗者側だけ = 敗者側の試合が決まったら / 残り全部。候補からも外れる・障害中は待つ', async () => {
  const e = await setup();
  await e.view(11);
  // P2 を勝者側だけ DQ → 100 は P1 の勝ち (DQ)
  let d = await e.call({ action: 'report_dq', token: e.admin, code: e.code, entrant: '2', scope: 'w' });
  assert.strictEqual(d.ok, true, JSON.stringify(d));
  assert.deepStrictEqual(e.fake.mutations, [['dq', '100', 1]]);
  assert.deepStrictEqual([d.dq.status, d.dq.done_sets], ['done', '100']);
  const row = await e.store.getReportSet(e.code, '100');
  assert.deepStrictEqual([row.state, row.note], ['fixed', 'dq']);
  // P4 を敗者側だけ DQ: 敗者側の試合 (103) はまだ相手がいない → 待つ。勝者側 101 は DQ にしない
  d = await e.call({ action: 'report_dq', token: e.admin, code: e.code, entrant: '4', scope: 'l' });
  assert.strictEqual(d.dq.status, 'open');
  assert.strictEqual(e.fake.mutations.length, 1);
  // 候補: P4 は敗者側の候補に出ない (DQ が start.gg に入る前でも)
  const b = await e.call({ action: 'report_bracket', token: e.admin, code: e.code });
  assert.ok(!b.groups[0].entrants.filter((x) => candidateFor(x, 'l')).some((x) => x.id === '4'));
  // 101 (P3 vs P4) を P3 の勝ちで報告 → 103 に P2 vs P4 がそろう → 次の読みで DQ (障害中は待つ)
  e.tick(4000);
  await e.submit(13, '101', W2(0));
  e.fake.down = true;
  e.tick(31000); await e.view(11); e.tick(31000); await e.view(11);
  assert.ok(!e.fake.mutations.some((m) => m[1] === '103'), '障害中は待つ');
  e.fake.down = false;
  e.tick(31000); await e.view(11);
  e.tick(31000); await e.view(11);
  assert.deepStrictEqual(e.fake.mutations.find((m) => m[1] === '103'), ['dq', '103', 2], '103 は P2 の勝ち (P4 の DQ)');
  const a = await e.call({ action: 'report_admin', token: e.admin, code: e.code });
  assert.deepStrictEqual(a.dqs.map((x) => [x.name, x.scope, x.status]), [['P4', 'l', 'done'], ['P2', 'w', 'done']]);
  // 運営: 参加者の試合 (対戦開始・DQ の欄)
  const ps = await e.call({ action: 'report_player_sets', token: e.admin, code: e.code, entrant: '1' });
  assert.deepStrictEqual(ps.sets.map((x) => [x.set_id, x.opp_name, x.started]), [['102', 'P3', false]]);
  // 外す
  const d3 = await e.call({ action: 'report_dq', token: e.admin, code: e.code, entrant: '3', scope: 'a' });
  assert.strictEqual(d3.dq.status, 'open');
  assert.ok(e.fake.mutations.some((m) => m[0] === 'dq' && m[1] === '102' && m[2] === 1), '残り全部: 102 も DQ');
  assert.strictEqual((await e.call({ action: 'report_dq_cancel', token: e.admin, code: e.code, id: d3.dq.id })).ok, true);
  assert.strictEqual((await e.call({ action: 'report_dq', token: await e.tok(11), code: e.code, entrant: '3', scope: 'a' })).error.code, 'not_admin');
});

test('start.gg に未反映: 結果・指定した試合・DQ・対戦開始を運営の画面に。対戦開始は start.gg に入るまでやり直し、結果が入れば要らない', async () => {
  const e = await setup();
  await e.view(11);
  e.tick(4000);
  e.fake.down = true;
  await e.submit(11, '100', W2(0));
  const m = await e.call({ action: 'report_manual_create', token: e.admin, code: e.code, group: '700', side: 'w', entrants: ['3', '4'] });
  await e.call({ action: 'report_dq', token: e.admin, code: e.code, entrant: '2', scope: 'l' });
  await e.call({ action: 'report_start', token: await e.tok(13), code: e.code, set_id: '101' });   // 写しで確かめて SPSP にだけ
  let a = await e.call({ action: 'report_admin', token: e.admin, code: e.code });
  assert.deepStrictEqual(a.unsynced.map((x) => [x.kind, x.set_id || x.name, x.state || x.sgg || '']).sort(),
    [['dq', 'P2', ''], ['manual', m.manual.set_id, ''], ['result', '100', 'queued'], ['start', '101', '']].sort());
  // 選手の画面: 対戦開始は記録したが start.gg には未反映
  assert.strictEqual((await e.view(13)).starts.find((x) => x.set_id === '101').sgg, 0);
  // 復旧: 結果を送り、対戦開始を start.gg に入れる (指定した試合は 101 が P3 vs P4 なので移る)
  e.fake.down = false;
  for (let i = 0; i < 4; i++) { e.tick(61000); await e.view(11); }
  assert.ok(e.fake.mutations.some((x) => x[0] === 'start' && x[1] === '101'), '対戦開始をやり直して start.gg に');
  a = await e.call({ action: 'report_admin', token: e.admin, code: e.code });
  assert.deepStrictEqual(a.unsynced.map((x) => x.kind), ['dq'], '残りは敗者側の試合を待っている DQ だけ');
  assert.strictEqual((await e.view(13)).starts.find((x) => x.set_id === '101').sgg, 1);
});
