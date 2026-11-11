// 告知画像 (1600×900) を組む: 撮った見本の画面 (shots/) を切り抜いて、説明と一緒に並べる (一時的なツール)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const SH = path.resolve('shots');
const OUT = path.resolve('out');
fs.mkdirSync(OUT, { recursive: true });
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// 画面の切り抜き: f = 画像 / y0..y1 = 画面上の位置 (CSS px、幅 390) / x,y,w = スライド上の位置と幅 / hl = 強調する枠 [x,y,w,h] (画面の CSS px)
const PL = 'players', OR = 'organizers';
const ENTRY_P = '入口：運営が配る URL ／ トップの「結果報告」 ／ 右上の人型メニュー';
const ENTRY_O = '入口：メニュー「大会運営支援」→「結果報告管理」';
const SLIDES = [
  { id: 'p1', who: PL, n: 1, title: 'スマホで、対戦から\n結果報告まで', lead: '運営が受付を始めた大会では、自分の試合の確認と結果の報告が SPSP からできます。',
    steps: [['どこから？', null],
      ['①', '運営が配る報告ページの URL'],
      ['②', 'ログイン中なら、トップページの「結果報告」の帯（自分のプレイヤーページにも）'],
      ['③', '右上の人型メニュー →「結果報告: 大会名」']],
    note: 'start.gg のアカウントで SPSP にログインして使います',
    screens: [{ f: 'top_notice_view.png', y0: 0, y1: 560, x: 880, y: 150, w: 430, hl: [[8, 126, 374, 45, '②'], [336, 0, 46, 44, '③']] }] },
  { id: 'p2', who: PL, n: 2, title: '対戦相手が決まると、\nすぐわかる',
    bullets: ['試合が決まると、演出つきで相手のプレイヤーカードが出ます', 'プール・ラウンド・台番号・配信台・何先もひと目で', '「対戦開始」で start.gg の試合も開始に', '画面は自動で新しくなります'],
    screens: [{ f: 'match_f3400.png', y0: 0, y1: 844, x: 760, y: 60, w: 360 }, { f: 'match_full.png', y0: 560, y1: 1010, x: 1160, y: 240, w: 380 }] },
  { id: 'p3', who: PL, n: 3, title: '結果はその場で、\nスマホから報告',
    bullets: ['スコアとキャラを選んで送信。運営の設定に合わせて start.gg に反映されます', '2 人とも送って OK。食い違ったら一度取り消して、2 人に知らせます', '相手が見つからないときは「対戦相手が見つからない」で運営と相手に連絡'],
    screens: [{ f: 'noshow_full.png', y0: 620, y1: 1000, x: 750, y: 110, w: 410, hl: [[16, 64, 358, 66, null]] }, { f: 'conflict_full.png', y0: 740, y1: 925, x: 1100, y: 560, w: 440 }] },
  { id: 'p4', who: PL, n: 4, title: '勝ったらシェア。\n待ち時間は次の相手を',
    bullets: ['勝利画面から、結果を画像つきでシェア（Upset Factor・次のフェーズ進出も）', '試合待ちの間は、次の相手の候補を表示', '終わった試合と報告の状態もここで確認'],
    screens: [{ f: 'win_view.png', y0: 0, y1: 844, x: 760, y: 60, w: 360 }, { f: 'waiting_full.png', y0: 141, y1: 800, x: 1160, y: 130, w: 370 }] },
  { id: 'o1', who: OR, n: 1, title: '受付は、\nイベントを選ぶだけ',
    steps: [['使い方', null],
      ['①', 'メニュー「大会運営支援」→「結果報告管理」'],
      ['②', 'start.gg で運営としてログイン'],
      ['③', '管理している大会からイベントを選び、設定して受付開始'],
      ['④', '報告ページの URL を選手に共有（ログイン中の参加者にはトップに自動で出ます）']],
    note: '下位クラス作成（Challonge）のトーナメントでも使えます',
    screens: [{ f: 'nav_menu_view.png', y0: 0, y1: 330, x: 760, y: 110, w: 400, hl: [[150, 128, 126, 28, null]] }, { f: 'setup_full.png', y0: 50, y1: 560, x: 1180, y: 210, w: 370 }] },
  { id: 'o2', who: OR, n: 2, title: '大会に合わせて\n細かく設定',
    bullets: ['何先：フェーズごと。勝者側・敗者側、途中のラウンドから変更も', '報告の取り込み：すぐ／1・3・5 分後／両者の報告が必要／運営の承認が必要', 'トップ N からは運営が入力、下位クラスだけ選手が報告、なども', '設定は名前をつけて保存・呼び出し'],
    screens: [{ f: 'admin_full.png', y0: 760, y1: 1100, x: 750, y: 230, w: 390 }, { f: 'admin_full.png', y0: 1100, y1: 1440, x: 1165, y: 150, w: 390 }] },
  { id: 'o3', who: OR, n: 3, title: '報告の確認・修正も\nまとめて',
    bullets: ['報告のあった試合を一覧で。食い違い・確認待ちがひと目でわかる', 'どちらかの報告を採用・スコアを入れて直す・取り消す', '対応が必要なときはスマホに通知', '管理者を追加して、報告の管理を任せられます'],
    screens: [{ f: 'admin_full.png', y0: 2200, y1: 2900, x: 760, y: 105, w: 370 }, { f: 'admin_full.png', y0: 1440, y1: 1532, x: 1165, y: 170, w: 390 }, { f: 'admin_full.png', y0: 1585, y1: 1770, x: 1165, y: 330, w: 390 }] },
  { id: 'o4', who: OR, n: 4, title: 'start.gg が止まっても、\n大会は止めない',
    bullets: ['選手の報告は SPSP に保存。復旧したら古い順に自動で反映', '次の試合が出ないときは、運営が 2 人を指定して進行', 'start.gg にまだ入っていない結果は一覧で確認・書き出し'],
    screens: [{ f: 'admin_outage_full.png', y0: 2420, y1: 3270, x: 770, y: 50, w: 365 }, { f: 'admin_outage_full.png', y0: 1770, y1: 2170, x: 1170, y: 250, w: 380 }] },
];

