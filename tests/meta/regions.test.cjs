'use strict';
// site/regions/<REGION>/ の契約 (site/regions/README.md):
//   - 地域ディレクトリはどれも同じファイル集合を持つ (JP が基準)
//   - config.js はどの地域も同じキー構造で、region はディレクトリ名と一致
//   - i18n.js の上書きは、言語辞書 (site/i18n/<lang>.js) にあるキーだけ、地域コードはディレクトリ名
//   - site/region は regions/<REGION> への symlink (配信する地域)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SITE = path.resolve(__dirname, '../../site');
const REGIONS = path.join(SITE, 'regions');
const regions = fs.readdirSync(REGIONS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
const BASE = 'JP';

function walk(dir, prefix = '') {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + ent.name;
    if (ent.isDirectory()) out.push(...walk(path.join(dir, ent.name), rel + '/'));
    else if (ent.name !== 'README.md') out.push(rel);
  }
  return out.sort();
}
function shape(v, prefix = '') {   // オブジェクトのキー構造 (葉の型込み) を平らに
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return [prefix + ':' + (Array.isArray(v) ? 'array' : typeof v)];
  return Object.keys(v).sort().flatMap((k) => shape(v[k], prefix ? prefix + '.' + k : k));
}
function loadConfig(region) {
  const w = { location: { hostname: 'example.test' } }; w.window = w;
  vm.runInNewContext(fs.readFileSync(path.join(REGIONS, region, 'config.js'), 'utf8'), w);
  return w.SPSP.site;
}
function loadOverlay(region) {
  const w = { SPSP_I18N_REGION: {} }; w.window = w;
  vm.runInNewContext(fs.readFileSync(path.join(REGIONS, region, 'i18n.js'), 'utf8'), w);
  return w.SPSP_I18N_REGION;
}
const dicts = {};
for (const f of fs.readdirSync(path.join(SITE, 'i18n')).filter((x) => x.endsWith('.js'))) {
  const w = { SPSP_I18N: {} }; w.window = w;
  vm.runInNewContext(fs.readFileSync(path.join(SITE, 'i18n', f), 'utf8'), w);
  Object.assign(dicts, w.SPSP_I18N);
}

test('地域ディレクトリは JP と同じファイル集合を持つ', () => {
  assert.ok(regions.includes(BASE));
  const base = walk(path.join(REGIONS, BASE));
  assert.ok(base.includes('config.js') && base.includes('i18n.js'));
  for (const r of regions) assert.deepStrictEqual(walk(path.join(REGIONS, r)), base, `regions/${r}: ファイル集合が regions/${BASE} と違う`);
});

test('config.js はどの地域も同じキー構造で、region はディレクトリ名', () => {
  const base = shape(loadConfig(BASE));
  for (const r of regions) {
    const cfg = loadConfig(r);
    assert.strictEqual(cfg.region, r, `regions/${r}/config.js: region が '${cfg.region}'`);
    assert.deepStrictEqual(shape(cfg), base, `regions/${r}/config.js: キー構造が regions/${BASE} と違う`);
    assert.ok(cfg.langs.includes(cfg.defaultLang), `regions/${r}: defaultLang が langs に無い`);
  }
});

test('i18n.js の上書きは言語辞書にあるキーだけ、地域コードはディレクトリ名', () => {
  for (const r of regions) {
    const over = loadOverlay(r);
    assert.deepStrictEqual(Object.keys(over), [r], `regions/${r}/i18n.js: SPSP_I18N_REGION.${r} だけを置くこと`);
    const cfg = loadConfig(r);
    assert.deepStrictEqual(Object.keys(over[r]).sort(), [...cfg.langs].sort(), `regions/${r}/i18n.js: 言語の集合が config.langs と違う`);
    for (const [lang, o] of Object.entries(over[r])) {
      const dict = dicts[lang] || dicts[cfg.defaultLang] || dicts.ja;   // その言語の辞書がまだ無ければ既定言語 (キー集合は全言語同じ)
      const unknown = Object.keys(o).filter((k) => !(k in dict));
      assert.deepStrictEqual(unknown, [], `regions/${r}/i18n.js (${lang}): 言語辞書に無いキーを上書きしている`);
    }
  }
});

test('site/region は regions/<REGION> への symlink', () => {
  const link = path.join(SITE, 'region');
  assert.ok(fs.lstatSync(link).isSymbolicLink(), 'site/region が symlink でない');
  const target = fs.readlinkSync(link);
  assert.match(target, /^regions\/[A-Z]+$/, `site/region -> ${target}`);
  assert.ok(regions.includes(target.split('/')[1]), `site/region -> ${target} は存在しない地域`);
});

test('ページは region/config.js と region/i18n.js を読む (regions/ 直下を直接読まない)', () => {
  const htmls = [];
  (function w(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!['players', 'tournaments', 'history', 'blog', 'data', 'regions'].includes(ent.name)) w(p); }
      else if (ent.name.endsWith('.html')) htmls.push(p);
    }
  })(SITE);
  for (const f of htmls) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /src="[^"]*regions\/[A-Z]+\//, `${path.relative(SITE, f)}: regions/<REGION>/ を直接読んでいる`);
    if (/src="[^"]*assets\/[a-z_]+\.js"/.test(s)) assert.match(s, /src="[^"]*region\/config\.js"/, `${path.relative(SITE, f)}: region/config.js を読んでいない`);
  }
});

test('日本以外の地域: 「全国 / 日本 / Japan / nationwide」と言う言語辞書のキーは全部上書きされている', () => {
  // 言語辞書は日本版の言い方 (全国ランキング、#1 in Japan …)。他の地域はそのままだと「北米版なのに 1st in Japan」になる。
  const JA_WORDS = /全国|日本/, EN_WORDS = /\bJapan\b|nationwide|\bnational\b/i;
  const skip = new Set(['lang.ja', 'region.JP']);   // 言語名・地域名そのもの
  for (const r of regions) {
    if (r === BASE) continue;
    const over = loadOverlay(r)[r];
    for (const [lang, re] of [['ja', JA_WORDS], ['en', EN_WORDS]]) {
      const need = Object.keys(dicts[lang]).filter((k) => !skip.has(k) && re.test(dicts[lang][k]));
      const missing = need.filter((k) => !(over[lang] && k in over[lang]));
      assert.deepStrictEqual(missing, [], `regions/${r}/i18n.js (${lang}): 日本の言い方のまま`);
      for (const k of need) assert.ok(!re.test(over[lang][k]), `regions/${r}/i18n.js (${lang}): ${k} の上書きにまだ日本の言い方が残っている: ${over[lang][k]}`);
    }
  }
});
