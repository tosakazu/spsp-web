// トーナメントシミュレーション (src/api/bracket_struct.ts) のテスト (2026-11-05)。
// fixtures/startgg_brackets.json の pools (4 プール → TOP24) を start.gg の応答の形で返す偽の gql で読み、シード通りに勝ち上がらせる。
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { fetchSimData, simulate } from '../src/api/bracket_struct.ts';

const FX = JSON.parse(fs.readFileSync(new URL('./fixtures/startgg_brackets.json', import.meta.url), 'utf8'));

function fakeGql(groups) {
  const top = groups.find((g) => g.seeds.some((s) => s.progressionSource));
  const phases = { P1: groups.filter((g) => g !== top), P2: [top] };
  const calls = [];
  const page = (nodes, v) => ({ pageInfo: { totalPages: Math.max(1, Math.ceil(nodes.length / v.perPage)) }, nodes: nodes.slice((v.page - 1) * v.perPage, v.page * v.perPage) });
  const gql = async (q, v) => {
    const name = /query (\w+)/.exec(q)[1];
    calls.push([name, v.id]);
    if (name === 'SpspSimPhase') return { data: { phase: { id: v.id, name: v.id === 'P1' ? 'Pools' : 'TOP24', phaseOrder: v.id === 'P1' ? 1 : 2, bracketType: 'DOUBLE_ELIMINATION', numSeeds: 0,
      phaseGroups: { nodes: phases[v.id].map((g, i) => ({ id: g.gid, displayIdentifier: String(i + 1), bracketType: g.bracketType })) } } } };
    if (name === 'SpspSimSeeds') return { data: { phase: { seeds: page(phases[v.id].flatMap((g) => g.seeds.map((s) => ({ ...s, phaseGroup: { id: g.gid } }))), v) } } };
    if (name === 'SpspSimSets') { const g = groups.find((x) => x.gid === v.id); return { data: { phaseGroup: { sets: page(g.sets.map((s) => ({ ...s, fullRoundText: 'R' + s.round })), v) } } }; }
    throw new Error(name);
  };
  return { gql, calls };
}

test('フェーズの構造を読む: 人数が同じプールの試合は 1 つだけ読む・シードはページをまたいで読む', async () => {
  const f = fakeGql(FX.pools);
  const data = await fetchSimData(f.gql, ['P1', 'P2'], 1);
  const pools = FX.pools.filter((g) => !g.seeds.some((s) => s.progressionSource));
  const sizes = new Set(pools.map((g) => g.seeds.length));
  assert.strictEqual(new Set(f.calls.filter((c) => c[0] === 'SpspSimSets').map((c) => c[1])).size, sizes.size + 1, '人数ごとに 1 つ + 本戦');
  assert.strictEqual(data.phases[0].seeds.length, pools.reduce((n, g) => n + g.seeds.length, 0));
  assert.strictEqual(data.phases[0].groups.length, pools.length);
});

test('シード通りに勝ち上がらせる: 全部の試合が埋まり、各プールの 1 番手が勝者側を勝ち上がる・本戦の決勝は 1 シード', async () => {
  const data = await fetchSimData(fakeGql(FX.pools).gql, ['P1', 'P2'], 1);
  const r = simulate(data);
  assert.deepStrictEqual(r.warnings, ['est'], '通過の並びは推定');
  for (const g of r.groups) {
    const sets = g.views.sets.filter((s) => !s.sl.some((x) => x.pt === 'bye'));
    assert.ok(sets.length > 10);
    assert.ok(sets.every((s) => s.sl.every((x) => x.e)), g.name + ' の試合が全部埋まる');
    assert.ok(sets.every((s) => s.w === (Number(s.sl[0].e.slice(1)) < Number(s.sl[1].e.slice(1)) ? s.sl[0].e : s.sl[1].e)), 'シード番号の小さい方が勝つ');
  }
  const top = r.groups[r.groups.length - 1];
  const gf = top.views.sets.filter((s) => s.r > 0).sort((a, b) => b.r - a.r)[0];
  assert.ok(gf.sl.some((x) => x.e === 'n1'), '1 シードが本戦の最後まで');
});

test('次のフェーズの席がまだ無いときは知らせる', async () => {
  const data = await fetchSimData(fakeGql(FX.pools).gql, ['P1', 'P2'], 1);
  data.phases[1].seeds = [];
  assert.ok(simulate(data).warnings.includes('no_seeds'));
});
