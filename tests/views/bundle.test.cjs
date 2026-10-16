'use strict';
// js/views.js bundledPlayer / js/player_data.js load: まとめ (data/views/bundle/) に入っているかは players_index.json (読み込み済みなら)
// か current/<uid % N>.json の bundled で決め、まとめていない選手の分は bundle/ を取りに行かない。データ = tests/views/fixtures/build
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const FIX = path.join(__dirname, 'fixtures/build');
const hits = [];
globalThis.fetch = async (url) => {
  const rel = String(url).replace(/^fix:\/\//, '');
  hits.push(rel);
  const p = path.join(FIX, rel);
  if (!fs.existsSync(p)) return new Response('', { status: 404 });
  return new Response(fs.readFileSync(p), { status: 200 });
};
const V = ((m) => m.default || m)(require('../../site/js/views.js'));
const PD = ((m) => m.default || m)(require('../../site/js/player_data.js'));
const bdir = path.join(FIX, 'data/views/bundle');
const bundled = new Set(fs.readdirSync(bdir).flatMap((f) => Object.keys(JSON.parse(fs.readFileSync(path.join(bdir, f), 'utf8')).players)).map(Number));
const B = JSON.parse(fs.readFileSync(path.join(FIX, 'data/views/manifest.json'), 'utf8')).bundle_shards;
const bundleHits = () => hits.filter((h) => /^data\/views\/bundle\//.test(h));

test('current/ の bundled で決める (players_index 未読み込み): まとめていない選手は bundle/ を読まない', async () => {
  assert.ok(B > 0 && bundled.has(1983750) && !bundled.has(1787719));
  const v = V.at('fix://');
  hits.length = 0;
  assert.strictEqual(await v.bundledPlayer(1787719), null);
  assert.deepStrictEqual(bundleHits(), []);
  assert.ok(hits.includes('data/views/current/' + (1787719 % 8) + '.json'));
  const rec = await PD.load('fix://', 1787719);
  assert.strictEqual(rec.user_id, 1787719);
  assert.deepStrictEqual(bundleHits(), [], 'load() も bundle/ を読まない');
  assert.ok(hits.includes('players/1787719.json'));
  hits.length = 0;
  const b = await v.bundledPlayer(1983750);
  assert.strictEqual(b.p.user_id, 1983750);
  assert.deepStrictEqual(bundleHits(), ['data/views/bundle/' + (1983750 % B) + '.json']);
  const rec2 = await PD.load('fix://', 1983750);
  assert.strictEqual(rec2.user_id, 1983750);
  assert.ok(!hits.includes('players/1983750.json') && !hits.includes('history/1983750.json'), 'まとめた選手の個別のファイルは読まない');
});

test('players_index 読み込み済みなら列 b で決める', async () => {
  const v = V.at('fix://');   // 上と同じ読み込み口。index を読ませてから見る
  await v.index();
  hits.length = 0;
  // まとめていない、かつ current/ もまだ読んでいない uid (index だけで決まる)
  const unb = JSON.parse(fs.readFileSync(path.join(FIX, 'data/views/players_index.json'), 'utf8')).rows.map((r) => r[0]).find((u) => !bundled.has(u) && u % 8 !== 1787719 % 8 && u % 8 !== 1983750 % 8);
  assert.ok(unb != null);
  assert.strictEqual(await v.bundledPlayer(unb), null);
  assert.deepStrictEqual(hits, [], 'index で決まるので current/ も bundle/ も読まない');
});
