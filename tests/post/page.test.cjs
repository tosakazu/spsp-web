'use strict';
// 静的整合: HTML ↔ JS の id、INV-8 (callback の外部リソース禁止)、
// クライアント定数と GAS 定数の食い違い検出。jsdom 不要。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => p.startsWith('site/') ? require('../helpers/built.cjs').built(p.slice(5)) : fs.readFileSync(path.join(ROOT, p), 'utf8');
// ビルド側 (spsp_scripts) の定数との突き合わせ。別リポジトリなので checkout の場所を SPSP_BUILD_REPO で指す
// (既定: この repo の隣の spsp-ranking)。無い環境 (CI) では skip する。
const BUILD_REPO = process.env.SPSP_BUILD_REPO || path.resolve(ROOT, '../spsp-ranking');
const buildFile = (p) => { const f = path.join(BUILD_REPO, p); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

const POST_HTML = read('site/post.html');
const CB_HTML = read('site/callback.html');
const VOTE_HTML = read('site/vote.html');
const POST_JS = read('site/js/post.js');
const CB_JS = read('site/js/callback.js');
const VOTE_JS = read('site/js/vote.js');
const AUTH_JS = read('site/js/auth.js');
const CONFIG_JS = read('site/js/post_config.js');
const GAS_CONFIG = read('gas/config.gs');

// 「nav.js は読まない」「spsp.games には出さない」のような注意書き自体が
// 検出に引っかからないよう、コメントを除いたソースで検査する。
const stripHtmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** `getElementById('x')` / `$('x')` で参照している id を集める。 */
function referencedIds(src) {
  const ids = new Set();
  const re = /(?:getElementById|\$)\(\s*'([a-z0-9-]+)'\s*\)/g;
  let m;
  while ((m = re.exec(src))) ids.add(m[1]);
  return ids;
}

function definedIds(html) {
  const ids = new Set();
  const re = /\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.add(m[1]);
  return ids;
}

test('post.js が参照する id は post.html に存在する', () => {
  const have = definedIds(POST_HTML);
  for (const id of referencedIds(POST_JS)) {
    assert.ok(have.has(id), 'post.html に id="' + id + '" が無い');
  }
});

test('callback.js が参照する id は callback.html に存在する', () => {
  const have = definedIds(CB_HTML);
  for (const id of referencedIds(CB_JS)) {
    assert.ok(have.has(id), 'callback.html に id="' + id + '" が無い');
  }
});

test('vote.js が参照する id は vote.html に存在する', () => {
  const have = definedIds(VOTE_HTML);
  for (const id of referencedIds(VOTE_JS)) {
    assert.ok(have.has(id), 'vote.html に id="' + id + '" が無い');
  }
});

test('vote.html は必要なスクリプトを順に読む', () => {
  // 読み込む script の並びは src/pages/vote.js の import (ビルドが assets/vote.js に結合)
  const imports = require('../helpers/pages.cjs').pageImports('vote');
  const idx = ['js/post_config.js', 'js/oauth_state.js', 'js/fighter_number.js', 'js/auth.js', 'js/vote.js']
    .map((s) => imports.indexOf(s));
  assert.ok(idx.every((i) => i !== -1), '読み込み漏れ: ' + idx);
  for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], '読み込み順が不正');
});

test('callback.html は auth.js を callback.js より先に読む (login フロー用)', () => {
  const imports = require('../helpers/pages.cjs').pageImports('callback');
  const a = imports.indexOf('js/auth.js');
  const c = imports.indexOf('js/callback.js');
  assert.ok(a !== -1 && c !== -1 && a < c);
});

