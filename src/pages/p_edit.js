// @ts-check
// src/pages/p_edit.js — site/p/edit.html (プレイヤーカードの編集、2026-09-30)。
//   選べるもの: テンプレート (今は 1 種類)・色 (js/player_card.js COLORS)・カードに出す実績 (選んだ順に入る。入りきらないものは選べない)。
//   表と裏はタブで切り替える (?tab=back で裏から)。裏 = 裏面の名前とシール (src/pages/card_back_edit.js)。「適用」で表も裏もまとめて保存。
//   preview の Worker だけは、ログインなしで誰のカードでも編集・適用できる (見た目の確認用、js/login.js openEdit)。
//   編集中の状態はこのブラウザに自動で保存し (下書き)、「適用」でサーバに保存してカードに出す (js/player_card_model.js)。
//   本人確認: start.gg でログインし (js/login.js)、ログインした人がこの選手のときだけ編集できる (サーバも token の本人の分しか書かない)。
//   API の無い ConoHa のプレビューでは本人確認を飛ばし、保存もこのブラウザ (見た目の確認用)。docs/login_design.md
import { escapeHtml } from '../../site/js/html.js';
import SPSPI18n from '../../site/js/i18n.js';
import SPSPLinks from '../../site/js/links.js';
import SPSPFormat from '../../site/js/format.js';
import '../../site/nav.js';
import SpspLogin from '../../site/js/login.js';
import SPSPPlayerCard, { COLORS, TEMPLATES, defaultTitle } from '../../site/js/player_card.js';
import SpspTitleNotice from '../../site/js/title_notice.js';
import { TITLES, usableIn, titleById, bitsTitles, simulateTitles, obtainableCount } from '../../site/js/titles.js';
import { mountBackEditor } from './card_back_edit.js';
import { loadCardData, buildCardModel, cardAchievements, titleLang, DEFAULT_SETTINGS, fetchApplied, putApplied, loadDraft, saveDraft, clearDraft } from '../../site/js/player_card_model.js';

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
  if (SpspLogin.openEdit() && !(SpspLogin.session() && SpspLogin.isSelf(uid))) return 'ok';   // preview の Worker: 誰でも
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
  /** @type {HTMLAnchorElement} */ ($('ce-back')).href = './' + (DISC ? '?d=' + encodeURIComponent(DISC) : '?uid=' + uid);
  $('loading').style.display = 'none';
  $('ce-root').style.display = '';

  await SpspLogin.verify();   // 無効なトークンはここで消える
  // 適用済み (サーバ) — 「適用」を押せるかの比較にも使う。持っている二つ名 (記録) も一緒に読む
  const titlesOn = !(SPSP.site && SPSP.site.features && SPSP.site.features.titles === false);   // 二つ名の無い地域 (北米) は欄ごと出さない
  if (!titlesOn) $('ce-title-sec').style.display = 'none';
  const [appliedRes, ownedRec] = await Promise.all([fetchApplied(uid), titlesOn ? SpspTitleNotice.fetchOwned(uid) : Promise.resolve(null)]);
  /** @type {CardSettings | null} */
  let applied = appliedRes;
  /** @type {CardSettings} */
  let st = loadDraft(uid) || applied || { ...DEFAULT_SETTINGS };
  const cardEl = $('ce-card');
  const all = cardAchievements(data);
  // 二つ名: 持っているものは記録 (D1、GET /api/titles)。API の無い ConoHa のプレビューだけは、記録の代わりに出た大会から計算して見た目を確かめる
  const lang = titleLang();
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const mainChar = ((data.player && data.player.characters) || [])[0];
  const ownedBits = ownedRec ? ownedRec.bits
    : !titlesOn || SpspLogin.apiAvailable() ? ''
    : simulateTitles(lang, uid, (data.player && data.player.tournaments) || [],
                     { chars: mainChar ? [mainChar.id] : [], pref: (data.prefs && data.prefs[String(uid)]) || null }, today);
  const recordPending = !!ownedRec && ownedRec.updated === null;   // 記録がまだ無い (次の同期で配られる)
  const owned = new Set(bitsTitles(lang, ownedBits).map(t => t.id));
  /** 持っていて、その位置に使えるものの文字 @param {string} id @param {'pre' | 'post'} slot */
  const titleText = (id, slot) => { const t = owned.has(id) ? titleById(lang, id) : null; return t && usableIn(t, slot) ? t.text : ''; };
  const backEl = $('ce-card-back');
  const draw = () => {
    const model = buildCardModel(data, st, titleText);
    SPSPPlayerCard.render(cardEl, model, { live: true });
    SPSPPlayerCard.renderBack(backEl, model, { live: true });
  };
  draw();

  const owner = ownerState(uid);
  if (owner !== 'ok') {
    $('ce-gate').style.display = '';
    const btn = /** @type {HTMLButtonElement} */ ($('ce-login-btn'));
    if (owner === 'other') {
      // 別の人でログイン中: 自分のカードしか編集できないことと、自分のカードの編集ページへのボタン
      const sess = /** @type {NonNullable<ReturnType<typeof SpspLogin.session>>} */ (SpspLogin.session());
      $('ce-gate-msg').textContent = i18n('card_edit.not_owner');
      btn.style.display = 'none';
      const mine = /** @type {HTMLAnchorElement} */ ($('ce-mine-btn'));
      mine.href = SPSP.pageHref('edit.html') + '?uid=' + encodeURIComponent(String(sess.user.id));
      mine.style.display = '';
    } else {
      btn.addEventListener('click', () => { btn.disabled = true; SpspLogin.startLogin().then(ok => { if (!ok) btn.disabled = false; }); });
    }
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
  // 二つ名: まだ見ていない新しいもの (NEW)。開いた時点で既読にする (NEW はこのページを開いている間だけ出す)
  const newIds = new Set(bitsTitles(lang, SpspTitleNotice.newSince(ownedBits, uid)).map(t => t.id));
  if (ownedRec) SpspTitleNotice.markSeen(uid, ownedBits);
  // (二つ名の無い地域では titleList が空なので、下のリールは「なし」だけ。欄は上で隠してある)
  const titleList = TITLES[lang] || [];
  // リールの先頭 (選ばない) は既定の二つ名 (前半「スマブラSP」・後半「プレイヤー」)。既定の無い地域は「なし」
  const defTitle = defaultTitle();
  const defText = (/** @type {'pre' | 'post'} */ part) => (defTitle ? defTitle[part] : '');
  // 獲得数と全体 (全体 = 持っているもの + まだ引けるもの。ほかのキャラ・都道府県のものは入れない) は開いている間は変わらないので 1 回だけ
  // 記録がまだ無い (次の同期で配られる) ときは何も書かない
  const titleNote = recordPending ? ''
    : i18n('card_edit.title_note', { have: owned.size, total: obtainableCount(lang, owned, today) });
  /** リールの今の印 (変わったものだけ付け替える) @type {Record<'pre' | 'post', string | null | undefined>} */
  const marked = { pre: undefined, post: undefined };

  function paint() {
    const hex = (COLORS.find(c => c.id === st.color) || COLORS[0]).hex;
    tplEl.innerHTML = TEMPLATES.map(t =>
      `<button type="button" class="ce-tpl${t.id === st.template ? ' on' : ''}" data-tpl="${t.id}" aria-label="${escapeHtml(i18n('card_edit.template.' + t.id))}" aria-pressed="${t.id === st.template}" style="--c:${hex}">` +
      `<span class="ce-tpl-head"></span><span class="ce-tpl-box"></span><span class="ce-tpl-side"></span></button>`).join('');
    colEl.innerHTML = COLORS.map(c =>
      `<button type="button" class="ce-color${c.id === st.color ? ' on' : ''}" data-color="${c.id}" style="--c:${c.hex}" aria-label="${escapeHtml(i18n('card_edit.color.' + c.id))}" aria-pressed="${c.id === st.color}"></button>`).join('');
    paintTitles(hex);
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

  /** 二つ名のリール: 既定 (スマブラSP / プレイヤー、値 'default') +「なし」(null) + 持っているもの (一覧の順)。設定が無ければ既定。真ん中の帯に止まったものが選ばれる。
   * 項目は最初に 1 回だけ作り、あとは選択の印と色だけ変える (作り直すとスクロールが動いて画面がずれる) @param {string} hex */
  const REEL_H = 40;
  function paintTitles(hex) {
    for (const part of /** @type {('pre' | 'post')[]} */ (['pre', 'post'])) {
      const cur = st.title ? st.title[part] : 'default';
      const box = $('ce-title-' + part);
      /** @type {HTMLElement} */ (box.closest('.ce-reel')).style.setProperty('--c', hex);
      if (!box.childElementCount) {
        const mine = titleList.filter(x => usableIn(x, part) && owned.has(x.id));   // 「どちらでも」は前半・後半の両方のリールに出る
        box.innerHTML =
          (defText(part) ? `<div class="ce-reel-item" role="option" data-tid="default"><span class="ce-reel-text">${escapeHtml(defText(part))}</span></div>` : '') +   // 既定 (スマブラSP / プレイヤー)
          `<div class="ce-reel-item none" role="option" data-tid="">${escapeHtml(i18n('card_edit.title_none'))}</div>` +
          mine.map(x => `<div class="ce-reel-item" role="option" data-tid="${escapeHtml(x.id)}"><span class="ce-reel-text">${escapeHtml(x.text)}</span>${
            newIds.has(x.id) ? '<span class="ce-title-new">NEW</span>' : ''}</div>`).join('');
      }
      if (box.dataset.fitted !== '1') {
        box.dataset.fitted = '1';
        fitReelText(box);
        // 二つ名の字体 (SPSP Title) が後から来ると幅が変わるので、読み込んだら測り直す
        const fonts = /** @type {any} */ (document).fonts;
        if (fonts && fonts.ready) fonts.ready.then(() => fitReelText(box)).catch(() => {});
      }
      // 選択の印は、前の選択と今の選択の 2 つだけ付け替える (操作のたびに数千の項目を見直さない)
      if (marked[part] !== cur) {
        const mark = (/** @type {string | null | undefined} */ tid, /** @type {boolean} */ on) => {
          if (tid === undefined) return;
          const c = box.querySelector(`[data-tid="${tid || ''}"]`);   // id は ja-0123 の形だけ (エスケープ不要)
          if (c) { c.classList.toggle('on', on); c.setAttribute('aria-selected', String(on)); }
        };
        mark(marked[part], false);
        mark(cur, true);
        marked[part] = cur;
      }
      // リールの真ん中が今の選択と違えば (最初・「デフォルトに戻す」など、リール以外で変わったとき) そこまで回す
      const sel = box.querySelector('.ce-reel-item.on');
      const want = sel ? Array.prototype.indexOf.call(box.children, sel) : 0;
      const centered = Math.round(box.scrollTop / REEL_H);
      if (centered !== want && !box.dataset.spinning) box.scrollTop = want * REEL_H;
    }
    $('ce-title-note').textContent = titleNote;
  }
  /** 長い二つ名: 2 行に折り返しても行 (40px) に入らなければ、入るまで字を小さくする (最小 9px) @param {HTMLElement} box */
  function fitReelText(box) {
    for (const t of /** @type {HTMLElement[]} */ (Array.from(box.querySelectorAll('.ce-reel-text')))) {
      let size = 15;
      if (t.style.fontSize) t.style.fontSize = '';   // 前に小さくしたものだけ戻す (書かなければレイアウトの測り直しが要らない)
      while (t.offsetHeight > REEL_H - 2 && size > 9) { size -= 1; t.style.fontSize = size + 'px'; }
    }
  }
  /** 真ん中に止まった項目を選ぶ @param {'pre' | 'post'} part */
  const pickCentered = part => {
    const box = $('ce-title-' + part);
    delete box.dataset.spinning;
    const items = Array.from(box.children);
    const idx = Math.min(items.length - 1, Math.max(0, Math.round(box.scrollTop / REEL_H)));
    const tid = items[idx] ? items[idx].getAttribute('data-tid') || null : null;   // '' =「なし」= null
    const cur = st.title ? st.title[part] : 'default';
    if (tid === cur) return;
    const next = { pre: st.title ? st.title.pre : 'default', post: st.title ? st.title.post : 'default' };
    next[part] = tid;
    // 両方とも既定なら設定なし (null)。「なし / なし」は { pre: null, post: null } のまま (空欄)
    update({ title: next.pre === 'default' && next.post === 'default' ? null : next });
  };
  for (const part of /** @type {('pre' | 'post')[]} */ (['pre', 'post'])) {
    const box = $('ce-title-' + part);
    // 回し終わったら選ぶ (scrollend が無いブラウザは、止まってから 150ms 後)
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    box.addEventListener('scroll', () => {
      box.dataset.spinning = '1';   // 回している間は、描き直しでリールを動かさない
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => pickCentered(part), 150);
    }, { passive: true });
    box.addEventListener('scrollend', () => { if (timer) clearTimeout(timer); pickCentered(part); });
    // 項目を押したらそこまで回す
    box.addEventListener('click', (/** @type {MouseEvent} */ e) => {
      const it = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('.ce-reel-item'));
      if (!it) return;
      const idx = Array.from(box.children).indexOf(it);
      box.scrollTo({ top: idx * REEL_H, behavior: 'smooth' });
    });
    // 触ったときに選択 (フォーカス) で画面がずれないように: ブラウザはフォーカスした部分が見えるよう画面を動かすことがあり、
    // 上に貼り付いたカードのプレビューにリールが隠れていると、回している間に画面ごとスクロールして見える
    box.addEventListener('pointerdown', () => {
      if (document.activeElement !== box) box.focus({ preventScroll: true });
    });
    // マウスホイール: 1 回で 1 つずつ回し、画面には伝えない (端まで回したあとに画面がスクロールしないように)
    /** @type {number} */
    let wheelAt = 0;
    box.addEventListener('wheel', (/** @type {WheelEvent} */ e) => {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      const now = Date.now();
      if (now - wheelAt < 120 && Math.abs(e.deltaY) < 40) return;   // トラックパッドの細かい連続は間引く
      wheelAt = now;
      box.scrollBy({ top: e.deltaY > 0 ? REEL_H : -REEL_H, behavior: 'smooth' });
    }, { passive: false });
    // キーボード: 上下で 1 つずつ
    box.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      box.scrollBy({ top: e.key === 'ArrowDown' ? REEL_H : -REEL_H, behavior: 'smooth' });
    });
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
  // プレビューを押すと表と裏が入れ替わる
  const preview = $('ce-preview');
  preview.addEventListener('click', e => { if (!(/** @type {Element} */ (e.target)).closest('a')) preview.classList.toggle('flipped'); });
  // デフォルトに戻す: 表 (テンプレート・色・実績・大会・二つ名) を既定に (保存は「適用」で)。裏 (名前・シール) はそのまま
  $('ce-default').addEventListener('click', () => { update({ ...DEFAULT_SETTINGS, latin: st.latin ?? null, back: st.back ?? null }); });

  // ── 表と裏のタブ。裏は初めて開いたときに組み立てる (シールの一覧のデータを読むので) ──
  $('ce-tabs').style.display = '';
  let backMounted = false;
  /** @param {'front' | 'back'} tab */
  const setTab = tab => {
    for (const b of $('ce-tabs').querySelectorAll('button')) {
      const on = /** @type {HTMLElement} */ (b).dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    $('ce-pane-front').style.display = tab === 'front' ? '' : 'none';
    $('ce-pane-back').style.display = tab === 'back' ? '' : 'none';
    preview.style.display = tab === 'front' ? '' : 'none';   // 裏のタブは自分のカード (シールを貼る台) を出す
    $('ce-default').style.display = tab === 'front' ? '' : 'none';
    try {
      const u = new URL(location.href);
      if (tab === 'back') u.searchParams.set('tab', 'back'); else u.searchParams.delete('tab');
      history.replaceState(null, '', u.toString());
    } catch (e) { /* URL を変えられなくても切り替えはできる */ }
    if (tab === 'back' && !backMounted) {
      backMounted = true;
      mountBackEditor({
        uid, data, back: st.back ?? null, latin: st.latin ?? null,
        model: (latin, back) => buildCardModel(data, { ...st, latin, back }, titleText),
        onChange: patch => update(patch),
      }).catch(e => console.error(e));
    }
  };
  for (const b of $('ce-tabs').querySelectorAll('button')) {
    b.addEventListener('click', () => setTab(/** @type {'front' | 'back'} */ (/** @type {HTMLElement} */ (b).dataset.tab)));
  }
  setTab(params.get('tab') === 'back' ? 'back' : 'front');
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
  tester = SPSPPlayerCard.makeAchFitTester(buildCardModel(data, st, titleText));
  paint();
}

main().catch(e => { console.error(e); notFound(i18n('common.load_error', { message: e.message })); });
