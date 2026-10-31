'use strict';
// jsdom 実行時テスト: 試合結果の報告ページ (src/pages/report.js + site/report/index.html) を見本の画面 (?demo=) で動かす。
// 見本は API にも start.gg にも送らない (fetch は全部 404 に差し替え。選手のデータが無いのでカードは NO DATA になる)。
//   - どの見本もエラーなく描ける
//   - 試合の画面: マッチングの幕が画面より先に出る・タップで消える・自分のカード → 相手のカード → 台 → 入力欄の順
//   - 入力欄は自分の行が先・カードのリンクは押せない
//   - 演出の案 (?anim=) は全部見本の帯から選べる。描く処理が違う案 (幕だけ / カード / 線 + 飾りの有無 / ランダム) は描ける。カードの案は描き終わるまで中身を隠す
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
  if (opts && opts.before) opts.before(w);
  for (const f of ['region/config.js', 'i18n/ja.js', 'region/i18n.js']) w.eval(built(f));
  w.eval(bundle());
  return { w, d: w.document, errs, state, fetched, close: () => w.close() };
}
async function until(fn, ms = 4000) {
  for (let t = 0; t < ms; t += 25) { if (fn()) return true; await sleep(25); }
  return false;
}

// 専用のテストが無い見本だけ (match / win / newcomer / admin / setup は下の専用のテストでエラーなしも見る)
const SCENES = ['conflict', 'waiting', 'done', 'gate', 'challonge', 'login', 'not_entrant', 'setup_login'];

