// 告知画像用: プレビューのプレイヤーページ・カード編集 (大会シール) をスマホの大きさで撮る (一時的なツール)。「適用」は押さない
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'https://spsp-web-preview.tosakazu.workers.dev/jp/';
const OUT = process.env.OUT || 'shots';
const UIDS = (process.env.UIDS || '1787719,1002311,1838577,932356').split(',');
const EDIT = (process.env.EDIT || '1787719,1838577').split(',');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ja-JP'] });
const mk = (guide) => browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 3, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' }).then(async (c) => {
  if (!guide) await c.addInitScript(() => { try { localStorage.setItem('spsp_card_back_guide_v1', '1'); } catch (e) {} });
  return c;
});
const ctx = await mk(false);
const meta = {};
const rects = (page, sels) => page.evaluate((sels) => {
  const o = { H: document.documentElement.scrollHeight, sy: scrollY };
  for (const s of sels) { const el = document.querySelector(s); if (!el) continue; const r = el.getBoundingClientRect(); o[s] = [Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height), (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)]; }
  return o;
}, sels);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

for (const uid of UIDS) {
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error') log.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}p/?uid=${uid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pcard .pc-in', { timeout: 30000 }).catch(() => {});
  // 裏面の準備 (シールの絵) ができるまで
  await page.waitForFunction(() => { const w = document.getElementById('pcard-wrap'); return w && !w.classList.contains('pc-wait'); }, null, { timeout: 40000 }).catch(() => log.push('pc-wait timeout'));
  await page.waitForTimeout(4500);   // 自動の裏返しが終わるまで
  await page.evaluate(() => { scrollTo(0, 0); return document.fonts.ready; });
  await page.waitForTimeout(500);
  await shot(page, `p_${uid}_front`);
  const P = ['#pcard-wrap', '#pcard', '#pcard-back', '#pc-edit-btn', 'header', '.site-header'];
  meta[`p_${uid}`] = await rects(page, P);
  await page.evaluate(() => document.getElementById('pcard-wrap').classList.add('flipped'));
  await page.waitForTimeout(1500);
  await shot(page, `p_${uid}_back`);
  // 傾けて光らせる (押したままゆっくり動かす)
  const r = meta[`p_${uid}`]['#pcard-wrap'];
  if (r) {
    const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (const [dx, dy, tag] of [[-0.3, -0.25, 'a'], [0.3, -0.2, 'b'], [0.32, 0.28, 'c']]) {
      const tx = cx + r[2] * dx, ty = cy + r[3] * dy;
      await page.mouse.move(tx, ty, { steps: 25 });
      await page.waitForTimeout(350);
      await shot(page, `p_${uid}_tilt_${tag}`);
    }
    await page.mouse.up();
  }
  meta[`p_${uid}`].log = log;
  await page.close();
}

for (const uid of EDIT) {
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => { if (m.type() === 'error') log.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}p/edit?uid=${uid}&tab=back`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#bz-tray > *', { timeout: 40000 }).catch(() => log.push('tray timeout'));
  await page.waitForTimeout(7000);
  await page.evaluate(() => { scrollTo(0, 0); return document.fonts.ready; });
  await page.waitForTimeout(500);
  const E = ['#ce-tabs', '#bz-stage', '#bz-tools', '#bz-tray', '#bz-filters', '.bz-find', '#bz-menu', '#bz-latin', '#bz-text-top', '#bz-sticker-text', '#bz-guide', '#ce-apply', '.ce-bar', '#bz-undo', '#bz-top', '#bz-tabs', '#bz-shapes', '#bz-more'];
  await shot(page, `e_${uid}_view`);
  await page.screenshot({ path: `${OUT}/e_${uid}_full.png`, fullPage: true });
  meta[`e_${uid}`] = await rects(page, E);
  meta[`e_${uid}`].tray = await page.evaluate(() => [...document.querySelectorAll('#bz-tray > *')].slice(0, 8).map((el) => { const r = el.getBoundingClientRect(); return [el.className, Math.round(r.left), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height), (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)]; }));
  // シールを 1 枚選ぶ (貼ってあるシールをタップ → 操作欄)
  const sk = await page.$('#bz-layer > *:last-child');
  if (sk) { await sk.click({ force: true }).catch((e) => log.push('sk ' + e.message.slice(0, 80))); await page.waitForTimeout(900); }
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  await shot(page, `e_${uid}_sel`);
  meta[`e_${uid}`].sel = await rects(page, [...E, '#bz-frame', '#bz-sel-name']);
  // メニュー
  await page.evaluate(() => { const m = document.getElementById('bz-menu'); if (m) m.open = true; });
  await page.waitForTimeout(500);
  await shot(page, `e_${uid}_menu`);
  meta[`e_${uid}`].menu = await rects(page, ['.bz-menu-pop', '#bz-rand', '#bz-default', '#bz-clear', '#bz-text-edit']);
  await page.evaluate(() => { const m = document.getElementById('bz-menu'); if (m) m.open = false; });
  // 一覧の所 (下へ)
  const ty = meta[`e_${uid}`]['#bz-tray'];
  if (ty) { await page.evaluate((y) => scrollTo(0, y - 150), ty[1]); await page.waitForTimeout(2500); await shot(page, `e_${uid}_tray`); meta[`e_${uid}`].traySy = await page.evaluate(() => scrollY); }
  meta[`e_${uid}`].log = log;
  await page.close();
}
// ガイドの 1 コマ
{
  const c2 = await mk(true); const page = await c2.newPage(); const uid = EDIT[0];
  await page.goto(`${BASE}p/edit?uid=${uid}&tab=back`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bzg', { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await shot(page, `e_${uid}_guide1`);
  const nx = await page.$('.bzg-next'); if (nx) { await nx.click().catch(() => {}); await page.waitForTimeout(1200); await shot(page, `e_${uid}_guide2`); }
  await page.close();
}
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
