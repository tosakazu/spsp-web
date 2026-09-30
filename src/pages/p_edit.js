// @ts-check
// src/pages/p_edit.js — site/p/edit.html (プレイヤーカードの編集、2026-09-30)。
//   選べるもの: テンプレート (今は 1 種類)・色 (js/player_card.js COLORS)・カードに出す実績 (選んだ順に入る。入りきらないものは選べない)。
//   編集中の状態はこのブラウザに自動で保存し (下書き)、「適用」でサーバに保存してカードに出す (js/player_card_model.js)。
//   本人確認: start.gg でログインし (js/login.js)、ログインした人がこの選手のときだけ編集できる (サーバも token の本人の分しか書かない)。
//   API の無い ConoHa のプレビューでは本人確認を飛ばし、保存もこのブラウザ (見た目の確認用)。docs/login_design.md
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPFormat from '../../site/js/format.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';
import SPSPPlayerCard, { COLORS, TEMPLATES } from '../../site/js/player_card.js';
import { loadCardData, buildCardModel, cardAchievements, DEFAULT_SETTINGS, fetchApplied, putApplied, loadDraft, saveDraft, clearDraft } from '../../site/js/player_card_model.js';

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
/** @param {number} uid @returns {'ok' | 'login' | 'other'} */
function ownerState(uid) {
  if (!SpspLogin.apiAvailable()) return 'ok';   // ConoHa のプレビュー (ログインできない) では確認しない
  if (!SpspLogin.session()) return 'login';
  return SpspLogin.isSelf(uid) ? 'ok' : 'other';
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

  await SpspLogin.verify();   // 無効なトークンはここで消える
  /** 適用済み (サーバ) — 「適用」を押せるかの比較にも使う @type {CardSettings | null} */
  let applied = await fetchApplied(uid);
  /** @type {CardSettings} */
  let st = loadDraft(uid) || applied || { ...DEFAULT_SETTINGS };
  const cardEl = $('ce-card');
  const all = cardAchievements(data);
  const draw = () => SPSPPlayerCard.render(cardEl, buildCardModel(data, st));
  draw();

  const owner = ownerState(uid);
  if (owner !== 'ok') {
    $('ce-gate').style.display = '';
    const btn = /** @type {HTMLButtonElement} */ ($('ce-login-btn'));
    btn.addEventListener('click', () => { btn.disabled = true; SpspLogin.startLogin().then(ok => { if (!ok) btn.disabled = false; }); });
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
    const done = same(st, applied || DEFAULT_SETTINGS);   // 適用済みと同じなら押せない
    apply.disabled = done;
    apply.textContent = done ? i18n('card_edit.applied') : i18n('card_edit.apply');
    ($('ce-reset')).style.visibility = picked.length ? '' : 'hidden';
    // 畳んだ見出しの右: 今の選択 (実績 = 自動か選んだ数、大会 = 自動か選んだ大会名)
    $('ce-ach-sum').textContent = picked.length ? i18n('card_edit.n_selected', { n: picked.length }) : i18n('card_edit.auto');
    const tsel = st.tour != null ? tours.find(t => t.event_id === st.tour) : null;
    $('ce-tour-sum').textContent = tsel ? String(tsel.name || '') : i18n('card_edit.auto');
    paintTours();
  }

  // 大会: カード左下に出す大会を選ぶ。並べ替え (日付 = 新しい順 / ポイント = 今の重み / ポイント (減衰なし) = 素点) と大会名の検索。
  // 先頭の「自動」は既定 (順位評価のポイントが一番高い大会)。DQ の大会は出さない
  const tourEl = $('ce-tours');
  const tourQ = /** @type {HTMLInputElement} */ ($('ce-tour-q'));
  const SCALE = (data.meta.params && data.meta.params.TJPR_ELO_SCALE) || 17.5;
  const tours = (/** @type {any[]} */ (data.player.tournaments || [])).filter(t => !t.is_dq && t.event_id != null);
  let tourSort = 'date';
  /** @param {any} t */
  const ptsOf = t => (tourSort === 'raw' ? (t.tjpr_raw || 0) : (t.tjpr_w || 0)) * SCALE;
  function paintTours() {
    const hex = (COLORS.find(c => c.id === st.color) || COLORS[0]).hex;
    const q = tourQ.value.trim().toLowerCase();
    const list = tours.filter(t => !q || String(t.name || '').toLowerCase().includes(q))
      .sort((a, b) => tourSort === 'date' ? (b.ts || 0) - (a.ts || 0) : (ptsOf(b) - ptsOf(a)) || ((b.ts || 0) - (a.ts || 0)));
    const row = (/** @type {any} */ t) => {
      const on = st.tour === t.event_id;
      const pts = ptsOf(t);
      const place = t.place != null ? `${t.place}${i18n('player.place_unit', { n: t.place })}${t.nent != null ? '/' + t.nent : ''}` : '';
      return `<button type="button" class="ce-tour${on ? ' on' : ''}" data-tour="${t.event_id}" style="--c:${hex}" aria-pressed="${on}">` +
        `<span class="ce-tour-date">${escapeHtml(t.date || '')}</span><span class="ce-tour-name">${escapeHtml(t.name || '')}</span>` +
        `<span class="ce-tour-place">${escapeHtml(place)}</span><span class="ce-tour-pts">${pts >= 0.05 ? '+' + pts.toFixed(1) : ''}</span></button>`;
    };
    tourEl.innerHTML = `<button type="button" class="ce-tour auto${st.tour == null ? ' on' : ''}" data-tour="" style="--c:${hex}" aria-pressed="${st.tour == null}">${escapeHtml(i18n('card_edit.tour_auto'))}</button>` +
      (list.length ? list.map(row).join('') : `<div class="ce-tour auto" style="cursor:default;color:#9ca3af">${escapeHtml(i18n('card_edit.tour_none'))}</div>`);
  }
  tourEl.addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-tour]');
    if (!b) return;
    const v = b.getAttribute('data-tour');
    update({ tour: v ? Number(v) : null });
  });
  $('ce-tour-sort').addEventListener('click', e => {
    const b = /** @type {HTMLElement} */ (e.target).closest('[data-sort]');
    if (!b) return;
    tourSort = /** @type {string} */ (b.getAttribute('data-sort'));
    $('ce-tour-sort').querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b));
    paintTours();
  });
  tourQ.addEventListener('input', () => paintTours());

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
  // リセットは見出しの行 (summary) の中にあるので、押しても欄が開閉しないようにする
  $('ce-reset').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); update({ ach: null }); });
  // デフォルトに戻す: テンプレート・色・実績・大会を全部既定に (保存は「適用」で)
  $('ce-default').addEventListener('click', () => update({ ...DEFAULT_SETTINGS }));
  $('ce-apply').addEventListener('click', async () => {
    const btn = /** @type {HTMLButtonElement} */ ($('ce-apply'));
    btn.disabled = true;
    const r = await putApplied(uid, st);
    if (r.ok) {
      // 適用したら編集ページを閉じてプレイヤーページへ (新しい設定のカードがすぐ出る)
      applied = { ...st }; clearDraft(uid);
      location.assign(/** @type {HTMLAnchorElement} */ ($('ce-back')).href);
      return;
    }
    // 間隔が短すぎて断られたときは待てばよいことを伝える (それ以外は保存できなかった旨だけ)
    alert(r.code === 'rate_limited' ? i18n('card_edit.apply_too_soon') : i18n('card_edit.apply_failed'));
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