function screenHtml(s) {
  const k = s.w / 390, h = Math.round((s.y1 - s.y0) * k);
  const hl = (s.hl || []).map(([x, y, w, hh, lab]) => `<i class="hl" style="left:${x * k}px;top:${(y - s.y0) * k}px;width:${w * k}px;height:${hh * k}px">${lab ? `<b>${esc(lab)}</b>` : ''}</i>`).join('');
  return `<div class="scr" style="left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${h}px"><img src="file://${SH}/${s.f}" style="width:${s.w}px;margin-top:${-s.y0 * k}px">${hl}</div>`;
}
function slideHtml(sl) {
  const P = sl.who === PL;
  const chip = `<div class="chip ${P ? 'p' : 'o'}">${P ? '選手向け' : '運営向け'}<span>${sl.n}/4</span></div>`;
  const title = `<h1>${esc(sl.title).replace(/\n/g, '<br>')}</h1>`;
  const lead = sl.lead ? `<p class="lead">${esc(sl.lead)}</p>` : '';
  const bl = sl.bullets ? `<ul>${sl.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : '';
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
.chip{margin-top:26px;align-self:flex-start;font-weight:700;font-size:22px;color:#fff;padding:6px 16px;display:flex;gap:14px;align-items:baseline}
.chip.p{background:#dc2626}.chip.o{background:#111827}
.chip span{font-family:"Zalando Sans Expanded",sans-serif;font-size:16px;opacity:.85}
h1{margin-top:22px;font-size:54px;line-height:1.25;font-weight:700;letter-spacing:.01em}
.lead{margin-top:22px;font-size:23px;line-height:1.6;color:#374151;font-weight:500}
ul{margin-top:28px;list-style:none}
li{position:relative;padding-left:30px;font-size:24px;line-height:1.5;font-weight:600;margin-bottom:16px}
li::before{content:"";position:absolute;left:0;top:13px;width:13px;height:13px;background:#dc2626}
.steps{margin-top:22px;border-left:5px solid #dc2626;padding:4px 0 4px 20px}
.steps h3{font-size:20px;color:#dc2626;font-weight:700;margin-bottom:8px}
.st{display:flex;gap:12px;font-size:22px;line-height:1.5;font-weight:600;margin-bottom:8px}
.st em{font-style:normal;color:#dc2626;font-weight:700;flex:none}
.note{margin-top:14px;font-size:19px;color:#6b7280;font-weight:500}
.foot{margin-top:auto;font-size:19px;font-weight:700;color:#111827;background:#f3f4f6;border-left:5px solid #111827;padding:10px 16px;line-height:1.45}
.foot b{font-family:"Zalando Sans Expanded",sans-serif;color:#dc2626;margin-right:12px}
.scr{position:absolute;overflow:hidden;background:#fff;border-radius:16px;box-shadow:0 18px 40px rgba(17,24,39,.35);border:3px solid #111827}
.scr img{display:block}
.hl{position:absolute;border:4px solid #facc15;border-radius:8px;box-shadow:0 0 0 3px rgba(17,24,39,.6)}
.hl b{position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;background:#facc15;color:#111827;font-size:22px;font-weight:700;display:flex;align-items:center;justify-content:center;font-style:normal}
</style></head><body>
<div class="band2"></div><div class="band"></div>
<div class="col"><div class="brand">SPSP <small>結果報告</small></div>${chip}${title}${lead}${bl}${st}${note}
<div class="foot"><b>spsp.games</b>${esc(P ? ENTRY_P : ENTRY_O)}</div></div>
${sl.screens.map(screenHtml).join('')}
</body></html>`;
}

const browser = await chromium.launch({ args: ['--lang=ja-JP'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 });
for (const sl of SLIDES) {
  const f = path.join(OUT, sl.id + '.html');
  fs.writeFileSync(f, slideHtml(sl));
  await page.goto('file://' + f, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${sl.who === PL ? 'player' : 'organizer'}_${sl.n}.png`) });
}
await browser.close();
