// 告知画像用: 本番の結果報告ページの見本 (?demo=) をスマホの大きさで撮る (一時的なツール)
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
const BASE = process.env.BASE || 'https://spsp.games/jp/report/';
const OUT = process.env.OUT || 'shots';
const PL = process.env.PL || '&p1=r1&p2=r2';
fs.mkdirSync(OUT, { recursive: true });
const S = [
  // name, query, frames (ms after load), click overlay then wait
  ['match', `?demo=match&anim=combo${PL}`, [2600, 3000, 3400, 3800, 4300, 5000], true],
  ['match_stamp', `?demo=match&anim=stamp${PL}`, [2600, 3000, 3400, 3800, 4300, 5000], false],
  ['match_cards', `?demo=match&anim=cards${PL}`, [2600, 3000, 3400, 3800, 4300, 5000], false],
  ['win', `?demo=win&win=card${PL}`, [600, 1200, 2000, 3500], false],
  ['win_ribbon', `?demo=win&win=ribbon${PL}`, [3500], false],
  ['waiting', `?demo=waiting${PL}`, [], true],
  ['noshow', `?demo=noshow${PL}`, [], true],
  ['done', `?demo=done${PL}`, [], true],
  ['conflict', `?demo=conflict${PL}`, [], true],
  ['rr', `?demo=rr${PL}`, [], true],
  ['outage', `?demo=outage${PL}`, [], true],
  ['login', `?demo=login`, [], true],
  ['admin', `?demo=admin${PL}`, [], true],
  ['admin_outage', `?demo=admin_outage${PL}`, [], true],
  ['setup', `?demo=setup`, [], true],
  ['setup_login', `?demo=setup_login`, [], true],
];
// 入口: トップの結果報告の帯 (見本) と、ナビの「大会運営支援」メニュー
const ENTRY = [['top_notice', 'https://spsp.games/jp/?demo=report_notice', null], ['nav_menu', BASE + '?demo=setup', 'nav_open']];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const browser = await chromium.launch({ args: ['--lang=ja-JP'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 3, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
const meta = {};
for (const [name, q, frames, click] of S) {
  if (only && !only.includes(name)) continue;
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(BASE + q, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.rp-demo{display:none!important}' });
  for (const ms of frames) {
    const w = ms - (Date.now() - t0); if (w > 0) await page.waitForTimeout(w);
    await page.screenshot({ path: `${OUT}/${name}_f${ms}.png` });
  }
  if (click) { const ov = await page.$('.rp-match-ov'); if (ov) await ov.click().catch(() => {}); }
  await page.waitForTimeout(6000);
  if (/^(match|noshow)$/.test(name)) {   // スコアを入れた状態 (2-1)
    const sels = await page.$$('.rp-sum-row select');
    if (sels[0]) await sels[0].selectOption('2').catch(() => {});
    if (sels[1]) await sels[1].selectOption('1').catch(() => {});
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => { scrollTo(0, 0); return document.fonts.ready; });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}_view.png` });
  await page.screenshot({ path: `${OUT}/${name}_full.png`, fullPage: true });
  meta[name] = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[class*="rp-"], h1, h2, h3, details, section')) {
      const r = el.getBoundingClientRect(); if (r.height < 24 || r.width < 100) continue;
      out.push({ tag: el.tagName, cls: el.className && el.className.baseVal === undefined ? String(el.className) : '', y: Math.round(r.top + scrollY), h: Math.round(r.height), x: Math.round(r.left), w: Math.round(r.width), t: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) });
    }
    return { H: document.documentElement.scrollHeight, els: out };
  });
  await page.close();
}
for (const [name, url, act] of ENTRY) {
  if (only && !only.includes(name)) continue;
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: '.rp-demo{display:none!important}' });
  await page.waitForTimeout(8000);
  if (act === 'nav_open') {
    const el = page.getByText('大会運営支援', { exact: false }).first();
    await el.click().catch(() => {}); await page.waitForTimeout(800);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${OUT}/${name}_view.png` });
  meta[name] = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[id], nav a, .notice, [class*="notice"]')) {
      const r = el.getBoundingClientRect(); if (r.height < 16 || r.width < 60 || r.top > 2000) continue;
      out.push({ tag: el.tagName, id: el.id, cls: String(el.className || ''), y: Math.round(r.top + scrollY), h: Math.round(r.height), x: Math.round(r.left), w: Math.round(r.width), t: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60) });
    }
    return { els: out };
  });
  await page.close();
}
fs.writeFileSync(`${OUT}/meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
