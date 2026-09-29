// @ts-check
// src/pages/p_edit.js — site/p/edit.html (プレイヤーカードの編集、2026-09-30)。
//   選べるもの: テンプレート (今は 1 種類)・色 (js/player_card.js COLORS)・カードに出す実績 (選んだ順に入る。入りきらないものは選べない)。
//   編集中の状態はこのブラウザに自動で保存し (下書き)、「適用」でカードに出す設定にする (js/player_card_model.js)。
//   本人確認: start.gg でログインし、ログインした人がこの選手のときだけ編集できる。いまはサーバ側が無いので
//   ブラウザのセッションで見るだけ・保存もブラウザだけ (サーバへの保存と検証は後で)。ログインは spsp.games でしか通らないので、
//   確認用のプレビュー (それ以外のドメイン) では本人確認を飛ばす。
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPFormat from '../../site/js/format.js';
import '../../site/nav.js';
import SPSP_POST_CONFIG from '../../site/js/post_config.js';
import SpspAuth from '../../site/js/auth.js';
import SpspOAuthState from '../../site/js/oauth_state.js';
import SPSPPlayerCard, { COLORS, TEMPLATES } from '../../site/js/player_card.js';
import { loadCardData, buildCardModel, cardAchievements, DEFAULT_SETTINGS, loadApplied, saveApplied, loadDraft, saveDraft, clearDraft } from '../../site/js/player_card_model.js';

'use strict';
const i18n = SPSPI18n.t;
SPSPI18n.apply(document);

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
const params = new URLSearchParams(location.search);
const DISC = (params.get('d') || '').trim().toLowerCase();

/** @typedef {import('../../site/js/player_card_model.js').CardSettings} CardSettings */

/** @param {string} msg */
function notFound(msg) {
  $('loading').style.display = 'none';
  const nf = $('not-found');
  if (msg) nf.textContent = msg;
  nf.style.display = '';
}

// ── 本人確認 (ログイン) ──
const CFG = SPSP_POST_CONFIG;
const S = SpspOAuthState;
/** 確認用のプレビューなど spsp.games 以外では本人確認をしない (ログインがそこでしか通らないため) */
const checkOwner = () => S.isCanonicalOrigin(CFG, location.origin);
/** @param {number} uid @returns {'ok' | 'login' | 'other'} */
function ownerState(uid) {
  if (!checkOwner()) return 'ok';
  const sess = SpspAuth.load();
  if (!sess) return 'login';
  return String(sess.user.id) === String(uid) ? 'ok' : 'other';
}
// start.gg へ (投票ページと同じ流れ: state はサーバに署名してもらい、戻り先はこのページ)
function startLogin() {
  const btn = /** @type {HTMLButtonElement} */ ($('ce-login-btn'));
  let nonce;
  try { nonce = crypto.randomUUID(); } catch (e) { return; }
  S.saveNonce(nonce);
  try { sessionStorage.setItem(S.INTENT_KEY, 'login'); } catch (e) { /* 続行 */ }
  btn.disabled = true;
  fetch(CFG.GAS_ENDPOINT, {
    method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'begin_login', flow: 'login', nonce, returnPath: location.pathname + location.search }),
  }).then(r => r.json()).then(json => {
    if (!json || !json.ok || !json.state) { btn.disabled = false; return; }
    location.assign(S.buildAuthorizeUrl(CFG, json.state));
  }).catch(() => { btn.disabled = false; });
}

