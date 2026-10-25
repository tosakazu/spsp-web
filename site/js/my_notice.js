// @ts-check
// my_notice.js — ログイン中の本人へのお知らせ (全国順位が上がった・Lv が上がった・二つ名を新しく入手した)。
//   observe(uid, {rank, lv})   ページが読んだ今の全国順位 (総合) と Lv を記録する (トップの一覧・自分のプレイヤーページ)
//   items(uid, titlesN)        出すお知らせの配列 [{kind, ...}]。titlesN = 新しい二つ名の数 (js/title_notice.js の checkNew)
//   dismiss(uid, titlesN)      × で閉じた: 今の順位・Lv を「見た」にして、二つ名はこの数まで出さない
//   render(el, uid, opts)      お知らせの帯を el に描く (無ければ隠す)。× で閉じる
//   showForSelf(el, recOf, o)  ログイン中なら recOf(本人の uid) の記録 (ranks / scores) を observe して帯を描く。
//                              recOf が undefined を返したら何もしない (他人のプレイヤーページ)
//   itemHTML(it) / bindTitles(el, uid, editHref)
//                              1 件の HTML。二つ名は「N 件入手 ▼」のボタンにして、押すと新しく入手した二つ名を下に並べる
//                              (一覧 js/titles_ja.js は押したときだけ読む。全ページのヘッダーには束ねない)
// 比べる相手は「前に閉じたときの順位・Lv」。下がったときは黙ってその値に合わせる (次に上がった分だけ出す)。
// 初めて見るときは何も出さない (今の値を基準にする)。記録はこのブラウザだけ (二つ名の NEW と同じ)。
// 順位と Lv はトップ (latest_tjpr_full.jsonl) と自分のプレイヤーページ (players_current.json) で読んだときだけ更新する。
// ほかのページ (ベル) は記録を見るだけ (重い一覧ファイルを読まない)
import SPSPI18n from './i18n.js';
import SpspTitleNotice from './title_notice.js';
import SpspLogin from './login.js';
import { bitsNumbers } from './title_bits.js';

const KEY = 'spsp_my_notice_v1';   // { uid: { base: {rank, lv}, now: {rank, lv}, titlesHid } }

const site = () => /** @type {any} */ ((typeof window !== 'undefined' ? window : globalThis)).SPSP || {};
/** @param {string} k @param {any} [p] */
const t = (k, p) => SPSPI18n.t(k, p);

/** @returns {Record<string, any>} */
function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
}
/** @param {Record<string, any>} m */
function writeAll(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* 保存できなければ出し続けるだけ */ }
}
/** @param {any} v @returns {number | null} */
const num = v => (v != null && Number(v) > 0) ? Number(v) : null;

/** @param {number | string} uid @param {{rank?: any, lv?: any}} cur */
export function observe(uid, cur) {
  const m = readAll();
  const k = String(uid);
  const now = { rank: num(cur.rank), lv: num(cur.lv) };
  const st = m[k];
  if (!st || !st.base) { m[k] = { base: { ...now }, now, titlesHid: 0 }; writeAll(m); return; }
  const base = st.base;
  // 基準が無い (圏外だった) / 下がった (同じ) ときは基準を今に合わせる。上がったときだけ基準を残す
  if (base.rank == null || now.rank == null || now.rank >= base.rank) base.rank = now.rank;
  if (base.lv == null || now.lv == null || now.lv <= base.lv) base.lv = now.lv;
  st.now = now;
  writeAll(m);
}

/**
 * @param {number | string} uid @param {number} [titlesN]
 * @returns {Array<{kind: 'rank' | 'lv' | 'titles', from?: number, to?: number, n?: number}>}
 */
export function items(uid, titlesN) {
  const st = readAll()[String(uid)];
  /** @type {Array<{kind: 'rank' | 'lv' | 'titles', from?: number, to?: number, n?: number}>} */
  const out = [];
  if (st && st.base && st.now) {
    // 文字列で innerHTML に入るので、保存値 (localStorage) は数に直してから使う
    const b = { rank: num(st.base.rank), lv: num(st.base.lv) }, n = { rank: num(st.now.rank), lv: num(st.now.lv) };
    if (b.rank != null && n.rank != null && n.rank < b.rank) out.push({ kind: 'rank', from: b.rank, to: n.rank });
    if (b.lv != null && n.lv != null && n.lv > b.lv) out.push({ kind: 'lv', from: b.lv, to: n.lv });
  }
  const tn = Number(titlesN) || 0;
  const hid = st ? Number(st.titlesHid) || 0 : 0;
  if (tn > hid) out.push({ kind: 'titles', n: tn });
  return out;
}

/** @param {number | string} uid @param {number} [titlesN] */
export function dismiss(uid, titlesN) {
  const m = readAll();
  const k = String(uid);
  const st = m[k] || {};
  if (st.now) st.base = { ...st.now };
  st.titlesHid = Number(titlesN) || 0;
  m[k] = st;
  writeAll(m);
  navChanged();
}

