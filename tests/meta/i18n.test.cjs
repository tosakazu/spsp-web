'use strict';
// 文言辞書 (site/i18n/*.js) と、それを引くコード (t('key') / i18n('key') / data-i18n / data-i18n-attr) の整合。
//   - 使われているキーが既定言語 (ja) の辞書に全部ある
//   - 辞書のキーはどこかで使われている (使われないキーは消す)
//   - 各言語の辞書のキー集合が ja と一致 (en を足したとき用)
//   - js/i18n.js の t() の置き換え ({name} / plural) が動く
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SITE = path.resolve(__dirname, '../../site');

function loadDict(file) {
  const w = { SPSP_I18N: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: w });
  const langs = Object.keys(w.SPSP_I18N);
  assert.strictEqual(langs.length, 1, file + ': 1 言語だけ置くこと');
  return { lang: langs[0], dict: w.SPSP_I18N[langs[0]] };
}
const dictFiles = fs.readdirSync(path.join(SITE, 'i18n')).filter((f) => f.endsWith('.js')).map((f) => path.join(SITE, 'i18n', f));
const dicts = Object.fromEntries(dictFiles.map((f) => { const d = loadDict(f); return [d.lang, d.dict]; }));
assert.ok(dicts.ja, 'i18n/ja.js が無い');

function siteFiles() {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isSymbolicLink()) continue;
      if (ent.isDirectory()) { if (!['players', 'tournaments', 'history', 'data', 'node_modules', 'i18n', 'blog'].includes(ent.name)) walk(p); }
      else if (/\.(html|js)$/.test(ent.name) && ent.name !== 'i18n.js') out.push(p);   // i18n.js 自身の説明文は除く
    }
  })(SITE);
  (function walkSrc(dir) {   // ページのコード (src/pages/) も
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walkSrc(p); else if (/\.(js|ts)$/.test(ent.name)) out.push(p);
    }
  })(path.resolve(SITE, '../src'));
  return out;
}

// 使われているキー: t('a.b') / i18n('a.b') / t('a.b.' + x) (接頭辞) / data-i18n="a.b" / data-i18n-attr="attr:a.b,attr:a.c"
function usedKeys() {
  const exact = new Map();   // key -> file
  const prefixes = new Map();
  for (const f of siteFiles()) {
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(SITE, f);
    for (const m of src.matchAll(/\b(?:t|i18n)\(\s*'([a-z0-9_.]+)'\s*(?:\+\s*[\w.]+)?\s*[,)]/g)) {
      if (m[0].includes('+')) prefixes.set(m[1], rel); else exact.set(m[1], rel);
    }
    for (const m of src.matchAll(/data-i18n="([a-z0-9_.]+)"/g)) exact.set(m[1], rel);
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g)) {
      for (const pair of m[1].split(',')) { const k = pair.split(':')[1]; if (k) exact.set(k.trim(), rel); }
    }
  }
  return { exact, prefixes };
}

const used = usedKeys();

test('使われている文言キーは ja の辞書にある', () => {
  const missing = [...used.exact].filter(([k]) => !(k in dicts.ja)).map(([k, f]) => `${k} (${f})`);
  assert.deepStrictEqual(missing, []);
  for (const [pre, f] of used.prefixes) {
    assert.ok(Object.keys(dicts.ja).some((k) => k.startsWith(pre)), `接頭辞 ${pre} に当たるキーが無い (${f})`);
  }
});

test('ja の辞書のキーはどこかで使われている', () => {
  const unused = Object.keys(dicts.ja).filter((k) => !used.exact.has(k) && ![...used.prefixes.keys()].some((pre) => k.startsWith(pre)));
  assert.deepStrictEqual(unused, []);
});

test('辞書の値は空でない文字列', () => {
  for (const [lang, d] of Object.entries(dicts)) {
    for (const [k, v] of Object.entries(d)) assert.ok(typeof v === 'string' && v.length > 0, `${lang}: ${k}`);
  }
});

test('各言語のキー集合が ja と一致する', () => {
  const ja = Object.keys(dicts.ja).sort();
  for (const [lang, d] of Object.entries(dicts)) {
    if (lang === 'ja') continue;
    assert.deepStrictEqual(Object.keys(d).sort(), ja, lang + ' のキーが ja と違う');
  }
});

test('js/i18n.js: 地域の上書き → 言語 → 既定言語 の順で引く', () => {
  const w = { SPSP: { site: { region: 'NA', langs: ['ja', 'en'], defaultLang: 'ja' } },
    SPSP_I18N: { ja: { 'x.a': 'ja-a', 'x.b': 'ja-b', 'x.c': 'ja-c' }, en: { 'x.a': 'en-a', 'x.b': 'en-b' } },
    SPSP_I18N_REGION: { NA: { en: { 'x.a': 'na-en-a' }, ja: { 'x.b': 'na-ja-b' } } },
    location: { href: 'https://spsp.games/?lang=en' }, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'ja' }, console: { warn() {} } };
  w.window = w; w.URL = URL; w.Intl = Intl;
  vm.runInNewContext(require('../helpers/built.cjs').built('js/i18n.js'), w);
  const I = w.SPSPI18n;
  assert.strictEqual(I.t('x.a'), 'na-en-a', '地域の上書き (en) が最優先');
  assert.strictEqual(I.t('x.b'), 'en-b', 'en に地域の上書きが無ければ言語辞書');
  assert.strictEqual(I.t('x.c'), 'ja-c', 'en に無ければ既定言語');
});

test('js/i18n.js: t() の置き換えと fallback', () => {
  const w = { SPSP: { site: { langs: ['ja', 'en'], defaultLang: 'ja' } }, SPSP_I18N: { ja: { 'x.hello': 'こんにちは {name}', 'x.n': '{n, plural, one{{n} 件} other{{n} 件}}', 'x.only_ja': 'ja だけ' }, en: { 'x.hello': 'Hello {name}', 'x.n': '{n, plural, one{{n} item} other{{n} items}}' } }, location: { href: 'https://spsp.games/?lang=en' }, localStorage: { getItem: () => null, setItem() {} }, navigator: { language: 'ja' }, console: { warn() {} } };
  w.window = w; w.URL = URL; w.Intl = Intl;
  vm.runInNewContext(require('../helpers/built.cjs').built('js/i18n.js'), w);
  const I = w.SPSPI18n;
  assert.strictEqual(I.lang, 'en');
  assert.strictEqual(I.t('x.hello', { name: 'A' }), 'Hello A');
  assert.strictEqual(I.t('x.n', { n: 1 }), '1 item');
  assert.strictEqual(I.t('x.n', { n: 3 }), '3 items');
  assert.strictEqual(I.t('x.only_ja'), 'ja だけ', '無いキーは既定言語に fallback');
  assert.strictEqual(I.t('x.none'), 'x.none', 'どこにも無いキーはキーのまま');
});