// ── 本体 ──
async function main() {
  let uid = parseInt(params.get('uid') || '0');
  if (!uid && DISC) {
    await SPSPLinks.loadDiscriminators(SPSP.data);
    uid = SPSPLinks.uidOfDisc(DISC) || 0;
  }
  if (!uid) { notFound(''); return; }
  const data = await loadCardData(uid).catch(() => null);
  if (!data || !data.meta) { notFound(''); return; }

  const name = SPSPFormat.stripTeamTag(data.rec.display);
  document.title = `${name} | SPSP`;
  $('ce-name').textContent = name;
  /** @type {HTMLAnchorElement} */ ($('ce-back')).href = './' + (DISC ? '?d=' + encodeURIComponent(DISC) : '?uid=' + uid);
  $('loading').style.display = 'none';
  $('ce-root').style.display = '';

  /** @type {CardSettings} */
  let st = loadDraft(uid) || loadApplied(uid) || { ...DEFAULT_SETTINGS };
  const cardEl = $('ce-card');
  const all = cardAchievements(data);
  const draw = () => SPSPPlayerCard.render(cardEl, buildCardModel(data, st));
  draw();

  const owner = ownerState(uid);
  if (owner !== 'ok') {
    $('ce-gate').style.display = '';
    const btn = $('ce-login-btn');
    btn.addEventListener('click', startLogin);
    if (owner === 'other') { $('ce-gate-msg').textContent = i18n('card_edit.not_owner'); }
    return;
  }
  $('ce-form').style.display = '';

  // 選択を変えたら: 下書きに保存 → カードと選択肢を描き直す
  const same = (/** @type {CardSettings | null} */ a, /** @type {CardSettings | null} */ b) => JSON.stringify(a) === JSON.stringify(b);
  /** @param {Partial<CardSettings>} patch */
  const update = patch => {
    st = { ...st, ...patch };
    if (st.ach && !st.ach.length) st.ach = null;   // 何も選んでいなければ自動
    saveDraft(uid, st);
    draw();
    paint();
  };

  // テンプレート: 小さなカードの絵 (今の色で)
  const tplEl = $('ce-templates');
  // 色: 丸い見本
  const colEl = $('ce-colors');
  // 実績: 選んだ順に番号。カードに入りきらないものは押せない
  const achEl = $('ce-achs');
  /** @type {{ fits: (labels: string[]) => boolean, destroy: () => void } | null} */
  let tester = null;
  const labelOf = new Map(all.map(a => [a.key, a.label]));

  function paint() {
    const hex = (COLORS.find(c => c.id === st.color) || COLORS[0]).hex;
    tplEl.innerHTML = TEMPLATES.map(t =>
      `<button type="button" class="ce-tpl${t.id === st.template ? ' on' : ''}" data-tpl="${t.id}" aria-label="${escapeHtml(i18n('card_edit.template.' + t.id))}" aria-pressed="${t.id === st.template}" style="--c:${hex}">` +
      `<span class="ce-tpl-head"></span><span class="ce-tpl-box"></span><span class="ce-tpl-side"></span></button>`).join('');
    colEl.innerHTML = COLORS.map(c =>
      `<button type="button" class="ce-color${c.id === st.color ? ' on' : ''}" data-color="${c.id}" style="--c:${c.hex}" aria-label="${escapeHtml(i18n('card_edit.color.' + c.id))}" aria-pressed="${c.id === st.color}"></button>`).join('');
    const picked = (st.ach || []).filter(k => labelOf.has(k));
    const pickedLabels = picked.map(k => /** @type {string} */ (labelOf.get(k)));
    achEl.innerHTML = all.map(a => {
      const n = picked.indexOf(a.key);
      const can = n >= 0 || !tester || tester.fits([...pickedLabels, a.label]);
      return `<button type="button" class="ce-ach${n >= 0 ? ' on' : ''}" data-key="${escapeHtml(a.key)}"${can ? '' : ' disabled'} style="--c:${hex}">` +
        (n >= 0 ? `<span class="ce-ach-n">${n + 1}</span>` : '') + `<span>${escapeHtml(a.label)}</span></button>`;
    }).join('');
    const apply = /** @type {HTMLButtonElement} */ ($('ce-apply'));
    const done = same(st, loadApplied(uid) || DEFAULT_SETTINGS);   // 適用済みと同じなら押せない
    apply.disabled = done;
    apply.textContent = done ? i18n('card_edit.applied') : i18n('card_edit.apply');
    ($('ce-reset')).style.visibility = picked.length ? '' : 'hidden';
  }

  tplEl.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-tpl]');
    if (b) update({ template: /** @type {string} */ (b.getAttribute('data-tpl')) });
  });
  colEl.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-color]');
    if (b) update({ color: /** @type {string} */ (b.getAttribute('data-color')) });
  });
  achEl.addEventListener('click', e => {
    const b = /** @type {HTMLButtonElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-key]'));
    if (!b || b.disabled) return;
    const key = /** @type {string} */ (b.getAttribute('data-key'));
    const cur = (st.ach || []).filter(k => labelOf.has(k));
    update({ ach: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] });
  });
  $('ce-reset').addEventListener('click', () => update({ ach: null }));
  $('ce-apply').addEventListener('click', () => {
    saveApplied(uid, st);
    clearDraft(uid);
    paint();
  });

  paint();
  // 入りきるかの判定は Web フォントを読み終えてから (幅が変わるため)
  const fonts = /** @type {any} */ (document).fonts;
  await (fonts && fonts.ready ? fonts.ready.catch(() => {}) : Promise.resolve());
  tester = SPSPPlayerCard.makeAchFitTester(buildCardModel(data, st));
  paint();
}

main().catch(e => { console.error(e); notFound(i18n('common.load_error', { message: e.message })); });
