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
  assert.strictEqual(p.d.querySelector('[data-set-apply]:checked').value, 'auto', '取り込み方の既定 = すぐ');
  assert.strictEqual(p.d.querySelector('[data-set-notify]').value, 'off', '通知の既定 = しない');
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
  // 取り込み方 (見本は 5 分後) と通知の設定。取り込み待ちの試合は承認・止めるができる
  assert.strictEqual(p.d.querySelector('[data-set-apply]:checked').value, 'delay');
  assert.strictEqual(p.d.querySelectorAll('[data-set-apply]').length, 6);
  assert.strictEqual(p.d.querySelector('[data-set-notify]').value, 'action');
  assert.ok(p.d.getElementById('rp-push-on'), 'この端末で通知を受け取る');
  const pend = () => p.d.querySelector('.rp-adm-row[data-set="106"]');
  assert.match(pend().querySelector('.rp-tag').textContent, /取り込み待ち/);
  assert.match(pend().querySelector('.rp-adm-note').textContent, /5 分後/);
  assert.match(pend().querySelector('[data-adopt]').textContent, /で承認/);
  pend().querySelector('[data-hold]').click();
  assert.ok(await until(() => pend() && pend().classList.contains('rp-state-review'), 3000), '止めた');
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
    ov.querySelector('[data-win-share]').click();
    assert.ok(await until(() => opened, 1500), '投稿画面を開く');
    const text = decodeURIComponent((/[?&]text=([^&]*)/.exec(opened) || [])[1] || '');
    assert.ok(/^https:\/\/x\.com\/intent\/tweet\?/.test(opened), opened);
    assert.match(text, /^(\S+で )?\S* ?.+ に 2-1 で勝利！ \(UF \+\d+\)\n\S.* Winners Final\n勝者側Top 32進出$/);
    assert.ok(!/Pools|B3|\/ /.test(text), 'プール・フェーズ・イベント名は入れない: ' + text);
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

test('勝利画面の共有: 画面を撮らずに Canvas で 1200×675 を描く (どの案でも同じ画像)。PC はコピー/保存してから X、スマホは共有シート', { skip }, async () => {
  // カードの案でもカードは撮らない (撮らずに描けるので jsdom でも最後まで通る)
  for (const win of ['card']) {
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
    // PC でコピーできないブラウザ: 画像を保存してから X の投稿画面
    let downloaded = '', opened0 = '';
    p.w.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
    p.w.open = (u) => { opened0 = String(u); return null; };
    ov.querySelector('[data-win-share]').click();
    assert.ok(await until(() => opened0, 3000), '投稿画面を開く');
    assert.match(downloaded, /^SPSP_win_.+_vs_.+\.png$/);
    assert.match(ov.querySelector('.rp-win-note').textContent, /保存/);
    assert.strictEqual(ov.querySelectorAll('.rp-win-actions button').length, 2, '共有と閉じるだけ');
    assert.deepStrictEqual(calls.find((c) => c[0] === 'toBlob'), ['toBlob', 1200, 675]);
    const texts = calls.filter((c) => c[0] === 'fillText').map((c) => String(c[1]));
    for (const t of ['WIN', 'spsp.games', '勝者側Top 32進出']) assert.ok(texts.some((x) => x.includes(t)), t + ' を描く: ' + texts.slice(0, 12).join(' / '));
    assert.deepStrictEqual(p.errs, []);
    // X に投稿 (PC): 画像をクリップボードに入れてから投稿画面
    let opened = '', clip = null;
    p.w.open = (u) => { opened = String(u); return null; };
    p.w.ClipboardItem = function (items) { this.items = items; };
    Object.defineProperty(p.w.navigator, 'clipboard', { configurable: true, value: { write: async (list) => { clip = await list[0].items['image/png']; } } });
    ov.querySelector('[data-win-share]').click();
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
    q.d.querySelector('[data-win-share]').click();
    assert.ok(await until(() => shared, 3000), '共有シート');
    assert.match(shared.files[0].name, /^SPSP_win_.+\.png$/);
    assert.match(shared.text, /勝利！[\s\S]*勝者側Top 32進出/);
    assert.strictEqual(opened, '', 'スマホは投稿画面を別に開かない');
    assert.deepStrictEqual(q.errs, []);
    q.close();
  }
});