/** 二つ名の数は編集ページで見たら 0 に戻る。閉じた数より減ったら閉じた数も合わせる @param {number | string} uid @param {number} titlesN */
function syncTitles(uid, titlesN) {
  const m = readAll();
  const st = m[String(uid)];
  if (st && Number(st.titlesHid) > titlesN) { st.titlesHid = titlesN; writeAll(m); }
}

/** @param {number | string} uid @returns {Promise<number>} */
export function titlesNew(uid) {
  const S = site();
  if (S.features && S.features.titles === false) return Promise.resolve(0);   // 二つ名の無い地域 (北米): 記録を読まない
  return SpspTitleNotice.checkNew(uid).then(n => { syncTitles(uid, n); return n; }).catch(() => 0);
}

/** @param {any} s */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (/** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }))[c]);

/** 1 件の文面 (HTML) @param {{kind: string, from?: number, to?: number, n?: number}} it */
export function text(it) {
  if (it.kind === 'rank') return t('notice.me.rank', { from: it.from, to: it.to }) + ` <span class="d">(+${Number(it.from) - Number(it.to)})</span>`;   // (+15) は折り返さない
  if (it.kind === 'lv') return t('notice.me.lv', { from: it.from, to: it.to });
  return t('notice.me.titles', { n: it.n });
}

/** 1 件の HTML。二つ名は押すと一覧が開くボタン (bindTitles で動かす)。それ以外は text のまま @param {{kind: string, from?: number, to?: number, n?: number}} it */
export function itemHTML(it) {
  if (it.kind !== 'titles') return text(it);
  return `<span class="my-notice-titles"><button type="button" class="my-notice-titles-toggle" aria-expanded="false">${text(it)}<span class="caret" aria-hidden="true">▼</span></button>` +
    `<span class="my-notice-titles-list" hidden></span></span>`;
}

/** 二つ名の一覧 (日本語だけ、北米は二つ名が無い)。押したときに 1 回だけ読む
 * @type {Promise<Map<number, {part: string, text: string}>> | null} */
let rowsP = null;
function loadRows() {
  if (!rowsP) {
    const url = new URL((site().root || './') + 'js/titles_ja.js', document.baseURI).href;
    rowsP = import(url).then((/** @type {any} */ m) => new Map((m.JA_ROWS || []).map((/** @type {any[]} */ r) => [Number(r[0]), { part: String(r[1]), text: String(r[3]) }])));
    rowsP.catch(() => { rowsP = null; });   // 読めなければ次に押したときにもう一度
  }
  return rowsP;
}

/** 新しく入手した二つ名 (前に編集ページで見たときに無かったもの)。記録が読めなければ null
 * @param {number | string} uid @returns {Promise<Array<{part: string, text: string}> | null>} */
export async function newTitles(uid) {
  if ((site().site && site().site.titleLang || 'ja') !== 'ja') return [];
  const owned = await SpspTitleNotice.fetchOwned(uid);
  if (!owned) return null;
  const nums = bitsNumbers(SpspTitleNotice.newSince(owned.bits, uid));
  if (!nums.length) return [];
  const rows = await loadRows();
  return nums.map(n => rows.get(n)).filter(r => r != null).map(r => /** @type {{part: string, text: string}} */ (r));
}

/** @param {{part: string, text: string}} r */
function titleLi(r) {
  const tag = r.part === 'pre' ? t('card_edit.title_pre') : r.part === 'post' ? t('card_edit.title_post') : '';
  return `<li>${esc(r.text)}${tag ? ` <span class="part">${esc(tag)}</span>` : ''}</li>`;
}

/**
 * el の中の「二つ名を N 件入手 ▼」を動かす: 押すと開閉し、初めて開いたときに一覧を読んで並べる (下にカード編集へのリンク)
 * @param {Element} el @param {number | string} uid @param {string} editHref
 * @param {Array<{part: string, text: string}>} [demoList] 見た目の確認用 (記録を読まない)
 */
export function bindTitles(el, uid, editHref, demoList) {
  el.querySelectorAll('.my-notice-titles-toggle').forEach(b => {
    const btn = /** @type {HTMLButtonElement} */ (b);
    const box = /** @type {HTMLElement | null} */ (btn.parentElement && btn.parentElement.querySelector('.my-notice-titles-list'));
    if (!box) return;
    let loaded = false;
    btn.addEventListener('click', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      box.hidden = !open;
      if (!open || loaded) return;
      loaded = true;
      box.innerHTML = `<span class="empty">${esc(t('common.loading'))}</span>`;
      (demoList ? Promise.resolve(demoList) : newTitles(uid)).then(list => {
        if (list == null) { loaded = false; box.innerHTML = `<span class="empty">${esc(t('notice.me.titles_failed'))}</span>`; return; }
        box.innerHTML = (list.length ? `<ul>${list.map(titleLi).join('')}</ul>` : `<span class="empty">${esc(t('notice.me.titles_none'))}</span>`) +
          `<a class="my-notice-titles-edit" href="${esc(editHref)}">${esc(t('notice.me.titles_edit'))}</a>`;
      }).catch(() => { loaded = false; box.innerHTML = `<span class="empty">${esc(t('notice.me.titles_failed'))}</span>`; });
    });
  });
}

