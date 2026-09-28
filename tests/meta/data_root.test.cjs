// tests/meta/data_root.test.cjs — JSON の置き場 (SPSP.data) と、ビルドの --data-root (別ホスト = R2 への切替、Cloudflare 移行の ②)。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');

function jsFiles(dir) {
  const out = [];
  (function walk(d) {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) { if (!['node_modules', 'i18n', 'regions', 'blog', 'data', 'players', 'tournaments', 'history'].includes(ent.name)) walk(p); }
      else if (ent.name.endsWith('.js') && ent.name !== 'html.js') out.push(p);
    }
  })(dir);
  return out;
}

test('JSON の fetch は SPSP.data 経由 (SPSP.root は assets など配信ファイルにだけ)', () => {
  const bad = [];
  for (const f of [...jsFiles(path.join(ROOT, 'src')), ...jsFiles(path.join(ROOT, 'site'))]) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/SPSP\.root\s*\+\s*['`](data\/|meta\.json|latest_|players|tournaments\/|history\/|news\.json|upcoming)/g)) {
      // 例外: キャラ絵文字の表はフロント (spsp-web) が持ち、サイトと一緒に配信する (js/char_emoji.js、2026-09-28)
      if (/^SPSP\.root\s*\+\s*['`]data\/char_emoji\.json/.test(src.slice(m.index, m.index + 60))) continue;
      bad.push(path.relative(ROOT, f) + ': ' + m[0]);
    }
    for (const m of src.matchAll(/(loadMaster|loadCurrent|loadDiscriminators|loadGeo|defaultFetchers|cachedFetchers)\(SPSP\.root/g)) bad.push(path.relative(ROOT, f) + ': ' + m[0]);
    // 2026-09-28 に見落としていた形: 型注釈付きの loadGeo(/** … */ (SPSP.root))、DATA_BASE = SPSP.root、ナビの news.json
    for (const m of src.matchAll(/loadGeo\([^)]*SPSP\.root/g)) bad.push(path.relative(ROOT, f) + ': ' + m[0]);
    for (const m of src.matchAll(/DATA_BASE\s*=\s*SPSP\.root/g)) bad.push(path.relative(ROOT, f) + ': ' + m[0]);
    for (const m of src.matchAll(/assetPrefix\s*\+\s*['`](news\.json|meta\.json|data\/)/g)) bad.push(path.relative(ROOT, f) + ': ' + m[0]);
  }
  assert.deepStrictEqual(bad, []);
});

test('js/html.js: SPSP.data は config.dataRoot があればそれ、無ければ SPSP.root', () => {
  const vm = require('vm');
  const ctx = { console }; ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { documentElement: { hasAttribute: () => true, getAttribute: (k) => (k === 'data-root' ? '../' : '../') } };
  vm.createContext(ctx);
  vm.runInContext(require('../helpers/built.cjs').built('js/html.js'), ctx);
  assert.strictEqual(ctx.SPSP.data, '../');
  ctx.SPSP.site = { dataRoot: 'https://data.spsp.games/jp/' };
  assert.strictEqual(ctx.SPSP.data, 'https://data.spsp.games/jp/');
  assert.strictEqual(ctx.SPSP.root, '../');
});

test('ビルド --data-root: out/region/config.js の dataRoot に入る (無ければ config のまま)', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'spsp-data-root-'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'tools/build/build_site.mjs'), '--out', out, '--quiet', '--data-root', 'https://data.spsp.games/jp/'], { cwd: ROOT, env: { ...process.env, GOMAXPROCS: '1' } });
    const cfg = fs.readFileSync(path.join(out, 'region/config.js'), 'utf8');
    assert.match(cfg, /dataRoot: 'https:\/\/data\.spsp\.games\/jp\/'/);
    assert.match(fs.readFileSync(path.join(ROOT, 'site/regions/JP/config.js'), 'utf8'), /dataRoot: ''/, 'source の config は変えない');
    assert.throws(() => execFileSync(process.execPath, [path.join(ROOT, 'tools/build/build_site.mjs'), '--out', out, '--quiet', '--data-root', 'data.spsp.games/jp'], { cwd: ROOT, stdio: 'pipe' }), /末尾/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