test('vote.html の CSS がナビ (nav.js 注入) に漏れない', () => {
  // 過去に素の button {} がナビのボタンまで塗り替えた。装飾セレクタは
  // main 配下にスコープすること (リセット系の * / html / body / [hidden] は除く)。
  const css = VOTE_HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}').map((r) => r.split('{')[0].trim()).filter(Boolean)
    .filter((sel) => !/^@/.test(sel) && sel !== 'to');
  const allowed = /^(\*|html|html, body|body|main|\[hidden\])$/;
  for (const sel of selectors) {
    if (allowed.test(sel)) continue;
    for (const part of sel.split(',')) {
      assert.ok(/^main[ #.]/.test(part.trim()),
        'main にスコープされていないセレクタ: ' + part.trim());
    }
  }
});

test('FIGHTER_NUMBER (共有) が char_emoji.json の全キャラを網羅し、マリオが 1', () => {
  // js/fighter_number.js はキャラ別ランキング (c/index.html) とキャラ投票の共有定義。
  // 実データとズレるとそのキャラだけ末尾に落ちる (壊れはしない) ので、ズレを検出する。
  const FN = ((m) => m.default || m)(require(path.join(ROOT, 'site/js/fighter_number.js')));   // ES module: require は namespace を返す
  const emoji = JSON.parse(read('site/data/char_emoji.json'));

  for (const [id, v] of Object.entries(emoji)) {
    assert.ok(FN[id] !== undefined, 'FIGHTER_NUMBER に無いキャラ: ' + id + ' ' + v.name);
  }
  // マリオ (1302) が 1 で、番号に重複が無い
  assert.strictEqual(FN[1302], 1);
  const vals = Object.values(FN);
  assert.strictEqual(new Set(vals).size, vals.length, '番号に重複がある');
});

test('c/index.html は共有の fighter_number.js を読む (独自定義を持たない)', () => {
  const { pageImports, pageWithScript } = require('../helpers/pages.cjs');
  assert.ok(pageImports('c_index').includes('js/fighter_number.js'), '共有ファイルを読んでいない (src/pages/c_index.js の import)');
  assert.ok(!/const FIGHTER_NUMBER\s*=/.test(pageWithScript('c/index.html')), 'インライン定義が残っている');
});

test('未公開のページと callback には noindex が付いている', () => {
  // vote.html は 2026-08-14 に公開済み (ナビの選手メニューからリンク)。
  // callback.html の noindex は公開後も外さない (認証の中継ページなので)。
  for (const [name, html] of [['post.html', POST_HTML], ['callback.html', CB_HTML]]) {
    assert.match(html, /<meta name="robots" content="noindex">/, name);
  }
  assert.ok(!/content="noindex"/.test(VOTE_HTML), 'vote.html は公開済みなので noindex は外す');
});

test('選手メニューは右揃えで開く (左揃えだと狭い画面で切れる)', () => {
  const NAV = read('site/nav.js');
  // 既定: アイコンの右端に揃える
  const base = NAV.match(/\.nav-user \.nav-menu \{[^}]*\}/);
  assert.ok(base, '.nav-user .nav-menu の規則が無い');
  assert.match(base[0], /left:\s*auto/, '左揃えのままになっている');
  assert.match(base[0], /right:\s*0/);

  // モバイル: viewport の右に固定し、nav の実測高さの下に出す
  const mq = NAV.match(/@media \(max-width:720px\) \{[\s\S]*?\n      \}/);
  assert.ok(mq, 'モバイル用のメディアクエリが無い');
  const mobile = mq[0].match(/\.nav-user \.nav-menu \{[^}]*\}/);
  assert.ok(mobile, 'モバイルで選手メニューの位置を直していない');
  assert.match(mobile[0], /position:\s*fixed/);
  assert.match(mobile[0], /top:\s*calc\(var\(--nav-height\)/,
    'nav が折り返したときに被らないよう実測高さを使うこと');
  assert.match(mobile[0], /max-width:\s*calc\(100vw/);
});

test('ナビの選手メニューから vote.html に行ける', () => {
  const NAV = require('../helpers/built.cjs').src('nav.js');
  assert.ok(/class="nav-dropdown nav-user/.test(NAV), '選手メニューが無い');
  assert.ok(NAV.indexOf("pageHref('vote.html')") !== -1, 'キャラ投票へのリンクが無い');
  assert.ok(/\/vote\(\\\.html\)\?\$\/\.test\(p\)\)\s*return 'vote'/.test(NAV),   // .html の有無どちらも (拡張子なしの URL)
    'currentPage() が vote を返さない (= 現在地のハイライトが効かない)');
  // post.html はまだ公開していないのでリンクしない
  assert.ok(NAV.indexOf('post.html') === -1, 'post.html は未公開なのでナビに出さない');
});

test('INV-8: callback.html に外部リソースが無い', () => {
  const html = stripHtmlComments(CB_HTML);
  // src=/href= が外部を指していないこと
  const re = /\b(?:src|href)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const v = m[1];
    assert.ok(!/^(https?:)?\/\//.test(v), 'callback.html が外部を参照: ' + v);
    assert.ok(!/^data:/.test(v), 'callback.html に data URI: ' + v);
  }
  // 埋め込み系のタグごと禁止
  for (const tag of ['<img', '<iframe', '<link', '<video', '<audio', '<object', '<embed']) {
    assert.ok(html.indexOf(tag) === -1, 'callback.html に ' + tag + ' がある');
  }
  // nav.js は Google Analytics を読み込むので callback では禁止
  assert.ok(html.indexOf('nav.js') === -1, 'callback.html が nav.js を読んでいる');
  assert.ok(stripJsComments(CB_JS).indexOf('googletagmanager') === -1);
});

test('INV-8: callback.html に referrer と CSP がある', () => {
  assert.match(CB_HTML, /<meta name="referrer" content="no-referrer">/);
  assert.match(CB_HTML, /http-equiv="Content-Security-Policy"/);
  const csp = CB_HTML.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  // Worker (/api = 自分自身) と GAS (script.google.com → script.googleusercontent.com にリダイレクト) の両方
  assert.match(csp, /connect-src[^;]*'self'/);
  assert.match(csp, /connect-src[^;]*script\.google\.com/);
  assert.match(csp, /connect-src[^;]*script\.googleusercontent\.com/);
});

test('両ページとも同じ設定・共有ロジックを読む', () => {
  const { pageImports } = require('../helpers/pages.cjs');
  for (const id of ['post', 'callback']) {
    const imports = pageImports(id);
    assert.ok(imports.includes('js/post_config.js'), `src/pages/${id}.js が post_config.js を読んでいない`);
    assert.ok(imports.includes('js/oauth_state.js'), `src/pages/${id}.js が oauth_state.js を読んでいない`);
  }
});

test('REDIRECT_URI がクライアントと GAS で一致する', () => {
  const c = CONFIG_JS.match(/REDIRECT_URI:\s*'([^']+)'/)[1];
  const g = GAS_CONFIG.match(/REDIRECT_URI\s*=\s*'([^']+)'/)[1];
  assert.strictEqual(c, g);
  assert.strictEqual(c, 'https://tosakazu.github.io/spsp/callback.html');
  // callback.html の実配置と一致していること
  assert.ok(fs.existsSync(path.join(ROOT, 'site/callback.html')));
});