/** 見た目の確認用 (?mynotice=demo): ログインも記録も見ずに 3 種類を出す。× は隠すだけ。リンクは押しても移らない @param {HTMLElement} el @param {boolean} selfPage */
function renderDemo(el, selfPage) {
  const list = [{ kind: 'rank', from: 50, to: 35 }, { kind: 'lv', from: 3, to: 4 }, { kind: 'titles', n: 2 }];
  el.innerHTML = `<div class="my-notice-items">${list.map(it => it.kind === 'titles' ? `<span class="my-notice-item titles">${itemHTML(it)}</span>` : selfPage ? `<span class="my-notice-item ${it.kind}">${text(it)}</span>` : `<a class="my-notice-item ${it.kind}" href="#">${text(it)}</a>`).join('')}</div><button type="button" class="ticker-close" aria-label="${esc(t('notice.me.close'))}">×</button>`;
  bindTitles(el, 0, '#', [{ part: 'pre', text: '択を拒む' }, { part: 'post', text: 'カメラに抜かれた' }]);
  el.style.display = '';
  const btn = el.querySelector('.ticker-close');
  if (btn) btn.addEventListener('click', () => { el.style.display = 'none'; });
}

/**
 * お知らせの帯を el に描く (トップの速報・通知と同じ形、× で閉じる)
 * @param {HTMLElement} el @param {number | string} uid
 * @param {{titlesN?: number, root?: string, selfPage?: boolean}} [opts]  root = サイトのルートへの相対 (リンク用)。
 *   selfPage = 自分のプレイヤーページ (順位・Lv はリンクにしない。押しても同じページなので)
 */
export function render(el, uid, opts) {
  const o = opts || {};
  const list = items(uid, o.titlesN);
  if (!list.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const S = site();
  const root = o.root != null ? o.root : (S.root || '');
  const page = (/** @type {string} */ p) => root + (S.pageHref ? S.pageHref(p) : p);
  const id = encodeURIComponent(String(uid));
  const editHref = page('p/edit.html') + '?uid=' + id;
  el.innerHTML =
    `<div class="my-notice-items">${list.map(it => it.kind === 'titles'
      ? `<span class="my-notice-item titles">${itemHTML(it)}</span>`   // 押すと新しい二つ名の一覧が開く (下にカード編集へのリンク)
      : o.selfPage
        ? `<span class="my-notice-item ${it.kind}">${text(it)}</span>`
        : `<a class="my-notice-item ${it.kind}" href="${page('p/index.html') + '?uid=' + id}">${text(it)}</a>`).join('')}</div>` +
    `<button type="button" class="ticker-close" aria-label="${esc(t('notice.me.close'))}" title="${esc(t('common.close'))}">×</button>`;
  el.style.display = '';
  bindTitles(el, uid, editHref);
  const btn = el.querySelector('.ticker-close');
  if (btn) btn.addEventListener('click', ev => {
    ev.stopPropagation();
    dismiss(uid, o.titlesN);
    el.style.display = 'none';
  });
}

function navChanged() {
  const w = /** @type {any} */ (typeof window !== 'undefined' ? window : null);
  if (w && w.SPSPMyNoticeChanged) w.SPSPMyNoticeChanged();   // ヘッダーのベルを付け直す (nav.js)
}

/** @param {number | string} uid @param {any} rec ranks.ensemble と Lv (shared_cascade_lv、無ければ tjpr_level。プレイヤーページと同じ) */
export function observeRec(uid, rec) {
  const sc = (rec && rec.scores) || {};
  observe(uid, { rank: rec && rec.ranks && rec.ranks.ensemble, lv: sc.shared_cascade_lv || sc.tjpr_level });
}

/** @param {HTMLElement | null} el @param {(uid: number) => any} recOf @param {{selfPage?: boolean}} [opts] */
export async function showForSelf(el, recOf, opts) {
  if (!el) return;
  if (/[?&]mynotice=demo\b/.test(location.search)) { renderDemo(el, !!(opts && opts.selfPage)); return; }   // 見た目の確認用 (記録は変えない)
  try { await SpspLogin.verify(); } catch (e) { /* 前のセッションのまま */ }
  const sess = SpspLogin.session();
  if (!sess) return;
  const uid = String(sess.user.id);
  const rec = await recOf(Number(uid));   // 同期でも Promise でもよい (トップは表に無い本人の行を取りに行く)
  if (rec === undefined) return;
  observeRec(uid, rec);   // 一覧に居ない (圏外) なら null: 基準も null にして、次に載ったときは出さない
  const n = await titlesNew(uid);
  render(el, uid, { titlesN: n, selfPage: !!(opts && opts.selfPage) });
  navChanged();
}

const API = { observe, observeRec, items, dismiss, titlesNew, text, itemHTML, newTitles, bindTitles, render, showForSelf };
// ほかの共通モジュールと同じく window にも置く
if (typeof window !== 'undefined') /** @type {any} */ (window).SpspMyNotice = API;
export default API;
