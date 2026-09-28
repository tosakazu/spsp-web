'use strict';
// シード生成ページのヘルプアイコン (?)。
// 各オプション / ボタンの意味を、マウスオーバーでもタップでも読めるようにしたもの。
// title 属性はホバーでしか出ずスマホで読めないため、独自ポップに置き換えている。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }

const SRC = require('./helpers/seed_app_src.cjs').SRC;   // seeding/app/*.js を並び順に連結 (旧 seed_app.js)
const CSS = fs.readFileSync(path.resolve(__dirname, '../../site/seeding/seed_app.css'), 'utf8');

/** ヘルプ関係のソースだけを取り出して jsdom で動かす (seed_app.js 全体は fetch 等に依存するため)。 */
function mount(bodyHtml) {
  // 実 CSS も入れる: hidden 属性が効くかは display 指定との勝ち負けで決まるので、
  // プロパティ (ico.hidden) だけ見ていると「? が消えない」バグを取り逃す。
  const dom = new JSDOM(
    '<!DOCTYPE html><head><style>' + CSS + '</style></head><body>' + bodyHtml + '</body>',
    { runScripts: 'outside-only' });
  const win = dom.window;
  const start = SRC.indexOf('const HELP_TEXT');
  assert.ok(start > 0, 'HELP_TEXT が見つからない');
  const end = SRC.indexOf("injectHelpIcons(document.getElementById('seed-app-root'));");
  assert.ok(end > start, '呼び出し行が見つからない');
  // 文言辞書 (HELP_TEXT の一部は i18n('seed.help.sN') で辞書から引く)
  for (const f of ['region/config.js', 'i18n/ja.js', 'region/i18n.js', 'js/i18n.js', 'js/html.js', 'seeding/seed_data.js']) win.eval(require('../helpers/built.cjs').built(f));
  win.eval('var i18n = SPSPI18n.t; var escapeHtml = SPSPHtml.escapeHtml;');
  // 地域まとめのトグルは設定 (region/config.js) から生成する (10_skeleton.js の regionGroupToggles) ので、その関数も持ち込んで展開する
  const rg0 = SRC.indexOf('function regionGroupToggleId'), rg1 = SRC.indexOf('\n}\n', SRC.indexOf('function regionGroupToggles')) + 3;
  assert.ok(rg0 > 0 && rg1 > rg0, 'regionGroupToggles が見つからない');
  win.eval(SRC.slice(rg0, rg1));
  if (bodyHtml.includes('${regionGroupToggles()}')) win.document.body.innerHTML = bodyHtml.replace('${regionGroupToggles()}', win.eval('regionGroupToggles()'));
  win.eval(SRC.slice(start, end));
  win.eval('injectHelpIcons(document.body);');
  return win;
}

test('主要ボタン / チェックボックスに ? が付く', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount(`
    <button id="fetch-btn">参加者を取得</button>
    <button id="upload-btn">start.gg にシード適用</button>
    <button id="bracket-preview">プレビュー</button>
    <label title="地域被りを分散する"><input type="checkbox" id="so-avoid-region"> 地域被りを考慮</label>
  `);
  const d = win.document;
  for (const id of ['fetch-btn', 'upload-btn', 'bracket-preview']) {
    const ico = d.querySelector('#' + id).nextElementSibling;
    assert.ok(ico && ico.classList.contains('help-ico'), id + ' に ? が無い');
    assert.ok(ico.dataset.help.length > 5, id + ' の説明が空');
  }
  // チェックボックスは囲っている label の末尾に付く (入力の直後ではない)
  const label = d.querySelector('#so-avoid-region').closest('label');
  assert.ok(label.lastElementChild.classList.contains('help-ico'));
});

test('説明が無い要素にはアイコンを付けない', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount('<select id="so-mode"></select><div><button id="so-mode-x">なにか</button></div>');
  // so-mode は HELP_TEXT にあるので付く
  assert.ok(win.document.querySelector('#so-mode').nextElementSibling.classList.contains('help-ico'));
  // 対象リストに無い id には付かない (title も HELP_TEXT も無いので何も足さない)
  assert.strictEqual(win.document.querySelector('#so-mode-x').nextElementSibling, null);
  assert.strictEqual(win.document.querySelectorAll('.help-ico').length, 1);
});

test('既存の title を説明として引き継ぎ、title 自体は消す (ツールチップ二重表示を防ぐ)',
  { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
    const win = mount('<label title="既存の説明文です"><input type="checkbox" id="so-keep-deplace"> 順位固定</label>');
    const label = win.document.querySelector('#so-keep-deplace').closest('label');
    assert.strictEqual(label.getAttribute('title'), null, 'title が残っている');
    assert.strictEqual(label.querySelector('.help-ico').dataset.help, '既存の説明文です');
  });

test('HELP_TEXT が既存 title より優先される', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount('<button id="upload-btn" title="みじかい説明">適用</button>');
  const help = win.document.querySelector('.help-ico').dataset.help;
  assert.notStrictEqual(help, 'みじかい説明');
  assert.match(help, /start\.gg/);
});

