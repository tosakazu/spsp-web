#!/usr/bin/env node
// start.gg の実プール構造を集めて tests/seeding/fixtures/startgg_pools.json に保存する。
// bracket_core.poolDoubleElim(M, adv, lbStart) が実ブラケットと一致するかの検証用フィクスチャ。
//
//   使い方: 環境変数 TOKEN に start.gg の API トークンを入れて実行する。
//     TOKEN=... node tools/fetch_startgg_pools.cjs [大会数] [--names=篝火,ウメブラ]
//   トークンの保管場所は docs/deploy_and_environments.md を参照 (値は表示しないこと)。
//
// 各プールから読み取るもの (すべて完了済みブラケットの set 一覧から機械的に導く):
//   M   = そのプールのシード数
//   lb  = 敗者側スタート人数 = M - (勝者側ラウンドに一度でも出た人数)
//         (敗者側からは勝者側に上がれないので、勝者側に現れない = 敗者側直入り)
//   adv = 通過人数 = M - (敗者側の試合数 + GF の有無)
//         (脱落するのは敗者側と GF の試合だけ)
//   w/l = 各ラウンドの試合数 (start.gg は bye の set を作らないので実試合のみ)
//   lbFirst = 敗者側初戦の組み合わせ (ローカルシード。敗者側スタートの配置検証用)
'use strict';

const fs = require('fs');
const path = require('path');

const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('環境変数 TOKEN に start.gg の API トークンを入れて実行してください'); process.exit(1); }
const ARGS = process.argv.slice(2);
const WANT_TOURNAMENTS = parseInt(ARGS.find((a) => /^\d+$/.test(a)), 10) || 40;
// --names=篝火,ウメブラ … 名前で大会を指定して取る (メジャー大会の形を必ず入れる用)。
// 指定した大会のプールは「形ごとに最大2件」の間引きから除外して全部残す。
const NAMES = (ARGS.find((a) => a.startsWith('--names=')) || '').replace('--names=', '')
  .split(',').map((x) => x.trim()).filter(Boolean);
const OUT = path.resolve(__dirname, '../tests/seeding/fixtures/startgg_pools.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch('https://api.start.gg/gql/alpha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
    const j = await res.json();
    if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
    return j.data;
  }
  throw new Error('start.gg リトライ上限');
}

const Q_BY_NAME = `
query($name: String!) {
  tournaments(query: {page: 1, perPage: 8, sortBy: "startAt desc",
                      filter: {videogameIds: [1386], past: true, name: $name}}) {
    nodes { name events(filter: {videogameId: 1386}) { id name numEntrants
      phases { id name groupCount } } }
  }
}`;

const Q_TOURNAMENTS = `
query($page: Int!, $perPage: Int!) {
  tournaments(query: {page: $page, perPage: $perPage, sortBy: "startAt desc",
                      filter: {countryCode: "JP", videogameIds: [1386], past: true}}) {
    nodes { name events(filter: {videogameId: 1386}) { id name numEntrants
      phases { id name groupCount } } }
  }
}`;

const Q_GROUPS = `
query($p: ID!, $perPage: Int!) {
  phase(id: $p) {
    name
    phaseGroups(query: {page: 1, perPage: $perPage}) {
      nodes { id displayIdentifier }
    }
  }
}`;

const Q_GROUP = `
query($g: ID!) {
  phaseGroup(id: $g) {
    displayIdentifier
    seeds(query: {page: 1, perPage: 128}) { pageInfo { total } nodes { seedNum entrant { id } } }
    sets(page: 1, perPage: 200, sortType: ROUND) {
      pageInfo { total }
      nodes { round fullRoundText slots { entrant { id } } }
    }
  }
}`;

