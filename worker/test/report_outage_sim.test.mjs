// 試合結果の報告: start.gg の障害を挟んで大会を最後まで流す (2026-11-04、docs/self_report_design.md §11)。
// 偽の start.gg (8 人のダブルイリミ。報告で次の試合の枠が埋まる) と、本物と同じ SQL (D1Store を node:sqlite の上で) で、
// 乱数で「選手の報告 (片方だけ・両方・食い違いからの出し直し)・障害の始まりと終わり・運営の次の試合の指定」を混ぜる。確かめること:
//   - 最後に start.gg の全試合に正しい勝者が入る (報告が消えない・二重にならない・取り違えない)
//   - 運営の候補: 勝者側に負けた人を出さない・敗者側に敗者側で負けた人を出さない (start.gg に未反映でも)・指定する 2 人は候補にいる
//   - 運営の確認待ち (review) が残らない
// start.gg は偽物 (本物には書き込まない・読みにも行かない)。
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { dispatch } from '../src/api/router.ts';
import { D1Store } from '../src/db.ts';
import { SESSION_TTL_MS_DEFAULT, STATE_TTL_MS_DEFAULT } from '../src/config.ts';
import { issueSessionToken } from '../src/api/session.ts';
import { candidateFor, decodeSnapshot } from '../src/api/report_outage.ts';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch (_) { /* skip */ }

