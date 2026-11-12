// 告知画像 (1600×900 を 1.5 倍 = 2400×1350) を組む: 撮った画面 (shots/) を切り抜いて、説明と一緒に並べる (一時的なツール)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const SH = path.resolve('shots');
const OUT = path.resolve('out');
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const M = process.env.MAIN || '932356', S2 = process.env.SUB || '1002311';
const META = JSON.parse(fs.readFileSync(path.join(SH, 'meta.json'), 'utf8'));
const BAR = META.e_sel['.ce-bar'], APPLY = META.e_sel['#ce-apply'];
const CARD = { x0: 25, x1: 365, y0: 131, y1: 355 };
// 画面の切り抜き: f = 画像 / x0..x1, y0..y1 = 画面上の位置 (CSS px) / x,y,w = スライド上の位置と幅 / hl = 強調する枠 [x,y,w,h,番号] / cap = 上のラベル
const SLIDES = [
  { n: 1, title: '大会のシールを\nカードの裏に貼れます', lead: '大会に出るとその大会のシールがもらえます',
    bullets: ['カードを横にはじくと裏返ります', 'ゆっくり動かすと傾いてシールが光ります', '最初は順位評価の高い 20 大会が並んでいます'],
    screens: [{ f: `p_${M}_back.png`, ...CARD, x: 820, y: 70, w: 720, cap: 'カードの裏' },
      { f: `p_${M}_ov.png`, ...CARD, x: 800, y: 610, w: 370, hl: [[273, 145, 36, 36, null]], cap: 'カードを押すと出る「裏返す」' },
      { f: `p_${M}_tilt_c.png`, x0: 13, x1: 367, y0: 122, y1: 362, x: 1200, y: 600, w: 370, cap: '傾けたところ' }] },
  { n: 2, title: 'シールがもらえる\n大会と色の条件',
    bullets: ['参加 8 人以上のオフライン大会が対象です', 'その大会で 1 試合でもした人がもらえます', '下位クラスはクラスごとに別のシールです'],
    panel: { x: 810, y: 60, w: 760, head: '上の色を取ると下の色も全部もらえます', rows: [
      ['虹', 'r', [['', '優勝']]],
      ['金', 'g', [['予選プールのある大会', 'Top 8'], ['予選のない大会', '上位 1/4 以内（最大 Top 8）']]],
      ['銀', 's', [['予選プールのある大会', '予選突破'], ['予選のない大会', '上位半分（最大 Top 16）　49 人以上は Top 24']]],
      ['素', 'n', [['', '参加']]]] },
    screens: [] },
  { n: 3, title: 'シールは編集ページの\n「裏」で貼ります',
    steps: [['貼り方', null], ['①', 'カードを押して「編集」を開きます'], ['②', '「裏」のタブを選びます'], ['③', '一覧の大会を押すと貼られます'], ['④', '下の色を押すと色を選べます']],
    note: '編集には start.gg でのログインが必要です',
    screens: [{ f: `p_${M}_ov.png`, ...CARD, x: 810, y: 60, w: 390, hl: [[231, 145, 36, 36, '①']] },
      { f: 'e_view.png', x0: 8, x1: 382, y0: 98, y1: 152, x: 810, y: 350, w: 390, hl: [[197, 108, 174, 34, '②']] },
      { f: 'e_tray.png', x0: 8, x1: 382, y0: 62, y1: 560, x: 1150, y: 250, w: 420, hl: [[139, 190, 113, 113, '③'], [139, 490, 113, 32, '④']] }] },
  { n: 4, title: '場所や大きさを決めて\n「適用」で保存します',
    bullets: ['ドラッグで動かせます', '角の ↻ で回転と大きさを変えられます', '形や重なり順も変えられます', '「適用」を押すと保存されます'],
    screens: [{ f: 'e_sel.png', x0: 8, x1: 382, y0: 145, y1: 560, x: 800, y: 50, w: 440 },
      { f: 'e_sel.png', x0: 0, x1: 390, y0: BAR[1], y1: BAR[1] + BAR[3], x: 800, y: 570, w: 440, hl: [[APPLY[0], APPLY[1], APPLY[2], APPLY[3], null]] },
      { f: 'e_menu.png', x0: 176, x1: 380, y0: 185, y1: 598, x: 1265, y: 250, w: 305 }] },
];
function panelHtml(p) {
  if (!p) return '';
  const rows = p.rows.map(([name, c, items]) => `<div class="prow"><div class="pc pc-${c}">${esc(name)}</div><div class="pi">${items.map(([k, v]) => `<div class="pit">${k ? `<span class="pk">${esc(k)}</span>` : ''}<span class="pv">${esc(v)}</span></div>`).join('')}</div></div>`).join('');
  return `<div class="panel" style="left:${p.x}px;top:${p.y}px;width:${p.w}px"><div class="ph">${esc(p.head)}</div>${rows}</div>`;
}
const ENTRY = '自分のプレイヤーページのカードを押して「編集」';

