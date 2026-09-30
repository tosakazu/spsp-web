// @ts-check
// src/pages/me.js — site/me.html (自分のプレイヤーページへの共通リンク、2026-09-30)。
//   ログイン中: すぐ自分のプレイヤーページ (p/?uid=<start.gg のユーザー ID>) へ移る (履歴に残さない)。
//   ログアウト中: start.gg でログインしてもらい、戻ってきたら (このページに ?login=1 で戻る) 同じく移る。
//   ログインできない所 (API の無い ConoHa のプレビュー) では、その旨だけ出す。
import '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

async function main() {
  await SpspLogin.verify();   // 無効なトークンはここで消える
  const sess = SpspLogin.session();
  if (sess) {
    location.replace(SPSP.pageHref('p/index.html') + '?uid=' + encodeURIComponent(String(sess.user.id)));
    return;
  }
  $('loading').style.display = 'none';
  $('me-gate').style.display = '';
  const btn = /** @type {HTMLButtonElement} */ ($('me-login-btn'));
  if (!SpspLogin.apiAvailable()) {
    $('me-msg').textContent = i18n('me.unavailable');
    btn.style.display = 'none';
    return;
  }
  btn.addEventListener('click', () => { btn.disabled = true; SpspLogin.startLogin().then(ok => { if (!ok) btn.disabled = false; }); });
}

main().catch(e => { console.error(e); });
