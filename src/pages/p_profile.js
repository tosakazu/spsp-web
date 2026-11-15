// @ts-check
// src/pages/p_profile.js — site/p/profile.html (プロフィール編集、2026-11-15)。カードの編集 (p_edit.js) とは別のページ。
//   いま変えられるもの: スマッチのレートを自分のプレイヤーページに出すか (既定は出す)。切り替えたらすぐ保存する (action profile_put)。
//   カードの編集へのリンクもここに置く。本人だけ (preview は誰でも。p_edit.js と同じ確認)。
import '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPFormat from '../../site/js/format.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';
import '../../site/js/views.js';
import SPSPPlayerData from '../../site/js/player_data.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);
const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(location.search);
const DISC = (params.get('d') || '').trim();

/** @param {number} uid @returns {'ok' | 'login' | 'other'} */
function ownerState(uid) {
  if (SpspLogin.openEdit() && !(SpspLogin.session() && SpspLogin.isSelf(uid))) return 'ok';   // preview の Worker: 誰でも
  if (!SpspLogin.session()) return 'login';
  return SpspLogin.isSelf(uid) ? 'ok' : 'other';
}

/** 読み書きの相手: ログイン中の本人はトークン、preview の誰でも編集は uid @param {number} uid */
const who = uid => { const s = SpspLogin.session(); return s && SpspLogin.isSelf(uid) ? { token: s.token } : { uid: String(uid) }; };

async function main() {
  let uid = parseInt(params.get('uid') || '0');
  if (!uid && DISC) {
    await SPSPLinks.loadDiscriminators(SPSP.data);
    uid = SPSPLinks.uidOfDisc(DISC) || 0;
  }
  const rec = uid ? await SPSPPlayerData.load(SPSP.data, uid, { history: false }).catch(() => null) : null;
  $('loading').style.display = 'none';
  if (!uid || !rec) { $('not-found').style.display = ''; return; }
  const q = DISC ? '?d=' + encodeURIComponent(DISC) : '?uid=' + uid;
  $('pf-name').textContent = SPSPFormat.stripTeamTag(rec.display || '');
  /** @type {HTMLAnchorElement} */ ($('pf-back')).href = './' + q;
  /** @type {HTMLAnchorElement} */ ($('pf-card')).href = SPSP.pageHref('edit.html') + q;
  $('pf-root').style.display = '';

  if (!SpspLogin.apiAvailable()) { $('pf-gate').style.display = ''; $('pf-gate-msg').textContent = i18n('me.unavailable'); $('pf-login-btn').style.display = 'none'; return; }
  await SpspLogin.verify();   // 無効なトークンはここで消える
  const owner = ownerState(uid);
  if (owner !== 'ok') {
    $('pf-gate').style.display = '';
    const btn = /** @type {HTMLButtonElement} */ ($('pf-login-btn'));
    if (owner === 'other') {
      const sess = /** @type {NonNullable<ReturnType<typeof SpspLogin.session>>} */ (SpspLogin.session());
      $('pf-gate-msg').textContent = i18n('profile.not_owner');
      btn.style.display = 'none';
      const mine = /** @type {HTMLAnchorElement} */ ($('pf-mine-btn'));
      mine.href = SPSP.pageHref('profile.html') + '?uid=' + encodeURIComponent(String(sess.user.id));
      mine.style.display = '';
    } else {
      $('pf-gate-msg').textContent = i18n('profile.login_needed');
      btn.addEventListener('click', () => { btn.disabled = true; SpspLogin.startLogin().then(ok => { if (!ok) btn.disabled = false; }); });
    }
    return;
  }
  $('pf-form').style.display = '';

  const boxes = /** @type {HTMLInputElement[]} */ ([$('pf-smatch-show-1on1'), $('pf-smatch-show-tokuoma')]);
  const status = $('pf-status');
  const say = (/** @type {string} */ msg, bad = false) => { status.textContent = msg; status.classList.toggle('bad', bad); };
  const r = await SpspLogin.api({ action: 'profile_get', ...who(uid) });
  if (!r || !r.ok) { say(i18n('common.load_error', { message: (r && r.error && r.error.code) || '' }), true); return; }
  const linked = !!(r.smatch && r.smatch.linked);
  const chip = $('pf-smatch-chip');
  chip.textContent = linked ? i18n('profile.smatch.linked') : i18n('profile.smatch.unlinked');
  chip.classList.toggle('on', linked);
  if (!linked) $('pf-smatch-note').style.display = '';
  // ルールごと (1on1・特おま) に出す・出さない。設定は { smatch_1on1, smatch_tokuoma } (既定はどちらも出す)
  const key = (/** @type {HTMLInputElement} */ b) => String(b.dataset.key);
  /** @type {Record<string, boolean>} */
  let saved = {};
  for (const b of boxes) { saved[key(b)] = !(r.settings && r.settings[key(b)] === false); b.checked = saved[key(b)]; b.disabled = false; }
  // 切り替えたらすぐ保存 (2 つまとめて送る)。失敗したら元に戻す
  for (const box of boxes) box.addEventListener('change', async () => {
    /** @type {Record<string, boolean>} */
    const want = {};
    for (const b of boxes) { want[key(b)] = b.checked; b.disabled = true; }
    say('');
    const w = await SpspLogin.api({ action: 'profile_put', ...who(uid), settings: want });
    for (const b of boxes) b.disabled = false;
    if (w && w.ok) { saved = want; say(i18n('profile.saved')); } else { for (const b of boxes) b.checked = saved[key(b)]; say(i18n('profile.save_failed'), true); }
  });
}

main().catch(e => { console.error(e); $('loading').style.display = 'none'; $('not-found').style.display = ''; });