function d1Like(db) {
  return {
    prepare(sql) {
      const stmt = { sql, params: [] };
      stmt.bind = (...p) => { stmt.params = p; return stmt; };
      stmt.first = async () => { const r = db.prepare(sql).get(...stmt.params); return r ? { ...r } : null; };
      stmt.all = async () => ({ results: db.prepare(sql).all(...stmt.params).map((r) => ({ ...r })) });
      stmt.run = async () => { const r = db.prepare(sql).run(...stmt.params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; };
      return stmt;
    },
    async batch(stmts) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}
function sqliteStore() {
  const db = new DatabaseSync(':memory:');
  for (const m of fs.readdirSync(new URL('../migrations/', import.meta.url)).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort()) {
    db.exec(fs.readFileSync(new URL('../migrations/' + m, import.meta.url), 'utf8'));
  }
  return new D1Store(d1Like(db));
}

/** 乱数 (seed つき) */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * 8 人のダブルイリミの構造: [id, round, 枠0 の前 (seed 番号 か [前の試合, 1=勝者 2=敗者]), 枠1 の前]
 * 勝者側 1〜3 回戦・グランドファイナル (4)、敗者側 -1〜-4
 */
const DE8 = [
  [1, 1, 1, 8], [2, 1, 4, 5], [3, 1, 2, 7], [4, 1, 3, 6],
  [5, 2, [1, 1], [2, 1]], [6, 2, [3, 1], [4, 1]],
  [7, 3, [5, 1], [6, 1]],
  [8, -1, [1, 2], [2, 2]], [9, -1, [3, 2], [4, 2]],
  [10, -2, [8, 1], [6, 2]], [11, -2, [9, 1], [5, 2]],
  [12, -3, [10, 1], [11, 1]],
  [13, -4, [12, 1], [7, 2]],
  [14, 4, [7, 1], [13, 1]],
];

/** 偽の start.gg: 試合 1000+n、entrant = 選手番号、user = 10+選手番号 */
/** flaky = 繋がっているときに 503 を返す割合、lost = 書き込みは通ったのに応答が 503 になる割合 */
/** struct = シード・ブロックの形式も返す (bracket_engine で次の試合を計算できる。2026-11-05) */
/** swap = 次の試合の 2 人を枠の前の試合の順と逆に入れる割合 (start.gg の実例、2026-11-05) */
function fakeStartgg(rand = Math.random, flaky = 0, lost = 0, STRUCT = DE8, struct = false, swap = 0) {
  const ent = (i) => ({ id: i, name: 'P' + i, initialSeedNum: i, participants: [{ user: { id: 10 + i } }] });
  const pg = { id: 700, displayIdentifier: '1', phase: { id: 77, name: 'Main', groupCount: 1 }, ...(struct ? { bracketType: STRUCT === DE8 ? 'DOUBLE_ELIMINATION' : 'ROUND_ROBIN' } : {}) };
  const players = Array.from(new Set(STRUCT.flatMap(([, , a, b]) => [a, b]).filter((x) => !Array.isArray(x)))).sort((x, y) => x - y);
  const st = { down: false, mutations: [], tick: 1, sets: [] };
  for (const [n, round, a, b] of STRUCT) {
    const slot = (x) => (Array.isArray(x) ? { entrant: null, prereqType: 'set', prereqId: 1000 + x[0], prereqPlacement: x[1] } : { entrant: ent(x), prereqType: 'seed', prereqId: struct ? 500 + x : null, prereqPlacement: null });
    st.sets.push({ id: 1000 + n, state: 1, round, fullRoundText: 'R' + round, winnerId: null, totalGames: 5, lPlacement: round > 0 ? 5 : 3, updatedAt: 1,
      event: { id: 9, name: 'Singles' }, phaseGroup: pg, games: null, station: null, slots: [slot(a), slot(b)] });
  }
  const byId = (id) => st.sets.find((s) => String(s.id) === String(id));
  const touch = (s) => { s.updatedAt = ++st.tick; };
  // 次の試合の枠を前の試合から作り直す。swap の試合は 2 人を逆の順に入れる (枠の前の試合の指定はそのまま)
  const outOf = (x) => {
    if (x.prereqType !== 'set') return x.entrant;
    const pv = byId(x.prereqId);
    if (!pv || pv.state !== 3) return null;
    const w = pv.slots.find((y) => y.entrant && y.entrant.id === pv.winnerId);
    const l = pv.slots.find((y) => y.entrant && y.entrant.id !== pv.winnerId);
    return x.prereqPlacement === 1 ? (w ? w.entrant : null) : (l ? l.entrant : null);
  };
  const fill = (s) => {
    for (const n of st.sets) {
      if (!n.slots.some((x) => x.prereqType === 'set' && String(x.prereqId) === String(s.id))) continue;
      if (n.swap === undefined && swap) n.swap = rand() < swap;
      const logical = n.slots.map((x) => (x.prereqType === 'set' ? outOf(x) : x.seedEntrant || x.entrant));
      const both = logical[0] && logical[1];
      n.slots[0].entrant = n.swap && both ? logical[1] : logical[0];
      n.slots[1].entrant = n.swap && both ? logical[0] : logical[1];
      touch(n);
    }
  };
  st.fetch = async (url, init) => {
    if (st.down) throw new TypeError('fetch failed');
    if (flaky && rand() < flaky) return new Response('{"message":"Service Unavailable"}', { status: 503 });
    if (url.includes('/oauth/')) return new Response(JSON.stringify({ access_token: 'AT-1', expires_in: 3600 * 24, refresh_token: 'RT-1' }), { status: 200 });
    const { query, variables } = JSON.parse(init.body);
    const name = (/(?:query|mutation)\s+(\w+)/.exec(query) || [])[1] || (query.includes('currentUser') ? 'me' : '?');
    const j = (data) => new Response(JSON.stringify({ data }), { status: 200 });
    if (name === 'me' || /^query \{ currentUser/.test(query)) return j({ currentUser: { id: 4242, slug: 'user/x', player: { gamerTag: 'TO' } } });
    if (name === 'SpspReportEvent') return j({ event: { id: 9, name: 'Singles', slug: 'tournament/t/event/singles', tournament: { id: 5, name: 'Test Cup', endAt: Math.floor(Date.now() / 1000) + 3600 } } });
    if (name === 'SpspClassAdmin') return j({ currentUser: { id: 4242 }, event: { id: 9, tournament: { id: 5, owner: { id: 1 }, admins: [{ id: 4242 }] } } });
    if (name === 'SpspReportSnap') {
      const after = variables.after;
      const nodes = st.sets.filter((s) => after === undefined || after === null || s.updatedAt > after);
      const per = variables.perPage; const page = variables.page;
      return j({ event: { sets: { pageInfo: { totalPages: Math.max(1, Math.ceil(nodes.length / per)) }, nodes: nodes.slice((page - 1) * per, page * per) } } });
    }
    if (name === 'SpspReportSet') return j({ set: byId(variables.id) || null });
    if (name === 'SpspReportSeeds' && struct) return j({ phase: { seeds: { pageInfo: { totalPages: 1 }, nodes: players.map((i) => ({ id: 500 + i, seedNum: i, groupSeedNum: i, phaseGroup: { id: 700 }, entrant: { id: i }, progressionSource: null })) } } });
    if (name === 'SpspReportDq') {
      const s = byId(variables.setId);
      if (s.state === 3 || !s.slots[0].entrant || !s.slots[1].entrant) return new Response(JSON.stringify({ errors: [{ message: 'Set is not ready' }], data: null }), { status: 200 });
      s.state = 3; s.winnerId = Number(variables.winnerId); s.games = null; touch(s); fill(s);
      st.mutations.push(['dq', s.id, s.winnerId]);
      if (lost && rand() < lost) return new Response('', { status: 503 });
      return j({ x: { id: s.id, state: 3 } });
    }
    if (name === 'SpspStartSet') { const s = byId(variables.setId); if (s.state === 1) { s.state = 2; touch(s); } return j({ x: { id: s.id, state: s.state } }); }
    if (name === 'SpspReportNext' || name === 'SpspReportFind' || name === 'SpspReportSetsOf') {
      const ids = variables.entrantIds.map(String);
      return j({ event: { sets: { pageInfo: { totalPages: 1 }, nodes: st.sets.filter((s) => s.slots.some((x) => x.entrant && ids.includes(String(x.entrant.id)))) } } });
    }
    if (name === 'SpspReportBracketSet' || name === 'SpspUpdateSet') {
      const s = byId(variables.setId);
      if (!s.slots[0].entrant || !s.slots[1].entrant) return new Response(JSON.stringify({ errors: [{ message: 'Set is not ready' }], data: null }), { status: 200 });
      if (name === 'SpspReportBracketSet' && s.state === 3) return new Response(JSON.stringify({ errors: [{ message: 'Set is already complete' }], data: null }), { status: 200 });
      s.state = 3; s.winnerId = Number(variables.winnerId);
      s.games = variables.gameData.map((g) => ({ orderNum: g.gameNum, winnerId: Number(g.winnerId) }));
      touch(s); fill(s);
      st.mutations.push([name, s.id, s.winnerId]);
      if (lost && rand() < lost) return new Response('', { status: 503 });   // 書けたが応答が届かない
      return j({ x: { id: s.id, state: 3 } });
    }
    if (name === 'SpspResetSet') {
      const s = byId(variables.setId);
      s.state = 1; s.winnerId = null; s.games = null; touch(s); fill(s);
      st.mutations.push(['reset', s.id]);
      return j({ resetSet: { id: s.id } });
    }
    return j({});
  };
  return st;
}

/** 本当の勝ち負け (選手番号の小さい方が 70% で勝つ) を先に決め、同じ構造で本当のブラケットを進める */
function truthBracket(rand, STRUCT = DE8) {
  const t = new Map();   // n → { a, b, w }
  const who = (x) => (Array.isArray(x) ? (t.get(x[0]) && t.get(x[0]).w ? (x[1] === 1 ? t.get(x[0]).w : t.get(x[0]).l) : null) : x);
  const ready = () => STRUCT.filter(([n, , a, b]) => !t.get(n) || !t.get(n).w).map(([n, round, a, b]) => ({ n, round, a: who(a), b: who(b) })).filter((x) => x.a && x.b);
  const play = (x) => { const lowWins = rand() < 0.7; const w = (x.a < x.b) === lowWins ? x.a : x.b; t.set(x.n, { a: x.a, b: x.b, w, l: w === x.a ? x.b : x.a, round: x.round }); return t.get(x.n); };
  return { t, ready, play };
}

const R2 = (w) => ({ w, g: [{ w, c: [null, null], s: null }, { w, c: [null, null], s: null }] });

async function runOne(seed, flaky = 0, lost = 0, STRUCT = DE8, struct = false, swap = 0) {
  const rand = rng(seed);
  const fake = fakeStartgg(rng(seed * 7919), flaky, lost, STRUCT, struct, swap);
  const store = DatabaseSync ? sqliteStore() : null;
  const cfg = { clientId: 'cid', redirectUri: 'https://x/callback.html', clientSecret: 'CS', sessionSecret: 'sess-' + seed,
    sessionTtlMs: SESSION_TTL_MS_DEFAULT, stateTtlMs: STATE_TTL_MS_DEFAULT, tsOffsetMin: 540 };
  let now = Date.now();
  const ctx = { cfg, store, fetch: fake.fetch, dataFetch: async () => { throw new Error('no'); }, now: () => now };
  const call = (b) => dispatch(ctx, b);
  const tok = (uid) => issueSessionToken(cfg, { id: String(uid), slug: '', gamerTag: '' }, now);
  const tick = (ms) => { now += ms; };
  // 受付を始めるまでは運営がやり直せばよい (503 に当たったらやり直す)
  let l = null; let en = null;
  for (let i = 0; i < 20 && !(en && en.ok); i++) {
    if (!(l && l.ok)) { tick(1000); const b = await call({ action: 'report_begin', nonce: 'N' + i, returnPath: '/jp/report/' }); l = await call({ action: 'report_login', code: 'C', state: new URL(b.url).searchParams.get('state') }); }
    if (l.ok) en = await call({ action: 'report_enable', token: l.token, event: '9' });
  }
  assert.ok(en && en.ok, "enable " + JSON.stringify([l, en]));
  const code = en.report.code;
  const admin = l.token;
  const view = async (p) => { tick(1000); return call({ action: 'report_view', token: await tok(10 + p), code }); };
  // 写しの 1 周目
  // 写しの 1 周目 (障害の前にできている前提。503 に当たっても続きを読む)
  for (let i = 0; i < 30; i++) { await view(1); tick(6000); const m = await store.getReportSnapshotMeta(code); if (m && m.full) break; }
  assert.ok((await store.getReportSnapshotMeta(code)).full, '写しができた');
  // 構造があるとき: 照合 (計算と start.gg の突き合わせ) まで済んでから障害が起きる前提 (受付を始めてから試合が始まるまでに済む)
  if (struct) {
    for (let i = 0; i < 30; i++) { const d = await decodeSnapshot((await store.getReportSnapshot(code)).data); if (d.chk) break; tick(46000); await view(1); }
    assert.ok((await decodeSnapshot((await store.getReportSnapshot(code)).data)).chk, '照合が済んだ');
  }

  const truth = truthBracket(rand, STRUCT);
  const lossesW = new Set(); const lossesL = new Set();   // 本当に負けた人 (勝者側 / 敗者側)
  const log = [];
  let checks = 0;
  /** 選手の報告 (rand で片方だけ・両方・食い違いからの出し直し)。set_id は start.gg の試合か指定した試合 */
  const report = async (setId, sides, res) => {
    // sides = [選手番号 (側 0), 選手番号 (側 1)]、res.w = 本当の勝者の側
    const r = rand();
    const send = async (p, result) => { tick(4000); const x = await call({ action: 'report_submit', token: await tok(10 + p), code, set_id: setId, result, ents: sides.map(String) /* 画面が見ている 2 人の並び */ }); log.push([setId, p, result.w, x.ok ? x.state : x.error.code]); return x; };
    if (r < 0.15) {   // 負けた側が間違えて送る → 勝った側が正しく送る → 負けた側が出し直す
      const loser = sides[1 - res.w];
      await send(loser, R2(1 - res.w));
      await send(sides[res.w], res);
      return send(loser, res);
    }
    if (r < 0.55) { await send(sides[0], res); return send(sides[1], res); }
    return send(sides[rand() < 0.5 ? 0 : 1], res);
  };
  let steps = 0; let dqs = 0;
  // 総当たりでは「次の試合」の DQ が決まらないので、この試合だけの DQ (s) のときだけ
  const dqOk = STRUCT === DE8;
  while (truth.ready().length && steps++ < 100) {
    // 繋がっているあいだは、送る待ち・食い違いが片付くまで待ってから次へ (取り違えた結果が start.gg に残ったまま次の試合に進むと、
    // 設計どおり運営の確認待ちになる。それはここでは流さない)
    for (let i = 0; i < 20 && !fake.down; i++) {
      const rows = await store.listReportSets(code);
      const dqWait = (await store.listReportDqs(code)).some((d) => d.status === 'open');
      if (!rows.some((r) => r.state === 'queued' || r.state === 'conflict') && !dqWait) break;
      tick(31000); await view(1 + (i % 8));
    }
    // 障害の始まり・終わり (1 試合ごとに 25% で切り替え)
    if (rand() < 0.25) { fake.down = !fake.down; log.push(['down', fake.down]); }
    // 読み直し (選手の画面) と時間
    await view(1 + Math.floor(rand() * 8));
    tick(Math.floor(rand() * 40000));
    const ready = truth.ready();
    const x = ready[Math.floor(rand() * ready.length)];
    const res = truth.play(x);
    const real = fake.sets.find((s) => s.id === 1000 + x.n);
    const realSides = real.slots.map((s) => (s.entrant ? s.entrant.id : null));
    let setId = String(real.id); let sides = [x.a, x.b];
    // start.gg の今の枠で側を決める (枠が埋まっていれば。埋まっていなければ運営が指定する)
    let needManual = !(realSides[0] && realSides[1]);
    if (!needManual) sides = realSides;
    // 構造があるとき: start.gg の枠が空でも、SPSP が計算で埋めた枠 (枠の順 = 前の試合の順) で start.gg の試合に報告する
    else if (struct) { needManual = false; sides = [x.a, x.b]; }
    let r = null;
    // 会えない・対戦開始 (結果には関係しない。障害中で写しに枠が無いと断られることがある)
    if (rand() < 0.3) {
      const who = sides[rand() < 0.5 ? 0 : 1];   // start.gg の今の枠の 2 人
      const sid = needManual ? null : setId;
      if (sid) {
        tick(1000); const ns = await call({ action: 'report_noshow', token: await tok(10 + who), code, set_id: sid });
        assert.ok(ns.ok || ['not_ready', 'provider_error', 'not_player', 'bad_request'].includes(ns.error.code), JSON.stringify(ns));   // 障害中は写し (少し古い) で確かめる
        tick(1000); const stt = await call({ action: 'report_start', token: await tok(10 + (who === sides[0] ? sides[1] : sides[0])), code, set_id: sid });
        assert.ok(stt.ok || ['not_ready', 'provider_error', 'not_player', 'bad_request'].includes(stt.error.code), JSON.stringify(stt));
      }
    }
    // 運営が負けた側を DQ にする (10%): start.gg の試合が分かっていればこの試合だけ、まだなら負けた側の次の試合
    // (同じ人に同じ範囲の DQ がまだ入っていなければ。同じ DQ は 1 つにまとまる = 画面の二度押し対策)
    const pendingDq = (await store.listReportDqs(code)).some((d) => d.status === 'open' && d.entrant_id === String(res.l));
    if (rand() < 0.1 && dqOk && !pendingDq) {
      const scope = needManual ? (x.round > 0 ? 'w' : 'l') : 's';
      const dq = await call({ action: 'report_dq', token: admin, code, entrant: String(res.l), scope, ...(scope === 's' ? { set_id: setId } : {}) });
      assert.strictEqual(dq.ok, true, 'seed ' + seed + ' ' + JSON.stringify(dq));
      log.push(['dq', res.l, scope, setId]);
      dqs++;
      (x.round > 0 && x.round < 4 ? lossesW : lossesL).add(res.l);
      continue;
    }
    if (!needManual) {
      r = await report(setId, sides, R2(sides[0] === res.w ? 0 : 1));
      if (!r.ok && r.error.code === 'not_ready') needManual = true;   // 障害中で、写しにはまだ枠が無かった
      else assert.strictEqual(r.ok, true, 'seed ' + seed + ' ' + JSON.stringify([r, log.slice(-6)]));
    }
    if (needManual) {
      // 運営が指定: 候補のきまりを確かめてから
      const side = x.round === 4 ? 'g' : x.round > 0 ? 'w' : 'l';   // 4 = グランドファイナル
      const br = await call({ action: 'report_bracket', token: admin, code });
      assert.strictEqual(br.ok, true, JSON.stringify(br));
      const g = br.groups.find((y) => y.id === '700');
      const cands = new Set(g.entrants.filter((e) => candidateFor(e, side)).map((e) => Number(e.id)));
      for (const p of [x.a, x.b]) assert.ok(cands.has(p), `seed ${seed}: P${p} が ${side} の候補にいない ${JSON.stringify(g.entrants.find((e) => Number(e.id) === p))} x=${JSON.stringify(x)} log=${JSON.stringify(log.slice(-10))}`);
      for (const p of side === 'w' ? [...lossesW, ...lossesL] : [...lossesL]) assert.ok(!cands.has(p), `seed ${seed}: 負けた P${p} が ${side} の候補にいる`);
      checks++;
      const m = await call({ action: 'report_manual_create', token: admin, code, group: '700', side, entrants: [String(x.a), String(x.b)] });
      assert.strictEqual(m.ok, true, 'seed ' + seed + ' ' + JSON.stringify(m));
      setId = m.manual.set_id; sides = [x.a, x.b];
      r = await report(setId, sides, R2(sides[0] === res.w ? 0 : 1));
      assert.strictEqual(r.ok, true, 'seed ' + seed + ' ' + JSON.stringify([r, log.slice(-6)]));
    }
    (x.round > 0 && x.round < 4 ? lossesW : lossesL).add(res.l);
  }
  // 復旧して、取り込み待ちが無くなるまで読み直す
  fake.down = false;
  for (let i = 0; i < 40; i++) {
    tick(61000);
    await view(1 + (i % 8));
    const adm = await call({ action: 'report_admin', token: admin, code });
    if (adm.ok && !adm.unsynced.length) break;
  }
  // 確かめる: SPSP にあって start.gg に無いものが残っていない (結果・指定した試合・DQ・対戦開始)
  const fin = await call({ action: 'report_admin', token: admin, code });
  assert.deepStrictEqual(fin.unsynced, [], 'seed ' + seed + ' start.gg に未反映が残った ' + JSON.stringify(fin.unsynced) + ' fake=' + JSON.stringify(fake.sets.filter((x) => fin.unsynced.some((u) => u.set_id === String(x.id))).map((x) => [x.id, x.state])));
  for (const [n] of STRUCT) {
    const s = fake.sets.find((y) => y.id === 1000 + n);
    const tr = truth.t.get(n);
    assert.ok(tr, 'seed ' + seed + ' 試合 ' + n + ' が流れていない');
    assert.strictEqual(s.state, 3, `seed ${seed}: 試合 ${n} に結果が無い truth=${JSON.stringify([...truth.t])} log=${JSON.stringify(log)} dqs=${JSON.stringify((await store.listReportDqs(code)).map((d) => [d.name, d.scope, d.set_id, d.status, d.done_sets]))} manual=${JSON.stringify((await store.listReportManual(code)).map((m) => [m.id, m.side, m.status, m.set_id, m.slots]))} fake=${JSON.stringify(fake.sets.map((x) => [x.id, x.state, x.winnerId, x.slots.map((y) => y.entrant && y.entrant.id)]))}`);
    assert.strictEqual(s.winnerId, tr.w, `seed ${seed}: 試合 ${n} の勝者が違う truth=${JSON.stringify(tr)} muts=${JSON.stringify(fake.mutations.filter((m) => m[1] === 1000 + n))} row=${JSON.stringify(await store.getReportSet(code, String(1000 + n)))} subs=${JSON.stringify((await store.listReportSubmissions(code, String(1000 + n))).map((x) => [x.id, x.side, JSON.parse(x.result || 'null') && JSON.parse(x.result).w, x.outcome]))} log=${JSON.stringify(log)} dqs=${JSON.stringify((await store.listReportDqs(code)).map((d) => [d.name, d.scope, d.set_id, d.status, d.done_sets, d.note]))} truthall=${JSON.stringify([...truth.t])} manual=${JSON.stringify(await store.listReportManual(code))}`);
  }
  const rows = await store.listReportSets(code);
  const bad = rows.filter((r) => r.state === 'review' || r.state === 'queued' || r.state === 'conflict');
  assert.deepStrictEqual(bad.map((r) => [r.set_id, r.state, r.note]), [], 'seed ' + seed + ' 残った行');
  assert.ok(!(await store.listReportManual(code)).some((m) => m.status === 'open'), 'seed ' + seed + ' 指定した試合が残った');
  // 同じ試合に 2 回 report を送っていない (start.gg が「もう結果がある」と断る送り方をしていない)
  assert.ok(!(await store.listReportDqs(code)).some((d) => d.status === 'open' && d.scope !== 'a'), 'seed ' + seed + ' DQ が残った ' + JSON.stringify((await store.listReportDqs(code)).map((d) => [d.name, d.scope, d.set_id, d.status, d.done_sets, d.note])) + ' log=' + JSON.stringify(log) + ' truth=' + JSON.stringify([...truth.t]) + ' fake=' + JSON.stringify(fake.sets.map((x) => [x.id, x.state, x.winnerId, x.slots.map((y) => y.entrant && y.entrant.id)])));
  return { checks, dqs, mutations: fake.mutations.length, manual: (await store.listReportManual(code)).length };
}

test('障害を挟んで 8 人のダブルイリミを最後まで流す (乱数 40 通り): start.gg の結果が全部正しい・候補のきまり・確認待ちが残らない',
  { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
    let checks = 0; let manual = 0; let dqs = 0;
    const n = Number(process.env.SPSP_SIM_SEEDS) || 40;   // 多めに回すときは SPSP_SIM_SEEDS=300
    for (let seed = Number(process.env.SPSP_SIM_FROM) || 1; seed <= n; seed++) {
      const r = await runOne(seed);
      checks += r.checks; manual += r.manual; dqs += r.dqs;
    }
    assert.ok(dqs > 10, 'DQ を十分に通った (' + dqs + ')');
    assert.ok(manual > 20, '運営の指定を十分に通った (' + manual + ')');
    assert.ok(checks > 20);
  });

test('同じ流れで、繋がっているときも 10% で 503・書き込みの 20% は応答が失われる (書けているのに失敗に見える)',
  { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
    const n = Number(process.env.SPSP_SIM_SEEDS) || 40;
    for (let seed = Number(process.env.SPSP_SIM_FROM) || 1; seed <= n; seed++) await runOne(1000 + seed, 0.1, 0.2);
  });

/** 5 人の総当たり (10 試合、全部最初から開いている) */
const RR5 = [];
for (let a = 1, n = 1; a <= 5; a++) for (let b = a + 1; b <= 5; b++) RR5.push([n++, 1, a, b]);

test('総当たり 5 人を障害・503・応答の消失を挟んで流す: 運営の指定なしで全部の結果が正しく入る', { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
  const n = Number(process.env.SPSP_SIM_SEEDS) || 40;
  for (let seed = 1; seed <= n; seed++) {
    const r = await runOne(5000 + seed, seed % 2 ? 0.1 : 0, seed % 2 ? 0.2 : 0, RR5);
    assert.strictEqual(r.manual, 0, '総当たりは全部の試合が写しにあるので指定は要らない');
  }
});

test('構造 (シード・不戦勝・順位) があれば、障害中も運営の指定なしで次の試合が計算で出て、最後まで正しく入る (2026-11-05)',
  { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
    const n = Number(process.env.SPSP_SIM_SEEDS) || 40;
    let manual = 0; let dqs = 0;
    for (let seed = Number(process.env.SPSP_SIM_FROM) || 1; seed <= n; seed++) {
      const r = await runOne(7000 + seed, seed % 2 ? 0.1 : 0, seed % 2 ? 0.2 : 0, DE8, true);
      manual += r.manual; dqs += r.dqs;
    }
    assert.strictEqual(manual, 0, '運営の指定は要らない');
    assert.ok(dqs > 10, 'DQ も通った (' + dqs + ')');
  });

test('構造あり + start.gg が 2 人を逆の順に入れることがある (30%): 照合は通り、復旧後は側を入れ替えて正しい勝者を送る',
  { skip: !DatabaseSync && 'node:sqlite が無い' }, async () => {
    const n = Number(process.env.SPSP_SIM_SEEDS) || 40;
    let manual = 0;
    for (let seed = Number(process.env.SPSP_SIM_FROM) || 1; seed <= n; seed++) manual += (await runOne(8000 + seed, seed % 2 ? 0.1 : 0, seed % 2 ? 0.2 : 0, DE8, true, 0.3)).manual;
    assert.strictEqual(manual, 0, '運営の指定は要らない');
  });
