// tests/meta/contracts.test.cjs — ビルド出力の契約 (contracts/*.schema.json) を、実データと fixture で検証する。
//   - fixture (tests/frontend/fixtures/achievement_kinds.json = ビルド側テストが組んだ kind/params 付きの全件) は achievement / dynamicBadge の形
//   - 配信中の players/<uid>.json (gh-pages checkout があれば 300 件) は player の形 (kind 無しの旧形式も通る)
//   - schema の kind の集合は js/achievements.js が組める kind と同じ
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv/dist/2020');   // schema は draft 2020-12

const ROOT = path.resolve(__dirname, '../..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/player.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validatePlayer = ajv.compile(schema);
const validateAch = ajv.compile({ $ref: schema.$id + '#/$defs/achievement' });
const validateBadge = ajv.compile({ $ref: schema.$id + '#/$defs/dynamicBadge' });

const fmt = (v) => (v.errors || []).slice(0, 5).map((e) => `${e.instancePath} ${e.message}`).join('; ');

test('fixture (ビルド側テストの全件) が achievement / dynamicBadge の契約を満たす', () => {
  const items = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/frontend/fixtures/achievement_kinds.json'), 'utf8')).items;
  for (const it of items) {
    const v = it.kind === 'trend' ? validateBadge : validateAch;
    assert.ok(v(it), JSON.stringify(it) + ' → ' + fmt(v));
  }
  // 契約違反は落ちる
  assert.ok(!validateAch({ label: 'x', cls: 'gold', priority: 1, kind: 'peak_rank', params: { top: 7 } }), 'top=7 が通ってしまう');
  assert.ok(!validateAch({ label: 'x', cls: 'gold', priority: 1, kind: 'tour', params: { name: 'A', bucket: 'win' } }), 'cls 欠落が通ってしまう');
  assert.ok(!validateAch({ label: 'x', cls: 'pink', priority: 1 }), '未知の cls が通ってしまう');
});

test('schema の kind の集合 = js/achievements.js が組める kind', () => {
  const src = fs.readFileSync(path.join(ROOT, 'site/js/achievements.js'), 'utf8');
  const inCode = new Set([...src.matchAll(/case '([a-z_0-9]+)'/g)].map((m) => m[1]));
  assert.deepStrictEqual([...inCode].sort(), [...schema.$defs.kind.enum].sort());
});

const PLAYERS = path.join(process.env.HOME || '', 'spsp-state/tosakazu.github.io/spsp/players');
test('配信中の players/<uid>.json が player の契約を満たす (300 件)', { skip: !fs.existsSync(PLAYERS) ? PLAYERS + ' が無い' : false }, () => {
  const files = fs.readdirSync(PLAYERS).filter((f) => f.endsWith('.json')).sort().slice(0, 300);
  assert.ok(files.length > 0);
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(PLAYERS, f), 'utf8'));
    assert.ok(validatePlayer(d), f + ' → ' + fmt(validatePlayer));
  }
});