for (const sc of SCENES) {
  test(`見本 ${sc}: エラーなく描ける`, { skip }, async () => {
    const p = await open('?demo=' + sc);
    await until(() => p.d.querySelector('.rp-demo'));
    const ov = p.d.querySelector('.rp-match-ov');
    if (ov) ov.click();
    const main = p.d.querySelector('.rp-main');
    await until(() => !p.d.querySelector('.rp-match-ov') && main.textContent.trim().length > 50, 1000);
    await sleep(100);   // 描いたあとの非同期の処理でエラーが出ないか
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
  await until(() => ov.querySelector('.rp-match-skip'));
  assert.ok(!/案 [A-Z]/.test(ov.textContent), '案の名前は画面に出さない');
  // 演出の案は見本の帯から全部選べる (下の演出のテストは描く処理が違う案だけ開く)
  const links = [...p.d.querySelectorAll('.rp-demo a[href*="anim="]')].map((a) => /anim=([a-z]+)/.exec(a.getAttribute('href'))[1]);
  for (const a of ['dark', 'light', 'band', 'cards', 'combo', 'cross', 'wipe', 'speed', 'flip', 'ring', 'bars', 'stamp', 'stripes']) assert.ok(links.includes(a), '見本の帯に ' + a);
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
  assert.deepStrictEqual(p.errs, []);
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

// 描く処理が違う案だけ: light (幕だけ。band も同じ処理、dark は上の試合の画面のテスト) / cards (カード) /
// 線の案は class 名と飾り (animFxHtml) だけが違う → 飾りなし combo・<i> の飾り speed・<b> の飾り stamp / ランダム
for (const anim of ['light', 'cards', 'combo', 'speed', 'stamp', '']) {
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
  assert.ok(p.d.querySelector('.rp-demo'), '見本の帯が出る');
  assert.deepStrictEqual(p.errs, []);
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

test('カードは、出ている文字のフォントを名指しで読み、届いてから詰め直す。それまで下の画面のカードは枠のまま', { skip }, async () => {
  // 描いた文字の分のフォントはまだ無い (check = false)。load は finish() まで終わらない
  let have = false, finish = () => {};
  const loads = [];
  const gate = new Promise((r) => { finish = () => { have = true; r(); }; });
  const fonts = { status: 'loaded', ready: Promise.resolve(), check: () => have, load: (spec, text) => { loads.push([spec, text]); return gate.then(() => []); } };
  const p = await open('?demo=newcomer&anim=dark', { before: (w) => {
    Object.defineProperty(w.document, 'fonts', { value: fonts, configurable: true });
    // jsdom は外の CSS を読まないので、CSS は届いている扱いにする
    Object.defineProperty(w.HTMLLinkElement.prototype, 'sheet', { get: () => ({}), configurable: true });
  } });
  await until(() => p.d.querySelector('.rp-match-ov'));
  p.d.querySelector('.rp-match-ov').click();
  assert.ok(await until(() => p.d.querySelector('.rp-current .rp-op .pc-in')), 'カードを描く');
  const card = p.d.querySelector('.rp-current .rp-op .pcard');
  const before = card.querySelector('.pc-in');
  await sleep(150);
  assert.ok(loads.some(([, t]) => /NO DATA/.test(t)), 'カードの文字でフォントを読む: ' + loads.length);
  assert.ok(card.classList.contains('rp-card-wait'), 'フォントが届くまでは枠のまま');
  assert.strictEqual(card.querySelector('.pc-in'), before);
  finish();
  assert.ok(await until(() => card.querySelector('.pc-in') !== before, 1000), 'フォントが届いたら作り直す');
  assert.ok(await until(() => !card.classList.contains('rp-card-wait'), 1000), '作り直してから見せる');
  p.close();
});

test('勝利画面 (見本): 演出 → 止まって勝利画面。自分と相手・スコア・キャラ絵文字・大会名・ラウンド・UF・X に投稿', { skip }, async () => {
  // 勝利画面の形は card / ribbon (赤い帯) / letters・confetti (白い紙) の 3 通り。letters は下の保存のテストで開く
  for (const win of ['card', 'ribbon', 'confetti']) {
    const emoji = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/char_emoji.json'), 'utf8'));
    const p = await open('?demo=win' + (win ? '&win=' + win : ''), { json: (u) => (/char_emoji\.json$/.test(u) ? emoji : null) });
    assert.ok(await until(() => p.d.querySelector('.rp-win-ov')), '勝利の演出が出る ' + win);
    const ov = p.d.querySelector('.rp-win-ov');
    assert.ok(ov.classList.contains('rp-win-' + win));
    assert.ok(!ov.classList.contains('still'), '最初は演出');
    ov.click();   // タップで飛ばす
    assert.ok(ov.classList.contains('still'), 'タップで勝利画面に');
    const panel = ov.querySelector('[data-win-panel]');
    assert.match(panel.querySelector('.rp-win-score').textContent.replace(/\s+/g, ''), /^2-1$/);
    if (ov.classList.contains('rp-win-card')) assert.ok(panel.querySelector('.rp-win-pcard .pc-in'), '自分のカード');
    else assert.ok(panel.querySelector('.rp-win-me .rp-win-nm').textContent.length > 0);
    assert.ok(panel.querySelector('.rp-win-op .rp-win-nm, .rp-win-against .rp-win-nm').textContent.length > 0);
    assert.ok([...panel.querySelectorAll('.rp-win-em')].every((e) => e.textContent.length > 0), '報告したキャラの絵文字');
    assert.match(panel.querySelector('.rp-win-round').textContent, /Pools.*B3.*Winners Final/);
    // 次のフェーズへの進出 (見本は 0.5 秒後に分かる): 勝者側Top 32進出
    assert.ok(await until(() => !panel.querySelector('.rp-win-adv').hidden, 1500), '進出の札');
    assert.strictEqual(panel.querySelector('.rp-win-adv').textContent, '勝者側Top 32進出');
    if (ov.classList.contains('rp-win-card')) assert.match(p.w.getComputedStyle(panel.querySelector('.rp-win-sash')).boxShadow || '#fff', /#fff|255, 255, 255/);
    assert.ok(panel.querySelector('.rp-win-tour').textContent.length > 0, '大会名');
    assert.match(panel.querySelector('.rp-win-uf').textContent, /^\+\d+UPSET FACTOR$/, 'シード 24 が 3 に勝った: UF');
    // X に投稿: 文に相手・スコア・UF。画像を渡せない端末は文だけで投稿画面を開く
    let opened = '';
    p.w.open = (u) => { opened = String(u); return null; };
    // 画像を渡せないスマホ扱い (画像は作らずすぐ開く。画像つきの経路は保存のテストで見る)
    p.w.matchMedia = (q) => ({ matches: /coarse/.test(q), addEventListener() {}, removeEventListener() {} });
    ov.querySelector('[data-win-tweet]').click();
    assert.ok(await until(() => opened, 1500), '投稿画面を開く');
    const text = decodeURIComponent((/[?&]text=([^&]*)/.exec(opened) || [])[1] || '');
    assert.ok(/^https:\/\/x\.com\/intent\/tweet\?/.test(opened), opened);
    assert.match(text, /で .+ に 2-1 で勝ちました！ \(UF \+\d+\)\n勝者側Top 32進出$/);
    ov.querySelector('[data-win-close]').click();
    assert.ok(await until(() => !p.d.querySelector('.rp-win-ov'), 1000), '閉じる');
    assert.deepStrictEqual(p.errs, []);
    p.close();
  }
});

test('勝利画面: 勝ちを報告したときだけ出る (負けの報告では出ない)。UF が 1 未満なら UF を出さない', { skip }, async () => {
  // 選手一覧にメインキャラ (1271 = ベヨネッタ、1272 = クッパJr.) がある。報告ではキャラを選ばない → 使用キャラの絵文字
  const emoji = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/char_emoji.json'), 'utf8'));
  const rows = [1271, 1272].map((c, i) => [5000 + i, 'Q' + i, i + 1, i + 1, i + 1, 3, 0, 0, c, null, 0, 0]);
  const index = { format: 1, columns: ['uid', 'name', 'ens', 'tjpr', 'bt', 'lv', 'prov', 'ovs', 'char', 'pref', 'last', 'b'], rows };
  const json = (u) => (/char_emoji\.json$/.test(u) ? emoji : /players_index\.json$/.test(u) ? index : null);
  for (const won of [true, false]) {
    const p = await open('?demo=match&anim=dark&p1=r1&p2=r2', { json });
    await until(() => p.d.querySelector('.rp-match-ov'));
    p.d.querySelector('.rp-match-ov').click();
    await until(() => p.d.querySelector('.rp-current form.rp-form'));
    const form = p.d.querySelector('.rp-current form.rp-form');
    const mine = form.querySelector('.rp-sum-row select[data-score]');   // 自分の行が先
    const theirs = form.querySelectorAll('.rp-sum-row select[data-score]')[1];
    mine.value = won ? '2' : '0'; mine.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    theirs.value = won ? '0' : '2'; theirs.dispatchEvent(new p.w.Event('change', { bubbles: true }));
    p.w.confirm = () => true;
    form.querySelector('button[type=submit]').click();
    await sleep(400);
    const ov = p.d.querySelector('.rp-win-ov');
    if (!won) { assert.strictEqual(ov, null, '負けでは出ない'); p.close(); continue; }
    assert.ok(ov, '勝ちで出る');
    ov.click();
    assert.match(ov.querySelector('.rp-win-score').textContent.replace(/\s+/g, ''), /^2-0$/);
    assert.strictEqual(ov.querySelector('.rp-win-uf'), null, '見本の試合はシード 5 vs 28 (UF なし)');
    assert.ok(ov.querySelector('.rp-win-adv').hidden, '進出が分からなければ札は出さない');
    const ems = [...ov.querySelectorAll('.rp-win-em')].map((e) => e.textContent);
    // カードの案は自分の絵文字の代わりにカード (相手の絵文字だけ)
    const want = ov.classList.contains('rp-win-card') ? [emoji['1272'].emoji] : [emoji['1271'].emoji, emoji['1272'].emoji];
    assert.ok(want.every((e) => ems.includes(e)), '報告にキャラが無ければ使用キャラ: ' + ems.join(' '));
    p.close();
  }
});

test('勝利画面の画像を保存: 画面を撮らずに Canvas で 1200×675 を描いて保存する (描く処理が最後まで通る)', { skip }, async () => {
  // 画像はカードの案かどうかだけで描き方が変わる (victoryPng)。カードの案は jsdom で撮れないので letters だけ
  for (const win of ['letters']) {
    const calls = [];
    const p = await open('?demo=win&win=' + win, { before: (w) => {
      // jsdom に canvas は無いので、描く命令を記録するだけの 2D の文脈を渡す
      const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'measureText' ? (t) => ({ width: String(t).length * 10 }) : (...a) => { calls.push([k, ...a]); }), set: (o, k, v) => { o[k] = v; return true; } });
      w.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
      w.HTMLCanvasElement.prototype.toBlob = function (cb) { calls.push(['toBlob', this.width, this.height]); cb(new w.Blob(['x'], { type: 'image/png' })); };
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    } });
    await until(() => p.d.querySelector('.rp-win-ov'));
    const ov = p.d.querySelector('.rp-win-ov');
    ov.click();
    await until(() => !p.d.querySelector('.rp-win-adv').hidden, 1500);
    let downloaded = '', alerted = '';
    p.w.alert = (m) => { alerted = String(m); };
    p.w.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
    ov.querySelector('[data-win-save]').click();
    assert.ok(await until(() => downloaded || alerted, 3000), '保存するか、失敗を知らせる');
    assert.strictEqual(alerted, '', '失敗しない');
    assert.match(downloaded, /^SPSP_win_.+_vs_.+\.png$/);
    assert.deepStrictEqual(calls.find((c) => c[0] === 'toBlob'), ['toBlob', 1200, 675]);
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
    for (const t of ['WIN', 'spsp.games', '勝者側Top 32進出']) assert.ok(texts.some((x) => x.includes(t)), t + ' を描く: ' + texts.slice(0, 12).join(' / '));
    assert.deepStrictEqual(p.errs, []);
    // X に投稿 (PC): 画像をクリップボードに入れてから投稿画面
    let opened = '', clip = null;
    p.w.open = (u) => { opened = String(u); return null; };
    p.w.ClipboardItem = function (items) { this.items = items; };
    Object.defineProperty(p.w.navigator, 'clipboard', { configurable: true, value: { write: async (list) => { clip = await list[0].items['image/png']; } } });
    ov.querySelector('[data-win-tweet]').click();
    assert.ok(await until(() => opened, 3000), 'コピーの後に投稿画面');
    assert.ok(clip && clip.type === 'image/png', '画像をコピー');
    assert.match(ov.querySelector('.rp-win-note').textContent, /コピー/);
    // スマホ: 共有シートに画像と文 (投稿画面は開かない)
    p.close();
    opened = '';
    let shared = null;
    const q = await open('?demo=win&win=' + win, { before: (w) => {
      const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : k === 'measureText' ? (t) => ({ width: String(t).length * 10 }) : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
      w.HTMLCanvasElement.prototype.getContext = function () { return ctx; };
      w.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new w.Blob(['x'], { type: 'image/png' })); };
      w.matchMedia = (mq) => ({ matches: /coarse/.test(mq), addEventListener() {}, removeEventListener() {} });
      w.navigator.canShare = () => true;
      w.navigator.share = async (d) => { shared = d; };
      w.open = (u) => { opened = String(u); return null; };
    } });
    await until(() => q.d.querySelector('.rp-win-ov'));
    q.d.querySelector('.rp-win-ov').click();
    await until(() => !q.d.querySelector('.rp-win-adv').hidden, 1500);
    q.d.querySelector('[data-win-tweet]').click();
    assert.ok(await until(() => shared, 3000), '共有シート');
    assert.match(shared.files[0].name, /^SPSP_win_.+\.png$/);
    assert.match(shared.text, /勝ちました！[\s\S]*勝者側Top 32進出/);
    assert.strictEqual(opened, '', 'スマホは投稿画面を別に開かない');
    assert.deepStrictEqual(q.errs, []);
    q.close();
  }
});