test('SCOPE / BODY_MAX がクライアントと GAS で一致する', () => {
  assert.strictEqual(
    CONFIG_JS.match(/SCOPE:\s*'([^']+)'/)[1],
    GAS_CONFIG.match(/SCOPE\s*=\s*'([^']+)'/)[1]);
  assert.strictEqual(
    Number(CONFIG_JS.match(/BODY_MAX:\s*(\d+)/)[1]),
    Number(GAS_CONFIG.match(/BODY_MAX\s*=\s*(\d+)/)[1]));
});

test('token エンドポイントは api.start.gg、認可は start.gg', () => {
  assert.match(GAS_CONFIG, /TOKEN_URL\s*=\s*'https:\/\/api\.start\.gg\/oauth\/access_token'/);
  assert.match(CONFIG_JS, /AUTHORIZE_URL:\s*'https:\/\/start\.gg\/oauth\/authorize'/);
});

test('INV-3: クライアント側に secret らしきものが無い', () => {
  for (const [name, src] of [['post_config.js', CONFIG_JS], ['post.js', POST_JS],
    ['callback.js', CB_JS], ['vote.js', VOTE_JS], ['auth.js', AUTH_JS]]) {
    assert.ok(!/client_secret/i.test(stripJsComments(src)), name + ' に client_secret がある');
  }
});

test('INV-3: 配信されるファイルに secret 形状の文字列が無い', () => {
  // site/ は spsp.games と GitHub Pages の両方に出る。長い 16 進文字列
  // (= start.gg の client secret の形) が紛れ込んでいないか見る。
  const files = ['site/post.html', 'site/callback.html', 'site/vote.html',
    'site/js/post_config.js', 'site/js/oauth_state.js', 'site/js/post.js',
    'site/js/callback.js', 'site/js/vote.js', 'site/js/auth.js'];
  for (const f of files) {
    const hits = read(f).match(/\b[0-9a-f]{32,}\b/gi);
    assert.strictEqual(hits, null, f + ' に secret 形状の文字列: ' + hits);
  }
});