test('報告管理者: 運営の画面で名前・discriminator から探して足す・外す。報告管理者の画面は結果の管理だけ', { skip }, async () => {
  const rows = [[7001, 'TeamX | Alpha', 1, 1, 1, 3, 0, 0, 1271, null, 0, 0], [7002, 'Beta', 2, 2, 2, 3, 0, 0, 1272, null, 0, 0]];
  const index = { format: 1, columns: ['uid', 'name', 'ens', 'tjpr', 'bt', 'lv', 'prov', 'ovs', 'char', 'pref', 'last', 'b'], rows };
  const json = (u) => (/players_index\.json$/.test(u) ? index : /discriminators\.json$/.test(u) ? { 7001: 'a1b2c3d4', 7002: 'e5f6a7b8' } : null);
  const p = await open('?demo=admin', { json });
  assert.ok(await until(() => p.d.getElementById('rp-mgr-q')), '報告管理者の欄');
  const q = p.d.getElementById('rp-mgr-q'); const sug = p.d.getElementById('rp-mgr-sug');
  const type = (v) => { q.value = v; q.dispatchEvent(new p.w.Event('input')); };
  // 名前で探す (チーム名は外す)
  type('alp');
  assert.ok(await until(() => !sug.hidden && sug.querySelector('[data-uid="7001"]')), '候補');
  assert.match(sug.textContent, /Alpha.*a1b2c3d4/);
  assert.ok(!/TeamX/.test(sug.textContent));
  sug.querySelector('[data-uid="7001"]').dispatchEvent(new p.w.MouseEvent('mousedown', { bubbles: true }));
  // 確認してから足す (既定 = 報告の管理のみ)
  const cf = p.d.getElementById('rp-mgr-confirm');
  assert.ok(await until(() => !cf.hidden), '確認');
  assert.match(cf.textContent, /Alpha \(a1b2c3d4\) を「報告の管理のみ」として追加しますか/);
  cf.querySelector('[data-mgr-ok]').click();
  assert.ok(await until(() => /Alpha/.test(p.d.getElementById('rp-mgr-list').textContent)), '足した');
  assert.match(p.d.getElementById('rp-mgr-list').textContent, /報告の管理のみ/);
  // discriminator で探す (SPSP の選手)
  type('E5F6A7B8');
  assert.ok(await until(() => !sug.hidden && sug.querySelector('[data-uid="7002"]')));
  assert.strictEqual(sug.querySelector('[data-disc]'), null, 'SPSP にいる人は discriminator の追加を出さない');
  // SPSP にデータの無い人は discriminator で
  type('https://www.start.gg/user/0badc0de');
  assert.ok(await until(() => !sug.hidden && sug.querySelector('[data-disc="0badc0de"]')));
  // 「確認」ボタン → 名前を見て承認。報告と設定の管理を選ぶ
  p.d.querySelector('input[name="rp-mgr-role"][value="full"]').checked = true;
  p.d.getElementById('rp-mgr-check').click();
  assert.ok(await until(() => !cf.hidden && /0badc0de/.test(cf.textContent)));
  assert.match(cf.textContent, /報告と設定の管理/);
  cf.querySelector('[data-mgr-ok]').click();
  assert.ok(await until(() => /0badc0de/.test(p.d.getElementById('rp-mgr-list').textContent)), 'ボタンで足す');
  // やめる
  type('alp');
  await until(() => !sug.hidden);
  q.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Enter' }));
  await until(() => !cf.hidden);
  cf.querySelector('[data-mgr-cancel]').click();
  assert.ok(cf.hidden);
  // 候補も discriminator も無い
  type('zzzz');
  p.d.getElementById('rp-mgr-check').click();
  assert.ok(await until(() => /discriminator/.test(p.d.getElementById('rp-mgr-status').textContent)));
  // 外す
  p.w.confirm = () => true;
  p.d.querySelector('[data-mgr-rm="7001"]').click();
  assert.ok(await until(() => !/Alpha/.test(p.d.getElementById('rp-mgr-list').textContent)), '外した');
  assert.deepStrictEqual(p.errs, []);
  p.close();
  // 報告管理者の画面: 設定・停止・報告管理者の欄は無く、試合の一覧と通知だけ
  const m = await open('?demo=admin&role=manager');
  assert.ok(await until(() => m.d.querySelector('.rp-adm-row')), '試合の一覧');
  assert.strictEqual(m.d.getElementById('rp-save-set'), null);
  assert.strictEqual(m.d.getElementById('rp-stop'), null);
  assert.strictEqual(m.d.getElementById('rp-mgr-q'), null);
  assert.ok(m.d.getElementById('rp-push-on'));
  assert.match(m.d.getElementById('rp-admin').textContent, /報告管理者です/);
  assert.deepStrictEqual(m.errs, []);
  m.close();
});

