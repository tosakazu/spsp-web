// 告知ツイート本体の 1 枚 (1600×900): 見出し + 選手の画面 2 つ + 運営の一覧
import path from 'node:path';
export function heroHtml(SH) {
  const scr = (f, y0, y1, w, x, y) => { const k = w / 390; return `<div class="scr" style="left:${x}px;top:${y}px;width:${w}px;height:${Math.round((y1 - y0) * k)}px"><img src="file://${path.join(SH, f)}" style="width:${w}px;margin-top:${-y0 * k}px"></div>`; };
  const lab = (n, t, x, y) => `<div class="lab" style="left:${x}px;top:${y}px"><b>${n}</b>${t}</div>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@500;600;700&family=Zalando+Sans+Expanded:wght@500;600;700&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1600px;height:900px;overflow:hidden;background:#fff}
body{font-family:"IBM Plex Sans JP","Noto Sans CJK JP",sans-serif;color:#111827;position:relative}
.band{position:absolute;left:-100px;top:470px;width:1800px;height:700px;background:#dc2626;transform:skewY(-4deg)}
.band2{position:absolute;left:-100px;top:440px;width:1800px;height:12px;background:#111827;transform:skewY(-4deg)}
.brand{position:absolute;left:72px;top:56px;font-family:"Zalando Sans Expanded",sans-serif;font-weight:700;font-size:24px;letter-spacing:.06em}
h1{position:absolute;left:72px;top:110px;font-size:54px;line-height:1.25;font-weight:700}
h1 em{font-style:normal;color:#dc2626}
.sub{position:absolute;left:72px;top:268px;font-size:27px;font-weight:600;color:#374151;line-height:1.5}
.scr{position:absolute;overflow:hidden;background:#fff;border-radius:16px;box-shadow:0 18px 40px rgba(17,24,39,.35);border:3px solid #111827}
.scr img{display:block}
.lab{position:absolute;font-size:23px;font-weight:700;background:#111827;color:#fff;padding:7px 16px 7px 8px;display:flex;align-items:center;gap:10px;white-space:nowrap}
.lab b{font-family:"Zalando Sans Expanded",sans-serif;background:#facc15;color:#111827;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:18px}
.arr{position:absolute;font-size:44px;font-weight:700;color:#fff}
.foot{position:absolute;left:72px;bottom:44px;font-size:22px;font-weight:700;color:#fff;line-height:1.6}
.foot span{background:#111827;padding:6px 14px;display:inline-block;margin-top:8px}
</style></head><body>
<div class="band2"></div><div class="band"></div>
<div class="brand">SPSP</div>
<h1>SPSP から<em>結果報告</em><br>できるようになりました</h1>
<p class="sub">start.gg のトーナメントの結果を<br>選手がスマホから報告できます</p>
${scr('match_f3400.png', 30, 615, 310, 780, 110)}
${lab(1, '対戦相手と台番号が出る', 780, 64)}
${scr('match_full.png', 628, 892, 400, 1130, 110)}
${lab(2, 'スコアを選んで送信', 1130, 64)}
${scr('admin_full.png', 2200, 2545, 400, 1130, 480)}
${lab(3, '運営は一覧で確認・修正', 1130, 434)}
<div class="foot"><span>運営は「大会運営支援」→「結果報告管理」から受付を始められます</span><br><span>Discord で結果報告していた大会にオススメです</span></div>
</body></html>`;
}