test('INV-3: secrets.gs は git 管理外で、追跡ファイルに secret が無い', () => {
  const { execFileSync } = require('node:child_process');
  const ignored = execFileSync('git', ['check-ignore', 'gas/secrets.gs'],
    { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.strictEqual(ignored, 'gas/secrets.gs', 'gas/secrets.gs が .gitignore されていない');

  // 追跡されている gas/*.gs に secret 形状の文字列が無いこと
  const tracked = execFileSync('git', ['ls-files', 'gas'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((s) => s.endsWith('.gs'));
  assert.ok(tracked.length > 0);
  for (const f of tracked) {
    assert.ok(!/\b[0-9a-f]{32,}\b/i.test(read(f)), f + ' に secret 形状の文字列がある');
  }
});

test('CLIENT_ID がクライアントと GAS で一致する', () => {
  assert.strictEqual(
    CONFIG_JS.match(/CLIENT_ID:\s*'([^']+)'/)[1],
    GAS_CONFIG.match(/STARTGG_CLIENT_ID\s*=\s*'([^']+)'/)[1]);
});

test('EXPORT_KEY_LABEL が GAS とビルドで一致する', (t) => {
  // 鍵は保存せず両側でこのラベルから導出する。ずれると export が auth_failed になる。
  const FETCH_PY = buildFile('spsp/cli/fetch_char_votes.py');
  if (FETCH_PY === null) return t.skip('ビルド側 (SPSP_BUILD_REPO) が無い');
  const gas = GAS_CONFIG.match(/EXPORT_KEY_LABEL\s*=\s*'([^']+)'/)[1];
  const build = FETCH_PY.match(/^EXPORT_KEY_LABEL\s*=\s*'([^']+)'/m)[1];
  assert.strictEqual(gas, build);
});

test('DOUBLE_MAIN_PCT_GAP がクライアント / GAS / ビルドで一致する', (t) => {
  // ビルド (spsp/char_vote.py) は投票の採否をこの閾値で決める。
  // 3 つがずれると「投票できたのにビルドが採用しない」が黙って起きる。
  const CHAR_VOTE_PY = buildFile('spsp/char_vote.py');
  if (CHAR_VOTE_PY === null) return t.skip('ビルド側 (SPSP_BUILD_REPO) が無い');
  const client = Number(CONFIG_JS.match(/DOUBLE_MAIN_PCT_GAP:\s*([\d.]+)/)[1]);
  const gas = Number(GAS_CONFIG.match(/DOUBLE_MAIN_PCT_GAP\s*=\s*([\d.]+)/)[1]);
  const build = Number(CHAR_VOTE_PY.match(/^DOUBLE_MAIN_PCT_GAP\s*=\s*([\d.]+)/m)[1]);
  assert.strictEqual(client, gas);
  assert.strictEqual(client, build);
});

test('spsp.games を指す URL がページに無い', () => {
  // spsp.games は検証・ビルド用。ユーザー向けページから露出させない。
  const pages = [
    ['post.html', stripHtmlComments(POST_HTML)],
    ['callback.html', stripHtmlComments(CB_HTML)],
    ['vote.html', stripHtmlComments(VOTE_HTML)],
    ['post.js', stripJsComments(POST_JS)],
    ['callback.js', stripJsComments(CB_JS)],
    ['vote.js', stripJsComments(VOTE_JS)],
    ['auth.js', stripJsComments(AUTH_JS)],
    ['post_config.js', stripJsComments(CONFIG_JS)],
  ];
  for (const [name, src] of pages) {
    assert.ok(src.indexOf('spsp.games') === -1, name + ' が spsp.games を参照している');
  }
});

test('シート列の定義がスキーマ (§7) どおり', () => {
  const m = read('gas/config.gs').match(/SHEET_HEADER\s*=\s*\[([^\]]+)\]/)[1];
  const cols = m.split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepStrictEqual(cols,
    ['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'body', 'status']);

  const v = read('gas/config.gs').match(/VOTES_HEADER\s*=\s*\[([^\]]+)\]/)[1];
  assert.deepStrictEqual(v.split(',').map((s) => s.trim().replace(/^'|'$/g, '')),
    ['timestamp', 'user_id', 'user_slug', 'gamer_tag', 'char_id', 'char_name', 'status']);
});

test('GAS の資格判定データは gh-pages (公開 URL) から読む', () => {
  const cfg = read('gas/config.gs');
  assert.match(cfg, /DATA_BASE_URL = 'https:\/\/tosakazu\.github\.io\/spsp'/);
  // spsp.games (検証用) を GAS からも参照しない
  assert.ok(stripJsComments(cfg).indexOf('spsp.games') === -1);
});

test('appsscript.json が匿名アクセスの Web アプリ設定になっている', () => {
  const j = JSON.parse(read('gas/appsscript.json'));
  assert.strictEqual(j.timeZone, 'Asia/Tokyo');
  assert.strictEqual(j.runtimeVersion, 'V8');
  assert.strictEqual(j.webapp.executeAs, 'USER_DEPLOYING');
  assert.strictEqual(j.webapp.access, 'ANYONE_ANONYMOUS');
});