test('運営の画面: 管理者の追加・通知の説明は「?」を押したときだけ出る。受付の期限に注記は付けない', { skip }, async () => {
  const p = await open('?demo=admin');
  assert.ok(await until(() => p.d.querySelectorAll('.rp-help').length >= 2));
  for (const b of p.d.querySelectorAll('.rp-help')) {
    const t = b.parentElement.nextElementSibling;
    assert.ok(t.hidden, '最初は出さない');
    b.click();
    assert.ok(!t.hidden && b.getAttribute('aria-expanded') === 'true', '押すと出る');
    b.click();
    assert.ok(t.hidden, 'もう一度押すと隠す');
  }
  assert.ok([...p.d.querySelectorAll('#rp-admin p')].some((e) => /^受付の期限: [^(]+$/.test(e.textContent.trim())), '期限だけ');
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('ホーム画面に追加: iPhone・iPad の Safari は手順 (通知はホーム画面からだけ)、Android は追加のボタン。ホーム画面から開いたときは出さない。3 分後に取り込むもある', { skip }, async () => {
  for (const [ua, standalone, want] of [['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', false, true],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', true, false],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile', false, false]]) {
    const p = await open('?demo=admin', { before: (w) => {
      Object.defineProperty(w.navigator, 'userAgent', { value: ua, configurable: true });
      Object.defineProperty(w.navigator, 'standalone', { value: standalone, configurable: true });
    } });
    assert.ok(await until(() => p.d.getElementById('rp-push-a2hs')));
    const a = p.d.getElementById('rp-push-a2hs');
    assert.strictEqual(!a.hidden, want, ua + ' standalone=' + standalone);
    if (want) {
      assert.ok(p.d.getElementById('rp-push-on').hidden, '通知のボタンは隠す');
      a.click();
      assert.ok(!p.d.getElementById('rp-a2hs').hidden, '手順が出る');
      assert.match(p.d.getElementById('rp-a2hs').textContent, /ホーム画面に追加/);
    }
    if (ua.includes('Android')) assert.ok(p.d.querySelector('[data-set-apply][value="delay3"]'), '3 分後に取り込む');
    // Android: ホーム画面に追加 (Chrome は確認の画面、来ていなければ手順)。iOS では出さない
    const inst = p.d.getElementById('rp-push-install');
    assert.strictEqual(!inst.hidden, ua.includes('Android'));
    if (ua.includes('Android')) {
      inst.click();
      assert.ok(!p.d.getElementById('rp-a2hs-android').hidden, '確認が来ていなければ手順');
      let prompted = 0;
      const ev = new p.w.Event('beforeinstallprompt');
      ev.prompt = async () => { prompted++; };
      ev.userChoice = Promise.resolve({ outcome: 'accepted' });
      p.w.dispatchEvent(ev);
      inst.click();
      assert.ok(await until(() => prompted === 1 && inst.hidden), 'Chrome の確認を出して、追加したらボタンを消す');
    }
    assert.deepStrictEqual(p.errs, []);
    p.close();
  }
  assert.ok(fs.readFileSync(path.join(ROOT, 'site/report/index.html'), 'utf8').includes('rel="manifest"'));
  const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/report/manifest.json'), 'utf8'));
  assert.strictEqual(mf.display, 'standalone');
  assert.strictEqual(mf.start_url, undefined, '追加したときのページ (受付の URL) で開く');
  assert.strictEqual(mf.name, 'SPSP');
  for (const ic of mf.icons) assert.ok(fs.existsSync(path.join(ROOT, 'site/report', ic.src)), ic.src);
});

test('何先: 既定は「設定しない」、start.gg の設定は読めたときだけ一番下 (選ぶとその何本勝負で受付を始める)', { skip }, async () => {
  const p = await open('?demo=setup');
  assert.ok(await until(() => p.d.querySelector('input[name="rp-ev"]:not([disabled])')));
  const r = p.d.querySelector('input[name="rp-ev"]:not([disabled])');
  r.checked = true; r.dispatchEvent(new p.w.Event('change', { bubbles: true }));
  assert.ok(await until(() => p.d.querySelectorAll('#rp-ft-set [data-ft-mode]').length === 2), 'フェーズごと');
  const [pools, top] = [...p.d.querySelectorAll('#rp-ft-set [data-ft-mode]')];
  for (const sel of [pools, top]) {
    assert.strictEqual(sel.value, '', '既定 = 設定しない');
    assert.strictEqual(sel.options[0].textContent, '設定しない');
  }
  // 見本の Pools は start.gg で全部 3 本勝負 → 一番下に「start.gg の設定どおり (勝者側 2 先 · 敗者側 2 先)」
  assert.strictEqual(pools.options[pools.options.length - 1].value, 'sgg');
  assert.match(pools.options[pools.options.length - 1].textContent, /start\.gg の設定どおり \(.*2 先/);
  pools.value = 'sgg';
  // 受付を始めるときに送る何先 (見本は送らずに止まるので、送る中身を api の手前で見る)
  assert.ok(top.options[top.options.length - 1].value === 'sgg', 'Top 32 も読める');
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('選手が報告できる範囲 (トップ N): 参加人数より小さいものだけ選べて、人数を出す', { skip }, async () => {
  // 運営の画面 (見本は 128 人)
  const p = await open('?demo=admin');
  assert.ok(await until(() => { const n = p.d.querySelector('[data-set-top-note]'); return n && !n.hidden; }), '人数が出る');
  const vals = () => [...p.d.querySelectorAll('[data-set-top] option')].map((o) => o.value).filter(Boolean).map(Number);
  assert.match(p.d.querySelector('[data-set-top-note]').textContent, /参加 128 人/);
  assert.strictEqual(Math.max(...vals()), 96);
  p.close();
  // 受付を始める画面: 一覧の人数 (Crew Battle 16 人は受付中なので、Singles 128 人。開催中の 1 つは最初から選ばれている)
  const s = await open('?demo=setup');
  assert.ok(await until(() => s.d.querySelector('input[name="rp-ev"]:not([disabled])')));
  const r = s.d.querySelector('input[name="rp-ev"]:not([disabled])');
  r.checked = true; r.dispatchEvent(new s.w.Event('change', { bubbles: true }));
  assert.ok(await until(() => { const n = s.d.querySelector('[data-set-top-note]'); return n && !n.hidden; }));
  assert.strictEqual(Math.max(...[...s.d.querySelectorAll('[data-set-top] option')].map((o) => Number(o.value) || 0)), 96);
  assert.deepStrictEqual(s.errs, []);
  s.close();
});

// ── start.gg に繋がらないとき (docs/self_report_design.md §11) ──
test('見本 outage (選手): 障害の帯・運営が指定した試合が今の試合・SPSP に保存した試合は終わった試合に「未反映」', { skip }, async () => {
  const p = await open('?demo=outage&anim=dark');
  assert.ok(await until(() => p.d.querySelector('.rp-current')), '今の試合');
  const ov = p.d.querySelector('.rp-match-ov');
  if (ov) ov.click();
  await sleep(100);
  const banner = p.d.querySelector('.rp-outage');
  assert.ok(banner, '障害の帯');
  assert.match(banner.textContent, /start\.gg に接続できません \(\d\d:\d\d から\)/);
  assert.match(banner.textContent, /未反映の試合: 1 件/);
  assert.match(banner.textContent, /時点のもの/);
  const cur = p.d.querySelector('.rp-current');
  assert.match(cur.querySelector('.rp-round').textContent, /Pools B3 · 敗者側/);
  assert.ok(!cur.querySelector('.rp-manual-note'), '指定した試合の説明文は出さない (2026-11-04)');
  assert.ok(cur.querySelector('form.rp-form[data-set="m1"]'), '指定した試合に報告できる');
  const done = [...p.d.querySelectorAll('.rp-done li')].map((li) => li.textContent);
  assert.ok(done.some((t) => /Winners Round 2/.test(t) && /未反映 \(SPSP に保存\)/.test(t)), done.join(' / '));
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('見本 admin_outage (運営): 障害の帯 → 次の試合を指定 (勝者側 = 負けていない人 / 敗者側 = 敗者側で負けていない人、名前で絞る) → 一覧に出る・取り消せる', { skip }, async () => {
  const p = await open('?demo=admin_outage');
  assert.ok(await until(() => p.d.querySelector('#rp-adm-manual .rp-outage')), '障害の帯');
  const sec = p.d.getElementById('rp-adm-manual');
  assert.match(sec.querySelector('.rp-outage').textContent, /未反映 2 件/);
  const det = sec.querySelector('details.rp-manual');
  assert.ok(det.open, '障害中は開いている');
  assert.ok(await until(() => sec.querySelector('[data-mq="0"]')), '入力欄');
  assert.match(p.d.querySelector('.rp-adm-row[data-set="101"] .rp-tag').textContent, /未反映/);
  const names = (k) => [...sec.querySelectorAll(`[data-mcands="${k}"] [data-mpick] b`)].map((b) => b.textContent);
  const P = names(0);
  // 勝者側: 負けていない人だけ (見本の 0・3・5)
  assert.strictEqual(P.length, 3, P.join(','));
  // 敗者側: 敗者側で負けた人 (4・7) は出ない。勝者側の負け (start.gg・未反映) の人が先、負けの記録が無い人も出る
  sec.querySelector('input[name="rp-mside"][value="l"]').click();
  sec.querySelector('input[name="rp-mside"][value="l"]').dispatchEvent(new p.w.Event('change'));
  await sleep(20);
  const L = [...sec.querySelectorAll('[data-mcands="0"] [data-mpick]')];
  assert.strictEqual(L.length, 6, L.map((b) => b.textContent).join(','));
  assert.match(L[0].textContent, /勝者側で負け/);
  assert.ok(L.some((b) => /負けの記録なし/.test(b.textContent)));
  // 名前で絞る
  const first = L[0].querySelector('b').textContent;
  const inp = sec.querySelector('[data-mq="0"]');
  inp.value = first.slice(0, 2);
  inp.dispatchEvent(new p.w.Event('input'));
  assert.ok(names(0).every((n) => n.includes(first.slice(0, 2)) || n.toLowerCase().includes(first.slice(0, 2).toLowerCase())));
  sec.querySelector('[data-mcands="0"] [data-mpick]').click();
  await sleep(10);
  assert.ok(sec.querySelector('.rp-mchosen'), '1 人目を選んだ');
  assert.ok(!names(1).includes(first), '同じ人は 2 人目に出ない');
  sec.querySelector('[data-mcands="1"] [data-mpick]').click();
  await sleep(10);
  const create = sec.querySelector('[data-mcreate]');
  assert.ok(!create.disabled);
  p.w.confirm = () => true;
  create.click();
  assert.ok(await until(() => sec.querySelector('[data-mlist] .rp-mitem')), '一覧に出る');
  assert.ok(await until(() => sec.querySelectorAll('.rp-mchosen').length === 0), '入力は空に戻る');
  assert.match(sec.querySelector('[data-mlist] .rp-mitem').textContent, /敗者側/);
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('見本 rr (総当たり): 開いている試合が複数なら相手を選ぶ画面 (相手も選んでいる人が先・ほかの人と対戦中は後)。選ぶと今の試合・相手を変えられる', { skip }, async () => {
  const p = await open('?demo=rr&anim=dark');
  assert.ok(await until(() => p.d.querySelector('.rp-rr')), '相手を選ぶ画面');
  assert.ok(!p.d.querySelector('.rp-current'), '選ぶまでは入力欄を出さない');
  const items = [...p.d.querySelectorAll('[data-rr-pick]')];
  assert.strictEqual(items.length, 4);
  assert.match(items[0].textContent, /相手もあなたを選んでいます/);
  assert.match(items[1].textContent, /start\.gg で開始済み/);
  assert.match(items[items.length - 1].textContent, /ほかの人と対戦中/);
  items[2].click();
  assert.ok(await until(() => p.d.querySelector('.rp-current')), '選んだ試合が今の試合');
  const ov = p.d.querySelector('.rp-match-ov');
  if (ov) ov.click();
  await sleep(50);
  assert.match(p.d.querySelector('.rp-rr-cur').textContent, /ほかに 3 人/);
  assert.ok(p.d.querySelector('.rp-current form.rp-form'));
  p.d.querySelector('[data-rr-change]').click();
  assert.ok(await until(() => p.d.querySelector('.rp-rr') && !p.d.querySelector('.rp-current')), '相手を変える');
  assert.ok(p.d.getElementById('rp-player-push'), '選手の通知の欄');
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('見本 admin_outage: 写しの様子・指定した試合に運営が結果を入れる・未反映の書き出し・総当たりのブロック', { skip }, async () => {
  const p = await open('?demo=admin_outage');
  assert.ok(await until(() => p.d.querySelector('#rp-adm-manual [data-mq="0"]')));
  const sec = p.d.getElementById('rp-adm-manual');
  assert.match(sec.querySelector('[data-msnap]').textContent, /ブラケットの写し: 31 試合/);
  p.w.confirm = () => true;
  // 指定 → 一覧の「結果を入力」→ 送る
  sec.querySelector('[data-mcands="0"] [data-mpick]').click();
  await sleep(10);
  sec.querySelector('[data-mcands="1"] [data-mpick]').click();
  await sleep(10);
  sec.querySelector('[data-mcreate]').click();
  assert.ok(await until(() => sec.querySelector('[data-mfix]')), '結果を入力のボタン');
  sec.querySelector('[data-mfix]').click();
  assert.ok(await until(() => sec.querySelector('[data-mfixbox] form.rp-form')), '入力欄');
  const form = sec.querySelector('[data-mfixbox] form.rp-form');
  const score = form.querySelector('[data-sum-score="0"]') || form.querySelector('select, input[type="number"]');
  assert.ok(score, 'スコアの入力');
  // 書き出し
  sec.querySelector('[data-mexport-btn]').click();
  assert.ok(await until(() => sec.querySelector('.rp-mexport-text')));
  const text = sec.querySelector('.rp-mexport-text').value;
  assert.match(text, /Pools B3 Winners Round 2: .+ 2-0 .+ \(start\.gg #101\)/);
  assert.match(text, /結果未定/);
  // 総当たりのブロック: 勝者側 / 敗者側ではなく総当たり、もう当たった人は 2 人目に出ない
  const sel = sec.querySelector('[data-mgroup]');
  sel.value = '902'; sel.dispatchEvent(new p.w.Event('change'));
  await sleep(20);
  assert.ok(!sec.querySelector('input[name="rp-mside"]'), '勝者側 / 敗者側は出さない');
  assert.match(sec.querySelector('.rp-mhelp').textContent, /総当たり/);
  const first = [...sec.querySelectorAll('[data-mcands="0"] [data-mpick]')].find((b) => b.getAttribute('data-eid') === 'e8');
  first.click();
  await sleep(10);
  const second = [...sec.querySelectorAll('[data-mcands="1"] [data-mpick]')].map((b) => b.getAttribute('data-eid'));
  assert.deepStrictEqual(second, ['e10', 'e11'], 'e9 とはもう当たった');
  [...sec.querySelectorAll('[data-mcands="1"] [data-mpick]')][0].click();
  await sleep(10);
  assert.match(sec.querySelector('[data-mform] .rp-note').textContent, /start\.gg/, 'start.gg に試合がある組');
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

// ── 対戦開始・対戦相手が見つからない・DQ (docs §12) ──
test('見本 noshow (選手): 相手が探している帯・対戦開始で開始の表示に・見つからないを押すと「伝えました (n 回目)」', { skip }, async () => {
  const p = await open('?demo=noshow&anim=dark');
  assert.ok(await until(() => p.d.querySelector('.rp-current [data-start]')));
  const ov = p.d.querySelector('.rp-match-ov'); if (ov) ov.click();
  await sleep(50);
  assert.match(p.d.querySelector('.rp-ns-them').textContent, /あなたを探しています/);
  p.d.querySelector('[data-noshow]').click();
  assert.ok(await until(() => p.d.querySelector('.rp-ns-mine')));
  assert.match(p.d.querySelector('.rp-ns-mine').textContent, /1 回目/);
  assert.match(p.d.querySelector('[data-noshow]').textContent, /もう一度/);
  p.d.querySelector('[data-noshow]').click();
  assert.ok(await until(() => /2 回目/.test((p.d.querySelector('.rp-ns-mine') || {}).textContent || '')), '押し直しは回数だけ');
  p.d.querySelector('[data-start]').click();
  assert.ok(await until(() => p.d.querySelector('.rp-start-done')));
  assert.match(p.d.querySelector('.rp-start-done').textContent, /対戦開始 \d\d:\d\d \(自分が押しました\)/);
  assert.ok(!p.d.querySelector('[data-noshow]'), '開始したら見つからないは出さない');
  assert.ok(p.d.querySelector('.rp-current form.rp-form'), '入力欄はそのまま');
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('見本 admin (運営): 見つからないの一覧 (対戦開始にする・対応済み・相手を DQ)・参加者の試合から対戦開始と DQ・通知の設定', { skip }, async () => {
  const p = await open('?demo=admin');
  assert.ok(await until(() => p.d.querySelector('#rp-adm-ops [data-ops-noshow] li')));
  const sec = p.d.getElementById('rp-adm-ops');
  assert.match(sec.querySelector('h2').textContent, /対戦相手が見つからない \(1 件\)/);
  assert.match(sec.querySelector('li').textContent, /\(3 回\)/);
  assert.ok(p.d.querySelector('[data-set-noshow]').checked, '見つからないの通知は既定で on');
  p.w.confirm = () => true;
  sec.querySelector('[data-ops-nsdq]').click();
  assert.ok(await until(() => sec.querySelector('[data-ops-dqs] li')), 'DQ の一覧');
  assert.match(sec.querySelector('[data-ops-dqs] li').textContent, /勝者側のみ/);
  assert.match(sec.querySelector('[data-ops-noshow] h2').textContent, /\(0 件\)/, 'DQ で解決');
  const lines = [...sec.querySelectorAll('[data-ops-noshow] li b')].map((b) => b.textContent);
  assert.ok(lines.some((t) => /を探していましたが、.+ を DQ にしました$/.test(t)), lines.join(' / '));
  assert.ok(lines.some((t) => /を探していましたが、対戦開始しました$/.test(t)), lines.join(' / '));
  // 参加者を選んで対戦開始・DQ (両方)
  const q = sec.querySelector('[data-ops-q]');
  q.dispatchEvent(new p.w.Event('focus'));
  assert.ok(await until(() => sec.querySelector('[data-ops-pick]')));
  sec.querySelector('[data-ops-pick]').click();
  assert.ok(await until(() => sec.querySelector('[data-ops-player] [data-ops-start]')));
  sec.querySelector('[data-ops-player] [data-ops-start]').click();
  assert.ok(await until(() => /対戦開始にしました/.test(sec.querySelector('[data-ops-status]').textContent)));
  sec.querySelector('[data-ops-dq="a"]').click();
  assert.ok(await until(() => [...sec.querySelectorAll('[data-ops-dqs] li')].some((li) => /両方/.test(li.textContent))));
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('運営の画面の「start.gg に未反映」: 障害中の見本は結果・指定した試合・DQ・対戦開始を理由つきで', { skip }, async () => {
  const p = await open('?demo=admin_outage');
  assert.ok(await until(() => p.d.querySelector('#rp-adm-unsynced li')));
  const sec = p.d.getElementById('rp-adm-unsynced');
  assert.match(sec.querySelector('h2').textContent, /start\.gg に未反映 \(5 件\)/);
  const t = [...sec.querySelectorAll('li')].map((li) => li.textContent.replace(/\s+/g, ' '));
  assert.match(t[0], /結果: .+ vs .+ #101 · start\.gg に接続できず未送信/);
  assert.match(t[1], /両者の報告が食い違っているので送っていません/);
  assert.match(t[2], /指定した試合: .+ \(敗者側\) · start\.gg にこの試合がまだありません/);
  assert.match(t[3], /DQ: .+ \(敗者側のみ\) · 次の試合が決まったら DQ にします/);
  assert.match(t[4], /対戦開始: .+ #104 · start\.gg の試合を試合中にできていません/);
  await sleep(300);   // 裏の読み込み (候補など) が終わってから閉じる
  assert.deepStrictEqual(p.errs, []);
  p.close();
});

test('運営の画面の「start.gg に未反映」: ふだんの見本は「ありません」の 1 行', { skip }, async () => {
  const p = await open('?demo=admin');
  assert.ok(await until(() => p.d.querySelector('#rp-adm-unsynced p')));
  assert.match(p.d.getElementById('rp-adm-unsynced').textContent, /start\.gg に未反映のものはありません/);
  await sleep(300);
  assert.deepStrictEqual(p.errs, []);
  p.close();
});
