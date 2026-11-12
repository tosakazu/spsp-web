// 結果報告の運営への通知 (Web Push、2026-11-01)。報告ページ (/jp/report/) を範囲にして登録する (src/pages/report.js の pushOn)。
// Worker (worker/src/api/report_notify.ts) が { title, body, url, tag } を暗号化して送る。押すとその受付の運営の画面を開く。
// ページの外 (閉じていても) で動くので、ほかのことはしない (キャッシュもしない)
'use strict';

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  const title = typeof d.title === 'string' && d.title ? d.title : 'SPSP';
  const opt = { body: typeof d.body === 'string' ? d.body : '', data: { url: typeof d.url === 'string' ? d.url : './' } };
  if (typeof d.tag === 'string' && d.tag) { opt.tag = d.tag; opt.renotify = true; }
  e.waitUntil(self.registration.showNotification(title, opt));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const raw = e.notification.data && e.notification.data.url ? e.notification.data.url : './';
  const url = new URL(raw, self.registration.scope);
  // 同じサイトの中だけ開く
  const target = url.origin === self.location.origin ? url.href : self.registration.scope;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url === target && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});