test('クリックで説明が出て、もう一度押すと閉じる', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount('<button id="fetch-btn">取得</button>');
  const d = win.document;
  const ico = d.querySelector('.help-ico');
  assert.strictEqual(d.querySelector('.help-pop'), null, '開く前からポップがある');
  ico.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const pop = d.querySelector('.help-pop');
  assert.ok(pop && !pop.hidden, '開かない');
  assert.match(pop.textContent, /参加者/);
  assert.strictEqual(ico.getAttribute('aria-expanded'), 'true');
  ico.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.ok(pop.hidden, '閉じない');
  assert.strictEqual(ico.getAttribute('aria-expanded'), 'false');
});

test('label 内の ? を押してもチェックボックスが切り替わらない',
  { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
    const win = mount('<label title="説明"><input type="checkbox" id="so-avoid-recent" checked> 直接対戦</label>');
    const d = win.document;
    const cb = d.querySelector('#so-avoid-recent');
    // jsdom は label 内クリックの暗黙の activation を行うので、preventDefault が効くかを見る
    const before = cb.checked;
    d.querySelector('.help-ico').dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.strictEqual(cb.checked, before, 'チェックが変わってしまった');
  });

test('ホバーで出て、離すと閉じる (クリックで開いたものは離しても閉じない)',
  { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
    const win = mount('<button id="fetch-btn">取得</button>');
    const d = win.document;
    const ico = d.querySelector('.help-ico');
    ico.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
    assert.ok(!d.querySelector('.help-pop').hidden, 'ホバーで出ない');
    ico.dispatchEvent(new win.MouseEvent('mouseout', { bubbles: true }));
    assert.ok(d.querySelector('.help-pop').hidden, 'ホバーを外しても閉じない');

    ico.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    ico.dispatchEvent(new win.MouseEvent('mouseout', { bubbles: true }));
    assert.ok(!d.querySelector('.help-pop').hidden, 'クリックで開いたのにホバー離脱で閉じた');
  });

test('Escape と外側クリックで閉じる', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount('<button id="fetch-btn">取得</button><div id="elsewhere">x</div>');
  const d = win.document;
  const ico = d.querySelector('.help-ico');
  ico.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  d.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(d.querySelector('.help-pop').hidden, 'Escape で閉じない');

  ico.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  d.querySelector('#elsewhere').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  assert.ok(d.querySelector('.help-pop').hidden, '外側クリックで閉じない');
});

test('start.gg 適用の説明に警告が入っている (押すと本番が書き換わるため)',
  { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
    const win = mount('<button id="upload-btn">適用</button>');
    assert.match(win.document.querySelector('.help-ico').dataset.help, /⚠️|本番/);
  });

test('CSS に help-ico / help-pop がある', () => {
  assert.match(CSS, /\.help-ico\s*\{/);
  assert.match(CSS, /\.help-pop\s*\{/);
  // ポップは fixed でないと、スクロール領域内で見切れる
  assert.match(CSS, /\.help-pop\s*\{[^}]*position:\s*fixed/);
});

test('HELP_TARGETS の id は実ソースに存在する (typo で無言に効かなくなるのを防ぐ)', () => {
  const m = SRC.match(/const HELP_TARGETS = \[([\s\S]*?)\];/);
  assert.ok(m, 'HELP_TARGETS が無い');
  const ids = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.ok(ids.length >= 20, '対象が少なすぎる: ' + ids.length);
  for (const id of ids) {
    assert.ok(SRC.includes('id="' + id + '"'), 'この id は HTML に無い: ' + id);
  }
});

test('ラベル文字の直後に置く (入力が display:block でも下に落ちない)',
  { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
    const win = mount('<label>プール数<input type="number" id="so-pools" style="display:block"></label>');
    const label = win.document.querySelector('label');
    const kids = [...label.childNodes];
    const icoIdx = kids.findIndex((n) => n.classList && n.classList.contains('help-ico'));
    const inpIdx = kids.findIndex((n) => n.id === 'so-pools');
    assert.ok(icoIdx >= 0 && inpIdx >= 0);
    assert.ok(icoIdx < inpIdx, '? が入力より後ろにある (= 下の行に落ちる)');
  });

test('チェックボックスはラベル末尾のまま', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount('<label title="説明"><input type="checkbox" id="so-avoid-region"> 地域被りを考慮</label>');
  const label = win.document.querySelector('label');
  assert.ok(label.lastElementChild.classList.contains('help-ico'));
});

test('外付け <label for> があればそちらの末尾に付く', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount('<label for="event-url">大会イベント URL</label><input type="text" id="event-url">');
  const label = win.document.querySelector('label[for="event-url"]');
  assert.ok(label.lastElementChild && label.lastElementChild.classList.contains('help-ico'),
    'ラベル側に付いていない');
  assert.strictEqual(win.document.querySelector('#event-url').nextElementSibling, null);
});

