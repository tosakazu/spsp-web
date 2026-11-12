// 告知画像用: プレビューのプレイヤーページ・カード編集 (大会シール)・結果報告の見本をスマホの大きさで撮る (一時的なツール)。「適用」は押さない
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'https://spsp-web-preview.tosakazu.workers.dev/jp/';
const OUT = process.env.OUT || 'shots';
const MAIN = process.env.MAIN || '932356', SUB = process.env.SUB || '1002311';
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--lang=ja-JP'] });
const mk = async (guide) => {
  const c = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 3, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  if (!guide) await c.addInitScript(() => { try { localStorage.setItem('spsp_card_back_guide_v1', '1'); } catch (e) {} });
  return c;
};
const ctx = await mk(false);
const meta = {};
// 撮って、そのときの要素の位置 (画面の座標) も残す
const snap = async (page, name, sels = []) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  meta[name] = await page.evaluate((sels) => {
    const o = {};
    for (const s of sels) { const el = document.querySelector(s); if (!el) continue; const r = el.getBoundingClientRect(); if (!r.width && !r.height) continue; o[s] = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }
    return o;
  }, sels);
};
const log = {};
const P = ['#pcard-wrap', '#pc-overlay', '#pc-edit-btn', '#pc-ov-flip', '#pc-ov-save'];
for (const uid of [MAIN, SUB]) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}p/?uid=${uid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pcard .pc-in', { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => { const w = document.getElementById('pcard-wrap'); return w && !w.classList.contains('pc-wait'); }, null, { timeout: 40000 }).catch(() => { log[uid] = 'pc-wait timeout'; });
  await page.waitForTimeout(4500);
  await page.evaluate(() => { scrollTo(0, 0); return document.fonts.ready; });
  await page.waitForTimeout(500);
  await snap(page, `p_${uid}_front`, P);
  // カードを押すと出るボタン (編集・裏返す・保存)
  const r = meta[`p_${uid}_front`]['#pcard-wrap'];
  await page.touchscreen.tap(r[0] + r[2] / 2, r[1] + r[3] / 2).catch(() => {});
  await page.waitForTimeout(700);
  await snap(page, `p_${uid}_ov`, P);
  await page.touchscreen.tap(r[0] + r[2] / 2, r[1] + r[3] + 120).catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('pcard-wrap').classList.add('flipped'));
  await page.waitForTimeout(1500);
  await snap(page, `p_${uid}_back`, P);
  const cx = r[0] + r[2] / 2, cy = r[1] + r[3] / 2;
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (const [dx, dy, tag] of [[0.3, -0.2, 'b'], [0.32, 0.28, 'c'], [-0.3, 0.25, 'd']]) {
    await page.mouse.move(cx + r[2] * dx, cy + r[3] * dy, { steps: 25 });
    await page.waitForTimeout(350);
    await snap(page, `p_${uid}_tilt_${tag}`, P);
  }
  await page.mouse.up();
  await page.close();
}

// 編集ページ (裏)
{
  const uid = MAIN;
  const page = await ctx.newPage();
  await page.goto(`${BASE}p/edit?uid=${uid}&tab=back`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#bz-tray > *', { timeout: 40000 }).catch(() => { log.edit = 'tray timeout'; });
  await page.waitForTimeout(7000);
  await page.evaluate(() => { scrollTo(0, 0); return document.fonts.ready; });
  await page.waitForTimeout(500);
  const E = ['#ce-tabs', '#ce-tabs button[data-tab="back"]', '#bz-stage', '#bz-tools', '#bz-tray', '#bz-filters', '.bz-find', '#bz-menu', '#bz-latin', '#bz-text-top', '#bz-sticker-text', '#bz-guide', '#ce-apply', '#ce-discard', '.ce-bar', '#bz-top', '#bz-tabs', '#bz-shapes', '#bz-frame', '.bz-menu-pop', '#bz-rand', '.bz-rand', '#bz-default', '#bz-clear', '#bz-sel-name'];
  await snap(page, 'e_view', E);
  // 一覧の所へ
  const top = await page.evaluate(() => document.querySelector('.bz-find').getBoundingClientRect().top + scrollY);
  await page.evaluate((y) => scrollTo(0, y - 70), top);
  await page.waitForTimeout(3000);
  await snap(page, 'e_tray', [...E, '#bz-tray > *:nth-child(1)', '#bz-tray > *:nth-child(2)', '#bz-tray > *:nth-child(3)', '#bz-tray > *:nth-child(4)', '#bz-tray > *:nth-child(5)', '#bz-tray > *:nth-child(6)']);
  // まだ貼っていない大会を 1 つ押して貼る (一覧の絵の所)
  const idx = await page.evaluate(() => { const l = [...document.querySelectorAll('#bz-tray > *')]; const i = l.findIndex((el, n) => n < 9 && !el.querySelector('.on, [aria-pressed="true"]') && !/✓/.test(el.textContent || '')); return i < 0 ? 0 : i; });
  meta.e_tray.picked = idx;
  const it = (await page.$$('#bz-tray > *'))[idx];
  if (it) { const b = await it.boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.width / 2).catch((e) => { log.tap = e.message.slice(0, 100); }); }
  await page.waitForTimeout(1800);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(600);
  await snap(page, 'e_sel', E);
  meta.e_sel.n = await page.evaluate(() => document.querySelectorAll('#bz-layer > *').length);
  await page.evaluate(() => { const m = document.getElementById('bz-menu'); if (m) m.open = true; });
  await page.waitForTimeout(500);
  await snap(page, 'e_menu', E);
  await page.close();
}
// ガイド
{
  const c2 = await mk(true); const page = await c2.newPage();
  await page.goto(`${BASE}p/edit?uid=${MAIN}&tab=back`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bzg', { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(6000);
  await snap(page, 'e_guide1', ['.bzg-hole', '.bzg-tip']);
  await page.close();
}
// 結果報告の見本: 対戦カードを裏返す
{
  const page = await ctx.newPage();
  await page.goto(`${BASE}report/?demo=match&anim=dark&p1=${MAIN}&p2=${SUB}`, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.rp-demo{display:none!important}' });
  await page.waitForTimeout(1500);
  const ov = await page.$('.rp-match-ov'); if (ov) await ov.click().catch(() => {});
  await page.waitForFunction(() => { const l = [...document.querySelectorAll('.rp-flip')]; return l.length && l.every((w) => !w.classList.contains('pc-wait')); }, null, { timeout: 40000 }).catch(() => { log.report = 'pc-wait timeout'; });
  await page.waitForTimeout(5000);
  await page.evaluate(() => { const l = [...document.querySelectorAll('.rp-flip')]; if (l[1]) l[1].classList.add('flipped'); });
  await page.waitForTimeout(1200);
  const y = await page.evaluate(() => { const l = document.querySelector('.rp-flip'); return l ? l.getBoundingClientRect().top + scrollY : 0; });
  await page.evaluate((y) => scrollTo(0, Math.max(0, y - 80)), y);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/r_vs.png` });
  meta.r_vs = await page.evaluate(() => ({ flips: [...document.querySelectorAll('.rp-flip')].map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }),
    cur: (() => { const el = document.querySelector('.rp-current'); if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })() }));
  await page.close();
}
meta.log = log;
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
