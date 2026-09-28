'use strict';
// SPSP ロゴ (ヘッダー + 読み込み中オーバーレイ)。
// 同じ組み立て関数を使うので、ヘッダーとローダーで見た目がずれない。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* skip */ }

const SITE = path.resolve(__dirname, '../../site');
const read = (p) => require('../helpers/built.cjs').built(p);   // 共通モジュールは古典 script の形で (tests/helpers/built.cjs)
const SRC = read('logo.js');
const CSS = read('logo.css');
const NAV = require('../helpers/built.cjs').src('nav.js');   // 正規表現で見るので生のソース (nav.js は import があり built() だと整形される)
const { pageWithScript } = require('../helpers/pages.cjs');
const INDEX = pageWithScript('index.html');   // HTML + src/pages/index.js

/** CSS も入れて起こす (アニメーション前の見え方を computedStyle で見るため)。 */
function winWith(body) {
  const dom = new JSDOM('<!DOCTYPE html><head><style>' + CSS + '</style></head><body>'
    + (body || '') + '</body>', { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(read('i18n/ja.js')); dom.window.eval(read('js/i18n.js'));   // logo.js は文言 (logo.*) を辞書から引く
  dom.window.eval(SRC);
  return dom.window;
}

/** ロゴ 1 つを読み込み枠に入れた状態で返す。 */
function win() {
  const w = winWith('<div id="slot" class="empty-msg">読み込み中…</div>');
  w.SPSPLogo.autoInline();
  return w;
}

test('背面は 5 段の左揃えティア (上ほど短く・濃い)', { skip: !JSDOM }, () => {
  const w = win();
  const bars = [...w.document.querySelectorAll('#slot .spsp__tiers b')];
  assert.strictEqual(bars.length, 5, 'Lv1〜Lv5 の 5 段でない');
  const ws = bars.map((b) => parseFloat(b.style.getPropertyValue('--w')));
  const as = bars.map((b) => parseFloat(b.style.getPropertyValue('--a')));
  // DOM 順は上 (最上位) → 下。上ほど短く、上ほど濃い
  assert.deepStrictEqual(ws, [21, 41, 61, 80, 100]);
  for (let i = 1; i < ws.length; i++) {
    assert.ok(ws[i] > ws[i - 1], '下に行くほど長くなっていない');
    assert.ok(as[i] < as[i - 1], '下に行くほど薄くなっていない');
  }
  // 最上位だけアクセント色 (CSS の :first-child)
  assert.match(CSS, /\.spsp__tiers b:first-child \{ background: rgba\(var\(--spsp-tier1\)/);
});

test('ワードマークは左→右のワイプで出る', { skip: !JSDOM }, () => {
  const w = win();
  const word = w.document.querySelector('#slot .spsp__word');
  assert.strictEqual(word.textContent, 'SPSP');
  // 再生前は右端まで隠れている
  assert.strictEqual(w.getComputedStyle(word).clipPath, 'inset(0 100% 0 0)');
  assert.ok(w.document.querySelector('#slot .spsp__scan'), 'スキャン線が無い');
  assert.match(CSS, /@keyframes spsp-reveal/);
  assert.match(CSS, /@keyframes spsp-scan/);
});

test('正式名称は 2 行で、SPECIAL がアクセント色', { skip: !JSDOM }, () => {
  const w = win();
  const lines = [...w.document.querySelectorAll('#slot .spsp__line')];
  assert.deepStrictEqual(lines.map((l) => l.dataset.line), ['SAIKYO PLAYERS', 'SPECIAL']);
  assert.strictEqual(w.document.querySelector('#slot .spsp__line--accent').dataset.line, 'SPECIAL');
  // 1 文字ずつ包んで順に出す
  assert.strictEqual(lines[0].querySelectorAll('u').length, 'SAIKYO PLAYERS'.length);
  assert.strictEqual(w.getComputedStyle(lines[0].querySelector('u')).opacity, '0');
});

test('fit はワードマーク幅に字間を合わせる (2 行の端をそろえる)', { skip: !JSDOM }, () => {
  const w = win();
  const mark = w.document.querySelector('#slot .spsp');
  // jsdom はレイアウトを持たない (幅 0) ので、fit は何もせず落ちないこと
  assert.doesNotThrow(() => w.SPSPLogo.fit(mark));
  assert.match(SRC, /line\.style\.letterSpacing = ls \+ 'px'/);
  assert.match(SRC, /textIndent = \(ls \/ 2\)/, '行末の余白を戻していない (中央がずれる)');
});

test('ヘッダーは静止・正式名称なし', { skip: !JSDOM }, () => {
  const w = win();
  const slot = w.document.createElement('span');
  w.document.body.appendChild(slot);
  w.SPSPLogo.mountHeader(slot);
  assert.strictEqual(slot.className, 'spsp');
  assert.ok(!slot.classList.contains('is-anim'), 'ヘッダーでアニメーションしている');
  // 背面ティアはヘッダーにも出す (ロゴとして同じ形)
  assert.strictEqual(slot.querySelectorAll('.spsp__tiers b').length, 5);
  assert.strictEqual(slot.querySelector('.spsp__word').textContent, 'SPSP');
  // 幅を食うので正式名称は出さない
  assert.strictEqual(slot.querySelectorAll('.spsp__line').length, 0);
  // 静止形ではワイプもスキャンも効かない
  assert.strictEqual(w.getComputedStyle(slot.querySelector('.spsp__word')).clipPath, 'none');
});

test('「読み込み中…」の枠をロゴに差し替える (全画面は覆わない)', { skip: !JSDOM }, () => {
  const w = winWith(`
    <table><tbody id="tb"><tr><td colspan="7" class="empty-msg">データ読み込み中…</td></tr></tbody></table>
    <div id="loading" class="empty-msg">読み込み中…</div>
    <div class="empty-msg">該当なし</div>
    <div class="empty-msg" style="display:none">プレイヤーが見つかりません。</div>
    <div class="loading-msg">詳細情報を取得中…</div>`);
  w.SPSPLogo.autoInline();
  const d = w.document;
  assert.ok(d.querySelector('td .spsp'), '表の読み込み枠に入っていない');
  assert.ok(d.querySelector('#loading .spsp'), '本文の読み込み枠に入っていない');
  // 読み込み中でない枠 / 非表示の予備枠 / 小さな詳細ローダーには入れない
  assert.strictEqual(d.querySelectorAll('.spsp').length, 2);
  assert.ok(!d.querySelector('.loading-msg .spsp'), '小さすぎる枠に入れている');
  // 画面全体を覆わない
  assert.strictEqual(d.getElementById('spsp-loader'), null);
});

test('ロードが先に終わったら表示を優先する (最短表示時間を持たない)', { skip: !JSDOM }, () => {
  const w = winWith('<table><tbody id="tb"><tr><td class="empty-msg">読み込み中…</td></tr></tbody></table>');
  w.SPSPLogo.autoInline();
  assert.ok(w.document.querySelector('.spsp'));
  // ページ側がデータを描いたら、そのまま消える (後始末も待ちも要らない)
  w.document.getElementById('tb').innerHTML = '<tr><td>1</td></tr>';
  assert.strictEqual(w.document.querySelector('.spsp'), null, 'ロゴが残っている');
  // 表示を引き延ばす仕掛けを持たないこと
  assert.doesNotMatch(SRC, /MIN_MS/, '最短表示時間があるとデータ表示が遅れる');
});

test('二重に入れない', { skip: !JSDOM }, () => {
  const w = winWith('<div class="empty-msg">読み込み中…</div>');
  w.SPSPLogo.autoInline();
  w.SPSPLogo.autoInline();
  assert.strictEqual(w.document.querySelectorAll('.spsp').length, 1);
});

test('外部フォントを読み込まない (全ページの nav から読まれるため)', () => {
  for (const [name, src] of [['logo.js', SRC], ['logo.css', CSS]]) {
    assert.doesNotMatch(src, /fonts\.googleapis|fonts\.gstatic|@import/, name + ' が外部フォントを読んでいる');
  }
});

test('nav がブランド枠にロゴを入れ、失敗したら文字に落とす', () => {
  assert.match(NAV, /spsp-brand-mark/);
  assert.match(NAV, /SPSPLogo\.mountHeader\(slot\)/);
  assert.match(NAV, /slot\.textContent = 'SPSP'/, 'ロゴが読めないときの代替が無い');
});

test('差し替えは nav から一括で行う (各ページに書き足さない)', () => {
  assert.match(NAV, /SPSPLogo\.autoInline\(\)/);
  // ページ側で差し込みを呼ばない (呼ぶと二重になる/書き漏れる)。
  // トップだけは「最後まで見せる」ために introGate を使うが、それだけ。
  assert.doesNotMatch(INDEX, /SPSPLogo\.(inline|autoInline)\(/);
});

test('動きを減らす設定を尊重する', () => {
  assert.match(CSS, /prefers-reduced-motion: reduce/);
  // 静止形に落とすので clip-path も外す (隠れたままにならないように)
  assert.match(CSS, /\.spsp\.is-anim \.spsp__word \{ clip-path: none; \}/);
});

test('ロードが長いときは繰り返しに移る', { skip: !JSDOM }, async () => {
  const w = winWith('<div class="empty-msg">読み込み中…</div>');
  w.SPSPLogo.autoInline();
  const mark = w.document.querySelector('.spsp');
  assert.ok(!mark.classList.contains('is-loop'), '最初から繰り返している');
  await new Promise((r) => setTimeout(r, 1400));
  assert.ok(mark.classList.contains('is-loop'), '一巡しても繰り返しに移らない');
  // 作り直しではなく、スキャン線の往復とティアの明滅で続ける
  assert.match(CSS, /@keyframes spsp-scan-loop/);
  assert.match(CSS, /@keyframes spsp-tier-wave/);
  assert.match(CSS, /\.spsp\.is-anim\.is-on\.is-loop \.spsp__scan \{[^}]*infinite/s);
});

test('ヘッダーのロゴは中身の幅に収まる (nav を押し広げない)', () => {
  // display:block だと nav の残り幅いっぱいに伸び、右側の項目が折り返す
  assert.match(CSS, /\.nav \.brand \.spsp \{ display: inline-block;/);
  assert.match(CSS, /\.nav \.brand a \{ display: inline-block/);
  assert.doesNotMatch(CSS, /\.nav \.brand \.spsp \{ display: block/);
  // ヘッダーは横幅が資源。ティアを文字幅からはみ出させない
  assert.match(CSS, /\.nav \.brand \.spsp__tiers \{ inset: 0;/);
  // ローダーより小さいこと
  const head = Number(CSS.match(/\.nav \.brand \.spsp__word \{ font-size: (\d+)px/)[1]);
  assert.ok(head <= 16, 'ヘッダーのワードマークが大きすぎる: ' + head + 'px');
});

test('一巡の想定時間が CSS の最後の遅延を上回る', () => {
  // ここがずれると、出そろう前に繰り返しへ移ってちらつく
  const intro = Number(SRC.match(/var INTRO_MS = (\d+)/)[1]);
  const subDelay = Number(CSS.match(/animation-delay: calc\((\.\d+)s \+ var\(--j\)/)[1] * 1000);
  const subDur = Number(CSS.match(/animation: spsp-fade (\.\d+)s/)[1] * 1000);
  const nChars = 'SAIKYO PLAYERS'.length + 'SPECIAL'.length;
  const step = Number(CSS.match(/var\(--j\) \* (\.\d+)s/)[1] * 1000);
  const end = subDelay + step * (nChars - 1) + subDur;
  assert.ok(intro >= end, `繰り返しが早すぎる (一巡 ${Math.round(end)}ms < INTRO_MS ${intro}ms)`);
});

// ── トップだけの「最後まで見せる」扱い ──
test('introGate: 再生が終わるまで待つ (差し込みより先に作られても)',
  { skip: !JSDOM }, async () => {
    const w = winWith('<div class="empty-msg">読み込み中…</div>');
    const t0 = Date.now();
    const gate = w.SPSPLogo.introGate();
    setTimeout(() => w.SPSPLogo.autoInline(), 250);     // 遅れて再生が始まる
    await gate;
    const waited = Date.now() - t0;
    assert.ok(waited >= 250 + w.SPSPLogo.INTRO_MS - 120,
      '再生の終わりより前に解けている: ' + waited + 'ms');
  });

test('introGate: タップ / キー操作で即スキップできる', { skip: !JSDOM }, async () => {
  for (const ev of [['pointerdown', 'MouseEvent'], ['keydown', 'KeyboardEvent']]) {
    const w = winWith('<div class="empty-msg">読み込み中…</div>');
    w.SPSPLogo.autoInline();
    const t0 = Date.now();
    const gate = w.SPSPLogo.introGate();
    setTimeout(() => {
      const E = ev[1] === 'MouseEvent' ? w.MouseEvent : w.KeyboardEvent;
      w.document.dispatchEvent(new E(ev[0], { bubbles: true, key: 'a' }));
    }, 120);
    await gate;
    const waited = Date.now() - t0;
    assert.ok(waited < 600, ev[0] + ' でスキップできない: ' + waited + 'ms');
  }
});

test('introGate: 差し込みが起きなくても必ず解ける', { skip: !JSDOM }, async () => {
  const w = winWith('<div>データ無し</div>');     // 読み込み枠が無いページ
  const t0 = Date.now();
  await w.SPSPLogo.introGate();
  assert.ok(Date.now() - t0 <= w.SPSPLogo.INTRO_MS * 2 + 400, '待ち続けている');
});

test('トップだけが最後まで見せる (他ページは待たせない)', () => {
  assert.match(INDEX, /SPSPLogo\.introGate\(\)/);
  assert.match(INDEX, /await INTRO_GATE;/);
  // 他のページに広げていないこと (待たされるのはトップだけ)
  const others = ['c/index.html', 'pref/index.html', 'events/index.html', 'p/index.html'];
  for (const f of others) {
    assert.doesNotMatch(pageWithScript(f), /introGate/, f + ' でも待たせている');
  }
});

test('消えるときのアニメーションは持たない (ロード済みなら即座に表示)', () => {
  // 差し込みは枠ごと差し替えられて消えるだけ。フェードアウト等を足さないこと。
  assert.doesNotMatch(CSS, /\.spsp-inline[^{]*\{[^}]*transition/s);
  assert.doesNotMatch(SRC, /is-out/);
});

test('切り替えは短いフェードイン (パッと入れ替えない)', () => {
  assert.match(CSS, /@keyframes spsp-fadein/);
  const dur = Number(CSS.match(/\.spsp-fadein \{ animation: spsp-fadein (\.\d+)s/)[1]);
  assert.ok(dur > 0 && dur <= 0.3, '長すぎる: ' + dur + 's');
  // 初回の描画だけ。並べ替え/絞り込みのたびに動かさない
  assert.match(INDEX, /function fadeInOnce/);
  assert.match(INDEX, /fadeInOnce\(document\.querySelector\('\.table-wrap'\)\)/);
  const render = INDEX.slice(INDEX.indexOf('function render() {'), INDEX.indexOf('function buildExplain'));
  assert.doesNotMatch(render, /fadeInOnce/, 'render のたびにフェードしている');
  // 動きを減らす設定では止める
  assert.match(CSS, /prefers-reduced-motion[\s\S]*\.spsp-fadein \{ animation: none; \}/);
});

test('スキップのタップが下のランキング行に落ちない', { skip: !JSDOM }, async () => {
  const w = winWith('<div class="empty-msg">読み込み中…</div><a id="row" href="#p">行</a>');
  w.SPSPLogo.autoInline();
  let hits = 0;
  w.document.getElementById('row').addEventListener('click', () => hits++);
  const gate = w.SPSPLogo.introGate();
  w.document.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  await gate;
  // 解除直後に表が描かれ、指を離した先が行になる → その click は握りつぶす
  const click = () => w.document.getElementById('row')
    .dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  click();
  assert.strictEqual(hits, 0, 'プレイヤーページへ飛んでしまう');
  // ただし通常操作は妨げない
  click();
  assert.strictEqual(hits, 1, '以降の操作まで止めている');
});

test('キー操作でスキップしたときは click を止めない', { skip: !JSDOM }, async () => {
  const w = winWith('<div class="empty-msg">読み込み中…</div><a id="row" href="#p">行</a>');
  w.SPSPLogo.autoInline();
  let hits = 0;
  w.document.getElementById('row').addEventListener('click', () => hits++);
  const gate = w.SPSPLogo.introGate();
  w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  await gate;
  w.document.getElementById('row').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(hits, 1);
});

test('握りつぶしは時限で自動解除する (取り逃しても操作不能にしない)', { skip: !JSDOM }, async () => {
  const w = winWith('<div class="empty-msg">読み込み中…</div><a id="row" href="#p">行</a>');
  w.SPSPLogo.autoInline();
  let hits = 0;
  w.document.getElementById('row').addEventListener('click', () => hits++);
  const gate = w.SPSPLogo.introGate();
  w.document.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }));
  await gate;
  await new Promise((r) => setTimeout(r, 800));
  w.document.getElementById('row').dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.strictEqual(hits, 1, '時限で解除されていない');
});