test('対象が非表示なら ? も非表示', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  const win = mount('<button id="upload-btn" style="display:none">適用</button>');
  const ico = win.document.querySelector('.help-ico');
  assert.strictEqual(ico.hidden, true, '隠れているボタンの ? が出ている');
});

test('対象が表示されたら ? も出る / 隠れたら開いていた説明も閉じる',
  { skip: !JSDOM ? 'jsdom 未導入' : false }, async () => {
    const win = mount('<button id="csv-btn" style="display:none">CSV</button>');
    const d = win.document;
    const btn = d.querySelector('#csv-btn');
    const ico = d.querySelector('.help-ico');
    assert.strictEqual(ico.hidden, true);

    btn.style.display = '';
    await new Promise((r) => setTimeout(r, 0));   // MutationObserver は非同期
    assert.strictEqual(ico.hidden, false, '表示されたのに ? が隠れたまま');

    ico.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.ok(!d.querySelector('.help-pop').hidden);
    btn.style.display = 'none';
    await new Promise((r) => setTimeout(r, 0));
    assert.strictEqual(ico.hidden, true);
    assert.ok(d.querySelector('.help-pop').hidden, '対象が消えたのに説明が出たまま');
  });

test('「作業状況を保存」「トーナメントプレビュー」ボタンに絵文字を入れない', () => {
  const m1 = SRC.match(/id="spec-export"[^>]*>([^<]*)</);
  const m2 = SRC.match(/id="bracket-preview"[^>]*>([^<]*)</);
  assert.ok(m1 && m2);
  for (const label of [m1[1], m2[1]]) {
    assert.doesNotMatch(label, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, '絵文字が入っている: ' + label);
  }
});

// hidden 属性で消す要素に display を指定したら、[hidden] を打ち消し直さないと消えない
// (作者スタイルは UA の [hidden]{display:none} に勝つ)。実際にこれで
// 「対象ボタンが非表示なのに ? だけ残る」バグを出した。
//
// ⚠️ jsdom はこの取り違えを再現しない (UA の [hidden] を作者スタイルより優先してしまう)。
//    そのため getComputedStyle では検出できず、CSS ソースを直接検査している。
test('display を指定したクラスには [hidden] の打ち消しがある', () => {
  for (const sel of ['.help-ico', '.help-pop']) {
    const re = new RegExp('\\' + sel.slice(0) + '\\s*\\{[^}]*display\\s*:', '');
    if (!re.test(CSS)) continue;                       // display 未指定なら不要
    const esc = sel.replace('.', '\\.');
    assert.match(CSS, new RegExp(esc + '\\[hidden\\]\\s*\\{[^}]*display\\s*:\\s*none'),
      sel + ' に display 指定があるのに ' + sel + '[hidden] の打ち消しが無い');
  }
});

// 実パネルの markup をそのまま jsdom に流し、HELP_TARGETS の全 id に説明が付くか見る。
// title 属性の中に " を書いて属性が壊れる（説明が途中で切れる / 別の属性ができる）事故を
// ここで検出する。実際に so-decaypoints でやらかしたので回帰テストにしてある。
test('パネル実 markup: HELP_TARGETS 全部に説明が付き、説明文は簡潔', { skip: !JSDOM ? 'jsdom 未導入' : false }, () => {
  // innerHTML に入れているパネルのテンプレートリテラルを取り出す。
  const beg = SRC.indexOf('<!-- 🔀 被り回避最適化パネル -->');
  const end = SRC.indexOf('<!-- 📌 シード指定・固定パネル');
  assert.ok(beg > 0 && end > beg, 'パネル markup が見つからない');
  const win = mount(SRC.slice(beg, end));
  const d = win.document;
  const listSrc = SRC.slice(SRC.indexOf('const HELP_TARGETS'), SRC.indexOf('function injectHelpIcons'));
  const targets = (listSrc.match(/'[\w-]+'/g) || []).map((x) => x.slice(1, -1))
    .filter((id) => d.querySelector('#' + id));
  assert.ok(targets.length >= 12, '対象要素がほとんど見つからない (markup 抽出の失敗?)');
  for (const id of targets) {
    const host = d.querySelector('label[for="' + id + '"]')
      || d.querySelector('#' + id).closest('label') || d.querySelector('#' + id).parentNode;
    const ico = host.querySelector('.help-ico');
    assert.ok(ico, id + ' に ? が付いていない');
    const help = ico.dataset.help || '';
    assert.ok(help.length > 5, id + ' の説明が空か短すぎる');
    // 何の機能か / どういうときに使うか だけ。細かい挙動は書かない方針 (2026-08)。
    assert.ok(help.length <= 90, `${id} の説明が長すぎる (${help.length}字): ${help}`);
    // 属性が壊れていると説明が引用符の手前で切れる。
    assert.ok(!/^["']|["']$/.test(help), id + ' の説明が引用符で切れている');
  }
});
