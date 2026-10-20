// @ts-check
// src/pages/p_badges.js — site/p/badges.html (裏面のシールの試作ページ、2026-10-20 にカード編集の「裏」タブへ移した)。
//   前の URL で来たら、同じ選手のカード編集の裏のタブへ移る
import '../../site/js/html.js';   // SPSP.pageHref

const q = new URLSearchParams(location.search);
q.set('tab', 'back');
location.replace(SPSP.pageHref('edit.html') + '?' + q.toString());