function screenHtml(s) {
  const k = s.w / (s.x1 - s.x0), h = Math.round((s.y1 - s.y0) * k);
  const hl = (s.hl || []).map(([x, y, w, hh, lab]) => `<i class="hl" style="left:${(x - s.x0) * k}px;top:${(y - s.y0) * k}px;width:${w * k}px;height:${hh * k}px">${lab ? `<b>${esc(lab)}</b>` : ''}</i>`).join('');
  const cap = s.cap ? `<div class="cap" style="left:${s.x}px;top:${s.y - 34}px">${esc(s.cap)}</div>` : '';
  return `${cap}<div class="scr" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${h}px"><img src="file://${SH}/${s.f}" style="width:${((META[s.f.replace('.png', '')] || {}).vw || 390) * k}px;margin-top:${-s.y0 * k}px;margin-left:${-s.x0 * k}px">${hl}</div>`;
}
function slideHtml(sl) {
  const chip = `<div class="chip p">大会シール<span>${sl.n}/4</span></div>`;
  const title = `<h1>${esc(sl.title).replace(/\n/g, '<br>')}</h1>`;
  const lead = sl.lead ? `<p class="lead">${esc(sl.lead)}</p>` : '';
  const bl = sl.bullets ? `<ul class="${sl.small ? 'sm' : ''}">${sl.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
  const st = sl.steps ? `<div class="steps">${sl.steps.map(([a, b]) => (b == null ? `<h3>${esc(a)}</h3>` : `<div class="st"><em>${esc(a)}</em><span>${esc(b)}</span></div>`)).join('')}</div>` : '';
  const note = sl.note ? `<p class="note">${esc(sl.note)}</p>` : '';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@500;600;700&family=Zalando+Sans+Expanded:wght@500;600;700&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1600px;height:900px;overflow:hidden;background:#fff}
body{font-family:"IBM Plex Sans JP","Noto Sans CJK JP",sans-serif;color:#111827;position:relative}
.band{position:absolute;left:820px;top:-40px;width:1000px;height:1000px;background:#dc2626;transform:skewX(-10deg)}
.band2{position:absolute;left:770px;top:-40px;width:14px;height:1000px;background:#111827;transform:skewX(-10deg)}
.col{position:absolute;left:72px;top:64px;width:640px;height:780px;display:flex;flex-direction:column}
.brand{font-family:"Zalando Sans Expanded",sans-serif;font-weight:700;font-size:22px;letter-spacing:.06em;display:flex;align-items:center;gap:14px}
.brand small{font-family:"IBM Plex Sans JP",sans-serif;font-weight:700;font-size:18px;letter-spacing:.02em;color:#dc2626}
.chip{margin-top:26px;align-self:flex-start;font-weight:700;font-size:22px;color:#fff;padding:6px 16px;display:flex;gap:14px;align-items:baseline;background:#dc2626}
.chip span{font-family:"Zalando Sans Expanded",sans-serif;font-size:16px;opacity:.85}
h1{margin-top:22px;font-size:46px;line-height:1.25;font-weight:700;letter-spacing:.01em}
.lead{margin-top:22px;font-size:23px;line-height:1.6;color:#374151;font-weight:500}
ul{margin-top:28px;list-style:none}
li{position:relative;padding-left:28px;font-size:23px;line-height:1.5;font-weight:600;margin-bottom:12px}
li::before{content:"";position:absolute;left:0;top:12px;width:13px;height:13px;background:#dc2626}
ul.sm{margin-top:22px}ul.sm li{font-size:21px;margin-bottom:9px}ul.sm li::before{top:10px}
.steps{margin-top:22px;border-left:5px solid #dc2626;padding:4px 0 4px 20px}
.steps h3{font-size:20px;color:#dc2626;font-weight:700;margin-bottom:8px}
.st{display:flex;gap:12px;font-size:22px;line-height:1.5;font-weight:600;margin-bottom:8px}
.st em{font-style:normal;color:#dc2626;font-weight:700;flex:none}
.note{margin-top:14px;font-size:19px;color:#6b7280;font-weight:500}
.foot{margin-top:auto;font-size:19px;font-weight:700;color:#111827;background:#f3f4f6;border-left:5px solid #111827;padding:10px 16px;line-height:1.45}
.foot b{font-family:"Zalando Sans Expanded",sans-serif;color:#dc2626;margin-right:12px}
.scr{position:absolute;overflow:hidden;background:#fff;border-radius:14px;box-shadow:0 18px 40px rgba(17,24,39,.35);border:3px solid #111827}
.scr img{display:block;max-width:none}
.cap{position:absolute;font-size:17px;font-weight:700;color:#fff;background:#111827;padding:3px 12px;border-radius:6px 6px 0 0;line-height:1.5}
.panel{position:absolute;background:#fff;border:3px solid #111827;border-radius:14px;box-shadow:0 18px 40px rgba(17,24,39,.35);padding:22px 26px 10px}
.ph{font-size:21px;font-weight:700;margin-bottom:14px}
.prow{display:flex;gap:20px;align-items:center;padding:16px 0;border-top:2px solid #e5e7eb}
.pc{flex:none;width:86px;height:86px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.pc-r{background:linear-gradient(135deg,#f87171,#fbbf24,#34d399,#60a5fa,#a78bfa)}.pc-g{background:#c9a227}.pc-s{background:#8b95a5}.pc-n{background:#fff;color:#111827;border:3px solid #d1d5db;text-shadow:none}
.pi{flex:1;min-width:0}
.pit{font-size:22px;line-height:1.45;font-weight:600;margin:5px 0}
.pk{display:block;font-size:17px;font-weight:700;color:#dc2626}
.pv{display:block}
.hl{position:absolute;border:4px solid #facc15;border-radius:8px;box-shadow:0 0 0 3px rgba(17,24,39,.6)}
.hl b{position:absolute;left:-46px;top:50%;margin-top:-18px;width:36px;height:36px;border-radius:50%;background:#facc15;color:#111827;font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;font-style:normal;box-shadow:0 0 0 3px rgba(17,24,39,.6)}
</style></head><body>
<div class="band2"></div><div class="band"></div>
<div class="col"><div class="brand">SPSP <small>プレイヤーカード</small></div>${chip}${title}${lead}${bl}${st}${note}
<div class="foot"><b>spsp.games</b>${esc(ENTRY)}</div></div>
${sl.screens.map(screenHtml).join('')}${panelHtml(sl.panel)}
</body></html>`;
}

const browser = await chromium.launch({ args: ['--lang=ja-JP'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
for (const sl of SLIDES) {
  const f = path.join(OUT, `s${sl.n}.html`);
  fs.writeFileSync(f, slideHtml(sl));
  await page.goto('file://' + f, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `sticker_${sl.n}.png`) });
}
await browser.close();