// 実プールの set 一覧 → 構造。読めない (未完了・非DE 等) 場合は null。
function analyze(g) {
  const seeds = (g.seeds.nodes || []).filter((s) => s.entrant);
  const M = seeds.length;
  if (M < 4 || M > 128) return null;
  if (g.seeds.pageInfo.total !== M) return null;          // ページ切れ
  if (g.sets.pageInfo.total !== g.sets.nodes.length) return null;
  // seedNum 昇順 → ローカルシード 1..M
  const local = new Map();
  seeds.slice().sort((a, b) => a.seedNum - b.seedNum).forEach((s, i) => local.set(s.entrant.id, i + 1));

  const rounds = new Map();       // round(数値) → 試合数
  const wbPlayers = new Set();
  let lbFirstRound = null, lbFirstSets = [];
  let gf = false;
  for (const st of g.sets.nodes) {
    const r = st.round;
    if (r == null) return null;
    rounds.set(r, (rounds.get(r) || 0) + 1);
    const ids = (st.slots || []).map((sl) => sl.entrant && sl.entrant.id).filter(Boolean);
    if (ids.length !== 2) return null;                     // 未完了・不整合
    const isGf = /grand final/i.test(st.fullRoundText || '');
    if (isGf) gf = true;
    // GF は round が正だが敗者側の勝者も出るので、勝者側スタート判定からは除く
    if (r > 0 && !isGf) for (const id of ids) wbPlayers.add(id);
  }
  const wRounds = [...rounds.keys()].filter((r) => r > 0).sort((a, b) => a - b);
  const lRounds = [...rounds.keys()].filter((r) => r < 0).sort((a, b) => b - a);   // -4, -5, ...
  if (!wRounds.length || !lRounds.length) return null;     // シングルエリミ等
  // GF は round が正の最大値として現れることがある。fullRoundText で判定済みなので除く
  const w = [], l = [];
  for (const r of wRounds) w.push(rounds.get(r));
  for (const r of lRounds) l.push(rounds.get(r));
  if (gf) w.pop();                                          // GF 列は別扱い
  // 初戦の組み合わせ (ローカルシード)。シードだけで決まるので構造検証に使える。
  //   勝者側1回戦 = 常に有効 / 敗者側初戦 = 敗者側スタートありのときだけ有効
  //   (通常構成の敗者側1回戦の顔ぶれは勝敗結果しだいなので比較できない)
  const pairsOf = (r) => g.sets.nodes.filter((st) => st.round === r).map((st) =>
    st.slots.map((sl) => local.get(sl.entrant.id)).sort((a, b) => a - b).join('v')).sort();
  const wFirst = pairsOf(wRounds[0]);
  lbFirstRound = lRounds[0];
  lbFirstSets = pairsOf(lbFirstRound);
  if (wFirst.concat(lbFirstSets).some((s) => /undefined/.test(s))) return null;

  const lbStart = M - wbPlayers.size;
  const elims = l.reduce((a, b) => a + b, 0) + (gf ? 1 : 0);
  const adv = M - elims;
  if (adv < 1 || adv >= M) return null;
  if (lbStart < 0 || lbStart > M - 2) return null;
  return { M, adv, lbStart, w, l, gf, wFirst, lbFirst: lbFirstSets };
}

const seen = new Set();
const out = [];

async function collectTournament(t, opts) {
  for (const ev of t.events || []) {
    for (const ph of (ev.phases || []).filter((p) => p.groupCount >= 1)) {
      let groups;
      try { groups = await gql(Q_GROUPS, { p: ph.id, perPage: opts.groupsPerPhase }); } catch (e) { continue; }
      await sleep(120);
      for (const g0 of (groups.phase && groups.phase.phaseGroups.nodes) || []) {
        if (seen.has(g0.id)) continue;
        seen.add(g0.id);
        let gd;
        try { gd = await gql(Q_GROUP, { g: g0.id }); } catch (e) { continue; }
        await sleep(120);
        const a = gd.phaseGroup && analyze(gd.phaseGroup);
        if (!a) continue;
        out.push(Object.assign({
          src: `${t.name} / ${ev.name} / ${ph.name} / ${g0.displayIdentifier}`,
          groupId: g0.id,
          major: !!opts.major,
        }, a));
        process.stderr.write(`\r${out.length} pools`);
      }
    }
  }
}

(async () => {
  // 既存フィクスチャは残す (テストが groupId で固定している行を消さないため)
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).pools || [] : [];
  for (const r of prev) seen.add(r.groupId);
  // 名前指定 (メジャー大会) を先に取る
  for (const name of NAMES) {
    const data = await gql(Q_BY_NAME, { name });
    for (const t of data.tournaments.nodes || []) {
      await collectTournament(t, { groupsPerPhase: 3, major: true });
    }
  }
  let page = 1;
  while (out.length < 400 && page <= Math.ceil(WANT_TOURNAMENTS / 20)) {
    const data = await gql(Q_TOURNAMENTS, { page, perPage: 20 });
    const tours = data.tournaments.nodes || [];
    if (!tours.length) break;
    for (const t of tours) await collectTournament(t, { groupsPerPhase: 2 });
    page++;
  }
  process.stderr.write('\n');
  // 同じ形 (M, adv, lbStart) は 2 件までに間引く。名前指定で取った大会は全部残す。
  const byShape = new Map();
  const kept = prev.slice();
  for (const r of prev) if (!r.major) {
    const k = `${r.M}:${r.adv}:${r.lbStart}`;
    byShape.set(k, (byShape.get(k) || 0) + 1);
  }
  for (const r of out) {
    if (!r.major) {
      const k = `${r.M}:${r.adv}:${r.lbStart}`;
      const n = byShape.get(k) || 0;
      if (n >= 2) continue;
      byShape.set(k, n + 1);
    }
    kept.push(r);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    note: 'start.gg の完了済みプールから機械的に導いた構造。tools/fetch_startgg_pools.cjs で再生成',
    fetchedCount: out.length,
    pools: kept,
  }, null, 1));
  console.log(`${kept.length} 件 (延べ ${out.length} 件。major=${kept.filter((r) => r.major).length}) → ${OUT}`);
})();
