'use strict';
// jsdom 実行時テスト: 試合結果の報告ページ (src/pages/report.js + site/report/index.html) を見本の画面 (?demo=) で動かす。
// 見本は API にも start.gg にも送らない (fetch は全部 404 に差し替え。選手のデータが無いのでカードは NO DATA になる)。
//   - どの見本もエラーなく描ける
//   - 試合の画面: マッチングの幕が画面より先に出る・タップで消える・自分のカード → 相手のカード → 台 → 入力欄の順
//   - 入力欄は自分の行が先・カードのリンクは押せない
//   - 演出の案 (?anim=) は全部描ける。カードの案は描き終わるまで中身を隠す
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null, VirtualConsole = null;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (e) { /* skip */ }
let esbuild = null;
try { esbuild = require('esbuild'); } catch (e) { /* skip */ }

const ROOT = path.resolve(__dirname, '../..');
const { built } = require('../helpers/built.cjs');
const skip = !JSDOM || !esbuild ? 'jsdom / esbuild が無い' : false;

let BUNDLE = null;
function bundle() {
  if (!BUNDLE) {
    BUNDLE = esbuild.buildSync({ entryPoints: [path.join(ROOT, 'src/pages/report.js')], bundle: true, write: false, format: 'iife', platform: 'browser',
      target: 'esnext', charset: 'utf8', logLevel: 'silent', absWorkingDir: ROOT }).outputFiles[0].text;
  }
  return BUNDLE;
}
const HTML = () => fs.readFileSync(path.join(ROOT, 'site/report/index.html'), 'utf8').replace(/<script src="[^"]*"><\/script>/g, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 見本の画面を開く。first = 試合の画面 (.rp-current) が最初に出たときに幕があったか */
async function open(query, opts) {
  const okRe = opts && opts.ok;   // この URL だけ {} を返す (ほかは 404)
  const errs = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { const m = String(e && e.message); if (!/scrollTo|Not implemented/.test(m)) errs.push(m.slice(0, 300)); });
  const dom = new JSDOM(HTML(), { url: 'https://example.test/jp/report/' + query, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.scrollTo = () => {};
  const fetched = [];
  w.fetch = async (u) => {
    fetched.push(String(u));
    const body = opts && opts.json ? opts.json(String(u)) : null;   // この URL はこの中身を返す
    if (body) return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    const ok = !!okRe && okRe.test(String(u));
    return { ok, status: ok ? 200 : 404, json: async () => ({}), text: async () => (ok ? '{}' : '') };
  };
  const state = { first: null };
  new w.MutationObserver(() => {
    if (state.first === null && w.document.querySelector('.rp-current')) state.first = !!w.document.querySelector('.rp-match-ov');
  }).observe(w.document, { subtree: true, childList: true });
  for (const f of ['region/config.js', 'i18n/ja.js', 'region/i18n.js']) w.eval(built(f));
  w.eval(bundle());
  return { w, d: w.document, errs, state, fetched, close: () => w.close() };
}
async function until(fn, ms = 4000) {
  for (let t = 0; t < ms; t += 25) { if (fn()) return true; await sleep(25); }
  return false;
}

const SCENES = ['match', 'newcomer', 'conflict', 'waiting', 'done', 'gate', 'challonge', 'login', 'not_entrant', 'admin', 'setup_login', 'setup'];

for (const sc of SCENES) {
  test(`見本 ${sc}: エラーなく描ける`, { skip }, async () => {
    const p = await open('?demo=' + sc);
    await until(() => p.d.querySelector('.rp-demo'));
    const ov = p.d.querySelector('.rp-match-ov');
    if (ov) ov.click();
    await sleep(300);
    const main = p.d.querySelector('.rp-main');
    assert.ok(p.d.querySelector('.rp-demo'), '見本の帯が出る');
    assert.ok(main.textContent.trim().length > 50, '画面が空でない');
    assert.deepStrictEqual(p.errs, []);
    p.close();
  });
}

test('試合の画面: 幕が先に出て、タップで消える。自分 → 相手 → 台 → 入力欄の順', { skip }, async () => {
  const p = await open('?demo=match&anim=dark');
  assert.ok(await until(() => p.state.first !== null), '試合の画面が出る');
  assert.strictEqual(p.state.first, true, '画面より先に幕がある (下の画面が見えない)');
  const ov = p.d.querySelector('.rp-match-ov');
  ov.click();
  assert.ok(await until(() => !p.d.querySelector('.rp-match-ov'), 1000), 'タップで幕が消える');
  const cur = p.d.querySelector('.rp-current');
  const order = [...cur.children].map((el) => ['rp-vs', 'rp-round', 'rp-stations', 'rp-form'].find((c) => el.classList.contains(c))).filter(Boolean);
  assert.deepStrictEqual(order.slice(0, 2), ['rp-vs', 'rp-round']);
  assert.ok(order.indexOf('rp-form') > order.indexOf('rp-vs'), '入力欄はカードの後');
  const sides = [...cur.querySelectorAll('.rp-vs > .rp-vs-side')];
  assert.ok(sides[0].classList.contains('rp-me') && sides[1].classList.contains('rp-op'), '自分のカードが先');
  // まとめて: 自分の行が先
  const rows = [...cur.querySelectorAll('.rp-sum-row .rp-sum-name')].map((e) => e.textContent);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows[0].startsWith(sides[0].querySelector('[data-card-name]').getAttribute('data-card-name')) && /自分/.test(rows[0]), 'まとめての欄も自分の行が先: ' + rows.join(' / '));
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('初参加の相手 (SPSP にデータが無い): NO DATA のカード', { skip }, async () => {
  const p = await open('?demo=newcomer&anim=dark');
  await until(() => p.d.querySelector('.rp-match-ov'));
  p.d.querySelector('.rp-match-ov').click();
  assert.ok(await until(() => [...p.d.querySelectorAll('.rp-current .rp-op')].some((e) => /NO DATA/.test(e.textContent))), '相手は NO DATA');
  p.close();
});

test('カードのリンクは押せない (画面が移らない)', { skip }, async () => {
  const p = await open('?demo=match&anim=dark');
  await until(() => p.d.querySelector('.rp-match-ov'));
  p.d.querySelector('.rp-match-ov').click();
  // 見本は選手のデータを読めない (fetch 404) ので、リンクのある要素をカードに足して確かめる
  await until(() => p.d.querySelector('.rp-current .pcard'));
  const a = p.d.createElement('a');
  a.href = '../pref/ranking?pref=tokyo';
  p.d.querySelector('.rp-current .pcard').appendChild(a);
  const ev = new p.w.MouseEvent('click', { bubbles: true, cancelable: true });
  a.dispatchEvent(ev);
  assert.strictEqual(ev.defaultPrevented, true);
  p.close();
});

for (const anim of ['dark', 'light', 'band', 'cards', 'combo', 'cross', 'wipe', 'speed', 'flip', 'ring', 'bars', 'stamp', 'stripes', '']) {
  test(`演出 ${anim || 'ランダム'}: 描けて、案の名前は出さない`, { skip }, async () => {
    const p = await open('?demo=match' + (anim ? '&anim=' + anim : ''));
    assert.ok(await until(() => p.d.querySelector('.rp-match-ov .rp-match-skip')), '幕の中身が出る');
    const ov = p.d.querySelector('.rp-match-ov');
    if (anim && anim !== 'dark') assert.ok(ov.classList.contains('rp-anim-' + anim));
    if (!anim) assert.ok([...ov.classList].some((c) => /^rp-anim-/.test(c)), 'ランダムでも案のどれか');
    assert.ok(!/案 [A-Z]/.test(ov.textContent), '案の名前は画面に出さない');
    const cards = ov.querySelectorAll('.rp-match-card');
    if (cards.length) {
      // カードの案: 描き終わる (ここではフォントが来ないので最大 3 秒) まで .go が付かない → 付いたら 2 枚とも描けている
      assert.ok(await until(() => ov.classList.contains('go'), 3600), '最大 3 秒で動き出す');
      assert.strictEqual([...cards].filter((c) => c.querySelector('.pc-name')).length, 2);
    }
    ov.click();
    assert.ok(await until(() => !p.d.querySelector('.rp-match-ov'), 1000));
    assert.deepStrictEqual(p.errs, []);
    p.close();
  });
}

test('受付を始める画面: 何先と受付の開始の欄がある', { skip }, async () => {
  const p = await open('?demo=setup');
  assert.ok(await until(() => p.d.querySelector('[data-set-open]')), '受付の開始の欄');
  assert.ok(p.d.getElementById('rp-ft-set'), '何先の欄');
  assert.ok(p.d.querySelector('[data-set-open]').value, '開始の既定値が入っている');
  p.close();
});

test('運営の画面: 食い違いは片方の報告を採用して解決できる・手動でスコアを入れて直す欄もある', { skip }, async () => {
  const p = await open('?demo=admin');
  assert.ok(await until(() => p.d.querySelector('.rp-adm-row[data-set="102"]')), '試合の一覧');
  const row = () => p.d.querySelector('.rp-adm-row[data-set="102"]');   // 見本の食い違い
  const adopt = [...row().querySelectorAll('[data-adopt]')];
  assert.strictEqual(adopt.length, 2, '両者の採用ボタン');
  assert.ok(/報告を採用/.test(adopt[1].textContent));
  assert.strictEqual(row().querySelector('[data-fix-open]').textContent, 'スコアを入力して直す');
  // 結果は 1 行ずつ (反映した結果・両者の報告)。食い違った報告は赤
  const res = [...row().querySelectorAll('.rp-adm-res > .rp-adm-k')].map((e) => e.textContent);
  assert.strictEqual(res.length, 3);
  assert.strictEqual(res[0], '反映した結果');
  assert.ok(/の報告$/.test(res[1]) && /の報告$/.test(res[2]));
  assert.strictEqual(row().querySelectorAll('.rp-adm-res .rp-adm-diff').length, 2);
  for (const v of row().querySelectorAll('.rp-adm-res .rp-adm-v.rp-adm-diff')) assert.match(v.textContent, /の \d-\d 勝ち/);
  // 次の試合に結果が出ている (locked) 確認待ちには採用ボタンを出さない
  assert.strictEqual(p.d.querySelector('.rp-adm-row[data-set="101"]').querySelectorAll('[data-adopt]').length, 0);
  // 手動: 欄が開く
  row().querySelector('[data-fix-open]').click();
  assert.ok(await until(() => row().querySelector('form.rp-form')), '入力欄が開く');
  row().querySelector('[data-fix-open]').click();
  await until(() => !row().querySelector('form.rp-form'));
  // 採用 → 確定 (見本はこの画面の中だけ)
  p.w.confirm = () => true;
  row().querySelector('[data-adopt="1"]').click();
  assert.ok(await until(() => row() && row().classList.contains('rp-state-fixed'), 3000), '確定した');
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('カードを何枚描いても、選手によらないファイル (サブ順位など) は 1 回だけ読む', { skip }, async () => {
  const p = await open('?demo=match&anim=cards', { ok: /(^|\/)(meta|overseas|character_index|player_prefectures|player_subranks)\.json$/ });
  await until(() => p.d.querySelectorAll('.pcard').length >= 4);
  await sleep(500);
  const n = (re) => p.fetched.filter((u) => re.test(u)).length;
  for (const re of [/player_subranks\.json/, /player_prefectures\.json/, /overseas\.json/, /character_index\.json/]) assert.strictEqual(n(re), 1, String(re));
  p.close();
});

test('見本: 試合の 2 人を URL で選べる (順位・名前・uid・初参加・ランダム)', { skip }, async () => {
  const rows = Array.from({ length: 100 }, (_, i) => [1000 + i, i === 7 ? 'TEAM | ほげ' : 'P' + (i + 1), i + 1, i + 1, i + 1, 3, 0, 0, null, null, 0, 0]);
  const index = { format: 1, columns: ['uid', 'name', 'ens', 'tjpr', 'bt', 'lv', 'prov', 'ovs', 'char', 'pref', 'last', 'b'], rows };
  const names = async (q) => {
    const p = await open('?demo=match&anim=dark' + q, { json: (u) => (/players_index\.json$/.test(u) ? index : null) });
    await until(() => p.d.querySelector('.rp-match-ov'));
    p.d.querySelector('.rp-match-ov').click();
    await until(() => p.d.querySelectorAll('.rp-current .rp-vs-side [data-card-name]').length === 2);
    const r = [...p.d.querySelectorAll('.rp-current .rp-vs-side [data-card-name]')].map((e) => e.getAttribute('data-card-name'));
    const u = [...p.d.querySelectorAll('.rp-current .rp-vs-side [data-card-name]')].map((e) => e.getAttribute('data-card-uid'));
    const href = p.w.location.search;
    assert.ok(p.d.querySelector('form.rp-demo-pick'), '選ぶ欄がある');
    assert.deepStrictEqual(p.errs, []);
    p.close();
    return { r, u, href };
  };
  assert.deepStrictEqual((await names('&p1=r3&p2=r10')).r, ['P3', 'P10']);
  assert.deepStrictEqual((await names('&p1=ほげ&p2=1004')).r, ['TEAM | ほげ', 'P5']);
  const nw = await names('&p1=r1&p2=new');
  assert.strictEqual(nw.r[0], 'P1');
  assert.strictEqual(nw.u[1], '999999999');
  const def = await names('');
  assert.ok(def.u.every((x) => /^10\d\d$/.test(x)), '指定が無ければ一覧からランダム: ' + def.u);
  const rnd = await names('&p1=random&p2=random');
  assert.ok(/p1=10\d\d&p2=10\d\d/.test(rnd.href), 'ランダムは選んだ uid を URL に書き戻す: ' + rnd.href);
});
